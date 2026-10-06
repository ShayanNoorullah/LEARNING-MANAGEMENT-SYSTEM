/* SDC Learn — core platform layer.
   Data store (LocalStorage + optional cloud sync), configuration & terminology,
   authentication, formatting helpers and the shared UI kit used by every page. */

/* ------------------------------------------------------------------ store */
const DBKEY = 'sdcLearnDB_v1';
const COLLECTIONS = ['roles', 'users','divisions','programs','courses','batches','sessions','assignments','enrollments','submissions','progress','attendance','results','fees','announcements','messages','notifications','certificates','feedback'];

const DEFAULT_SETTINGS = {
  brand: {
    productName: 'SDC Learn',
    orgName: 'Skill Development Council Karachi',
    orgShort: 'SDC Karachi',
    tagline: 'Demand-driven skills training',
    subTagline: 'Live online classes on Zoom with recorded access, plus onsite training at SDC Karachi.',
    logoUrl: 'assets/brand/sdc-logo.png',
    lockupUrl: 'assets/brand/sdc-lockup.png',
    website: 'https://sdckarachi.org.pk/',
    phone: '(021) 99334387, 99334388',
    email: 'sdckar@sdckarachi.org.pk',
    address: 'Karachi, Pakistan',
    established: 'Est. 1995 · National Training Ordinance 1980 / 2002 · MoFEPT, Government of Pakistan',
    footer: '© {year} Skill Development Council Karachi. All rights reserved.'
  },
  theme: { mode: 'light', primary: '#0F3D6E', accent: '#0F766E', highlight: '#C9A227', radius: 12 },
  terms: {
    learner: 'Learner', learners: 'Learners', instructor: 'Instructor', instructors: 'Instructors',
    admin: 'Coordinator', admins: 'Coordinators', course: 'Course', courses: 'Courses',
    session: 'Session', sessions: 'Sessions', module: 'Module', batch: 'Batch', batches: 'Batches',
    program: 'Program', programs: 'Programs', division: 'Division', divisions: 'Divisions',
    assignment: 'Assignment', assignments: 'Assignments', fee: 'Fee', fees: 'Fees'
  },
  lms: {
    helpUrl: 'mailto:sdckar@sdckarachi.org.pk?subject=SDC%20Learn%20support',
    uploadEndpoint: '/api/lms/uploads',
    uploadMaxMB: 30,
    allowedTypes: 'xlsx,xls,csv,docx,pptx,pdf,pbix,twbx,ipynb,sql,txt,zip',
    inlineFallbackMB: 1.5,
    lateSubmissions: true,
    completionPercent: 80,
    attendanceWarning: 75,
    weightAssignments: 40, weightAssessment: 40, weightAttendance: 20,
    passPercent: 50,
    gradeBands: 'A+:90|A:80|B:70|C:60|D:50',
    certificatePrefix: 'SDC',
    currency: 'PKR',
    programTypes: 'diploma:Diploma|certificate:Certificate|workshop:Workshop|short:Short Course',
    levels: 'Beginner|Intermediate|Advanced|All levels',
    deliveryModes: 'online:Online|onsite:Onsite|hybrid:Hybrid',
    feeTypes: 'Registration Fee|Course Fee|Examination Fee|Certificate Fee|Miscellaneous',
    showDemoAccounts: true,
    feedbackAtPercent: 40
  },
  features: { attendance: true, results: true, certificates: true, fees: true, messages: true, announcements: true, calendar: true, feedback: true },
  auth: { googleEnabled: true, googleSignUpRole: '' },
  general: { pageSize: 10 }
};

let _cache = null;
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
function deepMerge(base, over) {
  const out = clone(base);
  if (!isObj(over)) return out;
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  return out;
}
function normalizeState(input) {
  const seed = typeof SEED !== 'undefined' ? SEED : {};
  const src = isObj(input) ? input : clone(seed);
  COLLECTIONS.forEach(k => { if (!Array.isArray(src[k])) src[k] = clone(seed[k] || []); });
  src.settings = deepMerge(DEFAULT_SETTINGS, src.settings || {});
  if (src.settings.brand.logoUrl === 'assets/brand/sdc-logo.svg') src.settings.brand.logoUrl = DEFAULT_SETTINGS.brand.logoUrl; // placeholder replaced by official logo
  // Seeded demo users carry a plaintext password once; store only salted hashes.
  src.users.forEach(u => { if (u.password) { u.salt = u.salt || randomToken(8); u.passwordHash = hashPassword(u.password, u.salt); delete u.password; } });
  return src;
}
function db() {
  if (_cache) return _cache;
  let raw = null;
  try { raw = localStorage.getItem(DBKEY); } catch (e) {}
  let state;
  try { state = normalizeState(raw ? JSON.parse(raw) : null); } catch (e) { state = normalizeState(null); }
  if (!raw) persist(state);
  _cache = state;
  return state;
}
function persist(state) {
  try { localStorage.setItem(DBKEY, JSON.stringify(state)); }
  catch (e) { toast('Browser storage is full. Remove large inline files or connect the upload server.', 'error'); throw e; }
}
function saveDB(state) {
  _cache = normalizeState(state);
  persist(_cache);
  window.dispatchEvent(new Event('sdc-db-change'));
  if (window.SDCCloud?.syncNow) window.SDCCloud.syncNow();
}
function invalidateCache() { _cache = null; }
window.addEventListener('storage', e => { if (e.key === DBKEY) _cache = null; });

