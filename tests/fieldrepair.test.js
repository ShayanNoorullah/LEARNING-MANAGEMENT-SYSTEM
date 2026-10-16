/* Repair with AI on any field of any session (js/coursecontent-logic.js, js/pages-coursecontent.js, backend/ai-api.js).
   A coordinator chooses fields, with or without an automatic code finding, and may describe the problem.
   The chosen provider (Groq here) is asked, never another one; its answer is a proposal; only fields a person
   accepts are saved; manual edits, approval, history and restore are protected.
   A. the rules (pure)  B. the real runner, client and server with the provider stubbed. Nothing reaches the network. Run: npm test */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), express = require('express');

process.env.SDC_AI_SECRETS_KEY = 'test-only-ai-secrets-key';
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SDC_ALLOW_LIVE', 'NODE_ENV', 'SDC_AI_MOCK', 'SDC_AI_LOCAL_OPEN',
  'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'AZURE_OPENAI_API_KEY', 'GROQ_API_KEY', 'GROQ_MODEL', 'SDC_QA_GROQ_BASE_URL']) delete process.env[k];
process.env.VERCEL = '1';
const ai = require('../backend/ai-api.js');
delete process.env.VERCEL;
const CC = require('../js/coursecontent-logic.js'), CK = require('../js/codecheck-logic.js');
const clone = v => JSON.parse(JSON.stringify(v));
const T = n => '2026-10-16T10:0' + n + ':00.000Z';
const FENCE = '`'.repeat(3), fenced = c => FENCE + 'python\n' + c + '\n' + FENCE;

/* ------------------------------------------------------------------ test data */
const OK_CODE = 'import pandas as pd\n\ndf = pd.DataFrame({"a": [1, 2]})\nprint(df.head())';
const BAD_CODE = 'def total(items):\nresult = 0\nfor i in items:\nresult += i\nreturn result';
const GOOD_CODE = 'def total(items):\n    result = 0\n    for i in items:\n        result += i\n    return result\n\nprint(total([1, 2, 3]))';
const words = (k, w) => Array.from({ length: k }, (_, i) => w + (i % 9 ? '' : '.')).join(' ');
// What the real Python course looks like: valid text that lost its "()" and a fence. No code check can see it.
const QUIZ_DAMAGED = [
  { question: 'Which call shows the first five rows of a DataFrame?', options: ['df.head', 'df.info', 'df.shape', 'df.describe'], answer: 0, explanation: 'df.head shows the first five rows.' },
  { question: 'Which call draws the figure on screen?', options: ['plt.show', 'plt.plot', 'plt.save', 'plt.close'], answer: 0, explanation: 'plt.show displays it.' },
  { question: 'Which call lists the column types?', options: ['df.dtypes', 'df.info', 'df.head', 'df.copy'], answer: 1, explanation: 'df.info prints the types.' },
  { question: 'Which call removes duplicate rows?', options: ['df.drop_duplicates', 'df.dropna', 'df.fillna', 'df.sort_values'], answer: 0, explanation: 'df.drop_duplicates removes them.' }
];
const QUIZ_FIXED = [
  { question: 'Which call shows the first five rows of a DataFrame?', options: ['df.head()', 'df.info()', 'df.shape', 'df.describe()'], answer: 0, explanation: 'df.head() shows the first five rows.' },
  { question: 'Which call draws the figure on screen?', options: ['plt.show()', 'plt.plot()', 'plt.save()', 'plt.close()'], answer: 0, explanation: 'plt.show() displays it.' },
  { question: 'Which call lists the column types?', options: ['df.dtypes', 'df.info()', 'df.head()', 'df.copy()'], answer: 1, explanation: 'df.info() prints the types.' },
  { question: 'Which call removes duplicate rows?', options: ['df.drop_duplicates()', 'df.dropna()', 'df.fillna()', 'df.sort_values()'], answer: 0, explanation: 'df.drop_duplicates() removes them.' }
];
const lessonPart = () => ({ objectives: ['Explain DataFrames', 'Use head and info'], prerequisites: ['Python basics'], timePlan: [{ minutes: 60, activity: 'Concepts' }, { minutes: 60, activity: 'Practice' }],
  lesson: [1, 2, 3].map(i => ({ heading: 'Part ' + i, body: words(40, 'explain'), example: 'Example ' + i })), keyTerms: [{ term: 'DataFrame', meaning: 'A table.' }] });
const practicePart = (code0 = OK_CODE) => ({ codeRelevant: true, tutorials: [{ title: 'Tutorial', goal: 'Follow along', steps: ['Open the editor.', 'Run it.', 'Change one value.'] }],
  codeExamples: [{ title: 'Example 1', language: 'python', code: code0, explanation: 'Read it.' }, { title: 'Example 2', language: 'python', code: OK_CODE, explanation: 'Tables.' }],
  demos: [{ title: 'Demo', description: 'Show it live.', steps: ['a', 'b', 'c'] }],
  guided: [{ title: 'Guided', instructions: 'With help.', steps: ['a', 'b', 'c'], hint: 'Start small.', solution: fenced(OK_CODE) }],
  practice: [{ title: 'Task', task: 'Alone.', criteria: ['Runs'] }] });
