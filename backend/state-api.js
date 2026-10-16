/* SDC Learn — server gateway for the shared state row.
   The browser never talks to the Supabase table directly: the table is reachable only through
   SECURITY DEFINER functions that require SDC_STATE_SECRET (supabase/gateway.sql, supabase/migrations/).
   Saves are conditional (sdc_state_put_if) and the 14 protected collections are checked per record.
   Passwords are checked here, other users' password hashes never leave the server, and only
   roles with the matching permission can change accounts, roles or settings (never above their own).
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
  if (!r.ok) {
    const body = await r.text(), e = new Error(`Supabase ${fn} failed (${r.status}): ${body}`);
    // dbStatus/dbCode (not status/code) so callers such as ai-api.js keep answering 502 as before.
    e.dbStatus = r.status; try { e.dbCode = JSON.parse(body).code; } catch (x) {}
    throw e;
  }
  return r.json();
}
// An error the client should see as-is: HTTP status plus a stable `code` (see wrap below).
const coded = (status, code, message) => Object.assign(new Error(message), { status, code });
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
// Same scheme as js/core.js hashPassword so existing accounts keep working.
const hashPassword = (pw, salt) => { let h = `${salt}:${pw}`; for (let i = 0; i < 1500; i++) h = sha(h + salt); return h; };
const verify = (u, pw) => !!u?.passwordHash && hashPassword(String(pw), u.salt) === u.passwordHash;

function seedState() {
  const SEED = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'seed.js'), 'utf8') + ';SEED', {});
  SEED.users.forEach(u => { if (u.password) { u.salt = crypto.randomBytes(8).toString('hex'); u.passwordHash = hashPassword(u.password, u.salt); delete u.password; } });
  return SEED;
}
// Same one-time upgrades as normalizeState in js/core.js, applied here because only the server may change roles.
const { migrateState } = require('../js/migrations.js');
let seedRoles;
function migrate(state) {
  if ((state.schema || 1) >= 4) return state;
  seedRoles ||= vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'seed.js'), 'utf8') + ';SEED.roles', {});
  return migrateState(state, seedRoles);
}
/* Safe writes (supabase/migrations/20261014000100_sdc_state_put_if.sql). sdc_state_put_if saves only
   if the row still carries the updated_at we read, so two people saving at once can no longer
   overwrite each other. updatedAt is always the raw string from the database (microseconds); it is
   never round-tripped through Date. While the function is missing, ordinary saves use the old
   unconditional sdc_state_put (today's behaviour) and AI drafts are refused (fail closed). */
const missingFn = e => e.dbStatus === 404 || e.dbCode === 'PGRST202' || e.dbCode === '42883';
let safe = { at: 0, ok: null };
async function putIf(state, expected) {
  try {
    const at = await rpc('sdc_state_put_if', { p_state: state, p_expected: expected ?? null });
    safe = { at: Date.now(), ok: true };
    return at;
  } catch (e) {
    if (!missingFn(e)) throw e;
    safe = { at: Date.now(), ok: false };
    throw coded(503, 'safe_save_unavailable', 'Course generation needs a database update. Please contact your administrator.');
  }
}
// For GET /status. An empty state can never be written (the function rejects it before any write, and
// the epoch version never matches), so the probe only tells whether the function exists. Cached 60 s.
async function safeWrite() {
  if (!READY) return false;
  if (safe.ok !== null && Date.now() - safe.at < 60000) return safe.ok;
  let ok, timer;
  // Status must stay fast: a slow database answers safeWrite:false for now (not cached).
  const slow = new Promise(r => { timer = setTimeout(() => r('slow'), 3000); });
  const probe = rpc('sdc_state_put_if', { p_state: {}, p_expected: '1970-01-01T00:00:00Z' }).then(() => true, e => e.dbCode === '22023');
  try { ok = await Promise.race([probe, slow]); } finally { clearTimeout(timer); }
  if (ok === 'slow') return false;
  safe = { at: Date.now(), ok };
  return ok;
}
const save = state => rpc('sdc_state_put', { p_state: state });
const legacy = e => e.code === 'safe_save_unavailable';

async function load() {
  for (let i = 0; i < 3; i++) {
    const row = await rpc('sdc_state_get', {});
    if (row?.state?.users?.length) return { state: migrate(row.state), updatedAt: row.updated_at };
    // First start: create the row only if nobody else did meanwhile (otherwise read theirs).
    const state = seedState();
    let at;
    try { at = await putIf(state, row ? row.updated_at : null); } catch (e) { if (!legacy(e)) throw e; at = await save(state); }
    if (at) return { state, updatedAt: at };
  }
  throw coded(503, 'busy', 'Cloud storage is busy. Please try again.');
}

/* The single write path: load -> mutate -> conditional save; on a conflict reload and re-apply the
   change (3 retries), then answer 503 busy with nothing written. mutate(state, updatedAt) returns
   { state, ...extra } to save, or { reply: [status, body] } to answer without saving. safeOnly:
   never fall back to the unconditional save (AI drafts). */
async function commit(mutate, { safeOnly = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 20 * attempt + Math.random() * 40));
    const { state, updatedAt } = await load();
    const out = await mutate(state, updatedAt);
    if (out.reply) return out;
    let at;
    try { at = await putIf(out.state, updatedAt); }
    catch (e) { if (!legacy(e) || safeOnly) throw e; return { ...out, updatedAt: await save(out.state), legacy: true }; }
    if (at) return { ...out, updatedAt: at };
  }
  throw coded(503, 'busy', 'Several people are saving at the same time. Please try again.');
}

