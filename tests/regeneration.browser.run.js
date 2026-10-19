/* Real browser + real gateway + uniquely named disposable LOCAL PostgreSQL database.
   Never loads .env or backend/server.js. AI endpoints are mocks; all non-loopback HTTP is blocked.
   Run: node tests/regeneration.browser.run.js (Playwright on NODE_PATH; local PG already running). */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const express = require('express'), { chromium } = require('playwright');
const pg = require('../scripts/localdb/pg'), { createRestServer } = require('../scripts/localdb/rest');
const { fixture } = require('./regeneration.test'), CC = require('../js/coursecontent-logic');
const root = path.join(__dirname, '..'), clone = v => JSON.parse(JSON.stringify(v));
const original = process.argv.includes('--reproduce-original') ? require('child_process').execFileSync('git', ['show', 'HEAD:js/pages-coursecontent.js'], { encoding: 'utf8' }) : null;
const loopback = url => ['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname);
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DATABASE_URL', 'VERCEL', 'NODE_ENV', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'AZURE_OPENAI_API_KEY']) delete process.env[k];
const actualFetch = global.fetch;
global.fetch = (url, ...args) => { if (!loopback(String(url))) throw Error('Blocked external HTTP: ' + url); return actualFetch(url, ...args); };
(async () => {
  assert.ok(pg.available() && pg.up(), 'Requires existing local PostgreSQL; never starts or resets sdc_dev');
  const dbName = 'sdc_test_regen_' + crypto.randomBytes(6).toString('hex'), secret = crypto.randomBytes(24).toString('hex');
  let made = false, rest, server, browser;
  try {
    await pg.createDb(dbName); made = true;
    // Local cluster already has the Supabase-compatible test roles. No role or existing DB changes.
    await pg.apply(dbName, pg.MIGRATIONS()); await pg.setSecret(dbName, secret);
    rest = await createRestServer((fn, args) => pg.callFn(dbName, fn, args));
    process.env.SDC_STATE_SECRET = secret; process.env.SUPABASE_URL = rest.url; process.env.SUPABASE_ANON_KEY = 'disposable-local-only';
    const gateway = require('../backend/state-api');
    const f = fixture(), seed = vm.runInNewContext(fs.readFileSync(path.join(root, 'js/seed.js'), 'utf8') + ';SEED');
    for (const k of Object.keys(seed)) if (Array.isArray(seed[k]) && k !== 'roles') seed[k] = [];
    seed.users = [{ id: 'u-admin', name: 'QA Administrator', role: 'admin', email: 'qa@example.invalid', status: 'Active', salt: 'qa-only', passwordHash: gateway._test.hashPassword('disposable-password', 'qa-only') }];
    seed.courses = [f.course]; seed.sessions = [f.session]; seed.settings ||= {};
    seed.settings.features = { ...(seed.settings.features || {}), courseGen: true };
    seed.settings.integrations = { aiEnabled: true, primaryProvider: 'groq', fallbackProvider: 'none', capabilities: Object.fromEntries(['courseContent', 'contentRepair', 'courseGenerate'].map(k => [k, { provider: 'groq', model: 'mock-groq' }])) };
    await pg.callFn(dbName, 'sdc_state_put_if', { p_secret: secret, p_state: seed, p_expected: null });
    const app = express(), calls = [], blocked = []; let lag = 0; app.use(express.json({ limit: '20mb' }));
    app.get('/js/cloud-config.js', (req, res) => res.type('js').send('window.SDC_CLOUD_CONFIG=' + JSON.stringify({ enabled: true, url: rest.url, anonKey: 'disposable-local-only' })));
    if (original) app.get('/js/pages-coursecontent.js', (req, res) => res.type('js').send(original));
    app.use(gateway);
    app.get('/api/ai/status', (req, res) => res.json({ profiles: [{ id: 'QA-GROQ', provider: 'groq', name: 'Mock Groq', model: 'mock-groq', maskedKey: 'mock-only' }], env: {}, usage: {} }));
    app.post('/api/ai/complete', (req, res) => {
      const part = /Write the LESSON part/.test(req.body.system) ? 'lesson' : /Write the PRACTICE part/.test(req.body.system) ? 'practice' : 'assess';
      calls.push({ part, feature: req.body.feature, noFallback: req.body.noFallback });
      const value = clone(f.parts[part]);
      if (part === 'lesson') value.lesson[0].body = 'Mock regenerated explanation. '.repeat(12);
      if (part === 'practice') value.practice[0].task = 'Mock replacement task';
      if (part === 'assess') value.teacherNotes = ['Mock replacement notes'];
      const reply = () => res.json({ text: JSON.stringify(value), provider: 'groq', model: 'mock-groq', tokens: 10 });
      if (lag) setTimeout(reply, lag); else reply();
    });
    app.use(express.static(root));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const context = await browser.newContext();
    await context.route('**/*', route => { const u = route.request().url(); if (/^https?:/.test(u) && !loopback(u)) { blocked.push(u); return route.abort(); } return route.continue(); });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url + '/login.html');
    await page.evaluate(async () => { const r = await fetch('/api/sdc/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa@example.invalid', password: 'disposable-password' }) }); const j = await r.json(); if (!r.ok) throw Error(JSON.stringify(j)); sessionStorage.setItem('sdcSession', j.userId); localStorage.setItem('sdcCloudToken', j.token); sessionStorage.setItem('sdcCloudToken', j.token); localStorage.setItem('sdcLearnDB_v1', JSON.stringify(j.state)); });
    await page.goto(url + '/app.html#/manage/course/' + f.course.id + '?tab=content');
    await page.locator('[data-retry]').waitFor();
    const read = () => page.evaluate(id => JSON.parse(JSON.stringify(findRecord('sessions', id).content)), f.session.id);
    const before = await read();
    if (original) {
      assert.equal(await page.locator('[data-retry]').innerText(), 'Update');
      await page.locator('[data-retry]').click();
      await page.waitForFunction(id => TCRun.get(id)?.active === false, f.course.id);
      assert.deepEqual(calls.map(c => c.part), CC.PARTS);
      assert.deepEqual((await read()).meta.history.slice(0, 3).map(h => h.kind), ['regenerate', 'regenerate', 'regenerate']);
      console.log('REPRODUCED original Update: three mocked Groq requests, no confirmation, accepted repair overwritten.');
    } else {
      await page.locator('[data-retry]').click();
      assert.equal(calls.length, 0);
      assert.equal(await page.locator('input[name="p"][value="lesson"]').isChecked(), false);
      assert.equal(await page.locator('input[name="p"][value="assess"]').isChecked(), false);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      // Ordinary course/session/content Save handlers must never send AI requests.
      await page.locator('[data-edit-course]').click();
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
      await page.locator('[data-edit]').first().click();
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await page.goto(url + '/app.html#/manage/course/' + f.course.id + '?tab=content');
      await page.locator('[data-view]').click();
      await page.locator('[data-ed="lesson"]').click();
      await page.locator('[data-key="objectives"] textarea').fill('Explain charts\nBuild charts\nCompare charts');
      await page.locator('[data-save]').click();
      assert.equal(calls.length, 0, 'ordinary saves made zero AI requests');
      const editedContent = await read();
      assert.deepEqual(editedContent.lesson.map(x => x.body), before.lesson.map(x => x.body), 'saving objectives keeps repaired explanation (editor may fence existing code)');
      await page.locator('[data-retry]').click();
      await page.locator('input[name="p"][value="lesson"]').check();
      await page.locator('input[name="p"][value="practice"]').uncheck();
      await page.locator('[data-go]').click();
      await page.getByRole('button', { name: 'Regenerate and replace', exact: true }).waitFor();
      assert.equal(calls.length, 0);
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
      assert.equal(calls.length, 0, 'cancel did not generate');
      await page.locator('[data-go]').click();
      await page.getByRole('button', { name: 'Regenerate and replace', exact: true }).click();
      await page.waitForFunction(id => TCRun.get(id)?.active === false, f.course.id);
      assert.equal(calls.length, 1); assert.equal(calls[0].part, 'lesson'); assert.equal(calls[0].feature, 'contentRepair'); assert.equal(calls[0].noFallback, true);
      const after = await read(); assert.deepEqual(after.practice, before.practice); assert.deepEqual(after.teacherNotes, before.teacherNotes);
      assert.equal(after.meta.history[0].kind, 'regenerate'); assert.ok(after.meta.history.some(h => h.kind === 'repair'));
      await page.evaluate(async () => { await SDCCloud.flushNow(); });
      const stored = await pg.callFn(dbName, 'sdc_state_get', { p_secret: secret });
      assert.deepEqual(stored.state.sessions[0].content.lesson, after.lesson, 'real PostgreSQL saved the replacement');
      await page.reload(); await page.locator('[data-view]').click();
      await page.locator('[data-restore]').first().click();
      await page.getByRole('button', { name: 'Restore', exact: true }).click();
      await page.waitForFunction(id => findRecord('sessions', id).content.meta.history[0].kind === 'restore', f.session.id);
      assert.deepEqual((await read()).lesson, editedContent.lesson, 'browser history restored accepted repair');
      assert.equal(calls.length, 1, 'restore sends no AI requests');
      await page.locator('[data-modal-close]').last().click();
      lag = 1000;
      await page.locator('[data-retry]').click();
      await page.locator('input[name="p"][value="lesson"]').check();
      await page.locator('input[name="p"][value="practice"]').uncheck();
      await page.locator('input[name="p"][value="assess"]').uncheck();
      await page.locator('[data-go]').click(); await page.getByRole('button', { name: 'Regenerate and replace', exact: true }).click();
      for (let i = 0; calls.length < 2 && i < 100; i++) await new Promise(r => setTimeout(r, 10));
      assert.equal(calls.length, 2);
      await page.evaluate(id => { const s = findRecord('sessions', id); updateRecord('sessions', id, { content: CCL.applyEdit(s.content, { objectives: ['QA newer manual edit', 'Build charts', 'Compare charts'] }, App.user.id, new Date().toISOString()).content }); }, f.session.id);
      await page.waitForFunction(id => TCRun.get(id)?.active === false, f.course.id);
      assert.equal((await read()).objectives[0], 'QA newer manual edit');
      assert.equal((await read()).meta.history[0].kind, 'restore', 'late discarded answer added no replacement history');
      console.log('PASS browser: ordinary saves/cancel 0 AI; explicit Lesson replacement 1 mock request; late second response discarded after a newer edit; unrelated parts, repair history, PostgreSQL reload and restore kept.');
    }
    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log('Isolated database: ' + dbName + '; blocked external browser requests: ' + blocked.length);
  } finally {
    if (browser) await browser.close(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } if (rest) { rest.server.closeAllConnections(); await rest.close(); }
    // Only this invocation's newly created random database is disposable. No existing DB is dropped.
    if (made) { await pg.dropDb(dbName); console.log('Removed this run\'s disposable database: ' + dbName); }
    global.fetch = actualFetch;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
