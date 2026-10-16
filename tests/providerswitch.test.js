/* One Course Builder, four providers: the same workflow (outline, full content, save and resume, regenerate,
   Repair with AI) on OpenAI, Gemini, Azure OpenAI and Groq; the same error words for every provider (temporary
   limit, used-up quota, rejected key, unusable model, request too large); and a run that pauses when its
   provider stops and continues, only with the parts still missing, on another provider the coordinator
   chose, in either direction, without touching any organisation setting and never switching on its own.
   The real server module, the real client (ai-client.js, ai-provider-ui.js, aiprovider-logic.js), the real
   Course Builder runner and the real content logic run here; only the four providers' HTTP endpoints are
   stubbed, each in its own wire format. Nothing reaches the network. Run: npm test */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), express = require('express');

process.env.SDC_AI_SECRETS_KEY = 'test-only-ai-secrets-key';
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SDC_ALLOW_LIVE', 'NODE_ENV', 'SDC_AI_MOCK', 'SDC_AI_LOCAL_OPEN',
  'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'AZURE_OPENAI_API_KEY', 'GROQ_API_KEY', 'GROQ_MODEL', 'SDC_QA_GROQ_BASE_URL', 'SDC_QA_GEMINI_BASE_URL']) delete process.env[k];
process.env.VERCEL = '1'; // the secrets and usage files go to the temp folder while the module loads
const ai = require('../backend/ai-api.js');
delete process.env.VERCEL;
const CC = require('../js/coursecontent-logic.js'), CK = require('../js/codecheck-logic.js'), CGL = require('../js/coursegen-logic.js'), APL = require('../js/aiprovider-logic.js');
const loadProviderUi = require('./support/provider-box.js');

const KEYS = { openai: 'sk-test-openai-KEY-0001', gemini: 'gem-test-KEY-0002', azure_openai: 'az-test-KEY-0003', groq: 'gsk_test_KEY_0004' };
const MODELS = { openai: 'gpt-test', gemini: 'gemini-test', azure_openai: 'azure-dep', groq: 'openai/gpt-oss-test' };
const URLS = { groq: 'https://api.groq.com/openai/v1', openai: 'https://api.openai.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta', azure_openai: 'https://azure-test.openai.azure.com' };
const GROQ_LIST = [{ id: 'openai/gpt-oss-test', owned_by: 'OpenAI', active: true, context_window: 131072, max_completion_tokens: 65536 }, { id: 'llama-test-70b', owned_by: 'Meta', active: true, context_window: 131072, max_completion_tokens: 32768 }];

/* --------------------------------------------- each provider's wire format */
const wireOk = {
  openai: (content, finish = 'stop') => ({ status: 200, json: { id: 'chatcmpl-o', model: 'gpt-test-2025', choices: [{ message: { role: 'assistant', content }, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } } }),
  azure_openai: (content, finish = 'stop') => ({ status: 200, json: { id: 'chatcmpl-a', choices: [{ message: { role: 'assistant', content }, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } } }),
  groq: (content, finish = 'stop') => ({ status: 200, json: { id: 'chatcmpl-g', model: 'openai/gpt-oss-test', choices: [{ message: { role: 'assistant', content }, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, total_time: 0.3 }, x_groq: { id: 'req_1' } } }),
  gemini: (content, finish = 'STOP') => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: content }] }, finishReason: finish }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } } })
};
const oaErr = (status, message, code, type = 'invalid_request_error', headers) => ({ status, json: { error: { message, type, code } }, headers });
const gemErr = (status, message, st, details = []) => ({ status, json: { error: { code: status, message, status: st, details } } });
const ERR = {
  openai: {
    quota: () => oaErr(429, 'You exceeded your current quota, please check your plan and billing details.', 'insufficient_quota', 'insufficient_quota'),
    rate: () => oaErr(429, 'Rate limit reached for gpt-test in organization org-x on requests per min (RPM): Limit 3, Used 3, Requested 1. Please try again in 20s.', 'rate_limit_exceeded', 'requests'),
    auth: () => oaErr(401, `Incorrect API key provided: ${KEYS.openai}. You can find your API key at https://platform.openai.com/account/api-keys.`, 'invalid_api_key'),
    model: () => oaErr(404, 'The model `gpt-test` does not exist or you do not have access to it.', 'model_not_found'),
    large: () => oaErr(400, "This model's maximum context length is 8192 tokens. However, your messages resulted in 20000 tokens.", 'context_length_exceeded'),
    leak: () => oaErr(500, `The server had an error for key ${KEYS.openai}`, 'server_error')
  },
  azure_openai: {
    quota: () => oaErr(429, 'Requests to the ChatCompletions_Create Operation under Azure OpenAI API version 2024-08-01-preview have exceeded token rate limit of your current OpenAI S0 pricing tier. Please retry after 86400 seconds.', '429', undefined, { 'retry-after': '86400' }),
    rate: () => oaErr(429, 'Requests to the ChatCompletions_Create Operation under Azure OpenAI API version 2024-08-01-preview have exceeded call rate limit of your current OpenAI S0 pricing tier. Please retry after 30 seconds.', '429', undefined, { 'retry-after': '30' }),
    auth: () => oaErr(401, 'Access denied due to invalid subscription key or wrong API endpoint. Make sure to provide a valid key for an active subscription and use a correct regional API endpoint for your resource.', '401'),
    model: () => oaErr(404, 'The API deployment for this resource does not exist. If you created the deployment within the last 5 minutes, please wait a moment and try again.', 'DeploymentNotFound'),
    large: () => oaErr(400, "This model's maximum context length is 8192 tokens. However, your messages resulted in 20000 tokens.", 'context_length_exceeded'),
    leak: () => oaErr(500, `The server had an error for key ${KEYS.azure_openai}`, 'server_error')
  },
  gemini: {
    quota: () => gemErr(429, 'You exceeded your current quota, please check your plan and billing details.', 'RESOURCE_EXHAUSTED', [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }]),
    rate: () => gemErr(429, 'You exceeded your current quota, please check your plan and billing details.', 'RESOURCE_EXHAUSTED', [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '20s' }]),
    auth: () => gemErr(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT', [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }]),
    model: () => gemErr(404, 'models/gemini-test is not found for API version v1beta, or is not supported for generateContent.', 'NOT_FOUND'),
    large: () => gemErr(400, 'The input token count (200000) exceeds the maximum number of tokens allowed (131072).', 'INVALID_ARGUMENT'),
    leak: () => gemErr(500, `Internal error for key ${KEYS.gemini}`, 'INTERNAL')
  },
  groq: {
    quota: () => oaErr(429, 'Rate limit reached for model `openai/gpt-oss-test` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199990, Requested 2000. Please try again in 12m3.5s.', 'rate_limit_exceeded'),
    rate: () => oaErr(429, 'Rate limit reached for model `openai/gpt-oss-test` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 2000. Please try again in 4.2s.', 'rate_limit_exceeded'),
    auth: () => oaErr(401, 'Invalid API Key', 'invalid_api_key'),
    model: () => oaErr(404, 'The model `openai/gpt-oss-test` does not exist or you do not have access to it.', 'model_not_found'),
    large: () => oaErr(413, 'Request too large for model `openai/gpt-oss-test` in organization `org_x` on tokens per minute (TPM): Limit 8000, Requested 20000.', 'rate_limit_exceeded'),
    leak: () => oaErr(500, `The server had an error for key ${KEYS.groq}`, 'server_error')
  }
};
const EXPECT = { quota: [503, 'provider_quota'], rate: [503, 'provider_busy'], auth: [502, 'provider_auth'], model: [502, 'provider_model'], large: [400, 'provider_too_large'] };

