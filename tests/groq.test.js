/* Groq as an AI provider: the adapter (models list, JSON mode and Structured Outputs, parameters Groq
   rejects, limits, errors, rate limits, timeouts, usage), the Settings routes (save, test, models, remove,
   key never exposed), the fallback rules, per-capability routing with inheritance, and a Python course
   whose content generation runs out of Gemini quota, is switched to Groq, resumes and is repaired with AI.
   Every provider is stubbed: nothing here reaches the network. Run: npm test */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), express = require('express');

process.env.SDC_AI_SECRETS_KEY = 'test-only-ai-secrets-key';
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SDC_ALLOW_LIVE', 'NODE_ENV', 'SDC_AI_MOCK', 'SDC_AI_LOCAL_OPEN',
  'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'AZURE_OPENAI_API_KEY', 'GROQ_API_KEY', 'GROQ_MODEL', 'SDC_QA_GROQ_BASE_URL']) delete process.env[k];
process.env.VERCEL = '1'; // secrets and usage files go to the temp folder while loading
const ai = require('../backend/ai-api.js');
delete process.env.VERCEL;
const CC = require('../js/coursecontent-logic.js'), CK = require('../js/codecheck-logic.js');

const KEY = 'gsk_test_only_not_a_real_key_1234';
const GROQ = 'https://api.groq.com/openai/v1';
const MODELS = [
  { id: 'llama-test-70b', object: 'model', owned_by: 'Meta', active: true, context_window: 131072, max_completion_tokens: 32768 },
  { id: 'small-ctx-model', object: 'model', owned_by: 'Test', active: true, context_window: 4096, max_completion_tokens: 1024 },
  { id: 'openai/gpt-oss-test', object: 'model', owned_by: 'OpenAI', active: true, context_window: 131072, max_completion_tokens: 65536 },
  { id: 'whisper-large-v3', object: 'model', owned_by: 'OpenAI', active: true, context_window: 448 },
  { id: 'meta-llama/llama-guard-test', object: 'model', owned_by: 'Meta', active: true, context_window: 131072 },
  { id: 'groq/compound', object: 'model', owned_by: 'Groq', active: true, context_window: 131072 },
  { id: 'retired-model', object: 'model', owned_by: 'Test', active: false, context_window: 8192 }
];
const okChat = (content = '{"ok":1}', over = {}) => ({ status: 200, json: { id: 'chatcmpl-1', model: over.model || 'llama-test-70b', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: over.finish || 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, total_time: 0.42 }, x_groq: { id: 'req_test' } } });
const groqErr = (status, message, extra = {}, headers = {}) => ({ status, json: { error: { message, type: 'invalid_request_error', ...extra } }, headers });

