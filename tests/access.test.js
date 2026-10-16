// D3: server-side permissions for the 14 protected collections and the role ceiling. Pure functions from
// backend/state-api.js (the same applySave the PUT route uses), dummy data, no network. Run: npm test
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const T = require('../backend/state-api.js')._test, Rules = require('../js/shared-rules.js');
const clone = v => JSON.parse(JSON.stringify(v));
const SEED = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'seed.js'), 'utf8') + ';SEED', {});
const seedRole = id => clone(SEED.roles.find(r => r.id === id));

const roles = [seedRole('admin'), seedRole('teacher'), seedRole('student'), seedRole('accounts'),
  { id: 'enrol', name: 'Enrolment desk', base: 'admin', courseScope: 'all', permissions: { enrollments: ['view', 'create', 'edit', 'delete'], learners: ['view'] } },
  { id: 'certs', name: 'Certificates', base: 'admin', courseScope: 'all', permissions: { certificates: ['view', 'create', 'edit'] } },
  { id: 'quizzer', name: 'Quiz author', base: 'teacher', courseScope: 'assigned', permissions: { quizzes: ['view', 'create', 'edit'] } },
  { id: 'rm', name: 'Role manager', base: 'admin', courseScope: 'all', permissions: { roles: ['view', 'create', 'edit'], staff: ['view', 'create', 'edit'], learners: ['view', 'create'], settings: ['view', 'edit'] } },
  { id: 'sel', name: 'Selected', base: 'admin', courseScope: 'selected', courseIds: ['C1'], permissions: { roles: ['view', 'create', 'edit'], courses: ['view', 'edit'] } }];
