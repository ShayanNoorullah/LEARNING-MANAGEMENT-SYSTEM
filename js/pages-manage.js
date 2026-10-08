/* SDC Learn — catalogue & people management: generic CRUD engine, course builder
   (sessions, resources, assignments, learners), enrollments, programs, divisions, batches and users. */

/* --------------------------------------------------------- CRUD engine */
function crudPage(ctx, s) {
  const allow = a => !s.perm || can(s.perm, a);
  const canCreate = s.canCreate !== false && allow('create');
  if (!allow('edit')) s.canEdit = false;
  if (!allow('delete')) s.canDelete = false;
  ctx.root.innerHTML = `${pageHead(s.title, s.subtitle || '', `${s.headerActions || ''}${s.export !== false ? `<button class="btn btn-ghost btn-sm" data-export>${icon('download', 15)} Export</button>` : ''}${canCreate ? `<button class="btn btn-primary" data-add>${icon('plus', 16)} Add ${esc(s.singular)}</button>` : ''}`)}${s.top || ''}<div class="card" data-table></div>`;
  const rows = () => (s.rows ? s.rows() : db()[s.collection]);
  const table = dataTable(ctx.root.querySelector('[data-table]'), {
    rows, columns: s.columns, filters: s.filters, searchText: s.searchText, defaultSort: s.defaultSort, defaultDir: s.defaultDir,
    searchPlaceholder: `Search ${s.title.toLowerCase()}…`, emptyTitle: `No ${s.title.toLowerCase()} yet`, emptyIcon: s.icon,
    actions: r => `${s.rowActions ? s.rowActions(r) : ''}${s.canEdit === false || (s.canEditRow && !s.canEditRow(r)) ? '' : `<button class="icon-btn icon-btn-sm" data-edit="${esc(r.id)}" aria-label="Edit">${icon('edit', 15)}</button>`}${s.canDelete === false || (s.canDeleteRow && !s.canDeleteRow(r)) ? '' : `<button class="icon-btn icon-btn-sm danger" data-del="${esc(r.id)}" aria-label="Delete">${icon('trash', 15)}</button>`}`,
    onDraw: body => {
      body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(findRecord(s.collection, b.dataset.edit)));
      body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(findRecord(s.collection, b.dataset.del)));
      s.bindRow?.(body, table);
    }
  });
  function edit(rec) {
    const isNew = !rec, values = rec ? { ...rec, ...(s.toForm ? s.toForm(rec) : {}) } : (s.defaults ? s.defaults() : {});
    const fields = s.fields(rec);
    const m = openModal({ title: `${isNew ? 'Add' : 'Edit'} ${s.singular}`, size: s.modalSize || 'lg', body: `<form data-crud novalidate>${formHTML(fields, values)}</form>`, footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-save>${isNew ? 'Create' : 'Save changes'}</button>` });
    const form = m.querySelector('form');
    bindColorFields(m);
    s.bindForm?.(form, rec);
    const save = () => {
      const missing = fields.filter(f => f.required && !f.hidden).find(f => { const v = readForm(form, [f])[f.name]; return v === '' || v === undefined || (Array.isArray(v) && !v.length); });
      if (missing) { toast(`${missing.label} is required.`, 'error'); form.querySelector(`[data-field="${missing.name}"] .input`)?.focus(); return; }
      const invalid = [...form.querySelectorAll('input[type=email],input[type=url]')].find(i => i.value && !i.checkValidity());
      if (invalid) { toast('Please enter a valid ' + (invalid.type === 'email' ? 'email address.' : 'URL (including https://).'), 'error'); invalid.focus(); return; }
      try {
        let data = readForm(form, fields);
        if (s.transform) data = s.transform(data, rec);
        s.validate?.(data, rec);
        const saved = isNew ? addRecord(s.collection, data) : updateRecord(s.collection, rec.id, data);
        s.afterSave?.(saved, isNew, data);
        m.close(); toast(`${s.singular} ${isNew ? 'created' : 'updated'}.`); table.redraw(); App.syncBadges();
      } catch (err) { toast(err.message, 'error'); }
    };
    m.querySelector('[data-save]').onclick = save;
    form.onsubmit = e => { e.preventDefault(); save(); };
  }
  async function remove(rec) {
    try { s.beforeDelete?.(rec); } catch (err) { toast(err.message, 'error'); return; }
    if (!(await confirmDialog(s.deleteMessage ? s.deleteMessage(rec) : `Delete this ${s.singular.toLowerCase()}? This cannot be undone.`, { title: `Delete ${s.singular.toLowerCase()}`, confirmText: 'Delete', danger: true }))) return;
    deleteRecord(s.collection, rec.id); s.afterDelete?.(rec); toast(`${s.singular} deleted.`); table.redraw();
  }
  ctx.root.querySelector('[data-add]')?.addEventListener('click', () => edit(null));
  ctx.root.querySelector('[data-export]')?.addEventListener('click', () => {
    const cols = s.exportColumns || s.columns.map(c => ({ label: c.label, value: r => c.sortValue ? c.sortValue(r) : r[c.key] }));
    csvDownload(`${slugify(s.title)}.csv`, [cols.map(c => c.label), ...table.rows().map(r => cols.map(c => c.value(r)))]);
  });
  if (ctx.query.new && canCreate) edit(null);
  return { table, edit };
}

const opt = {
  courses: () => db().courses.map(c => ({ value: c.id, label: c.title })),
  learners: () => db().users.filter(u => kind(u) === 'student').map(u => ({ value: u.id, label: `${u.name} · ${u.email}` })),
  instructors: () => db().users.filter(u => kind(u) === 'teacher' && u.status === 'Active').map(u => ({ value: u.id, label: u.name })),
  programs: () => db().programs.map(p => ({ value: p.id, label: p.name })),
  divisions: () => db().divisions.map(d => ({ value: d.id, label: d.name })),
  programTypes: () => pairs(lms().programTypes),
  delivery: () => pairs(lms().deliveryModes),
  levels: () => pairs(lms().levels)
};
const COURSE_ICONS = ['book', 'grid', 'chart', 'pie', 'database', 'truck', 'shield', 'globe', 'cap', 'layers', 'target', 'sparkles', 'building', 'wallet'];

/* ---------------------------------------------------------- Courses list */
App.route('/manage/courses', { perm: 'courses', render(ctx) {
  const u = ctx.user, isAdmin = scopeAll(u);
  ctx.setCrumbs([{ label: isAdmin ? t('courses') : `My ${t('courses')}` }]);
  const list = () => Domain.visibleCourses(u);
  ctx.root.innerHTML = `${pageHead(isAdmin ? t('courses') : `My ${t('courses')}`, isAdmin ? `Create ${t('courses', true)}, schedule ${t('sessions', true)} and publish them to ${t('learners', true)}.` : `${t('courses')} you teach. Publish ${t('sessions', true)}, resources and ${t('assignments', true)}.`, can('courses', 'create') ? `<button class="btn btn-primary" data-add>${icon('plus', 16)} New ${t('course', true)}</button>` : '')}
    <div class="toolbar"><label class="search-box grow">${icon('search', 16)}<input type="search" data-q placeholder="Search ${t('courses', true)}…" aria-label="Search"></label>
    <div class="chips">${['All', 'published', 'draft', 'archived'].map((f, i) => `<button class="chip ${i ? '' : 'active'}" data-f="${f}">${f === 'All' ? 'All' : f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div></div>
    <div class="course-grid" data-grid></div>`;
  let q = '', f = 'All';
  const draw = () => {
    const rows = list().filter(c => (f === 'All' || c.status === f) && (!q || `${c.title} ${c.code} ${c.tagline}`.toLowerCase().includes(q)));
    ctx.root.querySelector('[data-grid]').innerHTML = rows.length ? rows.map(c => {
      const ss = Domain.courseSessions(c.id, true), learners = Domain.courseLearners(c.id).length, pend = db().submissions.filter(s => s.courseId === c.id && ['Submitted', 'Late'].includes(s.status)).length;
      return `<article class="course-card manage" style="--c:${esc(c.accent || 'var(--brand)')}">
        <div class="cc-top"><span class="cc-icon">${icon(c.icon || 'book', 20)}</span><span class="cc-tags">${badge(c.status === 'published' ? 'Published' : c.status === 'archived' ? 'Archived' : 'Draft')}</span></div>
        <h3><a href="#/manage/course/${c.id}">${esc(c.title)}</a></h3>
        <p class="cc-tagline">${esc(c.tagline || '')}</p>
        <div class="cc-meta"><span>${icon('layers', 14)} ${ss.length} ${t('sessions', true)}</span><span>${icon('users', 14)} ${learners} ${t('learners', true)}</span>${pend ? `<span class="text-warning">${icon('clipboard', 14)} ${pend} to grade</span>` : ''}</div>
        <div class="cc-foot small muted">${icon('user', 14)} ${esc((c.instructorIds || []).map(userName).join(', ') || 'No instructor')} · ${fmtDateShort(c.startDate)} – ${fmtDateShort(c.endDate)}</div>
        <div class="cc-actions">${Domain.canManageCourse(u, c) ? `<a class="btn btn-primary btn-sm" href="#/manage/course/${c.id}">${icon('settings', 15)} Manage</a>` : ''}<a class="btn btn-ghost btn-sm" href="#/course/${c.id}">${icon('eye', 15)} Preview</a>${can('courses', 'delete') ? `<button class="icon-btn icon-btn-sm danger" data-del="${c.id}" aria-label="Delete course">${icon('trash', 15)}</button>` : ''}</div>
      </article>`;
    }).join('') : `<div class="span-all">${emptyState(`No ${t('courses', true)} found`, isAdmin ? `Create your first ${t('course', true)} to get started.` : `You haven't been assigned any ${t('courses', true)} yet.`, 'book')}</div>`;
    ctx.root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => deleteCourse(b.dataset.del, draw));
  };
  ctx.root.querySelector('[data-q]').oninput = e => { q = e.target.value.toLowerCase(); draw(); };
  ctx.root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { f = b.dataset.f; ctx.root.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  ctx.root.querySelector('[data-add]')?.addEventListener('click', () => courseModal(null, c => { location.hash = `#/manage/course/${c.id}`; }));
  draw();
  if (ctx.query.new && can('courses', 'create')) courseModal(null, c => { location.hash = `#/manage/course/${c.id}`; });
} });

async function deleteCourse(id, done) {
  const c = findRecord('courses', id), n = Domain.courseLearners(id).length;
  if (!(await confirmDialog(`Delete "${c.title}"? This also removes its ${t('sessions', true)}, ${t('assignments', true)}, submissions, attendance and ${n} enrollment${n === 1 ? '' : 's'}.`, { title: `Delete ${t('course', true)}`, confirmText: 'Delete', danger: true }))) return;
  const d = db();
  ['sessions', 'assignments', 'submissions', 'attendance', 'enrollments', 'progress', 'results', 'batches', 'feedback'].forEach(k => { d[k] = d[k].filter(x => x.courseId !== id); });
  d.courses = d.courses.filter(x => x.id !== id);
  saveDB(d); toast(`${t('course')} deleted.`); done?.();
}

function courseFields(isAdmin) {
  return [
    { name: 'title', label: 'Title', required: true, full: true },
    { name: 'tagline', label: 'Tagline', full: true, placeholder: 'One line that sells the course' },
    { name: 'code', label: 'Course code', placeholder: 'e.g. DA-101' },
    { name: 'slug', label: 'URL slug', help: 'Auto-generated from the title if blank.' },
    { name: 'programId', label: t('program'), type: 'select', options: opt.programs, hidden: !isAdmin },
    { name: 'divisionId', label: t('division'), type: 'select', options: opt.divisions, hidden: !isAdmin },
    { name: 'programType', label: 'Program type', type: 'select', options: opt.programTypes, required: true, placeholderOption: false },
    { name: 'level', label: 'Level', type: 'select', options: opt.levels },
    { name: 'delivery', label: 'Delivery', type: 'select', options: opt.delivery, required: true, placeholderOption: false },
    { name: 'status', label: 'Status', type: 'select', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }], placeholderOption: false, hidden: !can('courses', 'publish') },
    { name: 'instructorIds', label: t('instructors'), type: 'multiselect', options: opt.instructors, hidden: !isAdmin },
    { name: 'startDate', label: 'Start date', type: 'date' },
    { name: 'endDate', label: 'End date', type: 'date', help: 'Filled from the start date and the program duration; you can still change it.' },
    { name: 'schedule', label: 'Schedule', placeholder: 'e.g. Mondays 7–9 PM (PKT)' },
    { name: 'venue', label: 'Venue', placeholder: 'Zoom / SDC Karachi Lab' },
    { name: 'fee', label: `Course ${t('fee', true)} (${lms().currency})`, type: 'number', min: 0, hidden: !isAdmin },
    { name: 'accent', label: 'Accent colour', type: 'color' },
    { name: 'icon', label: 'Icon', type: 'select', options: COURSE_ICONS, placeholderOption: false },
    { name: 'description', label: 'Description', type: 'textarea', rows: 4 },
    { name: 'outcomes', label: 'Learning outcomes', type: 'textarea', rows: 4, help: 'One outcome per line.' },
    { name: 'modules', label: 'Modules', type: 'textarea', rows: 4, help: 'One per line as "Module name | short summary". Sessions are grouped by module name.' },
    { name: 'prerequisites', label: 'Prerequisites', type: 'textarea', rows: 2 },
    { name: 'helpUrl', label: 'Help / support form URL', type: 'url', full: true, placeholder: 'https://forms.gle/…', help: 'Leave blank to use the platform default from Settings.' },
    { name: 'zoomRegisterUrl', label: 'Zoom register / join URL', type: 'url', full: true, placeholder: 'https://zoom.us/meeting/register/…' },
    { name: 'zoomMeetingId', label: 'Zoom meeting ID' },
    { name: 'zoomPassword', label: 'Zoom passcode' }
  ];
}
function courseModal(rec, onSaved) {
  const isAdmin = scopeAll(App.user), fields = courseFields(isAdmin);
  const values = rec ? { ...rec, outcomes: (rec.outcomes || []).join('\n'), modules: (rec.modules || []).map(m => m.summary ? `${m.name} | ${m.summary}` : m.name).join('\n'), zoomRegisterUrl: rec.zoom?.registerUrl, zoomMeetingId: rec.zoom?.meetingId, zoomPassword: rec.zoom?.password }
    : { programType: pairs(lms().programTypes)[0]?.value, delivery: 'online', status: 'draft', accent: settings().theme.accent, icon: 'book', level: pairs(lms().levels)[0]?.value };
  const m = openModal({ title: rec ? `Edit ${t('course', true)}` : `New ${t('course', true)}`, size: 'lg', body: `<form novalidate>${formHTML(fields, values)}</form>`, footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-save>${rec ? 'Save changes' : 'Create ' + t('course', true)}</button>` });
  bindColorFields(m);
  // 4/5. Picking a program fills its division; the end date follows the start date + program duration.
  const f = m.querySelector('form'), prog = () => findRecord('programs', f.programId?.value);
  const fillEnd = () => { const end = endDateFor(f.startDate.value, prog()?.duration); if (end) f.endDate.value = end; };
  f.programId?.addEventListener('change', () => { if (prog()?.divisionId && f.divisionId) f.divisionId.value = prog().divisionId; fillEnd(); });
  f.startDate.addEventListener('change', fillEnd);
  m.querySelector('[data-save]').onclick = () => {
    const form = m.querySelector('form'), r = readForm(form, fields);
    if (!r.title) return toast('Title is required.', 'error');
    if (r.startDate && r.endDate && r.endDate < r.startDate) return toast('End date must be after the start date.', 'error');
    const bad = [...form.querySelectorAll('input[type=url]')].find(i => i.value && !i.checkValidity());
    if (bad) { bad.focus(); return toast('Please enter a valid URL including https://', 'error'); }
    const slug = slugify(r.slug || r.title);
    if (db().courses.some(c => c.slug === slug && c.id !== rec?.id)) return toast('Another course already uses this slug.', 'error');
    const data = {
      ...r, slug, fee: Number(r.fee) || 0,
      outcomes: String(r.outcomes || '').split('\n').map(x => x.trim()).filter(Boolean),
      modules: String(r.modules || '').split('\n').map(x => x.trim()).filter(Boolean).map(line => { const [name, ...rest] = line.split('|'); return { name: name.trim(), summary: rest.join('|').trim() }; }),
      zoom: { registerUrl: r.zoomRegisterUrl, meetingId: r.zoomMeetingId, password: r.zoomPassword }
    };
    ['zoomRegisterUrl', 'zoomMeetingId', 'zoomPassword'].forEach(k => delete data[k]);
    if (!isAdmin) ['programId', 'divisionId', 'instructorIds', 'fee'].forEach(k => delete data[k]);
    if (!can('courses', 'publish')) delete data.status;
    if (!rec && !can('courses', 'publish')) data.status = 'draft';
    if (!rec && !isAdmin) data.instructorIds = [App.user.id];
    const saved = rec ? updateRecord('courses', rec.id, data) : addRecord('courses', { ...data, id: uid('C') });
    m.close(); toast(rec ? `${t('course')} updated.` : `${t('course')} created.`); onSaved?.(saved);
  };
}

/* -------------------------------------------------------- Course builder */
App.route('/manage/course/:id', { perm: 'courses', render(ctx) {
  const u = ctx.user, course = findRecord('courses', ctx.params.id);
  if (!course || !Domain.canManageCourse(u, course)) return deniedPage(ctx, `You can't manage this ${t('course', true)}.`);
  const tab = ctx.query.tab || 'overview';
  ctx.setCrumbs([{ label: scopeAll(u) ? t('courses') : `My ${t('courses')}`, href: '#/manage/courses' }, { label: course.title }]);
  const tabs = [['overview', 'Overview', 'layout'], ['sessions', t('sessions'), 'layers'], ['assignments', t('assignments'), 'clipboard'], ...(feature('quizzes') ? [['quizzes', t('quizzes'), 'clipboard']] : []), ['learners', t('learners'), 'users']];
  ctx.root.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">${esc(course.code || t('course'))} · ${badge(course.status === 'published' ? 'Published' : course.status === 'archived' ? 'Archived' : 'Draft')}</span><h1>${esc(course.title)}</h1><p>${esc(course.tagline || '')}</p></div>
      <div class="page-actions"><a class="btn btn-ghost btn-sm" href="#/course/${course.id}">${icon('eye', 15)} Preview as ${t('learner', true)}</a><button class="btn btn-secondary btn-sm" data-edit-course>${icon('edit', 15)} Edit details</button>${can('courses', 'publish') ? `<button class="btn btn-primary btn-sm" data-toggle-pub>${course.status === 'published' ? 'Unpublish' : 'Publish'}</button>` : ''}</div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l, i]) => `<a role="tab" href="#/manage/course/${course.id}?tab=${k}" class="tab ${tab === k ? 'active' : ''}" aria-selected="${tab === k}">${icon(i, 16)} ${esc(l)}</a>`).join('')}</div>
    <div data-tab></div>`;
  ctx.root.querySelector('[data-edit-course]').onclick = () => courseModal(course, () => ctx.refresh());
  ctx.root.querySelector('[data-toggle-pub]')?.addEventListener('click', () => {
    const next = course.status === 'published' ? 'draft' : 'published';
    updateRecord('courses', course.id, { status: next });
    if (next === 'published') notifyMany(Domain.courseLearners(course.id).map(x => x.user.id), `${t('course')} published`, `${course.title} is now open.`, 'Course', `#/course/${course.id}`);
    toast(next === 'published' ? `${t('course')} published.` : `${t('course')} moved to draft.`); ctx.refresh();
  });
  const pane = ctx.root.querySelector('[data-tab]');
  ({ overview: builderOverview, sessions: builderSessions, assignments: builderAssignments, quizzes: typeof builderQuizzes === 'function' ? builderQuizzes : null, learners: builderLearners })[tab]?.(pane, course, ctx);
} });

