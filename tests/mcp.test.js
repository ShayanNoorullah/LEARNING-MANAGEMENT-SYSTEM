// Course Builder MCP connector (backend/mcp-api.js) over HTTP on 127.0.0.1, through the real state gateway:
// OAuth sign-in, the MCP protocol, every tool, LMS permissions, proposals, approval, stale and concurrent
// writes. Dummy data on the in-memory database stand-in (npm test) or, with --pg, a new disposable local
// PostgreSQL database that is removed afterwards. Every non-loopback HTTP request fails the test.
const assert = require('assert'), crypto = require('crypto'), fs = require('fs'), path = require('path'), vm = require('vm');
const express = require('express'), { createRestServer } = require('../scripts/localdb/rest.js');
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SDC_ALLOW_LIVE', 'VERCEL', 'NODE_ENV', 'PUBLIC_URL', 'SDC_MCP', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'AZURE_OPENAI_API_KEY']) delete process.env[k];
const loopback = u => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(u).hostname);
const realFetch = global.fetch, outside = [];
global.fetch = (u, ...a) => { if (!loopback(String(u))) { outside.push(String(u)); throw Error('Blocked external HTTP: ' + u); } return realFetch(u, ...a); };
const clone = v => JSON.parse(JSON.stringify(v)), b64 = buf => buf.toString('base64url');
const PG = process.argv.includes('--pg');

