/* SDC Learn — learner course delivery: My Courses, course home, sessions, outline,
   assignment submission, assignments overview and the training calendar. */

/* ----------------------------------------------------------- shared bits */
function courseAccess(user, courseId) {
  const course = findRecord('courses', courseId) || db().courses.find(c => c.slug === courseId);
  if (!course) return { error: `This ${t('course', true)} could not be found.` };
  if (kind(user) !== 'student') return Domain.visibleCourses(user).some(c => c.id === course.id) ? { course } : { error: `This ${t('course', true)} is outside your role's course access.` };
  const enrollment = Domain.enrollment(user.id, course.id);
  if (!enrollment) return { error: `You are not enrolled in this ${t('course', true)}.` };
  if (course.status !== 'published') return { error: `This ${t('course', true)} is not open yet.` };
  return { course, enrollment };
}
function deniedPage(ctx, message) {
  ctx.setCrumbs([{ label: t('courses'), href: '#/courses' }, { label: 'Unavailable' }]);
  ctx.root.innerHTML = emptyState('Not available', message, 'lock', `<a class="btn btn-primary" href="#${App.home()}">Back</a>`);
}
function courseCrumbs(ctx, course, extra = []) {
  const first = kind(ctx.user) === 'student' ? { label: `My ${t('courses')}`, href: '#/courses' } : { label: t('courses'), href: '#/manage/courses' };
  ctx.setCrumbs([first, { label: course.title, href: `#/course/${course.id}` }, ...extra]);
}
function courseTools(ctx, course, session) {
  const zoom = Domain.zoomFor(course, session), help = Domain.helpUrlFor(course), b = brand();
  ctx.setTools(`
    <div class="pop-wrap"><button class="btn btn-ghost btn-sm" data-help-btn>${icon('help', 16)}<span class="hide-sm">Help</span></button>
      <div class="popover popover-panel" data-help-pop hidden>
        <div class="pop-head"><b>Need help?</b><small>Our support team usually replies within one working day.</small></div>
        <div class="pad stack-sm">
          <a class="btn btn-primary btn-block" href="${esc(help)}" target="_blank" rel="noopener">${icon('external', 16)} Open support form</a>
          <a class="mini-link" href="tel:${esc(b.phone.split(',')[0].replace(/[^\d+]/g, ''))}">${icon('phone', 14)} ${esc(b.phone)}</a>
          <a class="mini-link" href="mailto:${esc(b.email)}">${icon('mail', 14)} ${esc(b.email)}</a>
        </div>
      </div></div>
    <div class="pop-wrap"><button class="btn btn-ghost btn-sm" data-zoom-btn>${icon('video', 16)}<span class="hide-sm">Zoom</span></button>
      <div class="popover popover-panel" data-zoom-pop hidden>${zoomPanel(zoom, course)}</div></div>`, el => {
    App.popover('[data-help-btn]', '[data-help-pop]');
    App.popover('[data-zoom-btn]', '[data-zoom-pop]');
    bindCopyButtons(el);
  });
}
function zoomPanel(zoom, course) {
  if (!zoom) return `<div class="pop-head"><b>Live class</b><small>${course.delivery === 'onsite' ? `This ${t('course', true)} is delivered onsite${course.venue ? ' at ' + esc(course.venue) : ''}.` : 'Zoom details have not been published yet.'}</small></div>`;
  return `<div class="pop-head"><b>Join the live class</b><small>${esc(course.schedule || 'Use the details below to join on Zoom.')}</small></div>
    <div class="pad stack-sm">
      ${zoom.registerUrl ? `<a class="btn btn-primary btn-block" href="${esc(zoom.registerUrl)}" target="_blank" rel="noopener">${icon('video', 16)} Register / Join meeting</a>` : ''}
      ${zoom.meetingId ? copyRow('Meeting ID', zoom.meetingId) : ''}
      ${zoom.password ? copyRow('Passcode', zoom.password) : ''}
      ${zoom.registerUrl ? copyRow('Link', zoom.registerUrl, true) : ''}
    </div>`;
}
function copyRow(label, value, truncate) {
  return `<div class="copy-row"><span class="muted small">${esc(label)}</span><code class="${truncate ? 'truncate' : ''}">${esc(value)}</code><button class="icon-btn icon-btn-sm" data-copy="${esc(value)}" data-copy-label="${esc(label)}" aria-label="Copy ${esc(label)}">${icon('copy', 15)}</button></div>`;
}
function bindCopyButtons(scope) { scope.querySelectorAll('[data-copy]').forEach(b => b.onclick = e => { e.stopPropagation(); copyText(b.dataset.copy, `${b.dataset.copyLabel || 'Value'} copied`); }); }

