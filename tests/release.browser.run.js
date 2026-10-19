/* Release audit: real Chrome, real client + gateway + AI adapters, random disposable PostgreSQL.
   No .env, no production config, no real provider HTTP. NODE_PATH must include Playwright. */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const express = require('express'), { chromium } = require('playwright');
const pg = require('../scripts/localdb/pg'), { createRestServer } = require('../scripts/localdb/rest');
const CC = require('../js/coursecontent-logic'), CG = require('../js/coursegen-logic'), { fixture } = require('./regeneration.test');
const root = path.join(__dirname, '..'), clone = x => JSON.parse(JSON.stringify(x));
const artifacts = path.join(root, 'docs', 'qa', 'ai-course-builder');
const originalTabs = process.argv.includes('--reproduce-tabs') ? require('child_process').execFileSync('git', ['show', 'HEAD:js/pages-coursecontent.js'], { encoding: 'utf8' }) : null;
const models = { gemini: 'gemini-test', groq: 'openai/gpt-oss-test', openai: 'gpt-test', azure_openai: 'azure-test' };
const logs = [], results = [], ctl = { fail: '', after: Infinity, delay: 0 }, actualFetch = global.fetch;
const local = u => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(u).hostname);
for (const k of Object.keys(process.env)) if (/^(SDC_|SUPABASE_|OPENAI_|GEMINI_|GROQ_|AZURE_|DATABASE_URL$|VERCEL$|NODE_ENV$|JWT_SECRET$)/.test(k)) delete process.env[k];
// Every outbound provider request is answered in memory in its native wire format.
global.fetch = async (u, opts = {}) => {
  u = String(u); if (local(u)) return actualFetch(u, opts);
  const p = u.startsWith('https://generativelanguage.googleapis.com/') ? 'gemini' : u.startsWith('https://api.groq.com/') ? 'groq' : u.startsWith('https://api.openai.com/') ? 'openai' : u.startsWith('https://azure-test.openai.azure.com/') ? 'azure_openai' : '';
  if (!p) throw Error('Blocked unexpected external HTTP');
  if (u.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: models.groq, active: true, context_window: 131072, max_completion_tokens: 32768 }] }), { status: 200 });
  const b = JSON.parse(opts.body), sys = p === 'gemini' ? b.systemInstruction.parts[0].text : b.messages[0].content;
  const prompt = p === 'gemini' ? b.contents[0].parts[0].text : b.messages.at(-1).content;
  const kind = /curriculum designer/.test(sys) ? 'outline' : /curriculum reviewer/.test(sys) ? 'review' : /REPAIR it/.test(sys) ? 'repair' : /Write the LESSON/.test(sys) ? 'lesson' : /Write the PRACTICE/.test(sys) ? 'practice' : 'assess';
  const n = Number((/THIS SESSION: number (\d+)/.exec(prompt) || [])[1]) || 0;
  const fail = p === ctl.fail && n > ctl.after && ['lesson', 'practice', 'assess'].includes(kind);
  logs.push({ provider: p, kind, n, fail, prompt });
  if (ctl.delay) await new Promise(r => setTimeout(r, ctl.delay));
  if (fail) return new Response(JSON.stringify({ error: p === 'gemini' ? { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Daily quota exhausted', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'RequestsPerDay' }] }] } : { message: 'Rate limit reached on requests per day (RPD).', code: 'rate_limit_exceeded' } }), { status: 429 });
  let value;
  if (kind === 'outline') value = CG.mockOutline(prompt);
  else if (kind === 'review') value = { coverage: Array.from({ length: 6 }, (_, i) => ({ outcome: i + 1, sessions: [1], strength: 'strong' })), missingTopics: [], duplicates: [], progression: [], proposals: [], capstone: { title: 'QA capstone', brief: 'Compare charts', requirements: ['Build chart'], deliverables: ['Script'], milestones: [{ session: 1, task: 'Build' }], rubric: [{ criterion: 'Works', marks: 10 }], maxMarks: 10 } };
  else if (kind === 'repair') {
    value = {}; prompt.split(/^### "/m).slice(1).forEach(x => { const key = x.slice(0, x.indexOf('"')); value[key] = JSON.parse(x.split('\n')[1]); });
    if (value.teacherNotes) value.teacherNotes = ['QA repaired notes: preserve correct examples.'];
    if (value.objectives) value.objectives[0] += ' (reviewed)';
  } else { value = clone(fixture().parts[kind]); if (kind === 'lesson') value.objectives[0] += ' session ' + n; }
  const content = JSON.stringify(value), usage = { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 };
  return new Response(JSON.stringify(p === 'gemini' ? { candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, totalTokenCount: 200 } } : { model: models[p], choices: [{ message: { content }, finish_reason: 'stop' }], usage }), { status: 200 });
};
(async () => {
  assert.ok(pg.available() && pg.up());
  const name = 'sdc_test_release_' + crypto.randomBytes(6).toString('hex'), secret = crypto.randomBytes(24).toString('hex');
  let made = false, rest, server, browser, failed = false;
  const report = (name, evidence) => { results.push({ name, status: 'Pass', evidence }); console.log('PASS ' + name + ': ' + evidence); };
  try {
    await pg.createDb(name); made = true; await pg.apply(name, pg.MIGRATIONS()); await pg.setSecret(name, secret);
    console.log('Disposable database: ' + name);
    rest = await createRestServer((fn, args) => pg.callFn(name, fn, args));
    Object.assign(process.env, { SDC_STATE_SECRET: secret, SDC_AI_SECRETS_KEY: 'dummy-audit-encryption-only', SUPABASE_URL: rest.url, SUPABASE_ANON_KEY: 'dummy-local', SDC_AI_CONTENT_RATE: '1000' });
    const gw = require('../backend/state-api'), ai = require('../backend/ai-api');
    const seed = vm.runInNewContext(fs.readFileSync(path.join(root, 'js/seed.js'), 'utf8') + ';SEED');
    for (const k of Object.keys(seed)) if (Array.isArray(seed[k]) && k !== 'roles') seed[k] = [];
    seed.users = ['admin', 'learner'].map(role => ({ id: 'qa-' + role, name: 'QA ' + role, role: role === 'admin' ? 'admin' : 'student', email: role + '@example.invalid', status: 'Active', salt: 'qa-only', passwordHash: gw._test.hashPassword('qa-password', 'qa-only') }));
    seed.settings ||= {}; seed.settings.features = { ...(seed.settings.features || {}), courseGen: true };
    seed.settings.integrations = { aiEnabled: true, primaryProvider: 'gemini', fallbackProvider: 'groq', monthlyCallLimit: 5000, capabilities: Object.fromEntries(['courseGenerate', 'courseContent', 'contentRepair'].map(k => [k, { provider: 'gemini', model: models.gemini }])) };
    await pg.callFn(name, 'sdc_state_put_if', { p_secret: secret, p_state: seed, p_expected: null });
    const app = express(); app.get('/js/cloud-config.js', (req, res) => res.type('js').send('window.SDC_CLOUD_CONFIG=' + JSON.stringify({ enabled: true, url: rest.url, anonKey: 'dummy-local' })));
    if (originalTabs) app.get('/js/pages-coursecontent.js', (req, res) => res.type('js').send(originalTabs));
    app.use(gw); app.use(ai); app.use(express.static(root));
    server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const url = 'http://127.0.0.1:' + server.address().port;
    const api = async (endpoint, body, token, method = 'POST') => { const r = await actualFetch(url + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    const signIn = async role => (await api('/api/sdc/login', { email: role + '@example.invalid', password: 'qa-password' })).body;
    const admin = await signIn('admin');
    for (const p of Object.keys(models)) { const r = await api('/api/ai/configure', { provider: p, name: 'QA ' + p, apiKey: 'DUMMY-QA-ONLY-' + p, model: models[p], ...(p === 'azure_openai' ? { endpoint: 'https://azure-test.openai.azure.com', deployment: models[p], apiVersion: '2024-08-01-preview' } : {}) }, admin.token); assert.equal(r.status, 200); }
    const status = (await api('/api/ai/status', null, null, 'GET')).body;
    assert.ok(!JSON.stringify(status).includes('DUMMY-QA-ONLY')); report('server key masking', 'four dummy profiles configured; no raw dummy key in browser status');
    const learner = await signIn('learner');
    for (const feature of ['courseGenerate', 'courseContent', 'contentRepair']) assert.equal((await api('/api/ai/complete', { feature, prompt: 'test' }, learner.token)).status, 403);
    assert.equal((await api('/api/ai/auth', { userId: 'qa-admin' })).status, 403); report('authorization', 'learner refused all three builder capabilities; unauthenticated local-token mint refused');
    browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), blocked = [], errors = [], httpErrors = [];
    await context.route('**/*', route => { const u = route.request().url(); if (/^https?:/.test(u) && !local(u)) { blocked.push(new URL(u).hostname); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR:', e.message); }); page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) httpErrors.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    page.setDefaultTimeout(20000);
    page.on('dialog', d => d.accept());
    await page.goto(url + '/login.html');
    await page.evaluate(j => { sessionStorage.setItem('sdcSession', j.userId); sessionStorage.setItem('sdcCloudToken', j.token); localStorage.setItem('sdcCloudToken', j.token); localStorage.setItem('sdcLearnDB_v1', JSON.stringify(j.state)); }, admin);
    const contentUrl = id => url + '/app.html#/manage/course/' + id + '?tab=content';
    async function newCourse(count, first, tag) {
      await page.goto(url + '/app.html#/manage/courses/generate'); await page.locator('#cg-topic').fill('QA ' + tag); await page.locator('#cg-aud').fill('Synthetic learner team');
      await page.locator('#cg-weeks').fill(String(count / 2)); await page.locator('#cg-pw').fill('2'); await page.locator('#cg-h').fill('2');
      // Scope is a per-draft generation id; choose through the visible provider picker.
      await page.locator('[data-ap-change]').click();
      await page.locator('.ap-opt').filter({ hasText: first === 'gemini' ? 'Gemini' : first === 'groq' ? 'Groq' : first === 'openai' ? 'OpenAI' : 'Azure OpenAI' }).first().locator('input[type=radio]').check();
      await page.getByRole('button', { name: 'Use this provider', exact: true }).click();
      await page.locator('[data-generate]').click(); await page.locator('#o-title').waitFor();
      await page.locator('#o-title').fill('QA ' + tag + ' reviewed');
      await page.reload(); assert.equal(await page.locator('#o-title').inputValue(), 'QA ' + tag + ' reviewed');
      await page.locator('[data-act="toReview"]').click(); await page.locator('[data-create]').click();
      await page.waitForURL(/#\/manage\/course\//); const id = new URL(page.url()).hash.split('/')[3].split('?')[0];
      const data = await page.evaluate(id => ({ course: findRecord('courses', id), sessions: Domain.courseSessions(id, true) }), id);
      assert.equal(data.course.status, 'draft'); assert.equal(data.sessions.length, count); assert.ok(data.sessions.every(s => s.duration === '2h')); assert.equal(data.course.fee, 0);
      await page.reload(); assert.equal(await page.evaluate(id => Domain.courseSessions(id, true).length, id), count);
      report(tag + ' outline/draft', count + ' sessions, edited outline survives reload, atomic draft persisted; no fee/enrollments');
      await page.goto(contentUrl(id)); return id;
    }
    async function choose(id, provider) { await page.evaluate(({ id, provider, model }) => AIRoute.set(id, { provider, model }), { id, provider, model: models[provider] }); }
    async function generate() { console.log('Generating: ' + page.url()); await page.locator('[data-gen-all]').click(); await page.getByRole('dialog', { name: 'Generate course content', exact: true }).locator('[data-ok]').click(); console.log('Generation confirmed'); }
    const waitDone = async id => { try { await page.waitForFunction(id => !!TCRun.get(id), id, { timeout: 5000 }); await page.waitForFunction(id => TCRun.get(id)?.active === false, id, { timeout: 180000 }); } catch (e) { console.log('Runner diagnostic:', await page.evaluate(id => ({ run: TCRun.get(id), dialogs: [...document.querySelectorAll('[role="dialog"]')].map(x => x.innerText), text: document.body.innerText.slice(-1500) }), id), 'Mock requests:', logs.length); throw e; } };
    const contents = id => page.evaluate(id => Domain.courseSessions(id, true).map(s => ({ id: s.id, content: s.content })), id);
    if (process.argv.includes('--tabs-only') || process.argv.includes('--profiles-only')) {
      const id = await newCourse(2, 'azure_openai', 'tabs'), sid = (await contents(id))[0].id;
      const separate = process.argv.includes('--profiles-only'), other = separate ? await browser.newContext() : context;
      if (separate) await other.route('**/*', r => /^https?:/.test(r.request().url()) && !local(r.request().url()) ? r.abort() : r.continue());
      const tab = await other.newPage(); tab.on('dialog', d => d.accept());
      await tab.goto(url + '/login.html');
      if (separate) await tab.evaluate(j => { sessionStorage.setItem('sdcSession', j.userId); localStorage.setItem('sdcCloudToken', j.token); localStorage.setItem('sdcLearnDB_v1', JSON.stringify(j.state)); }, await signIn('admin'));
      else await tab.evaluate(() => sessionStorage.setItem('sdcSession', 'qa-admin'));
      await tab.goto(contentUrl(id));
      ctl.delay = 400; const start = logs.length;
      for (const p of [page, tab]) await p.evaluate(({ id, sid }) => TCRun.start(id, [{ sessionId: sid, parts: ['lesson'], fill: ['lesson'] }]), { id, sid });
      await Promise.all([page, tab].map(p => p.waitForFunction(id => TCRun.get(id)?.active === false, id)));
      const requests = logs.slice(start).filter(x => x.kind === 'lesson').length;
      console.log('MULTI-TAB lesson requests for the same missing part: ' + requests);
      assert.equal(requests, originalTabs || separate ? 2 : 1);
      if (separate) results.push({ name: 'cross-profile run exclusion', status: 'Fail', evidence: 'Two independent browser storage/lock contexts sent ' + requests + ' requests for the same missing part.' });
      else report(originalTabs ? 'baseline duplicate reproduction' : 'multi-tab run exclusion', requests + ' mocked request(s) for the same missing part');
      return;
    }
    if (process.argv.includes('--focused')) {
      const id = await newCourse(2, 'azure_openai', 'focused'), sid = (await contents(id))[0].id;
      await choose(id, 'azure_openai'); await generate(); await waitDone(id);
      assert.equal((await contents(id)).filter(s => CC.sessionState(s).done.length === 3).length, 2);
      report('Azure full generation', '2 sessions, all 6 parts through real Azure adapter with native-format mock');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.locator('.tc-head').waitFor(); await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(artifacts, 'builder-desktop-ready.png'), fullPage: false });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0);
      await page.screenshot({ path: path.join(artifacts, 'builder-mobile-ready.png'), fullPage: false });
      const width = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
      results.push({ name: 'rendered mobile width', status: width.width > width.viewport ? 'Fail' : 'Pass', evidence: width });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(sid => { const s = findRecord('sessions', sid), lesson = clone(s.content.lesson); lesson[0].example = 'plt.savefig("qa.png")'; updateRecord('sessions', sid, { content: CCL.applyEdit(s.content, { lesson }, App.user.id, new Date().toISOString()).content }); }, sid);
      await page.evaluate(() => SDCCloud.flushNow());
      const before = await contents(id), start = logs.length;
      for (let n = 0; n < 2; n++) { await page.locator('[data-review]').click(); await page.waitForFunction(() => !document.querySelector('[data-review]').disabled); }
      const reviews = logs.slice(start); assert.equal(reviews.length, 2); assert.ok(reviews.every(x => x.kind === 'review' && x.prompt.includes('plt.savefig'))); assert.deepEqual(reviews[0].prompt, reviews[1].prompt); assert.deepEqual(await contents(id), before);
      await page.evaluate(() => SDCCloud.flushNow()); await page.reload();
      assert.equal(await page.evaluate(id => CCL.reviewCurrent(findRecord('courses', id), Domain.courseSessions(id, true)), id), true);
      report('Course Check saved evidence', 'savefig only in saved example reached both identical mock review prompts; no session mutation; review current after PostgreSQL reload');
      const count = logs.length;
      await page.evaluate(id => { const c = findRecord('courses', id); updateRecord('courses', id, { aiContent: { ...c.aiContent, proposals: [{ id: 'QA-ADD', session: 1, topic: 'Figure exporting', instructions: 'Explain PNG export', status: 'open', severity: 'medium' }] } }); App.render(); }, id);
      await page.locator('[data-prop="QA-ADD"][data-mode="content"]').click(); await page.getByRole('dialog', { name: 'Apply this proposal', exact: true }).locator('[data-ok]').click();
      assert.equal(logs.length, count); const applied = (await contents(id))[0].content; assert.deepEqual(applied.lesson, before[0].content.lesson); assert.ok(applied.meta.outdated.length);
      await page.locator('[data-retry="' + sid + '"]').click(); assert.equal(logs.length, count); assert.equal(await page.locator('input[name="p"][value="lesson"]').isChecked(), false); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      report('Course Check addition', 'Add to content marks outdated and saves instructions, 0 AI requests; edited lesson unchecked; cancel 0 requests');
      // Genuine gateway 401 and offline write failures, not mocked browser state.
      await page.evaluate(() => SDCCloud.flushNow());
      await page.evaluate(sid => { localStorage.setItem('sdcCloudToken', 'expired-test-token'); updateRecord('sessions', sid, { summary: 'QA unsaved after expiry' }); }, sid);
      await page.evaluate(() => SDCCloud.flushNow()); assert.equal(await page.evaluate(() => SDCCloud.status().state), 'auth');
      assert.equal(await page.evaluate(() => SDCCloud.hasPending()), true); await page.reload();
      assert.equal(await page.evaluate(sid => findRecord('sessions', sid).summary, sid), 'QA unsaved after expiry');
      await page.evaluate(async () => { await SDCCloud.signIn('admin@example.invalid', 'qa-password', false); sessionStorage.setItem('sdcSession', 'qa-admin'); await SDCCloud.flushNow(); });
      const saved = await pg.callFn(name, 'sdc_state_get', { p_secret: secret }); assert.equal(saved.state.sessions.find(s => s.id === sid).summary, 'QA unsaved after expiry');
      report('expired login recovery', 'real gateway 401 preserved pending edit across reload; same-account sign-in replay reached PostgreSQL');
      await context.route('**/api/sdc/state', r => r.request().method() === 'PUT' ? r.abort() : r.continue());
      await page.evaluate(sid => updateRecord('sessions', sid, { summary: 'QA network retry' }), sid); await page.evaluate(() => SDCCloud.flushNow());
      assert.equal(await page.evaluate(() => SDCCloud.hasPending()), true); assert.notEqual(await page.evaluate(() => SDCCloud.status().state), 'saved');
      await context.unroute('**/api/sdc/state'); await page.evaluate(() => SDCCloud.retryNow());
      assert.equal((await pg.callFn(name, 'sdc_state_get', { p_secret: secret })).state.sessions.find(s => s.id === sid).summary, 'QA network retry');
      report('network write retry', 'aborted PUT not reported saved; pending retained; retry persisted exact edit');
      const fullStorage = await page.evaluate(sid => {
        const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === 'sdcLearnDB_v1') throw new DOMException('QA full', 'QuotaExceededError'); return set.call(this, k, v); };
        let threw = false; try { updateRecord('sessions', sid, { summary: 'QA storage recovery' }); } catch (e) { threw = true; }
        const state = SDCCloud.status().state; Storage.prototype.setItem = set; return { threw, state };
      }, sid);
      assert.deepEqual(fullStorage, { threw: true, state: 'storage' });
      await page.evaluate(() => SDCCloud.flushNow());
      assert.equal((await pg.callFn(name, 'sdc_state_get', { p_secret: secret })).state.sessions.find(s => s.id === sid).summary, 'QA storage recovery');
      await page.evaluate(() => saveDB(db())); await page.evaluate(() => SDCCloud.flushNow());
      report('storage-full recovery', 'real persist path threw QuotaExceededError, status storage; in-memory edit saved to PostgreSQL after capacity restored');
      const exposed = await api('/api/sdc/state', null, learner.token, 'GET');
      assert.equal(exposed.status, 200); assert.ok(exposed.body.state.courses.some(c => c.id === id)); assert.ok(exposed.body.state.sessions.find(s => s.id === sid).content.quiz.length);
      results.push({ name: 'learner raw-state isolation', status: 'Fail', evidence: 'Unenrolled learner received synthetic draft course and quiz answer keys from gateway state; UI hiding is not read authorization.' });
      console.log('CONFIRMED production blocker: learner raw state contains draft content and answer keys.');
      const tampered = clone(exposed.body.state); tampered.questions.push({ id: 'QA-UNAUTHORIZED', courseId: id, stem: 'Unauthorized synthetic question', points: 1 });
      assert.equal((await api('/api/sdc/state', { state: tampered }, learner.token, 'PUT')).status, 200);
      assert.ok((await pg.callFn(name, 'sdc_state_get', { p_secret: secret })).state.questions.some(q => q.id === 'QA-UNAUTHORIZED'));
      results.push({ name: 'question-bank server authorization', status: 'Fail', evidence: 'Learner hand-made state PUT added a synthetic question to an unprotected collection.' });
      const approvedSid = (await contents(id))[1].id;
      await page.evaluate(({ id, sid }) => {
        addRecord('batches', { id: 'QA-BATCH', courseId: id, name: 'QA batch', status: 'Active', instructorId: 'qa-admin' });
        addRecord('enrollments', { id: 'QA-ENROLL', courseId: id, batchId: 'QA-BATCH', learnerId: 'qa-learner', status: 'Active', accessMode: 'full', allowedSessionIds: [] });
        updateRecord('courses', id, { status: 'published' }); tcSetApproval(sid, true, App.user.id);
      }, { id, sid: approvedSid });
      await page.evaluate(() => SDCCloud.flushNow());
      const learnerContext = await browser.newContext(); await learnerContext.route('**/*', r => /^https?:/.test(r.request().url()) && !local(r.request().url()) ? r.abort() : r.continue());
      const lp = await learnerContext.newPage(), lj = await signIn('learner'); await lp.goto(url + '/login.html');
      await lp.evaluate(j => { sessionStorage.setItem('sdcSession', j.userId); localStorage.setItem('sdcCloudToken', j.token); localStorage.setItem('sdcLearnDB_v1', JSON.stringify(j.state)); }, lj);
      await lp.goto(url + '/app.html#/course/' + id + '/session/' + approvedSid); await lp.locator('.tc-card [data-sec="lesson"]').waitFor();
      assert.equal(await lp.locator('.tc-card [data-sec="quiz"],.tc-card [data-sec="teacherNotes"],.tc-card [data-sec="timePlan"]').count(), 0);
      await lp.goto(url + '/app.html#/course/' + id + '/session/' + sid); assert.equal(await lp.locator('.tc-card').count(), 0);
      await lp.goto(url + '/app.html#/manage/course/' + id + '?tab=content'); assert.equal(await lp.locator('[data-gen-all]').count(), 0);
      report('learner UI gating', 'enrolled learner sees approved published lesson only, no quiz/notes/timing; unapproved session hidden; manage/generate route refused');
      await page.reload(); await page.locator('[data-repair-open="' + approvedSid + '"]').click();
      await page.locator('input[name="k"][value="teacherNotes"]').check(); await page.locator('[data-go]').click(); await waitDone(id);
      assert.ok((await contents(id)).find(s => s.id === approvedSid).content.meta.approved, 'proposal did not withdraw approval or change live text');
      await page.locator('[data-repair-review="' + approvedSid + '"]').click(); await page.locator('input[name="d-teacherNotes"][value="use"]').check();
      await page.locator('[data-apply]').click(); await page.getByRole('dialog', { name: 'Apply the AI version', exact: true }).locator('[data-ok]').click();
      await page.evaluate(() => SDCCloud.flushNow());
      assert.equal((await contents(id)).find(s => s.id === approvedSid).content.meta.approved, undefined);
      assert.equal(await page.evaluate(id => findRecord('courses', id).status, id), 'published');
      await lp.goto(url + '/app.html#/course/' + id + '/session/' + approvedSid); await lp.evaluate(() => SDCCloud.pullNow()); assert.equal(await lp.locator('.tc-card').count(), 0);
      await learnerContext.close(); report('published repair approval', 'proposal kept approved text; explicit acceptance withdrew approval, did not republish; learner no longer sees replaced content');
      assert.deepEqual(errors, []); return;
    }
    for (const [first, next, reload] of [['gemini', 'groq', true], ['groq', 'gemini', false]]) {
      const id = await newCourse(24, first, first + '-switch'); await choose(id, first);
      const integrationsBefore = await page.evaluate(() => settings().integrations);
      ctl.fail = first; ctl.after = 10; const start = logs.length; await generate(); await waitDone(id);
      let before = await contents(id); const complete = before.filter(x => CC.sessionState(x).done.length === 3); assert.equal(complete.length, 10);
      assert.ok(logs.slice(start).every(x => x.provider === first));
      const manualId = before[0].id; await page.evaluate(id => { const s = findRecord('sessions', id); updateRecord('sessions', id, { content: CCL.applyEdit(s.content, { teacherNotes: ['QA manual preserve'] }, App.user.id, new Date().toISOString()).content }); }, manualId);
      before = await contents(id); await page.evaluate(() => SDCCloud.flushNow());
      if (reload) { await page.reload(); await page.locator('[data-switch-resume]').waitFor(); }
      const atPause = logs.length; await page.locator('[data-switch-resume]').waitFor(); assert.equal(logs.length, atPause);
      await page.locator('.ap-opt').filter({ hasText: next === 'groq' ? 'Groq' : 'Gemini' }).first().locator('input').check();
      await page.locator('[data-switch-resume]').click();
      if (reload) {
        await page.getByRole('dialog', { name: 'Switch provider and resume', exact: true }).waitFor();
        await page.reload(); assert.equal(logs.length, atPause, 'reload during unconfirmed switch sends no requests');
        await page.locator('[data-switch-resume]').waitFor();
        await page.locator('.ap-opt').filter({ hasText: 'Groq' }).first().locator('input').check(); await page.locator('[data-switch-resume]').click();
      }
      await page.getByRole('button', { name: 'Switch to ' + (next === 'groq' ? 'Groq' : 'Gemini') + ' and resume', exact: true }).click();
      await waitDone(id); const after = await contents(id); assert.ok(after.every(x => CC.sessionState(x).done.length === 3));
      for (const old of before.filter(x => CC.sessionState(x).done.length === 3)) assert.deepEqual(after.find(x => x.id === old.id).content, old.content);
      assert.ok(logs.slice(atPause).every(x => x.provider === next && x.n > 10));
      assert.deepEqual(await page.evaluate(() => settings().integrations), integrationsBefore);
      await page.evaluate(() => SDCCloud.flushNow()); const stored = await pg.callFn(name, 'sdc_state_get', { p_secret: secret }); assert.equal(stored.state.sessions.filter(s => s.courseId === id && CC.sessionState(s).done.length === 3).length, 24);
      report(first + ' to ' + next, '24 sessions; quota after 10 complete; 30 finished parts + manual edit unchanged; only incomplete parts resumed' + (reload ? ' after pause reload and interruption of unconfirmed switch (0 requests)' : '') + '; global Settings unchanged');
      ctl.fail = ''; ctl.after = Infinity;
    }
    const small = await newCourse(8, 'openai', 'small-stop'); await choose(small, 'openai'); ctl.delay = 120;
    await generate(); await page.waitForFunction(id => (TCRun.get(id)?.done || 0) >= 4, small); await page.locator('[data-stop]').click(); await waitDone(small);
    const stopped = await contents(small), doneBefore = stopped.reduce((n, s) => n + CC.sessionState(s).done.length, 0), resumedAt = logs.length;
    ctl.delay = 0; await page.evaluate(() => SDCCloud.flushNow()); await page.reload(); await generate(); await waitDone(small);
    const full = await contents(small); assert.equal(full.reduce((n, s) => n + CC.sessionState(s).done.length, 0), 24); assert.equal(logs.length - resumedAt, 24 - doneBefore);
    stopped.forEach(old => CC.sessionState(old).done.forEach(p => CC.FIELDS_OF(p).forEach(k => assert.deepEqual(full.find(s => s.id === old.id).content[k], old.content[k]))));
    report('stop/reload/resume', '8 sessions: ' + doneBefore + ' saved parts kept, exactly ' + (24 - doneBefore) + ' missing requests after resume');
    const sid = full[0].id;
    // Browser field selection/proposal/partial apply; no automatic code finding required.
    for (const provider of Object.keys(models)) {
      await choose(small, provider); const original = await contents(small); const s = original[0];
      await page.locator('[data-repair-open="' + sid + '"]').click();
      for (const field of await page.locator('input[name="k"]').all()) await field.uncheck();
      await page.locator('input[value="teacherNotes"]').check(); await page.locator('input[value="objectives"]').check();
      await page.locator('[data-go]').click(); await waitDone(small);
      const pending = (await contents(small))[0]; assert.deepEqual(pending.content.teacherNotes, s.content.teacherNotes); assert.deepEqual(pending.content.objectives, s.content.objectives);
      await page.locator('[data-repair-review="' + sid + '"]').click();
      // The first pending part is lesson; accept its single selected field, leaving other parts pending.
      await page.locator('input[name="d-objectives"][value="use"]').check(); await page.locator('[data-apply]').click(); await page.getByRole('button', { name: /^Apply/ }).last().click();
      await page.waitForFunction(id => findRecord('sessions', id).content.objectives[0].includes('(reviewed)'), sid);
      assert.deepEqual((await contents(small))[0].content.teacherNotes, s.content.teacherNotes);
      // Reject the remaining assessment proposal through its review window.
      if (await page.locator('[data-modal-close]').count()) await page.locator('[data-modal-close]').last().click();
      await page.locator('[data-repair-review="' + sid + '"]').click(); await page.locator('[data-reject]').click(); await page.getByRole('button', { name: 'Reject', exact: true }).last().click();
      await page.locator('[data-modal-close]').last().click();
      report(provider + ' repair UI', 'selected objectives + notes sent, text unchanged before acceptance, lesson accepted, assessment rejected');
    }
    await page.locator('[data-review]').click(); await page.waitForFunction(id => !!findRecord('courses', id).aiContent?.review, small);
    const checked = await contents(small); await page.locator('[data-review]').click(); await page.waitForFunction(id => !document.querySelector('[data-review]').disabled, small); assert.deepEqual(await contents(small), checked);
    report('Course Check', 'two mocked checks; no session text change or generation');
    await page.locator('[data-approve="' + sid + '"]').click(); assert.ok((await contents(small))[0].content.meta.approved);
    await page.goto(url + '/app.html#/course/' + small + '/session/' + sid + '?view=learner'); await page.getByText('Preview of what').waitFor();
    assert.equal(await page.locator('.tc-card').getByText('Instructor teaching notes', { exact: true }).count(), 0); report('approval/learner preview', 'human Approve, draft preview visible to staff, instructor notes not shown');
    await page.goto(contentUrl(small)); fs.mkdirSync(artifacts, { recursive: true }); await page.screenshot({ path: path.join(artifacts, 'builder-desktop.png'), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(artifacts, 'builder-mobile.png'), fullPage: false });
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
    results.push({ name: 'mobile horizontal overflow', status: overflow.width > overflow.viewport ? 'Fail' : 'Pass', evidence: overflow });
    assert.deepEqual(errors, []); report('runtime', 'zero uncaught page errors; expected quota failures: ' + httpErrors.length + '; external assets blocked: ' + blocked.length);
    fs.writeFileSync(path.join(artifacts, 'browser-results.json'), JSON.stringify({ database: name, results, errors, httpErrors, blocked, calls: logs.map(({ prompt, ...x }) => x) }, null, 2));
  } catch (e) {
    failed = true;
    console.error('Audit failure before cleanup:', e);
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'incomplete-' + name + '.json'), JSON.stringify({ completed: false, error: e.message, results, calls: logs.map(({ prompt, ...x }) => x) }, null, 2));
    throw e;
  } finally {
    if (browser) await browser.close(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } if (rest) { rest.server.closeAllConnections(); await rest.close(); }
    if (made) { await pg.dropDb(name); console.log('Removed only disposable database ' + name); } global.fetch = actualFetch;
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'run-' + name + '.json'), JSON.stringify({ completed: !failed, mode: process.argv.slice(2), databaseRemoved: made, results, calls: logs.map(({ prompt, ...x }) => x) }, null, 2));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
