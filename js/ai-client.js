/* SDC Learn AI — thin browser client for /api/ai/* */
(function () {
  const TOKEN_KEY = 'sdcAiToken';
  async function bearer() {
    try {
      const g = localStorage.getItem('sdcCloudToken');
      if (g) return g;
    } catch (e) {}
    try {
      const t = sessionStorage.getItem(TOKEN_KEY);
      if (t) return t;
    } catch (e) {}
    const u = typeof currentUser === 'function' ? currentUser() : null;
    if (!u) throw new Error('Sign in to use SDC Learn AI.');
    const r = await fetch('/api/ai/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: u.id }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not start an AI session.');
    try { sessionStorage.setItem(TOKEN_KEY, j.token); } catch (e) {}
    return j.token;
  }
  // Errors carry .status and .code (rate_limit, budget, not_configured, forbidden, unauthorized, provider,
  // provider_busy with .retryAfterMs, provider_quota, provider_auth, provider_model, provider_too_large, timeout) and the .provider that failed, so a page can tell them apart. timeoutMs stops waiting after that long (code 'timeout').
  async function api(path, body, method = 'POST', timeoutMs = 0) {
    const token = await bearer();
    const ctl = timeoutMs ? new AbortController() : null, timer = ctl && setTimeout(() => ctl.abort(), timeoutMs);
    let r;
    try {
      r = await fetch('/api/ai' + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
        signal: ctl?.signal
      });
    } catch (e) {
      if (ctl?.signal.aborted) throw Object.assign(new Error('The AI took too long to answer. Try again, or reduce the size of the request.'), { code: 'timeout' });
      throw e;
    } finally { clearTimeout(timer); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    }
    if (!r.ok) throw Object.assign(new Error(j.error || `AI request failed (${r.status})`), { status: r.status, code: j.code, ...(j.retryAfterMs ? { retryAfterMs: j.retryAfterMs } : {}), ...(j.provider ? { provider: j.provider } : {}), ...(j.model ? { model: j.model } : {}) });
    return j;
  }
  function capRoute(feature) {
    const cap = Domain.aiCapRoute(feature) || {};
    const integ = Domain.integrations();
    const provider = cap.provider || integ.primaryProvider || 'openai';
    const profileId = cap.profileId || integ.defaultProfileId || '';
    return {
      feature, provider, profileId, model: cap.model || undefined,
      temperature: cap.temperature, stripPii: integ.stripPiiDefault !== false,
      fallbackProvider: integ.fallbackProvider, primaryProvider: integ.primaryProvider,
      budget: integ.budget || {}
    };
  }
  window.SDCAI = {
    async status() {
      const r = await fetch('/api/ai/status');
      return r.json();
    },
    configure: body => api('/configure', body),
    test: body => api('/test', body),
    // Groq's model list for a saved or pasted key: { models: [{ id, contextWindow, maxOutput, ownedBy }] }
    models: body => api('/models', body, 'POST', 15000),
    // YouTube key for the Course Builder's videos: { apiKey } saves, { test: true } tests, { remove: true } removes.
    youtube: body => api('/youtube', body, 'POST', 20000),
    // { feature: 'courseGenerate' | 'courseContent', queries: [phrase] } -> { results: [[{ id, title, channel, duration }] | null] }
    videos: body => api('/videos', body, 'POST', 60000),
    // json: ask the provider for JSON mode. timeoutMs: give up waiting after that long. capability: use
    // another feature's provider settings (usage is still counted under `feature`). All are optional;
    // without them the request is exactly what it always was.
    // noFallback: the server uses only the chosen provider and reports its failure instead of trying another.
    // route: { provider, profileId, model } for this request only, instead of the one Settings → Integrations gives
    // the feature (the Course Builder's temporary provider choice). It never changes any setting.
    async call(feature, { system, prompt, messages, scrubNames, maxTokens, json, timeoutMs, capability, noFallback, route: pick } = {}) {
      if (!Domain.aiEnabled()) throw new Error('SDC Learn AI is turned off in Settings.');
      if (!can('ai', 'use') && !can('ai', 'configure')) throw new Error('You do not have permission to use SDC Learn AI.');
      const route = { ...capRoute(capability || feature), ...(pick?.provider ? { provider: pick.provider, profileId: pick.profileId || '', model: pick.model || undefined } : {}), feature };
      return api('/complete', { ...route, system, prompt, messages, scrubNames, maxTokens, ...(json ? { json: true } : {}), ...(noFallback ? { noFallback: true } : {}) }, 'POST', timeoutMs || 0);
    },
    badge(html) {
      return `<span class="ai-badge" title="Generated with SDC Learn AI">${typeof icon === 'function' ? icon('sparkles', 12) : ''} SDC Learn AI</span>${html || ''}`;
    }
  };
})();
