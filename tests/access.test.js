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

  // Quiz attempts are scored here: a forged score is replaced, an AI mark counts only when the server signed it
  // (POST /api/ai/quiz-check) for this learner, quiz, question and answer, AI points are capped, the limit holds.
  const attempt = (id, answers, aiReviews) => s => { s.quizAttempts.push({ id, quizId: 'QZ1', courseId: 'C1', learnerId: 'L', answers, aiReviews, score: 3, maxScore: 3, percent: 100, status: 'Submitted', pendingShort: false }); };
  r = save('L', attempt('QN', { Q1: 'b', Q2: 'text' }, { Q2: { points: 99, ai: true } }));
  let qn = r.find('quizAttempts', 'QN');
  assert.deepEqual([r.rej, qn.score, qn.maxScore, qn.percent, qn.aiReviews.Q2.points, qn.pendingShort, r.resync], [[], 0, 3, 0, null, true, true], 'a mark typed into the browser is ignored: the answer waits for the instructor');
  const signed = (answer, over = {}) => T.signReview({ uid: 'L', quizId: 'QZ1', questionId: 'Q2', answer, points: 99, rationale: 'Good', ...over });
  r = save('L', attempt('QN', { Q1: 'b', Q2: 'text' }, { Q2: { points: 99, ai: true, token: signed('text') } }));
  qn = r.find('quizAttempts', 'QN');
  assert.deepEqual([qn.score, qn.percent, qn.aiReviews.Q2.points, qn.aiReviews.Q2.rationale, qn.pendingShort], [2, 67, 2, 'Good', false], 'a signed mark counts, capped at the question points');
  for (const [why, token] of [['another answer', signed('other text')], ['another learner', signed('text', { uid: 'L2' })], ['another question', signed('text', { questionId: 'Q1' })], ['a forged signature', signed('text').slice(0, -3) + 'abc']]) {
    qn = save('L', attempt('QN', { Q1: 'b', Q2: 'text' }, { Q2: { points: 2, ai: true, token } })).find('quizAttempts', 'QN');
    assert.deepEqual([qn.aiReviews.Q2.points, qn.pendingShort], [null, true], 'a signature for ' + why + ' is refused');
  }
  const honest = state(), review = { points: 1, rationale: 'Good', ai: true, token: signed(undefined, { points: 1 }) }, browserGrade = Rules.gradeAttempt(['Q1', 'Q2'].map(id => rec(honest, 'questions', id)), { Q1: 'a' }, { Q2: review });
  r = save('L', s => { s.quizAttempts.push({ id: 'QH', quizId: 'QZ1', courseId: 'C1', learnerId: 'L', answers: { Q1: 'a' }, aiReviews: { Q2: review }, ...browserGrade, pendingShort: browserGrade.pending, status: 'Submitted' }); delete s.quizAttempts.at(-1).pending; });
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