function getData(key) { return key ? db()[key] : db(); }
function saveData(key, value) { const d = db(); d[key] = value; saveDB(d); }
function uid(prefix = 'ID') { return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
function addRecord(key, record) {
  const d = db();
  const rec = { ...record, id: record.id || uid(key.slice(0, 3).toUpperCase()), createdAt: record.createdAt || new Date().toISOString() };
  d[key].push(rec); saveDB(d); return rec;
}
function updateRecord(key, id, patch) {
  const d = db(), i = d[key].findIndex(x => x.id === id);
  if (i < 0) throw new Error('Record not found');
  d[key][i] = { ...d[key][i], ...patch, id, updatedAt: new Date().toISOString() };
  saveDB(d); return d[key][i];
}
function deleteRecord(key, id) { const d = db(); d[key] = d[key].filter(x => x.id !== id); saveDB(d); }
function findRecord(key, id) { return db()[key].find(x => x.id === id); }
function resetDemoData() { localStorage.removeItem(DBKEY); localStorage.removeItem('sdcCloudUpdatedAt'); _cache = null; db(); }

/* ---------------------------------------------------------- configuration */
function settings() { return db().settings; }
function brand() { return settings().brand; }
function lms() { return settings().lms; }
function feature(name) { return settings().features[name] !== false; }
function t(key, lower) { const v = settings().terms[key] || key; return lower ? v.toLowerCase() : v; }
/* ----------------------------------------------------- roles & permissions
   A role = { id, name, base, courseScope, courseIds, permissions: { module: [actions] } }.
   base picks the experience (admin = staff console, teacher = instructor console, student = learner portal);
   courseScope limits which courses the role sees: all | assigned (instructor of) | enrolled | selected (courseIds). */
const PERMISSIONS = [
  ['dashboard', 'Dashboard', ['view']],
  ['learn', 'My courses & learning', ['view']],
  ['courses', 'Courses, sessions & assignments', ['view', 'create', 'edit', 'delete', 'publish']],
  ['programs', 'Programs', ['view', 'create', 'edit', 'delete']],
  ['divisions', 'Divisions', ['view', 'create', 'edit', 'delete']],
  ['batches', 'Batches', ['view', 'create', 'edit', 'delete']],
  ['enrollments', 'Enrollments', ['view', 'create', 'edit', 'delete']],
  ['learners', 'Learner accounts', ['view', 'create', 'edit', 'delete']],
  ['staff', 'Staff accounts', ['view', 'create', 'edit', 'delete']],
  ['roles', 'Roles & permissions', ['view', 'create', 'edit', 'delete']],
  ['submissions', 'Submissions & grading', ['view', 'edit']],
  ['attendance', 'Attendance', ['view', 'edit']],
  ['results', 'Results', ['view', 'edit']],
  ['certificates', 'Certificates', ['view', 'create', 'edit']],
  ['fees', 'Fees', ['view', 'create', 'edit', 'delete']],
  ['announcements', 'Announcements', ['view', 'create', 'edit', 'delete']],
  ['messages', 'Messages', ['view', 'create']],
  ['calendar', 'Calendar', ['view']],
  ['reports', 'Reports', ['view']],
  ['settings', 'Settings', ['view', 'edit']]
];
const BASES = { admin: 'Staff console', teacher: 'Instructor console', student: 'Learner portal' };
function roleOf(u) { const id = typeof u === 'string' ? u : u?.role; return db().roles.find(r => r.id === id) || db().roles.find(r => r.id === 'student'); }
function kind(u) { return roleOf(u)?.base || 'student'; }
function roleLabel(role) { return roleOf(role)?.name || role; }
function can(module, action = 'view', user = (typeof App !== 'undefined' ? App.user : null) || currentUser()) {
  const r = roleOf(user);
  if (!r) return false;
  if (r.id === 'admin') return true; // ponytail: built-in admin is locked to full access so nobody can lock themselves out
  return (r.permissions?.[module] || []).includes(action);
}
function scopeAll(user) { return roleOf(user)?.courseScope === 'all'; }
function pairs(str) { return String(str || '').split('|').filter(Boolean).map(p => { const [v, l] = p.split(':'); return { value: v.trim(), label: (l || v).trim() }; }); }
function pairLabel(str, value) { return pairs(str).find(p => p.value === value)?.label || value || '—'; }
function csvList(str) { return String(str || '').split(',').map(x => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean); }
function footerText() { return brand().footer.replace('{year}', new Date().getFullYear()); }

function currentTheme() {
  try { const pref = localStorage.getItem('sdcTheme'); if (pref === 'dark' || pref === 'light') return pref; } catch (e) {}
  return settings().theme.mode === 'dark' ? 'dark' : 'light';
}
function applyTheme(mode) {
  const s = settings().theme, root = document.documentElement;
  root.dataset.theme = mode || currentTheme();
  const hex = v => /^#[0-9a-f]{6}$/i.test(v || '');
  if (hex(s.primary)) root.style.setProperty('--brand', s.primary);
  if (hex(s.accent)) root.style.setProperty('--accent', s.accent);
  if (hex(s.highlight)) root.style.setProperty('--highlight', s.highlight);
  root.style.setProperty('--radius', Math.min(24, Math.max(4, Number(s.radius) || 12)) + 'px');
  const fav = document.querySelector('link[rel="icon"]');
  if (fav && brand().logoUrl) fav.href = resolveAsset(brand().logoUrl);
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('sdcTheme', next); } catch (e) {}
  applyTheme(next);
  return next;
}
function resolveAsset(url) { return /^(https?:|data:|\/|mailto:)/.test(url || '') ? url : (document.baseURI ? new URL(url, document.baseURI).href : url); }

