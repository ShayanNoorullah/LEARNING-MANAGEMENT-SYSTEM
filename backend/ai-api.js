/* SDC Learn AI — server proxy for OpenAI / Gemini / Azure OpenAI.
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

const CAPABILITIES = ['tutor', 'summarize', 'practiceQuiz', 'quizGenerate', 'quizCheck', 'evaluate', 'atRisk', 'sessionAssist', 'complete'];
const PROVIDERS = ['openai', 'gemini', 'azure_openai'];

/* ----------------------------- secrets store ----------------------------- */
function keyBuf() { return crypto.createHash('sha256').update(String(SECRETS_KEY)).digest(); }
function enc(obj) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', keyBuf(), iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), data: ct.toString('base64') };
}
function dec(blob) {
  if (!blob?.iv || !blob?.data) return { profiles: {} };
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf(), Buffer.from(blob.iv, 'base64'));
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
  if (provider === 'gemini' && process.env.GEMINI_API_KEY) return { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' };
  if (provider === 'azure_openai' && process.env.AZURE_OPENAI_API_KEY) return { provider: 'azure_openai', apiKey: process.env.AZURE_OPENAI_API_KEY, endpoint: process.env.AZURE_OPENAI_ENDPOINT, deployment: process.env.AZURE_OPENAI_DEPLOYMENT, apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview', model: process.env.AZURE_OPENAI_DEPLOYMENT };
  return null;
}

/* -------------------------------- usage ---------------------------------- */
async function loadUsage() {
  const u = await kvGet('ai-usage', USAGE_FILE).catch(() => null);
  return u || { month: '', calls: 0, tokens: 0, byFeature: {} };
}
// ponytail: read-modify-write, so two simultaneous calls can undercount by one; fine for a budget guard.
async function trackUsage(feature, tokens) {
  const month = new Date().toISOString().slice(0, 7);
  const u = await loadUsage();
  if (u.month !== month) { u.month = month; u.calls = 0; u.tokens = 0; u.byFeature = {}; }
  u.calls += 1; u.tokens += tokens || 0;
  u.byFeature[feature] = (u.byFeature[feature] || 0) + 1;
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
  if (!raw) return res.status(401).json({ error: 'Sign in required for SDC Learn AI.' });
  if (GATEWAY_SIGN) {
    try { req.uid = jwt.verify(raw, GATEWAY_SIGN).uid; return next(); } catch (e) { /* fall through only if local minting allowed */ }
    if (!LOCAL_OPEN) return res.status(401).json({ error: 'Your AI session expired. Sign in again.' });
  }
  try {
    const p = jwt.verify(raw, JWT_SECRET);
    if (p.purpose === 'ai' && p.uid) { req.uid = p.uid; return next(); }
  } catch (e) {}
  return res.status(401).json({ error: 'Your AI session expired. Refresh and try again.' });
}
// ponytail: platform state cached 10 s per instance for permission/budget checks; role changes apply within that window.
let stateCache = { at: 0, state: null };
async function platform() {
  if (!gw.READY) return null;
  if (Date.now() - stateCache.at > 10000) stateCache = { at: Date.now(), state: (await gw.load()).state };
  return stateCache.state;
}
const deny = (res, msg) => res.status(403).json({ error: msg });
function allow(kind) {
  return async (req, res, next) => {
    try {
      const st = await platform();
      if (!st) return next(); // local development without the gateway: the browser enforces permissions
      const me = st.users.find(u => u.id === req.uid);
      if (!me || me.status !== 'Active') return res.status(401).json({ error: 'Your account is not active.' });
      req.platform = st;
      if (kind === 'configure' && !(gw.can(st, me, 'ai', ['configure']) || gw.can(st, me, 'settings', ['edit']))) return deny(res, 'Only administrators can change SDC Learn AI integrations.');
      if (kind === 'use') {
        const integ = st.settings?.integrations || {};
        if (st.settings?.features?.ai === false || integ.aiEnabled === false) return deny(res, 'SDC Learn AI is turned off in Settings.');
        if (!gw.can(st, me, 'ai', ['use', 'configure'])) return deny(res, 'You do not have permission to use SDC Learn AI.');
      }
      next();
    } catch (e) { console.error('[ai] permission check', e); res.status(502).json({ error: 'Could not verify your permissions. Try again.' }); }
  };
}
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[ai]', e);
  res.status(e.status || 502).json({ error: e.message || 'AI request failed.' });
});

const rate = new Map();
function rateLimit(uid, max = 60) {
  const k = `${uid}:${new Date().toISOString().slice(0, 13)}`;
  const n = (rate.get(k) || 0) + 1;
  rate.set(k, n);
  if (n > max) { const err = new Error('AI rate limit reached. Try again later.'); err.status = 429; throw err; }
}

