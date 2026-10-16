/* AI course generator at scale (8, 24 and 48 sessions), simulated: outline -> draft records -> full content
   (the real browser runner TCRun from js/pages-coursecontent.js, in a sandbox) -> completeness -> course check.
   The AI is a stub that answers with realistically sized content and fails on purpose (busy, cut-off,
   unreadable, time-out, daily quota); storage is in memory. Nothing here reaches the network. Run: npm test */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const CG = require('../js/coursegen-logic.js'), CC = require('../js/coursecontent-logic.js');
const clone = v => JSON.parse(JSON.stringify(v));
const kb = n => Math.round(n / 1024);

// Realistic answers: about the size of the generated courses so far (20-38 KB per session).
const words = (n, w) => Array.from({ length: n }, (_, i) => `${w}${i % 7 ? '' : '.'}`).join(' ');
const code = n => '```javascript\n' + Array.from({ length: n }, (_, i) => `const value${i} = compute(${i});`).join('\n') + '\n```';
const PART = {
  lesson: s => ({ objectives: ['Explain ' + s, 'Build ' + s, 'Debug ' + s, 'Apply ' + s], prerequisites: ['The previous session'],
    timePlan: [{ minutes: 15, activity: 'Introduction' }, { minutes: 35, activity: 'Concepts' }, { minutes: 10, activity: 'Break' }, { minutes: 40, activity: 'Guided practice' }, { minutes: 30, activity: 'Wrap-up' }], // 130: fitted to 120
    lesson: [1, 2, 3, 4, 5].map(i => ({ heading: `${s}: part ${i}`, body: words(230, 'explain'), example: `Worked example ${i}:\n\n${code(14)}` })),
    keyTerms: Array.from({ length: 8 }, (_, i) => ({ term: 'Term ' + i, meaning: words(14, 'means') })) }),
  practice: s => ({ codeRelevant: true,
    tutorials: [{ title: 'Tutorial: ' + s, goal: words(20, 'goal'), steps: Array.from({ length: 8 }, (_, i) => `Step ${i + 1}: ${words(25, 'do')}\n${code(4)}`) }],
    codeExamples: [1, 2, 3].map(i => ({ title: `Example ${i}`, language: 'javascript', code: Array.from({ length: 30 }, (_, j) => `app.get('/r${j}', (req, res) => res.json({ ok: ${j} }));`).join('\n'), explanation: words(60, 'because') })),
    demos: [{ title: 'Demo', description: words(60, 'show'), steps: ['a', 'b', 'c', 'd'] }],
    guided: [1, 2].map(i => ({ title: 'Guided ' + i, instructions: words(50, 'do'), steps: ['a', 'b', 'c'], hint: words(20, 'hint'), solution: code(25) })),
    practice: [1, 2].map(i => ({ title: 'Task ' + i, task: words(60, 'build'), criteria: ['works', 'tested', 'clean'] })) }),
  assess: s => ({ homework: { title: 'Homework ' + s, brief: words(120, 'brief'), deliverables: ['index.js', 'README.md'], rubric: [{ criterion: 'Works', marks: 60 }, { criterion: 'Clean', marks: 40 }], maxMarks: 100, estimatedHours: 3 },
    quiz: Array.from({ length: 7 }, (_, i) => ({ question: `Q${i} about ${s}?`, options: ['A', 'B', 'C', 'D'], answer: i % 4, explanation: words(25, 'since') })),
    teacherNotes: Array.from({ length: 6 }, () => words(45, 'note')), resources: [{ title: 'MDN Web Docs', type: 'official documentation', note: 'Reference' }] })
};
const kindOf = sys => (/Write the LESSON part/.test(sys) ? 'lesson' : /Write the PRACTICE part/.test(sys) ? 'practice' : /Write the ASSESSMENT part/.test(sys) ? 'assess' : 'review');
const sessionNo = prompt => Number((/THIS SESSION: number (\d+) of/.exec(prompt) || [])[1]);