/* ------------------------------------------------------------------- auth */
// Compact SHA-256 so hashing works synchronously everywhere (including file:// previews).
function sha256(ascii) {
  const rightRotate = (v, a) => (v >>> a) | (v << (32 - a));
  const words = [], bytes = unescape(encodeURIComponent(ascii)), len = bytes.length * 8;
  const hash = sha256.h || [], k = sha256.k || [];
  if (!k.length) {
    const isComposite = {};
    for (let c = 2, n = 0; n < 64; c++) {
      if (!isComposite[c]) {
        for (let i = 0; i < 313; i += c) isComposite[i] = c;
        hash[n] = (Math.pow(c, .5) * 4294967296) | 0;
        k[n++] = (Math.pow(c, 1 / 3) * 4294967296) | 0;
      }
    }
    sha256.h = hash.slice(0, 8); sha256.k = k;
  }
  let H = sha256.h.slice(0, 8), str = bytes + '\x80';
  while (str.length % 64 - 56) str += '\x00';
  for (let i = 0; i < str.length; i++) words[i >> 2] |= str.charCodeAt(i) << ((3 - i) % 4) * 8;
  words[words.length] = (len / 4294967296) | 0; words[words.length] = len;
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16), old = H;
    H = H.slice(0, 8);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2], a = H[0], e = H[4];
      const t1 = H[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & H[5]) ^ (~e & H[6])) + k[i] +
        (w[i] = i < 16 ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
      const t2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & H[1]) ^ (a & H[2]) ^ (H[1] & H[2]));
      H = [(t1 + t2) | 0].concat(H); H[4] = (H[4] + t1) | 0; H.length = 8;
    }
    for (let i = 0; i < 8; i++) H[i] = (H[i] + old[i]) | 0;
  }
  return H.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