function videoEmbed(url) {
  if (!url) return null;
  let m;
  if ((m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/))) return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0` };
  if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return { type: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
  if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/))) return { type: 'iframe', src: `https://drive.google.com/file/d/${m[1]}/preview` };
  if (/\.(mp4|webm|ogv|mov)(\?|#|$)/i.test(url) || url.startsWith('data:video') || url.startsWith('/uploads/')) return { type: 'video', src: url };
  return { type: 'link', src: url };
}
function videoBlock(session, unlocked) {
  if (!unlocked) return `<div class="video-frame video-empty">${icon('lock', 28)}<b>This ${t('session', true)} is locked</b><span>Contact your coordinator for access.</span></div>`;
  const v = videoEmbed(session.videoUrl);
  if (!v) {
    const st = Domain.sessionStatus(session);
    return `<div class="video-frame video-empty">${icon('video', 28)}<b>${st === 'Upcoming' || st === 'Today' ? 'Recording will appear after the live class' : 'No recording for this ' + t('session', true)}</b><span>${st === 'Today' ? 'This class is live today — use the Zoom button above to join.' : st === 'Upcoming' ? `Scheduled for ${fmtDate(session.date)}${session.time ? ' at ' + fmtTime(session.time) : ''}.` : 'Check the resources for materials.'}</span></div>`;
  }
  if (v.type === 'iframe') return `<div class="video-frame"><iframe src="${esc(v.src)}" title="${esc(session.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
  if (v.type === 'video') return `<div class="video-frame"><video controls preload="metadata" src="${esc(v.src)}"></video></div>`;
  return `<div class="video-frame video-empty">${icon('external', 28)}<b>Recording hosted externally</b><a class="btn btn-primary btn-sm" href="${esc(v.src)}" target="_blank" rel="noopener">Open recording</a></div>`;
}
function resourceList(resources, unlocked) {
  if (!unlocked) return `<p class="muted small">Resources unlock with the ${t('session', true)}.</p>`;
  if (!resources?.length) return emptyState('No resources yet', 'Materials will appear here when your instructor shares them.', 'file');
  return `<ul class="resource-list">${resources.map(r => {
    const isLink = r.type === 'link';
    return `<li><span class="res-icon">${icon(fileIcon(r.type), 16)}</span><div class="grow"><b>${esc(r.title)}</b><small class="muted">${isLink ? 'External link' : `${esc(String(r.type || fileExt(r.url)).toUpperCase())}${r.size ? ' · ' + fmtSize(r.size) : ''}`}</small></div><a class="btn btn-ghost btn-sm" href="${esc(r.url)}" ${isLink ? 'target="_blank" rel="noopener"' : `download="${esc(r.fileName || r.title)}"`}>${icon(isLink ? 'external' : 'download', 16)}<span class="hide-sm">${isLink ? 'Open' : 'Download'}</span></a></li>`;
  }).join('')}</ul>`;
}
function sessionStatusFor(user, session, enrollment, progress) {
  if (kind(user) === 'student' && !Domain.sessionUnlocked(session, enrollment)) return 'Locked';
  if (progress?.completed?.includes(session.id)) return 'Completed';
  return Domain.sessionStatus(session);
}
function learnerCourseState(course, enrollment) {
  const today = todayISO();
  if (enrollment?.status === 'Completed' || (course.endDate && course.endDate < today)) return 'Completed';
  if (course.startDate && course.startDate > today) return 'Upcoming';
  return 'In progress';
}

/* ------------------------------------------------------------ My Courses */
App.route('/courses', { perm: 'learn', base: 'student', render(ctx) {
  const u = ctx.user;
  ctx.setCrumbs([{ label: `My ${t('courses')}` }]);
  const enrollments = Domain.learnerEnrollments(u.id);
  const list = enrollments.map(e => ({ e, c: findRecord('courses', e.courseId) })).filter(x => x.c && x.c.status === 'published');
  const today = todayISO();
  const upcoming = list.flatMap(({ c, e }) => Domain.courseSessions(c.id).filter(s => s.date >= today && Domain.sessionUnlocked(s, e)).slice(0, 1).map(s => ({ s, c }))).sort((a, b) => (a.s.date + a.s.time).localeCompare(b.s.date + b.s.time))[0];
  const pending = list.flatMap(({ c }) => Domain.courseAssignments(c.id).filter(a => Domain.assignmentState(a, u.id).status === 'Pending'));
  const hour = new Date().getHours();
  ctx.root.innerHTML = `
    ${pageHead(`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${u.name.split(' ')[0]}`, `You're enrolled in ${list.length} ${list.length === 1 ? t('course', true) : t('courses', true)}.`)}
    ${(upcoming || pending.length) ? `<div class="up-next">
      ${upcoming ? `<a class="up-card" href="#/course/${upcoming.c.id}/session/${upcoming.s.id}"><span class="up-icon ${upcoming.s.date === today ? 'live' : ''}">${icon(upcoming.s.date === today ? 'video' : 'calendar', 18)}</span><div><small>${upcoming.s.date === today ? 'Live today' : 'Next ' + t('session', true)} · ${esc(fmtDate(upcoming.s.date, { weekday: 'short', day: 'numeric', month: 'short' }))}${upcoming.s.time ? ' · ' + fmtTime(upcoming.s.time) : ''}</small><b>${esc(upcoming.s.title)}</b><span class="muted small">${esc(upcoming.c.title)}</span></div>${icon('chevronRight', 18)}</a>` : ''}
      ${pending.length ? `<a class="up-card" href="#/assignments"><span class="up-icon warn">${icon('clipboard', 18)}</span><div><small>Due soon</small><b>${pending.length} pending ${pending.length === 1 ? t('assignment', true) : t('assignments', true)}</b><span class="muted small">Next: ${esc(pending.sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))[0].title)}</span></div>${icon('chevronRight', 18)}</a>` : ''}
    </div>` : ''}
    <div class="toolbar">
      <label class="search-box grow">${icon('search', 16)}<input type="search" placeholder="Search your ${t('courses', true)}…" data-q aria-label="Search courses"></label>
      <div class="chips" role="tablist">${['All', 'In progress', 'Upcoming', 'Completed'].map((f, i) => `<button class="chip ${i ? '' : 'active'}" data-filter="${f}" role="tab">${f}</button>`).join('')}</div>
    </div>
    <div class="course-grid" data-grid></div>`;
  let filter = 'All', q = '';
  const draw = () => {
    const rows = list.filter(({ c, e }) => (filter === 'All' || learnerCourseState(c, e) === filter) && (!q || `${c.title} ${c.tagline} ${c.code}`.toLowerCase().includes(q)));
    ctx.root.querySelector('[data-grid]').innerHTML = rows.length ? rows.map(({ c, e }) => courseCard(c, e, u)).join('') :
      `<div class="span-all">${list.length ? emptyState(`No matching ${t('courses', true)}`, 'Try another search or filter.', 'search') : emptyState(`No ${t('courses', true)} yet`, `Once you are enrolled, your ${t('courses', true)} will appear here. Contact ${brand().orgShort} to enroll.`, 'book', `<a class="btn btn-primary" href="mailto:${esc(brand().email)}">Contact ${esc(brand().orgShort)}</a>`)}</div>`;
  };
  ctx.root.querySelector('[data-q]').oninput = e => { q = e.target.value.toLowerCase(); draw(); };
  ctx.root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; ctx.root.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  draw();
} });

function courseCard(c, e, u) {
  const sessions = Domain.courseSessions(c.id), prog = Domain.progress(u.id, c.id), state = learnerCourseState(c, e), next = Domain.nextSession(c.id);
  return `<a class="course-card" href="#/course/${c.id}" style="--c:${esc(c.accent || 'var(--brand)')}">
    <div class="cc-top"><span class="cc-icon">${icon(c.icon || 'book', 20)}</span><span class="cc-tags">${badge(pairLabel(lms().programTypes, c.programType), 'neutral')}${badge(state, state === 'In progress' ? 'accent' : state === 'Upcoming' ? 'info' : 'success')}</span></div>
    <h3>${esc(c.title)}</h3>
    <p class="cc-tagline">${esc(c.tagline || '')}</p>
    <div class="cc-meta"><span>${icon('layers', 14)} ${sessions.length} ${t('sessions', true)}</span><span>${icon('target', 14)} ${esc(c.level || '—')}</span><span>${icon('map', 14)} ${esc(pairLabel(lms().deliveryModes, c.delivery))}</span></div>
    <div class="cc-progress">${progressBar(prog.percent, 'Course progress')}<span class="small muted">${prog.percent}% complete</span></div>
    <div class="cc-foot small">${next ? `${icon('calendar', 14)} Next: ${esc(fmtDate(next.date, { weekday: 'short', day: 'numeric', month: 'short' }))}` : state === 'Completed' ? `${icon('award', 14)} Completed` : `${icon('check', 14)} All ${t('sessions', true)} delivered`}${e?.accessMode === 'restricted' ? ` · ${icon('lock', 13)} Restricted access` : ''}</div>
  </a>`;
}

/* ----------------------------------------------------------- Course home */
App.route('/course/:id', { perm: ['learn', 'courses'], render(ctx) {
  const { course, enrollment, error } = courseAccess(ctx.user, ctx.params.id);
  if (error) return deniedPage(ctx, error);
  const u = ctx.user, isLearner = kind(u) === 'student';
  courseCrumbs(ctx, course);
  courseTools(ctx, course);
  const sessions = Domain.courseSessions(course.id), prog = isLearner ? Domain.progress(u.id, course.id) : null;
  const assignments = Domain.courseAssignments(course.id);
  const instructors = (course.instructorIds || []).map(id => findRecord('users', id)).filter(Boolean);
  const resumeId = prog?.lastSessionId && sessions.some(s => s.id === prog.lastSessionId) ? prog.lastSessionId : (sessions.find(s => !prog?.completed.includes(s.id) && Domain.sessionUnlocked(s, enrollment)) || sessions[0])?.id;
  const next = Domain.nextSession(course.id);
  const anns = Domain.announcementsFor(u).filter(a => a.audience === 'course' && a.courseId === course.id).slice(0, 2);
  const pendingCount = isLearner ? assignments.filter(a => ['Pending', 'Missing'].includes(Domain.assignmentState(a, u.id).status)).length : 0;
  const showFeedback = isLearner && feature('feedback') && prog.percent >= Number(lms().feedbackAtPercent) && !db().feedback.some(f => f.learnerId === u.id && f.courseId === course.id);

  ctx.root.innerHTML = `
    <section class="course-hero" style="--c:${esc(course.accent || 'var(--brand)')}">
      <div class="hero-main">
        <div class="hero-tags"><span class="code">${esc(course.code || '')}</span>${badge(pairLabel(lms().programTypes, course.programType), 'neutral')}${badge(pairLabel(lms().deliveryModes, course.delivery), 'info')}${course.status !== 'published' ? badge('Draft') : ''}</div>
        <h1>${esc(course.title)}</h1>
        <p class="lead">${esc(course.tagline || '')}</p>
        <div class="hero-meta">
          ${course.startDate ? `<span>${icon('calendar', 15)} ${fmtDate(course.startDate, { day: 'numeric', month: 'short' })} – ${fmtDate(course.endDate)}</span>` : ''}
          ${course.schedule ? `<span>${icon('clock', 15)} ${esc(course.schedule)}</span>` : ''}
          ${instructors.length ? `<span>${icon('user', 15)} ${esc(instructors.map(i => i.name).join(', '))}</span>` : ''}
          <span>${icon('layers', 15)} ${sessions.length} ${t('sessions', true)}</span>
        </div>
        <div class="hero-actions">
          ${resumeId ? `<a class="btn btn-primary" href="#/course/${course.id}/session/${resumeId}">${icon('play', 16)} ${isLearner && prog.completed.length ? 'Continue learning' : 'Start ' + t('course', true)}</a>` : ''}
          <a class="btn btn-secondary" href="#/course/${course.id}/outline">${icon('map', 16)} Outline</a>
          ${isLearner && assignments.length ? `<a class="btn btn-secondary" href="#/course/${course.id}/submit">${icon('upload', 16)} Submit ${t('assignment', true)}</a>` : ''}
          ${!isLearner && Domain.canManageCourse(u, course) ? `<a class="btn btn-secondary" href="#/manage/course/${course.id}">${icon('edit', 16)} Manage</a>` : ''}
        </div>
      </div>
      ${isLearner ? `<div class="hero-progress"><div class="ring" style="--p:${prog.percent}"><span>${prog.percent}%</span></div><small>${prog.completed.length} of ${sessions.length} ${t('sessions', true)} completed</small></div>` : ''}
    </section>

    <div class="layout-aside">
      <div class="stack">
        <div class="row-between"><h2 class="section-title">${t('sessions')}</h2><label class="search-box search-sm">${icon('search', 15)}<input type="search" placeholder="Filter ${t('sessions', true)}…" data-q aria-label="Filter sessions"></label></div>
        <div class="session-list" data-list>
          <a class="session-row pinned" href="#/course/${course.id}/outline"><span class="s-num">${icon('map', 16)}</span><div class="s-body"><b>Course Outline</b><small>Learning outcomes, modules and the full roadmap.</small></div>${badge('Outline')}</a>
          ${isLearner && assignments.length ? `<a class="session-row pinned" href="#/course/${course.id}/submit"><span class="s-num">${icon('upload', 16)}</span><div class="s-body"><b>Submit ${t('assignment')}</b><small>${pendingCount ? `${pendingCount} pending · upload or replace your work.` : 'Upload or replace your work.'}</small></div>${badge('Submit')}</a>` : ''}
          ${sessionGroups(sessions, s => sessionRow(course, s, sessionStatusFor(u, s, enrollment, prog), sessions.indexOf(s) + 1))}
          ${sessions.length ? '' : emptyState(`No ${t('sessions', true)} yet`, `${t('sessions')} will appear here once they are scheduled.`, 'calendar')}
        </div>
      </div>
      <aside class="stack">
        ${next ? `<div class="card"><div class="card-head"><h3>${next.date === todayISO() ? 'Live today' : 'Next live class'}</h3>${badge(next.date === todayISO() ? 'Today' : 'Upcoming')}</div><p class="strong">${esc(next.title)}</p><p class="muted small">${fmtDate(next.date, { weekday: 'long', day: 'numeric', month: 'long' })}${next.time ? ' · ' + fmtTime(next.time) : ''}${next.duration ? ' · ' + esc(next.duration) : ''}</p>${(() => { const z = Domain.zoomFor(course, next); return z?.registerUrl ? `<a class="btn btn-primary btn-block" href="${esc(z.registerUrl)}" target="_blank" rel="noopener">${icon('video', 16)} Join on Zoom</a>` : course.venue ? `<p class="small">${icon('map', 14)} ${esc(course.venue)}</p>` : ''; })()}</div>` : ''}
        ${assignments.length ? `<div class="card"><div class="card-head"><h3>${t('assignments')}</h3></div><ul class="mini-list">${assignments.map(a => { const st = isLearner ? Domain.assignmentState(a, u.id) : null; return `<li><div class="grow"><b>${esc(a.title)}</b><small class="muted block">Due ${fmtDateTime(a.dueAt)}</small></div>${isLearner ? badge(st.status) : `<small class="muted">${db().submissions.filter(s => s.assignmentId === a.id).length} subm.</small>`}</li>`; }).join('')}</ul>${isLearner ? `<a class="btn btn-ghost btn-sm btn-block" href="#/course/${course.id}/submit">Go to submission</a>` : ''}</div>` : ''}
        ${anns.length ? `<div class="card"><div class="card-head"><h3>Announcements</h3></div>${anns.map(a => `<div class="ann-mini"><b>${esc(a.title)}</b><p class="small muted">${esc(a.message)}</p></div>`).join('')}</div>` : ''}
        ${showFeedback ? `<div class="card card-highlight"><h3>How is the ${t('course', true)} going?</h3><p class="small muted">You're ${prog.percent}% through. Share quick feedback with ${esc(brand().orgShort)}.</p><button class="btn btn-secondary btn-sm" data-feedback>${icon('star', 15)} Share feedback</button></div>` : ''}
        ${instructors.map(i => `<div class="card person-card">${avatar(i, 44)}<div><b>${esc(i.name)}</b><small class="muted">${esc(i.designation || t('instructor'))}</small>${feature('messages') && isLearner ? `<a class="mini-link" href="#/messages?to=${i.id}">${icon('mail', 14)} Message</a>` : ''}</div></div>`).join('')}
      </aside>
    </div>`;
  const input = ctx.root.querySelector('[data-q]');
  input.oninput = () => { const q = input.value.toLowerCase(); ctx.root.querySelectorAll('[data-list] .session-row:not(.pinned)').forEach(r => r.hidden = q && !r.textContent.toLowerCase().includes(q)); ctx.root.querySelectorAll('[data-list] .module-head').forEach(h => { let n = h.nextElementSibling, any = false; while (n && !n.classList.contains('module-head')) { if (n.classList.contains('session-row') && !n.hidden) any = true; n = n.nextElementSibling; } h.hidden = !any; }); };
  ctx.root.querySelector('[data-feedback]')?.addEventListener('click', () => feedbackModal(course, u, ctx));
} });

function sessionGroups(sessions, rowFn) {
  let last = null;
  return sessions.map(s => { const head = s.moduleName && s.moduleName !== last ? `<div class="module-head">${esc(s.moduleName)}</div>` : ''; last = s.moduleName; return head + rowFn(s); }).join('');
}
function sessionRow(course, s, status, n) {
  const locked = status === 'Locked', done = status === 'Completed';
  return `<a class="session-row ${locked ? 'locked' : ''} ${status === 'Today' ? 'is-today' : ''}" href="#/course/${course.id}/session/${s.id}">
    <span class="s-num ${done ? 'done' : ''}">${done ? icon('check', 15) : locked ? icon('lock', 14) : n}</span>
    <div class="s-body"><b>${esc(s.title)}</b>${s.summary ? `<small>${esc(s.summary)}</small>` : ''}<span class="s-meta">${s.date ? `${icon('calendar', 13)} ${fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}${s.time ? ` · ${fmtTime(s.time)}` : ''}${s.duration ? ` · ${esc(s.duration)}` : ''}${s.videoUrl ? ` · ${icon('play', 12)} Recording` : ''}${s.resources?.length ? ` · ${icon('file', 12)} ${s.resources.length}` : ''}</span></div>
    ${badge(status)}
  </a>`;
}
function feedbackModal(course, u, ctx) {
  let rating = 0;
  const m = openModal({ title: 'Course feedback', body: `<form data-fb><p class="muted small">Your feedback helps ${esc(brand().orgShort)} improve every batch.</p><div class="stars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star', 26)}</button>`).join('')}</div><div class="field full"><label class="label" for="fbc">Comments</label><textarea id="fbc" class="input" rows="4" name="comment" placeholder="What is working well? What could be better?"></textarea></div><label class="check"><input type="checkbox" name="publish"><span>You may share my comment as a testimonial</span></label></form>`, footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-send>Submit feedback</button>` });
  m.querySelectorAll('[data-star]').forEach(b => b.onclick = () => { rating = Number(b.dataset.star); m.querySelectorAll('[data-star]').forEach(x => x.classList.toggle('on', Number(x.dataset.star) <= rating)); });
  m.querySelector('[data-send]').onclick = () => {
    if (!rating) return toast('Please choose a rating.', 'warning');
    const f = m.querySelector('[data-fb]');
    addRecord('feedback', { learnerId: u.id, courseId: course.id, rating, comment: f.comment.value.trim(), publish: f.publish.checked, date: todayISO() });
    m.close(); toast('Thank you for your feedback!'); ctx.refresh();
  };
}

