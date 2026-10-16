/* SDC Learn — the Course Builder's provider choice. Every AI operation in the Course Builder (outline, full
   content, regenerate, repair, course check) goes through AIRoute.call, so they all behave the same whichever
   provider writes.
   - By default a request uses the provider and model Settings → Integrations gives the feature.
   - A coordinator may choose another configured provider for one course (for example when the first one
     ran out of quota). That choice is temporary: it lives in this browser tab (sessionStorage), is shown
     wherever it applies, and never changes any organisation setting.
   - Course Builder requests always carry noFallback: the server uses exactly the provider chosen and never
     spends tokens on another one on its own. Changing provider is always a person's decision.
   Rules about errors and providers: js/aiprovider-logic.js. */
const AIRoute = (() => {
  const APL = AIProviderLogic;
  const mem = new Map(), KEY = scope => 'sdcAiRoute:' + scope;
  function get(scope) {
    if (mem.has(scope)) return mem.get(scope);
    let v = null;
    try { v = JSON.parse(sessionStorage.getItem(KEY(scope)) || 'null'); } catch (e) { /* storage unavailable: no temporary choice */ }
    if (!(v && APL.PROVIDERS.includes(v.provider))) v = null;
    mem.set(scope, v);
    return v;
  }
  function set(scope, o) {
    const v = { provider: o.provider, profileId: o.profileId || '', model: o.model || '', label: o.label || APL.label(o.provider), at: new Date().toISOString() };
    mem.set(scope, v);
    try { sessionStorage.setItem(KEY(scope), JSON.stringify(v)); } catch (e) { /* kept in memory for this page */ }
    return v;
  }
  function clear(scope) {
    mem.set(scope, null);
    try { sessionStorage.removeItem(KEY(scope)); } catch (e) { /* nothing stored */ }
  }
  // What Settings → Integrations gives a feature (provider, key profile, model), as ai-client.js reads it.
  function fromSettings(feature) {
    const cap = Domain.aiCapRoute(feature) || {}, integ = Domain.integrations(), provider = cap.provider || integ.primaryProvider || 'openai';
    return { provider, profileId: cap.profileId || integ.defaultProfileId || '', model: cap.model || '', label: APL.label(provider), source: 'settings' };
  }
  // The route a request for `feature` will take right now: the temporary choice, else Settings'.
  function resolve(scope, feature) {
    const t = get(scope);
    return t ? { ...t, source: 'temporary' } : fromSettings(feature);
  }
  // Server answers with names and "has a key" only. Cached briefly; a failed read is not cached.
  let cache = null;
  async function status(force = false) {
    if (!force && cache && Date.now() - cache.at < 15000) return cache.v;
    let v = null;
    try { v = await SDCAI.status(); } catch (e) { /* the request itself reports a failure */ }
    cache = v ? { at: Date.now(), v } : null;
    return v;
  }
  // The route with the model filled in from the saved profile, for display.
  function named(r, st) {
    let model = r.model;
    if (!model && st) {
      const p = (st.profiles || []).find(x => r.profileId && x.id === r.profileId) || (st.profiles || []).find(x => x.provider === r.provider && x.enabled !== false);
      model = p?.model || p?.deployment || '';
    }
    return { ...r, model, label: `${APL.label(r.provider)}${model ? ' · ' + model : ''}` };
  }
  // Every Course Builder request. The temporary choice (if any) replaces provider, key profile and model for
  // this request only; noFallback keeps the server from trying anyone else.
  function call(scope, feature, opts = {}) {
    const t = get(scope);
    return SDCAI.call(feature, { ...opts, noFallback: true, ...(t ? { route: { provider: t.provider, profileId: t.profileId, model: t.profileId ? '' : t.model } } : {}) });
  }

  /* ------------------------------------------------------------ the list */
  const optionsFor = async stopped => APL.options(await status(true), { stopped });
  const firstUsable = list => list.find(o => o.usable)?.id || '';
  function listHTML(list, name, selected) {
    return `<div class="ap-list" role="radiogroup" aria-label="AI provider">${list.map(o => `<label class="ap-opt ${o.usable ? '' : 'off'}"><input type="radio" name="${esc(name)}" value="${esc(o.id)}" ${o.usable ? '' : 'disabled'} ${o.id === selected ? 'checked' : ''}><span class="ap-opt-body"><span class="ap-opt-head"><b>${esc(APL.label(o.provider))}</b>${o.current ? badge('Stopped', 'danger') : o.usable ? badge('Ready', 'success') : o.configured ? badge('Cannot be used', 'warning') : badge('Not set up', 'neutral')}</span>${o.model ? `<span class="ap-opt-model small">${esc(o.model)}</span>` : ''}${o.profileId && o.name ? `<span class="muted small">Key: ${esc(o.name)}</span>` : ''}${o.reason ? `<span class="ap-opt-reason small muted">${esc(o.reason)}</span>` : ''}</span></label>`).join('')}</div>`;
  }

  /* --------------------------------------------------------- the picker */
  // Choose a provider for this course without starting anything. Resolves with the chosen option, or null.
  async function pick({ scope, feature, title = 'Choose the AI provider', intro = '', confirmText = 'Use this provider', stopped = null }) {
    const list = await optionsFor(stopped);
    return new Promise(resolve => {
      let done = false;
      const sel = firstUsable(list);
      const m = openModal({
        title, size: 'md',
        body: `<div class="ap-picker-intro">${intro ? `<p class="confirm-text">${esc(intro)}</p>` : ''}<p class="small muted">Only providers an administrator has set up are available. Your choice applies to this ${esc(t('course', true))} in this browser tab; <b>Settings → Integrations is not changed</b>. Nothing is sent until you start an operation.</p></div>${list.length ? listHTML(list, 'ap-pick', sel) : '<p class="text-danger">The AI settings could not be read just now. Reload and try again.</p>'}`,
        footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-use ${sel ? '' : 'disabled'}>${esc(confirmText)}</button>`,
        onClose: () => { if (!done) resolve(null); }
      });
      m.addEventListener('change', () => { m.querySelector('[data-use]').disabled = !m.querySelector('input[name="ap-pick"]:checked'); });
      m.querySelector('[data-use]').onclick = () => {
        const id = m.querySelector('input[name="ap-pick"]:checked')?.value, o = list.find(x => x.id === id);
        if (!o) return;
        done = true; resolve(o); m.close();
      };
    });
  }

  /* ------------------------------------------------------ the status line */
  // Fills an element with "AI provider: X (from Settings)" or the temporary choice, with the buttons to change it.
  async function fillLine(el, scope, feature, { canChange = true, onChange } = {}) {
    if (!el) return;
    // Painted at once from what is already known (no blank flash while a run redraws the page), then again
    // when the server's answer about the providers arrives.
    const paint = st => {
      if (!el.isConnected) return;
      const r = named(resolve(scope, feature), st), temp = r.source === 'temporary';
      const opts = st ? APL.options(st) : null, mine = opts?.find(o => o.provider === r.provider && r.profileId && o.profileId === r.profileId) || opts?.find(o => o.provider === r.provider);
      el.innerHTML = `<span class="ap-line">${icon('sparkles', 13)} AI provider: <b>${esc(r.label)}</b> ${temp ? `${badge('Temporary choice', 'warning')} <span class="small muted">for this ${esc(t('course', true))} in this tab; Settings is unchanged.</span>` : '<span class="small muted">from Settings → Integrations</span>'}${mine && !mine.usable ? ` <span class="small text-danger">${esc(mine.reason)}</span>` : ''}${canChange ? ` <button type="button" class="btn btn-ghost btn-sm" data-ap-change>Change provider</button>${temp ? ` <button type="button" class="btn btn-ghost btn-sm" data-ap-reset>Use the Settings choice</button>` : ''}` : ''}</span>`;
      el.querySelector('[data-ap-change]')?.addEventListener('click', async () => {
        const o = await pick({ scope, feature, title: 'Choose the AI provider', intro: `Use another provider for the ${t('course', true)}'s AI work?`, stopped: null });
        if (!o) return;
        set(scope, o); toast(`Using ${o.label} for this ${t('course', true)}. Settings are unchanged.`); onChange?.();
      });
      el.querySelector('[data-ap-reset]')?.addEventListener('click', () => { clear(scope); toast('Back to the provider set in Settings.'); onChange?.(); });
    };
    paint(cache?.v || null);
    const st = await status();
    if (st) paint(st);
  }

  return { get, set, clear, resolve, fromSettings, named, status, call, optionsFor, firstUsable, listHTML, pick, fillLine };
})();