// ---- P0: what a learner receives (no unauthorized drafts, no answer keys) and questions are guarded ----
{
  const s0 = () => {
    const s = state();
    Object.assign(rec(s, 'courses', 'C3'), { title: 'Secret draft' });
    rec(s, 'courses', 'C1').aiContent = { proposals: [{ text: 'staff only' }] };
    s.sessions.push({ id: 'S3', courseId: 'C3', title: 'Draft lesson', content: { lesson: [{ heading: 'Secret' }], meta: { approved: true } } });
    rec(s, 'sessions', 'S1').content = { lesson: [{ heading: 'Intro' }], quiz: [{ question: 'q', options: ['x', 'y'], answer: 1 }], teacherNotes: ['staff'], meta: { approved: true, parts: { lesson: { at: 't' } }, history: [{ id: 'h' }] } };
    rec(s, 'sessions', 'S1b').content = { lesson: [{ heading: 'Not approved yet' }], meta: {} };
    rec(s, 'sessions', 'S2').content = { lesson: [{ heading: 'C2 lesson' }], meta: { approved: true, parts: { lesson: { at: 't' } } } };
    s.questions.forEach(q => { q.courseId = 'C1'; });
    Object.assign(rec(s, 'questions', 'Q2'), { modelAnswer: 'secret answer', keywords: ['secret'] });
    s.questions.push({ id: 'Q3', courseId: 'C3', type: 'mcq_single', stem: 'Draft question', options: [{ id: 'a', correct: true }] });
    s.quizzes.push({ id: 'QZ3', courseId: 'C3', batchId: '', status: 'draft', questionIds: ['Q3'] });
    // C1 also has a draft quiz of the learner's batch and a published quiz of another batch.
    s.batches.push({ id: 'B1x', courseId: 'C1', instructorId: 'T' });
    s.questions.push({ id: 'QD', courseId: 'C1', type: 'short', stem: 'Draft quiz question' }, { id: 'QB', courseId: 'C1', type: 'short', stem: 'Other batch question' });
    s.quizzes.push({ id: 'QZD', courseId: 'C1', batchId: 'B1', status: 'draft', questionIds: ['QD'] }, { id: 'QZB', courseId: 'C1', batchId: 'B1x', status: 'published', questionIds: ['QB'] });
    s.assignments.push({ id: 'ASB', courseId: 'C1', batchId: 'B1x', status: 'Published', maxMarks: 10, dueAt: FUTURE });
    s.feedback.push({ id: 'FL', learnerId: 'L', courseId: 'C1', rating: 5 });
    s.certificates.push({ id: 'CTL', code: 'CERT-2026-0002', learnerId: 'L', courseId: 'C1', status: 'Valid', issuedBy: 'A', issuedAt: '2026-01-02' });
    return s;
  };
  const me = (s, id) => s.users.find(u => u.id === id), ids = (s, k) => s[k].map(x => x.id).join(',');
  const OWN = ['enrollments', 'submissions', 'quizAttempts', 'progress', 'attendance', 'results', 'feedback', 'certificates', 'fees'];
  const PART = ['courses', 'sessions', 'quizzes', 'questions', 'quizAttempts'], WORK = [...PART, 'assignments', ...OWN.filter(k => k !== 'quizAttempts')];
  let s = s0(), v = T.toClient(s, me(s, 'L'));
  assert.deepEqual(WORK.map(k => ids(v, k)), ['C1,C2', 'S1,S1b', 'QZ1', 'Q1,Q2', '', 'AS1,AS3,ASC,ASL', 'E1', 'SB1', 'PR1', 'AT1', '', 'FL', 'CTL', 'FE1'],
    'L (enrolled in C1, batch B1): the published C2 stays in the catalogue, but no C2 or draft C3 sessions, assignments, quizzes or questions, no draft or other-batch quiz or assignment, no unpublished result, and no one else\'s records');
  assert.ok(!/correct|secret|staff|Not approved|history|C2 lesson|Draft|Other batch/.test(JSON.stringify(PART.map(k => v[k]))), 'no answer keys, model answers, staff notes, unapproved content, AI working data or unavailable quizzes');
  assert.ok(OWN.every(k => v[k].every(x => x.learnerId === 'L')), 'no other learner\'s enrollments, submissions, attempts, progress, attendance, results, feedback, certificates or fees');
  assert.ok(v.assignments.every(a => a.batchId === 'B1' && a.status !== 'Draft'), 'only published assignments of their own batch');
  { const p = s0(); rec(p, 'results', 'R1').published = true;
    assert.equal(ids(T.toClient(p, me(p, 'L')), 'results'), 'R1', 'their result once it is published'); }
  { const b = s0(); rec(b, 'enrollments', 'E1').batchId = 'B1x'; const vb = T.toClient(b, me(b, 'L'));
    assert.deepEqual([ids(vb, 'quizzes'), ids(vb, 'questions'), ids(vb, 'assignments')], ['QZB', 'QB', 'ASB'], 'moved to batch B1x: that batch\'s published quiz and assignments instead'); }
  assert.deepEqual(Object.keys(rec(v, 'sessions', 'S1').content).sort(), ['lesson', 'meta'], 'approved content of a published course: the learner part only');
  assert.deepEqual(rec(v, 'sessions', 'S1').content.meta, { parts: { lesson: {} }, approved: true }, 'meta says only which parts are written');
  assert.ok(v.questions.every(q => q.answerHidden), 'questions are marked so the quiz page lets the server score');
  for (const who of ['A', 'T', 'ACC']) assert.deepEqual(T.toClient(s, me(s, who)), T.forClient(s, who), who + ': staff still receive the whole state');
  // LX (enrolled in C2) gets C2's lesson and the C1 question its quiz uses, but nothing else of C1.
  const vx = T.toClient(s, me(s, 'LX'));
  assert.deepEqual(WORK.map(k => ids(vx, k)), ['C1,C2', 'S2', 'QZ2', 'Q1', '', 'AS2', 'EX', 'SBX', '', 'AT2', 'R2', 'F2', '', ''], 'LX: only their own course and records');
  assert.equal(rec(vx, 'sessions', 'S2').content.lesson[0].heading, 'C2 lesson');
  // Withdrawn: the course stays in the catalogue, its lessons and assessments are no longer sent.
  { const w = s0(); rec(w, 'enrollments', 'E1').status = 'Withdrawn'; const vw = T.toClient(w, me(w, 'L'));
    assert.deepEqual(WORK.map(k => ids(vw, k)), ['C1,C2', '', '', '', '', '', 'E1', 'SB1', 'PR1', 'AT1', '', 'FL', 'CTL', 'FE1'], 'withdrawn learner: no sessions, quizzes, questions or assignments; only their own records');
    const had = Object.fromEntries(T.PROTECTED.map(k => [k, (vw[k] || []).map(x => x.id)]));
    const r = T.applySave(w, clone(vw), me(w, 'L'), T.readKnown({ known: had, fresh: had }));
    assert.deepEqual([r.rejected, WORK.map(k => r.state[k])], [[], WORK.map(k => w[k])], 'their save deletes none of the hidden records'); }
  // A lesson written by a person (no AI parts) and approved stays visible; staff AI data does not travel.
  { const m = s0();
    rec(m, 'sessions', 'S1b').content = { lesson: [{ heading: 'Hand written' }], practice: [{ task: 'Do it' }],
      meta: { approved: true, edited: { by: 'T', at: 't', parts: ['lesson'] }, parts: { practice: { at: 't', provider: 'groq', model: 'mx-model', tokens: 77, instructions: 'STAFF PROMPT' } }, errors: { assess: 'boom' }, history: [{ id: 'h' }] } };
    const sb = rec(T.toClient(m, me(m, 'L')), 'sessions', 'S1b'), CCL = require('../js/coursecontent-logic.js'), st = CCL.sessionState(sb);
    assert.deepEqual([st.status, st.done, st.approved, sb.content.lesson[0].heading], ['partial', ['lesson', 'practice'], true, 'Hand written'], 'an approved manual edit is shown to the learner');
    assert.ok(!/STAFF PROMPT|groq|mx-model|tokens|boom|edited|history|"at"/.test(JSON.stringify(sb)), 'no staff instructions, provider, model, tokens, errors or history'); }

  // The learner's own saves: the hidden records are not deleted and nothing is reported as refused.
  const base = c => T.readKnown({ known: Object.fromEntries(T.PROTECTED.map(k => [k, (c[k] || []).map(r => r.id)])), fresh: Object.fromEntries(T.PROTECTED.map(k => [k, (c[k] || []).map(r => r.id)])) });
  let r = T.applySave(s, clone(v), me(s, 'L'), base(v));
  assert.deepEqual([r.rejected, WORK.map(k => r.state[k])], [[], WORK.map(k => s0()[k])], 'saving the filtered copy changes and deletes nothing');
  for (const known of [base(v), null]) {
    const n = clone(v);
    n.questions.push({ id: 'QA-UNAUTHORIZED', courseId: 'C1', type: 'mcq_single', stem: 'x', options: [{ id: 'a', correct: true }] });
    n.questions[0].options[1].correct = true; n.questions = n.questions.filter(q => q.id !== 'Q2');
    r = T.applySave(s, n, me(s, 'L'), known);
    assert.deepEqual(r.rejected.filter(x => x.collection === 'questions').map(x => `${x.id}:${x.op}`).sort(), ['Q1:edit', 'QA-UNAUTHORIZED:create'], 'a learner cannot add or change questions');
    assert.deepEqual(r.state.questions, s0().questions, 'the stored questions are unchanged (a removed one is kept)');
  }
  // A quiz taken without the answer key is scored by the server from the stored key.
  const n = clone(v);
  n.quizAttempts.push({ id: 'QAL', quizId: 'QZ1', courseId: 'C1', learnerId: 'L', answers: { Q1: 'a', Q2: 'text' }, aiReviews: {}, score: 0, maxScore: 3, percent: 0, status: 'Submitted' });
  r = T.applySave(s, n, me(s, 'L'), base(v));
  assert.deepEqual([r.rejected, (({ score, percent, pendingShort }) => ({ score, percent, pendingShort }))(r.state.quizAttempts.find(a => a.id === 'QAL'))], [[], { score: 1, percent: 33, pendingShort: true }]);

  // Staff question writes keep working, within their course access.
  r = save('T', x => { x.questions.push({ id: 'Q4', courseId: 'C1', type: 'short', stem: 'new' }); rec(x, 'questions', 'Q1').stem = 'edited'; x.questions = x.questions.filter(q => q.id !== 'Q2'); }, { prev: s0() });
  assert.deepEqual([r.rej, r.ids('questions'), r.find('questions', 'Q1').stem], [[], 'Q1,Q3,QD,QB,Q4', 'edited'], 'instructor: questions of a course they teach');
  r = save('T', x => { x.questions.push({ id: 'Q5', courseId: 'C2', type: 'short', stem: 'x' }); rec(x, 'questions', 'Q3').stem = 'x'; }, { prev: s0() });
  assert.deepEqual(r.rej, ['questions:Q3:edit', 'questions:Q5:create'], 'instructor: not another course\'s questions');
  r = save('A', x => { x.questions.push({ id: 'Q6', courseId: 'C3', type: 'short', stem: 'x' }); rec(x, 'questions', 'Q3').stem = 'x'; }, { prev: s0() });
  assert.deepEqual([r.rej, r.ids('questions')], [[], 'Q1,Q2,Q3,QD,QB,Q6'], 'the coordinator is not limited');
}

