/* SDC Learn — "Repair with AI" workflow, pure rules (js/coursecontent-logic.js).
   Detect → proposal → before/after → accept or reject per field → save, with history and restore.
   The AI's text must never reach the content before a person accepts it, and a field that changed while
   the AI was working must never be replaced silently. */
const assert = require('assert');
const CC = require('../js/coursecontent-logic.js');
const clone = v => JSON.parse(JSON.stringify(v));

const BAD = 'def total(items):\nresult = 0\nfor i in items:\nresult += i\nreturn result';
const GOOD = 'def total(items):\n    result = 0\n    for i in items:\n        result += i\n    return result\n\nprint(total([1, 2, 3]))';
const OK2 = 'import pandas as pd\n\ndf = pd.DataFrame({"a": [1, 2]})\nprint(df.head())';
const practice = (code0, extra = {}) => ({
  codeRelevant: true,
  tutorials: [{ title: 'Tutorial', goal: 'Follow along', steps: ['Open the editor.', 'Run it.', 'Change one value.'] }],
  codeExamples: [{ title: 'Example 1', language: 'python', code: code0, explanation: 'Read it.' }, { title: 'Example 2', language: 'python', code: OK2, explanation: 'Tables.' }],
  demos: [{ title: 'Demo', description: 'Show it live.', steps: ['a', 'b', 'c'] }],
  guided: [{ title: 'Guided', instructions: 'With help.', steps: ['a', 'b', 'c'], hint: 'Start small.', solution: '```python\n' + OK2 + '\n```' }],
  practice: [{ title: 'Task', task: 'Alone.', criteria: ['Runs'] }], ...extra
});
const lesson = () => ({ objectives: ['One', 'Two'], prerequisites: ['None'], timePlan: [{ minutes: 60, activity: 'All' }, { minutes: 60, activity: 'More' }], lesson: [1, 2, 3].map(i => ({ heading: 'H' + i, body: 'Body ' + i, example: '' })) });
const base = (extra = {}) => ({ v: 1, ...lesson(), ...practice(BAD), meta: { parts: { lesson: { at: 't1', provider: 'gemini', model: 'g', tokens: 10, calls: 1, ms: 5 }, practice: { at: 't1', provider: 'gemini', model: 'g', tokens: 20, calls: 1, ms: 9 } }, ...extra } });
const info = { provider: 'groq', model: 'llama', tokens: 300, calls: 1, ms: 800 };
const T = n => '2026-10-16T10:0' + n + ':00.000Z';

/* ---- A. detect → proposal: the content is not touched */
const s0 = { id: 'S1', content: base() };
assert.ok(CC.codeReport(s0).open, 'the broken code is detected');
const plan = CC.repairPlan(s0);
assert.deepEqual(plan.parts, ['practice']);
const frozen = JSON.stringify(s0.content);
const p = CC.makeProposal(s0.content, 'practice', practice(GOOD), info, { id: 'RP1', by: 'U1', at: T(1), instructions: plan.instructions });
assert.equal(JSON.stringify(s0.content), frozen, 'making a proposal does not touch the content');
assert.equal(p.status, 'pending'); assert.equal(p.part, 'practice'); assert.equal(p.provider, 'groq');
assert.ok(p.checks.before > 0 && p.checks.after === 0, 'the proposal records the code checks before and after: ' + JSON.stringify(p.checks));
let c1 = CC.addProposal(s0.content, p);
assert.deepEqual(c1.codeExamples, s0.content.codeExamples, 'storing the proposal leaves every field as it was');
assert.equal(CC.pendingOf(c1).length, 1); assert.equal(c1.meta.repairs.spent.tokens, 300, 'the cost of the request is remembered');
assert.deepEqual(CC.codeReport({ content: c1 }).findings, CC.codeReport(s0).findings, 'the findings are the same until a person accepts');
assert.deepEqual(CC.sessionState({ content: c1 }), CC.sessionState(s0), 'a pending proposal changes no status');
// a newer answer for the same part replaces the pending one, a different part is kept next to it
const p2 = CC.makeProposal(s0.content, 'practice', practice(GOOD), info, { id: 'RP2', by: 'U1', at: T(2) });
assert.deepEqual(CC.pendingOf(CC.addProposal(c1, p2)).map(x => x.id), ['RP2']);
assert.equal(CC.addProposal(c1, p2).meta.repairs.spent.tokens, 600);
const pl = CC.makeProposal(s0.content, 'lesson', lesson(), info, { id: 'RPL', at: T(2) });
assert.deepEqual(CC.pendingOf(CC.addProposal(c1, pl)).map(x => x.id), ['RP1', 'RPL']);
// a failed request changes no content and is remembered
const cf = CC.noteRepairFailure(s0.content, 'practice', { code: 'provider_quota', message: 'quota', at: T(1), tokens: 5, calls: 1, ms: 2 });
assert.deepEqual(cf.codeExamples, s0.content.codeExamples); assert.equal(cf.meta.repairs.errors.practice.code, 'provider_quota'); assert.equal(cf.meta.repairs.spent.calls, 1);
assert.equal(CC.addProposal(cf, p).meta.repairs.errors, undefined, 'a new proposal clears the old error');

