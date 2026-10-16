/* AI course generation (Release 1): the pure rules (js/coursegen-logic.js), the retry rules, the AI
   connection additions (JSON mode, stop reason, answer-size cap, deadline, error codes, demo mode)
   and the draft records. Providers are stubbed: nothing here reaches the network. Run: npm test */
const assert = require('assert'), path = require('path'), http = require('http'), express = require('express');

// Test-only settings, set before the modules read them. VERCEL points the AI files at the temp dir
// while loading, and is removed again so demo mode (developer machines only) can be tested.
process.env.SDC_AI_SECRETS_KEY = 'test-only-ai-secrets-key';
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SDC_ALLOW_LIVE', 'NODE_ENV', 'SDC_AI_MOCK', 'SDC_AI_LOCAL_OPEN']) delete process.env[k];
process.env.VERCEL = '1';
const CG = require('../js/coursegen-logic.js');
const ai = require('../backend/ai-api.js');
delete process.env.VERCEL;
const clone = v => JSON.parse(JSON.stringify(v));

const BRIEF = { topic: 'Power BI for finance teams', audience: 'Accountants who know Excel', level: 'Beginner', programType: 'Short Course', delivery: 'Online', weeks: 6, perWeek: 2, hours: 2, tools: 'Power BI Desktop' };
const answer = (sessions = 12, over = {}) => {
  const mods = Math.ceil(sessions / 4), per = Math.floor(sessions / mods), extra = sessions % mods;
  let k = 0;
  return { title: 'Power BI for Finance', tagline: 'Dashboards that finance can trust', description: 'A practical course.', prerequisites: 'Excel basics', code: 'pbi-101', icon: 'chart',
    outcomes: ['Build a data model', 'Analyse variances', 'Configure refresh', 'Present a dashboard'],
    modules: Array.from({ length: mods }, (_, i) => ({ name: `Module ${i + 1}: Topic ${i + 1}`, summary: 'Summary', sessions: Array.from({ length: per + (i < extra ? 1 : 0) }, () => { k++; return { title: `Session ${k}: Lesson ${k}`, summary: 'One line', outcomes: [1 + (k % 4)] }; }) })), ...over };
};
const reply = (o, extra = {}) => ({ text: JSON.stringify(o), provider: 'openai', model: 'gpt-4o-mini', tokens: 900, truncated: false, ...extra });
const fail = (code, message = code, status) => Object.assign(new Error(message), { code, status });

