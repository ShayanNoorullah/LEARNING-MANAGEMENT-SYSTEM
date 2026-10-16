/* AI course content builder: the pure rules in js/coursecontent-logic.js (schema checks, link removal,
   retries, merging generated parts with a person's edits, completeness, the course check, blueprints).
   The AI is stubbed: nothing here reaches the network. Run: npm test */
const assert = require('assert');
const CC = require('../js/coursecontent-logic.js');
const clone = v => JSON.parse(JSON.stringify(v));

const long = (n = 260) => 'Explanation of the idea with a realistic workplace case. '.repeat(Math.ceil(n / 55)).slice(0, n);
const LESSON = {
  objectives: ['Build a semantic HTML page', 'Explain the role of headings', 'Validate markup with the browser tools'],
  prerequisites: ['A computer with a code editor installed'],
  timePlan: [{ minutes: 15, activity: 'Warm-up' }, { minutes: 45, activity: 'Lesson' }, { minutes: 10, activity: 'Break' }, { minutes: 50, activity: 'Lab' }],
  lesson: [1, 2, 3, 4].map(i => ({ heading: `Section ${i}`, body: long(), example: '```html\n<a href="https://example.com/docs">x</a>\n```' })),
  keyTerms: [{ term: 'Element', meaning: 'A part of the page' }],
  extra: 'dropped'
};
const PRACTICE = {
  codeRelevant: true,
  tutorials: [{ title: 'First page', goal: 'Make a page', steps: ['Open the editor', 'Create `index.html`', 'Add a heading'] }],
  codeExamples: [{ title: 'Skeleton', language: 'html', code: '<!doctype html>\n<html>\n  <body>https://cdn.example.net/x.js</body>\n</html>\n', explanation: 'The minimum page.' }],
  demos: [{ title: 'DevTools', description: 'Inspect the page.', steps: ['Open', 'Inspect', 'Edit'] }],
  guided: [{ title: 'Add a list', instructions: 'Add a list.', steps: ['a', 'b', 'c'], hint: 'Use ul', solution: '<ul><li>x</li></ul>' }],
  practice: [{ title: 'Profile page', task: 'Build your profile page.', criteria: ['Valid HTML'] }]
};
const QUIZ = n => Array.from({ length: n }, (_, i) => ({ question: `Q${i + 1}?`, options: ['a', 'b', 'c', 'd'], answer: i % 4, explanation: 'Because.' }));
const ASSESS = {
  homework: { title: 'Portfolio page', brief: 'Build a one-page portfolio.', deliverables: ['index.html'], rubric: [{ criterion: 'Semantics', marks: 6 }, { criterion: 'Validity', marks: 4 }], maxMarks: 99, estimatedHours: 2 },
  quiz: [...QUIZ(6), { question: 'Broken', options: ['only one'], answer: 0 }, { question: 'Out of range', options: ['a', 'b'], answer: 5 }],
  teacherNotes: ['Check that every learner has an editor installed.', 'Common mistake: forgetting the closing tag.'],
  resources: [{ title: 'MDN Web Docs: HTML basics https://developer.mozilla.org/en-US/docs/Learn', type: 'official documentation', note: 'See www.w3schools.com too' }]
};
const reply = (o, extra = {}) => ({ text: JSON.stringify(o), provider: 'gemini', model: 'gemini-2.5-flash', tokens: 1000, truncated: false, ...extra });
const fail = (code, message = code) => Object.assign(new Error(message), { code });

