// Stage 2: js/cloud-sync.js in a vm with a fake gateway (no network). Checks the stale-client
// protection on the browser side: the sync base stored with the copy (base.known / base.fresh),
// server versions in microseconds, resync after the server kept or undid records, tabs sharing
// localStorage, and the AI draft calls. Saves are also run through the real server guard. Run: npm test
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const src = read('sync-recover.js') + '\n' + read('cloud-sync.js');
const T = require('../backend/state-api.js')._test;
const clone = v => JSON.parse(JSON.stringify(v));

// One browser tab. db() keeps an in-memory copy like js/core.js; another tab's write reaches it only
// when its storage event is delivered (tab.storageEvent()), so the tests can hold that event back.
function browser(server, ls = new Map([['sdcCloudToken', 'tok']])) {
  const ss = new Map(), sent = [];
  let cache = null;
  const store = m => ({ getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) });
  const win = { SDC_CLOUD_CONFIG: { enabled: true, url: 'https://fake-test-project.supabase.co', anonKey: 'fake' }, addEventListener() {}, dispatchEvent() {} };
  const ctx = {
    window: win, localStorage: store(ls), sessionStorage: store(ss), console: { warn() {}, log() {} },
    setTimeout: () => 0, clearTimeout() {}, Event: function () {}, DBKEY: 'db',
    db: () => cache || (cache = JSON.parse(ls.get('db'))), normalizeState: s => s, invalidateCache() { cache = null; },
    loadSupabase: async () => { throw new Error('direct mode must not be used'); },
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET', body = opts.body ? JSON.parse(opts.body) : undefined;
      sent.push({ url, method, body });
      const [status, json] = await server(url, method, body, ls);
      return { ok: status < 400, status, json: async () => json };
    }
  };
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  const tab = {
    ls, sent, cloud: win.SDCCloud, puts: () => sent.filter(x => x.method === 'PUT'), db: ctx.db,
    // a local edit, as saveDB does: change the in-memory copy, write it, mark it pending
    edit(fn) { const d = ctx.db(); fn(d); ls.set('db', JSON.stringify(d)); win.SDCCloud.syncNow(); },
    storageEvent() { cache = null; },
    save: async fn => { tab.edit(fn); await win.SDCCloud.flushNow(); return tab.puts().at(-1).body; }
  };
  return tab;
}
const S0 = { users: [{ id: 'A', role: 'admin' }], roles: [{ id: 'admin' }], courses: [{ id: 'C1', title: 'One' }, { id: 'C2', title: 'Two' }], sessions: [{ id: 'S1', courseId: 'C1' }], batches: [{ id: 'B1', courseId: 'C1' }] };
const AT = '2020-01-02T03:04:05.123456+00:00', AT_US = Date.parse('2020-01-02T03:04:05Z') * 1000 + 123456;
// The server side of a save: what the gateway would store (real guard from backend/state-api.js).
const guard = (prev, body) => T.guardCourseData(prev, body.state, prev.users[0], T.readKnown(body.base)).state;
const gateway = (state, at = AT) => async (url, method) => {
  if (url === '/api/sdc/status') return [200, { gateway: true, safeWrite: true }];
  if (url === '/api/sdc/login') return [200, { token: 'tok', userId: 'A', state: clone(state()), updatedAt: at }];
  if (url === '/api/sdc/state' && method === 'PUT') return [200, { updatedAt: at }];
  if (url === '/api/sdc/state') return [200, { state: clone(state()), updatedAt: at }];
  return [404, {}];
};

