/* Unexpected regeneration regression: disposable in-memory database + mocked AI only.
   The browser companion also uses this synthetic fixture, never the real Python course. */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const CC = require('../js/coursecontent-logic');
const { fakeBackend } = require('./support/fake-db');
const clone = v => JSON.parse(JSON.stringify(v));
const ROOT = path.join(__dirname, '..');
const info = { at: '2026-10-17T02:00:00Z', provider: 'gemini', model: 'mock-gemini', calls: 1, tokens: 10 };
function fixture() {
  const parts = {
    lesson: { objectives: ['Explain plots', 'Build plots', 'Compare plots'], prerequisites: ['Python'],
      timePlan: [{ minutes: 60, activity: 'Explain' }, { minutes: 60, activity: 'Practice' }],
      lesson: [1, 2, 3].map(n => ({ heading: 'Plot ' + n, body: 'Explain the chart and compare its axes and values. '.repeat(6).trim(), example: 'print("plot")' })), keyTerms: [{ term: 'Axes', meaning: 'Chart area' }] },
    practice: { codeRelevant: true, tutorials: [{ title: 'Plot', goal: 'Make a chart', steps: ['Create values', 'Plot values', 'Show chart'] }],
      codeExamples: [{ title: 'Plot', language: 'python', code: 'print("plot")', explanation: 'Run this.' }], demos: [{ title: 'Demo', description: 'Show a chart', steps: ['Start', 'Plot', 'Finish'] }],
      guided: [{ title: 'Guided', instructions: 'Make a chart', steps: ['Start', 'Plot', 'Show'], solution: 'print("done")' }], practice: [{ title: 'Task', task: 'Compare charts', criteria: ['Correct axes'] }] },
    assess: { homework: { title: 'Charts', brief: 'Create and explain a chart.', deliverables: ['Script'], rubric: [{ criterion: 'Chart', marks: 10 }], maxMarks: 10 },
      quiz: [1, 2, 3, 4, 5].map(n => ({ question: 'Question ' + n, options: ['Yes', 'No'], answer: 0, explanation: 'Yes is correct.' })), teacherNotes: ['Help learners'], resources: [{ title: 'Matplotlib guide', type: 'documentation' }] }
  };
  const course = { id: 'QA-REGEN', title: 'Disposable regeneration fixture', slug: 'qa-regeneration', status: 'draft', outcomes: ['Build charts'], modules: [{ name: 'Charts' }] };
  let content = {};
  CC.PARTS.forEach(p => { content = CC.applyPart(content, p, parts[p], info); });
  const proposal = CC.makeProposal(content, 'lesson', { ...parts.lesson, lesson: parts.lesson.lesson.map(x => ({ ...x, body: 'Accepted repaired explanation: ' + x.body })) }, { ...info, provider: 'groq' }, { id: 'QA-REPAIR', by: 'u-admin', at: '2026-10-17T02:06:00Z' });
  content = CC.applyProposal(CC.addProposal(content, proposal), proposal, ['lesson'], { by: 'u-admin', at: '2026-10-17T02:06:00Z' }).content;
  content = CC.applyEdit(content, { teacherNotes: ['Manual notes to preserve'] }, 'u-admin', '2026-10-17T02:07:00Z').content;
  content.meta.outdated = [...CC.PARTS];
  return { course, session: { id: 'QA-S7', courseId: course.id, title: 'Visualising Data with Matplotlib (synthetic)', moduleName: 'Charts', summary: 'Synthetic session 7', duration: '2h', order: 7, published: true, content }, parts };
}
function sandbox(source = fs.readFileSync(path.join(ROOT, 'js/pages-coursecontent.js'), 'utf8')) {
  const f = fixture(), store = { courses: [f.course], sessions: [f.session], users: [] }, calls = [], confirms = [], modals = [], toasts = [];
  let answer = async part => ({ text: JSON.stringify({ ...f.parts[part], ...(part === 'lesson' ? { objectives: ['New objective', 'Build charts', 'Compare charts'] } : part === 'practice' ? { practice: [{ title: 'New task', task: 'Plot', criteria: ['Runs'] }] } : { teacherNotes: ['New AI notes'] }) }), provider: 'groq', model: 'mock-groq', tokens: 10 });
  const runAI = async (feature, o) => { const part = /Write the LESSON part/.test(o.system) ? 'lesson' : /Write the PRACTICE part/.test(o.system) ? 'practice' : 'assess'; calls.push({ feature, part }); return answer(part); };
  const node = () => ({ dataset: {}, addEventListener(type, fn) { this['on' + type] = fn; }, querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {} } });
  const buttons = { '[data-retry]': Object.assign(node(), { dataset: { retry: f.session.id } }) };
  const gen = node(), pane = { ...node(), isConnected: true, innerHTML: '', querySelector: s => s === '[data-gen-all]' ? gen : null, querySelectorAll: s => buttons[s] ? [buttons[s]] : [] };
  const box = { console, setTimeout: fn => setImmediate(fn), clearTimeout() {}, CourseContentLogic: CC, App: { user: { id: 'u-admin' } },
    window: { addEventListener() {}, scrollTo() {}, scrollY: 0 }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    t: x => x, esc: x => String(x ?? ''), icon: () => '', badge: x => x, clone, can: () => true, settings: () => ({ features: { courseGen: true } }),
    findRecord: (k, id) => store[k]?.find(x => x.id === id), updateRecord: (k, id, data) => Object.assign(store[k].find(x => x.id === id), clone(data)),
    Domain: { courseSessions: () => store.sessions, canManageCourse: () => true, canManageBatch: () => true, courseBatches: () => [], aiEnabled: () => true },
    fmtDateTime: x => x, progressBar: () => '', emptyState: () => '', feature: () => true, bindCopyButtons() {}, toast: (...x) => toasts.push(x),
    confirmDialog: async (message, options) => { confirms.push({ message, options }); return box.accept; }, accept: false,
    SDCAI: { call: runAI, status: async () => ({ profiles: [{ id: 'QA-GROQ', provider: 'groq', model: 'mock-groq' }] }) },
    openModal: options => { const go = node(), m = { options, ...node(), close() {}, querySelector: s => s === '[data-go]' ? go : null }; modals.push(m); return m; }
  };
  vm.createContext(box); require('./support/provider-box')(box);
  vm.runInContext(source + '\n;this.TCRun=TCRun;this.CCL=CCL;', box);
  box.AIRoute.set(f.course.id, { provider: 'groq', model: 'mock-groq', label: 'Groq' });
  return { box, f, store, calls, confirms, modals, pane, gen, buttons, toasts, setAnswer: fn => { answer = fn; } };
}
async function finished(x) {
  for (let i = 0; i < 300; i++) { const r = x.box.TCRun.get(x.f.course.id); if (!r?.active) return r; await new Promise(r => setImmediate(r)); }
  throw Error('Runner did not finish');
}
async function tests() {
  const db = fakeBackend(); await db.setSecret('disposable-regeneration');
  const x = sandbox(); await db.seed({ users: [{ id: 'u-admin' }], ...x.store });
  const before = clone(x.f.session.content);
  x.box.builderContent(x.pane, x.f.course, { user: x.box.App.user, query: {} });
  assert.ok(x.pane.innerHTML.includes('Regenerate outdated…') && !x.pane.innerHTML.includes('>Update</button>'));
  await x.buttons['[data-retry]'].onclick();
  assert.equal(x.calls.length, 0, 'the old Update action must open selection, not make three requests');
  assert.ok(x.modals[0].options.title.startsWith('Regenerate'));
  assert.ok(!/value="lesson" checked/.test(x.modals[0].options.body), 'accepted repair is unticked even when outdated');
  assert.ok(!/value="assess" checked/.test(x.modals[0].options.body), 'manual assessment is unticked even when outdated');
  assert.deepEqual(x.f.session.content, before);
  await x.gen.onclick(); assert.equal(x.calls.length, 0, 'bulk missing generation keeps all existing outdated content');

  const job = [{ sessionId: x.f.session.id, parts: [...CC.PARTS] }];
  assert.equal(await x.box.tcPrepareJobs(x.f.course, job), null, 'cancel refuses replacement');
  assert.equal(x.calls.length, 0); assert.deepEqual(x.f.session.content, before);
  assert.match(x.confirms[0].message, /Lesson/); assert.match(x.confirms[0].message, /Practice/); assert.match(x.confirms[0].message, /Assessment/);
  assert.match(x.confirms[0].message, /AI repair accepted/); assert.match(x.confirms[0].message, /manually edited/); assert.match(x.confirms[0].message, /Groq/);

  x.box.accept = true;
  const prepared = await x.box.tcPrepareJobs(x.f.course, job);
  // Only lesson is actually replaced here; the other parts must stay byte-for-byte intact.
  prepared[0].parts = ['lesson']; x.box.TCRun.start(x.f.course.id, prepared); await finished(x);
  assert.equal(x.calls.length, 1); assert.equal(x.calls[0].feature, 'contentRepair');
  assert.notDeepEqual(x.f.session.content.lesson, before.lesson, 'explicit confirmation actually replaces the repaired lesson');
  assert.deepEqual(x.f.session.content.practice, before.practice); assert.deepEqual(x.f.session.content.teacherNotes, before.teacherNotes);
  const histories = CC.historyOf(x.f.session.content); assert.equal(histories[0].kind, 'regenerate'); assert.ok(histories.some(h => h.kind === 'repair'));
  const restored = CC.restoreEntry(x.f.session.content, histories[0].id, { by: 'u-admin', at: '2026-10-17T02:11:00Z' });
  assert.ok(restored.changed); assert.deepEqual(restored.content.lesson, before.lesson, 'restoring regeneration recovers accepted repair');

  const all = sandbox(); all.box.accept = true;
  all.f.session.content.meta.approved = { by: 'u-admin', at: 'approved-before-regenerate' };
  const allJobs = await all.box.tcPrepareJobs(all.f.course, [{ sessionId: all.f.session.id, parts: [...CC.PARTS] }]);
  all.box.TCRun.start(all.f.course.id, allJobs); await finished(all);
  assert.deepEqual(all.calls.map(c => c.part), CC.PARTS, 'intentional three-part regeneration remains available after confirmation');
  assert.equal(CC.historyOf(all.f.session.content).filter(h => h.kind === 'regenerate').length, 3);
  assert.equal(all.f.session.content.meta.approved, undefined, 'new AI content withdraws approval');

  const race = sandbox(); race.box.accept = true;
  const planned = await race.box.tcPrepareJobs(race.f.course, [{ sessionId: race.f.session.id, parts: ['lesson'] }]);
  race.f.session.content = CC.applyEdit(race.f.session.content, { objectives: ['A newer manual edit'] }, 'u-admin', 'later').content;
  race.box.TCRun.start(race.f.course.id, planned); await finished(race);
  assert.equal(race.calls.length, 0, 'edit after confirmation prevents the request');
  assert.deepEqual(race.f.session.content.objectives, ['A newer manual edit']);

  const during = sandbox(); during.box.accept = true;
  const pending = await during.box.tcPrepareJobs(during.f.course, [{ sessionId: during.f.session.id, parts: ['lesson'] }]);
  during.setAnswer(async () => {
    const p = CC.makeProposal(during.f.session.content, 'lesson', { ...during.f.parts.lesson, objectives: ['Repaired during generation'] }, info, { id: 'RACE-REPAIR', by: 'u-admin', at: 'later' });
    during.f.session.content = CC.applyProposal(during.f.session.content, p, ['objectives'], { by: 'u-admin', at: 'later' }).content;
    return { text: JSON.stringify(during.f.parts.lesson), provider: 'groq', model: 'mock-groq', tokens: 10 };
  });
  during.box.TCRun.start(during.f.course.id, pending); await finished(during);
  assert.deepEqual(during.f.session.content.objectives, ['Repaired during generation'], 'accepted repair during request is kept');
  assert.equal(CC.historyOf(during.f.session.content)[0].kind, 'repair', 'no discarded answer in regeneration history');
  await db.seed({ users: [{ id: 'u-admin' }], ...x.store });
  assert.deepEqual((await db.row()).state.sessions[0].content.meta.history, x.f.session.content.meta.history);
  console.log('regeneration.test.js: Update/selection/cancel, missing-only bulk, protected defaults, explicit replacement, history/restore and concurrent edits/repairs passed (disposable in-memory DB, mocked AI).');
}
module.exports = { fixture, sandbox, finished };
if (require.main === module) tests().catch(e => { console.error(e); process.exitCode = 1; });
