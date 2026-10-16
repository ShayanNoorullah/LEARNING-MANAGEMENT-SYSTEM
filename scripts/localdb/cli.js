#!/usr/bin/env node
/* SDC Learn — LOCAL / TEST ONLY database commands (see SETUP.md, "Local PostgreSQL").
     node scripts/localdb/cli.js init     create a private cluster in .localdb/ (127.0.0.1:54329) and start it
     node scripts/localdb/cli.js start    start it          stop   stop it          status   is it running?
     node scripts/localdb/cli.js setup    (re)create database sdc_dev: Supabase role names, all migrations,
                                          a generated local secret and the demo seed data (dummy only)
     node scripts/localdb/cli.js dev      run the app against sdc_dev (REST stand-in on 127.0.0.1:54321)
   Uses the installed PostgreSQL binaries only. It never touches the PostgreSQL service on 5432, never
   edits a global configuration and never connects anywhere but 127.0.0.1. */
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto'), vm = require('vm');
const pg = require('./pg');

const PGDATA = path.join(pg.DATA, 'data'), LOG = path.join(pg.DATA, 'postgres.log'), SECRET_FILE = path.join(pg.DATA, 'dev-secret');
const run = (exe, args) => { const r = cp.spawnSync(pg.bin(exe), args, { encoding: 'utf8', env: pg.env(), windowsHide: true }); if (r.status !== 0) throw new Error(`${exe} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`); return r.stdout; };

function init() {
  if (fs.existsSync(path.join(PGDATA, 'PG_VERSION'))) { console.log('Cluster already exists in', PGDATA); return start(); }
  fs.mkdirSync(pg.DATA, { recursive: true });
  // trust is limited to loopback by listen_addresses below; the cluster holds dummy data only.
  run('initdb', ['-D', PGDATA, '-U', pg.CONN.user, '-A', 'trust', '-E', 'UTF8', '--locale=C']);
  fs.appendFileSync(path.join(PGDATA, 'postgresql.conf'), `\n# SDC Learn local cluster\nlisten_addresses = '127.0.0.1'\nport = ${pg.CONN.port}\n`);
  console.log('Created a private cluster in', PGDATA);
  start();
}
function start() {
  if (pg.up()) return console.log(`Local PostgreSQL is running on 127.0.0.1:${pg.CONN.port}`);
  // pg_ctl -w waits for start-up; the server keeps running after this command exits.
  const r = cp.spawnSync(pg.bin('pg_ctl'), ['start', '-w', '-D', PGDATA, '-l', LOG], { stdio: 'ignore', env: pg.env(), windowsHide: true });
  if (r.status !== 0) throw new Error('pg_ctl start failed; see ' + LOG);
  console.log(`Local PostgreSQL started on 127.0.0.1:${pg.CONN.port} (log: ${LOG})`);
}
const stop = () => { run('pg_ctl', ['stop', '-D', PGDATA, '-m', 'fast']); console.log('Stopped.'); };

function devSecret() {
  if (!fs.existsSync(SECRET_FILE)) { fs.mkdirSync(pg.DATA, { recursive: true }); fs.writeFileSync(SECRET_FILE, crypto.randomBytes(24).toString('hex')); }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}
function demoState() {
  const { hashPassword } = require('../../backend/state-api.js')._test;
  const SEED = vm.runInNewContext(fs.readFileSync(path.join(pg.ROOT, 'js', 'seed.js'), 'utf8') + ';SEED', {});
  SEED.users.forEach(u => { if (u.password) { u.salt = crypto.randomBytes(8).toString('hex'); u.passwordHash = hashPassword(u.password, u.salt); delete u.password; } });
  return SEED;
}
async function setup(db = 'sdc_dev') {
  if (!pg.up()) throw new Error('Local PostgreSQL is not running. Run: node scripts/localdb/cli.js init');
  await pg.createDb(db, { drop: true });
  await pg.apply(db, ['supabase/local/roles.sql', ...pg.MIGRATIONS()]);
  await pg.setSecret(db, devSecret());
  const at = await pg.callFn(db, 'sdc_state_put_if', { p_secret: devSecret(), p_state: demoState(), p_expected: null });
  console.log(`Database ${db} ready: ${pg.MIGRATIONS().length} migrations, demo data saved at ${at}.`);
}
async function dev() {
  if (!pg.up()) throw new Error('Local PostgreSQL is not running. Run: node scripts/localdb/cli.js init && node scripts/localdb/cli.js setup');
  const { createRestServer } = require('./rest');
  const rest = await createRestServer((fn, args) => pg.callFn('sdc_dev', fn, args), {}, Number(process.env.SDC_LOCALREST_PORT || 54321));
  console.log('Local REST stand-in for sdc_dev on', rest.url);
  // The secret is passed to the child only; it is never printed. Stage 1 safety sees a non-live host.
  const child = cp.spawn(process.execPath, ['--watch', path.join(pg.ROOT, 'backend', 'server.js')], {
    stdio: 'inherit', env: { ...process.env, SUPABASE_URL: rest.url, SUPABASE_ANON_KEY: 'local-dev-anon-key', SDC_STATE_SECRET: devSecret(), SDC_ALLOW_LIVE: '' }
  });
  const end = () => { child.kill(); rest.close().then(() => process.exit(0)); };
  process.on('SIGINT', end); process.on('SIGTERM', end); child.on('exit', code => rest.close().then(() => process.exit(code || 0)));
}

const cmd = process.argv[2];
const cmds = { init, start, stop, status: () => console.log(pg.up() ? `running on 127.0.0.1:${pg.CONN.port}` : 'not running'), setup: () => setup(process.argv[3]), dev };
if (!cmds[cmd]) { console.log('Usage: node scripts/localdb/cli.js init|start|stop|status|setup|dev'); process.exit(cmd ? 1 : 0); }
Promise.resolve().then(cmds[cmd]).catch(e => { console.error(e.message); process.exit(1); });