// ---- The other shared collections: accounts, messages, notifications, announcements, question banks,
// practice attempts, rubrics and at-risk flags ----
{
  const s1 = () => {
    const s = state();
    Object.assign(s.users.find(u => u.id === 'T'), { phone: '0300-T', designation: 'Instructor' });
    s.messages = [{ id: 'M1', from: 'L', to: 'T', subject: 'hi' }, { id: 'M2', from: 'T', to: 'L', subject: 're', read: false }, { id: 'M3', from: 'L2', to: 'T', subject: 'L2 private' }];
    s.notifications = [{ id: 'N1', userId: 'L', title: 'yours', read: false }, { id: 'N2', userId: 'L2', title: 'L2 grade' }, { id: 'N3', userId: 'T', title: 'staff note' }];
    s.announcements = [{ id: 'AN1', audience: 'everyone', authorId: 'A' }, { id: 'AN2', audience: 'learners', authorId: 'A' }, { id: 'AN3', audience: 'instructors', authorId: 'A', message: 'staff only' },
      { id: 'AN4', audience: 'course', courseId: 'C1', authorId: 'T' }, { id: 'AN5', audience: 'course', courseId: 'C2', authorId: 'T2' }, { id: 'AN6', audience: 'everyone', status: 'Draft', authorId: 'A' },
      { id: 'AN7', audience: 'everyone', expiry: '2020-01-01', authorId: 'A' }];
    s.questionBanks = [{ id: 'QB1', courseId: 'C1', title: 'bank' }];
    s.practiceAttempts = [{ id: 'PA1', learnerId: 'L', courseId: 'C1', percent: 50 }, { id: 'PA2', learnerId: 'L2', courseId: 'C1', percent: 10 }];
    s.rubrics = [{ id: 'RB1', assignmentId: 'AS1', criteria: [{ c: 'marking guide' }] }];
    s.atRiskFlags = [{ id: 'AR1', learnerId: 'L', courseId: 'C1', level: 'High', outreachNotes: [{ text: 'called' }] }];
    return s;
  };
  const S = ['users', 'messages', 'notifications', 'announcements', 'questionBanks', 'practiceAttempts', 'rubrics', 'atRiskFlags'];
  const me = (s, id) => s.users.find(u => u.id === id), idsOf = v => S.map(k => v[k].map(x => x.id).join(','));
  const s = s1(), v = T.toClient(s, me(s, 'L'));
  assert.deepEqual(idsOf(v), ['A,T,L,ACC,EN,CE,RM,SE', 'M1,M2', 'N1', 'AN1,AN2,AN4', '', 'PA1', '', ''],
    'L: staff-console accounts and their instructor, their own messages, notifications and practice, announcements for everyone, learners or their course; no banks, rubrics or flags');
  assert.ok(v.users.filter(u => u.id !== 'L').every(u => Object.keys(u).every(k => ['id', 'name', 'role', 'status', 'designation', 'avatarUrl'].includes(k))), 'others: name and picture only');
  assert.deepEqual([me(v, 'L').email, me(v, 'L').passwordHash, me(v, 'T').designation], ['l@x', 'hL', 'Instructor'], 'their own account in full');
  assert.ok(!/L2 private|L2 grade|staff note|staff only|marking guide|called|0300-T|t2@x|l2@x/.test(JSON.stringify(S.map(k => v[k]))), 'nothing of another learner, no staff records, no contact details');
  const vx = T.toClient(s, me(s, 'LX'));
  assert.deepEqual(idsOf(vx).slice(0, 4), ['A,T2,LX,ACC,EN,CE,RM,SE', '', '', 'AN1,AN2,AN5'], 'LX: their own instructor and course announcement');
  for (const who of ['A', 'T']) assert.deepEqual(T.toClient(s, me(s, who)), T.forClient(s, who), who + ': staff still receive everything');

  const L = me(s, 'L'), learnerSave = edit => { const n = clone(v); edit(n); const r = T.applySave(s, n, L, allKnown(v)); return { r, rej: r.rejected.map(x => `${x.collection}:${x.id}:${x.op}`).sort() }; };
  // The filtered copy, and the full copy an app version from before this change holds: nothing changes, nothing is reported.
  let { r } = learnerSave(() => {});
  assert.deepEqual([r.rejected, S.map(k => r.state[k])], [[], S.map(k => s1()[k])], 'saving the filtered copy deletes nothing hidden');
  r = T.applySave(s, clone(T.forClient(s, 'L')), L, allKnown(s));
  assert.deepEqual([r.rejected, S.map(k => r.state[k])], [[], S.map(k => s1()[k])], 'an older full copy changes nothing either');
  // What the learner's screens do: read a message and a notification, clear one, message and notify their instructor, practise, edit their profile.
  ({ r } = learnerSave(n => {
    me(n, 'L').name = 'L renamed'; Object.assign(n.messages.find(m => m.id === 'M2'), { read: true, updatedAt: 'now' });
    n.messages.push({ id: 'M4', from: 'L', to: 'T', subject: 'question' }); n.notifications.push({ id: 'N4', userId: 'T', title: 'New submission' }, { id: 'N5', userId: 'L', title: 'Submission received' });
    n.notifications = n.notifications.filter(x => x.id !== 'N1'); n.practiceAttempts.push({ id: 'PA3', learnerId: 'L', courseId: 'C1', percent: 80 });
  }));
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(idsOf(r.state).slice(1, 6), ['M1,M2,M3,M4', 'N2,N3,N4,N5', 'AN1,AN2,AN3,AN4,AN5,AN6,AN7', 'QB1', 'PA1,PA2,PA3'], 'their changes saved, every hidden record kept');
  assert.deepEqual([me(r.state, 'L').name, r.state.messages[1].read], ['L renamed', true]);
  // Crafted writes: hidden records, someone else's name on a message or attempt, staff collections, announcements without permission.
  const x = learnerSave(n => {
    n.messages.push({ id: 'M3', from: 'L2', to: 'T', subject: 'forged' }, { id: 'M5', from: 'L2', to: 'T', subject: 'as L2' }, { id: 'M6', from: 'L', to: 'L2', subject: 'to a hidden learner' });
    n.messages.find(m => m.id === 'M1').subject = 'rewritten';
    n.notifications.push({ id: 'N2', userId: 'L2', title: 'forged' }, { id: 'N6', userId: 'L2', title: 'spam' });
    n.announcements.push({ id: 'AN8', audience: 'everyone', authorId: 'L' }); n.announcements.find(a => a.id === 'AN1').title = 'x'; n.announcements = n.announcements.filter(a => a.id !== 'AN4');
    n.questionBanks.push({ id: 'QB2' }); n.rubrics.push({ id: 'RB1', criteria: [] }); n.atRiskFlags.push({ id: 'AR1', level: 'Low' });
    n.practiceAttempts.push({ id: 'PA4', learnerId: 'L2', percent: 100 }); n.practiceAttempts[0].percent = 100;
    me(n, 'T').name = 'renamed';
  });
  assert.deepEqual(x.rej, ['announcements:AN1:edit', 'announcements:AN4:delete', 'announcements:AN8:create', 'atRiskFlags:AR1:edit', 'messages:M1:edit', 'messages:M3:edit', 'messages:M5:create', 'messages:M6:create',
    'notifications:N2:edit', 'notifications:N6:create', 'practiceAttempts:PA1:edit', 'practiceAttempts:PA4:create', 'questionBanks:QB2:create', 'rubrics:RB1:edit', 'users:T:edit']);
  assert.deepEqual(S.map(k => x.r.state[k]), S.map(k => s1()[k]), 'every refused write is undone');
  // A learner role with announcement permission keeps it.
  { const p = s1(); p.roles = p.roles.map(r => r.id === 'student' ? { ...r, permissions: { ...r.permissions, announcements: ['view', 'create'] } } : r);
    const n = clone(T.toClient(p, me(p, 'L'))); n.announcements.push({ id: 'AN9', audience: 'course', courseId: 'C1', authorId: 'L' });
    assert.deepEqual(T.applySave(p, n, me(p, 'L'), allKnown(n)).rejected, []); }
}
console.log('access.test.js: all checks passed');