const roleOf = (s, u) => (s.roles || []).find(r => r.id === u?.role) || (s.roles || []).find(r => r.id === 'student');
const can = (s, u, mod, acts = ['create', 'edit', 'delete']) => { const r = roleOf(s, u); return !!r && (r.id === 'admin' || acts.some(a => (r.permissions?.[mod] || []).includes(a))); };
const findByEmail = (s, email) => s.users.find(u => String(u.email).toLowerCase() === String(email || '').trim().toLowerCase());
// Everyone's hash is removed except the signed-in user's own (needed for "change password").
const forClient = (s, uid) => ({ ...s, users: s.users.map(u => u.id === uid ? u : (({ passwordHash, salt, ...rest }) => rest)(u)) });
const OWN_LOCKED = ['id', 'role', 'status', 'email'];

const listOf = (s, k) => Array.isArray(s?.[k]) ? s[k] : [];
const index = list => { const m = new Map(); list.forEach(r => { if (r && typeof r.id === 'string' && !m.has(r.id)) m.set(r.id, r); }); return m; };
// Calls fn(id, op, prevRecord, nextRecord) for every record that was created, edited or deleted.
function changes(prevList, nextList, fn) {
  const P = index(prevList), N = index(nextList);
  N.forEach((n, id) => { const p = P.get(id); if (!p) fn(id, 'create', null, n); else if (!same(p, n)) fn(id, 'edit', p, n); });
  P.forEach((p, id) => { if (!N.has(id)) fn(id, 'delete', p, null); });
}
/* One collection rebuilt from the request. d maps id -> 'drop' (refused create), 'restore' (keep the
   server's copy, or put a deleted record back) or a record to save instead. Records without an id keep
   the server's copy, duplicate ids are ignored, and a record put back goes after its previous
   neighbour so the order on screen does not change. */
function rebuild(prevList, nextList, d) {
  const P = index(prevList), seen = new Set(), list = prevList.filter(r => !r || typeof r.id !== 'string');
  nextList.forEach(r => {
    if (!r || typeof r.id !== 'string' || seen.has(r.id)) return;
    seen.add(r.id);
    const v = d.get(r.id);
    if (v !== 'drop') list.push(v === 'restore' ? P.get(r.id) : v && typeof v === 'object' ? v : r);
  });
  let after = -1;
  prevList.forEach(p => {
    if (!p || typeof p.id !== 'string') return;
    if (seen.has(p.id)) { after = list.findIndex(r => r && r.id === p.id); return; }
    if (d.get(p.id) === 'restore') { list.splice(after + 1, 0, p); after++; seen.add(p.id); }
  });
  return list;
}

/* Accounts and roles are checked record by record, with the same rules as the screens
   (js/pages-users.js): a learner account needs learners:<action>, any other account staff:<action>
   (both kinds when a role change moves it between them); nobody changes their own role or deletes
   their own account; roles need roles:<action> and built-in roles cannot be deleted. Without the
   matching permission you may still edit your own profile fields and password.
   Role ceiling (js/shared-rules.js), so nobody grants themselves or an account they control more than
   they hold: someone who is not the built-in admin can only save a role, assign a role or set the
   Google sign-up role when their own role covers it, and can only reset the password or change the
   email of an account whose role it covers (that would let them sign in as it). Only the built-in
   admin deletes an admin account. Other account changes and deletions follow the permissions alone.
   Refused changes are undone and listed in `rejected`. */