const FUTURE = '2099-01-01T10:00', PAST = '2020-01-01T10:00';
const state = () => clone({
  schema: 4, roles, settings: { lms: { lateSubmissions: true, certificatePrefix: 'CERT' }, auth: { googleSignUpRole: '' } },
  users: ['admin:A', 'teacher:T', 'teacher:T2', 'student:L', 'student:L2', 'student:LX', 'accounts:ACC', 'enrol:EN', 'certs:CE', 'quizzer:QZ', 'rm:RM', 'sel:SE']
    .map(x => { const [role, id] = x.split(':'); return { id, role, name: id, email: id.toLowerCase() + '@x', status: 'Active', passwordHash: 'h' + id, salt: 's' + id }; }),
  courses: [{ id: 'C1', status: 'published', fee: 100 }, { id: 'C2', status: 'published', fee: 50 }, { id: 'C3', status: 'draft' }],
  sessions: [{ id: 'S1', courseId: 'C1' }, { id: 'S1b', courseId: 'C1' }, { id: 'S2', courseId: 'C2' }],
  batches: [{ id: 'B1', courseId: 'C1', instructorId: 'T' }, { id: 'B2', courseId: 'C2', instructorId: 'T2' }],
  enrollments: [{ id: 'E1', learnerId: 'L', courseId: 'C1', batchId: 'B1', status: 'Active' }, { id: 'E2', learnerId: 'L2', courseId: 'C1', batchId: 'B1', status: 'Active' }, { id: 'EX', learnerId: 'LX', courseId: 'C2', batchId: 'B2', status: 'Active' }],
  assignments: [{ id: 'AS1', courseId: 'C1', batchId: 'B1', status: 'Published', maxMarks: 20, dueAt: FUTURE }, { id: 'AS3', courseId: 'C1', batchId: 'B1', status: 'Published', maxMarks: 10, dueAt: FUTURE },
    { id: 'ASD', courseId: 'C1', batchId: 'B1', status: 'Draft', maxMarks: 10, dueAt: FUTURE }, { id: 'ASC', courseId: 'C1', batchId: 'B1', status: 'Published', maxMarks: 10, dueAt: PAST, lateAllowed: false },
    { id: 'ASL', courseId: 'C1', batchId: 'B1', status: 'Published', maxMarks: 10, dueAt: PAST, lateAllowed: true }, { id: 'AS2', courseId: 'C2', batchId: 'B2', status: 'Published', maxMarks: 10, dueAt: FUTURE }],
  questions: [{ id: 'Q1', type: 'mcq_single', points: 1, options: [{ id: 'a', correct: true }, { id: 'b' }] }, { id: 'Q2', type: 'short', points: 2 }],
  quizzes: [{ id: 'QZ1', courseId: 'C1', batchId: 'B1', status: 'published', questionIds: ['Q1', 'Q2'], attemptLimit: 1 }, { id: 'QZ2', courseId: 'C2', batchId: 'B2', status: 'published', questionIds: ['Q1'] }],
  quizAttempts: [{ id: 'QA1', quizId: 'QZ1', courseId: 'C1', learnerId: 'L2', answers: { Q1: 'a' }, score: 1, maxScore: 3, percent: 33, status: 'Submitted', pendingShort: true }],
  submissions: [{ id: 'SB1', learnerId: 'L', assignmentId: 'AS1', courseId: 'C1', fileName: 'a.pdf', status: 'Submitted', grade: null, feedback: '', history: [] },
    { id: 'SBG', learnerId: 'L2', assignmentId: 'AS1', courseId: 'C1', fileName: 'b.pdf', status: 'Graded', grade: 15, feedback: 'ok', history: [] },
    { id: 'SBX', learnerId: 'LX', assignmentId: 'AS2', courseId: 'C2', fileName: 'x.pdf', status: 'Submitted', grade: null, feedback: '', history: [] }],
  attendance: [{ id: 'AT1', sessionId: 'S1', courseId: 'C1', learnerId: 'L', status: 'Present' }, { id: 'AT2', sessionId: 'S2', courseId: 'C2', learnerId: 'LX', status: 'Absent' }],
  progress: [{ id: 'PR1', learnerId: 'L', courseId: 'C1', completedSessionIds: ['S1'] }, { id: 'PR2', learnerId: 'L2', courseId: 'C1', completedSessionIds: [] }],
  results: [{ id: 'R1', learnerId: 'L', courseId: 'C1', finalPct: 40, published: false }, { id: 'R2', learnerId: 'LX', courseId: 'C2', finalPct: 70, published: true }],
  feedback: [{ id: 'F1', learnerId: 'L2', courseId: 'C1', rating: 4 }, { id: 'F2', learnerId: 'LX', courseId: 'C2', rating: 2 }],
  certificates: [{ id: 'CT1', code: 'CERT-2026-0001', learnerId: 'L2', courseId: 'C1', grade: 'A', status: 'Valid', issuedBy: 'A', issuedAt: '2026-01-01' }],
  fees: [{ id: 'FE1', learnerId: 'L', courseId: 'C1', type: 'Course Fee', amount: 100, status: 'Pending' }]
});
// Everything this browser had (new clients prove deletions with base.known).
const allKnown = s => T.readKnown({ known: Object.fromEntries(T.PROTECTED.map(k => [k, (s[k] || []).map(r => r.id)])) });
// One save by `who`: the browser's copy is the server's copy minus other password hashes, then `edit`.
function save(who, edit, { known, prev = state() } = {}) {
  const me = prev.users.find(u => u.id === who), next = clone(T.forClient(prev, who));
  edit(next);
  const r = T.applySave(prev, next, me, known === undefined ? allKnown(prev) : known);
  const find = (k, id) => r.state[k].find(x => x.id === id);
  return { ...r, find, ids: k => r.state[k].map(x => x.id).join(','), rej: r.rejected.map(x => `${x.collection}:${x.id}:${x.op}`).sort() };
}
const rec = (s, k, id) => s[k].find(x => x.id === id);
const nothingFor = (r, why) => assert.deepEqual(r.state, (() => { const s = state(); return T.applySave(s, clone(s), s.users[0], allKnown(s)).state; })(), why);

