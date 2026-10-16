/* SDC Learn — AI course generator (Release 1): brief → one AI request → editable outline → review →
   draft course with its sessions. Pure rules live in js/coursegen-logic.js (also used by the server).
   - The AI writes teaching content only. A person reviews and saves; the course is always a draft.
   - One generation id (genId) per draft: the server derives the record ids from it, so pressing
     save twice, retrying after a lost response or saving on this device then syncing never makes
     two courses.
   - Work in progress is kept in sessionStorage per user (survives a reload in the same tab). */
const CGL = CourseGenLogic;

/* The button and the page appear only when all four hold (Final Plan section 3). The switch must be
   explicitly ON, as it is on the server. */
function courseGenAllowed(user = App.user) {
  return !!user && can('courses', 'create', user) && can('ai', 'use', user) && settings().features.courseGen === true && Domain.aiEnabled();
}

const CGKEY = userId => `sdcCourseGen:${userId}`;
const cgNewId = () => (window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);
function cgRestore(user) {
  try {
    const v = JSON.parse(sessionStorage.getItem(CGKEY(user.id)) || 'null');
    return v && v.v === 1 && v.userId === user.id && CGL.validGenId(v.genId) && v.brief ? v : null;
  } catch (e) { return null; }
}
const cgPersist = S => { try { sessionStorage.setItem(CGKEY(S.userId), JSON.stringify(S)); } catch (e) {} };
const cgForget = userId => { try { sessionStorage.removeItem(CGKEY(userId)); } catch (e) {} };

function cgDefaultBrief() {
  return {
    topic: '', audience: '', level: pairs(lms().levels)[0]?.value || '', programType: pairs(lms().programTypes)[0]?.value || '',
    delivery: pairs(lms().deliveryModes).find(p => p.value === 'online')?.value || pairs(lms().deliveryModes)[0]?.value || 'online',
    programId: '', divisionId: '', weeks: 4, perWeek: 2, hours: 2, goals: '', tools: '', source: ''
  };
}

const cgSetPath = (obj, path, value) => {
  const keys = path.split('.'); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
};
const cgGetPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

