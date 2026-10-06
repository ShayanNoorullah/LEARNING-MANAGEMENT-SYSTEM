/* End-to-end workflow test. Drives the real UI (clicks, forms, modals) for every module and role.
   Run on app.html while signed in, in the browser console:
     await (await fetch('tests/e2e.browser.js')).text().then(eval)
   It resets to demo data before and after, so never run it against live data. */
(async () => {
  const W = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const modal = () => $$('.modal').pop();
  const results = [];
  const go = async h => { location.hash = h; await W(140); };
  const as = async id => { sessionStorage.setItem('sdcSession', id); invalidateCache(); App.user = currentUser(); App.mountShell(); await go('#/profile'); };
  const click = async (sel, root = document) => { const el = typeof sel === 'string' ? root.querySelector(sel) : sel; if (!el) throw new Error('missing ' + sel); el.click(); await W(140); };
  const fill = (name, v, root = modal()) => { const el = root.querySelector(`[name="${name}"]`); if (!el) throw new Error('missing field ' + name); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  const save = () => click('[data-save]', modal());
  const confirmYes = () => click('[data-ok]', modal());
  const check = (c, m) => { if (!c) throw new Error(m); };
  const fresh = () => { invalidateCache(); return db(); };
  const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } finally { while ($('.modal')) { $$('.modal-backdrop').forEach(m => m.remove()); } } };
  const search = async q => { const i = $('[data-dt-search]'); i.value = q; i.dispatchEvent(new Event('input')); await W(60); };
  const navText = () => $$('.nav a > span:not(.nav-count)').map(x => x.textContent);
  const denied = () => /Page not available|Not available/.test($('#main').innerText);

  resetDemoData(); await as('u-admin');

  /* ---------------- coordinator: catalogue ---------------- */
  await step('Programs: create, edit, delete', async () => {
    await go('#/programs'); await click('[data-add]'); fill('name', 'QA Program'); fill('type', 'workshop'); await save();
    const p = fresh().programs.find(x => x.name === 'QA Program'); check(p, 'not created');
    await click(`[data-edit="${p.id}"]`); fill('name', 'QA Program 2'); await save(); check(fresh().programs.some(x => x.name === 'QA Program 2'), 'not edited');
    await click(`[data-del="${p.id}"]`); await confirmYes(); check(!fresh().programs.some(x => x.id === p.id), 'not deleted');
  });
  await step('Divisions: create/delete + delete blocked when in use', async () => {
    await go('#/divisions'); await click('[data-add]'); fill('name', 'QA Division'); await save();
    const d = fresh().divisions.find(x => x.name === 'QA Division'); check(d, 'not created');
    await click(`[data-del="${d.id}"]`); await confirmYes(); check(!fresh().divisions.some(x => x.id === d.id), 'not deleted');
    await click('[data-del="DIV-IT"]'); check(fresh().divisions.some(x => x.id === 'DIV-IT'), 'in-use division was deleted');
  });
  await step('Batches: create, delete', async () => {
    await go('#/batches'); await click('[data-add]'); fill('name', 'QA Batch'); fill('courseId', 'C-EXCEL'); await save();
    const b = fresh().batches.find(x => x.name === 'QA Batch'); check(b, 'not created');
    await click(`[data-del="${b.id}"]`); await confirmYes(); check(!findRecord('batches', b.id), 'not deleted');
  });
  let cid;
  await step('Courses: create, publish, edit details', async () => {
    await go('#/manage/courses?new=1'); fill('title', 'QA Course'); fill('startDate', '2026-11-01'); fill('endDate', '2026-12-01');
    modal().querySelector('[data-multi="instructorIds"] input[value="u-faraz"]').checked = true; await save(); await W(150);
    cid = location.hash.split('/')[3].split('?')[0]; const c = findRecord('courses', cid); check(c?.title === 'QA Course', 'not created');
    check(c.instructorIds.includes('u-faraz'), 'instructor not assigned');
    await click('[data-toggle-pub]'); check(findRecord('courses', cid).status === 'published', 'not published');
    await click('[data-edit-course]'); fill('tagline', 'QA tagline'); fill('zoomMeetingId', '111 222'); await save(); check(findRecord('courses', cid).zoom.meetingId === '111 222', 'zoom not saved');
  });
  await step('Sessions: add with resource, edit, reorder, delete', async () => {
    await go(`#/manage/course/${cid}?tab=sessions`);
    for (const t of ['QA S1', 'QA S2']) {
      await click('[data-tab] [data-add]'); fill('title', t); fill('date', '2026-11-02'); fill('videoUrl', 'https://youtu.be/dQw4w9WgXcQ');
      modal().querySelector('[data-rtitle]').value = 'Guide'; modal().querySelector('[data-rurl]').value = 'https://example.com/guide'; await click('[data-radd]', modal()); await save();
    }
    let ss = Domain.courseSessions(cid, true); check(ss.length === 2 && ss[0].resources.length === 1, 'sessions/resources not saved');
    await click(`[data-edit="${ss[0].id}"]`); fill('title', 'QA S1 edited'); await save(); check(findRecord('sessions', ss[0].id).title === 'QA S1 edited', 'not edited');
    await click(`[data-move="${ss[0].id}:1"]`); check(Domain.courseSessions(cid, true)[1].id === ss[0].id, 'not reordered');
    await click(`[data-del="${ss[1].id}"]`); await confirmYes(); check(Domain.courseSessions(cid, true).length === 1, 'not deleted');
  });
  await step('Assignments: create, edit', async () => {
    await go(`#/manage/course/${cid}?tab=assignments`); await click('[data-tab] [data-add]');
    fill('title', 'QA Assignment'); fill('sessionId', Domain.courseSessions(cid, true)[0].id); fill('dueAt', '2026-12-30T23:59'); fill('maxMarks', '10'); await save();
    const a = fresh().assignments.find(x => x.title === 'QA Assignment'); check(a?.courseId === cid, 'not created');
    await click(`[data-edit="${a.id}"]`); fill('maxMarks', '15'); await save(); check(findRecord('assignments', a.id).maxMarks === 15, 'not edited');
  });
  await step('Enrollments: restricted enroll, duplicate blocked, edit, remove', async () => {
    await go('#/enrollments'); await click('[data-add]'); fill('learnerId', 'u-zara'); fill('courseId', cid); fill('accessMode', 'restricted');
    modal().querySelector('[data-multi="allowedSessionIds"] input').checked = true; await save();
    const e = Domain.enrollment('u-zara', cid); check(e?.accessMode === 'restricted' && e.allowedSessionIds.length === 1, 'not enrolled');
    await click('[data-add]'); fill('learnerId', 'u-zara'); fill('courseId', cid); await save(); check(modal(), 'duplicate allowed'); $$('.modal-backdrop').forEach(m => m.remove());
    await click(`[data-ed="${e.id}"]`); fill('accessMode', 'full'); await save(); check(findRecord('enrollments', e.id).accessMode === 'full', 'not edited');
    await click(`[data-del="${e.id}"]`); await confirmYes(); check(!findRecord('enrollments', e.id), 'not removed');
  });
  await step('Courses: delete cascades', async () => {
    await go('#/manage/courses'); await click(`[data-del="${cid}"]`); await confirmYes();
    const d = fresh(); check(!findRecord('courses', cid) && !d.sessions.some(s => s.courseId === cid) && !d.assignments.some(a => a.courseId === cid), 'cascade failed');
  });

  /* ---------------- roles & users ---------------- */
  let roleId, uid2;
  await step('Roles: create custom role with selected courses + permission matrix', async () => {
    await go('#/roles'); await click('[data-add]'); fill('name', 'QA Auditor'); fill('base', 'admin'); fill('courseScope', 'selected');
    modal().querySelector('[data-multi="courseIds"] input[value="C-TABLEAU"]').checked = true;
    for (const [m, a] of [['submissions', 'view'], ['reports', 'view'], ['courses', 'view'], ['dashboard', 'view']]) modal().querySelector(`[data-m="${m}"][data-a="${a}"]`).checked = true;
    await save(); const r = fresh().roles.find(x => x.name === 'QA Auditor'); check(r && r.courseScope === 'selected' && r.permissions.submissions?.includes('view'), 'role not saved'); roleId = r.id;
  });
  await step('Users: create staff user with custom role', async () => {
    await go('#/users'); await click('[data-add]'); fill('name', 'QA Auditor User'); fill('email', 'qa.auditor@example.com'); fill('role', roleId); fill('password', 'Secret123'); await save();
    const u = fresh().users.find(x => x.email === 'qa.auditor@example.com'); check(u?.role === roleId && verifyPassword(u, 'Secret123'), 'user not created'); uid2 = u.id;
  });
  await step('Custom role: menu, course scope and read-only actions enforced', async () => {
    await as(uid2); const nav = navText();
    check(nav.includes('Submissions') && nav.includes('Reports') && !nav.includes('Settings') && !nav.includes('Fees'), 'nav wrong: ' + nav);
    check(Domain.visibleCourses(App.user).map(c => c.id).join() === 'C-TABLEAU', 'course scope wrong');
    await go('#/submissions'); check(!$('[data-g]') && $$('#main tbody tr').every(tr => /Tableau/.test(tr.innerText) || tr.classList.contains('tr-empty')), 'grade buttons visible or out-of-scope rows');
    await go('#/settings'); check(denied(), 'settings reachable'); await go('#/manage/course/C-TABLEAU'); check(denied(), 'builder reachable without edit');
  });
  await step('Roles: grant grading → Grade buttons appear', async () => {
    await as('u-admin'); await go('#/roles'); await click(`[data-ed="${roleId}"]`); modal().querySelector('[data-m="submissions"][data-a="edit"]').checked = true; await save();
    await as(uid2); await go('#/submissions'); check($('[data-g]'), 'grade button missing after grant');
  });
  await step('Roles: delete blocked while assigned, then users & role deleted', async () => {
    await as('u-admin'); await go('#/roles'); await click(`[data-del="${roleId}"]`); check(findRecord('roles', roleId), 'deleted while assigned');
    await go('#/users'); await search('qa.auditor'); await click(`[data-del="${uid2}"]`); await confirmYes(); check(!findRecord('users', uid2), 'user not deleted');
    await go('#/roles'); await click(`[data-del="${roleId}"]`); await confirmYes(); check(!findRecord('roles', roleId), 'role not deleted');
  });
  await step('Roles: built-in admin is locked; duplicate role works', async () => {
    await go('#/roles'); await click('[data-ed="admin"]'); check(modal().querySelectorAll('.perm-box:not(:disabled)').length === 0, 'admin matrix editable'); $$('.modal-backdrop').forEach(m => m.remove());
    await click('[data-dup="teacher"]'); await save(); const r = fresh().roles.find(x => x.name === 'Instructor (copy)'); check(r?.permissions.courses?.includes('edit'), 'duplicate failed');
    await click(`[data-del="${r.id}"]`); await confirmYes();
  });
  await step('Learners: create, edit status, own-role change blocked', async () => {
    await go('#/learners'); await click('[data-add]'); fill('name', 'QA Learner'); fill('email', 'qa.learner@example.com'); fill('password', 'Secret123'); await save();
    const u = fresh().users.find(x => x.email === 'qa.learner@example.com'); check(u?.role === 'student', 'not created');
    await search('qa.learner'); await click(`[data-edit="${u.id}"]`); fill('status', 'Inactive'); await save(); check(findRecord('users', u.id).status === 'Inactive', 'not edited');
    check(login('qa.learner@example.com', 'Secret123').ok === false, 'inactive user could sign in'); await as('u-admin');
    await go('#/users'); await click('[data-edit="u-admin"]'); check(modal().querySelector('[name=role]').disabled, 'own role editable'); $$('.modal-backdrop').forEach(m => m.remove());
  });

  /* ---------------- coordinator: operations ---------------- */
  await step('Fees: create, mark paid, delete', async () => {
    await go('#/fees'); await click('[data-add]'); fill('learnerId', 'u-ali'); fill('amount', '1234'); await save();
    const f = fresh().fees.find(x => x.amount === 1234); check(f, 'not created');
    await click(`[data-edit="${f.id}"]`); fill('status', 'Paid'); await save(); check(findRecord('fees', f.id).paidOn, 'paid date not set');
    await click(`[data-del="${f.id}"]`); await confirmYes(); check(!findRecord('fees', f.id), 'not deleted');
  });
  await step('Announcements: publish with notifications, edit, delete', async () => {
    await go('#/announcements'); await click('[data-add]'); fill('title', 'QA Notice'); fill('message', 'Hello all'); fill('audience', 'everyone'); await save();
    const a = fresh().announcements.find(x => x.title === 'QA Notice'); check(a, 'not created'); check(fresh().notifications.some(n => n.userId === 'u-ali' && n.title === 'QA Notice'), 'no notification');
    await click(`[data-ed="${a.id}"]`); fill('title', 'QA Notice 2'); await save(); check(findRecord('announcements', a.id).title === 'QA Notice 2', 'not edited');
    await click(`[data-del="${a.id}"]`); await confirmYes(); check(!findRecord('announcements', a.id), 'not deleted');
  });
  await step('Certificates: issue, revoke, restore', async () => {
    await go('#/certificates'); await click('[data-issue]'); modal().querySelector('input[name=pick]').checked = true; await click('[data-ok]', modal());
    const c = fresh().certificates.find(x => x.code.endsWith('0002')); check(c?.status === 'Valid', 'not issued');
    await click(`[data-revoke="${c.id}"]`); await confirmYes(); check(findRecord('certificates', c.id).status === 'Revoked', 'not revoked');
    await click(`[data-restore="${c.id}"]`); check(findRecord('certificates', c.id).status === 'Valid', 'not restored');
  });
  await step('Settings: branding, features toggle, grade bands, defaults', async () => {
    await go('#/settings?tab=brand'); $('[data-pane] [name=productName]').value = 'QA Learn'; $('[data-pane] form').requestSubmit(); await W(250);
    check($('.brand b').textContent === 'QA Learn', 'brand not applied');
    await go('#/settings?tab=features'); $('[data-pane] [name=fees]').checked = false; $('[data-pane] form').requestSubmit(); await W(250);
    check(!navText().includes('Fees'), 'fees still in nav'); await go('#/fees'); check(denied(), 'fees page reachable');
    await go('#/settings?tab=learning'); $('[data-pane] [name=gradeBands]').value = 'A:85|B:60'; $('[data-pane] form').requestSubmit(); await W(250); check(Domain.gradeFor(70) === 'B', 'grade bands not applied');
    for (const tab of ['brand', 'features', 'learning']) { await go('#/settings?tab=' + tab); await click('[data-defaults]'); await confirmYes(); await W(150); }
    check(brand().productName === 'SDC Learn' && feature('fees') && Domain.gradeFor(85) === 'A', 'defaults not restored');
  });

  /* ---------------- instructor ---------------- */
  await step('Instructor: attendance marked and saved', async () => {
    await as('u-faraz'); await go('#/attendance'); await click('[data-all="Present"]'); await click('[data-roster] [data-save]');
    check(fresh().attendance.filter(a => a.markedBy === 'u-faraz').length >= 3, 'attendance not saved');
  });
  await step('Instructor: grade submission → learner notified', async () => {
    await go('#/submissions'); const b = $('[data-g]'); const id = b.dataset.g; await click(b); fill('grade', '15'); fill('feedback', 'Good'); await save();
    const s = findRecord('submissions', id); check(s.status === 'Graded' && s.grade === 15, 'not graded'); check(fresh().notifications.some(n => n.userId === s.learnerId && n.type === 'Grade'), 'no notification');
  });
  await step('Instructor: results computed and published', async () => {
    await go('#/results?course=C-EXCEL'); const tr = $('tr[data-l]'); tr.querySelector('[data-assess]').value = '80'; tr.querySelector('[data-pub]').checked = true; await click('[data-save]');
    const r = fresh().results.find(x => x.learnerId === tr.dataset.l && x.courseId === 'C-EXCEL'); check(r?.published && r.grade !== '—', 'result not saved');
  });
  await step('Instructor: course scope (own course builder yes, others no; no publish)', async () => {
    await go('#/manage/course/C-EXCEL'); check(!denied() && !$('[data-toggle-pub]'), 'builder/publish wrong'); await go('#/manage/course/C-TABLEAU'); check(denied(), 'other course reachable');
  });
  await step('Messages: instructor sends, learner reads and replies', async () => {
    await go('#/messages?to=u-ali'); fill('subject', 'QA ping'); fill('body', 'Hi'); await click('[data-send]', modal());
    await as('u-ali'); await go('#/messages'); const m = fresh().messages.find(x => x.subject === 'QA ping'); await click(`[data-open="${m.id}"]`); check(findRecord('messages', m.id).read, 'not marked read');
    await click('[data-reply]'); fill('body', 'Thanks'); await click('[data-send]', modal()); check(fresh().messages.some(x => x.subject === 'Re: QA ping' && x.to === 'u-faraz'), 'reply missing');
  });

  /* ---------------- learner ---------------- */
  await step('Learner: My Courses, locked session, mark complete', async () => {
    await go('#/courses'); check($$('.course-card').length === 4, 'course cards');
    await go('#/course/C-TABLEAU'); check($$('.session-row.locked').length === 1, 'locked session not shown');
    const before = Domain.progress('u-ali', 'C-EXCEL').percent; await go('#/course/C-EXCEL/session/S-EX-4'); await click('[data-complete]'); check(Domain.progress('u-ali', 'C-EXCEL').percent > before, 'progress unchanged');
  });
  await step('Learner: submit assignment with email check and file', async () => {
    await go('#/course/C-EXCEL/submit?assignment=A-EX-1'); $('#sub-e').value = 'wrong@x.com';
    const dt = new DataTransfer(); dt.items.add(new File(['a,b\n1,2'], 'qa.csv')); $('.dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await click('[data-submit]'); check(!Domain.submissionFor('A-EX-1', 'u-ali'), 'wrong email accepted');
    $('#sub-e').value = 'learner@sdclearn.demo'; await click('[data-submit]'); await W(800); check(Domain.submissionFor('A-EX-1', 'u-ali')?.status, 'not submitted');
  });
  await step('Learner: notifications, profile, password change', async () => {
    await go('#/notifications'); await click('[data-all]'); check(!fresh().notifications.some(n => n.userId === 'u-ali' && !n.read), 'unread remain');
    await go('#/profile'); $('[data-p] [name=phone]').value = '0300-0000000'; $('[data-p]').requestSubmit(); await W(200); check(findRecord('users', 'u-ali').phone === '0300-0000000', 'profile not saved');
    await go('#/profile'); const f = $('[data-pw]'); f.current.value = 'Demo@123'; f.next.value = 'NewPass123'; f.confirm.value = 'NewPass123'; f.requestSubmit(); await W(200); check(verifyPassword(findRecord('users', 'u-ali'), 'NewPass123'), 'password not changed');
  });
  await step('Learner: staff pages denied', async () => { for (const p of ['#/manage/courses', '#/roles', '#/settings', '#/submissions']) { await go(p); check(denied(), p + ' reachable'); } });

  /* ---------------- custom seeded role ---------------- */
  await step('Accounts Officer: fees CRUD allowed, learners read-only, courses denied', async () => {
    await as('u-accounts'); await go('#/fees'); check($('[data-add]'), 'cannot add fee'); await go('#/learners'); check(!$('[data-add]') && !$('[data-edit]'), 'learners editable');
    await go('#/manage/courses'); check(denied(), 'courses reachable');
  });

  resetDemoData(); window.SDCCloud?.syncNow?.(); await as('u-admin'); await go('#/dashboard');
  const failed = results.filter(r => r[0] === 'FAIL');
  console.table(results);
  return { passed: results.length - failed.length, failed };
})();
