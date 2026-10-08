/* SDC Learn — server gateway for the shared state row.
   The browser never talks to the Supabase table directly: the table is reachable only through
   two SECURITY DEFINER functions that require SDC_STATE_SECRET (see supabase/schema.sql).
   Passwords are checked here, other users' password hashes never leave the server, and only
   roles with the matching permission can change accounts, roles or settings.
   ponytail: any signed-in user still receives the whole state minus hashes; per-role filtering
   needs per-collection tables. */
const express = require('express'), crypto = require('crypto'), jwt = require('jsonwebtoken'), fs = require('fs'), path = require('path'), vm = require('vm');

const SECRET = process.env.SDC_STATE_SECRET || '';
const cfg = (() => { const w = {}; try { vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-config.js'), 'utf8'), { window: w }); } catch (e) {} return w.SDC_CLOUD_CONFIG || {}; })();
const SB_URL = process.env.SUPABASE_URL || cfg.url, SB_KEY = process.env.SUPABASE_ANON_KEY || cfg.anonKey;
const READY = !!(SECRET && SB_URL && SB_KEY);
const SIGN = crypto.createHash('sha256').update('sdc-session:' + SECRET).digest('hex');

async function rpc(fn, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_secret: SECRET, ...args }) });
  if (!r.ok) throw new Error(`Supabase ${fn} failed (${r.status}): ${await r.text()}`);
  return r.json();
}
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
// Same scheme as js/core.js hashPassword so existing accounts keep working.
const hashPassword = (pw, salt) => { let h = `${salt}:${pw}`; for (let i = 0; i < 1500; i++) h = sha(h + salt); return h; };
const verify = (u, pw) => !!u?.passwordHash && hashPassword(String(pw), u.salt) === u.passwordHash;

function seedState() {
  const SEED = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'seed.js'), 'utf8') + ';SEED', {});
  SEED.users.forEach(u => { if (u.password) { u.salt = crypto.randomBytes(8).toString('hex'); u.passwordHash = hashPassword(u.password, u.salt); delete u.password; } });
  return SEED;
}
// Same one-time upgrade as normalizeState in js/core.js, applied here because only the server may change roles.
let seedRoles;
function migrate(state) {
  if ((state.schema || 1) >= 2) return state;
  seedRoles ||= vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'seed.js'), 'utf8') + ';SEED.roles', {});
  (state.roles || []).forEach(r => { const s = seedRoles.find(x => x.id === r.id); if (!s || !r.permissions) return; ['ai', 'quizzes'].forEach(m => { if (!r.permissions[m] && s.permissions?.[m]) r.permissions[m] = [...s.permissions[m]]; }); });
  state.schema = 2;
  return state;
}
async function load() {
  const row = await rpc('sdc_state_get', {});
  if (row?.state?.users?.length) return { state: migrate(row.state), updatedAt: row.updated_at };
  const state = seedState();
  return { state, updatedAt: await rpc('sdc_state_put', { p_state: state }) };
}
const save = state => rpc('sdc_state_put', { p_state: state });

const roleOf = (s, u) => (s.roles || []).find(r => r.id === u?.role) || (s.roles || []).find(r => r.id === 'student');
const can = (s, u, mod, acts = ['create', 'edit', 'delete']) => { const r = roleOf(s, u); return !!r && (r.id === 'admin' || acts.some(a => (r.permissions?.[mod] || []).includes(a))); };
const findByEmail = (s, email) => s.users.find(u => String(u.email).toLowerCase() === String(email || '').trim().toLowerCase());
// Everyone's hash is removed except the signed-in user's own (needed for "change password").
const forClient = (s, uid) => ({ ...s, users: s.users.map(u => u.id === uid ? u : (({ passwordHash, salt, ...rest }) => rest)(u)) });
const OWN_LOCKED = ['id', 'role', 'status', 'email'];

function merge(prev, next, me) {
  const out = { ...next };
  const byId = Object.fromEntries(prev.users.map(u => [u.id, u]));
  if (can(prev, me, 'learners') || can(prev, me, 'staff')) {
    // The browser holds no hashes but your own, so a missing hash means "unchanged".
    out.users = next.users.map(u => { const old = byId[u.id]; return !u.passwordHash && old ? { ...u, passwordHash: old.passwordHash, salt: old.salt } : u; });
  } else {
    // Without account permissions you may only edit your own profile fields (and password).
    const mine = next.users.find(u => u.id === me.id) || {};
    out.users = prev.users.map(u => u.id !== me.id ? u : { ...u, ...Object.fromEntries(Object.entries(mine).filter(([k]) => !OWN_LOCKED.includes(k))), passwordHash: mine.passwordHash || u.passwordHash, salt: mine.passwordHash ? mine.salt : u.salt });
  }
  if (!can(prev, me, 'roles')) out.roles = prev.roles;
  if (!can(prev, me, 'settings', ['edit'])) out.settings = prev.settings;
  return out;
}

