// Stage 1 (B5) regression tests: local development must never reach the live Supabase project.
// Everything here is mocked or local: fake fetch, fake Supabase client, a localhost-only server on an
// ephemeral port. No test reads or writes live data. Run: npm test
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http'), cp = require('child_process');
const express = require('express');
const ROOT = path.join(__dirname, '..');

// Scrub anything that could point these tests (or the server they start) at a real project.
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SDC_ALLOW_LIVE', 'VERCEL', 'NODE_ENV']) delete process.env[k];
const ds = require('../backend/dev-safety.js');
const LIVE = ds.liveConfig();
const LIVE_HOST = ds.hostOf(LIVE.url);
assert.ok(LIVE_HOST, 'js/cloud-config.js is readable and names the live project (read only)');
const FAKE = { url: 'https://fake-test-project.supabase.co', anonKey: 'sb_publishable_FAKE_TEST_KEY' };

// ---- resolve(): what a non-production server may expose --------------------------------------
let r = ds.resolve({}, LIVE);
assert.equal(r.mode, 'local-only', 'safe by default with no env at all (SDC_DEV_SAFE missing)');
assert.deepEqual(r.config, { enabled: false });
assert.equal(ds.resolve({ SDC_DEV_SAFE: '0' }, LIVE).mode, 'local-only', 'SDC_DEV_SAFE cannot switch safety off');
assert.equal(ds.resolve({ SUPABASE_URL: LIVE.url, SUPABASE_ANON_KEY: 'x' }, LIVE).mode, 'local-only', 'naming the live URL does not unlock it');
assert.equal(ds.resolve({ SUPABASE_URL: LIVE.url.toUpperCase() + '/', SUPABASE_ANON_KEY: 'x' }, LIVE).mode, 'local-only', 'live host matching ignores case and a trailing slash');
r = ds.resolve({ SUPABASE_URL: FAKE.url, SUPABASE_ANON_KEY: FAKE.anonKey }, LIVE);
assert.equal(r.mode, 'isolated');
assert.equal(r.config.url, FAKE.url); assert.equal(r.config.anonKey, FAKE.anonKey);
assert.ok(!JSON.stringify(r.config).includes(LIVE_HOST), 'isolated config never names the live project');
assert.equal(ds.resolve({ SUPABASE_URL: FAKE.url }, LIVE).mode, 'local-only', 'non-live URL without a key stays local-only');
assert.equal(ds.resolve({ SDC_ALLOW_LIVE: '1' }, LIVE).mode, 'live-opt-in', 'live needs the explicit SDC_ALLOW_LIVE=1');
assert.equal(ds.resolve({ SDC_ALLOW_LIVE: 'true' }, LIVE).mode, 'local-only', 'only the exact value 1 opts in');
assert.equal(ds.resolve({ VERCEL: '1' }, LIVE).mode, 'production', 'Vercel is production: behaviour unchanged');
assert.equal(ds.resolve({ NODE_ENV: 'production' }, LIVE).mode, 'production');
assert.equal(ds.resolve({ VERCEL: '1' }, LIVE).config, null, 'production serves the real static file');

// ---- assertSafeStartup(): gateway must not target live from a dev machine ---------------------
assert.throws(() => ds.assertSafeStartup({ SDC_STATE_SECRET: 's' }, LIVE), /Refusing to start/, 'secret + no SUPABASE_URL would use the live project');
assert.throws(() => ds.assertSafeStartup({ SDC_STATE_SECRET: 's', SUPABASE_URL: LIVE.url }, LIVE), /Refusing to start/);
assert.doesNotThrow(() => ds.assertSafeStartup({}, LIVE), 'plain local run starts');
assert.doesNotThrow(() => ds.assertSafeStartup({ SDC_STATE_SECRET: 's', SUPABASE_URL: FAKE.url, SUPABASE_ANON_KEY: FAKE.anonKey }, LIVE), 'non-live project starts');
assert.doesNotThrow(() => ds.assertSafeStartup({ SDC_STATE_SECRET: 's', VERCEL: '1' }, LIVE), 'production gateway starts');
assert.doesNotThrow(() => ds.assertSafeStartup({ SDC_STATE_SECRET: 's', SDC_ALLOW_LIVE: '1' }, LIVE), 'explicit opt-in starts');
assert.ok(!/s3cret-value/.test(String((() => { try { ds.assertSafeStartup({ SDC_STATE_SECRET: 's3cret-value' }, LIVE); } catch (e) { return e.message; } })())), 'error never echoes the secret');