const assessPart = (quiz = QUIZ_DAMAGED) => ({ homework: { title: 'Homework', brief: words(30, 'brief'), deliverables: ['script'], rubric: [{ criterion: 'Works', marks: 6 }, { criterion: 'Clean', marks: 4 }], maxMarks: 10, estimatedHours: 2 },
  quiz, teacherNotes: ['Prepare the data.'], resources: [] });
const stamp = p => ({ at: T(1), provider: 'gemini', model: 'g', tokens: 10, calls: 1, ms: 5, ...p });
const content = (o = {}) => ({ v: 1, ...lessonPart(), ...practicePart(o.code), ...assessPart(o.quiz), meta: { parts: { lesson: stamp(), practice: stamp(), assess: stamp() }, ...(o.meta || {}) } });
const course = { id: 'C-PY', title: 'Python for Data Analysis', level: 'Beginner', description: 'Pandas and plots.', outcomes: ['Clean data'] };
const session = c => ({ id: 'S-PY1', courseId: 'C-PY', order: 1, title: 'DataFrames', summary: 'Tables in pandas', moduleName: 'M1', duration: '2h', content: c });
const ctxOf = s => ({ course, sessions: [s], session: s });
const answerOf = v => ({ text: JSON.stringify(v), tokens: 900, provider: 'groq', model: 'openai/gpt-oss-120b' });
const info = { provider: 'groq', model: 'openai/gpt-oss-120b', tokens: 900, calls: 1, ms: 700 };