function builderOverview(pane, course, ctx) {
  const sessions = Domain.courseSessions(course.id, true), learners = Domain.courseLearners(course.id);
  const avgProg = learners.length ? Math.round(sum(learners, x => Domain.progress(x.user.id, course.id).percent) / learners.length) : 0;
  const pend = db().submissions.filter(s => s.courseId === course.id && ['Submitted', 'Late'].includes(s.status)).length;
  const zoom = course.zoom || {};
  const checks = [
    [sessions.length > 0, `At least one ${t('session', true)} scheduled`, 'sessions'],
    [sessions.some(s => s.resources?.length), 'Resources shared', 'sessions'],
    [Domain.courseAssignments(course.id, true).length > 0, `${t('assignment')} published`, 'assignments'],
    [!!(zoom.registerUrl || course.delivery === 'onsite'), 'Zoom details configured', null],
    [(course.outcomes || []).length > 0, 'Learning outcomes added', null],
    [learners.length > 0, `${t('learners')} enrolled`, 'learners']
  ];
  pane.innerHTML = `
    <div class="stats">${statCard(t('sessions'), sessions.length, 'layers', `${sessions.filter(s => s.date && s.date < todayISO()).length} delivered`)}${statCard(t('learners'), learners.length, 'users')}${statCard('Avg. progress', avgProg + '%', 'target')}${statCard('To grade', pend, 'clipboard', '', '#/submissions?course=' + course.id)}</div>
    <div class="layout-aside">
      <div class="card"><h3>Details</h3><dl class="facts cols-2">
        <div><dt>Program type</dt><dd>${esc(pairLabel(lms().programTypes, course.programType))}</dd></div><div><dt>${t('program')}</dt><dd>${esc(findRecord('programs', course.programId)?.name || '—')}</dd></div>
        <div><dt>Delivery</dt><dd>${esc(pairLabel(lms().deliveryModes, course.delivery))}</dd></div><div><dt>Level</dt><dd>${esc(course.level || '—')}</dd></div>
        <div><dt>Dates</dt><dd>${fmtDate(course.startDate)} – ${fmtDate(course.endDate)}</dd></div><div><dt>Schedule</dt><dd>${esc(course.schedule || '—')}</dd></div>
        <div><dt>${t('instructors')}</dt><dd>${esc((course.instructorIds || []).map(userName).join(', ') || '—')}</dd></div><div><dt>${t('fee')}</dt><dd>${course.fee ? fmtMoney(course.fee) : '—'}</dd></div>
        <div><dt>Help URL</dt><dd class="truncate">${esc(course.helpUrl || 'Platform default')}</dd></div><div><dt>Zoom</dt><dd>${zoom.meetingId ? esc(zoom.meetingId) : zoom.registerUrl ? 'Link configured' : '—'}</dd></div>
      </dl></div>
      <div class="card"><h3>Launch checklist</h3><ul class="checklist">${checks.map(([ok, label, tab]) => `<li class="${ok ? 'ok' : ''}">${icon(ok ? 'check' : 'x', 15)}<span>${esc(label)}</span>${!ok && tab ? `<a class="small" href="#/manage/course/${course.id}?tab=${tab}">Fix</a>` : ''}</li>`).join('')}</ul></div>
    </div>`;
}