// ---- real startup: the server process itself refuses (child process, no network) --------------
const childEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SDC_STATE_SECRET: 'test-secret-not-real' };
let out = cp.spawnSync(process.execPath, ['-e', "require('./backend/server.js')"], { cwd: ROOT, env: childEnv, encoding: 'utf8', timeout: 20000 });
assert.notEqual(out.status, 0, 'server.js must not load with the gateway aimed at the live project');
assert.match(out.stderr, /Refusing to start/);
assert.ok(!out.stderr.includes('test-secret-not-real') && !out.stdout.includes('test-secret-not-real'));

// ---- middleware: static route is shadowed outside production -----------------------------------
function serve(env, done) {
  const app = express();
  app.get('/js/cloud-config.js', ds.middleware(env, LIVE));
  app.use(express.static(ROOT));
  const srv = app.listen(0, '127.0.0.1', () => done(srv, 'http://127.0.0.1:' + srv.address().port));
}
const get = url => new Promise((res, rej) => http.get(url, x => { let b = ''; x.on('data', d => b += d); x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: b })); }).on('error', rej));
const evalCfg = body => { const w = {}; vm.runInNewContext(body, { window: w }); return w.SDC_CLOUD_CONFIG; };
const withServer = (env, fn) => new Promise((resolve, reject) => serve(env, async (srv, base) => { try { await fn(base); resolve(); } catch (e) { reject(e); } finally { srv.close(); } }));

