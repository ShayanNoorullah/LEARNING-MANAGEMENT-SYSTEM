/* Focused regression for the Course Check's missing saved-content evidence. No network or user data. */
const assert = require('assert'), CC = require('../js/coursecontent-logic');
const course = { title: 'Charts', outcomes: ['Export charts'], aiContent: { proposals: [{ session: 1, topic: 'Figure exporting', instructions: 'Save PNG files', status: 'applied' }] } };
const session = { id: 'qa', title: 'Visualisation', duration: '2h', content: { objectives: ['Build plots'], lesson: [{ heading: 'Charts', body: 'Export a graphic for reports.', example: 'plt.savefig("report.png")' }], codeExamples: [{ title: 'Graphic', code: 'fig.savefig("report.svg")' }], meta: { instructions: 'Include PNG export' } } };
if (process.argv.includes('--reproduce-original')) {
  const box = { module: { exports: {} }, CodeCheckLogic: require('../js/codecheck-logic') };
  require('vm').runInNewContext(require('child_process').execFileSync('git', ['show', 'HEAD:js/coursecontent-logic.js'], { encoding: 'utf8' }), box);
  const original = box.module.exports, changed = JSON.parse(JSON.stringify(session)); changed.content.lesson[0].example = 'plt.show()';
  assert.ok(!original.buildReviewMessages(course, [session]).prompt.includes('savefig'));
  assert.equal(original.reviewStamp(course, [session]), original.reviewStamp(course, [changed]));
  console.log('REPRODUCED original Course Check: saved savefig example omitted, example-only edit not reflected in check stamp. No AI requests.');
  process.exit(0);
}
const m = CC.buildReviewMessages(course, [session]);
assert.match(m.prompt, /plt\.savefig/); assert.match(m.prompt, /fig\.savefig/); assert.match(m.prompt, /Include PNG export/); assert.match(m.prompt, /applied: session 1, Figure exporting/);
assert.match(m.system, /Equivalent wording/); assert.match(m.system, /Completeness does not prove/);
const before = JSON.stringify(session), stamp = CC.reviewStamp(course, [session]);
const reloaded = JSON.parse(JSON.stringify(session)); reloaded.content.lesson[0].example = 'plt.show()';
assert.notEqual(CC.reviewStamp(course, [reloaded]), stamp, 'example-only edits invalidate Course Check');
assert.equal(JSON.stringify(session), before, 'review is read-only');
const large = JSON.parse(before); large.content.lesson[0].body = 'x'.repeat(40000); large.content.lesson[0].example = 'plt.savefig("end.png")';
assert.ok(CC.buildReviewMessages(course, [large]).prompt.length < 6000, 'evidence is bounded');
const reordered = { ...session, content: { meta: session.content.meta, codeExamples: session.content.codeExamples, lesson: session.content.lesson, objectives: session.content.objectives } };
reordered.content.lesson = session.content.lesson.map(x => ({ example: x.example, body: x.body, heading: x.heading }));
assert.equal(CC.reviewStamp(course, [reordered]), stamp, 'JSONB key ordering does not stale the review');
console.log('release-audit.test.js: saved explanations/code, calls, instructions/decisions, stable bounded evidence and content-sensitive stamps pass (mock-only).');