/* ------------------------------------------ what the providers "write" */
const FENCE = '`'.repeat(3), fenced = c => FENCE + 'python\n' + c + '\n' + FENCE;
const words = (k, w) => Array.from({ length: k }, (_, i) => w + (i % 9 ? '' : '.')).join(' ');
const PY = ['import pandas as pd\n\ndef clean(df):\n    if df.empty:\n        return df\n    df = df.drop_duplicates()\n    return df.fillna(df.mean()).reset_index()\n\nprint(clean(pd.DataFrame()).isnull().sum().sum())',
  'summary = (df.groupby("city")["salary"]\n           .agg(["mean", "max"])\n           .sort_values("mean", ascending=False)\n           .reset_index())\nprint(summary.head())',
  'for name, group in df.groupby("dept"):\n    total = 0\n    for _, row in group.iterrows():\n        if row["pay"] > 0:\n            total += row["pay"]\n    print(name, total)'];
const QUIZ_GOOD = Array.from({ length: 6 }, (_, i) => ({ question: 'Question ' + (i + 1) + '?', options: ['df.head()', 'df.info()', 'df.shape', 'plt.show()'], answer: i % 4, explanation: 'Because.' }));
const QUIZ_DAMAGED = QUIZ_GOOD.map(q => ({ ...q, options: ['df.head', 'df.info', 'df.shape', 'plt.show'] }));
let writes = 0; // every lesson differs a little, as real answers do, so a regeneration really changes the text
const answer = (kind, n) => {
  if (kind === 'lesson') return { objectives: ['Explain ' + n + ' (draft ' + (++writes) + ')', 'Build ' + n, 'Debug ' + n], prerequisites: ['The previous session'],
    timePlan: [{ minutes: 20, activity: 'Introduction' }, { minutes: 40, activity: 'Concepts' }, { minutes: 10, activity: 'Break' }, { minutes: 50, activity: 'Practice' }],
    lesson: [0, 1, 2, 3].map(i => ({ heading: 'Part ' + (i + 1) + ' of session ' + n, body: words(60, 'explain'), example: 'Worked example:\n\n' + fenced(PY[i % 3]) + '\n\nRun it.' })), keyTerms: [{ term: 'DataFrame', meaning: 'A table.' }] };
  if (kind === 'practice') return { codeRelevant: true, tutorials: [{ title: 'Tutorial', goal: 'Follow along', steps: ['Open the editor.', 'Type the code:\n' + fenced(PY[0]), 'Run it.', 'Change one value.'] }],
    codeExamples: [0, 1, 2].map(i => ({ title: 'Example ' + (i + 1), language: 'python', code: PY[i], explanation: 'Read it line by line.' })),
    demos: [{ title: 'Demo', description: 'Show it live.', steps: ['a', 'b', 'c'] }], guided: [0, 1].map(i => ({ title: 'Guided ' + (i + 1), instructions: 'Write it with help.', steps: ['a', 'b', 'c'], hint: 'Start small.', solution: fenced(PY[i]) })),
    practice: [{ title: 'Task', task: 'Do it alone.', criteria: ['It runs', 'It is tidy'] }] };
  return { homework: { title: 'Homework ' + n, brief: words(40, 'brief'), deliverables: ['script'], rubric: [{ criterion: 'Works', marks: 6 }, { criterion: 'Clean', marks: 4 }], maxMarks: 10, estimatedHours: 2 },
    quiz: QUIZ_GOOD, teacherNotes: ['Prepare the data file.'], resources: [{ title: 'Official documentation', type: 'documentation', note: 'Reference.' }] };
};
const kindOf = sys => (/curriculum designer/.test(sys) ? 'outline' : /REPAIR it\. You are not writing new material/.test(sys) ? 'repair' : /Write the LESSON part/.test(sys) ? 'lesson' : /Write the PRACTICE part/.test(sys) ? 'practice' : /Write the ASSESS/i.test(sys) || /homework/i.test(sys) ? 'assess' : 'other');
const numOf = p => Number((/THIS SESSION: number (\d+)/.exec(p) || [])[1]);
const fixDf = v => (typeof v === 'string' ? v.replace(/\b(df\.(?:head|info))\b(?!\()/g, '$1()') : Array.isArray(v) ? v.map(fixDf) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fixDf(x)])) : v);
function write(sys, prompt) { // what any provider would answer: the same for all four, so the workflow is what is compared
  const kind = kindOf(sys);
  if (kind === 'outline') return JSON.stringify(CGL.mockOutline(prompt));
  if (kind === 'repair') { const fields = {}; prompt.split(/^### "/m).slice(1).forEach(b => { const key = b.slice(0, b.indexOf('"')); try { fields[key] = JSON.parse(b.split('\n')[1]); } catch (e) { /* unreadable: left out */ } }); return JSON.stringify(fixDf(fields)); }
  if (kind === 'other') return 'OK';
  return JSON.stringify(answer(kind, numOf(prompt)));
}

const cleaner = { run: async () => {} }; // removes the stand-in profiles from the shared temp secrets file, also when a check fails
(async () => {
  /* ----------------------------------------------------------- harness */
  const app = express(); app.use(ai);
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const realFetch = global.fetch;
  const sent = [];                                   // every request that would have left this machine
  const ctl = {};                                    // provider -> { ok: calls still answered, fail: error kind after that, leak }
  const calls = { openai: 0, gemini: 0, azure_openai: 0, groq: 0 };
  const log = [];                                    // "provider:kind:n" in the order the requests came
  const reset = (over = {}) => { for (const p of Object.keys(KEYS)) ctl[p] = { ok: Infinity, fail: 'quota', ...(over[p] || {}) }; };
  reset();
  const hostOf = url => (url.startsWith(URLS.groq) ? 'groq' : url.startsWith(URLS.openai) ? 'openai' : url.startsWith(URLS.gemini) ? 'gemini' : url.startsWith(URLS.azure_openai) ? 'azure_openai' : '');
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith(BASE)) return realFetch(url, opts);
    const p = hostOf(url), body = opts.body ? JSON.parse(opts.body) : null;
    sent.push({ provider: p, url, headers: opts.headers || {}, body });
    let r;
    if (!p) r = { status: 599, json: { error: { message: 'unexpected host ' + url } } };
    else if (url === URLS.groq + '/models') r = { status: 200, json: { object: 'list', data: GROQ_LIST } };
    else {
      const sys = p === 'gemini' ? body.systemInstruction?.parts?.[0]?.text || '' : body.messages[0].content;
      const prompt = p === 'gemini' ? body.contents[0].parts[0].text : body.messages.at(-1).content;
      const kind = kindOf(sys);
      if (ctl[p].ok <= 0) r = ERR[p][ctl[p].fail]();
      else {
        ctl[p].ok--; calls[p]++; log.push(`${p}:${kind}:${numOf(prompt) || ''}`);
        r = wireOk[p](write(sys, prompt), ctl[p].finish);
      }
    }
    const h = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return { ok: r.status < 400, status: r.status, headers: { get: k => h[String(k).toLowerCase()] ?? null }, json: async () => r.json };
  };
  const call = async (p, body, token, method = 'POST') => { const r = await realFetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const signIn = async id => (await call('/api/ai/auth', { userId: id })).body.token;   // 60 ordinary / 300 course requests an hour per person: each part signs in as its own person
  const profiles = {};
  const admin = await signIn('U-admin');
  // a run that stopped half-way may have left profiles in the temp secrets file: start clean
  for (const old of (await call('/api/ai/status', null, null, 'GET')).body.profiles || []) await call('/api/ai/configure', { provider: old.provider, profileId: old.id, remove: true }, admin);
  for (const [provider, extra] of [['openai', {}], ['gemini', {}], ['azure_openai', { endpoint: URLS.azure_openai, deployment: MODELS.azure_openai, apiVersion: '2024-08-01-preview' }], ['groq', {}]]) {
    const r = await call('/api/ai/configure', { provider, name: provider + ' key', apiKey: KEYS[provider], model: MODELS[provider], ...extra }, admin);
    assert.equal(r.status, 200, JSON.stringify(r.body)); profiles[provider] = r.body.profile.id;
  }
  cleaner.run = async () => { for (const p of Object.keys(profiles)) await call('/api/ai/configure', { provider: p, profileId: profiles[p], remove: true }, admin); };
  const status = async () => (await call('/api/ai/status', null, null, 'GET')).body;
  const st0 = await status();
  assert.deepEqual(st0.profiles.map(p => p.provider).sort(), ['azure_openai', 'gemini', 'groq', 'openai'], 'all four providers are configured');
  assert.ok(!JSON.stringify(st0).includes('KEY-000') && !JSON.stringify(st0).includes('gsk_test'), 'the status the browser sees holds no key');

  /* ------------------------------------------ A. the same words for every provider */
  let token = await signIn('U-a');
  const complete = (provider, body = {}) => call('/api/ai/complete', { prompt: 'hi', feature: 'courseContent', provider, profileId: profiles[provider], noFallback: true, ...body }, token);
  const KINDS = ['quota', 'rate', 'auth', 'model', 'large'];
  for (const p of Object.keys(KEYS)) {
    for (const kind of KINDS) {
      reset({ [p]: { ok: 0, fail: kind } });
      const r = await complete(p);
      assert.deepEqual([r.status, r.body.code], EXPECT[kind], `${p} ${kind}: same status and code for every provider (got ${r.status} ${r.body.code} ${r.body.error})`);
      assert.equal(r.body.provider, p, `${p} ${kind}: the answer names the provider that failed`);
      assert.ok(!JSON.stringify(r.body).includes(KEYS[p]), `${p} ${kind}: the key is not in the answer`);
      if (kind === 'rate') assert.ok(r.body.retryAfterMs >= 5000 && r.body.retryAfterMs <= 120000, `${p}: a temporary limit says how long to wait (${r.body.retryAfterMs})`);
      if (kind === 'quota') assert.ok(!r.body.retryAfterMs || r.body.retryAfterMs >= 5000);
      if (kind === 'model') assert.match(r.body.error, /not available for this API key/, `${p}: the model problem is in words`);
      if (kind === 'auth') assert.match(r.body.error, /rejected the API key/);
    }
    reset({ [p]: { ok: 0, fail: 'leak' } });
    const leak = await complete(p);
    assert.equal(leak.status, 502); assert.ok(!JSON.stringify(leak.body).includes(KEYS[p]), `${p}: a key echoed by the provider is removed from the error`); assert.match(leak.body.error, /\[key\]/);
  }
  // a used-up quota is told apart from a temporary limit, for each provider, in the words the pause panel uses
  assert.equal(APL.explain({ code: 'provider_quota', provider: 'gemini' }).kind, 'quota');
  assert.equal(APL.explain({ code: 'provider_busy', provider: 'gemini' }).kind, 'rate');
  assert.deepEqual([APL.kindOf('provider_quota').retry, APL.kindOf('provider_auth').retry, APL.kindOf('provider_busy').retry], [true, false, true], 'retrying helps for a limit, not for a rejected key');
  assert.deepEqual(['rate_limit', 'budget', 'unauthorized', 'forbidden'].map(c => APL.kindOf(c).swap), [false, false, false, false], 'another provider does not help when the platform, the budget or the person is the limit');

  /* ----------------------------- B. the same result shape, JSON mode, truncation, usage */
  reset(); sent.length = 0;
  const shapes = {};
  for (const p of Object.keys(KEYS)) {
    const r = await complete(p, { json: true, maxTokens: 500 });
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.body)}`);
    shapes[p] = r.body;
    assert.deepEqual(Object.keys(r.body).filter(k => ['text', 'model', 'provider', 'tokens', 'usage', 'truncated'].includes(k)).sort(), ['model', 'provider', 'text', 'tokens', 'truncated', 'usage'], `${p}: one result shape`);
    assert.deepEqual([r.body.provider, r.body.tokens, r.body.truncated, r.body.usage.input, r.body.usage.output], [p, 150, false, 100, 50], `${p}: normalised provider, tokens, stop reason and usage`);
    const b = sent.filter(x => x.provider === p && x.body && !x.url.endsWith('/models')).at(-1).body;
    if (p === 'gemini') assert.equal(b.generationConfig.responseMimeType, 'application/json', 'Gemini JSON mode'); else assert.deepEqual(b.response_format, { type: 'json_object' }, `${p}: JSON mode`);
    ctl[p].finish = p === 'gemini' ? 'MAX_TOKENS' : 'length';
    assert.equal((await complete(p, { json: true })).body.truncated, true, `${p}: a cut-off answer is flagged the same way`);
    delete ctl[p].finish;
  }
  assert.equal(shapes.azure_openai.model, MODELS.azure_openai, 'Azure reports its deployment as the model');
  // a model that does not write text is refused the same way before anything is sent
  for (const [p, m] of [['openai', 'text-embedding-3-small'], ['gemini', 'imagen-3'], ['azure_openai', 'whisper-1'], ['groq', 'whisper-large-v3']]) {
    const n = sent.length, r = await complete(p, { model: m });
    assert.deepEqual([r.status, r.body.code], [400, 'provider_model'], `${p}: ${m}`); assert.match(r.body.error, /does not write text/); assert.equal(sent.length, n, 'nothing was sent');
  }
  // an option the model does not accept (JSON mode) is dropped once, the answer is still checked by the page
  let rejected = 0; const origCtl = ctl.openai;
  const before = global.fetch;
  global.fetch = async (url, opts = {}) => { const b = opts.body && String(url).startsWith(URLS.openai) ? JSON.parse(opts.body) : null; if (b?.response_format && !rejected++) return { ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: { message: "'response_format' of type 'json_object' is not supported with this model.", code: 'invalid_value' } }) }; return before(url, opts); };
  const rf = await complete('openai', { json: true });
  assert.equal(rf.status, 200); assert.equal(rejected, 1, 'one corrected request without JSON mode'); global.fetch = before; ctl.openai = origCtl;
  // course writing has its own hourly allowance; everything else keeps 60
  const burst = await signIn('U-burst'); let lastStatus = 0;
  for (let i = 0; i < 62; i++) lastStatus = (await call('/api/ai/complete', { prompt: 'hi', feature: 'courseContent', provider: 'openai', profileId: profiles.openai }, burst)).status;
  assert.equal(lastStatus, 200, '62 course-content requests in an hour are fine (a course is hundreds)');
  for (let i = 0; i < 61; i++) lastStatus = (await call('/api/ai/complete', { prompt: 'hi', feature: 'tutor', provider: 'openai', profileId: profiles.openai }, burst)).status;
  assert.equal(lastStatus, 429, 'other AI features still stop at 60 an hour');

  /* --------------------------- C. the browser: real client, real runner, stubbed providers */
  const store = {};
  const ctx = {
    console, URL, URLSearchParams, Intl, Blob: class {}, Event: class { constructor(t) { this.type = t; } }, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; return a; } },
    document: { querySelector: () => null }, location: {}, fetch: (u, o) => realFetch(String(u).startsWith('/') ? BASE + u : u, o)
  };
  ctx.window = ctx; ctx.window.addEventListener = () => {}; ctx.window.dispatchEvent = () => {};
  vm.createContext(ctx);
  vm.runInContext(['seed.js', 'migrations.js', 'shared-rules.js', 'core.js', 'ai-client.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join(';\n') + ';globalThis.__x={db,saveDB,Domain,invalidateCache}', ctx, { filename: 'core-bundle.js' });
  const { db, saveDB, Domain, invalidateCache } = ctx.__x;
  ctx.can = () => true;
  { const d = db(); d.settings.integrations.budget = { ...d.settings.integrations.budget, maxCalls: 0, hardStop: false }; saveDB(d); } // the monthly budget is not what this test is about (the usage file in the temp folder grows with every run)
  const setInteg = patch => { const d = db(); Object.assign(d.settings.integrations, patch); saveDB(d); };
  const setCap = (name, v) => { const d = db(); d.settings.integrations.capabilities[name] = { ...d.settings.integrations.capabilities[name], ...v }; saveDB(d); };
  const settingsNow = () => JSON.stringify(db().settings.integrations);

  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const data = { courses: [], sessions: [] };
  let failSave = 0, sessionMem = {};
  const box = {
    CourseContentLogic: CC, CodeCheckLogic: CK, console, Map, Set, Promise, Date, JSON, Math, Number, String, Object, Array, Error,
    setTimeout: fn => setImmediate(fn), clearTimeout() {}, window: { addEventListener() {} },
    sessionStorage: { getItem: k => sessionMem[k] ?? null, setItem: (k, v) => { sessionMem[k] = String(v); }, removeItem: k => { delete sessionMem[k]; } },
    t: x => x, esc, clone: v => JSON.parse(JSON.stringify(v)), icon: () => '', badge: x => '[' + x + ']', kind: () => 'staff',
    findRecord: (k, id) => data[k].find(x => x.id === id),
    updateRecord: (k, id, patch) => { if (failSave > 0) { failSave--; throw new Error('QuotaExceededError'); } const i = data[k].findIndex(x => x.id === id); data[k][i] = JSON.parse(JSON.stringify({ ...data[k][i], ...patch, id })); return data[k][i]; },
    Domain: { courseSessions: id => data.sessions.filter(s => s.courseId === id).sort((a, b) => a.order - b.order), canManageCourse: () => true, aiCapRoute: n => Domain.aiCapRoute(n), integrations: () => Domain.integrations(), aiEnabled: () => true },
    SDCAI: { call: (f, o) => ctx.SDCAI.call(f, o), status: () => ctx.SDCAI.status() }
  };
  vm.createContext(box);
  loadProviderUi(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'pages-coursecontent.js'), 'utf8') + '\n;this.TCRun = TCRun;', box);
  const { TCRun, AIRoute } = box;
  const finished = id => new Promise(res => { const off = TCRun.on(run => { if (run.courseId === id && !run.active) { off(); res(run); } }); });
  const sessionsOf = id => data.sessions.filter(s => s.courseId === id).sort((a, b) => a.order - b.order);
  const addCourse = (id, n) => {
    data.courses.push({ id, title: 'Python for Data Analysis ' + id, level: 'Beginner', description: 'Pandas and plots.', outcomes: ['Clean data'], aiMeta: { coverage: [] } });
    for (let i = 1; i <= n; i++) data.sessions.push({ id: id + '-S' + i, courseId: id, order: i, title: 'Session ' + i, summary: 'Summary ' + i, moduleName: 'M1', duration: '2h' });
    return sessionsOf(id);
  };
  const missingJobs = id => box.tcResumeJobs(data.courses.find(c => c.id === id), null, sessionsOf(id));
  const optionFor = async (provider) => APL.options(await status()).find(o => o.provider === provider && o.usable);
  const partsBy = (id, provider) => sessionsOf(id).flatMap(s => CC.PARTS.filter(p => s.content?.meta?.parts?.[p]?.provider === provider).map(p => s.id + ':' + p));
  const useToken = async id => { store.sdcCloudToken = await signIn(id); };

  // C1. the identical workflow on every provider: outline, full content, regenerate, Repair with AI
  for (const p of ['openai', 'gemini', 'azure_openai', 'groq']) {
    await useToken('U-flow-' + p); reset();
    const cid = 'C-' + p, label = APL.label(p), sBefore = settingsNow();
    const sess = addCourse(cid, 3);
    AIRoute.set(cid, await optionFor(p));
    assert.equal(AIRoute.resolve(cid, 'courseContent').source, 'temporary'); assert.equal(AIRoute.resolve(cid, 'courseContent').provider, p);
    // outline (Generate Course Outline): the same call the outline page makes
    const out = await CGL.generate(o => AIRoute.call(cid, 'courseGenerate', { ...o, timeoutMs: 58000 }), { topic: 'Python', audience: 'Analysts', level: 'Beginner', programType: 'Short Course', delivery: 'Online', weeks: 2, perWeek: 2, hours: 2 }, {});
    assert.ok(out.ok, `${p}: outline ${out.message}`); assert.equal(out.meta.provider, p, `${p}: the outline records who wrote it`);
    assert.equal(CGL.countSessions(out.outline), 4);
    // full content generation: every missing part
    const snap = { ...calls }, n0 = calls[p]; TCRun.start(cid, missingJobs(cid)); let run = await finished(cid);
    assert.ok(!run.fatal && !run.pause, `${p}: ${run.fatal}`);
    assert.equal(partsBy(cid, p).length, 9, `${p}: all 9 parts written by ${label}`);
    assert.equal(calls[p] - n0, 9, `${p}: one request per part`);
    for (const k of Object.keys(KEYS)) if (k !== p) assert.equal(calls[k], snap[k], `${p}: no other provider (${k}) received a request`);
    sessionsOf(cid).forEach(s => { assert.equal(CC.sessionState(s).status, 'complete'); CC.PARTS.forEach(part => { const m = s.content.meta.parts[part]; assert.deepEqual([m.provider, m.tokens > 0], [p, true], `${p}: part records provider and tokens`); assert.ok(m.model, `${p}: and the model`); }); });
    assert.deepEqual(APL.writers(sessionsOf(cid)).map(w => [w.provider, w.parts, w.sessions]), [[p, 9, 3]], `${p}: who wrote what`);
    // Generate again: nothing is missing, so nothing is asked
    const n1 = calls[p]; assert.deepEqual(missingJobs(cid), []); assert.equal(calls[p], n1);
    // regenerate one part (replaces, keeps the old text in the history)
    const s1 = sessionsOf(cid)[0], was = JSON.stringify(s1.content.objectives);
    TCRun.start(cid, [{ sessionId: s1.id, parts: ['lesson'], repairParts: ['lesson'] }]); run = await finished(cid);
    assert.ok(!run.fatal); assert.equal(CC.historyOf(sessionsOf(cid)[0].content)[0].provider, p, `${p}: the history says who wrote the new text`);
    // Repair with AI, on a damaged quiz, on this provider
    const dmg = sessionsOf(cid)[1]; box.updateRecord('sessions', dmg.id, { content: { ...dmg.content, quiz: QUIZ_DAMAGED } });
    const cBefore = JSON.stringify(sessionsOf(cid)[1].content.quiz);
    TCRun.start(cid, [{ sessionId: dmg.id, parts: ['assess'], instructions: 'The options lost their ().', repairKeys: { assess: ['quiz'] }, repairParts: ['assess'], proposeParts: ['assess'] }]); run = await finished(cid);
    assert.ok(!run.fatal, p + ' ' + run.fatal);
    const after = sessionsOf(cid)[1], pend = CC.pendingOf(after.content);
    assert.equal(JSON.stringify(after.content.quiz), cBefore, `${p}: the quiz is not touched by the proposal`);
    assert.deepEqual([pend.length, pend[0].provider, pend[0].scope], [1, p, ['quiz']], `${p}: a proposal from ${label}, limited to the chosen field`);
    const chg = CC.proposalChanges(after.content, pend[0]).find(x => x.key === 'quiz');
    assert.equal(chg.change, 'changed'); assert.equal(chg.after[0].options[0], 'df.head()');
    // accept: approval is withdrawn, history keeps the old text and who proposed it, restore works
    const approved = CC.applyEdit(after.content, {}, 'U', '2026-10-17T09:00:00Z').content; approved.meta = { ...approved.meta, approved: { by: 'U', at: '2026-10-17T09:00:00Z' } };
    box.updateRecord('sessions', dmg.id, { content: approved });
    const acc = CC.applyProposal(sessionsOf(cid)[1].content, CC.pendingOf(sessionsOf(cid)[1].content)[0], ['quiz'], { by: 'U-coord', at: '2026-10-17T09:05:00Z' });
    assert.equal(acc.content.meta.approved, undefined, `${p}: applying a repair withdraws approval`); assert.equal(acc.content.quiz[0].options[0], 'df.head()');
    const h = CC.historyOf(acc.content)[0]; assert.deepEqual([h.kind, h.provider], ['repair', p]);
    assert.equal(CC.restoreEntry(acc.content, h.id, { at: '2026-10-17T09:10:00Z' }).content.quiz[0].options[0], 'df.head', `${p}: restore puts the old text back`);
    assert.equal(settingsNow(), sBefore, `${p}: the organisation settings are exactly as they were`);
    AIRoute.clear(cid);
  }
  console.log('providerswitch: C1 identical workflow on four providers ok');

  /* C2. Gemini runs out of quota part-way through a 12-session course; the coordinator switches to Groq in the
         Course Builder; only the missing parts are written; nothing is lost; settings are untouched.
         The organisation's fallback provider is Groq: it must still not be used on its own. */
  await useToken('U-switch-1'); reset({ gemini: { ok: 10, fail: 'quota' } }); log.length = 0;
  for (const k of Object.keys(calls)) calls[k] = 0;
  setCap('courseGenerate', { provider: 'gemini', profileId: profiles.gemini, model: '' });
  setInteg({ fallbackProvider: 'groq', primaryProvider: 'gemini' });
  const S1 = 'C-SW', sw = addCourse(S1, 12), settingsBefore = settingsNow();
  assert.equal(Domain.aiCapRoute('courseContent').provider, 'gemini', 'by Settings, Gemini writes this course');
  TCRun.start(S1, missingJobs(S1));
  let run = await finished(S1);
  assert.equal(run.pause?.code, 'provider_quota', 'the run paused on the used-up quota: ' + run.fatal);
  assert.equal(run.pause.provider, 'gemini'); assert.equal(run.active, false);
  assert.equal(calls.groq, 0, 'the organisation fallback (Groq) was NOT used on its own');
  assert.equal(calls.gemini, 10, 'ten parts written before the quota ran out');
  assert.equal(partsBy(S1, 'gemini').length, 10);
  const written = partsBy(S1, 'gemini'), snapshot = JSON.stringify(sessionsOf(S1).map(s => s.content));
  // what the page shows: a clear title, the saved progress, the providers that can take over
  const pause = box.tcPauseOf(run, sessionsOf(S1));
  assert.equal(pause.kind, 'quota'); assert.match(pause.title, /Gemini's quota is used up/); assert.deepEqual([pause.canSwap, pause.canRetry], [true, true]);
  const opts = APL.options(await status(), { stopped: { provider: 'gemini', profileId: '', model: pause.model } });
  assert.deepEqual(opts.filter(o => o.usable).map(o => o.provider).sort(), ['azure_openai', 'groq', 'openai'], 'configured, compatible providers are offered; the stopped one is not');
  assert.equal(opts.find(o => o.provider === 'gemini').current, true);
  // the same pause is found again after a reload (no run in memory): from what is stored with the parts
  const fromStore = box.tcPauseOf(null, sessionsOf(S1));
  assert.deepEqual([fromStore.code, fromStore.provider, fromStore.kind], ['provider_quota', 'gemini', 'quota'], 'it survives a reload');
  assert.ok(fromStore.partsLeft > 0 && fromStore.partsDone === 10, 'with the progress: ' + JSON.stringify([fromStore.partsDone, fromStore.partsLeft]));
  // a person writes a part that is still missing while the course is paused: it must not be overwritten
  const lateSess = sessionsOf(S1).find(s => CC.sessionState(s).missing.includes('assess') && CC.sessionState(s).done.length === 0) || sessionsOf(S1).at(-1);
  const mine = CC.applyEdit(lateSess.content || {}, { teacherNotes: ['Written by a person'] }, 'U-coord', '2026-10-17T10:00:00Z');
  box.updateRecord('sessions', lateSess.id, { content: mine.content });
  assert.ok(CC.sessionState(sessionsOf(S1).find(s => s.id === lateSess.id)).done.includes('assess'), 'the person\'s edit counts as written');
  // switching: an explicit choice, kept in the browser tab only
  const groq = await optionFor('groq');
  assert.equal(AIRoute.get(S1), null, 'no temporary choice until the coordinator makes one');
  AIRoute.set(S1, groq);
  assert.deepEqual([AIRoute.resolve(S1, 'courseContent').provider, AIRoute.resolve(S1, 'courseContent').source], ['groq', 'temporary']);
  assert.equal(settingsNow(), settingsBefore, 'Settings → Integrations is unchanged by the switch');
  assert.equal(Domain.aiCapRoute('courseContent').provider, 'gemini', 'the organisation route still says Gemini');
  const jobs = box.tcResumeJobs(data.courses.find(c => c.id === S1), run, sessionsOf(S1)), left = jobs.reduce((n, j) => n + j.parts.length, 0);
  assert.equal(left, 36 - 10 - 1, 'only what is not written: 36 parts - 10 by Gemini - 1 by a person');
  assert.ok(!jobs.some(j => j.sessionId === lateSess.id && j.parts.includes('assess')), 'the person\'s part is not in the job list');
  // after a reload there is no run in memory: the same list is worked out from what is stored
  const reloaded = box.tcResumeJobs(data.courses.find(c => c.id === S1), null, sessionsOf(S1));
  assert.equal(reloaded.reduce((n, j) => n + j.parts.length, 0), left, 'a reload finds the same parts to write');
  assert.ok(!reloaded.some(j => j.sessionId === lateSess.id && j.parts.includes('assess')) && reloaded.every(j => j.fill.length === j.parts.length), 'never the person\'s part, and every part is fill-only');
  log.length = 0;
  TCRun.start(S1, jobs); run = await finished(S1);
  assert.ok(!run.fatal && !run.pause, 'resumed to the end: ' + run.fatal);
  assert.equal(calls.gemini, 10, 'Gemini was not asked again'); assert.equal(calls.groq, left, 'Groq wrote exactly the remaining parts, once each');
  assert.equal(new Set(log).size, log.length, 'no part was requested twice');
  // nothing written before the switch changed, and the person\'s part is intact
  const nowSess = sessionsOf(S1), was = JSON.parse(snapshot);
  nowSess.forEach((s, i) => CC.PARTS.forEach(part => { if (written.includes(s.id + ':' + part)) { CC.FIELDS_OF(part).forEach(k => assert.deepEqual(s.content[k], was[i][k], `${s.id} ${part}.${k} written by Gemini is unchanged`)); assert.deepEqual(s.content.meta.parts[part], was[i].meta.parts[part], 'with its provider record'); } }));
  assert.deepEqual(nowSess.find(s => s.id === lateSess.id).content.teacherNotes, ['Written by a person'], 'the person\'s edit is intact');
  assert.equal(partsBy(S1, 'gemini').length, 10); assert.equal(partsBy(S1, 'groq').length, left);
  assert.ok(nowSess.every(s => CC.sessionState(s).status === 'complete'), 'the course is complete');
  assert.deepEqual(APL.writers(nowSess).map(w => [w.provider, w.model, w.parts]).sort(), [['gemini', 'gemini-test', 10], ['groq', 'openai/gpt-oss-test', left]].sort(), 'each part says which provider and model wrote it');
  assert.equal(settingsNow(), settingsBefore, 'settings are still exactly as they were');
  assert.equal(box.tcPauseOf(null, sessionsOf(S1)), null, 'no pause is shown for a finished course');
  AIRoute.clear(S1); assert.equal(AIRoute.resolve(S1, 'courseContent').source, 'settings', 'back to the Settings choice');
  console.log('providerswitch: C2 Gemini -> Groq ok (' + 10 + ' + ' + left + ' parts)');

  /* C3. the other direction: Groq stops, Gemini continues; and Retry, rate limits, rejected key, unusable model */
  await useToken('U-switch-2'); reset({ groq: { ok: 7, fail: 'quota' } }); for (const k of Object.keys(calls)) calls[k] = 0;
  const S2 = 'C-RV'; addCourse(S2, 6);
  AIRoute.set(S2, await optionFor('groq'));
  TCRun.start(S2, missingJobs(S2)); run = await finished(S2);
  assert.equal(run.pause?.code, 'provider_quota'); assert.equal(run.pause.provider, 'groq'); assert.equal(calls.groq, 7);
  assert.equal(calls.gemini, 0, 'Gemini (the organisation\'s primary) was not used on its own');
  // Retry the same provider while it is still out of quota: one request is refused, the run pauses again, no part is lost
  const doneBeforeRetry = partsBy(S2, 'groq').length;
  TCRun.start(S2, box.tcResumeJobs(data.courses.find(c => c.id === S2), run, sessionsOf(S2))); run = await finished(S2);
  assert.equal(run.pause?.code, 'provider_quota', 'still out of quota: paused again'); assert.equal(partsBy(S2, 'groq').length, doneBeforeRetry);
  // Retry after the quota came back: continues with the same provider, only what is missing
  ctl.groq.ok = 4;
  TCRun.start(S2, box.tcResumeJobs(data.courses.find(c => c.id === S2), run, sessionsOf(S2))); run = await finished(S2);
  assert.equal(run.pause?.code, 'provider_quota'); assert.equal(partsBy(S2, 'groq').length, doneBeforeRetry + 4, 'the retry wrote four more parts with the same provider');
  // now switch to Gemini (the reverse direction) and finish
  const sB = settingsNow();
  AIRoute.set(S2, await optionFor('gemini'));
  TCRun.start(S2, box.tcResumeJobs(data.courses.find(c => c.id === S2), run, sessionsOf(S2))); run = await finished(S2);
  assert.ok(!run.fatal && !run.pause, run.fatal);
  assert.equal(partsBy(S2, 'groq').length, doneBeforeRetry + 4); assert.equal(partsBy(S2, 'gemini').length, 18 - doneBeforeRetry - 4, 'Gemini wrote the rest');
  assert.ok(sessionsOf(S2).every(s => CC.sessionState(s).status === 'complete')); assert.equal(settingsNow(), sB);
  console.log('providerswitch: C3 Groq -> Gemini ok');

  // C4. a temporary limit (not a used-up quota): waits as asked, then pauses as "rate", and retry works later
  await useToken('U-rate'); reset({ gemini: { ok: 2, fail: 'rate' } });
  const S3 = 'C-RATE'; addCourse(S3, 3); AIRoute.set(S3, await optionFor('gemini'));
  TCRun.start(S3, missingJobs(S3)); run = await finished(S3);
  assert.equal(run.pause?.code, 'provider_busy'); const rp = box.tcPauseOf(run, sessionsOf(S3));
  assert.deepEqual([rp.kind, rp.canRetry, rp.canSwap], ['rate', true, true]); assert.match(rp.title, /limiting requests right now/); assert.doesNotMatch(rp.title, /quota/);
  reset(); TCRun.start(S3, box.tcResumeJobs(data.courses.find(c => c.id === S3), run, sessionsOf(S3))); run = await finished(S3);
  assert.ok(!run.pause && sessionsOf(S3).every(s => CC.sessionState(s).status === 'complete'), 'retrying after the limit lifted finishes the course');

  // C5. a rejected key: retrying cannot help, another provider can
  await useToken('U-auth'); reset({ openai: { ok: 1, fail: 'auth' } });
  const S4 = 'C-AUTH'; addCourse(S4, 2); AIRoute.set(S4, await optionFor('openai'));
  TCRun.start(S4, missingJobs(S4)); run = await finished(S4);
  const ap = box.tcPauseOf(run, sessionsOf(S4));
  assert.deepEqual([run.pause.code, ap.kind, ap.canRetry, ap.canSwap], ['provider_auth', 'auth', false, true]); assert.match(ap.title, /OpenAI rejected the API key/);
  AIRoute.set(S4, await optionFor('azure_openai'));
  TCRun.start(S4, box.tcResumeJobs(data.courses.find(c => c.id === S4), run, sessionsOf(S4))); run = await finished(S4);
  assert.ok(!run.pause && sessionsOf(S4).every(s => CC.sessionState(s).status === 'complete'));
  assert.ok(partsBy(S4, 'azure_openai').length >= 5, 'Azure OpenAI continued');

  // C6. an unusable model (retired, or no access): the same pause, with the model named, then another provider
  await useToken('U-model'); reset({ gemini: { ok: 0, fail: 'model' } });
  const S5 = 'C-MODEL'; addCourse(S5, 2); AIRoute.set(S5, await optionFor('gemini'));
  TCRun.start(S5, missingJobs(S5)); run = await finished(S5);
  assert.equal(run.pause?.code, 'provider_model'); assert.match(run.pause.message, /gemini-test/); assert.equal(box.tcPauseOf(run, sessionsOf(S5)).kind, 'model');
  AIRoute.set(S5, await optionFor('groq')); reset();
  TCRun.start(S5, box.tcResumeJobs(data.courses.find(c => c.id === S5), run, sessionsOf(S5))); run = await finished(S5);
  assert.ok(!run.pause && partsBy(S5, 'groq').length === 6 && sessionsOf(S5).every(s => CC.sessionState(s).status === 'complete'), 'another provider finished it');
  console.log('providerswitch: C4-C6 rate limit, rejected key, unusable model ok');

  // C7. a provider that stops answering at all: three failed requests in a row pause the run
  await useToken('U-down'); reset({ groq: { ok: 0, fail: 'leak' } });
  const S6 = 'C-DOWN'; addCourse(S6, 4); AIRoute.set(S6, await optionFor('groq'));
  TCRun.start(S6, missingJobs(S6)); run = await finished(S6);
  assert.equal(run.pause?.code, 'provider_unavailable'); assert.match(run.fatal, /did not answer \d+ requests in a row/);
  assert.equal(box.tcPauseOf(run, sessionsOf(S6)).kind, 'down');

  // C8. no automatic switch without consent: every route above was explicit. With a fallback configured and no
  //     temporary choice, a stopped provider still stops the run.
  await useToken('U-nofb'); reset({ gemini: { ok: 1, fail: 'quota' } }); for (const k of Object.keys(calls)) calls[k] = 0;
  setInteg({ fallbackProvider: 'openai', primaryProvider: 'gemini' });
  const S7 = 'C-NOFB', s7 = sent.length; addCourse(S7, 3); AIRoute.clear(S7);
  TCRun.start(S7, missingJobs(S7)); run = await finished(S7);
  assert.equal(run.pause?.code, 'provider_quota'); assert.deepEqual([calls.openai, calls.groq, calls.azure_openai], [0, 0, 0], 'no other provider received a request');
  assert.ok(sent.slice(s7).every(x => x.provider === 'gemini'), 'every request that left went to Gemini');

  // C9. repair stops on a provider too, and resumes on another one as a repair
  await useToken('U-rep'); reset({ gemini: { ok: 0, fail: 'quota' } });
  const S8 = 'C-REP', rs = addCourse(S8, 1); AIRoute.set(S8, await optionFor('groq')); TCRun.start(S8, missingJobs(S8)); await finished(S8);
  AIRoute.set(S8, await optionFor('gemini'));
  const rsess = sessionsOf(S8)[0]; box.updateRecord('sessions', rsess.id, { content: { ...rsess.content, quiz: QUIZ_DAMAGED } });
  TCRun.start(S8, [{ sessionId: rsess.id, parts: ['assess'], repairKeys: { assess: ['quiz'] }, repairParts: ['assess'], proposeParts: ['assess'] }]); run = await finished(S8);
  assert.equal(run.pause?.code, 'provider_quota'); assert.equal(CC.pendingOf(sessionsOf(S8)[0].content).length, 0, 'no proposal');
  assert.match(sessionsOf(S8)[0].content.meta.repairs.errors.assess.message, /No other provider was tried/);
  const rj = box.tcResumeJobs(data.courses.find(c => c.id === S8), run, sessionsOf(S8));
  assert.deepEqual([rj.length, rj[0].repairKeys, rj[0].proposeParts], [1, { assess: ['quiz'] }, ['assess']], 'it resumes as the same repair, not as new generation');
  AIRoute.set(S8, await optionFor('openai')); TCRun.start(S8, rj); run = await finished(S8);
  const pr = CC.pendingOf(sessionsOf(S8)[0].content); assert.deepEqual([pr.length, pr[0].provider], [1, 'openai']);
  assert.equal(JSON.stringify(sessionsOf(S8)[0].content.quiz), JSON.stringify(QUIZ_DAMAGED), 'the damaged quiz is still as it was until a person accepts');

  // C10. session expiry: the run stops, what is written stays, nothing is sent to any provider, no switch is offered
  await useToken('U-exp'); reset(); for (const k of Object.keys(calls)) calls[k] = 0;
  const S9 = 'C-EXP'; addCourse(S9, 3); AIRoute.set(S9, await optionFor('groq'));
  store.sdcCloudToken = 'expired.token.value';
  const c0 = sent.length; TCRun.start(S9, missingJobs(S9)); run = await finished(S9);
  assert.ok(run.fatal && !run.pause, 'stopped without a provider pause'); assert.equal(sent.length, c0, 'nothing reached any provider');
  assert.equal(APL.kindOf('unauthorized').pause, false); assert.equal(box.tcPauseOf(run, sessionsOf(S9)), null, 'no provider switch is offered for a session problem');
  await useToken('U-exp2'); TCRun.start(S9, missingJobs(S9)); run = await finished(S9);
  assert.ok(sessionsOf(S9).every(s => CC.sessionState(s).status === 'complete'), 'signing in again and resuming completes it');

  // C11. the browser cannot store a result: the run stops, no more provider requests are spent, nothing is half-written
  await useToken('U-store'); reset(); for (const k of Object.keys(calls)) calls[k] = 0;
  const S10 = 'C-STORE'; addCourse(S10, 4); AIRoute.set(S10, await optionFor('azure_openai'));
  failSave = 1; TCRun.start(S10, missingJobs(S10)); run = await finished(S10);
  assert.ok(/Could not store/.test(run.fatal) && !run.pause); assert.ok(calls.azure_openai <= 2, 'at most the requests already running: ' + calls.azure_openai);
  failSave = 0; const sBefore10 = partsBy(S10, 'azure_openai').length;
  TCRun.start(S10, missingJobs(S10)); run = await finished(S10);
  assert.ok(sessionsOf(S10).every(s => CC.sessionState(s).status === 'complete') && !run.fatal, 'after freeing space, resuming completes it');

  // C12. a part written by someone else while a run was in flight is not overwritten by the late answer
  await useToken('U-race'); reset(); for (const k of Object.keys(calls)) calls[k] = 0;
  const S11 = 'C-RACE', rc = addCourse(S11, 1); AIRoute.set(S11, await optionFor('groq'));
  const slowFetch = global.fetch; let injected = false;
  global.fetch = async (u, o) => { if (!injected && String(u).startsWith(URLS.groq + '/chat') ) { injected = true; const s0 = sessionsOf(S11)[0], e = CC.applyEdit(s0.content || {}, { objectives: ['A person wrote this first'] }, 'U-coord', '2026-10-17T11:00:00Z'); box.updateRecord('sessions', s0.id, { content: e.content }); } return slowFetch(u, o); };
  TCRun.start(S11, [{ sessionId: rc[0].id, parts: ['lesson'], fill: ['lesson'] }]); run = await finished(S11); global.fetch = slowFetch;
  assert.deepEqual(sessionsOf(S11)[0].content.objectives, ['A person wrote this first'], 'the late answer did not replace the person\'s text');
  assert.deepEqual(run.jobs[0].skipped, ['lesson']); assert.equal(sessionsOf(S11)[0].content.meta.parts?.lesson, undefined);
  console.log('providerswitch: C7-C12 outage, no auto-switch, repair, expiry, storage, race ok');

  /* D. the browser's list of providers: what is offered and why not */
  const full = await status(), L = APL.options(full);
  assert.deepEqual(L.map(o => [o.provider, o.usable]), [['openai', true], ['gemini', true], ['azure_openai', true], ['groq', true]]);
  const bad = { profiles: [{ id: 'p1', provider: 'groq', model: '', maskedKey: 'gsk…1234', enabled: true }, { id: 'p2', provider: 'openai', model: 'text-embedding-3-small', maskedKey: 'sk-…1', enabled: true },
    { id: 'p3', provider: 'azure_openai', model: '', endpoint: '', deployment: '', maskedKey: 'abc…1', enabled: true }, { id: 'p4', provider: 'gemini', model: 'gemini-x', maskedKey: 'abc…2', enabled: true, lastTest: { ok: false, code: 'provider_auth' } }], env: {} };
  const why = Object.fromEntries(APL.options(bad).map(o => [o.provider, o.reason]));
  assert.match(why.groq, /No Groq model is chosen/); assert.match(why.openai, /does not write text/); assert.match(why.azure_openai, /endpoint or deployment/); assert.match(why.gemini, /key was rejected/);
  assert.equal(APL.options({ profiles: [], env: { groq: true } }).find(o => o.provider === 'groq').usable, true, 'a server-side key counts as set up');
  assert.match(APL.options({ profiles: [], env: {} })[0].reason, /No API key is saved for OpenAI/);

  await cleaner.run();
  global.fetch = realFetch;
  await new Promise(res => srv.close(res));
  console.log('providerswitch.test.js: all checks passed');
})().catch(async e => { await cleaner.run().catch(() => {}); console.error(e); process.exit(1); });