function builderSessions(pane, course, ctx) {
  const draw = () => {
    const sessions = Domain.courseSessions(course.id, true);
    pane.innerHTML = `<div class="row-between mb"><p class="muted small">${sessions.length} ${t('sessions', true)} · reorder with the arrows. Unpublished ${t('sessions', true)} are hidden from ${t('learners', true)}.</p><button class="btn btn-primary btn-sm" data-add>${icon('plus', 15)} Add ${t('session', true)}</button></div>
      <div class="session-list builder">${sessions.length ? sessionGroups(sessions, s => {
        const i = sessions.indexOf(s);
        return `<div class="session-row ${s.published === false ? 'muted-row' : ''}"><span class="s-num">${i + 1}</span><div class="s-body"><b>${esc(s.title)}</b><span class="s-meta">${s.date ? fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' }) : 'No date'}${s.time ? ' · ' + fmtTime(s.time) : ''}${s.duration ? ' · ' + esc(s.duration) : ''} · ${s.videoUrl ? icon('play', 12) + ' video' : 'no video'} · ${(s.resources || []).length} resources</span></div>
          <div class="row gap-xs">${s.published === false ? badge('Draft') : badge(Domain.sessionStatus(s))}<button class="icon-btn icon-btn-sm" data-move="${s.id}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('arrowUp', 14)}</button><button class="icon-btn icon-btn-sm" data-move="${s.id}:1" ${i === sessions.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('arrowDown', 14)}</button><button class="icon-btn icon-btn-sm" data-edit="${s.id}" aria-label="Edit">${icon('edit', 14)}</button><button class="icon-btn icon-btn-sm danger" data-del="${s.id}" aria-label="Delete">${icon('trash', 14)}</button></div></div>`;
      }) : emptyState(`No ${t('sessions', true)} yet`, `Add the first ${t('session', true)} with its date, recording and resources.`, 'layers')}</div>`;
    pane.querySelector('[data-add]').onclick = () => sessionModal(course, null, draw);
    pane.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => sessionModal(course, findRecord('sessions', b.dataset.edit), draw));
    pane.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const s = findRecord('sessions', b.dataset.del);
      if (!(await confirmDialog(`Delete "${s.title}"? Attendance for this ${t('session', true)} is removed too.`, { danger: true, confirmText: 'Delete' }))) return;
      const d = db(); d.sessions = d.sessions.filter(x => x.id !== s.id); d.attendance = d.attendance.filter(x => x.sessionId !== s.id); d.assignments.forEach(a => { if (a.sessionId === s.id) a.sessionId = ''; });
      saveDB(d); toast(`${t('session')} deleted.`); draw();
    });
    pane.querySelectorAll('[data-move]').forEach(b => b.onclick = () => {
      const [id, dir] = b.dataset.move.split(':'); const list = Domain.courseSessions(course.id, true); const i = list.findIndex(x => x.id === id), j = i + Number(dir);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      const d = db(); list.forEach((s, k) => { d.sessions.find(x => x.id === s.id).order = k + 1; }); saveDB(d); draw();
    });
  };
  draw();
  if (ctx.query.edit) { const s = findRecord('sessions', ctx.query.edit); if (s) sessionModal(course, s, draw); }
}

function sessionModal(course, rec, done) {
  const modules = [...new Set([...(course.modules || []).map(m => m.name), ...Domain.courseSessions(course.id, true).map(s => s.moduleName).filter(Boolean)])];
  let resources = clone(rec?.resources || []);
  const fields = [
    { name: 'title', label: 'Title', required: true, full: true },
    { name: 'moduleName', label: t('module'), placeholder: modules[0] || 'Module 1' },
    { name: 'date', label: 'Date', type: 'date' },
    { name: 'time', label: 'Start time', type: 'time' },
    { name: 'duration', label: 'Duration', placeholder: 'e.g. 2h' },
    { name: 'delivery', label: 'Delivery (override)', type: 'select', options: opt.delivery, placeholderOption: `Same as ${t('course', true)}` },
    { name: 'statusOverride', label: 'Status', type: 'select', options: ['Available', 'Upcoming', 'Today', 'Cancelled', 'Postponed'], placeholderOption: 'Automatic (from date)' },
    { name: 'summary', label: 'Summary', type: 'textarea', rows: 3 },
    { name: 'videoUrl', label: 'Recording / video URL', type: 'url', full: true, placeholder: 'YouTube, Vimeo, Google Drive or .mp4 link', help: 'Paste a share link — it will be embedded automatically.' },
    { name: 'zoomRegisterUrl', label: 'Zoom URL for this session (optional)', type: 'url', full: true, help: `Overrides the ${t('course', true)}-level Zoom link.` },
    { name: 'zoomMeetingId', label: 'Meeting ID (optional)' },
    { name: 'zoomPassword', label: 'Passcode (optional)' },
    { name: 'published', label: 'Published', type: 'checkbox', checkLabel: `Visible to ${t('learners', true)}` }
  ];
  const values = rec ? { ...rec, zoomRegisterUrl: rec.zoom?.registerUrl, zoomMeetingId: rec.zoom?.meetingId, zoomPassword: rec.zoom?.password, published: rec.published !== false } : { published: true, moduleName: modules[modules.length - 1] || '', time: '19:00', duration: '2h' };
  const m = openModal({ title: rec ? `Edit ${t('session', true)}` : `Add ${t('session', true)}`, size: 'lg', body: `<form novalidate>${formHTML(fields, values)}<datalist id="dl-modules">${modules.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <div class="sub-section"><div class="row-between"><h3>Resources</h3><span class="muted small">Files or links ${t('learners', true)} can download</span></div><ul class="resource-list editable" data-res></ul>
      <div class="res-add"><input class="input" data-rtitle placeholder="Resource title"><input class="input" data-rurl type="url" placeholder="https://… (or choose a file)"><label class="btn btn-ghost btn-sm file-btn">${icon('upload', 15)} File<input type="file" hidden data-rfile></label><button type="button" class="btn btn-secondary btn-sm" data-radd>${icon('plus', 15)} Add</button></div></div></form>`,
    footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-save>${rec ? 'Save changes' : 'Add ' + t('session', true)}</button>` });
  m.querySelector('[name="moduleName"]').setAttribute('list', 'dl-modules');
  const drawRes = () => {
    m.querySelector('[data-res]').innerHTML = resources.length ? resources.map((r, i) => `<li><span class="res-icon">${icon(fileIcon(r.type), 15)}</span><div class="grow"><b>${esc(r.title)}</b><small class="muted truncate block">${esc(r.type === 'link' ? r.url : (r.fileName || r.url).slice(0, 80))}${r.size ? ' · ' + fmtSize(r.size) : ''}</small></div><button type="button" class="icon-btn icon-btn-sm" data-rup="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('arrowUp', 14)}</button><button type="button" class="icon-btn icon-btn-sm danger" data-rdel="${i}" aria-label="Remove">${icon('trash', 14)}</button></li>`).join('') : `<li class="muted small">No resources added.</li>`;
    m.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => { resources.splice(Number(b.dataset.rdel), 1); drawRes(); });
    m.querySelectorAll('[data-rup]').forEach(b => b.onclick = () => { const i = Number(b.dataset.rup); [resources[i - 1], resources[i]] = [resources[i], resources[i - 1]]; drawRes(); });
  };
  drawRes();
  const fileInput = m.querySelector('[data-rfile]');
  fileInput.onchange = () => { const f = fileInput.files[0]; if (f) { m.querySelector('[data-rurl]').value = ''; m.querySelector('[data-rurl]').placeholder = `File: ${f.name}`; if (!m.querySelector('[data-rtitle]').value) m.querySelector('[data-rtitle]').value = f.name.replace(/\.[^.]+$/, ''); } };
  m.querySelector('[data-radd]').onclick = async () => {
    const title = m.querySelector('[data-rtitle]').value.trim(), url = m.querySelector('[data-rurl]').value.trim(), file = fileInput.files[0];
    if (!title) return toast('Give the resource a title.', 'error');
    const btn = m.querySelector('[data-radd]');
    try {
      if (file) {
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
        const up = await uploadFile(file, { types: [...new Set([...csvList(lms().allowedTypes), 'pdf', 'pptx', 'docx', 'xlsx', 'csv', 'zip', 'txt', 'png', 'jpg'])] });
        resources.push({ id: uid('RES'), title, type: fileExt(file.name), url: up.url, size: up.size, fileName: file.name });
        if (up.stored === 'inline') toast('Upload server unavailable — file stored in this browser only.', 'warning');
      } else if (url) {
        if (!/^https?:\/\//.test(url)) return toast('Links must start with https://', 'error');
        resources.push({ id: uid('RES'), title, type: 'link', url, size: 0 });
      } else return toast('Add a link or choose a file.', 'error');
      m.querySelector('[data-rtitle]').value = ''; m.querySelector('[data-rurl]').value = ''; m.querySelector('[data-rurl]').placeholder = 'https://… (or choose a file)'; fileInput.value = '';
      drawRes();
    } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; btn.innerHTML = `${icon('plus', 15)} Add`; }
  };
  m.querySelector('[data-save]').onclick = () => {
    const form = m.querySelector('form'), r = readForm(form, fields);
    if (!r.title) return toast('Title is required.', 'error');
    const bad = [...form.querySelectorAll('input[type=url][name]')].find(i => i.value && !i.checkValidity());
    if (bad) { bad.focus(); return toast('Please enter a valid URL including https://', 'error'); }
    const data = { ...r, courseId: course.id, resources, zoom: { registerUrl: r.zoomRegisterUrl, meetingId: r.zoomMeetingId, password: r.zoomPassword } };
    ['zoomRegisterUrl', 'zoomMeetingId', 'zoomPassword'].forEach(k => delete data[k]);
    if (rec) updateRecord('sessions', rec.id, data);
    else {
      const saved = addRecord('sessions', { ...data, id: uid('S'), order: Domain.courseSessions(course.id, true).length + 1 });
      if (saved.published && course.status === 'published') notifyMany(Domain.courseLearners(course.id).map(x => x.user.id), `New ${t('session', true)}: ${saved.title}`, `${course.title}${saved.date ? ' · ' + fmtDate(saved.date) : ''}`, 'Session', `#/course/${course.id}/session/${saved.id}`);
    }
    m.close(); toast(rec ? `${t('session')} updated.` : `${t('session')} added.`); done?.();
  };
}

