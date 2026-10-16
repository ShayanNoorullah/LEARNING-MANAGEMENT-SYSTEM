/* SDC Learn — LOCAL / TEST ONLY stand-in for the Supabase REST endpoint the gateway uses.
   backend/state-api.js only calls POST {SUPABASE_URL}/rest/v1/rpc/<function>; this answers those
   calls on 127.0.0.1 with PostgREST-style JSON and errors, so the real server code runs unchanged
   against a local database (or the in-memory fake in tests). It is not a PostgREST replacement and
   is never used in production. Google sign-in (/auth/v1/user) is always refused. */
const http = require('http');

// call(fn, args) -> value, or throws { status, code, message }. hooks.before(fn, args) may delay or fail a call.
function createRestServer(call, hooks = {}, port = 0) {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('The local REST stand-in never runs in production.');
  const server = http.createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(req.url.split('?')[0]);
    if (req.method !== 'POST' || !m) return send(req.url.startsWith('/auth/v1/') ? 401 : 404, { code: 'PGRST000', message: 'not available locally' });
    if (!req.headers.apikey) return send(401, { code: 'PGRST301', message: 'No API key found in request' });
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', d => raw += d);
    req.on('end', async () => {
      try {
        const args = raw ? JSON.parse(raw) : {};
        if (hooks.before) await hooks.before(m[1], args);
        send(200, await call(m[1], args));
      } catch (e) {
        send(e.status || 400, { code: e.code || 'XX000', message: e.message, details: null, hint: null });
      }
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(r => server.close(r)), server })));
}

module.exports = { createRestServer };