// ---- Learners: own records only, never grades, payments or certificates ----
{
  let r = save('L', s => {
    rec(s, 'fees', 'FE1').status = 'Paid'; s.fees.push({ id: 'FN', learnerId: 'L', amount: 0, status: 'Paid' });
    rec(s, 'submissions', 'SB1').grade = 20; rec(s, 'submissions', 'SBG').feedback = 'mine now';
    s.certificates.push({ id: 'CN', code: 'CERT-2026-0099', learnerId: 'L', courseId: 'C1', status: 'Valid' });
    rec(s, 'attendance', 'AT1').status = 'Excused'; rec(s, 'results', 'R1').finalPct = 99; rec(s, 'results', 'R1').published = true;
    s.enrollments.push({ id: 'EN9', learnerId: 'L', courseId: 'C2', batchId: 'B2', status: 'Active' });
    rec(s, 'assignments', 'AS1').maxMarks = 1; s.quizAttempts = s.quizAttempts.filter(a => a.id !== 'QA1');
    rec(s, 'progress', 'PR2').completedSessionIds = ['S1']; rec(s, 'feedback', 'F1').rating = 1;
  });
  assert.deepEqual(r.rej, ['assignments:AS1:edit', 'attendance:AT1:edit', 'certificates:CN:create', 'enrollments:EN9:create', 'feedback:F1:edit', 'fees:FE1:edit', 'fees:FN:create',
    'progress:PR2:edit', 'quizAttempts:QA1:delete', 'results:R1:edit', 'submissions:SB1:edit', 'submissions:SBG:edit'], 'a learner cannot change fees, marks, certificates, attendance, results or others\' records');
  nothingFor(r, 'every refused change is undone');
  r = save('L', s => { s.fees = []; s.certificates = []; s.attendance = []; s.results = []; });
  assert.deepEqual([r.ids('fees'), r.ids('certificates'), r.ids('attendance'), r.ids('results')], ['FE1', 'CT1', 'AT1,AT2', 'R1,R2'], 'nor delete them');

  // Legitimate learner work: submit, replace, quiz, progress, feedback.
  r = save('L', s => {
    s.submissions.push({ id: 'SBN', learnerId: 'L', assignmentId: 'AS3', courseId: 'C1', fileName: 'n.pdf', status: 'Submitted', grade: null, feedback: '', history: [] });
    Object.assign(rec(s, 'submissions', 'SB1'), { fileName: 'v2.pdf', uploadedAt: 'now', history: [{ fileName: 'a.pdf' }] });
    rec(s, 'progress', 'PR1').completedSessionIds = ['S1', 'S1b']; rec(s, 'progress', 'PR1').lastSessionId = 'S1b';
    s.feedback.push({ id: 'FN', learnerId: 'L', courseId: 'C1', rating: 5, comment: 'good' });
  });
  assert.deepEqual([r.rej, r.resync], [[], false], 'submit, replace, progress and feedback are saved as sent');
  assert.equal(r.find('submissions', 'SB1').fileName, 'v2.pdf');

  r = save('L', s => {
    s.submissions.push({ id: 'X1', learnerId: 'L', assignmentId: 'ASD', courseId: 'C1', status: 'Submitted' }, { id: 'X2', learnerId: 'L', assignmentId: 'AS2', courseId: 'C2', status: 'Submitted' },
      { id: 'X3', learnerId: 'L', assignmentId: 'ASC', courseId: 'C1', status: 'Late' }, { id: 'X4', learnerId: 'L2', assignmentId: 'AS3', courseId: 'C1', status: 'Submitted' },
      { id: 'X5', learnerId: 'L', assignmentId: 'AS3', courseId: 'C1', status: 'Graded', grade: 10 });
    rec(s, 'submissions', 'SB1').history = []; rec(s, 'submissions', 'SB1').fileName = 'erased-history.pdf';
    s.feedback.push({ id: 'F9', learnerId: 'L', courseId: 'C1', rating: 9 }, { id: 'F8', learnerId: 'L', courseId: 'C2', rating: 3 });
    rec(s, 'progress', 'PR1').completedSessionIds = ['S1', 'S2'];
  }, { prev: (() => { const s = state(); rec(s, 'submissions', 'SB1').history = [{ fileName: 'v0.pdf' }]; return s; })() });
  assert.deepEqual(r.rej, ['feedback:F8:create', 'feedback:F9:create', 'progress:PR1:edit', 'submissions:SB1:edit', 'submissions:X1:create', 'submissions:X2:create',
    'submissions:X3:create', 'submissions:X4:create', 'submissions:X5:create'], 'draft, other batch, closed, someone else, self-graded, rewritten history, bad rating, foreign session');
  r = save('L', s => { s.submissions.push({ id: 'XL', learnerId: 'L', assignmentId: 'ASL', courseId: 'C1', status: 'Submitted', grade: null, feedback: '' }); });
  assert.deepEqual([r.rej, r.find('submissions', 'XL').status, r.resync], [[], 'Late', true], 'past due by any time zone: saved as Late');
  const graded = state(); rec(graded, 'submissions', 'SB1').status = 'Graded'; rec(graded, 'submissions', 'SB1').grade = 12;
  r = save('L', s => { Object.assign(rec(s, 'submissions', 'SB1'), { fileName: 'late.pdf', status: 'Submitted', grade: null }); }, { prev: graded });
  assert.deepEqual(r.rej, ['submissions:SB1:edit'], 'no replacing after grading');

  // Quiz attempts are scored here: a forged score is replaced, AI points are capped, the limit holds.
  r = save('L', s => { s.quizAttempts.push({ id: 'QN', quizId: 'QZ1', courseId: 'C1', learnerId: 'L', answers: { Q1: 'b', Q2: 'text' }, aiReviews: { Q2: { points: 99, ai: true } }, score: 3, maxScore: 3, percent: 100, status: 'Submitted', pendingShort: false }); });
  const qn = r.find('quizAttempts', 'QN');
  assert.deepEqual([r.rej, qn.score, qn.maxScore, qn.percent, qn.aiReviews.Q2.points, r.resync], [[], 2, 3, 67, 2, true], 'score recomputed from the answer key');
  const honest = state(), browserGrade = Rules.gradeAttempt(['Q1', 'Q2'].map(id => rec(honest, 'questions', id)), { Q1: 'a' }, { Q2: { points: 1, ai: true } });
  r = save('L', s => { s.quizAttempts.push({ id: 'QH', quizId: 'QZ1', courseId: 'C1', learnerId: 'L', answers: { Q1: 'a' }, aiReviews: { Q2: { points: 1, ai: true } }, ...browserGrade, pendingShort: browserGrade.pending, status: 'Submitted' }); delete s.quizAttempts.at(-1).pending; });
  assert.deepEqual([r.rej, r.resync], [[], false], 'an honest attempt (scored like the browser) is saved unchanged');
  r = save('L', s => { s.quizAttempts.push({ id: 'Q1a', quizId: 'QZ1', courseId: 'C1', learnerId: 'L', answers: {}, status: 'Submitted' }, { id: 'Q1b', quizId: 'QZ1', courseId: 'C1', learnerId: 'L', answers: {}, status: 'Submitted' }, { id: 'Q2a', quizId: 'QZ2', courseId: 'C2', learnerId: 'L', answers: {}, status: 'Submitted' }); });
  assert.deepEqual(r.rej, ['quizAttempts:Q1b:create', 'quizAttempts:Q2a:create'], 'attempt limit (also within one save); only quizzes of your batch');

  // A withdrawn learner or an unpublished course: no new work.
  const gone = state(); rec(gone, 'enrollments', 'E1').status = 'Withdrawn';
  r = save('L', s => { s.submissions.push({ id: 'W1', learnerId: 'L', assignmentId: 'AS3', courseId: 'C1', status: 'Submitted' }); s.feedback.push({ id: 'W2', learnerId: 'L', courseId: 'C1', rating: 3 }); }, { prev: gone });
  assert.deepEqual(r.rej, ['feedback:W2:create', 'submissions:W1:create']);
}