function builderAssignments(pane, course) {
  const sessions = Domain.courseSessions(course.id, true);
  pane.innerHTML = `<div data-crud></div>`;
  const sub = { root: pane.querySelector('[data-crud]'), query: {} };
  crudPage(sub, {
    collection: 'assignments', title: t('assignments'), singular: t('assignment'), icon: 'clipboard', export: false,
    subtitle: `Each ${t('assignment', true)} is linked to a ${t('session', true)} and appears in the learner's Submit page.`,
    rows: () => Domain.courseAssignments(course.id, true), defaultSort: 'due',
    columns: [
      { key: 'title', label: 'Title', primary: true, render: a => `<b>${esc(a.title)}</b>` },
      { key: 'session', label: t('session'), sortValue: a => sessions.findIndex(s => s.id === a.sessionId), render: a => { const i = sessions.findIndex(s => s.id === a.sessionId); return i < 0 ? '<span class="muted">—</span>' : `<span class="pill">${i + 1}</span> ${esc(sessions[i].title)}`; } },
      { key: 'due', label: 'Due', sortValue: a => a.dueAt || '', render: a => fmtDateTime(a.dueAt) },
      { key: 'maxMarks', label: 'Marks' },
      { key: 'subs', label: 'Submissions', sortValue: a => db().submissions.filter(s => s.assignmentId === a.id).length, render: a => { const ss = db().submissions.filter(s => s.assignmentId === a.id); return `<a href="#/submissions?assignment=${a.id}">${ss.length}</a> <small class="muted">(${ss.filter(s => s.status === 'Graded').length} graded)</small>`; } },
      { key: 'status', label: 'Status', render: a => badge(a.status) }
    ],
    fields: () => [
      { name: 'title', label: 'Title', required: true, full: true },
      { name: 'sessionId', label: t('session'), type: 'select', options: sessions.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.title}` })) },
      { name: 'dueAt', label: 'Due date & time', type: 'datetime-local', required: true },
      { name: 'maxMarks', label: 'Maximum marks', type: 'number', min: 1, required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Published', 'Draft'], placeholderOption: false },
      { name: 'lateAllowed', label: 'Late submissions', type: 'checkbox', checkLabel: 'Accept late submissions' },
      { name: 'description', label: 'Instructions', type: 'textarea', rows: 4 }
    ],
    defaults: () => ({ status: 'Published', lateAllowed: lms().lateSubmissions !== false, maxMarks: 20 }),
    transform: d => ({ ...d, courseId: course.id, maxMarks: Number(d.maxMarks) || 0 }),
    validate: d => { if (d.maxMarks <= 0) throw new Error('Maximum marks must be greater than zero.'); },
    afterSave: (a, isNew) => { if (isNew && a.status === 'Published') notifyMany(Domain.courseLearners(course.id).map(x => x.user.id), `New ${t('assignment', true)}: ${a.title}`, `Due ${fmtDateTime(a.dueAt)}`, 'Assignment', `#/course/${course.id}/submit?assignment=${a.id}`); },
    beforeDelete: a => { if (db().submissions.some(s => s.assignmentId === a.id)) throw new Error('This assignment already has submissions. Set it to Draft instead of deleting.'); }
  });
}

function builderLearners(pane, course) {
  pane.innerHTML = `<div class="row-between mb"><p class="muted small">${t('learners')} enrolled in this ${t('course', true)}, with progress and attendance.</p>${can('enrollments', 'create') ? `<button class="btn btn-primary btn-sm" data-enroll>${icon('userPlus', 15)} Enroll ${t('learner', true)}</button>` : ''}</div><div class="card" data-t></div>`;
  const tbl = dataTable(pane.querySelector('[data-t]'), {
    rows: () => Domain.courseLearners(course.id), searchText: x => `${x.user.name} ${x.user.email}`,
    columns: [
      { key: 'name', label: t('learner'), primary: true, sortValue: x => x.user.name, render: x => `<div class="person">${avatar(x.user, 30)}<div><b>${esc(x.user.name)}</b><small class="muted block">${esc(x.user.email)}</small></div></div>` },
      { key: 'batch', label: t('batch'), sortValue: x => findRecord('batches', x.enrollment.batchId)?.name || '', render: x => esc(findRecord('batches', x.enrollment.batchId)?.name || '—') },
      { key: 'access', label: 'Access', sortValue: x => x.enrollment.accessMode, render: x => x.enrollment.accessMode === 'restricted' ? `${badge('Restricted', 'warning')} <small class="muted">${(x.enrollment.allowedSessionIds || []).length} ${t('sessions', true)}</small>` : badge('Full', 'success') },
      { key: 'progress', label: 'Progress', sortValue: x => Domain.progress(x.user.id, course.id).percent, render: x => { const p = Domain.progress(x.user.id, course.id).percent; return `<div class="inline-progress">${progressBar(p)}<small>${p}%</small></div>`; } },
      { key: 'att', label: 'Attendance', sortValue: x => Domain.attendanceStats(x.user.id, course.id).percent ?? -1, render: x => { const a = Domain.attendanceStats(x.user.id, course.id); return a.percent === null ? '<span class="muted">—</span>' : `<span class="${a.percent < lms().attendanceWarning ? 'text-danger' : ''}">${a.percent}%</span>`; } },
      { key: 'status', label: 'Status', sortValue: x => x.enrollment.status, render: x => badge(x.enrollment.status) }
    ],
    actions: x => can('enrollments', 'edit') ? `<button class="icon-btn icon-btn-sm" data-ed="${x.enrollment.id}" aria-label="Edit enrollment">${icon('edit', 15)}</button>` : (feature('messages') ? `<a class="icon-btn icon-btn-sm" href="#/messages?to=${x.user.id}" aria-label="Message">${icon('mail', 15)}</a>` : ''),
    emptyTitle: `No ${t('learners', true)} enrolled`, emptyIcon: 'users',
    onDraw: body => body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => enrollmentModal(findRecord('enrollments', b.dataset.ed), () => tbl.redraw()))
  });
  pane.querySelector('[data-enroll]')?.addEventListener('click', () => enrollmentModal(null, () => tbl.redraw(), course.id));
}

