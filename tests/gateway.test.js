// Self-check for the server state gateway: hashing matches the browser and the merge rules hold. Run: npm test
const assert = require('assert'), vm = require('vm'), fs = require('fs'), path = require('path');
const t = require('../backend/state-api.js')._test;
const js = f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const ctx = { localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null }, document: { querySelector: () => null }, location: {}, crypto: { getRandomValues: a => a } };
ctx.window = ctx; ctx.addEventListener = () => {}; vm.createContext(ctx);
vm.runInContext(js('seed.js') + ';' + js('migrations.js') + ';' + js('core.js') + ';globalThis.__h=hashPassword', ctx);
assert.equal(t.hashPassword('Demo@123', 'ab12'), ctx.__h('Demo@123', 'ab12'), 'server hash = browser hash');
assert.equal(t.hashPassword('pässwörd', 'x'), ctx.__h('pässwörd', 'x'), 'unicode passwords hash the same');

const roles = [{ id: 'admin', base: 'admin' }, { id: 'student', base: 'student', permissions: {} }, { id: 'teacher', base: 'teacher', permissions: { courses: ['edit'] } }];
const prev = { roles, settings: { a: 1 }, users: [{ id: 'A', role: 'admin', passwordHash: 'ha', salt: 'sa' }, { id: 'L', role: 'student', passwordHash: 'hl', salt: 'sl', name: 'L' }, { id: 'T', role: 'teacher', passwordHash: 'ht', salt: 'st' }] };
const client = t.forClient(prev, 'L');
assert.ok(!client.users.find(u => u.id === 'A').passwordHash && client.users.find(u => u.id === 'L').passwordHash, 'only your own hash is sent');

let out = t.merge(prev, { roles: [], settings: { a: 2 }, users: [{ id: 'L', role: 'admin', name: 'New', passwordHash: 'hl' }] }, prev.users[1]);
assert.equal(out.users.length, 3, 'learner cannot delete accounts');
assert.equal(out.users.find(u => u.id === 'L').role, 'student', 'learner cannot change own role');
assert.equal(out.users.find(u => u.id === 'L').name, 'New', 'learner can edit own profile');
assert.deepEqual(out.settings, { a: 1 }); assert.equal(out.roles, roles, 'roles/settings need permission');
out = t.merge(prev, { ...client, users: client.users.map(u => u.id === 'A' ? { ...u, passwordHash: 'evil', salt: 'x' } : u) }, prev.users[1]);
assert.equal(out.users.find(u => u.id === 'A').passwordHash, 'ha', "learner cannot set another user's password");

const adminView = t.forClient(prev, 'A');
out = t.merge(prev, { ...adminView, users: adminView.users.map(u => u.id === 'T' ? { ...u, passwordHash: 'new', salt: 'n' } : u) }, prev.users[0]);
assert.equal(out.users.find(u => u.id === 'L').passwordHash, 'hl', 'missing hash = unchanged');
assert.equal(out.users.find(u => u.id === 'T').passwordHash, 'new', 'account managers can reset passwords');
// Phase 2 upgrade: built-in roles gain ai/quizzes once; existing choices and later edits are kept.
const old = { roles: [{ id: 'student', permissions: { learn: ['view'] } }, { id: 'teacher', permissions: { ai: ['view'] } }] };
t.migrate(old);
assert.deepEqual(old.roles[0].permissions.ai, ['view', 'use']); assert.deepEqual(old.roles[1].permissions.ai, ['view'], 'existing ai permissions kept');
delete old.roles[0].permissions.ai; t.migrate(old); assert.equal(old.roles[0].permissions.ai, undefined, 'upgrade runs only once');

