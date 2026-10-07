// Runs the SDC Learning Portal Test Suite against a LOCAL server and prints JSON results per test case.
//   npm start            (in another terminal; no SDC_STATE_SECRET so nothing reaches the cloud)
//   node tests/suite.run.js http://localhost:3000 > suite-results.json
// Needs puppeteer-core and Chrome. All Supabase traffic is blocked so live data is never touched.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path');
const base = process.argv[2] || 'http://localhost:3000';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = ms => new Promise(r => setTimeout(r, ms));
const out = {};
const tc = async (id, fn) => { try { const note = await fn(); out[id] = note ? ['NOTE', note] : ['PASS']; } catch (e) { out[id] = ['FAIL', e.message]; } };
const check = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const errors = [];
  const page = async (opts = {}) => {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage();
    await p.setRequestInterception(true);
    p.__supabaseWrites = 0;
    p.on('request', r => {
      const u = r.url();
      if (u.includes('supabase.co')) { if (r.method() !== 'GET') p.__supabaseWrites++; return r.abort(); }
      if (opts.uploadDown && u.includes('/api/lms/uploads')) return r.abort();
      r.continue();
    });
    p.on('pageerror', e => errors.push(e.message));
    await p.setViewport(opts.viewport || { width: 1366, height: 860 });
    return p;
  };
  const signIn = async (p, email, pw = 'Demo@123') => {
    await p.goto(base + '/login.html', { waitUntil: 'networkidle0' });
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await p.reload({ waitUntil: 'networkidle0' });
    await p.type('#email', email); await p.type('#password', pw);
    await Promise.all([p.click('#loginBtn'), p.waitForNavigation({ waitUntil: 'networkidle0', timeout: 8000 }).catch(() => {})]); await W(600);
  };
  const err = p => p.evaluate(() => { const e = document.querySelector('#loginError'); return e && !e.hidden ? e.textContent : ''; });

  let p = await page();
  await tc('TC-001', async () => { await signIn(p, 'admin@sdclearn.demo'); check(p.url().endsWith('#/dashboard'), 'landed on ' + p.url()); check(await p.evaluate(() => kind(App.user) === 'admin' && /Settings/.test(document.querySelector('.nav').innerText)), 'not admin console'); });
  await tc('TC-002', async () => { await signIn(p, 'instructor@sdclearn.demo'); check(p.url().endsWith('#/dashboard'), 'landed on ' + p.url()); check(await p.evaluate(() => kind(App.user) === 'teacher' && /Excel/.test(document.querySelector('#main').innerText)), 'no instructor view with assigned courses'); });
  await tc('TC-003', async () => { await signIn(p, 'learner@sdclearn.demo'); check(p.url().endsWith('#/courses'), 'landed on ' + p.url()); });
  await tc('TC-009', async () => { await p.reload({ waitUntil: 'networkidle0' }); await W(400); check(p.url().includes('app.html#/courses') && await p.evaluate(() => App.user?.id === 'u-ali'), 'session lost on reload'); });
  await tc('TC-010', async () => {
    await p.click('[data-user-btn]'); await W(150);
    await Promise.all([p.click('[data-user-pop] [data-logout]'), p.waitForNavigation({ waitUntil: 'networkidle0' })]);
    check(p.url().includes('login.html'), 'not redirected'); check(await p.evaluate(() => !sessionStorage.getItem('sdcSession') && !localStorage.getItem('sdcRemember')), 'session not cleared');
  });
  await tc('TC-004', async () => { await signIn(p, 'learner@sdclearn.demo', 'wrongpassword123'); check(p.url().includes('login.html') && /incorrect/i.test(await err(p)), 'no invalid-credentials error'); check(await p.evaluate(() => !sessionStorage.getItem('sdcSession')), 'session created'); });
  await tc('TC-005', async () => { await signIn(p, 'ghost@sdckarachi.org.pk', 'password123'); check(p.url().includes('login.html') && /incorrect/i.test(await err(p)), 'no error for unknown email'); });
  await tc('TC-006', async () => {
    await p.goto(base + '/login.html', { waitUntil: 'networkidle0' }); await p.click('.demo-btn[data-mail="admin@sdclearn.demo"]');
    check(await p.evaluate(() => document.querySelector('#email').value === 'admin@sdclearn.demo' && !!document.querySelector('#password').value), 'fields not filled');
    await Promise.all([p.click('#loginBtn'), p.waitForNavigation({ waitUntil: 'networkidle0' })]); check(p.url().endsWith('#/dashboard'), 'not signed in');
    await p.evaluate(() => logout()); await p.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
  });
  await tc('TC-007', async () => { await p.goto(base + '/login.html', { waitUntil: 'networkidle0' }); await p.click('#forgot'); await W(200); check(/sdckar@sdckarachi\.org\.pk/.test(await p.evaluate(() => document.querySelector('.modal')?.innerText || '')), 'reset info missing coordinator email'); });
  await tc('TC-008', async () => {
    await p.goto(base + '/login.html', { waitUntil: 'networkidle0' });
    await p.evaluate(() => { localStorage.clear(); invalidateCache(); updateRecord('users', 'u-hira', { status: 'Inactive' }); });
    await p.type('#email', 'hira@sdclearn.demo'); await p.type('#password', 'Demo@123'); await p.click('#loginBtn'); await W(600);
    check(p.url().includes('login.html') && /not active/i.test(await err(p)), 'inactive account not blocked');
  });
  await tc('TC-011', async () => { const q = await page(); await q.goto(base + '/app.html#/dashboard', { waitUntil: 'networkidle0' }); await W(400); check(q.url().includes('login.html'), 'unauthenticated user stayed on ' + q.url()); });
  await tc('TC-014', async () => {
    const found = [];
    for (const [url, who] of [['/login.html'], ['/verify.html'], ['/app.html#/dashboard', 'u-admin'], ['/app.html#/courses', 'u-ali']]) {
      if (who) await p.evaluate(id => { localStorage.clear(); sessionStorage.setItem('sdcSession', id); }, who);
      await p.goto(base + url, { waitUntil: 'networkidle0' }); await W(300);
      const html = await p.evaluate(() => document.documentElement.outerHTML + document.title);
      if (/EAD/.test(html)) found.push(url); check(/SDC|Skill Development Council/.test(html), 'no SDC branding on ' + url);
    }
    check(!found.length, '"EAD" found on ' + found.join(', '));
  });
  await tc('TC-016', async () => {
    await p.evaluate(() => { localStorage.clear(); sessionStorage.setItem('sdcSession', 'u-admin'); localStorage.setItem('sdcTheme', 'light'); });
    await p.goto(base + '/app.html#/dashboard', { waitUntil: 'networkidle0' });
    await p.click('[data-theme-toggle]'); await W(700);
    const dark = await p.evaluate(() => ({ t: document.documentElement.dataset.theme, s: localStorage.getItem('sdcTheme'), bg: getComputedStyle(document.body).backgroundColor }));
    check(dark.t === 'dark' && dark.s === 'dark', 'dark not applied/persisted');
    await p.click('[data-theme-toggle]'); await W(700);
    const light = await p.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
    check(light.t === 'light' && light.bg !== dark.bg, 'did not toggle back');
  });
  await tc('TC-017', async () => {
    const m = await page({ viewport: { width: 375, height: 667, isMobile: true, hasTouch: true } });
    await m.goto(base + '/login.html', { waitUntil: 'networkidle0' }); await m.evaluate(() => { localStorage.clear(); sessionStorage.setItem('sdcSession', 'u-ali'); });
    const over = [];
    for (const h of ['#/courses', '#/course/C-EXCEL', '#/course/C-EXCEL/session/S-EX-2', '#/assignments']) {
      await m.goto(base + '/app.html' + h, { waitUntil: 'networkidle0' }); await W(300);
      if (await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) over.push(h);
    }
    check(!over.length, 'horizontal overflow on ' + over.join(', '));
    check(await m.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).position === 'fixed' && !!document.querySelector('[data-menu]').offsetParent), 'sidebar not a drawer');
    await m.click('[data-menu]'); await W(300); check(await m.evaluate(() => document.querySelector('.sidebar').classList.contains('open')), 'drawer did not open');
    await m.goto(base + '/app.html#/course/C-EXCEL', { waitUntil: 'networkidle0' }); await W(300);
    check(await m.evaluate(() => { const z = document.querySelector('[data-zoom-btn]'); const r = z.getBoundingClientRect(); return r.width > 20 && r.right <= innerWidth; }), 'Zoom tool not usable on mobile');
  });
  await tc('TC-020', async () => {
    await p.evaluate(() => { localStorage.clear(); invalidateCache(); const u = addRecord('users', { id: 'u-empty', name: 'Empty Learner', email: 'empty@sdc.test', role: 'student', status: 'Active' }); sessionStorage.setItem('sdcSession', u.id); });
    await p.goto(base + '/app.html#/courses', { waitUntil: 'networkidle0' }); await W(300);
    check(/No courses yet|No .* yet/i.test(await p.evaluate(() => document.querySelector('#main').innerText)) && /Contact|contact/.test(await p.evaluate(() => document.querySelector('#main').innerText)), 'no friendly empty state');
  });
  const verify = async code => { await p.goto(base + '/verify.html', { waitUntil: 'networkidle0' }); await p.type('#code', code); await p.click('#vf button'); await p.waitForFunction(() => /certificate/i.test(document.querySelector('#result').innerText) && !/Checking/.test(document.querySelector('#result').innerText), { timeout: 8000 }).catch(() => {}); return p.evaluate(() => document.querySelector('#result').innerText); };
  await tc('TC-051', async () => { await p.evaluate(() => { localStorage.clear(); }); const t = await verify('SDC-2026-0001'); ['Valid certificate', 'Ali Raza', 'Power BI', 'A+'].forEach(s => check(t.includes(s), 'missing ' + s)); });
  await tc('TC-052', async () => { await p.evaluate(() => { invalidateCache(); const c = db().certificates[0]; updateRecord('certificates', c.id, { status: 'Revoked' }); }); const t = await verify('SDC-2026-0001'); check(/revoked/i.test(t), 'revoked not flagged'); await p.evaluate(() => localStorage.clear()); });
  await tc('TC-053', async () => { const t = await verify('INVALID-9999-XXXX'); check(/No certificate found/.test(t), 'no not-found message'); });
  await tc('TC-087', async () => {
    const q = await page(); await q.goto(base + '/login.html', { waitUntil: 'networkidle0' }); await q.evaluate(() => { localStorage.clear(); sessionStorage.setItem('sdcSession', 'u-admin'); });
    await q.goto(base + '/app.html#/dashboard', { waitUntil: 'networkidle0' }); await W(1500); q.__supabaseWrites = 0;
    await q.evaluate(() => { updateRecord('courses', 'C-EXCEL', { title: 'A' }); updateRecord('courses', 'C-EXCEL', { title: 'B' }); updateRecord('courses', 'C-EXCEL', { title: 'C' }); }); await W(150);
    await q.evaluate(() => updateRecord('courses', 'C-EXCEL', { description: 'later edit' })); await W(1500);
    check(q.__supabaseWrites >= 1 && q.__supabaseWrites <= 2, `${q.__supabaseWrites} cloud writes for 4 rapid saves`);
    return `4 rapid saves produced ${q.__supabaseWrites} cloud write(s) carrying the latest snapshot (400 ms debounce, serialised).`;
  });
  await tc('TC-089', async () => {
    const fd = new FormData(); fd.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'note.txt');
    const up = await (await fetch(base + '/api/lms/uploads', { method: 'POST', body: fd })).json(); check(up.url, 'upload failed: ' + JSON.stringify(up));
    const r = await fetch(base + up.url); const h = k => r.headers.get(k) || '';
    check(h('x-content-type-options') === 'nosniff' && /attachment/.test(h('content-disposition')), 'missing nosniff / attachment');
    const bad = new FormData(); bad.append('file', new Blob(['MZ']), 'payload.exe'); check((await fetch(base + '/api/lms/uploads', { method: 'POST', body: bad })).status === 415, '.exe not rejected by server');
  });
  await tc('TC-090', async () => {
    const q = await page({ uploadDown: true }); await q.goto(base + '/login.html', { waitUntil: 'networkidle0' }); await q.evaluate(() => { localStorage.clear(); sessionStorage.setItem('sdcSession', 'u-ali'); });
    await q.goto(base + '/app.html#/course/C-EXCEL/submit?assignment=A-EX-1', { waitUntil: 'networkidle0' }); await W(400);
    await q.evaluate(async () => { document.querySelector('#sub-e').value = 'learner@sdclearn.demo'; const inp = document.querySelector('input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(50 * 1024)], 'small.xlsx')); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 100)); document.querySelector('[data-form]').requestSubmit(); });
    await W(2500); const s = await q.evaluate(() => { invalidateCache(); return Domain.submissionFor('A-EX-1', 'u-ali'); });
    check(s && s.stored === 'inline' && s.fileUrl.startsWith('data:'), 'no inline fallback: ' + JSON.stringify(s && { stored: s.stored }));
  });

  // Everything else runs inside the app.
  p = await page(); await p.goto(base + '/login.html', { waitUntil: 'networkidle0' }); await p.evaluate(() => { localStorage.clear(); sessionStorage.setItem('sdcSession', 'u-admin'); });
  await p.goto(base + '/app.html#/dashboard', { waitUntil: 'networkidle0' });
  const inApp = await p.evaluate(fs.readFileSync(path.join(__dirname, 'suite.browser.js'), 'utf8'));
  Object.assign(out, inApp.results);
  // Step 7 of TC-094: the certificate issued in the app verifies on the public page; then restore demo data.
  if (inApp.cert && out['TC-094'][0] === 'PASS') await tc('TC-094', async () => { await p.goto(base + '/verify.html?code=' + inApp.cert, { waitUntil: 'networkidle0' }); await p.waitForFunction(() => /certificate/i.test(document.querySelector('#result').innerText), { timeout: 8000 }).catch(() => {}); check(/Valid certificate/.test(await p.evaluate(() => document.querySelector('#result').innerText)), 'issued certificate does not verify publicly'); });
  await p.evaluate(() => resetDemoData());
  await tc('TC-084', async () => {
    await p.evaluate(() => { sessionStorage.setItem('sdcSession', 'u-admin'); addRecord('programs', { name: 'Should vanish', code: 'ZZ' }); });
    await p.goto(base + '/app.html#/settings?tab=data', { waitUntil: 'networkidle0' }); await W(300);
    await p.click('[data-reset]'); await W(200);
    await Promise.all([p.click('.modal [data-ok]'), p.waitForNavigation({ waitUntil: 'networkidle0' })]); await W(300);
    check(await p.evaluate(() => { invalidateCache(); return !db().programs.some(x => x.code === 'ZZ') && db().users.length === SEED.users.length; }), 'not reset to seed');
  });
  console.log(JSON.stringify({ results: out, pageErrors: [...new Set(errors)] }, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