const Rules = require('../js/shared-rules.js');
const ceiling = prev => { const roles = listOf(prev, 'roles'); return { baseline: roles.find(r => r.id === 'student'), roleById: id => roles.find(r => r.id === id) }; };
function guardRoles(prev, next, me, rejected) {
  const before = listOf(prev, 'roles');
  if (!Array.isArray(next.roles)) return before;
  const mine = roleOf(prev, me), { baseline } = ceiling(prev), covered = r => Rules.covers(mine, r, baseline);
  const d = new Map();
  changes(before, next.roles, (id, op, p, n) => {
    const ok = can(prev, me, 'roles', [op]) && !(op === 'delete' && p.system) && (!n || covered(n));
    if (!ok) { d.set(id, op === 'create' ? 'drop' : 'restore'); rejected.push({ collection: 'roles', id, op }); }
  });
  const out = rebuild(before, next.roles, d);
  return same(out, before) ? before : out;
}
function guardUsers(prev, next, me, roles, rejected) {
  const kindIn = (list, u) => (list.find(r => r.id === u?.role) || list.find(r => r.id === 'student'))?.base || 'student';
  const mod = (list, u) => kindIn(list, u) === 'student' ? 'learners' : 'staff';
  const before = listOf(prev, 'roles'), validRole = u => roles.some(r => r.id === u.role);
  const mine = roleOf(prev, me), { baseline } = ceiling(prev);
  const coveredIn = (list, u) => Rules.covers(mine, list.find(r => r.id === u?.role) || list.find(r => r.id === 'student'), baseline);
  const login = u => [u.passwordHash, u.salt, String(u.email || '').toLowerCase()];
  const P = index(prev.users);
  // The browser holds no hashes but your own, so a missing hash means "unchanged".
  const sent = next.users.map(u => { const old = u && P.get(u.id); return u && !u.passwordHash && old ? { ...u, passwordHash: old.passwordHash, salt: old.salt } : u; });
  const d = new Map(), refuse = (id, op) => { d.set(id, op === 'create' ? 'drop' : 'restore'); rejected.push({ collection: 'users', id, op }); };
  changes(prev.users, sent, (id, op, p, n) => {
    if (op === 'create') return can(prev, me, mod(roles, n), ['create']) && validRole(n) && coveredIn(roles, n) ? null : refuse(id, op);
    if (op === 'delete') return id !== me.id && can(prev, me, mod(before, p), ['delete']) && (p.role !== 'admin' || mine?.id === 'admin') ? null : refuse(id, op);
    if (id !== me.id) return can(prev, me, mod(before, p), ['edit']) && can(prev, me, mod(roles, n), ['edit'])
      && (n.role === p.role || (validRole(n) && coveredIn(before, p) && coveredIn(roles, n))) && (same(login(p), login(n)) || coveredIn(before, p)) ? null : refuse(id, op);
    // Your own account: never your role; email and status only with edit permission for your kind of account.
    const own = can(prev, me, mod(before, p), ['edit'])
      ? { ...n, id: p.id, role: p.role }
      : { ...p, ...Object.fromEntries(Object.entries(n).filter(([k]) => !OWN_LOCKED.includes(k))), passwordHash: n.passwordHash || p.passwordHash, salt: n.passwordHash ? n.salt : p.salt };
    d.set(id, own);
    if (!same(own, n)) rejected.push({ collection: 'users', id, op });
  });
  return rebuild(prev.users, sent, d);
}
// Settings need settings:edit; the Google sign-up role is also held to the role ceiling.
function guardSettings(prev, next, me, roles, rejected) {
  if (!can(prev, me, 'settings', ['edit'])) return prev.settings;
  const was = prev.settings?.auth?.googleSignUpRole, now = next.settings?.auth?.googleSignUpRole;
  if (!now || now === was || Rules.covers(roleOf(prev, me), roles.find(r => r.id === now), ceiling(prev).baseline)) return next.settings;
  rejected.push({ collection: 'settings', id: 'auth.googleSignUpRole', op: 'edit' });
  const auth = { ...next.settings.auth };
  if (was === undefined) delete auth.googleSignUpRole; else auth.googleSignUpRole = was;
  return { ...next.settings, auth };
}
// rejected (optional) collects the refused account, role and settings changes.
function merge(prev, next, me, rejected = []) {
  const out = { ...next };
  out.roles = guardRoles(prev, next, me, rejected);
  out.users = guardUsers(prev, next, me, out.roles, rejected);
  out.settings = guardSettings(prev, next, me, out.roles, rejected);
  return out;
}

/* The 14 protected collections are checked record by record against the server's copy (prev).
   create = id new, edit = same id with different content, delete = id missing from the request.
   Rules follow what the screens allow. "In scope" = the record's course is one the actor's course
   access covers (Domain.visibleCourses in js/core.js):
     courses       create courses:create (+ courses:publish unless it starts as a draft); edit
                   courses:edit in scope (+ courses:publish if status changes); delete courses:delete in scope
     sessions      courses:edit, course in scope (the course builder)
     batches       create batches:create, or the first batch of a course the actor creates in this request;
                   edit batches:edit, or only clearing instructorId of an account deleted in this request;
                   delete batches:delete
     assignments,  the batch workspace (Domain.canManageBatch): courses:edit (quizzes also quizzes:<action>,
     quizzes       publishing also quizzes:publish) and the course in scope or the actor teaches the batch;
                   an assignment that has submissions is not deleted
     quizAttempts  learner: own attempt at a published quiz of their batch, within the attempt limit, scored
                   here from the stored answer key; staff: reviewing scores like a quiz edit, answers fixed
     submissions   learner: own upload for a published assignment of their batch, no marks, not after grading,
                   not when late work is closed; staff: submissions:edit in scope, marks 0 to the maximum
     attendance    attendance:edit in scope        results   results:edit in scope
     progress      learner: own progress in an enrolled course, only sessions of that course
     feedback      learner: own rating 1-5 for an enrolled course; delete feedback:delete in scope
     certificates  create certificates:create (a code already taken gets the next free number); edit
                   certificates:edit, status and revocation only (code, learner, course, grade stay)
     fees          fees:<action>; enrolling with "create a course fee" adds that fee with enrollments:create
     enrollments   enrollments:<action>, one enrollment per learner and course
   Fees, certificates and enrollments are organisation-wide on their screens, so they have no course
   scope. Anything else (for example deleting attendance or a submission outside a cascade) needs the
   built-in admin. Scope comes from prev, so nobody can widen their own access in the same request.
   Deletion needs proof: a record missing from the request is deleted only if its id is in
   base.known (the ids that browser last received from the server). Anything else missing (a stale
   tab, an outdated app version, a record created by someone else meanwhile) is kept.
   Stale copies: base.fresh lists the known records the browser has not changed since it received
   them. Such a record that differs from the server's copy is out of date, so the server's copy is
   kept; one the server no longer has was deleted by someone else, so it is not brought back.
   Cascades: deleting a course, session, batch, enrollment or account also removes its related records
   (js/pages-manage.js, js/pages-users.js); those need no proof of their own. When that deletion is
   refused or unproven, the related records the request removed with it are put back.
   Rejected changes are undone one record at a time; everything else in the request is saved. */