// ---- Instructors: grading, attendance, results and batch work in their own courses only ----
{
  let r = save('T', s => {
    Object.assign(rec(s, 'submissions', 'SB1'), { grade: 18, feedback: 'Good', status: 'Graded', gradedBy: 'T' });
    rec(s, 'attendance', 'AT1').status = 'Late'; s.attendance.push({ id: 'ATN', sessionId: 'S1b', courseId: 'C1', learnerId: 'L2', status: 'Present' });
    rec(s, 'results', 'R1').finalPct = 75; s.results.push({ id: 'RN', learnerId: 'L2', courseId: 'C1', finalPct: 60 });
    s.assignments.push({ id: 'ASN', courseId: 'C1', batchId: 'B1', status: 'Published', maxMarks: 5 }); s.assignments = s.assignments.filter(a => a.id !== 'ASD');
    s.quizzes.push({ id: 'QZN', courseId: 'C1', batchId: 'B1', status: 'published', questionIds: [] }); rec(s, 'quizAttempts', 'QA1').score = 3; rec(s, 'quizAttempts', 'QA1').pendingShort = false;
  });
  assert.deepEqual([r.rej, r.resync], [[], false], 'the instructor\'s normal work in C1 is saved');
  r = save('T', s => {
    rec(s, 'submissions', 'SBX').grade = 9; rec(s, 'submissions', 'SBG').grade = 25; rec(s, 'attendance', 'AT2').status = 'Present'; rec(s, 'results', 'R2').finalPct = 1;
    s.attendance.push({ id: 'ATW', sessionId: 'S2', courseId: 'C1', learnerId: 'L', status: 'Present' });
    s.assignments.push({ id: 'ASW', courseId: 'C2', batchId: 'B2', status: 'Published' }, { id: 'ASM', courseId: 'C1', batchId: 'B2', status: 'Published' }); s.assignments = s.assignments.filter(a => a.id !== 'AS1');
    rec(s, 'quizzes', 'QZ2').status = 'draft'; rec(s, 'quizAttempts', 'QA1').answers = { Q1: 'b' };
    rec(s, 'fees', 'FE1').status = 'Waived'; s.certificates.push({ id: 'CW', code: 'C-1', learnerId: 'L', courseId: 'C1' }); s.enrollments.push({ id: 'EW', learnerId: 'LX', courseId: 'C1', batchId: 'B1' });
  });
  assert.deepEqual(r.rej, ['assignments:AS1:delete', 'assignments:ASM:create', 'assignments:ASW:create', 'attendance:AT2:edit', 'attendance:ATW:create', 'certificates:CW:create', 'enrollments:EW:create',
    'fees:FE1:edit', 'quizAttempts:QA1:edit', 'quizzes:QZ2:edit', 'results:R2:edit', 'submissions:SBG:edit', 'submissions:SBX:edit'],
    'other courses, marks above the maximum, a batch of another course, an assignment with submissions, answers, fees, certificates, enrollments');
  r = save('QZ', s => { s.quizzes.push({ id: 'QQ', courseId: 'C1', batchId: 'B1', status: 'draft' }, { id: 'QP', courseId: 'C1', batchId: 'B1', status: 'published' }); }, { prev: (() => { const s = state(); s.batches[0].instructorId = 'QZ'; return s; })() });
  assert.deepEqual(r.rej, ['quizzes:QP:create'], 'quizzes:create without courses:edit creates drafts in the batch it teaches; publishing needs quizzes:publish');
}

