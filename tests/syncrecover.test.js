/* Unsent changes are never lost or reported as saved: the data-loss bug found in QA (the sign-in expires,
   the person keeps editing, the server never saves it, the pending marker is cleared and the next sign-in
   replaces the browser copy) and everything around it.
   Part 1 is the pure replay logic (js/sync-recover.js). Part 2 runs the real core.js + cloud-sync.js in
   browser tabs against a fake gateway that applies saves with the real server guard: expiry, signing in
   again, conflicts, other accounts, several tabs, reloads, network failures and full browser storage.
   Run: npm test */
const assert = require('assert');
const SR = require('../js/sync-recover.js');
const { Browser, Server, Tab, Locks, clone } = require('./support/browser.js');

/* ------------------------------------------------ part 1: the replay logic */
{
  const rec = (id, o = {}) => ({ id, ...o });
  const server0 = { courses: [rec('C1', { title: 'One', n: 1 }), rec('C2', { title: 'Two' })], settings: { brand: 'a' } };
  const base = SR.baseOf(server0);
  assert.equal(base._v, SR.VERSION);
  assert.equal(SR.hash({ a: 1, b: { c: 2, d: 3 } }), SR.hash({ b: { d: 3, c: 2 }, a: 1 }), 'key order does not matter (the database reorders keys)');
  assert.notEqual(SR.hash({ a: 1 }), SR.hash({ a: 2 }));

  // what a copy changed
  const mine = clone(server0); mine.courses[0].title = 'One edited'; mine.courses.push(rec('C3', { title: 'New' })); mine.courses = mine.courses.filter(c => c.id !== 'C2'); mine.settings.brand = 'b'; mine._sync = base;
  const d = SR.delta(mine, base);
  assert.equal(d.count, 4);
  assert.deepEqual(Object.keys(d.changes.courses.put).sort(), ['C1', 'C3']);
  assert.deepEqual(d.changes.courses.del, ['C2']);
  assert.equal(d.changes.courses.from.C3, null, 'a created record has no base');
  assert.equal(d.changes.settings.value.brand, 'b');
  assert.equal(SR.delta(server0, base).count, 0, 'an untouched copy has no changes');
  assert.equal(SR.delta(mine, null).count, 0, 'without a base nothing can be said to have changed');
  const noBaseKey = SR.delta({ courses: [rec('C9')], extra: [rec('X')] }, { _v: 2, courses: {} });
  assert.deepEqual(Object.keys(noBaseKey.changes), ['courses'], 'a key the base never covered is skipped, not guessed');

  // replay onto the server's copy: nothing else changed -> everything applies
  let r = SR.apply(d.changes, clone(server0));
  assert.deepEqual(r.state.courses.map(c => c.id + ':' + (c.title || '')), ['C1:One edited', 'C3:New']);
  assert.equal(r.state.settings.brand, 'b');
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.applied.length, 4);
  // replayed twice (a retry after a failed push): nothing is applied again, nothing conflicts
  const twice = SR.apply(d.changes, r.state);
  assert.deepEqual([twice.applied.length, twice.conflicts.length, twice.already.length], [0, 0, 4], 'replay is idempotent');

  // someone else changed the same record -> conflict, the server's version stays
  const theirs = clone(server0); theirs.courses[0].title = 'One by someone else';
  r = SR.apply(d.changes, theirs);
  assert.equal(r.state.courses.find(c => c.id === 'C1').title, 'One by someone else', "the server's newer record is never overwritten");
  assert.deepEqual(r.conflicts.map(c => c.collection + ':' + c.id + ':' + c.kind), ['courses:C1:changed']);
  assert.equal(r.conflicts[0].mine.title, 'One edited', 'my version is kept aside');
  assert.ok(r.state.courses.some(c => c.id === 'C3') && !r.state.courses.some(c => c.id === 'C2'), 'unrelated changes still apply');
  // deleted on the server while I edited it
  const gone = clone(server0); gone.courses = gone.courses.filter(c => c.id !== 'C1');
  r = SR.apply(d.changes, gone);
  assert.ok(!r.state.courses.some(c => c.id === 'C1'), 'not brought back silently');
  assert.equal(r.conflicts.find(c => c.id === 'C1').kind, 'deleted');
  // I deleted what someone else edited since
  const edited = clone(server0); edited.courses[1].title = 'Two edited elsewhere';
  r = SR.apply(d.changes, edited);
  assert.ok(r.state.courses.some(c => c.id === 'C2'), 'their edit survives my deletion');
  assert.equal(r.conflicts.find(c => c.id === 'C2').op, 'delete');
  // a created record whose id the server already uses for something else
  const clash = clone(server0); clash.courses.push(rec('C3', { title: 'Someone else created C3' }));
  r = SR.apply(d.changes, clash);
  assert.equal(r.state.courses.find(c => c.id === 'C3').title, 'Someone else created C3');
  assert.equal(r.conflicts.find(c => c.id === 'C3').op, 'create');
  // settings changed on the server too
  const s2 = clone(server0); s2.settings.brand = 'c';
  r = SR.apply(d.changes, s2);
  assert.equal(r.state.settings.brand, 'c');
  assert.equal(r.conflicts.find(c => c.id === '#').collection, 'settings');
  // deciding for my version
  const st = clone(r.state); SR.useMine(st, r.conflicts.find(c => c.id === '#')); assert.equal(st.settings.brand, 'b');
  const st2 = clone(theirs); SR.useMine(st2, SR.apply(d.changes, clone(theirs)).conflicts[0]); assert.equal(st2.courses[0].title, 'One edited');

  // copies stored by an older version (order-sensitive hashes, no _v) still work
  const legacyBase = SR.baseOf(server0, SR.legacyHash); delete legacyBase._v;
  const ld = SR.delta(mine, legacyBase);
  assert.equal(ld.kind, 'legacy');
  assert.equal(SR.apply(ld.changes, clone(server0), 'legacy').conflicts.length, 0);
}

