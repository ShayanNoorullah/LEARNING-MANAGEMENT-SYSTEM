/* SDC Learn — background cloud reconciliation. LocalStorage is rendered first; the cloud copy
   is pulled/pushed in the background and never blocks the UI when Supabase is slow or offline. */
(function () {
  const c = window.SDC_CLOUD_CONFIG || {};
  const configured = !!(c.enabled !== false && c.url && c.anonKey && !c.url.includes('YOUR_'));
  window.SDC_CLOUD_STATUS = configured ? 'Connecting…' : 'Local only (cloud sync off)';
  if (!configured || !window.supabase?.createClient) return;
  const client = window.supabase.createClient(c.url, c.anonKey, { auth: { persistSession: false } });
  const table = c.table || 'sdc_app_state', id = c.stateId || 'sdc-learn-main', PENDING = 'sdcCloudPending', STAMP = 'sdcCloudUpdatedAt';
  const useful = s => s && typeof s === 'object' && Array.isArray(s.users) && s.users.length > 0 && Array.isArray(s.courses);
  const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Cloud timeout')), ms))]);

  async function push(state) {
    const res = await withTimeout(client.from(table).upsert({ id, state, updated_at: new Date().toISOString() }, { onConflict: 'id' }));
    if (res.error) throw res.error;
    localStorage.setItem(STAMP, String(Date.now()));
  }
  async function pull() {
    try {
      const res = await withTimeout(client.from(table).select('state,updated_at').eq('id', id).maybeSingle());
      if (res.error) throw res.error;
      const remote = res.data?.state;
      if (localStorage.getItem(PENDING)) await flush();
      else if (useful(remote)) {
        const remoteAt = Date.parse(res.data.updated_at || 0) || 0, localAt = Number(localStorage.getItem(STAMP) || 0);
        if (remoteAt > localAt) {
          localStorage.setItem(DBKEY, JSON.stringify(normalizeState(remote)));
          localStorage.setItem(STAMP, String(remoteAt));
          invalidateCache();
          window.dispatchEvent(new Event('sdc-cloud-refresh'));
        }
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
  window.SDCCloud = {
    syncNow() { localStorage.setItem(PENDING, `${Date.now()}-${Math.random().toString(36).slice(2)}`); clearTimeout(timer); timer = setTimeout(flush, 400); },
    flushNow: flush, pullNow: pull, ready: null
  };
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); flush(); } });
  window.SDCCloud.ready = new Promise(r => setTimeout(() => pull().finally(r), 100));
})();
