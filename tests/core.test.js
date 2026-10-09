// Self-check for the permission engine and core domain rules. Run: npm test
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const store = {};
const ctx = {
  console, URL, URLSearchParams, Intl, Blob: class {}, Event: class { constructor(t) { this.type = t; } },
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; return a; } },
  document: { querySelector: () => null }, location: {}
};
ctx.window = ctx; ctx.window.addEventListener = () => {}; ctx.window.dispatchEvent = () => {};
vm.createContext(ctx);
const src = ['seed.js', 'migrations.js', 'core.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join(';\n');
vm.runInContext(src + ';globalThis.migrateState=migrateState;globalThis.__x={db,can,kind,Domain,verifyPassword,addRecord,findRecord,endDateFor}', ctx, { filename: 'core-bundle.js' });
const { db, can, kind, Domain, verifyPassword, addRecord, findRecord, endDateFor } = ctx.__x;
const u = id => findRecord('users', id);

// built-in roles
assert.equal(kind(u('u-admin')), 'admin');
assert.ok(can('settings', 'edit', u('u-admin')), 'admin has full access');
assert.ok(can('courses', 'edit', u('u-faraz')) && !can('courses', 'delete', u('u-faraz')), 'instructor edits but cannot delete courses');
assert.ok(!can('settings', 'view', u('u-ali')) && can('learn', 'view', u('u-ali')), 'learner permissions');
// custom role from seed
assert.equal(kind(u('u-accounts')), 'admin');
assert.ok(can('fees', 'delete', u('u-accounts')) && !can('courses', 'view', u('u-accounts')), 'accounts officer scoped to fees');

// course scoping
assert.equal(Domain.visibleCourses(u('u-admin')).length, db().courses.length);
assert.deepEqual(Domain.visibleCourses(u('u-faraz')).map(c => c.id).sort(), ['C-EXCEL', 'C-PBI']);
assert.ok(Domain.visibleCourses(u('u-ali')).every(c => c.status === 'published'), 'learners never see drafts');
assert.ok(!Domain.canManageCourse(u('u-faraz'), findRecord('courses', 'C-TABLEAU')), 'instructor cannot manage others\' courses');

// a new custom role limited to selected courses
addRecord('roles', { id: 'tableau-viewer', name: 'Tableau viewer', base: 'teacher', courseScope: 'selected', courseIds: ['C-TABLEAU'], permissions: { courses: ['view'], submissions: ['view'] } });
const viewer = addRecord('users', { name: 'V', email: 'v@x.test', role: 'tableau-viewer', status: 'Active' });
assert.deepEqual(Domain.visibleCourses(viewer).map(c => c.id), ['C-TABLEAU']);
assert.ok(can('submissions', 'view', viewer) && !can('submissions', 'edit', viewer));
assert.ok(!Domain.canManageCourse(viewer, findRecord('courses', 'C-TABLEAU')), 'view-only role cannot manage');

// grading, sessions, passwords
assert.equal(Domain.gradeFor(95), 'A+'); assert.equal(Domain.gradeFor(55), 'D'); assert.equal(Domain.gradeFor(10), 'F');
const ex = findRecord('enrollments', 'EN-02');
assert.ok(!Domain.sessionUnlocked(findRecord('sessions', 'S-TB-4'), ex) && Domain.sessionUnlocked(findRecord('sessions', 'S-TB-1'), ex), 'restricted access');
assert.ok(verifyPassword(u('u-ali'), 'Demo@123') && !verifyPassword(u('u-ali'), 'wrong'));
assert.ok(db().users.every(x => !x.password), 'no plaintext passwords stored');
// program duration -> course end date; only held sessions can be completed
assert.equal(endDateFor('2026-01-01', '3 months'), '2026-03-31'); assert.equal(endDateFor('2026-10-10', '1–2 days'), '2026-10-11'); assert.equal(endDateFor('2026-01-01', 'TBD'), '');
const future = addRecord('sessions', { courseId: 'C-EXCEL', title: 'F', date: '2999-01-01', published: true });
assert.equal(Domain.setSessionComplete('u-ali', 'C-EXCEL', future.id, true), false, 'future session cannot be completed');
// Schema 3: course-level work moves to batches; each learner keeps their own submission and sees only their batch.
const old3 = { schema: 2, batches: [{ id: 'B1', courseId: 'C' }, { id: 'B2', courseId: 'C' }], enrollments: [{ learnerId: 'L1', courseId: 'C', batchId: 'B1' }, { learnerId: 'L2', courseId: 'C', batchId: 'B2' }],
  assignments: [{ id: 'A', courseId: 'C' }], submissions: [{ assignmentId: 'A', learnerId: 'L1' }, { assignmentId: 'A', learnerId: 'L2' }], quizzes: [{ id: 'Q', courseId: 'C' }], quizAttempts: [{ quizId: 'Q', learnerId: 'L2' }] };
ctx.migrateState(old3, []); ctx.migrateState({ ...old3, schema: 2 }, []);
assert.deepEqual(old3.assignments.map(a => a.id + ':' + a.batchId), ['A:B1', 'A-B2:B2'], 'one copy per batch, idempotent');
assert.deepEqual(old3.submissions.map(s => s.assignmentId), ['A', 'A-B2'], 'submissions follow the learner batch');
assert.equal(old3.quizAttempts[0].quizId, 'Q-B2'); assert.equal(old3.schema, 3);
// Learners see only their own batch's work: Usman (weekend batch) never gets the evening batch's assignments.
assert.deepEqual(Domain.learnerAssignments('u-usman', 'C-EXCEL').map(a => a.id), ['A-EX-W1']);
assert.ok(!Domain.learnerAssignments('u-ali', 'C-EXCEL').some(a => a.id === 'A-EX-W1'), 'evening learner does not see weekend work');
console.log('core.test.js: all checks passed');