/* ------------------------------------------------ part 2: browsers */
const A = 'admin@sdclearn.demo', B = 'instructor@sdclearn.demo';
const KEYS = { pending: 'sdcCloudPending', token: 'sdcCloudToken', db: 'sdcLearnDB_v1', rescueA: 'sdcRescue:u-admin' };

async function world(opts = {}) {
  const probe = Tab(Browser(), Server({ users: [] }));
  const init = probe.normalizeState(clone(probe.SEED));
  const server = Server(init), browser = Browser(opts), locks = opts.locks ? Locks() : null;
  const tab = Tab(browser, server, { locks });
  return { server, browser, tab, locks };
}
const title = (state, id) => state.courses.find(c => c.id === id)?.title;
const serverTitle = (w, id) => title(w.server.state(), id);
const pending = w => w.browser.store.get(KEYS.pending);

(async () => {
  /* 1. THE BUG: the sign-in expires, the person keeps editing, then signs in again */
  {
    const w = await world(), { tab, server, browser } = w;
    await tab.signIn(A);
    tab.updateRecord('courses', 'C-HSE', { title: 'HSE (saved while signed in)' });
    await tab.cloud.flushNow();
    assert.equal(tab.cloud.status().state, 'saved');
    assert.equal(pending(w), undefined, 'confirmed by the server: the marker is removed');
    assert.equal(serverTitle(w, 'C-HSE'), 'HSE (saved while signed in)');

    server.expire('u-admin'); // the 12-hour token runs out
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (edited after expiry)' });
    const before = tab.puts().length;
    await tab.cloud.flushNow();
    assert.equal(tab.puts().length, before + 1, 'the save was tried');
    assert.ok(pending(w), 'NOT reported as saved: the pending marker stays');
    assert.equal(tab.cloud.status().state, 'auth', 'the status says the sign-in expired');
    assert.match(tab.cloud.status().text, /NOT saved/);
    assert.equal(browser.store.get(KEYS.token), undefined, 'the dead token is dropped');
    assert.ok(browser.store.get('sdcCloudAuthLost'), 'the expiry is remembered across reloads and tabs');
    assert.equal(serverTitle(w, 'C-EXCEL') === 'Excel (edited after expiry)', false, 'the server never got it');
    assert.equal(title(JSON.parse(browser.store.get(KEYS.db)), 'C-EXCEL'), 'Excel (edited after expiry)', 'the browser still holds it');
    const rescue = JSON.parse(browser.store.get(KEYS.rescueA));
    assert.equal(rescue.userId, 'u-admin');
    assert.equal(rescue.changes.courses.put['C-EXCEL'].title, 'Excel (edited after expiry)', 'set aside under the account');
    assert.deepEqual(Object.keys(rescue.changes.courses.put), ['C-EXCEL'], 'only what was unsent, not what the server confirmed');
    // more edits after the warning go on being kept
    tab.updateRecord('courses', 'C-SCM', { title: 'SCM (second offline edit)' });
    await tab.cloud.flushNow();
    assert.ok(pending(w));
    assert.equal(tab.cloud.status().state, 'auth');
    assert.equal(JSON.parse(browser.store.get(KEYS.rescueA)).count, 2);

    // meanwhile another person changes other things on the server
    server.mutate(s => { s.courses.find(c => c.id === 'C-TABLEAU').title = 'Tableau (changed by someone else)'; });
    // sign in again as the same account
    const cap = tab.cloud.prepareReauth(); assert.ok(cap.ok);
    assert.equal(tab.ss.get('sdcSession'), undefined, 'the sign-in page can open');
    await tab.signIn(A);
    const mine = tab.db();
    assert.equal(title(mine, 'C-EXCEL'), 'Excel (edited after expiry)', 'the unsent edit is back');
    assert.equal(title(mine, 'C-SCM'), 'SCM (second offline edit)');
    assert.equal(title(mine, 'C-TABLEAU'), 'Tableau (changed by someone else)', "and the other person's newer edit is kept");
    assert.ok(pending(w), 'recovered changes are pending until the server confirms them');
    assert.deepEqual(JSON.parse(tab.ss.get('sdcRecovered')), { applied: 2, already: 0, conflicts: 0, kept: true });
    await tab.cloud.pullNow(); // the page load after sign-in must still send them
    assert.equal(pending(w), undefined, 'the server confirmed: only now is the marker cleared');
    assert.equal(tab.cloud.status().state, 'saved');
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (edited after expiry)');
    assert.equal(serverTitle(w, 'C-SCM'), 'SCM (second offline edit)');
    assert.equal(serverTitle(w, 'C-TABLEAU'), 'Tableau (changed by someone else)', "the stale copy did not overwrite the other person's edit");
    assert.equal(serverTitle(w, 'C-HSE'), 'HSE (saved while signed in)');
    assert.equal(browser.store.get(KEYS.rescueA), undefined, 'nothing left set aside once it is saved');
  }

  /* 2. Someone changed the SAME record: the server's version wins until the person decides */
  {
    const w = await world(), { tab, server, browser } = w;
    await tab.signIn(A);
    server.expire('u-admin');
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (mine)' });
    tab.updateRecord('courses', 'C-PBI', { title: 'PBI (mine)' });
    await tab.cloud.flushNow();
    server.mutate(s => { s.courses.find(c => c.id === 'C-EXCEL').title = 'Excel (theirs, newer)'; });
    tab.cloud.prepareReauth();
    await tab.signIn(A);
    assert.equal(title(tab.db(), 'C-EXCEL'), 'Excel (theirs, newer)', "the server's newer record is not overwritten");
    assert.equal(title(tab.db(), 'C-PBI'), 'PBI (mine)', 'the rest of the work is restored');
    assert.deepEqual(JSON.parse(tab.ss.get('sdcRecovered')), { applied: 1, already: 0, conflicts: 1, kept: true });
    const cf = tab.cloud.conflicts();
    assert.equal(cf.length, 1);
    assert.equal(cf[0].mine.title, 'Excel (mine)', 'my version is kept for the decision');
    assert.equal(tab.cloud.status().conflicts, 1);
    await tab.cloud.flushNow();
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (theirs, newer)', 'the recovery save does not touch it either');
    assert.equal(serverTitle(w, 'C-PBI'), 'PBI (mine)');
    // reload: the conflict is still there
    const t2 = tab.reload(); assert.equal(t2.cloud.conflicts().length, 1);
    // keep the server's
    assert.ok(t2.cloud.resolveConflict(0, 'theirs'));
    assert.equal(t2.cloud.conflicts().length, 0);
    assert.equal(browser.store.get(KEYS.rescueA), undefined);
    assert.equal(title(t2.db(), 'C-EXCEL'), 'Excel (theirs, newer)');
  }
  {
    const w = await world(), { tab, server } = w;
    await tab.signIn(A);
    server.expire('u-admin');
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (mine)' });
    await tab.cloud.flushNow();
    server.mutate(s => { s.courses.find(c => c.id === 'C-EXCEL').title = 'Excel (theirs)'; });
    tab.cloud.prepareReauth(); await tab.signIn(A);
    assert.ok(tab.cloud.resolveConflict(0, 'mine'), 'the person chooses their own version');
    assert.equal(title(tab.db(), 'C-EXCEL'), 'Excel (mine)');
    await tab.cloud.flushNow();
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (mine)', 'only an explicit choice overwrites');
    assert.equal(tab.cloud.conflicts().length, 0);
  }
  {
    // edited here, deleted by someone else; and deleted here, edited by someone else
    const w = await world(), { tab, server } = w;
    await tab.signIn(A);
    server.expire('u-admin');
    tab.updateRecord('courses', 'C-HSE', { title: 'HSE (mine)' });
    tab.deleteRecord('courses', 'C-PBI');
    await tab.cloud.flushNow();
    server.mutate(s => { s.courses = s.courses.filter(c => c.id !== 'C-HSE'); s.courses.find(c => c.id === 'C-PBI').title = 'PBI (edited by someone else)'; });
    tab.cloud.prepareReauth(); await tab.signIn(A);
    assert.equal(tab.db().courses.some(c => c.id === 'C-HSE'), false, 'not brought back without asking');
    assert.equal(title(tab.db(), 'C-PBI'), 'PBI (edited by someone else)', 'their edit survives my deletion');
    assert.deepEqual(tab.cloud.conflicts().map(c => c.id + ':' + c.kind).sort(), ['C-HSE:deleted', 'C-PBI:changed']);
    await tab.cloud.flushNow();
    assert.equal(serverTitle(w, 'C-PBI'), 'PBI (edited by someone else)');
  }

  /* 3. Another account on the same browser never sees or receives the first account's work */
  {
    const w = await world(), { tab, server, browser } = w;
    await tab.signIn(A);
    server.expire('u-admin');
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (A, unsent)' });
    await tab.cloud.flushNow();
    assert.ok(browser.store.get(KEYS.rescueA));
    // B signs in on this browser instead
    tab.cloud.prepareReauth();
    await tab.signIn(B);
    assert.equal(title(tab.db(), 'C-EXCEL'), 'Microsoft Excel with AI-Driven Analytics & Automation', "B's copy is the server's, without A's edit");
    assert.deepEqual(tab.cloud.conflicts(), [], "B has no access to A's set-aside work");
    assert.equal(tab.ss.get('sdcRecovered'), undefined, 'nothing is replayed for B');
    tab.updateRecord('users', 'u-faraz', { phone: '0300-0000000' });
    await tab.cloud.flushNow();
    assert.equal(serverTitle(w, 'C-EXCEL') === 'Excel (A, unsent)', false, "A's edit was not sent under B's account");
    assert.ok(browser.store.get(KEYS.rescueA), "A's work is still set aside for A");
    assert.equal(JSON.parse(browser.store.get(KEYS.rescueA)).userId, 'u-admin');
    // B signs out; A signs in: A gets the work back
    await tab.logout().catch(() => {}); // location is a stub
    tab.ss.delete('sdcSession');
    await tab.signIn(A);
    assert.equal(title(tab.db(), 'C-EXCEL'), 'Excel (A, unsent)');
    await tab.cloud.pullNow(); await tab.cloud.flushNow();
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (A, unsent)');
    assert.equal(browser.store.get(KEYS.rescueA), undefined);
  }

  /* 4. Signing out with changes the server has not confirmed keeps them for next time */
  {
    const w = await world(), { tab, server, browser } = w;
    await tab.signIn(A);
    server.down = true;
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (offline when signing out)' });
    await tab.cloud.flushNow();
    assert.equal(tab.cloud.status().state, 'failed');
    assert.ok(pending(w));
    const kept = tab.cloud.beforeSignOut();
    assert.deepEqual([kept.ok, kept.count], [true, 1]);
    tab.cloud.signOut();
    assert.equal(browser.store.get(KEYS.db), undefined, 'the next person on this computer sees nothing');
    assert.ok(browser.store.get(KEYS.rescueA), 'but the unsent change is set aside');
    server.down = false; tab.ss.delete('sdcSession');
    await tab.signIn(A);
    assert.equal(title(tab.db(), 'C-EXCEL'), 'Excel (offline when signing out)');
    await tab.cloud.pullNow();
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (offline when signing out)');
  }

  /* 5. A failed save is never reported as saved; it is retried and reported when it works */
  {
    const w = await world(), { tab, server } = w;
    await tab.signIn(A);
    const seen = [];
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (network down)' });
    assert.equal(tab.cloud.status().state, 'local', 'right after the change: this device only');
    server.down = true;
    await tab.cloud.flushNow();
    seen.push(tab.cloud.status().state);
    await tab.cloud.flushNow();
    assert.equal(tab.cloud.status().state, 'failed');
    assert.equal(tab.cloud.status().lastSavedAt, 0, 'no confirmation yet');
    assert.ok(tab.cloud.status().failures >= 2);
    assert.match(tab.cloud.status().text, /NOT been saved/);
    assert.ok(pending(w));
    server.down = false;
    await tab.cloud.retryNow();
    assert.equal(tab.cloud.status().state, 'saved');
    assert.ok(tab.cloud.status().lastSavedAt > 0);
    assert.equal(pending(w), undefined);
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (network down)');
    // no token at all is not "saved" either (this used to clear the marker)
    w.browser.store.delete(KEYS.token);
    tab.updateRecord('courses', 'C-PBI', { title: 'PBI (no token)' });
    await tab.cloud.flushNow();
    assert.ok(pending(w), 'a save without a sign-in leaves the marker');
    assert.equal(tab.cloud.status().state, 'auth');
  }

  /* 6. Browser reload */
  {
    const w = await world(), { tab, server } = w;
    await tab.signIn(A);
    server.down = true;
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (before reload)' });
    await tab.cloud.flushNow();
    const t2 = tab.reload(); t2.ss.delete('sdcFreshAt');
    assert.equal(t2.cloud.status().state, 'local', 'after the reload the change is still waiting');
    server.down = false;
    await t2.cloud.pullNow();
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (before reload)', 'sent after the reload');
    assert.equal(t2.cloud.status().state, 'saved');
    // reload after the sign-in expired while the page was closed
    t2.updateRecord('courses', 'C-PBI', { title: 'PBI (unsent at close)' });
    server.down = true; await t2.cloud.flushNow(); server.down = false;
    server.expire('u-admin');
    const t3 = t2.reload(); t3.ss.delete('sdcFreshAt');
    await t3.cloud.pullNow();
    assert.equal(t3.cloud.status().state, 'auth');
    assert.ok(pending(w), 'still pending after the reload');
    assert.equal(JSON.parse(w.browser.store.get(KEYS.rescueA)).changes.courses.put['C-PBI'].title, 'PBI (unsent at close)');
    // the sign-in page closed without signing in: unsent work of a signed-out browser is set aside on the next load
    w.browser.store.delete(KEYS.rescueA);
    const t4 = t3.reload();
    assert.ok(w.browser.store.get(KEYS.rescueA), 'set aside again as soon as a page loads without a sign-in');
  }

  /* 7. Several tabs */
  {
    const w = await world({ locks: true }), { tab: t1, server, browser } = w;
    await t1.signIn(A);
    const t2 = Tab(browser, server, { session: t1.ss, locks: w.locks });
    t1.updateRecord('courses', 'C-EXCEL', { title: 'Excel (tab 1)' });
    await Promise.all([t1.cloud.flushNow(), t2.cloud.flushNow()]);
    assert.equal(server.log.filter(x => x.method === 'PUT').length, 1, 'tabs take turns: one save, not two');
    assert.equal(pending(w), undefined);
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (tab 1)');
    // the sign-in expires: tab 1 finds out, tab 2 knows too and neither clears the marker
    server.expire('u-admin');
    t1.updateRecord('courses', 'C-PBI', { title: 'PBI (tab 1 after expiry)' });
    await t1.cloud.flushNow();
    assert.equal(t1.cloud.status().state, 'auth');
    assert.equal(t2.cloud.status().state, 'auth', 'the other tab shows the warning too');
    t2.invalidateCache();
    assert.equal(title(t2.db(), 'C-PBI'), 'PBI (tab 1 after expiry)', 'tabs share the unsent copy');
    await t2.cloud.flushNow();
    assert.ok(pending(w), 'a second tab cannot clear what the first could not save');
    // signing in again in tab 2 restores the work for both
    t2.cloud.prepareReauth(); await t2.signIn(A);
    t1.invalidateCache();
    await t2.cloud.pullNow();
    assert.equal(serverTitle(w, 'C-PBI'), 'PBI (tab 1 after expiry)');
    assert.equal(t1.cloud.status().state, 'saved', 'tab 1 stops warning once the other tab signed in');
  }
  {
    // an older tab (copy not refreshed) never deletes what another tab or person added
    const w = await world({ locks: true }), { tab: t1, server, browser } = w;
    await t1.signIn(A);
    const t2 = Tab(browser, server, { session: t1.ss, locks: w.locks });
    t2.addRecord('courses', { id: 'C-NEW', title: 'Created in tab 2', status: 'draft', slug: 'new' });
    await t2.cloud.flushNow();
    t1.updateRecord('courses', 'C-EXCEL', { title: 'Excel (tab 1)' });
    await t1.cloud.flushNow();
    assert.ok(server.state().courses.some(c => c.id === 'C-NEW'), 'the course made in the other tab is still on the server');
  }

  /* 8. The database stores keys in its own order: that alone is never a conflict */
  {
    const w = await world(), { tab, server } = w;
    server.reorder = true;
    await tab.signIn(A);
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (saved, then reordered by the database)' });
    await tab.cloud.flushNow();
    server.expire('u-admin');
    tab.updateRecord('courses', 'C-PBI', { title: 'PBI (offline)' });
    await tab.cloud.flushNow();
    tab.cloud.prepareReauth(); await tab.signIn(A);
    assert.deepEqual(tab.cloud.conflicts(), [], 'no false conflict');
    assert.equal(title(tab.db(), 'C-PBI'), 'PBI (offline)');
    await tab.cloud.pullNow();
    assert.equal(serverTitle(w, 'C-PBI'), 'PBI (offline)');
  }

  /* 9. Copies stored by the previous version (order-sensitive base, no version) are recovered too */
  {
    const w = await world(), { tab, server, browser } = w;
    await tab.signIn(A);
    const st = JSON.parse(browser.store.get(KEYS.db)); st._sync = tab.ctx.SyncRecover.baseOf(st, tab.ctx.SyncRecover.legacyHash); delete st._sync._v;
    browser.store.set(KEYS.db, JSON.stringify(st)); tab.invalidateCache();
    server.expire('u-admin');
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (old base)' });
    await tab.cloud.flushNow();
    assert.equal(JSON.parse(browser.store.get(KEYS.rescueA)).kind, 'legacy');
    tab.cloud.prepareReauth(); await tab.signIn(A);
    assert.equal(title(tab.db(), 'C-EXCEL'), 'Excel (old base)');
    assert.deepEqual(tab.cloud.conflicts(), []);
  }

  /* 10. Browser storage is full */
  {
    const w = await world(), { tab, server, browser } = w;
    await tab.signIn(A);
    browser.full = true; // nothing can be written any more
    assert.throws(() => tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (storage full)' }), /quota/i, 'the failure is raised, not hidden');
    assert.equal(tab.cloud.status().state, 'storage');
    assert.match(tab.cloud.status().text, /no room left/);
    assert.notEqual(title(JSON.parse(browser.store.get(KEYS.db)), 'C-EXCEL'), 'Excel (storage full)', 'the stored copy did not change');
    assert.equal(title(tab.db(), 'C-EXCEL'), 'Excel (storage full)', 'but this tab still has it in memory');
    assert.equal(tab.cloud.status().pending, true, 'and knows it is not safe');
    // the safe recovery option: save from memory to the server
    await tab.cloud.retryNow();
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (storage full)', 'saved to the server although the browser cannot store it');
    assert.equal(tab.cloud.status().state, 'storage', 'still reported: this browser cannot keep a copy');
    assert.equal(tab.cloud.status().pending, false);
    // a pull must not replace the in-memory work while it is unsent
    // room again: back to normal
    browser.full = false;
    tab.updateRecord('courses', 'C-PBI', { title: 'PBI (room again)' });
    assert.equal(tab.cloud.status().state === 'storage', false);
    await tab.cloud.flushNow();
    assert.equal(tab.cloud.status().state, 'saved');
  }
  {
    // the pending marker itself cannot be stored: it is kept in memory and still sent
    const w = await world(), { tab, browser } = w;
    await tab.signIn(A);
    browser.failKeys.add(KEYS.pending);
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (no room for the marker)' });
    assert.equal(tab.cloud.status().state, 'storage');
    assert.equal(tab.cloud.status().pending, true);
    await tab.cloud.flushNow();
    assert.equal(serverTitle(w, 'C-EXCEL'), 'Excel (no room for the marker)');
    assert.equal(tab.cloud.status().pending, false);
  }
  {
    // unsent changes cannot be set aside (no room): signing in is refused, nothing is discarded
    const w = await world(), { tab, server, browser } = w;
    await tab.signIn(A);
    server.expire('u-admin');
    tab.updateRecord('courses', 'C-EXCEL', { title: 'Excel (cannot be set aside)' });
    browser.failKeys.add(KEYS.rescueA);
    await tab.cloud.flushNow();
    assert.equal(tab.cloud.status().state, 'auth');
    const cap = tab.cloud.prepareReauth();
    assert.equal(cap.ok, false, 'the person is told, not silently signed out');
    assert.ok(tab.ss.get('sdcSession'), 'the page session is kept while their work is unprotected');
    const err = await tab.signIn(A).catch(e => e);
    assert.equal(err.code, 'unsaved_changes');
    assert.equal(title(JSON.parse(browser.store.get(KEYS.db)), 'C-EXCEL'), 'Excel (cannot be set aside)', 'the copy is untouched');
    const exported = tab.cloud.unsavedExport();
    assert.equal(exported.changes.courses.put['C-EXCEL'].title, 'Excel (cannot be set aside)', 'a downloadable copy holds the work');
    assert.equal(browser.store.get(KEYS.token), undefined, 'no half signed-in state');
    tab.cloud.discardUnsaved();
    await tab.signIn(A); // the person chose to discard
    assert.equal(title(tab.db(), 'C-EXCEL'), 'Microsoft Excel with AI-Driven Analytics & Automation');
  }
  {
    // signing in when the copy cannot be stored: a clear error, no half-state
    const w = await world(), { tab, browser } = w;
    browser.full = true;
    const err = await tab.signIn(A).catch(e => e);
    assert.equal(err.code, 'storage_full');
    assert.equal(browser.store.get(KEYS.token), undefined);
  }
  {
    // headroom for big runs: usage() reports what is used and what is left
    const w = await world({ quota: 600000 }), { tab } = w;
    await tab.signIn(A);
    const u = tab.cloud.usage();
    assert.ok(u.used > 0 && u.free === u.limit - u.used && u.pct >= 0 && u.pct <= 100, JSON.stringify(u));
  }

  console.log('syncrecover.test.js: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