const PROTECTED = ['courses', 'sessions', 'batches', 'enrollments', 'assignments', 'quizzes', 'quizAttempts', 'submissions', 'attendance', 'progress', 'results', 'feedback', 'certificates', 'fees'];
// Related records removed by deleteCourse (js/pages-manage.js) and by deleting an account (js/pages-users.js).
const COURSE_CHILDREN = ['assignments', 'submissions', 'attendance', 'enrollments', 'progress', 'results', 'feedback', 'quizzes', 'quizAttempts'];
const LEARNER_RECORDS = ['enrollments', 'progress', 'submissions', 'attendance', 'results', 'certificates', 'feedback'];
const CERT_LOCKED = ['code', 'learnerId', 'courseId', 'issuedAt', 'grade', 'issuedBy'];
const MAX_KNOWN = 100000;
// Key order does not matter: the same record from two browsers compares equal.
const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : JSON.stringify(v) ?? 'null';
const same = (a, b) => stable(a) === stable(b);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
// Past due wherever the browser is: a due time without a zone is read as UTC plus 14 hours (the widest
// time zone offset), so the server never closes work that is still open for the learner.
const pastDue = due => { const s = String(due || ''), t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : s + 'Z'); return !!due && Number.isFinite(t) && Date.now() > t + 14 * 3600e3; };

// base.known / base.fresh from the browser -> Sets (fresh only within known). Missing or malformed =
// empty (deletes nothing, everything counts as changed); too large = null.
function readKnown(base) {
  const known = {}, fresh = {};
  for (const k of PROTECTED) {
    const ids = base?.known?.[k], f = base?.fresh?.[k];
    if ((Array.isArray(ids) && ids.length > MAX_KNOWN) || (Array.isArray(f) && f.length > MAX_KNOWN)) return null;
    known[k] = new Set(Array.isArray(ids) ? ids.filter(x => typeof x === 'string') : []);
    fresh[k] = new Set(Array.isArray(f) ? f.filter(x => typeof x === 'string' && known[k].has(x)) : []);
  }
  known.fresh = fresh;
  return known;
}

