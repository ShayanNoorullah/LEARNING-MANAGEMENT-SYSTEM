/* SDC Learn — AI course content builder: Course Builder → Content tab, the session content view used by
   the session page, the content editor and the course check. Pure rules: js/coursecontent-logic.js.
   - Each session gets three small AI requests (lesson, practice, assessment). Every finished part is
     saved to the session at once, so stopping, a failure or closing the tab loses nothing; "Generate"
     again only fills what is missing.
   - Nothing a person wrote is replaced without asking: titles, summaries and modules are never written
     by generation, and regenerating an edited part needs a confirmation.
   - Learners see a session's content only after a person approved it and the course is published.
     Homework and quizzes stay blueprints until someone creates them, as drafts, in a batch. */
const CCL = CourseContentLogic;

function courseContentAllowed(course, user = App.user) {
  return !!user && !!course && Domain.canManageCourse(user, course) && can('ai', 'use', user) && settings().features.courseGen === true && Domain.aiEnabled();
}
const tcHasContent = course => Domain.courseSessions(course.id, true).some(s => s.content);
// Called before a person's edit is saved: a course check that is current stays current through edits
// it does not read (timings, quizzes, notes). Checks saved by older versions are restamped first.
function tcKeepReview(courseId) {
  const c = findRecord('courses', courseId), list = Domain.courseSessions(courseId, true), r = c?.aiContent?.review;
  if (!r || !CCL.reviewCurrent(c, list)) return;
  const stamp = CCL.reviewStamp(c, list);
  if (r.stamp === stamp) return;
  const ai = clone(c.aiContent); ai.review.stamp = stamp;
  updateRecord('courses', courseId, { aiContent: ai });
}
// Sessions whose time plan does not fit the session length and can be fitted without AI.
function tcTimeFits(list) {
  return list.map((s, i) => {
    const want = CCL.minutesOf(s.duration), got = CCL.planMinutes(s.content);
    if (!want || !(s.content?.timePlan || []).length || Math.abs(got - want) <= CCL.TIME_SLACK) return null;
    const plan = CCL.fitTimePlan(s.content.timePlan, want);
    return plan ? { id: s.id, n: i + 1, from: got, to: want, plan } : null;
  }).filter(Boolean);
}