App.route('/manage/courses/generate', { perm: 'courses', render(ctx) {
  const u = ctx.user;
  ctx.setCrumbs([{ label: scopeAll(u) ? t('courses') : `My ${t('courses')}`, href: '#/manage/courses' }, { label: 'Generate with SDC Learn AI' }]);
  if (!courseGenAllowed(u)) return deniedPage(ctx, `The AI course generator is not available for your account.`);

  const S = cgRestore(u) || { v: 1, userId: u.id, genId: cgNewId(), step: 'brief', brief: cgDefaultBrief(), outline: null, meta: null, confirmCount: false, takenSlugs: [], saving: false };
  const T = { busy: false, error: null, touched: {}, attempted: false, block: '', saveNote: '', gen: 0 };
  const scope = 'new:' + u.id; // the temporary provider choice for the course being drafted (js/ai-provider-ui.js)
  const rootEl = document.createElement('div');
  ctx.root.innerHTML = '';
  ctx.root.appendChild(rootEl);
  const alive = () => rootEl.isConnected;
  const save = () => cgPersist(S);
  const check = () => (S.outline ? CGL.check(S.outline, { expected: CGL.briefCheck(S.brief).sessions, takenSlugs: [...db().courses.map(c => c.slug), ...(S.takenSlugs || [])] }) : []);
  const blockers = marks => marks.filter(m => m.block);
  const sourceNote = () => S.meta?.mock ? `<div class="alert cg-demo" role="status"><b>Demo mode.</b> No AI provider is configured for course generation, so this outline is a built-in sample, <b>not written by AI</b>. Add a provider in Settings → Integrations to generate real outlines.</div>` : '';

  /* --------------------------------------------------------- frame */
  function frame(inner) {
    const steps = [['brief', '1. Brief'], ['outline', '2. Outline'], ['review', '3. Review and create']];
    const cur = steps.findIndex(([k]) => k === S.step);
    rootEl.innerHTML = `${pageHead('Generate with SDC Learn AI', `Describe the ${t('course', true)}; SDC Learn AI drafts the outline. You review and edit it, then save a <b>draft</b>. Nothing is published, and no fee, ${t('instructor', true)}, venue or Zoom link is set.`)}
      <ol class="cg-steps" aria-label="Steps">${steps.map(([k, l], i) => `<li class="${i === cur ? 'on' : i < cur ? 'done' : ''}" ${i === cur ? 'aria-current="step"' : ''}>${esc(l)}</li>`).join('')}</ol>${inner}`;
  }
  const draw = () => { if (!alive()) return; ({ brief: drawBrief, outline: drawOutline, review: drawReview })[S.step]?.(); };

  /* ------------------------------------------------------ step 1: brief */
  const saveMode = { mode: null, safe: null };
  async function preflight() {
    try {
      const cloud = window.SDCCloud;
      saveMode.mode = cloud?.mode ? await cloud.mode() : 'off';
      saveMode.safe = saveMode.mode === 'gateway' ? await cloud.safeWrite() : true;
    } catch (e) { saveMode.mode = 'offline'; }
    T.block = saveMode.mode === 'direct' ? 'Course generation needs the secure server connection (the shared-data gateway). Ask your administrator to switch it on.'
      : saveMode.mode === 'offline' ? 'The server could not be reached, so a generated course could not be saved right now. Check your connection and reload.'
      : saveMode.safe === false ? 'Course generation needs a database update. Please contact your administrator.' : '';
    if (alive() && S.step === 'brief' && !T.busy) { const n = rootEl.querySelector('[data-block]'); if (n) { n.hidden = !T.block; n.textContent = T.block; } syncBriefState(); }
  }
  function syncBriefState() {
    const chk = CGL.briefCheck(S.brief);
    const tot = rootEl.querySelector('[data-total]');
    if (tot) {
      tot.innerHTML = chk.sessions ? `<b>${chk.sessions}</b> ${t('sessions', true)} · <b>${chk.hours}</b> hours in total` + (chk.errors.weeks && chk.sessions > CGL.LIMITS.sessions ? ` <span class="text-danger">· over the limit of ${CGL.LIMITS.sessions}</span>` : '') : '<span class="muted">Enter the weeks, sessions per week and hours.</span>';
      tot.classList.toggle('over', chk.sessions > CGL.LIMITS.sessions);
    }
    rootEl.querySelectorAll('[data-err]').forEach(el => {
      const k = el.dataset.err, show = chk.errors[k] && (T.attempted || T.touched[k] || k === 'weeks' && chk.sessions > CGL.LIMITS.sessions || k === 'source');
      el.textContent = show ? chk.errors[k] : ''; el.hidden = !show;
    });
    const n = String(S.brief.source || '').length, cnt = rootEl.querySelector('[data-src-count]');
    if (cnt) { cnt.textContent = `${n.toLocaleString('en')} / ${CGL.LIMITS.source.toLocaleString('en')}`; cnt.classList.toggle('text-danger', n > CGL.LIMITS.source); }
    const btn = rootEl.querySelector('[data-generate]');
    if (btn) btn.disabled = T.busy || !chk.ok || !!T.block;
  }
  function drawBrief() {
    const b = S.brief, sel = (name, list, withNone) => `<select class="input" name="${name}" data-bf>${withNone ? '<option value="">—</option>' : ''}${list.map(o => `<option value="${esc(o.value)}" ${String(b[name]) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    const err = k => `<p class="help text-danger" data-err="${k}" hidden></p>`;
    const showProg = scopeAll(u);
    frame(`${S.outline ? `<div class="alert cg-note">You already have an outline for this draft. <button class="link-btn" data-to-outline>Back to the outline</button> (generating again replaces it).</div>` : ''}
      <div class="alert alert-danger" data-block ${T.block ? '' : 'hidden'} role="alert">${esc(T.block)}</div>
      ${T.error ? `<div class="alert alert-danger" role="alert"><b>Could not generate the outline.</b> ${esc(T.error.message)}</div><div data-recover></div>` : ''}
      <form class="card cg-brief" data-brief novalidate>
        <div class="form-grid">
          <div class="field full"><label class="label" for="cg-topic">Course topic or working title *</label><input class="input" id="cg-topic" name="topic" data-bf value="${esc(b.topic)}" maxlength="200" placeholder="For example: Power BI for finance teams" autofocus>${err('topic')}</div>
          <div class="field full"><label class="label" for="cg-aud">Target audience *</label><textarea class="input" id="cg-aud" name="audience" data-bf rows="2" placeholder="Who the learners are and what they already know">${esc(b.audience)}</textarea>${err('audience')}</div>
          <div class="field"><label class="label">Level *</label>${sel('level', opt.levels())}${err('level')}</div>
          <div class="field"><label class="label">Program type *</label>${sel('programType', opt.programTypes())}${err('programType')}</div>
          <div class="field"><label class="label">Delivery *</label>${sel('delivery', opt.delivery())}${err('delivery')}</div>
          ${showProg ? `<div class="field"><label class="label">${esc(t('program'))}</label>${sel('programId', opt.programs(), true)}</div><div class="field"><label class="label">${esc(t('division'))}</label>${sel('divisionId', opt.divisions(), true)}</div>` : ''}
          <div class="field"><label class="label" for="cg-weeks">Number of weeks *</label><input class="input" id="cg-weeks" type="number" name="weeks" data-bf min="1" max="${CGL.LIMITS.weeks}" step="1" value="${esc(b.weeks)}">${err('weeks')}</div>
          <div class="field"><label class="label" for="cg-pw">${esc(t('sessions'))} per week *</label><input class="input" id="cg-pw" type="number" name="perWeek" data-bf min="1" max="${CGL.LIMITS.perWeek}" step="1" value="${esc(b.perWeek)}">${err('perWeek')}</div>
          <div class="field"><label class="label" for="cg-h">Hours per ${esc(t('session', true))} *</label><input class="input" id="cg-h" type="number" name="hours" data-bf min="0.5" max="${CGL.LIMITS.maxHours}" step="0.5" value="${esc(b.hours)}">${err('hours')}</div>
          <div class="field cg-total-field"><span class="label">Total</span><div class="cg-total" data-total aria-live="polite"></div><p class="help">At most ${CGL.LIMITS.sessions} ${esc(t('sessions', true))} and ${CGL.LIMITS.modules} modules.</p></div>
          <div class="field full"><label class="label" for="cg-goals">What learners should be able to do at the end</label><textarea class="input" id="cg-goals" name="goals" data-bf rows="2">${esc(b.goals)}</textarea>${err('goals')}</div>
          <div class="field full"><label class="label" for="cg-tools">Tools or software used</label><input class="input" id="cg-tools" name="tools" data-bf value="${esc(b.tools)}" placeholder="For example: Power BI Desktop, Excel">${err('tools')}</div>
          <div class="field full"><div class="row-between"><label class="label" for="cg-src">Source material (optional)</label><span class="small muted" data-src-count></span></div>
            <textarea class="input" id="cg-src" name="source" data-bf rows="5" placeholder="Paste a syllabus or notes. Used as the main reference for the content.">${esc(b.source)}</textarea>
            <p class="help">Up to ${CGL.LIMITS.source.toLocaleString('en')} characters; longer text is refused, not cut. Do not paste personal data or material SDC has no right to use. Personal details such as emails and phone numbers are removed before the text is sent to the AI provider.</p>${err('source')}</div>
          <p class="help full">Start date, class days and times are worked out later (a following release); they are never sent to the AI.</p>
          <div class="field full"><div class="tc-routeline" data-route-line></div></div>
        </div>
        <div class="form-foot row gap-sm wrap"><a class="btn btn-ghost" href="#/manage/courses">Cancel</a>
          ${S.outline ? `<button type="button" class="btn btn-ghost" data-discard>Discard draft</button>` : ''}
          <button type="submit" class="btn btn-primary" data-generate ${T.busy ? 'disabled' : ''}>${icon('sparkles', 16)} ${S.outline ? 'Generate again' : 'Generate outline'}</button></div>
      </form>`);
    const form = rootEl.querySelector('[data-brief]');
    syncBriefState();
    form.addEventListener('input', e => {
      const f = e.target; if (!f.matches('[data-bf]')) return;
      S.brief[f.name] = f.type === 'number' ? (f.value === '' ? '' : Number(f.value)) : f.value;
      T.touched[f.name] = true;
      if (f.name === 'programId' && f.value) { const d = findRecord('programs', f.value)?.divisionId; if (d) { S.brief.divisionId = d; const dv = form.querySelector('[name=divisionId]'); if (dv) dv.value = d; } }
      save(); syncBriefState();
    });
    rootEl.querySelector('[data-to-outline]')?.addEventListener('click', () => { S.step = 'outline'; save(); draw(); });
    rootEl.querySelector('[data-discard]')?.addEventListener('click', discard);
    form.addEventListener('submit', e => { e.preventDefault(); generate(); });
    routeLine();
    if (T.error && AIProviderLogic.kindOf(T.error.code).pause) recover();
    if (S.step === 'brief' && saveMode.mode === null) preflight();
    else if (T.block) syncBriefState();
  }

  // The provider that will write the outline: Settings' choice, or the temporary one made here.
  const routeLine = () => AIRoute.fillLine(rootEl.querySelector('[data-route-line]'), scope, 'courseGenerate', { canChange: !T.busy, onChange: routeLine });
  // The provider stopped (quota, key, model, size, not set up): say so, and offer the providers that can take over.
  // Choosing one is the only thing that sends a request to it.
  async function recover() {
    const el = rootEl.querySelector('[data-recover]'); if (!el || !T.error) return;
    const e = AIProviderLogic.explain(T.error), st = await AIRoute.status(true);
    const stopped = T.error.provider ? { provider: T.error.provider, profileId: '', model: T.error.model || '' } : null;
    const opts = st ? AIProviderLogic.options(st, { stopped }) : [], pick = AIRoute.firstUsable(opts), who = AIProviderLogic.label(T.error.provider);
    if (!el.isConnected) return;
    el.innerHTML = `<div class="card tc-pause" role="alert"><h3>${icon('clock', 16)} ${esc(e.title)}</h3><p>${esc(e.detail)} Your brief is kept.</p>
      ${e.canSwap ? `<h4>Continue with another provider</h4>${opts.length ? AIRoute.listHTML(opts, 'ap-outline', pick) : '<p class="text-danger small">The AI settings could not be read just now. Reload to try again.</p>'}` : ''}
      <div class="row gap-sm wrap">${e.canSwap ? `<button type="button" class="btn btn-primary" data-switch-go ${pick ? '' : 'disabled'}>${icon('refresh', 15)} Switch Provider &amp; Try Again</button>` : ''}<button type="button" class="btn btn-secondary" data-retry-same ${e.canRetry ? '' : 'disabled'}>Retry ${esc(who)}</button></div>
      <p class="small muted">Nothing is sent to another provider unless you choose it. Settings → Integrations is not changed.</p></div>`;
    el.querySelector('[data-retry-same]')?.addEventListener('click', () => generate());
    el.querySelector('[data-switch-go]')?.addEventListener('click', async () => {
      const o = opts.find(x => x.id === el.querySelector('input[name="ap-outline"]:checked')?.value);
      if (!o) return toast('Choose a provider first.', 'warning');
      if (!(await confirmDialog(`Draft the outline with ${o.label}? This sends one request to ${o.label} and uses its tokens. Settings → Integrations stays as it is; the choice applies to this draft in this tab.`, { title: 'Switch provider', confirmText: `Use ${AIProviderLogic.label(o.provider)}` }))) return;
      AIRoute.set(scope, o); generate();
    });
  }
  /* ------------------------------------------------ the AI request */
  function aiContext() {
    const prog = findRecord('programs', S.brief.programId), div = findRecord('divisions', S.brief.divisionId);
    const ex = db().courses.find(c => c.status === 'published' && (c.outcomes || []).length && (!S.brief.programId || c.programId === S.brief.programId)) || db().courses.find(c => c.status === 'published' && (c.outcomes || []).length);
    return {
      programName: prog?.name || '', divisionName: div?.name || '', existingTitles: db().courses.map(c => c.title),
      example: ex ? { title: ex.title, outcomes: ex.outcomes, modules: (ex.modules || []).map(m => m.name) } : null
    };
  }
  async function generate() {
    if (T.busy) return;
    T.attempted = true;
    const chk = CGL.briefCheck(S.brief);
    if (!chk.ok || T.block) { syncBriefState(); rootEl.querySelector('[data-err]:not([hidden])')?.scrollIntoView({ block: 'center' }); return; }
    if (S.outline && !(await confirmDialog('Generating again replaces the outline you have, including your edits. Continue?', { title: 'Replace the outline', confirmText: 'Generate again', danger: true }))) return;
    T.busy = true; T.error = null; const run = ++T.gen;
    const via = AIRoute.named(AIRoute.resolve(scope, 'courseGenerate'), await AIRoute.status());
    const b = S.brief, labelled = { ...b, level: b.level, programType: pairLabel(lms().programTypes, b.programType), delivery: pairLabel(lms().deliveryModes, b.delivery) };
    frame(`<div class="card cg-wait" role="status" aria-live="polite"><span class="spinner"></span><div><b>Drafting your outline with ${esc(via.label)}…</b><p class="muted">${chk.sessions > 24 ? 'Large courses can take up to a minute. ' : 'This usually takes under half a minute. '}Please keep this page open.</p></div><button class="btn btn-ghost btn-sm" data-cancel>Cancel</button></div>`);
    rootEl.querySelector('[data-cancel]').onclick = () => { T.gen++; T.busy = false; draw(); };
    let r;
    try {
      r = await CGL.generate(o => AIRoute.call(scope, 'courseGenerate', { ...o, timeoutMs: 58000 }), labelled, aiContext(), { sleep: ms => new Promise(res => setTimeout(res, ms)) });
    } catch (e) { r = { ok: false, code: e.code || 'provider', message: e.message || 'Could not generate the outline. Try again.' }; }
    if (run !== T.gen) return; // cancelled, or a newer request
    T.busy = false;
    if (r.ok) {
      S.outline = { ...r.outline, slug: '' }; S.meta = r.meta; S.step = 'outline'; S.confirmCount = false; S.takenSlugs = [];
      save(); if (alive()) { draw(); window.scrollTo(0, 0); }
    } else { T.error = { code: r.code, message: r.message, provider: r.provider || via.provider, model: r.model || via.model }; if (alive()) draw(); }
  }

  /* ---------------------------------------------- step 2: the outline */
  const nameOf = (v, fallback) => (String(v || '').trim() ? esc(v) : `<span class="muted">${fallback}</span>`);
  function outlineHTML(o) {
    const sNo = (() => { let n = 0; return () => ++n; })();
    const mark = path => `<small class="cg-mark" data-mark="${path}" hidden></small>`;
    return `<section class="card cg-section"><h3>Course details</h3><div class="form-grid">
        <div class="field full"><label class="label" for="o-title">Title *</label><input class="input" id="o-title" data-bind="title" value="${esc(o.title)}">${mark('title')}</div>
        <div class="field full"><label class="label">Tagline</label><input class="input" data-bind="tagline" value="${esc(o.tagline)}">${mark('tagline')}</div>
        <div class="field full"><label class="label">Description</label><textarea class="input" rows="4" data-bind="description">${esc(o.description)}</textarea>${mark('description')}</div>
        <div class="field full"><label class="label">Prerequisites</label><input class="input" data-bind="prerequisites" value="${esc(o.prerequisites)}">${mark('prerequisites')}</div>
        <div class="field"><label class="label">Course code</label><input class="input" data-bind="code" value="${esc(o.code)}" maxlength="${CGL.LIMITS.code}"></div>
        <div class="field"><label class="label">Icon</label><select class="input" data-bind="icon">${CGL.ICONS.map(i => `<option ${o.icon === i ? 'selected' : ''}>${i}</option>`).join('')}</select></div>
        <div class="field full"><label class="label">Web address name</label><input class="input" data-bind="slug" value="${esc(o.slug)}" placeholder="${esc(CGL.slugify(o.title))}"><p class="help">Left empty, it is made from the title. A name already in use is reported; it is never changed for you.</p>${mark('slug')}</div>
      </div></section>
      <section class="card cg-section"><div class="row-between"><h3>Learning outcomes</h3><button class="btn btn-ghost btn-sm" data-act="addOutcome">${icon('plus', 14)} Add outcome</button></div>
        <ol class="cg-list">${o.outcomes.map((x, i) => `<li><div class="cg-row"><span class="s-num">${i + 1}</span><input class="input" data-bind="outcomes.${i}" value="${esc(x)}" aria-label="Outcome ${i + 1}">
          <span class="cg-btns"><button class="icon-btn icon-btn-sm" data-act="upOutcome" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move outcome up">${icon('arrowUp', 14)}</button><button class="icon-btn icon-btn-sm" data-act="downOutcome" data-i="${i}" ${i === o.outcomes.length - 1 ? 'disabled' : ''} aria-label="Move outcome down">${icon('arrowDown', 14)}</button><button class="icon-btn icon-btn-sm danger" data-act="rmOutcome" data-i="${i}" aria-label="Remove outcome">${icon('trash', 14)}</button></span></div>${mark(`outcomes.${i}`)}</li>`).join('') || '<li class="muted small">No outcomes yet.</li>'}</ol>${mark('outcomes')}</section>
      <section class="cg-section"><div class="row-between mb"><h3>Modules and ${esc(t('sessions', true))}</h3><button class="btn btn-ghost btn-sm" data-act="addModule">${icon('plus', 14)} Add module</button></div>
        ${mark('modules')}
        ${o.modules.map((m, mi) => `<div class="card cg-module"><div class="cg-row cg-mhead"><span class="pill">Module ${mi + 1}</span><input class="input" data-bind="modules.${mi}.name" value="${esc(m.name)}" aria-label="Module ${mi + 1} name" placeholder="Module name">
            <span class="cg-btns"><button class="icon-btn icon-btn-sm" data-act="upModule" data-m="${mi}" ${mi === 0 ? 'disabled' : ''} aria-label="Move module up">${icon('arrowUp', 14)}</button><button class="icon-btn icon-btn-sm" data-act="downModule" data-m="${mi}" ${mi === o.modules.length - 1 ? 'disabled' : ''} aria-label="Move module down">${icon('arrowDown', 14)}</button><button class="icon-btn icon-btn-sm danger" data-act="rmModule" data-m="${mi}" aria-label="Remove module">${icon('trash', 14)}</button></span></div>
          <input class="input input-sm cg-msum" data-bind="modules.${mi}.summary" value="${esc(m.summary)}" aria-label="Module ${mi + 1} summary" placeholder="One-line summary">${mark(`modules.${mi}`)}${mark(`modules.${mi}.summary`)}
          <ul class="cg-list">${m.sessions.map((s, si) => { const n = sNo(); return `<li><div class="cg-row"><span class="s-num">${n}</span>
              <div class="cg-sbody"><input class="input input-sm" data-bind="modules.${mi}.sessions.${si}.title" value="${esc(s.title)}" aria-label="${esc(t('session'))} ${n} title" placeholder="${esc(t('session'))} title">
              <input class="input input-sm" data-bind="modules.${mi}.sessions.${si}.summary" value="${esc(s.summary)}" aria-label="${esc(t('session'))} ${n} summary" placeholder="One-line summary"></div>
              <label class="cg-refs"><span class="sr-only">Outcomes supported</span><input class="input input-sm" data-refs="modules.${mi}.sessions.${si}.refs" value="${esc((s.refs || []).join(', '))}" placeholder="Outcomes" title="Outcome numbers this ${esc(t('session', true))} supports, e.g. 1, 3" aria-label="Outcomes supported by ${esc(t('session', true))} ${n}"></label>
              <span class="cg-btns"><button class="icon-btn icon-btn-sm" data-act="upSession" data-m="${mi}" data-s="${si}" aria-label="Move up">${icon('arrowUp', 14)}</button><button class="icon-btn icon-btn-sm" data-act="downSession" data-m="${mi}" data-s="${si}" aria-label="Move down">${icon('arrowDown', 14)}</button><button class="icon-btn icon-btn-sm danger" data-act="rmSession" data-m="${mi}" data-s="${si}" aria-label="Remove ${esc(t('session', true))}">${icon('trash', 14)}</button></span></div>${mark(`modules.${mi}.sessions.${si}`)}</li>`; }).join('') || `<li class="muted small">No ${esc(t('sessions', true))} in this module.</li>`}</ul>
          <button class="btn btn-ghost btn-sm" data-act="addSession" data-m="${mi}">${icon('plus', 14)} Add ${esc(t('session', true))}</button></div>`).join('')}
      </section>`;
  }
  function drawOutline() {
    const o = S.outline; if (!o) { S.step = 'brief'; return draw(); }
    frame(`${sourceNote()}<div class="cg-summary card" data-summary></div><div data-marks></div>
      <div data-outline>${outlineHTML(o)}</div>
      <div class="form-foot row gap-sm wrap"><button class="btn btn-ghost" data-act="toBrief">Back to the brief</button><button class="btn btn-ghost" data-discard>Discard draft</button><button class="btn btn-primary" data-act="toReview">Review ${icon('chevronRight', 15)}</button></div>`);
    refreshMarks();
    rootEl.querySelector('[data-discard]').onclick = discard;
  }
  // Warnings are recomputed from the outline on every edit, so a correction clears its mark at once.
  function refreshMarks() {
    const o = S.outline; if (!o || !alive()) return;
    const marks = check(), blocking = blockers(marks), chk = CGL.briefCheck(S.brief), n = CGL.countSessions(o);
    const hrs = Math.round(n * Number(S.brief.hours || 0) * 100) / 100;
    const sum = rootEl.querySelector('[data-summary]');
    if (sum) sum.innerHTML = `<div class="row wrap gap"><span><b>${o.modules.length}</b> modules</span><span><b>${n}</b> ${esc(t('sessions', true))}${n !== chk.sessions ? ` <span class="text-warning">(brief: ${chk.sessions})</span>` : ''}</span><span><b>${hrs}</b> hours</span>
      ${S.meta ? `<span class="muted small">${S.meta.mock ? 'Demo sample (not AI)' : `${icon('sparkles', 13)} ${esc(S.meta.provider || 'AI')}${S.meta.model ? ' · ' + esc(S.meta.model) : ''}`}</span>` : ''}</div>`;
    const mp = rootEl.querySelector('[data-marks]');
    if (mp) mp.innerHTML = marks.length ? `<div class="alert cg-warn" role="status"><b>${marks.length} thing${marks.length === 1 ? '' : 's'} to check</b>${blocking.length ? ` · ${blocking.length} must be fixed before saving` : ' · warnings do not block saving'}
      <ul>${marks.map(m => `<li class="${m.block ? 'block' : ''}">${esc(m.message)}</li>`).join('')}</ul></div>` : `<div class="alert cg-ok" role="status">${icon('check', 14)} No problems found.</div>`;
    const byPath = {};
    marks.forEach(m => { (byPath[m.path] ||= []).push(m.message); });
    rootEl.querySelectorAll('[data-mark]').forEach(el => {
      const msgs = byPath[el.dataset.mark] || [];
      el.hidden = !msgs.length; el.textContent = msgs.join(' ');
      el.closest('li, .field, .card')?.classList.toggle('has-mark', !!msgs.length);
    });
  }
  function onOutlineInput(e) {
    const f = e.target, o = S.outline;
    if (f.dataset.bind) { cgSetPath(o, f.dataset.bind, f.value); S.confirmCount = false; }
    else if (f.dataset.refs) { cgSetPath(o, f.dataset.refs, String(f.value).split(/[^0-9]+/).filter(Boolean).map(Number)); }
    else return;
    save(); refreshMarks();
  }
  function onAct(btn) {
    const o = S.outline, a = btn.dataset.act, i = Number(btn.dataset.i), m = Number(btn.dataset.m), s = Number(btn.dataset.s);
    const redraw = focusSel => { S.confirmCount = false; save(); const keep = window.scrollY; rootEl.querySelector('[data-outline]').innerHTML = outlineHTML(o); refreshMarks(); window.scrollTo(0, keep); if (focusSel) rootEl.querySelector(focusSel)?.focus(); };
    switch (a) {
      case 'toBrief': S.step = 'brief'; save(); return draw();
      case 'toReview': { const b = blockers(check()); if (b.length) { toast(b[0].message, 'error'); return; } S.step = 'review'; save(); draw(); window.scrollTo(0, 0); return; }
      case 'addOutcome': o.outcomes.push(''); return redraw(`[data-bind="outcomes.${o.outcomes.length - 1}"]`);
      case 'rmOutcome': CGL.removeOutcome(o, i); return redraw();
      case 'upOutcome': CGL.moveOutcome(o, i, -1); return redraw();
      case 'downOutcome': CGL.moveOutcome(o, i, 1); return redraw();
      case 'addModule': o.modules.push({ name: '', summary: '', sessions: [] }); return redraw(`[data-bind="modules.${o.modules.length - 1}.name"]`);
      case 'rmModule': {
        const n = o.modules[m].sessions.length;
        if (n && !window.confirm(`Remove this module and its ${n} ${t('sessions', true)}?`)) return;
        o.modules.splice(m, 1); return redraw();
      }
      case 'upModule': CGL.moveModule(o, m, -1); return redraw();
      case 'downModule': CGL.moveModule(o, m, 1); return redraw();
      case 'addSession': o.modules[m].sessions.push({ title: '', summary: '', refs: [] }); return redraw(`[data-bind="modules.${m}.sessions.${o.modules[m].sessions.length - 1}.title"]`);
      case 'rmSession': o.modules[m].sessions.splice(s, 1); return redraw();
      case 'upSession': CGL.moveSession(o, m, s, -1); return redraw();
      case 'downSession': CGL.moveSession(o, m, s, 1); return redraw();
    }
  }

  /* ---------------------------------------------- step 3: review & save */
  function drawReview() {
    const o = S.outline; if (!o) { S.step = 'brief'; return draw(); }
    const marks = check(), blocking = blockers(marks), b = S.brief, n = CGL.countSessions(o), want = CGL.briefCheck(b).sessions, hrs = Math.round(n * Number(b.hours || 0) * 100) / 100;
    const countOff = n !== want, prog = findRecord('programs', b.programId), div = findRecord('divisions', b.divisionId);
    const slug = CGL.slugify(o.slug || o.title);
    let k = 0;
    frame(`${sourceNote()}
      <div class="alert cg-note">${S.meta?.mock ? '<b>Demo sample, not written by AI. Replace the content before publishing.</b>' : '<b>Drafted with SDC Learn AI. Review the content before publishing.</b>'} The course is saved as a <b>draft</b>: ${esc(t('learners', true))} see nothing until a person publishes it. Fee, ${esc(t('instructor', true))}, venue, Zoom details and dates are left empty for you; no one is enrolled.</div>
      ${T.saveNote ? `<div class="alert ${T.saveNote.startsWith('!') ? 'alert-danger' : 'cg-note'}" role="alert">${esc(T.saveNote.replace(/^!/, ''))}</div>` : ''}
      <div class="card cg-review">
        <div class="row-between wrap gap-sm"><div><span class="eyebrow">${esc(o.code || t('course'))} · Draft</span><h2>${esc(o.title)}</h2><p class="muted">${esc(o.tagline)}</p></div><span class="ai-badge">${icon('sparkles', 12)} ${S.meta?.mock ? 'Demo sample (not AI)' : 'Drafted with SDC Learn AI'}</span></div>
        <dl class="facts cols-2">
          <div><dt>Program type</dt><dd>${esc(pairLabel(lms().programTypes, b.programType))}</dd></div><div><dt>Level</dt><dd>${esc(b.level || '—')}</dd></div>
          <div><dt>Delivery</dt><dd>${esc(pairLabel(lms().deliveryModes, b.delivery))}</dd></div><div><dt>${esc(t('program'))} / ${esc(t('division'))}</dt><dd>${esc(prog?.name || '—')} / ${esc(div?.name || '—')}</dd></div>
          <div><dt>Modules</dt><dd>${o.modules.length}</dd></div><div><dt>${esc(t('sessions'))}</dt><dd>${n} · ${hrs} hours</dd></div>
          <div><dt>Web address</dt><dd class="truncate">/${esc(slug)}</dd></div><div><dt>Made by</dt><dd>${S.meta ? esc(S.meta.mock ? 'Demo mode (no AI)' : `${S.meta.provider}${S.meta.model ? ' · ' + S.meta.model : ''}`) : '—'}</dd></div>
        </dl>
        ${o.description ? `<h3>Description</h3><p>${esc(o.description)}</p>` : ''}
        ${o.prerequisites ? `<h3>Prerequisites</h3><p>${esc(o.prerequisites)}</p>` : ''}
        <h3>Learning outcomes</h3><ol class="cg-ro">${o.outcomes.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
        <h3>Modules and ${esc(t('sessions', true))}</h3>
        ${o.modules.map((m, mi) => `<div class="cg-rmod"><b>Module ${mi + 1}: ${esc(m.name)}</b>${m.summary ? `<small class="muted block">${esc(m.summary)}</small>` : ''}<ul class="plain">${m.sessions.map(s => { k++; return `<li><span class="s-num">${k}</span><span><b>${esc(s.title)}</b>${s.summary ? ` <span class="muted small">— ${esc(s.summary)}</span>` : ''}</span></li>`; }).join('') || '<li class="muted small">No sessions</li>'}</ul></div>`).join('')}
      </div>
      ${marks.length ? `<div class="alert cg-warn" role="status"><b>${marks.length} thing${marks.length === 1 ? '' : 's'} to check</b><ul>${marks.map(m => `<li class="${m.block ? 'block' : ''}">${esc(m.message)}</li>`).join('')}</ul></div>` : ''}
      ${countOff ? `<label class="check cg-confirm"><input type="checkbox" data-confirm-count ${S.confirmCount ? 'checked' : ''}><span>I confirm saving <b>${n}</b> ${esc(t('sessions', true))} instead of the <b>${want}</b> in the brief.</span></label>` : ''}
      <div class="form-foot row gap-sm wrap"><button class="btn btn-ghost" data-act="toOutline">${icon('chevronLeft', 15)} Back to the outline</button><button class="btn btn-ghost" data-discard>Discard draft</button>
        <button class="btn btn-primary" data-create ${blocking.length || (countOff && !S.confirmCount) || S.saving ? 'disabled' : ''}>${S.saving ? '<span class="spinner"></span> Saving…' : `${icon('check', 16)} Create draft course`}</button></div>
      ${blocking.length ? `<p class="help text-danger">Fix the marked problems on the outline before saving.</p>` : ''}`);
    rootEl.querySelector('[data-confirm-count]')?.addEventListener('change', e => { S.confirmCount = e.target.checked; save(); rootEl.querySelector('[data-create]').disabled = !S.confirmCount || !!blocking.length || S.saving; });
    rootEl.querySelector('[data-create]').onclick = createDraft;
    rootEl.querySelector('[data-discard]').onclick = discard;
    rootEl.querySelector('[data-act="toOutline"]').onclick = () => { S.step = 'outline'; save(); draw(); };
  }

  async function discard() {
    if (!(await confirmDialog('Throw this draft away? The brief and the outline are removed from this browser. Nothing has been saved to the platform.', { title: 'Discard draft', confirmText: 'Discard', danger: true }))) return;
    cgForget(u.id); AIRoute.clear(scope); T.gen++;
    location.hash = '#/manage/courses';
  }

  // Same shape the server reads: brief-derived fields ride on the outline; the AI mark rides in `meta`.
  function payload() {
    const b = S.brief, o = S.outline;
    return {
      outline: {
        title: o.title, tagline: o.tagline, description: o.description, prerequisites: o.prerequisites, code: o.code, icon: o.icon, slug: o.slug || '',
        outcomes: o.outcomes.filter(x => String(x).trim()),
        modules: o.modules.map(m => ({ name: m.name, summary: m.summary, sessions: m.sessions.map(s => ({ title: s.title, summary: s.summary, refs: s.refs || [] })) })),
        level: b.level, programType: b.programType, delivery: b.delivery, programId: scopeAll(u) ? b.programId : '', divisionId: scopeAll(u) ? b.divisionId : '', hoursPerSession: Number(b.hours) || 0
      },
      meta: { provider: S.meta?.provider || '', model: S.meta?.model || '', mock: S.meta?.mock === true }
    };
  }

  // The returned records are put into this tab's state in one synchronous step, so a background
  // sync can never apply an older copy in between.
  function applyCommitted(resp) {
    const d = db(), put = (key, rec) => { const i = d[key].findIndex(x => x.id === rec.id); if (i >= 0) d[key][i] = rec; else d[key].push(rec); };
    const added = [];
    [['courses', resp.course], ...resp.sessions.map(s => ['sessions', s]), ['batches', resp.batch]].forEach(([k, r]) => { if (r) { if (!d[k].some(x => x.id === r.id)) added.push([k, r.id]); put(k, r); } });
    try { saveDB(d); }
    catch (e) { added.forEach(([k, id]) => { d[k] = d[k].filter(x => x.id !== id); }); throw e; }
  }
  function saveLocal(p) {
    const d = db(), now = new Date().toISOString(), id = CGL.ids(S.genId);
    if (d.courses.some(c => c.aiMeta?.genId === S.genId)) return d.courses.find(c => c.aiMeta?.genId === S.genId).id; // already saved: never a second course
    const recs = CGL.build({ genId: S.genId, outline: p.outline, userId: u.id, ownBatch: !scopeAll(u), now, meta: p.meta });
    if (d.courses.some(c => c.slug === recs.course.slug)) { const e = new Error('Another course already uses this web address.'); e.code = 'slug_in_use'; e.slug = recs.course.slug; throw e; }
    if (!scopeAll(u) || !d.programs.some(x => x.id === recs.course.programId)) { recs.course.programId = ''; recs.course.divisionId = ''; }
    if (recs.batch) { const taken = new Set(d.batches.map(x => x.name)); let nm = [String(recs.course.slug.split('-')[0] || 'Course').replace(/^./, c => c.toUpperCase()), pairLabel(lms().deliveryModes, recs.course.delivery), now.slice(0, 4)].join('-'), n = 2; const base = nm; while (taken.has(nm)) nm = `${base}-${n++}`; recs.batch.name = nm; }
    const added = [];
    d.courses.push(recs.course); added.push(['courses', recs.course.id]);
    recs.sessions.forEach(s => { d.sessions.push(s); added.push(['sessions', s.id]); });
    if (recs.batch) { d.batches.push(recs.batch); added.push(['batches', recs.batch.id]); }
    try { saveDB(d); }
    catch (e) { added.forEach(([k, i]) => { d[k] = d[k].filter(x => x.id !== i); }); throw e; } // remove our own half-written records
    return id.course;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // Ambiguous failures (no answer, timeout, 5xx): the same genId is sent again. The server returns
  // the course if it was already saved, and saves it once otherwise.
  async function commitWithRecovery(p) {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const resp = await SDCCloud.aiDraft({ genId: S.genId, ...p });
        return resp;
      } catch (e) {
        last = e;
        if (e.status && e.status < 500 && e.status !== 408) throw e; // the server answered: a definitive no
        if (e.code === 'busy' || e.code === 'safe_save_unavailable') throw e;
        await wait(600 * (i + 1));
      }
    }
    throw Object.assign(last || new Error('No answer'), { unconfirmed: true });
  }
  async function createDraft() {
    if (S.saving) return;
    const marks = check(), blocking = blockers(marks), n = CGL.countSessions(S.outline), want = CGL.briefCheck(S.brief).sessions;
    if (blocking.length) { toast(blocking[0].message, 'error'); return; }
    if (n !== want && !S.confirmCount) { toast('Confirm the number of sessions first.', 'error'); return; }
    const p = payload(), problem = CGL.validate(p.outline);
    if (problem) { toast(problem, 'error'); return; }
    S.saving = true; T.saveNote = ''; save(); drawReview();
    try {
      let courseId;
      const mode = window.SDCCloud?.mode ? await SDCCloud.mode() : 'off';
      if (mode === 'off') courseId = saveLocal(p);
      else if (mode !== 'gateway') throw Object.assign(new Error(mode === 'direct' ? 'Course generation needs the secure server connection. Your draft is kept on this device.' : 'The server could not be reached. Your draft is kept on this device; try again in a moment.'), { definitive: true });
      else {
        if (!(await SDCCloud.safeWrite())) throw Object.assign(new Error('Course generation needs a database update. Please contact your administrator. Your draft is kept on this device.'), { definitive: true });
        try { await SDCCloud.flushNow(); } catch (e) {}
        const resp = await commitWithRecovery(p);
        applyCommitted(resp); courseId = resp.courseId;
      }
      cgForget(u.id); AIRoute.clear(scope); S.saving = false;
      toast('Draft course created. Review it, then publish when ready.');
      location.hash = `#/manage/course/${courseId}`;
    } catch (e) {
      S.saving = false;
      if (e.code === 'slug_in_use') {
        S.takenSlugs = [...new Set([...(S.takenSlugs || []), e.slug || CGL.slugify(S.outline.slug || S.outline.title)])];
        S.step = 'outline'; save(); T.saveNote = ''; if (alive()) { draw(); toast('Another course already uses this web address. Change the title or the web address name.', 'error'); }
        return;
      }
      if (e.unconfirmed) T.saveNote = '!We could not confirm whether the course was saved. Your draft is kept on this device. Press “Create draft course” again to check: it saves once, never twice.';
      else if (e.status === 403) T.saveNote = `!${e.message || 'Your role cannot create courses.'}`;
      else if (e.status === 401) T.saveNote = '!Your session ended. Sign in again; your draft is kept in this tab.';
      else T.saveNote = `!${e.message || 'The course could not be saved.'} Your draft is kept.`;
      save(); if (alive()) drawReview();
    }
  }

  /* ------------------------------------------------------- wiring */
  rootEl.addEventListener('input', e => { if (S.step === 'outline') onOutlineInput(e); });
  rootEl.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && rootEl.contains(b) && S.step === 'outline') onAct(b); });
  if (S.saving) { // reloaded while saving: finish (idempotent) instead of leaving the draft in limbo
    S.saving = false; S.step = 'review'; T.saveNote = 'Checking whether your course was saved…'; drawReview(); createDraft();
  } else draw();
} });
