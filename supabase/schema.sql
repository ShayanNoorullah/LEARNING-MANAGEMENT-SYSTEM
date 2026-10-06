-- SDC Learn - Supabase PostgreSQL schema (cloud sync state table)
-- Run this file in Supabase SQL Editor.

create table if not exists public.ead_app_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.ead_app_state enable row level security;

-- DEMO/PROTOTYPE POLICIES: allow the configured browser project to read/write the
-- shared JSON state. For production, remove these and use Supabase Auth + strict RLS.
drop policy if exists "ead demo read" on public.ead_app_state;
drop policy if exists "ead demo insert" on public.ead_app_state;
drop policy if exists "ead demo update" on public.ead_app_state;
create policy "ead demo read" on public.ead_app_state for select to anon, authenticated using (true);
create policy "ead demo insert" on public.ead_app_state for insert to anon, authenticated with check (true);
create policy "ead demo update" on public.ead_app_state for update to anon, authenticated using (true) with check (true);

-- Optional: limit prototype state to the single shared application row.