/* ---- B. field-level comparison */
const ch = CC.proposalChanges(c1, p), by = k => ch.find(x => x.key === k);
assert.deepEqual(ch.map(x => x.key), ['codeRelevant', 'tutorials', 'codeExamples', 'demos', 'guided', 'practice']);
assert.equal(by('codeExamples').change, 'changed'); assert.equal(by('tutorials').change, 'same', 'identical fields are not offered');
assert.ok(by('codeExamples').checks.before > 0 && by('codeExamples').checks.after === 0, 'per field: code checks before → after');
assert.ok(ch.every(x => !x.conflict), 'nothing changed since the AI was shown');
const lines = CC.fieldLines('codeExamples', c1.codeExamples);
assert.ok(lines.includes('1.') && lines.some(l => /Title: Example 1/.test(l)), 'a field is shown as readable lines');
assert.ok(lines.includes('    result = 0'), 'code lines are shown as stored (here the broken, unindented line), under their label');
const ops = CC.diffLines(CC.fieldLines('codeExamples', c1.codeExamples), CC.fieldLines('codeExamples', p.fields.codeExamples));
assert.ok(ops.some(o => o.t === 'del') && ops.some(o => o.t === 'add') && ops.some(o => o.t === 'same'));
assert.deepEqual(ops.filter(o => o.t !== 'add').map(o => o.text), CC.fieldLines('codeExamples', c1.codeExamples), 'the "before" column is exactly the current text');
assert.deepEqual(ops.filter(o => o.t !== 'del').map(o => o.text), CC.fieldLines('codeExamples', p.fields.codeExamples), 'the "after" column is exactly the proposed text');
const rows = CC.diffRows(ops); assert.ok(rows.some(r => r.k === 'chg') && rows.every(r => r.k !== 'chg' || r.l !== undefined || r.r !== undefined));
assert.deepEqual(CC.diffLines(['a', 'b'], ['a', 'b']).map(o => o.t), ['same', 'same']);
assert.deepEqual(CC.diffRows(CC.diffLines(['a'], ['a'])), [{ k: 'gap', n: 1 }]);
assert.deepEqual(CC.fieldLines('quiz', [{ question: 'Q?', options: ['x', 'y'], answer: 1, explanation: 'E' }]).filter(l => /Correct option/.test(l)), ['  Correct option: B']);

