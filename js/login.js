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

  const showError = msg => { const err = $('#loginError'); err.textContent = msg; err.hidden = false; const c = $('.auth-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); };

  /* Sign in with Google via Supabase Auth. Google proves who the person is; the platform account
     (role, permissions, courses) is found by email. Unknown emails are refused unless Settings →
     Sign-in names a role for automatic registration. */
  async function setupGoogle() {
    const c = window.SDC_CLOUD_CONFIG || {}, btn = $('#googleBtn');
    if (!settings().auth.googleEnabled || !c.url || !c.anonKey || !window.supabase?.createClient) return;
    const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.slice(1));
    const oauthError = q.get('error_description') || h.get('error_description');
    if (oauthError) { history.replaceState(null, '', location.pathname); showError(`Google sign-in failed: ${oauthError}`); }
    const client = window.supabase.createClient(c.url, c.anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, storageKey: 'sdc-google-auth' } });
    const returning = q.has('code');
    if (returning) { btn.hidden = false; btn.disabled = true; btn.querySelector('span').textContent = 'Signing you in…'; }
    const { data } = await client.auth.getSession();
    if (data.session?.user?.email) return finishGoogle(client, data.session.user, data.session.access_token);
    if (returning) { history.replaceState(null, '', location.pathname); btn.disabled = false; btn.querySelector('span').textContent = 'Continue with Google'; }
    try { const r = await fetch(`${c.url}/auth/v1/settings`, { headers: { apikey: c.anonKey } }); if (!(await r.json()).external?.google) { btn.hidden = true; return; } } catch (e) { btn.hidden = true; return; }
    btn.hidden = false; $('#googleOr').hidden = false;
    btn.onclick = async () => {
      btn.disabled = true; btn.querySelector('span').textContent = 'Redirecting to Google…';
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
      if (error) { showError(error.message); btn.disabled = false; btn.querySelector('span').textContent = 'Continue with Google'; }
    };
  }
  async function finishGoogle(client, gUser, accessToken) {
    history.replaceState(null, '', location.pathname);
    if (await window.SDCCloud?.gateway?.()) {
      // Gateway: the server checks the Google token and matches (or registers) the account.
      try {
        const uid = await SDCCloud.signInGoogle(accessToken);
        await client.auth.signOut().catch(() => {});
        sessionStorage.setItem('sdcSession', uid); localStorage.setItem('sdcRemember', uid);
        updateRecord('users', uid, { lastLoginAt: new Date().toISOString(), avatarUrl: gUser.user_metadata?.avatar_url || currentUser()?.avatarUrl || '' });
        location.href = 'app.html'; return;
      } catch (e) {
        await client.auth.signOut().catch(() => {});
        const btn = $('#googleBtn'); btn.disabled = false; btn.querySelector('span').textContent = 'Continue with Google';
        return showError(e.message);
      }
    }
    const email = String(gUser.email).toLowerCase(), meta = gUser.user_metadata || {};
    try { await window.SDCCloud?.ready; } catch (e) {} // make sure accounts created on other devices are known
    invalidateCache();
    let u = db().users.find(x => String(x.email).toLowerCase() === email);
    const signUpRole = settings().auth.googleSignUpRole;
    if (!u && signUpRole && findRecord('roles', signUpRole)) {
      u = addRecord('users', { name: meta.full_name || meta.name || email.split('@')[0], email, role: signUpRole, status: 'Active', joinedAt: todayISO(), authProvider: 'google' });
      notifyMany(db().users.filter(x => roleOf(x)?.id === 'admin').map(x => x.id), 'New Google sign-up', `${u.name} (${email}) joined as ${roleLabel(u)}.`, 'Account', '#/users');
    }
    await client.auth.signOut().catch(() => {});
    const btn = $('#googleBtn'); btn.disabled = false; btn.querySelector('span').textContent = 'Continue with Google';
    if (!u) return showError(`${email} isn't registered on ${brand().productName}. Ask your coordinator to create your account, then try again.`);
    if (u.status !== 'Active') return showError('This account is not active. Please contact your coordinator.');
    sessionStorage.setItem('sdcSession', u.id);
    updateRecord('users', u.id, { lastLoginAt: new Date().toISOString(), avatarUrl: meta.avatar_url || u.avatarUrl || '' });
    location.href = 'app.html';
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (currentUser()) { location.replace('app.html'); return; }
    setupGoogle();
    paint();
    window.SDCCloud?.gateway?.().then(on => on && SDCCloud.publicSettings().then(s => { const d = db(); d.settings = s; localStorage.setItem(DBKEY, JSON.stringify(normalizeState(d))); invalidateCache(); paint(); })).catch(() => {});
    window.addEventListener('sdc-cloud-refresh', paint);
    const err = $('#loginError'), btn = $('#loginBtn');
    const show = showError;
    $('[data-theme-toggle]').onclick = e => { const m = toggleTheme(e); e.currentTarget.innerHTML = icon(m === 'dark' ? 'sun' : 'moon'); };
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
      setTimeout(async () => {
        if (await window.SDCCloud?.gateway?.()) {
          try {
            const uid = await SDCCloud.signIn(email.value.trim(), pw.value, $('#remember').checked);
            sessionStorage.setItem('sdcSession', uid);
            if ($('#remember').checked) localStorage.setItem('sdcRemember', uid); else localStorage.removeItem('sdcRemember');
            updateRecord('users', uid, { lastLoginAt: new Date().toISOString() });
            location.href = 'app.html';
          } catch (ex) { show(ex.message); btn.disabled = false; btn.textContent = 'Sign in'; pw.select(); }
          return;
        }
        invalidateCache();
        const res = login(email.value, pw.value, $('#remember').checked);
        if (res.ok) { location.href = 'app.html'; return; }
        show(res.error); btn.disabled = false; btn.textContent = 'Sign in'; pw.select();
      }, 250);
    };
  });
})();
