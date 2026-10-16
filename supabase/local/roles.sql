-- LOCAL / TEST ONLY. Never run on Supabase (these roles already exist there).
-- Plain PostgreSQL has no Supabase API roles, so the migrations' grants would fail. This creates
-- the same role names, without login, so grants and "anon cannot read the table" can be tested.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