function randomToken(bytes = 16) {
  const arr = new Uint8Array(bytes);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hashPassword(password, salt) { let h = `${salt}:${password}`; for (let i = 0; i < 1500; i++) h = sha256(h + salt); return h; }
function verifyPassword(user, password) { return !!user?.passwordHash && hashPassword(password, user.salt) === user.passwordHash; }
function setPassword(userId, password) { const salt = randomToken(8); updateRecord('users', userId, { salt, passwordHash: hashPassword(password, salt) }); }

function currentUser() {
  let id = null;
  try { id = sessionStorage.getItem('sdcSession') || localStorage.getItem('sdcRemember'); } catch (e) {}
  const u = id ? findRecord('users', id) : null;
  return u && u.status === 'Active' ? u : null;
}
function login(email, password, remember) {
  const mail = String(email || '').trim().toLowerCase();
  const u = db().users.find(x => String(x.email).toLowerCase() === mail);
  if (!u || !verifyPassword(u, password)) return { ok: false, error: 'Email or password is incorrect.' };
  if (u.status !== 'Active') return { ok: false, error: 'This account is not active. Please contact your coordinator.' };
  sessionStorage.setItem('sdcSession', u.id);
  if (remember) localStorage.setItem('sdcRemember', u.id); else localStorage.removeItem('sdcRemember');
  updateRecord('users', u.id, { lastLoginAt: new Date().toISOString() });
  return { ok: true, user: u };
}
function logout() { sessionStorage.removeItem('sdcSession'); localStorage.removeItem('sdcRemember'); location.href = 'login.html'; }

/* --------------------------------------------------------------- helpers */
function esc(v = '') { return String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
function initials(name = '') { return String(name).split(/\s+/).filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase() || '?'; }
function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function parseDate(s) { if (!s) return null; const d = new Date(String(s).length === 10 ? s + 'T00:00:00' : s); return isNaN(d) ? null : d; }
function fmtDate(s, opts) { const d = parseDate(s); return d ? d.toLocaleDateString('en-GB', opts || { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function fmtDateShort(s) { return fmtDate(s, { day: 'numeric', month: 'short' }); }
function fmtDateTime(s) { const d = parseDate(s); return d ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
function fmtTime(hhmm) { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`; }
function fmtMoney(n) { return `${lms().currency} ${Number(n || 0).toLocaleString('en-PK')}`; }
function fmtSize(bytes) { if (!bytes) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0, n = Number(bytes); while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`; }
function relTime(s) {
  const d = parseDate(s); if (!d) return '';
  const diff = (Date.now() - d.getTime()) / 1000, abs = Math.abs(diff);
  const units = [[60, 'second'], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [2629800, 'week', 604800], [Infinity, 'month', 2629800]];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [lim, unit, div] of units) if (abs < lim) return rtf.format(Math.round(-diff / (div || 1)), unit);
  return fmtDate(s);
}
function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function sum(arr, fn) { return arr.reduce((a, x) => a + (Number(fn ? fn(x) : x) || 0), 0); }
function byOrder(a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.date || '').localeCompare(String(b.date || '')); }
function fileExt(name) { return String(name || '').split('.').pop().toLowerCase(); }

function userName(id) { return findRecord('users', id)?.name || '—'; }
function courseTitle(id) { return findRecord('courses', id)?.title || '—'; }

/* ---------------------------------------------------------------- domain */
const Domain = {
  learnerEnrollments(learnerId) { return db().enrollments.filter(e => e.learnerId === learnerId && e.status !== 'Withdrawn'); },
  enrollment(learnerId, courseId) { return db().enrollments.find(e => e.learnerId === learnerId && e.courseId === courseId && e.status !== 'Withdrawn'); },
  courseSessions(courseId, includeDrafts) { return db().sessions.filter(s => s.courseId === courseId && (includeDrafts || s.published !== false)).sort(byOrder); },
  courseAssignments(courseId, includeDrafts) { return db().assignments.filter(a => a.courseId === courseId && (includeDrafts || a.status !== 'Draft')).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))); },
  courseLearners(courseId) { return db().enrollments.filter(e => e.courseId === courseId && e.status !== 'Withdrawn').map(e => ({ enrollment: e, user: findRecord('users', e.learnerId) })).filter(x => x.user); },
  instructorCourses(userId) { return db().courses.filter(c => (c.instructorIds || []).includes(userId)); },
  visibleCourses(user) {
    const r = roleOf(user), all = db().courses;
    switch (r.courseScope) {
      case 'all': return all;
      case 'selected': return all.filter(c => (r.courseIds || []).includes(c.id));
      case 'assigned': return Domain.instructorCourses(user.id);
      default: { const ids = Domain.learnerEnrollments(user.id).map(e => e.courseId); return all.filter(c => ids.includes(c.id) && c.status === 'published'); }
    }
  },
  canManageCourse(user, course) { return !!course && can('courses', 'edit', user) && Domain.visibleCourses(user).some(c => c.id === course.id); },
  scopedLearnerIds(user) { const ids = Domain.visibleCourses(user).map(c => c.id); return [...new Set(db().enrollments.filter(e => ids.includes(e.courseId)).map(e => e.learnerId))]; },
  sessionUnlocked(session, enrollment) {
    if (!enrollment) return true;
    if (enrollment.accessMode !== 'restricted') return true;
    return (enrollment.allowedSessionIds || []).includes(session.id);
  },
  sessionStatus(session) {
    if (session.statusOverride) return session.statusOverride;
    const today = todayISO();
    if (!session.date) return 'Available';
    if (session.date === today) return 'Today';
    if (session.date > today) return 'Upcoming';
    return 'Available';
  },
  sessionNumber(session) { return Domain.courseSessions(session.courseId).findIndex(s => s.id === session.id) + 1; },
  zoomFor(course, session) {
    const z = session?.zoom && (session.zoom.registerUrl || session.zoom.meetingId) ? session.zoom : course?.zoom;
    return z && (z.registerUrl || z.meetingId) ? z : null;
  },
  helpUrlFor(course) { return course?.helpUrl || lms().helpUrl; },
  progress(learnerId, courseId) {
    const sessions = Domain.courseSessions(courseId);
    const p = db().progress.find(x => x.learnerId === learnerId && x.courseId === courseId);
    const done = (p?.completedSessionIds || []).filter(id => sessions.some(s => s.id === id));
    return { record: p, completed: done, percent: pct(done.length, sessions.length), lastSessionId: p?.lastSessionId };
  },
  setSessionComplete(learnerId, courseId, sessionId, complete) {
    const d = db(); let p = d.progress.find(x => x.learnerId === learnerId && x.courseId === courseId);
    if (!p) { p = { id: uid('PRG'), learnerId, courseId, completedSessionIds: [], lastSessionId: sessionId }; d.progress.push(p); }
    const set = new Set(p.completedSessionIds || []);
    complete ? set.add(sessionId) : set.delete(sessionId);
    p.completedSessionIds = [...set]; p.lastSessionId = sessionId; p.updatedAt = new Date().toISOString();
    saveDB(d);
  },
  touchSession(learnerId, courseId, sessionId) {
    const d = db(); let p = d.progress.find(x => x.learnerId === learnerId && x.courseId === courseId);
    if (p && p.lastSessionId === sessionId) return;
    if (!p) { p = { id: uid('PRG'), learnerId, courseId, completedSessionIds: [] }; d.progress.push(p); }
    p.lastSessionId = sessionId; saveDB(d);
  },
  submissionFor(assignmentId, learnerId) { return db().submissions.find(s => s.assignmentId === assignmentId && s.learnerId === learnerId); },
  assignmentState(a, learnerId) {
    const s = Domain.submissionFor(a.id, learnerId);
    if (s) return { submission: s, status: s.status };
    return { submission: null, status: a.dueAt && new Date(a.dueAt) < new Date() ? 'Missing' : 'Pending' };
  },
  attendanceStats(learnerId, courseId) {
    const rows = db().attendance.filter(a => a.learnerId === learnerId && (!courseId || a.courseId === courseId));
    const present = rows.filter(a => a.status === 'Present' || a.status === 'Late').length;
    return { total: rows.length, present, absent: rows.filter(a => a.status === 'Absent').length, late: rows.filter(a => a.status === 'Late').length, percent: rows.length ? pct(present, rows.length) : null };
  },
  assignmentAverage(learnerId, courseId) {
    const as = Domain.courseAssignments(courseId);
    const graded = as.map(a => ({ a, s: Domain.submissionFor(a.id, learnerId) })).filter(x => x.s && x.s.grade !== null && x.s.grade !== undefined && x.s.grade !== '');
    if (!graded.length) return null;
    return Math.round(sum(graded, x => (Number(x.s.grade) / (Number(x.a.maxMarks) || 100)) * 100) / graded.length);
  },
  gradeFor(percent) {
    if (percent === null || percent === undefined) return '—';
    const band = pairs(lms().gradeBands).map(b => ({ g: b.value, min: Number(b.label) })).sort((a, b) => b.min - a.min).find(b => percent >= b.min);
    return band ? band.g : 'F';
  },
  nextSession(courseId) { const today = todayISO(); return Domain.courseSessions(courseId).find(s => s.date && s.date >= today); },
  learnerCourseIds(userId) { return Domain.learnerEnrollments(userId).map(e => e.courseId); },
  announcementsFor(user) {
    const now = todayISO(), k = kind(user), courseIds = scopeAll(user) ? null : Domain.visibleCourses(user).map(c => c.id);
    return db().announcements.filter(a => a.status !== 'Draft' && (!a.expiry || a.expiry >= now) && (
      !courseIds || a.audience === 'everyone' ||
      (a.audience === 'learners' && k === 'student') ||
      (a.audience === 'instructors' && k !== 'student') ||
      (a.audience === 'course' && courseIds.includes(a.courseId))
    )).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.date).localeCompare(String(a.date)));
  }
};