/* ---- C. accept: only the chosen fields, approval withdrawn, history kept */
const approved = clone(c1); approved.meta.approved = { by: 'U9', at: T(0) }; approved.meta.codeReview = { by: 'U9', at: T(0), sig: 'x', count: 1 };
const none = CC.applyProposal(approved, p, [], { by: 'U1', at: T(3) });
assert.equal(none.changed, false); assert.deepEqual(none.content, approved, 'accepting nothing changes nothing');
const acc = CC.applyProposal(approved, p, ['codeExamples'], { by: 'U1', at: T(3) });
assert.ok(acc.changed); assert.deepEqual(acc.applied, ['codeExamples']);
assert.deepEqual(acc.content.codeExamples, p.fields.codeExamples, 'the accepted field has the AI text');
assert.deepEqual(acc.content.guided, approved.guided, 'a field that was not accepted keeps the current text'); assert.deepEqual(acc.content.tutorials, approved.tutorials);
assert.equal(acc.content.meta.approved, undefined, 'new text needs a new approval'); assert.equal(acc.content.meta.codeReview, undefined);
assert.equal(CC.pendingOf(acc.content).length, 0, 'the proposal is closed');
assert.deepEqual(CC.codeReport({ content: acc.content }).findings, [], 'and the code now passes the same checks');
assert.equal(acc.content.meta.parts.practice.provider, 'gemini', 'the original generation record stays'); assert.equal(acc.content.meta.parts.practice.repaired.provider, 'groq');
assert.deepEqual(acc.content.meta.parts.practice.repaired.fields, ['codeExamples']);
const h = acc.content.meta.history[0];
assert.equal(h.kind, 'repair'); assert.equal(h.by, 'U1'); assert.equal(h.approvalWithdrawn, true);
assert.deepEqual(h.applied.map(x => x.key), ['codeExamples']); assert.deepEqual(h.applied[0].before, approved.codeExamples, 'the replaced text is kept');
assert.deepEqual(h.rejected, [], 'the fields that were not part of this change are not listed');
assert.deepEqual(approved.codeExamples[0].code, BAD, 'the input is never mutated');
// accepting some of the changed fields lists the rest as rejected
const p3 = CC.makeProposal(s0.content, 'practice', practice(GOOD, { demos: [{ title: 'New demo', description: 'Different.', steps: ['x', 'y', 'z'] }] }), info, { id: 'RP3', at: T(2) });
const c3 = CC.addProposal(s0.content, p3);
const acc3 = CC.applyProposal(c3, p3, ['codeExamples'], { by: 'U1', at: T(3) });
assert.deepEqual(acc3.entry.rejected, ['demos'], 'the field the person declined is recorded'); assert.deepEqual(acc3.content.demos, s0.content.demos);
// a key that is not a change is skipped, not applied
assert.deepEqual(CC.applyProposal(c1, p, ['tutorials'], { by: 'U1', at: T(3) }).skipped, [{ key: 'tutorials', reason: 'nothing' }]);

/* ---- D. reject: nothing changes, the decision is recorded */
const rej = CC.rejectProposal(c1, 'RP1', { by: 'U1', at: T(3) });
assert.ok(rej.changed); assert.deepEqual(rej.content.codeExamples, c1.codeExamples); assert.equal(CC.pendingOf(rej.content).length, 0);
assert.equal(rej.content.meta.history[0].kind, 'rejected'); assert.deepEqual(rej.content.meta.history[0].applied, []);
assert.equal(CC.rejectProposal(rej.content, 'RP1', {}).changed, false, 'rejecting twice is harmless');