// The real runner in a sandbox: an in-memory store, timers that fire at once, and a stub SDCAI.call.
function sandbox(store, ai) {
  const now = () => new Date().toISOString();
  const box = {
    CourseContentLogic: CC, console, Map, Set, Promise, Date, JSON, Math, Number, String, Object, Array, Error,
    setTimeout: fn => setImmediate(fn), clearTimeout() {}, window: { addEventListener() {} },
    sessionStorage: { getItem: () => null, setItem() {} }, t: x => x, esc: x => String(x), icon: () => '', badge: x => x,
    findRecord: (k, id) => store[k].find(r => r.id === id),
    updateRecord: (k, id, patch) => {
      const i = store[k].findIndex(r => r.id === id); if (i < 0) throw new Error('Record not found');
      const next = { ...store[k][i], ...patch, id, updatedAt: now() };
      if (store.quotaBytes && JSON.stringify({ ...store, [k]: store[k].map((r, j) => (j === i ? next : r)) }).length > store.quotaBytes) throw new Error('Browser storage is full.');
      store[k][i] = next; store.saves++; return next;
    },
    Domain: { courseSessions: id => store.sessions.filter(s => s.courseId === id).sort((a, b) => a.order - b.order) },
    SDCAI: { call: (feature, o) => ai(o) }
  };
  vm.createContext(box);
  require('./support/provider-box')(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'pages-coursecontent.js'), 'utf8') + '\n;this.TCRun = TCRun;', box);
  return box.TCRun;
}
const finished = (TCRun, courseId) => new Promise(res => { const off = TCRun.on(r => { if (r.courseId === courseId && !r.active) { off(); res(r); } }); });
const jobsFor = (sessions, filter = () => true) => sessions.map(s => { const st = CC.sessionState(s); return { sessionId: s.id, parts: CC.PARTS.filter(p => (st.missing.includes(p) || st.outdated.includes(p)) && filter(s, p)) }; }).filter(j => j.parts.length);

