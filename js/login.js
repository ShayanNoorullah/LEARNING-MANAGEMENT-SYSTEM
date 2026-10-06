/* SDC Learn — sign-in page. All copy comes from Settings → Branding. */
(function () {
  const $ = s => document.querySelector(s);
  function paint() {
    applyTheme();
    const b = brand();
    document.title = `Sign in · ${b.productName}`;
    document.querySelectorAll('[data-lockup]').forEach(i => i.src = resolveAsset(b.lockupUrl || b.logoUrl));
    document.querySelectorAll('[data-product]').forEach(e => e.textContent = b.productName);
    document.querySelectorAll('[data-org-short]').forEach(e => e.textContent = b.orgName);
    const words = esc(b.tagline).split(' '), tail = words.splice(-Math.min(2, Math.max(1, words.length - 1)));
    $('[data-tagline]').innerHTML = `${words.join(' ')} <span class="grad-text">${tail.join(' ')}</span>`;
    paintShowcase();
    $('[data-subtag]').textContent = b.subTagline;
    $('[data-established]').textContent = b.established;
    $('[data-phone]').textContent = b.phone;
    const em = $('[data-email]'); em.textContent = b.email; em.href = `mailto:${b.email}`;
    const ws = $('[data-website]'); ws.textContent = b.website.replace(/^https?:\/\//, '').replace(/\/$/, ''); ws.href = b.website;
    document.querySelectorAll('[data-icon]').forEach(e => e.innerHTML = icon(e.dataset.icon, 16));
    $('[data-theme-toggle]').innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
    $('#togglePw').innerHTML = icon('eye', 16);
    const demos = [['admin', 'admin@sdclearn.demo', 'shield'], ['teacher', 'instructor@sdclearn.demo', 'users'], ['student', 'learner@sdclearn.demo', 'cap']]
      .filter(([, mail]) => db().users.some(u => u.email === mail && u.status === 'Active'));
    $('#demo').hidden = !(lms().showDemoAccounts && demos.length);
    $('#demoGrid').innerHTML = demos.map(([role, mail, ic]) => `<button type="button" class="demo-btn" data-mail="${mail}" title="${esc(mail)}">${icon(ic, 18)}<b>${esc(roleLabel(role))}</b></button>`).join('');
    document.querySelectorAll('[data-mail]').forEach(btn => btn.onclick = () => { $('#email').value = btn.dataset.mail; $('#password').value = 'Demo@123'; $('#loginError').hidden = true; $('#loginBtn').focus(); });
  }

  // Brand-panel showcase built from live data: stats count up, preview cards float.
  function paintShowcase() {
    const d = db(), today = todayISO(), pub = d.courses.filter(c => c.status === 'published');
    const stats = [[pub.length, t('courses')], [d.users.filter(u => kind(u) === 'student').length, t('learners')], [d.sessions.filter(s => pub.some(c => c.id === s.courseId)).length, t('sessions')]];
    $('[data-stats]').innerHTML = stats.map(([n, l]) => `<div><b data-count="${n}">0</b><span>${esc(l)}</span></div>`).join('');
    document.querySelectorAll('[data-count]').forEach(el => {
      const end = Number(el.dataset.count), t0 = performance.now();
      const tick = now => { const p = Math.min(1, (now - t0) / 1200); el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const next = d.sessions.filter(s => s.date >= today && pub.some(c => c.id === s.courseId)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
    const course = next && pub.find(c => c.id === next.courseId), live = next?.date === today;
    const people = d.users.filter(u => kind(u) === 'student').slice(0, 4);
    $('[data-stage]').innerHTML = `
      ${next ? `<div class="fc fc-live"><div class="fc-row"><span class="fc-dot ${live ? 'on' : ''}"></span><small>${live ? 'Live today' : 'Next class'} · ${esc(fmtDate(next.date, { weekday: 'short', day: 'numeric', month: 'short' }))}${next.time ? ' · ' + fmtTime(next.time) : ''}</small></div><b>${esc(next.title)}</b><small class="fc-muted">${esc(course.title)}</small><div class="fc-avatars">${people.map(p => `<span>${esc(initials(p.name))}</span>`).join('')}<em>${icon('video', 13)} Zoom</em></div></div>` : ''}
      <div class="fc fc-progress"><div class="fc-ring"><span>72%</span></div><div><b>Course progress</b><small class="fc-muted">5 of 7 ${esc(t('sessions', true))} done</small></div></div>
      <div class="fc fc-cert"><span class="fc-award">${icon('award', 18)}</span><div><b>Certificate verified</b><small class="fc-muted">${esc(lms().certificatePrefix)}-${new Date().getFullYear()}-0001</small></div>${icon('check', 16)}</div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (currentUser()) { location.replace('app.html'); return; }
    paint();
    window.addEventListener('sdc-cloud-refresh', paint);
    const err = $('#loginError'), btn = $('#loginBtn');
    const show = msg => { err.textContent = msg; err.hidden = false; const c = $('.auth-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); };
    $('[data-theme-toggle]').onclick = e => { const m = toggleTheme(); e.currentTarget.innerHTML = icon(m === 'dark' ? 'sun' : 'moon'); };
    $('#togglePw').onclick = () => { const p = $('#password'), show = p.type === 'password'; p.type = show ? 'text' : 'password'; $('#togglePw').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); };
    $('#forgot').onclick = () => {
      const b = brand();
      openModal({ title: 'Reset your password', size: 'sm', body: `<p>For your security, passwords are reset by the ${esc(b.orgShort)} coordination office.</p><p class="small">Email <a href="mailto:${esc(b.email)}?subject=${encodeURIComponent(b.productName + ' password reset')}">${esc(b.email)}</a> or call ${esc(b.phone)} from your registered email or phone number.</p>`, footer: `<button class="btn btn-primary" data-modal-close>Got it</button>` });
    };
    $('#loginForm').onsubmit = e => {
      e.preventDefault(); err.hidden = true;
      const email = $('#email'), pw = $('#password');
      if (!email.value.trim() || !email.checkValidity()) { show('Please enter a valid email address.'); email.focus(); return; }
      if (!pw.value) { show('Please enter your password.'); pw.focus(); return; }
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Signing in…';
      setTimeout(() => {
        invalidateCache();
        const res = login(email.value, pw.value, $('#remember').checked);
        if (res.ok) { location.href = 'app.html'; return; }
        show(res.error); btn.disabled = false; btn.textContent = 'Sign in'; pw.select();
      }, 250);
    };
  });
})();
