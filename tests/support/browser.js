/* Test harness: a browser tab running the real js/core.js + js/sync-recover.js + js/cloud-sync.js in a vm,
   talking to a fake gateway that applies saves with the real server guard (backend/state-api.js). Tabs of
   one Browser share localStorage (with a size limit and storage events); each tab has its own memory.
   No network, no timers: tests call SDCCloud.flushNow() / pullNow() themselves. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const T = require('../../backend/state-api.js')._test;
const clone = v => JSON.parse(JSON.stringify(v));
const read = f => fs.readFileSync(path.join(__dirname, '..', '..', 'js', f), 'utf8');
const SRC = ['seed.js', 'migrations.js', 'shared-rules.js', 'core.js', 'sync-recover.js', 'cloud-sync.js'].map(read).join(';\n');

// What one person's computer holds: localStorage (shared by its tabs) and the tabs.
function Browser({ quota = Infinity } = {}) {
  const store = new Map(), tabs = [], b = { store, tabs, quota, full: false, failKeys: new Set() };
  const size = () => { let n = 0; store.forEach((v, k) => { n += k.length + v.length; }); return n; };
  b.size = size;
  b.facade = tab => ({
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => {
      v = String(v);
      const next = size() - (store.has(k) ? k.length + store.get(k).length : 0) + k.length + v.length;
      if (b.full || b.failKeys.has(k) || next > b.quota) throw Object.assign(new Error('QuotaExceededError: the quota has been exceeded'), { name: 'QuotaExceededError' });
      const old = store.has(k) ? store.get(k) : null; store.set(k, v);
      tabs.forEach(t => { if (t !== tab) t.fire('storage', { key: k, oldValue: old, newValue: v }); });
    },
    removeItem: k => { const old = store.has(k) ? store.get(k) : null; store.delete(k); tabs.forEach(t => { if (t !== tab) t.fire('storage', { key: k, oldValue: old, newValue: null }); }); },
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  });
  return b;
}
const stubDocument = () => {
  const el = () => ({ className: '', style: {}, classList: { add() {}, remove() {}, contains: () => false }, setAttribute() {}, appendChild() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, set innerHTML(v) {}, get innerHTML() { return ''; } });
  return { querySelector: () => null, querySelectorAll: () => [], createElement: el, body: { appendChild() {}, prepend() {} }, addEventListener() {}, documentElement: { dataset: {} } };
};

const reorder = v => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reorder(v[k])])) : v;
function Server(initial) {
  let state = clone(initial), n = 1, k = 0;
  const tokens = new Map(), log = [];
  const ver = () => `2026-01-01T00:00:${String(Math.floor(n / 1e6)).padStart(2, '0')}.${String(n % 1e6).padStart(6, '0')}+00:00`;
  const srv = {
    log, down: false, state: () => state, version: ver,
    expire(uid) { [...tokens].forEach(([t, u]) => { if (u === uid) tokens.delete(t); }); },
    expireAll() { tokens.clear(); },
    // another person (or another device) changes the server directly
    mutate(fn) { fn(state); n++; },
    reorder: false, // the database stores object keys in its own order, not the browser's
    async handle(url, method, body, headers) {
      if (srv.down) throw new Error('Failed to fetch');
      log.push({ url, method });
      if (url === '/api/sdc/status') return [200, { gateway: true, safeWrite: true }];
      if (url === '/api/sdc/login') {
        const u = state.users.find(x => x.email === body.email); if (!u) return [401, { error: 'Wrong email or password.' }];
        const token = `tok-${u.id}-${++k}`; tokens.set(token, u.id);
        return [200, { token, userId: u.id, state: clone(state), updatedAt: ver() }];
      }
      const uid = tokens.get(String(headers?.Authorization || '').replace(/^Bearer /, ''));
      if (!uid) return [401, { error: 'Your session has expired. Please sign in again.', code: 'auth_expired' }];
      const me = state.users.find(x => x.id === uid);
      if (url === '/api/sdc/state' && method === 'PUT') {
        const out = T.applySave(state, body.state, me, T.readKnown(body.base)); state = srv.reorder ? reorder(out.state) : out.state; n++;
        return [200, { updatedAt: ver(), ...(out.rejected.length ? { rejected: out.rejected } : {}), ...(out.resync ? { resync: true } : {}) }];
      }
      if (url === '/api/sdc/state') return [200, { state: clone(state), updatedAt: ver() }];
      return [404, {}];
    }
  };
  return srv;
}

function Tab(browser, server, { session = new Map(), locks = null } = {}) {
  const listeners = {}, sent = [];
  const tab = { sent, ss: session, ctx: null, fire(type, e) { (listeners[type] || []).forEach(fn => fn(e || {})); } };
  const sstore = { getItem: k => session.has(k) ? session.get(k) : null, setItem: (k, v) => session.set(k, String(v)), removeItem: k => session.delete(k), get length() { return session.size; }, key: i => [...session.keys()][i] ?? null };
  const ctx = {
    console: { warn() {}, log() {}, error() {} }, URL, URLSearchParams, Intl, Blob: class {}, Event: class { constructor(t) { this.type = t; } },
    localStorage: browser.facade(tab), sessionStorage: sstore, document: stubDocument(), location: {},
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; return a; } },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, navigator: locks ? { locks } : undefined,
    loadSupabase: async () => { throw new Error('direct mode must not be used'); },
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET', body = opts.body ? JSON.parse(opts.body) : undefined;
      sent.push({ url, method, body });
      const [status, json] = await server.handle(url, method, body, opts.headers);
      return { ok: status < 400, status, json: async () => json };
    }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.SDC_CLOUD_CONFIG = { enabled: true, url: 'https://fake-test-project.supabase.co', anonKey: 'fake' };
  ctx.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
  ctx.dispatchEvent = () => true;
  vm.createContext(ctx);
  vm.runInContext(SRC + ';globalThis.__x={db,saveDB,updateRecord,addRecord,deleteRecord,findRecord,invalidateCache,logout,toast,persist,normalizeState,SEED}', ctx, { filename: 'bundle.js' });
  Object.assign(tab, ctx.__x, { cloud: ctx.SDCCloud, ls: ctx.localStorage, puts: () => sent.filter(x => x.method === 'PUT'), toasts: [] });
  tab.ctx = ctx;
  browser.tabs.push(tab);
  tab.signIn = async (email, remember) => { const uid = await tab.cloud.signIn(email, 'pw', !!remember); session.set('sdcSession', uid); tab.invalidateCache(); return uid; };
  tab.reload = () => Tab(browser, server, { session, locks }); // same browser storage, fresh memory
  tab.close = () => { const i = browser.tabs.indexOf(tab); if (i >= 0) browser.tabs.splice(i, 1); };
  return tab;
}

// A simple Web Locks stand-in shared by tabs: one holder at a time per name.
function Locks() {
  const chains = new Map();
  return { request: (name, fn) => { const prev = chains.get(name) || Promise.resolve(); const run = prev.then(() => fn(), () => fn()); chains.set(name, run.catch(() => {})); return run; } };
}

module.exports = { Browser, Server, Tab, Locks, clone, T };
