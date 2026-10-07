/* SDC Learn — application shell: hash router, role-aware navigation, top bar and page context. */
const App = {
  routes: [],
  user: null,
  route(pattern, def) { this.routes.push({ pattern, parts: pattern.split('/').filter(Boolean), ...def }); },

  // One menu for every role; each item shows only when the user's role can view its module.
  nav() {
    const learner = kind(this.user) === 'student';
    return [
      { group: '', items: [{ path: '/dashboard', label: () => 'Dashboard', icon: 'home', perm: 'dashboard' }] },
      { group: 'Learn', items: [
        { path: '/courses', label: () => `My ${t('courses')}`, icon: 'book', perm: 'learn', base: 'student' },
        { path: '/assignments', label: () => t('assignments'), icon: 'clipboard', perm: 'learn', base: 'student' }
      ] },
      { group: 'Catalogue', items: [
        { path: '/manage/courses', label: () => scopeAll(this.user) ? t('courses') : `My ${t('courses')}`, icon: 'layers', perm: 'courses' },
        { path: '/programs', label: () => t('programs'), icon: 'layers', perm: 'programs' },
        { path: '/divisions', label: () => t('divisions'), icon: 'building', perm: 'divisions' },
        { path: '/batches', label: () => t('batches'), icon: 'grid', perm: 'batches' }
      ] },
      { group: 'People', items: [
        { path: '/learners', label: () => t('learners'), icon: 'cap', perm: 'learners' },
        { path: '/instructors', label: () => t('instructors'), icon: 'users', perm: 'staff' },
        { path: '/enrollments', label: () => 'Enrollments', icon: 'userPlus', perm: 'enrollments' },
        { path: '/users', label: () => 'All users', icon: 'user', perm: 'staff' },
        { path: '/roles', label: () => 'Roles & permissions', icon: 'shield', perm: 'roles' }
      ] },
      { group: learner ? 'Progress' : 'Delivery', items: [
        { path: '/submissions', label: () => 'Submissions', icon: 'clipboard', perm: 'submissions', badge: () => pendingSubmissions(this.user) },
        { path: '/attendance', label: () => 'Attendance', icon: 'checkSquare', perm: 'attendance', feature: 'attendance' },
        { path: '/results', label: () => 'Results', icon: 'chart', perm: 'results', feature: 'results' },
        { path: '/certificates', label: () => 'Certificates', icon: 'award', perm: 'certificates', feature: 'certificates' },
        { path: '/fees', label: () => t('fees'), icon: 'wallet', perm: 'fees', feature: 'fees' },
        { path: '/calendar', label: () => 'Calendar', icon: 'calendar', perm: 'calendar', feature: 'calendar' }
      ] },
      { group: 'Connect', items: [
        { path: '/announcements', label: () => 'Announcements', icon: 'megaphone', perm: 'announcements', feature: 'announcements' },
        { path: '/messages', label: () => 'Messages', icon: 'mail', perm: 'messages', feature: 'messages', badge: () => unreadMessages() },
        { path: '/notifications', label: () => 'Notifications', icon: 'bell', badge: () => db().notifications.filter(n => n.userId === this.user.id && !n.read).length }
      ] },
      { group: 'System', items: [
        { path: '/reports', label: () => 'Reports', icon: 'pie', perm: 'reports' },
        { path: '/feedback', label: () => 'Feedback', icon: 'star', perm: 'feedback', feature: 'feedback' },
        { path: '/settings', label: () => 'Settings', icon: 'settings', perm: 'settings' }
      ] }
    ];
  },
  allowed(item) { return (!item.base || kind(this.user) === item.base) && (!item.feature || feature(item.feature)) && (!item.perm || [].concat(item.perm).some(p => can(p, 'view', this.user))); },
  home() {
    if (kind(this.user) === 'student' && can('learn', 'view', this.user)) return '/courses';
    if (can('dashboard', 'view', this.user)) return '/dashboard';
    return this.nav().flatMap(g => g.items).find(i => this.allowed(i))?.path || '/profile';
  },

  start() {
    try { applyTheme(); } catch (e) {}
    this.user = currentUser();
    if (!this.user) { location.replace('login.html'); return; }
    this.mountShell();
    window.addEventListener('hashchange', () => this.render());
    window.addEventListener('sdc-cloud-refresh', () => { invalidateCache(); this.user = currentUser(); if (!this.user) return logout(); this.render(true); });
    this.render();
  },

  mountShell() {
    const b = brand(), u = this.user;
    document.body.innerHTML = `
      <a class="skip-link" href="#main">Skip to content</a>
      <div class="shell">
        <aside class="sidebar" aria-label="Main navigation">
          <div class="brand"><button class="brand-toggle" data-collapse aria-label="Collapse navigation" title="Collapse navigation"><img src="${esc(resolveAsset(b.logoUrl))}" alt="" class="brand-logo"></button><a class="brand-name" href="#${this.home()}"><b>${esc(b.productName)}</b><small>${esc(b.orgShort)}</small></a></div>
          <nav class="nav" data-nav></nav>
          <div class="sidebar-foot">
            <div class="me">${avatar(u, 34)}<div><b>${esc(u.name)}</b><small>${esc(roleLabel(u.role))}</small></div></div>
            <button class="icon-btn" data-logout title="Sign out" aria-label="Sign out">${icon('logout')}</button>
          </div>
        </aside>
        <div class="scrim" data-scrim></div>
        <div class="main">
          <header class="topbar">
            <button class="icon-btn" data-menu aria-label="Toggle navigation">${icon('menu')}</button>
            <nav class="crumbs" data-crumbs aria-label="Breadcrumb"></nav>
            <div class="top-actions">
              <div class="course-tools" data-tools></div>
              <button class="icon-btn" data-theme-toggle aria-label="Toggle dark mode">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
              <div class="pop-wrap"><button class="icon-btn" data-bell aria-label="Notifications">${icon('bell')}<span class="dot-count" data-bell-count hidden></span></button><div class="popover popover-notes" data-bell-pop hidden></div></div>
              <div class="pop-wrap"><button class="user-chip" data-user-btn aria-label="Account menu">${avatar(u, 30)}<span class="hide-sm">${esc(u.name.split(' ')[0])}</span>${icon('chevronDown', 14)}</button>
                <div class="popover popover-menu" data-user-pop hidden>
                  <div class="pop-head"><b>${esc(u.name)}</b><small>${esc(u.email)}</small></div>
                  <a href="#/profile">${icon('user', 16)} My profile</a>
                  <a href="#/notifications">${icon('bell', 16)} Notifications</a>
                  <button data-logout>${icon('logout', 16)} Sign out</button>
                </div>
              </div>
            </div>
          </header>
          <main id="main" class="content" tabindex="-1"></main>
          <footer class="app-foot"><span>${esc(footerText())}</span><span><a href="${esc(b.website)}" target="_blank" rel="noopener">${esc(b.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a> · ${esc(b.phone)} · <a href="mailto:${esc(b.email)}">${esc(b.email)}</a></span></footer>
        </div>
      </div>`;
    const side = document.querySelector('.sidebar'), scrim = document.querySelector('[data-scrim]');
    const closeMenu = () => { side.classList.remove('open'); scrim.classList.remove('show'); };
    // Phones/tablets: slide-in drawer. Desktop: collapse the sidebar to icons (remembered per browser).
    const shell = document.querySelector('.shell'), setMini = on => { shell.classList.toggle('nav-mini', on); const t = document.querySelector('[data-collapse]'); t.title = t.ariaLabel = on ? 'Expand navigation' : 'Collapse navigation'; try { localStorage.setItem('sdcNavMini', on ? '1' : ''); } catch (e) {} };
    try { if (localStorage.getItem('sdcNavMini') === '1') setMini(true); } catch (e) {}
    document.querySelector('[data-menu]').onclick = () => { side.classList.add('open'); scrim.classList.add('show'); };
    document.querySelector('[data-collapse]').onclick = () => { if (matchMedia('(max-width: 1024px)').matches) closeMenu(); else setMini(!shell.classList.contains('nav-mini')); };
    document.querySelector('[data-nav]').addEventListener('click', e => {
      const btn = e.target.closest('[data-group]'); if (!btn) return;
      let closed = []; try { closed = JSON.parse(localStorage.getItem('sdcNavClosed') || '[]'); } catch (err) {}
      const g = btn.dataset.group, open = closed.includes(g);
      closed = open ? closed.filter(x => x !== g) : [...closed, g];
      try { localStorage.setItem('sdcNavClosed', JSON.stringify(closed)); } catch (err) {}
      btn.parentElement.classList.toggle('collapsed', !open); btn.setAttribute('aria-expanded', String(open));
    });
    scrim.onclick = closeMenu;
    side.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
    document.querySelectorAll('[data-logout]').forEach(b => b.onclick = logout);
    document.querySelector('[data-theme-toggle]').onclick = e => { const m = toggleTheme(e); e.currentTarget.innerHTML = icon(m === 'dark' ? 'sun' : 'moon'); };
    this.popover('[data-user-btn]', '[data-user-pop]');
    this.popover('[data-bell]', '[data-bell-pop]', () => this.renderNotifications());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); document.querySelectorAll('.popover').forEach(p => p.hidden = true); } });
  },

  popover(btnSel, popSel, onOpen) {
    const btn = document.querySelector(btnSel), pop = document.querySelector(popSel);
    if (!btn || !pop) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = pop.hidden;
      document.querySelectorAll('.popover').forEach(p => p.hidden = true);
      if (willOpen) { onOpen?.(); pop.hidden = false; }
    });
    document.addEventListener('click', e => { if (!pop.contains(e.target) && !btn.contains(e.target)) pop.hidden = true; });
    pop.addEventListener('click', e => { if (e.target.closest('a')) pop.hidden = true; });
  },

  renderNav(path) {
    const u = this.user, nav = document.querySelector('[data-nav]');
    nav.innerHTML = this.nav().map(g => {
      const items = g.items.filter(i => this.allowed(i));
      if (!items.length) return '';
      let closed = []; try { closed = JSON.parse(localStorage.getItem('sdcNavClosed') || '[]'); } catch (e) {}
      const hasActive = items.some(i => path === i.path || path.startsWith(i.path + '/') || (i.path === '/courses' && path.startsWith('/course/')) || (i.path === '/manage/courses' && path.startsWith('/manage/course/')));
      const collapsed = g.group && closed.includes(g.group) && !hasActive;
      return `<div class="nav-group ${collapsed ? 'collapsed' : ''}">${g.group ? `<button type="button" class="nav-label" data-group="${esc(g.group)}" aria-expanded="${!collapsed}"><span>${esc(g.group)}</span>${icon('chevronDown', 13)}</button>` : ''}<div class="nav-items">${items.map(i => {
        const active = path === i.path || path.startsWith(i.path + '/') || (i.path === '/courses' && path.startsWith('/course/')) || (i.path === '/manage/courses' && path.startsWith('/manage/course/'));
        const n = i.badge ? i.badge() : 0;
        return `<a href="#${i.path}" class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''} title="${esc(i.label())}">${icon(i.icon)}<span>${esc(i.label())}</span>${n ? `<span class="nav-count">${n}</span>` : ''}</a>`;
      }).join('')}</div></div>`;
    }).join('');
  },

  renderNotifications() {
    const pop = document.querySelector('[data-bell-pop]');
    const rows = db().notifications.filter(n => n.userId === this.user.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    pop.innerHTML = `<div class="pop-head row-between"><b>Notifications</b>${rows.some(n => !n.read) ? '<button class="link-btn" data-read-all>Mark all read</button>' : ''}</div>
      <div class="note-list">${rows.slice(0, 6).map(n => `<button class="note ${n.read ? '' : 'unread'}" data-note="${esc(n.id)}"><span class="note-dot"></span><span><b>${esc(n.title)}</b><small>${esc(n.message)}</small><small class="muted">${esc(relTime(n.date))}</small></span></button>`).join('') || `<p class="muted small pad">You're all caught up.</p>`}</div>
      <a class="pop-foot" href="#/notifications">View all</a>`;
    pop.querySelector('[data-read-all]')?.addEventListener('click', e => { e.stopPropagation(); const d = db(); d.notifications.forEach(n => { if (n.userId === this.user.id) n.read = true; }); saveDB(d); this.renderNotifications(); this.syncBadges(); });
    pop.querySelectorAll('[data-note]').forEach(b => b.onclick = () => { const n = findRecord('notifications', b.dataset.note); updateRecord('notifications', n.id, { read: true }); pop.hidden = true; this.syncBadges(); if (n.link) location.hash = n.link.replace(/^#/, ''); });
  },

  syncBadges() {
    const n = db().notifications.filter(x => x.userId === this.user.id && !x.read).length;
    const el = document.querySelector('[data-bell-count]');
    if (el) { el.hidden = !n; el.textContent = n > 9 ? '9+' : n; }
    this.renderNav(this.currentPath || '');
  },

  match(path) {
    const parts = path.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params = {};
      if (r.parts.every((p, i) => p.startsWith(':') ? (params[p.slice(1)] = decodeURIComponent(parts[i]), true) : p === parts[i])) return { route: r, params };
    }
    return null;
  },

  render(keepScroll) {
    invalidateCache();
    this.user = currentUser();
    if (!this.user) return logout();
    const raw = location.hash.replace(/^#/, '') || this.home();
    const [path, qs] = raw.split('?');
    if (!location.hash) { history.replaceState(null, '', '#' + path); }
    const m = this.match(path);
    const root = document.getElementById('main');
    this.currentPath = path;
    this.renderNav(path);
    this.setTools('');
    this.syncBadges();
    if (!m || !this.allowed(m.route)) {
      this.setCrumbs([{ label: 'Not found' }]);
      root.innerHTML = emptyState('Page not available', 'This page does not exist or is not available for your role.', 'alert', `<a class="btn btn-primary" href="#${this.home()}">Go home</a>`);
      return;
    }
    const ctx = {
      user: this.user, params: m.params, query: Object.fromEntries(new URLSearchParams(qs || '')), root,
      setCrumbs: c => this.setCrumbs(c), setTools: (h, bind) => this.setTools(h, bind), refresh: () => this.render(true)
    };
    try {
      const y = window.scrollY;
      root.innerHTML = '';
      m.route.render(ctx);
      root.classList.remove('fade-in'); void root.offsetWidth; root.classList.add('fade-in');
      if (keepScroll) window.scrollTo(0, y); else { window.scrollTo(0, 0); }
    } catch (e) {
      console.error(e);
      root.innerHTML = emptyState('Something went wrong', e.message || 'This page could not be displayed.', 'alert', `<button class="btn btn-primary" onclick="location.reload()">Reload</button>`);
    }
  },

  setCrumbs(crumbs) {
    const el = document.querySelector('[data-crumbs]');
    const list = crumbs.filter(Boolean);
    el.innerHTML = list.length < 2 ? '' : list.map((c, i) => i < list.length - 1 && c.href ? `<a href="${esc(c.href)}">${esc(c.label)}</a>${icon('chevronRight', 14)}` : `<span ${i === list.length - 1 ? 'aria-current="page"' : ''}>${esc(c.label)}</span>${i < list.length - 1 ? icon('chevronRight', 14) : ''}`).join('');
    document.title = `${list[list.length - 1]?.label || ''} · ${brand().productName}`;
  },
  setTools(html, bind) {
    const el = document.querySelector('[data-tools]');
    if (!el) return;
    el.innerHTML = html || '';
    if (bind) bind(el);
  }
};

function unreadMessages() { return feature('messages') ? db().messages.filter(m => m.to === App.user?.id && !m.read).length : 0; }
function pendingSubmissions(user) {
  if (!user) return 0;
  const ids = scopeAll(user) ? null : Domain.visibleCourses(user).map(c => c.id);
  return db().submissions.filter(s => (s.status === 'Submitted' || s.status === 'Late') && (!ids || ids.includes(s.courseId))).length;
}

/* Shared page header used by every screen. */
function pageHead(title, subtitle = '', actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}
function statCard(label, value, iconName, hint = '', href = '') {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="stat" ${href ? `href="${esc(href)}"` : ''}><span class="stat-icon">${icon(iconName, 18)}</span><div><span class="stat-label">${esc(label)}</span><b class="stat-value">${esc(value)}</b>${hint ? `<span class="stat-hint">${esc(hint)}</span>` : ''}</div></${tag}>`;
}

document.addEventListener('DOMContentLoaded', () => App.start());