/* --------------------------------------------------------- Session page */
App.route('/course/:id/session/:sid', { perm: ['learn', 'courses'], render(ctx) {
  const { course, enrollment, error } = courseAccess(ctx.user, ctx.params.id);
  if (error) return deniedPage(ctx, error);
  const u = ctx.user, isLearner = kind(u) === 'student';
  const sessions = Domain.courseSessions(course.id, !isLearner), i = sessions.findIndex(s => s.id === ctx.params.sid), s = sessions[i];
  if (!s) return deniedPage(ctx, `This ${t('session', true)} is not available.`);
  const unlocked = !isLearner || Domain.sessionUnlocked(s, enrollment);
  courseCrumbs(ctx, course, [{ label: `${t('session')} ${i + 1}` }]);
  courseTools(ctx, course, s);
  if (isLearner && unlocked) Domain.touchSession(u.id, course.id, s.id);
  const prog = isLearner ? Domain.progress(u.id, course.id) : null, done = prog?.completed.includes(s.id);
  const status = sessionStatusFor(u, s, enrollment, prog);
  const assignment = db().assignments.find(a => a.sessionId === s.id && a.status !== 'Draft');
  const ast = assignment && isLearner ? Domain.assignmentState(assignment, u.id) : null;
  const prev = sessions[i - 1], next = sessions[i + 1];
  const zoom = Domain.zoomFor(course, s);
  ctx.root.innerHTML = `
    <div class="session-head">
      <div><span class="eyebrow">${t('session')} ${i + 1}${s.moduleName ? ' · ' + esc(s.moduleName) : ''}</span><h1>${esc(s.title)}</h1>
      <div class="hero-meta">${s.date ? `<span>${icon('calendar', 15)} ${fmtDate(s.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>` : ''}${s.time ? `<span>${icon('clock', 15)} ${fmtTime(s.time)}${s.duration ? ' · ' + esc(s.duration) : ''}</span>` : ''}${s.delivery || course.delivery ? `<span>${icon('map', 15)} ${esc(pairLabel(lms().deliveryModes, s.delivery || course.delivery))}</span>` : ''}${badge(status)}</div></div>
      ${!isLearner && Domain.canManageCourse(u, course) ? `<a class="btn btn-secondary btn-sm" href="#/manage/course/${course.id}?tab=sessions&edit=${s.id}">${icon('edit', 15)} Edit ${t('session', true)}</a>` : ''}
    </div>
    <div class="layout-aside">
      <div class="stack">
        ${videoBlock(s, unlocked)}
        ${unlocked && s.summary ? `<div class="card"><h3>About this ${t('session', true)}</h3><p>${esc(s.summary)}</p></div>` : ''}

      </div>
      <aside class="stack">
        ${isLearner && unlocked ? `<button class="btn ${done ? 'btn-secondary' : 'btn-primary'} btn-block" data-complete>${icon(done ? 'check' : 'checkSquare', 16)} ${done ? 'Completed — undo' : 'Mark as complete'}</button>` : ''}
        <div class="card"><div class="card-head"><h3>Resources</h3>${unlocked && s.resources?.length ? `<span class="muted small">${s.resources.length}</span>` : ''}</div>${resourceList(s.resources, unlocked)}</div>
        ${assignment ? `<div class="card"><div class="card-head"><h3>${t('assignment')}</h3>${ast ? badge(ast.status) : ''}</div><p class="strong">${esc(assignment.title)}</p><p class="small muted">${esc(assignment.description || '')}</p><p class="small">${icon('clock', 14)} Due ${fmtDateTime(assignment.dueAt)} · ${assignment.maxMarks} marks</p>${ast?.submission?.status === 'Graded' ? `<p class="small"><b>Grade:</b> ${ast.submission.grade}/${assignment.maxMarks}</p>` : ''}${isLearner ? `<a class="btn btn-primary btn-sm btn-block" href="#/course/${course.id}/submit?assignment=${assignment.id}">${icon('upload', 15)} ${ast?.submission ? 'View / replace submission' : 'Submit ' + t('assignment', true)}</a>` : `<a class="btn btn-ghost btn-sm btn-block" href="#/submissions?assignment=${assignment.id}">View submissions</a>`}</div>` : ''}
        ${zoom && (status === 'Today' || status === 'Upcoming') ? `<div class="card"><div class="card-head"><h3>Live class</h3></div>${zoomPanel(zoom, course).replace(/pop-head/g, 'card-sub')}</div>` : ''}
      </aside>
    </div>
    <nav class="pager mt" aria-label="Session navigation">
      ${prev ? `<a class="pager-link" href="#/course/${course.id}/session/${prev.id}">${icon('chevronLeft', 18)}<span><small>Previous</small><b>${esc(prev.title)}</b></span></a>` : '<span></span>'}
      ${next ? `<a class="pager-link next" href="#/course/${course.id}/session/${next.id}"><span><small>Next</small><b>${esc(next.title)}</b></span>${icon('chevronRight', 18)}</a>` : `<a class="pager-link next" href="#/course/${course.id}"><span><small>Finished</small><b>Back to ${t('course', true)}</b></span>${icon('chevronRight', 18)}</a>`}
    </nav>`;
  bindCopyButtons(ctx.root);
  ctx.root.querySelector('[data-complete]')?.addEventListener('click', () => {
    Domain.setSessionComplete(u.id, course.id, s.id, !done);
    toast(done ? `${t('session')} marked as not complete.` : `Nice work! ${t('session')} completed.`);
    if (!done && next && Domain.sessionUnlocked(next, enrollment)) location.hash = `#/course/${course.id}/session/${next.id}`; else ctx.refresh();
  });
} });

/* -------------------------------------------------------------- Outline */
App.route('/course/:id/outline', { perm: ['learn', 'courses'], render(ctx) {
  const { course, enrollment, error } = courseAccess(ctx.user, ctx.params.id);
  if (error) return deniedPage(ctx, error);
  courseCrumbs(ctx, course, [{ label: 'Outline' }]);
  courseTools(ctx, course);
  const u = ctx.user, sessions = Domain.courseSessions(course.id), prog = kind(u) === 'student' ? Domain.progress(u.id, course.id) : null;
  const modules = (course.modules?.length ? course.modules : [...new Set(sessions.map(s => s.moduleName || 'Sessions'))].map(name => ({ name, summary: '' })));
  const extra = [...new Set(sessions.map(s => s.moduleName || 'Sessions'))].filter(n => !modules.some(m => m.name === n)).map(name => ({ name, summary: '' }));
  const instructors = (course.instructorIds || []).map(id => findRecord('users', id)).filter(Boolean);
  ctx.root.innerHTML = `
    ${pageHead('Course Outline', esc(course.title), `<button class="btn btn-ghost btn-sm" data-print>${icon('printer', 15)} Print</button>`)}
    <div class="layout-aside">
      <div class="stack" data-outline>
        <div class="card"><h3>Overview</h3><p>${esc(course.description || course.tagline || '')}</p></div>
        ${course.outcomes?.length ? `<div class="card"><h3>What you'll learn</h3><ul class="check-grid">${course.outcomes.map(o => `<li>${icon('check', 16)}<span>${esc(o)}</span></li>`).join('')}</ul></div>` : ''}
        <div class="card"><h3>Roadmap</h3><ol class="roadmap">${[...modules, ...extra].map((m, mi) => {
          const items = sessions.filter(s => (s.moduleName || 'Sessions') === m.name);
          return `<li class="road-module"><span class="road-dot">${mi + 1}</span><div><b>${esc(m.name)}</b>${m.summary ? `<p class="small muted">${esc(m.summary)}</p>` : ''}${items.length ? `<ul class="road-sessions">${items.map(s => { const st = sessionStatusFor(u, s, enrollment, prog); return `<li><a href="#/course/${course.id}/session/${s.id}"><span>${t('session')} ${sessions.indexOf(s) + 1}: ${esc(s.title)}</span><span class="muted small">${fmtDateShort(s.date)}</span></a>${badge(st)}</li>`; }).join('')}</ul>` : '<p class="small muted">Sessions to be scheduled.</p>'}</div></li>`;
        }).join('')}</ol></div>
      </div>
      <aside class="stack">
        <div class="card"><h3>At a glance</h3><dl class="facts">
          <div><dt>${t('program')}</dt><dd>${esc(findRecord('programs', course.programId)?.name || pairLabel(lms().programTypes, course.programType))}</dd></div>
          <div><dt>Level</dt><dd>${esc(course.level || '—')}</dd></div>
          <div><dt>Duration</dt><dd>${esc(course.duration || '—')}</dd></div>
          <div><dt>Schedule</dt><dd>${esc(course.schedule || '—')}</dd></div>
          <div><dt>Delivery</dt><dd>${esc(pairLabel(lms().deliveryModes, course.delivery))}${course.venue ? ' · ' + esc(course.venue) : ''}</dd></div>
          <div><dt>Dates</dt><dd>${fmtDate(course.startDate)} – ${fmtDate(course.endDate)}</dd></div>
          <div><dt>${t('sessions')}</dt><dd>${sessions.length}</dd></div>
        </dl></div>
        ${course.prerequisites ? `<div class="card"><h3>Prerequisites</h3><p class="small">${esc(course.prerequisites)}</p></div>` : ''}
        ${instructors.map(i => `<div class="card person-card">${avatar(i, 44)}<div><b>${esc(i.name)}</b><small class="muted">${esc(i.designation || '')}</small>${i.bio ? `<p class="small muted">${esc(i.bio)}</p>` : ''}</div></div>`).join('')}
      </aside>
    </div>`;
  ctx.root.querySelector('[data-print]').onclick = () => printDocument(`${course.title} — Course Outline`, ctx.root.querySelector('[data-outline]').innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, ''));
} });

/* ---------------------------------------------------- Submit assignment */
App.route('/course/:id/submit', { perm: 'learn', base: 'student', render(ctx) {
  const { course, error } = courseAccess(ctx.user, ctx.params.id);
  if (error) return deniedPage(ctx, error);
  const u = ctx.user;
  courseCrumbs(ctx, course, [{ label: `Submit ${t('assignment')}` }]);
  courseTools(ctx, course);
  const assignments = Domain.courseAssignments(course.id);
  const sessions = Domain.courseSessions(course.id, true);
  const cfg = lms(), types = csvList(cfg.allowedTypes), maxMB = Number(cfg.uploadMaxMB) || 30;
  const label = a => { const s = sessions.find(x => x.id === a.sessionId); return `${s ? `${t('session')} ${sessions.indexOf(s) + 1} · ` : ''}${a.title}`; };
  if (!assignments.length) {
    ctx.root.innerHTML = pageHead(`Submit ${t('assignment')}`, esc(course.title)) + emptyState(`No ${t('assignments', true)} yet`, `Your instructor hasn't published any ${t('assignments', true)} for this ${t('course', true)}.`, 'clipboard');
    return;
  }
  const pre = ctx.query.assignment || assignments.find(a => a.sessionId === ctx.query.session)?.id || (assignments.find(a => Domain.assignmentState(a, u.id).status === 'Pending') || assignments[0]).id;
  ctx.root.innerHTML = `
    ${pageHead(`Submit ${t('assignment')}`, esc(course.title))}
    <div class="layout-aside">
      <form class="card stack" data-form novalidate>
        <div class="field full"><label class="label" for="sub-a">${t('session')} / ${t('assignment')} <span class="req">*</span></label>
          <select id="sub-a" class="input" name="assignment" required>${assignments.map(a => `<option value="${a.id}" ${a.id === pre ? 'selected' : ''}>${esc(label(a))}</option>`).join('')}</select></div>
        <div data-detail></div>
        <div class="field full"><label class="label" for="sub-e">Confirm your email <span class="req">*</span></label>
          <input id="sub-e" class="input" type="email" name="email" required placeholder="${esc(u.email)}" autocomplete="email"><p class="help">Type the email address on your ${esc(brand().productName)} account.</p></div>
        <div class="field full"><span class="label">File <span class="req">*</span></span><div data-drop></div></div>
        <div class="form-foot"><a class="btn btn-ghost" href="#/course/${course.id}">Cancel</a><button class="btn btn-primary" type="submit" data-submit>${icon('upload', 16)} Upload submission</button></div>
      </form>
      <aside class="stack" data-side></aside>
    </div>`;
  const form = ctx.root.querySelector('[data-form]');
  const dz = dropzone(ctx.root.querySelector('[data-drop]'), { accept: types, maxMB });
  const detail = () => {
    const a = findRecord('assignments', form.assignment.value), st = Domain.assignmentState(a, u.id), sub = st.submission;
    const late = a.dueAt && new Date(a.dueAt) < new Date();
    const closed = late && (a.lateAllowed === false || cfg.lateSubmissions === false);
    form.querySelector('[data-detail]').innerHTML = `<div class="note-box ${closed ? 'danger' : late ? 'warning' : ''}"><b>${esc(a.title)}</b><p class="small">${esc(a.description || '')}</p><p class="small">${icon('clock', 14)} Due ${fmtDateTime(a.dueAt)} (${esc(relTime(a.dueAt))}) · ${a.maxMarks} marks${closed ? ' · <b>Submissions closed</b>' : late ? ' · Late submissions accepted' : ''}</p></div>`;
    const graded = sub?.status === 'Graded';
    const btn = form.querySelector('[data-submit]');
    btn.disabled = closed || graded;
    btn.innerHTML = `${icon('upload', 16)} ${sub ? 'Replace submission' : 'Upload submission'}`;
    ctx.root.querySelector('[data-side]').innerHTML = sub ? `<div class="card"><div class="card-head"><h3>Your submission</h3>${badge(sub.status)}</div><ul class="resource-list"><li><span class="res-icon">${icon('file', 16)}</span><div class="grow"><b class="truncate">${esc(sub.fileName)}</b><small class="muted">${fmtDateTime(sub.uploadedAt)}${sub.size ? ' · ' + fmtSize(sub.size) : ''}</small></div><a class="btn btn-ghost btn-sm" href="${esc(sub.fileUrl)}" download="${esc(sub.fileName)}">${icon('download', 15)}</a></li></ul>${graded ? `<div class="grade-box"><b>${sub.grade}/${a.maxMarks}</b><span>${esc(sub.feedback || 'No feedback provided.')}</span></div><p class="small muted">Graded submissions can't be replaced. Message your instructor if you need to resubmit.</p>` : `<p class="small muted">Uploading a new file will replace this submission.</p>`}${sub.history?.length ? `<details class="small"><summary>${sub.history.length} earlier version${sub.history.length > 1 ? 's' : ''}</summary><ul class="plain">${sub.history.map(h => `<li>${esc(h.fileName)} · ${fmtDateTime(h.uploadedAt)}</li>`).join('')}</ul></details>` : ''}</div>`
      : `<div class="card"><h3>Before you submit</h3><ul class="plain small stack-sm"><li>${icon('check', 14)} Accepted: ${esc(types.join(', ').toUpperCase())}</li><li>${icon('check', 14)} Maximum size: ${maxMB} MB</li><li>${icon('check', 14)} You can replace your file until it is graded.</li></ul></div>`;
  };
  form.assignment.onchange = detail;
  detail();
  form.onsubmit = async e => {
    e.preventDefault();
    const a = findRecord('assignments', form.assignment.value);
    if (form.email.value.trim().toLowerCase() !== String(u.email).toLowerCase()) { toast('The email does not match your account.', 'error'); form.email.focus(); return; }
    if (!dz.file) { toast('Please choose a file to upload.', 'error'); return; }
    const btn = form.querySelector('[data-submit]'); btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Uploading…`;
    try {
      const up = await uploadFile(dz.file, { maxMB, types });
      const existing = Domain.submissionFor(a.id, u.id), late = a.dueAt && new Date(a.dueAt) < new Date();
      const payload = { assignmentId: a.id, sessionId: a.sessionId, courseId: course.id, learnerId: u.id, email: u.email, fileName: up.fileName, fileUrl: up.url, size: up.size, stored: up.stored, uploadedAt: new Date().toISOString(), status: late ? 'Late' : 'Submitted', grade: null, feedback: '' };
      if (existing) updateRecord('submissions', existing.id, { ...payload, history: [...(existing.history || []), { fileName: existing.fileName, fileUrl: existing.fileUrl, uploadedAt: existing.uploadedAt }] });
      else addRecord('submissions', { ...payload, history: [] });
      notifyMany(course.instructorIds || [], existing ? 'Submission replaced' : 'New submission', `${u.name} ${existing ? 'replaced' : 'submitted'} "${a.title}".`, 'Submission', '#/submissions');
      notify(u.id, 'Submission received', `"${a.title}" — ${up.fileName}`, 'Submission', `#/course/${course.id}/submit?assignment=${a.id}`);
      ctx.root.innerHTML = `${pageHead('Submission received', esc(course.title))}
        <div class="card success-card"><span class="success-icon">${icon('check', 26)}</span><h2>${existing ? 'Your submission was replaced' : 'Your work has been submitted'}</h2>
        <dl class="facts"><div><dt>${t('assignment')}</dt><dd>${esc(a.title)}</dd></div><div><dt>File</dt><dd>${esc(up.fileName)} (${fmtSize(up.size)})</dd></div><div><dt>Submitted</dt><dd>${fmtDateTime(payload.uploadedAt)}</dd></div><div><dt>Status</dt><dd>${badge(payload.status)}</dd></div></dl>
        ${up.stored === 'inline' ? `<p class="note-box warning small">The upload server wasn't reachable, so this file is stored in your browser. Ask your coordinator to run the platform server for shared storage.</p>` : ''}
        <div class="row gap"><a class="btn btn-primary" href="#/course/${course.id}">Back to ${t('course', true)}</a><a class="btn btn-ghost" href="#/assignments">My ${t('assignments', true)}</a></div></div>`;
      toast('Submission uploaded.');
    } catch (err) {
      toast(err.message, 'error'); btn.disabled = false; detail();
    }
  };
} });

/* ------------------------------------------------- Learner assignments */
App.route('/assignments', { perm: 'learn', base: 'student', render(ctx) {
  const u = ctx.user;
  ctx.setCrumbs([{ label: t('assignments') }]);
  const courses = Domain.visibleCourses(u);
  const rows = courses.flatMap(c => Domain.courseAssignments(c.id).map(a => ({ a, c, ...Domain.assignmentState(a, u.id) })));
  const count = s => rows.filter(r => r.status === s).length;
  ctx.root.innerHTML = `${pageHead(`My ${t('assignments')}`, `Track deadlines, submissions and feedback across your ${t('courses', true)}.`)}
    <div class="stats">${statCard('Pending', count('Pending'), 'clock')}${statCard('Submitted', count('Submitted') + count('Late'), 'upload')}${statCard('Graded', count('Graded'), 'award')}${statCard('Missing', count('Missing'), 'alert')}</div>
    <div class="card" data-table></div>`;
  dataTable(ctx.root.querySelector('[data-table]'), {
    rows: () => rows, searchPlaceholder: `Search ${t('assignments', true)}…`, defaultSort: 'due',
    searchText: r => `${r.a.title} ${r.c.title}`,
    filters: [{ key: 'status', label: 'All statuses', options: ['Pending', 'Submitted', 'Late', 'Graded', 'Missing'], match: (r, v) => r.status === v }, { key: 'course', label: `All ${t('courses', true)}`, options: courses.map(c => ({ value: c.id, label: c.title })), match: (r, v) => r.c.id === v }],
    columns: [
      { key: 'title', label: t('assignment'), primary: true, sortValue: r => r.a.title, render: r => `<b>${esc(r.a.title)}</b><small class="muted block">${esc(r.c.title)}</small>` },
      { key: 'due', label: 'Due', sortValue: r => r.a.dueAt || '', render: r => `${fmtDateTime(r.a.dueAt)}<small class="muted block">${esc(relTime(r.a.dueAt))}</small>` },
      { key: 'status', label: 'Status', sortValue: r => r.status, render: r => badge(r.status) },
      { key: 'grade', label: 'Grade', sortValue: r => Number(r.submission?.grade ?? -1), render: r => r.submission?.grade != null ? `<b>${r.submission.grade}</b>/${r.a.maxMarks}${r.submission.feedback ? `<small class="muted block clamp-2">${esc(r.submission.feedback)}</small>` : ''}` : `<span class="muted">—</span>` }
    ],
    actions: r => `<a class="btn btn-ghost btn-sm" href="#/course/${r.c.id}/submit?assignment=${r.a.id}">${r.submission ? 'View' : 'Submit'}</a>`,
    emptyTitle: `No ${t('assignments', true)} yet`, emptyIcon: 'clipboard'
  });
} });

/* -------------------------------------------------------------- Calendar */
App.route('/calendar', { perm: 'calendar', feature: 'calendar', render(ctx) {
  const u = ctx.user;
  ctx.setCrumbs([{ label: 'Calendar' }]);
  const courses = Domain.visibleCourses(u).filter(c => kind(u) !== 'student' || c.status === 'published');
  const events = courses.flatMap(c => [
    ...Domain.courseSessions(c.id).filter(s => s.date).map(s => ({ date: s.date, time: s.time, title: s.title, sub: c.title, color: c.accent, href: `#/course/${c.id}/session/${s.id}`, kind: 'session' })),
    ...Domain.courseAssignments(c.id).filter(a => a.dueAt).map(a => ({ date: a.dueAt.slice(0, 10), time: a.dueAt.slice(11, 16), title: `Due: ${a.title}`, sub: c.title, color: c.accent, href: kind(u) === 'student' ? `#/course/${c.id}/submit?assignment=${a.id}` : `#/submissions?assignment=${a.id}`, kind: 'due' }))
  ]).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  let cursor = ctx.query.m ? new Date(ctx.query.m + '-01T00:00:00') : new Date(); cursor.setDate(1);
  const draw = () => {
    const y = cursor.getFullYear(), mo = cursor.getMonth(), first = new Date(y, mo, 1), startPad = (first.getDay() + 6) % 7, daysIn = new Date(y, mo + 1, 0).getDate();
    const key = d => `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, today = todayISO();
    const monthEvents = events.filter(e => e.date.startsWith(`${y}-${String(mo + 1).padStart(2, '0')}`));
    ctx.root.innerHTML = `${pageHead('Training calendar', `${t('sessions')} and deadlines for your ${t('courses', true)}.`, `<div class="row gap-sm"><button class="btn btn-ghost btn-sm" data-nav="-1" aria-label="Previous month">${icon('chevronLeft', 16)}</button><b class="month-label">${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b><button class="btn btn-ghost btn-sm" data-nav="1" aria-label="Next month">${icon('chevronRight', 16)}</button><button class="btn btn-secondary btn-sm" data-today>Today</button></div>`)}
      <div class="card cal-card"><div class="cal-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-dow">${d}</div>`).join('')}${Array.from({ length: startPad }, () => '<div class="cal-cell pad-cell"></div>').join('')}${Array.from({ length: daysIn }, (_, i) => { const k = key(i + 1), ev = events.filter(e => e.date === k); return `<div class="cal-cell ${k === today ? 'today' : ''}"><span class="cal-day">${i + 1}</span>${ev.slice(0, 3).map(e => `<a class="cal-ev ${e.kind}" href="${e.href}" style="--c:${esc(e.color || 'var(--brand)')}" title="${esc(e.title)} — ${esc(e.sub)}">${e.time ? `<span>${fmtTime(e.time).replace(':00', '')}</span>` : ''}${esc(e.title)}</a>`).join('')}${ev.length > 3 ? `<span class="cal-more">+${ev.length - 3} more</span>` : ''}</div>`; }).join('')}</div>
      <div class="cal-agenda">${monthEvents.length ? monthEvents.map(e => `<a class="agenda-row" href="${e.href}" style="--c:${esc(e.color || 'var(--brand)')}"><span class="agenda-date"><b>${parseDate(e.date).getDate()}</b><small>${parseDate(e.date).toLocaleDateString('en-GB', { weekday: 'short' })}</small></span><span class="grow"><b>${esc(e.title)}</b><small class="muted block">${esc(e.sub)}${e.time ? ' · ' + fmtTime(e.time) : ''}</small></span>${badge(e.kind === 'due' ? 'Due' : e.date === today ? 'Today' : e.date > today ? 'Upcoming' : 'Available', e.kind === 'due' ? 'warning' : undefined)}</a>`).join('') : emptyState('Nothing scheduled', 'No sessions or deadlines this month.', 'calendar')}</div></div>`;
    ctx.root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { cursor.setMonth(cursor.getMonth() + Number(b.dataset.nav)); draw(); });
    ctx.root.querySelector('[data-today]').onclick = () => { cursor = new Date(); cursor.setDate(1); draw(); };
  };
  draw();
} });
