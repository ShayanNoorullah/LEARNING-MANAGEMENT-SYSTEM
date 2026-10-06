/* SDC Learn — user accounts and configurable roles & permissions. */

/* ----------------------------------------------------------------- Users
   base = 'student' | 'teacher' | null (all accounts). Any role (built-in or custom) can be assigned. */
function userPage(ctx, base) {
  const perm = base === 'student' ? 'learners' : 'staff';
  const all = scopeAll(ctx.user);
  const title = base === 'student' ? t('learners') : base === 'teacher' ? t('instructors') : 'All users';
  const singular = base === 'student' ? t('learner') : base === 'teacher' ? t('instructor') : 'User';
  const roleOptions = () => db().roles.filter(r => !base || r.base === base).map(r => ({ value: r.id, label: r.name }));
  const scopeIds = !all && base === 'student' ? Domain.scopedLearnerIds(ctx.user) : null;
  ctx.setCrumbs([{ label: title }]);
  crudPage(ctx, {
    collection: 'users', perm, title, singular, icon: base === 'student' ? 'cap' : base === 'teacher' ? 'users' : 'user',
    subtitle: all ? `Manage ${title.toLowerCase()} accounts, roles and access.` : `${t('learners')} enrolled in your ${t('courses', true)}.`,
    canDeleteRow: u => u.id !== ctx.user.id,
    rows: () => db().users.filter(u => (!base || kind(u) === base) && (!scopeIds || scopeIds.includes(u.id))),
    bindForm: (form, rec) => { if (rec?.id === ctx.user.id) form.role.disabled = true; },
    searchText: u => `${u.name} ${u.email} ${u.regNo || ''} ${u.designation || ''} ${u.city || ''} ${roleLabel(u)}`,
    filters: [
      { key: 'role', label: 'All roles', options: roleOptions },
      { key: 'status', label: 'All statuses', options: ['Active', 'Inactive', 'Suspended'] },
      ...(base === 'student' ? [{ key: 'course', label: `All ${t('courses', true)}`, options: opt.courses, match: (u, v) => !!Domain.enrollment(u.id, v) }] : [])
    ],
    columns: [
      { key: 'name', label: 'Name', primary: true, render: u => `<div class="person">${avatar(u, 32)}<div><b>${esc(u.name)}</b>${u.demo ? ' <span class="badge badge-neutral">Demo</span>' : ''}<small class="muted block">${esc(u.email)}</small></div></div>` },
      { key: 'role', label: 'Role', sortValue: u => roleLabel(u), render: u => badge(roleLabel(u), roleOf(u)?.system ? 'info' : 'accent') },
      { key: 'courses', label: t('courses'), sortValue: u => Domain.visibleCourses(u).length, render: u => scopeAll(u) ? '<span class="muted">All</span>' : Domain.visibleCourses(u).map(c => `<span class="pill">${esc(c.code || c.title)}</span>`).join(' ') || '<span class="muted">—</span>' },
      { key: 'lastLoginAt', label: 'Last sign-in', sortValue: u => u.lastLoginAt || '', render: u => u.lastLoginAt ? esc(relTime(u.lastLoginAt)) : '<span class="muted">Never</span>' },
      { key: 'status', label: 'Status', render: u => badge(u.status) }
    ],
    rowActions: u => u.id !== ctx.user.id && feature('messages') && can('messages', 'create') ? `<a class="icon-btn icon-btn-sm" href="#/messages?to=${u.id}" aria-label="Message">${icon('mail', 15)}</a>` : '',
    fields: rec => {
      const k = rec ? kind(rec) : base;
      return [
        { name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'role', label: 'Role', type: 'select', options: roleOptions, required: true, placeholderOption: false, readonly: rec?.id === ctx.user.id, help: rec?.id === ctx.user.id ? 'You cannot change your own role.' : 'Controls what this person can see and do.' },
        { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Suspended'], placeholderOption: false },
        { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'city', label: 'City' },
        ...(k === 'student' ? [{ name: 'regNo', label: 'Registration no.' }, { name: 'cnic', label: 'CNIC' }, { name: 'education', label: 'Education', full: true }]
          : [{ name: 'designation', label: 'Designation' }, { name: 'specialization', label: 'Specialization' }, { name: 'bio', label: 'Short bio', type: 'textarea' }]),
        { name: 'password', label: rec ? 'New password' : 'Password', type: 'password', required: !rec, help: rec ? 'Leave blank to keep the current password.' : 'Minimum 8 characters.' }
      ];
    },
    toForm: () => ({ password: '' }),
    defaults: () => ({ status: 'Active', role: roleOptions()[0]?.value }),
    transform: (d, rec) => {
      const email = String(d.email).toLowerCase();
      if (db().users.some(u => u.email.toLowerCase() === email && u.id !== rec?.id)) throw new Error('Another account already uses this email.');
      if (d.password && d.password.length < 8) throw new Error('Password must be at least 8 characters.');
      if (!roleOf(d.role) || !db().roles.some(r => r.id === d.role)) throw new Error('Choose a valid role.');
      if (rec?.id === ctx.user.id && d.role !== rec.role) throw new Error('You cannot change your own role.');
      const out = { ...d, email };
      delete out.password;
      if (d.password) { out.salt = randomToken(8); out.passwordHash = hashPassword(d.password, out.salt); out.demo = false; }
      if (!rec) out.joinedAt = todayISO();
      return out;
    },
    afterSave: (u, isNew) => { if (isNew) notify(u.id, `Welcome to ${brand().productName}`, `Your ${roleLabel(u).toLowerCase()} account is ready.`, 'Account', '#/profile'); },
    deleteMessage: u => `Delete ${u.name}'s account? Their enrollments, progress, submissions and attendance are removed. Consider setting the status to Inactive instead.`,
    afterDelete: u => { const d = db(); ['enrollments', 'progress', 'submissions', 'attendance', 'results', 'certificates', 'feedback'].forEach(k => d[k] = d[k].filter(x => x.learnerId !== u.id)); d.notifications = d.notifications.filter(n => n.userId !== u.id); d.courses.forEach(c => { c.instructorIds = (c.instructorIds || []).filter(id => id !== u.id); }); saveDB(d); }
  });
}
App.route('/learners', { perm: 'learners', render: ctx => userPage(ctx, 'student') });
App.route('/instructors', { perm: 'staff', render: ctx => userPage(ctx, 'teacher') });
App.route('/users', { perm: 'staff', render: ctx => userPage(ctx, null) });

/* ------------------------------------------------------- Roles & permissions */
const ACTIONS = ['view', 'create', 'edit', 'delete', 'publish'];
const SCOPES = [
  { value: 'all', label: 'All courses' },
  { value: 'assigned', label: 'Courses they are assigned to teach' },
  { value: 'enrolled', label: 'Courses they are enrolled in' },
  { value: 'selected', label: 'Only the courses selected below' }
];

App.route('/roles', { perm: 'roles', render(ctx) {
  ctx.setCrumbs([{ label: 'Roles & permissions' }]);
  const users = r => db().users.filter(u => u.role === r.id).length;
  ctx.root.innerHTML = `${pageHead('Roles & permissions', 'Create roles and decide exactly which pages, actions and courses each role can access.', can('roles', 'create') ? `<button class="btn btn-primary" data-add>${icon('plus', 16)} New role</button>` : '')}<div class="card" data-t></div>`;
  const tbl = dataTable(ctx.root.querySelector('[data-t]'), {
    rows: () => db().roles, defaultSort: 'name', searchText: r => `${r.name} ${r.description || ''}`,
    columns: [
      { key: 'name', label: 'Role', primary: true, render: r => `<b>${esc(r.name)}</b> ${r.system ? badge('Built-in', 'info') : badge('Custom', 'accent')}<small class="muted block">${esc(r.description || '')}</small>` },
      { key: 'base', label: 'Experience', render: r => esc(BASES[r.base] || r.base) },
      { key: 'scope', label: 'Course access', sortValue: r => r.courseScope, render: r => esc(SCOPES.find(s => s.value === r.courseScope)?.label || '—') + (r.courseScope === 'selected' ? ` <small class="muted">(${(r.courseIds || []).length})</small>` : '') },
      { key: 'perms', label: 'Permissions', sortValue: r => Object.values(r.permissions || {}).flat().length, render: r => r.id === 'admin' ? 'Full access' : `${Object.keys(r.permissions || {}).filter(k => r.permissions[k]?.length).length} modules · ${Object.values(r.permissions || {}).flat().length} actions` },
      { key: 'users', label: 'Users', sortValue: users, render: r => users(r) }
    ],
    actions: r => `${can('roles', 'edit') ? `<button class="icon-btn icon-btn-sm" data-ed="${r.id}" aria-label="Edit">${icon('edit', 15)}</button>` : ''}${can('roles', 'create') ? `<button class="icon-btn icon-btn-sm" data-dup="${r.id}" aria-label="Duplicate">${icon('copy', 15)}</button>` : ''}${can('roles', 'delete') && !r.system ? `<button class="icon-btn icon-btn-sm danger" data-del="${r.id}" aria-label="Delete">${icon('trash', 15)}</button>` : ''}`,
    emptyTitle: 'No roles', emptyIcon: 'shield',
    onDraw: body => {
      body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => roleModal(findRecord('roles', b.dataset.ed), () => tbl.redraw()));
      body.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => { const r = findRecord('roles', b.dataset.dup); roleModal({ ...clone(r), id: null, name: `${r.name} (copy)`, system: false, permissions: r.id === 'admin' ? allPermissions() : clone(r.permissions || {}) }, () => tbl.redraw()); });
      body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        const r = findRecord('roles', b.dataset.del);
        if (users(r)) return toast(`Reassign the ${users(r)} user(s) with this role first.`, 'error');
        if (await confirmDialog(`Delete the "${r.name}" role?`, { danger: true, confirmText: 'Delete' })) { deleteRecord('roles', r.id); tbl.redraw(); toast('Role deleted.'); }
      });
    }
  });
  ctx.root.querySelector('[data-add]')?.addEventListener('click', () => roleModal(null, () => tbl.redraw()));
} });