// keptUsers: accounts whose deletion merge() refused in this request (their records stay too).
function guardCourseData(prev, next, me, known, keptUsers = new Set()) {
  known = known || readKnown(null);
  const fresh = known.fresh || readKnown(null).fresh;
  const role = roleOf(prev, me), admin = role?.id === 'admin';
  const may = (mod, act) => admin || (role?.permissions?.[mod] || []).includes(act);
  const arr = listOf;
  const P = {}, N = {};
  PROTECTED.forEach(k => { P[k] = index(arr(prev, k)); N[k] = index(arr(next, k)); });
  const scope = role?.courseScope, mine = new Set(arr(prev, 'batches').filter(b => b.instructorId === me.id).map(b => b.courseId));
  const enrolment = courseId => arr(prev, 'enrollments').find(e => e && e.learnerId === me.id && e.courseId === courseId && e.status !== 'Withdrawn');
  const enrolled = new Set(arr(prev, 'enrollments').filter(e => e && e.learnerId === me.id && e.status !== 'Withdrawn').map(e => e.courseId));
  const created = new Set();
  // Same as Domain.visibleCourses in js/core.js; enrolled = published courses the actor is enrolled in.
  const inScope = id => admin || scope === 'all' || (scope === 'selected' && (role.courseIds || []).includes(id)) || (scope === 'assigned' && mine.has(id))
    || ((!scope || scope === 'enrolled') && enrolled.has(id) && P.courses.get(id)?.status === 'published') || created.has(id);
  // A learner's own course (courseAccess in js/pages-learn.js): enrolled, not withdrawn, published.
  const learnsIn = courseId => !!enrolment(courseId) && P.courses.get(courseId)?.status === 'published';
  const rejected = [], decisions = Object.fromEntries(PROTECTED.map(k => [k, new Map()]));
  let kept = 0;
  // decision per id: 'take' next, 'gone' (deleted), 'drop' (rejected create), 'restore' prev, or a record to save instead
  const judge = (k, id, op, res, n) => {
    if (isObj(res)) { decisions[k].set(id, res); if (!same(res, n)) kept++; return true; }
    decisions[k].set(id, res ? (op === 'delete' ? 'gone' : 'take') : (op === 'create' ? 'drop' : 'restore'));
    if (!res) rejected.push({ collection: k, id, op });
    return !!res;
  };
  const each = (k, fn) => changes(arr(prev, k), arr(next, k), (id, op, p, n) => {
    // An unchanged stale copy: keep the server's version, and do not bring back what it deleted.
    if (op !== 'delete' && fresh[k].has(id)) { decisions[k].set(id, op === 'create' ? 'drop' : 'restore'); kept++; return; }
    fn(id, op, p, n);
  });
  const unproven = (k, id) => { decisions[k].set(id, 'restore'); kept++; };
  // The record as it will be saved (after the decisions so far).
  const now = (k, id) => { const v = decisions[k].get(id); return v === 'take' ? N[k].get(id) : isObj(v) ? v : v === 'drop' || v === 'gone' ? undefined : P[k].get(id); };
  // Deleted in this request (gone) / deletion refused or unproven, so its related records come back (keptBack).
  const gone = {}, keptBack = {};
  const settle = k => { gone[k] = new Set(); keptBack[k] = new Set(); decisions[k].forEach((v, id) => { if (v === 'gone') gone[k].add(id); else if (v === 'restore' && !N[k].has(id)) keptBack[k].add(id); }); };
  const users = new Set(arr(next, 'users').map(u => u?.id)), had = new Set(arr(prev, 'users').map(u => u?.id)), userGone = id => had.has(id) && !users.has(id);
  const pairCache = new Map(), pairs = ids => { if (!pairCache.has(ids)) pairCache.set(ids, new Set([...ids].map(id => P.enrollments.get(id)).filter(Boolean).map(e => `${e.learnerId}|${e.courseId}`))); return pairCache.get(ids); };
  const cascade = (k, p) => ((k === 'sessions' || k === 'batches' || COURSE_CHILDREN.includes(k)) && gone.courses.has(p.courseId))
    || (k === 'attendance' && gone.sessions.has(p.sessionId)) || ((k === 'assignments' || k === 'quizzes') && gone.batches.has(p.batchId))
    || (k === 'quizAttempts' && gone.quizzes.has(p.quizId)) || (k === 'progress' && pairs(gone.enrollments).has(`${p.learnerId}|${p.courseId}`))
    || (LEARNER_RECORDS.includes(k) && userGone(p.learnerId));
  const parentKept = (k, p) => ((k === 'sessions' || k === 'batches' || COURSE_CHILDREN.includes(k)) && keptBack.courses.has(p.courseId))
    || (k === 'attendance' && keptBack.sessions.has(p.sessionId)) || ((k === 'assignments' || k === 'quizzes') && keptBack.batches.has(p.batchId))
    || (k === 'quizAttempts' && keptBack.quizzes.has(p.quizId)) || (k === 'progress' && pairs(keptBack.enrollments).has(`${p.learnerId}|${p.courseId}`))
    || (LEARNER_RECORDS.includes(k) && keptUsers.has(p.learnerId));

  each('courses', (id, op, p, n) => {
    if (op === 'create') { if (judge('courses', id, op, may('courses', 'create') && ((n.status || 'draft') === 'draft' || may('courses', 'publish')))) created.add(id); }
    else if (op === 'edit') judge('courses', id, op, may('courses', 'edit') && inScope(id) && (same(p.status, n.status) || may('courses', 'publish')));
    else if (!known.courses.has(id)) unproven('courses', id);
    else judge('courses', id, op, may('courses', 'delete') && inScope(id));
  });
  settle('courses');

  const editsCourse = c => may('courses', 'edit') && inScope(c);
  const onlyUnassigned = (p, n) => n.instructorId === '' && p.instructorId && !users.has(p.instructorId) && same({ ...p, instructorId: '' }, n);
  const teaches = batchId => !!batchId && (P.batches.get(batchId) || now('batches', batchId))?.instructorId === me.id;
  // The batch workspace (Domain.canManageBatch); extra = the quizzes action that also allows it.
  const work = (r, extra) => !!r && (may('courses', 'edit') || (!!extra && may('quizzes', extra))) && (inScope(r.courseId) || teaches(r.batchId))
    && !(r.batchId && now('batches', r.batchId) && now('batches', r.batchId).courseId !== r.courseId);
  const questions = index(arr(prev, 'questions')), lms = prev.settings?.lms || {};
  const unchanged = (p, n, keys) => keys.every(k => same(p?.[k], n?.[k]));
  const enrolKeys = new Set(arr(prev, 'enrollments').filter(Boolean).map(e => `${e.learnerId}|${e.courseId}`)), newEnrol = [], attempts = new Map();
  const codes = new Set(arr(prev, 'certificates').map(c => String(c?.code || '').toUpperCase()));
  const nextCode = code => {
    const m = /^(.*-)(\d+)$/.exec(code), base = m ? m[1] : `${lms.certificatePrefix || 'CERT'}-${new Date().getFullYear()}-`;
    let max = 0; codes.forEach(c => { if (c.startsWith(base.toUpperCase())) max = Math.max(max, Number(c.slice(base.length)) || 0); });
    return base + String(max + 1).padStart(m ? m[2].length : 4, '0');
  };
  const RULE = {
    sessions: (op, p, n) => { const cs = [p?.courseId, n?.courseId].filter(x => x !== undefined); return admin || (cs.length > 0 && cs.every(c => editsCourse(c) || (created.has(c) && may('courses', 'create')))); },
    batches: (op, p, n) => op === 'create' ? may('batches', 'create') || (created.has(n.courseId) && may('courses', 'create') && n.instructorId === me.id)
      : op === 'edit' ? may('batches', 'edit') || onlyUnassigned(p, n) : may('batches', 'delete'),
    enrollments: (op, p, n) => {
      if (!may('enrollments', op)) return false;
      if (op === 'delete') return true;
      const key = `${n.learnerId}|${n.courseId}`;
      if (!users.has(n.learnerId) || ((!p || key !== `${p.learnerId}|${p.courseId}`) && enrolKeys.has(key))) return false;
      enrolKeys.add(key); if (op === 'create') newEnrol.push(n);
      return true;
    },
    assignments: (op, p, n) => op === 'delete' ? work(p) && !arr(prev, 'submissions').some(s => s?.assignmentId === p.id) : (!p || work(p)) && work(n),
    quizzes: (op, p, n) => {
      if (op === 'delete') return work(p, 'delete');
      const publishing = (n.status === 'published') !== (p?.status === 'published');
      return (!p || work(p, op)) && work(n, op) && (!publishing || may('courses', 'edit') || may('quizzes', 'publish'));
    },
    quizAttempts: (op, p, n) => {
      if (admin) return true;
      if (op === 'delete') return false;
      if (op === 'edit') return unchanged(p, n, ['learnerId', 'quizId', 'courseId', 'answers', 'submittedAt']) && work({ courseId: p.courseId, batchId: now('quizzes', p.quizId)?.batchId }, 'edit');
      // A learner's own attempt (renderQuizAttempt in js/pages-ai.js), scored here like in the browser.
      const q = P.quizzes.get(n.quizId);
      if (n.learnerId !== me.id || !q || q.status !== 'published' || n.courseId !== q.courseId || !learnsIn(q.courseId) || enrolment(q.courseId).batchId !== q.batchId || n.status !== 'Submitted') return false;
      const used = attempts.get(q.id) ?? arr(prev, 'quizAttempts').filter(a => a?.quizId === q.id && a.learnerId === me.id && a.status === 'Submitted').length;
      if (Number(q.attemptLimit) > 0 && used >= Number(q.attemptLimit)) return false;
      attempts.set(q.id, used + 1);
      const qs = (q.questionIds || []).map(id => questions.get(id)).filter(Boolean), reviews = { ...(isObj(n.aiReviews) ? n.aiReviews : {}) };
      qs.filter(x => x.type === 'short').forEach(x => { const r = reviews[x.id]; if (isObj(r) && r.points != null) reviews[x.id] = { ...r, points: Math.min(Number(x.points) || 1, Math.max(0, Number(r.points) || 0)) }; });
      const g = Rules.gradeAttempt(qs, n.answers, reviews);
      return { ...n, aiReviews: reviews, score: g.score, maxScore: g.maxScore, percent: g.percent, detail: g.detail, pendingShort: g.pending };
    },
    submissions: (op, p, n) => {
      if (admin) return true;
      if (op === 'delete') return false;
      const a = P.assignments.get(n.assignmentId);
      // Grading (gradeModal in js/pages-ops.js).
      if (op === 'edit' && may('submissions', 'edit') && inScope(p.courseId) && inScope(n.courseId))
        return same(n.grade, p.grade) || n.grade == null || (typeof n.grade === 'number' && n.grade >= 0 && !(n.grade > Number(a?.maxMarks)));
      // A learner's own upload (the submit page in js/pages-learn.js): never marks, never after grading.
      if (n.learnerId !== me.id || (p && (p.learnerId !== me.id || p.status === 'Graded'))) return false;
      if (!a || a.status === 'Draft' || n.courseId !== a.courseId || !learnsIn(a.courseId) || enrolment(a.courseId).batchId !== a.batchId) return false;
      if (n.grade != null || n.feedback || !['Submitted', 'Late'].includes(n.status)) return false;
      if (p ? !unchanged(p, n, ['assignmentId', 'courseId', 'gradedAt', 'gradedBy', 'aiDraft', 'aiAssisted']) || !same((n.history || []).slice(0, (p.history || []).length), p.history || [])
        : n.gradedAt || n.gradedBy || n.aiDraft || n.aiAssisted) return false;
      const late = pastDue(a.dueAt);
      if (late && (a.lateAllowed === false || lms.lateSubmissions === false)) return false;
      return late && n.status === 'Submitted' ? { ...n, status: 'Late' } : true;
    },
    attendance: (op, p, n) => op === 'delete' ? admin
      : may('attendance', 'edit') && (!p || inScope(p.courseId)) && inScope(n.courseId) && !(now('sessions', n.sessionId) && now('sessions', n.sessionId).courseId !== n.courseId),
    results: (op, p, n) => op === 'delete' ? admin : may('results', 'edit') && (!p || inScope(p.courseId)) && inScope(n.courseId),
    progress: (op, p, n) => {
      if (admin) return true;
      if (op === 'delete' || n.learnerId !== me.id || (p && !unchanged(p, n, ['learnerId', 'courseId'])) || !learnsIn(n.courseId)) return false;
      const had = new Set(p?.completedSessionIds || []);
      return (Array.isArray(n.completedSessionIds) ? n.completedSessionIds : []).every(id => had.has(id) || P.sessions.get(id)?.courseId === n.courseId);
    },
    feedback: (op, p, n) => admin || (op === 'delete' ? may('feedback', 'delete') && inScope(p.courseId)
      : op === 'create' && n.learnerId === me.id && learnsIn(n.courseId) && Number.isInteger(n.rating) && n.rating >= 1 && n.rating <= 5),
    certificates: (op, p, n) => {
      if (op === 'delete') return admin;
      if (op === 'edit') return may('certificates', 'edit') && (admin || unchanged(p, n, CERT_LOCKED));
      if (!may('certificates', 'create')) return false;
      // Codes are numbered in the browser, so two people issuing at once can pick the same one.
      let code = String(n.code || '');
      if (!code || codes.has(code.toUpperCase())) code = nextCode(code);
      codes.add(code.toUpperCase());
      const out = { ...n, code, issuedBy: admin && n.issuedBy ? n.issuedBy : me.id };
      return same(out, n) ? true : out;
    },
    // "Create a course fee record" when enrolling (enrollmentModal in js/pages-manage.js).
    fees: (op, p, n) => may('fees', op) || (op === 'create' && !!P.courses.get(n.courseId) && newEnrol.some(e => e.learnerId === n.learnerId && e.courseId === n.courseId)
      && n.type === 'Course Fee' && Number(n.amount) === Number(P.courses.get(n.courseId).fee) && n.status === 'Pending' && !n.paidOn && !n.method && !n.reference)
  };
  PROTECTED.slice(1).forEach(k => {
    each(k, (id, op, p, n) => {
      if (op === 'delete' && cascade(k, p)) return judge(k, id, op, true);
      if (op === 'delete' && !known[k].has(id)) return unproven(k, id);
      if (op === 'delete' && parentKept(k, p)) return judge(k, id, op, false);
      // Deleting a session clears assignment.sessionId; when that session stays, so does the link.
      const m = k === 'assignments' && op === 'edit' && !n.sessionId && keptBack.sessions.has(p.sessionId) ? { ...n, sessionId: p.sessionId } : n;
      const res = RULE[k](op, p, m);
      judge(k, id, op, res === true && m !== n ? m : res, n);
    });
    settle(k);
  });

  const out = { ...next };
  PROTECTED.forEach(k => { if (Array.isArray(prev[k]) || Array.isArray(next[k])) out[k] = rebuild(arr(prev, k), arr(next, k), decisions[k]); });
  return { state: out, rejected, resync: rejected.length > 0 || kept > 0 };
}