(async () => {
  /* ---------------------------------------------------------------- harness */
  const app = express(); app.use(ai);
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const realFetch = global.fetch;
  const sent = [];
  let groqChat = async () => okChat(), groqList = async () => ({ status: 200, json: { object: 'list', data: MODELS } });
  let openai = async () => ({ status: 200, json: { choices: [{ message: { content: 'from openai' }, finish_reason: 'stop' }], usage: { total_tokens: 3 } } });
  let gemini = async () => ({ status: 500, json: { error: { message: 'gemini not stubbed' } } });
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith(BASE)) return realFetch(url, opts);
    const req = { url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null, signal: opts.signal };
    sent.push(req);
    const r = url === GROQ + '/models' ? await groqList(req) : url === GROQ + '/chat/completions' ? await groqChat(req)
      : url.startsWith('https://api.openai.com/') ? await openai(req) : url.startsWith('https://generativelanguage.googleapis.com/') ? await gemini(req)
      : { status: 599, json: { error: { message: 'unexpected host ' + url } } };
    const h = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return { ok: r.status < 400, status: r.status, headers: { get: k => h[String(k).toLowerCase()] ?? null }, json: async () => r.json };
  };
  const call = async (p, body, token, method = 'POST') => { const r = await realFetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})), raw: '' }; };
  // the server allows 60 requests an hour per person, so each part of this test signs in as its own person
  const signIn = async id => (await call('/api/ai/auth', { userId: id })).body.token;
  let token = await signIn('U-coord-a');
  assert.ok(token);
  const complete = body => call('/api/ai/complete', { prompt: 'hi', provider: 'groq', model: 'llama-test-70b', fallbackProvider: 'none', ...body }, token);
  const chats = () => sent.filter(x => x.url === GROQ + '/chat/completions');
  const lists = () => sent.filter(x => x.url === GROQ + '/models');
  const usage = async () => (await call('/api/ai/status', null, null, 'GET')).body.usage?.byProvider?.groq || { calls: 0, tokens: 0, errors: 0, ms: 0 };

  /* ------------------------------------------- A. the adapter, with an env key */
  process.env.GROQ_API_KEY = KEY;
  ai._test.resetGroq();
  const u0 = await usage();
  let r = await complete({ feature: 'tutor', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Mail ali@example.com', name: 'ali' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.provider, r.body.model, r.body.text, r.body.tokens, r.body.ms, r.body.truncated], ['groq', 'llama-test-70b', '{"ok":1}', 15, 420, false]);
  assert.deepEqual(r.body.usage, { input: 10, output: 5 });
  let b = chats().at(-1);
  assert.equal(b.headers.Authorization, 'Bearer ' + KEY, 'the key goes to Groq, as a bearer token');
  assert.deepEqual(Object.keys(b.body).sort(), ['max_completion_tokens', 'messages', 'model', 'temperature'], 'no JSON mode unless asked; nothing Groq rejects');
  assert.equal(b.body.max_completion_tokens, 2048);
  assert.deepEqual(b.body.messages[1], { role: 'user', content: 'Mail [redacted]' }, 'messages[].name is not sent; PII is still scrubbed');
  assert.equal(lists().length, 1, 'the model list was read once');
  await complete({ feature: 'tutor' });
  assert.equal(lists().length, 1, 'and is cached');
  assert.ok(sent.every(x => x.url.startsWith(GROQ)), 'nothing else was called');
  // the QA stand-in address is honoured only on this machine's loopback, never elsewhere or in production
  process.env.SDC_QA_GROQ_BASE_URL = 'https://elsewhere.example/v1';
  await complete({ feature: 'tutor' });
  assert.ok(chats().at(-1).url.startsWith(GROQ), 'a non-loopback stand-in is ignored');
  process.env.SDC_QA_GROQ_BASE_URL = 'http://127.0.0.1:9/v1'; process.env.NODE_ENV = 'production';
  await complete({ feature: 'tutor' });
  assert.ok(chats().at(-1).url.startsWith(GROQ), 'and ignored in production');
  delete process.env.SDC_QA_GROQ_BASE_URL; delete process.env.NODE_ENV;

  // JSON mode, answer size within the model's own limit, Structured Outputs when a schema is sent
  r = await complete({ feature: 'courseContent', json: true, maxTokens: 8000, model: 'small-ctx-model' });
  b = chats().at(-1);
  assert.deepEqual(b.body.response_format, { type: 'json_object' });
  assert.equal(b.body.max_completion_tokens, 1024, 'never above the model\'s max_completion_tokens');
  await complete({ feature: 'courseContent', json: true, schema: { type: 'object', properties: { a: { type: 'string' } } } });
  assert.deepEqual(chats().at(-1).body.response_format, { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object', properties: { a: { type: 'string' } } }, strict: false } });
  await complete({ feature: 'courseContent', schema: { type: 'object' } });
  assert.equal(chats().at(-1).body.response_format, undefined, 'a schema without JSON mode is ignored');
  await complete({ feature: 'courseContent', json: true, model: 'openai/gpt-oss-test' });
  assert.equal(chats().at(-1).body.reasoning_effort, 'low', 'GPT-OSS reasons briefly so the answer fits');
  // a prompt larger than the model's context is refused before anything is sent
  let n0 = chats().length;
  r = await complete({ feature: 'courseContent', json: true, model: 'small-ctx-model', prompt: 'x'.repeat(20000) });
  assert.deepEqual([r.status, r.body.code], [400, 'provider_too_large']); assert.match(r.body.error, /4096-token context/);
  assert.equal(chats().length, n0, 'no request was sent');
  // model problems
  r = await complete({ feature: 'tutor', model: '' });
  assert.deepEqual([r.body.code], ['provider_model'], 'no model chosen'); assert.match(r.body.error, /Load the models/);
  r = await complete({ feature: 'tutor', model: 'retired-model' });
  assert.equal(r.body.code, 'provider_model', 'an inactive model is not available');
  assert.equal(chats().length, n0, 'still nothing sent');
  groqChat = async () => groqErr(404, 'The model `llama-test-70b` does not exist or you do not have access to it.', { code: 'model_not_found' });
  assert.equal((await complete({ feature: 'tutor' })).body.code, 'provider_model');
  groqChat = async () => groqErr(400, 'The model `llama-test-70b` has been decommissioned and is no longer supported.');
  assert.equal((await complete({ feature: 'tutor' })).body.code, 'provider_model');

  // stop reason, reasoning text, request id
  groqChat = async () => okChat('<think>Let me plan the JSON.</think>\n{"ok":2}');
  assert.equal((await complete({ feature: 'tutor' })).body.text, '{"ok":2}', 'reasoning in <think> tags is not part of the answer');
  groqChat = async () => okChat('{"cut', { finish: 'length' });
  r = await complete({ feature: 'courseContent', json: true });
  assert.deepEqual([r.body.truncated, r.body.text], [true, '{"cut']);

  // parameters a model rejects: one corrected request, remembered for that model
  ai._test.resetGroq();
  groqChat = async req => (req.body.response_format && req.body.reasoning_format === undefined ? groqErr(400, 'reasoning_format=raw is not supported with JSON mode or tool use') : okChat());
  n0 = chats().length;
  r = await complete({ feature: 'courseContent', json: true });
  assert.equal(r.status, 200); assert.equal(chats().length - n0, 2);
  assert.equal(chats().at(-1).body.reasoning_format, 'hidden');
  await complete({ feature: 'courseContent', json: true });
  assert.equal(chats().length - n0, 3, 'the correction is remembered: one request the next time');
  groqChat = async req => (req.body.response_format?.type === 'json_schema' ? groqErr(400, "response_format 'json_schema' is not supported with this model") : okChat());
  n0 = chats().length;
  r = await complete({ feature: 'courseContent', json: true, model: 'small-ctx-model', schema: { type: 'object' } });
  assert.equal(r.status, 200); assert.deepEqual(chats().slice(n0).map(x => x.body.response_format.type), ['json_schema', 'json_object'], 'falls back to JSON mode');
  groqChat = async req => ('max_completion_tokens' in req.body ? groqErr(400, "property 'max_completion_tokens' is unsupported, use max_tokens") : okChat());
  n0 = chats().length;
  assert.equal((await complete({ feature: 'tutor', model: 'openai/gpt-oss-test' })).status, 200);
  assert.equal(chats().at(-1).body.max_tokens, 2048);
  groqChat = async () => groqErr(400, 'reasoning_effort is not supported for this model');
  n0 = chats().length;
  r = await complete({ feature: 'tutor', model: 'openai/gpt-oss-test' });
  assert.ok(chats().length - n0 <= 2, 'never more than one correction per parameter'); assert.equal(r.status, 502);
  ai._test.resetGroq();
  // JSON mode that failed validation: what the model wrote goes to the page's own checks
  groqChat = async () => groqErr(400, 'Failed to generate JSON. Please adjust your prompt. See \'failed_generation\' for more details.', { code: 'json_validate_failed', failed_generation: '{"a": 1,}' });
  r = await complete({ feature: 'courseContent', json: true });
  assert.deepEqual([r.status, r.body.text, r.body.jsonInvalid], [200, '{"a": 1,}', true]);
  assert.equal(CC.parseAnswer(r.body.text).value.a, 1, 'and the existing repair reads it');
  groqChat = async () => groqErr(400, 'Failed to generate JSON.', { code: 'json_validate_failed' });
  assert.equal((await complete({ feature: 'courseContent', json: true })).body.code, 'invalid_json');

  // rate limits, quota, size, busy, keys
  groqChat = async () => groqErr(429, 'Rate limit reached for model `llama-test-70b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Used 5200, Requested 1900. Please try again in 1m2.5s.', { code: 'rate_limit_exceeded' });
  r = await complete({ feature: 'courseContent' });
  assert.deepEqual([r.status, r.body.code, r.body.retryAfterMs], [503, 'provider_busy', 62500]);
  groqChat = async () => groqErr(429, 'Rate limit reached on requests per minute (RPM): Limit 30.', {}, { 'retry-after': '7' });
  assert.equal((await complete({ feature: 'courseContent' })).body.retryAfterMs, 7000, 'retry-after header');
  groqChat = async () => groqErr(429, 'Rate limit reached for model `llama-test-70b` on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 5m0s.');
  assert.equal((await complete({ feature: 'courseContent' })).body.code, 'provider_quota', 'a used-up daily limit stops');
  groqChat = async () => groqErr(413, 'Request too large for model `llama-test-70b` in organization `org_x` on tokens per minute (TPM): Limit 6000, Requested 9000, please reduce your message size and try again.');
  r = await complete({ feature: 'courseContent' });
  assert.deepEqual([r.status, r.body.code], [400, 'provider_too_large']);
  groqChat = async () => ({ status: 498, json: { error: { message: 'Flex tier capacity exceeded.' } } });
  assert.equal((await complete({ feature: 'tutor' })).body.code, 'provider_busy');
  groqChat = async () => groqErr(503, 'Service unavailable');
  assert.equal((await complete({ feature: 'tutor' })).body.code, 'provider_busy');
  groqChat = async () => groqErr(500, 'Internal error while handling key ' + KEY);
  r = await complete({ feature: 'tutor' });
  assert.equal(r.status, 502); assert.ok(!JSON.stringify(r.body).includes(KEY), 'a key in a provider message is never passed on');
  groqChat = async () => groqErr(401, 'Invalid API Key', { code: 'invalid_api_key' });
  r = await complete({ feature: 'tutor' });
  assert.deepEqual([r.body.code], ['provider_auth']); assert.match(r.body.error, /rejected the API key/);
  ai._test.resetGroq();
  groqList = async () => groqErr(401, 'Invalid API Key');
  assert.equal((await complete({ feature: 'tutor' })).body.code, 'provider_auth', 'a rejected key on the model list stops too');
  groqList = async () => groqErr(503, 'busy');
  groqChat = async () => okChat();
  assert.equal((await complete({ feature: 'tutor' })).status, 200, 'without the model list the request is sent as asked');
  groqList = async () => ({ status: 200, json: { object: 'list', data: MODELS } });
  ai._test.resetGroq();
  // time-out within the request's deadline
  ai._test.limits.deadlineMs = 400; ai._test.limits.fallbackMinMs = 200;
  groqChat = req => new Promise((_, rej) => req.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
  r = await complete({ feature: 'tutor' });
  assert.deepEqual([r.status, r.body.code], [504, 'timeout']);
  ai._test.limits.deadlineMs = 50000; ai._test.limits.fallbackMinMs = 15000;
  groqChat = async () => okChat();
  // usage, time and errors are counted per provider
  const u1 = await usage();
  assert.ok(u1.calls - u0.calls >= 10 && u1.tokens > u0.tokens && u1.ms > u0.ms, 'answered calls, tokens and time');
  assert.ok(u1.errors - u0.errors >= 10, 'failed attempts'); assert.ok(u1.lastError.code && u1.lastError.at);

  token = await signIn('U-coord-b');
  /* -------------------------------------------- B. fallback: never to Groq by surprise */
  process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
  groqChat = async () => groqErr(500, 'Groq failed');
  n0 = sent.length;
  r = await complete({ feature: 'tutor', fallbackProvider: 'none' });
  assert.equal(r.status, 502); assert.ok(sent.slice(n0).every(x => x.url.startsWith(GROQ)), 'fallback "none": no other provider is tried');
  r = await complete({ feature: 'tutor', fallbackProvider: 'openai' });
  assert.deepEqual([r.status, r.body.provider], [200, 'openai'], 'a configured fallback still works as before');
  groqChat = async () => okChat();
  openai = async () => ({ status: 500, json: { error: { message: 'OpenAI failed' } } });
  n0 = sent.length;
  r = await call('/api/ai/complete', { prompt: 'hi', provider: 'openai', fallbackProvider: 'gemini', primaryProvider: 'openai', feature: 'tutor' }, token);
  assert.equal(r.status, 502); assert.ok(!sent.slice(n0).some(x => x.url.startsWith(GROQ)), 'Groq is not an automatic fallback unless chosen');
  r = await call('/api/ai/complete', { prompt: 'hi', provider: 'openai', fallbackProvider: 'groq', primaryProvider: 'openai', feature: 'tutor', model: 'gpt-x' }, token);
  assert.equal(r.status, 400, 'Groq chosen as fallback but no Groq model in the env profile'); assert.equal(r.body.code, 'provider_model');
  process.env.GROQ_MODEL = 'llama-test-70b';
  r = await call('/api/ai/complete', { prompt: 'hi', provider: 'openai', fallbackProvider: 'groq', primaryProvider: 'openai', feature: 'tutor', model: 'gpt-x' }, token);
  assert.deepEqual([r.status, r.body.provider, chats().at(-1).body.model], [200, 'groq', 'llama-test-70b'], 'chosen as fallback: Groq with its own model, not the other provider\'s');
  delete process.env.GROQ_MODEL; delete process.env.OPENAI_API_KEY;
  openai = async () => ({ status: 200, json: { choices: [{ message: { content: 'from openai' }, finish_reason: 'stop' }], usage: { total_tokens: 3 } } });

  token = await signIn('U-coord-c');
  /* -------------------------------------- C. Settings: save, models, test, update, remove */
  delete process.env.GROQ_API_KEY;
  const SAVED = 'gsk_saved_key_for_tests_9876';
  r = await call('/api/ai/configure', { provider: 'groq', name: 'groq', apiKey: SAVED, model: 'bad model!' }, token);
  assert.equal(r.status, 400, 'a model id with spaces is refused');
  r = await call('/api/ai/configure', { provider: 'groq', name: 'groq', apiKey: SAVED, model: 'llama-test-70b', baseUrl: 'https://elsewhere.example' }, token);
  assert.equal(r.status, 200); const pid = r.body.profile.id;
  assert.equal(r.body.profile.maskedKey, 'gsk…9876');
  try {
    let st = (await call('/api/ai/status', null, null, 'GET')).body;
    const prof = st.profiles.find(p => p.id === pid);
    assert.deepEqual([prof.provider, prof.model, prof.baseUrl, prof.lastTest], ['groq', 'llama-test-70b', '', null], 'stored without a base URL: the key only goes to api.groq.com');
    assert.ok(!JSON.stringify(st).includes(SAVED), 'the status never contains the key');
    r = await call('/api/ai/models', { provider: 'groq', profileId: pid, fresh: true }, token);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.models.map(m => m.id), ['llama-test-70b', 'openai/gpt-oss-test', 'small-ctx-model'], 'text models only, inactive ones left out');
    assert.deepEqual(r.body.models[0], { id: 'llama-test-70b', ownedBy: 'Meta', contextWindow: 131072, maxOutput: 32768, text: true });
    assert.deepEqual(r.body.other.sort(), ['groq/compound', 'meta-llama/llama-guard-test', 'whisper-large-v3']);
    assert.equal(lists().at(-1).headers.Authorization, 'Bearer ' + SAVED); assert.ok(!JSON.stringify(r.body).includes(SAVED));
    assert.equal((await call('/api/ai/models', { provider: 'groq', apiKey: 'gsk_pasted_before_save_000' }, token)).status, 200);
    assert.equal(lists().at(-1).headers.Authorization, 'Bearer gsk_pasted_before_save_000', 'a pasted key can list models before it is saved');
    assert.equal((await call('/api/ai/models', { provider: 'openai' }, token)).status, 400);
    assert.equal((await call('/api/ai/models', { provider: 'groq' })).status, 401, 'sign-in required');
    // test: the result is stored with the profile, never the key
    r = await call('/api/ai/test', { provider: 'groq', profileId: pid }, token);
    assert.deepEqual([r.status, r.body.provider, r.body.model], [200, 'groq', 'llama-test-70b']);
    assert.equal(chats().at(-1).body.max_completion_tokens, 32);
    st = (await call('/api/ai/status', null, null, 'GET')).body;
    assert.equal(st.profiles.find(p => p.id === pid).lastTest.ok, true);
    groqChat = async () => groqErr(401, 'Invalid API Key');
    r = await call('/api/ai/test', { provider: 'groq', profileId: pid }, token);
    assert.equal(r.body.code, 'provider_auth');
    st = (await call('/api/ai/status', null, null, 'GET')).body;
    assert.deepEqual([st.profiles.find(p => p.id === pid).lastTest.ok, st.profiles.find(p => p.id === pid).lastTest.code], [false, 'provider_auth']);
    groqChat = async () => okChat();
    // the saved profile is used for requests; update the key: the old test result no longer applies
    r = await complete({ feature: 'tutor', model: undefined });
    assert.equal(r.status, 200); assert.equal(chats().at(-1).headers.Authorization, 'Bearer ' + SAVED); assert.equal(chats().at(-1).body.model, 'llama-test-70b', 'the profile\'s model when the capability names none');
    r = await call('/api/ai/configure', { provider: 'groq', profileId: pid, apiKey: 'gsk_updated_key_0000', model: 'llama-test-70b' }, token);
    st = (await call('/api/ai/status', null, null, 'GET')).body;
    assert.deepEqual([st.profiles.find(p => p.id === pid).maskedKey, st.profiles.find(p => p.id === pid).lastTest], ['gsk…0000', null]);
    r = await call('/api/ai/configure', { provider: 'groq', profileId: pid, apiKey: 'gsk…0000', model: 'small-ctx-model' }, token);
    assert.equal(r.status, 200, 'the masked key in the form keeps the stored key');
    await complete({ feature: 'tutor', model: undefined });
    assert.deepEqual([chats().at(-1).headers.Authorization, chats().at(-1).body.model], ['Bearer gsk_updated_key_0000', 'small-ctx-model']);
  } finally {
    r = await call('/api/ai/configure', { provider: 'groq', profileId: pid, remove: true }, token);
  }
  assert.equal(r.body.removed, pid);
  assert.ok(!(await call('/api/ai/status', null, null, 'GET')).body.profiles.some(p => p.id === pid), 'removed');
  assert.equal((await complete({ feature: 'tutor' })).body.code, 'not_configured', 'no Groq key left');

  token = await signIn('U-coord-d');
  /* ------------------- D. per-capability routing in the browser (core.js), with inheritance */
  const store = {};
  const ctx = {
    console, URL, URLSearchParams, Intl, Blob: class {}, Event: class { constructor(t) { this.type = t; } }, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; return a; } },
    document: { querySelector: () => null }, location: {},
    fetch: (u, o) => realFetch(String(u).startsWith('/') ? BASE + u : u, o)
  };
  ctx.window = ctx; ctx.window.addEventListener = () => {}; ctx.window.dispatchEvent = () => {};
  vm.createContext(ctx);
  const src = ['seed.js', 'migrations.js', 'shared-rules.js', 'core.js', 'ai-client.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join(';\n');
  vm.runInContext(src + ';globalThis.__x={db,saveDB,Domain,invalidateCache}', ctx, { filename: 'core-bundle.js' });
  const { db, saveDB, Domain, invalidateCache } = ctx.__x;
  ctx.can = () => true; // the person is a coordinator; permissions are tested elsewhere
  { const d = db(); d.settings.integrations.budget = { ...d.settings.integrations.budget, maxCalls: 0, hardStop: false }; saveDB(d); } // the monthly budget is not what this test is about (the usage file in the temp folder grows with every run)
  store.sdcCloudToken = token;
  const setCap = (name, v) => { const d = db(); d.settings.integrations.capabilities[name] = { ...d.settings.integrations.capabilities[name], ...v }; saveDB(d); };
  assert.deepEqual(['courseContent', 'contentRepair'].map(k => Domain.aiCapRoute(k).provider), ['openai', 'openai'], 'by default both follow the course outline');
  setCap('courseGenerate', { provider: 'gemini', model: '' });
  assert.deepEqual(['courseGenerate', 'courseContent', 'contentRepair'].map(k => Domain.aiCapRoute(k).provider), ['gemini', 'gemini', 'gemini'], 'an existing Gemini setup keeps working with no change');
  assert.equal(Domain.aiCapRoute('contentRepair').inheritedFrom, 'courseGenerate');
  // an old saved state without the new capabilities gets them from the defaults
  { const d = db(); delete d.settings.integrations.capabilities.courseContent; delete d.settings.integrations.capabilities.contentRepair; saveDB(d); invalidateCache(); }
  assert.equal(Domain.aiCapRoute('contentRepair').provider, 'gemini');
  // a loop of inherits cannot hang
  setCap('tutor', { provider: '', inherit: 'tutor' });
  assert.equal(Domain.aiCapRoute('tutor').provider, '');
  setCap('tutor', { provider: 'openai', inherit: undefined });

  /* --- E. a Python course: Gemini runs out of quota, the content capability is switched to Groq, the run
         resumes, and a part with broken code is repaired with AI. The real runner, client and server. */
  process.env.GEMINI_API_KEY = 'test-not-a-real-key'; process.env.GEMINI_MODEL = 'gemini-2.5-flash'; process.env.GROQ_API_KEY = KEY;
  ai._test.resetGroq();
  const PY = {
    clean: 'import pandas as pd\n\ndef clean(df):\n    if df.empty:\n        return df\n    df = df.drop_duplicates()\n    return df.fillna(df.mean()).reset_index()\n\nprint(clean(pd.DataFrame()).isnull().sum().sum())',
    chain: 'summary = (df.groupby("city")["salary"]\n           .agg(["mean", "max"])\n           .sort_values("mean", ascending=False)\n           .reset_index())\nprint(summary.head())',
    loop: 'for name, group in df.groupby("dept"):\n    total = 0\n    for _, row in group.iterrows():\n        if row["pay"] > 0:\n            total += row["pay"]\n    print(name, total)'
  };
  const BAD_PY = 'def total(items):\nresult = 0\nfor i in items:\nresult += i\nreturn result';
  const FENCE = '`'.repeat(3), fenced = c => FENCE + 'python\n' + c + '\n' + FENCE;
  const words = (k, w) => Array.from({ length: k }, (_, i) => w + (i % 9 ? '' : '.')).join(' ');
  const A = [PY.clean, PY.chain, PY.loop];
  const answer = (kind, n, bad) => {
    if (kind === 'lesson') return { objectives: ['Explain ' + n, 'Build ' + n, 'Debug ' + n], prerequisites: ['The previous session'],
      timePlan: [{ minutes: 20, activity: 'Introduction' }, { minutes: 40, activity: 'Concepts' }, { minutes: 10, activity: 'Break' }, { minutes: 50, activity: 'Practice' }],
      lesson: [0, 1, 2, 3].map(i => ({ heading: 'Part ' + (i + 1) + ' of session ' + n, body: words(60, 'explain'), example: 'Worked example:\n\n' + fenced(A[i % 3]) + '\n\nRun it.' })),
      keyTerms: [{ term: 'DataFrame', meaning: 'A table.' }] };
    if (kind === 'practice') return { codeRelevant: true,
      tutorials: [{ title: 'Tutorial', goal: 'Follow along', steps: ['Open the editor.', 'Type the code:\n' + fenced(A[0]), 'Run it.', 'Change one value.'] }],
      codeExamples: [0, 1, 2].map(i => ({ title: 'Example ' + (i + 1), language: 'python', code: bad && i === 0 ? BAD_PY : A[i], explanation: 'Read it line by line.' })),
      demos: [{ title: 'Demo', description: 'Show it live.', steps: ['a', 'b', 'c'] }],
      guided: [0, 1].map(i => ({ title: 'Guided ' + (i + 1), instructions: 'Write it with help.', steps: ['a', 'b', 'c'], hint: 'Start small.', solution: fenced(A[i]) })),
      practice: [{ title: 'Task', task: 'Do it alone.', criteria: ['It runs', 'It is tidy'] }] };
    return { homework: { title: 'Homework ' + n, brief: words(40, 'brief'), deliverables: ['script'], rubric: [{ criterion: 'Works', marks: 6 }, { criterion: 'Clean', marks: 4 }], maxMarks: 10, estimatedHours: 2 },
      quiz: Array.from({ length: 6 }, (_, i) => ({ question: 'Question ' + (i + 1) + '?', options: ['df.head()', 'df.info()', 'df.shape', 'plt.show()'], answer: i % 4, explanation: 'Because.' })),
      teacherNotes: ['Prepare the data file.'], resources: [{ title: 'Official documentation', type: 'documentation', note: 'Reference.' }] };
  };
  const kindOf = sys => (/Write the LESSON part/.test(sys) ? 'lesson' : /Write the PRACTICE part/.test(sys) ? 'practice' : 'assess');
  const numOf = p => Number((/THIS SESSION: number (\d+)/.exec(p) || [])[1]);
  const log = [];
  let geminiLeft = 4;
  gemini = async req => {
    const sys = req.body.systemInstruction?.parts?.[0]?.text || '', prompt = req.body.contents[0].parts[0].text, kind = kindOf(sys), n = numOf(prompt);
    if (geminiLeft-- <= 0) { log.push('gemini-quota:' + kind + n); return { status: 429, json: { error: { code: 429, message: 'You exceeded your current quota.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }] } } }; }
    log.push('gemini:' + kind + n);
    return { status: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify(answer(kind, n)) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 1200, totalTokenCount: 2100 } } };
  };
  let badOnce = new Set(['practice3']); const repairPrompts = [];
  groqChat = async req => {
    const sys = req.body.messages[0].content, prompt = req.body.messages.at(-1).content, kind = kindOf(sys), n = numOf(prompt);
    if (/Fix these problems/.test(prompt)) repairPrompts.push(prompt);
    log.push('groq:' + kind + n);
    return okChat(JSON.stringify(answer(kind, n, badOnce.has(kind + n) && !/Fix these problems/.test(prompt))), { model: req.body.model });
  };
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const data = { courses: [{ id: 'C-PY', title: 'Python for Data Analysis', level: 'Beginner', description: 'Pandas and plots.', outcomes: ['Clean data'], aiMeta: { coverage: [[1], [1], [1]] } }],
    sessions: [1, 2, 3].map(n => ({ id: 'S-PY' + n, courseId: 'C-PY', order: n, title: 'Session ' + n, summary: 'Summary ' + n, moduleName: 'M1', duration: '2h' })) };
  const features = [];
  const box = {
    CourseContentLogic: CC, CodeCheckLogic: CK, console, Map, Set, Promise, Date, JSON, Math, Number, String, Object, Array, Error,
    setTimeout: fn => setImmediate(fn), clearTimeout() {}, window: { addEventListener() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    t: x => x, esc, clone: v => JSON.parse(JSON.stringify(v)), icon: () => '', badge: x => '[' + x + ']', kind: () => 'staff',
    findRecord: (k, id) => data[k].find(x => x.id === id),
    updateRecord: (k, id, patch) => { const i = data[k].findIndex(x => x.id === id); data[k][i] = JSON.parse(JSON.stringify({ ...data[k][i], ...patch, id })); return data[k][i]; },
    Domain: { courseSessions: id => data.sessions.filter(s => s.courseId === id).sort((a, b) => a.order - b.order), canManageCourse: () => true },
    SDCAI: { call: (f, o) => { features.push(f); return ctx.SDCAI.call(f, o); } }
  };
  vm.createContext(box);
  require('./support/provider-box')(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'pages-coursecontent.js'), 'utf8') + '\n;this.TCRun = TCRun;', box);
  const finished = id => new Promise(res => { const off = box.TCRun.on(run => { if (run.courseId === id && !run.active) { off(); res(run); } }); });
  const missingJobs = () => data.sessions.map(s => { const st = CC.sessionState(s); return { sessionId: s.id, parts: CC.PARTS.filter(p => st.missing.includes(p) || st.outdated.includes(p) || st.failed.includes(p)) }; }).filter(j => j.parts.length);

  // 1. generation with Gemini (the course outline's provider) until the daily quota is used up
  box.TCRun.start('C-PY', missingJobs());
  let run = await finished('C-PY');
  assert.ok(run.fatal && /quota/i.test(run.fatal), 'the run stops on the used-up quota: ' + run.fatal);
  assert.ok(!log.some(x => x.startsWith('groq')), 'and does not switch to Groq on its own');
  const doneBefore = data.sessions.flatMap(s => CC.PARTS.filter(p => s.content?.meta?.parts?.[p]?.provider === 'gemini').map(p => s.id + ':' + p));
  assert.equal(doneBefore.length, 4, 'four parts were written by Gemini: ' + doneBefore.join(', '));
  assert.ok(features.every(f => f === 'courseContent'));
  // a person edits one finished part
  const edited = data.sessions.find(s => s.content?.meta?.parts?.lesson?.provider === 'gemini');
  const e = CC.applyEdit(edited.content, { keyTerms: [{ term: 'My term', meaning: 'Written by a person' }] }, 'U-coord', '2026-10-16T10:00:00Z');
  box.updateRecord('sessions', edited.id, { content: e.content });
  const before = JSON.parse(JSON.stringify(data.sessions));

  // 2. switch Full course content to Groq in Settings; the outline keeps Gemini
  setCap('courseContent', { provider: 'groq', model: 'llama-test-70b' });
  assert.deepEqual([Domain.aiCapRoute('courseGenerate').provider, Domain.aiCapRoute('courseContent').provider, Domain.aiCapRoute('contentRepair').provider], ['gemini', 'groq', 'groq']);
  log.length = 0;
  box.TCRun.start('C-PY', missingJobs());
  run = await finished('C-PY');
  assert.ok(!run.fatal, run.fatal);
  assert.ok(log.every(x => x.startsWith('groq')), 'the resumed run uses Groq only: ' + log.join(', '));
  assert.equal(log.length, 9 - 4 + 1, 'only the missing parts were asked for (plus one more try for the broken code)');
  for (const s of before) {
    const now = data.sessions.find(x => x.id === s.id);
    for (const p of CC.PARTS) {
      if (!s.content?.meta?.parts?.[p]) continue;
      CC.FIELDS_OF(p).forEach(k => assert.deepEqual(now.content[k], s.content[k], `${s.id} ${p}.${k} written before the switch is unchanged`));
      assert.deepEqual(now.content.meta.parts[p], s.content.meta.parts[p], 'with its provider record');
    }
  }
  assert.deepEqual(data.sessions.find(x => x.id === edited.id).content.keyTerms, [{ term: 'My term', meaning: 'Written by a person' }], 'the person\'s edit is kept');
  assert.ok(data.sessions.find(x => x.id === edited.id).content.meta.edited, 'and still marked as a person\'s edit');
  const groqParts = data.sessions.flatMap(s => CC.PARTS.filter(p => s.content.meta.parts[p].provider === 'groq').map(p => s.content.meta.parts[p]));
  assert.equal(groqParts.length, 5); assert.ok(groqParts.every(m => m.model === 'llama-test-70b' && m.tokens > 0), 'each part records Groq, its model and tokens');
  data.sessions.slice(0, 2).forEach(s => { assert.equal(CC.sessionState(s).status, 'complete'); assert.deepEqual(CC.codeReport(s).findings, [], s.id + ' has no code checks'); });
  const s3 = data.sessions[2];
  assert.ok(CC.codeReport(s3).open && CC.approvalBlockers(s3).length, 'session 3 has broken code: flagged and not approvable');
  assert.deepEqual(s3.content.codeExamples[0].code, BAD_PY, 'stored as written, not guessed');

  // 3. Repair with AI: the parts with findings, instructions naming each one, the contentRepair capability
  const plan = CC.repairPlan(s3);
  assert.deepEqual(plan.parts, ['practice']); assert.match(plan.instructions, /Fix these problems/); assert.match(plan.instructions, /Code examples 1 · Code/);
  assert.deepEqual(CC.repairPlan(data.sessions[0]), { parts: [], instructions: '' }, 'nothing to repair without open checks');
  features.length = 0; log.length = 0;
  const s3Before = JSON.stringify(data.sessions[2].content);
  box.TCRun.start('C-PY', [{ sessionId: s3.id, parts: plan.parts, instructions: plan.instructions, repairParts: plan.parts, proposeParts: plan.parts }]);
  run = await finished('C-PY');
  assert.deepEqual(features, ['contentRepair']); assert.deepEqual(log, ['groq:practice3']);
  assert.equal(repairPrompts.length, 1); assert.match(repairPrompts[0], /line \d+/);
  // the AI's answer is a proposal: the session content is exactly as it was
  const waiting = data.sessions[2];
  const pend = CC.pendingOf(waiting.content);
  assert.equal(pend.length, 1, 'one proposal is waiting'); assert.equal(pend[0].provider, 'groq'); assert.equal(pend[0].model, 'llama-test-70b');
  assert.deepEqual(CC.PARTS.flatMap(p => CC.FIELDS_OF(p)).map(k => waiting.content[k]), CC.PARTS.flatMap(p => CC.FIELDS_OF(p)).map(k => JSON.parse(s3Before)[k]), 'no field of the session changed');
  assert.deepEqual(waiting.content.codeExamples[0].code, BAD_PY, 'the broken code is still there until a person accepts');
  assert.ok(CC.codeReport(waiting).open, 'and still flagged');
  assert.deepEqual(run.jobs[0].proposed, ['practice']);
  // a person compares and accepts one field; the others stay as they are
  const ch = CC.proposalChanges(waiting.content, pend[0]).filter(x => x.change !== 'same');
  assert.ok(ch.some(x => x.key === 'codeExamples' && x.checks.before > 0 && x.checks.after === 0), 'the code field shows its checks going from some to none');
  const ac = CC.applyProposal(waiting.content, pend[0], ['codeExamples'], { by: 'U-coord', at: '2026-10-16T11:00:00Z' });
  box.updateRecord('sessions', s3.id, { content: ac.content });
  const fixed = data.sessions[2];
  assert.deepEqual(CC.codeReport(fixed).findings, [], 'accepted: the new code passes the same checks');
  assert.equal(fixed.content.codeExamples[0].code, PY.clean);
  assert.equal(fixed.content.meta.approved, undefined, 'repair never approves');
  assert.deepEqual(CC.approvalBlockers(fixed), [], 'a person can approve it now');
  assert.equal(CC.historyOf(fixed.content)[0].applied[0].before[0].code, BAD_PY, 'and the replaced code is in the history');
  assert.equal(CC.restoreEntry(fixed.content, CC.historyOf(fixed.content)[0].id, { at: '2026-10-16T12:00:00Z' }).content.codeExamples[0].code, BAD_PY, 'which can be restored');
  // 4. a person edits a field while the AI is still working: the proposal notices and does not replace it
  groqChat = async req => {
    const cur = data.sessions[1], e2 = CC.applyEdit(cur.content, { codeExamples: [{ title: 'Mine', language: 'python', code: 'print("mine")', explanation: 'written by hand' }] }, 'U-coord', '2026-10-16T13:00:00Z');
    box.updateRecord('sessions', cur.id, { content: e2.content });
    return okChat(JSON.stringify(answer('practice', 2)), { model: req.body.model });
  };
  box.TCRun.start('C-PY', [{ sessionId: 'S-PY2', parts: ['practice'], instructions: 'Check the examples.', repairParts: ['practice'], proposeParts: ['practice'] }]);
  run = await finished('C-PY');
  const mid = data.sessions[1], midProp = CC.pendingOf(mid.content)[0], midCh = CC.proposalChanges(mid.content, midProp);
  assert.equal(mid.content.codeExamples[0].code, 'print("mine")', 'the edit made during the request is intact');
  assert.equal(midCh.find(x => x.key === 'codeExamples').conflict, true, 'and the proposal reports that this field changed after the AI was shown it');
  assert.ok(midCh.filter(x => x.key !== 'codeExamples').every(x => !x.conflict), 'other fields are not reported');
  assert.deepEqual(CC.applyProposal(mid.content, midProp, ['codeExamples'], { at: '2026-10-16T13:05:00Z' }).skipped, [{ key: 'codeExamples', reason: 'changed' }], 'it is not replaced without an explicit choice');

  // content repair can use its own provider without changing course content
  setCap('contentRepair', { provider: 'gemini', model: '' });
  assert.deepEqual([Domain.aiCapRoute('courseContent').provider, Domain.aiCapRoute('contentRepair').provider], ['groq', 'gemini']);
  const st = (await call('/api/ai/status', null, null, 'GET')).body;
  assert.ok(st.usage.byFeature.contentRepair >= 1 && st.usage.byFeature.courseContent >= 9, 'usage per feature');
  assert.ok(st.usage.byProvider.gemini.errors >= 1 && st.usage.byProvider.gemini.lastError.code === 'provider_quota');

  delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODEL; delete process.env.GROQ_API_KEY;
  global.fetch = realFetch;
  await new Promise(res => srv.close(res));
  console.log('groq.test.js: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
