/* SDC Learn — background cloud reconciliation. LocalStorage is rendered first; the cloud copy
   is pulled/pushed in the background and never blocks the UI when the cloud is slow or offline.
   Gateway mode (server has SDC_STATE_SECRET): every read/write goes through /api/sdc with a
   signed session token, and sign-in is checked on the server. Direct mode (legacy, until the
   gateway is configured): the browser reads/writes the Supabase row with the publishable key. */
(function () {
  const c = window.SDC_CLOUD_CONFIG || {};
  const off = c.enabled === false;
  window.SDC_CLOUD_STATUS = off ? 'Local only (cloud sync off)' : 'Connecting…';
  const table = c.table || 'sdc_app_state', id = c.stateId || 'sdc-learn-main', PENDING = 'sdcCloudPending', STAMP = 'sdcCloudUpdatedAt', TOKEN = 'sdcCloudToken';
  const useful = s => s && typeof s === 'object' && Array.isArray(s.users) && s.users.length > 0 && Array.isArray(s.courses);
  const withTimeout = (p, ms = 8000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Cloud timeout')), ms))]);
  const token = () => { try { return localStorage.getItem(TOKEN); } catch (e) { return null; } };
  const mode = off ? Promise.resolve('off') : fetch('/api/sdc/status').then(r => r.ok ? r.json() : {}).then(j => j.gateway ? 'gateway' : 'direct').catch(() => 'direct');
  let client = null;
  const direct = () => client || (c.url && c.anonKey && !c.url.includes('YOUR_') && window.supabase?.createClient ? (client = window.supabase.createClient(c.url, c.anonKey, { auth: { persistSession: false } })) : null);

  async function api(path, opts = {}) {
    const t = token(), r = await withTimeout(fetch('/api/sdc' + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) } }));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && t) { localStorage.removeItem(TOKEN); if (typeof App !== 'undefined') logout(); }
    if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return j;
  }
  function adopt(state, updatedAt) {
    localStorage.setItem(DBKEY, JSON.stringify(normalizeState(state)));
    localStorage.setItem(STAMP, String(Date.parse(updatedAt) || Date.now()));
    localStorage.removeItem(PENDING);
    invalidateCache();
  }
  async function remote() {
    const m = await mode;
    if (m === 'gateway') { if (!token()) return null; const j = await api('/state'); return { state: j.state, at: Date.parse(j.updatedAt) || 0 }; }
    const cl = m === 'direct' && direct(); if (!cl) return null;
    const res = await withTimeout(cl.from(table).select('state,updated_at').eq('id', id).maybeSingle());
    if (res.error) throw res.error;
    return { state: res.data?.state, at: Date.parse(res.data?.updated_at || 0) || 0 };
  }
  async function push(state) {
    const m = await mode;
    if (m === 'gateway') { if (!token()) return; await api('/state', { method: 'PUT', body: JSON.stringify({ state }) }); }
    else { const cl = m === 'direct' && direct(); if (!cl) return; const res = await withTimeout(cl.from(table).upsert({ id, state, updated_at: new Date().toISOString() }, { onConflict: 'id' })); if (res.error) throw res.error; }
    localStorage.setItem(STAMP, String(Date.now()));
  }
  async function pull() {
    try {
      // A browser signed in before the gateway existed has no token: sign in again so changes reach the cloud.
      if (await mode === 'gateway' && !token() && typeof App !== 'undefined' && currentUser()) return logout();
      const r = await remote();
      if (!r) { window.SDC_CLOUD_STATUS = off ? window.SDC_CLOUD_STATUS : 'Local only'; return; }
      if (localStorage.getItem(PENDING)) await flush();
      else if (useful(r.state)) {
        if (r.at > Number(localStorage.getItem(STAMP) || 0)) { adopt(r.state, new Date(r.at).toISOString()); window.dispatchEvent(new Event('sdc-cloud-refresh')); }
      } else await push(db());
      window.SDC_CLOUD_STATUS = 'Connected';
    } catch (e) { console.warn('Cloud sync unavailable; working locally.', e); window.SDC_CLOUD_STATUS = 'Offline — working locally'; }
  }
  // Pushes are debounced and serialised so an older snapshot can never overwrite a newer one.
  let running = null, dirty = false, timer = null;
  async function flush() {
    if (running) { dirty = true; return running; }
    running = (async () => {
      do { dirty = false; try { const tag = localStorage.getItem(PENDING); await push(db()); if (localStorage.getItem(PENDING) === tag) localStorage.removeItem(PENDING); window.SDC_CLOUD_STATUS = 'Connected'; } catch (e) { console.warn('Cloud save skipped:', e); window.SDC_CLOUD_STATUS = 'Offline — changes saved locally'; } } while (dirty);
    })();
    try { return await running; } finally { running = null; }
  }
  async function startSession(j) { localStorage.setItem(TOKEN, j.token); adopt(j.state, j.updatedAt); return j.userId; }
  window.SDCCloud = {
    syncNow() { localStorage.setItem(PENDING, `${Date.now()}-${Math.random().toString(36).slice(2)}`); clearTimeout(timer); timer = setTimeout(flush, 400); },
    flushNow: flush, pullNow: pull, ready: null,
    gateway: () => mode.then(m => m === 'gateway'),
    signIn: (email, password, remember) => api('/login', { method: 'POST', body: JSON.stringify({ email, password, remember }) }).then(startSession),
    signInGoogle: accessToken => api('/google', { method: 'POST', body: JSON.stringify({ accessToken }) }).then(startSession),
    verify: code => fetch('/api/sdc/verify?code=' + encodeURIComponent(code)).then(r => r.json()),
    publicSettings: () => api('/public').then(j => j.settings),
    // Signing out of a gateway session also drops the cached copy so the next person on this browser sees nothing.
    signOut() { if (token()) { localStorage.removeItem(TOKEN); localStorage.removeItem(DBKEY); localStorage.removeItem(STAMP); localStorage.removeItem(PENDING); } }
  };
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); flush(); } });
  window.SDCCloud.ready = new Promise(r => setTimeout(() => pull().finally(r), 100));
})();