// One browser save, as PUT /api/sdc/state applies it: accounts, roles and settings first, then the
// 14 protected collections (an account whose deletion was refused keeps its learner records).
function applySave(prev, next, me, known) {
  const refused = [], merged = merge(prev, next, me, refused);
  const g = guardCourseData(prev, merged, me, known, new Set(refused.filter(x => x.collection === 'users' && x.op === 'delete').map(x => x.id)));
  return { state: g.state, rejected: [...refused, ...g.rejected], resync: g.resync || refused.length > 0 };
}

const router = express.Router();
router.use(express.json({ limit: '15mb' }));
// safeWrite: sdc_state_put_if is installed (AI drafts and conflict-safe saving need it).
router.get('/api/sdc/status', (req, res) => safeWrite().catch(() => false).then(ok => res.json({ gateway: READY, safeWrite: ok })));
router.use('/api/sdc', (req, res, next) => READY ? next() : res.status(503).json({ error: 'Cloud gateway is not configured (SDC_STATE_SECRET).' }));

const issue = (u, remember) => jwt.sign({ uid: u.id }, SIGN, { expiresIn: remember ? '30d' : '12h' });
const session = (state, updatedAt, u, remember) => ({ token: issue(u, remember), userId: u.id, state: forClient(state, u.id), updatedAt });
function auth(req, res, next) {
  try { req.uid = jwt.verify(String(req.headers.authorization || '').replace(/^Bearer /, ''), SIGN).uid; next(); }
  catch (e) { res.status(401).json({ error: 'Your session has expired. Please sign in again.', code: 'auth_expired' }); }
}
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e.code && e.status) return res.status(e.status).json({ error: e.message, code: e.code });
  console.error(e); res.status(502).json({ error: 'Cloud storage is unavailable. Please try again.' });
});

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
    const nu = { id: 'U-' + crypto.randomUUID().slice(0, 8), name: meta.full_name || meta.name || email.split('@')[0], email, role, status: 'Active', joinedAt: now.slice(0, 10), authProvider: 'google', avatarUrl: meta.avatar_url || '' };
    // Conditional save: a sign-up never overwrites a change someone else saved a moment earlier.
    ({ state, updatedAt } = await commit((s, at) => {
      if (findByEmail(s, email)) return { reply: true, state: s, updatedAt: at }; // created meanwhile: nothing to save
      s.users.push(nu);
      s.users.filter(x => x.role === 'admin').forEach(a => (s.notifications = s.notifications || []).push({ id: 'N-' + crypto.randomUUID().slice(0, 8), userId: a.id, title: 'New Google sign-up', message: `${nu.name} (${email}) joined via Google.`, type: 'Account', link: '#/users', date: now, read: false }));
      return { state: s };
    }));
    u = findByEmail(state, email);
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

