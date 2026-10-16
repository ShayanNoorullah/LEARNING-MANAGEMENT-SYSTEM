/* SDC Learn — LOCAL / TEST ONLY PostgreSQL helper (never required by backend/ or api/).
   Talks to a private PostgreSQL cluster on 127.0.0.1 through the installed psql binary, so no npm
   database driver is needed. Every call is checked: loopback host only, a database whose name starts
   with sdc_dev or sdc_test, and never on Vercel or with NODE_ENV=production. */
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const DATA = process.env.SDC_LOCALDB_DIR || path.join(ROOT, '.localdb');
const CONN = { host: '127.0.0.1', port: Number(process.env.SDC_LOCALDB_PORT || 54329), user: 'sdc_local' };
const DB_NAME = /^sdc_(dev|test)[a-z0-9_]*$/;

function assertLocal(db) {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('Local database tools are disabled in production.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(CONN.host)) throw new Error('Local database tools only connect to 127.0.0.1.');
  if (db !== 'postgres' && !DB_NAME.test(db)) throw new Error(`Refusing database "${db}": local databases must be named sdc_dev* or sdc_test*.`);
}

// PG_BIN, else the newest C:\Program Files\PostgreSQL\<n>\bin, else whatever is on PATH.
function bin(name) {
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, exe);
  const base = 'C:\\Program Files\\PostgreSQL';
  if (process.platform === 'win32' && fs.existsSync(base)) {
    const v = fs.readdirSync(base).filter(d => fs.existsSync(path.join(base, d, 'bin', exe))).sort((a, b) => Number(b) - Number(a))[0];
    if (v) return path.join(base, v, 'bin', exe);
  }
  return exe;
}
const available = () => { try { return cp.spawnSync(bin('psql'), ['--version'], { encoding: 'utf8' }).status === 0; } catch (e) { return false; } };

// Child env without inherited PG* variables, so nothing can redirect psql to another server.
function env() {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^PG/i.test(k)) e[k] = v;
  return { ...e, PGCONNECT_TIMEOUT: '5', PGCLIENTENCODING: 'UTF8' };
}

// Runs SQL through stdin. Resolves to stdout (unaligned, tuples only); rejects with {code, message}.
function psql(db, sql, { tx = false } = {}) {
  assertLocal(db);
  return new Promise((resolve, reject) => {
    const p = cp.spawn(bin('psql'), ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', CONN.host, '-p', String(CONN.port), '-U', CONN.user, '-d', db], { env: env(), windowsHide: true });
    let out = '', err = '';
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => {
      // psql on Windows ends lines with \r\n (JSON values never contain a raw CR: it is escaped).
      if (code === 0) return resolve(out.replace(/\r\n/g, '\n').replace(/\n$/, ''));
      const m = /ERROR:\s+([0-9A-Z]{5}):\s*([^\r\n]*)/.exec(err);
      reject(Object.assign(new Error(m ? m[2] : err.trim() || `psql exited with ${code}`), { code: m ? m[1] : 'psql', stderr: err }));
    });
    p.stdin.end('\\set VERBOSITY verbose\n' + (tx ? `begin;\n${sql}\ncommit;\n` : sql + '\n'), 'utf8');
  });
}

// Dollar-quoted literal with a random tag that cannot occur in the value (no escaping needed).
function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  let tag; do { tag = '$q' + crypto.randomBytes(6).toString('hex') + '$'; } while (s.includes(tag));
  return tag + s + tag;
}

const FUNCTIONS = ['sdc_state_get', 'sdc_state_put', 'sdc_state_put_if', 'sdc_kv_get', 'sdc_kv_put'];
// Calls one gateway function with named arguments, like PostgREST does. Missing function -> PGRST202.
async function callFn(db, fn, args) {
  if (!FUNCTIONS.includes(fn)) throw Object.assign(new Error('Could not find the function'), { status: 404, code: 'PGRST202' });
  const named = Object.entries(args).map(([k, v]) => { if (!/^p_[a-z_]+$/.test(k)) throw new Error('bad argument ' + k); return `${k} => ${lit(v)}`; }).join(', ');
  try {
    const out = await psql(db, `select coalesce(to_jsonb(public.${fn}(${named}))::text, 'null');`);
    return JSON.parse(out);
  } catch (e) {
    if (e.code === '42883') throw Object.assign(new Error('Could not find the function public.' + fn), { status: 404, code: 'PGRST202' });
    throw Object.assign(e, { status: e.code === '42501' ? 403 : 400 });
  }
}

const sqlFile = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MIGRATIONS = () => fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort().map(f => 'supabase/migrations/' + f);
// Each file in its own transaction, as the Supabase CLI and SQL Editor run them.
async function apply(db, files) { for (const f of files) await psql(db, sqlFile(f), { tx: true }); }
const secretHash = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const setSecret = (db, secret) => psql(db, `insert into public.sdc_learn_secret (id, secret_hash) values (1, ${lit(secretHash(secret))}) on conflict (id) do update set secret_hash = excluded.secret_hash;`);

async function createDb(db, { drop = false } = {}) {
  assertLocal(db);
  if (drop) await psql('postgres', `drop database if exists ${db} with (force);`);
  await psql('postgres', `create database ${db} encoding 'UTF8' template template0;`);
}
const dropDb = db => (assertLocal(db), psql('postgres', `drop database if exists ${db} with (force);`));
const up = () => { try { return cp.spawnSync(bin('pg_isready'), ['-h', CONN.host, '-p', String(CONN.port)], { encoding: 'utf8', env: env() }).status === 0; } catch (e) { return false; } };

module.exports = { ROOT, DATA, CONN, bin, available, up, psql, lit, callFn, apply, sqlFile, MIGRATIONS, secretHash, setSecret, createDb, dropDb, assertLocal, FUNCTIONS, env };
