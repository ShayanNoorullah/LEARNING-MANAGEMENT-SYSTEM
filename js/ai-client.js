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
  async function api(path, body, method = 'POST') {
    const token = await bearer();
    const r = await fetch('/api/ai' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: method === 'GET' ? undefined : JSON.stringify(body || {})
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    }
    if (!r.ok) throw new Error(j.error || `AI request failed (${r.status})`);
    return j;
  }
  function capRoute(feature) {
    const cap = Domain.aiCap(feature) || {};
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
    async call(feature, { system, prompt, messages, scrubNames, maxTokens } = {}) {
      if (!Domain.aiEnabled()) throw new Error('SDC Learn AI is turned off in Settings.');
      if (!can('ai', 'use') && !can('ai', 'configure')) throw new Error('You do not have permission to use SDC Learn AI.');
      const route = capRoute(feature);
      return api('/complete', { ...route, system, prompt, messages, scrubNames, maxTokens });
    },
    badge(html) {
      return `<span class="ai-badge" title="Generated with SDC Learn AI">${typeof icon === 'function' ? icon('sparkles', 12) : ''} SDC Learn AI</span>${html || ''}`;
    }
  };
})();
