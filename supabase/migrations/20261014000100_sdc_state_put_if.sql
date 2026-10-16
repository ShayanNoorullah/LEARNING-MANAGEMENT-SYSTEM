-- SDC Learn — compare-and-swap write for the shared state row (Stage 2 safe-write foundation).
--
-- ADDITIVE: creates one new function and changes nothing else. Existing tables, rows, functions,
-- signatures, policies and grants are left exactly as they are. Safe to apply before the code deploy:
-- nothing calls it until the new server code runs, and the server falls back to today's behaviour
-- for ordinary saves while it is missing (AI drafts are refused instead).
--
-- Requires (checked below, the whole file aborts otherwise): public.sdc_learn_state,
-- public.sdc_learn_secret and public.sdc_state_get(text) from supabase/schema.sql + supabase/gateway.sql
-- (or the baseline migration), and a role that owns sdc_learn_state, so the SECURITY DEFINER
-- function is not blocked by row level security. In the Supabase SQL Editor that role is `postgres`.
-- Run inside one transaction (the SQL Editor and `psql -1` both do). Rollback:
-- supabase/rollback/20261014000100_sdc_state_put_if.down.sql

do $$
declare
  owner_ok boolean;
begin
  if to_regclass('public.sdc_learn_state') is null or to_regclass('public.sdc_learn_secret') is null then
    raise exception 'sdc_state_put_if needs public.sdc_learn_state and public.sdc_learn_secret: apply supabase/schema.sql and supabase/gateway.sql (or the baseline migration) first';
  end if;
  if to_regprocedure('public.sdc_state_get(text)') is null then
    raise exception 'sdc_state_put_if needs public.sdc_state_get(text) from supabase/gateway.sql';
  end if;
  select c.relowner = r.oid or r.rolsuper or r.rolbypassrls into owner_ok
    from pg_class c, pg_roles r
   where c.oid = 'public.sdc_learn_state'::regclass and r.rolname = current_user;
  if not coalesce(owner_ok, false) then
    raise exception 'run this migration as the owner of public.sdc_learn_state (in Supabase: the postgres role), otherwise row level security blocks the function';
  end if;
  if (select relforcerowsecurity from pg_class where oid = 'public.sdc_learn_state'::regclass) then
    raise exception 'public.sdc_learn_state has FORCE ROW LEVEL SECURITY; the gateway functions cannot work with it';
  end if;
end $$;

-- Writes p_state only if the row still has updated_at = p_expected (the raw value sdc_state_get returned).
-- Returns the new updated_at, or NULL when someone else saved first (the caller reloads and retries).
-- p_expected NULL means "create the row only if it does not exist yet" (first start of a new project).
-- The new updated_at is always strictly later than the old one, so two writes never share a version.
-- Under READ COMMITTED a concurrent UPDATE waits for the row lock and re-checks the WHERE clause
-- against the committed row, so exactly one of two writers with the same p_expected succeeds.
create or replace function public.sdc_state_put_if(p_secret text, p_state jsonb, p_expected timestamptz)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t timestamptz;
begin
  if p_secret is null or not exists (select 1 from public.sdc_learn_secret where secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')) then
    raise exception 'denied' using errcode = '42501';
  end if;
  -- CASE keeps jsonb_array_length away from non-arrays and a missing key (NULL) counts as invalid.
  if (case when jsonb_typeof(p_state -> 'users') = 'array' then jsonb_array_length(p_state -> 'users') = 0 else true end) then
    raise exception 'state must contain users' using errcode = '22023';
  end if;
  if p_expected is null then
    insert into public.sdc_learn_state (id, state, updated_at) values ('sdc-learn-main', p_state, clock_timestamp())
    on conflict (id) do nothing
    returning updated_at into t;
    return t;
  end if;
  update public.sdc_learn_state
     set state = p_state,
         updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
   where id = 'sdc-learn-main' and updated_at = p_expected
  returning updated_at into t;
  return t;
end $$;

comment on function public.sdc_state_put_if(text, jsonb, timestamptz) is
  'SDC Learn: compare-and-swap save of sdc-learn-main. Returns the new updated_at, or NULL if the row changed since p_expected.';

-- Same access model as sdc_state_put: callable with the publishable key, guarded by the secret.
revoke all on function public.sdc_state_put_if(text, jsonb, timestamptz) from public;
grant execute on function public.sdc_state_put_if(text, jsonb, timestamptz) to anon, authenticated;

-- Supabase: make PostgREST see the new function now (a harmless no-op on plain PostgreSQL).
notify pgrst, 'reload schema';