(async () => {
  // sign-in stores the base with the copy; a save proves its deletions and marks what it left unchanged
  const b = browser(gateway(() => S0));
  await b.cloud.signIn('a@x', 'pw');
  assert.deepEqual(Object.keys(b.db()._sync.courses), ['C1', 'C2'], 'base is stored inside the copy');
  let put = await b.save(s => { s.courses = s.courses.filter(c => c.id !== 'C2'); s.sessions[0].title = 'edited'; });
  const three = o => ({ courses: o.courses, sessions: o.sessions, batches: o.batches });
  assert.deepEqual(Object.keys(put.base.known), T.PROTECTED, 'the base covers the 14 protected collections, as the server reads them');
  assert.deepEqual(three(put.base.known), { courses: ['C1', 'C2'], sessions: ['S1'], batches: ['B1'] }, 'the save proves the deletion of C2');
  assert.deepEqual(three(put.base.fresh), { courses: ['C1'], sessions: [], batches: ['B1'] }, 'unchanged records are marked fresh, the edited session is not');
  assert.equal(put.state._sync, undefined, 'the base itself is never sent as data');
  assert.deepEqual(put.state.courses, [{ id: 'C1', title: 'One' }]);
  assert.equal(b.ls.get('sdcCloudUpdatedAt'), String(AT_US), "STAMP is the server's version in microseconds");
  assert.deepEqual(Object.keys(b.db()._sync.courses), ['C1'], 'the base follows what was saved');
  assert.equal(b.sent.filter(x => x.url === '/api/sdc/state' && x.method === 'GET').length, 0, 'no resync when the server saved exactly the request');

  // what a save sends is captured when it is sent, not when it returns
  let release; const held = new Promise(r => release = r);
  const c = browser(async (url, method) => {
    if (url === '/api/sdc/status') return [200, { gateway: true }];
    if (method === 'PUT') { await held; return [200, { updatedAt: AT }]; }
    return [404, {}];
  });
  c.ls.set('db', JSON.stringify(S0));
  c.cloud.syncNow(); const f = c.cloud.flushNow();
  await new Promise(r => setImmediate(r));
  c.edit(s => { s.courses = s.courses.filter(x => x.id !== 'C2'); s.courses[0].title = 'in flight'; }); // changed while saving
  release(); await f;
  assert.ok(c.ls.get('sdcCloudPending'), 'the change made in flight is still pending');
  await c.cloud.flushNow();
  put = c.puts().at(-1).body;
  assert.deepEqual([put.base.known.courses, put.base.fresh.courses], [['C1', 'C2'], []], 'C2 was in the saved copy (its deletion is proven); C1 changed after it, so it is not fresh');

  // Finding 3: a stale tab no longer undoes another person's edit to a record it did not touch
  let server = clone(S0);
  const a1 = browser(gateway(() => server)), b1 = browser(gateway(() => server));
  await a1.cloud.signIn('a@x', 'pw'); await b1.cloud.signIn('a@x', 'pw');
  server = guard(server, await a1.save(s => { s.courses[0].title = 'A edit'; }));
  server = guard(server, await b1.save(s => { s.courses[1].title = 'B edit'; }));
  assert.deepEqual(server.courses.map(x => x.title), ['A edit', 'B edit'], "both edits survive; B's stale copy of C1 is ignored");

  // D3: the same for the other protected collections: a stale tab's unchanged fee does not undo a payment.
  server = { ...clone(S0), fees: [{ id: 'F1', learnerId: 'L', status: 'Pending' }] };
  const f1 = browser(gateway(() => server)), f2 = browser(gateway(() => server));
  await f1.cloud.signIn('a@x', 'pw'); await f2.cloud.signIn('a@x', 'pw');
  server = guard(server, await f1.save(s => { s.fees[0].status = 'Paid'; }));
  put = await f2.save(s => { s.courses[0].title = 'other edit'; });
  assert.deepEqual([put.base.known.fees, put.base.fresh.fees], [['F1'], ['F1']], 'fees are part of the base');
  server = guard(server, put);
  assert.deepEqual([server.fees[0].status, server.courses[0].title], ['Paid', 'other edit'], "the stale tab's fee copy does not undo the payment");

  // Finding 5: tabs share localStorage. A tab whose copy is older than the one another tab just
  // downloaded must not use that newer copy's ids to delete a course it never had.
  server = clone(S0);
  const shared = new Map([['sdcCloudToken', 'tok']]);
  const t1 = browser(gateway(() => server), shared);
  await t1.cloud.signIn('a@x', 'pw'); t1.db();
  server = { ...clone(S0), courses: [...clone(S0).courses, { id: 'C3', title: 'New' }] };
  const t2 = browser(gateway(() => server, '2020-01-02T03:04:06.000001+00:00'), shared);
  await t2.cloud.pullNow(); // tab 2 downloads C3; tab 1 has not received the storage event yet
  assert.ok(JSON.parse(shared.get('db')).courses.some(x => x.id === 'C3'));
  put = await t1.save(s => { s.courses[0].title = 'tab 1 edit'; });
  assert.ok(!put.base.known.courses.includes('C3'), 'the base belongs to the copy that is sent');
  assert.ok(guard(server, put).courses.some(x => x.id === 'C3'), 'C3 is kept');

  // Finding 4: the server kept or undid something and the re-download fails: the next pull still adopts
  server = { ...clone(S0), courses: [...clone(S0).courses, { id: 'C-AI-NEW' }] };
  let failGet = true;
  const d = browser(async (url, method) => {
    if (url === '/api/sdc/status') return [200, { gateway: true }];
    if (method === 'PUT') return [200, { updatedAt: AT, resync: true }];
    if (failGet) { failGet = false; return [502, { error: 'Cloud storage is unavailable.' }]; }
    return [200, { state: clone(server), updatedAt: AT }];
  });
  d.ls.set('db', JSON.stringify({ ...S0, courses: [{ id: 'C1' }] }));
  d.cloud.syncNow(); await d.cloud.flushNow();
  assert.equal(d.ls.get('sdcCloudPending'), undefined);
  await d.cloud.pullNow();
  assert.deepEqual(JSON.parse(d.ls.get('db')).courses.map(x => x.id), ['C1', 'C2', 'C-AI-NEW'], 'same server version, but the copy is taken because the server changed the save');

  // Finding 6: two server versions in the same millisecond are still told apart
  const e = browser(async (url, method) => {
    if (url === '/api/sdc/status') return [200, { gateway: true }];
    if (method === 'PUT') return [200, { updatedAt: '2020-01-02T03:04:05.123001+00:00' }];
    return [200, { state: { ...clone(S0), courses: [{ id: 'C9' }] }, updatedAt: '2020-01-02T03:04:05.123999+00:00' }];
  });
  e.ls.set('db', JSON.stringify(S0));
  e.cloud.syncNow(); await e.cloud.flushNow(); await e.cloud.pullNow();
  assert.deepEqual(JSON.parse(e.ls.get('db')).courses.map(x => x.id), ['C9'], 'a later version within the same millisecond is adopted');

  // a restore keeps the current base (it may delete and overwrite); a copy without one gets none
  assert.deepEqual(b.cloud.carryBase({ _sync: { courses: { C1: 'h' } } }, { _sync: { old: 1 } })._sync, { courses: { C1: 'h' } });
  assert.equal(b.cloud.carryBase({}, { _sync: { old: 1 } })._sync, undefined);

  // AI draft calls surface the server's status and code
  const ai = browser(async (url, method) => {
    if (url === '/api/sdc/status') return [200, { gateway: true, safeWrite: true }];
    if (url.startsWith('/api/sdc/courses/ai-draft')) return method === 'POST' ? [409, { error: 'slug', code: 'slug_in_use' }] : [200, { committed: false }];
    return gateway(() => S0)(url, method);
  });
  await ai.cloud.signIn('a@x', 'pw');
  const err = await ai.cloud.aiDraft({ genId: 'g', outline: {} }).catch(x => x);
  assert.deepEqual([err.status, err.code], [409, 'slug_in_use']);
  assert.deepEqual(await ai.cloud.aiDraftStatus('g/../x'), { committed: false });
  assert.equal(ai.sent.at(-1).url, '/api/sdc/courses/ai-draft/g%2F..%2Fx', 'genId is URL-encoded');
  assert.equal(await ai.cloud.safeWrite(), true);
  ai.cloud.signOut();
  assert.equal(ai.ls.get('db'), undefined, 'signing out drops the copy and its base');
  console.log('cloudsync.test.js: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