(async () => {
  /* --------------------------------------------------------- the schema */
  let n = CC.normalizePart('lesson', LESSON);
  assert.ok(!n.error, n.error);
  assert.equal(n.value.extra, undefined, 'unknown fields are dropped');
  assert.equal(n.value.lesson.length, 4);
  assert.match(n.value.lesson[0].example, /https:\/\/example\.com\/docs/, 'links inside code are kept');
  assert.equal(CC.normalizePart('lesson', { ...LESSON, lesson: LESSON.lesson.slice(0, 2) }).error.includes('lesson content'), true, 'fewer than 3 real sections is refused');
  assert.match(CC.normalizePart('lesson', { ...LESSON, objectives: [] }).error, /learning objectives/);
  assert.equal(CC.normalizePart('lesson', [1, 2]).error, 'The AI answer was not the expected content.');
  const huge = CC.normalizePart('lesson', { ...LESSON, objectives: Array(50).fill('Build x'), lesson: LESSON.lesson.map(x => ({ ...x, body: 'y'.repeat(90000) })) }).value;
  assert.equal(huge.objectives.length, 8, 'lists are bounded');
  assert.equal(huge.lesson[0].body.length, 5000, 'text is bounded');

  n = CC.normalizePart('practice', PRACTICE);
  assert.ok(!n.error, n.error);
  assert.match(n.value.codeExamples[0].code, /^<!doctype html>\n<html>\n {2}<body>https:\/\/cdn\.example\.net\/x\.js<\/body>/, 'code is kept exactly, links included');
  assert.equal(CC.normalizePart('practice', { ...PRACTICE, codeRelevant: undefined }).value.codeRelevant, true, 'codeRelevant follows the examples when missing');
  assert.match(CC.normalizePart('practice', { ...PRACTICE, tutorials: [{ title: 'x', steps: ['one'] }] }).error, /tutorials/, 'a tutorial needs 3+ steps');

  n = CC.normalizePart('assess', ASSESS);
  assert.ok(!n.error, n.error);
  assert.equal(n.value.quiz.length, 6, 'unusable quiz items are removed');
  assert.equal(n.value.homework.maxMarks, 10, 'the maximum is the sum of the rubric');
  assert.equal(n.value.resources[0].title, 'MDN Web Docs: HTML basics', 'links are removed from resources');
  assert.ok(!/www\./.test(n.value.resources[0].note));
  assert.equal(n.linksRemoved, 2);
  assert.match(CC.normalizePart('assess', { ...ASSESS, quiz: QUIZ(2) }).error, /quiz/);
  assert.equal(CC.normalizePart('assess', { ...ASSESS, quiz: [{ ...QUIZ(1)[0], answer: '2' }, ...QUIZ(3)] }).value.quiz[0].answer, 2, 'numbers as text are read');
  assert.match(CC.normalizePart('lesson', { ...LESSON, lesson: [{ heading: 'See https://evil.example.org.attacker.io/x', body: long(), example: 'e' }, ...LESSON.lesson] }).value.lesson[0].heading, /^See$/, 'look-alike example domains are not kept');
  // Regression: removing links once also removed every "()" and collapsed indentation, so code written
  // without a fence lost its calls (`express()` -> `express`, `() => {` -> `=> {`).
  const UNFENCED = "const app = express();\napp.use(express.json());\napp.listen(PORT, () => {\n  console.log('up');\n});\nplt.show()";
  const g = CC.normalizePart('practice', { ...PRACTICE, guided: [{ title: 'Server', instructions: 'Call fetch() and df.head() here.', steps: ['Run app.listen()'], solution: UNFENCED }] }).value.guided[0];
  assert.equal(g.solution, '```javascript\n' + UNFENCED + '\n```', 'code without a fence keeps its calls and indentation, and gets a code block');
  assert.equal(g.instructions, 'Call fetch() and df.head() here.');
  assert.deepEqual(g.steps, ['Run app.listen()']);
  const tidy = CC.normalizePart('assess', { ...ASSESS, resources: [{ title: 'Express guide (https://expressjs.com/en/guide)', type: 'docs', note: 'Read https://a.io/x then call app.get() twice' }] });
  assert.equal(tidy.value.resources[0].title, 'Express guide', 'a link in brackets goes with its brackets');
  assert.equal(tidy.value.resources[0].note, 'Read then call app.get() twice', 'only the gap left by a link is tidied');
  assert.equal(CC.applyEdit({}, { guided: [{ title: 'x', solution: UNFENCED }] }, 'u1', 't').content.guided[0].solution, '```javascript\n' + UNFENCED + '\n```', "a person's edit keeps the code too");
  // Python: nested blocks, chained calls and empty parameter lists survive, with or without a fence.
  const PY = "import pandas as pd\n\ndef clean(df):\n    if df.empty:\n        return df\n    df = df.drop_duplicates()\n    return df.fillna(df.mean()).reset_index()\n\nprint(clean(pd.DataFrame()).isnull().sum().sum())\nplt.tight_layout()\nplt.show()";
  const FENCED = '```python\n' + PY + '\n```';
  for (const solution of [PY, FENCED, 'Run it:\n' + FENCED + '\nThen read https://pandas.pydata.org/docs and compare.']) {
    const kept = CC.normalizePart('practice', { ...PRACTICE, guided: [{ title: 'Clean', instructions: 'Use df.info() first.', steps: ['Call plt.show()'], solution }] }).value.guided[0];
    assert.ok(kept.solution.includes(PY), 'Python keeps its indentation, brackets and chained calls');
    assert.equal(kept.instructions, 'Use df.info() first.');
    assert.equal(CC.applyEdit({ guided: [{ title: 'Clean', solution: 'old' }] }, { guided: [{ title: 'Clean', solution }] }, 'u1', 't').content.guided[0].solution.includes(PY), true, "a person's edit keeps it");
  }
  assert.ok(!/pandas\.pydata/.test(CC.normalizePart('practice', { ...PRACTICE, guided: [{ title: 'Clean', instructions: 'x', steps: ['y'], solution: 'Run it:\n' + FENCED + '\nThen read https://pandas.pydata.org/docs and compare.' }] }).value.guided[0].solution), 'a link beside the code is still removed');

  /* ------------------------------------------------------- durations */
  assert.deepEqual(['2h', '1.5 h', '90m', '1h 30m', '2 hours', '45', '3', '', 'x'].map(CC.minutesOf), [120, 90, 90, 90, 120, 45, 180, 0, 0]);

  /* --------------------------------------------------------- prompts */
  const course = { id: 'C1', title: 'Full Stack Web Development', code: 'FSWD-101', level: 'Beginner', description: 'A course.', outcomes: ['Build pages', 'Build APIs'], aiMeta: { coverage: [[1], [2]] } };
  const sessions = [{ id: 'S1', courseId: 'C1', title: 'HTML', summary: 'Pages', moduleName: 'Front', duration: '2h', order: 1 }, { id: 'S2', courseId: 'C1', title: 'APIs', summary: 'Express', moduleName: 'Back', duration: '2h', order: 2 }];
  let m = CC.buildMessages('lesson', { course, sessions, session: sessions[1], coverage: [2], instructions: 'Add a database section.', prevObjectives: ['Build a page'] });
  assert.match(m.system, /add up to exactly 120/);
  assert.match(m.system, /Do not write any URL/);
  assert.match(m.prompt, /THIS SESSION: number 2 of 2: "APIs"/);
  assert.match(m.prompt, /2\. APIs \[Back\] — Express {3}<== THIS SESSION/);
  assert.match(m.prompt, /last session of the course/);
  assert.match(m.prompt, /Instructions from the course coordinator for this session: Add a database section\./);
  assert.match(m.prompt, /previous session's objectives.*Build a page/);
  assert.equal(m.maxTokens, CC.PART_TOKENS.lesson);
  m = CC.buildMessages('assess', { course, sessions, session: sessions[0], earlier: { objectives: ['Build x'], lesson: [{ heading: 'Tags' }], codeExamples: [{ title: 'Skeleton' }] } });
  assert.match(m.prompt, /Already written for this session/); assert.match(m.prompt, /Code examples: Skeleton/);
  assert.ok(Object.values(CC.PART_TOKENS).every(x => x <= 8000), 'every part fits under the server cap');

  /* ----------------------------------------------- generate with retries */
  const ctx = { course, sessions, session: sessions[0] };
  let seen = [];
  const stub = answers => async o => { seen.push(o); const a = answers.shift(); if (a instanceof Error) throw a; return a; };
  seen = [];
  let r = await CC.generatePart(stub([reply(LESSON, { truncated: true }), reply(LESSON)]), 'lesson', ctx);
  assert.equal(r.ok, true); assert.equal(r.meta.calls, 2); assert.equal(r.meta.tokens, 2000, 'tokens of every attempt are counted');
  assert.equal(seen[0].json, true); assert.ok(!/too long/.test(seen[0].prompt)); assert.match(seen[1].prompt, /previous answer was too long/, 'the retry asks for a shorter answer');
  r = await CC.generatePart(stub([fail('timeout'), reply(PRACTICE)]), 'practice', ctx);
  assert.equal(r.ok, true, 'one retry after a time-out');
  r = await CC.generatePart(stub([fail('rate_limit'), reply(LESSON)]), 'lesson', ctx);
  assert.deepEqual([r.ok, r.code, r.calls], [false, 'rate_limit', 1], 'limits are never retried');
  // the provider's per-minute limit: wait as asked, without using up the retry
  const busy = (ms = 59000) => Object.assign(fail('provider_busy', 'Gemini is limiting how many requests it accepts per minute.'), { retryAfterMs: ms });
  const waited = [], slept = [];
  r = await CC.generatePart(stub([busy(), busy(2000), reply({ objectives: [] }), reply(LESSON)]), 'lesson', ctx, { sleep: async ms => slept.push(ms), onWait: ms => waited.push(ms) });
  assert.equal(r.ok, true, 'two waits, then a bad answer and its one retry');
  assert.deepEqual(waited, [59000, 5000], 'waits as long as asked (at least 5 s)'); assert.equal(r.meta.calls, 4);
  r = await CC.generatePart(stub(Array(10).fill(0).map(() => busy(1))), 'lesson', ctx, { sleep: async () => {} });
  assert.deepEqual([r.ok, r.code, r.calls], [false, 'provider_busy', 7], 'gives up after 6 waits');
  r = await CC.generatePart(stub([fail('provider_quota'), reply(LESSON)]), 'lesson', ctx);
  assert.deepEqual([r.ok, r.code, r.calls], [false, 'provider_quota', 1], 'a used-up daily quota is not retried');
  r = await CC.generateReview(stub([busy(), reply({ coverage: [] })]), course, sessions, { sleep: async () => {} });
  assert.equal(r.ok, true, 'the course check waits too');
  r = await CC.generatePart(stub([reply('not json'), { ...reply(LESSON), text: 'Here you go: ' + JSON.stringify(LESSON) + ' thanks' }]), 'lesson', ctx);
  assert.equal(r.ok, true, 'text around the object is ignored');
  r = await CC.generatePart(stub([reply({ objectives: [] }), reply({ objectives: [] })]), 'lesson', ctx);
  assert.deepEqual([r.ok, r.code, r.calls], [false, 'invalid_answer', 2]);
  assert.match(r.message, /missing/);

  /* ------------------------------- time plans that do not add up (no AI needed) */
  const P130 = [{ minutes: 15, activity: 'Intro' }, { minutes: 25, activity: 'Basics' }, { minutes: 30, activity: 'Demo' }, { minutes: 10, activity: 'Short break' }, { minutes: 25, activity: 'Lab' }, { minutes: 25, activity: 'Wrap-up' }];
  let fitted = CC.fitTimePlan(P130, 120);
  assert.equal(fitted.reduce((n, x) => n + x.minutes, 0), 120, 'fitted to the session length');
  assert.deepEqual(fitted.map(x => x.activity), P130.map(x => x.activity), 'activities are kept, in order');
  assert.equal(fitted[3].minutes, 10, 'breaks are not shortened'); assert.equal(P130[2].minutes, 30, 'the input is not changed');
  assert.deepEqual(fitted.map(x => x.minutes), [15, 20, 25, 10, 25, 25], 'minutes come from the longest blocks');
  assert.equal(CC.fitTimePlan([{ minutes: 50, activity: 'A' }, { minutes: 62, activity: 'B' }], 120).reduce((n, x) => n + x.minutes, 0), 120, 'short plans grow too, by any amount');
  assert.equal(CC.fitTimePlan([{ minutes: 100, activity: 'A' }, { minutes: 100, activity: 'B' }], 120), null, 'a plan far off is left for a person');
  assert.equal(CC.fitTimePlan([{ minutes: 5, activity: 'A' }, { minutes: 125, activity: 'Break' }], 120), null, 'nothing can give minutes');
  r = await CC.generatePart(stub([reply({ ...LESSON, timePlan: P130 })]), 'lesson', ctx);
  assert.equal(CC.planMinutes(r.value), 120, 'a generated plan that does not add up is fitted');
  assert.deepEqual(r.meta.timeFitted, { from: 130, to: 120 });
  assert.deepEqual(CC.applyPart(null, 'lesson', r.value, { ...r.meta, at: '2026-10-15T10:00:00.000Z' }).meta.parts.lesson.timeFitted, { from: 130, to: 120 }, 'and the fitting is recorded');
  r = await CC.generatePart(stub([reply(LESSON)]), 'lesson', ctx);
  assert.equal(r.meta.timeFitted, undefined, 'a plan that adds up is left alone');

  /* ------------------------------------- merging parts and a person's edits */
  const at = '2026-10-15T10:00:00.000Z';
  let c = CC.applyPart(null, 'lesson', CC.normalizePart('lesson', LESSON).value, { at, provider: 'gemini', model: 'gemini-2.5-flash', tokens: 900, calls: 1, ms: 5000 });
  let s = { ...sessions[0], content: c };
  assert.deepEqual(CC.sessionState(s).done, ['lesson']); assert.equal(CC.sessionState(s).status, 'partial');
  c = CC.failPart(c, 'practice', { code: 'timeout', message: 'Too slow', at, tokens: 0, calls: 2 });
  s = { ...s, content: c };
  assert.equal(CC.sessionState(s).status, 'failed'); assert.deepEqual(CC.sessionState(s).failed, ['practice']);
  c = CC.applyPart(c, 'practice', CC.normalizePart('practice', PRACTICE).value, { at, tokens: 1 });
  c = CC.applyPart(c, 'assess', CC.normalizePart('assess', ASSESS).value, { at, tokens: 1 });
  assert.equal(c.meta.errors, undefined, 'a later success clears the error');
  assert.equal(c.objectives.length, 3, 'other parts are kept');
  s = { ...s, content: c };
  assert.equal(CC.sessionState(s).status, 'complete');
  c.meta.approved = { by: 'u', at };
  const ed = CC.applyEdit(c, { objectives: ['Build a page', 'Write a list'], lesson: c.lesson }, 'u-admin', at);
  assert.equal(ed.changed, true); assert.deepEqual(ed.content.meta.edited.parts, ['lesson']);
  assert.ok(ed.content.meta.approved, "a person's edit keeps the approval");
  assert.equal(CC.applyEdit(ed.content, { objectives: ['Build a page', 'Write a list'] }, 'u', at).changed, false, 'unchanged fields are not an edit');
  assert.equal(CC.applyEdit(c, { title: 'x', meta: {} }, 'u', at).changed, false, 'only content fields can be edited');
  const regen = CC.applyPart(ed.content, 'practice', CC.normalizePart('practice', PRACTICE).value, { at });
  assert.deepEqual(regen.meta.edited.parts, ['lesson'], 'regenerating another part keeps the record of the edited one');
  assert.equal(regen.meta.approved, undefined, 'new AI text needs a new approval');
  assert.deepEqual(regen.objectives, ['Build a page', 'Write a list'], "the person's edits in other parts are kept");
  const outd = clone(regen); outd.meta.outdated = ['lesson', 'practice'];
  assert.equal(CC.sessionState({ content: outd }).status, 'outdated');
  assert.deepEqual(CC.applyPart(outd, 'lesson', CC.normalizePart('lesson', LESSON).value, { at }).meta.outdated, ['practice']);

  /* ---------------------------------------------------- completeness */
  let items = CC.sessionChecks({ ...sessions[0], content: c });
  assert.ok(items.every(x => x.ok), JSON.stringify(items.filter(x => !x.ok)));
  assert.equal(items.find(x => x.key === 'timePlan').note, '120 of 120 minutes planned');
  items = CC.sessionChecks({ ...sessions[0], duration: '3h', content: c });
  assert.equal(items.find(x => x.key === 'timePlan').ok, false, 'a plan that does not fit the session is not complete');
  items = CC.sessionChecks({ ...sessions[0], content: { ...c, codeRelevant: false, codeExamples: [] } });
  assert.equal(items.some(x => x.key === 'codeExamples'), false, 'code is required only where the topic needs it');
  assert.equal(CC.sessionChecks({ ...sessions[0], content: { ...c, quiz: QUIZ(4) } }).find(x => x.key === 'quiz').ok, false);
  assert.equal(CC.sessionChecks(sessions[0]).filter(x => x.ok).length, 0, 'nothing is counted for an empty session');

  const full = sessions.map(x => ({ ...x, content: c }));
  let cc = CC.courseChecks(course, full);
  assert.equal(cc.complete, false);
  assert.deepEqual(cc.course.filter(x => !x.ok).map(x => x.key), ['capstone', 'review', 'gaps'], 'outcomes come from the outline links until a course check ran');
  const reviewed = { ...course, aiContent: { review: { stamp: CC.outlineStamp(course, full), coverage: [{ outcome: 1, sessions: [1], strength: 'strong' }, { outcome: 2, sessions: [], strength: 'missing' }] }, capstone: { title: 'Cap', brief: 'Build it', rubric: [{ criterion: 'Works', marks: 10 }] }, proposals: [] } };
  cc = CC.courseChecks(reviewed, full);
  assert.deepEqual(cc.course.filter(x => !x.ok).map(x => x.key), ['outcomes']); assert.match(cc.course[0].note, /outcome 2/);
  assert.equal(cc.total, full.length * 13 + 4); assert.equal(cc.ok, cc.total - 1);
  const edited = full.map((x, i) => (i ? x : { ...x, title: 'HTML and CSS' }));
  assert.equal(CC.courseChecks(reviewed, edited).course.find(x => x.key === 'review').ok, false, 'a changed outline makes the check out of date');
  // The check's own stamp covers only what it reads: timings and quizzes edited later keep it current.
  const checked = { ...reviewed, aiContent: { ...reviewed.aiContent, review: { ...reviewed.aiContent.review, stamp: CC.reviewStamp(course, full) } } };
  const retimed = full.map((x, i) => (i ? x : { ...x, content: CC.applyEdit(x.content, { timePlan: [{ minutes: 60, activity: 'A' }, { minutes: 60, activity: 'B' }], quiz: QUIZ(5) }, 'u', at).content }));
  assert.equal(CC.reviewCurrent(checked, retimed), true, 'editing timings or a quiz keeps the course check current');
  const reaimed = full.map((x, i) => (i ? x : { ...x, content: CC.applyEdit(x.content, { objectives: ['Build forms', 'Validate input'] }, 'u', at).content }));
  assert.equal(CC.reviewCurrent(checked, reaimed), false, 'changed objectives make it out of date');
  assert.equal(CC.reviewCurrent(checked, edited), false, 'and so does a changed title');
  assert.equal(CC.reviewCurrent(reviewed, full), true, 'a check saved with the older stamp is still accepted');
  // The database does not keep the order of object keys: a downloaded copy must give the same stamp.
  const stamped = full.map((x, i) => ({ ...x, content: { ...c, meta: { parts: { lesson: { at: `2026-01-0${i + 1}T10:00:00Z` }, practice: { at: `2026-01-0${i + 1}T10:01:00Z` }, assess: { at: `2026-01-0${i + 1}T10:02:00Z` } } } } }));
  const reordered = stamped.map(x => ({ ...x, content: { ...x.content, meta: { parts: { assess: x.content.meta.parts.assess, lesson: x.content.meta.parts.lesson, practice: x.content.meta.parts.practice } } } }));
  assert.equal(CC.outlineStamp(course, reordered), CC.outlineStamp(course, stamped), 'the stamp does not depend on the order of stored keys');
  assert.notEqual(CC.outlineStamp(course, stamped.map((x, i) => (i ? x : { ...x, content: { ...x.content, meta: { parts: { ...x.content.meta.parts, assess: { at: '2026-02-01T00:00:00Z' } } } } }))), CC.outlineStamp(course, stamped), 'a regenerated part still changes the stamp');
  const withGap = { ...reviewed, aiContent: { ...reviewed.aiContent, proposals: [{ status: 'open', severity: 'high', topic: 'Databases' }] } };
  assert.match(CC.courseChecks(withGap, full).course.find(x => x.key === 'gaps').note, /Databases/);

  /* --------------------------------------------------- the course check */
  const RV = {
    coverage: [{ outcome: 1, sessions: [1, 9], strength: 'strong' }, { outcome: 7, sessions: [1] }],
    missingTopics: [{ topic: 'Databases', why: 'Full stack needs persistence', severity: 'HIGH' }],
    duplicates: [{ sessions: [1], topic: 'x' }], progression: [],
    proposals: [{ session: 2, topic: 'Databases', title: 'APIs and Databases', summary: 's', instructions: 'Add SQLite persistence.', reason: 'r', severity: 'high' }, { session: 9, instructions: 'x' }],
    capstone: { title: 'Task tracker', brief: 'Build it', milestones: [{ session: 2, task: 'API' }, { session: 12, task: 'x' }], rubric: [{ criterion: 'Works', marks: 60 }, { criterion: 'Code', marks: 40 }], maxMarks: 5 }
  };
  const nr = CC.normalizeReview(RV, 2, 2).value;
  assert.deepEqual(nr.coverage, [{ outcome: 1, sessions: [1], strength: 'strong' }], 'outcomes and sessions out of range are dropped');
  assert.equal(nr.missingTopics[0].severity, 'high');
  assert.equal(nr.duplicates.length, 0, 'a duplicate needs two sessions');
  assert.equal(nr.proposals.length, 1); assert.equal(nr.capstone.maxMarks, 100); assert.equal(nr.capstone.milestones.length, 1);
  seen = [];
  r = await CC.generateReview(stub([reply(RV)]), course, full);
  assert.equal(r.ok, true); assert.match(seen[0].prompt, /Objectives: Build a page; Write a list|Objectives: Build a semantic/);
  assert.match(seen[0].system, /never new sessions/);
  r = await CC.generateReview(stub([fail('timeout')]), course, full);
  assert.deepEqual([r.ok, r.calls], [false, 1], 'the course check is not repeated after a time-out');
  const merged = CC.mergeProposals([{ session: 2, topic: 'Databases', status: 'dismissed' }, { session: 1, topic: 'Old', status: 'open' }], nr.proposals.concat([{ session: 1, topic: 'Forms', instructions: 'x' }]), at);
  assert.deepEqual(merged.map(p => `${p.session}:${p.topic}:${p.status}`), ['2:Databases:dismissed', '1:Forms:open'], 'decisions are kept, stale open ones are replaced');
  // Storing a check: an AI capstone is replaced and kept as the previous version; an edited one is never replaced.
  const oldCap = { title: 'Old capstone', brief: 'b', rubric: [{ criterion: 'x', marks: 10 }], at: 't0', model: 'm0' };
  const info = { at: 't1', by: 'u1', stamp: 's1', basedOn: 'content' };
  let ai2 = CC.applyReview({ capstone: oldCap, proposals: [{ session: 2, topic: 'Databases', status: 'dismissed' }] }, nr, { provider: 'gemini', model: 'm1' }, info);
  assert.deepEqual([ai2.capstone.title, ai2.capstone.model, ai2.capstonePrev.title, ai2.capstonePrev.replacedAt], ['Task tracker', 'm1', 'Old capstone', 't1'], 'the replaced AI capstone is kept');
  assert.deepEqual([ai2.review.stamp, ai2.review.capstone, ai2.review.proposals, ai2.proposals.length], ['s1', undefined, undefined, 1], 'the dismissed proposal stays dismissed');
  const editedCap = { ...oldCap, edited: { by: 'u2', at: 't0' } };
  ai2 = CC.applyReview({ capstone: editedCap }, nr, { model: 'm1' }, info);
  assert.deepEqual([ai2.capstone, ai2.capstonePrev], [editedCap, undefined], "a person's capstone is never replaced");
  ai2 = CC.applyReview({ capstone: oldCap }, { ...nr, capstone: null }, { model: 'm1' }, info);
  assert.deepEqual([ai2.capstone.title, ai2.capstonePrev], ['Old capstone', undefined], 'a check without a capstone keeps the current one');

  /* ---------------------------------------------- similar material */
  const dupSessions = [{ content: { lesson: [{ heading: 'Handling form submissions with JavaScript' }] } }, { content: { lesson: [{ heading: 'Handling form submissions in JavaScript' }] } }, { content: { lesson: [{ heading: 'Deploying to a server' }] } }];
  assert.deepEqual(CC.findDuplicates(dupSessions).map(d => d.sessions), [[1, 2]]);

  /* -------------------------------------------------- blueprints */
  const sess = { ...sessions[0], content: c };
  const a = CC.assignmentFrom(sess, { id: 'B1' });
  assert.deepEqual([a.status, a.dueAt, a.batchId, a.sessionId, a.maxMarks], ['Draft', '', 'B1', 'S1', 10], 'a draft with no due date');
  assert.match(a.description, /Deliverables:\n- index\.html/);
  let k = 0;
  const q = CC.quizFrom(sess, { id: 'B1' }, p => `${p}-${++k}`);
  assert.deepEqual([q.quiz.status, q.quiz.batchId, q.quiz.questionIds.length], ['draft', 'B1', 6]);
  assert.equal(q.questions[1].options.filter(o => o.correct).length, 1); assert.equal(q.questions[1].options[1].correct, true);
  assert.equal(CC.assignmentFrom({ content: {} }, { id: 'B1' }), null);

  /* ------------------- what learners see (the real browser code, in a sandbox) */
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const box = { CourseContentLogic: CC, esc, icon: () => '', badge: x => `[${x}]`, t: x => x, window: { addEventListener() {} }, sessionStorage: { getItem: () => null, setItem() {} }, console };
  const user = { role: 'student' }, course2 = { id: 'C1', status: 'draft' };
  Object.assign(box, { kind: u => (u.role === 'student' ? 'student' : 'staff'), Domain: { canManageCourse: () => true } });
  vm.createContext(box);
  require('./support/provider-box')(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'pages-coursecontent.js'), 'utf8') + '\n;this.tcContentHTML = tcContentHTML; this.tcSessionBlock = tcSessionBlock; this.tcRich = tcRich; this.TC_SPLIT = TC_SPLIT;', box);
  // A step cut at its size limit inside a code block: stored with the block closed, and the editor
  // (items separated by empty lines outside code) reads the steps back as they were, not merged.
  const longCode = 'Connect the database:\n```javascript\n' + Array.from({ length: 80 }, (_, i) => `const line${i} = ${i};\n`).join('');
  const cut = CC.normalizePart('practice', { tutorials: [{ title: 'T', steps: [longCode, 'Step two\n\nwith a second paragraph', 'Step three'] }], demos: [{ title: 'D', description: 'd' }], guided: [{ title: 'G', instructions: 'g' }], practice: [{ title: 'P', task: 'p' }] }).value.tutorials[0].steps;
  assert.ok(cut[0].length <= 1200 && cut[0].endsWith('\n```'), 'a step cut inside a code block keeps the block closed');
  const legacy = [longCode.slice(0, 1200), 'Step two', 'Step three'];
  assert.equal(box.TC_SPLIT(legacy.join('\n\n')).length, 1, 'without closing, the editor merges the steps after an unclosed block');
  assert.deepEqual(box.TC_SPLIT(legacy.map(x => CC.closeFence(x)).join('\n\n')).length, 3, 'the editor closes the block first, so every step stays separate');
  assert.equal(CC.closeFence('no code'), 'no code'); assert.equal(CC.closeFence('```js\nx\n```'), '```js\nx\n```');
  const sess2 = { ...sessions[0], content: { ...clone(c), teacherNotes: ['SECRET-NOTE'], homework: { ...c.homework, title: 'HOMEWORK-TITLE' } } };
  delete sess2.content.meta.approved;
  const learnerHtml = box.tcContentHTML(sess2, { audience: 'learner' }), staffHtml = box.tcContentHTML(sess2, { audience: 'staff' });
  for (const hidden of ['SECRET-NOTE', 'HOMEWORK-TITLE', 'data-sec="quiz"', 'data-sec="timePlan"', 'data-sec="teacherNotes"', 'Because.']) {
    assert.ok(!learnerHtml.includes(hidden), `learners never see ${hidden}`); assert.ok(staffHtml.includes(hidden), `staff see ${hidden}`);
  }
  assert.ok(learnerHtml.includes('data-sec="lesson"') && learnerHtml.includes('data-sec="codeExamples"') && learnerHtml.includes('data-sec="practice"'));
  assert.equal(box.tcSessionBlock(course2, sess2, user), '', 'a draft course shows learners nothing');
  assert.equal(box.tcSessionBlock({ ...course2, status: 'published' }, sess2, user), '', 'nor does unapproved content');
  const approved = { ...sess2, content: { ...sess2.content, meta: { ...sess2.content.meta, approved: { by: 'u', at } } } };
  assert.ok(box.tcSessionBlock({ ...course2, status: 'published' }, approved, user).includes('data-sec="lesson"'), 'approved content of a published course is shown');
  assert.equal(box.tcSessionBlock({ ...course2, status: 'published' }, approved, user, { unlocked: false }), '', 'never for a locked session');
  assert.ok(!box.tcSessionBlock({ ...course2, status: 'published' }, approved, user).includes('SECRET-NOTE'));
  // text is escaped before the few formatting marks are applied
  assert.equal(box.tcRich('<img src=x onerror=alert(1)> **b** `c`'), '<p>&lt;img src=x onerror=alert(1)&gt; <b>b</b> <code>c</code></p>');
  assert.match(box.tcRich('Intro\n- one\n- two\n\n```js\nlet a = "<b>";\n```'), /<p>Intro<\/p><ul><li>one<\/li><li>two<\/li><\/ul><div class="tc-code">.*&lt;b&gt;/s);

  console.log('coursecontent.test.js: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