/* ---- E. concurrent changes */
// a person edits the examples while the AI is working: the field no longer matches what the AI was shown
const edit = CC.applyEdit(c1, { codeExamples: [{ title: 'Example 1', language: 'python', code: 'print("my own fix")', explanation: 'Mine.' }] }, 'U2', T(2));
assert.ok(edit.changed);
const chE = CC.proposalChanges(edit.content, p);
assert.equal(chE.find(x => x.key === 'codeExamples').conflict, true, 'the edited field is flagged as changed since the AI was shown');
assert.equal(chE.find(x => x.key === 'codeExamples').edited, true, 'and the part is marked as edited by a person');
assert.equal(chE.find(x => x.key === 'guided').conflict, false, 'other fields are not');
const refuse = CC.applyProposal(edit.content, p, ['codeExamples'], { by: 'U1', at: T(4) });
assert.equal(refuse.changed, false); assert.deepEqual(refuse.skipped, [{ key: 'codeExamples', reason: 'changed' }], 'a changed field is not replaced without an explicit choice');
assert.deepEqual(refuse.content.codeExamples[0].code, 'print("my own fix")', 'the person\'s edit is intact');
const forced = CC.applyProposal(edit.content, p, ['codeExamples'], { by: 'U1', at: T(4), force: ['codeExamples'] });
assert.ok(forced.changed); assert.deepEqual(forced.content.codeExamples, p.fields.codeExamples); assert.deepEqual(forced.entry.forced, ['codeExamples']);
assert.deepEqual(forced.entry.applied[0].before[0].code, 'print("my own fix")', 'a forced replacement keeps the person\'s text in the history');
assert.ok(forced.content.meta.edited, 'the part is still marked as edited by a person (it may hold other edits)');
// a different tab regenerated the part meanwhile (different text, edited flag unchanged)
const regen = clone(c1); regen.codeExamples = [{ title: 'Example 1', language: 'python', code: OK2, explanation: 'x' }];
assert.equal(CC.proposalChanges(regen, p).find(x => x.key === 'codeExamples').conflict, true);
// when the current text already equals the proposal there is nothing to apply, and no false conflict
const already = clone(c1); already.codeExamples = clone(p.fields.codeExamples);
assert.equal(CC.proposalChanges(already, p).find(x => x.key === 'codeExamples').change, 'same');
// key order does not matter (the database does not keep it)
const reordered = clone(c1); reordered.codeExamples = reordered.codeExamples.map(e => Object.fromEntries(Object.entries(e).reverse()));
assert.equal(CC.proposalChanges(reordered, p).find(x => x.key === 'codeExamples').conflict, false, 'a reordered copy of the same text is not a conflict');
// a removed field and an added field
const noEx = CC.makeProposal(s0.content, 'practice', (() => { const x = practice(GOOD); delete x.codeExamples; x.codeRelevant = false; return x; })(), info, { id: 'RPR', at: T(2) });
const rmCh = CC.proposalChanges(CC.addProposal(s0.content, noEx), noEx);
assert.equal(rmCh.find(x => x.key === 'codeExamples').change, 'removed');
assert.equal(CC.applyProposal(s0.content, noEx, ['codeExamples'], { at: T(3) }).content.codeExamples, undefined, 'accepting a removal removes the field');
const added = CC.makeProposal({ ...s0.content, keyTerms: undefined }, 'lesson', { ...lesson(), keyTerms: [{ term: 'T', meaning: 'M' }] }, info, { id: 'RPA', at: T(2) });
assert.equal(CC.proposalChanges(s0.content, added).find(x => x.key === 'keyTerms').change, 'added');