(async () => {
  let pg, dbName, made = false, rest, srv;
  try {
    const secret = crypto.randomBytes(16).toString('hex');
    let call, seedRow, readRow;
    if (PG) {
      pg = require('../scripts/localdb/pg.js');
      assert.ok(pg.available() && pg.up(), 'needs the local PostgreSQL cluster (never starts or resets sdc_dev)');
      dbName = 'sdc_test_mcp_' + crypto.randomBytes(6).toString('hex');
      await pg.createDb(dbName); made = true; await pg.apply(dbName, pg.MIGRATIONS()); await pg.setSecret(dbName, secret);
      call = (fn, a) => pg.callFn(dbName, fn, a);
      seedRow = async st => { const cur = await call('sdc_state_get', { p_secret: secret }); return call('sdc_state_put_if', { p_secret: secret, p_state: st, p_expected: cur ? cur.updated_at : null }); };
      readRow = async () => (await call('sdc_state_get', { p_secret: secret })).state;
    } else {
      const fake = require('./support/fake-db.js').fakeBackend(); await fake.setSecret(secret);
      call = fake.call; seedRow = fake.seed; readRow = async () => (await fake.row()).state;
    }
    rest = await createRestServer(call);
    Object.assign(process.env, { SUPABASE_URL: rest.url, SUPABASE_ANON_KEY: 'local-test-anon', SDC_STATE_SECRET: secret, SDC_MCP: '1' });
    const stateApi = require('../backend/state-api.js'), mcpApi = require('../backend/mcp-api.js'), CCL = require('../js/coursecontent-logic.js');
    assert.ok(mcpApi._test.ON, 'connector on (SDC_MCP=1 and gateway configured)');
    const app = express(); app.use(stateApi); app.use(mcpApi);
    srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const BASE = 'http://127.0.0.1:' + srv.address().port;
    const http = async (method, p, { json, form, token, redirect = 'manual' } = {}) => {
      const r = await realFetch(BASE + p, { method, redirect, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : undefined });
      const text = await r.text(); let body; try { body = JSON.parse(text); } catch (e) { body = text; }
      return { status: r.status, headers: r.headers, body };
    };

    // Dummy LMS: T teaches C1 (batch B1); T2 teaches the draft C2; A is the coordinator; L a learner.
    const SEED = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'seed.js'), 'utf8') + ';SEED', {});
    const user = (id, role) => { const salt = 's' + id; return { id, role, name: 'User ' + id, email: id.toLowerCase() + '@test.local', status: 'Active', salt, passwordHash: stateApi._test.hashPassword('Test@123', salt) }; };
    const S1 = { objectives: ['Read a CSV file', 'Describe a data frame'], prerequisites: ['Python basics'], timePlan: [{ minutes: 60, activity: 'Talk' }, { minutes: 60, activity: 'Lab' }],
      lesson: [{ heading: 'Loading data', body: 'Use pandas.', example: 'df = pd.read_csv("a.csv")' }, { heading: 'Looking at data', body: 'head() and info().' }, { heading: 'Saving', body: 'to_csv().' }],
      codeExamples: [{ title: 'Broken print', language: 'python', code: 'print("hello"\n', explanation: 'Prints.' }],
      meta: { approved: true, parts: { lesson: { at: '2026-10-01T10:00:00Z', provider: 'gemini', model: 'm' }, practice: { at: '2026-10-01T10:01:00Z', provider: 'gemini', model: 'm' } } } };
    const seedState = () => ({ schema: 4, roles: clone(SEED.roles), users: [user('A', 'admin'), user('T', 'teacher'), user('T2', 'teacher'), user('L', 'student')],
      courses: [{ id: 'C1', title: 'Python Data Analysis', code: 'PDA-1', slug: 'pda', status: 'published', level: 'Beginner', description: 'Analyse data with Python.', outcomes: ['Load data', 'Summarise data'], modules: [{ name: 'Basics' }, { name: 'Next' }], aiMeta: { coverage: [[1], [2]] } },
        { id: 'C2', title: 'Web Secret Draft', slug: 'web', status: 'draft', outcomes: [], modules: [] }],
      sessions: [{ id: 'S1', courseId: 'C1', title: 'Intro to pandas', moduleName: 'Basics', summary: 'Load and inspect data', duration: '2h', order: 1, content: clone(S1) },
        { id: 'S2', courseId: 'C1', title: 'Grouping', moduleName: 'Basics', summary: 'groupby', duration: '2h', order: 2 }, { id: 'S3', courseId: 'C2', title: 'Secret HTML lesson', order: 1 }],
      batches: [{ id: 'B1', courseId: 'C1', name: 'PDA-1', instructorId: 'T', status: 'Active' }, { id: 'B2', courseId: 'C2', name: 'WEB-1', instructorId: 'T2', status: 'Active' }],
      enrollments: [{ id: 'E1', learnerId: 'L', courseId: 'C1', batchId: 'B1', status: 'Active' }], settings: { features: { courseGen: true }, lms: { deliveryModes: 'online:Online' } } });
    await seedRow(seedState());

    /* --- protocol and OAuth --- */
    let r = await http('POST', '/mcp', { json: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
    assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate'), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
    const prm = (await http('GET', '/.well-known/oauth-protected-resource')).body, asm = (await http('GET', '/.well-known/oauth-authorization-server')).body;
    assert.deepEqual([prm.resource, prm.authorization_servers], [BASE + '/mcp', [BASE]]);
    assert.deepEqual([asm.issuer, asm.code_challenge_methods_supported, asm.token_endpoint_auth_methods_supported, asm.registration_endpoint], [BASE, ['S256'], ['none'], BASE + '/oauth/register']);
    for (const bad of ['http://evil.example/cb', 'https://evil.example/cb', 'https://claude.ai.evil.example/cb'])
      assert.equal((await http('POST', '/oauth/register', { json: { redirect_uris: [bad] } })).status, 400, bad + ': only Claude, ChatGPT or this computer as return address');
    assert.equal((await http('POST', '/oauth/register', { json: { redirect_uris: ['http://localhost:33418/callback'] } })).status, 201, 'a client on this computer (Claude Code)');
    const CB = 'https://claude.ai/api/mcp/auth_callback', reg = await http('POST', '/oauth/register', { json: { redirect_uris: [CB], client_name: 'Claude' } });
    assert.equal(reg.status, 201); const clientId = reg.body.client_id;
    const verifier = b64(crypto.randomBytes(32)), challenge = b64(crypto.createHash('sha256').update(verifier).digest());
    const q = { response_type: 'code', client_id: clientId, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'course-builder', resource: BASE + '/mcp' };
    r = await http('GET', '/oauth/authorize?' + new URLSearchParams(q));
    assert.equal(r.status, 200); assert.match(r.body, /<b>Claude<\/b> \(claude\.ai\)/); assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal((await http('GET', '/oauth/authorize?' + new URLSearchParams({ ...q, redirect_uri: 'https://evil.example/cb' }))).status, 400, 'unregistered redirect refused, not followed');
    r = await http('GET', '/oauth/authorize?' + new URLSearchParams({ ...q, code_challenge_method: 'plain' }));
    assert.match(r.headers.get('location'), /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?error=invalid_request&state=xyz$/, 'PKCE S256 required');
    const signIn = (email, password = 'Test@123', extra = {}) => http('POST', '/oauth/authorize', { form: { ...q, ...extra, email, password } });
    assert.equal((await signIn('t@test.local', 'wrong')).status, 401);
    r = await signIn('l@test.local'); assert.equal(r.status, 403); assert.match(r.body, /cannot use the Course Builder/, 'a learner cannot connect');
    const tokenFor = async email => {
      const loc = new URL((await signIn(email)).headers.get('location'));
      assert.deepEqual([loc.origin + loc.pathname, loc.searchParams.get('state'), loc.searchParams.get('iss')], [CB, 'xyz', BASE]);
      const code = loc.searchParams.get('code');
      assert.equal((await http('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code, redirect_uri: CB, client_id: clientId, code_verifier: 'x'.repeat(43) } })).status, 400, 'wrong PKCE verifier');
      const t = await http('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code, redirect_uri: CB, client_id: clientId, code_verifier: verifier } });
      assert.equal(t.status, 200, JSON.stringify(t.body)); assert.equal(t.body.token_type, 'Bearer');
      assert.equal((await http('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code, redirect_uri: CB, client_id: clientId, code_verifier: verifier } })).status, 400, 'a code works once');
      return t.body;
    };
    const tT = await tokenFor('t@test.local'), tA = await tokenFor('a@test.local');
    const refreshed = await http('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: tT.refresh_token, client_id: clientId } });
    assert.equal(refreshed.status, 200); assert.ok(refreshed.body.access_token);
    let id = 10;
    const rpc = (token, method, params) => http('POST', '/mcp', { token, json: { jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) } });
    const lms = await http('POST', '/api/sdc/login', { json: { email: 't@test.local', password: 'Test@123' } });
    assert.equal((await rpc(lms.body.token, 'tools/list')).status, 401, 'an LMS browser session token is not an MCP token');
    assert.equal((await rpc(require('jsonwebtoken').sign({ typ: 'access', uid: 'A', aud: BASE + '/mcp' }, 'another-key'), 'tools/list')).status, 401, 'forged token refused');
    r = await rpc(tT.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.deepEqual([r.body.result.protocolVersion, r.body.result.serverInfo.name, !!r.body.result.capabilities.tools], ['2025-06-18', 'sdc-learn-course-builder', true]);
    assert.equal((await rpc(tT.access_token, 'initialize', { protocolVersion: '2024-11-05' })).body.result.protocolVersion, '2024-11-05');
    assert.equal((await http('POST', '/mcp', { token: tT.access_token, json: { jsonrpc: '2.0', method: 'notifications/initialized' } })).status, 202, 'notifications get no answer');
    assert.equal((await rpc(tT.access_token, 'resources/list')).body.error.code, -32601);
    assert.equal((await http('GET', '/mcp', { token: tT.access_token })).status, 405);
    const tools = (await rpc(refreshed.body.access_token, 'tools/list')).body.result.tools;
    assert.deepEqual(tools.map(t => t.name), ['list_courses', 'search', 'fetch', 'get_course_outline', 'get_session_content', 'get_generation_status', 'get_generation_brief', 'run_course_check',
      'propose_session_changes', 'review_proposal', 'apply_proposal', 'reject_proposal', 'create_draft_course', 'update_course_outline']);
    assert.ok(tools.every(t => t.inputSchema.type === 'object' && typeof t.description === 'string' && typeof t.annotations.readOnlyHint === 'boolean'));
    const use = async (token, name, args) => { const x = await rpc(token, 'tools/call', { name, arguments: args }); assert.equal(x.status, 200); const res = x.body.result; return { error: res.isError ? res.content[0].text : '', out: res.isError ? null : JSON.parse(res.content[0].text) }; };
    const T = (name, args) => use(tT.access_token, name, args), A = (name, args) => use(tA.access_token, name, args);
    const ok = async (p, why) => { const x = await p; assert.ok(!x.error, why + ': ' + x.error); return x.out; };

    /* --- reading: only the courses the role may edit --- */
    let out = await ok(T('list_courses', {}), 'list');
    assert.deepEqual(out.courses.map(c => [c.id, c.sessions, c.sessionsApproved]), [['C1', 2, 1]], 'the instructor sees only the course they teach');
    assert.deepEqual((await ok(A('list_courses', { limit: 1 }), 'admin list')).nextCursor, '1', 'paginated');
    for (const [name, args] of [['get_course_outline', { courseId: 'C2' }], ['get_session_content', { sessionId: 'S3' }], ['fetch', { id: 'course:C2' }], ['run_course_check', { courseId: 'C2' }], ['propose_session_changes', { sessionId: 'S3', part: 'lesson', fields: { objectives: ['x'] } }]])
      assert.match((await T(name, args)).error, /not (one of the courses|in a course) you can edit/, name + ': another instructor\'s course is refused');
    assert.ok(!/Web Secret|Secret HTML/.test(JSON.stringify((await ok(T('search', { query: 'secret' }), 'search')).results)), 'search never returns other courses');
    const outline = await ok(T('get_course_outline', { courseId: 'C1' }), 'outline');
    assert.deepEqual([outline.sessions.map(s => s.id), outline.totals.sessions, outline.sessions[0].content.codeErrors > 0], [['S1', 'S2'], 2, true]);
    assert.equal((await ok(T('get_course_outline', { courseId: 'C1', limit: 1 }), 'page')).nextOffset, 1);
    assert.deepEqual((await ok(T('search', { query: 'pandas' }), 'search')).results.map(x => x.id), ['session:S1']);
    assert.match((await ok(T('fetch', { id: 'session:S1' }), 'fetch')).text, /Read a CSV file/);
    const sc = await ok(T('get_session_content', { sessionId: 'S1', part: 'lesson' }), 'content');
    assert.deepEqual([Object.keys(sc.fields).sort(), sc.state.approved, sc.stamp], [['lesson', 'objectives', 'prerequisites', 'timePlan'], true, CCL.fieldHash(S1)]);
    const st = await ok(T('get_generation_status', { courseId: 'C1' }), 'status');
    assert.deepEqual(st.todo.map(x => x.sessionId + ':' + x.part), ['S1:assess', 'S2:lesson', 'S2:practice', 'S2:assess'], 'what is left to resume');
    const brief = await ok(T('get_generation_brief', { sessionId: 'S2', part: 'lesson' }), 'brief');
    assert.ok(brief.system.includes('JSON shape') && brief.prompt.includes('THIS SESSION: number 2 of 2'), 'the in-app writing brief');
    assert.match((await ok(T('get_generation_brief', { sessionId: 'S1', part: 'practice', fields: ['codeExamples'] }), 'repair brief')).system, /REPAIR/);
    const check = await ok(T('run_course_check', { courseId: 'C1' }), 'course check');
    assert.ok(check.codeProblems.some(x => x.sessionId === 'S1') && check.sessionIssues.length && check.review.material.includes('Intro to pandas') && check.review.pages === 1, 'checks and review material');
    assert.deepEqual(outside, [], 'no AI provider or other outside service was called');

    /* --- proposals: nothing changes until a person accepts --- */
    const row = async () => { const s = await readRow(); return { s, S1: s.sessions.find(x => x.id === 'S1'), S2: s.sessions.find(x => x.id === 'S2') }; };
    const before = (await row()).S1;
    assert.match((await T('propose_session_changes', { sessionId: 'S1', part: 'lesson', fields: { codeExamples: [] } })).error, /Not in it: codeExamples/);
    assert.match((await T('propose_session_changes', { sessionId: 'S1', part: 'lesson', fields: { objectives: ['x', 'y'] }, basedOn: 'old' })).error, /changed since you read it/);
    const prop = await ok(T('propose_session_changes', { sessionId: 'S1', part: 'lesson', fields: { objectives: ['Load a CSV file with pandas', 'Inspect a data frame with head() and info()'] }, basedOn: sc.stamp, reason: 'Objectives must name the tools.', assistant: 'Claude' }), 'propose');
    assert.deepEqual(prop.comparison.map(c => [c.field, c.change]), [['objectives', 'changed']]);
    let now = await row();
    assert.deepEqual([now.S1.content.objectives, now.S1.content.meta.approved, CCL.pendingOf(now.S1.content).length, CCL.pendingOf(now.S1.content)[0].provider], [S1.objectives, true, 1, 'Claude via MCP'], 'text and approval unchanged; one proposal waiting');
    assert.match((await ok(T('review_proposal', { sessionId: 'S1' }), 'review')).comparison[0].after, /Load a CSV file with pandas/);
    out = await ok(T('apply_proposal', { sessionId: 'S1', proposalId: prop.proposalId }), 'preview');
    assert.equal(out.saved, false); assert.deepEqual((await row()).S1, now.S1, 'without approved: true nothing is saved');
    // Someone edits the same field in the LMS meanwhile (an ordinary whole-state save): it is not overwritten.
    const lmsA = await http('POST', '/api/sdc/login', { json: { email: 'a@test.local', password: 'Test@123' } }), mine = clone(lmsA.body.state);
    mine.sessions.find(x => x.id === 'S1').content.objectives = ['Edited in the LMS', 'Second'];
    assert.equal((await http('PUT', '/api/sdc/state', { token: lmsA.body.token, json: { state: mine } })).status, 200);
    assert.match((await T('apply_proposal', { sessionId: 'S1', proposalId: prop.proposalId, approved: true })).error, /Nothing was applied\. Skipped: objectives \(changed since the proposal\)/);
    assert.deepEqual((await row()).S1.content.objectives, ['Edited in the LMS', 'Second'], 'the newer LMS edit is kept');
    out = await ok(T('apply_proposal', { sessionId: 'S1', proposalId: prop.proposalId, approved: true, replaceChanged: ['objectives'] }), 'apply');
    assert.deepEqual([out.applied, out.approvalWithdrawn], [['objectives'], true]);
    now = await row();
    assert.deepEqual([now.S1.content.objectives[0], !!now.S1.content.meta.approved, CCL.pendingOf(now.S1.content).length, now.S1.content.meta.history[0].kind, now.S1.content.meta.history[0].applied[0].before],
      ['Load a CSV file with pandas', false, 0, 'repair', ['Edited in the LMS', 'Second']], 'applied with history (restorable); approval withdrawn; lesson part kept');
    assert.deepEqual(now.S1.content.lesson, S1.lesson);
    assert.match((await T('apply_proposal', { sessionId: 'S1', proposalId: prop.proposalId, approved: true })).error, /no longer waiting/, 'applying twice does nothing');
    // A new part for S2 written by the assistant, and a second one rejected; two proposals at once are both kept.
    const lessonPart = { objectives: ['Group rows with groupby', 'Aggregate columns'], prerequisites: ['Session 1'], timePlan: [{ minutes: 60, activity: 'Talk' }, { minutes: 60, activity: 'Lab' }],
      lesson: [{ heading: 'groupby', body: 'Split, apply, combine.' }, { heading: 'agg', body: 'Several functions.' }, { heading: 'Pivot', body: 'pivot_table.' }] };
    const [p1, p2] = await Promise.all([T('propose_session_changes', { sessionId: 'S2', part: 'lesson', fields: lessonPart, assistant: 'ChatGPT' }),
      T('propose_session_changes', { sessionId: 'S2', part: 'assess', fields: { teacherNotes: ['Watch the time.'] }, assistant: 'ChatGPT' })]);
    assert.ok(!p1.error && !p2.error, p1.error + p2.error);
    now = await row();
    assert.deepEqual(CCL.pendingOf(now.S2.content).map(p => p.part).sort(), ['assess', 'lesson'], 'simultaneous proposals: neither lost');
    assert.equal(CCL.sessionState(now.S2).status, 'none', 'still no lesson text until accepted');
    await ok(T('reject_proposal', { sessionId: 'S2', proposalId: p2.out.proposalId }), 'reject');
    now = await row();
    assert.deepEqual([CCL.pendingOf(now.S2.content).map(p => p.part), now.S2.content.meta.history[0].kind], [['lesson'], 'rejected']);

    /* --- outline changes: preview, stale refusal, approved save --- */
    const ol = await ok(T('get_course_outline', { courseId: 'C1' }), 'outline again');
    const change = { courseId: 'C1', basedOn: ol.stamp, course: { description: 'Analyse real data with pandas.', outcomes: ['Load data', 'Summarise data', 'Visualise data'] }, sessions: [{ id: 'S1', title: 'Loading data with pandas' }] };
    out = await ok(T('update_course_outline', change), 'outline preview');
    assert.deepEqual([out.saved, out.changes.map(c => c.target + '.' + c.field)], [false, ['course.description', 'course.outcomes', 'S1.title']]);
    assert.equal((await row()).s.courses[0].description, 'Analyse data with Python.', 'preview saves nothing');
    assert.match((await T('update_course_outline', { ...change, basedOn: 'stale', approved: true })).error, /outline changed since you read it/);
    assert.match((await T('update_course_outline', { ...change, course: { outcomes: ['Load data'] }, approved: true })).error, /remove or reorder outcomes in the LMS/);
    await ok(T('update_course_outline', { ...change, approved: true }), 'outline save');
    now = await row();
    assert.deepEqual([now.s.courses[0].description, now.s.courses[0].outcomes.length, now.s.courses[0].status, now.S1.title, now.S1.content.meta.outdated], ['Analyse real data with pandas.', 3, 'published', 'Loading data with pandas', ['lesson', 'practice']],
      'saved; never (un)published; the written parts of the renamed session are out of date');

    /* --- new draft courses: coordinator only, preview first, one course per genId --- */
    const draft = { title: 'Excel for Analysts', outcomes: ['Build formulas', 'Make charts'], modules: [{ name: 'Formulas', sessions: [{ title: 'Cells and ranges', outcomes: [1] }, { title: 'Lookups' }] }, { name: 'Charts', sessions: [{ title: 'Charts', outcomes: [2] }] }] };
    assert.match((await T('create_draft_course', { outline: draft, approved: true })).error, /cannot create courses/, 'the instructor role has no courses:create');
    assert.match((await A('create_draft_course', { outline: { ...draft, modules: Array.from({ length: 13 }, (_, i) => ({ name: 'M' + i, sessions: [{ title: 'x' }] })) } })).error, /at most 12/);
    const pre = await ok(A('create_draft_course', { outline: draft }), 'draft preview');
    assert.deepEqual([pre.saved, pre.preview.sessions], [false, 3]);
    const made2 = await Promise.all([A('create_draft_course', { outline: draft, genId: pre.genId, approved: true, assistant: 'Claude' }), A('create_draft_course', { outline: draft, genId: pre.genId, approved: true })]);
    assert.ok(made2.every(x => !x.error), made2.map(x => x.error).join());
    now = await row();
    const c = now.s.courses.filter(x => x.aiMeta?.genId === pre.genId);
    assert.deepEqual([c.length, c[0].status, now.s.sessions.filter(s => s.courseId === c[0].id).length, made2.filter(x => x.out.alreadyExisted).length, c[0].aiMeta.provider], [1, 'draft', 3, 1, 'Claude via MCP'], 'one draft course, never published');
    await A('list_courses', {});

    /* --- the account is checked on every call --- */
    { const s = await readRow(); s.users.find(u => u.id === 'T').status = 'Inactive'; await seedRow(s); }
    assert.match((await T('list_courses', {})).error, /not active/, 'a deactivated account loses access at once');
    assert.deepEqual(outside, [], 'still no outside request');
    console.log(`mcp.test.js: OAuth, protocol, 14 tools, permissions, proposals, approval, stale and concurrent writes passed (${PG ? 'local PostgreSQL ' + dbName : 'in-memory database'})`);
  } finally {
    if (srv) { srv.closeAllConnections(); await new Promise(r => srv.close(r)); }
    if (rest) { rest.server.closeAllConnections(); await rest.close(); }
    if (made) { await pg.dropDb(dbName); console.log('Removed this run\'s disposable database: ' + dbName); }
    global.fetch = realFetch;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
