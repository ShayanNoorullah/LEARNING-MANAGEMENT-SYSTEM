/* SDC Learn — local development safety.
   js/cloud-config.js points at the LIVE Supabase project and is served to every browser as a
   static file, so a plain `npm run dev` would let the browser read and write live data directly.
   Outside production this module makes the browser receive a "cloud off" config instead, unless
   the developer explicitly points SUPABASE_URL at a different (non-live) project or opts in with
   SDC_ALLOW_LIVE=1. It never reads or prints secrets and never touches js/cloud-config.js. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const CONFIG_FILE = path.join(__dirname, '..', 'js', 'cloud-config.js');

function liveConfig(file = CONFIG_FILE) {
  const w = {};
  try { vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: w }); } catch (e) {}
  return w.SDC_CLOUD_CONFIG || {};
}
const hostOf = u => { try { return new URL(String(u)).host.toLowerCase(); } catch (e) { return ''; } };
// Production = Vercel or NODE_ENV=production. Everything else is a developer machine or CI.
const isProduction = env => !!env.VERCEL || env.NODE_ENV === 'production';

/* Decides what a non-production server may expose. mode:
   production   deployed app: nothing changes
   live-opt-in  developer set SDC_ALLOW_LIVE=1 (explicit, logged)
   isolated     SUPABASE_URL names a non-live project: the browser gets that project
   local-only   default: the browser gets {enabled:false}, no cloud reads or writes */
function resolve(env = process.env, live = liveConfig()) {
  const liveHost = hostOf(live.url);
  if (isProduction(env)) return { mode: 'production', liveHost, config: null };
  if (env.SDC_ALLOW_LIVE === '1') return { mode: 'live-opt-in', liveHost, config: null };
  const host = hostOf(env.SUPABASE_URL);
  if (host && host !== liveHost && env.SUPABASE_ANON_KEY) {
    return { mode: 'isolated', liveHost, config: { enabled: true, url: String(env.SUPABASE_URL).replace(/\/$/, ''), anonKey: env.SUPABASE_ANON_KEY, table: live.table, stateId: live.stateId } };
  }
  return { mode: 'local-only', liveHost, config: { enabled: false } };
}

/* The gateway talks to the project named by SUPABASE_URL, or the live one when it is unset.
   Starting it from a developer machine against the live host is refused. */
function assertSafeStartup(env = process.env, live = liveConfig()) {
  const r = resolve(env, live);
  if (r.mode === 'production' || r.mode === 'live-opt-in') return r;
  if (env.SDC_STATE_SECRET && hostOf(env.SUPABASE_URL || live.url) === r.liveHost) {
    throw new Error('Refusing to start: the state gateway would use the LIVE Supabase project from a non-production environment. Set SUPABASE_URL and SUPABASE_ANON_KEY to a separate test project, or unset SDC_STATE_SECRET to run local-only. (SDC_ALLOW_LIVE=1 overrides this and is not recommended.)');
  }
  return r;
}

// Registered BEFORE express.static so the live file is never sent outside production.
function middleware(env = process.env, live = liveConfig()) {
  const r = resolve(env, live);
  return (req, res, next) => {
    if (!r.config) return next();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`window.SDC_CLOUD_CONFIG = ${JSON.stringify(r.config)};`);
  };
}

const describe = r => ({
  production: 'cloud: production configuration',
  'live-opt-in': 'cloud: LIVE project (SDC_ALLOW_LIVE=1) — writes reach production data',
  isolated: 'cloud: isolated test project (' + (r.config && hostOf(r.config.url)) + ')',
  'local-only': 'cloud: OFF (local only, safe default)'
})[r.mode];

module.exports = { resolve, assertSafeStartup, middleware, liveConfig, describe, hostOf, isProduction };
