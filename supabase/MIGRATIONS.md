# Database migrations — SDC Learn

Production runs on **Supabase PostgreSQL**. Development and database tests run on a **local PostgreSQL**
cluster (see [SETUP.md](../SETUP.md#5c-local-postgresql-development-and-database-tests)). Every database
change is a versioned file in `supabase/migrations/`, written so it can be applied to the existing
production schema and to a fresh database.

## Files

| File | What it does | Production |
|---|---|---|
| `migrations/20261014000000_sdc_baseline.sql` | The schema `schema.sql` + `gateway.sql` already created (3 tables, 4 functions, grants, gateway lock-down). No secret. | **Already present. Do not run.** With the Supabase CLI: `supabase migration repair --status applied 20261014000000` |
| `migrations/20261014000100_sdc_state_put_if.sql` | Adds `sdc_state_put_if(text, jsonb, timestamptz)`: compare-and-swap save. Additive only. | **Apply** (Stage 2) |
| `rollback/20261014000100_sdc_state_put_if.down.sql` | Removes that function only. | Recovery only |
| `local/roles.sql` | Creates the Supabase role names `anon`, `authenticated`, `service_role` on plain PostgreSQL. | **Never** (they exist in Supabase) |
| `schema.sql`, `gateway.sql` | The original setup scripts, unchanged. | Already applied |

Rules for new migrations: one change per file, named `YYYYMMDDHHMMSS_name.sql`; additive where possible
(`create or replace`, `if not exists`); no secrets and no production data; no `begin`/`commit` inside the
file (the runner wraps each file in one transaction); a precondition check at the top for anything it
depends on; a matching file in `rollback/`; a test in `tests/db.test.js`.

## What `sdc_state_put_if` changes

Nothing that exists today. It adds one function with the same security model as `sdc_state_put`
(SECURITY DEFINER, `search_path` pinned, secret checked against `sdc_learn_secret`, `EXECUTE` for
`anon` and `authenticated`, revoked from `PUBLIC`). It writes the state only if the row still has the
`updated_at` the caller read, and returns the new `updated_at`, or `NULL` when someone else saved
first. Concurrent callers are serialised by the row lock; exactly one of them wins (tested with real
concurrent transactions). Existing tables, rows, functions, signatures, policies and grants are
untouched (tested against a database built from the original `schema.sql` + `gateway.sql` with demo
LMS data).

## Prerequisites (check before applying)

Run these **read-only** queries in the production SQL Editor:

```sql
select proname, pg_get_function_identity_arguments(oid) from pg_proc
 where proname in ('sdc_state_get','sdc_state_put','sdc_state_put_if','sdc_kv_get','sdc_kv_put');
select policyname from pg_policies where tablename = 'sdc_learn_state';          -- expect no rows
select has_table_privilege('anon', 'public.sdc_learn_state', 'select');          -- expect false
select pg_get_userbyid(relowner), relforcerowsecurity from pg_class
 where oid = 'public.sdc_learn_state'::regclass;                                 -- expect postgres, false
select current_user;                                                              -- expect postgres
```

1. `sdc_state_get` and `sdc_state_put` exist (gateway.sql was applied). If not, production is still in
   direct mode: stop, the migration refuses to run and generation must stay blocked (plan item B1/B2).
2. `GET https://<production>/api/sdc/status` returns `"gateway":true`.
3. The person applying it runs as the owner of `sdc_learn_state` (in the SQL Editor: `postgres`).
4. A database backup exists (Supabase → Database → Backups, or a manual `pg_dump` of the three tables).

The migration checks 1 and 3 itself and aborts with a clear message, changing nothing.

## Deployment order

1. **Review** the SQL file (Noman prepares; the SDC Supabase owner reviews and applies).
2. **Local**: `npm run test:db` passes (fresh database, production-shaped database with LMS data,
   concurrency, failures, permissions, rollback).
3. **Non-production Supabase project** (when available): run `schema.sql`, `gateway.sql` (with that
   project's secret hash) and the migration; point a local server at it (`SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SDC_STATE_SECRET`); `GET /api/sdc/status` must return `safeWrite:true`.
4. **Production**: paste `20261014000100_sdc_state_put_if.sql` into the SQL Editor and run it once.
   Safe before the code deploy: nothing calls the function yet.
5. **Verify** (read-only): the first query above lists `sdc_state_put_if`; after the code deploy
   `GET /api/sdc/status` returns `{"gateway":true,"safeWrite":true}`.
6. **Deploy the code.** Until then the old code ignores the function.

Order does not matter for safety: new code without the function keeps saving as today (and refuses AI
drafts); the function without new code is unused.

### D3 server permissions: what protects what, and the safe rollout

D3 (the per-record checks for the 14 protected collections and the role ceiling, FEATURES.md
sections 10 and 12) is code only: no database change, no new stored fields, nothing to migrate.
It is effective only when every write to the row goes through the new server code:

| Path to the row | D3 permissions | Conflict-safe (no lost update) |
|---|---|---|
| New server, migration applied | Enforced | Yes (`sdc_state_put_if`, 3 retries) |
| New server, migration **not** applied | Enforced (the guard runs before the save) | **No**: two saves at the same moment can still lose one another's records |
| Old server (the version in production today), during the deploy switch-over or after a rollback | **None** | No |
| Browser in direct mode (publishable key, no server) | **None**: bypasses everything | No |
| Another tool holding `SDC_STATE_SECRET` | None | Only if it uses `sdc_state_put_if` |

Old browser tabs (an app version from before D3) still go through the server, so they are checked
too: they cannot change records they may not change, and without `base` they cannot delete any of
the 14 collections except through a cascade. A deletion from such a tab reappears after reload.

Safe rollout (each step read-only or reversible):

1. **Prerequisites B1/B2** (read-only, above): `sdc_state_get` exists, `anon` has no table access,
   production answers `"gateway":true`. If production is in direct mode, D3 protects nothing: stop.
2. **Custom roles check** (read-only, tested on local PostgreSQL): list roles other than the
   Coordinator that can create or edit roles, accounts or settings, so their users can be told about
   the role ceiling before it applies:
   ```sql
   select r->>'id' as role, r->>'courseScope' as scope, r->'permissions' as permissions
     from sdc_learn_state, jsonb_array_elements(state->'roles') r
    where id = 'sdc-learn-main' and r->>'id' <> 'admin'
      and (r->'permissions'->'roles' ?| array['create','edit'] or r->'permissions'->'staff' ?| array['create','edit']
           or r->'permissions'->'learners' ?| array['create','edit'] or r->'permissions'->'settings' ? 'edit');
   ```
   Each role listed can from now on only grant what it has itself (FEATURES.md section 10).
   Also count records without a text `id` in the 14 collections (expect no rows). Such records are
   kept as stored but can no longer be changed from the browser:
   ```sql
   select e.key as collection, count(*) as without_id
     from sdc_learn_state, jsonb_each(state) e,
          jsonb_array_elements(case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end) r
    where id = 'sdc-learn-main'
      and e.key in ('courses','sessions','batches','enrollments','assignments','quizzes','quizAttempts',
                    'submissions','attendance','progress','results','feedback','certificates','fees')
      and jsonb_typeof(r->'id') is distinct from 'string'
    group by e.key;
   ```
3. **Apply `sdc_state_put_if`** (steps above). Do this before the code deploy, so D3 never runs
   without conflict-safe saving in production.
4. **Preview deploy on `Noman`** against a non-production project: `npm test`, `npm run test:db`,
   then sign in as a learner, an instructor, an accounts officer and the Coordinator and do one
   normal action each (submit, grade, record a payment, issue a certificate). No `rejected` in the
   `PUT /api/sdc/state` answers.
5. **Production deploy** outside teaching hours. Ask users to reload open tabs afterwards.
6. **Watch** for a week: repeated `rejected` answers for a legitimate action point to a screen whose
   rule is missing in `RULE` (`backend/state-api.js`); fix forward.
7. **Later, optional**: revoke `sdc_state_put` (below) once a rollback to the pre-D3 code is no
   longer planned. That closes the last unconditional path.

Rollback: redeploying the previous code is safe for the data (no schema change, `_sync` is never
stored) but **removes all D3 and role-ceiling protection** until the new code is back. Prefer a fix
forward.

### Unconditional writers (`sdc_state_put`)

`sdc_state_put` overwrites the row without a version check, so any caller of it can erase a save made
through `sdc_state_put_if` a moment earlier (for example a committed AI draft). After both steps above,
nothing in this repository calls it while `sdc_state_put_if` exists: the new server uses it only while
the function is missing. Remaining unconditional writers, and how each is closed:

| Writer | Closed by |
|---|---|
| The previous server version, during the deploy switch-over | Vercel routes new requests to the new deployment; only requests already running finish on the old one. Deploy outside teaching hours. |
| A browser in direct mode (publishable key, no server) | `gateway.sql` revokes table access from `anon` (prerequisite query 2 must return `false`). |
| The new server before the migration is applied | Expected: it saves as today and refuses AI drafts (`safeWrite:false`). |
| Any other tool holding `SDC_STATE_SECRET` | Do not use `sdc_state_put` outside the app. |
| The new server's own fallback (`save()` in `backend/state-api.js`), used only while `sdc_state_put_if` is missing, and the first-start seed in `load()` | Applying the migration. The fallback still runs the D3 checks, so it cannot be used to bypass permissions, only to lose a concurrent save. |

Optional, later, once the new code has run in production for a while and a rollback to the old code is
no longer planned: remove the unconditional path completely. This also stops the old code from saving,
so it must be undone before redeploying an older version.

```sql
revoke execute on function public.sdc_state_put(text, jsonb) from anon, authenticated;
notify pgrst, 'reload schema';
-- undo: grant execute on function public.sdc_state_put(text, jsonb) to anon, authenticated;
```

## Recovery

| Situation | Action |
|---|---|
| Migration aborted with a precondition message | Nothing changed. Fix the prerequisite, run again. |
| Migration applied, something looks wrong | Run `rollback/20261014000100_sdc_state_put_if.down.sql`. Only the function is removed; no data is touched. The app keeps working (`safeWrite:false`, AI drafts refused). |
| New code misbehaves | Redeploy the previous version. The function can stay; the old code never calls it. |
| `safeWrite:false` after both are deployed | PostgREST may not have reloaded: run `notify pgrst, 'reload schema';`. Check the function exists and `anon` has `EXECUTE`. |
| Repeated `busy` (503) answers | Many saves at the same moment; the server already retries 3 times. Check for a client stuck in a save loop. |

## Not verifiable without a real Supabase project

Tested locally on plain PostgreSQL 18; these depend on Supabase itself and need step 3 or 5 above:

- PostgREST: named-argument RPC calls, `timestamptz` serialisation round trip, the
  `404 / PGRST202` answer for a missing function, and the schema reload after `notify pgrst`.
- Supabase's default privileges on new functions (it may grant `EXECUTE` to `service_role` as well).
- Table owner and `postgres` role attributes in the production project (checked by the migration).
- The PostgreSQL version of the project (needs 11+ for `sha256()`; Supabase runs 15 or 17).
- Network timeouts between Vercel (`bom1`) and the Supabase region under load.
