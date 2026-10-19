// Stage 2 database tests against a LOCAL PostgreSQL cluster (127.0.0.1 only, sdc_test_* databases,
// dummy data only). Run: npm run test:db  (first: node scripts/localdb/cli.js init)
// 1 fresh database  2 existing production-shaped schema with LMS data  3 concurrent transactions
// 4 failed writes  5 permissions and grants  6 + 7 the full safe-write scenarios through the real
// server code. Never touches Supabase.
const assert = require('assert'), crypto = require('crypto'), fs = require('fs'), path = require('path'), vm = require('vm');
for (const k of ['SDC_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SDC_ALLOW_LIVE', 'VERCEL', 'NODE_ENV']) delete process.env[k];
const pg = require('../scripts/localdb/pg.js');

const PUT_IF = 'supabase/migrations/20261014000100_sdc_state_put_if.sql', BASELINE = 'supabase/migrations/20261014000000_sdc_baseline.sql', ROLLBACK = 'supabase/rollback/20261014000100_sdc_state_put_if.down.sql';
const SECRET = crypto.randomBytes(16).toString('hex'), L = pg.lit;
const q = (db, sql) => pg.psql(db, sql);
const val = async (db, sql) => JSON.parse(await q(db, `select coalesce((${sql})::text, 'null');`));
const putIf = (db, state, expected, secret = SECRET) => val(db, `select to_jsonb(public.sdc_state_put_if(${L(secret)}, ${L(state)}::jsonb, ${L(expected)}::timestamptz))`);
const rowOf = db => val(db, `select jsonb_build_object('state', state, 'updated_at', updated_at, 'text', md5(state::text)) from public.sdc_learn_state where id = 'sdc-learn-main'`);
const rejects = async (p, code, msg) => { try { await p; } catch (e) { assert.equal(e.code, code, msg + ': ' + e.message); return e; } assert.fail(msg + ': expected ' + code); };
const catalog = db => q(db, `select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || p.prosecdef || ' ' || coalesce(p.proacl::text, '') || ' ' || md5(pg_get_functiondef(p.oid)), E'\\n' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'sdc\\_%'`);
// Policies (coalesce: gateway.sql drops them all, and a NULL would blank the whole line) and table grants.
const access = db => q(db, `select coalesce((select string_agg(policyname, ',' order by policyname) from pg_policies where tablename = 'sdc_learn_state'), '') || ' | ' ||
  has_table_privilege('anon', 'public.sdc_learn_state', 'select') || has_table_privilege('anon', 'public.sdc_learn_state', 'update') || has_table_privilege('authenticated', 'public.sdc_learn_secret', 'select')`);

// backend/state-api.js must not be loaded before the scenarios point it at the local stand-in,
// so the (same) password hash scheme is repeated here.
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hashPassword = (pw, salt) => { let h = `${salt}:${pw}`; for (let i = 0; i < 1500; i++) h = sha(h + salt); return h; };
function demoState() {
  const SEED = vm.runInNewContext(fs.readFileSync(path.join(pg.ROOT, 'js', 'seed.js'), 'utf8') + ';SEED', {});
  SEED.users.forEach(u => { if (u.password) { u.salt = 'demo' + u.id; u.passwordHash = hashPassword(u.password, u.salt); delete u.password; } });
  return SEED;
}