/* ----------------------------------------------------------- Enrollments */
function enrollmentModal(rec, done, presetCourse) {
  const values = rec ? { ...rec } : { courseId: presetCourse || '', accessMode: 'full', status: 'Active', enrolledAt: todayISO(), createFee: true };
  const base = [
    { name: 'learnerId', label: t('learner'), type: 'select', options: opt.learners, required: true },
    { name: 'courseId', label: t('course'), type: 'select', options: opt.courses, required: true },
    { name: 'batchId', label: t('batch'), type: 'select', options: () => db().batches.filter(b => b.courseId === values.courseId).map(b => ({ value: b.id, label: b.name })), placeholderOption: 'No batch' },
    { name: 'enrolledAt', label: 'Enrolled on', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Completed', 'Withdrawn'], placeholderOption: false },
    { name: 'accessMode', label: 'Access', type: 'select', options: [{ value: 'full', label: `Full — all ${t('sessions', true)}` }, { value: 'restricted', label: `Restricted — selected ${t('sessions', true)} only` }], placeholderOption: false },
    { name: 'allowedSessionIds', label: `Allowed ${t('sessions', true)}`, type: 'multiselect', options: () => Domain.courseSessions(values.courseId, true).map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.title}` })), emptyText: `Select a ${t('course', true)} first.` },
    { name: 'createFee', label: 'Fee', type: 'checkbox', checkLabel: `Create a course ${t('fee', true)} record from the ${t('course', true)} price`, hidden: !!rec || !feature('fees') }
  ];
  const m = openModal({ title: rec ? 'Edit enrollment' : `Enroll ${t('learner', true)}`, size: 'lg', body: `<form novalidate>${formHTML(base, values)}</form>`, footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-save>${rec ? 'Save' : 'Enroll'}</button>` });
  const form = m.querySelector('form');
  const sync = () => {
    const cur = readForm(form, base); Object.assign(values, cur);
    const batchF = base.find(f => f.name === 'batchId'), sesF = base.find(f => f.name === 'allowedSessionIds');
    form.querySelector('[data-field="batchId"]').outerHTML = fieldHTML(batchF, values);
    form.querySelector('[data-field="allowedSessionIds"]').outerHTML = fieldHTML(sesF, values);
    toggleAllowed();
  };
  const toggleAllowed = () => { form.querySelector('[data-field="allowedSessionIds"]').hidden = form.accessMode.value !== 'restricted'; };
  form.courseId.addEventListener('change', sync);
  form.accessMode.addEventListener('change', toggleAllowed);
  toggleAllowed();
  m.querySelector('[data-save]').onclick = () => {
    const r = readForm(form, base);
    if (!r.learnerId || !r.courseId) return toast(`${t('learner')} and ${t('course', true)} are required.`, 'error');
    if (db().enrollments.some(e => e.learnerId === r.learnerId && e.courseId === r.courseId && e.id !== rec?.id)) return toast(`This ${t('learner', true)} is already enrolled in the ${t('course', true)}.`, 'error');
    if (r.accessMode === 'restricted' && !r.allowedSessionIds.length) return toast(`Choose at least one ${t('session', true)} for restricted access.`, 'error');
    const batch = findRecord('batches', r.batchId);
    if (batch && !rec && batch.capacity && db().enrollments.filter(e => e.batchId === batch.id && e.status === 'Active').length >= Number(batch.capacity)) return toast(`${batch.name} is full (${batch.capacity}).`, 'error');
    const createFee = r.createFee; delete r.createFee;
    if (r.accessMode !== 'restricted') r.allowedSessionIds = [];
    const course = findRecord('courses', r.courseId);
    if (rec) updateRecord('enrollments', rec.id, r);
    else {
      addRecord('enrollments', r);
      notify(r.learnerId, `Enrolled: ${course.title}`, course.status === 'published' ? `Your ${t('course', true)} is ready in My ${t('courses')}.` : `You'll be notified when the ${t('course', true)} opens.`, 'Enrollment', `#/course/${course.id}`);
      if (createFee && course.fee) addRecord('fees', { learnerId: r.learnerId, courseId: course.id, type: 'Course Fee', amount: Number(course.fee), dueDate: course.startDate || todayISO(), status: 'Pending', paidOn: '', method: '', reference: '' });
    }
    m.close(); toast(rec ? 'Enrollment updated.' : `${t('learner')} enrolled.`); done?.();
  };
}

