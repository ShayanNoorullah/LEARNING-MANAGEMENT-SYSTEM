/* P0 learner access in a real browser: real gateway (backend/state-api.js) over a uniquely named disposable
   LOCAL PostgreSQL database, real app pages. Never loads .env or backend/server.js; all non-loopback HTTP is
   blocked. Covers: enrolled vs unenrolled vs withdrawn learners, an approved hand-written lesson, no answer
   keys or staff data in the learner's browser, a quiz scored by the server, safe saves, staff access, and the
   other shared collections (accounts, messages, notifications, announcements, banks, practice, rubrics, at-risk flags).
   Run: node tests/learneraccess.browser.run.js (Playwright on NODE_PATH; local PG already running). */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const express = require('express'), { chromium } = require('playwright');
const pg = require('../scripts/localdb/pg'), { createRestServer } = require('../scripts/localdb/rest');
const root = path.join(__dirname, '..'), clone = v => JSON.parse(JSON.stringify(v));
const loopback = url => ['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname);
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DATABASE_URL', 'VERCEL', 'NODE_ENV', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'AZURE_OPENAI_API_KEY']) delete process.env[k];
const actualFetch = global.fetch;
global.fetch = (url, ...args) => { if (!loopback(String(url))) throw Error('Blocked external HTTP: ' + url); return actualFetch(url, ...args); };

const SECRETS = /"correct"|model answer text|kw-secret|STAFF PROMPT|mx-model|staff notes|C3 secret lesson|C3 question|Draft secret|QA Draft quiz|Draft quiz question|QA Evening quiz|Evening batch question|L2 private feedback|QA Draft task|QA Evening task|L2 absence note|L2 unpublished remark|L2 private comment|L2 fee ref|CERT-2026-0002|L2 private message|L2 grade notice|Staff memo|Bank secret|Rubric secret|Risk secret|qa-evening@|qa-withdrawn@|qa-teacher@|0300-555/;
const OTHERS = /"learnerId":"u-(l2|w)"/; // any record of another learner
const LESSON = { lesson: [{ heading: 'Hand written intro', body: 'Written by the instructor.' }], teacherNotes: ['staff notes'],
  meta: { approved: true, edited: { by: 'u-t', at: '2026-10-01T10:00:00Z', parts: ['lesson'] }, parts: { practice: { at: 't', provider: 'groq', model: 'mx-model', tokens: 77, instructions: 'STAFF PROMPT' } }, history: [{ id: 'h1' }] } };

(async () => {
  assert.ok(pg.available() && pg.up(), 'Requires existing local PostgreSQL; never starts or resets sdc_dev');
  const dbName = 'sdc_test_learner_' + crypto.randomBytes(6).toString('hex'), secret = crypto.randomBytes(24).toString('hex');
  let made = false, rest, server, browser;
  try {
    await pg.createDb(dbName); made = true;
    await pg.apply(dbName, pg.MIGRATIONS()); await pg.setSecret(dbName, secret);
    rest = await createRestServer((fn, args) => pg.callFn(dbName, fn, args));
    process.env.SDC_STATE_SECRET = secret; process.env.SUPABASE_URL = rest.url; process.env.SUPABASE_ANON_KEY = 'disposable-local-only';
    const gateway = require('../backend/state-api');
    const seed = vm.runInNewContext(fs.readFileSync(path.join(root, 'js/seed.js'), 'utf8') + ';SEED');
    for (const k of Object.keys(seed)) if (Array.isArray(seed[k]) && k !== 'roles') seed[k] = [];
    const user = (id, role, email) => ({ id, role, name: 'QA ' + id, email, status: 'Active', salt: 'qa-' + id, passwordHash: gateway._test.hashPassword('disposable-password', 'qa-' + id) });
    Object.assign(seed, {
      users: [user('u-a', 'admin', 'qa-admin@example.invalid'), { ...user('u-t', 'teacher', 'qa-teacher@example.invalid'), phone: '0300-5550000' }, user('u-l', 'student', 'qa-learner@example.invalid'), user('u-w', 'student', 'qa-withdrawn@example.invalid'), user('u-l2', 'student', 'qa-evening@example.invalid')],
      courses: [{ id: 'C1', title: 'QA Enrolled Course', slug: 'qa-1', status: 'published' }, { id: 'C3', title: 'QA Other Course', slug: 'qa-3', status: 'published' }, { id: 'C2', title: 'Draft secret course', slug: 'qa-2', status: 'draft' }],
      sessions: [{ id: 'S1', courseId: 'C1', title: 'QA Session One', order: 1, content: LESSON }, { id: 'S4', courseId: 'C3', title: 'Other lesson', order: 1, content: { lesson: [{ heading: 'C3 secret lesson' }], meta: { approved: true, parts: { lesson: { at: 't' } } } } }],
      batches: [{ id: 'B1', courseId: 'C1', name: 'QA-B1', instructorId: 'u-t', status: 'Active' }, { id: 'B1b', courseId: 'C1', name: 'QA-B1-evening', instructorId: 'u-t', status: 'Active' }, { id: 'B3', courseId: 'C3', name: 'QA-B3', instructorId: '', status: 'Active' }],
      enrollments: [{ id: 'E1', learnerId: 'u-l', courseId: 'C1', batchId: 'B1', status: 'Active' }, { id: 'E2', learnerId: 'u-w', courseId: 'C1', batchId: 'B1', status: 'Withdrawn' }, { id: 'E3', learnerId: 'u-l2', courseId: 'C1', batchId: 'B1b', status: 'Active' }],
      assignments: [{ id: 'AS1', courseId: 'C1', batchId: 'B1', title: 'QA Task', status: 'Published', maxMarks: 10, dueAt: '2099-01-01T10:00' },
        { id: 'ASD', courseId: 'C1', batchId: 'B1', title: 'QA Draft task', status: 'Draft', maxMarks: 10, dueAt: '2099-01-01T10:00' }, { id: 'ASE', courseId: 'C1', batchId: 'B1b', title: 'QA Evening task', status: 'Published', maxMarks: 10, dueAt: '2099-01-01T10:00' }],
      progress: [{ id: 'PR2', learnerId: 'u-l2', courseId: 'C1', completedSessionIds: ['S1'] }],
      attendance: [{ id: 'AT1', sessionId: 'S1', learnerId: 'u-l', courseId: 'C1', status: 'Present' }, { id: 'AT2', sessionId: 'S1', learnerId: 'u-l2', courseId: 'C1', status: 'Absent', notes: 'L2 absence note' }],
      results: [{ id: 'RL', learnerId: 'u-l', courseId: 'C1', finalPct: 87, grade: 'A', published: true }, { id: 'R2', learnerId: 'u-l2', courseId: 'C1', finalPct: 30, grade: 'F', remarks: 'L2 unpublished remark', published: false }],
      feedback: [{ id: 'FB2', learnerId: 'u-l2', courseId: 'C1', rating: 1, comment: 'L2 private comment', date: '2026-10-01' }],
      certificates: [{ id: 'CT1', code: 'CERT-2026-0001', learnerId: 'u-l', courseId: 'C1', status: 'Valid', issuedAt: '2026-10-01', issuedBy: 'u-a' }, { id: 'CT2', code: 'CERT-2026-0002', learnerId: 'u-l2', courseId: 'C1', status: 'Valid', issuedAt: '2026-10-02', issuedBy: 'u-a' }],
      fees: [{ id: 'FE1', learnerId: 'u-l', courseId: 'C1', type: 'Course Fee', amount: 100, status: 'Pending', dueDate: '2099-01-01' }, { id: 'FE2', learnerId: 'u-l2', courseId: 'C1', type: 'Course Fee', amount: 100, status: 'Overdue', reference: 'L2 fee ref', dueDate: '2026-01-01' }],
      submissions: [{ id: 'SB1', learnerId: 'u-l', assignmentId: 'AS1', courseId: 'C1', fileName: 'mine.pdf', status: 'Submitted', grade: null, feedback: '', history: [] },
        { id: 'SB2', learnerId: 'u-l2', assignmentId: 'AS1', courseId: 'C1', fileName: 'theirs.pdf', status: 'Graded', grade: 9, feedback: 'L2 private feedback', history: [] }],
      quizzes: [{ id: 'QZ1', courseId: 'C1', batchId: 'B1', title: 'QA Quiz', status: 'published', questionIds: ['Q1', 'Q2'], attemptLimit: 2 }, { id: 'QZ3', courseId: 'C3', batchId: 'B3', title: 'Other quiz', status: 'published', questionIds: ['Q9'] },
        { id: 'QZD', courseId: 'C1', batchId: 'B1', title: 'QA Draft quiz', status: 'draft', questionIds: ['QD'] }, { id: 'QZB', courseId: 'C1', batchId: 'B1b', title: 'QA Evening quiz', status: 'published', questionIds: ['QB'] }],
      questions: [{ id: 'Q1', courseId: 'C1', type: 'mcq_single', points: 1, stem: 'Pick A', options: [{ id: 'a', text: 'Option A', correct: true }, { id: 'b', text: 'Option B', correct: false }] },
        { id: 'Q2', courseId: 'C1', type: 'short', points: 2, stem: 'Explain', modelAnswer: 'model answer text', keywords: ['kw-secret'] },
        { id: 'Q9', courseId: 'C3', type: 'mcq_single', points: 1, stem: 'C3 question', options: [{ id: 'a', text: 'x', correct: true }] },
        { id: 'QD', courseId: 'C1', type: 'short', points: 1, stem: 'Draft quiz question' }, { id: 'QB', courseId: 'C1', type: 'short', points: 1, stem: 'Evening batch question' }],
      messages: [{ id: 'M1', from: 'u-t', to: 'u-l', subject: 'QA Welcome', body: 'Hello from your instructor', date: '2026-10-01T10:00:00Z', read: false },
        { id: 'M2', from: 'u-l2', to: 'u-t', subject: 'L2 private message', body: 'x', date: '2026-10-01T11:00:00Z', read: false }],
      notifications: [{ id: 'N1', userId: 'u-l', title: 'QA your grade is ready', message: 'ok', type: 'Grade', link: '', date: '2026-10-01T10:00:00Z', read: false },
        { id: 'N2', userId: 'u-l2', title: 'L2 grade notice', message: 'x', type: 'Grade', link: '', date: '2026-10-01T10:00:00Z', read: false }],
      announcements: [{ id: 'AN1', audience: 'learners', authorId: 'u-a', title: 'QA For learners', message: 'Welcome all', status: 'Published', date: '2026-10-01' },
        { id: 'AN2', audience: 'instructors', authorId: 'u-a', title: 'Staff memo', message: 'x', status: 'Published', date: '2026-10-01' }],
      questionBanks: [{ id: 'QB1', courseId: 'C1', title: 'Bank secret' }],
      practiceAttempts: [{ id: 'PA2', learnerId: 'u-l2', courseId: 'C1', sessionId: 'S1', score: 1, maxScore: 5, percent: 20, at: '2026-10-01T10:00:00Z' }],
      rubrics: [{ id: 'RB1', assignmentId: 'AS1', criteria: [{ criterion: 'Rubric secret', marks: 10 }] }],
      atRiskFlags: [{ id: 'AR1', learnerId: 'u-l', courseId: 'C1', level: 'High', factors: ['Risk secret'], status: 'Open', outreachNotes: [] }]
    });
    await pg.callFn(dbName, 'sdc_state_put_if', { p_secret: secret, p_state: seed, p_expected: null });
    const stored = async () => (await pg.callFn(dbName, 'sdc_state_get', { p_secret: secret })).state;
    const app = express(), blocked = [];
    app.get('/js/cloud-config.js', (req, res) => res.type('js').send('window.SDC_CLOUD_CONFIG=' + JSON.stringify({ enabled: true, url: rest.url, anonKey: 'disposable-local-only' })));
    app.use(gateway); app.use(express.static(root));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = 'http://127.0.0.1:' + server.address().port, errors = [];
    browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    // One browser profile per person, signed in through the real gateway login.
    const open = async email => {
      const context = await browser.newContext();
      await context.route('**/*', route => { const u = route.request().url(); if (/^https?:/.test(u) && !loopback(u)) { blocked.push(u); return route.abort(); } return route.continue(); });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(email + ': ' + e.message));
      await page.goto(url + '/login.html'); await page.waitForLoadState('networkidle');
      await page.evaluate(async email => { const r = await fetch('/api/sdc/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'disposable-password' }) }); const j = await r.json(); if (!r.ok) throw Error(JSON.stringify(j)); sessionStorage.setItem('sdcSession', j.userId); localStorage.setItem('sdcCloudToken', j.token); sessionStorage.setItem('sdcCloudToken', j.token); localStorage.setItem('sdcLearnDB_v1', JSON.stringify(j.state)); }, email);
      return page;
    };
    const go = async (page, hash) => { await page.goto(url + "/app.html#" + hash); await page.waitForFunction(() => typeof App !== "undefined" && !!App.user, null, { timeout: 15000 }).catch(async e => { throw Error(e.message + " errors=" + JSON.stringify(errors) + " url=" + page.url() + " body=" + (await page.evaluate(() => document.body.innerText.slice(0, 300)))); }); await page.evaluate(() => SDCCloud.ready); };
    // The learner's own graded attempt says which of their answers were right (detail.correct); that is their result, not the key.
    const local = page => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('sdcLearnDB_v1')); (s.quizAttempts || []).forEach(a => delete a.detail); return JSON.stringify(s); });

    // Enrolled learner: the approved hand-written lesson shows; the browser holds no keys or staff data.
    const l = await open('qa-learner@example.invalid');
    await go(l, '/course/C1/session/S1');
    await l.getByText('Hand written intro').waitFor();
    assert.ok(!SECRETS.test(await local(l)), 'learner localStorage: no answer keys, staff data, other-course, draft or other-batch content');
    assert.ok(!OTHERS.test(await local(l)), 'learner localStorage: no other learner\'s enrollments, submissions or attempts');
    // Quizzes: only the published quiz of their own batch is listed; the draft and the other batch's quiz are refused.
    await go(l, '/course/C1/quizzes'); await l.getByText('QA Quiz').waitFor();
    assert.ok(!/QA Draft quiz|QA Evening quiz/.test(await l.locator('#main').innerText()), 'no draft or other-batch quiz listed');
    for (const q of ['QZD', 'QZB']) { await go(l, '/course/C1/quiz/' + q); await l.getByText('Quiz not available', { exact: false }).waitFor(); }
    // Their own assignments, attendance, result, certificate and fees still show; nothing of others or of hidden work.
    const main = async (page, hash, text) => { await go(page, hash); await page.getByText(text, { exact: false }).first().waitFor(); return page.locator('#main').innerText(); };
    assert.ok(!/QA Draft task|QA Evening task/.test(await main(l, '/assignments', 'QA Task')), 'only the published assignment of their own batch');
    assert.ok(!/L2 absence note/.test(await main(l, '/attendance', 'QA Session One')), 'own attendance only');
    await main(l, '/results', '87%');
    assert.ok(!/CERT-2026-0002/.test(await main(l, '/certificates', 'CERT-2026-0001')), 'own certificate only');
    assert.ok(!/L2 fee ref/.test(await main(l, '/fees', '100')), 'own fees only');
    // Messages, notifications and announcements: their own, and messaging their instructor still works.
    assert.ok(!/L2 private message/.test(await main(l, '/messages', 'QA Welcome')), 'own messages only');
    await l.getByText('QA Welcome').first().click(); await l.getByText('Hello from your instructor').last().waitFor();
    await l.locator('[data-new]').click();
    const to = await l.locator('select[name="to"] option').allInnerTexts();
    assert.ok(to.some(x => x.startsWith('QA u-t')) && to.some(x => x.startsWith('QA u-a')) && !to.some(x => /u-l2|u-w/.test(x)), 'recipients: instructor and coordinator, no other learner ' + JSON.stringify(to));
    await l.locator('select[name="to"]').selectOption('u-t'); await l.locator('input[name="subject"]').fill('QA question'); await l.locator('textarea[name="body"]').fill('Can you help?');
    await l.locator('[data-send]').click(); await l.getByText('Message sent.').waitFor();
    assert.ok(!/L2 grade notice/.test(await main(l, '/notifications', 'QA your grade is ready')), 'own notifications only');
    assert.ok(!/Staff memo/.test(await main(l, '/announcements', 'QA For learners')), 'announcements for learners only');
    await l.evaluate(() => SDCCloud.flushNow());
    { const st = await stored(), sent = st.messages.find(m => m.subject === 'QA question');
      assert.deepEqual([st.messages[0].read, sent?.from, sent?.to, st.notifications.some(n => n.userId === 'u-t' && /New message/.test(n.title))], [true, 'u-l', 'u-t', true], 'read, sent and notified');
      for (const k of ['users', 'announcements', 'questionBanks', 'practiceAttempts', 'rubrics', 'atRiskFlags']) assert.deepEqual(st[k], seed[k], k + ': unchanged after the learner\'s saves');
      assert.deepEqual([st.messages.find(m => m.id === 'M2'), st.notifications.find(n => n.id === 'N2')], [seed.messages[1], seed.notifications[1]], 'the other learner\'s message and notification kept'); }
    // Unenrolled published course and the draft course: refused, nothing to show.
    await go(l, '/course/C3'); await l.getByText('You are not enrolled', { exact: false }).waitFor();
    await go(l, '/course/C3/session/S4'); await l.getByText('You are not enrolled', { exact: false }).waitFor();
    // Quiz without the key: the server scores it.
    await go(l, '/course/C1/quiz/QZ1');
    await l.locator('input[name="Q1"][value="a"]').check();
    await l.locator('textarea[name="Q2"]').fill('My own words');
    await l.getByRole('button', { name: /Submit/ }).click();
    await l.getByText('Your score appears in a moment', { exact: false }).waitFor();
    await l.evaluate(() => SDCCloud.flushNow());
    let s = await stored();
    const att = s.quizAttempts.find(a => a.learnerId === 'u-l');
    assert.deepEqual([att.score, att.maxScore, att.percent, att.pendingShort], [1, 3, 33, true], 'server-scored attempt ' + JSON.stringify(att));
    // Mark the lesson complete: an ordinary save keeps every hidden record and staff field.
    await go(l, '/course/C1/session/S1');
    await l.locator('[data-complete]').click();
    await l.evaluate(() => SDCCloud.flushNow());
    s = await stored();
    assert.deepEqual(s.progress.find(p => p.learnerId === 'u-l').completedSessionIds, ['S1'], 'progress saved');
    assert.deepEqual(s.progress.find(p => p.learnerId === 'u-l2'), seed.progress[0], 'the other learner\'s progress kept');
    for (const k of ['courses', 'sessions', 'quizzes', 'questions', 'enrollments', 'submissions', 'assignments', 'attendance', 'results', 'feedback', 'certificates', 'fees']) assert.deepEqual(s[k], seed[k], k + ': unchanged in PostgreSQL after learner saves');
    await l.evaluate(() => SDCCloud.pullNow?.());
    await go(l, '/course/C1/quizzes'); await l.getByText('Best: 33%').waitFor();
    { const ls = await local(l), m = SECRETS.exec(ls) || OTHERS.exec(ls); assert.ok(!m, 'still no secrets after the re-download: ' + (m && ls.slice(Math.max(0, m.index - 300), m.index + 200))); }

    // The evening-batch learner sees their own batch's quiz.
    const l2 = await open('qa-evening@example.invalid');
    await go(l2, '/course/C1/quizzes'); await l2.getByText('QA Evening quiz').waitFor();
    assert.ok(!/QA Draft quiz|>QA Quiz</.test(await l2.locator('#main').innerHTML()), 'evening learner: not the other batch\'s or the draft quiz');

    // Withdrawn learner: the course is refused and its lesson is not in the browser.
    const w = await open('qa-withdrawn@example.invalid');
    await go(w, '/course/C1/session/S1'); await w.getByText('You are not enrolled', { exact: false }).waitFor();
    { const ls = (await local(w)).split('qa-withdrawn@example.invalid').join(''); assert.ok(!/Hand written intro/.test(ls) && !SECRETS.test(ls), 'withdrawn learner holds no lesson, keys or other people\'s details'); }

    // Coordinator and instructor still see and manage everything they did before.
    for (const email of ['qa-admin@example.invalid', 'qa-teacher@example.invalid']) {
      const p = await open(email);
      await go(p, '/course/C1/session/S1');
      await p.getByText('Hand written intro').waitFor();
      await p.getByRole('link', { name: /Review and edit/ }).waitFor();
      const ls = await local(p);
      assert.ok(/model answer text/.test(ls) && /STAFF PROMPT/.test(ls) && /"correct":true/.test(ls), email + ': full questions and teaching content');
      assert.ok(['L2 private feedback', 'L2 absence note', 'L2 unpublished remark', 'L2 private comment', 'L2 fee ref', 'QA Draft task', 'QA Evening task'].concat(['L2 private message', 'Staff memo', 'Bank secret', 'Rubric secret', 'Risk secret', 'qa-evening@example.invalid', '0300-5550000']).every(x => ls.includes(x)), email + ': every learner\'s records, every assignment, accounts and staff tools');
      await go(p, '/course/C1/quizzes');
      for (const title of ['QA Quiz', 'QA Draft quiz', 'QA Evening quiz']) await p.getByText(title, { exact: true }).first().waitFor();
    }
    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log('PASS learner access browser: enrolled lesson shown (hand-written, approved), unenrolled and withdrawn refused, no keys, staff data, other learners\' records (enrollments, submissions, attempts, progress, attendance, results, feedback, certificates, fees), draft or other-batch quizzes and assignments, other accounts\' contact details, other people\'s messages, notifications or practice, staff announcements, banks, rubrics or at-risk flags in the learner browser, own assignments, attendance, result, certificate, fees, messages (read, sent to the instructor), notifications and announcements shown, quiz scored by the server (33%), saves kept all hidden records, coordinator and instructor unchanged.');
    console.log('Isolated database: ' + dbName + '; blocked external browser requests: ' + blocked.length);
  } finally {
    if (browser) await browser.close(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } if (rest) { rest.server.closeAllConnections(); await rest.close(); }
    // Only this invocation's newly created random database is disposable. No existing DB is dropped.
    if (made) { await pg.dropDb(dbName); console.log('Removed this run\'s disposable database: ' + dbName); }
    global.fetch = actualFetch;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