(async () => {
  /* ---------------------------------------------------------------- the brief */
  assert.equal(CG.briefCheck(BRIEF).ok, true);
  assert.deepEqual([CG.briefCheck(BRIEF).sessions, CG.briefCheck(BRIEF).hours], [12, 24], 'live totals');
  assert.equal(CG.briefCheck({ ...BRIEF, weeks: 24, perWeek: 2 }).ok, true, '48 sessions is allowed');
  const over = CG.briefCheck({ ...BRIEF, weeks: 25, perWeek: 2 });
  assert.equal(over.ok, false); assert.match(over.errors.weeks, /50 sessions.*at most 48/);
  assert.equal(CG.briefCheck({ ...BRIEF, source: 'x'.repeat(12000) }).ok, true);
  assert.match(CG.briefCheck({ ...BRIEF, source: 'x'.repeat(12001) }).errors.source, /12,000.*never cut/, 'over the source limit is refused, not cut');
  for (const [k, v] of [['topic', ''], ['audience', '  '], ['level', ''], ['weeks', 0], ['weeks', 1.5], ['perWeek', 8], ['hours', 0], ['hours', 9]]) assert.ok(CG.briefCheck({ ...BRIEF, [k]: v }).errors[k], `${k}=${v} is refused`);
  assert.equal(CG.tokenBudget(48), 6780); assert.equal(CG.tokenBudget(1), 1610); assert.ok(CG.tokenBudget(10000) <= 8000, 'never above the cap');

  /* ---------------------------------------------------- reading the answer */
  assert.equal(CG.parseAnswer('{"a":1}').value.a, 1);
  assert.equal(CG.parseAnswer('```json\n{"a":1}\n```').value.a, 1, 'code fences are fixed quietly');
  assert.equal(CG.parseAnswer('Here is the outline:\n{"a":1}\nHope it helps').value.a, 1, 'text around the object is fixed quietly');
  for (const bad of ['', '   ', 'no json here', '{"a":', '[1,2]', '"text"']) assert.ok(CG.parseAnswer(bad).error, `refused: ${JSON.stringify(bad)}`);

  /* ------------------------------------------------ fix / mark / refuse */
  const n = CG.normalize({ ...answer(12), unknownField: 'x', modules: [{ name: 'Module 1: Intro | basics\nand more', summary: ' s ', extra: 1, sessions: [{ title: 'Session 1: Start', summary: 'a', outcomes: ['1', 2, 'x'] }] }] });
  assert.ok(!n.error, n.error);
  assert.equal(n.outline.modules[0].name, 'Intro - basics and more', 'numbering, "|" and line breaks fixed; meaning kept');
  assert.equal(n.outline.modules[0].sessions[0].title, 'Start');
  assert.deepEqual(n.outline.modules[0].sessions[0].refs, [1, 2], 'outcome numbers read, junk dropped');
  assert.equal(n.outline.unknownField, undefined, 'unknown fields dropped');
  assert.equal(CG.normalize({ ...answer(4), icon: 'not-an-icon' }).outline.icon, 'book', 'icon outside the list is fixed');
  assert.equal(CG.normalize(answer(4)).outline.code, 'PBI-101');
  const longTitle = 'L'.repeat(500);
  const kept = CG.normalize({ ...answer(4), description: 'D'.repeat(5000), modules: [{ name: 'M', sessions: [{ title: longTitle }] }] });
  assert.equal(kept.outline.description.length, 5000, 'long text is kept whole, never cut');
  assert.equal(kept.outline.modules[0].sessions[0].title.length, 500);
  const marks = CG.check(kept.outline, { expected: 1 });
  assert.ok(marks.some(m => m.code === 'long' && m.block && m.path === 'description'), 'and marked, blocking the save');
  // refuse
  for (const [label, o] of [['no title', { ...answer(4), title: ' ' }], ['no modules', { ...answer(4), modules: [] }], ['no outcomes', { ...answer(4), outcomes: [] }],
    ['13 modules', { ...answer(4), modules: Array.from({ length: 13 }, (_, i) => ({ name: 'M' + i, sessions: [{ title: 'S' }] })) }],
    ['49 sessions', { ...answer(4), modules: [{ name: 'M', sessions: Array.from({ length: 49 }, (_, i) => ({ title: 'S' + i })) }] }],
    ['module without name', { ...answer(4), modules: [{ sessions: [{ title: 'S' }] }] }], ['session without title', { ...answer(4), modules: [{ name: 'M', sessions: [{ summary: 'x' }] }] }],
    ['module without sessions list', { ...answer(4), modules: [{ name: 'M' }] }], ['no sessions at all', { ...answer(4), modules: [{ name: 'M', sessions: [] }] }]])
    assert.ok(CG.normalize(o).error, `refused: ${label}`);

  // marks (never rewritten, and they follow the edits)
  const o = CG.normalize(answer(12)).outline;
  assert.deepEqual(CG.check(o, { expected: 12, takenSlugs: [] }).filter(m => m.level === 'warn'), [], 'a good outline has no warnings');
  o.outcomes[1] = 'Understand variances';
  assert.ok(CG.check(o, { expected: 12 }).some(m => m.code === 'weak' && m.path === 'outcomes.1'), 'weak outcome marked, not rewritten');
  assert.equal(o.outcomes[1], 'Understand variances');
  o.modules[0].sessions[0].refs = [9]; o.modules[0].sessions[1].refs = [];
  const m2 = CG.check(o, { expected: 12 });
  assert.ok(m2.some(m => m.code === 'badRef') && m2.some(m => m.code === 'noOutcome'), 'outcome number that does not exist; session with no outcome');
  o.modules[1].name = o.modules[0].name;
  assert.ok(CG.check(o, { expected: 12 }).some(m => m.code === 'dupModule'));
  assert.ok(CG.check(o, { expected: 14 }).find(m => m.code === 'count').message.includes('2 missing'));
  assert.ok(CG.check(o, { expected: 10 }).find(m => m.code === 'count').message.includes('2 extra'));
  assert.ok(CG.check(o, { expected: 12, takenSlugs: [CG.slugify(o.title)] }).some(m => m.code === 'slug' && m.block), 'a name already in use is reported, and blocks');
  const e = clone(o); e.modules[0].sessions[0].title = ''; e.modules.push({ name: '', summary: '', sessions: [] });
  assert.equal(CG.check(e, {}).filter(m => m.block && m.code === 'empty').length, 2);
  const unc = CG.normalize(answer(4)).outline; unc.outcomes.push('Defend a design');
  assert.ok(CG.check(unc, { expected: 4 }).some(m => m.code === 'uncovered' && m.path === 'outcomes.4'), 'an outcome with no session');

  /* ------------------------------------------------------ editing helpers */
  const ed = CG.normalize({ ...answer(4), outcomes: ['Build A', 'Analyse B', 'Configure C'], modules: [{ name: 'M1', sessions: [{ title: 'a', outcomes: [1] }, { title: 'b', outcomes: [2, 3] }] }, { name: 'M2', sessions: [{ title: 'c', outcomes: [3] }] }] }).outline;
  CG.removeOutcome(ed, 0);
  assert.deepEqual(ed.outcomes, ['Analyse B', 'Configure C']);
  assert.deepEqual(ed.modules.map(m => m.sessions.map(s => s.refs)), [[[], [1, 2]], [[2]]], 'links follow the outcomes they point to');
  CG.moveOutcome(ed, 0, 1);
  assert.deepEqual(ed.outcomes, ['Configure C', 'Analyse B']);
  assert.deepEqual(ed.modules[0].sessions[1].refs, [2, 1]);
  CG.moveSession(ed, 1, 0, -1); // up from the first session of module 2: to the end of module 1
  assert.deepEqual(ed.modules.map(m => m.sessions.map(s => s.title)), [['a', 'b', 'c'], []]);
  CG.moveSession(ed, 0, 2, 1); // down from the last session: first of the next module
  assert.deepEqual(ed.modules.map(m => m.sessions.map(s => s.title)), [['a', 'b'], ['c']]);
  assert.equal(CG.moveModule(ed, 0, -1), false); assert.equal(CG.moveModule(ed, 0, 1), true); assert.equal(ed.modules[0].name, 'M2');
  assert.equal(CG.countSessions(ed), 3, 'moving never adds or removes a session');

  /* ----------------------------------------------- generate + retry rules */
  const run = async script => { const calls = []; const r = await CG.generate(async o => { calls.push(o); const step = script[Math.min(calls.length, script.length) - 1]; if (step instanceof Error) throw step; return typeof step === 'function' ? step(o) : step; }, BRIEF, { existingTitles: ['Excel'] }, { sleep: async () => {} }); return { r, calls }; };
  let g = await run([reply(answer(12))]);
  assert.equal(g.r.ok, true); assert.equal(g.calls.length, 1, 'a good answer needs one request');
  assert.equal(g.calls[0].json, true); assert.equal(g.calls[0].maxTokens, CG.tokenBudget(12));
  assert.match(g.calls[0].system, /Exactly 12 sessions/); assert.match(g.calls[0].prompt, /Course topic: Power BI for finance teams/);
  assert.match(g.calls[0].prompt, /Existing SDC courses.*Excel/); assert.match(g.calls[0].system, /SDC\) Karachi.*job-focused/s);
  assert.ok(!/startDate|class days/i.test(g.calls[0].prompt), 'dates and class days are never sent to the AI');
  assert.deepEqual([g.r.meta.provider, g.r.meta.model, g.r.meta.mock], ['openai', 'gpt-4o-mini', false]);
  g = await run([{ text: '{"title": "cut off', truncated: true }, reply(answer(12))]);
  assert.deepEqual([g.r.ok, g.calls.length], [true, 2], 'a cut-off answer gets one retry');
  g = await run([{ text: 'not json', truncated: false }, { text: '', truncated: false }]);
  assert.deepEqual([g.r.ok, g.r.code, g.calls.length], [false, 'invalid_json', 2], 'broken twice: an error, never saved');
  g = await run([{ text: '{"a":', truncated: true }, { text: '{"a":', truncated: true }]);
  assert.equal(g.r.code, 'truncated'); assert.match(g.r.message, /cut off/);
  g = await run([reply(answer(4, { modules: [] })), reply(answer(4, { title: '' }))]);
  assert.deepEqual([g.r.ok, g.r.code, g.calls.length], [false, 'invalid_answer', 2], 'missing required field: retry once, then an error');
  g = await run([reply(answer(14)), reply(answer(13))]);
  assert.equal(g.calls.length, 2); assert.equal(g.r.ok, true);
  assert.equal(CG.countSessions(g.r.outline), 13, 'wrong count after a retry: shown as returned, never padded or trimmed');
  g = await run([reply(answer(10)), { text: 'garbage' }]);
  assert.equal(CG.countSessions(g.r.outline), 10, 'the valid first answer is kept when the retry is broken');
  g = await run([reply(answer(12))]); assert.equal(CG.countSessions(g.r.outline), 12);
  for (const code of ['budget', 'rate_limit', 'not_configured', 'timeout', 'forbidden', 'unauthorized']) {
    g = await run([fail(code, `server says ${code}`)]);
    assert.deepEqual([g.r.ok, g.r.code, g.calls.length], [false, code, 1], `${code}: not retried`);
    assert.equal(g.r.message, `server says ${code}`, 'the existing server message is shown');
  }
  g = await run([fail('provider', 'down'), reply(answer(12))]);
  assert.deepEqual([g.r.ok, g.calls.length], [true, 2], 'a fast provider failure is retried once');
  let clock = 0; const slow = await CG.generate(async () => { clock += 20000; throw fail('provider', 'slow'); }, BRIEF, {}, { now: () => clock, sleep: async () => {} });
  assert.equal(slow.calls, 1, 'a slow failure is not repeated');
  assert.equal((await CG.generate(async () => { throw new Error('x'); }, { ...BRIEF, weeks: 30 }, {})).calls, 0, 'an over-limit brief never reaches the AI');

  /* --------------------------------------------------------- saved records */
  const outline = { ...CG.normalize(answer(12)).outline, level: 'Beginner', programType: 'short', delivery: 'online', hoursPerSession: 2 };
  const genId = '11111111-2222-3333-4444-555555555555';
  const b = CG.build({ genId, outline, userId: 'U1', ownBatch: false, now: '2026-10-15T00:00:00.000Z', meta: { provider: 'openai', model: 'gpt-4o-mini', mock: false } });
  assert.equal(b.course.status, 'draft'); assert.equal(b.course.aiGenerated, true); assert.equal(b.course.fee, 0);
  assert.deepEqual([b.course.zoom.meetingId, b.course.venue, b.course.startDate, b.course.instructorIds], ['', undefined, undefined, undefined], 'nothing the AI may not set');
  assert.equal(b.sessions.length, 12); assert.ok(b.sessions.every(s => s.courseId === b.course.id && s.duration === '2h' && s.published === true));
  assert.deepEqual(b.sessions.map(s => s.order), [...Array(12).keys()].map(i => i + 1));
  assert.deepEqual(b.course.modules.map(m => m.name), [...new Set(b.sessions.map(s => s.moduleName))], 'sessions belong to a module by its exact name');
  assert.equal(b.course.aiMeta.model, 'gpt-4o-mini'); assert.equal(b.course.aiMeta.coverage.length, 12);
  assert.equal(b.batch, null);
  assert.equal(CG.build({ genId, outline, userId: 'U1', ownBatch: true, now: 'x' }).batch.instructorId, 'U1');
  assert.deepEqual(CG.build({ genId, outline, userId: 'U1', now: 'y' }).sessions.map(s => s.id), b.sessions.map(s => s.id), 'ids come from the generation id: a retry builds the same records');
  assert.equal(CG.validate(outline), '');
  assert.match(CG.validate({ ...outline, title: 'T'.repeat(161) }), /longer than 160/);

  /* ------------------------------------------------------------ the demo outline */
  for (const n of [1, 2, 3, 6, 12, 13, 24, 47, 48]) {
    const m = CG.mockOutline(CG.buildMessages({ ...BRIEF, weeks: n, perWeek: 1 }, {}).prompt), nn = CG.normalize(JSON.parse(JSON.stringify(m)));
    assert.ok(!nn.error, `demo outline for ${n}: ${nn.error}`);
    assert.equal(CG.countSessions(nn.outline), n); assert.ok(nn.outline.modules.length <= 12);
    assert.deepEqual(CG.check(nn.outline, { expected: n }).filter(x => x.level === 'warn'), [], `demo outline for ${n} has no warnings`);
    assert.match(m.description, /DEMO SAMPLE, not written by AI/);
  }

  /* ------------------------------------------------------ the AI connection */
  const app = express(); app.use(ai);
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const realFetch = global.fetch;
  const sent = []; let provider = async () => ({ status: 200, json: { choices: [{ message: { content: '{"ok":1}' }, finish_reason: 'stop' }], usage: { total_tokens: 7 } } });
  global.fetch = async (url, opts = {}) => {
    if (String(url).startsWith(BASE)) return realFetch(url, opts);
    sent.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null, signal: opts.signal });
    const r = await provider(url, opts, sent.at(-1));
    return { ok: r.status < 400, status: r.status, json: async () => r.json };
  };
  const call = async (path, body, token) => { const r = await realFetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const token = (await call('/api/ai/auth', { userId: 'U1' })).body.token;
  assert.ok(token, 'local development mints an AI session');
  const complete = body => call('/api/ai/complete', { prompt: 'hi', provider: 'openai', ...body }, token);

  // no provider configured: a clear code, no demo unless asked for
  let r = await complete({ feature: 'courseGenerate' });
  assert.deepEqual([r.status, r.body.code], [400, 'not_configured']);
  assert.match(r.body.error, /Settings → Integrations/);
  assert.equal((await call('/api/ai/complete', { prompt: 'hi' })).body.code, 'unauthorized');

  process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
  // unchanged bodies for the other features
  r = await complete({ feature: 'tutor' });
  assert.equal(r.status, 200); assert.equal(r.body.truncated, false);
  assert.deepEqual(Object.keys(sent.at(-1).body).sort(), ['max_tokens', 'messages', 'model', 'temperature'], 'no JSON mode unless the page asks');
  assert.equal(sent.at(-1).body.max_tokens, 2048);
  // course generation: JSON mode, requested size, cap
  r = await complete({ feature: 'courseGenerate', json: true, maxTokens: 3000, temperature: 0.4 });
  assert.equal(sent.at(-1).body.response_format.type, 'json_object'); assert.equal(sent.at(-1).body.max_tokens, 3000); assert.equal(sent.at(-1).body.temperature, 0.4);
  await complete({ feature: 'courseGenerate', json: true, maxTokens: 999999 });
  assert.equal(sent.at(-1).body.max_tokens, ai._test.MAX_OUT_TOKENS, 'the answer size never goes above the cap');
  await complete({ feature: 'tutor', maxTokens: 50000 });
  assert.equal(sent.at(-1).body.max_tokens, ai._test.MAX_OUT_TOKENS, 'the cap applies to every feature');
  // stop reason reaches the page
  provider = async () => ({ status: 200, json: { choices: [{ message: { content: '{"cut' }, finish_reason: 'length' }], usage: { total_tokens: 3 } } });
  r = await complete({ feature: 'courseGenerate', json: true });
  assert.equal(r.body.truncated, true); assert.equal(r.body.text, '{"cut');
  // newer models: one corrected request, only when the provider asks for it
  let attempts = 0;
  provider = async (u, o, s) => (++attempts === 1 ? { status: 400, json: { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } } } : { status: 200, json: { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: {} } });
  const before = sent.length;
  r = await complete({ feature: 'courseGenerate', json: true, maxTokens: 1000 });
  assert.equal(r.status, 200); assert.equal(sent.length - before, 2);
  assert.equal(sent.at(-1).body.max_completion_tokens, 1000); assert.equal(sent.at(-1).body.max_tokens, undefined);
  // provider errors carry a code; the next provider is tried
  process.env.GEMINI_API_KEY = 'test-not-a-real-key';
  provider = async url => (String(url).includes('generativelanguage') ? { status: 200, json: { candidates: [{ content: { parts: [{ text: '{"g":1}' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { totalTokenCount: 5 } } } : { status: 500, json: { error: { message: 'boom' } } });
  process.env.GEMINI_MODEL = 'gemini-2.0-flash';
  r = await complete({ feature: 'courseGenerate', json: true, maxTokens: 2000, fallbackProvider: 'gemini' });
  assert.equal(r.status, 200); assert.equal(r.body.provider, 'gemini'); assert.equal(r.body.truncated, true, 'Gemini stop reason mapped');
  const gem = sent.at(-1).body;
  assert.equal(gem.generationConfig.responseMimeType, 'application/json'); assert.equal(gem.generationConfig.maxOutputTokens, 2000);
  assert.equal(gem.generationConfig.thinkingConfig, undefined, 'models without thinking get no thinking setting');
  // Gemini 2.5: thinking tokens would eat the output budget and cut the outline off
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  await complete({ feature: 'courseGenerate', json: true, maxTokens: 2000, fallbackProvider: 'gemini' });
  assert.equal(sent.at(-1).body.generationConfig.thinkingConfig.thinkingBudget, 0, '2.5 flash: no thinking for structured output');
  await complete({ feature: 'tutor', maxTokens: 2000, provider: 'gemini' });
  assert.equal(sent.at(-1).body.generationConfig.thinkingConfig, undefined, 'other features are unchanged');
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';
  await complete({ feature: 'courseGenerate', json: true, maxTokens: 2000, fallbackProvider: 'gemini' });
  assert.equal(sent.at(-1).body.generationConfig.thinkingConfig.thinkingBudget, 128); assert.equal(sent.at(-1).body.generationConfig.maxOutputTokens, 2512);
  assert.equal(sent.at(-1).body.generationConfig.temperature, 0.3, '2.5: temperature still sent');
  delete process.env.OPENAI_API_KEY; // Gemini alone, so its own errors reach the page
  // Gemini 3: thinking by level (never thinkingBudget), the lowest level the model accepts, room for the
  // thinking on top of the answer size, the model's default temperature, JSON mode unchanged
  const G = ai._test.geminiThinking;
  assert.deepEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-4-argon', 'gemini-2.5-flash', 'gemini-2.0-flash'].map(G),
    ['minimal', 'minimal', 'minimal', 'minimal', 'low', 'low', 'low', null, null]);
  provider = async () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: '{"g":3}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 25, totalTokenCount: 165 } } });
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  r = await complete({ feature: 'courseContent', json: true, maxTokens: 6000, temperature: 0.4, provider: 'gemini' });
  let gc = sent.at(-1).body.generationConfig;
  assert.deepEqual(gc.thinkingConfig, { thinkingLevel: 'low' }, '3.8 Flash rejects "minimal"');
  assert.equal(gc.maxOutputTokens, 8048); assert.equal(gc.responseMimeType, 'application/json'); assert.equal('temperature' in gc, false);
  assert.match(sent.at(-1).url, /models\/gemini-3\.8-flash:generateContent/);
  assert.deepEqual([r.body.text, r.body.tokens, r.body.model, r.body.truncated], ['{"g":3}', 165, 'gemini-3.8-flash', false]);
  assert.deepEqual(r.body.usage, { input: 100, output: 40, thinking: 25 }, 'thinking tokens reported (and counted in the total)');
  process.env.GEMINI_MODEL = 'models/gemini-3.5-flash-lite';
  r = await complete({ feature: 'tutor', provider: 'gemini' });
  gc = sent.at(-1).body.generationConfig;
  assert.deepEqual(gc.thinkingConfig, { thinkingLevel: 'minimal' }); assert.equal(gc.maxOutputTokens, 2048 + 1024);
  assert.equal(gc.responseMimeType, undefined, 'no JSON mode unless asked'); assert.equal(r.body.model, 'gemini-3.5-flash-lite');
  // a model that rejects the level: one corrected request
  attempts = 0;
  provider = async () => (++attempts === 1 ? { status: 400, json: { error: { message: 'Thinking level MINIMAL is not supported for this model.' } } } : { status: 200, json: { candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 9 } } });
  let n0 = sent.length;
  r = await complete({ feature: 'courseContent', json: true, maxTokens: 1000, provider: 'gemini' });
  assert.equal(r.status, 200); assert.equal(sent.length - n0, 2);
  assert.deepEqual(sent.at(-1).body.generationConfig.thinkingConfig, { thinkingLevel: 'low' }); assert.equal(sent.at(-1).body.generationConfig.maxOutputTokens, 3048);
  provider = async () => ({ status: 400, json: { error: { message: 'Invalid thinking level.' } } });
  process.env.GEMINI_MODEL = 'gemini-3.8-flash'; n0 = sent.length;
  r = await complete({ feature: 'courseContent', json: true, maxTokens: 1000, provider: 'gemini' });
  const gemSent = sent.slice(n0).filter(s => s.url.includes('generativelanguage'));
  assert.equal(gemSent.length, 2, 'only one corrected request'); assert.equal(gemSent[1].body.generationConfig.thinkingConfig, undefined, 'then the model default');
  assert.deepEqual([r.status, r.body.code], [502, 'provider']);
  // a model this key cannot use: provider_model with a clear message (no retry, the page stops)
  provider = async () => ({ status: 404, json: { error: { message: 'models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent.' } } });
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  r = await complete({ feature: 'courseContent', json: true, provider: 'gemini' });
  assert.deepEqual([r.status, r.body.code], [502, 'provider_model']); assert.match(r.body.error, /"gemini-2\.5-flash" is not available.*Settings → Integrations/);
  provider = async () => ({ status: 403, json: { error: { message: 'This model is no longer available to new users. Please use a newer model.' } } });
  assert.equal((await complete({ feature: 'courseContent', json: true, provider: 'gemini' })).body.code, 'provider_model');
  provider = async () => ({ status: 400, json: { error: { message: 'API key not valid. Please pass a valid API key.' } } });
  r = await complete({ feature: 'courseContent', json: true, provider: 'gemini' });
  assert.deepEqual([r.status, r.body.code, r.body.provider], [502, 'provider_auth', 'gemini'], 'an invalid key is a rejected key, the same code for every provider');
  assert.match(r.body.error, /Gemini rejected the API key/);
  provider = async () => ({ status: 500, json: { error: { message: 'Internal error' } } });
  assert.deepEqual(Object.values((await complete({ feature: 'courseContent', json: true, provider: 'gemini' })).body).slice(0, 2), ['Internal error', 'provider'], 'other errors unchanged');
  // a blocked or safety-stopped answer is an error with the reason, not an empty answer
  provider = async () => ({ status: 200, json: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { totalTokenCount: 4 } } });
  r = await complete({ feature: 'courseContent', json: true, provider: 'gemini' });
  assert.deepEqual([r.status, r.body.code], [502, 'provider_blocked']); assert.match(r.body.error, /PROHIBITED_CONTENT/);
  provider = async () => ({ status: 200, json: { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] } });
  assert.equal((await complete({ feature: 'courseContent', json: true, provider: 'gemini' })).body.code, 'provider_blocked');
  // thinking used the whole budget: no text, MAX_TOKENS, reported as cut off (the page retries shorter)
  provider = async () => ({ status: 200, json: { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 10, thoughtsTokenCount: 3000, totalTokenCount: 3010 } } });
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  r = await complete({ feature: 'courseContent', json: true, provider: 'gemini' });
  assert.deepEqual([r.status, r.body.truncated, r.body.text, r.body.tokens], [200, true, '', 3010]);
  delete process.env.GEMINI_MODEL;
  // a key without a model setting uses a model that is open to new projects
  provider = async () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] } });
  await complete({ feature: 'tutor', provider: 'gemini' });
  process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
  assert.match(sent.at(-1).url, /models\/gemini-3\.5-flash-lite:/);
  provider = async () => ({ status: 500, json: { error: { message: 'boom' } } });
  r = await complete({ feature: 'courseGenerate', json: true, fallbackProvider: 'gemini' });
  assert.deepEqual([r.status, r.body.code], [502, 'provider']);
  // deadline: a provider that never answers ends in a clear timeout, and is not repeated
  ai._test.limits.deadlineMs = 400; ai._test.limits.fallbackMinMs = 200;
  const hang = (u, o) => new Promise((res, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
  provider = hang; let t0 = Date.now(); const calls0 = sent.length;
  r = await complete({ feature: 'courseGenerate', json: true, fallbackProvider: 'gemini' });
  assert.deepEqual([r.status, r.body.code], [504, 'timeout']);
  assert.ok(Date.now() - t0 < 3000, 'ends at the deadline');
  assert.equal(sent.length - calls0, 1, 'a request that ran out of time is not repeated on the fallback provider');
  // slow failure leaves too little time for the fallback
  provider = async url => { if (String(url).includes('generativelanguage')) return { status: 200, json: { candidates: [{ content: { parts: [{ text: 'x' }] } }] } }; await new Promise(r => setTimeout(r, 250)); return { status: 500, json: { error: { message: 'slow failure' } } }; };
  const c1 = sent.length;
  r = await complete({ feature: 'courseGenerate', json: true, fallbackProvider: 'gemini' });
  assert.equal(r.status, 502); assert.equal(sent.length - c1, 1, 'less than the minimum left: no fallback attempt');
  // a fast failure still falls back
  ai._test.limits.deadlineMs = 50000; ai._test.limits.fallbackMinMs = 15000;
  provider = async url => (String(url).includes('generativelanguage') ? { status: 200, json: { candidates: [{ content: { parts: [{ text: '{}' }] } }] } } : { status: 429, json: { error: { message: 'rate' } } });
  r = await complete({ feature: 'courseGenerate', json: true, fallbackProvider: 'gemini' });
  assert.equal(r.body.provider, 'gemini');
  // the provider's own per-minute limit or overload: provider_busy with the wait it asked for; a used-up
  // daily quota: provider_quota; anything else stays a 502
  const gemErr = (status, message, details) => async () => ({ status, json: { error: { message, details } } });
  provider = gemErr(429, 'You exceeded your current quota. Please retry in 59.15s.', [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '59s' }]);
  r = await complete({ feature: 'courseContent', json: true, provider: 'gemini' });
  assert.deepEqual([r.status, r.body.code, r.body.retryAfterMs], [503, 'provider_busy', 59000]);
  assert.match(r.body.error, /per minute/);
  provider = gemErr(503, 'This model is currently experiencing high demand.');
  r = await complete({ feature: 'courseContent', json: true, provider: 'gemini' });
  assert.deepEqual([r.status, r.body.code, r.body.retryAfterMs], [503, 'provider_busy', 10000], 'overloaded: a short default wait');
  provider = gemErr(429, 'Quota exceeded. Please retry in 3s.', [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }]);
  r = await complete({ feature: 'courseContent', json: true, provider: 'gemini' });
  assert.equal(r.body.code, 'provider_quota', 'a daily quota is not worth waiting for');
  provider = gemErr(400, 'bad');
  assert.deepEqual(Object.values((await complete({ feature: 'courseContent', json: true, provider: 'gemini' })).body).slice(0, 2), ['bad', 'provider']);
  provider = async () => ({ status: 200, json: { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: {} } });
  // budget and rate limit codes
  r = await complete({ feature: 'courseGenerate', budget: { hardStop: true, maxCalls: 1 } });
  assert.deepEqual([r.status, r.body.code], [429, 'budget'], 'monthly budget reached (the calls above are counted)');
  assert.equal((await complete({ feature: 'courseGenerate', budget: { hardStop: true, maxCalls: 100000 } })).status, 200);
  const usage = await (async () => { const f = require('fs'); return JSON.parse(f.readFileSync(require('path').join('/tmp', 'sdc-ai-usage.json'), 'utf8')); })().catch(() => null);
  if (usage) assert.ok(usage.byFeature.courseGenerate >= 1, 'usage is listed under its own name');
  delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY;

  // demo mode: only when asked for, only without a provider, never in production, always labelled
  r = await complete({ feature: 'courseGenerate', json: true });
  assert.equal(r.body.code, 'not_configured', 'demo mode is off by default');
  process.env.SDC_AI_MOCK = '1';
  const brief = CG.buildMessages(BRIEF, {});
  r = await complete({ feature: 'courseGenerate', json: true, system: brief.system, prompt: brief.prompt });
  assert.equal(r.status, 200); assert.equal(r.body.mock, true); assert.equal(r.body.provider, 'mock-demo'); assert.equal(r.body.model, 'mock-demo'); assert.match(r.body.badge, /not AI/i);
  const demo = CG.normalize(CG.parseAnswer(r.body.text).value);
  assert.ok(!demo.error); assert.equal(CG.countSessions(demo.outline), 12);
  assert.equal((await complete({ feature: 'tutor' })).body.code, 'not_configured', 'only course generation has a demo');
  process.env.VERCEL = '1';
  assert.equal((await complete({ feature: 'courseGenerate', json: true, prompt: brief.prompt })).body.code, 'not_configured', 'never in production');
  delete process.env.VERCEL; delete process.env.SDC_AI_MOCK;

  global.fetch = realFetch;
  await new Promise(r => srv.close(r));
  console.log('coursegen.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
