/* SDC Learn — provider-neutral rules for the Course Builder: what an AI failure means in plain words (the
   same for OpenAI, Gemini, Azure OpenAI and Groq), which providers can take over, what was written by whom,
   and whether a course is waiting on a provider. Pure functions: no DOM, no network, no settings are changed.
   Also loaded by the tests in Node (typeof module guard). */
const AIProviderLogic = (() => {
  const PROVIDERS = ['openai', 'gemini', 'azure_openai', 'groq'];
  const LABEL = { openai: 'OpenAI', gemini: 'Gemini', azure_openai: 'Azure OpenAI', groq: 'Groq' };
  const label = p => LABEL[p] || p || 'the AI provider';
  // What the server uses when a profile names no model (backend/ai-api.js). Azure and Groq have none built in.
  const DEFAULT_MODEL = { openai: 'gpt-4o-mini', gemini: 'gemini-3.5-flash-lite', azure_openai: '', groq: '' };
  // Speech, image, embedding and safety models do not write text; the server refuses them with the same words.
  const NOT_TEXT = /whisper|tts|orpheus|playai|guard|compound|embed|moderation|dall-e|imagen|veo-|transcribe/i;

  /* ---------------------------------------------------------------- errors */
  // code -> what it means. `pause`: the whole run should stop and ask the coordinator (switching or waiting
  // can help). `swap`: another provider can take over. `retry`: asking the same provider again can work.
  const KINDS = {
    provider_quota: { kind: 'quota', pause: true, swap: true, retry: true },
    provider_busy: { kind: 'rate', pause: true, swap: true, retry: true },
    provider_auth: { kind: 'auth', pause: true, swap: true, retry: false },
    provider_model: { kind: 'model', pause: true, swap: true, retry: false },
    provider_too_large: { kind: 'size', pause: true, swap: true, retry: false },
    not_configured: { kind: 'setup', pause: true, swap: true, retry: false },
    provider_unavailable: { kind: 'down', pause: true, swap: true, retry: true },
    provider_blocked: { kind: 'blocked', pause: false, swap: true, retry: true },
    rate_limit: { kind: 'platform', pause: false, swap: false, retry: false },
    budget: { kind: 'budget', pause: false, swap: false, retry: false },
    unauthorized: { kind: 'signin', pause: false, swap: false, retry: false },
    forbidden: { kind: 'denied', pause: false, swap: false, retry: false }
  };
  const kindOf = code => KINDS[code] || { kind: 'error', pause: false, swap: true, retry: true };

  // A failure in words for the Course Builder: a title, what it means, and what a person can do.
  function explain(e = {}) {
    const k = kindOf(e.code), p = label(e.provider), m = e.model ? ` (${e.model})` : '';
    const wait = e.retryAfterMs ? ` It asked to wait about ${Math.max(1, Math.round(e.retryAfterMs / 1000))} seconds.` : '';
    const T = {
      quota: [`${p}'s quota is used up`, `${p}${m} will not accept more requests until its quota resets or is raised. What was finished is saved.`],
      rate: [`${p} is limiting requests right now`, `${p}${m} is receiving or sending too much at the moment.${wait} It is a temporary limit, not a used-up quota.`],
      auth: [`${p} rejected the API key`, `The key saved for ${p} was refused. An administrator can fix it in Settings → Integrations. Until then another provider can continue.`],
      model: [`${p} cannot use this model`, `${p}${m} is not available for this key or does not write text. An administrator can choose another model in Settings → Integrations; another provider can continue meanwhile.`],
      size: [`The request is too large for ${p}`, `${p}${m} cannot take a request of this size. Another provider or a model with a larger limit can continue.`],
      setup: [`${p} is not set up`, `No API key is saved for ${p}, so nothing was sent. An administrator can add it in Settings → Integrations.`],
      down: [`${p} is not answering`, `${p}${m} failed several requests in a row. It may be having an outage. You can retry it or let another provider continue.`],
      blocked: [`${p} declined this request`, `${p}${m} did not answer this one (${e.message || 'blocked'}).`],
      platform: ['This platform has reached its hourly AI limit', 'The limit is on SDC Learn, not on the provider, so another provider does not help. What was finished is saved; continue later.'],
      budget: ['The monthly AI budget is reached', 'Ask an administrator to raise the limit in Settings → Integrations. Another provider does not help.'],
      signin: ['Your sign-in ended', 'Sign in again; what was finished is saved. Nothing was sent to another provider.'],
      denied: ['You cannot do this', e.message || 'Your role does not allow this.'],
      error: [`${p} could not do this`, e.message || 'The AI request failed.']
    }[k.kind];
    return { kind: k.kind, title: T[0], detail: T[1], canSwap: k.swap, canRetry: k.retry, pauses: k.pause };
  }

  /* ------------------------------------------------------------- providers */
  // Every provider, with the profiles that have a key, whether each can write course text, and why not.
  // status: what GET /api/ai/status returns (names, models and a masked key; never a key).
  // stopped: the route that just failed, so it is shown but not offered as a place to switch to.
  function options(status, { stopped = null } = {}) {
    const st = status || {}, out = [];
    for (const provider of PROVIDERS) {
      const profs = (st.profiles || []).filter(p => p.provider === provider && p.enabled !== false && p.maskedKey);
      const list = profs.map(p => ({ profileId: p.id, name: p.name || p.id, model: p.model || p.deployment || DEFAULT_MODEL[provider], prof: p }));
      if (!list.length && st.env?.[provider]) list.push({ profileId: '', name: 'Server settings', model: '', prof: null });
      if (!list.length) { out.push({ id: provider + ':', provider, profileId: '', model: '', name: '', label: label(provider), configured: false, usable: false, reason: `No API key is saved for ${label(provider)}. An administrator can add it in Settings → Integrations.` }); continue; }
      for (const x of list) {
        let reason = '';
        const p = x.prof, t = p?.lastTest;
        if (!x.model && provider === 'groq' && p) reason = 'No Groq model is chosen. An administrator can load the models and choose one in Settings → Integrations.';
        else if (provider === 'azure_openai' && p && (!p.endpoint || !(p.deployment || p.model))) reason = 'The Azure OpenAI endpoint or deployment is missing in Settings → Integrations.';
        else if (x.model && NOT_TEXT.test(x.model)) reason = `The model "${x.model}" does not write text (speech, image, embedding or safety model).`;
        else if (t && t.ok === false && t.code === 'provider_auth') reason = 'The last connection test failed: the key was rejected.';
        else if (t && t.ok === false && t.code === 'provider_model') reason = 'The last connection test failed: the model is not available for this key.';
        const o = { id: `${provider}:${x.profileId}`, provider, profileId: x.profileId, model: x.model || '', name: x.name, label: `${label(provider)}${x.model ? ' · ' + x.model : ''}`, configured: true, usable: !reason, reason };
        if (stopped && same(o, stopped)) { o.current = true; o.usable = false; o.reason = o.reason || 'This is the provider that stopped.'; }
        out.push(o);
      }
    }
    return out;
  }
  // Two routes are the same place when provider, profile and model agree (an empty model means the profile's own).
  function same(a, b) {
    if (!a || !b || a.provider !== b.provider) return false;
    if ((a.profileId || '') !== (b.profileId || '') && a.profileId && b.profileId) return false;
    return !a.model || !b.model || a.model === b.model;
  }
  const routeOf = o => ({ provider: o.provider, profileId: o.profileId || '', model: o.model || '' });

  /* ----------------------------------------------------------- the content */
  const PARTS = ['lesson', 'practice', 'assess'];
  const doneParts = m => PARTS.filter(p => m?.parts?.[p] || (m?.edited?.parts || []).includes(p));
  // The newest failure that waits on a provider (not a one-off bad answer), across the course's sessions.
  // Only parts that are still unwritten count: once a part exists the failure is history.
  function pausedBy(sessions) {
    let last = null, parts = 0, left = 0, done = 0;
    for (const s of sessions) {
      const m = s.content?.meta || {}, d = doneParts(m);
      left += PARTS.length - d.length; done += d.length;
      for (const [part, e] of Object.entries(m.errors || {})) {
        if (d.includes(part) || !kindOf(e.code).pause) continue;
        parts++;
        if (!last || String(e.at || '') >= String(last.at || '')) last = { ...e, part, sessionId: s.id };
      }
    }
    if (!last || !left) return null;
    return { ...last, ...explain(last), failedParts: parts, partsLeft: left, partsDone: done };
  }
  // Who wrote what: one row per provider and model, from what is stored with each part.
  function writers(sessions) {
    const map = new Map();
    for (const s of sessions) {
      for (const [part, info] of Object.entries(s.content?.meta?.parts || {})) {
        const provider = info.provider || '', model = info.model || '', key = provider + '|' + model;
        const w = map.get(key) || { provider, model, label: provider === 'mock-demo' ? 'Demo sample (not AI)' : `${label(provider)}${model ? ' · ' + model : ''}`, parts: 0, sessions: new Set(), tokens: 0 };
        w.parts++; w.sessions.add(s.id); w.tokens += info.tokens || 0;
        map.set(key, w);
      }
    }
    return [...map.values()].map(w => ({ ...w, sessions: w.sessions.size }));
  }
  // One session's parts and who wrote each.
  const writtenBy = s => PARTS.filter(p => s.content?.meta?.parts?.[p]).map(p => { const i = s.content.meta.parts[p]; return { part: p, provider: i.provider || '', model: i.model || '', label: `${label(i.provider)}${i.model ? ' · ' + i.model : ''}`, at: i.at || '' }; });

  const api = { PROVIDERS, LABEL, label, DEFAULT_MODEL, NOT_TEXT, KINDS, kindOf, explain, options, same, routeOf, pausedBy, writers, writtenBy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
