// Stage 2 safe-write scenarios, run against the REAL backend/state-api.js and backend/ai-api.js code
// over HTTP on 127.0.0.1. The database behind the local REST stand-in is either the in-memory fake
// (npm test) or a local PostgreSQL test database (npm run test:db). Dummy data only.
const assert = require('assert'), crypto = require('crypto'), fs = require('fs'), path = require('path'), vm = require('vm');
const express = require('express');
const { createRestServer } = require('../../scripts/localdb/rest.js');

const ROOT = path.join(__dirname, '..', '..');
const clone = v => JSON.parse(JSON.stringify(v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 10000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out waiting'); await sleep(5); } };
// The 14 protected collections, as js/cloud-sync.js sends them (backend/state-api.js PROTECTED).
const TRACKED = ['courses', 'sessions', 'batches', 'enrollments', 'assignments', 'quizzes', 'quizAttempts', 'submissions', 'attendance', 'progress', 'results', 'feedback', 'certificates', 'fees'];
const idsOf = s => Object.fromEntries(TRACKED.map(k => [k, (s[k] || []).map(r => r.id)]));
const has = (s, k, id) => (s[k] || []).some(r => r.id === id);
const genId = () => crypto.randomUUID();

function outline(over = {}) {
  return { title: 'AI Generated Course ' + crypto.randomBytes(3).toString('hex'), tagline: 'Draft', description: 'Made by a test.', outcomes: ['One', 'Two'], delivery: 'online',
    modules: [{ name: 'Module 1', summary: 'First', sessions: [{ title: 'Lesson 1', summary: 'a' }, { title: 'Lesson 2', summary: 'b' }] }, { name: 'Module 2', sessions: [{ title: 'Lesson 3' }] }], ...over };
}

async function run(backend) {
  // Nothing here may reach a real project: scrub, then point the gateway at the local stand-in.
  for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SDC_ALLOW_LIVE', 'VERCEL', 'NODE_ENV', 'SDC_AI_LOCAL_OPEN']) delete process.env[k];
  // state-api.js reads its target once at load; loaded earlier it would fall back to js/cloud-config.js.
  assert.ok(!require.cache[require.resolve('../../backend/state-api.js')], 'state-api.js must be loaded only after the local target is set');
  const secret = crypto.randomBytes(16).toString('hex');
  await backend.setSecret(secret);
  const hooks = {};
  const rest = await createRestServer(backend.call, hooks);
  assert.match(rest.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  Object.assign(process.env, { SUPABASE_URL: rest.url, SUPABASE_ANON_KEY: 'local-test-anon', SDC_STATE_SECRET: secret });
  const stateApi = require('../../backend/state-api.js'), aiApi = require('../../backend/ai-api.js');
  const T = stateApi._test;
  const app = express(); app.use(stateApi); app.use(aiApi);
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const callApi = async (method, p, body, token) => {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  // Dummy LMS data: built-in roles from js/seed.js plus three custom roles.
  const SEED = vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'seed.js'), 'utf8') + ';SEED', {});
  const roles = [...SEED.roles,
    { id: 'editor', name: 'Editor', base: 'admin', courseScope: 'selected', courseIds: ['C1'], permissions: { courses: ['view', 'edit'] } },
    { id: 'creator', name: 'Creator', base: 'teacher', courseScope: 'assigned', courseIds: [], permissions: { courses: ['view', 'create', 'edit'], ai: ['view', 'use'] } },
    { id: 'hr', name: 'HR', base: 'admin', courseScope: 'all', courseIds: [], permissions: { staff: ['view', 'create', 'edit', 'delete'], batches: ['view'] } },
    { id: 'intake', name: 'Intake', base: 'admin', courseScope: 'all', courseIds: [], permissions: { learners: ['view', 'create'] } }];
  const user = (id, role) => { const salt = 'salt' + id; return { id, role, name: 'User ' + id, email: id.toLowerCase() + '@test.local', status: 'Active', salt, passwordHash: T.hashPassword('Test@123', salt) }; };
  const baseState = (over = {}) => ({
    schema: 4, roles: clone(roles),
    users: [user('A', 'admin'), user('A2', 'admin'), user('T', 'teacher'), user('T2', 'teacher'), user('L', 'student'), user('E', 'editor'), user('CR', 'creator'), user('H', 'hr'), user('IN', 'intake')],
    courses: [{ id: 'C1', title: 'Data Analytics', slug: 'data-analytics', status: 'published' }, { id: 'C2', title: 'Web Basics', slug: 'web-basics', status: 'draft' }],
    sessions: [{ id: 'S1', courseId: 'C1', title: 'Intro', order: 1 }, { id: 'S2', courseId: 'C1', title: 'Excel', order: 2 }, { id: 'S3', courseId: 'C2', title: 'HTML', order: 1 }],
    batches: [{ id: 'B1', courseId: 'C1', name: 'Data-Online-2026', instructorId: 'T', status: 'Active' }, { id: 'B2', courseId: 'C2', name: 'Web-Online-2026', instructorId: 'T2', status: 'Active' }],
    enrollments: [{ id: 'EN1', learnerId: 'L', courseId: 'C1', batchId: 'B1', status: 'Active' }],
    assignments: [{ id: 'AS1', courseId: 'C1', batchId: 'B1', title: 'Task 1', status: 'Published' }],
    submissions: [{ id: 'SUB1', learnerId: 'L', assignmentId: 'AS1', courseId: 'C1', status: 'Submitted' }],
    attendance: [{ id: 'AT1', sessionId: 'S1', learnerId: 'L', courseId: 'C1', status: 'Present' }],
    notifications: [], settings: { features: { courseGen: true }, lms: { deliveryModes: 'online:Online|onsite:On-site' } }, ...over
  });
  const reset = async over => { Object.keys(hooks).forEach(k => delete hooks[k]); T.resetSafeWrite(); aiApi._test.resetPlatformCache(); return backend.seed(baseState(over)); };
  const row = async () => (await backend.row()).state;
  async function login(id) {
    const r = await callApi('POST', '/api/sdc/login', { email: id.toLowerCase() + '@test.local', password: 'Test@123' });
    assert.equal(r.status, 200, 'login ' + id);
    return { id, token: r.body.token, state: r.body.state, known: idsOf(r.body.state) };
  }
  // A browser save: new clients send base.known and base.fresh (the known records they left
  // unchanged, as js/cloud-sync.js does); old (pre-Stage 2) clients send only the state.
  const freshOf = (before, after, known) => Object.fromEntries(TRACKED.map(k => [k, (known[k] || []).filter(id => { const a = (before[k] || []).find(r => r.id === id), b = (after[k] || []).find(r => r.id === id); return a && b && JSON.stringify(a) === JSON.stringify(b); })]));
  const push = (c, mutate, { base = true, known } = {}) => { const s = clone(c.state); if (mutate) mutate(s); const k = known || c.known; return callApi('PUT', '/api/sdc/state', { state: s, ...(base ? { base: { known: k, fresh: freshOf(c.state, s, k) } } : {}) }, c.token); };
  const draft = (c, body) => callApi('POST', '/api/sdc/courses/ai-draft', body, c.token);
  const steps = [];
  const step = async (name, fn) => { await reset(); await fn(); steps.push(name); };

  try {
    await step('status reports gateway and safe write', async () => {
      const r = await callApi('GET', '/api/sdc/status');
      assert.deepEqual(r.body, { gateway: true, safeWrite: true });
    });

    await step('coordinator save goes through the conditional write', async () => {
      const a = await login('A');
      const r = await push(a, s => s.courses.push({ id: 'CX', title: 'New', slug: 'new', status: 'draft' }));
      assert.equal(r.status, 200);
      const db = await backend.row();
      assert.ok(has(db.state, 'courses', 'CX'));
      assert.equal(r.body.updatedAt, db.updated_at, 'updatedAt is the raw database value');
      assert.ok(!r.body.rejected && !r.body.resync);
      assert.deepEqual(db.state.submissions, baseState().submissions, 'other collections are untouched');
    });

    await step('two coordinators saving at once: the conflict is retried and nothing is lost', async () => {
      const a = await login('A'), b = await login('A2');
      let n = 0, release; const held = new Promise(r => release = r);
      hooks.before = async fn => { if (fn === 'sdc_state_put_if' && n++ === 0) await held; };
      const pa = push(a, s => s.courses.push({ id: 'CA', title: 'From A', slug: 'from-a', status: 'draft' }));
      await until(() => n >= 1);
      const rb = await push(b, s => s.courses.push({ id: 'CB', title: 'From B', slug: 'from-b', status: 'draft' }));
      release();
      const ra = await pa;
      assert.equal(rb.status, 200); assert.equal(ra.status, 200);
      assert.ok(n >= 3, 'A had to retry after B saved');
      const db = await backend.row();
      assert.ok(has(db.state, 'courses', 'CA') && has(db.state, 'courses', 'CB'), 'both new courses survive');
      assert.equal(ra.body.updatedAt, db.updated_at);
      assert.equal(ra.body.resync, true, "A is told to re-download (B's course was kept)");
      // and without any forced ordering
      const [x, y] = await Promise.all([push(a, s => s.courses.push({ id: 'CC', title: 'C', slug: 'c', status: 'draft' })), push(b, s => s.courses.push({ id: 'CD', title: 'D', slug: 'd', status: 'draft' }))]);
      assert.equal(x.status + y.status, 400);
      const s2 = await row();
      assert.ok(['CA', 'CB', 'CC', 'CD'].every(id => has(s2, 'courses', id)));
    });

    await step('endless conflicts end in 503 busy with nothing written', async () => {
      const a = await login('A');
      hooks.before = async fn => { if (fn === 'sdc_state_put_if') await backend.seed(baseState()); };
      const r = await push(a, s => s.courses.push({ id: 'CZ', title: 'Z', slug: 'z', status: 'draft' }));
      assert.equal(r.status, 503); assert.equal(r.body.code, 'busy');
      delete hooks.before;
      assert.ok(!has(await row(), 'courses', 'CZ'));
    });

    await step('a failed write is not applied and a retry saves exactly once', async () => {
      const a = await login('A');
      let fail = true;
      hooks.before = async fn => { if (fn === 'sdc_state_put_if' && fail) { fail = false; throw Object.assign(new Error('connection reset'), { status: 500, code: 'XX000' }); } };
      const add = s => s.courses.push({ id: 'CR1', title: 'Retry', slug: 'retry', status: 'draft' });
      const r1 = await push(a, add);
      assert.equal(r1.status, 502);
      assert.ok(!has(await row(), 'courses', 'CR1'));
      const r2 = await push(a, add);
      assert.equal(r2.status, 200);
      assert.equal((await row()).courses.filter(c => c.id === 'CR1').length, 1);
    });

    await step('without sdc_state_put_if: ordinary saves keep working, AI drafts fail closed', async () => {
      await backend.setPutIf(false);
      try {
        T.resetSafeWrite();
        assert.deepEqual((await callApi('GET', '/api/sdc/status')).body, { gateway: true, safeWrite: false });
        const a = await login('A');
        const r = await push(a, s => s.courses.push({ id: 'CL', title: 'Legacy', slug: 'legacy', status: 'draft' }));
        assert.equal(r.status, 200, 'legacy path');
        assert.ok(has(await row(), 'courses', 'CL'));
        const l = await login('L');
        const lr = await push(l, s => { s.courses[0].title = 'hacked'; });
        assert.deepEqual(lr.body.rejected, [{ collection: 'courses', id: 'C1', op: 'edit' }], 'permissions apply on the legacy path too');
        const g = genId(), d = await draft(a, { genId: g, outline: outline() });
        assert.equal(d.status, 503); assert.equal(d.body.code, 'safe_save_unavailable');
        assert.ok(!(await row()).courses.some(c => c.aiMeta?.genId === g), 'nothing written');
      } finally { await backend.setPutIf(true); T.resetSafeWrite(); }
      assert.equal((await callApi('GET', '/api/sdc/status')).body.safeWrite, true);
    });

    await step('learner cannot create, edit or delete courses, sessions or batches', async () => {
      const l = await login('L');
      assert.ok(!l.state.courses.some(c => c.id === 'C2') && !l.state.sessions.some(x => x.id === 'S3'), 'the draft course is not sent to the learner');
      // A crafted request that claims to have seen the draft and deletes it.
      const r = await push(l, s => {
        s.courses.push({ id: 'CEVIL', title: 'x', slug: 'x', status: 'published' });
        s.courses[0].title = 'Changed'; s.courses = s.courses.filter(c => c.id !== 'C2');
        s.sessions[0].aiPinnedSummary = { text: 'pinned' };
        s.batches.push({ id: 'BEVIL', courseId: 'C1', instructorId: 'L' });
        s.users.find(u => u.id === 'L').name = 'Renamed Learner';
      }, { known: { ...l.known, courses: [...l.known.courses, 'C2'] } });
      assert.equal(r.status, 200);
      const ops = r.body.rejected.map(x => `${x.collection}:${x.id}:${x.op}`).sort();
      assert.deepEqual(ops, ['batches:BEVIL:create', 'courses:C1:edit', 'courses:C2:delete', 'courses:CEVIL:create', 'sessions:S1:edit'].sort());
      const s = await row();
      for (const k of TRACKED) assert.deepEqual(s[k], baseState()[k], k + ' unchanged');
      assert.equal(s.users.find(u => u.id === 'L').name, 'Renamed Learner', 'allowed parts of the same save are kept');
      assert.equal(r.body.resync, true);
    });

    await step('learner reads over HTTP: own active course only, approved manual lesson, no staff data or answer keys', async () => {
      const lesson = { lesson: [{ heading: 'Hand written intro' }], teacherNotes: ['staff notes'],
        meta: { approved: true, edited: { by: 'T', at: 't', parts: ['lesson'] }, parts: { practice: { at: 't', provider: 'groq', model: 'mx-model', tokens: 77, instructions: 'STAFF PROMPT' } }, history: [{ id: 'h1' }] } };
      const over = {
        courses: [...baseState().courses, { id: 'C3', title: 'Other published', slug: 'other', status: 'published' }],
        sessions: [{ ...baseState().sessions[0], content: lesson }, ...baseState().sessions.slice(1), { id: 'S4', courseId: 'C3', title: 'Other lesson', content: { lesson: [{ heading: 'C3 secret lesson' }], meta: { approved: true, parts: { lesson: { at: 't' } } } } }],
        assignments: [...baseState().assignments, { id: 'AS9', courseId: 'C3', batchId: 'B9', title: 'Other task', status: 'Published' }],
        quizzes: [{ id: 'QZ1', courseId: 'C1', batchId: 'B1', status: 'published', questionIds: ['Q1', 'Q2'], attemptLimit: 1 }, { id: 'QZ9', courseId: 'C3', batchId: 'B9', status: 'published', questionIds: ['Q9'] }],
        questions: [{ id: 'Q1', courseId: 'C1', type: 'mcq_single', points: 1, stem: 'Pick a', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B' }] },
          { id: 'Q2', courseId: 'C1', type: 'short', points: 2, stem: 'Explain', modelAnswer: 'model answer text', keywords: ['kw-secret'] },
          { id: 'Q9', courseId: 'C3', type: 'mcq_single', points: 1, stem: 'C3 question', options: [{ id: 'a', correct: true }] }],
        quizAttempts: [] };
      await reset(over);
      const strip = s => JSON.stringify(['sessions', 'assignments', 'quizzes', 'questions'].map(k => s[k]));
      const check = (s, who) => {
        assert.deepEqual(['courses', 'sessions', 'assignments', 'quizzes', 'questions'].map(k => s[k].map(r => r.id).join(',')), ['C1,C3', 'S1,S2', 'AS1', 'QZ1', 'Q1,Q2'], who + ': catalogue keeps C3, its work is not sent; draft C2 not sent');
        assert.ok(!/correct|model answer|kw-secret|STAFF PROMPT|groq|mx-model|tokens|staff notes|history|C3 secret|C3 question/.test(strip(s)), who + ': no answer keys or staff data');
        const S1 = s.sessions.find(x => x.id === 'S1');
        assert.deepEqual(S1.content, { lesson: lesson.lesson, meta: { parts: { lesson: {}, practice: {} }, approved: true } }, who + ': the approved hand-written lesson is sent');
      };
      const l = await login('L');
      check(l.state, 'login');
      check((await callApi('GET', '/api/sdc/state', undefined, l.token)).body.state, 'GET /state');
      // An ordinary learner save (progress) plus a quiz taken without the key: nothing hidden is lost.
      const r = await push(l, s => {
        s.progress = [{ id: 'PRL', learnerId: 'L', courseId: 'C1', completedSessionIds: ['S1'] }];
        s.quizAttempts.push({ id: 'QAL', quizId: 'QZ1', courseId: 'C1', learnerId: 'L', answers: { Q1: 'a', Q2: 'my words' }, aiReviews: {}, score: 0, maxScore: 3, percent: 0, status: 'Submitted' });
      });
      assert.equal(r.status, 200); assert.ok(!r.body.rejected, JSON.stringify(r.body.rejected));
      const db = await row(), want = baseState(over);
      for (const k of ['courses', 'sessions', 'assignments', 'quizzes', 'questions']) assert.deepEqual(db[k], want[k], k + ': hidden records and staff data kept in the database');
      assert.deepEqual(db.progress.map(x => x.id), ['PRL']);
      assert.deepEqual((({ score, percent, pendingShort }) => ({ score, percent, pendingShort }))(db.quizAttempts.find(a => a.id === 'QAL')), { score: 1, percent: 33, pendingShort: true }, 'scored by the server');
      // Short answers are marked on the server (the learner has no key): only for a short question of a quiz they may take.
      const qc = (c, body) => callApi('POST', '/api/ai/quiz-check', { feature: 'quizCheck', quizId: 'QZ1', questionId: 'Q2', answer: 'my words', ...body }, c.token);
      assert.deepEqual([(await qc(l)).status, (await qc(l)).body.code], [400, 'not_configured'], 'the learner passes every check and reaches the AI step (no provider here)');
      assert.equal((await qc(l, { questionId: 'Q1' })).status, 403, 'only short questions');
      assert.equal((await qc(l, { quizId: 'QZ9', questionId: 'Q9' })).status, 403, 'only quizzes of the own batch');
      assert.equal((await qc(l, { answer: 'x'.repeat(4001) })).status, 400, 'answer size limit');
      assert.equal((await qc(await login('T'))).status, 403, 'staff are not enrolled');
      assert.equal((await callApi('POST', '/api/ai/quiz-check', { feature: 'quizCheck', quizId: 'QZ1', questionId: 'Q2', answer: 'x' })).status, 401, 'sign-in required');
      // Crafted question writes are still refused.
      const q = await push(l, s => { s.questions[0].options[1].correct = true; s.questions.push({ id: 'QEVIL', courseId: 'C1', type: 'short', stem: 'x' }); s.questions = s.questions.filter(x => x.id !== 'Q2'); });
      assert.deepEqual(q.body.rejected.map(x => `${x.id}:${x.op}`).sort(), ['Q1:edit', 'QEVIL:create']);
      assert.deepEqual((await row()).questions, want.questions);
      // Staff still receive everything they manage.
      const a = await login('A'), t = await login('T');
      assert.deepEqual(a.state.questions, want.questions, 'coordinator: full questions with keys');
      assert.deepEqual(a.state.sessions.find(x => x.id === 'S1').content, lesson, 'coordinator: full teaching content');
      assert.ok(has(a.state, 'sessions', 'S4') && has(a.state, 'courses', 'C2'));
      assert.deepEqual(t.state.sessions.find(x => x.id === 'S1').content, lesson, 'instructor: full teaching content');
      // Withdrawn: the course stays in the catalogue, its lessons and assessments are not sent.
      const w = clone(over); w.enrollments = [{ ...baseState().enrollments[0], status: 'Withdrawn' }];
      await reset(w);
      const lw = await login('L');
      assert.deepEqual(['courses', 'sessions', 'assignments', 'quizzes', 'questions'].map(k => lw.state[k].map(x => x.id).join(',')), ['C1,C3', '', '', '', '']);
      const rw = await push(lw, s => { s.users.find(u => u.id === 'L').phone = '123'; });
      assert.equal(rw.status, 200); assert.ok(!rw.body.rejected);
      for (const k of ['sessions', 'assignments', 'quizzes', 'questions']) assert.deepEqual((await row())[k], baseState(w)[k], k + ': kept after a withdrawn learner saves');
    });

    await step('learner reads over HTTP: only their own records, only the published work of their own batch', async () => {
      const b = baseState();
      const KEYS = ['enrollments', 'submissions', 'quizzes', 'questions', 'quizAttempts', 'assignments', 'progress', 'attendance', 'results', 'feedback', 'certificates', 'fees'];
      const over = {
        users: [...b.users, user('L2', 'student')],
        batches: [...b.batches, { id: 'B1b', courseId: 'C1', name: 'Data-Evening-2026', instructorId: 'T', status: 'Active' }],
        enrollments: [...b.enrollments, { id: 'EN2', learnerId: 'L2', courseId: 'C1', batchId: 'B1b', status: 'Active' }],
        submissions: [...b.submissions, { id: 'SUB2', learnerId: 'L2', assignmentId: 'AS1', courseId: 'C1', status: 'Graded', grade: 9, feedback: 'L2 private feedback' }],
        quizzes: [{ id: 'QZ1', courseId: 'C1', batchId: 'B1', status: 'published', questionIds: ['Q1'], attemptLimit: 2 },
          { id: 'QZD', courseId: 'C1', batchId: 'B1', status: 'draft', questionIds: ['QD'] }, { id: 'QZB', courseId: 'C1', batchId: 'B1b', status: 'published', questionIds: ['QB'] }],
        questions: [{ id: 'Q1', courseId: 'C1', type: 'mcq_single', points: 1, stem: 'Pick a', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B' }] },
          { id: 'QD', courseId: 'C1', type: 'short', points: 1, stem: 'Draft quiz question' }, { id: 'QB', courseId: 'C1', type: 'short', points: 1, stem: 'Evening batch question' }],
        quizAttempts: [{ id: 'QA2', quizId: 'QZB', courseId: 'C1', learnerId: 'L2', answers: { QB: 'x' }, score: 1, maxScore: 1, percent: 100, status: 'Submitted' }],
        assignments: [...b.assignments, { id: 'ASD', courseId: 'C1', batchId: 'B1', title: 'Draft task secret', status: 'Draft' }, { id: 'ASE', courseId: 'C1', batchId: 'B1b', title: 'Evening task', status: 'Published' }],
        progress: [{ id: 'PR1', learnerId: 'L', courseId: 'C1', completedSessionIds: [] }, { id: 'PR2', learnerId: 'L2', courseId: 'C1', completedSessionIds: ['S1', 'S2'] }],
        attendance: [...b.attendance, { id: 'AT2', sessionId: 'S1', learnerId: 'L2', courseId: 'C1', status: 'Absent', notes: 'L2 absence note' }],
        results: [{ id: 'RL', learnerId: 'L', courseId: 'C1', finalPct: 80, grade: 'A', published: true }, { id: 'R2', learnerId: 'L2', courseId: 'C1', finalPct: 30, grade: 'F', remarks: 'L2 unpublished remark', published: false }],
        feedback: [{ id: 'FB2', learnerId: 'L2', courseId: 'C1', rating: 1, comment: 'L2 private comment' }],
        certificates: [{ id: 'CT1', code: 'CERT-2026-0001', learnerId: 'L', courseId: 'C1', status: 'Valid', issuedAt: '2026-01-01', issuedBy: 'A' }, { id: 'CT2', code: 'CERT-2026-0002', learnerId: 'L2', courseId: 'C1', status: 'Revoked', revokeReason: 'L2 revoke reason', issuedAt: '2026-01-02', issuedBy: 'A' }],
        fees: [{ id: 'FE1', learnerId: 'L', courseId: 'C1', type: 'Course Fee', amount: 100, status: 'Pending' }, { id: 'FE2', learnerId: 'L2', courseId: 'C1', type: 'Course Fee', amount: 100, status: 'Overdue', reference: 'L2 fee ref' }] };
      await reset(over);
      const view = s => KEYS.map(k => s[k].map(r => r.id).join(','));
      const SECRET = /L2 |Draft quiz|Draft task|Evening|"correct"/;
      const l = await login('L');
      for (const s of [l.state, (await callApi('GET', '/api/sdc/state', undefined, l.token)).body.state]) {
        assert.deepEqual(view(s), ['EN1', 'SUB1', 'QZ1', 'Q1', '', 'AS1', 'PR1', 'AT1', 'RL', '', 'CT1', 'FE1'], 'L: own records, published work of batch B1 only');
        assert.ok(!SECRET.test(JSON.stringify(KEYS.map(k => s[k]))), 'L: nothing of L2, no draft or other-batch work, no key');
      }
      const l2 = (await login('L2')).state;
      assert.deepEqual(view(l2), ['EN2', 'SUB2', 'QZB', 'QB', 'QA2', 'ASE', 'PR2', 'AT2', '', 'FB2', 'CT2', 'FE2'], 'L2: their own batch and records; their unpublished result is not sent');
      assert.ok(!/L2 unpublished/.test(JSON.stringify(l2.results)));
      // L marks a session done, leaves feedback and takes their quiz: accepted, scored by the server, nothing hidden is lost.
      const r = await push(l, s => {
        s.progress.find(p => p.id === 'PR1').completedSessionIds = ['S1'];
        s.feedback.push({ id: 'FBL', learnerId: 'L', courseId: 'C1', rating: 5, comment: 'good' });
        s.quizAttempts.push({ id: 'QAL', quizId: 'QZ1', courseId: 'C1', learnerId: 'L', answers: { Q1: 'a' }, aiReviews: {}, score: 0, maxScore: 1, percent: 0, status: 'Submitted' });
      });
      assert.equal(r.status, 200); assert.ok(!r.body.rejected, JSON.stringify(r.body.rejected));
      let db = await row();
      const want = baseState(over), HIDDEN = ['enrollments', 'submissions', 'quizzes', 'questions', 'assignments', 'attendance', 'results', 'certificates', 'fees'];
      for (const k of HIDDEN) assert.deepEqual(db[k], want[k], k + ': hidden records kept in the database');
      assert.deepEqual([db.progress, db.feedback.map(f => f.id)], [[{ ...want.progress[0], completedSessionIds: ['S1'] }, want.progress[1]], ['FB2', 'FBL']], 'L\'s progress and feedback saved, L2\'s kept');
      assert.deepEqual(db.quizAttempts.map(a => [a.id, a.percent]), [['QA2', 100], ['QAL', 100]], 'L2\'s attempt kept; L\'s attempt scored by the server');
      // Crafted writes: hidden quizzes and assignments, L2's records, and L's own marks, payments and certificates are refused.
      const x = await push(l, s => {
        s.quizAttempts.push({ id: 'QXD', quizId: 'QZD', courseId: 'C1', learnerId: 'L', answers: {}, status: 'Submitted' }, { id: 'QXB', quizId: 'QZB', courseId: 'C1', learnerId: 'L', answers: {}, status: 'Submitted' });
        s.submissions.push({ id: 'SUB2', learnerId: 'L2', assignmentId: 'AS1', courseId: 'C1', status: 'Submitted', grade: null, feedback: '' },
          { id: 'SXD', learnerId: 'L', assignmentId: 'ASD', courseId: 'C1', status: 'Submitted' }, { id: 'SXE', learnerId: 'L', assignmentId: 'ASE', courseId: 'C1', status: 'Submitted' });
        s.progress.push({ id: 'PR2', learnerId: 'L2', courseId: 'C1', completedSessionIds: [] });
        s.feedback.push({ id: 'FB2', learnerId: 'L2', courseId: 'C1', rating: 5 });
        s.attendance.push({ id: 'AT9', sessionId: 'S2', learnerId: 'L', courseId: 'C1', status: 'Present' });
        s.results.find(x => x.id === 'RL').finalPct = 100;
        s.certificates.push({ id: 'CTX', code: 'CERT-2026-0009', learnerId: 'L', courseId: 'C1', status: 'Valid' });
        s.fees.find(x => x.id === 'FE1').status = 'Paid';
      });
      assert.deepEqual(x.body.rejected.map(e => `${e.collection}:${e.id}:${e.op}`).sort(), ['attendance:AT9:create', 'certificates:CTX:create', 'feedback:FB2:edit', 'fees:FE1:edit', 'progress:PR2:edit',
        'quizAttempts:QXB:create', 'quizAttempts:QXD:create', 'results:RL:edit', 'submissions:SUB2:edit', 'submissions:SXD:create', 'submissions:SXE:create']);
      const after = await row();
      assert.deepEqual(KEYS.map(k => after[k]), KEYS.map(k => db[k]), 'every refused write is undone');
      // Coordinator and instructor still receive everything.
      for (const who of ['A', 'T']) assert.deepEqual(view((await login(who)).state), ['EN1,EN2', 'SUB1,SUB2', 'QZ1,QZD,QZB', 'Q1,QD,QB', 'QA2,QAL', 'AS1,ASD,ASE', 'PR1,PR2', 'AT1,AT2', 'RL,R2', 'FB2,FBL', 'CT1,CT2', 'FE1,FE2'], who + ': full access');
    });

    await step('learner reads over HTTP: people shown to them, own messages, notifications and practice, their announcements, no staff tools', async () => {
      const b = baseState(), S = ['users', 'messages', 'notifications', 'announcements', 'questionBanks', 'practiceAttempts', 'rubrics', 'atRiskFlags'];
      const over = {
        users: [...b.users, { ...user('L2', 'student'), phone: 'L2 phone' }],
        enrollments: [...b.enrollments, { id: 'EN2', learnerId: 'L2', courseId: 'C1', batchId: 'B1', status: 'Active' }],
        messages: [{ id: 'M1', from: 'T', to: 'L', subject: 'Welcome', body: 'hi', read: false }, { id: 'M2', from: 'L2', to: 'T', subject: 'L2 private message', body: 'x', read: false }],
        notifications: [{ id: 'N1', userId: 'L', title: 'Yours', read: false }, { id: 'N2', userId: 'L2', title: 'L2 grade notice', read: false }],
        announcements: [{ id: 'AN1', audience: 'learners', authorId: 'A', title: 'For learners', status: 'Published' }, { id: 'AN2', audience: 'instructors', authorId: 'A', title: 'Staff memo', status: 'Published' },
          { id: 'AN3', audience: 'course', courseId: 'C2', authorId: 'T2', title: 'Web course news', status: 'Published' }],
        questionBanks: [{ id: 'QB1', courseId: 'C1', title: 'Bank secret' }],
        practiceAttempts: [{ id: 'PA1', learnerId: 'L', courseId: 'C1', percent: 60 }, { id: 'PA2', learnerId: 'L2', courseId: 'C1', percent: 5 }],
        rubrics: [{ id: 'RB1', assignmentId: 'AS1', criteria: ['Rubric secret'] }],
        atRiskFlags: [{ id: 'AR1', learnerId: 'L', courseId: 'C1', level: 'High', factors: ['Risk secret'] }] };
      await reset(over);
      const view = s => S.map(k => s[k].map(r => r.id).join(','));
      const SECRET = /L2 |Staff memo|Web course|Bank secret|Rubric secret|Risk secret|@test\.local|passwordHash/;
      const l = await login('L');
      for (const s of [l.state, (await callApi('GET', '/api/sdc/state', undefined, l.token)).body.state]) {
        assert.deepEqual(view(s), ['A,A2,T,L,E,H,IN', 'M1', 'N1', 'AN1', '', 'PA1', '', ''], 'L: staff-console accounts and their instructor, their own messages, notifications and practice, the learner announcement');
        assert.ok(!SECRET.test(JSON.stringify(S.map(k => k === 'users' ? s.users.filter(u => u.id !== 'L') : s[k]))), 'nothing of L2, no staff records, no one else\'s email or password hash');
        assert.equal(s.users.find(u => u.id === 'L').email, 'l@test.local', 'their own account in full');
      }
      // L reads and answers their instructor, clears a notification, notifies the instructor and practises.
      const r = await push(l, s => {
        s.messages[0].read = true; s.messages.push({ id: 'M3', from: 'L', to: 'T', subject: 'Re: Welcome', body: 'thanks', read: false });
        s.notifications = [{ id: 'N3', userId: 'T', title: 'New submission', read: false }]; s.practiceAttempts.push({ id: 'PA3', learnerId: 'L', courseId: 'C1', percent: 90 });
      });
      assert.equal(r.status, 200); assert.ok(!r.body.rejected, JSON.stringify(r.body.rejected));
      const want = baseState(over), db = await row();
      assert.deepEqual(view(db), ['A,A2,T,T2,L,E,CR,H,IN,L2', 'M1,M2,M3', 'N2,N3', 'AN1,AN2,AN3', 'QB1', 'PA1,PA2,PA3', 'RB1', 'AR1'], 'L\'s changes saved; nothing hidden was deleted');
      assert.deepEqual([db.users, db.messages[0].read, db.notifications[0], ...['announcements', 'questionBanks', 'rubrics', 'atRiskFlags'].map(k => db[k])],
        [want.users, true, want.notifications[1], ...['announcements', 'questionBanks', 'rubrics', 'atRiskFlags'].map(k => want[k])], 'accounts (with hashes and contact details) and hidden records unchanged');
      // Crafted writes (from a fresh copy) are refused and undone.
      const x = await push(await login('L'), s => {
        s.messages.push({ id: 'M2', from: 'L2', to: 'T', subject: 'forged' }, { id: 'MX', from: 'L2', to: 'T', subject: 'as L2' });
        s.notifications.push({ id: 'NX', userId: 'L2', title: 'spam' }); s.announcements.push({ id: 'ANX', audience: 'everyone', authorId: 'L', title: 'x' });
        s.questionBanks.push({ id: 'QBX' }); s.rubrics.push({ id: 'RB1', criteria: [] }); s.atRiskFlags.push({ id: 'AR1', level: 'Low' });
        s.practiceAttempts.push({ id: 'PA2', learnerId: 'L2', percent: 100 }); s.users.find(u => u.id === 'T').name = 'renamed';
      });
      assert.deepEqual(x.body.rejected.map(e => `${e.collection}:${e.id}:${e.op}`).sort(), ['announcements:ANX:create', 'atRiskFlags:AR1:edit', 'messages:M2:edit', 'messages:MX:create', 'notifications:NX:create',
        'practiceAttempts:PA2:edit', 'questionBanks:QBX:create', 'rubrics:RB1:edit', 'users:T:edit']);
      const after = await row();
      const byId = l => l.slice().sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(S.map(k => byId(after[k])), S.map(k => byId(db[k])), 'every refused write is undone');
      for (const who of ['A', 'T']) assert.deepEqual(view((await login(who)).state), view(after), who + ': full access');
    });

    await step('instructor: own course sessions yes; other course, publish, delete, new course no', async () => {
      const t = await login('T');
      const ok = await push(t, s => {
        s.sessions.find(x => x.id === 'S1').aiPinnedSummary = { text: 'Summary', by: 'T' };
        s.sessions.push({ id: 'S9', courseId: 'C1', title: 'New session', order: 3 });
        s.sessions = s.sessions.filter(x => x.id !== 'S2');
      });
      assert.equal(ok.status, 200); assert.ok(!ok.body.rejected, JSON.stringify(ok.body));
      let s = await row();
      assert.equal(s.sessions.find(x => x.id === 'S1').aiPinnedSummary.text, 'Summary');
      assert.ok(has(s, 'sessions', 'S9') && !has(s, 'sessions', 'S2'));
      const t2 = await login('T');
      const bad = await push(t2, x => {
        x.courses.find(c => c.id === 'C2').title = 'Not mine';
        x.courses.find(c => c.id === 'C1').status = 'draft';
        x.courses.push({ id: 'CT', title: 'Mine', slug: 'mine', status: 'draft' });
        x.batches.push({ id: 'BSELF', courseId: 'C2', instructorId: 'T' });
        x.sessions.push({ id: 'S10', courseId: 'C2', title: 'Sneaky' });
      });
      assert.deepEqual(bad.body.rejected.map(x => x.id).sort(), ['BSELF', 'C1', 'C2', 'CT', 'S10'].sort(), 'scope cannot be widened in the same request');
      const t3 = await login('T');
      const del = await push(t3, x => { x.courses = x.courses.filter(c => c.id !== 'C1'); x.sessions = x.sessions.filter(v => v.courseId !== 'C1'); x.batches = x.batches.filter(b => b.courseId !== 'C1'); });
      assert.ok(del.body.rejected.some(x => x.id === 'C1' && x.op === 'delete'));
      s = await row();
      assert.ok(has(s, 'courses', 'C1') && has(s, 'sessions', 'S1') && has(s, 'sessions', 'S9') && has(s, 'batches', 'B1'), 'a refused course delete keeps its sessions and batches');
    });

    await step('editor without publish: details saved, status change reverted', async () => {
      const e = await login('E');
      const r = await push(e, s => { const c = s.courses.find(x => x.id === 'C1'); c.title = 'Renamed'; c.status = 'archived'; s.courses.find(x => x.id === 'C2').title = 'Out of scope'; });
      assert.deepEqual(r.body.rejected.map(x => x.id).sort(), ['C1', 'C2']);
      const e2 = await login('E');
      const ok = await push(e2, s => { s.courses.find(x => x.id === 'C1').title = 'Renamed'; });
      assert.ok(!ok.body.rejected);
      assert.equal((await row()).courses.find(x => x.id === 'C1').title, 'Renamed');
    });

    await step('course creator gets the first batch; batch-only changes need batch permissions', async () => {
      const c = await login('CR');
      const r = await push(c, s => {
        s.courses.push({ id: 'CN', title: 'Created', slug: 'created', status: 'draft' });
        s.batches.push({ id: 'BN', courseId: 'CN', instructorId: 'CR', status: 'Active' });
        s.sessions.push({ id: 'SN', courseId: 'CN', title: 'First' });
        s.batches.push({ id: 'BX', courseId: 'C1', instructorId: 'CR' });
      });
      assert.deepEqual(r.body.rejected, [{ collection: 'batches', id: 'BX', op: 'create' }]);
      const s = await row();
      assert.ok(has(s, 'courses', 'CN') && has(s, 'batches', 'BN') && has(s, 'sessions', 'SN'));
    });

    await step('deleting an account clears its batch instructor without batch permission', async () => {
      const h = await login('H');
      const r = await push(h, s => { s.users = s.users.filter(u => u.id !== 'T2'); s.batches.find(b => b.id === 'B2').instructorId = ''; });
      assert.ok(!r.body.rejected, JSON.stringify(r.body));
      const s = await row();
      assert.equal(s.batches.find(b => b.id === 'B2').instructorId, '');
      const h2 = await login('H');
      const bad = await push(h2, x => { x.batches.find(b => b.id === 'B1').status = 'Cancelled'; });
      assert.deepEqual(bad.body.rejected, [{ collection: 'batches', id: 'B1', op: 'edit' }]);
    });

    await step('AI draft: switch and permission checks', async () => {
      await reset({ settings: { features: {} } });
      const a = await login('A'), l = await login('L');
      assert.equal((await draft(a, { genId: genId(), outline: outline() })).body.code, 'disabled', 'switch missing = OFF on the server');
      await reset();
      assert.equal((await draft(l, { genId: genId(), outline: outline() })).status, 403);
      const t = await login('T');
      assert.equal((await draft(t, { genId: genId(), outline: outline() })).body.code, 'forbidden', 'instructors cannot create courses');
      assert.equal((await draft(a, { genId: 'short', outline: outline() })).status, 400);
      const many = outline({ modules: Array.from({ length: 13 }, (_, i) => ({ name: 'M' + i, sessions: [{ title: 'x' }] })) });
      assert.equal((await draft(a, { genId: genId(), outline: many })).body.code, 'limits');
      const big = outline({ modules: [{ name: 'M', sessions: Array.from({ length: 49 }, (_, i) => ({ title: 'S' + i })) }] });
      assert.equal((await draft(a, { genId: genId(), outline: big })).body.code, 'limits');
      const max = outline({ modules: Array.from({ length: 12 }, (_, i) => ({ name: 'M' + i, sessions: Array.from({ length: 4 }, (_, j) => ({ title: `S${i}.${j}` })) })) });
      const ok = await draft(a, { genId: genId(), outline: max });
      assert.equal(ok.status, 200, '12 modules / 48 sessions is allowed');
      assert.equal(ok.body.sessions.length, 48);
    });

    await step('AI draft: idempotent by genId (retries, duplicates, lost responses)', async () => {
      const a = await login('A'), g = genId();
      const r1 = await draft(a, { genId: g, outline: outline() });
      assert.equal(r1.status, 200); assert.equal(r1.body.alreadyCommitted, false);
      const c = r1.body.course;
      assert.equal(c.status, 'draft'); assert.equal(c.aiGenerated, true); assert.equal(c.aiMeta.genId, g);
      assert.ok(c.fee === 0 && !c.venue && !c.startDate && !c.zoom.registerUrl, 'allow-listed fields only');
      assert.equal(r1.body.sessions.length, 3); assert.equal(r1.body.batch, null, 'all-courses coordinator: no batch, like New course');
      let s = await row();
      assert.equal(r1.body.updatedAt, (await backend.row()).updated_at);
      const r2 = await draft(a, { genId: g, outline: outline({ title: 'Edited after a timeout' }) });
      assert.equal(r2.body.alreadyCommitted, true); assert.equal(r2.body.courseId, c.id);
      s = await row();
      assert.equal(s.courses.filter(x => x.aiMeta?.genId === g).length, 1, 'retry did not create a second course');
      assert.equal(s.sessions.filter(x => x.courseId === c.id).length, 3);
      // lost response: ask first, then retry with the same genId
      const st = await callApi('GET', '/api/sdc/courses/ai-draft/' + g, undefined, a.token);
      assert.deepEqual([st.body.committed, st.body.courseId], [true, c.id]);
      assert.equal((await callApi('GET', '/api/sdc/courses/ai-draft/' + genId(), undefined, a.token)).body.committed, false);
      const cr = await login('CR');
      assert.equal((await callApi('GET', '/api/sdc/courses/ai-draft/' + g, undefined, cr.token)).status, 403, "only the creator or an admin may ask about a draft");
      // two identical requests at the same moment
      const g2 = genId(), body = { genId: g2, outline: outline() };
      const [x, y] = await Promise.all([draft(a, body), draft(a, body)]);
      assert.equal(x.status, 200); assert.equal(y.status, 200);
      assert.equal([x.body.alreadyCommitted, y.body.alreadyCommitted].filter(Boolean).length, 1);
      assert.equal((await row()).courses.filter(v => v.aiMeta?.genId === g2).length, 1, 'simultaneous duplicates make one course');
      // slug clash with a different draft
      const clash = await draft(a, { genId: genId(), outline: outline({ title: c.title }) });
      assert.equal(clash.status, 409); assert.equal(clash.body.code, 'slug_in_use');
    });

    await step('AI draft by a course creator includes their first batch', async () => {
      const cr = await login('CR'), r = await draft(cr, { genId: genId(), outline: outline() });
      assert.equal(r.status, 200);
      assert.equal(r.body.batch.instructorId, 'CR');
      assert.equal(r.body.batch.courseId, r.body.courseId);
      assert.ok(has(await row(), 'batches', r.body.batch.id));
    });

    await step('AI draft (release 1): AI mark, hours, program rules, nothing cut, limits enforced', async () => {
      await reset({ programs: [{ id: 'P1', name: 'Program', divisionId: 'D1' }], divisions: [{ id: 'D1', name: 'Division' }] });
      const a = await login('A'), cr = await login('CR');
      const body = (o = {}, meta) => ({ genId: genId(), outline: outline({ programId: 'P1', divisionId: 'D1', hoursPerSession: 1.5, code: 'dx-101', icon: 'chart', level: 'Beginner', programType: 'short',
        modules: [{ name: 'Module 1', summary: 'First', sessions: [{ title: 'Lesson 1', summary: 'a', refs: [1] }, { title: 'Lesson 2', refs: [1, 2] }] }, { name: 'Module 2', sessions: [{ title: 'Lesson 3', refs: [2, 9] }] }], ...o }),
        meta: meta || { provider: 'openai', model: 'gpt-4o-mini', mock: false } });
      const r = await draft(a, body());
      assert.equal(r.status, 200);
      const c = r.body.course;
      assert.deepEqual([c.programId, c.divisionId, c.code, c.icon, c.level, c.programType, c.status], ['P1', 'D1', 'DX-101', 'chart', 'Beginner', 'short', 'draft']);
      assert.deepEqual([c.aiMeta.provider, c.aiMeta.model, c.aiMeta.mock], ['openai', 'gpt-4o-mini', false], 'provider and model are recorded on the course');
      assert.deepEqual(c.aiMeta.coverage, [[1], [1, 2], [2]], 'outcome links kept in session order (a number with no outcome is dropped)');
      assert.deepEqual(r.body.sessions.map(x => x.duration), ['1.5h', '1.5h', '1.5h']);
      assert.ok(c.fee === 0 && !c.venue && !c.startDate && !c.zoom.meetingId && !(r.body.sessions[0].zoom.meetingId), 'no fee, venue, dates or Zoom details');
      const s = await row();
      assert.equal((s.enrollments || []).length, 1, 'no enrolment was created'); // the one seeded enrolment only
      assert.equal(!!r.body.batch, false);
      // videos chosen in the review are saved on their sessions; anything that is not a YouTube video id is dropped
      const vids = await draft(a, body({ modules: [{ name: 'Module 1', sessions: [{ title: 'Lesson 1', video: { id: 'dQw4w9WgXcQ', title: 'Pivot tables', channel: 'Excel Channel', duration: 600 } },
        { title: 'Lesson 2', video: { id: 'javascript:x', title: 'bad' } }, { title: 'Lesson 3', video: null, videoUrl: 'https://evil.example/x.mp4' }] }] }));
      assert.equal(vids.status, 200);
      assert.deepEqual(vids.body.sessions.map(x => [x.videoUrl || '', x.videoTitle || '', x.videoChannel || '']), [['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Pivot tables', 'Excel Channel'], ['', '', ''], ['', '', '']]);
      assert.equal((await row()).sessions.find(x => x.id === vids.body.sessions[0].id).videoUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'stored in the shared state');
      const demo = await draft(a, body({}, { provider: 'mock-demo', model: 'mock-demo', mock: true }));
      assert.equal(demo.body.course.aiMeta.mock, true, 'demo-mode drafts are marked as such');
      const forged = await draft(a, body({}, { provider: 'x'.repeat(200), model: { a: 1 }, mock: 'yes' }));
      assert.ok(forged.body.course.aiMeta.provider.length <= 40 && forged.body.course.aiMeta.mock === false && forged.body.course.aiMeta.model === '', 'labels are clipped and typed');
      const own = await draft(cr, body());
      assert.equal(own.status, 200); assert.deepEqual([own.body.course.programId, own.body.course.divisionId], ['', ''], 'only an all-courses coordinator picks program and division');
      assert.equal((await draft(a, body({ programId: 'NOPE', divisionId: 'NOPE' }))).body.course.programId, '', 'unknown program is dropped');
      // nothing is cut: an over-limit field is refused, never shortened
      const tooLong = await draft(a, body({ title: 'T'.repeat(161) }));
      assert.equal(tooLong.status, 400); assert.equal(tooLong.body.code, 'limits');
      assert.equal((await draft(a, body({ description: 'D'.repeat(4001) }))).status, 400);
      assert.equal((await draft(a, body({ modules: Array.from({ length: 13 }, (_, i) => ({ name: 'M' + i, sessions: [{ title: 'S' + i }] })) }))).status, 400);
      assert.equal((await draft(a, body({ modules: [{ name: 'Big', sessions: Array.from({ length: 49 }, (_, i) => ({ title: 'S' + i })) }] }))).status, 400);
      const fit = await draft(a, body({ title: 'T'.repeat(160), modules: [{ name: 'Big', sessions: Array.from({ length: 48 }, (_, i) => ({ title: 'S' + i })) }] }));
      assert.equal(fit.status, 200); assert.equal(fit.body.sessions.length, 48);
      assert.equal(fit.body.course.title.length, 160);
      // learners and instructors cannot create drafts
      const l = await login('L'), t = await login('T');
      assert.equal((await draft(l, body())).status, 403); assert.equal((await draft(t, body())).status, 403);
    });

    await step('old and new browsers saving around a committed AI draft', async () => {
      const oldTab = await login('A2'), newStale = await login('A2'); // both opened before the draft
      const a = await login('A'), g = genId();
      const d = await draft(a, { genId: g, outline: outline() });
      const cid = d.body.courseId, sids = d.body.sessions.map(x => x.id);
      const present = async () => { const s = await row(); return has(s, 'courses', cid) && sids.every(id => has(s, 'sessions', id)); };
      // (1) old client (no base) pushes a state without the draft, (3) new stale tab likewise
      let r = await push(oldTab, s => { s.courses.find(c => c.id === 'C2').title = 'Old tab edit'; }, { base: false });
      assert.equal(r.status, 200); assert.ok(await present(), 'old client cannot remove the draft');
      assert.equal((await row()).courses.find(c => c.id === 'C2').title, 'Old tab edit', '(5) its unrelated edit is applied');
      r = await push(newStale, null);
      assert.ok(await present(), 'stale new tab cannot remove the draft'); assert.equal(r.body.resync, true);
      // (2) old client that pulled the draft and then deletes it: not deleted (no proof)
      const old2 = await login('A2');
      r = await push(old2, s => { s.courses = s.courses.filter(c => c.id !== cid); s.sessions = s.sessions.filter(x => x.courseId !== cid); }, { base: false });
      assert.ok(await present(), 'deletion without base.known is ignored'); assert.equal(r.body.resync, true);
      // (4) new tab that knew the draft deletes it: deleted
      const new2 = await login('A2');
      r = await push(new2, s => { s.courses = s.courses.filter(c => c.id !== cid); s.sessions = s.sessions.filter(x => x.courseId !== cid); });
      assert.ok(!r.body.rejected);
      let s = await row();
      assert.ok(!has(s, 'courses', cid) && !sids.some(id => has(s, 'sessions', id)), 'proven deletion removes the course and its sessions');
      // (6) old and new push different new courses at once
      const o = await login('A'), n = await login('A2');
      await Promise.all([push(o, x => x.courses.push({ id: 'CO', title: 'O', slug: 'o', status: 'draft' }), { base: false }), push(n, x => x.courses.push({ id: 'CNW', title: 'N', slug: 'n', status: 'draft' }))]);
      s = await row(); assert.ok(has(s, 'courses', 'CO') && has(s, 'courses', 'CNW'));
      // (7) same record edited by both: last write wins, record still there
      const o2 = await login('A'), n2 = await login('A2');
      await push(o2, x => { x.courses.find(c => c.id === 'C1').title = 'Old wins?'; }, { base: false });
      await push(n2, x => { x.courses.find(c => c.id === 'C1').title = 'New wins'; });
      assert.equal((await row()).courses.find(c => c.id === 'C1').title, 'New wins');
    });

    await step('base.known cannot grant anything and is size-limited', async () => {
      const l = await login('L');
      const r = await push(l, s => { s.courses = s.courses.filter(c => c.id !== 'C1'); }, { known: { courses: ['C1', 'C2'], sessions: [], batches: [] } });
      // C2 (a draft the learner never received) is "deleted" too by claiming it is known: also refused.
      assert.deepEqual(r.body.rejected, [{ collection: 'courses', id: 'C1', op: 'delete' }, { collection: 'courses', id: 'C2', op: 'delete' }]);
      const a = await login('A');
      const junk = await callApi('PUT', '/api/sdc/state', { state: a.state, base: { known: { courses: 'C1', sessions: [{}], batches: null } } }, a.token);
      assert.equal(junk.status, 200, 'malformed base is treated as empty');
      const huge = await callApi('PUT', '/api/sdc/state', { state: a.state, base: { known: { courses: Array.from({ length: 100001 }, (_, i) => 'X' + i) } } }, a.token);
      assert.equal(huge.status, 400);
      for (const k of TRACKED) assert.deepEqual((await row())[k], baseState()[k]);
    });

    await step('accounts: a limited account manager cannot promote anyone, themselves included', async () => {
      const m = await login('IN');
      const r = await push(m, s => {
        s.users.find(u => u.id === 'IN').role = 'admin';
        s.users.find(u => u.id === 'L').role = 'admin';
        s.users.push({ ...user('X1', 'admin') }, { ...user('Y1', 'student') });
        s.roles.find(x => x.id === 'intake').permissions.staff = ['view', 'create', 'edit', 'delete'];
      });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.rejected.map(x => `${x.collection}:${x.id}:${x.op}`).sort(), ['roles:intake:edit', 'users:IN:edit', 'users:L:edit', 'users:X1:create']);
      const s = await row();
      assert.deepEqual(['IN', 'L'].map(id => s.users.find(u => u.id === id).role), ['intake', 'student']);
      assert.ok(!s.users.some(u => u.id === 'X1') && s.users.some(u => u.id === 'Y1' && u.role === 'student'), 'creating a learner is still allowed');
      assert.deepEqual(s.roles.find(x => x.id === 'intake').permissions, { learners: ['view', 'create'] }, 'nor widen their own role');
      // D3 role ceiling: HR (staff accounts only) still edits instructor profiles and deletes their
      // accounts, but cannot hand out the admin role or take over an instructor by resetting the password.
      const hr = await login('H');
      const up = await push(hr, x => { x.users.find(u => u.id === 'T').role = 'admin'; x.users.find(u => u.id === 'T2').passwordHash = 'reset'; x.users.find(u => u.id === 'T').phone = '0300'; });
      assert.deepEqual(up.body.rejected.map(x => x.id).sort(), ['T', 'T2'], 'no granting above your own role, no password take-over');
      const ok = await push(await login('H'), x => { x.users.find(u => u.id === 'T').phone = '0300'; });
      assert.ok(!ok.body.rejected, 'plain profile edits still work');
      assert.equal((await row()).users.find(u => u.id === 'T').role, 'teacher');
      const self = await push(await login('A'), x => { x.users = x.users.filter(u => u.id !== 'A'); });
      assert.deepEqual(self.body.rejected, [{ collection: 'users', id: 'A', op: 'delete' }], 'nobody deletes their own account');
    });

    await step('a stale copy does not undo edits to other records, or bring deleted ones back', async () => {
      const a = await login('A'), b = await login('A2');
      await push(a, s => { s.courses.find(c => c.id === 'C1').title = 'Edited by A'; s.courses = s.courses.filter(c => c.id !== 'C2'); s.sessions = s.sessions.filter(x => x.courseId !== 'C2'); s.batches = s.batches.filter(x => x.courseId !== 'C2'); });
      const r = await push(b, s => { s.sessions.find(x => x.id === 'S1').title = 'Edited by B'; });
      assert.ok(!r.body.rejected); assert.equal(r.body.resync, true);
      const s = await row();
      assert.equal(s.courses.find(c => c.id === 'C1').title, 'Edited by A', "A's edit survives B's stale copy");
      assert.equal(s.sessions.find(x => x.id === 'S1').title, 'Edited by B', "B's own edit is saved");
      assert.ok(!has(s, 'courses', 'C2') && !has(s, 'sessions', 'S3') && !has(s, 'batches', 'B2'), 'what A deleted stays deleted');
    });

    await step("a refused or unproven course delete keeps the course's learner records", async () => {
      const cascade = s => { ['sessions', 'assignments', 'submissions', 'attendance', 'enrollments', 'batches'].forEach(k => { s[k] = s[k].filter(x => x.courseId !== 'C1'); }); s.courses = s.courses.filter(c => c.id !== 'C1'); };
      const r = await push(await login('A'), cascade, { base: false }); // an old browser: deletion not proven
      assert.equal(r.body.resync, true);
      let s = await row();
      for (const k of ['courses', 'sessions', 'batches', 'enrollments', 'assignments', 'submissions', 'attendance']) assert.deepEqual(s[k], baseState()[k], k + ' kept');
      const l = await push(await login('L'), cascade); // not allowed to delete
      assert.ok(l.body.rejected.some(x => x.id === 'C1' && x.op === 'delete'));
      s = await row();
      for (const k of ['enrollments', 'submissions', 'attendance']) assert.deepEqual(s[k], baseState()[k], k + ' kept');
      await push(await login('A'), cascade); // proven and allowed: the whole course goes
      s = await row();
      assert.ok(!has(s, 'courses', 'C1') && !s.submissions.length && !s.enrollments.length && !s.attendance.length);
    });

    // ---- D3: the other 11 protected collections over HTTP, with the real conditional save ----
    await step('D3: a learner cannot change fees, marks, certificates or attendance through the API', async () => {
      const over = { fees: [{ id: 'FE1', learnerId: 'L', courseId: 'C1', type: 'Course Fee', amount: 100, status: 'Pending' }], certificates: [] };
      await reset(over);
      const r = await push(await login('L'), s => { s.fees[0].status = 'Paid'; Object.assign(s.submissions[0], { grade: 20, status: 'Graded' }); s.certificates.push({ id: 'CX', code: 'FAKE-1', learnerId: 'L', courseId: 'C1', status: 'Valid' }); s.attendance = []; });
      assert.deepEqual(r.body.rejected.map(x => `${x.collection}:${x.id}`).sort(), ['attendance:AT1', 'certificates:CX', 'fees:FE1', 'submissions:SUB1']);
      const s = await row();
      for (const k of ['fees', 'submissions', 'attendance', 'certificates']) assert.deepEqual(s[k], baseState(over)[k], k + ' unchanged');
    });

    await step('D3: a learner, an instructor and the accounts office saving at the same moment all keep their work', async () => {
      await reset({ assignments: [...baseState().assignments, { id: 'AS2', courseId: 'C1', batchId: 'B1', title: 'Task 2', status: 'Published', maxMarks: 10 }], fees: [{ id: 'FE1', learnerId: 'L', courseId: 'C1', type: 'Course Fee', amount: 100, status: 'Pending' }] });
      const [l, t, a] = await Promise.all(['L', 'T', 'A'].map(login));
      const rs = await Promise.all([
        push(l, s => { s.submissions.push({ id: 'SUB2', learnerId: 'L', assignmentId: 'AS2', courseId: 'C1', status: 'Submitted', grade: null, feedback: '', history: [] }); }),
        push(t, s => { Object.assign(s.submissions.find(x => x.id === 'SUB1'), { grade: 18, status: 'Graded', feedback: 'Good' }); s.attendance.push({ id: 'AT2', sessionId: 'S2', courseId: 'C1', learnerId: 'L', status: 'Present' }); }),
        push(a, s => { Object.assign(s.fees[0], { status: 'Paid', paidOn: '2026-10-15' }); })
      ]);
      rs.forEach(r => assert.ok(r.status === 200 && !r.body.rejected, JSON.stringify(r.body)));
      const s = await row();
      assert.deepEqual([s.submissions.find(x => x.id === 'SUB1').grade, has(s, 'submissions', 'SUB2'), has(s, 'attendance', 'AT2'), s.fees[0].status], [18, true, true, 'Paid']);
    });

    await step('D3: two people issuing certificates at the same moment get different codes', async () => {
      await reset({ certificates: [] });
      const [a, b] = await Promise.all(['A', 'A2'].map(login));
      const cert = (id, learnerId) => s => { s.certificates.push({ id, code: 'CERT-2026-0001', learnerId, courseId: 'C1', status: 'Valid', issuedAt: '2026-10-15' }); };
      const rs = await Promise.all([push(a, cert('CT-A', 'L')), push(b, cert('CT-B', 'T'))]);
      rs.forEach(r => assert.equal(r.status, 200));
      assert.deepEqual((await row()).certificates.map(c => c.code).sort(), ['CERT-2026-0001', 'CERT-2026-0002']);
    });

    await step("D3: stale tabs: an instructor's old copy keeps the learner's upload, a learner's old tab cannot undo a grade", async () => {
      const t = await login('T'), lOld = await login('L');
      await push(await login('L'), s => { Object.assign(s.submissions[0], { fileName: 'v2.pdf', history: [{ fileName: 'v1.pdf' }] }); });
      const r = await push(t, s => { s.attendance[0].status = 'Late'; });
      assert.ok(!r.body.rejected, JSON.stringify(r.body));
      let s = await row();
      assert.deepEqual([s.submissions[0].fileName, s.attendance[0].status], ['v2.pdf', 'Late']);
      await push(await login('T'), x => { Object.assign(x.submissions[0], { grade: 17, status: 'Graded' }); });
      const old = await push(lOld, () => {}, { base: false }); // a tab opened before both changes, on an old app version
      assert.deepEqual(old.body.rejected.map(x => `${x.collection}:${x.id}:${x.op}`).sort(), ['attendance:AT1:edit', 'submissions:SUB1:edit'], 'its stale copies count as edits it may not make');
      s = await row();
      assert.deepEqual([s.submissions[0].grade, s.submissions[0].fileName, s.attendance[0].status], [17, 'v2.pdf', 'Late'], 'the grade, the upload and the attendance survive');
    });

    await step('AI requests for course generation need courses:create and the switch', async () => {
      const ai = (c, feature) => callApi('POST', '/api/ai/complete', { feature, prompt: 'hello' }, c.token);
      const l = await login('L'), t = await login('T'), a = await login('A');
      assert.equal((await ai(l, 'courseGenerate')).status, 403);
      assert.equal((await ai(t, 'courseGenerate')).status, 403, 'ai:use alone is not enough');
      assert.equal((await ai(a, 'courseGenerate')).status, 400, 'coordinator passes the guard (then: no provider configured)');
      assert.equal((await ai(l, 'tutor')).status, 400, 'other AI features are unchanged');
      assert.equal((await ai(l, 'courseContent')).status, 403, 'session content needs courses:edit');
      assert.equal((await ai(t, 'courseContent')).status, 400, 'an instructor who edits courses passes the guard (then: no provider configured)');
      assert.equal((await ai(a, 'courseContent')).status, 400);
      // YouTube videos for the Course Builder: the same guard; with no YouTube key the answer is "not configured"
      const vids = (c, feature) => callApi('POST', '/api/ai/videos', { feature, queries: ['excel pivot tables'] }, c.token);
      assert.equal((await vids(l, 'courseGenerate')).status, 403);
      assert.equal((await vids(t, 'courseGenerate')).status, 403, 'finding videos for a new course needs courses:create');
      assert.equal((await vids(l, 'courseContent')).status, 403);
      assert.deepEqual([(await vids(a, 'courseGenerate')).status, (await vids(a, 'courseGenerate')).body.code], [400, 'not_configured']);
      assert.equal((await vids(t, 'courseContent')).status, 400, 'an instructor who edits courses passes the guard');
      assert.equal((await vids(a, 'tutor')).status, 400, 'only the Course Builder features can search videos');
      assert.equal((await vids(a)).status, 400, 'a request without a feature is refused, not let through the guard');
      assert.equal((await callApi('POST', '/api/ai/youtube', { apiKey: 'AIzaTestOnly' }, l.token)).status, 403, 'only administrators set the YouTube key');
      assert.equal((await callApi('POST', '/api/ai/youtube', { apiKey: 'AIzaTestOnly' }, t.token)).status, 403);
      await reset({ settings: { features: { courseGen: false } } });
      assert.equal((await vids(await login('A'), 'courseGenerate')).status, 403, 'switch OFF: no video search either');
      assert.equal((await ai(await login('A'), 'courseGenerate')).status, 403, 'switch OFF');
      assert.equal((await ai(await login('A'), 'courseContent')).status, 403, 'switch OFF for content too');
    });

    await step('Google sign-in cannot be used locally', async () => {
      assert.equal((await callApi('POST', '/api/sdc/google', { accessToken: 'x' })).status, 401);
    });
  } finally {
    srv.close(); await rest.close();
  }
  return steps;
}
module.exports = { run };