(async () => {
  await withServer({}, async base => {
    const x = await get(base + '/js/cloud-config.js');
    assert.equal(x.status, 200);
    assert.deepEqual(evalCfg(x.body), { enabled: false }, 'default dev server serves a disabled config');
    assert.ok(!x.body.includes(LIVE_HOST) && !x.body.includes(LIVE.anonKey), 'live URL and key are never sent');
    assert.match(x.headers['cache-control'], /no-store/);
    const q = await get(base + '/js/cloud-config.js?v=2');
    assert.deepEqual(evalCfg(q.body), { enabled: false }, 'query strings do not bypass the guard');
  });
  await withServer({ SUPABASE_URL: FAKE.url, SUPABASE_ANON_KEY: FAKE.anonKey }, async base => {
    const c = evalCfg((await get(base + '/js/cloud-config.js')).body);
    assert.equal(c.url, FAKE.url); assert.equal(c.enabled, true);
  });
  await withServer({ VERCEL: '1' }, async base => {
    const x = await get(base + '/js/cloud-config.js');
    assert.ok(x.body.includes(LIVE_HOST), 'production still receives the real file');
  });
  // The real server (default env in this process) must be shadowed as well.
  process.env.PORT = '0';
  const app = require('../backend/server.js');
  await new Promise((resolve, reject) => { const srv = app.listen(0, '127.0.0.1', async () => { try { const x = await get('http://127.0.0.1:' + srv.address().port + '/js/cloud-config.js'); assert.deepEqual(evalCfg(x.body), { enabled: false }); resolve(); } catch (e) { reject(e); } finally { srv.close(); } }); });

  // ---- browser side: js/cloud-sync.js in a vm with a fake network ------------------------------
  const js = f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  const src = js('sync-recover.js') + '\n' + js('cloud-sync.js');
  function browser({ config, status, token }) {
    const ls = new Map(), ss = new Map(), calls = { fetch: [], upsert: 0, loadSupabase: 0 };
    if (token) ls.set('sdcCloudToken', token);
    const store = m => ({ getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) });
    const win = { SDC_CLOUD_CONFIG: config, addEventListener() {}, dispatchEvent() {} };
    const ctx = {
      window: win, localStorage: store(ls), sessionStorage: store(ss), console: { warn() {}, log() {} },
      setTimeout: () => 0, clearTimeout() {}, Event: function () {}, DBKEY: 'k', STAMP: 's',
      db: () => ({ users: [{ id: 'U' }], courses: [] }), normalizeState: s => s, invalidateCache() {},
      loadSupabase: async () => { calls.loadSupabase++; return { createClient: () => ({ from: () => ({ upsert: async () => { calls.upsert++; return {}; }, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }; },
      fetch: async (url, opts = {}) => {
        calls.fetch.push({ url, method: opts.method || 'GET' });
        if (url === '/api/sdc/status') return status(calls);
        if (url === '/api/sdc/state' && opts.method === 'PUT') return { ok: true, status: 200, json: async () => ({ updatedAt: new Date().toISOString() }) };
        return { ok: false, status: 404, json: async () => ({}) };
      }
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return { win, ls, ss, calls, cloud: win.SDCCloud };
  }
  const answer = body => async () => ({ ok: true, status: 200, json: async () => body });
  const live = { enabled: true, url: FAKE.url, anonKey: FAKE.anonKey, table: 'sdc_learn_state', stateId: 'sdc-learn-main' };
  const puts = b => b.calls.fetch.filter(c => c.method === 'PUT').length;

  // status request throws (server restarting)
  let b = browser({ config: live, status: async () => { throw new Error('ECONNREFUSED'); } });
  b.cloud.syncNow(); await b.cloud.flushNow();
  assert.equal(b.calls.loadSupabase, 0, 'status failure must not create a direct Supabase client');
  assert.equal(b.calls.upsert, 0, 'status failure must not write the table');
  assert.equal(puts(b), 0);
  assert.ok(b.ls.get('sdcCloudPending'), 'change stays pending for retry');
  assert.match(b.win.SDC_CLOUD_STATUS, /Offline/);
  assert.equal(b.ss.get('sdcGwMode'), undefined, 'offline is never cached for the tab');
  assert.equal(await b.cloud.gateway(), false);

  // status answers with an error, with garbage, and with a slow/non-JSON body
  for (const bad of [async () => ({ ok: false, status: 503, json: async () => ({}) }), answer({}), answer({ gateway: 'yes' }), async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } })]) {
    b = browser({ config: live, status: bad });
    b.cloud.syncNow(); await b.cloud.flushNow();
    assert.equal(b.calls.upsert + b.calls.loadSupabase + puts(b), 0, 'unusable status = no cloud write of any kind');
    assert.ok(b.ls.get('sdcCloudPending'));
  }

  // pull() while offline never writes either
  b = browser({ config: live, status: async () => { throw new Error('down'); } });
  await b.cloud.pullNow();
  assert.equal(b.calls.upsert + b.calls.loadSupabase + puts(b), 0);

  // recovery: first status fails, then the server answers gateway:true -> the pending change is pushed once
  let n = 0;
  b = browser({ config: live, token: 'tok', status: async () => { if (n++ === 0) throw new Error('restarting'); return { ok: true, status: 200, json: async () => ({ gateway: true }) }; } });
  b.cloud.syncNow(); await b.cloud.flushNow();
  assert.equal(puts(b), 0); assert.ok(b.ls.get('sdcCloudPending'));
  await b.cloud.flushNow();
  assert.equal(puts(b), 1, 'retry after the server is back goes through the gateway');
  assert.equal(b.ls.get('sdcCloudPending'), undefined, 'pending cleared only after a real push');
  assert.equal(b.ss.get('sdcGwMode'), 'gateway');
  assert.equal(b.calls.loadSupabase, 0);

  // a server that answered gateway:false keeps the legacy direct mode (existing behaviour preserved)
  b = browser({ config: live, status: answer({ gateway: false }) });
  b.cloud.syncNow(); await b.cloud.flushNow();
  assert.equal(b.calls.upsert, 1, 'explicit gateway:false still uses direct mode as before');

  // cloud disabled by config (what the dev server now serves): no network at all
  b = browser({ config: { enabled: false }, status: async () => { throw new Error('must not be called'); } });
  b.cloud.syncNow(); await b.cloud.flushNow(); await b.cloud.pullNow();
  assert.equal(b.calls.fetch.length + b.calls.loadSupabase, 0, 'enabled:false makes no request');
  assert.match(b.win.SDC_CLOUD_STATUS, /Local only/);

  // config absent (cloud-config.js failed to load): treated as unconfigured, not as live
  b = browser({ config: undefined, status: async () => { throw new Error('down'); } });
  b.cloud.syncNow(); await b.cloud.flushNow();
  assert.equal(b.calls.upsert + b.calls.loadSupabase, 0);

  // ---- source-level guards --------------------------------------------------------------------
  assert.ok(!/catch \(e\) \{ return 'direct'; \}/.test(src), "cloud-sync.js no longer falls back to 'direct' on a failed status call");
  const cfgNow = fs.readFileSync(path.join(ROOT, 'js', 'cloud-config.js'), 'utf8');
  assert.ok(cfgNow.includes(LIVE.url), 'js/cloud-config.js is untouched');
  console.log('devsafety.test.js: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
