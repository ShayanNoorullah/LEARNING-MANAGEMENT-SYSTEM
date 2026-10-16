/* Generated code survives the whole pipeline: AI answer -> checks -> storage -> editor -> rendering.
   Python and JavaScript teaching content goes through the real normalizer, generator and browser runner
   (TCRun in a sandbox) with a stub AI; nothing here reaches the network. What must hold:
   - code keeps its brackets, calls, chained calls and indentation, byte for byte inside its block;
   - unfenced code gets a code block, a cut never lands inside a line of code and is always flagged;
   - flagged content cannot be approved or counted complete until a person has dealt with it;
   - a person's edit gets the same treatment, and is refused (not cut) when it is over a limit. Run: npm test */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const CC = require('../js/coursecontent-logic.js'), CK = require('../js/codecheck-logic.js');
const clone = v => JSON.parse(JSON.stringify(v));
const words = (n, w) => Array.from({ length: n }, (_, i) => w + (i % 9 ? '' : '.')).join(' ');
const FENCE = '`'.repeat(3);
const fenced = (lang, code) => FENCE + lang + '\n' + code + '\n' + FENCE;

/* ------------------------------------------------------------ the code */
const PY = {
  clean: 'import pandas as pd\n\ndef clean(df):\n    if df.empty:\n        return df\n    df = df.drop_duplicates()\n    return df.fillna(df.mean()).reset_index()\n\nprint(clean(pd.DataFrame()).isnull().sum().sum())\nplt.tight_layout()\nplt.show()',
  chain: 'summary = (df.groupby("city")["salary"]\n           .agg(["mean", "max"])\n           .sort_values("mean", ascending=False)\n           .reset_index())\nprint(summary.head())',
  loop: 'for name, group in df.groupby("dept"):\n    total = 0\n    for _, row in group.iterrows():\n        if row["pay"] > 0:\n            total += row["pay"]\n    print(name, total)',
  info: 'df.info()\ndf.describe()\ndf.head()'
};
const JS = {
  fetch: 'async function load(id) {\n  try {\n    const res = await fetch(`/api/users/${id}`);\n    if (!res.ok) throw new Error(`HTTP ${res.status}`);\n    return await res.json();\n  } catch (err) {\n    console.error(err.message);\n  }\n}',
  chain: 'fetch(url)\n  .then(res => res.json())\n  .then(data => data.items.map(i => i.name).filter(Boolean))\n  .then(names => console.log(names.join(", ")))\n  .catch(err => console.error(err));',
  server: "app.get('/users/:id', (req, res) => {\n  const user = users.find(u => u.id === Number(req.params.id));\n  if (!user) return res.status(404).json({ error: 'Not found' });\n  res.json(user);\n});",
  dom: "document.querySelector('#save').addEventListener('click', event => {\n  event.preventDefault();\n  items.forEach(item => {\n    list.appendChild(render(item));\n  });\n});"
};
// One answer per part, in the shape the AI returns. `unfenced` puts solutions as raw text (the AI often does).
function answer(kind, lang, n = 1, { unfenced = true, extra = {} } = {}) {
  const C = lang === 'python' ? PY : JS, A = lang === 'python' ? [C.clean, C.chain, C.loop] : [C.fetch, C.chain, C.server];
  const ex = i => fenced(lang, A[i % A.length]);
  if (kind === 'lesson') return { objectives: ['Explain ' + n, 'Build ' + n, 'Debug ' + n], prerequisites: ['The previous session'],
    timePlan: [{ minutes: 20, activity: 'Introduction' }, { minutes: 40, activity: 'Concepts' }, { minutes: 10, activity: 'Break' }, { minutes: 50, activity: 'Practice' }],
    lesson: [0, 1, 2, 3].map(i => ({ heading: 'Part ' + (i + 1) + ' of session ' + n, body: words(60, 'explain'), example: 'Worked example:\n\n' + ex(i) + '\n\nRun it and compare the output.' })),
    keyTerms: [{ term: 'Term', meaning: 'Means something.' }], ...extra };
  if (kind === 'practice') return { codeRelevant: true,
    tutorials: [{ title: 'Tutorial', goal: 'Follow along', steps: ['Open the editor.', 'Type the code:\n' + ex(0), 'Run it.', 'Change one value and run it again.'] }],
    codeExamples: [0, 1, 2].map(i => ({ title: 'Example ' + (i + 1), language: lang, code: A[i % A.length], explanation: 'Read it line by line.' })),
    demos: [{ title: 'Demo', description: 'Show it live.', steps: ['a', 'b', 'c'] }],
    guided: [0, 1].map(i => ({ title: 'Guided ' + (i + 1), instructions: 'Write it with help.', steps: ['a', 'b', 'c'], hint: 'Start with the function.', solution: unfenced ? A[i % A.length] : ex(i) })),
    practice: [{ title: 'Task', task: 'Do it alone.', criteria: ['It runs', 'It is tidy'] }], ...extra };
  return { homework: { title: 'Homework ' + n, brief: words(40, 'brief'), deliverables: ['script'], rubric: [{ criterion: 'Works', marks: 6 }, { criterion: 'Clean', marks: 4 }], maxMarks: 10, estimatedHours: 2 },
    quiz: Array.from({ length: 6 }, (_, i) => ({ question: 'Question ' + (i + 1) + '?', options: lang === 'python' ? ['df.head()', 'df.info()', 'df.shape', 'plt.show()'] : ['res.json()', 'res.text()', 'res.status', 'res.ok'], answer: i % 4, explanation: 'Because.' })),
    teacherNotes: ['Prepare the data file.'], resources: [{ title: 'Official documentation', type: 'documentation', note: 'Reference.' }], ...extra };
}
const course = lang => ({ id: 'C-' + lang, title: lang === 'python' ? 'Python for Data Analysis' : 'Full Stack Web Development', level: 'Beginner', description: 'A course.', outcomes: ['Do it'], aiMeta: { coverage: [[1]] } });
const session = (lang, n = 1) => ({ id: 'S-' + lang + n, courseId: 'C-' + lang, order: n, title: 'Session ' + n, summary: 'Summary', moduleName: 'M', duration: '2h' });
// every fenced code block of a content object, in order
const blocksOf = content => {
  const out = [];
  const walk = v => { if (typeof v === 'string') CK.fencedBlocks(v).forEach(b => out.push(b.code)); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(content); return out;
};

(async () => {
  /* -------------------- A. the normalizer keeps code exactly, and fences what is raw */
  for (const lang of ['python', 'javascript']) {
    const lesson = CC.normalizePart('lesson', answer('lesson', lang), { lang });
    assert.ok(!lesson.error, lesson.error);
    const code = blocksOf(lesson.value);
    const want = lang === 'python' ? [PY.clean, PY.chain, PY.loop, PY.clean] : [JS.fetch, JS.chain, JS.server, JS.fetch];
    want.forEach((w, i) => assert.ok(code.includes(w), lang + ': lesson example ' + i + ' keeps its code byte for byte'));
    const practice = CC.normalizePart('practice', answer('practice', lang), { lang });
    assert.ok(!practice.error, practice.error);
    const ex = practice.value.codeExamples.map(x => x.code), A = lang === 'python' ? [PY.clean, PY.chain, PY.loop] : [JS.fetch, JS.chain, JS.server];
    assert.deepEqual(ex, A, lang + ': code examples are unchanged');
    assert.equal(practice.value.guided[0].solution, FENCE + lang + '\n' + A[0] + '\n' + FENCE, lang + ': a raw solution gets a ' + lang + ' code block, the code inside unchanged');
    assert.ok(practice.fixes.some(f => f.kind === 'fenced' && f.path === 'guided[0].solution'), 'the fix is recorded, not silent');
    assert.equal(practice.value.tutorials[0].steps[1], 'Type the code:\n' + fenced(lang, A[0]), 'a step with a code block is untouched');
    const second = CC.normalizePart('practice', practice.value, { lang });
    assert.deepEqual(second.value, practice.value, 'normalizing twice changes nothing');
    assert.deepEqual(CC.contentFindings(practice.value), [], lang + ': valid code gets no findings');
    assert.deepEqual(CC.contentFindings(lesson.value), []);
    const quiz = CC.normalizePart('assess', answer('assess', lang), { lang }).value.quiz;
    assert.ok(quiz[0].options.every(o => o.includes('.')), 'quiz options keep their calls');
    assert.ok(quiz[0].options.includes(lang === 'python' ? 'df.head()' : 'res.json()'));
  }

  /* ---------------------------------- B. limits: never cut inside a line of code */
  const bigLines = n => Array.from({ length: n }, (_, i) => 'value_' + i + ' = compute(' + i + ', "item")  # row ' + i).join('\n');
  const nearLimit = bigLines(200).slice(0, 7990).replace(/\n[^\n]*$/, '');
  const okLimit = CC.normalizePart('practice', answer('practice', 'python', 1, { extra: { codeExamples: [{ title: 'Long', language: 'python', code: nearLimit, explanation: 'x' }] } }));
  assert.equal(okLimit.value.codeExamples[0].code, nearLimit, 'code just under its limit is kept whole');
  assert.ok(!(okLimit.flags || []).some(f => f.kind === 'cut'));
  const tooLong = bigLines(400);
  const cutRes = CC.normalizePart('practice', answer('practice', 'python', 1, { extra: { codeExamples: [{ title: 'Long', language: 'python', code: tooLong, explanation: 'x' }] } }));
  const cutCode = cutRes.value.codeExamples[0].code;
  assert.ok(cutCode.length <= 8000 && tooLong.startsWith(cutCode), 'the cut keeps a prefix of the code');
  assert.ok(tooLong.charAt(cutCode.length) === '\n', 'the cut falls at the end of a line, never inside one');
  const f = cutRes.flags.find(x => x.kind === 'cut');
  assert.deepEqual([f.path, f.code, f.from > 8000], ['codeExamples[0].code', 'partial', true], 'and it is recorded');
  const solLong = fenced('python', bigLines(120));
  const solRes = CC.normalizePart('practice', answer('practice', 'python', 1, { extra: { guided: [{ title: 'G', instructions: 'i', steps: ['a', 'b', 'c'], solution: solLong }] } }));
  const sol = solRes.value.guided[0].solution;
  assert.ok(sol.length <= 4000 && sol.endsWith('\n' + FENCE), 'a solution cut inside its block keeps the block closed');
  assert.ok(sol.split('\n').slice(1, -1).every(l => /^value_\d+ = compute\(\d+, "item"\)  # row \d+$/.test(l)), 'every line that is left is a whole line');
  assert.equal(solRes.flags.find(x => x.kind === 'cut').code, 'partial');
  const prose = CC.normalizePart('lesson', answer('lesson', 'python', 1, { extra: { lesson: [0, 1, 2].map(i => ({ heading: 'H' + i, body: words(1500, 'explain'), example: 'e' })) } }));
  assert.ok(prose.value.lesson[0].body.length <= 5000, 'prose is shortened to its limit');
  assert.ok(prose.flags.some(x => x.kind === 'cut' && !x.code), 'shortened prose is recorded too');
  // more items than the schema holds are recorded as well
  const many = CC.normalizePart('lesson', answer('lesson', 'python', 1, { extra: { objectives: Array.from({ length: 12 }, (_, i) => 'Objective ' + i) } }));
  assert.equal(many.value.objectives.length, 8); assert.ok(many.flags.some(x => x.kind === 'items' && x.from === 12));

  /* ------------------------------------------------ C. a JSON slip is repaired */
  const raw = '{"objectives": ["a", "b"], "note": "line one' + '\n' + 'line two' + '\t' + 'tab",}';
  const pr = CC.parseAnswer(raw);
  assert.equal(pr.repaired, true); assert.equal(pr.value.note, 'line one\nline two\ttab', 'raw line breaks in a string are escaped, nothing else changes');
  assert.ok(CC.parseAnswer('{"a": "x}').error, 'a real syntax error is still an error');
  assert.equal(CC.parseAnswer('```json\n{"a": 1}\n```').value.a, 1);

  /* ------- D. generation: code that cannot be valid gets one more try, then is flagged */
  const sess = session('python'), ctxOf = s => ({ course: course('python'), sessions: [s], session: s });
  const BAD_PY = 'def total(items):\nresult = 0\nfor i in items:\nresult += i\nreturn result';
  const withCode = code => answer('practice', 'python', 1, { extra: { codeExamples: [{ title: 'Total', language: 'python', code, explanation: 'x' }, { title: 'Clean', language: 'python', code: PY.clean, explanation: 'x' }] } });
  const reply = a => ({ text: JSON.stringify(a), provider: 'stub', model: 'stub-1', tokens: 100 });
  let prompts = [];
  const ai = (...answers) => { let n = 0; prompts = []; return async o => { prompts.push(o.prompt); const a = answers[Math.min(n++, answers.length - 1)]; if (a instanceof Error) throw a; return reply(a); }; };
  let r = await CC.generatePart(ai(withCode(BAD_PY), withCode(PY.loop)), 'practice', ctxOf(sess));
  assert.ok(r.ok); assert.equal(r.meta.calls, 2, 'one more try, never more');
  assert.match(prompts[1], /code problems/); assert.match(prompts[1], /Code examples 1 · Code/);
  assert.equal(r.value.codeExamples[0].code, PY.loop, 'the corrected answer is the one kept');
  assert.equal(r.meta.codeChecks, undefined, 'no open checks on the kept answer');
  r = await CC.generatePart(ai(withCode(BAD_PY), withCode(BAD_PY)), 'practice', ctxOf(sess));
  assert.ok(r.ok && r.meta.calls === 2);
  assert.ok(r.meta.codeChecks.errors > 0, 'a part that is still wrong is saved, and says so');
  const saved = { id: 'S1', courseId: 'C-python', duration: '2h', content: CC.applyPart({}, 'practice', r.value, { ...r.meta, at: 't1' }) };
  assert.ok(CC.codeReport(saved).open && CC.codeReport(saved).errors > 0);
  assert.equal(saved.content.meta.parts.practice.codeChecks.errors, r.meta.codeChecks.errors);
  r = await CC.generatePart(ai(withCode(PY.loop)), 'practice', ctxOf(sess));
  assert.equal(r.meta.calls, 1, 'valid code costs no extra request');
  const rawJson = { text: JSON.stringify(withCode(PY.loop)).split('\\n').join('\n'), provider: 'stub', model: 'm', tokens: 5 };
  r = await CC.generatePart(async () => rawJson, 'practice', ctxOf(sess));
  assert.ok(r.ok && r.meta.calls === 1, 'an answer with raw line breaks in its strings is repaired without another request');
  assert.deepEqual(r.value.codeExamples[1].code, PY.clean, 'and the code in it is exact');
  assert.ok(r.meta.fixes.some(x => x.kind === 'json-repaired'), 'the repair is recorded');
  r = await CC.generatePart(ai(withCode(BAD_PY), Object.assign(new Error('down'), { code: 'provider' })), 'practice', ctxOf(sess));
  assert.ok(r.ok, 'when the second try fails the first answer is still usable'); assert.ok(r.meta.codeChecks.errors > 0);
  const jsSess = session('javascript');
  r = await CC.generatePart(ai(answer('practice', 'javascript', 1, { extra: { codeExamples: [{ title: 'Fetch', language: 'javascript', code: 'fetch(u).then(r => r.json)', explanation: 'x' }, { title: 'Load', language: 'javascript', code: JS.fetch, explanation: 'x' }] } })), 'practice', { course: course('javascript'), sessions: [jsSess], session: jsSess });
  assert.equal(r.meta.calls, 1, 'a call that may have lost its brackets is to be confirmed, not retried');
  assert.ok(r.meta.codeChecks.review > 0 && !r.meta.codeChecks.errors);

  /* --------------- E. a complete session: checks, approval and a person's edits */
  const full = lang => {
    const s = session(lang);
    let c = {};
    ['lesson', 'practice', 'assess'].forEach((p, i) => { const n = CC.normalizePart(p, answer(p, lang), { lang }); assert.ok(!n.error, n.error); c = CC.applyPart(c, p, n.value, { at: 't' + i, provider: 'stub', model: 'm', ...n }); });
    return { ...s, content: c };
  };
  const base = full('python');
  assert.equal(CC.sessionState(base).status, 'complete');
  assert.ok(CC.sessionChecks(base).every(x => x.ok), 'a clean complete session has every item');
  assert.equal(CC.sessionChecks(base).length, 13, 'and no extra code item');
  assert.deepEqual(CC.approvalBlockers(base), []);
  let edit = CC.applyEdit(base.content, { guided: [{ title: 'Guided', instructions: 'Do it', steps: ['a', 'b', 'c'], solution: BAD_PY }] }, 'u-coord', 'tE');
  assert.ok(edit.changed && edit.findings.length > 0, 'the editor is told right away');
  assert.equal(edit.content.guided[0].solution.startsWith(FENCE + 'python'), true, 'the typed code got a code block');
  const flagged = { ...base, content: edit.content };
  assert.ok(CC.codeReport(flagged).open);
  const items = CC.sessionChecks(flagged), item = items.find(x => x.key === 'codeChecks');
  assert.ok(item && !item.ok && items.filter(x => !x.ok).length === 1, 'an unresolved check is one missing item of its own');
  assert.match(CC.approvalBlockers(flagged)[0], /code checks? need/);
  const confirmed = { ...flagged, content: CC.acknowledgeCode(flagged, 'u-coord', 'tA') };
  assert.ok(CC.codeReport(confirmed).acknowledged); assert.deepEqual(CC.approvalBlockers(confirmed), []);
  assert.ok(CC.sessionChecks(confirmed).find(x => x.key === 'codeChecks').ok);
  const changedAgain = CC.applyEdit(confirmed.content, { guided: [{ title: 'Guided', instructions: 'Do it', steps: ['a', 'b', 'c'], solution: 'def f(x):\nreturn x\nprint(f(1))\nprint(f(2)' }] }, 'u', 'tB');
  assert.ok(CC.codeReport({ ...confirmed, content: changedAgain.content }).open, 'a confirmation stops applying when the findings change');
  const repaired = CC.applyEdit(flagged.content, { guided: [{ title: 'Guided', instructions: 'Do it', steps: ['a', 'b', 'c'], solution: fenced('python', PY.loop) }] }, 'u', 'tC');
  assert.deepEqual(CC.codeReport({ ...base, content: repaired.content }).findings, [], 'fixing the code clears the check');
  assert.equal(CC.sessionChecks({ ...base, content: repaired.content }).length, 13);
  // a person's text is never cut: over its limit it is refused with the field named
  const longSol = fenced('python', Array.from({ length: 700 }, (_, i) => 'x' + i + ' = ' + i).join('\n'));
  const refused = CC.applyEdit(base.content, { guided: [{ title: 'Guided', instructions: 'Do it', steps: ['a', 'b', 'c'], solution: longSol }] }, 'u', 'tD');
  assert.equal(refused.changed, false);
  assert.deepEqual(refused.overLimit.map(o => [o.label, o.max]), [['Guided exercises 1 · Solution', 4000]]);
  assert.deepEqual(refused.content, base.content, 'nothing was saved or cut');
  assert.equal(CC.applyEdit(base.content, { guided: [{ title: 'G', instructions: 'i', steps: ['a', 'b', 'c'], solution: longSol }] }, 'u', 'tD', { allowCut: true }).changed, true, 'cutting only happens when asked for');
  // regenerating a part drops approval and the confirmation with it
  const approvedFlagged = { ...confirmed, content: { ...confirmed.content, meta: { ...confirmed.content.meta, approved: { by: 'u', at: 'tA2' } } } };
  const regen = CC.applyPart(approvedFlagged.content, 'practice', CC.normalizePart('practice', answer('practice', 'python')).value, { at: 'tR' });
  assert.ok(!regen.meta.approved && !regen.meta.codeReview);
  assert.match(CC.approvalBlockers({ ...base, content: { ...base.content, meta: { ...base.content.meta, parts: { lesson: base.content.meta.parts.lesson } } } })[0], /Not complete/);
  assert.match(CC.pathLabel('guided[1].solution'), /Guided exercises 2 · Solution/);
  assert.equal(CC.pathLabel('codeExamples[0].code'), 'Code examples 1 · Code');

  /* ---------------- F. links: removed from prose, kept in code, flagged in a code line */
  const lk = CC.normalizePart('lesson', answer('lesson', 'javascript', 1, { extra: { lesson: [0, 1, 2].map(i => ({ heading: 'H' + i, body: words(40, 'explain') + ' See https://example.org.evil.io/guide for more.', example: 'Fetch it:\n' + fenced('javascript', "const r = await fetch('https://api.example.com/items');\nconsole.log(r.status);") + '\n' + 'Then open https://docs.evil.io/x.' })) } }), { lang: 'javascript' });
  assert.equal(lk.linksRemoved, 6, 'two links per section are removed from prose');
  assert.ok(lk.value.lesson[0].example.includes('https://api.example.com/items'), 'the address inside code is code, and stays');
  assert.ok(!/evil/.test(JSON.stringify(lk.value)));
  const inLine = CC.normalizePart('practice', answer('practice', 'python', 1, { extra: { guided: [{ title: 'G', instructions: 'Use the API.', steps: ['a', 'b', 'c'], solution: 'Add this line to the file:\nurl = "https://api.example.org.evil.io/v1"\nThen run the app.' }] } }));
  assert.ok(inLine.flags.some(x => x.kind === 'link-in-code' && x.path === 'guided[0].solution'), 'a link taken out of a line of code is flagged for a person');

  /* ---- G. the real browser runner, end to end, for a Python and a JavaScript course */
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const unesc = v => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  function sandbox(store, aiCall) {
    const box = {
      CourseContentLogic: CC, console, Map, Set, Promise, Date, JSON, Math, Number, String, Object, Array, Error,
      setTimeout: fn => setImmediate(fn), clearTimeout() {}, window: { addEventListener() {} }, sessionStorage: { getItem: () => null, setItem() {} },
      t: x => x, esc, clone: v => JSON.parse(JSON.stringify(v)), icon: () => '', badge: x => '[' + x + ']', kind: u => (u.role === 'student' ? 'student' : 'staff'),
      findRecord: (k, id) => store[k].find(r => r.id === id),
      updateRecord: (k, id, patch) => { const i = store[k].findIndex(r => r.id === id); if (i < 0) throw new Error('Record not found'); store[k][i] = JSON.parse(JSON.stringify({ ...store[k][i], ...patch, id })); return store[k][i]; },
      Domain: { courseSessions: id => store.sessions.filter(s => s.courseId === id).sort((a, b) => a.order - b.order), canManageCourse: () => true },
      SDCAI: { call: (feature, o) => aiCall(o) }
    };
    vm.createContext(box);
    require('./support/provider-box')(box);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'pages-coursecontent.js'), 'utf8') + '\n;this.TCRun = TCRun; this.tcContentHTML = tcContentHTML; this.tcSessionBlock = tcSessionBlock; this.tcSetApproval = tcSetApproval;', box);
    return box;
  }
  const kindOf = sys => (/Write the LESSON part/.test(sys) ? 'lesson' : /Write the PRACTICE part/.test(sys) ? 'practice' : 'assess');
  const finished = (TCRun, id) => new Promise(res => { const off = TCRun.on(run => { if (run.courseId === id && !run.active) { off(); res(run); } }); });
  const jobs = (sessions, only) => sessions.map(s => { const st = CC.sessionState(s); return { sessionId: s.id, parts: CC.PARTS.filter(p => (st.missing.includes(p) || st.outdated.includes(p)) && (!only || only(s, p))) }; }).filter(j => j.parts.length);

  for (const lang of ['python', 'javascript']) {
    const c = course(lang), store = { courses: [c], sessions: [1, 2, 3].map(n => ({ ...session(lang, n), content: undefined })) };
    const calls = [];
    const box = sandbox(store, async o => { const kind = kindOf(o.system), n = Number((/THIS SESSION: number (\d+)/.exec(o.prompt) || [])[1]); calls.push(kind + n); return reply(answer(kind, lang, n)); });
    box.TCRun.start(c.id, jobs(store.sessions));
    const done = await finished(box.TCRun, c.id);
    assert.equal(calls.length, 9, lang + ': one request per part'); assert.ok(done.jobs.every(j => j.state === 'done'));
    const A = lang === 'python' ? [PY.clean, PY.chain, PY.loop] : [JS.fetch, JS.chain, JS.server];
    for (const s of store.sessions) {
      const stored = JSON.parse(JSON.stringify(s.content));
      assert.equal(CC.sessionState(s).status, 'complete');
      assert.deepEqual(CC.codeReport(s).findings, [], lang + ': nothing to review');
      assert.ok(CC.sessionChecks(s).every(x => x.ok) && CC.sessionChecks(s).length === 13);
      assert.deepEqual(CC.approvalBlockers(s), [], 'ready for a person to approve');
      assert.deepEqual(s.content.codeExamples.map(x => x.code), A, 'stored code is what was validated');
      assert.deepEqual(JSON.parse(JSON.stringify(stored)), s.content, 'a copy through the database (JSON) is identical');
      const html = box.tcContentHTML(s, { audience: 'staff' }), shown = [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map(m => unesc(m[1]));
      A.forEach(code => assert.ok(shown.includes(code), lang + ': the code is shown exactly: ' + code.split('\n')[0]));
      assert.ok(shown.length >= 9, 'lesson examples, tutorial step, examples and solutions are all code blocks');
      assert.ok(!/<p>[^<]*(def |function |const |=&gt;)/.test(html), 'no code is shown as running text');
      const learner = box.tcContentHTML(s, { audience: 'learner' });
      assert.ok(learner.includes('<pre><code>') && !/data-sec="(quiz|timePlan|teacherNotes|homework)"/.test(learner));
    }

    // an edit by a person, then a resume with one part missing: only that part is asked for, the edit stays
    const s2 = store.sessions[1], third = store.sessions[2];
    const e = CC.applyEdit(s2.content, { keyTerms: [{ term: 'My term', meaning: 'My meaning' }] }, 'u-coord', 'tE');
    box.updateRecord('sessions', s2.id, { content: e.content });
    const broken = JSON.parse(JSON.stringify(box.findRecord('sessions', third.id).content));
    CC.FIELDS_OF('practice').forEach(k => delete broken[k]); delete broken.meta.parts.practice;
    box.updateRecord('sessions', third.id, { content: broken });
    calls.length = 0;
    box.TCRun.start(c.id, jobs(store.sessions));
    await finished(box.TCRun, c.id);
    assert.deepEqual(calls, ['practice3'], lang + ': resume asks only for what is missing');
    assert.deepEqual(box.findRecord('sessions', s2.id).content.keyTerms, [{ term: 'My term', meaning: 'My meaning' }], 'the edit by a person is untouched');
    assert.deepEqual(CC.codeReport(box.findRecord('sessions', third.id)).findings, []);
  }

  // a part whose code stays wrong: saved, flagged, never ready, never counted complete
  {
    const c = course('python'), store = { courses: [c], sessions: [session('python', 1)] };
    const calls = [];
    const box = sandbox(store, async o => { const kind = kindOf(o.system); calls.push(kind); return reply(kind === 'practice' ? withCode(BAD_PY) : answer(kind, 'python', 1)); });
    box.TCRun.start(c.id, jobs(store.sessions));
    const done = await finished(box.TCRun, c.id);
    assert.equal(calls.filter(k => k === 'practice').length, 2, 'the broken part was asked for twice, not more');
    const s = store.sessions[0];
    assert.equal(CC.sessionState(s).status, 'complete', 'the three parts exist');
    assert.ok(CC.codeReport(s).open && CC.codeReport(s).errors > 0);
    assert.ok(CC.approvalBlockers(s).length > 0, 'but it cannot be approved');
    assert.ok(CC.sessionChecks(s).some(x => x.key === 'codeChecks' && !x.ok), 'and the completeness count shows the open check');
    assert.equal(CC.courseChecks(c, store.sessions).complete, false);
    assert.equal(done.jobs[0].doneParts.length, 3);
    // approval is refused where it happens, whatever the screen shows
    const no = box.tcSetApproval(s.id, true, 'u-coord');
    assert.equal(no.ok, false); assert.match(no.reason, /code check/);
    assert.equal(box.findRecord('sessions', s.id).content.meta.approved, undefined, 'nothing was approved');
    // once a person has fixed the code, approval works, and can be withdrawn
    const fixed = CC.applyEdit(s.content, { codeExamples: s.content.codeExamples.map(x => ({ ...x, code: PY.loop })), guided: [{ title: 'G', instructions: 'i', steps: ['a', 'b', 'c'], solution: fenced('python', PY.loop) }] }, 'u-coord', 'tF');
    assert.equal(fixed.changed, true);
    box.updateRecord('sessions', s.id, { content: fixed.content });
    assert.deepEqual(CC.codeReport(box.findRecord('sessions', s.id)).findings, []);
    assert.equal(box.tcSetApproval(s.id, true, 'u-coord').ok, true);
    assert.equal(box.findRecord('sessions', s.id).content.meta.approved.by, 'u-coord');
    assert.equal(box.tcSetApproval(s.id, false, 'u-coord').ok, true);
    assert.equal(box.findRecord('sessions', s.id).content.meta.approved, undefined);
    const incomplete = JSON.parse(JSON.stringify(box.findRecord('sessions', s.id).content)); CC.FIELDS_OF('assess').forEach(k => delete incomplete[k]); delete incomplete.meta.parts.assess;
    box.updateRecord('sessions', s.id, { content: incomplete });
    assert.equal(box.tcSetApproval(s.id, true, 'u').ok, false, 'an incomplete session cannot be approved either');
  }

  console.log('codesafe.test.js: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
