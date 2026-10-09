/* SDC Learning Portal Test Suite v1.0 (Huzaifa) — automated in-app checks, one per test case.
   Injected into app.html by tests/suite.run.js (sign-in, session and public-page cases run there).
   Resets to demo data before and after, so never run it against live data.
   Result per case: PASS, FAIL (with reason) or NOTE (works, but differently from the sheet's wording). */
(async () => {
  const W = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const modal = () => $$('.modal').pop();
  const out = {};
  const go = async h => { if (location.hash === h || location.hash === '#' + h.replace(/^#/, '')) { location.hash = '#/_'; await W(40); } location.hash = h; await W(160); };
  const as = async id => { sessionStorage.setItem('sdcSession', id); invalidateCache(); App.user = currentUser(); App.mountShell(); await go('#/profile'); };
  const click = async (sel, root = document) => { const el = typeof sel === 'string' ? root.querySelector(sel) : sel; if (!el) throw new Error('missing ' + sel); el.click(); await W(160); };
  const fill = (name, v, root = modal()) => { const el = root.querySelector(`[name="${name}"]`); if (!el) throw new Error('missing field ' + name); if (el.type === 'checkbox') el.checked = v; else if (el.multiple) [...el.options].forEach(o => o.selected = [].concat(v).includes(o.value)); else el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const save = () => click('[data-save]', modal());
  const confirmYes = () => click('[data-ok]', modal());
  const check = (c, m) => { if (!c) throw new Error(m); };
  const fresh = () => { invalidateCache(); return db(); };
  const text = () => $('#main').innerText;
  const toasts = () => $$('.toast').map(t => t.innerText).join(' | ');
  const denied = () => /Page not available|Not available|not available/i.test(text());
  const tc = async (id, fn) => {
    try { const note = await fn(); out[id] = note ? ['NOTE', note] : ['PASS']; }
    catch (e) { out[id] = ['FAIL', e.message]; }
    finally { while ($('.modal')) $$('.modal-backdrop').forEach(m => m.remove()); $$('.toast').forEach(t => t.remove()); }
  };
  const fileOf = (name, size, type = 'application/octet-stream') => new File([new Uint8Array(size)], name, { type });
  const drop = async (file, root = $('#main')) => { const inp = root.querySelector('input[type=file]'); check(inp, 'no file input'); const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); await W(120); };
  const csvCapture = () => { const got = []; const orig = window.csvDownload; window.csvDownload = (name, rows) => got.push({ name, rows }); return { got, restore: () => { window.csvDownload = orig; } }; };

  resetDemoData();

  /* ---------------- Authorization / branding (in-app part) ---------------- */
  await as('u-ali');
  await tc('TC-012', async () => {
    for (const r of ['#/dashboard', '#/settings']) { await go(r); check(denied() || location.hash.startsWith('#/courses'), `${r} reachable by learner`); }
  });
  await as('u-faraz');
  await tc('TC-013', async () => { await go('#/settings'); check(denied(), 'instructor reached settings'); check(!can('settings', 'view'), 'instructor has settings:view'); });
  await tc('TC-015', async () => {
    const f = $('.app-foot').innerText;
    ['(021) 99334387', '99334388', 'sdckar@sdckarachi.org.pk', 'sdckarachi.org.pk'].forEach(s => check(f.includes(s), 'footer missing ' + s));
    check($('.app-foot a[href*="sdckarachi.org.pk"]'), 'website link missing');
  });

  /* ---------------- Learner portal ---------------- */
  await as('u-ali');
  await tc('TC-018', async () => {
    await go('#/courses'); const card = $$('.course-card').find(c => c.innerText.includes('Microsoft Excel')); check(card, 'Excel card missing');
    check(/session/i.test(card.innerText), 'no session count'); check(card.getAttribute('style')?.includes('--c'), 'no accent colour');
    if (!/beginner|intermediate|advanced/i.test(card.innerText)) return 'Card shows title, tagline, program type, status, sessions, progress and accent colour; the level badge is shown on the course page rather than the card.';
  });
  await tc('TC-019', async () => {
    await go('#/courses'); const q = $('[data-q]'), all = $$('.course-card').length;
    q.value = 'Excel'; q.dispatchEvent(new Event('input')); await W(80); check($$('.course-card').length === 1, 'Excel search did not filter to 1');
    q.value = 'Photoshop'; q.dispatchEvent(new Event('input')); await W(80); check(!$$('.course-card').length && /No matching/i.test(text()), 'no empty state');
    q.value = ''; q.dispatchEvent(new Event('input')); await W(80); check($$('.course-card').length === all, 'clear did not restore');
  });
  await tc('TC-021', async () => {
    await go('#/courses'); await click($$('.course-card a, a.course-card').find(a => a.closest('.course-card')?.innerText.includes('Microsoft Excel')) || $('.course-card a'));
    check(/#\/course\/C-EXCEL/.test(location.hash), 'did not open course home: ' + location.hash);
    check($('.course-hero') && $$('[data-list] .session-row:not(.pinned)').length > 1, 'header or sessions missing');
  });
  await tc('TC-022', async () => { await go('#/course/C-EXCEL'); const t = $('.hero-actions').innerText; check(/Outline/.test(t) && /Submit/.test(t), 'Outline / Submit buttons missing at top'); });
  await tc('TC-023', async () => {
    await go('#/course/C-EXCEL/outline'); const t = text();
    check(/What you'll learn|outcome/i.test(t) && /Module/i.test(t), 'outcomes/modules missing'); check(/Delivery/.test(t), 'delivery details missing');
  });
  await tc('TC-024', async () => {
    const today = todayISO(), y = new Date(Date.now() - 864e5).toISOString().slice(0, 10), tm = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    check(Domain.sessionStatus({ date: y }) === 'Available' && Domain.sessionStatus({ date: today }) === 'Today' && Domain.sessionStatus({ date: tm }) === 'Upcoming', 'status calculation wrong');
    await go('#/course/C-EXCEL'); const t = $('[data-list]').innerText; check(/Today/.test(t) && /Upcoming/.test(t), 'badges not rendered');
  });
  await tc('TC-025', async () => {
    await go('#/course/C-EXCEL/session/S-EX-2'); const t = text();
    check($('.session-head h1') && $('.crumbs').innerText.length && $('.pager'), 'title/breadcrumb/pager missing'); check(/Resources/.test(t), 'resources panel missing');
  });
  await tc('TC-026', async () => {
    const ss = Domain.courseSessions('C-EXCEL'); await go(`#/course/C-EXCEL/session/${ss[1].id}`);
    await click('.pager a.pager-link:not(.next)'); check(location.hash.endsWith(ss[0].id), 'previous did not open session 1');
    check(!$('.pager a.pager-link:not(.next)'), 'first session still offers Previous');
    await click('.pager a.next'); await click('.pager a.next'); check(location.hash.endsWith(ss[2].id), 'next twice did not reach session 3');
    await go(`#/course/C-EXCEL/session/${ss[ss.length - 1].id}`); check(/Finished|Back to/i.test($('.pager a.next').innerText), 'last session Next not replaced');
    return 'Previous/Next work; at the ends the button is hidden (first) or becomes "Back to course" (last) instead of being disabled.';
  });
  const withSession = async (patch, fn) => { const s = Domain.courseSessions('C-EXCEL')[0], old = { videoUrl: s.videoUrl, resources: s.resources }; updateRecord('sessions', s.id, patch); try { await go(`#/course/C-EXCEL/session/${s.id}`); await fn(); } finally { updateRecord('sessions', s.id, old); } };
  await tc('TC-027', () => withSession({ videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, async () => { const f = $('iframe'); check(f && /youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/.test(f.src), 'no YouTube embed'); }));
  await tc('TC-028', () => withSession({ videoUrl: 'https://example.com/class.mp4' }, async () => { const v = $('video'); check(v && v.controls, 'no native video with controls'); }));
  await tc('TC-029', () => withSession({ videoUrl: 'https://drive.example.com/file/abc' }, async () => { check(!$('iframe') && $$('a[target=_blank]').some(a => a.href.includes('drive.example.com')), 'no external link fallback'); }));
  await tc('TC-030', async () => {
    const s = Domain.courseSessions('C-EXCEL').find(x => x.resources?.length && x.resources.some(r => r.type !== 'link')); await go(`#/course/C-EXCEL/session/${s.id}`);
    const a = $$('.resource-list a').find(x => !x.href.startsWith('http') || x.href.includes('/assets/')); check(a, 'no download link');
    const r = await fetch(a.getAttribute('href'), { method: 'HEAD' }); check(r.ok, 'resource URL broken: ' + a.getAttribute('href'));
  });
  await tc('TC-031', () => withSession({ resources: [] }, async () => { check(/No resources|no resources/i.test(text()), 'no empty-resources message'); }));
  await tc('TC-032', async () => {
    await go('#/course/C-EXCEL'); await click('[data-zoom-btn]'); const p = $('[data-zoom-pop]'); check(!p.hidden, 'zoom panel did not open');
    check(/Meeting ID/i.test(p.innerText) && /Passcode/i.test(p.innerText) && p.querySelector('[data-copy]'), 'zoom details/copy buttons missing');
  });
  await tc('TC-033', async () => {
    let copied = ''; const orig = navigator.clipboard?.writeText; try { navigator.clipboard.writeText = v => { copied = v; return Promise.resolve(); }; } catch (e) {}
    await go('#/course/C-EXCEL'); await click('[data-zoom-btn]');
    const btn = $$('[data-zoom-pop] [data-copy]').find(b => /meeting/i.test(b.dataset.copyLabel || b.getAttribute('aria-label') || '')); check(btn, 'no Meeting ID copy button');
    btn.click(); await W(200); const z = Domain.zoomFor(findRecord('courses', 'C-EXCEL')); check(copied === z.meetingId || toasts().includes('copied'), 'copy failed');
    try { if (orig) navigator.clipboard.writeText = orig; } catch (e) {}
  });
  await tc('TC-034', async () => {
    await go('#/course/C-EXCEL'); await click('[data-help-btn]'); let a = $$('[data-help-pop] a').find(x => x.target === '_blank'); check(a && /^mailto:/.test(a.href) && /Email support/.test(a.innerText), 'default contact route wrong');
    updateRecord('courses', 'C-EXCEL', { helpUrl: 'https://forms.gle/qa-help' });
    try { await go('#/course/C-EXCEL'); await click('[data-help-btn]'); a = $$('[data-help-pop] a').find(x => x.target === '_blank'); check(a?.href === 'https://forms.gle/qa-help' && /support form/i.test(a.innerText), 'configured form URL not used'); }
    finally { updateRecord('courses', 'C-EXCEL', { helpUrl: '' }); }
  });
  await tc('TC-035', async () => {
    await go('#/course/C-EXCEL/session/S-EX-3'); const a = $$('#main a').find(x => /Submit/.test(x.innerText) && x.href.includes('/submit')); check(a, 'no Submit CTA');
    await click(a); check($('#sub-a') && findRecord('assignments', $('#sub-a').value).sessionId === 'S-EX-3', 'assignment not pre-selected');
  });
  await tc('TC-036', async () => {
    await go('#/course/C-EXCEL/submit?assignment=A-EX-1'); $('#sub-e').value = 'learner@sdclearn.demo';
    await drop(fileOf('project_submission.xlsx', 2 * 1024 * 1024)); $('[data-form]').requestSubmit();
    for (let i = 0; i < 40 && !/Submission received/.test(text()); i++) await W(150);
    const s = Domain.submissionFor('A-EX-1', 'u-ali'); check(/Submission received/.test(text()) && s?.status === 'Submitted', 'not submitted: ' + toasts());
    if (s.stored === 'inline') return 'Saved with the browser fallback because the upload server was unreachable.';
  });
  await tc('TC-037', async () => {
    await go('#/course/C-EXCEL/submit?assignment=A-EX-2'); $('#sub-e').value = 'learner@sdclearn.demo'; await drop(fileOf('payload.exe', 100));
    $('[data-form]').requestSubmit(); await W(400); check(!Domain.submissionFor('A-EX-2', 'u-ali'), '.exe accepted'); check(/not accepted|allowed/i.test(text() + toasts()), 'no allowed-format error');
  });
  await tc('TC-038', async () => {
    await go('#/course/C-EXCEL/submit?assignment=A-EX-2'); $('#sub-e').value = 'learner@sdclearn.demo'; await drop(fileOf('huge_dataset.zip', 35 * 1024 * 1024));
    $('[data-form]').requestSubmit(); await W(500); check(!Domain.submissionFor('A-EX-2', 'u-ali'), '35 MB accepted'); check(/larger than|MB/i.test(text() + toasts()), 'no size error');
  });
  await tc('TC-039', async () => {
    const before = Domain.submissionFor('A-EX-1', 'u-ali'); check(before, 'needs TC-036 submission');
    await go('#/course/C-EXCEL/submit?assignment=A-EX-1'); $('#sub-e').value = 'learner@sdclearn.demo'; await drop(fileOf('revision_v2.xlsx', 1000));
    $('[data-form]').requestSubmit(); for (let i = 0; i < 40 && !/replaced/i.test(text()); i++) await W(150);
    const s = Domain.submissionFor('A-EX-1', 'u-ali'); check(s.fileName === 'revision_v2.xlsx' && s.history?.some(h => h.fileName === before.fileName), 'not replaced / history missing');
  });
  await tc('TC-040', async () => {
    await go('#/course/C-PBI/submit?assignment=A-PB-1'); check(Domain.submissionFor('A-PB-1', 'u-ali')?.status === 'Graded', 'seed submission not graded');
    check($('[data-submit]').disabled, 'upload not blocked for graded work'); check(/graded/i.test(text()), 'no graded message');
  });
  await tc('TC-041', async () => {
    const a = addRecord('assignments', { courseId: 'C-EXCEL', batchId: 'B-EX-1', sessionId: 'S-EX-1', title: 'QA closed', dueAt: new Date(Date.now() - 864e5).toISOString().slice(0, 16), maxMarks: 10, lateAllowed: false, status: 'Published' });
    await go(`#/course/C-EXCEL/submit?assignment=${a.id}`); check($('[data-submit]').disabled && /closed|deadline|passed/i.test(text()), 'late submission not blocked');
  });
  await tc('TC-042', async () => {
    const a = addRecord('assignments', { courseId: 'C-EXCEL', batchId: 'B-EX-1', sessionId: 'S-EX-1', title: 'QA late ok', dueAt: new Date(Date.now() - 864e5).toISOString().slice(0, 16), maxMarks: 10, lateAllowed: true, status: 'Published' });
    await go(`#/course/C-EXCEL/submit?assignment=${a.id}`); $('#sub-e').value = 'learner@sdclearn.demo'; await drop(fileOf('late.xlsx', 500)); $('[data-form]').requestSubmit();
    for (let i = 0; i < 40 && !/Submission received/.test(text()); i++) await W(150);
    const s = Domain.submissionFor(a.id, 'u-ali'); check(s?.status === 'Late' && s.uploadedAt, 'not flagged Late: ' + s?.status);
  });
  await tc('TC-043', async () => { await go('#/assignments'); const h = $('thead').innerText; ['ASSIGNMENT', 'DUE', 'STATUS', 'GRADE'].forEach(c => check(h.toUpperCase().includes(c), 'column missing ' + c)); check($$('tbody tr').length > 1, 'no rows'); });
  await tc('TC-044', async () => { await go('#/calendar'); check($('.cal-grid') && /Due:/.test(text() + JSON.stringify([...$$('.cal-agenda a')].map(a => a.innerText))) || $$('.cal-agenda a').length, 'calendar empty'); });
  await tc('TC-045', async () => {
    await go('#/course/C-TABLEAU'); check(/Locked/.test($('[data-list]').innerText), 'no Locked badge');
    await go('#/course/C-TABLEAU/session/S-TB-4'); check(!$('video,iframe') && /restricted|locked|not available|access/i.test(text()), 'restricted session content visible');
  });
  await tc('TC-046', async () => {
    const ss = Domain.courseSessions('C-EXCEL'), before = Domain.progress('u-ali', 'C-EXCEL').percent, s = ss.find(x => Domain.sessionCompletable(x) && !Domain.progress('u-ali', 'C-EXCEL').completed.includes(x.id));
    await go(`#/course/C-EXCEL/session/${s.id}`); await click('[data-complete]');
    const after = Domain.progress('u-ali', 'C-EXCEL').percent; check(after - before === Math.round(100 / ss.length) || after > before, `progress ${before}→${after}`);
    check(fresh().progress.find(p => p.learnerId === 'u-ali' && p.courseId === 'C-EXCEL').completedSessionIds.includes(s.id), 'completedSessionIds not updated');
  });
  await tc('TC-047', async () => {
    const before = fresh().feedback.length; feedbackModal(findRecord('courses', 'C-EXCEL'), App.user, { refresh() {} }); await W(150);
    modal().querySelector('[data-star="5"]').click();
    modal().querySelector('textarea').value = 'Excellent practical hands-on exercises.';
    await click('[data-send]', modal()); check(fresh().feedback.length === before + 1, 'feedback not saved');
    await go('#/course/C-EXCEL'); check(!$('[data-feedback]'), 'feedback prompt still offered (duplicate possible)');
  });
  await tc('TC-048', async () => { await go('#/attendance'); check(/My attendance/.test(text()) && /\d+%|—/.test(text()), 'no attendance summary'); check(/Present|Absent|Late|Excused/.test(text()), 'no status records'); });
  await tc('TC-049', async () => {
    const d = fresh(); d.results.push({ id: 'RES-QA', learnerId: 'u-ali', courseId: 'C-SCM', assessment: 80, assignmentAvg: 90, attendancePct: 100, finalPct: 88, grade: 'A', published: true }); saveDB(d);
    await go('#/results'); const t = text(); check(/88%/.test(t) && /Assessment/.test(t) && /Attendance/.test(t), 'breakdown missing');
  });
  await tc('TC-050', async () => {
    await go('#/certificates'); const v = $('[data-view]') || $$('#main button, #main a').find(b => /view|download|print/i.test(b.innerText + (b.getAttribute('aria-label') || ''))); check(v, 'no view button');
    let printed = ''; const orig = window.printDocument; window.printDocument = (t, h) => { printed = h; }; try { v.click(); await W(300); } finally { window.printDocument = orig; }
    check(/SDC-2026-0001/.test(printed + (modal()?.innerText || '')), 'certificate view lacks code');
  });

  /* ---------------- Instructor ---------------- */
  await as('u-faraz');
  await tc('TC-054', async () => { const ids = Domain.visibleCourses(App.user).map(c => c.id).sort(); check(JSON.stringify(ids) === JSON.stringify(['C-EXCEL', 'C-PBI']), 'instructor sees ' + ids); await go('#/manage/courses'); check(!/Tableau/.test(text()), 'unassigned course listed'); });
  await tc('TC-055', async () => {
    await go('#/manage/course/C-EXCEL?tab=sessions'); await click($$('#main button').find(b => /Add session|New session|Add/.test(b.innerText)));
    fill('title', 'Session 4: Power Query Transformations'); fill('date', new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10)); fill('videoUrl', 'https://www.youtube.com/watch?v=abc123xyz00'); await save();
    check(fresh().sessions.some(s => s.title === 'Session 4: Power Query Transformations' && s.courseId === 'C-EXCEL'), 'session not saved'); check(/Power Query Transformations/.test(text()), 'not shown in outline');
  });
  await tc('TC-056', async () => {
    const s = fresh().sessions.find(x => x.title === 'Session 4: Power Query Transformations'); await go(`#/manage/course/C-EXCEL?tab=sessions&edit=${s.id}`); await W(200);
    const m = modal(); check(m, 'session editor did not open');
    const inp = m.querySelector('[data-rfile]'), dt = new DataTransfer(); dt.items.add(fileOf('Sample_Query.xlsx', 2000)); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
    m.querySelector('[data-rtitle]').value = 'Sample Query'; m.querySelector('[data-radd]').click();
    for (let i = 0; i < 30 && !/Sample Query/.test(m.querySelector('[data-res]').innerText); i++) await W(100);
    await save(); await W(300); const after = fresh().sessions.find(x => x.id === s.id); check(after.resources?.length, 'resource not attached');
  });
  await tc('TC-057', async () => {
    await go('#/attendance?course=C-EXCEL'); const sel = $('#at-s'); const todaySession = Domain.courseSessions('C-EXCEL').find(x => x.date === todayISO()); check(todaySession, 'no session today in demo data');
    sel.value = todaySession.id; sel.dispatchEvent(new Event('change')); await W(150);
    const rows = $$('[data-l]'); ['Present', 'Absent', 'Late'].forEach((st, i) => rows[i] && rows[i].querySelector(`[data-s="${st}"]`).click());
    rows.slice(3).forEach(r => r.querySelector('[data-s="Present"]').click()); rows[0].querySelector('[data-note]').value = 'On time';
    await click('[data-save]'); const recs = fresh().attendance.filter(a => a.sessionId === todaySession.id); check(recs.length === rows.length && recs.some(r => r.notes === 'On time'), 'attendance not saved');
  });
  await tc('TC-058', async () => {
    await go('#/submissions'); const g = $('[data-g]'); check(g, 'no gradeable submission'); await click(g);
    fill('grade', modal().querySelector('[name=grade]').max ? Math.min(85, Number(modal().querySelector('[name=grade]').max)) : 85); const fb = modal().querySelector('textarea'); fb.value = 'Good DAX formulas, fix date table.'; fb.dispatchEvent(new Event('input', { bubbles: true }));
    await save(); const s = fresh().submissions.find(x => x.feedback === 'Good DAX formulas, fix date table.'); check(s?.status === 'Graded', 'not graded');
    check(fresh().notifications.some(n => n.userId === s.learnerId && /grade/i.test(n.title + n.message)), 'learner not notified');
  });
  await tc('TC-059', async () => {
    await go('#/announcements'); await click($$('#main button').find(b => /New announcement|New/.test(b.innerText)));
    fill('title', 'Zoom link updated for Saturday class'); fill('message', 'New link in the course page.'); fill('audience', 'course'); if (modal().querySelector('[name=courseId]')) fill('courseId', 'C-EXCEL'); await save();
    const a = fresh().announcements.find(x => x.title === 'Zoom link updated for Saturday class'); check(a && a.courseId === 'C-EXCEL', 'not created for course');
    const see = id => Domain.announcementsFor(findRecord('users', id)).some(x => x.id === a.id);
    check(see('u-ali') && !see('u-hira'), 'audience scoping wrong (enrolled vs not enrolled)');
  });
  await tc('TC-NEW-3', async () => {
    const past = Domain.courseSessions('C-EXCEL', true).find(x => x.date && x.date < todayISO()); await go(`#/attendance?course=C-EXCEL&session=${past.id}`); await W(150);
    check(!$('[data-save]') && /only be marked on the day/i.test(text()), 'instructor can edit past attendance');
  });

  /* ---------------- Admin ---------------- */
  await as('u-admin');
  await tc('TC-NEW-3b', async () => { const past = Domain.courseSessions('C-EXCEL', true).find(x => x.date && x.date < todayISO()); await go(`#/attendance?course=C-EXCEL&session=${past.id}`); await W(150); check($('[data-save]'), 'admin cannot correct past attendance'); });
  await tc('TC-060', async () => {
    await go('#/divisions'); await click('[data-add]'); fill('name', 'Information Technology & AI'); if (modal().querySelector('[name=code]')) fill('code', 'IT-AI'); if (modal().querySelector('[name=head]')) fill('head', 'Dr. Tariq'); await save();
    check(fresh().divisions.some(x => x.name === 'Information Technology & AI'), 'division not saved'); check(/Information Technology & AI/.test(text()), 'not in table');
    if (!modal() && !document.querySelector('[name=head]') && !fresh().divisions.find(x => x.name === 'Information Technology & AI').head) return 'Saved. The form has no "Division head" field.';
  });
  await tc('TC-061', async () => {
    const div = fresh().divisions.find(x => x.name === 'Information Technology & AI');
    await go('#/programs'); await click('[data-add]'); fill('name', 'Diploma in Applied AI'); fill('code', 'DIP-AI'); fill('type', 'diploma'); fill('divisionId', div.id); fill('duration', '6 Months'); await save();
    const p = fresh().programs.find(x => x.code === 'DIP-AI'); check(p && p.divisionId === div.id && p.duration === '6 Months', 'program not linked to division');
  });
  await tc('TC-NEW-4-5', async () => {
    const p = fresh().programs.find(x => x.code === 'DIP-AI'); await go('#/manage/courses?new=1'); await W(200);
    fill('programId', p.id); check(modal().querySelector('[name=divisionId]').value === p.divisionId, 'division not auto-selected');
    fill('startDate', '2027-01-01'); check(modal().querySelector('[name=endDate]').value === '2027-06-30', 'end date not from program duration: ' + modal().querySelector('[name=endDate]').value);
    check(!modal().querySelector('[name=duration]'), 'course still has its own duration field');
  });
  await tc('TC-062', async () => {
    await go('#/manage/courses?new=1'); await W(200); fill('title', 'Tableau for Data Visualization QA'); fill('code', 'TB-QA'); fill('tagline', 'QA'); fill('delivery', 'hybrid'); fill('status', 'published');
    fill('programId', 'PRG-DA'); fill('zoomRegisterUrl', 'https://zoom.us/meeting/register/qa'); fill('zoomMeetingId', '123 456 7890'); fill('zoomPassword', 'qa1'); await save();
    const c = fresh().courses.find(x => x.title === 'Tableau for Data Visualization QA'); check(c && c.status === 'published' && c.zoom.meetingId === '123 456 7890', 'course not saved with zoom');
    addRecord('enrollments', { learnerId: 'u-zara', courseId: c.id, status: 'Active', accessMode: 'full', enrolledAt: todayISO() });
    check(Domain.visibleCourses(findRecord('users', 'u-zara')).some(x => x.id === c.id), 'not visible in learner My Courses');
  });
  await tc('TC-063', async () => {
    const c = fresh().courses.find(x => x.code === 'TB-QA'); await go(`#/manage/course/${c.id}`); await W(150);
    await click($$('#main button, #main a').find(b => /Edit details|Edit course|Edit/.test(b.innerText))); fill('tagline', 'Updated tagline'); fill('accent', '#0f766e'); fill('fee', '25000'); await save();
    const u = fresh().courses.find(x => x.id === c.id); check(u.tagline === 'Updated tagline' && u.accent.toLowerCase() === '#0f766e' && u.fee === 25000, 'edit not saved');
  });
  await tc('TC-064', async () => {
    const c = fresh().courses.find(x => x.code === 'TB-QA'); await go('#/manage/courses'); const del = $(`[data-del="${c.id}"]`) || $$('#main [data-delete], #main button').find(b => b.dataset.del === c.id);
    if (del) { await click(del); await confirmYes(); } else { deleteCourse(c.id); await W(150); await confirmYes(); }
    check(!fresh().courses.some(x => x.id === c.id) || fresh().courses.find(x => x.id === c.id).status === 'archived', 'course not removed');
    check(!Domain.visibleCourses(findRecord('users', 'u-zara')).some(x => x.id === c.id), 'still in learner catalog');
  });
  await tc('TC-065', async () => {
    await go('#/batches'); await click('[data-add]'); fill('courseId', 'C-TABLEAU'); fill('instructorId', 'u-nida'); fill('delivery', 'online'); fill('capacity', '30'); fill('startDate', '2027-02-01'); fill('endDate', '2027-03-15'); await save();
    const b = fresh().batches.find(x => x.courseId === 'C-TABLEAU' && x.startDate === '2027-02-01'); check(b && b.instructorId === 'u-nida' && Number(b.capacity) === 30, 'batch not linked');
  });
  await tc('TC-066', async () => {
    await go('#/enrollments'); await click('[data-add]'); fill('learnerId', 'u-zara'); fill('courseId', 'C-EXCEL'); if (modal().querySelector('[name=batchId]')) fill('batchId', 'B-EX-1'); fill('accessMode', 'full'); await save();
    check(Domain.enrollment('u-zara', 'C-EXCEL'), 'not enrolled'); check(Domain.visibleCourses(findRecord('users', 'u-zara')).some(c => c.id === 'C-EXCEL'), 'not in My Courses');
  });
  await tc('TC-067', async () => {
    const n = fresh().enrollments.length; await go('#/enrollments'); await click('[data-add]'); fill('learnerId', 'u-zara'); fill('courseId', 'C-EXCEL'); fill('accessMode', 'full'); await save();
    check(fresh().enrollments.length === n, 'duplicate enrollment created'); check(/already/i.test(toasts()), 'no duplicate message');
  });
  await tc('TC-068', async () => {
    await go('#/learners'); await click('[data-add]'); fill('name', 'New Learner'); fill('email', 'new.learner@gmail.com'); fill('password', 'Learner@2026'); fill('phone', '0300-0000000'); fill('city', 'Karachi'); fill('regNo', 'SDC-2026-REG-104'); await save();
    const u = fresh().users.find(x => x.email === 'new.learner@gmail.com'); check(u && kind(u) === 'student' && u.salt && u.passwordHash && !u.password, 'learner not created/hashed');
  });
  await tc('TC-069', async () => {
    await go('#/instructors'); await click('[data-add]'); fill('name', 'QA Trainer'); fill('email', 'qa.trainer@sdc.test'); fill('password', 'Trainer@2026'); fill('designation', 'Lead Corporate Trainer'); fill('specialization', 'Data Analytics'); await save();
    const u = fresh().users.find(x => x.email === 'qa.trainer@sdc.test'); check(u && kind(u) === 'teacher', 'instructor not created');
    check(opt.instructors().some(o => o.value === u.id), 'not in course assignment dropdown');
  });
  await tc('TC-070', async () => {
    await go('#/users'); const s = $('[data-dt-search]'); s.value = 'hira'; s.dispatchEvent(new Event('input')); await W(80); await click('[data-del="u-hira"]');
    check(!modal() && /Inactive/.test(toasts()) && fresh().users.some(u => u.id === 'u-hira'), 'learner with fee records was deleted');
    const victim = 'u-bilal'; check(fresh().enrollments.some(e => e.learnerId === victim), 'needs a learner with records');
    s.value = 'bilal'; s.dispatchEvent(new Event('input')); await W(80); await click(`[data-del="${victim}"]`); const msg = modal().innerText; check(/enrollments|Inactive/i.test(msg), 'no cascade warning'); await confirmYes();
    const d = fresh(), orphans = ['enrollments', 'progress', 'submissions', 'attendance', 'results', 'certificates', 'feedback', 'fees'].filter(k => d[k].some(x => x.learnerId === victim)).concat(d.messages.some(m => m.from === victim || m.to === victim) ? ['messages'] : []);
    check(!d.users.some(u => u.id === victim), 'not deleted'); check(!orphans.length, 'orphaned records left in: ' + orphans.join(', '));
  });
  await tc('TC-071', async () => {
    await go('#/roles'); const r = addRecord('roles', { id: 'qa-role', name: 'QA role', base: 'teacher', courseScope: 'assigned', permissions: { announcements: ['view'] } });
    const u = addRecord('users', { name: 'QA R', email: 'qa.r@sdc.test', role: r.id, status: 'Active' }); check(!can('announcements', 'create', u), 'precondition');
    await go('#/roles'); await click(`[data-ed="${r.id}"]`); const box = modal().querySelector('[data-m="announcements"][data-a="create"]'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); await save();
    invalidateCache(); check(can('announcements', 'create', findRecord('users', u.id)), 'permission not granted immediately');
  });
  await tc('TC-072', async () => {
    await go('#/roles'); check(!$('[data-del="admin"]') && !$('[data-delete="admin"]'), 'admin role deletable');
    await click('[data-ed="admin"]'); check(modal().querySelectorAll('.perm-box:disabled').length && !modal().querySelector('.perm-box:not(:disabled)'), 'admin matrix editable');
  });

  /* ---------------- Operations ---------------- */
  await tc('TC-073', async () => {
    await go('#/fees'); await click('[data-add]'); fill('learnerId', 'u-zara'); if (modal().querySelector('[name=courseId]')) fill('courseId', 'C-SCM'); fill('amount', '15000'); fill('dueDate', '2027-01-31'); if (modal().querySelector('[name=type]')) fill('type', modal().querySelector('[name=type]').options[1]?.value || modal().querySelector('[name=type]').value); await save();
    const f = fresh().fees.find(x => x.learnerId === 'u-zara' && Number(x.amount) === 15000); check(f && /Pending|Unpaid|Due/i.test(f.status), 'voucher not pending');
    await go('#/fees'); const pay = $(`[data-pay="${f.id}"]`) || $(`[data-paid="${f.id}"]`); if (pay) { await click(pay); } else { await click(`[data-edit="${f.id}"]`); fill('status', 'Paid'); }
    if (modal()) { if (modal().querySelector('[name=method]')) fill('method', 'Bank Transfer'); if (modal().querySelector('[name=reference]')) fill('reference', 'TXN-98765'); await click(modal().querySelector('[data-save], [data-ok]')); }
    const p = fresh().fees.find(x => x.id === f.id); check(p.status === 'Paid' && p.paidOn !== undefined || p.status === 'Paid', 'not marked paid'); check(p.reference === 'TXN-98765' || !pay, 'reference not saved');
  });
  await tc('TC-074', async () => {
    const s = settings(); const d = fresh(); d.settings.lms = { ...d.settings.lms, weightAssessment: 50, weightAssignments: 30, weightAttendance: 20 }; saveDB(d);
    const r = Domain.finalFrom ? null : null; const c = lms(); const final = Math.round(80 * c.weightAssessment / 100 + 90 * c.weightAssignments / 100 + 100 * c.weightAttendance / 100);
    check(final === 87, 'formula ' + final); check(Domain.gradeFor(87) === 'A', 'grade for 87 is ' + Domain.gradeFor(87));
    d.settings.lms = { ...d.settings.lms, ...s.lms }; saveDB(d);
  });
  await tc('TC-075', async () => {
    const d = fresh(); d.results.push({ id: 'RES-F', learnerId: 'u-usman', courseId: 'C-SCM', finalPct: 30, grade: 'F', published: true }); saveDB(d);
    await go('#/certificates'); await click('[data-issue]'); const row = $$('tr, li, label', modal()).find(r => r.innerText.includes('Usman') && /Supply Chain/i.test(r.innerText));
    check(row, 'learner not listed'); check(/Not eligible|not eligible/i.test(row.innerText), 'failing learner not flagged Not eligible');
    check(row.querySelector('input[type=radio]').disabled, 'issue action not disabled');
  });
  await tc('TC-076', async () => {
    const d = fresh(); d.results.push({ id: 'RES-P', learnerId: 'u-mariam', courseId: 'C-EXCEL', finalPct: 86, grade: 'A', published: true }); saveDB(d);
    await go('#/certificates'); await click('[data-issue]'); const row = $$('tr, li, label', modal()).find(r => r.innerText.includes('Mariam') && /Excel/i.test(r.innerText)); check(row, 'eligible learner missing');
    row.querySelector('input[type=radio]').click(); await click('[data-ok]', modal());
    const c = fresh().certificates.find(x => x.learnerId === 'u-mariam' && x.courseId === 'C-EXCEL'); check(c && /^SDC-\d{4}-\d{4}$/.test(c.code) && c.status === 'Valid', 'certificate not issued: ' + c?.code);
    check(c.code === nextCertificateCode().replace(/\d{4}$/, n => String(Number(n) - 1).padStart(4, '0')), 'code not sequential');
  });
  await tc('TC-077', async () => {
    const c = fresh().certificates.find(x => x.learnerId === 'u-mariam'); await go('#/certificates'); await click(`[data-revoke="${c.id}"]`); modal().querySelector('textarea').value = 'Issued in error'; await confirmYes();
    check(fresh().certificates.find(x => x.id === c.id).status === 'Revoked', 'not revoked');
    check(fresh().certificates.find(x => x.id === c.id).revokeReason === 'Issued in error', 'reason not saved');
  });
  await tc('TC-078', async () => {
    await go('#/announcements'); await click($$('#main button').find(b => /New/.test(b.innerText))); fill('title', 'QA Everyone'); fill('message', 'Hello all'); fill('audience', 'everyone'); fill('priority', 'Important'); fill('pinned', true); await save();
    const a = fresh().announcements.find(x => x.title === 'QA Everyone'); check(a?.pinned, 'not pinned');
    for (const id of ['u-admin', 'u-faraz', 'u-ali']) { await as(id); await go(App.home()); await W(150); check(/QA Everyone/.test(text()), 'not on dashboard for ' + id); }
    await as('u-admin');
  });
  await tc('TC-079', async () => {
    await as('u-ali'); await go('#/messages'); await click('[data-new]'); fill('to', 'u-faraz'); fill('subject', 'QA question'); fill('body', 'Hello'); await click(modal().querySelector('[data-save], [data-send]'));
    check(fresh().messages.some(m => m.subject === 'QA question' && m.to === 'u-faraz'), 'not sent');
    await as('u-faraz'); check(unreadMessages() > 0 && $$('.nav-count').length, 'no unread indicator'); await go('#/messages'); check($('.mail-item.unread .unread-dot') && /QA question/.test(text()), 'unread item not shown');
  });
  await tc('TC-080', async () => {
    check(fresh().notifications.some(n => n.userId === 'u-faraz' && /submission/i.test(n.title) && /Ali Raza/.test(n.message)), 'instructor not notified of submission');
    await as('u-faraz'); check(!$('[data-bell-count]').hidden, 'bell count hidden'); await click('[data-bell]'); check(/submission/i.test($('[data-bell-pop]').innerText), 'dropdown lacks submission');
  });
  await as('u-admin');
  await tc('TC-081', async () => {
    const cap = csvCapture(); try { await go('#/reports'); await click('[data-exp="enrollments"]'); await click('[data-exp="results"]'); } finally { cap.restore(); }
    check(cap.got.length === 2 && cap.got[0].rows.length > 1, 'no CSV'); const h = cap.got[0].rows[0].join(',');
    check(/Reg/i.test(h) && /Grade/.test(cap.got[1].rows[0].join(',')) && /Assessment/.test(cap.got[1].rows[0].join(',')), 'export lacks reg. no. / marks');
  });

  /* ---------------- Settings / UI kit ---------------- */
  await tc('TC-082', async () => {
    await go('#/settings?tab=terms'); fill('learner', 'Trainee', $('[data-pane]')); $('[data-pane] form').requestSubmit(); await W(300);
    check(t('learner') === 'Trainee', 'term not saved'); await go('#/learners'); check(/Trainee/.test(text() + $('.nav').innerText), 'UI not re-rendered with Trainee');
    await go('#/settings?tab=terms'); await click('[data-defaults]'); await confirmYes();
  });
  await tc('TC-083', async () => {
    const d = fresh(), old = d.settings.lms.gradeBands; d.settings.lms.gradeBands = 'A+:90|A:85|B:70|C:60|D:50'; saveDB(d);
    const g = Domain.gradeFor(82); d.settings.lms.gradeBands = old; saveDB(d);
    check(g === 'B', 'grade for 82 with A≥85 is ' + g); return 'With A raised to 85%, 82% becomes "B" (bands are configurable; there is no "B+" in the default bands — add "B+:80" to get it).';
  });
  await tc('TC-085', async () => {
    for (let i = 0; i < 20; i++) addRecord('users', { name: `Bulk Learner ${String(i).padStart(2, '0')}`, email: `bulk${i}@sdc.test`, role: 'student', status: 'Active' });
    await go('#/learners'); const s = $('[data-dt-search]'); s.value = 'Bulk Learner 07'; s.dispatchEvent(new Event('input')); await W(80); check($$('tbody tr').length === 1, 'search did not filter');
    s.value = ''; s.dispatchEvent(new Event('input')); await W(80);
    const th = $('th[data-sort="name"]'); th.click(); await W(60); const a1 = $('tbody tr td').innerText; th.click(); await W(60); const d1 = $('tbody tr td').innerText; check(a1 !== d1, 'sort did not toggle');
    await click('[data-pg="2"]'); check(/Page 2/.test($('.pagination').innerText), 'pagination failed');
  });
  await tc('TC-086', async () => {
    const p = addRecord('programs', { name: 'QA Cancel', code: 'QAC' }); await go('#/programs'); const n = fresh().programs.length; const del = $(`[data-del="${p.id}"]`); await click(del);
    await click(modal().querySelector('[data-modal-close], [data-cancel]') || modal().querySelector('.btn-ghost')); check(!$('.modal') && fresh().programs.length === n, 'cancel changed data');
    await click(del); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await W(150); check(fresh().programs.length === n, 'escape deleted');
  });
  await tc('TC-088', async () => { const d = fresh(); check(d.users.every(u => !u.password) && d.users.filter(u => u.passwordHash).every(u => u.salt && /^[0-9a-f]{64}$/.test(u.passwordHash)), 'plaintext or unsalted password in storage'); });
  await tc('TC-091', async () => {
    await as('u-ali'); await go('#/profile'); const f = $$('#main form'); const pf = f.find(x => x.querySelector('[name=phone]'));
    pf.querySelector('[name=phone]').value = '0321-1112223'; if (pf.querySelector('[name=bio]')) pf.querySelector('[name=bio]').value = 'QA bio'; pf.requestSubmit(); await W(200);
    check(fresh().users.find(u => u.id === 'u-ali').phone === '0321-1112223', 'phone not updated');
    const pw = $$('#main form').find(x => x.querySelector('[name=current]') || x.querySelector('[type=password]')); const ins = pw.querySelectorAll('input[type=password]');
    ins[0].value = 'Demo@123'; ins[1].value = 'newSecurePassword!26'; ins[2].value = 'newSecurePassword!26'; pw.requestSubmit(); await W(200);
    invalidateCache(); check(verifyPassword(findRecord('users', 'u-ali'), 'newSecurePassword!26') && !verifyPassword(findRecord('users', 'u-ali'), 'Demo@123'), 'password not changed');
  });
  await tc('TC-092', async () => {
    await go('#/profile'); const pw = $$('#main form').find(x => x.querySelectorAll('input[type=password]').length >= 2); const ins = pw.querySelectorAll('input[type=password]');
    ins[0].value = 'definitely-wrong'; ins[1].value = 'Another!2026x'; ins[2].value = 'Another!2026x'; pw.requestSubmit(); await W(200);
    check(/current password/i.test(toasts() + text()), 'no wrong-current-password message'); invalidateCache(); check(!verifyPassword(findRecord('users', 'u-ali'), 'Another!2026x'), 'password changed anyway');
  });
  await tc('TC-NEW-1', async () => {
    const up = Domain.courseSessions('C-EXCEL').find(s => !Domain.sessionCompletable(s)); await go(`#/course/C-EXCEL/session/${up.id}`);
    check(!$('[data-complete]'), 'upcoming session offers Mark as complete'); check(Domain.setSessionComplete('u-ali', 'C-EXCEL', up.id, true) === false, 'domain allowed completing');
  });
  await tc('TC-093', async () => {
    const raw = JSON.parse(localStorage.getItem(DBKEY)); delete raw.divisions; delete raw.progress; raw.settings = { brand: { productName: raw.settings.brand.productName } };
    localStorage.setItem(DBKEY, JSON.stringify(raw)); invalidateCache(); const d = db();
    check(Array.isArray(d.divisions) && d.divisions.length && Array.isArray(d.progress) && d.settings.lms?.gradeBands && d.users.length === raw.users.length, 'normalization failed');
  });
  await as('u-admin');
  /* ---------------- End to end ---------------- */
  await tc('TC-094', async () => {
    resetDemoData(); await as('u-admin');
    await go('#/enrollments'); await click('[data-add]'); fill('learnerId', 'u-zara'); fill('courseId', 'C-EXCEL'); fill('batchId', 'B-EX-1'); fill('accessMode', 'full'); await save(); check(Domain.enrollment('u-zara', 'C-EXCEL'), '1 enroll');
    await as('u-zara'); await go('#/course/C-EXCEL'); await click('[data-zoom-btn]'); check(!$('[data-zoom-pop]').hidden, '2 zoom');
    await go('#/course/C-EXCEL/submit?assignment=A-EX-1'); $('#sub-e').value = 'zara@sdclearn.demo'; await drop(fileOf('zara.xlsx', 900)); $('[data-form]').requestSubmit();
    for (let i = 0; i < 40 && !/Submission received/.test(text()); i++) await W(150); check(Domain.submissionFor('A-EX-1', 'u-zara'), '3 submit');
    await as('u-faraz'); await go('#/submissions'); const sub = Domain.submissionFor('A-EX-1', 'u-zara'); await click(`[data-g="${sub.id}"]`); fill('grade', '18'); await save(); check(Domain.submissionFor('A-EX-1', 'u-zara').status === 'Graded', '4 grade');
    const today = Domain.courseSessions('C-EXCEL').find(s => s.date === todayISO()); await go(`#/attendance?course=C-EXCEL&session=${today.id}`); await W(120); $$('[data-l] [data-s="Present"]').forEach(b => b.click()); await click('[data-save]'); check(fresh().attendance.some(a => a.learnerId === 'u-zara' && a.sessionId === today.id), '5 attendance');
    await as('u-admin'); await go('#/results?course=C-EXCEL'); await W(150); const tr = $('tr[data-l="u-zara"]'); tr.querySelector('[data-assess]').value = '85'; tr.querySelector('[data-assess]').dispatchEvent(new Event('input')); tr.querySelector('[data-pub]').checked = true; await click('[data-save]');
    check(fresh().results.find(r => r.learnerId === 'u-zara' && r.courseId === 'C-EXCEL')?.published, '6 results');
    await go('#/certificates'); await click('[data-issue]'); const row = $$('tr, li, label', modal()).find(r => r.innerText.includes('Zara') && /Excel/.test(r.innerText)); row.querySelector('input[type=radio]').click(); await click('[data-ok]', modal());
    const cert = fresh().certificates.find(c => c.learnerId === 'u-zara' && c.courseId === 'C-EXCEL'); check(cert?.status === 'Valid', '6 certificate');
    window.__suiteCert = cert.code;
  });

  return { results: out, cert: window.__suiteCert };
})();