/* ---- F. history and restore */
const hist = acc.content;
const plan1 = CC.restorePlan(hist, h.id); assert.deepEqual(plan1.map(x => [x.key, x.conflict]), [['codeExamples', false]]);
const back = CC.restoreEntry(hist, h.id, { by: 'U1', at: T(5) });
assert.ok(back.changed); assert.deepEqual(back.content.codeExamples, approved.codeExamples, 'the replaced text is back, exactly');
assert.equal(back.content.meta.history[0].kind, 'restore'); assert.deepEqual(back.content.meta.history[0].applied[0].before, p.fields.codeExamples, 'a restore keeps what it replaced, so it can be undone');
assert.deepEqual(CC.restoreEntry(back.content, h.id, { at: T(6) }).applied, [], 'an entry is restored once');
const undo = CC.restoreEntry(back.content, back.content.meta.history[0].id, { by: 'U1', at: T(6) });
assert.deepEqual(undo.content.codeExamples, p.fields.codeExamples, 'restoring the restore brings the AI text back');
// restoring withdraws approval like any change of text
const approvedAfter = clone(hist); approvedAfter.meta.approved = { by: 'U9', at: T(4) };
assert.equal(CC.restoreEntry(approvedAfter, h.id, { at: T(5) }).content.meta.approved, undefined);
// restore refuses a field that was changed after the entry unless it is forced
const later = CC.applyEdit(hist, { codeExamples: [{ title: 'Example 1', language: 'python', code: 'print(1)', explanation: 'later' }] }, 'U2', T(5)).content;
assert.equal(CC.restorePlan(later, h.id)[0].conflict, true);
const blocked = CC.restoreEntry(later, h.id, { at: T(6) });
assert.equal(blocked.changed, false); assert.deepEqual(blocked.skipped, [{ key: 'codeExamples', reason: 'changed' }]);
assert.deepEqual(CC.restoreEntry(later, h.id, { at: T(6), force: ['codeExamples'] }).content.codeExamples, approved.codeExamples);
// restoring one field of several
const many = CC.applyProposal(c3, p3, ['codeExamples', 'demos'], { by: 'U1', at: T(3) });
const partial = CC.restoreEntry(many.content, many.entry.id, { at: T(4), keys: ['demos'] });
assert.deepEqual(partial.content.demos, s0.content.demos); assert.deepEqual(partial.content.codeExamples, p3.fields.codeExamples);
assert.deepEqual(CC.restorePlan(partial.content, many.entry.id).map(x => x.key), ['codeExamples'], 'the rest can still be restored');
// a direct regeneration also keeps what it replaced
const regenerated = CC.applyPart(s0.content, 'practice', practice(OK2), { at: T(4), provider: 'groq', model: 'llama', tokens: 1 });
const recorded = CC.recordReplaced(regenerated, s0.content, 'practice', { by: 'U1', at: T(4), provider: 'groq', model: 'llama' });
assert.equal(recorded.meta.history[0].kind, 'regenerate'); assert.deepEqual(recorded.meta.history[0].applied.find(x => x.key === 'codeExamples').before, s0.content.codeExamples);
assert.deepEqual(CC.restoreEntry(recorded, recorded.meta.history[0].id, { at: T(5) }).content.codeExamples, s0.content.codeExamples, 'Regenerate can be undone');
assert.equal(CC.recordReplaced(CC.applyPart({}, 'lesson', lesson(), { at: T(1) }), {}, 'lesson', { at: T(1) }).meta.history, undefined, 'writing a part that did not exist replaces nothing, so no history');
// history is bounded
let big = clone(s0.content);
for (let i = 0; i < 20; i++) { const q = CC.makeProposal(big, 'practice', practice(i % 2 ? GOOD : OK2 + '\n# ' + i), info, { id: 'B' + i, at: T(1) }); big = CC.applyProposal(CC.addProposal(big, q), q, ['codeExamples'], { at: T(2) }).content; }
assert.equal(big.meta.history.length, CC.HISTORY_MAX, 'only the most recent changes are kept');

/* ---- G. code-check notes follow the text they describe */
const cut = base(); cut.meta.parts.practice.cuts = [{ path: 'codeExamples[0].code', kind: 'cut', code: 'partial', max: 8000, from: 9000 }, { path: 'guided[0].solution', kind: 'link-in-code', text: 'x' }];
const pc = CC.makeProposal(cut, 'practice', practice(GOOD), info, { id: 'RPC', at: T(1) });
const accC = CC.applyProposal(CC.addProposal(cut, pc), pc, ['codeExamples'], { at: T(2) });
assert.deepEqual(accC.content.meta.parts.practice.cuts.map(x => x.path), ['guided[0].solution'], 'the cut note of the replaced field is gone, the others stay');
assert.deepEqual(CC.restoreEntry(accC.content, accC.entry.id, { at: T(3) }).content.meta.parts.practice.cuts.map(x => x.path).sort(), ['codeExamples[0].code', 'guided[0].solution'], 'and comes back with the old text');

/* ---- H. usage is counted whether or not the proposal is accepted */
assert.equal(CC.addProposal(CC.addProposal(s0.content, p), p2).meta.repairs.spent.calls, 2);

console.log('repair.test.js: all checks passed');
