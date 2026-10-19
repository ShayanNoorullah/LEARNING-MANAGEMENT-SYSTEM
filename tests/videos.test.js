/* YouTube videos for the AI Course Builder: the search phrase the AI writes, the picking rules (best first,
   never the same video twice in a course, "Another video"), the saved session fields, and the server routes
   (/api/ai/videos and /api/ai/youtube): filtering, cache, demo mode, quota and key errors, the key never
   leaving the server. YouTube is stubbed: nothing here reaches the network. Run: npm test */
const assert = require('assert'), express = require('express');

process.env.SDC_AI_SECRETS_KEY = 'test-only-ai-secrets-key';
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SDC_ALLOW_LIVE', 'NODE_ENV', 'SDC_AI_MOCK', 'SDC_AI_LOCAL_OPEN', 'YOUTUBE_API_KEY', 'SDC_QA_YOUTUBE_BASE_URL']) delete process.env[k];
process.env.VERCEL = '1'; // secrets and usage files go to the temp folder while loading
const ai = require('../backend/ai-api.js');
const CG = require('../js/coursegen-logic.js');
delete process.env.VERCEL;

/* ------------------------------------------------------------- the logic */
{
  assert.equal(CG.youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(CG.youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30'), 'dQw4w9WgXcQ');
  assert.equal(CG.youtubeId('https://m.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  for (const bad of ['javascript:alert(1)//youtu.be/dQw4w9WgXcQ', 'https://evil.example/?youtu.be/dQw4w9WgXcQ', 'https://youtu.be/short', 'dQw4w9WgXcQ', '', null]) assert.equal(CG.youtubeId(bad), '', String(bad));
  assert.equal(CG.durationLabel(3725), '1:02:05'); assert.equal(CG.durationLabel(605), '10:05'); assert.equal(CG.durationLabel(0), '');

  // the AI is asked for a search phrase, never a link; normalize keeps the phrase
  const { system } = CG.buildMessages({ topic: 'Excel', audience: 'Clerks', level: 'Beginner', programType: 'short', delivery: 'online', weeks: 1, perWeek: 2, hours: 2 });
  assert.ok(/"video": string \(a YouTube search phrase/.test(system));
  const n = CG.normalize({ title: 'Excel', outcomes: ['Build a sheet'], modules: [{ name: 'M', sessions: [{ title: 'Pivot tables', outcomes: [1], video: '  excel   pivot tables tutorial ' }, { title: 'Charts', outcomes: [1], video: 'https://youtu.be/dQw4w9WgXcQ'.repeat(10) }, { title: 'Lookups', outcomes: [1] }] }] });
  const ss = n.outline.modules[0].sessions;
  assert.equal(ss[0].videoQuery, 'excel pivot tables tutorial');
  assert.equal(ss[1].videoQuery.length, CG.LIMITS.videoQuery, 'a long phrase is clipped to the search limit');
  assert.equal(ss[2].videoQuery, undefined);
  assert.equal(CG.videoQuery(n.outline, ss[0]), 'excel pivot tables tutorial');
  assert.equal(CG.videoQuery(n.outline, ss[2]), 'Lookups Excel', 'no phrase: the session and course titles');

  // picking: best first, never the same video in two sessions, a failed search is left for later
  const v = (id, extra = {}) => ({ id: id.padEnd(11, '0'), title: 'T ' + id, channel: 'C', duration: 300, ...extra });
  const o = { title: 'Excel', modules: [{ sessions: [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D', video: v('kept') }] }] };
  const [a, b, c, d] = o.modules[0].sessions;
  const targets = CG.videoTargets(o);
  assert.deepEqual(targets.map(x => x.title), ['A', 'B', 'C'], 'a session that has a video is not searched');
  const found = CG.assignVideos(o, targets, [[v('one'), v('two')], [v('one'), v('three'), { id: 'bad id', title: 'x' }], null]);
  assert.equal(found, 2);
  assert.deepEqual([a.video.id, b.video.id], [v('one').id, v('three').id], 'B gets its next best: one is already used by A');
  assert.equal(b.videoAlt.length, 2, 'invalid candidates are dropped');
  assert.equal(c.video, undefined, 'a failed search leaves the session to be searched again');
  assert.deepEqual(CG.videoTargets(o).map(x => x.title), ['C']);
  CG.assignVideos(o, [c], [[v('kept')]]);
  assert.equal(c.video, null, 'the only candidate is used elsewhere: no video, not a duplicate');
  assert.equal(c.videoAlt.length, 1);
  // "Another video" cycles through the alternatives that no other session shows
  assert.equal(CG.nextVideo(o, a).id, v('two').id);
  assert.equal(CG.nextVideo(o, a).id, v('one').id, 'back to the first');
  assert.equal(CG.nextVideo(o, b), null, 'B has nothing else free: one is used by A');
  a.video = null; // removed by the person
  assert.deepEqual(CG.videoTargets(o).map(x => x.title), [], 'removed and tried sessions are not searched automatically');
  assert.deepEqual(CG.videoTargets(o, { all: true }).map(x => x.title), ['A', 'C'], '"Find videos for sessions without one" includes them');
  void d;

  // the saved records: the video goes on the session; anything else is dropped
  const recs = CG.build({ genId: 'abcdef12-3456-7890-abcd-ef1234567890', userId: 'U1', now: '2026-10-19T00:00:00Z', outline: { title: 'Excel', modules: [{ name: 'M', sessions: [
    { title: 'A', video: v('one', { title: 'x'.repeat(300), channel: 'Ch' }) }, { title: 'B', video: { id: '"><script>', title: 'bad' } }, { title: 'C', video: null }, { title: 'D', videoUrl: 'https://evil.example/a.mp4' }] }] } });
  assert.deepEqual(recs.sessions.map(x => x.videoUrl || ''), [`https://www.youtube.com/watch?v=${v('one').id}`, '', '', '']);
  assert.equal(recs.sessions[0].videoTitle.length, 200); assert.equal(recs.sessions[0].videoChannel, 'Ch');
  assert.ok(!('videoTitle' in recs.sessions[1]) && !('video' in recs.sessions[0]) && !('videoAlt' in recs.sessions[0]), 'only the three video fields are stored');
  const hand = CG.build({ genId: 'abcdef12-3456-7890-abcd-ef1234567891', userId: 'U1', now: 'x', outline: { title: 'Excel', modules: [{ name: 'M', sessions: [{ title: 'A', video: { id: 'jNQXAC9IVRw', title: '', channel: '' } }] }] } }).sessions[0];
  assert.deepEqual([hand.videoUrl, 'videoTitle' in hand, 'videoChannel' in hand], ['https://www.youtube.com/watch?v=jNQXAC9IVRw', false, false], 'a pasted link has no made-up title');
  // the demo outline carries a phrase too
  const demo = CG.mockOutline('Course topic: Power BI\nTotal sessions: 4 (2 weeks × 2 per week)');
  assert.ok(demo.modules.every(m => m.sessions.every(x => /Power BI/.test(x.video))));
}

/* -------------------------------------------------------------- the server */
(async () => {
  const app = express(); app.use(ai);
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const realFetch = global.fetch, YT = 'https://www.googleapis.com/youtube/v3';
  const sent = [];
  const item = (id, over = {}) => ({ id, snippet: { title: `Video &quot;${id}&quot; &amp; more`, channelTitle: 'Chan &#39;A&#39;', liveBroadcastContent: 'none', ...over.snippet }, contentDetails: { duration: over.duration || 'PT12M5S' }, status: { embeddable: true, privacyStatus: 'public', ...over.status } });
  let search = () => ({ status: 200, json: { items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff', 'not valid'].map(videoId => ({ id: { kind: 'youtube#video', videoId } })) } });
  let videos = () => ({ status: 200, json: { items: [item('aaaaaaaaaaa'), item('bbbbbbbbbbb', { duration: 'PT45S' }), item('ccccccccccc', { snippet: { liveBroadcastContent: 'live' } }), item('ddddddddddd', { status: { privacyStatus: 'unlisted' } }), item('eeeeeeeeeee', { status: { embeddable: false } }), item('fffffffffff', { duration: 'PT1H2M' })] } });
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith(BASE)) return realFetch(url, opts);
    const u = new URL(url); sent.push(u);
    const r = url.startsWith(YT + '/search?') ? await search(u) : url.startsWith(YT + '/videos?') ? await videos(u) : { status: 599, json: { error: { message: 'unexpected host ' + url } } };
    return { ok: r.status < 400, status: r.status, headers: { get: () => null }, json: async () => r.json };
  };
  const call = async (p, body, token, method = 'POST') => { const r = await realFetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const token = (await call('/api/ai/auth', { userId: 'U-coord' })).body.token;
  const find = (queries, feature = 'courseGenerate') => call('/api/ai/videos', { feature, queries }, token);

  try {
    await call('/api/ai/youtube', { remove: true }, token); // a key left by an earlier, interrupted run
    // no key: refused with a clear message, nothing sent
    let r = await find(['excel pivot tables']);
    assert.deepEqual([r.status, r.body.code, r.body.provider], [400, 'not_configured', 'youtube']);
    assert.ok(/Settings → Integrations → YouTube/.test(r.body.error));
    assert.equal(sent.length, 0);
    let st = (await call('/api/ai/status', null, null, 'GET')).body.youtube;
    assert.deepEqual([st.configured, st.env, st.maskedKey, st.demo], [false, false, '', false]);

    // demo mode on a developer machine: labelled placeholders, still nothing sent
    process.env.SDC_AI_MOCK = '1';
    r = await find(['excel pivot tables', 'charts']);
    assert.equal(r.body.source, 'demo'); assert.equal(r.body.results.length, 2);
    assert.ok(r.body.results.every(list => list.length === 3 && list.every(x => /^[\w-]{11}$/.test(x.id) && /not a real video/.test(x.channel))));
    assert.equal((await call('/api/ai/status', null, null, 'GET')).body.youtube.demo, true);
    assert.equal(sent.length, 0);
    process.env.NODE_ENV = 'production';
    assert.equal((await find(['x'])).body.code, 'not_configured', 'demo mode never runs in production');
    delete process.env.NODE_ENV; delete process.env.SDC_AI_MOCK;

    // bad requests
    assert.equal((await find(['x'], 'tutor')).status, 400);
    assert.equal((await call('/api/ai/videos', { queries: ['x'] }, token)).status, 400, 'no feature: refused');
    assert.equal((await find([])).status, 400);
    assert.equal((await find(Array.from({ length: 49 }, (_, i) => 'q' + i))).status, 400, 'at most 48, one per session');
    assert.equal((await find(['ok', '  '])).status, 400);
    assert.equal((await find(['ok', 5])).status, 400);
    assert.equal((await call('/api/ai/videos', { feature: 'courseGenerate', queries: ['x'] })).status, 401, 'sign-in required');

    // the saved key: masked, tested, never returned
    const KEY = 'AIzaSyTEST_only_not_a_real_key_42';
    assert.equal((await call('/api/ai/youtube', { apiKey: 'has spaces <x>' }, token)).status, 400);
    r = await call('/api/ai/youtube', { apiKey: KEY }, token);
    assert.equal(r.status, 200); assert.ok(!JSON.stringify(r.body).includes(KEY));
    st = (await call('/api/ai/status', null, null, 'GET')).body.youtube;
    assert.equal(st.configured, true); assert.ok(st.maskedKey && !st.maskedKey.includes(KEY.slice(6, 20)));
    r = await call('/api/ai/youtube', { test: true }, token);
    assert.deepEqual([r.status, r.body.found], [200, 2]);
    assert.equal(sent.at(-1).searchParams.get('key'), KEY, 'the key goes to YouTube only');
    st = (await call('/api/ai/status', null, null, 'GET')).body;
    assert.equal(st.youtube.lastTest.ok, true); assert.ok(!JSON.stringify(st).includes(KEY), 'status never shows the key');

    // the search: filters and order
    sent.length = 0;
    r = await find(['excel pivot tables', 'excel pivot tables', 'excel charts']);
    assert.equal(r.status, 200); assert.equal(r.body.source, 'youtube'); assert.equal(r.body.failed, 0);
    assert.deepEqual(r.body.results[0].map(x => x.id), ['aaaaaaaaaaa', 'fffffffffff'], 'too short, live, unlisted and not-embeddable videos are left out; order kept');
    assert.deepEqual(r.body.results[0][0], { id: 'aaaaaaaaaaa', title: 'Video "aaaaaaaaaaa" & more', channel: "Chan 'A'", duration: 725 });
    assert.equal(r.body.results[0][1].duration, 3720);
    const s1 = sent.find(u => u.pathname.endsWith('/search'));
    assert.deepEqual(['type', 'videoEmbeddable', 'safeSearch', 'maxResults'].map(k => s1.searchParams.get(k)), ['video', 'true', 'strict', '8']);
    assert.equal(sent.find(u => u.pathname.endsWith('/videos')).searchParams.get('id'), 'aaaaaaaaaaa,bbbbbbbbbbb,ccccccccccc,ddddddddddd,eeeeeeeeeee,fffffffffff', 'one details request per search, invalid ids dropped');
    assert.equal(sent.filter(u => u.pathname.endsWith('/search')).length, 2, 'the repeated phrase was searched once');
    sent.length = 0;
    await find(['EXCEL pivot tables']);
    assert.equal(sent.length, 0, 'cached for 12 hours (the quota is small)');

    // one search fails: the others are kept, that one is null
    search = u => (u.searchParams.get('q') === 'broken' ? { status: 500, json: { error: { message: 'backend error' } } } : { status: 200, json: { items: [{ id: { videoId: 'aaaaaaaaaaa' } }] } });
    r = await find(['broken', 'fresh one']);
    assert.equal(r.status, 200); assert.equal(r.body.results[0], null); assert.equal(r.body.results[1][0].id, 'aaaaaaaaaaa'); assert.equal(r.body.failed, 1);

    // quota used up: stops; a partial answer keeps what was found
    search = () => ({ status: 403, json: { error: { message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } } });
    r = await find(['quota one']);
    assert.deepEqual([r.status, r.body.code, r.body.provider], [429, 'provider_quota', 'youtube']);
    assert.ok(/quota for today/.test(r.body.error));
    r = await find(['fresh one', 'quota two']); // the first is cached
    assert.equal(r.status, 200); assert.equal(r.body.code, 'provider_quota'); assert.ok(r.body.stopped); assert.equal(r.body.results[0][0].id, 'aaaaaaaaaaa'); assert.equal(r.body.results[1], null);

    // a refused key: a clear message, and the key is never echoed
    search = () => ({ status: 400, json: { error: { message: `API key not valid. Please pass a valid API key. (${KEY})`, errors: [{ reason: 'badRequest' }], status: 'INVALID_ARGUMENT' } } });
    r = await find(['key test']);
    assert.deepEqual([r.status, r.body.code], [400, 'provider_auth']);
    assert.ok(!r.body.error.includes(KEY) && /YouTube refused the API key/.test(r.body.error));
    r = await call('/api/ai/youtube', { test: true }, token);
    assert.equal(r.body.code, 'provider_auth');
    st = (await call('/api/ai/status', null, null, 'GET')).body.youtube;
    assert.equal(st.lastTest.ok, false); assert.ok(!JSON.stringify(st).includes(KEY));
    search = () => ({ status: 403, json: { error: { message: 'YouTube Data API v3 has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } } });
    assert.equal((await find(['api off'])).body.code, 'provider_auth', 'API not enabled on the key is a key problem');

    // the environment key wins; removing the saved key
    process.env.YOUTUBE_API_KEY = 'AIzaENV_only_test';
    search = () => ({ status: 200, json: { items: [] } });
    r = await find(['nothing at all']);
    assert.deepEqual(r.body.results, [[]], 'no results is an empty list, not a failure');
    assert.equal(sent.at(-1).searchParams.get('key'), 'AIzaENV_only_test');
    delete process.env.YOUTUBE_API_KEY;
    assert.equal((await call('/api/ai/youtube', { remove: true }, token)).status, 200);
    assert.equal((await call('/api/ai/status', null, null, 'GET')).body.youtube.configured, false);
    assert.equal((await find(['after removal'])).body.code, 'not_configured');
    assert.equal((await call('/api/ai/youtube', { test: true }, token)).body.code, 'not_configured');

    console.log('videos.test.js: all checks passed');
  } finally { global.fetch = realFetch; srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