(async () => {
  if (!pg.available()) throw new Error('psql was not found. Install PostgreSQL or set PG_BIN to its bin folder.');
  if (!pg.up()) throw new Error(`No local PostgreSQL on 127.0.0.1:${pg.CONN.port}. Run: node scripts/localdb/cli.js init`);
  const made = [];
  // Never reset a pre-existing test database. Only databases created by this invocation are removed.
  const suffix = '_' + crypto.randomBytes(6).toString('hex');
  const fresh = async name => { name += suffix; await pg.createDb(name); made.push(name); await pg.apply(name, ['supabase/local/roles.sql']); return name; };
  try {
    // ---- 1. fresh database -------------------------------------------------------------------
    const F = await fresh('sdc_test_fresh');
    await pg.apply(F, pg.MIGRATIONS());
    await pg.setSecret(F, SECRET);
    assert.match(await catalog(F), /sdc_state_put_if\(p_secret text, p_state jsonb, p_expected timestamp with time zone\) true/, 'function exists with the planned signature, SECURITY DEFINER');
    const st = { users: [{ id: 'U1' }], courses: [] };
    const t1 = await putIf(F, st, null);
    assert.ok(t1, 'p_expected NULL creates the row');
    assert.equal(await putIf(F, st, null), null, 'p_expected NULL never overwrites an existing row');
    const t2 = await putIf(F, { ...st, courses: [{ id: 'C1' }] }, t1);
    assert.ok(t2 && Date.parse(t2) >= Date.parse(t1) && t2 !== t1, 'matching version saves and moves the version forward');
    assert.equal(await putIf(F, { ...st, courses: [{ id: 'STALE' }] }, t1), null, 'stale version: NULL');
    assert.deepEqual((await rowOf(F)).state.courses, [{ id: 'C1' }], 'stale write did not change the row');
    assert.equal((await rowOf(F)).updated_at, t2, 'sdc_state_get-style value equals the returned value (raw string, microseconds)');
    // failed writes: nothing changes
    const before = await rowOf(F);
    await rejects(putIf(F, st, t2, 'wrong-secret'), '42501', 'wrong secret');
    await rejects(val(F, `select to_jsonb(public.sdc_state_put_if(null, ${L(st)}::jsonb, ${L(t2)}::timestamptz))`), '42501', 'null secret');
    for (const bad of [{}, { users: [] }, { users: {} }, { users: 'x' }]) await rejects(putIf(F, bad, t2), '22023', 'invalid users ' + JSON.stringify(bad));
    await rejects(putIf(F, {}, '1970-01-01T00:00:00Z'), '22023', 'the status probe raises and cannot write');
    assert.deepEqual(await rowOf(F), before, 'failed calls left the row untouched');
    // permissions: the publishable-key roles may call the function but never touch the tables
    await rejects(q(F, `set role anon; select count(*) from public.sdc_learn_state;`), '42501', 'anon cannot read the state table');
    await rejects(q(F, `set role authenticated; update public.sdc_learn_state set state = '{}';`), '42501', 'authenticated cannot write the table');
    await rejects(q(F, `set role anon; select secret_hash from public.sdc_learn_secret;`), '42501', 'anon cannot read the secret hash');
    const asAnon = JSON.parse(await q(F, `set role anon; select coalesce(to_jsonb(public.sdc_state_put_if(${L(SECRET)}, ${L({ ...st, courses: [{ id: 'ANON' }] })}::jsonb, ${L(t2)}::timestamptz))::text, 'null');`));
    assert.ok(asAnon, 'anon (publishable key) can save through the function with the secret');
    await q(F, `create role sdc_test_stranger nologin;`).catch(() => {});
    await rejects(q(F, `set role sdc_test_stranger; select public.sdc_state_put_if('x', '{}'::jsonb, null);`), '42501', 'roles without the grant cannot even call it');
    // idempotent: applying the migration again changes nothing
    const cat = await catalog(F), row1 = await rowOf(F);
    await pg.apply(F, [PUT_IF]);
    assert.equal(await catalog(F), cat); assert.deepEqual(await rowOf(F), row1);

    // ---- 3. concurrency inside PostgreSQL ------------------------------------------------------
    const base = (await rowOf(F)).updated_at;
    const slow = q(F, `begin; select coalesce(to_jsonb(public.sdc_state_put_if(${L(SECRET)}, ${L({ ...st, who: 'first' })}::jsonb, ${L(base)}::timestamptz))::text, 'null'); select pg_sleep(1.5); commit;`);
    await new Promise(r => setTimeout(r, 400));
    const t0 = Date.now(), second = await putIf(F, { ...st, who: 'second' }, base), waited = Date.now() - t0;
    const firstOut = await slow;
    assert.notEqual(firstOut.split('\n')[0], 'null', 'first writer saved');
    assert.equal(second, null, 'second writer with the same version is refused');
    assert.ok(waited > 600, `second writer waited for the row lock (${waited} ms), then re-checked the version`);
    assert.equal((await rowOf(F)).state.who, 'first');
    const v = (await rowOf(F)).updated_at;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => putIf(F, { ...st, who: 'racer' + i }, v)));
    assert.equal(results.filter(Boolean).length, 1, 'eight simultaneous writers, exactly one wins');

    // ---- preconditions --------------------------------------------------------------------------
    const E = await fresh('sdc_test_empty');
    const pe = await rejects(pg.apply(E, [PUT_IF]), 'P0001', 'migration on a database without the gateway schema');
    assert.match(pe.message, /apply supabase\/schema\.sql/);
    assert.equal(await q(E, `select to_regproc('public.sdc_state_put_if') is null;`), 't', 'nothing was created (transaction rolled back)');
    await pg.apply(E, ['supabase/schema.sql']); // direct mode only, gateway.sql never applied
    await rejects(pg.apply(E, [PUT_IF]), 'P0001', 'production still in direct mode (no sdc_learn_secret)');
    await q(E, `do $$ begin if not exists (select 1 from pg_roles where rolname = 'sdc_test_nonowner') then create role sdc_test_nonowner nologin; end if; end $$;`);
    await pg.apply(E, ['supabase/gateway.sql']);
    const no = await rejects(pg.psql(E, `set role sdc_test_nonowner;\n` + pg.sqlFile(PUT_IF), { tx: true }), 'P0001', 'run by a role that does not own the table');
    assert.match(no.message, /owner of public\.sdc_learn_state/);

    // ---- 2 + 7. existing production-shaped schema with LMS data ------------------------------------
    const X = await fresh('sdc_test_existing');
    await pg.apply(X, ['supabase/schema.sql', 'supabase/gateway.sql']); // the files production ran, unmodified
    await pg.setSecret(X, SECRET); // replace the committed hash with this test's secret
    const lms = demoState();
    const legacyAt = await val(X, `select to_jsonb(public.sdc_state_put(${L(SECRET)}, ${L(lms)}::jsonb))`);
    await q(X, `insert into public.sdc_learn_kv (key, value) values ('ai-usage', '{"calls": 3}');`);
    const cat0 = await catalog(X), acc0 = await access(X), row0 = await rowOf(X), kv0 = await q(X, `select value::text from public.sdc_learn_kv;`);
    assert.equal(row0.updated_at, legacyAt);
    await pg.apply(X, [PUT_IF]);
    const cat1 = await catalog(X);
    assert.deepEqual(await rowOf(X), row0, 'existing state row unchanged (content and updated_at)');
    assert.equal(await q(X, `select value::text from public.sdc_learn_kv;`), kv0, 'kv rows unchanged');
    assert.equal(acc0, ' | falsefalsefalse', 'production shape: no policies, anon/authenticated cannot read or write');
    assert.equal(await access(X), acc0, 'policies and table grants unchanged');
    assert.deepEqual(cat1.split('\n').filter(l => !l.startsWith('sdc_state_put_if(')), cat0.split('\n'), 'existing functions, signatures, SECURITY DEFINER flags and grants unchanged');
    assert.equal(cat1.split('\n').length, cat0.split('\n').length + 1, 'exactly one function added');
    const xt = await putIf(X, { ...row0.state, courses: [...row0.state.courses, { id: 'C-NEW' }] }, row0.updated_at);
    assert.ok(xt, 'the version read from the legacy row is accepted by the new function');
    assert.equal((await rowOf(X)).state.users.length, lms.users.length, 'LMS data intact after a conditional save');
    // the baseline really matches what production ran: applying it changes no function or row
    const rowBefore = await rowOf(X);
    await pg.apply(X, [BASELINE]);
    assert.equal(await catalog(X), cat1, 'baseline bodies are byte-identical to supabase/gateway.sql');
    assert.deepEqual(await rowOf(X), rowBefore);
    // rollback removes only the new function
    await pg.apply(X, [ROLLBACK]);
    assert.equal(await catalog(X), cat0, 'rollback restores the original function set');
    assert.deepEqual(await rowOf(X), rowBefore, 'rollback touches no data');
    await pg.apply(X, [PUT_IF]);

    // ---- 8. the largest AI course (48 sessions with full content) and concurrent saves -------------
    {
    const S = await fresh('sdc_test_scale');
    await pg.apply(S, pg.MIGRATIONS());
    await pg.setSecret(S, SECRET);
    const filler = n => 'x'.repeat(n);
    const bigCourse = (tag, perSession) => ({ course: { id: 'C-AI-' + tag, title: 'Scale ' + tag, status: 'draft', aiGenerated: true },
      sessions: Array.from({ length: 48 }, (_, i) => ({ id: `S-AI-${tag}-${String(i + 1).padStart(2, '0')}`, courseId: 'C-AI-' + tag, order: i + 1, title: 'Session ' + (i + 1),
        content: { v: 1, lesson: [{ heading: 'h', body: filler(perSession / 2), example: '```js\nconsole.log(1);\n```' }], practice: [{ title: 't', task: filler(perSession / 2) }], meta: { parts: { lesson: { at: 't' } } } } })) });
    const withCourse = (base, c) => ({ ...base, courses: [...base.courses, c.course], sessions: [...base.sessions, ...c.sessions] });
    const real = withCourse(demoState(), bigCourse('REAL', 30000)), worst = withCourse(real, bigCourse('WORST', 72000));
    let ver = await putIf(S, real, null);
    assert.ok(ver, 'a 48-session course with realistic content (about 30 KB a session) saves');
    const realBack = (await rowOf(S)).state.sessions.filter(s => s.courseId === 'C-AI-REAL');
    assert.equal(realBack.length, 48);
    assert.deepEqual(realBack, real.sessions.filter(s => s.courseId === 'C-AI-REAL'), 'read back exactly as saved');
    const t0 = Date.now();
    ver = await putIf(S, worst, ver);
    assert.ok(ver, `a second 48-session course at the largest possible size (${Math.round(JSON.stringify(worst).length / 1024)} KB state) saves`);
    const saveMs = Date.now() - t0;
    // Concurrent saves of different sessions (two coordinators): one wins, the other gets NULL, reloads and saves again.
    const edit = (st, sid, text) => ({ ...st, sessions: st.sessions.map(s => (s.id === sid ? { ...s, content: { ...s.content, objectives: [text] } } : s)) });
    const writers = ['01', '02', '03', '04', '05'].map(n => ({ sid: `S-AI-REAL-${n}`, text: 'edited by writer ' + n }));
    const first = await rowOf(S);
    const results = await Promise.all(writers.map(w => putIf(S, edit(first.state, w.sid, w.text), first.updated_at)));
    assert.equal(results.filter(Boolean).length, 1, 'of five saves made from the same version, exactly one is accepted');
    for (const w of writers) {
      for (let tries = 0; ; tries++) {
        const cur = await rowOf(S);
        if (cur.state.sessions.find(s => s.id === w.sid).content.objectives?.[0] === w.text) break;
        if (await putIf(S, edit(cur.state, w.sid, w.text), cur.updated_at)) break;
        assert.ok(tries < 5, 'a refused save succeeds after reloading');
      }
    }
    const end = (await rowOf(S)).state;
    writers.forEach(w => assert.equal(end.sessions.find(s => s.id === w.sid).content.objectives[0], w.text, 'no edit was lost'));
    assert.equal(end.sessions.filter(s => s.courseId === 'C-AI-WORST').length, 48, 'the other course is untouched');
    console.log(`db.test.js: 48-session courses persist (state ${Math.round(JSON.stringify(worst).length / 1024)} KB saved in ${saveMs} ms); 5 concurrent saves: 1 accepted, 4 refused and saved after reloading, nothing lost`);
    }

    // ---- 9. generated code survives the database exactly (jsonb keeps text, not key order) ----------
    {
      const CCL = require('../js/coursecontent-logic.js'), D = await fresh('sdc_test_code');
      await pg.apply(D, pg.MIGRATIONS());
      await pg.setSecret(D, SECRET);
      const PYC = ['import pandas as pd\n\ndef clean(df):\n    if df.empty:\n        return df\n    df = df.drop_duplicates()\n    return df.fillna(df.mean()).reset_index()\n\nprint(clean(pd.DataFrame()).isnull().sum().sum())\nplt.tight_layout()\nplt.show()',
        'for name, group in df.groupby("dept"):\n    total = 0\n    for _, row in group.iterrows():\n        if row["pay"] > 0:\n            total += row["pay"]\n    print(name, total)'];
            const JSC = ['async function load(id) {\n  try {\n    const res = await fetch("/api/users/" + id);\n    return await res.json();\n  } catch (err) {\n    console.error(err.message);\n  }\n}',
        'fetch(url)\n  .then(res => res.json())\n  .then(data => data.items.map(i => i.name).filter(Boolean))\n  .catch(err => console.error(err));'];
      const mk = (lang, codes) => {
        const F = '`'.repeat(3), fence = c => F + lang + '\n' + c + '\n' + F, w = n => Array.from({ length: n }, () => 'explain').join(' ');
        const lesson = CCL.normalizePart('lesson', { objectives: ['a', 'b'], prerequisites: ['p'], timePlan: [{ minutes: 60, activity: 'x' }, { minutes: 60, activity: 'y' }],
          lesson: [0, 1, 2].map(i => ({ heading: 'H' + i, body: w(60), example: 'Example:\n' + fence(codes[i % 2]) })) }, { lang }).value;
        const practice = CCL.normalizePart('practice', { tutorials: [{ title: 'T', goal: 'g', steps: ['one', 'Type:\n' + fence(codes[0]), 'three'] }],
          codeExamples: codes.map((c, i) => ({ title: 'E' + i, language: lang, code: c, explanation: 'x' })), demos: [{ title: 'D', description: 'd' }],
          guided: [{ title: 'G', instructions: 'i', steps: ['a', 'b', 'c'], solution: codes[0] }], practice: [{ title: 'P', task: 't' }] }, { lang }).value;
        return { lesson, practice };
      };
      const state0 = demoState(), sessions = [];
      for (const [lang, codes] of [['python', PYC], ['javascript', JSC]]) {
        const p = mk(lang, codes);
        let c = CCL.applyPart({}, 'lesson', p.lesson, { at: 't1', provider: 'stub', model: 'm' });
        c = CCL.applyPart(c, 'practice', p.practice, { at: 't2', provider: 'stub', model: 'm' });
        sessions.push({ id: 'S-CODE-' + lang, courseId: 'C-CODE-' + lang, order: 1, title: 'Code', duration: '2h', content: c });
      }
      const state = { ...state0, courses: [...state0.courses, ...['python', 'javascript'].map(l => ({ id: 'C-CODE-' + l, title: l, status: 'draft' }))], sessions: [...state0.sessions, ...sessions] };
      const v = await putIf(D, state, null);
      assert.ok(v, 'content with Python and JavaScript saves');
      const back = (await rowOf(D)).state.sessions.filter(s => /^S-CODE-/.test(s.id));
      assert.deepEqual(back, sessions, 'read back exactly as saved');
      const codeOf = s => s.content.codeExamples.map(x => x.code);
      assert.deepEqual(codeOf(back.find(s => /python/.test(s.id))), PYC, 'Python: brackets, chained calls and indentation are byte for byte');
      assert.deepEqual(codeOf(back.find(s => /javascript/.test(s.id))), JSC, 'JavaScript: template strings, arrows and chains are byte for byte');
      back.forEach(s => assert.deepEqual(CCL.codeReport(s).findings, [], 'nothing flagged after the round trip'));
      // a person edits the stored Python through the same rules and saves again
      const edited = CCL.applyEdit(back[0].content, { guided: [{ title: 'G', instructions: 'i', steps: ['a', 'b', 'c'], solution: PYC[1] }] }, 'u-admin', 'tE');
      assert.equal(edited.changed, true);
      const v2 = await putIf(D, { ...state, sessions: state.sessions.map(s => (s.id === back[0].id ? { ...s, content: edited.content } : s)) }, v);
      assert.ok(v2);
      const again = (await rowOf(D)).state.sessions.find(s => s.id === back[0].id);
      assert.ok(again.content.guided[0].solution.includes(PYC[1]), 'the edit is stored with its indentation');
      assert.deepEqual(codeOf(again), PYC, 'and the code examples beside it did not change');
      console.log('db.test.js: Python and JavaScript content is stored and read back byte for byte, before and after a person edits it');
    }

    // ---- 4-7. the full scenarios through the real server code ------------------------------------
    const A = await fresh('sdc_test_app');
    await pg.apply(A, pg.MIGRATIONS());
    const backend = {
      label: 'local PostgreSQL',
      call: (fn, args) => pg.callFn(A, fn, args),
      setSecret: s => pg.setSecret(A, s),
      seed: async st => JSON.parse(await q(A, `insert into public.sdc_learn_state (id, state, updated_at) values ('sdc-learn-main', ${L(st)}::jsonb, clock_timestamp())
        on conflict (id) do update set state = excluded.state, updated_at = greatest(clock_timestamp(), public.sdc_learn_state.updated_at + interval '1 microsecond') returning to_jsonb(updated_at)::text;`)),
      row: () => val(A, `select jsonb_build_object('state', state, 'updated_at', updated_at) from public.sdc_learn_state where id = 'sdc-learn-main'`),
      setPutIf: on => pg.apply(A, [on ? PUT_IF : ROLLBACK])
    };
    const steps = await require('./support/scenarios.js').run(backend);
    console.log(`db.test.js: SQL checks passed; ${steps.length} server scenarios passed on local PostgreSQL ${await q('postgres', 'show server_version;')}`);
  } finally {
    for (const d of made) await pg.dropDb(d).catch(() => {});
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