function allPermissions() { return Object.fromEntries(PERMISSIONS.map(([k, , acts]) => [k, [...acts]])); }

function roleModal(rec, done) {
  const isNew = !rec?.id, locked = rec?.id === 'admin';
  const perms = clone(rec?.permissions || {});
  const fields = [
    { name: 'name', label: 'Role name', required: true },
    { name: 'base', label: 'Experience', type: 'select', options: Object.entries(BASES).map(([value, label]) => ({ value, label })), placeholderOption: false, readonly: rec?.system, help: 'Which portal layout this role uses.' },
    { name: 'description', label: 'Description', full: true },
    { name: 'courseScope', label: 'Course access', type: 'select', options: SCOPES, placeholderOption: false, help: 'Limits courses (and their learners, submissions and attendance) this role can see.' },
    { name: 'courseIds', label: 'Selected courses', type: 'multiselect', options: opt.courses }
  ];
  const matrix = `<div class="sub-section"><div class="row-between"><h3>Page & action permissions</h3>${locked ? badge('Full access — locked', 'info') : `<span class="row gap-sm"><button type="button" class="link-btn small" data-allp>Select all</button><button type="button" class="link-btn small" data-nonep>Clear</button></span>`}</div>
    <div class="table-wrap"><table class="table perm-table"><thead><tr><th>Module</th>${ACTIONS.map(a => `<th class="ta-c">${a}</th>`).join('')}</tr></thead><tbody>${PERMISSIONS.map(([key, label, acts]) => `<tr><td class="td-primary"><label class="check"><input type="checkbox" data-row="${key}" ${locked ? 'checked disabled' : ''}><span>${esc(label)}</span></label></td>${ACTIONS.map(a => `<td class="ta-c" data-label="${a}">${acts.includes(a) ? `<input type="checkbox" class="perm-box" data-m="${key}" data-a="${a}" aria-label="${esc(label)} — ${a}" ${locked || (perms[key] || []).includes(a) ? 'checked' : ''} ${locked ? 'disabled' : ''}>` : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="help">"View" lets the role open the page; other actions enable the matching buttons. Turning a module off hides it from the menu.</p></div>`;
  const m = openModal({ title: isNew ? 'New role' : `Edit role — ${rec.name}`, size: 'xl', body: `<form novalidate>${formHTML(fields, rec || { base: 'admin', courseScope: 'all', courseIds: [] })}${matrix}</form>`, footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-save>${isNew ? 'Create role' : 'Save changes'}</button>` });
  const form = m.querySelector('form');
  if (rec?.system) form.base.disabled = true;
  const sync = () => { form.querySelector('[data-field="courseIds"]').hidden = form.courseScope.value !== 'selected'; m.querySelectorAll('[data-row]').forEach(r => { if (locked) return; const boxes = [...m.querySelectorAll(`[data-m="${r.dataset.row}"]`)]; r.checked = boxes.every(b => b.checked); r.indeterminate = !r.checked && boxes.some(b => b.checked); }); };
  form.courseScope.onchange = sync;
  m.querySelectorAll('[data-row]').forEach(r => r.onchange = () => { m.querySelectorAll(`[data-m="${r.dataset.row}"]`).forEach(b => b.checked = r.checked); sync(); });
  m.querySelectorAll('.perm-box').forEach(b => b.onchange = () => {
    // Any action implies view; removing view removes the rest.
    const row = [...m.querySelectorAll(`[data-m="${b.dataset.m}"]`)], view = row.find(x => x.dataset.a === 'view');
    if (b.checked && b !== view && view) view.checked = true;
    if (b === view && !b.checked) row.forEach(x => x.checked = false);
    sync();
  });
  m.querySelector('[data-allp]')?.addEventListener('click', () => { m.querySelectorAll('.perm-box').forEach(b => b.checked = true); sync(); });
  m.querySelector('[data-nonep]')?.addEventListener('click', () => { m.querySelectorAll('.perm-box').forEach(b => b.checked = false); sync(); });
  sync();
  m.querySelector('[data-save]').onclick = () => {
    const r = readForm(form, fields);
    if (!r.name) return toast('Role name is required.', 'error');
    if (db().roles.some(x => x.name.toLowerCase() === r.name.toLowerCase() && x.id !== rec?.id)) return toast('Another role already has this name.', 'error');
    if (r.courseScope === 'selected' && !r.courseIds.length) return toast('Select at least one course, or choose another course access option.', 'error');
    const permissions = {};
    m.querySelectorAll('.perm-box:checked').forEach(b => { (permissions[b.dataset.m] ||= []).push(b.dataset.a); });
    if (rec?.system) r.base = rec.base;
    if (r.courseScope !== 'selected') r.courseIds = [];
    const data = { ...r, permissions: locked ? {} : permissions };
    if (isNew) addRecord('roles', { ...data, id: slugify(r.name) && !findRecord('roles', slugify(r.name)) ? slugify(r.name) : uid('ROLE'), system: false });
    else updateRecord('roles', rec.id, data);
    m.close(); toast(isNew ? 'Role created.' : 'Role updated.'); App.renderNav(App.currentPath); done?.();
  };
}