// ---- Office roles: fees, enrollments, certificates (organisation-wide, as on their screens) ----
{
  let r = save('ACC', s => { rec(s, 'fees', 'FE1').status = 'Paid'; s.fees.push({ id: 'FN', learnerId: 'L2', courseId: 'C1', amount: 100, status: 'Pending' }); s.enrollments.push({ id: 'EA', learnerId: 'LX', courseId: 'C1', batchId: 'B1' }); });
  assert.deepEqual(r.rej, ['enrollments:EA:create'], 'accounts manage fees, not enrollments');
  r = save('ACC', s => { s.fees = []; });
  assert.equal(r.ids('fees'), '', 'fees:delete with proof');

  r = save('EN', s => {
    s.enrollments.push({ id: 'EN1', learnerId: 'LX', courseId: 'C1', batchId: 'B1', status: 'Active' }, { id: 'EN2', learnerId: 'L2', courseId: 'C2', batchId: 'B2', status: 'Active' }, { id: 'EDUP', learnerId: 'L', courseId: 'C1', batchId: 'B1' });
    s.fees.push({ id: 'FC1', learnerId: 'LX', courseId: 'C1', type: 'Course Fee', amount: 100, dueDate: '', status: 'Pending', paidOn: '', method: '', reference: '' },
      { id: 'FC2', learnerId: 'L2', courseId: 'C2', type: 'Course Fee', amount: 50, status: 'Paid', paidOn: 'today' }, { id: 'FC3', learnerId: 'L', courseId: 'C1', type: 'Course Fee', amount: 100, status: 'Pending' });
  });
  assert.deepEqual(r.rej, ['enrollments:EDUP:create', 'fees:FC2:create', 'fees:FC3:create'], 'enrolling adds the course fee; no paid fees, no fees without that enrollment, no duplicate enrollment');
  r = save('EN', s => { s.enrollments = s.enrollments.filter(e => e.id !== 'E1'); s.progress = s.progress.filter(p => p.id !== 'PR1'); });
  assert.deepEqual([r.rej, r.ids('enrollments'), r.ids('progress')], [[], 'E2,EX', 'PR2'], 'removing an enrollment removes its progress (cascade)');
  r = save('EN', s => { s.progress = s.progress.filter(p => p.id !== 'PR1'); });
  assert.deepEqual(r.rej, ['progress:PR1:delete'], 'progress alone is not deleted');

  r = save('CE', s => {
    s.certificates.push({ id: 'CN1', code: 'CERT-2026-0001', learnerId: 'L', courseId: 'C1', status: 'Valid', issuedBy: 'A' });
    Object.assign(rec(s, 'certificates', 'CT1'), { status: 'Revoked', revokeReason: 'error', revokedBy: 'CE' });
  });
  assert.deepEqual([r.rej, r.find('certificates', 'CN1').code, r.find('certificates', 'CN1').issuedBy, r.find('certificates', 'CT1').status], [[], 'CERT-2026-0002', 'CE', 'Revoked'], 'a code already taken gets the next number; issued by the actor');
  r = save('CE', s => { rec(s, 'certificates', 'CT1').learnerId = 'L'; s.certificates.push({ id: 'X', code: 'Z-1' }); s.certificates = s.certificates.filter(c => c.id !== 'X'); });
  assert.deepEqual(r.rej, ['certificates:CT1:edit'], 'a certificate cannot be moved to another learner');
  r = save('CE', s => { s.certificates = []; });
  assert.deepEqual(r.rej, ['certificates:CT1:delete'], 'certificates are revoked, not deleted');
}