App.route('/enrollments', { perm: 'enrollments', render(ctx) {
  ctx.setCrumbs([{ label: 'Enrollments' }]);
  ctx.root.innerHTML = `${pageHead('Enrollments', `Link ${t('learners', true)} to ${t('courses', true)} and ${t('batches', true)}, and control ${t('session', true)} access.`, `<button class="btn btn-ghost btn-sm" data-export>${icon('download', 15)} Export</button>${can('enrollments', 'create') ? `<button class="btn btn-primary" data-add>${icon('userPlus', 16)} Enroll ${t('learner', true)}</button>` : ''}`)}<div class="card" data-t></div>`;
  const tbl = dataTable(ctx.root.querySelector('[data-t]'), {
    rows: () => db().enrollments, defaultSort: 'date', defaultDir: 'desc',
    searchText: e => `${userName(e.learnerId)} ${courseTitle(e.courseId)} ${findRecord('batches', e.batchId)?.name || ''}`,
    filters: [{ key: 'courseId', label: `All ${t('courses', true)}`, options: opt.courses }, { key: 'status', label: 'All statuses', options: ['Active', 'Completed', 'Withdrawn'] }, { key: 'accessMode', label: 'Any access', options: [{ value: 'full', label: 'Full' }, { value: 'restricted', label: 'Restricted' }] }],
    columns: [
      { key: 'learner', label: t('learner'), primary: true, sortValue: e => userName(e.learnerId), render: e => { const u = findRecord('users', e.learnerId); return `<div class="person">${avatar(u, 30)}<div><b>${esc(u?.name || '—')}</b><small class="muted block">${esc(u?.email || '')}</small></div></div>`; } },
      { key: 'course', label: t('course'), sortValue: e => courseTitle(e.courseId), render: e => `${esc(courseTitle(e.courseId))}<small class="muted block">${esc(findRecord('batches', e.batchId)?.name || 'No batch')}</small>` },
      { key: 'access', label: 'Access', sortValue: e => e.accessMode, render: e => e.accessMode === 'restricted' ? badge(`Restricted · ${(e.allowedSessionIds || []).length}`, 'warning') : badge('Full', 'success') },
      { key: 'progress', label: 'Progress', sortValue: e => Domain.progress(e.learnerId, e.courseId).percent, render: e => `${Domain.progress(e.learnerId, e.courseId).percent}%` },
      { key: 'date', label: 'Enrolled', sortValue: e => e.enrolledAt || '', render: e => fmtDate(e.enrolledAt) },
      { key: 'status', label: 'Status', render: e => badge(e.status) }
    ],
    actions: e => `${can('enrollments', 'edit') ? `<button class="icon-btn icon-btn-sm" data-ed="${e.id}" aria-label="Edit">${icon('edit', 15)}</button>` : ''}${can('enrollments', 'delete') ? `<button class="icon-btn icon-btn-sm danger" data-del="${e.id}" aria-label="Remove">${icon('trash', 15)}</button>` : ''}`,
    emptyTitle: 'No enrollments yet', emptyIcon: 'userPlus',
    onDraw: body => {
      body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => enrollmentModal(findRecord('enrollments', b.dataset.ed), () => tbl.redraw()));
      body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        const e = findRecord('enrollments', b.dataset.del);
        if (!(await confirmDialog(`Remove ${userName(e.learnerId)} from ${courseTitle(e.courseId)}? Progress for this ${t('course', true)} is removed. Tip: set status to "Withdrawn" to keep history.`, { danger: true, confirmText: 'Remove' }))) return;
        const d = db(); d.enrollments = d.enrollments.filter(x => x.id !== e.id); d.progress = d.progress.filter(p => !(p.learnerId === e.learnerId && p.courseId === e.courseId)); saveDB(d); toast('Enrollment removed.'); tbl.redraw();
      });
    }
  });
  ctx.root.querySelector('[data-add]')?.addEventListener('click', () => enrollmentModal(null, () => tbl.redraw()));
  ctx.root.querySelector('[data-export]').onclick = () => csvDownload('enrollments.csv', [[t('learner'), 'Email', t('course'), t('batch'), 'Access', 'Progress %', 'Status', 'Enrolled'], ...tbl.rows().map(e => [userName(e.learnerId), findRecord('users', e.learnerId)?.email, courseTitle(e.courseId), findRecord('batches', e.batchId)?.name || '', e.accessMode, Domain.progress(e.learnerId, e.courseId).percent, e.status, e.enrolledAt])]);
  if (ctx.query.new && can('enrollments', 'create')) enrollmentModal(null, () => tbl.redraw());
} });

