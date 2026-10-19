/* MCP connector and the in-app Course Builder together, in a real browser: real gateway (backend/state-api.js)
   and connector (backend/mcp-api.js) over a uniquely named disposable LOCAL PostgreSQL database. A change
   applied through MCP shows in the Course Builder; a proposal made through MCP is compared and accepted in
   the Course Builder's own review window; MCP then reads the accepted text. No AI provider exists here and
   all non-loopback HTTP is blocked. Never loads .env or backend/server.js.
   Run: node tests/mcp.browser.run.js (Playwright on NODE_PATH; local PG already running). */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const express = require('express'), { chromium } = require('playwright');
const pg = require('../scripts/localdb/pg'), { createRestServer } = require('../scripts/localdb/rest');
const root = path.join(__dirname, '..'), b64 = b => b.toString('base64url');
const loopback = url => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DATABASE_URL', 'VERCEL', 'NODE_ENV', 'PUBLIC_URL', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'AZURE_OPENAI_API_KEY']) delete process.env[k];
const actualFetch = global.fetch;
global.fetch = (url, ...args) => { if (!loopback(String(url))) throw Error('Blocked external HTTP: ' + url); return actualFetch(url, ...args); };

(async () => {
  assert.ok(pg.available() && pg.up(), 'Requires existing local PostgreSQL; never starts or resets sdc_dev');
  const dbName = 'sdc_test_mcpui_' + crypto.randomBytes(6).toString('hex'), secret = crypto.randomBytes(24).toString('hex');
  let made = false, rest, server, browser, page;
  try {
    await pg.createDb(dbName); made = true;
    await pg.apply(dbName, pg.MIGRATIONS()); await pg.setSecret(dbName, secret);
    rest = await createRestServer((fn, args) => pg.callFn(dbName, fn, args));
    Object.assign(process.env, { SDC_STATE_SECRET: secret, SUPABASE_URL: rest.url, SUPABASE_ANON_KEY: 'disposable-local-only', SDC_MCP: '1' });
    const gateway = require('../backend/state-api'), mcp = require('../backend/mcp-api');
    const seed = vm.runInNewContext(fs.readFileSync(path.join(root, 'js/seed.js'), 'utf8') + ';SEED');
    for (const k of Object.keys(seed)) if (Array.isArray(seed[k]) && k !== 'roles') seed[k] = [];
    const lessonPart = { objectives: ['Read a CSV file', 'Describe a data frame'], prerequisites: ['Python basics'], timePlan: [{ minutes: 60, activity: 'Talk' }, { minutes: 60, activity: 'Lab' }],
      lesson: [{ heading: 'Loading data', body: 'Use pandas.' }, { heading: 'Looking at data', body: 'head() and info().' }, { heading: 'Saving', body: 'to_csv().' }] };
    Object.assign(seed, {
      users: [{ id: 'u-a', role: 'admin', name: 'QA Coordinator', email: 'qa-admin@example.invalid', status: 'Active', salt: 'qa', passwordHash: gateway._test.hashPassword('disposable-password', 'qa') }],
      courses: [{ id: 'C1', title: 'QA Python Data', slug: 'qa-py', status: 'draft', level: 'Beginner', description: 'Synthetic course.', outcomes: ['Load data'], modules: [{ name: 'Basics' }] }],
      sessions: [{ id: 'S1', courseId: 'C1', title: 'QA Intro', moduleName: 'Basics', summary: 'Load data', duration: '2h', order: 1, published: true, content: { ...lessonPart, v: 1, meta: { approved: true, parts: { lesson: { at: '2026-10-01T10:00:00Z', provider: 'gemini', model: 'mock' } } } } },
        { id: 'S2', courseId: 'C1', title: 'QA Grouping', moduleName: 'Basics', summary: 'groupby', duration: '2h', order: 2, published: true }],
      batches: [{ id: 'B1', courseId: 'C1', name: 'QA-B1', instructorId: '', status: 'Active' }]
    });
    await pg.callFn(dbName, 'sdc_state_put_if', { p_secret: secret, p_state: seed, p_expected: null });
    const stored = async () => (await pg.callFn(dbName, 'sdc_state_get', { p_secret: secret })).state;
    const app = express();
    app.get('/js/cloud-config.js', (req, res) => res.type('js').send('window.SDC_CLOUD_CONFIG=' + JSON.stringify({ enabled: true, url: rest.url, anonKey: 'disposable-local-only' })));
    app.use(gateway); app.use(mcp); app.use(express.static(root));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = 'http://127.0.0.1:' + server.address().port;

    // The connector signs in like ChatGPT or Claude would: register, authorize with PKCE, exchange the code.
    const post = (p, body, form) => actualFetch(url + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) });
    const CB = 'https://chatgpt.com/connector_platform_oauth_redirect', { client_id } = await (await post('/oauth/register', { redirect_uris: [CB], client_name: 'ChatGPT' })).json();
    const verifier = b64(crypto.randomBytes(32)), challenge = b64(crypto.createHash('sha256').update(verifier).digest());
    const auth = await post('/oauth/authorize', { response_type: 'code', client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 's', email: 'qa-admin@example.invalid', password: 'disposable-password' }, true);
    const code = new URL(auth.headers.get('location')).searchParams.get('code');
    const { access_token } = await (await post('/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: CB, client_id, code_verifier: verifier }, true)).json();
    let n = 0;
    const tool = async (name, args) => {
      const r = await (await actualFetch(url + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + access_token }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }) })).json();
      assert.ok(!r.result.isError, name + ': ' + r.result.content[0].text); return JSON.parse(r.result.content[0].text);
    };
    // 1. Through MCP: a practice part written by the assistant and applied after approval; an objectives proposal left waiting.
    const p2 = await tool('propose_session_changes', { sessionId: 'S2', part: 'practice', fields: { practice: [{ title: 'QA Group sales by region', task: 'Use groupby on the sales table.', criteria: ['Correct totals'] }] }, assistant: 'ChatGPT' });
    await tool('apply_proposal', { sessionId: 'S2', proposalId: p2.proposalId, approved: true });
    const stamp = (await tool('get_session_content', { sessionId: 'S1', part: 'lesson' })).stamp;
    await tool('propose_session_changes', { sessionId: 'S1', part: 'lesson', fields: { objectives: ['QA Load a CSV file with pandas', 'Inspect a data frame'] }, basedOn: stamp, reason: 'Name the tools.', assistant: 'ChatGPT' });

    // 2. The coordinator in the LMS: the applied part shows; the waiting proposal is compared and accepted in the Course Builder.
    browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const context = await browser.newContext(), blocked = [], errors = [];
    await context.route('**/*', route => { const u = route.request().url(); if (/^https?:/.test(u) && !loopback(u)) { blocked.push(u); return route.abort(); } return route.continue(); });
    page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(url + '/login.html'); await page.waitForLoadState('networkidle');
    await page.evaluate(async () => { const r = await fetch('/api/sdc/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa-admin@example.invalid', password: 'disposable-password' }) }); const j = await r.json(); if (!r.ok) throw Error(JSON.stringify(j)); sessionStorage.setItem('sdcSession', j.userId); localStorage.setItem('sdcCloudToken', j.token); sessionStorage.setItem('sdcCloudToken', j.token); localStorage.setItem('sdcLearnDB_v1', JSON.stringify(j.state)); });
    await page.goto(url + '/app.html#/manage/course/C1?tab=content');
    await page.waitForFunction(() => typeof App !== 'undefined' && !!App.user, null, { timeout: 15000 }); await page.evaluate(() => SDCCloud.ready);
    await page.locator('[data-view="S2"]').first().click();
    await page.getByText('QA Group sales by region').first().waitFor();
    await page.keyboard.press('Escape');
    await page.locator('[data-view="S1"]').first().click();
    await page.getByText('1 proposal waiting', { exact: false }).waitFor();
    await page.locator('[data-review-prop]').first().click();
    await page.getByText('ChatGPT via MCP', { exact: false }).first().waitFor();
    await page.locator('input[name="d-objectives"][value="use"]').check();
    await page.locator('[data-apply]').click();
    await page.getByRole('button', { name: 'Apply 1 field', exact: true }).last().click();
    await page.getByText('Applied 1 field', { exact: false }).first().waitFor();
    await page.evaluate(() => SDCCloud.flushNow());
    const s = await stored(), S1 = s.sessions.find(x => x.id === 'S1');
    assert.deepEqual([S1.content.objectives[0], !!S1.content.meta.approved, (S1.content.meta.repairs?.pending || []).length, S1.content.meta.history[0].kind], ['QA Load a CSV file with pandas', false, 0, 'repair'], 'accepted in the LMS, saved on the server');
    assert.equal(s.courses[0].status, 'draft', 'nothing was published');

    // 3. MCP reads what was accepted in the LMS.
    const back = await tool('get_session_content', { sessionId: 'S1', part: 'lesson' });
    assert.deepEqual([back.fields.objectives[0], back.pendingProposals.length, back.state.approved], ['QA Load a CSV file with pandas', 0, false]);
    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log('PASS MCP + Course Builder browser: MCP-applied practice shown in the LMS; MCP proposal compared and accepted in the Course Builder review window (approval withdrawn, history kept, nothing published); MCP reads the accepted text.');
    console.log('Isolated database: ' + dbName + '; blocked external browser requests: ' + blocked.length);
  } catch (e) {
    // What the page showed when a step failed.
    if (page) console.error('Page at failure: ' + page.url() + '\n' + (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 1500));
    throw e;
  } finally {
    if (browser) await browser.close(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } if (rest) { rest.server.closeAllConnections(); await rest.close(); }
    if (made) { await pg.dropDb(dbName); console.log('Removed this run\'s disposable database: ' + dbName); }
    global.fetch = actualFetch;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