/* ------------------------------------------------------------ rich text */
// Escaped first; then only fenced code, `inline code`, **bold**, "- " and "1." lists, and paragraphs.
function tcCode(code, lang) {
  return `<div class="tc-code"><div class="tc-code-head"><span>${esc(lang || 'code')}</span><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(code)}" data-copy-label="Code">${icon('copy', 13)} Copy</button></div><pre><code>${esc(code)}</code></pre></div>`;
}
const tcInline = v => esc(v).replace(/`([^`]+)`/g, '<code>$1</code>');
function tcRich(text) {
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const out = [];
  CCL.fenceCode(String(text || '')).text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/).forEach((seg, i) => {
    if (i % 2) { const m = /^```([^\n]*)\n([\s\S]*?)(?:\n?```)?$/.exec(seg); out.push(tcCode(m ? m[2] : seg, m ? m[1].trim() : '')); return; }
    seg.split(/\n{2,}/).forEach(block => {
      let list = null, para = [];
      const flushP = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
      const flushL = () => { if (list) out.push(`<${list.tag}>${list.items.map(x => `<li>${inline(x)}</li>`).join('')}</${list.tag}>`); list = null; };
      block.split('\n').filter(l => l.trim()).forEach(l => {
        const b = /^\s*[-*•]\s+(.*)$/.exec(l), n = /^\s*\d+[.)]\s+(.*)$/.exec(l), tag = b ? 'ul' : n ? 'ol' : '';
        if (tag) { flushP(); if (list && list.tag !== tag) flushL(); (list ||= { tag, items: [] }).items.push((b || n)[1]); }
        else { flushL(); para.push(l); }
      });
      flushL(); flushP();
    });
  });
  return out.join('');
}

/* ----------------------------------------------- the content (read view) */
// audience 'learner': what learners may see; 'staff': everything, including the assessment blueprints,
// the time plan and the instructor's notes.
function tcContentHTML(session, { audience = 'staff' } = {}) {
  const c = session.content || {}, staff = audience === 'staff', show = k => staff || CCL.LEARNER_FIELDS.includes(k);
  const sec = (k, inner) => (inner && show(k) ? `<section class="tc-sec" data-sec="${k}"><h3>${esc(CCL.SCHEMA[k].label)}</h3>${inner}</section>` : '');
  const ul = (arr, cls = '') => (arr || []).length ? `<ul class="${cls}">${arr.map(x => `<li>${tcRich(x)}</li>`).join('')}</ul>` : '';
  const steps = arr => (arr || []).length ? `<ol class="tc-steps">${arr.map(x => `<li>${tcRich(x)}</li>`).join('')}</ol>` : '';
  const want = CCL.minutesOf(session.duration), got = CCL.planMinutes(c), fit = c.meta?.parts?.lesson?.timeFitted;
  const parts = [
    sec('objectives', ul(c.objectives, 'tc-objs')),
    sec('prerequisites', ul(c.prerequisites)),
    sec('timePlan', (c.timePlan || []).length ? `<table class="tc-time"><tbody>${c.timePlan.map(x => `<tr><td>${esc(x.minutes)} min</td><td>${esc(x.activity)}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>${got} min</b></td><td>${want ? (Math.abs(got - want) <= CCL.TIME_SLACK ? `matches the ${want}-minute session` : `<span class="text-warning">the session is ${want} minutes</span>`) : ''}${fit ? ` <span class="small muted">· the AI planned ${esc(fit.from)} minutes; fitted automatically</span>` : ''}</td></tr></tfoot></table>` : ''),
    sec('lesson', (c.lesson || []).map((x, i) => `<article class="tc-lesson"><h4>${i + 1}. ${esc(x.heading || '')}</h4><div class="prose">${tcRich(x.body)}</div>${x.example ? `<div class="tc-example"><span class="tc-label">Example</span>${tcRich(x.example)}</div>` : ''}</article>`).join('')),
    sec('keyTerms', (c.keyTerms || []).length ? `<dl class="tc-terms">${c.keyTerms.map(x => `<div><dt>${esc(x.term)}</dt><dd>${esc(x.meaning || '')}</dd></div>`).join('')}</dl>` : ''),
    sec('tutorials', (c.tutorials || []).map(x => `<article class="tc-item"><h4>${esc(x.title || 'Tutorial')}</h4>${x.goal ? `<p class="muted">${esc(x.goal)}</p>` : ''}${steps(x.steps)}</article>`).join('')),
    sec('codeExamples', (c.codeExamples || []).map(x => `<article class="tc-item"><h4>${esc(x.title || 'Example')}</h4>${x.code ? tcCode(x.code, x.language) : ''}${x.explanation ? `<div class="prose">${tcRich(x.explanation)}</div>` : ''}</article>`).join('')),
    sec('demos', (c.demos || []).map(x => `<article class="tc-item"><h4>${esc(x.title || 'Demonstration')}</h4><div class="prose">${tcRich(x.description)}</div>${steps(x.steps)}</article>`).join('')),
    sec('guided', (c.guided || []).map(x => `<article class="tc-item"><h4>${esc(x.title || 'Exercise')}</h4><div class="prose">${tcRich(x.instructions)}</div>${steps(x.steps)}${x.hint ? `<details class="tc-more"><summary>Hint</summary>${tcRich(x.hint)}</details>` : ''}${x.solution ? `<details class="tc-more"><summary>${staff ? 'Solution' : 'Solution (try it first)'}</summary>${tcRich(x.solution)}</details>` : ''}</article>`).join('')),
    sec('practice', (c.practice || []).map(x => `<article class="tc-item"><h4>${esc(x.title || 'Task')}</h4><div class="prose">${tcRich(x.task)}</div>${(x.criteria || []).length ? `<p class="tc-label">You have succeeded when</p>${ul(x.criteria, 'tc-checks')}` : ''}</article>`).join('')),
    sec('homework', c.homework ? `<article class="tc-item tc-blueprint"><span class="tc-label">Blueprint · not yet given to ${esc(t('learners', true))}</span><h4>${esc(c.homework.title || '')}</h4><div class="prose">${tcRich(c.homework.brief)}</div>${(c.homework.deliverables || []).length ? `<p class="tc-label">Deliverables</p>${ul(c.homework.deliverables)}` : ''}${(c.homework.rubric || []).length ? `<table class="tc-time"><tbody>${c.homework.rubric.map(r => `<tr><td>${esc(r.marks ?? '')}</td><td>${esc(r.criterion)}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>${esc(c.homework.maxMarks ?? '')}</b></td><td>marks${c.homework.estimatedHours ? ` · about ${esc(c.homework.estimatedHours)} hours of work` : ''}</td></tr></tfoot></table>` : ''}</article>` : ''),
    sec('quiz', (c.quiz || []).length ? `<p class="tc-label">Blueprint · answers are visible to staff only</p><ol class="tc-quiz">${c.quiz.map(q => `<li><div class="prose">${tcRich(q.question)}</div><ol class="tc-opts" type="A">${(q.options || []).map((o, i) => `<li class="${i === q.answer ? 'ok' : ''}">${tcInline(o)}${i === q.answer ? ` ${icon('check', 13)}` : ''}</li>`).join('')}</ol>${q.explanation ? `<p class="small muted">${esc(q.explanation)}</p>` : ''}</li>`).join('')}</ol>` : ''),
    sec('teacherNotes', ul(c.teacherNotes)),
    sec('resources', (c.resources || []).length ? `<ul>${c.resources.map(r => `<li><b>${esc(r.title)}</b>${r.type ? ` <span class="muted small">· ${esc(r.type)}</span>` : ''}${r.note ? `<br><span class="small">${esc(r.note)}</span>` : ''}</li>`).join('')}</ul><p class="help">Suggested by SDC Learn AI by name only, without links. Check that each resource exists before sharing it.</p>` : '')
  ];
  return parts.join('');
}

// Session page block. Staff see everything with its state; learners see approved content of a published course.
function tcSessionBlock(course, session, user, { unlocked = true, preview = false } = {}) {
  const st = CCL.sessionState(session);
  if (!session.content || st.status === 'none' && !st.failed.length) return '';
  const learner = kind(user) === 'student';
  if (learner) {
    if (!unlocked || course.status !== 'published' || !st.approved) return '';
    return `<div class="card tc-card">${tcContentHTML(session, { audience: 'learner' })}</div>`;
  }
  const manage = Domain.canManageCourse(user, course);
  const head = `<div class="card-head wrap gap-sm"><h3>Teaching content ${tcStateBadge(st, CCL.codeReport(session))}</h3><div class="row gap-xs">${preview
    ? `<a class="btn btn-ghost btn-sm" href="#/course/${course.id}/session/${session.id}">${icon('eye', 14)} Staff view</a>`
    : `<a class="btn btn-ghost btn-sm" href="#/course/${course.id}/session/${session.id}?view=learner">${icon('eye', 14)} Preview as ${esc(t('learner', true))}</a>`}${manage ? `<a class="btn btn-secondary btn-sm" href="#/manage/course/${course.id}?tab=content&session=${session.id}">${icon('edit', 14)} Review and edit</a>` : ''}</div></div>`;
  const note = preview
    ? `<div class="alert cg-note">${icon('eye', 14)} Preview of what ${esc(t('learners', true))} will see${st.approved ? '' : ' once a person approves this content'}${course.status === 'published' ? '' : ' and the course is published'}. Assessment blueprints, timings and instructor notes are not shown to ${esc(t('learners', true))}.</div>`
    : `<p class="small muted">${icon('sparkles', 13)} Drafted with SDC Learn AI${st.edited ? ' and edited by a person' : ''}. ${st.approved ? `Approved for ${esc(t('learners', true))}.` : `Not yet approved: ${esc(t('learners', true))} cannot see it.`}${st.status !== 'complete' ? ` <b>Incomplete:</b> ${esc(st.missing.map(p => CCL.PART_LABEL[p]).join(', ') || st.outdated.map(p => CCL.PART_LABEL[p]).join(', '))} ${st.outdated.length && !st.missing.length ? 'out of date' : 'missing'}.` : ''}</p>`;
  return `<div class="card tc-card">${head}${note}${tcContentHTML(session, { audience: preview ? 'learner' : 'staff' })}</div>`;
}

function tcStateBadge(st, rep) {
  if (st.status === 'complete') return st.approved ? (rep?.open ? badge('Approved · code checks open', 'warning') : badge('Approved', 'success')) : rep?.open ? badge('Code checks to review', 'warning') : badge('Ready for review', 'info');
  if (st.status === 'outdated') return badge('Out of date', 'warning');
  if (st.status === 'failed') return badge('Failed', 'danger');
  if (st.status === 'partial') return badge('Incomplete', 'warning');
  return badge('No content', 'neutral');
}

/* ------------------------------------------------------- the runner */
// One run per course, kept while the app is open (navigating away does not stop it). Two sessions are
// worked on at a time; a session's parts go in order, because the later parts build on the lesson.
// When the provider says it is rate-limited (free plans allow only a few requests a minute), the run
// waits as asked, then continues with one request at a time, spaced PACE_MS apart.
// 'save': the browser could not store a result; going on would only spend more AI requests on results that cannot be kept.
// TC_PAUSE: a provider is to blame and the coordinator decides what happens next (wait and retry, or switch
// to another configured provider). The run stops, everything written is kept, and the pause panel appears.
// The other stops are not a provider's fault, so switching would not help: the run stops with a message.
const TC_PAUSE = new Set(['provider_quota', 'provider_busy', 'provider_auth', 'provider_model', 'provider_too_large', 'not_configured', 'provider_unavailable']);
const TC_STOP_ALL = new Set(['save', 'rate_limit', 'budget', 'forbidden', 'unauthorized', 'disabled', ...TC_PAUSE]);
const TC_SOFT_FAILS = 3; // this many requests in a row that get no answer from the provider also pause the run
const TC_PACE_MS = 13000;
const APL = AIProviderLogic;
const tcProviderLabel = p => APL.label(p);
// The provider Repair with AI will use (the course's temporary choice, else Settings → Integrations → AI
// content repair), and whether it can be used. Only names and a yes/no come back from the server; a key never
// reaches the browser.
async function tcRepairRoute(courseId) {
  const st = await AIRoute.status(true), r = AIRoute.named(AIRoute.resolve(courseId, 'contentRepair'), st), list = st ? APL.options(st) : null;
  const mine = list ? list.find(o => o.provider === r.provider && r.profileId && o.profileId === r.profileId) || list.find(o => o.provider === r.provider) : null;
  const prof = st ? (st.profiles || []).find(p => r.profileId && p.id === r.profileId) || (st.profiles || []).find(p => p.provider === r.provider && p.enabled !== false) : null;
  return { provider: r.provider, label: APL.label(r.provider), model: r.model, profile: prof?.name || '', source: r.source, configured: list ? !!mine?.configured : null, usable: list ? !!mine?.usable : null, reason: mine?.reason || '' };
}
// One content part is about 8,000 characters in the browser copy. Before many AI requests are spent, check
// that the browser has room for the results; if not, the person decides (download a backup first, or go on).
const TC_PART_CHARS = 9000;
async function tcStorageOk(parts) {
  const c = window.SDCCloud; if (!c?.usage) return true;
  const u = c.usage(), need = Math.round(parts * TC_PART_CHARS * 1.25);
  if (u.free >= need) return true;
  const kb = n => Math.round(n / 1000).toLocaleString() + ' KB';
  return confirmDialog(`This browser has about ${kb(u.free)} of room left (${u.pct}% used) and this run needs about ${kb(need)}. Results that do not fit cannot be stored here and the run will stop at the first one. Download a backup and free up space first, or go on anyway?`, { title: 'Browser storage is nearly full', confirmText: 'Go on anyway', danger: true });
}
const TC_COLLAPSED = new Set(); // courses whose pause panel the coordinator folded away ("Pause and resume later")
// The parts a paused or stopped run still has to write, as jobs. From the run when this page still has it
// (a regenerate or a repair resumes as that, not as new generation); from what is stored otherwise. Parts that
// were only to be filled in are left out once they exist, so nothing finished or edited is asked for again.
function tcResumeJobs(course, run, list) {
  const jobs = [];
  if (run?.jobs?.length) {
    for (const j of run.jobs) {
      const s = findRecord('sessions', j.sessionId); if (!s) continue;
      const done = CCL.sessionState(s).done;
      const rest = j.parts.filter(p => !j.doneParts.includes(p) && !(j.skipped || []).includes(p) && !((j.fill || []).includes(p) && done.includes(p)));
      if (!rest.length) continue;
      const o = { sessionId: j.sessionId, parts: rest };
      if (j.instructions) o.instructions = j.instructions;
      if (j.repairParts) o.repairParts = j.repairParts.filter(p => rest.includes(p));
      if (j.proposeParts) o.proposeParts = j.proposeParts.filter(p => rest.includes(p));
      if (j.repairKeys) o.repairKeys = Object.fromEntries(rest.filter(p => j.repairKeys[p]).map(p => [p, j.repairKeys[p]]));
      if (j.fill) o.fill = j.fill.filter(p => rest.includes(p));
      jobs.push(o);
    }
    if (jobs.length) return jobs;
  }
  return list.map(s => { const parts = CCL.sessionState(s).missing; return { sessionId: s.id, parts, fill: parts }; }).filter(j => j.parts.length);
}
// Why the course is waiting on a provider, if it is: this page's run, else the failures stored with the parts.
function tcPauseOf(run, list) {
  if (run?.active) return null;
  const p = run?.pause || APL.pausedBy(list);
  if (!p) return null;
  return { ...p, ...APL.explain(p) };
}
// Who wrote what, for the whole course (one line per provider and model).
function tcWriters(list) {
  const w = APL.writers(list);
  return w.length ? `<div class="tc-writers small muted">Written by: ${w.map(x => `<b>${esc(x.label)}</b> (${x.parts} part${x.parts === 1 ? '' : 's'} in ${x.sessions} ${esc(t(x.sessions === 1 ? 'session' : 'sessions', true))})`).join(' · ')}</div>` : '';
}
const TCRun = (() => {
  const runs = new Map(), listeners = new Set();
  const emit = run => listeners.forEach(fn => { try { fn(run); } catch (e) {} });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Reserves the next start time synchronously, so two workers never start inside the same gap.
  async function pace(run) {
    const now = Date.now(), slot = Math.max(now, run.nextSlot || 0);
    run.nextSlot = slot + run.gapMs;
    if (slot > now) await sleep(slot - now);
  }
  // Remembered for an hour in this tab, so a reload does not start fast and get limited again.
  const PACE_KEY = 'sdcTcPace', paced = () => { try { const v = JSON.parse(sessionStorage.getItem(PACE_KEY) || 'null'); return v && Date.now() - v.at < 3600000 ? v.gapMs : 0; } catch (e) { return 0; } };
  const slowDown = run => (ms, e) => {
    run.maxWorkers = 1; run.gapMs = Math.max(run.gapMs, TC_PACE_MS); run.waitUntil = Date.now() + ms; run.note = e?.message || 'The AI provider asked to wait.'; run.waits = (run.waits || 0) + 1;
    try { sessionStorage.setItem(PACE_KEY, JSON.stringify({ gapMs: run.gapMs, at: Date.now() })); } catch (x) {}
    emit(run);
  };
  const beforeUnload = e => { if ([...runs.values()].some(r => r.active)) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  const saveFail = (e, r) => ({ ok: false, code: 'save', message: `Could not store this in the browser (${e.message}). The text is still in memory: press "Save to the server" in the red bar at the top, then free up browser space. The run has stopped so no more AI requests are spent.`, tokens: r.meta?.tokens || r.tokens || 0, calls: r.meta?.calls || r.calls || 0 });
  async function runPart(run, job, part) {
    if (job.repairKeys?.[part]) return runRepair(run, job, part);
    const course = findRecord('courses', run.courseId), session = findRecord('sessions', job.sessionId);
    if (!course || !session) return { ok: false, code: 'gone', message: `This ${t('session', true)} no longer exists.` };
    const sessions = Domain.courseSessions(course.id, true), i = sessions.findIndex(s => s.id === session.id);
    const basis = JSON.parse(JSON.stringify(session.content || {})); // what the AI is shown: a repair proposal is checked against it
    const standing = session.content?.meta?.instructions || '', instructions = [standing, job.instructions].filter(x => String(x || '').trim()).join('\n');
    const ctx = { course, sessions, session, coverage: (course.aiMeta?.coverage || [])[i] || [], instructions, earlier: session.content || {}, prevObjectives: sessions[i - 1]?.content?.objectives || [] };
    let r;
    // Replacing a part that exists (Regenerate, Repair with AI) uses the contentRepair capability; new
    // content uses courseContent. Both use the course outline's provider unless set in Settings → Integrations.
    const feat = (job.repairParts || []).includes(part) ? 'contentRepair' : 'courseContent';
    // Every request goes through the course's provider choice (the temporary one, else Settings') and is sent
    // to that provider alone: a failure is reported, never passed to another provider.
    const route = AIRoute.resolve(run.courseId, feat);
    try { r = await CCL.generatePart(async o => { await pace(run); return AIRoute.call(run.courseId, feat, { ...o, timeoutMs: 58000 }); }, part, ctx, { sleep, onWait: slowDown(run) }); }
    catch (e) { r = { ok: false, code: e.code || 'provider', message: e.message || 'The AI request failed.', provider: e.provider, calls: 1, tokens: 0, ms: 0 }; }
    if (!r.ok) { r.provider = r.provider || route.provider; r.model = r.model || route.model || ''; }
    const fresh = findRecord('sessions', job.sessionId); // re-read: anything changed meanwhile is kept
    if (!fresh) return { ok: false, code: 'gone', message: `This ${t('session', true)} was deleted while its content was being written.` };
    const at = new Date().toISOString(), by = typeof App !== 'undefined' ? App.user?.id || '' : '';
    // A part that was only to be filled in (it was missing when the run started) is not written if it exists by
    // now: a person wrote it, or another tab or another provider did. The answer is dropped, nothing is replaced.
    if (r.ok && (job.fill || []).includes(part) && CCL.sessionState(fresh).done.includes(part)) {
      (job.skipped ||= []).push(part);
      return { ok: true, skipped: true, tokens: r.meta.tokens, calls: r.meta.calls, ms: r.meta.ms };
    }
    // Repair with AI: the answer is kept as a proposal and the content is not touched. The proposal remembers
    // the content the AI was shown (`basis`, copied before the request), so a change made while it worked is
    // noticed when a person decides. Nothing is replaced until a person accepts fields.
    if ((job.proposeParts || []).includes(part)) {
      const content = r.ok
        ? CCL.addProposal(fresh.content, CCL.makeProposal(basis, part, r.value, { ...r.meta, linksRemoved: r.linksRemoved }, { by, at, instructions }))
        : CCL.noteRepairFailure(fresh.content, part, { code: r.code, message: r.message, at, tokens: r.tokens, calls: r.calls, ms: r.ms });
      try { updateRecord('sessions', fresh.id, { content }); }
      catch (e) { return saveFail(e, r); }
      if (r.ok) (job.proposed ||= []).push(part);
      return r.ok ? { ok: true, tokens: r.meta.tokens, calls: r.meta.calls, ms: r.meta.ms } : { ok: false, code: r.code, message: r.message, tokens: r.tokens, calls: r.calls, ms: r.ms };
    }
    let content = r.ok
      ? CCL.applyPart(fresh.content, part, r.value, { ...r.meta, at, linksRemoved: r.linksRemoved, instructions })
      : CCL.failPart(fresh.content, part, { code: r.code, message: r.message, at, tokens: r.tokens, calls: r.calls, ms: r.ms, provider: r.provider, model: r.model });
    // A part that already had text keeps it in the history, so a regeneration can be undone.
    if (r.ok) content = CCL.recordReplaced(content, fresh.content, part, { by, at, provider: r.meta?.provider, model: r.meta?.model, approvalWithdrawn: !!fresh.content?.meta?.approved });
    try { updateRecord('sessions', fresh.id, { content }); }
    catch (e) { return saveFail(e, r); }
    return r.ok ? { ok: true, tokens: r.meta.tokens, calls: r.meta.calls, ms: r.meta.ms } : { ok: false, code: r.code, message: r.message, provider: r.provider, model: r.model, retryAfterMs: r.retryAfterMs, tokens: r.tokens, calls: r.calls, ms: r.ms };
  }
  // Repair with AI on the fields a person chose: their current text goes to the provider set for contentRepair
  // and to no other (noFallback), and the answer is kept as a proposal. The content itself is not touched.
  async function runRepair(run, job, part) {
    const course = findRecord('courses', run.courseId), session = findRecord('sessions', job.sessionId);
    if (!course || !session) return { ok: false, code: 'gone', message: `This ${t('session', true)} no longer exists.` };
    const basis = JSON.parse(JSON.stringify(session.content || {})), keys = job.repairKeys[part].filter(k => basis[k] !== undefined);
    const ctx = { course, sessions: Domain.courseSessions(course.id, true), session }, findings = CCL.codeReport(session).findings;
    const route = AIRoute.resolve(run.courseId, 'contentRepair'), label = tcProviderLabel(route.provider);
    const value = {}, fixes = [], cuts = []; let calls = 0, tokens = 0, ms = 0, links = 0, meta = null, fail = null;
    for (const b of CCL.repairBatches(basis, keys)) {
      if (run.stop) break;
      let r;
      try { r = await CCL.generateRepair(async o => { await pace(run); return AIRoute.call(run.courseId, 'contentRepair', { ...o, timeoutMs: 58000 }); }, part, ctx, b.keys, { findings, instructions: job.instructions }, { sleep, onWait: slowDown(run) }); }
      catch (e) { r = { ok: false, code: e.code || 'provider', message: e.message || 'The AI request failed.', provider: e.provider, calls: 1, tokens: 0, ms: 0 }; }
      if (!r.ok) { r.provider = r.provider || route.provider; r.model = r.model || route.model || ''; }
      calls += r.meta?.calls ?? r.calls ?? 0; tokens += r.meta?.tokens ?? r.tokens ?? 0; ms += r.meta?.ms ?? r.ms ?? 0;
      if (r.ok) { Object.assign(value, r.value); links += r.linksRemoved || 0; fixes.push(...(r.meta.fixes || [])); cuts.push(...(r.meta.cuts || [])); meta = r.meta; }
      else { fail = r; if (TC_STOP_ALL.has(r.code)) break; }
    }
    const fresh = findRecord('sessions', job.sessionId); // re-read: anything changed meanwhile is kept
    if (!fresh) return { ok: false, code: 'gone', message: `This ${t('session', true)} was deleted while it was being repaired.` };
    const at = new Date().toISOString(), by = typeof App !== 'undefined' ? App.user?.id || '' : '', got = Object.keys(value).length > 0;
    const msg = fail ? (fail.code === 'not_configured' ? fail.message : `${tcProviderLabel(fail.provider || route.provider)} could not repair this: ${fail.message} No other provider was tried and nothing was changed.`) : '';
    let content;
    if (got) {
      content = CCL.addProposal(fresh.content, CCL.makeProposal(basis, part, value, { provider: meta.provider, model: meta.model, tokens, calls, ms, linksRemoved: links, fixes, cuts }, { by, at, instructions: job.instructions, scope: keys }));
      if (fail) content = CCL.noteRepairFailure(content, part, { code: fail.code, message: `Only some fields were repaired. ${msg}`, at, tokens: 0, calls: 0, ms: 0 });
    } else if (fail) content = CCL.noteRepairFailure(fresh.content, part, { code: fail.code, message: msg, at, tokens, calls, ms });
    else return { ok: false, code: 'stopped', message: 'Stopped before this part was repaired.', tokens, calls, ms };
    try { updateRecord('sessions', fresh.id, { content }); } catch (e) { return saveFail(e, { tokens, calls }); }
    if (got) (job.proposed ||= []).push(part);
    return got ? { ok: true, tokens, calls, ms } : { ok: false, code: fail.code, message: msg, provider: fail.provider, model: fail.model, retryAfterMs: fail.retryAfterMs, tokens, calls, ms };
  }
  async function worker(run, index) {
    for (;;) {
      if (run.stop || index >= run.maxWorkers) return;
      const job = run.jobs.find(j => j.state === 'queued');
      if (!job) return;
      job.state = 'running'; job.started = Date.now();
      for (const part of job.parts) {
        if (run.stop) break;
        job.part = part; emit(run);
        const r = await runPart(run, job, part);
        run.calls += r.calls || 0; run.tokens += r.tokens || 0; run.done++;
        if (r.ok) { if (!r.skipped) job.doneParts.push(part); run.soft = 0; }
        else {
          job.errors.push({ part, message: r.message, code: r.code });
          // A provider that does not answer several requests in a row is treated like a stopped one.
          if (['provider', 'timeout'].includes(r.code)) run.soft = (run.soft || 0) + 1; else run.soft = 0;
          const down = !TC_PAUSE.has(r.code) && run.soft >= TC_SOFT_FAILS;
          if (TC_STOP_ALL.has(r.code) || down) {
            const code = down ? 'provider_unavailable' : r.code, label = tcProviderLabel(r.provider);
            if (!run.stop) {
              run.stop = true; run.fatal = down ? `${label} did not answer ${run.soft} requests in a row. ${r.message}` : r.message;
              if (TC_PAUSE.has(code)) run.pause = { code, provider: r.provider || '', model: r.model || '', message: run.fatal, retryAfterMs: r.retryAfterMs || 0, at: new Date().toISOString(), sessionId: job.sessionId, part };
            }
          }
          if (part === 'lesson' && !job.repairKeys) { run.done += job.parts.length - job.parts.indexOf(part) - 1; break; } // the other parts build on the lesson
        }
        emit(run);
      }
      job.part = null; job.ms = Date.now() - job.started;
      job.state = job.errors.length ? 'failed' : job.doneParts.length === job.parts.length ? 'done' : 'stopped';
      emit(run);
    }
  }
  function start(courseId, jobs) {
    const cur = runs.get(courseId);
    if (cur?.active) return cur;
    const prev = runs.get(courseId); // a provider that limited the last run will limit this one too
    const run = { courseId, jobs: jobs.map(j => ({ ...j, state: 'queued', part: null, doneParts: [], errors: [] })), total: jobs.reduce((n, j) => n + j.parts.length, 0), done: 0, calls: 0, tokens: 0, started: Date.now(), active: true, stop: false, maxWorkers: prev?.maxWorkers || (paced() ? 1 : 2), gapMs: prev?.gapMs || paced(), nextSlot: 0 };
    runs.set(courseId, run);
    Promise.all(Array.from({ length: Math.min(2, jobs.length) }, (_, i) => worker(run, i))).then(() => {
      run.jobs.forEach(j => { if (j.state === 'queued') j.state = 'stopped'; });
      run.active = false; run.ended = Date.now(); emit(run);
    });
    emit(run);
    return run;
  }
  return { start, get: id => runs.get(id), stop: id => { const r = runs.get(id); if (r) { r.stop = true; emit(r); } }, on: fn => { listeners.add(fn); return () => listeners.delete(fn); }, pace, slowDown };
})();

/* ---------------------------------------------------- usage summary */
function tcUsage(course, sessions) {
  let calls = 0, tokens = 0, ms = 0, failedCalls = 0, links = 0;
  sessions.forEach(s => {
    Object.values(s.content?.meta?.parts || {}).forEach(p => { calls += p.calls || 0; tokens += p.tokens || 0; ms += p.ms || 0; links += p.linksRemoved || 0; });
    Object.values(s.content?.meta?.errors || {}).forEach(e => { failedCalls += e.calls || 0; tokens += e.tokens || 0; ms += e.ms || 0; });
    const sp = s.content?.meta?.repairs?.spent; if (sp) { calls += sp.calls || 0; tokens += sp.tokens || 0; ms += sp.ms || 0; } // repair proposals, accepted or not
  });
  const rv = course.aiContent?.review?.meta;
  if (rv) { calls += rv.calls || 0; tokens += rv.tokens || 0; ms += rv.ms || 0; }
  const models = [...new Set(sessions.flatMap(s => Object.values(s.content?.meta?.parts || {}).map(p => p.model)).concat(rv?.model || []).filter(Boolean))];
  return { calls: calls + failedCalls, failedCalls, tokens, ms, links, models };
}
const tcDur = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

/* --------------------------------------------- Course Builder → Content */
function builderContent(pane, course, ctx) {
  const u = ctx.user, allowed = courseContentAllowed(course, u);
  let off = null;
  const sessions = () => Domain.courseSessions(course.id, true);
  const cur = () => findRecord('courses', course.id) || course;

  function draw() {
    if (!pane.isConnected) { off?.(); return; }
    const list = sessions(), c = cur(), run = TCRun.get(course.id), chk = CCL.courseChecks(c, list), use = tcUsage(c, list);
    const missing = list.filter(s => CCL.sessionState(s).missing.length || CCL.sessionState(s).outdated.length);
    const keep = window.scrollY;
    pane.innerHTML = `
      ${!allowed ? `<div class="alert cg-note">${can('ai', 'use') ? 'AI course generation is turned off in Settings → Features (AI course generator), or SDC Learn AI is off.' : 'Your role cannot use SDC Learn AI.'} You can still review and edit existing content.</div>` : ''}
      <div class="card tc-head">
        <div class="row-between wrap gap-sm"><div><h3>Course content ${icon('sparkles', 15)}</h3><p class="muted small">Complete written teaching material for every ${esc(t('session', true))}: objectives, lesson, tutorials, code, exercises, a homework brief, a quiz and notes for the ${esc(t('instructor', true))}. Generated in small parts and saved after each part. ${c.status === 'published' ? '' : `The ${esc(t('course', true))} is a draft, so ${esc(t('learners', true))} see none of it.`}</p></div>
          <div class="row gap-sm wrap">${run?.active
            ? `<button class="btn btn-ghost btn-sm" data-stop ${run.stop ? 'disabled' : ''}>${run.stop ? 'Stopping…' : 'Stop'}</button>`
            : allowed && list.length ? `<button class="btn btn-primary btn-sm" data-gen-all ${missing.length ? '' : 'disabled'}>${icon('sparkles', 15)} ${list.some(s => s.content) ? (missing.length ? `Generate missing content (${missing.length})` : 'All content generated') : 'Generate Full Course Content with AI'}</button>` : ''}</div></div>
        <div class="tc-routeline" data-route-line></div>
        ${run ? tcRunPanel(run) : ''}
        <div class="tc-usage small muted">${use.calls ? `${icon('sparkles', 13)} ${use.calls} AI request${use.calls === 1 ? '' : 's'}${use.failedCalls ? ` (${use.failedCalls} failed)` : ''} · ${use.tokens.toLocaleString('en')} tokens · ${tcDur(use.ms)} of generation${use.models.length ? ` · ${esc(use.models.join(', '))}` : ''}${use.links ? ` · ${use.links} unverifiable link${use.links === 1 ? '' : 's'} removed` : ''}` : 'No AI content generated yet.'}</div>
        ${tcWriters(list)}
      </div>
      ${tcPauseOf(run, list) ? '<div data-pause></div>' : ''}
      ${tcCompleteness(chk, Domain.canManageCourse(u, c) ? tcTimeFits(list) : [])}
      ${tcReviewPanel(c, list, allowed)}
      <div class="card"><div class="card-head"><h3>${esc(t('sessions'))}</h3><span class="muted small">Titles, summaries and modules are never changed by content generation.</span></div>
        <div class="tc-rows">${list.map((s, i) => tcSessionRow(s, i, run, allowed)).join('') || emptyState(`No ${t('sessions', true)} yet`, `Add ${t('sessions', true)} first.`, 'layers')}</div></div>`;
    window.scrollTo(0, keep);
    bind();
    AIRoute.fillLine(pane.querySelector('[data-route-line]'), course.id, 'courseContent', { canChange: allowed && !run?.active, onChange: draw });
    const pause = tcPauseOf(run, list);
    if (pause) fillPause(pane.querySelector('[data-pause]'), pause, run, list);
  }
  function bind() {
    pane.querySelector('[data-gen-all]')?.addEventListener('click', startAll);
    pane.querySelector('[data-stop]')?.addEventListener('click', () => TCRun.stop(course.id));
    pane.querySelector('[data-review]')?.addEventListener('click', runReview);
    pane.querySelector('[data-fit-time]')?.addEventListener('click', fitTimes);
    pane.querySelectorAll('[data-view]').forEach(b => b.onclick = () => tcViewModal(course, findRecord('sessions', b.dataset.view), draw, allowed ? jobs => startJobs(jobs) : null));
    pane.querySelectorAll('[data-edit-part]').forEach(b => b.onclick = () => { const [id, part] = b.dataset.editPart.split(':'); tcEditModal(course, findRecord('sessions', id), part, draw); });
    pane.querySelectorAll('[data-regen]').forEach(b => b.onclick = () => tcRegenModal(course, findRecord('sessions', b.dataset.regen), jobs => startJobs(jobs)));
    pane.querySelectorAll('[data-repair-review]').forEach(b => b.onclick = () => tcRepairModal(course, b.dataset.repairReview, null, draw, allowed ? jobs => startJobs(jobs) : null));
    pane.querySelectorAll('[data-repair-open]').forEach(b => b.onclick = () => tcRepairSelectModal(course, findRecord('sessions', b.dataset.repairOpen), jobs => startJobs(jobs), draw));
    pane.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => { const s = findRecord('sessions', b.dataset.retry), st = CCL.sessionState(s); const parts = CCL.PARTS.filter(p => st.missing.includes(p) || st.outdated.includes(p)); startJobs([{ sessionId: s.id, parts, fill: parts.filter(p => st.missing.includes(p)) }]); });
    pane.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => approve(b.dataset.approve, true));
    pane.querySelectorAll('[data-unapprove]').forEach(b => b.onclick = () => approve(b.dataset.unapprove, false));
    pane.querySelectorAll('[data-prop]').forEach(b => b.onclick = () => proposal(b.dataset.prop, b.dataset.mode));
    pane.querySelector('[data-cap-edit]')?.addEventListener('click', () => tcCapstoneModal(course, draw));
    pane.querySelector('[data-cap-restore]')?.addEventListener('click', restoreCapstone);
    bindCopyButtons(pane);
  }
  async function startJobs(jobs) {
    jobs = jobs.filter(j => j.parts.length);
    if (!jobs.length) return toast('Nothing to generate.', 'warning');
    if (!(await tcStorageOk(jobs.reduce((k, j) => k + j.parts.length, 0)))) return;
    TCRun.start(course.id, jobs); draw();
  }
  async function startAll() {
    const list = sessions(), jobs = list.map(s => { const st = CCL.sessionState(s), parts = CCL.PARTS.filter(p => st.missing.includes(p) || st.outdated.includes(p)); return { sessionId: s.id, parts, fill: parts.filter(p => st.missing.includes(p)) }; }).filter(j => j.parts.length);
    if (!jobs.length) return toast('Every session already has its content.', 'success');
    const outdatedEdited = jobs.filter(j => { const st = CCL.sessionState(findRecord('sessions', j.sessionId)); return j.parts.some(p => st.editedParts.includes(p)); });
    const n = jobs.reduce((k, j) => k + j.parts.length, 0), via = AIRoute.named(AIRoute.resolve(course.id, 'courseContent'), await AIRoute.status());
    const ok = await confirmDialog(`Generate ${n} content part${n === 1 ? '' : 's'} for ${jobs.length} ${t(jobs.length === 1 ? 'session' : 'sessions', true)} with ${via.label}${via.source === 'temporary' ? ' (your temporary choice for this course)' : ''} (one AI request per part, about ${Math.max(1, Math.round(n * 20 / 2 / 60))} minute${n > 6 ? 's' : ''}). Content that already exists is kept; only missing${jobs.some(j => CCL.sessionState(findRecord('sessions', j.sessionId)).outdated.length) ? ' and out-of-date' : ''} parts are written.${outdatedEdited.length ? ` ${outdatedEdited.length} of them contain a person's edits that will be replaced.` : ''} If the provider runs out of quota or fails, generation pauses with everything written so far saved, and you choose here whether to retry or continue with another provider. Nothing is sent to another provider on its own. Keep this app open until it finishes.`, { title: 'Generate course content', confirmText: 'Generate' });
    if (ok) startJobs(jobs);
  }
  // The course is waiting on a provider. Everything written is saved; the coordinator chooses: switch to another
  // configured provider and continue, retry the same one, or leave it for later. Nothing is sent anywhere until a button is pressed.
  async function fillPause(el, pause, run, list) {
    if (!el) return;
    const jobs = tcResumeJobs(course, run, list), left = jobs.reduce((n, j) => n + j.parts.length, 0), done = list.reduce((n, s) => n + CCL.sessionState(s).done.length, 0);
    const complete = list.filter(s => CCL.sessionState(s).status === 'complete').length, who = APL.label(pause.provider);
    if (TC_COLLAPSED.has(course.id)) {
      el.innerHTML = `<div class="card tc-pause compact" role="status"><span>${icon('clock', 14)} <b>Paused:</b> ${esc(pause.title)}. ${left} part${left === 1 ? '' : 's'} left; everything written is saved.</span> <button class="btn btn-secondary btn-sm" data-expand>Choose how to continue</button></div>`;
      el.querySelector('[data-expand]').onclick = () => { TC_COLLAPSED.delete(course.id); draw(); };
      return;
    }
    const st = allowed ? await AIRoute.status(true) : null, stopped = pause.provider ? { provider: pause.provider, profileId: '', model: pause.model || '' } : null;
    const opts = st ? APL.options(st, { stopped }) : [], pick = AIRoute.firstUsable(opts);
    if (!el.isConnected) return;
    el.innerHTML = `<div class="card tc-pause" role="alert">
      <h3>${icon('clock', 16)} Generation paused: ${esc(pause.title)}</h3>
      <p>${esc(pause.detail)}</p>
      <p class="small"><b>${done}</b> part${done === 1 ? ' is' : 's are'} written and saved (${complete} of ${list.length} ${esc(t('sessions', true))} complete). <b>${left}</b> part${left === 1 ? ' is' : 's are'} still to write. Parts that are finished, and anything a person edited, will not be written again. Nothing is sent to another provider unless you choose it below.</p>
      ${pause.message && pause.message !== pause.detail ? `<details class="tc-more"><summary>What the provider said</summary><p class="small">${esc(pause.message)}</p></details>` : ''}
      ${allowed && left ? `${pause.canSwap ? `<h4>Continue with another provider</h4>${opts.length ? AIRoute.listHTML(opts, 'ap-switch', pick) : '<p class="text-danger small">The AI settings could not be read just now. Reload to try again.</p>'}<p class="small muted">Only providers an administrator has set up are shown. Your choice applies to this ${esc(t('course', true))} in this tab; Settings → Integrations is not changed.</p>` : ''}
        <div class="row gap-sm wrap">
          ${pause.canSwap ? `<button class="btn btn-primary" data-switch-resume ${pick ? '' : 'disabled'}>${icon('refresh', 15)} Switch Provider &amp; Resume</button>` : ''}
          <button class="btn btn-secondary" data-retry-current ${pause.canRetry ? '' : 'disabled'} title="${pause.canRetry ? '' : 'Retrying cannot help until an administrator fixes this in Settings → Integrations.'}">Retry ${esc(who)}</button>
          <button class="btn btn-ghost" data-pause-later>Pause and Resume Later</button>
        </div>` : left ? '<p class="small muted">You do not have permission to continue AI generation for this course.</p>' : ''}
    </div>`;
    el.querySelector('[data-pause-later]')?.addEventListener('click', () => { TC_COLLAPSED.add(course.id); toast('Paused. Everything written is saved; come back any time to continue.', 'success'); draw(); });
    el.querySelector('[data-retry-current]')?.addEventListener('click', () => {
      const again = tcResumeJobs(course, run, sessions()); if (!again.length) return toast('Nothing is left to write.', 'success');
      TC_COLLAPSED.delete(course.id); startJobs(again);
    });
    el.querySelector('[data-switch-resume]')?.addEventListener('click', async () => {
      const o = opts.find(x => x.id === el.querySelector('input[name="ap-switch"]:checked')?.value);
      if (!o) return toast('Choose a provider first.', 'warning');
      const again = tcResumeJobs(course, run, sessions()), n = again.reduce((k, j) => k + j.parts.length, 0);
      if (!n) return toast('Nothing is left to write.', 'success');
      const wr = APL.writers(sessions()).map(w => w.label).join(', ');
      const ok = await confirmDialog(`Continue with ${o.label}? The ${n} part${n === 1 ? '' : 's'} not written yet will be written by ${o.label} and use its tokens${n > 20 ? '; this is many requests' : ''}. The ${done} finished part${done === 1 ? '' : 's'}${wr ? ` (written by ${wr}, or by a person)` : ''} are not touched. Settings → Integrations stays as it is; this choice applies to this ${t('course', true)} in this tab until you switch again.`, { title: 'Switch provider and resume', confirmText: `Switch to ${APL.label(o.provider)} and resume` });
      if (!ok) return;
      AIRoute.set(course.id, o); TC_COLLAPSED.delete(course.id);
      startJobs(tcResumeJobs(course, run, sessions()));
    });
  }
  // No AI: each plan is fitted by moving minutes between its longest teaching blocks, saved as this person's edit.
  async function fitTimes() {
    const fits = tcTimeFits(sessions());
    if (!fits.length) return toast('Every time plan already fits.', 'success');
    const ok = await confirmDialog(`${fits.map(f => `${t('session')} ${f.n}: ${f.from} → ${f.to} minutes`).join('\n')}\n\nMinutes are taken from (or added to) the longest teaching activities; the activities and breaks stay as they are. No AI request is made. The change is saved as your edit.`, { title: `Fit ${fits.length} time plan${fits.length === 1 ? '' : 's'}`, confirmText: 'Fit time plans' });
    if (!ok) return;
    tcKeepReview(course.id);
    const at = new Date().toISOString();
    fits.forEach(f => { const s = findRecord('sessions', f.id), r = CCL.applyEdit(s.content, { timePlan: f.plan }, u.id, at); if (r.changed) updateRecord('sessions', f.id, { content: r.content }); });
    toast(`${fits.length} time plan${fits.length === 1 ? '' : 's'} fitted.`); draw();
  }
  function approve(id, yes) {
    const r = tcSetApproval(id, yes, u.id);
    if (!r.ok) { toast(`Cannot approve yet: ${r.reason}`, 'warning'); return draw(); }
    toast(yes ? `Approved. ${t('learners')} see it once the ${t('course', true)} is published.` : 'Approval withdrawn.'); draw();
  }
  async function runReview() {
    const btn = pane.querySelector('[data-review]'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Checking…'; }
    const list = sessions(), c = cur(), stamp = CCL.reviewStamp(c, list);
    let r;
    try { r = await CCL.generateReview(o => AIRoute.call(course.id, 'courseContent', { ...o, timeoutMs: 58000 }), c, list, { sleep: ms => new Promise(res => setTimeout(res, ms)), onWait: (ms, e) => toast(`${e?.message || 'The AI provider is busy.'} Trying again in ${Math.ceil(ms / 1000)} s.`, 'warning') }); }
    catch (e) { r = { ok: false, message: e.message }; }
    const latest = cur(), at = new Date().toISOString(), ai = clone(latest.aiContent || {});
    if (r.ok) {
      updateRecord('courses', course.id, { aiContent: CCL.applyReview(ai, r.value, r.meta, { at, by: u.id, stamp, basedOn: list.some(s => s.content?.lesson) ? 'content' : 'outline' }) });
      toast('Course check finished.');
    } else {
      ai.reviewError = { message: r.message || 'The course check failed.', at };
      updateRecord('courses', course.id, { aiContent: ai });
      toast(`Course check failed: ${r.message || 'try again'}`, 'error');
    }
    draw();
  }
  // Swaps the capstone with the one the last course check replaced (so the swap can be undone the same way).
  async function restoreCapstone() {
    const c = cur(), ai = clone(c.aiContent || {}), prev = ai.capstonePrev; if (!prev) return;
    if (!(await confirmDialog(`Use “${prev.title}” (from ${fmtDateTime(prev.at)}) as the capstone again? The current capstone “${ai.capstone?.title || '—'}” is kept as the other version. No AI request is made.`, { title: 'Restore the previous capstone', confirmText: 'Restore' }))) return;
    const { replacedAt, ...back } = prev;
    ai.capstonePrev = ai.capstone ? { ...ai.capstone, replacedAt: new Date().toISOString() } : undefined;
    ai.capstone = back;
    updateRecord('courses', c.id, { aiContent: ai });
    toast('Previous capstone restored.'); draw();
  }
  // Applying a proposal is always a person's decision. "content": the session keeps its title and
  // summary and only its content instructions change. "outline": also the title and summary, after a
  // confirmation that shows both versions.
  async function proposal(id, mode) {
    const c = cur(), ai = clone(c.aiContent || {}), p = (ai.proposals || []).find(x => x.id === id); if (!p) return;
    if (mode === 'dismiss') { p.status = 'dismissed'; p.decidedAt = new Date().toISOString(); p.by = u.id; updateRecord('courses', c.id, { aiContent: ai }); return draw(); }
    const s = sessions()[p.session - 1]; if (!s) return toast(`${t('session')} ${p.session} no longer exists.`, 'error');
    const changeOutline = mode === 'outline' && ((p.title && p.title !== s.title) || (p.summary && p.summary !== s.summary));
    const st = CCL.sessionState(s);
    const msg = `${changeOutline ? `${t('session')} ${p.session} changes:\n\nTitle: “${s.title}” → “${p.title || s.title}”\nSummary: “${s.summary || '—'}” → “${p.summary || s.summary || '—'}”\n\n` : `${t('session')} ${p.session} (“${s.title}”) keeps its title and summary. `}Its content will add: ${String(p.instructions || p.topic).replace(/[.\s]+$/, '')}.${st.done.length ? ` The ${st.done.map(x => CCL.PART_LABEL[x].toLowerCase()).join(', ')} part${st.done.length === 1 ? ' is' : 's are'} then marked out of date; regenerate ${st.done.length === 1 ? 'it' : 'them'} when you are ready${st.edited ? ' (your edits are kept until you do)' : ''}.` : ''}`;
    if (!(await confirmDialog(msg, { title: 'Apply this proposal', confirmText: 'Apply' }))) return;
    const content = clone(s.content || {}); content.meta = content.meta || {};
    content.meta.instructions = [content.meta.instructions, p.instructions || `Cover: ${p.topic}`].filter(Boolean).join('\n').slice(0, 2000);
    if (st.done.length) content.meta.outdated = [...new Set([...(content.meta.outdated || []), ...st.done])];
    updateRecord('sessions', s.id, { content, ...(changeOutline ? { title: p.title || s.title, summary: p.summary || s.summary } : {}) });
    p.status = 'applied'; p.mode = changeOutline ? 'outline' : 'content'; p.decidedAt = new Date().toISOString(); p.by = u.id;
    updateRecord('courses', c.id, { aiContent: ai });
    toast('Proposal applied.'); draw();
  }

  off = TCRun.on(run => {
    if (run.courseId !== course.id) return;
    if (!run.active && run.pause && !run.pauseShown) { run.pauseShown = true; toast(`Paused: ${APL.explain(run.pause).title}. What was written is saved. Choose how to continue.`, 'warning'); }
    draw();
  });
  draw();
  if (ctx.query.session) setTimeout(() => { const s = findRecord('sessions', ctx.query.session); if (s?.courseId === course.id) tcViewModal(course, s, draw, allowed ? jobs => startJobs(jobs) : null); }, 0);
  if (ctx.query.start && allowed && !TCRun.get(course.id)?.active) { history.replaceState(null, '', `#/manage/course/${course.id}?tab=content`); startAll(); }
}

function tcRunPanel(run) {
  const pct = run.total ? Math.round(run.done / run.total * 100) : 0, failed = run.jobs.filter(j => j.errors.length).length;
  const elapsed = (run.ended || Date.now()) - run.started;
  return `<div class="tc-run ${run.active ? 'on' : ''}" role="status" aria-live="polite">
    <div class="row-between wrap gap-sm"><b>${run.active ? (run.stop ? 'Stopping after the requests already running…' : `${run.jobs.every(j => j.repairKeys) ? 'Writing repair proposals' : 'Generating'}… ${run.done} of ${run.total} parts`) : run.pause ? `Paused: ${run.jobs.reduce((n, j) => n + j.doneParts.length, 0)} of ${run.total} parts written` : `Finished: ${run.done} of ${run.total} parts${failed ? `, ${failed} ${t(failed === 1 ? 'session' : 'sessions', true)} with errors` : ''}`}</b><span class="small muted">${run.calls} request${run.calls === 1 ? '' : 's'} · ${run.tokens.toLocaleString('en')} tokens · ${tcDur(elapsed)}</span></div>
    ${progressBar(pct, 'Generation progress')}
    ${run.active && run.waitUntil > Date.now() ? `<p class="small text-warning">${icon('clock', 13)} ${esc(run.note)} Waiting about ${Math.ceil((run.waitUntil - Date.now()) / 1000)} s, then continuing.</p>` : ''}
    ${run.gapMs ? `<p class="small muted">The AI provider limits requests per minute, so requests are sent one at a time, at least ${Math.round(run.gapMs / 1000)} s apart.</p>` : ''}
    ${!run.active && run.jobs.some(j => (j.proposed || []).length) ? `<p class="small text-success">${icon('check', 13)} ${run.jobs.reduce((n, j) => n + (j.proposed || []).length, 0)} repair proposal${run.jobs.reduce((n, j) => n + (j.proposed || []).length, 0) === 1 ? '' : 's'} ready. <b>Nothing has been changed yet:</b> open the ${esc(t('session', true))} and compare the old and new text field by field.</p>` : ''}
    ${run.fatal && !run.pause ? `<p class="text-danger small">${esc(run.fatal)} Generation stopped; what was finished is saved.</p>` : ''}${!run.active && run.jobs.some(j => (j.skipped || []).length) ? `<p class="small muted">${run.jobs.reduce((n, j) => n + j.skipped.length, 0)} part${run.jobs.reduce((n, j) => n + (j.skipped || []).length, 0) === 1 ? ' was' : 's were'} written by someone else while this ran, so the AI's version was not saved over it.</p>` : ''}
    ${!run.active && !run.pause && run.jobs.some(j => j.state !== 'done') ? `<p class="small">Everything finished is saved. Use “Generate missing content” or “Retry” to continue.</p>` : ''}</div>`;
}

function tcCompleteness(chk, fits = []) {
  const missing = [...chk.sessions.flatMap((s, i) => s.items.filter(x => !x.ok).map(x => `${t('session')} ${i + 1}: ${x.label}${x.note ? ` (${x.note})` : ''}`)), ...chk.course.filter(x => !x.ok).map(x => `Course: ${x.label}${x.note ? ` (${x.note})` : ''}`)];
  const complete = chk.sessions.filter(s => s.items.every(x => x.ok)).length;
  return `<div class="card tc-complete"><div class="row-between wrap gap-sm"><h3>Course content completeness</h3><span class="${chk.complete ? 'text-success' : ''}"><b>${chk.ok}</b> of <b>${chk.total}</b> required items present</span></div>
    ${progressBar(chk.total ? chk.ok / chk.total * 100 : 0, 'Required items present')}
    <p class="small muted">Counted from what is actually stored: per ${esc(t('session', true))} the objectives, prerequisites, lesson sections with examples, a tutorial, code examples (where the topic needs code), a demonstration, guided and independent exercises, a homework brief, a quiz of 5+ questions, ${esc(t('instructor', true))} notes and a time plan that fits the ${esc(t('session', true))}; for the ${esc(t('course', true))} every outcome taught, a final assessment, and an up-to-date course check with no essential topic left open. ${complete} of ${chk.sessions.length} ${esc(t('sessions', true))} complete.</p>
    ${missing.length ? `<details class="tc-more"${missing.length <= 6 ? ' open' : ''}><summary>${missing.length} item${missing.length === 1 ? '' : 's'} missing</summary><ul class="small">${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul></details>${fits.length ? `<div class="row gap-sm wrap"><button class="btn btn-secondary btn-sm" data-fit-time>${icon('clock', 14)} Fit ${fits.length} time plan${fits.length === 1 ? '' : 's'} to the ${esc(t('session', true))} length</button><span class="small muted">No AI request: minutes are moved between the longest activities.</span></div>` : ''}` :`<p class="text-success small">${icon('check', 14)} Every required item is present. A person still needs to review and approve each ${esc(t('session', true))}.</p>`}</div>`;
}

function tcReviewPanel(course, list, allowed) {
  const ai = course.aiContent || {}, r = ai.review, stale = r && !CCL.reviewCurrent(course, list);
  const dups = CCL.findDuplicates(list), props = ai.proposals || [], cap = ai.capstone;
  const sev = s => badge(s === 'high' ? 'Essential' : s === 'low' ? 'Minor' : 'Important', s === 'high' ? 'danger' : s === 'low' ? 'neutral' : 'warning');
  const outs = course.outcomes || [], cov = CCL.coverageMap(course, list);
  return `<div class="card tc-review"><div class="row-between wrap gap-sm"><div><h3>Course check</h3><p class="muted small">Outcome coverage, missing essential topics, repetition, the order of concepts and a final project. ${r ? `Last run ${esc(fmtDateTime(r.at))} on the ${r.basedOn === 'content' ? 'generated content' : 'outline'}${stale ? ' · <b class="text-warning">out of date</b>' : ''}.` : 'Not run yet.'}</p></div>
      ${allowed ? `<button class="btn btn-secondary btn-sm" data-review>${icon('sparkles', 14)} ${r ? 'Check again' : 'Check the course with AI'}</button>` : ''}</div>
    ${ai.reviewError && (!r || ai.reviewError.at > r.at) ? `<div class="alert alert-danger small">The last course check failed: ${esc(ai.reviewError.message)}</div>` : ''}
    <h4>Learning outcomes</h4><table class="tc-cov"><tbody>${outs.map((o, i) => { const ss = cov[i + 1] || [], rc = r?.coverage?.find(x => x.outcome === i + 1); return `<tr><td>${i + 1}</td><td>${esc(o)}</td><td>${ss.length ? ss.map(n => `<span class="pill">${n}</span>`).join(' ') : `<span class="text-danger">not taught</span>`}${rc && rc.strength === 'weak' ? ` ${badge('Weak', 'warning')}` : ''}</td></tr>`; }).join('')}</tbody></table>
    ${r ? `${r.missingTopics.length ? `<h4>Missing topics</h4><ul class="tc-findings">${r.missingTopics.map(x => `<li>${sev(x.severity)} <b>${esc(x.topic)}</b> <span class="small muted">${esc(x.why || '')}</span></li>`).join('')}</ul>` : '<p class="small text-success">No essential topic missing.</p>'}
      ${r.duplicates.length ? `<h4>Repetition</h4><ul class="tc-findings">${r.duplicates.map(x => `<li>${esc(t('sessions'))} ${x.sessions.join(' and ')}: <b>${esc(x.topic)}</b> <span class="small muted">${esc(x.note || '')}</span></li>`).join('')}</ul>` : ''}
      ${r.progression.length ? `<h4>Order of concepts</h4><ul class="tc-findings">${r.progression.map(x => `<li>${x.sessions.length ? `${esc(t('sessions'))} ${x.sessions.join(', ')}: ` : ''}${esc(x.issue)}</li>`).join('')}</ul>` : ''}` : ''}
    ${dups.length ? `<h4>Similar material in different ${esc(t('sessions', true))}</h4><ul class="tc-findings small">${dups.map(d => `<li>${esc(t('sessions'))} ${d.sessions.join(' and ')} (${esc(d.kind)}): “${esc(d.a)}” / “${esc(d.b)}”</li>`).join('')}</ul>` : ''}
    ${props.length ? `<h4>Proposed corrections</h4><p class="help">Nothing is changed until you apply a proposal. “Add to content” keeps the ${esc(t('session', true))} title and summary.</p><div class="tc-props">${props.map(p => { const s = list[p.session - 1]; return `<div class="tc-prop ${p.status}"><div class="row-between wrap gap-sm"><span>${sev(p.severity)} <b>${esc(p.topic || p.title)}</b> → ${esc(t('session'))} ${p.session}${s ? ` “${esc(s.title)}”` : ''}</span>${p.status === 'open' ? (allowed || can('courses', 'edit') ? `<span class="row gap-xs wrap"><button class="btn btn-primary btn-sm" data-prop="${esc(p.id)}" data-mode="content">Add to content</button>${(p.title && s && p.title !== s.title) || (p.summary && s && p.summary !== s.summary) ? `<button class="btn btn-secondary btn-sm" data-prop="${esc(p.id)}" data-mode="outline">Also change title and summary</button>` : ''}<button class="btn btn-ghost btn-sm" data-prop="${esc(p.id)}" data-mode="dismiss">Dismiss</button></span>` : '') : badge(p.status === 'applied' ? (p.mode === 'outline' ? 'Applied (title and content)' : 'Applied to content') : 'Dismissed', p.status === 'applied' ? 'success' : 'neutral')}</div>
        <p class="small">${esc(p.reason || '')}</p><p class="small"><b>Content to add:</b> ${esc(p.instructions || '')}</p>${p.title && s && p.title !== s.title ? `<p class="small muted">Proposed title: “${esc(p.title)}”${p.summary ? ` · summary: “${esc(p.summary)}”` : ''}</p>` : ''}</div>`; }).join('')}</div>` : ''}
    <h4>Final assessment</h4>${cap ? `<div class="tc-item tc-blueprint"><div class="row-between wrap gap-sm"><span class="tc-label">Capstone project · blueprint${cap.edited ? ' · edited by a person' : ''}</span>${can('courses', 'edit') ? `<span class="row gap-xs wrap">${ai.capstonePrev ? `<button class="btn btn-ghost btn-sm" data-cap-restore title="${esc(`Replaced by the course check of ${fmtDateTime(ai.capstonePrev.replacedAt)}`)}">${icon('refresh', 13)} Previous version</button>` : ''}<button class="btn btn-ghost btn-sm" data-cap-edit>${icon('edit', 13)} Edit</button></span>` : ''}</div><h4>${esc(cap.title)}</h4><div class="prose">${tcRich(cap.brief)}</div>
      ${(cap.requirements || []).length ? `<p class="tc-label">Requirements</p><ul>${cap.requirements.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${(cap.deliverables || []).length ? `<p class="tc-label">Deliverables</p><ul>${cap.deliverables.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${(cap.milestones || []).length ? `<p class="tc-label">Milestones</p><ul>${cap.milestones.map(m => `<li>${esc(t('session'))} ${m.session}: ${esc(m.task)}</li>`).join('')}</ul>` : ''}
      ${(cap.rubric || []).length ? `<table class="tc-time"><tbody>${cap.rubric.map(x => `<tr><td>${esc(x.marks)}</td><td>${esc(x.criterion)}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>${esc(cap.maxMarks)}</b></td><td>marks</td></tr></tfoot></table>` : ''}</div>` : `<p class="small muted">The course check drafts a capstone project${r ? '; the last check returned none' : ''}.</p>`}
  </div>`;
}

// "Written by Gemini · model (lesson) · Groq · model (practice, assessment)" for one session.
function tcWrittenLine(s) {
  const w = APL.writtenBy(s); if (!w.length) return '';
  const groups = new Map();
  w.forEach(x => { if (!groups.has(x.label)) groups.set(x.label, []); groups.get(x.label).push(CCL.PART_LABEL[x.part].toLowerCase()); });
  return `<p class="small muted tc-by">${icon('sparkles', 12)} Written by ${[...groups].map(([l, parts]) => `${esc(l)} (${parts.join(', ')})`).join(' · ')}</p>`;
}
function tcSessionRow(s, i, run, allowed) {
  const st = CCL.sessionState(s), job = run?.jobs.find(j => j.sessionId === s.id && (run.active || j.state !== 'done'));
  const chips = CCL.PARTS.map(p => {
    const running = job?.state === 'running' && job.part === p, queued = job && ['queued', 'running'].includes(job.state) && job.parts.includes(p) && !job.doneParts.includes(p) && !running && run.active;
    const cls = running ? 'run' : st.outdated.includes(p) ? 'warn' : st.done.includes(p) ? 'ok' : st.failed.includes(p) ? 'bad' : queued ? 'queued' : '';
    const label = running ? `${CCL.PART_LABEL[p]}: writing…` : queued ? `${CCL.PART_LABEL[p]}: queued` : `${CCL.PART_LABEL[p]}${st.editedParts.includes(p) ? ' (edited)' : ''}${st.outdated.includes(p) ? ' (out of date)' : ''}`;
    return `<span class="tc-chip ${cls}" title="${esc(st.errors[p]?.message || APL.writtenBy(s).filter(x => x.part === p).map(x => `Written by ${x.label}`).join(''))}">${running ? '<span class="spinner"></span>' : st.done.includes(p) && !st.outdated.includes(p) ? icon('check', 12) : st.failed.includes(p) ? icon('x', 12) : ''}${esc(label)}</span>`;
  }).join('');
  const rep = CCL.codeReport(s), items = CCL.sessionChecks(s), ok = items.filter(x => x.ok).length, busy = job && ['queued', 'running'].includes(job.state) && run.active, pend = CCL.pendingOf(s.content);
  const errs = st.failed.map(p => `${CCL.PART_LABEL[p]}: ${st.errors[p].message}`);
  return `<div class="tc-row"><span class="s-num">${i + 1}</span><div class="tc-rbody"><b>${esc(s.title)}</b><span class="small muted">${esc(s.moduleName || '')}${s.duration ? ` · ${esc(s.duration)}` : ''} · ${ok} of ${items.length} required items</span>
      <div class="tc-chips">${chips} ${s.content ? tcStateBadge(st, CCL.codeReport(s)) : ''}</div>${tcWrittenLine(s)}${errs.length ? `<p class="small text-danger">${esc(errs.join(' · '))}</p>` : ''}${Object.entries(s.content?.meta?.repairs?.errors || {}).map(([p, e]) => `<p class="small text-danger">${icon('alert', 12)} AI repair of the ${esc((CCL.PART_LABEL[p] || p).toLowerCase())} failed; nothing was changed. ${esc(e.message)}</p>`).join('')}${rep.findings.length ? `<p class="small ${rep.open ? 'text-warning' : 'muted'}">${icon('alert', 12)} ${rep.open ? `${rep.findings.length} code check${rep.findings.length === 1 ? '' : 's'} to review (${rep.errors} error${rep.errors === 1 ? '' : 's'}, ${rep.review} to confirm)` : `Code checks reviewed${rep.by ? ` by ${esc(findRecord('users', rep.by)?.name || 'a person')}` : ''}`}</p>` : ''}${pend.length ? `<p class="small text-warning">${icon('sparkles', 12)} ${pend.length} AI repair proposal${pend.length === 1 ? '' : 's'} waiting (${esc(pend.map(x => CCL.PART_LABEL[x.part].toLowerCase()).join(', '))}). The text has not been changed.</p>` : ''}${s.content?.meta?.instructions ? `<p class="small muted">${icon('edit', 12)} Instructions: ${esc(s.content.meta.instructions)}</p>` : ''}</div>
    <div class="tc-ractions">${pend.length && can('courses', 'edit') ? `<button class="btn btn-primary btn-sm" data-repair-review="${s.id}">${icon('sparkles', 14)} Review repair</button>` : ''}${s.content ? `<button class="btn btn-ghost btn-sm" data-view="${s.id}">${icon('eye', 14)} View</button>` : ''}
      ${allowed && !busy && (st.failed.length || (st.done.length && st.missing.length) || st.outdated.length) ? `<button class="btn btn-secondary btn-sm" data-retry="${s.id}">${st.outdated.length && !st.failed.length ? 'Update' : 'Retry'}</button>` : ''}
      ${allowed && !busy ? `<button class="btn btn-ghost btn-sm" data-regen="${s.id}">${icon('sparkles', 14)} ${st.done.length ? 'Regenerate' : 'Generate'}</button>` : ''}
      ${allowed && !busy && s.content ? `<button class="btn btn-ghost btn-sm" data-repair-open="${s.id}" title="Choose fields that look wrong; the AI writes a proposal and nothing is replaced until you accept it.">${icon('sparkles', 14)} Repair with AI</button>` : ''}
      ${can('courses', 'edit') ? (st.approved ? `<button class="btn btn-ghost btn-sm" data-unapprove="${s.id}">Withdraw approval</button>` : st.status === 'complete' ? (rep.open ? `<button class="btn btn-secondary btn-sm" data-view="${s.id}" title="${esc(CCL.approvalBlockers(s).join(' '))}">${icon('alert', 14)} Review code checks</button>` : `<button class="btn btn-primary btn-sm" data-approve="${s.id}">${icon('check', 14)} Approve</button>`) : '') : ''}</div></div>`;
}

// Approval is a person's decision. It is refused here, where it happens (not only by hiding the button),
// while the content is incomplete or has open code checks.
function tcSetApproval(id, yes, userId) {
  const s = findRecord('sessions', id);
  if (!s?.content) return { ok: false, reason: 'There is no content yet.' };
  if (yes) { const why = CCL.approvalBlockers(s); if (why.length) return { ok: false, reason: why[0] }; }
  const content = clone(s.content); content.meta = content.meta || {};
  if (yes) content.meta.approved = { by: userId, at: new Date().toISOString() }; else delete content.meta.approved;
  updateRecord('sessions', id, { content });
  return { ok: true };
}

/* ------------------------------------------------------ code checks */
// What the code checks found in this session, in words, with the confirmation of a person.
function tcCodePanel(rep, st, canAck, canRepair) {
  if (!rep.findings.length && !rep.info.length) return '';
  const row = f => `<li>${badge(f.level === 'error' ? 'Error' : 'To confirm', f.level === 'error' ? 'danger' : 'warning')} ${f.source === 'cut' ? esc(f.message) : `<b>${esc(CCL.pathLabel(f.path))}</b>${f.line ? ', line ' + f.line : ''}: ${esc(f.message)}`}</li>`;
  const n = rep.findings.length;
  const title = n ? (rep.open ? n + ' code check' + (n === 1 ? '' : 's') + ' need review by a person' : 'Code checks reviewed') : 'Shortened text';
  const how = 'Found by reading the stored code; nothing was changed or guessed. ' + (st.approved && rep.open ? '<b>This content is already approved:</b> withdraw approval if the code needs fixing. ' : '') + 'Fix a problem with <i>Edit</i>, or confirm that the code is as intended (an incomplete teaching snippet is fine).';
  const ack = rep.acknowledged ? '<p class="muted">Confirmed as checked' + (rep.at ? ' on ' + esc(fmtDateTime(rep.at)) : '') + '.</p>' : rep.open && (canAck || canRepair) ? `<div class="row gap-sm wrap">${canAck ? `<button class="btn btn-secondary btn-sm" data-ack>${icon('check', 14)} I have checked this code</button>` : ''}${canRepair ? `<button class="btn btn-ghost btn-sm" data-repair title="Choose the fields to repair; the fields with these problems are ticked. The AI writes a proposal and nothing is replaced until you accept it.">${icon('sparkles', 14)} Repair with AI</button>` : ''}</div>` : '';
  return `<div class="alert ${rep.open ? 'alert-warning' : 'cg-note'} small tc-codechecks" role="status"><b>${title}</b>
    ${n ? '<p>' + how + '</p><ul>' + rep.findings.map(row).join('') + '</ul>' : ''}
    ${rep.info.length ? '<ul>' + rep.info.map(x => '<li>' + esc(x.message) + '</li>').join('') + '</ul>' : ''}
    ${ack}</div>`;
}

/* ------------------------------------------------------ view modal */
function tcViewModal(course, s, done, start) {
  if (!s) return;
  const st = CCL.sessionState(s), rep = CCL.codeReport(s), canEdit = Domain.canManageCourse(App.user, course), batches = Domain.courseBatches(course.id).filter(b => Domain.canManageBatch(App.user, b));
  const used = s.content?.meta?.used || {};
  const m = openModal({
    title: `${t('session')} ${Domain.courseSessions(course.id, true).findIndex(x => x.id === s.id) + 1}: ${s.title}`, size: 'lg',
    body: `<div class="tc-view-toolbar"><div class="tc-view-status">${tcStateBadge(st, rep)}${start && canEdit && can('courses', 'edit') && s.content ? `<button class="btn btn-secondary btn-sm" data-repair-open title="Choose fields that look wrong; the AI writes a proposal and nothing is replaced until you accept it.">${icon('sparkles', 13)} Repair with AI</button>` : ''}</div>${canEdit ? `<div class="tc-view-edits">${CCL.PARTS.map(p => `<button class="btn btn-secondary btn-sm" data-ed="${p}">${icon('edit', 13)} Edit ${CCL.PART_LABEL[p].toLowerCase()}</button>`).join('')}</div>` : ''}</div>
      ${st.failed.length ? `<div class="alert alert-danger small">${st.failed.map(p => `${esc(CCL.PART_LABEL[p])}: ${esc(st.errors[p].message)}`).join('<br>')}</div>` : ''}
      ${tcWrittenLine(s)}
      ${tcRepairPanel(s, canEdit && can('courses', 'edit'))}
      ${tcCodePanel(rep, st, canEdit && can('courses', 'edit'), !!start && canEdit && can('courses', 'edit'))}
      ${tcContentHTML(s, { audience: 'staff' })}
      ${tcHistoryPanel(s, canEdit && can('courses', 'edit'))}
      ${canEdit && (s.content?.homework || s.content?.quiz?.length) ? `<div class="sub-section"><h3>Use the blueprints in a ${esc(t('batch', true))}</h3><p class="small muted">Creates a <b>draft</b> (not published, no due date) in the ${esc(t('batch', true))} you choose. ${esc(t('learners'))} see nothing until you publish it from the ${esc(t('batch', true))}.</p>
        ${batches.length ? `<div class="row gap-sm wrap"><select class="input input-sm" data-batch>${batches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>${s.content?.homework ? `<button class="btn btn-secondary btn-sm" data-mk="assignment">Create draft ${esc(t('assignment', true))}</button>` : ''}${s.content?.quiz?.length && feature('quizzes') ? `<button class="btn btn-secondary btn-sm" data-mk="quiz">Create draft ${esc(t('quiz', true))}</button>` : ''}</div>` : `<p class="small">This ${esc(t('course', true))} has no ${esc(t('batch', true))} yet. Create one first; the blueprints stay here until then.</p>`}
        ${[...(used.assignment || []), ...(used.quiz || [])].length ? `<p class="small muted">Already created: ${[...(used.assignment || []).map(x => `${t('assignment')} in ${findRecord('batches', x.batchId)?.name || 'a removed batch'}`), ...(used.quiz || []).map(x => `${t('quiz')} in ${findRecord('batches', x.batchId)?.name || 'a removed batch'}`)].map(esc).join(', ')}</p>` : ''}</div>` : ''}`,
    footer: `<button class="btn btn-ghost" data-modal-close>Close</button>`
  });
  bindCopyButtons(m);
  m.querySelector('[data-ack]')?.addEventListener('click', () => {
    const fresh = findRecord('sessions', s.id), content = CCL.acknowledgeCode(fresh, App.user.id, new Date().toISOString());
    if (!content) return;
    updateRecord('sessions', s.id, { content });
    toast('Marked as checked. It stops applying if the code changes.'); m.close(); tcViewModal(course, findRecord('sessions', s.id), done, start); done?.();
  });
  m.querySelectorAll('[data-repair], [data-repair-open]').forEach(b => b.addEventListener('click', () => { m.close(); tcRepairSelectModal(course, findRecord('sessions', s.id), start, done); }));
  m.querySelectorAll('[data-review-prop]').forEach(b => b.onclick = () => { m.close(); tcRepairModal(course, s.id, b.dataset.reviewProp, done, start); });
  m.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
    const fresh = findRecord('sessions', s.id), plan = CCL.restorePlan(fresh.content, b.dataset.restore);
    if (!plan.length) return toast('Nothing is left to restore from this change.', 'warning');
    const late = plan.filter(x => x.conflict), withdraws = !!fresh.content.meta?.approved;
    const msg = [`Put back the earlier text of: ${plan.map(x => x.label).join(', ')}.`,
      late.length ? `${late.map(x => x.label).join(', ')} ${late.length === 1 ? 'has' : 'have'} been changed since, so the newer text would be replaced (it stays in the history).` : '',
      withdraws ? `The approval is withdrawn${(findRecord('courses', course.id) || course).status === 'published' ? `; ${t('learners', true)} stop seeing this ${t('session', true)}'s content until it is approved again` : ''}.` : ''].filter(Boolean).join('\n\n');
    if (!(await confirmDialog(msg, { title: 'Restore earlier text', confirmText: 'Restore', danger: late.length > 0 }))) return;
    const again = findRecord('sessions', s.id), r = CCL.restoreEntry(again.content, b.dataset.restore, { by: App.user.id, at: new Date().toISOString(), force: CCL.restorePlan(again.content, b.dataset.restore).filter(x => x.conflict).map(x => x.key) });
    if (!r.changed) return toast('Nothing was restored.', 'warning');
    if (!tcSaveContent(course, s.id, r.content)) return;
    toast(`Restored ${r.applied.length} field${r.applied.length === 1 ? '' : 's'}.${withdraws ? ' Approval withdrawn.' : ''}`); m.close(); done?.(); tcViewModal(course, findRecord('sessions', s.id), done, start);
  });
  m.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { m.close(); tcEditModal(course, findRecord('sessions', s.id), b.dataset.ed, done); });
  m.querySelectorAll('[data-mk]').forEach(b => b.onclick = async () => {
    const batch = findRecord('batches', m.querySelector('[data-batch]').value), what = b.dataset.mk, fresh = findRecord('sessions', s.id);
    if (!batch) return;
    if (!(await confirmDialog(`Create a draft ${what === 'quiz' ? t('quiz', true) : t('assignment', true)} from this blueprint in ${batch.name}? It stays a draft until you publish it.`, { title: 'Create draft', confirmText: 'Create draft' }))) return;
    const d = db(), at = new Date().toISOString(), content = clone(fresh.content); content.meta = content.meta || {}; content.meta.used = content.meta.used || {};
    if (what === 'assignment') {
      const a = { ...CCL.assignmentFrom(fresh, batch), id: uid('A'), createdAt: at };
      d.assignments.push(a); (content.meta.used.assignment ||= []).push({ batchId: batch.id, id: a.id, at });
    } else {
      const q = CCL.quizFrom(fresh, batch, uid);
      q.questions.forEach(x => d.questions.push({ ...x, createdAt: at }));
      const quiz = { ...q.quiz, id: uid('QZ'), createdAt: at };
      d.quizzes.push(quiz); (content.meta.used.quiz ||= []).push({ batchId: batch.id, id: quiz.id, at });
    }
    d.sessions.find(x => x.id === fresh.id).content = content;
    saveDB(d); m.close(); toast(`Draft created in ${batch.name}. Open the ${t('batch', true)} to review and publish it.`); done?.();
  });
}

/* ------------------------------------------- Repair with AI: review and history */
// Everything that changes content after a person's decision (accept fields, restore) is saved here. If
// storing fails, the previous content is put back, so a half-saved change is never left in memory.
function tcSaveContent(course, sessionId, content) {
  const prev = findRecord('sessions', sessionId)?.content;
  tcKeepReview(course.id);
  try { updateRecord('sessions', sessionId, { content }); return true; }
  catch (e) { try { updateRecord('sessions', sessionId, { content: prev }); } catch (x) {} toast(`Could not save: ${e.message}. Nothing was changed.`, 'error'); return false; }
}
const tcWho = id => findRecord('users', id)?.name || 'a person';
const TC_KIND = { repair: 'AI repair accepted', regenerate: 'Regenerated with AI', restore: 'Earlier text restored', rejected: 'AI repair rejected' };

// Proposals waiting for a decision (and the last failed repair request), shown in the session view.
function tcRepairPanel(s, canDecide) {
  const pend = CCL.pendingOf(s.content), errs = Object.entries(s.content?.meta?.repairs?.errors || {});
  if (!pend.length && !errs.length) return '';
  return `<div class="alert cg-note small tc-repairs" role="status"><b>${icon('sparkles', 13)} AI repair</b>
    ${pend.length ? `<p>${pend.length} proposal${pend.length === 1 ? '' : 's'} waiting. <b>The text below has not been changed.</b> Compare it with the AI's version and choose what to keep.</p><ul>${pend.map(p => { const n = CCL.proposalChanges(s.content, p).filter(x => x.change !== 'same').length; return `<li>${esc(CCL.PART_LABEL[p.part])} · ${esc(p.provider)} ${esc(p.model)} · ${esc(fmtDateTime(p.at))} · ${n} field${n === 1 ? '' : 's'} would change ${canDecide ? `<button class="btn btn-primary btn-sm" data-review-prop="${esc(p.id)}">Review changes</button>` : ''}</li>`; }).join('')}</ul>` : ''}
    ${errs.length ? `<p class="text-danger">The last repair request failed; nothing was changed:</p><ul>${errs.map(([p, e]) => `<li>${esc(CCL.PART_LABEL[p] || p)}: ${esc(e.message)}</li>`).join('')}</ul>` : ''}</div>`;
}
// What was replaced and when, with a way back.
function tcHistoryPanel(s, canRestore) {
  const list = CCL.historyOf(s.content);
  if (!list.length) return '';
  return `<div class="sub-section tc-history"><h3>Change history</h3><p class="small muted">Every AI repair, regeneration and restore keeps the text it replaced, so it can be put back. The last ${CCL.HISTORY_MAX} changes are kept.</p><ul class="tc-hist">${list.map(e => {
    const names = (e.applied || []).map(it => CCL.SCHEMA[it.key]?.label || it.key), left = (e.applied || []).filter(it => !(e.restoredKeys || []).includes(it.key));
    return `<li class="${e.kind === 'rejected' ? 'dim' : ''}"><div><b>${esc(TC_KIND[e.kind] || e.kind)}</b>${CCL.PART_LABEL[e.part] ? ` · ${esc(CCL.PART_LABEL[e.part])}` : ''}<br><span class="small muted">${esc(fmtDateTime(e.at))} · ${esc(tcWho(e.by))}${e.provider ? ` · ${esc(e.provider)} ${esc(e.model || '')}` : ''}</span>${names.length ? `<br><span class="small">${esc(names.join(', '))}${e.forced?.length ? ' <b class="text-warning">(replaced text that had changed meanwhile)</b>' : ''}</span>` : ''}${e.kind === 'rejected' ? '<br><span class="small">The proposal was declined; the text was not changed.</span>' : ''}${e.restoredAt ? `<br><span class="small muted">Put back ${esc(fmtDateTime(e.restoredAt))} by ${esc(tcWho(e.restoredBy))}${left.length ? ` (${names.length - left.length} of ${names.length} fields)` : ''}</span>` : ''}</div>${canRestore && left.length && e.kind !== 'rejected' ? `<button class="btn btn-secondary btn-sm" data-restore="${esc(e.id)}">Restore earlier text</button>` : ''}</li>`;
  }).join('')}</ul></div>`;
}

// Compare, choose and apply. Nothing in the session changes until "Apply" and only for the fields chosen.
function tcRepairModal(course, sessionId, proposalId, done, start) {
  const s0 = findRecord('sessions', sessionId);
  if (!s0) return;
  const pend = CCL.pendingOf(s0.content), p = pend.find(x => x.id === proposalId) || pend[0];
  if (!p) return toast(`There is no repair waiting for this ${t('session', true)}.`, 'warning');
  const canDecide = Domain.canManageCourse(App.user, course) && can('courses', 'edit');
  const st = CCL.sessionState(s0), live = findRecord('courses', course.id) || course, n = Domain.courseSessions(course.id, true).findIndex(x => x.id === s0.id) + 1;
  const all = CCL.proposalChanges(s0.content, p), changes = all.filter(x => x.change !== 'same'), same = all.filter(x => x.change === 'same');
  const conflicts = changes.filter(x => x.conflict);
  const CH = { changed: 'Changed', added: 'New field', removed: 'Removed' };
  const block = ch => {
    const rows = CCL.diffRows(CCL.diffLines(CCL.fieldLines(ch.key, ch.before), CCL.fieldLines(ch.key, ch.after)));
    const cell = (txt, cls) => (txt === undefined ? '<td></td>' : `<td class="${cls}">${esc(txt) || '&nbsp;'}</td>`);
    return `<fieldset class="tc-rp ${ch.conflict ? 'conflict' : ''}" data-key="${ch.key}">
      <div class="tc-rp-head"><b>${esc(ch.label)}</b><span class="row">${badge(CH[ch.change], 'info')}${ch.checks.before || ch.checks.after ? badge(`Code checks ${ch.checks.before} → ${ch.checks.after}`, ch.checks.after < ch.checks.before ? 'success' : ch.checks.after > ch.checks.before ? 'danger' : 'neutral') : ''}${ch.edited ? badge('Part edited by a person', 'warning') : ''}${ch.review.length ? badge('Needs your review', 'warning') : ''}${ch.conflict ? badge('Changed since the AI saw it', 'danger') : ''}</span></div>
      ${ch.review.length ? `<div class="alert alert-warning small"><b>Read this one carefully.</b> The checks cannot tell whether this change is right:<ul>${ch.review.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="tc-diff-wrap"><table class="tc-diff"><thead><tr><th>Current</th><th>AI proposal</th></tr></thead><tbody>${rows.map(r => r.k === 'gap' ? `<tr class="gap"><td colspan="2">${r.n} unchanged line${r.n === 1 ? '' : 's'}</td></tr>` : `<tr>${cell(r.l, r.k === 'chg' && r.l !== undefined ? 'del' : '')}${cell(r.r, r.k === 'chg' && r.r !== undefined ? 'add' : '')}</tr>`).join('')}</tbody></table></div>
      ${ch.conflict ? `<p class="small text-danger">This field is not what the AI was shown: it was changed after the request started. The left column is the newer, current text. Using the AI version replaces it (it stays in the change history).</p>` : ''}
      <div class="tc-d-choice" role="radiogroup" aria-label="Decision for ${esc(ch.label)}"><label class="check"><input type="radio" name="d-${ch.key}" value="keep" checked ${canDecide ? '' : 'disabled'}><span>Keep current</span></label><label class="check"><input type="radio" name="d-${ch.key}" value="use" ${canDecide ? '' : 'disabled'}><span>Use the AI version${ch.conflict ? ' (replaces the newer text)' : ''}</span></label></div></fieldset>`;
  };
  const m = openModal({
    title: `Repair with AI: ${CCL.PART_LABEL[p.part]} · ${t('session')} ${n}: ${s0.title}`, size: 'lg',
    body: `<div class="alert cg-note small"><b>Nothing has been changed.</b> The AI wrote this as a proposal. For each field below, choose to keep the current text or use the AI's. Only the fields you choose are replaced, and the text they replace is kept in the change history.<br>
        <span class="muted">${esc(p.provider)} ${esc(p.model)} · ${esc(fmtDateTime(p.at))} · ${esc(tcWho(p.by))} · ${(p.tokens || 0).toLocaleString('en')} tokens · code checks in this part: ${p.checks.before} → ${p.checks.after}</span>${p.scope ? `<br><span class="small">Fields the AI was asked to repair: ${esc(p.requested.map(k => CCL.SCHEMA[k]?.label || k).join(', '))}.${p.requested.some(k => !p.scope.includes(k)) ? ` <b>Not returned, left unchanged:</b> ${esc(p.requested.filter(k => !p.scope.includes(k)).map(k => CCL.SCHEMA[k]?.label || k).join(', '))}.` : ''}${p.carried?.length ? ` Also kept from an earlier proposal: ${esc(p.carried.map(k => CCL.SCHEMA[k]?.label || k).join(', '))}.` : ''}</span>` : ''}${p.instructions ? `<details class="tc-more"><summary>Instructions given to the AI</summary><pre class="small" style="white-space:pre-wrap">${esc(p.instructions)}</pre></details>` : ''}</div>
      ${pend.length > 1 ? `<div class="row gap-xs wrap mb">${pend.map(x => `<button class="btn ${x.id === p.id ? 'btn-secondary' : 'btn-ghost'} btn-sm" data-switch="${esc(x.id)}">${esc(CCL.PART_LABEL[x.part])}</button>`).join('')}</div>` : ''}
      ${conflicts.length ? `<div class="alert alert-danger small"><b>${conflicts.length} field${conflicts.length === 1 ? ' was' : 's were'} changed after this request started</b> (by a person, or by another regeneration): ${esc(conflicts.map(x => x.label).join(', '))}. They are not replaced unless you choose the AI version for them.</div>` : ''}
      ${st.approved ? `<div class="alert alert-warning small">This ${esc(t('session', true))} is <b>approved</b>${live.status === 'published' ? ` and the ${esc(t('course', true))} is <b>published</b>, so ${esc(t('learners', true))} can see it now` : ''}. Applying any field withdraws the approval; ${esc(t('learners', true))} will not see the ${esc(t('session', true))}'s content until a person approves it again.</div>` : ''}
      ${changes.length ? changes.map(block).join('') : '<p class="muted">The AI version is identical to the current text. There is nothing to apply.</p>'}
      ${same.length ? `<p class="small muted">No difference: ${esc(same.map(x => x.label).join(', '))}.</p>` : ''}`,
    footer: `<button class="btn btn-ghost" data-modal-close>Close</button>${canDecide ? `<button class="btn btn-ghost" data-reject>Reject proposal</button>${changes.length ? `<button class="btn btn-ghost" data-all title="Fields marked “Needs your review” or changed since the AI saw them are not included.">Use the AI version for all that need no extra review</button><button class="btn btn-primary" data-apply disabled>Apply 0 fields</button>` : ''}` : ''}`
  });
  const picked = () => changes.filter(ch => m.querySelector(`input[name="d-${ch.key}"][value="use"]`)?.checked);
  const sync = () => { const b = m.querySelector('[data-apply]'); if (b) { const k = picked().length; b.disabled = !k; b.textContent = `Apply ${k} field${k === 1 ? '' : 's'}`; } };
  m.addEventListener('change', sync);
  m.querySelector('[data-all]')?.addEventListener('click', () => { changes.filter(ch => !ch.review.length && !ch.conflict).forEach(ch => { const r = m.querySelector(`input[name="d-${ch.key}"][value="use"]`); if (r) r.checked = true; }); sync(); });
  m.querySelectorAll('[data-switch]').forEach(b => b.onclick = () => { m.close(); tcRepairModal(course, sessionId, b.dataset.switch, done, start); });
  const back = () => { m.close(); done?.(); const f = findRecord('sessions', sessionId); if (f) tcViewModal(course, f, done, start); };
  m.querySelector('[data-reject]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Discard the AI's ${CCL.PART_LABEL[p.part].toLowerCase()} proposal? The ${t('session', true)} keeps its current text. The proposal is deleted; the decision is recorded in the change history.`, { title: 'Reject proposal', confirmText: 'Reject' }))) return;
    const fresh = findRecord('sessions', sessionId), r = CCL.rejectProposal(fresh.content, p.id, { by: App.user.id, at: new Date().toISOString() });
    if (r.changed && !tcSaveContent(course, sessionId, r.content)) return;
    toast('Proposal rejected. Nothing was changed.'); back();
  });
  m.querySelector('[data-apply]')?.addEventListener('click', async () => {
    // Decide from the record as it is now, not as it was when this window opened.
    const fresh = findRecord('sessions', sessionId), pNow = CCL.pendingOf(fresh?.content).find(x => x.id === p.id);
    if (!pNow) { toast('This proposal was already applied or removed.', 'warning'); return back(); }
    const now = CCL.proposalChanges(fresh.content, pNow), chosen = picked().map(x => x.key), sel = now.filter(x => chosen.includes(x.key) && x.change !== 'same');
    if (!sel.length) return toast('Nothing to apply: the chosen fields already match.', 'warning');
    const late = sel.filter(x => x.conflict), person = sel.filter(x => x.edited), care = sel.filter(x => x.review.length), withdraws = !!fresh.content.meta?.approved;
    const msg = [`Replace ${sel.map(x => x.label).join(', ')} in ${t('session')} ${n} with the AI version. The text it replaces is kept in the change history and can be restored. Nothing is approved or published by this.`,
      care.length ? `Check these before you continue; the automatic checks cannot confirm they are right:\n${care.map(x => `• ${x.label}: ${x.review.join(' ')}`).join('\n')}` : '',
      late.length ? `${late.map(x => x.label).join(', ')} ${late.length === 1 ? 'was' : 'were'} changed after the AI started, so you would replace newer text.` : '',
      person.length ? `The ${CCL.PART_LABEL[p.part].toLowerCase()} part contains edits by a person${fresh.content.meta?.edited?.at ? ` (${fmtDateTime(fresh.content.meta.edited.at)})` : ''}; the replaced text can be restored from the change history.` : '',
      withdraws ? `The approval is withdrawn${(findRecord('courses', course.id) || course).status === 'published' ? `; ${t('learners', true)} stop seeing this ${t('session', true)}'s content until it is approved again` : ''}.` : ''].filter(Boolean).join('\n\n');
    if (!(await confirmDialog(msg, { title: 'Apply the AI version', confirmText: `Apply ${sel.length} field${sel.length === 1 ? '' : 's'}`, danger: late.length > 0 || person.length > 0 || care.length > 0 }))) return;
    const again = findRecord('sessions', sessionId), r = CCL.applyProposal(again.content, pNow, sel.map(x => x.key), { by: App.user.id, at: new Date().toISOString(), force: late.map(x => x.key) });
    if (!r.changed) { toast('Nothing was applied: the text changed while you were deciding. Review it again.', 'warning'); return back(); }
    if (!tcSaveContent(course, sessionId, r.content)) return;
    const rest = CCL.codeReport({ content: r.content }).findings.length;
    toast(`Applied ${r.applied.length} field${r.applied.length === 1 ? '' : 's'}.${r.skipped.length ? ` ${r.skipped.length} skipped because the text changed.` : ''}${withdraws ? ' Approval withdrawn.' : ''}${rest ? ` ${rest} code check${rest === 1 ? '' : 's'} remain.` : ''} The earlier text is in the change history.`, rest ? 'warning' : undefined);
    back();
  });
}

/* ------------------------------------- Repair with AI: choose the fields */
// Any session with content, with or without an automatic code finding: the coordinator ticks the fields that
// look wrong and may say what is wrong. Fields with open code checks start ticked. Nothing is replaced: the
// answer becomes a proposal to compare and accept field by field.
async function tcRepairSelectModal(course, s, start, done) {
  if (!s?.content || !start) return;
  if (TCRun.get(course.id)?.active) return toast('An AI run is still going for this course. Wait until it finishes, then repair.', 'warning');
  const route = await tcRepairRoute(course.id), targets = CCL.repairTargets(s), st = CCL.sessionState(s), n = Domain.courseSessions(course.id, true).findIndex(x => x.id === s.id) + 1;
  const setup = route.usable === false
    ? `<div class="alert alert-danger small" role="alert"><b>${esc(route.label)} cannot be used for this repair, so nothing can be sent.</b> ${route.configured === false ? `No API key is saved for ${esc(route.label)}.` : esc(route.reason)} No other provider will be used instead. Use <b>Change provider</b> to pick another provider an administrator has set up, or ask an administrator to fix this in <b>Settings → Integrations</b> (AI content repair: the provider, its API key and the model).</div>`
    : route.configured === null ? '<div class="alert alert-warning small">The AI settings could not be checked just now. The repair is still tried, and any failure is reported.</div>' : '';
  const group = p => { const rows = targets.filter(x => x.part === p); return rows.length ? `<fieldset class="tc-parts"><legend class="label"><label class="check"><input type="checkbox" data-group="${p}"><span>${esc(CCL.PART_LABEL[p])}</span></label></legend>${rows.map(x => `<label class="check"><input type="checkbox" name="k" value="${x.key}" ${x.open ? 'checked' : ''}><span>${esc(x.label)} <span class="small muted">· ${(x.size / 1000).toFixed(1)}k characters</span>${x.findings ? ` ${badge(`${x.findings} code check${x.findings === 1 ? '' : 's'}`, x.errors ? 'danger' : 'warning')}` : ''}${x.edited ? ` ${badge('edited by a person', 'warning')}` : ''}</span></label>`).join('')}</fieldset>` : ''; };
  const m = openModal({
    title: `Repair with AI: ${t('session')} ${n}: ${s.title}`, size: 'md',
    body: `<form data-f class="stack-sm">
      <div class="alert cg-note small"><b>Provider:</b> ${esc(route.label)}${route.model ? ` · ${esc(route.model)}` : ''}${route.profile ? ` · key “${esc(route.profile)}”` : ''}${route.source === 'temporary' ? ` ${badge('Temporary choice', 'warning')}` : ' (from Settings → Integrations → AI content repair)'}. If it fails, the failure is reported and <b>no other provider is used</b> unless you choose one. <button type="button" class="btn btn-ghost btn-sm" data-ap-change>Change provider</button>${route.source === 'temporary' ? ' <button type="button" class="btn btn-ghost btn-sm" data-ap-reset>Use the Settings choice</button>' : ''}</div>
      ${setup}
      ${targets.length ? `<p class="help"><b>Nothing is replaced.</b> Tick the fields that look wrong. The AI is shown their current text, the code checks found in them and your description, and writes a proposal. You then compare it with the current text and accept only the fields you want. A person still approves the content.</p>${CCL.PARTS.map(group).join('')}` : `<p class="muted">This ${esc(t('session', true))} has no text to repair yet.</p>`}
      <div class="field"><label class="label" for="tc-rins">What is wrong? (optional)</label><textarea class="input" id="tc-rins" name="ins" rows="3" maxlength="1500" placeholder="For example: the quiz options are missing the () after method names; Session 5 exercise 2 stops half-way; the example output does not match the code."></textarea></div>
      <p class="small muted" data-summary></p></form>`,
    footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-go disabled>${icon('sparkles', 15)} Write a proposal</button>`
  });
  const f = m.querySelector('[data-f]'), picked = () => [...f.querySelectorAll('input[name="k"]:checked')].map(x => x.value);
  const sync = () => {
    const keys = picked(), batches = CCL.repairBatches(s.content, keys).length, finds = CCL.codeReport(s).findings.filter(x => keys.includes(x.field)).length;
    f.querySelector('[data-summary]').textContent = keys.length ? `${keys.length} field${keys.length === 1 ? '' : 's'} chosen: ${batches} AI request${batches === 1 ? '' : 's'}.${finds ? ` ${finds} automatic code check${finds === 1 ? '' : 's'} in them will be sent as context.` : ' No automatic code check applies to them; your description (if any) is the context.'}` : '';
    const go = m.querySelector('[data-go]'); go.disabled = !keys.length || route.usable === false;
    CCL.PARTS.forEach(p => { const g = f.querySelector(`[data-group="${p}"]`); if (g) { const all = [...f.querySelectorAll('input[name="k"]')].filter(x => CCL.SCHEMA[x.value].part === p); g.checked = all.length > 0 && all.every(x => x.checked); } });
  };
  m.querySelector('[data-ap-change]')?.addEventListener('click', async () => {
    const o = await AIRoute.pick({ scope: course.id, feature: 'contentRepair', title: 'Choose the AI provider', intro: `Use another provider to repair this ${t('session', true)}? Nothing is sent until you press "Write a proposal".`, stopped: null });
    if (!o) return;
    AIRoute.set(course.id, o); m.close(); tcRepairSelectModal(course, findRecord('sessions', s.id), start, done);
  });
  m.querySelector('[data-ap-reset]')?.addEventListener('click', () => { AIRoute.clear(course.id); m.close(); tcRepairSelectModal(course, findRecord('sessions', s.id), start, done); });
  f.addEventListener('change', e => { if (e.target.dataset.group) f.querySelectorAll('input[name="k"]').forEach(x => { if (CCL.SCHEMA[x.value].part === e.target.dataset.group) x.checked = e.target.checked; }); sync(); });
  sync();
  m.querySelector('[data-go]').onclick = () => {
    const keys = picked(); if (!keys.length) return toast('Choose at least one field.', 'error');
    if (TCRun.get(course.id)?.active) return toast('An AI run is still going for this course.', 'warning');
    const parts = CCL.PARTS.filter(p => keys.some(k => CCL.SCHEMA[k].part === p)), repairKeys = {};
    parts.forEach(p => { repairKeys[p] = keys.filter(k => CCL.SCHEMA[k].part === p); });
    m.close(); start([{ sessionId: s.id, parts, instructions: f.ins.value.trim(), repairKeys, repairParts: parts, proposeParts: parts }]);
  };
}

/* ---------------------------------------------------- regenerate modal */
function tcRegenModal(course, s, start) {
  if (!s || !start) return;
  const st = CCL.sessionState(s), pre = CCL.PARTS.filter(p => !st.done.includes(p) || st.outdated.includes(p) || st.failed.includes(p));
  // Parts a person edited start unticked: replacing an edit is always an explicit choice.
  const unedited = CCL.PARTS.filter(p => !st.editedParts.includes(p)), checked = pre.length ? pre : unedited.length ? unedited : [];
  const m = openModal({
    title: `${st.done.length ? 'Regenerate' : 'Generate'} content: ${s.title}`, size: 'md',
    body: `<form data-f class="stack-sm"><div class="tc-routeline" data-route-line></div><fieldset class="tc-parts"><legend class="label">Parts</legend>${CCL.PARTS.map(p => `<label class="check"><input type="checkbox" name="p" value="${p}" ${checked.includes(p) ? 'checked' : ''}><span>${esc(CCL.PART_LABEL[p])}${st.done.includes(p) ? ' (replaces what is there)' : ''}${st.editedParts.includes(p) ? ` <b class="text-warning">· edited by a person</b>` : ''}</span></label>`).join('')}</fieldset>
      ${s.content?.meta?.instructions ? `<p class="small"><b>Standing instructions</b> (from applied proposals): ${esc(s.content.meta.instructions)}</p>` : ''}
      <div class="field"><label class="label" for="tc-ins">Extra instructions for this run (optional)</label><textarea class="input" id="tc-ins" name="ins" rows="3" maxlength="1500" placeholder="For example: use a library-management example throughout; add more practice on flexbox."></textarea></div>
      <p class="help">The ${esc(t('session', true))} title, summary and module are not changed. Each part is one AI request and is saved as soon as it is ready.</p></form>`,
    footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-go>${icon('sparkles', 15)} Generate</button>`
  });
  const line = () => AIRoute.fillLine(m.querySelector('[data-route-line]'), course.id, 'courseContent', { canChange: true, onChange: line });
  line();
  m.querySelector('[data-go]').onclick = async () => {
    const f = m.querySelector('[data-f]'), parts = CCL.PARTS.filter(p => f.querySelector(`input[value="${p}"]`).checked), ins = f.ins.value.trim();
    if (!parts.length) return toast('Choose at least one part.', 'error');
    const edited = parts.filter(p => st.editedParts.includes(p)), replaces = parts.filter(p => st.done.includes(p));
    if (edited.length && !(await confirmDialog(`The ${edited.map(p => CCL.PART_LABEL[p].toLowerCase()).join(' and ')} part${edited.length === 1 ? ' was' : 's were'} edited by a person${s.content?.meta?.edited?.at ? ` (${fmtDateTime(s.content.meta.edited.at)})` : ''}. Regenerating replaces those edits.${st.approved ? ' The content is approved; the new content needs a new review and approval before learners see it.' : ''} Continue?`, { title: 'Replace edited content', confirmText: 'Replace edits', danger: true }))) return;
    if (!edited.length && replaces.length && st.approved && !(await confirmDialog('This content is approved. New content needs a new review and approval before learners see it. Continue?', { title: 'Regenerate approved content', confirmText: 'Regenerate' }))) return;
    m.close(); start([{ sessionId: s.id, parts, instructions: ins, repairParts: replaces, fill: parts.filter(p => !st.done.includes(p)) }]);
  };
}

/* ------------------------------------------------------ content editor */
// Built from CCL.SCHEMA: short lists are edited one item per line ("a | b" for pairs), longer
// structures as repeatable groups. Saving records that a person edited the part.
const TC_SPLIT = v => { const out = []; let cur = [], fence = false; String(v || '').replace(/\r\n/g, '\n').split('\n').forEach(l => { if (/^```/.test(l.trim())) fence = !fence; if (!fence && !l.trim()) { if (cur.length) out.push(cur.join('\n')); cur = []; } else cur.push(l); }); if (cur.length) out.push(cur.join('\n')); return out; };
const tcSimpleObj = s => s.t === 'obj' && Object.values(s.fields).every(f => ['line', 'int', 'num'].includes(f.t));
function tcNode(key, s, v, label) {
  const lab = label ? `<label class="label">${esc(label)}</label>` : '';
  const help = h => `<p class="help">${h}</p>`;
  if (s.t === 'line') return `<div class="field full" data-key="${key}">${lab}<input class="input" data-node="line" value="${esc(v ?? '')}"></div>`;
  if (s.t === 'text') return `<div class="field full" data-key="${key}">${lab}<textarea class="input" data-node="text" rows="${Math.min(14, Math.max(3, String(v || '').split('\n').length + 1))}">${esc(v ?? '')}</textarea></div>`;
  if (s.t === 'code') return `<div class="field full" data-key="${key}">${lab}<textarea class="input tc-mono" data-node="code" rows="${Math.min(24, Math.max(4, String(v || '').split('\n').length + 1))}" spellcheck="false">${esc(v ?? '')}</textarea></div>`;
  if (s.t === 'int' || s.t === 'num') {
    if (key === 'answer') return `<div class="field" data-key="${key}">${lab.replace(esc(label), 'Correct option (1 = first)')}<input class="input" type="number" min="1" max="6" data-node="index" value="${Number.isInteger(v) ? v + 1 : ''}"></div>`;
    return `<div class="field" data-key="${key}">${lab}<input class="input" type="number" step="${s.t === 'int' ? 1 : 0.5}" min="${s.min}" max="${s.max}" data-node="num" value="${esc(v ?? '')}"></div>`;
  }
  if (s.t === 'bool') return `<div class="field full" data-key="${key}"><label class="check"><input type="checkbox" data-node="bool" ${v !== false ? 'checked' : ''}><span>${esc(label)}</span></label></div>`;
  if (s.t === 'list' && s.of.t === 'line') return `<div class="field full" data-key="${key}">${lab}<textarea class="input" data-node="lines" rows="${Math.min(12, Math.max(3, (v || []).length + 1))}">${esc((v || []).join('\n'))}</textarea>${help('One per line.')}</div>`;
  if (s.t === 'list' && s.of.t === 'text') { const joined = (v || []).map(x => CCL.closeFence(x)).join('\n\n'); return `<div class="field full" data-key="${key}">${lab}<textarea class="input" data-node="blocks" rows="${Math.min(16, Math.max(4, joined.split('\n').length + 1))}">${esc(joined)}</textarea>${help('Separate items with an empty line.')}</div>`; }
  if (s.t === 'list' && s.of.t === 'int') return `<div class="field full" data-key="${key}">${lab}<input class="input" data-node="ints" value="${esc((v || []).join(', '))}"></div>`;
  if (s.t === 'list' && tcSimpleObj(s.of)) { const cols = Object.keys(s.of.fields); return `<div class="field full" data-key="${key}">${lab}<textarea class="input" data-node="pipes" data-cols="${cols.join(',')}" rows="${Math.min(14, Math.max(3, (v || []).length + 1))}">${esc((v || []).map(x => cols.map(c => x[c] ?? '').join(' | ')).join('\n'))}</textarea>${help(`One per line: ${cols.join(' | ')}`)}</div>`; }
  if (s.t === 'list' && s.of.t === 'obj') return `<div class="field full" data-key="${key}">${lab}<div data-node="olist">${(v || []).map((x, i) => tcItem(s.of, x, i)).join('')}</div><template>${tcItem(s.of, {}, 0)}</template><button type="button" class="btn btn-ghost btn-sm" data-add-item>${icon('plus', 13)} Add</button></div>`;
  if (s.t === 'obj') return `<div class="field full" data-key="${key}">${lab}<div class="tc-group" data-node="obj">${Object.entries(s.fields).map(([k, f]) => tcNode(k, f, v?.[k], tcLabel(k))).join('')}</div></div>`;
  return '';
}
const tcLabel = k => ({ minutes: 'Minutes', activity: 'Activity', heading: 'Heading', body: 'Explanation', example: 'Worked example', term: 'Term', meaning: 'Meaning', title: 'Title', goal: 'Goal', steps: 'Steps', language: 'Language', code: 'Code', explanation: 'Explanation', description: 'Description', instructions: 'Instructions', hint: 'Hint', solution: 'Solution', task: 'Task', criteria: 'Success criteria', brief: 'Brief', deliverables: 'Deliverables', rubric: 'Marking rubric', maxMarks: 'Maximum marks (sum of the rubric)', estimatedHours: 'Estimated hours', question: 'Question', options: 'Options', answer: 'Correct option', type: 'Type', note: 'Note', criterion: 'Criterion', marks: 'Marks', requirements: 'Requirements', milestones: 'Milestones', session: 'Session' }[k] || k);
function tcItem(s, v, i) {
  return `<fieldset class="tc-group" data-item><div class="row-between"><span class="small muted">Item</span><button type="button" class="icon-btn icon-btn-sm danger" data-rm-item aria-label="Remove">${icon('trash', 13)}</button></div><div data-node="obj">${Object.entries(s.fields).map(([k, f]) => tcNode(k, f, v?.[k], tcLabel(k))).join('')}</div></fieldset>`;
}
function tcRead(el) {
  const node = el.matches('[data-node]') ? el : el.querySelector('[data-node]'), kind_ = node.dataset.node;
  switch (kind_) {
    case 'line': case 'text': case 'code': return node.value;
    case 'num': return node.value === '' ? undefined : Number(node.value);
    case 'index': return node.value === '' ? undefined : Number(node.value) - 1;
    case 'bool': return node.checked;
    case 'lines': return node.value.split('\n').map(x => x.trim()).filter(Boolean);
    case 'blocks': return TC_SPLIT(node.value);
    case 'ints': return node.value.split(/[^0-9]+/).filter(Boolean).map(Number);
    case 'pipes': { const cols = node.dataset.cols.split(','); return node.value.split('\n').filter(l => l.trim()).map(l => { const v = l.split('|').map(x => x.trim()), o = {}; cols.forEach((c, i) => { o[c] = i === cols.length - 1 ? v.slice(i).join(' | ') : v[i] ?? ''; }); return o; }); }
    case 'olist': return [...node.children].filter(x => x.matches('[data-item]')).map(it => tcReadObj(it.querySelector('[data-node="obj"]')));
    case 'obj': return tcReadObj(node);
  }
  return undefined;
}
function tcReadObj(objEl) {
  const out = {};
  objEl.querySelectorAll('[data-key]').forEach(f => { if (f.parentElement.closest('[data-node="obj"]') === objEl) out[f.dataset.key] = tcRead(f.querySelector('[data-node]')); });
  return out;
}
function tcEditModal(course, s, part, done) {
  if (!s || !CCL.PARTS.includes(part)) return;
  const keys = CCL.FIELDS_OF(part), c = s.content || {};
  const m = openModal({
    title: `Edit ${CCL.PART_LABEL[part].toLowerCase()}: ${s.title}`, size: 'lg',
    body: `<div class="alert alert-danger small" data-over hidden></div><form data-f class="form-grid" novalidate>${keys.map(k => tcNode(k, CCL.SCHEMA[k].s, c[k], CCL.SCHEMA[k].label)).join('')}</form>
      <p class="help">Saved edits are marked as made by a person; regenerating this part later asks before replacing them.${part === 'practice' ? ' Code is kept exactly as typed.' : ''} Links to websites are removed on save unless they are in code.</p>`,
    footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-save>Save changes</button>`
  });
  const f = m.querySelector('[data-f]');
  f.addEventListener('click', e => {
    const add = e.target.closest('[data-add-item]'), rm = e.target.closest('[data-rm-item]');
    if (add) { const field = add.closest('[data-key]'); field.querySelector('[data-node="olist"]').insertAdjacentHTML('beforeend', field.querySelector('template').innerHTML); }
    if (rm) rm.closest('[data-item]').remove();
  });
  m.querySelector('[data-save]').onclick = () => {
    const fields = {};
    keys.forEach(k => { const el = [...f.querySelectorAll('[data-key]')].find(x => x.dataset.key === k && x.parentElement === f); if (el) fields[k] = tcRead(el.querySelector('[data-node]')); });
    if (fields.homework?.rubric?.length) fields.homework.maxMarks = fields.homework.rubric.reduce((n, r) => n + (Number(r.marks) || 0), 0) || fields.homework.maxMarks;
    const fresh = findRecord('sessions', s.id);
    const r = CCL.applyEdit(fresh.content, fields, App.user.id, new Date().toISOString(), { lang: CCL.hintLanguage(course, s) });
    const over = m.querySelector('[data-over]');
    if (r.overLimit && r.overLimit.length) {
      over.hidden = false;
      const what = x => (x.kind === 'items' ? esc(x.label) + ': at most ' + x.max + ' items (' + x.from + ' given)' : esc(x.label) + ': ' + x.from + ' characters, the limit is ' + x.max);
      over.innerHTML = '<b>Not saved: too long.</b> ' + r.overLimit.map(what).join('; ') + '. Shorten it and save again; nothing was cut.';
      return toast('Not saved: a field is over its limit.', 'error');
    }
    over.hidden = true;
    if (!r.changed) { m.close(); return toast('No changes.'); }
    tcKeepReview(course.id);
    updateRecord('sessions', s.id, { content: r.content });
    const added = (r.fixes || []).filter(x => x.kind === 'fenced').length, flagged = (r.findings || []).length;
    const msg = ['Content saved.'];
    if (added) msg.push('A code block was added in ' + added + (added === 1 ? ' place.' : ' places.'));
    if (flagged) msg.push(flagged + (flagged === 1 ? ' code check' : ' code checks') + ' to review.');
    m.close(); toast(msg.join(' '), flagged ? 'warning' : undefined); done?.();
  };
}

function tcCapstoneModal(course, done) {
  const c = findRecord('courses', course.id), cap = c.aiContent?.capstone || {};
  const S = { t: 'obj', fields: { title: { t: 'line', max: 300 }, brief: { t: 'text', max: 3000 }, requirements: { t: 'list', of: { t: 'line', max: 300 }, max: 12 }, deliverables: { t: 'list', of: { t: 'line', max: 300 }, max: 10 }, milestones: { t: 'list', of: { t: 'obj', fields: { session: { t: 'int', min: 1, max: 48 }, task: { t: 'line', max: 300 } } }, max: 12 }, rubric: { t: 'list', of: { t: 'obj', fields: { criterion: { t: 'line', max: 300 }, marks: { t: 'int', min: 0, max: 100 } } }, max: 10 } } };
  const m = openModal({ title: 'Edit the capstone project', size: 'lg', body: `<form data-f class="form-grid">${tcNode('capstone', S, cap, '')}</form>`, footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-save>Save</button>` });
  m.querySelector('[data-save]').onclick = () => {
    const v = tcRead(m.querySelector('[data-node="obj"]'));
    v.milestones = (v.milestones || []).map(x => ({ session: Math.round(Number(x.session)) || 1, task: x.task })).filter(x => x.task);
    v.rubric = (v.rubric || []).map(x => ({ criterion: x.criterion, marks: Math.max(0, Math.round(Number(x.marks)) || 0) })).filter(x => x.criterion);
    if (!String(v.title || '').trim() || !String(v.brief || '').trim()) return toast('The capstone needs a title and a brief.', 'error');
    const ai = clone(c.aiContent || {});
    ai.capstone = { ...cap, ...v, maxMarks: v.rubric.reduce((n, x) => n + x.marks, 0), edited: { by: App.user.id, at: new Date().toISOString() } };
    updateRecord('courses', c.id, { aiContent: ai });
    m.close(); toast('Capstone saved.'); done?.();
  };
}
