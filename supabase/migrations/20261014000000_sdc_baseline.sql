-- SDC Learn — baseline schema (what supabase/schema.sql + supabase/gateway.sql already created).
--
-- FRESH DATABASES ONLY (local PostgreSQL, a new test project). PRODUCTION ALREADY HAS THIS SCHEMA:
-- do not run this file there. With the Supabase CLI, record it as applied instead:
--   supabase migration repair --status applied 20261014000000
-- See supabase/MIGRATIONS.md.
--
-- Idempotent. Contains no secret: the secret hash row (sdc_learn_secret) is environment specific and
-- is inserted separately (production: supabase/gateway.sql header; local: scripts/localdb/cli.js).
-- Run inside one transaction (the SQL Editor and `psql -1` both do; the local runner wraps it).

create table if not exists public.sdc_learn_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.sdc_learn_state enable row level security;

create table if not exists public.sdc_learn_secret (id int primary key default 1 check (id = 1), secret_hash text not null);
alter table public.sdc_learn_secret enable row level security;

create table if not exists public.sdc_learn_kv (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.sdc_learn_kv enable row level security;

-- The four gateway functions, byte-for-byte the bodies in supabase/gateway.sql.
create or replace function public.sdc_state_get(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from sdc_learn_secret where secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')) then
    raise exception 'denied' using errcode = '42501';
  end if;
  return (select jsonb_build_object('state', state, 'updated_at', updated_at) from sdc_learn_state where id = 'sdc-learn-main');
end $$;

create or replace function public.sdc_state_put(p_secret text, p_state jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if not exists (select 1 from sdc_learn_secret where secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')) then
    raise exception 'denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_state -> 'users') <> 'array' or jsonb_array_length(p_state -> 'users') = 0 then
    raise exception 'state must contain users' using errcode = '22023';
  end if;
  insert into sdc_learn_state (id, state, updated_at) values ('sdc-learn-main', p_state, t)
  on conflict (id) do update set state = excluded.state, updated_at = excluded.updated_at;
  return t;
end $$;

create or replace function public.sdc_kv_get(p_secret text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from sdc_learn_secret where secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')) then
    raise exception 'denied' using errcode = '42501';
  end if;
  return (select value from sdc_learn_kv where key = p_key);
end $$;

create or replace function public.sdc_kv_put(p_secret text, p_key text, p_value jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from sdc_learn_secret where secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')) then
    raise exception 'denied' using errcode = '42501';
  end if;
  insert into sdc_learn_kv (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  return true;
end $$;

revoke all on function public.sdc_state_get(text) from public;
revoke all on function public.sdc_state_put(text, jsonb) from public;
revoke all on function public.sdc_kv_get(text, text) from public;
revoke all on function public.sdc_kv_put(text, text, jsonb) from public;
grant execute on function public.sdc_state_get(text) to anon, authenticated;
grant execute on function public.sdc_state_put(text, jsonb) to anon, authenticated;
grant execute on function public.sdc_kv_get(text, text) to anon, authenticated;
grant execute on function public.sdc_kv_put(text, text, jsonb) to anon, authenticated;

-- Gateway mode: no direct browser access to any of the three tables.
drop policy if exists "sdc_learn read" on public.sdc_learn_state;
drop policy if exists "sdc_learn insert" on public.sdc_learn_state;
drop policy if exists "sdc_learn update" on public.sdc_learn_state;
revoke all on public.sdc_learn_state from anon, authenticated;
revoke all on public.sdc_learn_secret from anon, authenticated;
revoke all on public.sdc_learn_kv from anon, authenticated;