// Whole-state save from the browser. base.known lists the ids of the 14 protected collections that
// browser last received and base.fresh those it has not changed since; browsers without it (older app
// versions) can change but not delete those records (cascades still apply).
// rejected: changes the server undid; resync: the saved copy differs from the request, re-download it.
router.put('/api/sdc/state', auth, wrap(async (req, res) => {
  const body = req.body?.state;
  if (!body || !Array.isArray(body.users) || !body.users.length) return res.status(400).json({ error: 'Invalid state.' });
  const { _sync, ...next } = body; // the browser's own sync bookkeeping (js/cloud-sync.js) is never stored
  const known = readKnown(req.body?.base);
  if (!known) return res.status(400).json({ error: 'Invalid sync metadata.', code: 'bad_request' });
  const out = await commit(state => {
    const me = state.users.find(u => u.id === req.uid);
    if (!me || me.status !== 'Active') return { reply: [401, { error: 'Your account is no longer active.' }] };
    return applySave(state, next, me, known);
  });
  if (out.reply) return res.status(out.reply[0]).json(out.reply[1]);
  res.json({ updatedAt: out.updatedAt, ...(out.rejected.length ? { rejected: out.rejected } : {}), ...(out.resync ? { resync: true } : {}) });
}));

/* AI course drafts. One generation id (genId) per draft decides duplicates: ids are derived from it
   and an existing course with the same genId is returned instead of creating another, re-checked on
   every conflict retry, so retries and simultaneous requests can never create two courses.
   Fail closed: only the conditional save is used (503 safe_save_unavailable while it is missing). */