// ---- Cascades, deletion proof and stale copies for the new collections ----
{
  let r = save('A', s => { s.users = s.users.filter(u => u.id !== 'L2'); ['enrollments', 'progress', 'submissions', 'attendance', 'results', 'certificates', 'feedback', 'quizAttempts'].forEach(k => { s[k] = s[k].filter(x => x.learnerId !== 'L2'); }); }, { known: null });
  assert.deepEqual([r.ids('enrollments'), r.ids('certificates'), r.ids('feedback'), r.ids('quizAttempts')], ['E1,EX', '', 'F2', 'QA1'], 'deleting an account removes its learner records without proof (cascade); quiz attempts were never part of it');
  r = save('EN', s => { s.users = s.users.filter(u => u.id !== 'L2'); s.enrollments = s.enrollments.filter(x => x.learnerId !== 'L2'); });
  assert.deepEqual([r.rej, r.ids('enrollments')], [['enrollments:E2:delete', 'users:L2:delete'], 'E1,E2,EX'], 'a refused account deletion keeps its enrollments, even for an enrollments:delete role');
  r = save('A', s => { s.fees = []; s.attendance = []; s.submissions = []; }, { known: null });
  assert.deepEqual([r.ids('fees'), r.ids('attendance'), r.ids('submissions'), r.rej, r.resync], ['FE1', 'AT1,AT2', 'SB1,SBG,SBX', [], true], 'an old app version (no base) deletes nothing');
  r = save('A', s => { s.batches = s.batches.filter(b => b.id !== 'B1'); ['assignments', 'quizzes'].forEach(k => { s[k] = s[k].filter(x => x.batchId !== 'B1'); }); s.quizAttempts = s.quizAttempts.filter(a => a.quizId !== 'QZ1'); });
  assert.deepEqual([r.ids('batches'), r.ids('assignments'), r.ids('quizzes'), r.ids('quizAttempts')], ['B2', 'AS2', 'QZ2', ''], 'a batch delete takes its work and attempts');

  // A staff tab with a stale copy: the learner's newer upload and the accountant's payment survive.
  const before = state(), server = state();
  Object.assign(rec(server, 'submissions', 'SB1'), { fileName: 'v2.pdf', history: [{ fileName: 'a.pdf' }] }); rec(server, 'fees', 'FE1').status = 'Paid';
  const tab = clone(T.forClient(before, 'T')); rec(tab, 'submissions', 'SBG').grade = 16;
  const fresh = T.readKnown({ known: Object.fromEntries(T.PROTECTED.map(k => [k, before[k].map(x => x.id)])), fresh: Object.fromEntries(T.PROTECTED.map(k => [k, before[k].filter(x => !(k === 'submissions' && x.id === 'SBG')).map(x => x.id)])) });
  r = T.applySave(server, tab, server.users.find(u => u.id === 'T'), fresh);
  assert.deepEqual([rec(r.state, 'submissions', 'SB1').fileName, rec(r.state, 'fees', 'FE1').status, rec(r.state, 'submissions', 'SBG').grade, r.rejected], ['v2.pdf', 'Paid', 16, []], 'stale copy: only the grade the instructor changed is saved');
  r = T.applySave(server, clone(T.forClient(before, 'L')), server.users.find(u => u.id === 'L'), null);
  assert.deepEqual([rec(r.state, 'fees', 'FE1').status, rec(r.state, 'submissions', 'SB1').fileName], ['Paid', 'v2.pdf'], 'an old learner tab cannot undo the payment; its own stale upload is not older than the server either');
}