/* ---------------------------- provider calls ----------------------------- */
async function callOpenAI(profile, messages, opts = {}) {
  const base = (profile.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = opts.model || profile.model || 'gpt-4o-mini';
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens || 2048 })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `OpenAI error (${r.status})`), { status: 502 });
  return { text: j.choices?.[0]?.message?.content || '', tokens: j.usage?.total_tokens || 0, model, provider: 'openai' };
}
async function callAzure(profile, messages, opts = {}) {
  const endpoint = String(profile.endpoint || '').replace(/\/$/, '');
  const deployment = profile.deployment || profile.model;
  const ver = profile.apiVersion || '2024-08-01-preview';
  if (!endpoint || !deployment) throw Object.assign(new Error('Azure OpenAI endpoint and deployment are required.'), { status: 400 });
  const r = await fetch(`${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(ver)}`, {
    method: 'POST',
    headers: { 'api-key': profile.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens || 2048 })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Azure OpenAI error (${r.status})`), { status: 502 });
  return { text: j.choices?.[0]?.message?.content || '', tokens: j.usage?.total_tokens || 0, model: deployment, provider: 'azure_openai' };
}
async function callGemini(profile, messages, opts = {}) {
  const model = opts.model || profile.model || 'gemini-2.0-flash';
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(profile.apiKey)}`;
  const body = { contents, generationConfig: { temperature: opts.temperature ?? 0.3, maxOutputTokens: opts.maxTokens || 2048 } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Gemini error (${r.status})`), { status: 502 });
  const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  const tokens = (j.usageMetadata?.totalTokenCount) || 0;
  return { text, tokens, model, provider: 'gemini' };
}
async function complete(provider, profile, messages, opts) {
  if (provider === 'openai') return callOpenAI(profile, messages, opts);
  if (provider === 'azure_openai') return callAzure(profile, messages, opts);
  if (provider === 'gemini') return callGemini(profile, messages, opts);
  throw Object.assign(new Error('Unknown provider'), { status: 400 });
}

function pickRoute(body) {
  const provider = body.provider || 'openai';
  const profileId = body.profileId || null;
  return { provider, profileId, model: body.model, temperature: body.temperature, maxTokens: body.maxTokens };
}

/* -------------------------------- routes --------------------------------- */
router.get('/api/ai/status', wrap(async (req, res) => {
  const store = await loadSecrets();
  const profiles = Object.entries(store.profiles || {}).map(([id, p]) => ({
    id, name: p.name || id, provider: p.provider, model: p.model || p.deployment || '',
    endpoint: p.endpoint || '', deployment: p.deployment || '', apiVersion: p.apiVersion || '',
    baseUrl: p.baseUrl || '', enabled: p.enabled !== false, maskedKey: maskKey(p.apiKey),
    lastValidatedAt: p.lastValidatedAt || null
  }));
  const env = {
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    azure_openai: !!process.env.AZURE_OPENAI_API_KEY
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
  store.profiles[id] = {
    name: name || prev.name || provider,
    provider,
    apiKey: apiKey && !String(apiKey).includes('…') ? apiKey : prev.apiKey,
    model: model || prev.model || '',
    endpoint: endpoint ?? prev.endpoint ?? '',
    deployment: deployment ?? prev.deployment ?? '',
    apiVersion: apiVersion ?? prev.apiVersion ?? '',
    baseUrl: baseUrl ?? prev.baseUrl ?? '',
    enabled: enabled !== false,
    lastValidatedAt: prev.lastValidatedAt || null
  };
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
  const out = await complete(provider, profile, [
    { role: 'system', content: 'Reply with exactly: OK' },
    { role: 'user', content: 'ping' }
  ], { maxTokens: 16, temperature: 0 });
  if (profileId && store.profiles[profileId]) {
    store.profiles[profileId].lastValidatedAt = new Date().toISOString();
    await saveSecrets(store);
  }
  await trackUsage('test', out.tokens);
  res.json({ ok: true, reply: out.text.trim(), model: out.model, provider: out.provider, tokens: out.tokens });
}));

router.post('/api/ai/complete', auth, allow('use'), wrap(async (req, res) => {
  rateLimit(req.uid);
  const feature = CAPABILITIES.includes(req.body?.feature) ? req.body.feature : 'complete';
  const budget = req.platform ? (req.platform.settings?.integrations?.budget || {}) : (req.body?.budget || {});
  const usage = await loadUsage();
  if (budget.hardStop && budget.maxCalls && usage.month === new Date().toISOString().slice(0, 7) && usage.calls >= Number(budget.maxCalls)) {
    return res.status(429).json({ error: 'Monthly AI budget reached. Ask your coordinator to raise the limit.' });
  }
  const route = pickRoute(req.body || {});
  const store = await loadSecrets();
  // FR-INT-6: the capability's provider first, then the configured fallback/primary, then any provider with a key.
  const integ = req.platform?.settings?.integrations || req.body || {};
  const order = [...new Set([route.provider, integ.fallbackProvider, integ.primaryProvider, ...PROVIDERS].filter(p => PROVIDERS.includes(p)))];
  const candidates = order.map(p => ({ provider: p, profile: resolveProfile(store, p === route.provider ? route.profileId : null, p) })).filter(c => c.profile?.apiKey);
  if (!candidates.length) return res.status(400).json({ error: 'SDC Learn AI is not configured yet. Ask your coordinator to add a provider in Settings → Integrations.' });

  const strip = req.body?.stripPii !== false;
  const names = req.body?.scrubNames || [];
  let messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length && req.body?.prompt) {
    messages = [
      { role: 'system', content: req.body.system || 'You are SDC Learn AI, an assistant for Skill Development Council Karachi training programmes. English only. Be accurate and concise.' },
      { role: 'user', content: req.body.prompt }
    ];
  }
  if (strip) messages = messages.map(m => ({ ...m, content: scrubPii(m.content, names) }));

  let out, lastErr;
  for (const c of candidates) {
    try { out = await complete(c.provider, c.profile, messages, { model: c.provider === route.provider ? route.model : undefined, temperature: route.temperature, maxTokens: route.maxTokens }); break; }
    catch (e) { lastErr = e; console.warn(`[ai] ${c.provider} failed, trying the next provider:`, e.message); }
  }
  if (!out) throw lastErr;
  await trackUsage(feature, out.tokens);
  res.json({
    text: out.text,
    model: out.model,
    provider: out.provider,
    tokens: out.tokens,
    feature,
    badge: 'SDC Learn AI'
  });
}));

module.exports = router;
module.exports._test = { scrubPii, maskKey, enc, dec };
