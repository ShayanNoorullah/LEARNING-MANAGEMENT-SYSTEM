/* SDC Learn AI — server proxy for OpenAI / Gemini / Azure OpenAI / Groq.
   Secrets live in an AES-GCM file (never in the browser state blob).
   ponytail: one router, thin fetch adapters, PII scrub, budget + rate limits. */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const gw = require('./state-api').server;
const router = express.Router();
router.use(express.json({ limit: '2mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'sdc-learn-development-secret-change-in-production';
const GATEWAY_SECRET = process.env.SDC_STATE_SECRET || '';
const GATEWAY_SIGN = GATEWAY_SECRET ? crypto.createHash('sha256').update('sdc-session:' + GATEWAY_SECRET).digest('hex') : '';
const SECRETS_KEY = process.env.SDC_AI_SECRETS_KEY || GATEWAY_SECRET || JWT_SECRET;
const SECRETS_FILE = process.env.VERCEL
  ? path.join('/tmp', 'sdc-ai-secrets.json')
  : path.join(__dirname, 'data', 'ai-secrets.json');
const USAGE_FILE = process.env.VERCEL
  ? path.join('/tmp', 'sdc-ai-usage.json')
  : path.join(__dirname, 'data', 'ai-usage.json');
// When the state gateway is on, local AI token minting is off unless explicitly enabled.
// (Stops anonymous /api/ai/auth with a guessed userId from minting AI JWTs in production.)
const LOCAL_OPEN = GATEWAY_SIGN
  ? process.env.SDC_AI_LOCAL_OPEN === '1'
  : process.env.SDC_AI_LOCAL_OPEN !== '0';

const CAPABILITIES = ['tutor', 'summarize', 'practiceQuiz', 'quizGenerate', 'quizCheck', 'evaluate', 'atRisk', 'sessionAssist', 'courseGenerate', 'courseContent', 'contentRepair', 'complete'];
// Largest answer a page may ask for, and the time budget of one request (Vercel stops the function at 60 s).
// A fallback provider is only tried when enough of the budget is left for it to finish (limits below).
const MAX_OUT_TOKENS = 8000, DEFAULT_OUT_TOKENS = 2048;
const limits = { deadlineMs: 50000, fallbackMinMs: 15000 }; // changed only by tests
// Demo mode (developer machines only, never in production): when no provider is configured, course
// generation answers with a deterministic sample outline labelled provider "mock-demo". It is not AI.
const mockDemo = () => process.env.SDC_AI_MOCK === '1' && !process.env.VERCEL && process.env.NODE_ENV !== 'production';
const CG = require('../js/coursegen-logic.js');
const PROVIDERS = ['openai', 'gemini', 'azure_openai', 'groq'];
// When a request fails, the next provider is tried (FR-INT-6): the configured fallback, the primary, then
// these. Groq is not in this list: it is only used where a person chose it (a capability, the primary or
// the fallback provider). Fallback provider "none" turns automatic switching off.
const IMPLICIT_FALLBACK = ['openai', 'gemini', 'azure_openai'];

/* ----------------------------- secrets store ----------------------------- */
/* v1 used sha256(SECRETS_KEY) as the AES key. With the default SECRETS_KEY (SDC_STATE_SECRET) that is
   exactly the hash stored in sdc_learn_secret (and written in supabase/gateway.sql), so whoever can
   read that hash and the encrypted blob could decrypt the provider keys. v2 derives a separate key
   for this purpose. v1 blobs are still read and become v2 on the next save (SETUP.md, "AI key encryption"). */
function keyBuf(v = 2) { return crypto.createHash('sha256').update((v === 1 ? '' : 'sdc-ai-secrets:v2:') + String(SECRETS_KEY)).digest(); }
let warnedV1 = false;
function enc(obj) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', keyBuf(2), iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: 2, iv: iv.toString('base64'), tag: tag.toString('base64'), data: ct.toString('base64') };
}
function dec(blob) {
  if (!blob?.iv || !blob?.data) return { profiles: {} };
  try {
    const v = blob.v === 2 ? 2 : 1;
    if (v === 1 && !warnedV1) { warnedV1 = true; console.warn('AI provider keys use the old encryption key. Save or test a provider in Settings → Integrations once to re-encrypt them.'); }
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf(v), Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch (e) { console.warn('AI secrets decrypt failed', e.message); return { profiles: {} }; }
}
const readFile = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const writeFile = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
async function kvGet(key, file) {
  if (gw.READY) return gw.rpc('sdc_kv_get', { p_key: key });
  return readFile(file);
}
async function kvPut(key, file, value) {
  if (gw.READY) return gw.rpc('sdc_kv_put', { p_key: key, p_value: value });
  writeFile(file, value);
}
async function loadSecrets() { const blob = await kvGet('ai-secrets', SECRETS_FILE); return blob ? dec(blob) : { profiles: {} }; }
async function saveSecrets(store) { await kvPut('ai-secrets', SECRETS_FILE, enc(store)); }
function maskKey(k) {
  const s = String(k || '');
  if (s.length < 8) return s ? '••••' : '';
  return s.slice(0, 3) + '…' + s.slice(-4);
}
function resolveProfile(store, profileId, provider) {
  const profiles = store.profiles || {};
  if (profileId && profiles[profileId]) return profiles[profileId];
  const byProv = Object.values(profiles).find(p => p.provider === provider && p.enabled !== false);
  if (byProv) return byProv;
  // Env fallbacks
  if (provider === 'openai' && process.env.OPENAI_API_KEY) return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4o-mini', baseUrl: process.env.OPENAI_BASE_URL || '' };
  if (provider === 'gemini' && process.env.GEMINI_API_KEY) return { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite' };
  if (provider === 'azure_openai' && process.env.AZURE_OPENAI_API_KEY) return { provider: 'azure_openai', apiKey: process.env.AZURE_OPENAI_API_KEY, endpoint: process.env.AZURE_OPENAI_ENDPOINT, deployment: process.env.AZURE_OPENAI_DEPLOYMENT, apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview', model: process.env.AZURE_OPENAI_DEPLOYMENT };
  if (provider === 'groq' && process.env.GROQ_API_KEY) return { provider: 'groq', apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || '' };
  return null;
}

/* -------------------------------- usage ---------------------------------- */
async function loadUsage() {
  const u = await kvGet('ai-usage', USAGE_FILE).catch(() => null);
  return u || { month: '', calls: 0, tokens: 0, byFeature: {} };
}
// ponytail: read-modify-write, so two simultaneous calls can undercount by one; fine for a budget guard.
// byProvider adds, per provider: answered calls, tokens, failed attempts, total answer time and the last
// error (its code and time only, never a key or a prompt).
async function trackUsage(feature, tokens, info = null) {
  const month = new Date().toISOString().slice(0, 7);
  const u = await loadUsage();
  if (u.month !== month) { u.month = month; u.calls = 0; u.tokens = 0; u.byFeature = {}; u.byProvider = {}; }
  if (feature) {
    u.calls += 1; u.tokens += tokens || 0;
    u.byFeature[feature] = (u.byFeature[feature] || 0) + 1;
  }
  if (info?.provider) {
    const p = (u.byProvider ||= {})[info.provider] ||= { calls: 0, tokens: 0, errors: 0, ms: 0 };
    if (info.ok) { p.calls += 1; p.tokens += tokens || 0; p.ms += Math.max(0, Math.round(info.ms || 0)); p.lastOkAt = new Date().toISOString(); }
    else { p.errors += 1; p.lastError = { code: String(info.code || 'provider').slice(0, 40), status: Number(info.status) || 0, at: new Date().toISOString() }; }
  }
  await kvPut('ai-usage', USAGE_FILE, u).catch(e => console.warn('AI usage not saved', e.message));
  return u;
}

/* ----------------------------- PII scrubber ------------------------------ */
const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  /\b\d{5}-\d{7}-\d\b/g, // CNIC
  /\bSDC-\d{2}-\d{4}\b/gi
];
function scrubPii(text, extraNames = []) {
  let s = String(text || '');
  extraNames.filter(Boolean).forEach(n => {
    const parts = String(n).trim().split(/\s+/).filter(p => p.length > 2);
    parts.forEach(p => { s = s.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[redacted]'); });
  });
  PII_PATTERNS.forEach(re => { s = s.replace(re, '[redacted]'); });
  return s;
}

/* -------------------------------- auth ----------------------------------- */
function auth(req, res, next) {
  const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!raw) return res.status(401).json({ error: 'Sign in required for SDC Learn AI.', code: 'unauthorized' });
  if (GATEWAY_SIGN) {
    try { req.uid = jwt.verify(raw, GATEWAY_SIGN).uid; return next(); } catch (e) { /* fall through only if local minting allowed */ }
    if (!LOCAL_OPEN) return res.status(401).json({ error: 'Your AI session expired. Sign in again.', code: 'unauthorized' });
  }
  try {
    const p = jwt.verify(raw, JWT_SECRET);
    if (p.purpose === 'ai' && p.uid) { req.uid = p.uid; return next(); }
  } catch (e) {}
  return res.status(401).json({ error: 'Your AI session expired. Refresh and try again.', code: 'unauthorized' });
}
// ponytail: platform state cached 10 s per instance for permission/budget checks; role changes apply within that window.
let stateCache = { at: 0, state: null };
async function platform() {
  if (!gw.READY) return null;
  if (Date.now() - stateCache.at > 10000) stateCache = { at: Date.now(), state: (await gw.load()).state };
  return stateCache.state;
}
const deny = (res, msg) => res.status(403).json({ error: msg, code: 'forbidden' });
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
// Features that lead to new records need more than ai:use. The switch must be explicitly ON
// (missing = OFF on the server, unlike feature() in the browser).
// courseContent (session teaching material for an existing course) needs courses:edit; the content is
// saved through the state gateway, which checks the course scope like any other session edit.
const FEATURE_GUARD = {
  courseGenerate: { module: 'courses', action: 'create', setting: 'courseGen', off: 'AI course generation is turned off in Settings.', denied: 'Your role cannot create courses.' },
  courseContent: { module: 'courses', action: 'edit', setting: 'courseGen', off: 'AI course generation is turned off in Settings.', denied: 'Your role cannot edit courses.' },
  contentRepair: { module: 'courses', action: 'edit', setting: 'courseGen', off: 'AI course generation is turned off in Settings.', denied: 'Your role cannot edit courses.' }
};
function allow(kind) {
  return async (req, res, next) => {
    try {
      const st = await platform();
      if (!st) return next(); // local development without the gateway: the browser enforces permissions
      const me = st.users.find(u => u.id === req.uid);
      if (!me || me.status !== 'Active') return res.status(401).json({ error: 'Your account is not active.', code: 'unauthorized' });
      req.platform = st;
      if (kind === 'configure' && !(gw.can(st, me, 'ai', ['configure']) || gw.can(st, me, 'settings', ['edit']))) return deny(res, 'Only administrators can change SDC Learn AI integrations.');
      if (kind === 'use') {
        const integ = st.settings?.integrations || {};
        if (st.settings?.features?.ai === false || integ.aiEnabled === false) return deny(res, 'SDC Learn AI is turned off in Settings.');
        if (!gw.can(st, me, 'ai', ['use', 'configure'])) return deny(res, 'You do not have permission to use SDC Learn AI.');
        const g = FEATURE_GUARD[req.body?.feature];
        if (g && st.settings?.features?.[g.setting] !== true) return deny(res, g.off);
        if (g && !gw.can(st, me, g.module, [g.action])) return deny(res, g.denied);
      }
      next();
    } catch (e) { console.error('[ai] permission check', e); res.status(502).json({ error: 'Could not verify your permissions. Try again.' }); }
  };
}
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[ai]', e);
  res.status(e.status || 502).json({ error: e.message || 'AI request failed.', ...(e.code ? { code: e.code } : {}), ...(e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {}), ...(e.provider ? { provider: e.provider } : {}), ...(e.model ? { model: e.model } : {}) });
});

const rate = new Map();
// Writing a whole course is hundreds of small requests (3 per session), so the three course features count in
// their own bucket (SDC_AI_CONTENT_RATE per person per hour, default 300); everything else stays at 60.
const CONTENT_FEATURES = ['courseGenerate', 'courseContent', 'contentRepair'];
const CONTENT_RATE = Math.max(60, Math.floor(Number(process.env.SDC_AI_CONTENT_RATE)) || 300);
function rateLimit(uid, max = 60, bucket = '') {
  const k = `${uid}:${bucket}:${new Date().toISOString().slice(0, 13)}`;
  const n = (rate.get(k) || 0) + 1;
  rate.set(k, n);
  if (n > max) throw fail(429, 'rate_limit', 'AI rate limit reached. Try again later.');
}

/* ---------------------------- provider calls ----------------------------- */
const signalOf = opts => (opts.timeoutMs ? { signal: AbortSignal.timeout(Math.max(1000, opts.timeoutMs)) } : {});
// A provider that says "slow down" (429) or "overloaded" (503) answers with code provider_busy and the
// wait it asked for, so a page can pause and try again; a used-up daily quota is provider_quota (stop).
// Any other provider error stays a plain 502 with the provider's message, as before.
// A model this key cannot use (unknown, retired, or closed to new projects) is provider_model, so a
// page stops instead of failing every request the same way.
// A request larger than the model's context or the account's per-minute token limit is
// provider_too_large (Groq answers 413 "Request too large"): sending it again cannot help.
// opts.auth: a rejected key is provider_auth (stop), used by the Groq adapter.
const PROVIDER_OF = { OpenAI: 'openai', Gemini: 'gemini', 'Azure OpenAI': 'azure_openai', Groq: 'groq' };
// Speech, image, embedding and safety models are not text generators. A request to one is refused here, with
// the same wording for every provider, instead of coming back from the provider as an unreadable error.
const NOT_TEXT_MODEL = /whisper|tts|orpheus|playai|guard|compound|embed|moderation|dall-e|imagen|veo-|transcribe/i;
function providerError(label, r, j, model, opts = {}) {
  const err = providerError0(label, r, j, model, opts);
  err.provider = opts.provider || PROVIDER_OF[label] || '';
  if (model && !err.model) err.model = model;
  return err;
}
function providerError0(label, r, j, model, opts = {}) {
  const msg = String(j?.error?.message || `${label} error (${r.status})`);
  const errCode = String(j?.error?.code || j?.error?.status || '') + ' ' + String(j?.error?.type || '');
  if (r.status === 413 || (r.status !== 429 && r.status !== 503 && /request too large|context.{0,20}(length|window)|maximum context|too many tokens|exceeds the maximum number of tokens/i.test(msg))) {
    console.warn(`[ai] ${label} ${r.status} request too large: ${msg.slice(0, 200)}`);
    return Object.assign(new Error(`The request is too large for ${label}${model ? ` model "${model}"` : ''} (${msg.slice(0, 160)}). Choose a model with a larger limit in Settings → Integrations, or shorten the request.`), { status: 400, code: 'provider_too_large' });
  }
  // A rejected key: 401/403, or Gemini's 400 API_KEY_INVALID. (A 403 about a model is a model problem, below.)
  if (opts.auth !== false && (r.status === 401 || r.status === 403 || (r.status === 400 && /api[ _]key (is )?not valid|api_key_invalid|invalid[ _]api[ _]key|incorrect api key/i.test(errCode + ' ' + msg))) && !/\bmodels?\b/i.test(msg)) {
    console.warn(`[ai] ${label} ${r.status}: API key rejected`);
    return Object.assign(new Error(`${label} rejected the API key (${r.status}). Update the key in Settings → Integrations.`), { status: 502, code: 'provider_auth' });
  }
  if (model && (r.status === 404 || ((r.status === 400 || r.status === 403) && /\bmodels?\b/i.test(msg) && /not found|not available|no longer|not supported|unsupported|deprecated|decommissioned|does not exist|access/i.test(msg)))) {
    console.warn(`[ai] ${label} ${r.status} for model ${model}: ${msg.slice(0, 200)}`);
    return Object.assign(new Error(`${label} model "${model}" is not available for this API key (${msg.slice(0, 160)}). Choose another model in Settings → Integrations.`), { status: 502, code: 'provider_model' });
  }
  // 498: Groq's flex tier is at capacity, which is "busy" too.
  if (r.status !== 429 && r.status !== 503 && r.status !== 498) return Object.assign(new Error(msg), { status: 502 });
  const details = JSON.stringify(j?.error?.details || []);
  const info = (j?.error?.details || []).map(d => d?.retryDelay).find(Boolean); // Gemini RetryInfo, e.g. "59s"
  const header = Number(typeof r.headers?.get === 'function' ? r.headers.get('retry-after') : 0);
  const said = /retry in ([\d.]+)\s*s/i.exec(msg), again = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(msg); // Gemini / Groq ("try again in 1m2.5s")
  const azure = /retry after (\d+) seconds?/i.exec(msg); // Azure OpenAI
  const secs = parseFloat(info) || (header > 0 ? header : 0) || (said ? Number(said[1]) : 0) || (again ? Number(again[1] || 0) * 60 + Number(again[2]) : 0) || (azure ? Number(azure[1]) : 0) || (r.status === 429 ? 30 : 10);
  // Used up, not just slow: a per-day quota, an account with no credit (OpenAI insufficient_quota), or a wait of an hour or more.
  const credit = /insufficient_quota|billing_hard_limit/i.test(errCode + ' ' + msg);
  const daily = credit || secs >= 3600 || /PerDay|per day|daily/i.test(details + msg);
  console.warn(`[ai] ${label} ${r.status}: ${msg.slice(0, 200)}`);
  return Object.assign(new Error(credit ? `${label} has no credit or quota left on this account. Add credit or raise the plan's limits, or use another provider.` : daily ? `${label}'s daily request quota is used up. Try again tomorrow or raise the plan's limits.`
    : r.status === 429 ? `${label} is limiting how many requests it accepts per minute.` : `${label} is busy right now.`),
  { status: 503, code: daily ? 'provider_quota' : 'provider_busy', retryAfterMs: Math.min(120000, Math.max(5000, Math.round(secs * 1000))) });
}
const timedOut = e => e && (e.name === 'TimeoutError' || e.name === 'AbortError');
// Same body as always unless the page asked for JSON mode. Newer models reject max_tokens or a
// temperature other than the default; for those one corrected request is sent (and only then).
// OpenAI-style usage -> { input, output }, the shape Groq and Gemini already report.
const usageOf = u => (u && (u.prompt_tokens || u.completion_tokens) ? { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 } : undefined);
async function callOpenAI(profile, messages, opts = {}) {
  const base = (profile.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = opts.model || profile.model || 'gpt-4o-mini';
  const body = { model, messages, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens || DEFAULT_OUT_TOKENS };
  if (opts.json) body.response_format = { type: 'json_object' };
  const send = async b => {
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b), ...signalOf(opts) });
    return { r, j: await r.json().catch(() => ({})) };
  };
  let { r, j } = await send(body);
  const why = String(j.error?.message || '');
  if (r.status === 400 && /max_completion_tokens/i.test(why) && body.max_tokens) { const { max_tokens, ...rest } = body; ({ r, j } = await send({ ...rest, max_completion_tokens: max_tokens })); }
  else if (r.status === 400 && /temperature/i.test(why) && 'temperature' in body) { const { temperature, ...rest } = body; ({ r, j } = await send(rest)); }
  else if (r.status === 400 && /response_format|json_object|json mode/i.test(why) && body.response_format) { const { response_format, ...rest } = body; ({ r, j } = await send(rest)); } // a model without JSON mode: the page checks the JSON itself
  if (!r.ok) throw providerError('OpenAI', r, j, model);
  return { text: j.choices?.[0]?.message?.content || '', tokens: j.usage?.total_tokens || 0, usage: usageOf(j.usage), model: j.model || model, provider: 'openai', truncated: j.choices?.[0]?.finish_reason === 'length' };
}
async function callAzure(profile, messages, opts = {}) {
  const endpoint = String(profile.endpoint || '').replace(/\/$/, '');
  const deployment = profile.deployment || profile.model;
  const ver = profile.apiVersion || '2024-08-01-preview';
  if (!endpoint || !deployment) throw Object.assign(new Error('Azure OpenAI endpoint and deployment are required.'), { status: 400 });
  const body = { messages, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens || DEFAULT_OUT_TOKENS };
  if (opts.json) body.response_format = { type: 'json_object' };
  const send = async b => {
    const r = await fetch(`${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(ver)}`, {
      method: 'POST',
      headers: { 'api-key': profile.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(b), ...signalOf(opts)
    });
    return { r, j: await r.json().catch(() => ({})) };
  };
  let { r, j } = await send(body);
  const why = String(j.error?.message || '');
  if (r.status === 400 && /max_completion_tokens/i.test(why) && body.max_tokens) { const { max_tokens, ...rest } = body; ({ r, j } = await send({ ...rest, max_completion_tokens: max_tokens })); }
  else if (r.status === 400 && /temperature/i.test(why) && 'temperature' in body) { const { temperature, ...rest } = body; ({ r, j } = await send(rest)); }
  else if (r.status === 400 && /response_format|json_object|json mode/i.test(why) && body.response_format) { const { response_format, ...rest } = body; ({ r, j } = await send(rest)); }
  if (!r.ok) throw providerError('Azure OpenAI', r, j, deployment);
  return { text: j.choices?.[0]?.message?.content || '', tokens: j.usage?.total_tokens || 0, usage: usageOf(j.usage), model: deployment, provider: 'azure_openai', truncated: j.choices?.[0]?.finish_reason === 'length' };
}

/* Groq: OpenAI-compatible Chat Completions at the official address only (a stored key is never sent
   anywhere else). No model id is built in: the model comes from the profile or the capability, chosen
   from Groq's own model list, which also gives each model's context window and answer limit.
   Fields Groq rejects (logprobs, logit_bias, top_logprobs, n > 1, messages[].name) are never sent. */
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// QA only, like the Groq one below: SDC_QA_GEMINI_BASE_URL points at a stand-in on this machine's loopback.
const geminiBase = () => {
  const qa = String(process.env.SDC_QA_GEMINI_BASE_URL || '');
  return qa && !process.env.VERCEL && process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(qa.replace(/\/?$/, '/')) ? qa.replace(/\/$/, '') : GEMINI_BASE;
};
// QA only: SDC_QA_GROQ_BASE_URL points at a stand-in on this machine (loopback addresses only; ignored on
// Vercel and with NODE_ENV=production), so the Settings screens can be tried without a real Groq request.
const groqBase = () => {
  const qa = String(process.env.SDC_QA_GROQ_BASE_URL || '');
  return qa && !process.env.VERCEL && process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(qa.replace(/\/?$/, '/')) ? qa.replace(/\/$/, '') : GROQ_BASE;
};
// Speech, text-to-speech and safety-classifier models are not text generators; agentic "compound"
// systems call web tools on their own, so they are not offered for course content either.
const GROQ_NOT_TEXT = /whisper|tts|orpheus|playai|guard|compound/i;
const groqModelCache = new Map(); // hash of the key -> { at, all: [{ id, ... }] }
const keyTag = k => crypto.createHash('sha256').update('groq-models:' + String(k)).digest('hex').slice(0, 16);
const redact = (s, k) => (k ? String(s).split(String(k)).join('[key]') : String(s));
async function groqModels(profile, { fresh = false, timeoutMs = 10000 } = {}) {
  const tag = keyTag(profile.apiKey), hit = groqModelCache.get(tag);
  if (hit && !fresh && Date.now() - hit.at < 600000) return hit.all;
  const r = await fetch(`${groqBase()}/models`, { headers: { Authorization: `Bearer ${profile.apiKey}` }, signal: AbortSignal.timeout(timeoutMs) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw providerError('Groq', r, j, '', { auth: true });
  const all = (Array.isArray(j.data) ? j.data : []).filter(m => m && typeof m.id === 'string' && m.active !== false).map(m => ({
    id: m.id, ownedBy: String(m.owned_by || ''), contextWindow: Number(m.context_window) || 0, maxOutput: Number(m.max_completion_tokens) || 0, text: !GROQ_NOT_TEXT.test(m.id)
  })).sort((a, b) => a.id.localeCompare(b.id));
  groqModelCache.set(tag, { at: Date.now(), all });
  return all;
}
// Corrections a model needed once (a parameter it rejects) are remembered for the life of the server,
// so later requests do not pay for the same 400 again.
const groqLearned = new Map(); // model -> { field: value | undefined }
const GROQ_THINK = /<think>[\s\S]*?<\/think>\s*/gi;
async function callGroq(profile, messages, opts = {}) {
  const model = String(opts.model || profile.model || '').trim();
  if (!model) throw Object.assign(new Error('No Groq model is chosen. Load the models and choose one in Settings → Integrations.'), { status: 400, code: 'provider_model' });
  // Model facts from Groq's list (cached 10 minutes). Without the list the request is sent as asked.
  const info = await groqModels(profile, { timeoutMs: Math.min(10000, opts.timeoutMs || 10000) }).then(all => {
    const m = all.find(x => x.id === model);
    if (!m) throw Object.assign(new Error(`Groq model "${model}" is not available for this API key. Choose another model in Settings → Integrations.`), { status: 502, code: 'provider_model' });
    return m;
  }, e => { if (['provider_auth', 'provider_quota'].includes(e.code)) throw e; return null; });
  let out = opts.maxTokens || DEFAULT_OUT_TOKENS;
  if (info?.maxOutput) out = Math.min(out, info.maxOutput);
  if (info?.contextWindow) {
    const input = Math.ceil(JSON.stringify(messages).length / 3.5) + 16; // a generous estimate of the prompt's tokens
    const room = info.contextWindow - input;
    if (room < Math.min(out, 256)) throw Object.assign(new Error(`The request is too long for Groq model "${model}" (about ${input} tokens for a ${info.contextWindow}-token context). Choose a model with a larger context in Settings → Integrations, or shorten the request.`), { status: 400, code: 'provider_too_large' });
    out = Math.min(out, room);
  }
  const body = { model, messages: messages.map(m => ({ role: m.role, content: String(m.content ?? '') })), temperature: opts.temperature ?? 0.3, max_completion_tokens: out };
  // Structured Outputs when the page sends a schema (best effort, then validated by the page as always);
  // plain JSON mode otherwise. A model that rejects either gets the next simpler form.
  if (opts.json) body.response_format = opts.schema ? { type: 'json_schema', json_schema: { name: 'answer', schema: opts.schema, strict: false } } : { type: 'json_object' };
  // GPT-OSS models reason before answering and that counts against the answer limit: ask for little.
  if (/gpt-oss/i.test(model)) body.reasoning_effort = 'low';
  Object.entries(groqLearned.get(model) || {}).forEach(([k, v]) => { if (v === undefined) delete body[k]; else if (k !== 'response_format' || body.response_format) body[k] = v; });
  const send = async () => {
    const r = await fetch(`${groqBase()}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...signalOf(opts) });
    return { r, j: await r.json().catch(() => ({})) };
  };
  const learn = patch => { groqLearned.set(model, { ...(groqLearned.get(model) || {}), ...patch }); Object.entries(patch).forEach(([k, v]) => { if (v === undefined) delete body[k]; else body[k] = v; }); };
  const t0 = Date.now(), tried = new Set();
  let r, j;
  for (let i = 0; i < 4; i++) {
    ({ r, j } = await send());
    if (r.ok || r.status !== 400) break;
    const why = String(j.error?.message || ''), code = String(j.error?.code || '');
    const badJson = code === 'json_validate_failed' || /failed to generate json|does not match the expected schema|json_validate/i.test(why);
    let fix = null, key = '';
    if (badJson && body.response_format?.type === 'json_schema') { key = 'schema'; fix = () => { body.response_format = { type: 'json_object' }; }; }
    else if (badJson) {
      // JSON mode could not produce valid JSON. Groq returns what the model wrote: the page's own
      // JSON repair and checks decide (the answer is never trusted because of its mode).
      if (typeof j.error?.failed_generation === 'string' && j.error.failed_generation.trim()) {
        return { text: j.error.failed_generation, tokens: 0, model, provider: 'groq', truncated: false, jsonInvalid: true, ms: Date.now() - t0 };
      }
      throw Object.assign(new Error('Groq could not produce valid JSON for this request. Try again.'), { status: 502, code: 'invalid_json' });
    }
    else if (/reasoning_format/i.test(why)) { key = 'rf:' + body.reasoning_format; fix = () => learn({ reasoning_format: body.reasoning_format === undefined && opts.json ? 'hidden' : undefined }); }
    else if (/include_reasoning/i.test(why)) { key = 'ir'; fix = () => learn({ include_reasoning: undefined }); }
    else if (/reasoning_effort/i.test(why)) { key = 're'; fix = () => learn({ reasoning_effort: undefined }); }
    else if (/json_schema/i.test(why) && body.response_format?.type === 'json_schema') { key = 'schema'; fix = () => { body.response_format = { type: 'json_object' }; }; }
    else if (/response_format|json mode|json_object/i.test(why) && body.response_format) { key = 'rfmt'; fix = () => learn({ response_format: undefined }); }
    else if (/max_completion_tokens/i.test(why) && body.max_completion_tokens) { key = 'mct'; fix = () => learn({ max_completion_tokens: undefined, max_tokens: body.max_completion_tokens }); }
    else if (/temperature/i.test(why) && 'temperature' in body) { key = 'temp'; fix = () => learn({ temperature: undefined }); }
    if (!fix || tried.has(key)) break;
    tried.add(key); fix();
    console.warn(`[ai] Groq ${model} rejected a parameter, sending one corrected request (${key.split(':')[0]})`);
  }
  if (!r.ok) {
    const e = providerError('Groq', r, j, model, { auth: true });
    e.message = redact(e.message, profile.apiKey);
    throw e;
  }
  const choice = j.choices?.[0] || {}, u = j.usage || {};
  const text = String(choice.message?.content || '').replace(GROQ_THINK, '');
  const usage = { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 };
  const ms = Number(u.total_time) > 0 ? Math.round(Number(u.total_time) * 1000) : Date.now() - t0;
  return { text, tokens: u.total_tokens || usage.input + usage.output, usage, model: j.model || model, provider: 'groq', truncated: choice.finish_reason === 'length', ms, requestId: String(j.x_groq?.id || '') };
}
// Gemini 3 and later set thinking by level; thinkingBudget is legacy there and sending both is a 400.
// Thinking tokens count against maxOutputTokens, so these models get the lowest level they accept
// ("minimal" only on Flash-Lite and a few Flash models; gemini-3.8-flash and Pro reject it) plus room
// for that thinking on top of the answer size. Temperature stays at the model default (1.0): Google
// warns that lower values can make Gemini 3 loop. Gemini 2.x requests are unchanged.
const GEMINI_MINIMAL = /^gemini-3(\.\d+)?-flash-lite|^gemini-3\.6-flash$|^gemini-3-flash-preview$/;
const GEMINI_THINK_ROOM = { minimal: 1024, low: 2048 };
const geminiGen = model => Number((/^gemini-(\d+)/.exec(model) || [])[1] || 0);
function geminiThinking(model) {
  if (geminiGen(model) < 3) return null;
  return GEMINI_MINIMAL.test(model) ? 'minimal' : 'low';
}
// An answer Gemini stopped for a reason other than length (safety, recitation, blocked prompt) is an
// error with that reason, not an empty answer the page would mistake for unreadable JSON.
const GEMINI_STOPPED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE', 'OTHER']);
async function callGemini(profile, messages, opts = {}) {
  const model = String(opts.model || profile.model || 'gemini-3.5-flash-lite').replace(/^models\//, '');
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const url = `${geminiBase()}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(profile.apiKey)}`;
  const body = { contents, generationConfig: { temperature: opts.temperature ?? 0.3, maxOutputTokens: opts.maxTokens || DEFAULT_OUT_TOKENS } };
  const level = geminiThinking(model);
  if (level) {
    delete body.generationConfig.temperature;
    body.generationConfig.thinkingConfig = { thinkingLevel: level };
    body.generationConfig.maxOutputTokens += GEMINI_THINK_ROOM[level];
  }
  if (opts.json) {
    body.generationConfig.responseMimeType = 'application/json';
    // Gemini 2.5 models "think" first and the thinking tokens count against maxOutputTokens, which cut
    // the outline off mid-answer. Structured output needs no thinking: flash models allow 0, pro a minimum.
    if (/^gemini-2\.5-flash/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    else if (/^gemini-2\.5-pro/.test(model)) { body.generationConfig.thinkingConfig = { thinkingBudget: 128 }; body.generationConfig.maxOutputTokens += 512; }
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const send = async b => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), ...signalOf(opts) });
    return { r, j: await r.json().catch(() => ({})) };
  };
  let { r, j } = await send(body);
  // A model that rejects the thinking level (a newer model than this list knows): one corrected request,
  // "low" instead of "minimal", or the model's own default.
  if (r.status === 400 && level && /thinking/i.test(String(j.error?.message || ''))) {
    const thinkingConfig = level === 'minimal' ? { thinkingLevel: 'low' } : undefined;
    const generationConfig = { ...body.generationConfig, thinkingConfig, maxOutputTokens: body.generationConfig.maxOutputTokens - GEMINI_THINK_ROOM[level] + GEMINI_THINK_ROOM.low };
    if (!thinkingConfig) delete generationConfig.thinkingConfig;
    ({ r, j } = await send({ ...body, generationConfig }));
  }
  if (!r.ok) throw providerError('Gemini', r, j, model);
  const cand = j.candidates?.[0], finish = cand?.finishReason || '';
  const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  const blocked = j.promptFeedback?.blockReason || (!text.trim() && GEMINI_STOPPED.has(finish) ? finish : '');
  if (blocked) throw Object.assign(new Error(`Gemini did not answer (${blocked}). Rephrase the request or try again.`), { status: 502, code: 'provider_blocked' });
  const u = j.usageMetadata || {};
  const usage = { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, thinking: u.thoughtsTokenCount || 0 };
  const tokens = u.totalTokenCount || (usage.input + usage.output + usage.thinking);
  return { text, tokens, usage, model, provider: 'gemini', truncated: finish === 'MAX_TOKENS' };
}
async function complete(provider, profile, messages, opts) {
  const asked = String(opts?.model || profile?.model || profile?.deployment || '');
  if (asked && NOT_TEXT_MODEL.test(asked)) {
    const label = { openai: 'OpenAI', gemini: 'Gemini', azure_openai: 'Azure OpenAI', groq: 'Groq' }[provider] || provider;
    throw Object.assign(new Error(`${label} model "${asked}" does not write text (it is a speech, image, embedding or safety model). Choose a chat model in Settings → Integrations, or use another provider.`), { status: 400, code: 'provider_model', provider, model: asked });
  }
  if (provider === 'openai') return callOpenAI(profile, messages, opts);
  if (provider === 'azure_openai') return callAzure(profile, messages, opts);
  if (provider === 'gemini') return callGemini(profile, messages, opts);
  if (provider === 'groq') return callGroq(profile, messages, opts);
  throw Object.assign(new Error('Unknown provider'), { status: 400 });
}

function pickRoute(body) {
  const provider = body.provider || 'openai';
  const profileId = body.profileId || null;
  const asked = Math.floor(Number(body.maxTokens));
  // Never above the cap, whatever the page asked for; unchanged (provider default) when it asked for nothing.
  const maxTokens = asked > 0 ? Math.min(asked, MAX_OUT_TOKENS) : undefined;
  // A JSON schema (Structured Outputs, used by Groq where the model supports it) is only forwarded when
  // it is a small plain object.
  const schema = body.json === true && body.schema && typeof body.schema === 'object' && !Array.isArray(body.schema) && JSON.stringify(body.schema).length <= 20000 ? body.schema : undefined;
  return { provider, profileId, model: body.model, temperature: body.temperature, maxTokens, json: body.json === true, ...(schema ? { schema } : {}) };
}

/* -------------------------------- routes --------------------------------- */
router.get('/api/ai/status', wrap(async (req, res) => {
  const store = await loadSecrets();
  const profiles = Object.entries(store.profiles || {}).map(([id, p]) => ({
    id, name: p.name || id, provider: p.provider, model: p.model || p.deployment || '',
    endpoint: p.endpoint || '', deployment: p.deployment || '', apiVersion: p.apiVersion || '',
    baseUrl: p.baseUrl || '', enabled: p.enabled !== false, maskedKey: maskKey(p.apiKey),
    lastValidatedAt: p.lastValidatedAt || null, lastTest: p.lastTest || null
  }));
  const env = {
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    azure_openai: !!process.env.AZURE_OPENAI_API_KEY,
    groq: !!process.env.GROQ_API_KEY
  };
  res.json({ ok: true, product: 'SDC Learn AI', profiles, env, usage: await loadUsage(), localAuth: LOCAL_OPEN });
}));

router.post('/api/ai/auth', wrap(async (req, res) => {
  if (!LOCAL_OPEN && GATEWAY_SIGN) return res.status(403).json({ error: 'Use gateway sign-in for AI.' });
  const userId = String(req.body?.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId required.' });
  const token = jwt.sign({ uid: userId, purpose: 'ai' }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
}));

router.post('/api/ai/configure', auth, allow('configure'), wrap(async (req, res) => {
  const { profileId, name, provider, apiKey, model, endpoint, deployment, apiVersion, baseUrl, enabled, remove } = req.body || {};
  if (!PROVIDERS.includes(provider) && !remove) return res.status(400).json({ error: 'Invalid provider.' });
  const store = await loadSecrets();
  store.profiles = store.profiles || {};
  const id = profileId || `prof-${provider}-${Date.now().toString(36)}`;
  if (remove) {
    delete store.profiles[id];
    await saveSecrets(store);
    return res.json({ ok: true, removed: id });
  }
  const prev = store.profiles[id] || {};
  if (model && (String(model).length > 200 || !/^[\w.:/@-]+$/.test(String(model)))) return res.status(400).json({ error: 'The model name has characters a model id cannot have.' });
  store.profiles[id] = {
    name: name || prev.name || provider,
    provider,
    apiKey: apiKey && !String(apiKey).includes('…') ? apiKey : prev.apiKey,
    model: model || prev.model || '',
    endpoint: endpoint ?? prev.endpoint ?? '',
    deployment: deployment ?? prev.deployment ?? '',
    apiVersion: apiVersion ?? prev.apiVersion ?? '',
    baseUrl: provider === 'groq' ? '' : baseUrl ?? prev.baseUrl ?? '', // Groq keys only go to api.groq.com
    enabled: enabled !== false,
    lastValidatedAt: prev.lastValidatedAt || null
  };
  // A new key has not been tested yet.
  if (store.profiles[id].apiKey === prev.apiKey && store.profiles[id].model === prev.model) store.profiles[id].lastTest = prev.lastTest || null;
  else store.profiles[id].lastValidatedAt = null;
  if (!store.profiles[id].apiKey) return res.status(400).json({ error: 'API key is required.' });
  await saveSecrets(store);
  res.json({ ok: true, profile: { id, name: store.profiles[id].name, provider, maskedKey: maskKey(store.profiles[id].apiKey) } });
}));

router.post('/api/ai/test', auth, allow('configure'), wrap(async (req, res) => {
  rateLimit(req.uid, 20);
  const { provider, profileId } = pickRoute(req.body || {});
  const store = await loadSecrets();
  let profile = resolveProfile(store, profileId, provider);
  // Allow testing with a key pasted in the form before save
  if (req.body?.apiKey && !String(req.body.apiKey).includes('…')) {
    profile = { ...(profile || {}), provider, apiKey: req.body.apiKey, model: req.body.model || profile?.model, endpoint: req.body.endpoint, deployment: req.body.deployment, apiVersion: req.body.apiVersion, baseUrl: req.body.baseUrl };
  }
  if (!profile?.apiKey) return res.status(400).json({ error: 'No API key configured for this provider.' });
  // The result of a test of the stored key is kept with the profile (never the key), so Settings can show
  // whether the connection works.
  const pasted = !!(req.body?.apiKey && !String(req.body.apiKey).includes('…'));
  const saved = !pasted && profileId && store.profiles[profileId] ? store.profiles[profileId] : null;
  const t0 = Date.now();
  let out;
  try {
    out = await complete(provider, profile, [
      { role: 'system', content: 'Reply with exactly: OK' },
      { role: 'user', content: 'ping' }
    ], { maxTokens: provider === 'groq' ? 32 : 16, temperature: 0, model: req.body?.model || undefined, timeoutMs: 20000 });
  } catch (e) {
    if (timedOut(e)) e = fail(504, 'timeout', 'The provider did not answer within 20 seconds.');
    e.message = redact(e.message, profile.apiKey);
    if (saved) { saved.lastTest = { ok: false, at: new Date().toISOString(), code: String(e.code || 'provider'), message: e.message.slice(0, 200) }; await saveSecrets(store).catch(() => {}); }
    await trackUsage(null, 0, { provider, ok: false, code: e.code, status: e.status });
    throw e;
  }
  const ms = out.ms || Date.now() - t0;
  if (saved) {
    saved.lastValidatedAt = new Date().toISOString();
    saved.lastTest = { ok: true, at: saved.lastValidatedAt, model: out.model, ms };
    await saveSecrets(store);
  }
  await trackUsage('test', out.tokens, { provider, ok: true, ms });
  res.json({ ok: true, reply: out.text.trim(), model: out.model, provider: out.provider, tokens: out.tokens, ms });
}));

// The models a Groq key can use, from Groq's authenticated Models API, with each model's context window
// and answer limit. Text-generation models are marked `text: true`; the page offers only those.
router.post('/api/ai/models', auth, allow('configure'), wrap(async (req, res) => {
  rateLimit(req.uid, 20);
  const provider = req.body?.provider;
  if (provider !== 'groq') return res.status(400).json({ error: 'A model list is available for Groq only. Type the model name for other providers.', code: 'bad_request' });
  const store = await loadSecrets();
  let profile = resolveProfile(store, req.body?.profileId || null, provider);
  if (req.body?.apiKey && !String(req.body.apiKey).includes('…')) profile = { provider, apiKey: req.body.apiKey };
  if (!profile?.apiKey) return res.status(400).json({ error: 'Save or paste a Groq API key first.', code: 'not_configured' });
  try {
    const all = await groqModels(profile, { fresh: req.body?.fresh === true });
    res.json({ ok: true, provider, models: all.filter(m => m.text), other: all.filter(m => !m.text).map(m => m.id) });
  } catch (e) {
    if (timedOut(e)) throw fail(504, 'timeout', 'Groq did not answer within 10 seconds.');
    e.message = redact(e.message, profile.apiKey);
    throw e;
  }
}));

router.post('/api/ai/complete', auth, allow('use'), wrap(async (req, res) => {
  const feature = CAPABILITIES.includes(req.body?.feature) ? req.body.feature : 'complete';
  if (CONTENT_FEATURES.includes(feature)) rateLimit(req.uid, CONTENT_RATE, 'content'); else rateLimit(req.uid);
  const budget = req.platform ? (req.platform.settings?.integrations?.budget || {}) : (req.body?.budget || {});
  const usage = await loadUsage();
  if (budget.hardStop && budget.maxCalls && usage.month === new Date().toISOString().slice(0, 7) && usage.calls >= Number(budget.maxCalls)) {
    return res.status(429).json({ error: 'Monthly AI budget reached. Ask your coordinator to raise the limit.', code: 'budget' });
  }
  const route = pickRoute(req.body || {});
  const store = await loadSecrets();
  // FR-INT-6: the capability's provider first, then the configured fallback/primary, then any provider with a
  // key (not Groq, see IMPLICIT_FALLBACK). Fallback provider "none": only the capability's own provider.
  const integ = req.platform?.settings?.integrations || req.body || {};
  // noFallback: a request that must run on the provider the coordinator chose (Repair with AI) never goes to another one.
  const alone = req.body?.noFallback === true;
  const order = integ.fallbackProvider === 'none' || alone ? [route.provider].filter(p => PROVIDERS.includes(p))
    : [...new Set([route.provider, integ.fallbackProvider, integ.primaryProvider, ...IMPLICIT_FALLBACK].filter(p => PROVIDERS.includes(p)))];
  const candidates = order.map(p => ({ provider: p, profile: resolveProfile(store, p === route.provider ? route.profileId : null, p) })).filter(c => c.profile?.apiKey);
  const demo = !candidates.length && mockDemo() && feature === 'courseGenerate';
  if (!candidates.length && !demo) {
    const label = { openai: 'OpenAI', gemini: 'Gemini', azure_openai: 'Azure OpenAI', groq: 'Groq' }[route.provider] || route.provider;
    return res.status(400).json({ error: alone ? `${label} has no API key saved, so nothing was sent. Another provider was not used. An administrator can add the ${label} key in Settings → Integrations, or choose another provider for this feature there.` : 'SDC Learn AI is not configured yet. Ask your coordinator to add a provider in Settings → Integrations.', code: 'not_configured' });
  }

  const strip = req.body?.stripPii !== false;
  const names = req.body?.scrubNames || [];
  let messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length && req.body?.prompt) {
    messages = [
      { role: 'system', content: req.body.system || 'You are SDC Learn AI, an assistant for Skill Development Council Karachi training programmes. English only. Be accurate and concise.' },
      { role: 'user', content: req.body.prompt }
    ];
  }
  if (demo) {
    // Clearly not AI: the response says so, and the page shows it.
    const text = JSON.stringify(CG.mockOutline(messages.map(m => m.content).join('\n')));
    await trackUsage(feature, 0);
    return res.json({ text, model: 'mock-demo', provider: 'mock-demo', mock: true, tokens: 0, truncated: false, feature, badge: 'Demo mode: not AI' });
  }
  if (strip) messages = messages.map(m => ({ ...m, content: scrubPii(m.content, names) }));

  // One deadline for the whole request. Each attempt gets what is left; the next provider is only
  // tried when at least FALLBACK_MIN_MS remain, and a request that ran out of time is not repeated.
  const started = Date.now();
  let out, lastErr;
  for (const c of candidates) {
    const left = limits.deadlineMs - (Date.now() - started);
    if (out || (lastErr && left < limits.fallbackMinMs)) break;
    const t0 = Date.now();
    try { out = await complete(c.provider, c.profile, messages, { model: c.provider === route.provider ? route.model : undefined, temperature: route.temperature, maxTokens: route.maxTokens, json: route.json, schema: route.schema, timeoutMs: left }); out.ms = out.ms || Date.now() - t0; break; }
    catch (e) {
      lastErr = timedOut(e) ? fail(504, 'timeout', 'The AI took too long to answer. Try again, or reduce the size of the request.') : e;
      lastErr.message = redact(lastErr.message, c.profile.apiKey); // no provider's key ever leaves in an error text
      lastErr.provider ||= c.provider;
      console.warn(`[ai] ${c.provider} failed${timedOut(e) ? ' (timeout)' : ', trying the next provider'}:`, e.message);
      await trackUsage(null, 0, { provider: c.provider, ok: false, code: lastErr.code || 'provider', status: lastErr.status });
      if (timedOut(e)) break;
    }
  }
  if (!out) throw lastErr?.code ? lastErr : Object.assign(lastErr || new Error('AI request failed.'), { status: 502, code: 'provider' });
  await trackUsage(feature, out.tokens, { provider: out.provider, ok: true, ms: out.ms });
  res.json({
    text: out.text,
    model: out.model,
    provider: out.provider,
    tokens: out.tokens,
    ...(out.usage ? { usage: out.usage } : {}),
    ms: out.ms,
    ...(out.jsonInvalid ? { jsonInvalid: true } : {}),
    truncated: out.truncated === true,
    feature,
    badge: 'SDC Learn AI'
  });
}));

module.exports = router;
module.exports._test = { MAX_OUT_TOKENS, limits, geminiThinking, complete, scrubPii, maskKey, enc, dec, resetPlatformCache: () => { stateCache = { at: 0, state: null }; }, resetGroq: () => { groqModelCache.clear(); groqLearned.clear(); } };