// ---- Role ceiling: nobody grants more than they hold (review of the roles:edit risk) ----
{
  const R = id => roles.find(r => r.id === id), base = R('student');
  assert.ok(Rules.covers(R('admin'), R('teacher'), base) && !Rules.covers(R('rm'), R('admin'), base), 'admin covers all; nobody else covers admin');
  assert.ok(Rules.covers(R('rm'), base, base) && !Rules.covers(R('rm'), R('teacher'), base), 'learner roles are covered via the baseline; instructors are not');
  assert.ok(!Rules.covers(R('sel'), { permissions: {}, courseScope: 'all' }, base) && Rules.covers(R('sel'), { permissions: {}, courseScope: 'selected', courseIds: ['C1'] }, base)
    && !Rules.covers(R('sel'), { permissions: {}, courseScope: 'selected', courseIds: ['C2'] }, base), 'course access cannot be widened');

  let r = save('RM', s => { rec(s, 'roles', 'rm').permissions.fees = ['view', 'edit']; s.roles.push({ id: 'boss', base: 'admin', courseScope: 'all', permissions: { settings: ['view', 'edit'], fees: ['view', 'edit'] } }); });
  assert.deepEqual(r.rej, ['roles:boss:create', 'roles:rm:edit'], 'roles:edit cannot add a permission to its own role, or create a role above itself');
  r = save('RM', s => { s.roles.push({ id: 'helper', base: 'admin', courseScope: 'all', permissions: { learners: ['view', 'create'] } }); rec(s, 'roles', 'rm').description = 'renamed'; rec(s, 'roles', 'rm').permissions.settings = ['view']; });
  assert.deepEqual(r.rej, [], 'creating smaller roles and trimming its own role still work');
  r = save('RM', s => {
    s.users.push({ id: 'NEW1', role: 'admin', email: 'n1@x', passwordHash: 'p', salt: 's' }, { id: 'NEW2', role: 'teacher', email: 'n2@x', passwordHash: 'p', salt: 's' }, { id: 'NEW3', role: 'student', email: 'n3@x', passwordHash: 'p', salt: 's' });
    rec(s, 'users', 'A').passwordHash = 'mine'; rec(s, 'users', 'T').email = 'rm-controls@x'; rec(s, 'users', 'ACC').role = 'admin'; rec(s, 'users', 'T').phone = '1';
    s.settings.auth.googleSignUpRole = 'admin';
  });
  assert.deepEqual(r.rej, ['settings:auth.googleSignUpRole:edit', 'users:A:edit', 'users:ACC:edit', 'users:NEW1:create', 'users:NEW2:create', 'users:T:edit'],
    'no admin accounts, no take-over by password or email, no admin role for Google sign-ups');
  assert.deepEqual([r.find('users', 'NEW3')?.role, r.state.settings.auth.googleSignUpRole], ['student', ''], 'learner accounts are still created');
  r = save('RM', s => { rec(s, 'users', 'T').phone = '1'; rec(s, 'users', 'T2').name = 'Renamed'; });
  assert.deepEqual(r.rej, [], 'ordinary profile edits of other staff still work');
  r = save('A', s => { s.users.push({ id: 'NEWA', role: 'admin', email: 'na@x', passwordHash: 'p', salt: 's' }); rec(s, 'roles', 'rm').permissions.fees = ['view']; s.settings.auth.googleSignUpRole = 'teacher'; });
  assert.deepEqual(r.rej, [], 'the built-in admin is not limited');
}
console.log('access.test.js: all checks passed');
