-- SDC Learn - Supabase schema for browser cloud sync (one shared state row).
-- Run in the Supabase SQL Editor. Safe to add to a project that hosts other apps:
-- it creates one table and policies that only touch that table's single row.

create table if not exists public.sdc_learn_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.sdc_learn_state enable row level security;

-- EVALUATION POLICIES: the browser (publishable key) may read and write the single
-- 'sdc-learn-main' row; deletes are blocked and the state must contain a users array.
-- For a public production launch see supabase/PRODUCTION_SECURITY_NOTES.md.
drop policy if exists "sdc_learn read" on public.sdc_learn_state;
drop policy if exists "sdc_learn insert" on public.sdc_learn_state;
drop policy if exists "sdc_learn update" on public.sdc_learn_state;
create policy "sdc_learn read" on public.sdc_learn_state
  for select to anon, authenticated using (id = 'sdc-learn-main');
create policy "sdc_learn insert" on public.sdc_learn_state
  for insert to anon, authenticated
  with check (id = 'sdc-learn-main' and jsonb_typeof(state -> 'users') = 'array');
create policy "sdc_learn update" on public.sdc_learn_state
  for update to anon, authenticated
  using (id = 'sdc-learn-main')
  with check (id = 'sdc-learn-main' and jsonb_typeof(state -> 'users') = 'array');

revoke delete, truncate on public.sdc_learn_state from anon, authenticated;
grant select, insert, update on public.sdc_learn_state to anon, authenticated;
