/* SDC Learn — background cloud reconciliation. LocalStorage is rendered first; the cloud copy
   is pulled/pushed in the background and never blocks the UI when the cloud is slow or offline.
   Gateway mode (server has SDC_STATE_SECRET): every read/write goes through /api/sdc with a
   signed session token, and sign-in is checked on the server. Direct mode (legacy, until the
   gateway is configured): the browser reads/writes the Supabase row with the publishable key.

   A change has one of three fates, and the app always says which (SDCCloud.status()):
     local   saved in this browser only (pending marker set), not yet confirmed by the server
     saved   the server answered the save: only then is the pending marker removed
     failed  the server could not be reached, refused the sign-in (auth) or this browser cannot store (storage)
   Nothing is reported as saved, and no pending marker is removed, without the server's answer. When the
   sign-in expires, the unsent changes are set aside per account (sdcRescue:<userId>, see js/sync-recover.js)
   and replayed against the server's current copy after that same account signs in again; anything the
   server changed meanwhile is listed as a conflict instead of being overwritten. */
(function () {
  const c = window.SDC_CLOUD_CONFIG || {};
  const off = c.enabled === false;
  const SR = window.SyncRecover;
  const table = c.table || 'sdc_app_state', id = c.stateId || 'sdc-learn-main', PENDING = 'sdcCloudPending', STAMP = 'sdcCloudUpdatedAt', TOKEN = 'sdcCloudToken';
  const OWNER = 'sdcCloudOwner', AUTHLOST = 'sdcCloudAuthLost', RESCUE = 'sdcRescue:', RECOVERED = 'sdcRecovered';
  // Characters. Browsers allow about 5 million per site, but the whole state also travels in one request
  // and Vercel rejects requests over 4.5 MB, so the lower server-safe limit from js/core.js (STATE_MAX) applies.
  const STORAGE_LIMIT = typeof STATE_MAX === 'number' ? STATE_MAX : 4300000;
  const useful = s => s && typeof s === 'object' && Array.isArray(s.users) && s.users.length > 0 && Array.isArray(s.courses);
  const withTimeout = (p, ms = 8000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Cloud timeout')), ms))]);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };
  const token = () => lsGet(TOKEN);
  // The server's version of the copy. If the browser cannot store it (full), it is kept in memory: a save the
  // server confirmed is never turned into a failure by this bookkeeping.
  let memStamp = 0;
  const stamp = () => Math.max(Number(lsGet(STAMP) || 0), memStamp);
  function setStamp(v) { memStamp = Number(v) || 0; try { localStorage.setItem(STAMP, String(v)); } catch (e) {} }

  /* ---------------------------------------------------------------- status */
  let memPending = null, memAuth = false, storageFailed = null, lastError = null, failures = 0, lastSavedAt = 0, inflight = false, booting = !off, localOnly = false, conflictCount = 0;
  const getPending = () => lsGet(PENDING) || memPending;
  // The marker normally lives in localStorage (it survives a reload). If the browser cannot store even
  // that, it is kept in memory and the problem is reported (storage).
  function setPending(tag) {
    try { localStorage.setItem(PENDING, tag); memPending = null; }
    catch (e) { memPending = tag; noteStorageFailure(e); }
  }
  function clearPending() { lsDel(PENDING); memPending = null; }
  const authFlag = () => memAuth || !!lsGet(AUTHLOST);
  const LABEL = {
    off: 'Local only (cloud sync off)', connecting: 'Connecting…', saved: 'Connected — all changes are saved to the server', saving: 'Saving to the server…',
    local: 'Changes are saved on this device only — the server has not confirmed them yet',
    failed: 'Offline — changes are kept on this device and have NOT been saved to the server yet',
    auth: 'Your sign-in expired — changes are kept on this device but are NOT saved to the server. Sign in again.',
    storage: 'This browser has no room left — recent changes may NOT be kept. Save them to the server or download a backup.'
  };
  function derive() {
    if (off || localOnly) return 'off';
    if (authFlag()) return 'auth';
    if (storageFailed) return 'storage';
    if (inflight) return 'saving';
    if (getPending()) return lastError ? 'failed' : 'local';
    return booting ? 'connecting' : 'saved';
  }
  function status() {
    const state = derive();
    return { state, text: LABEL[state], pending: !!getPending(), lastSavedAt, failures, error: lastError ? String(lastError.message || lastError) : '', storageError: storageFailed ? String(storageFailed.message || storageFailed) : '', conflicts: conflictCount, userId: owner() };
  }
  function refresh() {
    conflictCount = readRescue(owner())?.conflicts?.length || 0;
    const s = status();
    window.SDC_CLOUD_STATUS = s.text;
    window.SDC_SYNC = s;
    try { window.dispatchEvent(new Event('sdc-sync-status')); } catch (e) {}
  }
  function noteStorageFailure(e) { storageFailed = e || new Error('Storage full'); if (!getPending()) memPending = `mem-${Date.now()}`; refresh(); }
  function storageOk() { if (storageFailed) { storageFailed = null; if (memPending) { const t = memPending; memPending = null; try { localStorage.setItem(PENDING, t); } catch (e) { memPending = t; storageFailed = e; } } refresh(); } }

  /* ------------------------------------------------------------- sync base */
  /* Sync base: for each record of every collection (and each object such as settings) this copy last
     received from (or saved to) the server, its id and a hash of its content (js/sync-recover.js). It is
     stored inside the state itself (state._sync), so it always belongs to the copy it describes, even
     when several tabs share localStorage. Each save sends base.known (the ids of the 14 protected
     collections, TRACKED, the same list as PROTECTED in backend/state-api.js: only these can be deleted,
     so a stale copy never removes a record it never saw) and base.fresh (the ones not changed since: the
     server keeps its own newer version of those instead of the stale one). */
  const SYNC = SR.SYNC, TRACKED = ['courses', 'sessions', 'batches', 'enrollments', 'assignments', 'quizzes', 'quizAttempts', 'submissions', 'attendance', 'progress', 'results', 'feedback', 'certificates', 'fees'];
  const baseOf = s => { const o = SR.baseOf(s); TRACKED.forEach(k => { if (!o[k]) o[k] = {}; }); return o; };
  const wire = (base, now) => {
    const known = {}, fresh = {};
    TRACKED.forEach(k => { const b = base?.[k] || {}; known[k] = Object.keys(b); fresh[k] = Object.keys(now[k] || {}).filter(id => Object.prototype.hasOwnProperty.call(b, id) && b[id] === now[k][id]); });
    return { known, fresh };
  };
  // Server versions carry microseconds; Date.parse keeps milliseconds, so two saves in the same
  // millisecond would look equal. Versions are compared as whole microseconds.
  const micros = v => {
    const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(String(v || '').trim());
    if (!m) return (Date.parse(v) || 0) * 1000;
    const tz = !m[4] || m[4] === 'Z' ? 'Z' : m[4].length === 3 ? m[4] + ':00' : m[4].replace(/^([+-]\d\d)(\d\d)$/, '$1:$2');
    const ms = Date.parse(`${m[1]}T${m[2]}${tz}`);
    return Number.isFinite(ms) ? ms * 1000 + Number(((m[3] || '') + '000000').slice(0, 6)) : 0;
  };
  // Gateway detection is cached for this tab only when the server ANSWERED (status is not a secret).
  // If the status request fails, the mode is 'offline' (fail closed): the browser never falls back to
  // writing the Supabase row directly, because that path has no server checks. 'offline' is not
  // cached, so the next sync attempt asks again.
  let modeP = null;
  async function detect() {
    try {
      const c = sessionStorage.getItem('sdcGwMode');
      if (c === 'gateway' || c === 'direct') return c;
    } catch (e) {}
    try {
      const r = await withTimeout(fetch('/api/sdc/status'));
      if (!r.ok) return 'offline';
      const j = await r.json();
      if (!j || typeof j.gateway !== 'boolean') return 'offline';
      const m = j.gateway ? 'gateway' : 'direct';
      try { sessionStorage.setItem('sdcGwMode', m); } catch (e) {}
      return m;
    } catch (e) { return 'offline'; }
  }
  const mode = () => {
    if (off) return Promise.resolve('off');
    if (!modeP) { const p = detect(); modeP = p; p.then(m => { if (m === 'offline' && modeP === p) modeP = null; }); }
    return modeP;
  };
  let client = null;
  const direct = async () => client || (c.url && c.anonKey && !c.url.includes('YOUR_') ? (client = (await loadSupabase()).createClient(c.url, c.anonKey, { auth: { persistSession: false } })) : null);

  /* --------------------------------------------- unsent changes and sign-in */
  // Whose copy is in this browser: set when that account signed in; older sessions fall back to the page session.
  const owner = () => lsGet(OWNER) || (() => { try { return sessionStorage.getItem('sdcSession'); } catch (e) { return null; } })() || lsGet('sdcRemember') || '';
  function readRescue(uid) { if (!uid) return null; try { const r = JSON.parse(lsGet(RESCUE + uid) || 'null'); return r && r.userId === uid ? r : null; } catch (e) { return null; } }
  function writeRescue(uid, r) {
    const empty = !(r && ((r.changes && Object.keys(r.changes).length) || (r.conflicts && r.conflicts.length)));
    try { if (empty) localStorage.removeItem(RESCUE + uid); else localStorage.setItem(RESCUE + uid, JSON.stringify(r)); return true; } catch (e) { return false; }
  }
  // Sets the unsent changes of this browser's copy aside under the owning account. The copy itself is not
  // touched. ok:false = they could not be kept (browser storage is full): the caller must not discard them.
  function captureRescue() {
    try {
      const raw = lsGet(DBKEY), uid = owner();
      if (!raw) return { ok: true, count: 0, userId: uid };
      const st = JSON.parse(raw), d = SR.delta(st, st[SYNC]);
      if (!d.count) return { ok: true, count: 0, userId: uid };
      // An unknown owner is kept under '?': no account replays it, but it is not thrown away either.
      const key = uid || '?', prev = readRescue(key);
      const r = { v: 1, userId: key, at: Date.now(), kind: d.kind, count: d.count, changes: d.changes, conflicts: prev?.conflicts || [] };
      return writeRescue(key, r) ? { ok: true, count: d.count, userId: key } : { ok: false, count: d.count, reason: 'storage', userId: key };
    } catch (e) { return { ok: false, count: 0, reason: 'error', error: e.message }; }
  }
  // The sign-in is no longer accepted by the server. The copy and the pending marker stay; the unsent
  // changes are also set aside; the person is asked to sign in again (never signed out silently).
  function lostAuth() {
    lsDel(TOKEN);
    const cap = getPending() ? captureRescue() : { ok: true, count: 0 };
    try { localStorage.setItem(AUTHLOST, JSON.stringify({ at: Date.now(), userId: owner(), kept: cap.ok })); } catch (e) { memAuth = true; }
    refresh();
    return cap;
  }
  function authError(msg) { const e = new Error(msg || 'Your session has expired. Please sign in again.'); e.status = 401; e.code = 'auth_expired'; return e; }

  async function api(path, opts = {}, ms) {
    const t = token(), r = await withTimeout(fetch('/api/sdc' + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) } }), ms);
    const j = await r.json().catch(() => ({}));
    const signingIn = path === '/login' || path === '/google' || path === '/verify' || path === '/public';
    if (r.status === 401 && !signingIn) lostAuth();
    if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; e.code = r.status === 401 && !signingIn ? 'auth_expired' : j.code; throw e; }
    return j;
  }
  // The returned copy replaces this one. rescue (optional): unsent changes of the same account, replayed
  // onto the server's copy first. at: the server version in microseconds (see micros).
  function adopt(state, at, rescue) {
    const s = normalizeState(state);
    const base = baseOf(s); // the server's copy as confirmed, before anything is replayed onto it
    const result = rescue?.changes && Object.keys(rescue.changes).length ? SR.apply(rescue.changes, s, rescue.kind || 'v2') : null;
    s[SYNC] = base;
    localStorage.setItem(DBKEY, JSON.stringify(s));
    setStamp(at || Date.now() * 1000);
    clearPending();
    if (result?.applied.length) setPending(`${Date.now()}-recovered`);
    invalidateCache();
    return result;
  }
  async function remote() {
    const m = await mode();
    if (m === 'gateway') { if (!token()) return null; const j = await api('/state', {}, 30000); return { state: j.state, at: micros(j.updatedAt) }; }
    const cl = m === 'direct' && await direct(); if (!cl) return null;
    const res = await withTimeout(cl.from(table).select('state,updated_at').eq('id', id).maybeSingle());
    if (res.error) throw res.error;
    return { state: res.data?.state, at: micros(res.data?.updated_at) };
  }
  // Resolves with the server's answer, or throws. It never resolves to "saved" for a save the server did not confirm.
  async function push(state) {
    const m = await mode();
    if (m === 'off') { localOnly = true; return { local: true }; }
    // Throw (not return) so the pending flag stays set and the change is retried once the server answers.
    if (m === 'offline') throw new Error('Cloud gateway status unavailable; changes stay on this device');
    const { [SYNC]: base, ...body } = state || {};
    if (m === 'gateway') {
      if (!token()) { lostAuth(); throw authError(); }
      // Captured now: a record changed or deleted while the request is in flight must not count as saved.
      const rawAtStart = lsGet(DBKEY), now = baseOf(state), cmp = base && base._v === SR.VERSION ? now : SR.baseOf(state, SR.legacyHash);
      const j = await api('/state', { method: 'PUT', body: JSON.stringify({ state: body, base: wire(base, cmp) }) }, 30000);
      // The saved copy is the new base, but only for this tab's own copy: if another tab replaced it
      // meanwhile, that copy keeps its own base.
      if (db() === state) {
        state[SYNC] = now;
        // Written back right away when nothing else wrote meanwhile, so a reload keeps the confirmed base.
        try { if (rawAtStart !== null && lsGet(DBKEY) === rawAtStart) localStorage.setItem(DBKEY, JSON.stringify(state)); } catch (e) {}
      }
      // Server time, so the next pull compares server versions. When the server kept or undid something,
      // stop just short of its version, so the next pull takes its copy even if the resync below fails.
      const at = micros(j.updatedAt) || Date.now() * 1000;
      setStamp(j.resync || j.rejected ? at - 1 : at);
      return j;
    }
    const cl = m === 'direct' && await direct();
    if (!cl) { localOnly = true; return { local: true }; }
    const res = await withTimeout(cl.from(table).upsert({ id, state: body, updated_at: new Date().toISOString() }, { onConflict: 'id' })); if (res.error) throw res.error;
    setStamp(Date.now() * 1000);
    return {};
  }
  // The server kept or undid something (rejected / resync): take its copy unless the user changed more meanwhile.
  async function resync(j) {
    // The server did not accept some changes (this account may not make them) and keeps its own copy: say so, do not lose them silently.
    if (j.rejected?.length) { console.warn('Cloud kept its copy of', j.rejected.length, 'record(s) this account may not change.'); window.SDC_SYNC_REJECTED = j.rejected; try { window.dispatchEvent(new Event('sdc-sync-rejected')); } catch (e) {} }
    const r = await remote();
    if (r && useful(r.state) && !getPending()) { try { adopt(r.state, r.at); } catch (e) { return noteStorageFailure(e); } window.dispatchEvent(new Event('sdc-cloud-refresh')); }
  }
  async function pull() {
    try {
      // A browser signed in before the gateway existed has no token: sign in again so changes reach the cloud.
      // Unsent changes are never dropped for that: they are kept and the person is asked to sign in again.
      if (await mode() === 'gateway' && !token() && typeof App !== 'undefined' && currentUser()) {
        if (getPending() || authFlag()) { lostAuth(); booting = false; refresh(); return; }
        return logout();
      }
      // Sign-in already returned the latest data; skip the immediate re-download on the first page load.
      // Unsent changes (for example ones replayed after signing in again) are still sent.
      let fresh = false;
      try { if (Date.now() - Number(sessionStorage.getItem('sdcFreshAt') || 0) < 15000) { sessionStorage.removeItem('sdcFreshAt'); fresh = true; } } catch (e) {}
      if (fresh) { if (getPending()) await flush(); else lastError = null; booting = false; refresh(); return; }
      const r = await remote();
      if (!r) { booting = false; refresh(); return; }
      if (getPending()) await flush();
      else if (useful(r.state)) {
        if (r.at > stamp()) { try { adopt(r.state, r.at); } catch (e) { noteStorageFailure(e); throw e; } window.dispatchEvent(new Event('sdc-cloud-refresh')); }
      } else await push(db());
      lastError = null;
    } catch (e) { lastError = e; console.warn('Cloud sync unavailable; working locally.', e); }
    booting = false; refresh();
  }

  /* ---------------------------------------------------------------- saving */
  // Pushes are debounced and serialised so an older snapshot can never overwrite a newer one. Tabs of
  // one browser take turns (Web Locks); a tab's in-memory copy is dropped when another tab stores (the
  // storage event in js/core.js), so after waiting for its turn it sends the newest shared copy.
  let running = null, dirty = false, timer = null, retryTimer = null;
  const RETRY = [3000, 10000, 30000, 60000, 120000];
  const exclusive = fn => typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request ? navigator.locks.request('sdc-cloud-push', fn) : fn();
  function scheduleRetry() { clearTimeout(retryTimer); retryTimer = setTimeout(() => { flush(); }, RETRY[Math.min(failures, RETRY.length) - 1] || 120000); }
  async function once() {
    const tag = getPending();
    if (!tag) return;
    inflight = true; refresh();
    try {
      // The marker is removed inside the turn, before the next tab's turn starts, so a second tab
      // never sends the same change again; and only after the server's answer.
      let cleared = false;
      const j = await exclusive(async () => {
        if (!getPending()) return { shared: true }; // another tab already got the server's confirmation
        const r = await push(db());
        if (getPending() === tag) { clearPending(); cleared = true; }
        return r;
      });
      lastError = null; failures = 0; clearTimeout(retryTimer);
      if (!j?.local) lastSavedAt = Date.now();
      // If it changed while saving, the marker stays and the next round (already scheduled by that change) sends it.
      if (cleared && j && (j.resync || j.rejected)) await resync(j);
    } catch (e) {
      lastError = e; failures++;
      if (e.code !== 'auth_expired') scheduleRetry();
      console.warn('Cloud save not confirmed:', e);
    } finally { inflight = false; booting = false; refresh(); }
  }
  async function flush() {
    if (running) { dirty = true; return running; }
    running = (async () => { do { dirty = false; await once(); } while (dirty); })();
    try { return await running; } finally { running = null; }
  }

  /* --------------------------------------------------------------- sign-in */
  async function startSession(j) {
    // 1. whoever used this browser before: keep their unsent changes (they are never written to this
    //    account's copy and are only replayed when that same account signs in again)
    const cap = getPending() || authFlag() ? captureRescue() : { ok: true, count: 0 };
    if (!cap.ok) {
      const e = new Error('This browser holds unsaved changes that could not be set aside' + (cap.reason === 'storage' ? ' because browser storage is full' : '') + '. Download them first, or discard them to continue.');
      e.code = 'unsaved_changes'; throw e;
    }
    const full = e => Object.assign(new Error('Signed in, but this browser could not store your data (' + (e.message || 'storage full') + '). Free up space and try again.'), { code: 'storage_full' });
    try { localStorage.setItem(TOKEN, j.token); } catch (e) { throw full(e); }
    // 2. the server's current copy, with this account's unsent changes replayed onto it
    const rescue = readRescue(j.userId);
    let result = null;
    try { result = adopt(j.state, micros(j.updatedAt), rescue); }
    catch (e) { lsDel(TOKEN); throw full(e); }
    try { localStorage.setItem(OWNER, j.userId); } catch (e) {}
    lsDel(AUTHLOST); memAuth = false; lastError = null; failures = 0; localOnly = false;
    // 3. what the replay could not apply stays for the person to decide; the rest is now in the copy
    if (rescue) {
      const keep = new Map((rescue.conflicts || []).map(x => [x.collection + '|' + x.id, x]));
      (result?.conflicts || []).forEach(x => keep.set(x.collection + '|' + x.id, { ...x, at: Date.now() }));
      const left = { ...rescue, changes: {}, count: 0, conflicts: [...keep.values()] };
      const stored = writeRescue(j.userId, left);
      try { sessionStorage.setItem(RECOVERED, JSON.stringify({ applied: result?.applied.length || 0, already: result?.already.length || 0, conflicts: (result?.conflicts || []).length, kept: stored })); } catch (e) {}
    }
    try { sessionStorage.setItem('sdcFreshAt', String(Date.now())); } catch (e) {}
    refresh();
    return j.userId;
  }

  /* --------------------------------------------------------------- storage */
  function usage() {
    let used = 0;
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += k.length + (localStorage.getItem(k) || '').length; } }
    catch (e) { used = (lsGet(DBKEY) || '').length; }
    return { used, limit: STORAGE_LIMIT, free: Math.max(0, STORAGE_LIMIT - used), pct: Math.min(100, Math.round(used * 100 / STORAGE_LIMIT)) };
  }

  /* ------------------------------------------------------ the public object */
  // Everything the person has not saved yet, as a file they can keep: this copy's changes plus anything set aside.
  function unsavedExport() {
    const st = (() => { try { return db(); } catch (e) { return null; } })(), d = st ? SR.delta(st, st[SYNC]) : { changes: {}, count: 0 }, r = readRescue(owner());
    if (!d.count && !r) return null;
    return { app: 'sdc-learn', kind: 'unsaved-changes', userId: owner(), exportedAt: new Date().toISOString(), changes: d.changes, setAside: r ? { changes: r.changes, conflicts: r.conflicts } : null, note: 'Records this browser changed but the server has not confirmed. Not a full backup.' };
  }
  window.SDCCloud = {
    syncNow() { setPending(`${Date.now()}-${Math.random().toString(36).slice(2)}`); clearTimeout(timer); timer = setTimeout(flush, 400); refresh(); },
    flushNow: flush, pullNow: pull, ready: null,
    gateway: () => mode().then(m => m === 'gateway'),
    mode: () => mode(), // 'off' | 'gateway' | 'direct' | 'offline'
    status, usage, unsavedExport,
    hasPending: () => !!getPending(),
    retryNow() { failures = 0; clearTimeout(retryTimer); return flush(); },
    signIn: (email, password, remember) => api('/login', { method: 'POST', body: JSON.stringify({ email, password, remember }) }).then(startSession),
    signInGoogle: accessToken => api('/google', { method: 'POST', body: JSON.stringify({ accessToken }) }).then(startSession),
    verify: code => fetch('/api/sdc/verify?code=' + encodeURIComponent(code)).then(r => r.json()),
    publicSettings: () => api('/public').then(j => j.settings),
    // AI course drafts (the generator page arrives in a later stage). Errors carry .status and .code.
    safeWrite: () => fetch('/api/sdc/status').then(r => r.json()).then(j => j.gateway === true && j.safeWrite === true).catch(() => false),
    aiDraft: body => api('/courses/ai-draft', { method: 'POST', body: JSON.stringify(body) }),
    aiDraftStatus: genId => api('/courses/ai-draft/' + encodeURIComponent(genId)),
    // Browser storage: called by persist() (js/core.js) when the copy cannot be stored / can be stored again.
    storageFailed: noteStorageFailure, storageOk,
    // The person is about to sign in again: set the unsent changes aside and let go of the page session
    // so the sign-in page opens. The copy itself stays until the new sign-in has replayed it.
    prepareReauth() { const cap = captureRescue(); if (cap.ok) { try { sessionStorage.removeItem('sdcSession'); } catch (e) {} lsDel('sdcRemember'); } return cap; },
    // Before signing out: unsent changes are set aside, never thrown away.
    beforeSignOut() { return getPending() || authFlag() ? captureRescue() : { ok: true, count: 0 }; },
    // Discards what this browser holds unsent for the account that owned it (the person chose to).
    discardUnsaved() { const uid = owner(); if (uid) lsDel(RESCUE + uid); clearPending(); lsDel(AUTHLOST); memAuth = false; lsDel(DBKEY); refresh(); },
    // Conflicts left by a replay, for the signed-in account only.
    conflicts: () => (readRescue(owner())?.conflicts || []).slice(),
    resolveConflict(index, choice) {
      const uid = owner(), r = readRescue(uid), cf = r?.conflicts?.[index];
      if (!cf) return false;
      if (choice === 'mine') { const d = db(); if (!SR.useMine(d, cf)) return false; saveDB(d); }
      r.conflicts.splice(index, 1); writeRescue(uid, r); refresh();
      return true;
    },
    // Signing out of a gateway session also drops the cached copy so the next person on this browser sees nothing.
    signOut() { if (token() || authFlag()) { lsDel(TOKEN); lsDel(DBKEY); lsDel(STAMP); memStamp = 0; lsDel(OWNER); clearPending(); lsDel(AUTHLOST); memAuth = false; } try { sessionStorage.removeItem('sdcGwMode'); } catch (e) {} },
    // A restore or reset replaces the local copy; keeping the current base lets that save delete and
    // overwrite what the replaced copy had, as the person asked.
    carryBase(from, to) { if (to) { if (from?.[SYNC]) to[SYNC] = from[SYNC]; else delete to[SYNC]; } return to; }
  };
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); flush(); } if (getPending() && !token()) captureRescue(); });
  window.addEventListener('online', () => { if (getPending()) { failures = 0; flush(); } });
  window.addEventListener('storage', e => {
    if (e.key === PENDING || e.key === AUTHLOST || (e.key && e.key.startsWith(RESCUE))) refresh();
    // Another tab signed in again: this tab's copy was replaced, so draw it again.
    if (e.key === TOKEN && e.newValue && !e.oldValue) { memAuth = false; refresh(); try { window.dispatchEvent(new Event('sdc-cloud-refresh')); } catch (x) {} }
  });
  // Unsent changes of a signed-out browser (the page was closed after the sign-in expired) are set aside
  // before anything else on a sign-in page can replace the copy.
  try { if (!off && lsGet(PENDING) && !lsGet(TOKEN)) captureRescue(); } catch (e) {}
  refresh();
  window.SDCCloud.ready = new Promise(r => setTimeout(() => pull().finally(r), 100));
})();