// ---- Stage 2: per-record guard for courses, sessions and batches (pure function, no network) ----
{
  const R = [{ id: 'admin' }, { id: 'student', permissions: {} }, { id: 'teacher', courseScope: 'assigned', permissions: { courses: ['view', 'edit'] } },
    { id: 'pub', courseScope: 'all', permissions: { courses: ['view', 'create', 'edit', 'publish'] } }, { id: 'del', courseScope: 'all', permissions: { courses: ['view', 'delete'] } }];
  const base = () => ({ roles: R, users: [{ id: 'A', role: 'admin' }, { id: 'L', role: 'student' }, { id: 'T', role: 'teacher' }, { id: 'P', role: 'pub' }, { id: 'D', role: 'del' }],
    courses: [{ id: 'C1', status: 'published' }, { id: 'C2', status: 'draft' }], sessions: [{ id: 'S1', courseId: 'C1' }, { id: 'S2', courseId: 'C2' }], batches: [{ id: 'B1', courseId: 'C1', instructorId: 'T' }] });
  const all = s => t.readKnown({ known: { courses: s.courses.map(x => x.id), sessions: s.sessions.map(x => x.id), batches: s.batches.map(x => x.id) } });
  const g = (who, edit, known) => { const p = base(), n = JSON.parse(JSON.stringify(p)); edit(n); return t.guardCourseData(p, n, p.users.find(u => u.id === who), known === undefined ? all(p) : known); };
  const ids = (r, k) => r.state[k].map(x => x.id).join(',');

  let r = g('A', n => { n.courses = []; n.sessions = []; n.batches = []; n.courses.push({ id: 'CN', status: 'published' }); });
  assert.deepEqual([ids(r, 'courses'), ids(r, 'sessions'), ids(r, 'batches'), r.rejected.length], ['CN', '', '', 0], 'admin may do anything it can prove');
  r = g('A', n => { n.courses = []; n.sessions = []; n.batches = []; }, null);
  assert.deepEqual([ids(r, 'courses'), ids(r, 'sessions'), ids(r, 'batches'), r.resync], ['C1,C2', 'S1,S2', 'B1', true], 'no base: nothing is deleted, not even by an admin');
  assert.equal(g('A', n => { n.courses[0].title = 'x'; }, null).rejected.length, 0, 'no base: edits still work (old app versions)');
  r = g('D', n => { n.courses = n.courses.filter(c => c.id !== 'C2'); n.sessions = n.sessions.filter(s => s.courseId !== 'C2'); });
  assert.deepEqual([ids(r, 'courses'), ids(r, 'sessions'), r.rejected.length], ['C1', 'S1', 0], 'course delete takes its sessions without courses:edit (cascade)');
  r = g('D', n => { n.courses = n.courses.filter(c => c.id !== 'C2'); }, t.readKnown({ known: { courses: ['C2'] } }));
  assert.equal(ids(r, 'sessions'), 'S1,S2', 'cascade only removes what the request removed');
  r = g('P', n => { n.courses.push({ id: 'CP', status: 'published' }); n.courses[1].status = 'published'; });
  assert.equal(r.rejected.length, 0, 'publisher may create published courses and change status');
  r = g('T', n => { n.sessions.find(s => s.id === 'S1').courseId = 'C2'; });
  assert.deepEqual(r.rejected, [{ collection: 'sessions', id: 'S1', op: 'edit' }], 'moving a session needs both courses in scope');
  r = g('T', n => { n.courses = n.courses.filter(c => c.id !== 'C1'); n.sessions = n.sessions.filter(s => s.id !== 'S1'); n.batches = []; });
  assert.deepEqual([ids(r, 'courses'), ids(r, 'sessions'), ids(r, 'batches')], ['C1,C2', 'S1,S2', 'B1'], 'refused course delete restores children in their original order');
  r = g('L', n => { n.courses.push({ title: 'no id' }); n.courses.push({ id: 'C1', status: 'x' }); });
  assert.deepEqual(r.state.courses, base().courses, 'records without an id or with a duplicate id are not accepted');
  assert.equal(g('L', () => {}).rejected.length, 0, 'an unchanged copy (any key order) is not an edit');
  assert.ok(t.same({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.equal(t.readKnown({ known: { courses: Array(100001).fill('x') } }), null, 'oversized base is refused');
  assert.equal(t.readKnown({ known: { courses: 'C1' } }).courses.size, 0, 'malformed base is empty');

  // Stale copies (review fix): an unchanged known record never overwrites the server's newer one,
  // and one the server deleted is not brought back.
  const fresh = (s, over = {}) => t.readKnown({ known: { courses: s.courses.map(x => x.id), sessions: s.sessions.map(x => x.id), batches: s.batches.map(x => x.id) }, fresh: { courses: s.courses.map(x => x.id), sessions: s.sessions.map(x => x.id), batches: s.batches.map(x => x.id), ...over } });
  const old = base(), server = base(); server.courses[0].title = 'A edit'; server.courses = server.courses.filter(c => c.id !== 'C2'); server.sessions = server.sessions.filter(s => s.id !== 'S2');
  const stale = JSON.parse(JSON.stringify(old)); stale.sessions[0].title = 'B edit';
  r = t.guardCourseData(server, stale, server.users[0], fresh(old, { sessions: ['S2'] }));
  assert.deepEqual([r.state.courses.map(c => `${c.id}:${c.title}`).join(), ids(r, 'sessions'), r.state.sessions[0].title, r.rejected.length, r.resync], ['C1:A edit', 'S1', 'B edit', 0, true], "stale copy keeps A's edit and deletions, saves B's own edit");
  r = t.guardCourseData(server, stale, server.users[0], t.readKnown({ known: { courses: ['C1', 'C2'] } }));
  assert.equal(r.state.courses[0].title, undefined, 'without base.fresh the old behaviour (last write wins) is kept');
  assert.equal(t.readKnown({ known: { courses: ['C1'] }, fresh: { courses: ['C1', 'C9'] } }).fresh.courses.has('C9'), false, 'fresh only counts within known');

  // A course or session that stays keeps the related records the request removed with it (review fix).
  const kids = () => ({ ...base(), enrollments: [{ id: 'E1', courseId: 'C1', learnerId: 'L' }, { id: 'E2', courseId: 'C2', learnerId: 'L' }], submissions: [{ id: 'SB1', courseId: 'C1' }],
    attendance: [{ id: 'AT1', courseId: 'C1', sessionId: 'S1' }], assignments: [{ id: 'AS1', courseId: 'C1', batchId: 'B1', sessionId: 'S1' }], quizzes: [{ id: 'Q1', courseId: 'C1', batchId: 'B1' }], quizAttempts: [{ id: 'QA1', courseId: 'C1', quizId: 'Q1' }] });
  const cascade = n => { ['sessions', 'batches', 'enrollments', 'submissions', 'attendance', 'assignments', 'quizzes', 'quizAttempts'].forEach(k => { n[k] = n[k].filter(x => x.courseId !== 'C1'); }); n.courses = n.courses.filter(c => c.id !== 'C1'); };
  const gk = (who, edit, known) => { const p = kids(), n = JSON.parse(JSON.stringify(p)); edit(n); return t.guardCourseData(p, n, p.users.find(u => u.id === who), known === undefined ? all(p) : known); };
  for (const [who, known, why] of [['L', undefined, 'refused'], ['A', null, 'unproven (no base)']]) {
    r = gk(who, cascade, known);
    assert.deepEqual(['enrollments', 'submissions', 'attendance', 'assignments', 'quizzes', 'quizAttempts'].map(k => ids(r, k)), ['E1,E2', 'SB1', 'AT1', 'AS1', 'Q1', 'QA1'], `${why} course delete keeps its learner records`);
  }
  r = gk('A', cascade);
  assert.deepEqual([ids(r, 'courses'), ids(r, 'enrollments'), ids(r, 'submissions')], ['C2', 'E2', ''], 'a proven, allowed course delete removes them');
  r = gk('A', n => { n.sessions = n.sessions.filter(s => s.id !== 'S1'); n.attendance = []; n.assignments[0].sessionId = ''; n.assignments[0].title = 'kept edit'; }, t.readKnown({ known: { courses: ['C1', 'C2'], attendance: ['AT1'], assignments: ['AS1'] } }));
  assert.deepEqual([ids(r, 'sessions'), ids(r, 'attendance'), r.state.assignments[0].sessionId, r.state.assignments[0].title], ['S1,S2', 'AT1', 'S1', 'kept edit'], 'unproven session delete keeps attendance and the assignment link');
  r = gk('L', n => { n.sessions = n.sessions.filter(s => s.id !== 'S1'); n.attendance = []; n.assignments[0].sessionId = ''; });
  assert.deepEqual([ids(r, 'sessions'), ids(r, 'attendance'), r.state.assignments[0].sessionId], ['S1,S2', 'AT1', 'S1'], 'refused session delete keeps them too');
  r = gk('A', n => { n.batches = []; n.assignments = []; n.quizzes = []; n.quizAttempts = []; }, t.readKnown({ known: { courses: ['C1', 'C2'] } }));
  assert.deepEqual([ids(r, 'batches'), ids(r, 'assignments'), ids(r, 'quizzes'), ids(r, 'quizAttempts')], ['B1', 'AS1', 'Q1', 'QA1'], 'unproven batch delete keeps its work');

  // Enrolled-scope roles with courses:edit may edit published courses they are enrolled in (Domain.visibleCourses).
  const ep = { ...base(), roles: [...R, { id: 'ee', courseScope: 'enrolled', permissions: { courses: ['view', 'edit'] } }], enrollments: [{ id: 'E', courseId: 'C1', learnerId: 'EE', status: 'Active' }] };
  ep.users.push({ id: 'EE', role: 'ee' });
  const en = JSON.parse(JSON.stringify(ep)); en.courses[0].title = 'ok'; en.courses[1].title = 'no';
  assert.deepEqual(t.guardCourseData(ep, en, ep.users.at(-1), all(ep)).rejected, [{ collection: 'courses', id: 'C2', op: 'edit' }]);
}
// ---- Review fix: accounts and roles are checked per record (no self-promotion) ----
{
  const R = [{ id: 'admin', base: 'admin', system: true }, { id: 'student', base: 'student', system: true, permissions: {} }, { id: 'teacher', base: 'teacher', system: true, permissions: {} },
    { id: 'intake', base: 'admin', permissions: { learners: ['view', 'create'] } }, { id: 'tutor', base: 'admin', permissions: { learners: ['view', 'create', 'edit'] } },
    { id: 'hr', base: 'admin', permissions: { staff: ['view', 'edit'] } }, { id: 'rc', base: 'admin', permissions: { roles: ['view', 'create'] } }, { id: 'rd', base: 'admin', permissions: { roles: ['view', 'delete'] } }];
  const P = () => ({ roles: JSON.parse(JSON.stringify(R)), settings: {}, users: ['admin:A', 'student:L', 'teacher:T', 'intake:I', 'tutor:TU', 'hr:H', 'rc:RC', 'rd:RD'].map(x => { const [role, id] = x.split(':'); return { id, role, name: id, passwordHash: 'h' + id, salt: 's' + id }; }) });
  const m = (who, edit) => { const p = P(), n = JSON.parse(JSON.stringify(t.forClient(p, who))); edit(n); const rej = []; const out = t.merge(p, n, p.users.find(u => u.id === who), rej); return { out, rej: rej.map(x => `${x.collection}:${x.id}:${x.op}`).sort(), role: id => out.users.find(u => u.id === id)?.role }; };
  let r = m('I', n => { n.users.find(u => u.id === 'I').role = 'admin'; });
  assert.deepEqual([r.role('I'), r.rej], ['intake', ['users:I:edit']], 'learners:create cannot promote itself');
  r = m('I', n => { n.users.push({ id: 'N1', role: 'admin' }, { id: 'N2', role: 'student', passwordHash: 'x', salt: 'y' }); n.users.find(u => u.id === 'L').name = 'x'; });
  assert.deepEqual([r.role('N1'), r.role('N2'), r.out.users.find(u => u.id === 'L').name, r.rej], [undefined, 'student', 'L', ['users:L:edit', 'users:N1:create']], 'creates learners only, edits nothing');
  r = m('TU', n => { n.users.find(u => u.id === 'L').name = 'ok'; n.users.find(u => u.id === 'T').name = 'no'; n.users.find(u => u.id === 'L').role = 'teacher'; });
  assert.deepEqual([r.out.users.find(u => u.id === 'L').name, r.role('L'), r.rej], ['L', 'student', ['users:L:edit', 'users:T:edit']], 'a learner account cannot be moved to staff without staff:edit');
  r = m('TU', n => { n.users.find(u => u.id === 'L').name = 'ok'; });
  assert.deepEqual([r.out.users.find(u => u.id === 'L').name, r.rej], ['ok', []]);
  r = m('H', n => { n.users.find(u => u.id === 'T').role = 'hr'; n.users.find(u => u.id === 'H').email = 'new@x'; n.users.find(u => u.id === 'H').role = 'admin'; });
  assert.deepEqual([r.role('T'), r.role('H'), r.out.users.find(u => u.id === 'H').email, r.rej], ['hr', 'hr', 'new@x', ['users:H:edit']], 'staff:edit assigns roles it covers to others, never to itself');
  r = m('A', n => { n.users = n.users.filter(u => u.id !== 'A' && u.id !== 'L'); n.users.find(u => u.id === 'T').role = 'nope'; });
  assert.deepEqual([r.out.users.length, r.role('T'), r.rej], [7, 'teacher', ['users:A:delete', 'users:T:edit']], 'no deleting yourself; only existing roles');
  assert.deepEqual(r.out.users.map(u => u.id), ['A', 'T', 'I', 'TU', 'H', 'RC', 'RD'], 'order kept');
  r = m('A', n => { n.users.find(u => u.id === 'A').name = 'Me'; });
  assert.deepEqual([r.out.users.find(u => u.id === 'A').passwordHash, r.out.users.find(u => u.id === 'L').passwordHash, r.rej], ['hA', 'hL', []], 'hashes the browser never had stay');
  r = m('RC', n => { n.roles.find(x => x.id === 'rc').permissions.staff = ['view', 'edit']; n.roles.push({ id: 'new', base: 'admin', permissions: {} }); });
  assert.deepEqual([r.out.roles.find(x => x.id === 'rc').permissions.staff, !!r.out.roles.find(x => x.id === 'new'), r.rej], [undefined, true, ['roles:rc:edit']], 'roles:create cannot edit its own role');
  r = m('RD', n => { n.roles = n.roles.filter(x => x.id !== 'admin' && x.id !== 'hr'); });
  assert.deepEqual([r.out.roles.map(x => x.id).join(), r.rej], ['admin,student,teacher,intake,tutor,rc,rd', ['roles:admin:delete']], 'built-in roles cannot be deleted');
}
// ---- Stage 2: AI draft records are deterministic and allow-listed ----
{
  const CG = require('../js/coursegen-logic.js');
  const o = { title: 'Data Basics', modules: [{ name: 'M1', sessions: [{ title: 'S1' }, { title: 'S2' }] }], fee: 99, venue: 'Lab', zoom: { registerUrl: 'https://x' }, status: 'published', instructorId: 'X' };
  assert.equal(CG.validate(o), '');
  const a = CG.build({ genId: '0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b', outline: o, userId: 'U1', ownBatch: true, now: 'T' });
  const b = CG.build({ genId: '0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b', outline: o, userId: 'U1', ownBatch: true, now: 'T' });
  assert.deepEqual(a, b, 'same genId, same records');
  assert.deepEqual([a.course.id, a.sessions.map(s => s.id).join(','), a.batch.id], ['C-AI-0F8E2A4C1B3D', 'S-AI-0F8E2A4C1B3D-01,S-AI-0F8E2A4C1B3D-02', 'B-AI-0F8E2A4C1B3D']);
  assert.deepEqual([a.course.status, a.course.fee, a.course.venue, a.course.zoom.registerUrl, a.course.instructorId], ['draft', 0, undefined, '', undefined], 'fee, venue, Zoom, status and instructors never come from the outline');
  assert.equal(a.batch.instructorId, 'U1');
  assert.ok(!CG.validGenId('short') && !CG.validGenId('----------------') && CG.validGenId('0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b'));
  assert.match(CG.validate({ title: 'x', modules: Array(13).fill({ name: 'm', sessions: [{ title: 's' }] }) }), /12 modules/);
}
console.log('gateway.test.js: all checks passed');