const router = express.Router();
router.use(express.json({ limit: '15mb' }));
router.get('/api/sdc/status', (req, res) => res.json({ gateway: READY }));
router.use('/api/sdc', (req, res, next) => READY ? next() : res.status(503).json({ error: 'Cloud gateway is not configured (SDC_STATE_SECRET).' }));

const issue = (u, remember) => jwt.sign({ uid: u.id }, SIGN, { expiresIn: remember ? '30d' : '12h' });
const session = (state, updatedAt, u, remember) => ({ token: issue(u, remember), userId: u.id, state: forClient(state, u.id), updatedAt });
function auth(req, res, next) {
  try { req.uid = jwt.verify(String(req.headers.authorization || '').replace(/^Bearer /, ''), SIGN).uid; next(); }
  catch (e) { res.status(401).json({ error: 'Your session has expired. Please sign in again.' }); }
}
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(502).json({ error: 'Cloud storage is unavailable. Please try again.' }); });

router.post('/api/sdc/login', wrap(async (req, res) => {
  const { email, password, remember } = req.body || {};
  const { state, updatedAt } = await load(), u = findByEmail(state, email);
  if (!u || !verify(u, password)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (u.status !== 'Active') return res.status(403).json({ error: 'This account is not active. Please contact your coordinator.' });
  res.json(session(state, updatedAt, u, remember));
}));

// Google: the Supabase access token proves the email; the platform account is matched by it.
router.post('/api/sdc/google', wrap(async (req, res) => {
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${req.body?.accessToken || ''}` } });
  if (!r.ok) return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  const g = await r.json(), email = String(g.email || '').toLowerCase(), meta = g.user_metadata || {};
  let { state, updatedAt } = await load(), u = findByEmail(state, email);
  const role = state.settings?.auth?.googleSignUpRole;
  if (!u && role && (state.roles || []).some(x => x.id === role)) {
    const now = new Date().toISOString();
    u = { id: 'U-' + crypto.randomUUID().slice(0, 8), name: meta.full_name || meta.name || email.split('@')[0], email, role, status: 'Active', joinedAt: now.slice(0, 10), authProvider: 'google', avatarUrl: meta.avatar_url || '' };
    state.users.push(u);
    state.users.filter(x => x.role === 'admin').forEach(a => (state.notifications = state.notifications || []).push({ id: 'N-' + crypto.randomUUID().slice(0, 8), userId: a.id, title: 'New Google sign-up', message: `${u.name} (${email}) joined via Google.`, type: 'Account', link: '#/users', date: now, read: false }));
    updatedAt = await save(state);
  }
  if (!u) return res.status(404).json({ error: `${email} isn't registered. Ask your coordinator to create your account, then try again.` });
  if (u.status !== 'Active') return res.status(403).json({ error: 'This account is not active. Please contact your coordinator.' });
  res.json(session(state, updatedAt, u, true));
}));

router.get('/api/sdc/state', auth, wrap(async (req, res) => {
  const { state, updatedAt } = await load(), me = state.users.find(u => u.id === req.uid);
  if (!me || me.status !== 'Active') return res.status(401).json({ error: 'Your account is no longer active.' });
  res.json({ state: forClient(state, me.id), updatedAt });
}));

router.put('/api/sdc/state', auth, wrap(async (req, res) => {
  const next = req.body?.state;
  if (!next || !Array.isArray(next.users) || !next.users.length) return res.status(400).json({ error: 'Invalid state.' });
  const { state } = await load(), me = state.users.find(u => u.id === req.uid);
  if (!me || me.status !== 'Active') return res.status(401).json({ error: 'Your account is no longer active.' });
  res.json({ updatedAt: await save(merge(state, next, me)) });
}));

// Public certificate check: returns only what is printed on the certificate.
router.get('/api/sdc/verify', wrap(async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase(), { state } = await load();
  const c = (state.certificates || []).find(x => String(x.code).toUpperCase() === code);
  if (!c) return res.status(404).json({ found: false });
  const learner = state.users.find(u => u.id === c.learnerId), course = (state.courses || []).find(x => x.id === c.courseId);
  res.json({ found: true, code: c.code, status: c.status, issuedAt: c.issuedAt, grade: c.grade || '', learnerName: learner?.name || '', courseTitle: course?.title || '' });
}));

// Branding for the sign-in page before anyone is signed in.
router.get('/api/sdc/public', wrap(async (req, res) => { const { state } = await load(); res.json({ settings: state.settings || {} }); }));

module.exports = router;
module.exports._test = { merge, forClient, hashPassword, verify, migrate };
// Shared with ai-api.js: the same secret-guarded storage and permission rules.
module.exports.server = { READY, load, can, rpc };