const CG = require('../js/coursegen-logic.js');
const draftReply = (state, course, updatedAt, alreadyCommitted) => ({
  courseId: course.id, updatedAt, alreadyCommitted,
  course, sessions: (state.sessions || []).filter(s => s.courseId === course.id), batch: (state.batches || []).find(b => b.id === CG.ids(course.aiMeta.genId).batch) || null
});
function draftGate(state, uid) {
  const me = state.users.find(u => u.id === uid);
  if (!me || me.status !== 'Active') return [401, { error: 'Your account is no longer active.' }];
  if (!can(state, me, 'courses', ['create'])) return [403, { error: 'Your role cannot create courses.', code: 'forbidden' }];
  if (state.settings?.features?.courseGen !== true) return [403, { error: 'AI course generation is turned off in Settings.', code: 'disabled' }];
  return me;
}
function deliveryLabel(state, value) {
  const p = String(state.settings?.lms?.deliveryModes || '').split('|').map(x => x.split(':')).find(([v]) => String(v).trim() === value);
  return p ? String(p[1] || p[0]).trim() : value;
}
router.post('/api/sdc/courses/ai-draft', auth, wrap(async (req, res) => {
  const { genId, outline, meta } = req.body || {};
  if (!CG.validGenId(genId)) return res.status(400).json({ error: 'Invalid generation id.', code: 'bad_request' });
  const problem = CG.validate(outline);
  if (problem) return res.status(400).json({ error: problem, code: 'limits' });
  const out = await commit((state, updatedAt) => {
    const me = draftGate(state, req.uid);
    if (Array.isArray(me)) return { reply: me };
    const done = (state.courses || []).find(c => c.aiMeta?.genId === genId);
    if (done) return { reply: [200, draftReply(state, done, updatedAt, true)] };
    const id = CG.ids(genId), sessionPrefix = id.session(0).slice(0, -2);
    if ([...(state.courses || []), ...(state.sessions || []), ...(state.batches || [])].some(r => r && (r.id === id.course || r.id === id.batch || String(r.id).startsWith(sessionPrefix))))
      return { reply: [409, { error: 'This generation id clashes with existing records. Start a new draft.', code: 'id_conflict' }] };
    const role = roleOf(state, me), ownBatch = role?.id !== 'admin' && role?.courseScope !== 'all';
    const now = new Date().toISOString(), title = String(outline.title).trim();
    const short = (CG.slugify(outline.slug || title).split('-')[0] || 'Course').replace(/^./, c => c.toUpperCase());
    const taken = new Set((state.batches || []).map(b => b.name)), base = [short, deliveryLabel(state, String(outline.delivery || 'online').trim()), now.slice(0, 4)].join('-');
    let name = base; for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    const recs = CG.build({ genId, outline, userId: me.id, ownBatch, now, batchName: name, meta: isObj(meta) ? meta : {} });
    // Same rules as the manual form: only an all-courses coordinator picks the program and division, and they must exist.
    if (ownBatch || !(state.programs || []).some(x => x.id === recs.course.programId)) recs.course.programId = '';
    if (ownBatch || !(state.divisions || []).some(x => x.id === recs.course.divisionId)) recs.course.divisionId = '';
    if ((state.courses || []).some(c => c.slug === recs.course.slug)) return { reply: [409, { error: 'Another course already uses this slug.', code: 'slug_in_use', slug: recs.course.slug }] };
    return {
      recs,
      state: { ...state, courses: [...(state.courses || []), recs.course], sessions: [...(state.sessions || []), ...recs.sessions], batches: recs.batch ? [...(state.batches || []), recs.batch] : (state.batches || []) }
    };
  }, { safeOnly: true });
  if (out.reply) return res.status(out.reply[0]).json(out.reply[1]);
  res.json({ courseId: out.recs.course.id, updatedAt: out.updatedAt, alreadyCommitted: false, course: out.recs.course, sessions: out.recs.sessions, batch: out.recs.batch });
}));
// Was this draft saved? Used after a timeout or lost response, before retrying the same genId.
router.get('/api/sdc/courses/ai-draft/:genId', auth, wrap(async (req, res) => {
  const genId = req.params.genId;
  if (!CG.validGenId(genId)) return res.status(400).json({ error: 'Invalid generation id.', code: 'bad_request' });
  const { state, updatedAt } = await load(), me = state.users.find(u => u.id === req.uid);
  if (!me || me.status !== 'Active') return res.status(401).json({ error: 'Your account is no longer active.' });
  if (!can(state, me, 'courses', ['create'])) return res.status(403).json({ error: 'Your role cannot create courses.', code: 'forbidden' });
  const c = (state.courses || []).find(x => x.aiMeta?.genId === genId);
  if (!c) return res.json({ committed: false });
  if (c.aiMeta.createdBy !== me.id && roleOf(state, me)?.id !== 'admin') return res.status(403).json({ error: 'This draft belongs to someone else.', code: 'forbidden' });
  res.json({ committed: true, courseId: c.id, updatedAt });
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
module.exports._test = { applySave, merge, forClient, hashPassword, verify, migrate, guardCourseData, readKnown, same, rebuild, PROTECTED, pastDue, resetSafeWrite: () => { safe = { at: 0, ok: null }; } };
// Shared with ai-api.js: the same secret-guarded storage and permission rules.
module.exports.server = { READY, load, can, rpc, commit };