function notify(userId, title, message, type = 'System', link = '') {
  if (!userId) return;
  addRecord('notifications', { userId, title, message, type, link, date: new Date().toISOString(), read: false });
}
function notifyMany(userIds, ...args) {
  const d = db(), now = new Date().toISOString();
  [...new Set(userIds.filter(Boolean))].forEach(userId => d.notifications.push({ id: uid('NOT'), userId, title: args[0], message: args[1], type: args[2] || 'System', link: args[3] || '', date: now, read: false }));
  saveDB(d);
}

/* ----------------------------------------------------------------- icons */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  video: '<path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-8"/>',
  wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M16 14h.01"/>',
  megaphone: '<path d="m3 11 18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  checkSquare: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  cap: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  map: '<path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><path d="M8 2v16M16 6v16"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  truck: '<rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'
};
function icon(name, size = 18, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`;
}
function fileIcon(nameOrType) {
  const e = String(nameOrType || '').toLowerCase();
  if (e === 'link' || e === 'url') return 'link';
  if (e === 'video') return 'video';
  return 'file';
}

/* ------------------------------------------------------------- UI kit */
function toast(message, type = 'success') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'warning' ? 'alert' : 'check', 16)}<span>${esc(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 3600);
}
function badge(text, tone) {
  const map = { published: 'success', active: 'success', available: 'success', present: 'success', paid: 'success', graded: 'success', completed: 'info', today: 'accent', upcoming: 'info', outline: 'neutral', submit: 'highlight', submitted: 'info', pending: 'warning', late: 'warning', missing: 'danger', absent: 'danger', overdue: 'danger', draft: 'neutral', inactive: 'neutral', withdrawn: 'neutral', revoked: 'danger', locked: 'neutral', excused: 'neutral', important: 'danger', normal: 'neutral', waived: 'neutral', 'partially paid': 'warning', suspended: 'danger' };
  const tn = tone || map[String(text || '').toLowerCase()] || 'neutral';
  return `<span class="badge badge-${tn}">${esc(text || '—')}</span>`;
}
function avatar(user, size = 32) {
  let photo = '';
  try { photo = user ? localStorage.getItem('sdcAvatar_' + user.id) || '' : ''; } catch (e) {}
  return photo ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(photo)}" alt="">` : `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .38)}px">${esc(initials(user?.name))}</span>`;
}
function emptyState(title, text = '', iconName = 'layers', action = '') {
  return `<div class="empty"><div class="empty-icon">${icon(iconName, 22)}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}
function progressBar(percent, label) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="progress" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" ${label ? `aria-label="${esc(label)}"` : ''}><span style="width:${p}%"></span></div>`;
}