(async () => {
  const report = [];
  for (const N of [8, 24, 48]) {
    const t0 = Date.now();
    /* ---------------------------------------------- outline and draft records */
    const brief = { topic: `Scale test ${N}`, audience: 'Testers', level: 'Beginner', programType: 'Short Course', delivery: 'Online', weeks: N / 2, perWeek: 2, hours: 2 };
    const bc = CG.briefCheck(brief);
    assert.deepEqual([bc.ok, bc.sessions], [true, N]);
    const msg = CG.buildMessages(brief);
    assert.ok(CG.tokenBudget(N) <= 8000, 'the outline answer stays under the cap');
    const norm = CG.normalize(CG.mockOutline(msg.prompt));
    assert.ok(!norm.error, norm.error);
    assert.equal(CG.countSessions(norm.outline), N); assert.ok(norm.outline.modules.length <= CG.LIMITS.modules);
    const genId = crypto.randomUUID(), at = new Date().toISOString();
    const rec = CG.build({ genId, outline: { ...norm.outline, hoursPerSession: 2 }, userId: 'u-admin', ownBatch: false, now: at });
    assert.equal(rec.sessions.length, N); assert.equal(rec.course.status, 'draft');
    assert.deepEqual(CG.build({ genId, outline: { ...norm.outline, hoursPerSession: 2 }, userId: 'u-admin', ownBatch: false, now: at }).sessions.map(s => s.id), rec.sessions.map(s => s.id), 'the same draft always gets the same ids (no duplicates on retry)');
    const store = { courses: [rec.course], sessions: rec.sessions.map(s => ({ ...s, duration: s.duration || '2h' })), saves: 0 };
    const course = store.courses[0], list = () => store.sessions;

    /* ------------------- full content: failures, an interruption and the resume */
    const calls = [], seen = new Map(); let inFlight = 0, maxInFlight = 0, n = 0;
    const plan = new Map(); // call number -> failure
    [[3, 'busy'], [7, 'truncated'], [11, 'badjson'], [15, 'timeout'], [19, 'provider']].forEach(([k, f]) => plan.set(k, f));
    const ai = async o => {
      const k = ++n, kind = kindOf(o.system), s = sessionNo(o.prompt);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setImmediate(r));
      inFlight--; calls.push(`${kind}#${s}`);
      const f = plan.get(k);
      if (f === 'busy') throw Object.assign(new Error('busy'), { code: 'provider_busy', retryAfterMs: 6000 });
      if (f === 'timeout') throw Object.assign(new Error('slow'), { code: 'timeout', status: 504 });
      if (f === 'provider') throw Object.assign(new Error('500'), { code: 'provider', status: 502 });
      if (f === 'quota') throw Object.assign(new Error('quota'), { code: 'provider_quota' });
      const value = PART[kind](`session ${s}`);
      if (f !== 'badjson' && f !== 'truncated') seen.set(`${kind}#${s}`, (seen.get(`${kind}#${s}`) || 0) + 1);
      return { text: f === 'badjson' ? 'not json' : JSON.stringify(value), truncated: f === 'truncated', provider: 'stub', model: 'stub-model', tokens: 1000 };
    };
    const TCRun = sandbox(store, ai);
    // Interrupted: the run is stopped once a third of the parts are saved (like closing the tab).
    let run = TCRun.start(course.id, jobsFor(list()));
    assert.equal(run.total, 3 * N);
    const stopAt = Math.ceil(N);
    const offStop = TCRun.on(r => { if (r.done >= stopAt && !r.stop) TCRun.stop(course.id); });
    run = await finished(TCRun, course.id); offStop();
    const savedParts = list().reduce((k, s) => k + CC.sessionState(s).done.length, 0);
    assert.ok(savedParts > 0 && savedParts < 3 * N, `the stop left part of the course (${savedParts} of ${3 * N} parts)`);
    assert.ok(maxInFlight <= 2, 'never more than two requests at once');
    const before = clone(list());
    // A person edits a finished session while the rest is generated: the edit is kept.
    const editedS = list().find(s => CC.sessionState(s).done.includes('lesson'));
    store.sessions[store.sessions.indexOf(editedS)].content = CC.applyEdit(editedS.content, { objectives: ['EDITED objective one', 'EDITED objective two'] }, 'u-admin', at).content;
    // Resume: only what is missing is asked for.
    const resumeJobs = jobsFor(list());
    const missingParts = resumeJobs.reduce((k, j) => k + j.parts.length, 0);
    assert.equal(missingParts, 3 * N - savedParts, 'the resume asks only for the missing parts');
    const callsBefore = calls.length;
    run = await (TCRun.start(course.id, resumeJobs), finished(TCRun, course.id));
    // Sessions whose lesson failed twice stay incomplete; a second resume finishes them.
    let rounds = 1;
    while (list().some(s => CC.sessionState(s).status !== 'complete') && rounds < 4) { rounds++; await (TCRun.start(course.id, jobsFor(list())), finished(TCRun, course.id)); }
    assert.ok(list().every(s => CC.sessionState(s).status === 'complete'), 'every session complete after resuming');
    for (const [key, k] of seen) assert.equal(k, 1, `${key} was generated once, not again on resume`);
    assert.equal(seen.size, 3 * N);
    before.forEach(b => { const s = list().find(x => x.id === b.id); CC.PARTS.filter(p => b.content?.meta?.parts?.[p]).forEach(p => assert.equal(s.content.meta.parts[p].at, b.content.meta.parts[p].at, 'saved parts are not regenerated')); });
    assert.deepEqual(list().find(s => s.id === editedS.id).content.objectives, ['EDITED objective one', 'EDITED objective two'], "a person's edit made during the run is kept");
    assert.ok(list().every(s => CC.planMinutes(s.content) === 120), 'every time plan fitted to the session length');
    assert.ok(maxInFlight <= 2);

    /* -------------------------------------------- completeness and course check */
    let chk = CC.courseChecks(course, list());
    assert.equal(chk.total, 13 * N + 4, '13 items per session + 4 for the course');
    assert.deepEqual(chk.course.filter(x => !x.ok).map(x => x.key), ['capstone', 'review', 'gaps']);
    const rv = CC.buildReviewMessages(course, list());
    const reviewAnswer = { coverage: course.outcomes.map((_, i) => ({ outcome: i + 1, sessions: [1 + (i % N), N], strength: 'strong' })), missingTopics: [], duplicates: [], progression: [], proposals: [],
      capstone: { title: 'Capstone', brief: 'Build it.', requirements: ['r'], deliverables: ['d'], milestones: Array.from({ length: 12 }, (_, i) => ({ session: Math.min(N, (i + 1) * 4), task: 't' })), rubric: [{ criterion: 'Works', marks: 100 }], maxMarks: 100 } };
    const r = await CC.generateReview(async () => ({ text: JSON.stringify(reviewAnswer), provider: 'stub', model: 'stub-model', tokens: 3000 }), course, list());
    assert.ok(r.ok, r.message);
    course.aiContent = CC.applyReview(course.aiContent, r.value, r.meta, { at, by: 'u-admin', stamp: CC.reviewStamp(course, list()), basedOn: 'content' });
    chk = CC.courseChecks(course, list());
    assert.equal(chk.ok, chk.total, `${chk.ok}/${chk.total}: complete after the course check`);

    /* ------------------------------------------------------------------- size */
    const bytes = Buffer.byteLength(JSON.stringify({ course, sessions: list() }));
    assert.ok(bytes < 10 * 1024 * 1024, 'the course fits the server request limit (10 MB) with room for the rest of the LMS');
    report.push(`${N} sessions: ${3 * N} parts, ${calls.length} AI requests (${calls.length - 3 * N} failed or repeated), stopped at ${savedParts} saved parts and resumed in ${rounds} round(s), ` +
      `${store.saves} saves, completeness ${chk.ok}/${chk.total}, stored size ${kb(bytes)} KB (${kb(bytes / N)} KB per session), course-check prompt ${Math.round(rv.prompt.length / 1000)}k characters, ${Date.now() - t0} ms`);
  }

  /* ----------------------------- failure recovery: daily quota and full storage */
  {
    const genId = crypto.randomUUID(), at = new Date().toISOString();
    const out = CG.normalize(CG.mockOutline(CG.buildMessages({ topic: 'Quota', audience: 'x', level: 'Beginner', programType: 'Short Course', delivery: 'Online', weeks: 3, perWeek: 2, hours: 2 }).prompt)).outline;
    const rec = CG.build({ genId, outline: { ...out, hoursPerSession: 2 }, userId: 'u', ownBatch: false, now: at });
    const store = { courses: [rec.course], sessions: rec.sessions, saves: 0 };
    let k = 0;
    const TCRun = sandbox(store, async o => { k++; if (k === 4) throw Object.assign(new Error('Daily quota used up.'), { code: 'provider_quota' }); return { text: JSON.stringify(PART[kindOf(o.system)]('s')), provider: 'stub', model: 'm', tokens: 1 }; });
    const run = await (TCRun.start(rec.course.id, jobsFor(store.sessions)), finished(TCRun, rec.course.id));
    assert.match(run.fatal, /Daily quota/, 'a used-up quota stops the whole run with its message');
    assert.ok(k <= 5, `no further requests after the quota error (${k})`);
    const done = store.sessions.reduce((n, s) => n + CC.sessionState(s).done.length, 0);
    assert.equal(done, k - 1, 'every answer that arrived (including one already in flight) is kept');
    // Browser storage full: the part fails with a clear message and nothing half-written is kept.
    const store2 = { courses: [rec.course], sessions: clone(rec.sessions), saves: 0 };
    store2.quotaBytes = JSON.stringify(store2).length + 60000; // room for about two parts
    let k2 = 0;
    const TC2 = sandbox(store2, async o => (k2++, { text: JSON.stringify(PART[kindOf(o.system)]('s')), provider: 'stub', model: 'm', tokens: 1 }));
    const run2 = await (TC2.start(rec.course.id, jobsFor(store2.sessions)), finished(TC2, rec.course.id));
    assert.ok(run2.jobs.some(j => j.errors.some(e => e.code === 'save' && /storage is full/.test(e.message))), 'a full browser storage is reported per part');
    const stored2 = store2.sessions.reduce((n, s) => n + CC.sessionState(s).done.length, 0);
    assert.ok(run2.fatal && /Could not store this in the browser/.test(run2.fatal), 'the first part that cannot be stored stops the whole run, with a message that says what to do');
    assert.ok(k2 <= stored2 + 3, `no more AI requests are spent once storage is full (${k2} requests, ${stored2} parts stored)`);
    assert.ok(k2 < 3 * store2.sessions.length, 'the run did not go on through the whole course');
    store2.sessions.forEach(s => { if (s.content) assert.ok(CC.PARTS.filter(p => s.content.meta?.parts?.[p]).every(p => CC.present(CC.FIELDS_OF(p).find(f => CC.SCHEMA[f].need), s.content)), 'saved parts are whole'); });
  }

  /* ------------------------------------------- limits around the largest course */
  const big = CG.briefCheck({ topic: 'x', audience: 'y', level: 'Beginner', programType: 'Short Course', delivery: 'Online', weeks: 25, perWeek: 2, hours: 2 });
  assert.equal(big.ok, false, '50 sessions are refused before any AI request');
  // The largest possible answers (every part at its token cap, about 4 characters a token) for 48 sessions.
  const worst = 48 * (CC.PART_TOKENS.lesson + CC.PART_TOKENS.practice + CC.PART_TOKENS.assess) * 4;
  report.push(`worst case: 48 sessions with every part at its token cap is about ${kb(worst)} KB of content`);
  assert.ok(worst < 10 * 1024 * 1024);

  report.forEach(l => console.log('  ' + l));
  console.log('coursescale.test.js: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