/* -------------------------------------------- Programs, divisions, batches */
// Batch names follow <Course>-<Delivery>-<Year>, with -2, -3… when that name is already taken.
function batchName(courseId, delivery, startDate, exceptId) {
  const c = findRecord('courses', courseId); if (!c) return '';
  const short = String(c.slug || c.title).split(/[-\s]+/)[0];
  const base = [short.charAt(0).toUpperCase() + short.slice(1), pairLabel(lms().deliveryModes, delivery), String(startDate || todayISO()).slice(0, 4)].join('-');
  const taken = new Set(db().batches.filter(b => b.id !== exceptId).map(b => b.name));
  if (!taken.has(base)) return base;
  let n = 2; while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
App.route('/programs', { perm: 'programs', render(ctx) {
  ctx.setCrumbs([{ label: t('programs') }]);
  crudPage(ctx, {
    collection: 'programs', perm: 'programs', title: t('programs'), singular: t('program'), icon: 'layers',
    subtitle: `Diplomas, certificates, workshops and short ${t('courses', true)} offered by ${esc(brand().orgShort)}.`,
    columns: [
      { key: 'name', label: 'Name', primary: true, render: p => `<b>${esc(p.name)}</b><small class="muted block">${esc(p.code || '')}</small>` },
      { key: 'type', label: 'Type', sortValue: p => p.type, render: p => badge(pairLabel(lms().programTypes, p.type), 'neutral') },
      { key: 'division', label: t('division'), sortValue: p => findRecord('divisions', p.divisionId)?.name || '', render: p => esc(findRecord('divisions', p.divisionId)?.name || '—') },
      { key: 'duration', label: 'Duration' },
      { key: 'courses', label: t('courses'), sortValue: p => db().courses.filter(c => c.programId === p.id).length, render: p => db().courses.filter(c => c.programId === p.id).length },
      { key: 'status', label: 'Status', render: p => badge(p.status) }
    ],
    filters: [{ key: 'type', label: 'All types', options: opt.programTypes }, { key: 'status', label: 'All statuses', options: ['Active', 'Inactive'] }],
    fields: () => [
      { name: 'name', label: 'Name', required: true, full: true }, { name: 'code', label: 'Code' },
      { name: 'type', label: 'Type', type: 'select', options: opt.programTypes, required: true, placeholderOption: false },
      { name: 'divisionId', label: t('division'), type: 'select', options: opt.divisions }, { name: 'duration', label: 'Duration', placeholder: 'e.g. 6 months' },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], placeholderOption: false }, { name: 'description', label: 'Description', type: 'textarea' }
    ],
    defaults: () => ({ status: 'Active', type: pairs(lms().programTypes)[0]?.value }),
    beforeDelete: p => { if (db().courses.some(c => c.programId === p.id)) throw new Error(`Reassign the ${t('courses', true)} in this ${t('program', true)} before deleting it.`); }
  });
} });