function openModal({ title, body = '', size = 'md', footer = '', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-modal-close aria-label="Close">${icon('x')}</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
  const prev = document.activeElement;
  const close = () => { wrap.classList.add('out'); document.removeEventListener('keydown', onKey); setTimeout(() => wrap.remove(), 160); onClose?.(); prev?.focus?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  setTimeout(() => (wrap.querySelector('[autofocus],input:not([type=hidden]),select,textarea,button:not([data-modal-close])') || wrap.querySelector('.modal')).focus?.(), 30);
  wrap.close = close;
  return wrap;
}
function confirmDialog(message, { title = 'Please confirm', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title, size: 'sm', body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`,
      onClose: () => { if (!done) resolve(false); }
    });
    m.querySelector('[data-ok]').onclick = () => { done = true; resolve(true); m.close(); };
  });
}

/* Form builder. Field: {name,label,type,required,options,placeholder,help,full,min,max,step,rows,value} */
function optionList(opts) {
  const list = typeof opts === 'function' ? opts() : (opts || []);
  return list.map(o => typeof o === 'object' ? o : { value: o, label: o });
}
function fieldHTML(f, values = {}) {
  const v = values[f.name] ?? f.value ?? (f.type === 'checkbox' ? false : '');
  const id = `f_${f.name}_${Math.random().toString(36).slice(2, 6)}`;
  const req = f.required ? 'required' : '';
  const attrs = `id="${id}" name="${esc(f.name)}" ${req} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.readonly ? 'readonly' : ''} ${f.pattern ? `pattern="${esc(f.pattern)}"` : ''}`;
  let control;
  switch (f.type) {
    case 'textarea': control = `<textarea class="input" rows="${f.rows || 3}" ${attrs}>${esc(Array.isArray(v) ? v.join('\n') : v)}</textarea>`; break;
    case 'select': control = `<select class="input" ${attrs}>${f.placeholderOption !== false ? `<option value="">${esc(f.placeholderOption || 'Select…')}</option>` : ''}${optionList(f.options).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`; break;
    case 'multiselect': {
      const sel = Array.isArray(v) ? v.map(String) : String(v || '').split(',').filter(Boolean);
      const opts = optionList(f.options);
      control = `<div class="check-list" data-multi="${esc(f.name)}">${opts.length ? opts.map(o => `<label class="check"><input type="checkbox" value="${esc(o.value)}" ${sel.includes(String(o.value)) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('') : `<span class="muted small">${esc(f.emptyText || 'No options available yet.')}</span>`}</div>`;
      break;
    }
    case 'checkbox': control = `<label class="switch"><input type="checkbox" ${attrs} ${v === true || v === 'true' ? 'checked' : ''}><span class="switch-track"></span><span class="switch-label">${esc(f.checkLabel || f.label)}</span></label>`; break;
    case 'color': control = `<div class="color-field"><input type="color" class="color-swatch" ${attrs} value="${esc(v || '#0F3D6E')}"><code>${esc(v || '')}</code></div>`; break;
    default: control = `<input class="input" type="${f.type || 'text'}" ${attrs} value="${esc(v)}" ${f.type === 'password' ? 'autocomplete="new-password"' : ''}>`;
  }
  const label = f.type === 'checkbox' ? '' : `<label class="label" for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>`;
  return `<div class="field ${f.full || f.type === 'textarea' || f.type === 'multiselect' ? 'full' : ''}" data-field="${esc(f.name)}">${label}${control}${f.help ? `<p class="help">${esc(f.help)}</p>` : ''}</div>`;
}
function formHTML(fields, values = {}) { return `<div class="form-grid">${fields.filter(f => !f.hidden).map(f => fieldHTML(f, values)).join('')}</div>`; }
function readForm(form, fields) {
  const out = {};
  fields.filter(f => !f.hidden).forEach(f => {
    if (f.type === 'multiselect') { out[f.name] = [...form.querySelectorAll(`[data-multi="${f.name}"] input:checked`)].map(i => i.value); return; }
    const el = form.elements[f.name]; if (!el) return;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'number') out[f.name] = el.value === '' ? '' : Number(el.value);
    else if (f.type === 'lines') out[f.name] = el.value.split('\n').map(x => x.trim()).filter(Boolean);
    else out[f.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
  });
  return out;
}
function bindColorFields(scope) { scope.querySelectorAll('.color-field input').forEach(i => i.addEventListener('input', () => { i.nextElementSibling.textContent = i.value; })); }

/* Data table with search, filters, sorting and pagination. Collapses to cards on phones. */
function dataTable(container, cfg) {
  const state = { q: '', filters: {}, page: 1, sort: cfg.defaultSort || null, dir: cfg.defaultDir || 'asc' };
  const size = cfg.pageSize || Number(settings().general.pageSize) || 10;
  container.innerHTML = `<div class="table-tools">${cfg.search !== false ? `<label class="search-box">${icon('search', 16)}<input type="search" placeholder="${esc(cfg.searchPlaceholder || 'Search…')}" data-dt-search aria-label="Search"></label>` : ''}${(cfg.filters || []).map(f => `<select class="input input-sm" data-dt-filter="${esc(f.key)}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}</option>${optionList(f.options).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`).join('')}<span class="table-count muted small" data-dt-count></span></div><div class="table-wrap"><table class="table"><thead><tr>${cfg.columns.map(c => `<th ${c.sortable !== false ? `data-sort="${esc(c.key)}" tabindex="0"` : ''} class="${c.align === 'right' ? 'ta-r' : ''}">${esc(c.label)}${c.sortable !== false ? `<span class="sort-ind"></span>` : ''}</th>`).join('')}${cfg.actions ? '<th class="ta-r"><span class="sr-only">Actions</span></th>' : ''}</tr></thead><tbody data-dt-body></tbody></table></div><div class="pagination" data-dt-pages></div>`;
  const body = container.querySelector('[data-dt-body]');
  const sortVal = (row, key) => { const c = cfg.columns.find(x => x.key === key); const v = c?.sortValue ? c.sortValue(row) : row[key]; return typeof v === 'number' ? v : String(v ?? '').toLowerCase(); };
  function rowsNow() {
    let rows = cfg.rows();
    const q = state.q.toLowerCase();
    if (q) rows = rows.filter(r => (cfg.searchText ? cfg.searchText(r) : JSON.stringify(r)).toLowerCase().includes(q));
    for (const [k, v] of Object.entries(state.filters)) if (v) { const f = cfg.filters.find(x => x.key === k); rows = rows.filter(r => f.match ? f.match(r, v) : String(r[k]) === v); }
    if (state.sort) rows = rows.slice().sort((a, b) => { const x = sortVal(a, state.sort), y = sortVal(b, state.sort); return (x > y ? 1 : x < y ? -1 : 0) * (state.dir === 'asc' ? 1 : -1); });
    return rows;
  }
  function draw() {
    const rows = rowsNow(), pages = Math.max(1, Math.ceil(rows.length / size));
    if (state.page > pages) state.page = pages;
    const items = rows.slice((state.page - 1) * size, state.page * size);
    container.querySelector('[data-dt-count]').textContent = `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`;
    body.innerHTML = items.length ? items.map(r => `<tr>${cfg.columns.map(c => `<td data-label="${esc(c.label)}" class="${c.align === 'right' ? 'ta-r' : ''} ${c.primary ? 'td-primary' : ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '—')}</td>`).join('')}${cfg.actions ? `<td class="ta-r td-actions">${cfg.actions(r)}</td>` : ''}</tr>`).join('')
      : `<tr class="tr-empty"><td colspan="${cfg.columns.length + (cfg.actions ? 1 : 0)}">${emptyState(cfg.emptyTitle || 'Nothing here yet', cfg.emptyText || (state.q ? 'Try a different search term.' : ''), cfg.emptyIcon || 'layers')}</td></tr>`;
    container.querySelectorAll('th[data-sort]').forEach(th => { th.dataset.dir = th.dataset.sort === state.sort ? state.dir : ''; });
    const pg = container.querySelector('[data-dt-pages]');
    pg.innerHTML = pages > 1 ? `<button class="btn btn-ghost btn-sm" data-pg="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevronLeft', 16)}</button><span class="small muted">Page ${state.page} of ${pages}</span><button class="btn btn-ghost btn-sm" data-pg="${state.page + 1}" ${state.page === pages ? 'disabled' : ''} aria-label="Next page">${icon('chevronRight', 16)}</button>` : '';
    pg.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { state.page = Number(b.dataset.pg); draw(); });
    cfg.onDraw?.(body);
  }
  container.querySelector('[data-dt-search]')?.addEventListener('input', e => { state.q = e.target.value; state.page = 1; draw(); });
  container.querySelectorAll('[data-dt-filter]').forEach(s => s.addEventListener('change', () => { state.filters[s.dataset.dtFilter] = s.value; state.page = 1; draw(); }));
  container.querySelectorAll('th[data-sort]').forEach(th => {
    const go = () => { const k = th.dataset.sort; state.dir = state.sort === k && state.dir === 'asc' ? 'desc' : 'asc'; state.sort = k; draw(); };
    th.addEventListener('click', go); th.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
  draw();
  return { redraw: draw, rows: rowsNow };
}

/* Files: upload through the Express API, falling back to inline storage for small files. */
async function uploadFile(file, { maxMB, types } = {}) {
  const cfg = lms(), limit = Number(maxMB || cfg.uploadMaxMB) || 30, allowed = types || csvList(cfg.allowedTypes);
  if (!file) throw new Error('Please choose a file.');
  const ext = fileExt(file.name);
  if (allowed.length && !allowed.includes(ext)) throw new Error(`.${ext} files are not accepted. Allowed: ${allowed.join(', ')}`);
  if (file.size > limit * 1024 * 1024) throw new Error(`File is larger than ${limit} MB.`);
  try {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(cfg.uploadEndpoint || '/api/lms/uploads', { method: 'POST', body: fd });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.url) return { url: out.url, fileName: file.name, size: file.size, stored: 'server' };
    if (res.status && res.status !== 404 && res.status < 500) throw new Error(out.error || 'Upload was rejected by the server.');
  } catch (e) { if (!(e instanceof TypeError) && !/fetch|network|JSON/i.test(e.message)) throw e; }
  const inlineMax = Number(cfg.inlineFallbackMB) || 0;
  if (file.size > inlineMax * 1024 * 1024) throw new Error(`The upload server is unavailable. Start it with "npm start" (files up to ${inlineMax} MB can be stored in the browser without it).`);
  const url = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(new Error('Could not read the file.')); r.readAsDataURL(file); });
  return { url, fileName: file.name, size: file.size, stored: 'inline' };
}
function dropzone(container, { accept = [], maxMB, onFile, label = 'Drag & drop your file here' }) {
  container.innerHTML = `<label class="dropzone" tabindex="0"><input type="file" hidden ${accept.length ? `accept="${accept.map(a => '.' + a).join(',')}"` : ''}><span class="dz-icon">${icon('upload', 22)}</span><span class="dz-title">${esc(label)}</span><span class="dz-sub">or <u>browse files</u> · ${accept.length ? esc(accept.join(', ').toUpperCase()) : 'any file'} · up to ${maxMB} MB</span><span class="dz-file" hidden></span></label>`;
  const zone = container.querySelector('.dropzone'), input = zone.querySelector('input'), info = zone.querySelector('.dz-file');
  const set = file => {
    if (!file) return;
    const ext = fileExt(file.name);
    if (accept.length && !accept.includes(ext)) { toast(`.${ext} files are not accepted.`, 'error'); return; }
    if (maxMB && file.size > maxMB * 1024 * 1024) { toast(`File is larger than ${maxMB} MB.`, 'error'); return; }
    zone.classList.add('has-file'); info.hidden = false;
    info.innerHTML = `${icon('file', 16)} <b>${esc(file.name)}</b> <span class="muted">${fmtSize(file.size)}</span>`;
    container.file = file; onFile?.(file);
  };
  input.addEventListener('change', () => set(input.files[0]));
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', e => set(e.dataTransfer.files[0]));
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  return { get file() { return container.file; }, reset() { container.file = null; input.value = ''; zone.classList.remove('has-file'); info.hidden = true; } };
}
function copyText(text, label = 'Copied') {
  const done = () => toast(`${label} to clipboard.`);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
  else fallback();
  function fallback() { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed', 'error'); } ta.remove(); }
}
function downloadBlob(filename, content, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function csvDownload(filename, rows) { downloadBlob(filename, rows.map(r => r.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n'), 'text/csv'); }
function printDocument(title, html, { landscape = false } = {}) {
  const w = window.open('', '_blank', 'width=1000,height=760');
  if (!w) { toast('Please allow pop-ups to print.', 'error'); return; }
  const b = brand(), th = settings().theme;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${esc(b.productName)}</title><style>@page{size:A4 ${landscape ? 'landscape' : ''};margin:16mm}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0E1726;margin:0;line-height:1.5}header{display:flex;align-items:center;gap:12px;border-bottom:2px solid ${th.primary};padding-bottom:10px;margin-bottom:18px}header img{width:44px;height:44px}header h1{font-size:17px;margin:0}header p{margin:0;color:#5B6576;font-size:12px}h2{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #D9DEE6;padding:6px 8px;text-align:left}th{background:#F1F4F8}footer{margin-top:24px;font-size:11px;color:#5B6576;border-top:1px solid #D9DEE6;padding-top:8px}</style></head><body><header><img src="${esc(resolveAsset(b.logoUrl))}" alt=""><div><h1>${esc(b.orgName)}</h1><p>${esc(b.productName)} · ${esc(b.phone)} · ${esc(b.email)}</p></div></header><h2>${esc(title)}</h2>${html}<footer>Generated ${new Date().toLocaleString('en-GB')} · ${esc(footerText())}</footer></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 350);
}
