-- SDC Learn — lock the state row behind the server gateway (fixes anonymous read/write).
-- Run in the Supabase SQL Editor AFTER SDC_STATE_SECRET is set in Vercel and the app has redeployed.
-- Afterwards the publishable key can no longer read or write sdc_learn_state; only the server
-- (which knows the secret) can, through the two functions below. Only the secret's SHA-256 is stored.
-- To rotate: put a new secret in Vercel and replace the hash below with
--   encode(sha256(convert_to('<new secret>', 'UTF8')), 'hex')

create table if not exists public.sdc_learn_secret (id int primary key default 1 check (id = 1), secret_hash text not null);
alter table public.sdc_learn_secret enable row level security;
revoke all on public.sdc_learn_secret from anon, authenticated;
insert into public.sdc_learn_secret (id, secret_hash)
values (1, '7bfd724d218239f969405937db5081f2b2875aa524047c6e742fa05edb7e1424')
on conflict (id) do update set secret_hash = excluded.secret_hash;

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

revoke all on function public.sdc_state_get(text) from public;
revoke all on function public.sdc_state_put(text, jsonb) from public;
grant execute on function public.sdc_state_get(text) to anon, authenticated;
grant execute on function public.sdc_state_put(text, jsonb) to anon, authenticated;

-- Close direct browser access to the table.
drop policy if exists "sdc_learn read" on public.sdc_learn_state;
drop policy if exists "sdc_learn insert" on public.sdc_learn_state;
drop policy if exists "sdc_learn update" on public.sdc_learn_state;
revoke all on public.sdc_learn_state from anon, authenticated;