App.route('/divisions', { perm: 'divisions', render(ctx) {
  ctx.setCrumbs([{ label: t('divisions') }]);
  crudPage(ctx, {
    collection: 'divisions', perm: 'divisions', title: t('divisions'), singular: t('division'), icon: 'building',
    subtitle: `Training departments that own ${t('programs', true)} and ${t('courses', true)}.`,
    columns: [
      { key: 'name', label: 'Name', primary: true, render: d => `<b>${esc(d.name)}</b><small class="muted block">${esc(d.code || '')}</small>` },
      { key: 'head', label: 'Head' },
      { key: 'programs', label: t('programs'), sortValue: d => db().programs.filter(p => p.divisionId === d.id).length, render: d => db().programs.filter(p => p.divisionId === d.id).length },
      { key: 'courses', label: t('courses'), sortValue: d => db().courses.filter(c => c.divisionId === d.id).length, render: d => db().courses.filter(c => c.divisionId === d.id).length },
      { key: 'status', label: 'Status', render: d => badge(d.status) }
    ],
    fields: () => [{ name: 'name', label: 'Name', required: true, full: true }, { name: 'code', label: 'Code' }, { name: 'head', label: 'Head of division' }, { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], placeholderOption: false }, { name: 'description', label: 'Description', type: 'textarea' }],
    defaults: () => ({ status: 'Active' }),
    beforeDelete: d => { if (db().programs.some(p => p.divisionId === d.id) || db().courses.some(c => c.divisionId === d.id)) throw new Error(`This ${t('division', true)} still has ${t('programs', true)} or ${t('courses', true)}.`); }
  });
} });

App.route('/batches', { perm: 'batches', render(ctx) {
  ctx.setCrumbs([{ label: t('batches') }]);
  crudPage(ctx, {
    collection: 'batches', perm: 'batches', title: t('batches'), singular: t('batch'), icon: 'grid',
    subtitle: `Cohorts or sections of a ${t('course', true)} with their own ${t('instructor', true)}, venue and capacity.`,
    columns: [
      { key: 'name', label: 'Name', primary: true, render: b => `<b>${esc(b.name)}</b><small class="muted block">${esc(courseTitle(b.courseId))}</small>` },
      { key: 'instructor', label: t('instructor'), sortValue: b => userName(b.instructorId), render: b => esc(userName(b.instructorId)) },
      { key: 'dates', label: 'Dates', sortValue: b => b.startDate || '', render: b => `${fmtDateShort(b.startDate)} – ${fmtDate(b.endDate)}` },
      { key: 'delivery', label: 'Delivery', render: b => `${esc(pairLabel(lms().deliveryModes, b.delivery))}<small class="muted block">${esc(b.venue || '')}</small>` },
      { key: 'seats', label: 'Seats', sortValue: b => db().enrollments.filter(e => e.batchId === b.id && e.status !== 'Withdrawn').length, render: b => { const n = db().enrollments.filter(e => e.batchId === b.id && e.status !== 'Withdrawn').length; return `${n}${b.capacity ? ' / ' + b.capacity : ''}`; } },
      { key: 'status', label: 'Status', render: b => badge(b.status) }
    ],
    filters: [{ key: 'courseId', label: `All ${t('courses', true)}`, options: opt.courses }, { key: 'status', label: 'All statuses', options: ['Active', 'Completed', 'Cancelled'] }],
    fields: () => [
      { name: 'name', label: 'Name', required: true, full: true, readonly: true, help: 'Generated automatically from the course, delivery mode and start year.' }, { name: 'courseId', label: t('course'), type: 'select', options: opt.courses, required: true },
      { name: 'instructorId', label: t('instructor'), type: 'select', options: opt.instructors }, { name: 'startDate', label: 'Start date', type: 'date' }, { name: 'endDate', label: 'End date', type: 'date' },
      { name: 'delivery', label: 'Delivery', type: 'select', options: opt.delivery, placeholderOption: false }, { name: 'venue', label: 'Venue' }, { name: 'capacity', label: 'Capacity', type: 'number', min: 1 },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Completed', 'Cancelled'], placeholderOption: false }
    ],
    defaults: () => ({ status: 'Active', delivery: 'online', capacity: 30 }),
    bindForm: (form, rec) => {
      const sync = () => { form.name.value = batchName(form.courseId.value, form.delivery.value, form.startDate.value, rec?.id) || ''; };
      ['courseId', 'delivery', 'startDate'].forEach(k => form[k].addEventListener('change', sync));
      if (!rec) sync();
    },
    transform: (b, rec) => {
      const keyChanged = !rec || rec.courseId !== b.courseId || rec.delivery !== b.delivery || String(rec.startDate || '').slice(0, 4) !== String(b.startDate || '').slice(0, 4);
      return { ...b, name: keyChanged ? batchName(b.courseId, b.delivery, b.startDate, rec?.id) : rec.name };
    },
    validate: b => { if (b.startDate && b.endDate && b.endDate < b.startDate) throw new Error('End date must be after the start date.'); },
    beforeDelete: b => { if (db().enrollments.some(e => e.batchId === b.id)) throw new Error(`Move enrolled ${t('learners', true)} to another ${t('batch', true)} first.`); }
  });
} });