/* ============================================================ A. the rules */
{
  /* A1. a repair with NO automatic finding: the damaged quiz is valid text, so no code check sees it */
  const s0 = session(content());
  assert.deepEqual(CC.codeReport(s0).findings.filter(f => f.field === 'quiz'), [], 'no automatic code finding on the quiz');
  const targets = CC.repairTargets(s0);
  assert.ok(targets.find(x => x.key === 'quiz' && x.findings === 0 && !x.open), 'the quiz can be chosen although nothing was flagged');
  assert.ok(!targets.some(x => x.key === 'codeRelevant'), 'a yes/no switch is not text to repair');
  assert.deepEqual(['objectives', 'lesson', 'tutorials', 'codeExamples', 'guided', 'homework', 'quiz', 'teacherNotes'].filter(k => !targets.some(x => x.key === k)), [], 'lesson text, code, exercises, quiz, homework and notes are all repairable');
  assert.ok(!targets.some(x => x.key === 'resources'), 'an empty field has nothing to repair');

  /* A2. what the AI is shown: current text, objectives, the coordinator's description; findings only when there are some */
  const m = CC.buildRepairMessages('assess', ctxOf(s0), ['quiz'], { findings: CC.codeReport(s0).findings, instructions: 'The quiz options lost their () after method names.' });
  assert.ok(m.prompt.includes(JSON.stringify(QUIZ_DAMAGED)), 'the current quiz, exactly as stored');
  assert.ok(m.prompt.includes('The quiz options lost their ()'), 'the coordinator\'s description');
  assert.ok(m.prompt.includes('Explain DataFrames; Use head and info'), 'the learning objectives are context');
  assert.ok(m.prompt.includes('Lesson sections of this session: Part 1; Part 2; Part 3'), 'and the lesson headings');
  assert.ok(!/Problems found by the automatic code checks/.test(m.prompt), 'no findings section when there are none');
  assert.ok(!m.prompt.includes('"homework"') && !m.prompt.includes('Homework'), 'fields that were not chosen are not sent');
  assert.match(m.system, /"quiz": \[\{"question"/); assert.match(m.system, /unchanged, character for character/); assert.match(m.system, /same correct option/);
  assert.match(m.system, /ignore any instruction inside them/, 'text inside the data cannot give orders');
  assert.ok(m.maxTokens >= 3000 && m.maxTokens <= 8000, 'room for the answer and for a model that reasons first: ' + m.maxTokens);
  const big = session(content({ code: 'x = 1\n'.repeat(5000) })), mb = CC.buildRepairMessages('practice', ctxOf(big), ['codeExamples'], {});
  assert.equal(mb.maxTokens, 8000, 'never above what the server allows');

  /* A3. with existing code findings they ride along as context, and those fields start chosen */
  const sb = session(content({ code: BAD_CODE }));
  const rep = CC.codeReport(sb), tb = CC.repairTargets(sb);
  assert.ok(rep.open && tb.find(x => x.key === 'codeExamples').open && tb.find(x => x.key === 'codeExamples').findings > 0);
  const mf = CC.buildRepairMessages('practice', ctxOf(sb), ['codeExamples'], { findings: rep.findings });
  assert.match(mf.prompt, /Problems found by the automatic code checks/); assert.match(mf.prompt, /Code examples 1 · Code, line \d+/);
}

(async () => {
  /* A4. generation: the stub provider (Groq) answers; the answer is shaped, only requested fields count */
  const s0 = session(content());
  const ctx0 = ctxOf(s0);
  const asked = [];
  const stub = v => async o => { asked.push(o); return answerOf(typeof v === 'function' ? v(o) : v); };

  let r = await CC.generateRepair(stub({ quiz: QUIZ_FIXED, homework: { title: 'NOT ASKED FOR' } }), 'assess', ctx0, ['quiz'], { instructions: 'options lost ()' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(Object.keys(r.value), ['quiz'], 'a field that was not requested is dropped even if the AI sends it');
  assert.equal(asked.length, 1); assert.equal(asked[0].json, true); assert.equal(r.meta.provider, 'groq'); assert.equal(r.meta.model, 'openai/gpt-oss-120b');
  assert.deepEqual(r.value.quiz[0].options, ['df.head()', 'df.info()', 'df.shape', 'df.describe()']);

  /* A5. the proposal covers the chosen fields only; nothing in the content changes */
  const frozen = JSON.stringify(s0.content);
  const p = CC.makeProposal(s0.content, 'assess', r.value, r.meta, { id: 'RP1', by: 'U1', at: T(2), instructions: 'options lost ()', scope: ['quiz'] });
  assert.equal(JSON.stringify(s0.content), frozen, 'making a proposal changes nothing');
  assert.deepEqual(p.scope, ['quiz']); assert.deepEqual(p.requested, ['quiz']); assert.equal(p.provider, 'groq');
  const c1 = CC.addProposal(s0.content, p);
  assert.deepEqual(CC.PARTS.flatMap(x => CC.FIELDS_OF(x)).map(k => c1[k]), CC.PARTS.flatMap(x => CC.FIELDS_OF(x)).map(k => s0.content[k]), 'storing it changes no field');
  assert.equal(c1.meta.approved, undefined, 'and approves nothing');
  const ch = CC.proposalChanges(c1, p);
  assert.deepEqual(ch.map(x => x.key), ['quiz'], 'only the chosen field is offered; homework and notes are not "removed"');
  assert.equal(ch[0].change, 'changed'); assert.deepEqual(ch[0].review, [], 'fixing brackets only: nothing to look at twice');
  // Before / After: the changed lines are what the page highlights, the unchanged ones are folded
  const rows = CC.diffRows(CC.diffLines(CC.fieldLines('quiz', ch[0].before), CC.fieldLines('quiz', ch[0].after)));
  assert.ok(rows.some(x => x.k === 'chg' && /df\.head$/.test(x.l || '') && /df\.head\(\)$/.test(x.r || '')), 'the old and the new option sit side by side');

  /* A6. accept some fields, keep the rest; approval withdrawn; history; restore */
  const approved = clone(c1); approved.meta.approved = { by: 'U9', at: T(1) };
  const ap = CC.applyProposal(approved, p, ['quiz'], { by: 'U1', at: T(3) });
  assert.ok(ap.changed); assert.deepEqual(ap.applied, ['quiz']);
  assert.deepEqual(ap.content.quiz, QUIZ_FIXED, 'the accepted field is replaced');
  assert.deepEqual(ap.content.homework, approved.homework, 'every other field is as it was');
  assert.equal(ap.content.meta.approved, undefined, 'applying withdraws the approval');
  assert.equal(ap.entry.approvalWithdrawn, true); assert.equal(ap.content.meta.history[0].kind, 'repair');
  assert.equal(CC.pendingOf(ap.content).length, 0, 'the proposal is spent');
  const back = CC.restoreEntry(ap.content, ap.entry.id, { by: 'U1', at: T(4) });
  assert.deepEqual(back.content.quiz, QUIZ_DAMAGED, 'restore puts the original text back');
  assert.equal(back.content.meta.approved, undefined, 'and never approves');
  // rejecting leaves the content untouched
  const rj = CC.rejectProposal(c1, 'RP1', { by: 'U1', at: T(3) });
  assert.deepEqual(rj.content.quiz, QUIZ_DAMAGED); assert.equal(CC.pendingOf(rj.content).length, 0); assert.equal(rj.content.meta.history[0].kind, 'rejected');
  // choosing nothing applies nothing
  assert.equal(CC.applyProposal(c1, p, [], { by: 'U1', at: T(3) }).changed, false);

  /* A7. a person's edit while the AI worked: not replaced without an explicit choice */
  const edit = CC.applyEdit(c1, { quiz: [...QUIZ_DAMAGED.slice(0, 3), { question: 'Mine?', options: ['a()', 'b()'], answer: 0, explanation: 'Mine.' }] }, 'U2', T(3));
  assert.ok(edit.changed);
  const chE = CC.proposalChanges(edit.content, p)[0];
  assert.equal(chE.conflict, true); assert.equal(chE.edited, true);
  const refused = CC.applyProposal(edit.content, p, ['quiz'], { by: 'U1', at: T(4) });
  assert.equal(refused.changed, false, 'a stale apply is refused'); assert.deepEqual(refused.skipped, [{ key: 'quiz', reason: 'changed' }]);
  assert.deepEqual(refused.content.quiz, edit.content.quiz, 'the person\'s text stays');
  const forced = CC.applyProposal(edit.content, p, ['quiz'], { by: 'U1', at: T(4), force: ['quiz'] });
  assert.ok(forced.changed && forced.entry.forced.includes('quiz'), 'only an explicit choice replaces it, and the history says so');
  assert.deepEqual(CC.restoreEntry(forced.content, forced.entry.id, { by: 'U1', at: T(5) }).content.quiz, edit.content.quiz, 'and the person\'s version can be restored');
  // an edit to a field that was NOT chosen is no conflict and survives the apply
  const edG = CC.applyEdit(c1, { guided: [{ title: 'Guided (mine)', instructions: 'My text.', steps: ['a', 'b', 'c'], hint: 'h', solution: 'x' }] }, 'U2', T(3));
  const apG = CC.applyProposal(edG.content, p, ['quiz'], { by: 'U1', at: T(4) });
  assert.ok(apG.changed && apG.content.guided[0].title === 'Guided (mine)', 'manual edits elsewhere are preserved');

  /* A8. uncertain changes are flagged for a person; the checks never claim they are right */
  const wrongAnswer = clone(QUIZ_FIXED); wrongAnswer[1].options[0] = 'plt.draw()'; // the correct answer's text changed
  const pw = CC.makeProposal(s0.content, 'assess', { quiz: wrongAnswer }, info, { id: 'RPW', at: T(2), scope: ['quiz'] });
  assert.ok(CC.proposalChanges(s0.content, pw)[0].review.some(x => /correct answer changed in question 2/.test(x)), 'a changed correct answer must be checked');
  const moved = clone(QUIZ_FIXED); moved[0].answer = 2;
  assert.ok(CC.proposalChanges(s0.content, CC.makeProposal(s0.content, 'assess', { quiz: moved }, info, { id: 'RPM', at: T(2), scope: ['quiz'] }))[0].review.some(x => /question 1/.test(x)), 'a moved answer position too');
  const fewer = CC.makeProposal(s0.content, 'assess', { quiz: QUIZ_FIXED.slice(0, 2) }, info, { id: 'RPF', at: T(2), scope: ['quiz'] });
  const rf = CC.proposalChanges(s0.content, fewer)[0].review.join(' ');
  assert.match(rf, /number of items changed: 4 before, 2 after/); assert.match(rf, /incomplete/);
  const retitled = clone(clone(s0.content).lesson); retitled[0].heading = 'Something else';
  assert.ok(CC.proposalChanges(s0.content, CC.makeProposal(s0.content, 'lesson', { lesson: retitled }, info, { id: 'RPH', at: T(2), scope: ['lesson'] }))[0].review.some(x => /heading or title changed in item 1/.test(x)));
  const shrunk = clone(s0.content.lesson); shrunk.forEach(x => { x.body = 'Short.'; });
  assert.ok(CC.proposalChanges(s0.content, CC.makeProposal(s0.content, 'lesson', { lesson: shrunk }, info, { id: 'RPS', at: T(2), scope: ['lesson'] }))[0].review.some(x => /length changed a lot/.test(x)));
  const stillBad = CC.makeProposal(s0.content, 'practice', { codeExamples: [{ title: 'Example 1', language: 'python', code: BAD_CODE, explanation: 'Read it.' }] }, info, { id: 'RPB', at: T(2), scope: ['codeExamples'] });
  assert.ok(CC.proposalChanges(s0.content, stillBad)[0].review.some(x => /still has \d+ code problem/.test(x)), 'syntax that is still wrong is flagged');
  const redacted = clone(QUIZ_FIXED); redacted[0].explanation = '[redacted]';
  assert.ok(CC.proposalChanges(s0.content, CC.makeProposal(s0.content, 'assess', { quiz: redacted }, info, { id: 'RPR', at: T(2), scope: ['quiz'] }))[0].review.some(x => /redacted/.test(x)));

  /* A9. Python code and indentation repair: the same checks, before → after */
  const sc = session(content({ code: BAD_CODE }));
  const rc = await CC.generateRepair(stub({ codeExamples: [{ title: 'Example 1', language: 'python', code: GOOD_CODE, explanation: 'Read it.' }, { title: 'Example 2', language: 'python', code: OK_CODE, explanation: 'Tables.' }] }), 'practice', ctxOf(sc), ['codeExamples'], { findings: CC.codeReport(sc).findings });
  assert.ok(rc.ok && !rc.meta.codeChecks, 'the repaired code passes the checks');
  const pc = CC.makeProposal(sc.content, 'practice', rc.value, rc.meta, { id: 'RPC', at: T(2), scope: ['codeExamples'] });
  assert.ok(pc.checks.before > 0 && pc.checks.after === 0, JSON.stringify(pc.checks));
  assert.deepEqual(CC.proposalChanges(sc.content, pc)[0].review, [], 'a clean indentation fix needs no extra warning');
  // code that is still wrong after the answer gets one more try with the problem named, and is flagged if it stays wrong
  asked.length = 0;
  const rr = await CC.generateRepair(stub(() => ({ codeExamples: [{ title: 'Example 1', language: 'python', code: BAD_CODE, explanation: 'x' }] })), 'practice', ctxOf(sc), ['codeExamples'], {});
  assert.equal(asked.length, 2); assert.match(asked[1].prompt, /still had code problems/); assert.ok(rr.ok && rr.meta.codeChecks.errors > 0, 'kept, and marked as having errors');

  /* A10. failures: reported, nothing changes, no retry where a retry cannot help */
  let n = 0;
  const failing = code => async () => { n++; throw Object.assign(new Error('boom'), { code }); };
  n = 0; let f = await CC.generateRepair(failing('not_configured'), 'assess', ctx0, ['quiz'], {});
  assert.deepEqual([f.ok, f.code, n], [false, 'not_configured', 1], 'a missing key is not retried');
  n = 0; f = await CC.generateRepair(failing('provider'), 'assess', ctx0, ['quiz'], {});
  assert.deepEqual([f.ok, f.code, n], [false, 'provider', 2], 'a provider error gets one more try');
  n = 0; f = await CC.generateRepair(failing('provider_quota'), 'assess', ctx0, ['quiz'], {});
  assert.deepEqual([f.ok, n], [false, 1], 'a used-up quota stops at once');
  f = await CC.generateRepair(async () => ({ text: 'not json', tokens: 5 }), 'assess', ctx0, ['quiz'], {});
  assert.equal(f.code, 'invalid_json'); assert.equal(f.tokens, 10, 'and its cost is known');
  f = await CC.generateRepair(stub({ homework: { title: 'x' } }), 'assess', ctx0, ['quiz'], {});
  assert.equal(f.code, 'invalid_answer', 'an answer without any requested field is no answer');
  const cfail = CC.noteRepairFailure(s0.content, 'assess', { code: 'provider', message: 'Groq could not repair this.', at: T(1), tokens: 10, calls: 2, ms: 3 });
  assert.deepEqual(cfail.quiz, QUIZ_DAMAGED, 'a failure leaves the text alone'); assert.equal(cfail.meta.repairs.spent.calls, 2);

  /* A11. a long answer for several fields is asked again one field at a time */
  asked.length = 0;
  const both = session(content());
  const multi = await CC.generateRepair(async o => { asked.push(o); const two = /"codeExamples"[\s\S]*"guided"/.test(o.system); return two ? { text: '{"codeExam', tokens: 100, truncated: true, provider: 'groq', model: 'm' } : answerOf(/"guided"/.test(o.system) ? { guided: both.content.guided } : { codeExamples: both.content.codeExamples }); }, 'practice', ctxOf(both), ['codeExamples', 'guided'], {});
  assert.ok(multi.ok, JSON.stringify(multi)); assert.deepEqual(Object.keys(multi.value).sort(), ['codeExamples', 'guided']); assert.equal(asked.length, 3); assert.equal(multi.meta.calls, 3);
  asked.length = 0;
  const single = await CC.generateRepair(async o => { asked.push(o); return { text: '{"quiz', tokens: 1, truncated: true }; }, 'assess', ctx0, ['quiz'], {});
  assert.deepEqual([single.ok, single.code, asked.length], [false, 'truncated', 1], 'one cut-off field is not asked again unchanged');

  /* A12. requests are sized to what the provider can answer */
  const bigC = content(); bigC.lesson = Array.from({ length: 6 }, (_, i) => ({ heading: 'H' + i, body: 'x'.repeat(4000), example: 'y'.repeat(1500) }));
  const batches = CC.repairBatches(bigC, ['lesson', 'quiz', 'homework', 'keyTerms', 'objectives']);
  assert.ok(batches.every(b => b.keys.every(k => CC.SCHEMA[k].part === b.part)), 'a request never mixes parts');
  assert.ok(batches.filter(b => b.chars > 11000).every(b => b.keys.length === 1), 'only one field alone may be longer than a request');
  assert.deepEqual(batches.find(b => b.part === 'assess').keys, ['homework', 'quiz'], 'small fields of a part share one request');
  const huge = content(); huge.codeExamples = Array.from({ length: 5 }, (_, i) => ({ title: 'E' + i, language: 'python', code: ('x = 1\n').repeat(450), explanation: 'e' })); huge.guided = Array.from({ length: 5 }, (_, i) => ({ title: 'G' + i, instructions: 'i'.repeat(1900), steps: ['a', 'b', 'c'], hint: 'h', solution: 's'.repeat(1500) }));
  assert.ok(CC.repairBatches(huge, ['codeExamples', 'guided', 'tutorials']).length >= 2, 'text that is too long for one answer is split over requests');
  assert.deepEqual(CC.repairBatches(huge, ['quiz']).map(b => b.keys), [['quiz']]);

  /* A13. a second repair on other fields of the same part keeps the first proposal's fields */
  const pa = CC.makeProposal(s0.content, 'practice', { guided: practicePart().guided }, info, { id: 'RPA', at: T(2), scope: ['guided'] });
  const withA = CC.addProposal(s0.content, pa);
  const pb = CC.makeProposal(withA, 'practice', { tutorials: practicePart().tutorials }, info, { id: 'RPB2', at: T(3), scope: ['tutorials'] });
  const both2 = CC.pendingOf(CC.addProposal(withA, pb));
  assert.equal(both2.length, 1, 'one proposal per part'); assert.deepEqual(both2[0].scope.sort(), ['guided', 'tutorials']); assert.deepEqual(both2[0].carried, ['guided']);
  assert.equal(both2[0].base.fields.guided, pa.base.fields.guided, 'fingerprints of the carried field are the old ones');
  // a proposal for a different part is kept next to it
  const other = CC.addProposal(CC.addProposal(s0.content, pa), CC.makeProposal(s0.content, 'assess', { quiz: QUIZ_FIXED }, info, { id: 'RPQ', at: T(3), scope: ['quiz'] }));
  assert.deepEqual(CC.pendingOf(other).map(x => x.part).sort(), ['assess', 'practice']);

  /* A14. a proposal survives a reload (stored JSON) and still compares the same */
  const reloaded = JSON.parse(JSON.stringify(c1));
  assert.deepEqual(CC.proposalChanges(reloaded, CC.pendingOf(reloaded)[0]).map(x => [x.key, x.change, x.conflict]), [['quiz', 'changed', false]]);

  /* ===================================================== B. runner + client + server, Groq stubbed */
  const app = express(); app.use(ai);
  const srv = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const BASE = 'http://127.0.0.1:' + srv.address().port, realFetch = global.fetch, GROQ = 'https://api.groq.com/openai/v1', KEY = 'gsk_test_only_not_a_real_key_5678';
  const sent = [];
  const MODELS = [{ id: 'openai/gpt-oss-120b', object: 'model', owned_by: 'OpenAI', active: true, context_window: 131072, max_completion_tokens: 65536 }];
  const okChat = (content, model) => ({ status: 200, json: { id: 'c1', model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200, total_time: 1.1 } } });
  let groqChat = async req => okChat(JSON.stringify({ quiz: QUIZ_FIXED }), req.body.model), geminiCalls = 0, openaiCalls = 0;
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith(BASE)) return realFetch(url, opts);
    const req = { url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null };
    sent.push(req);
    let out;
    if (url === GROQ + '/models') out = { status: 200, json: { object: 'list', data: MODELS } };
    else if (url === GROQ + '/chat/completions') out = await groqChat(req);
    else if (url.startsWith('https://generativelanguage.googleapis.com/')) { geminiCalls++; out = { status: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ quiz: QUIZ_FIXED }) }] }, finishReason: 'STOP' }] } }; }
    else if (url.startsWith('https://api.openai.com/')) { openaiCalls++; out = { status: 200, json: { choices: [{ message: { content: JSON.stringify({ quiz: QUIZ_FIXED }) }, finish_reason: 'stop' }], usage: { total_tokens: 3 } } }; }
    else out = { status: 599, json: { error: { message: 'unexpected host ' + url } } };
    return { ok: out.status < 400, status: out.status, headers: { get: () => null }, json: async () => out.json };
  };
  const post = async (p, body, token) => { const r = await realFetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const tokenOf = async id => (await realFetch(BASE + '/api/ai/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) }).then(r => r.json())).token;

  /* B1. the server: an explicit request never leaves its provider */
  process.env.GEMINI_API_KEY = 'test-not-a-real-key'; process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite'; process.env.OPENAI_API_KEY = 'sk-test-not-real';
  const tk = await tokenOf('U-coord-r1');
  const base = { feature: 'contentRepair', prompt: 'x', provider: 'groq', model: 'openai/gpt-oss-120b', fallbackProvider: 'gemini', primaryProvider: 'openai', json: true };
  let res = await post('/api/ai/complete', { ...base, noFallback: true }, tk);
  assert.equal(res.status, 400); assert.equal(res.body.code, 'not_configured'); assert.match(res.body.error, /Groq has no API key saved/); assert.match(res.body.error, /Another provider was not used/);
  assert.deepEqual([geminiCalls, openaiCalls, sent.length], [0, 0, 0], 'Groq is not set up: nothing was sent to any provider');
  res = await post('/api/ai/complete', { ...base }, tk);
  assert.equal(res.status, 200, 'without the flag the old behaviour (fallback) is unchanged'); assert.equal(res.body.provider, 'gemini'); assert.equal(geminiCalls, 1);
  geminiCalls = 0; sent.length = 0;
  process.env.GROQ_API_KEY = KEY; ai._test.resetGroq();
  groqChat = async () => ({ status: 500, json: { error: { message: 'Internal error' } } });
  res = await post('/api/ai/complete', { ...base, noFallback: true }, tk);
  assert.ok(res.status >= 500 && res.body.code !== undefined || res.status >= 400, JSON.stringify(res));
  assert.deepEqual([geminiCalls, openaiCalls], [0, 0], 'Groq failed: no other provider was tried');
  assert.ok(sent.every(x => x.url.startsWith(GROQ)));
  groqChat = async req => okChat(JSON.stringify({ quiz: QUIZ_FIXED }), req.body.model);
  res = await post('/api/ai/complete', { ...base, noFallback: true }, tk);
  assert.equal(res.status, 200); assert.equal(res.body.provider, 'groq'); assert.equal(res.body.model, 'openai/gpt-oss-120b');
  assert.ok(!JSON.stringify(res.body).includes(KEY), 'the key is never in an answer');

  /* B2. the real runner in a browser-like context, with the real client and Settings → Integrations routing */
  const store = {};
  const ctx = {
    console, URL, URLSearchParams, Intl, Blob: class {}, Event: class { constructor(t) { this.type = t; } }, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; return a; } },
    document: { querySelector: () => null }, location: {}, fetch: (u, o) => realFetch(String(u).startsWith('/') ? BASE + u : u, o)
  };
  ctx.window = ctx; ctx.window.addEventListener = () => {}; ctx.window.dispatchEvent = () => {};
  vm.createContext(ctx);
  vm.runInContext(['seed.js', 'migrations.js', 'shared-rules.js', 'core.js', 'ai-client.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join(';\n') + ';globalThis.__x={db,saveDB,Domain,invalidateCache}', ctx);
  const { db, saveDB, Domain } = ctx.__x;
  ctx.can = () => true;
  store.sdcCloudToken = await tokenOf('U-coord-r2');
  const d0 = db(); d0.settings.integrations.capabilities.contentRepair = { ...d0.settings.integrations.capabilities.contentRepair, provider: 'groq', model: 'openai/gpt-oss-120b', profileId: '' };
  d0.settings.integrations.fallbackProvider = 'gemini'; // the organisation's general fallback is ON: a repair must still ignore it
  d0.settings.integrations.primaryProvider = 'openai';
  d0.settings.integrations.budget = { ...d0.settings.integrations.budget, maxCalls: 0, hardStop: false }; // the temp usage file grows with every test run; the budget is not what this test is about
  saveDB(d0);
  assert.deepEqual([Domain.aiCapRoute('contentRepair').provider, Domain.aiCapRoute('contentRepair').model], ['groq', 'openai/gpt-oss-120b']);

  const data = { courses: [clone(course)], sessions: [{ ...session(content()), content: content() }] };
  let failSave = 0;
  const features = [];
  const box = {
    CourseContentLogic: CC, CodeCheckLogic: CK, console, Map, Set, Promise, Date, JSON, Math, Number, String, Object, Array, Error,
    setTimeout: fn => setImmediate(fn), clearTimeout() {}, window: { addEventListener() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    t: x => x, esc: v => String(v ?? ''), clone, icon: () => '', badge: x => '[' + x + ']', kind: () => 'staff',
    findRecord: (k, id) => data[k].find(x => x.id === id),
    updateRecord: (k, id, patch) => { if (failSave > 0) { failSave--; throw new Error('QuotaExceededError'); } const i = data[k].findIndex(x => x.id === id); data[k][i] = clone({ ...data[k][i], ...patch, id }); return data[k][i]; },
    Domain: { courseSessions: id => data.sessions.filter(s => s.courseId === id), canManageCourse: () => true, aiCapRoute: n => Domain.aiCapRoute(n), integrations: () => Domain.integrations() },
    SDCAI: { call: (f, o) => { features.push(f); return ctx.SDCAI.call(f, o); }, status: () => ctx.SDCAI.status() }
  };
  vm.createContext(box);
  require('./support/provider-box')(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'pages-coursecontent.js'), 'utf8') + '\n;this.TCRun = TCRun;', box);
  const finished = id => new Promise(resolve => { const off = box.TCRun.on(run => { if (run.courseId === id && !run.active) { off(); resolve(run); } }); });
  const jobFor = (keysByPart, instructions = '') => ({ sessionId: 'S-PY1', parts: Object.keys(keysByPart), instructions, repairKeys: keysByPart, repairParts: Object.keys(keysByPart), proposeParts: Object.keys(keysByPart) });
  const before = () => JSON.stringify(CC.PARTS.flatMap(p => CC.FIELDS_OF(p)).map(k => data.sessions[0].content[k])); // every content field, not the notes about repairs
  const repairs = () => sent.filter(x => x.url === GROQ + '/chat/completions');

  // the page asks which provider will be used, and whether it has a key (never the key itself)
  let route = await box.tcRepairRoute();
  assert.deepEqual([route.provider, route.label, route.model, route.configured], ['groq', 'Groq', 'openai/gpt-oss-120b', true]);
  assert.ok(!JSON.stringify(route).includes(KEY));

  /* B3. repair with no automatic finding, through Groq only, as a proposal */
  sent.length = 0; geminiCalls = 0; openaiCalls = 0;
  const content0 = before();
  assert.deepEqual(CC.codeReport(data.sessions[0]).findings.filter(f => f.field === 'quiz'), [], 'nothing was flagged automatically');
  box.TCRun.start('C-PY', [jobFor({ assess: ['quiz'] }, 'The quiz options lost their () after method names.')]);
  let run = await finished('C-PY');
  assert.ok(!run.fatal, run.fatal);
  assert.deepEqual(features, ['contentRepair'], 'the contentRepair capability, not the generation one');
  assert.equal(repairs().length, 1); assert.ok(sent.every(x => x.url.startsWith(GROQ)), 'only Groq was called');
  assert.deepEqual([geminiCalls, openaiCalls], [0, 0], 'no other provider, although the organisation fallback is Gemini');
  const rq = repairs()[0];
  assert.equal(rq.headers.Authorization, 'Bearer ' + KEY); assert.equal(rq.body.model, 'openai/gpt-oss-120b'); assert.deepEqual(rq.body.response_format, { type: 'json_object' });
  const userMsg = rq.body.messages.at(-1).content;
  assert.ok(userMsg.includes('Which call shows the first five rows'), 'the current text was sent'); assert.ok(userMsg.includes('lost their () after method names'), 'and the description');
  assert.equal(before(), content0, 'the course content is exactly as it was');
  const waiting = CC.pendingOf(data.sessions[0].content);
  assert.equal(waiting.length, 1); assert.deepEqual(waiting[0].scope, ['quiz']); assert.deepEqual([waiting[0].provider, waiting[0].model, waiting[0].status], ['groq', 'openai/gpt-oss-120b', 'pending']);
  assert.deepEqual(data.sessions[0].content.quiz, QUIZ_DAMAGED);
  assert.deepEqual(run.jobs[0].proposed, ['assess']);

  /* B4. the person accepts the quiz: saved, approval withdrawn, history, restore */
  data.sessions[0].content.meta.approved = { by: 'U9', at: T(1) };
  const acc = CC.applyProposal(data.sessions[0].content, CC.pendingOf(data.sessions[0].content)[0], ['quiz'], { by: 'U1', at: T(5) });
  box.updateRecord('sessions', 'S-PY1', { content: acc.content });
  assert.deepEqual(data.sessions[0].content.quiz, QUIZ_FIXED); assert.equal(data.sessions[0].content.meta.approved, undefined);
  const hist = CC.historyOf(data.sessions[0].content)[0];
  assert.deepEqual([hist.kind, hist.provider, hist.model, hist.approvalWithdrawn], ['repair', 'groq', 'openai/gpt-oss-120b', true]);
  box.updateRecord('sessions', 'S-PY1', { content: CC.restoreEntry(data.sessions[0].content, hist.id, { by: 'U1', at: T(6) }).content });
  assert.deepEqual(data.sessions[0].content.quiz, QUIZ_DAMAGED, 'restore');

  /* B5. Groq fails: reported, nothing changed, no other provider */
  sent.length = 0; geminiCalls = 0; openaiCalls = 0; features.length = 0;
  groqChat = async () => ({ status: 500, json: { error: { message: 'Internal error' } } });
  const c5 = before();
  box.TCRun.start('C-PY', [jobFor({ assess: ['quiz'] })]);
  run = await finished('C-PY');
  assert.equal(before(), c5, 'no field changed; only a failure note was added');
  assert.deepEqual(data.sessions[0].content.quiz, QUIZ_DAMAGED);
  assert.deepEqual([geminiCalls, openaiCalls], [0, 0], 'no automatic switch to Gemini or OpenAI');
  const err = data.sessions[0].content.meta.repairs.errors.assess;
  assert.match(err.message, /^Groq could not repair this/); assert.match(err.message, /No other provider was tried/);
  assert.ok(run.jobs[0].errors.length === 1 && run.jobs[0].state === 'failed');

  /* B6. no Groq key: clear setup instructions, nothing sent, the run stops */
  delete process.env.GROQ_API_KEY; ai._test.resetGroq(); sent.length = 0; geminiCalls = 0; openaiCalls = 0;
  route = await box.tcRepairRoute('C-PY'); assert.deepEqual([route.provider, route.configured], ['groq', false], 'the page can tell before spending anything');
  box.TCRun.start('C-PY', [jobFor({ assess: ['quiz'] })]);
  run = await finished('C-PY');
  assert.ok(run.fatal && /Groq has no API key saved/.test(run.fatal) && /Settings → Integrations/.test(run.fatal), run.fatal);
  assert.deepEqual([sent.length, geminiCalls, openaiCalls], [0, 0, 0], 'nothing was sent anywhere');
  assert.deepEqual(data.sessions[0].content.quiz, QUIZ_DAMAGED);

  /* B7. several fields of one session, two parts: one proposal per part, independent of each other */
  process.env.GROQ_API_KEY = KEY; ai._test.resetGroq(); sent.length = 0;
  data.sessions[0].content = content({ code: BAD_CODE });
  groqChat = async req => {
    const sys = req.body.messages[0].content;
    return okChat(JSON.stringify(/"quiz"/.test(sys) ? { quiz: QUIZ_FIXED } : { codeExamples: [{ title: 'Example 1', language: 'python', code: GOOD_CODE, explanation: 'Read it.' }, { title: 'Example 2', language: 'python', code: OK_CODE, explanation: 'Tables.' }] }), req.body.model);
  };
  box.TCRun.start('C-PY', [jobFor({ practice: ['codeExamples'], assess: ['quiz'] })]);
  run = await finished('C-PY');
  assert.ok(!run.fatal, run.fatal); assert.equal(repairs().length, 2);
  assert.deepEqual(CC.pendingOf(data.sessions[0].content).map(x => x.part).sort(), ['assess', 'practice']);
  assert.ok(repairs()[0].body.messages.at(-1).content.includes('Problems found by the automatic code checks'), 'the existing finding went along as context');
  assert.ok(CC.codeReport(data.sessions[0]).open, 'still flagged until a person accepts');

  /* B8. the browser could not store the proposal: the run stops, no more requests are spent */
  failSave = 1; sent.length = 0; data.sessions[0].content = content();
  box.TCRun.start('C-PY', [jobFor({ assess: ['quiz'], practice: ['guided'] })]);
  run = await finished('C-PY');
  assert.ok(run.fatal && /Could not store this in the browser/.test(run.fatal), run.fatal);
  assert.equal(repairs().length, 1, 'the second part was never requested'); assert.deepEqual(data.sessions[0].content.quiz, QUIZ_DAMAGED);

  global.fetch = realFetch; srv.close();
  console.log('fieldrepair.test.js: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
