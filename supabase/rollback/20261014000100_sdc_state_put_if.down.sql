-- Rollback for 20261014000100_sdc_state_put_if.sql. Removes only the new function; no data is touched.
-- Afterwards /api/sdc/status reports safeWrite:false, ordinary saves use the old sdc_state_put path
-- again, and AI course drafts are refused with "safe_save_unavailable" until the function is back.
drop function if exists public.sdc_state_put_if(text, jsonb, timestamptz);
notify pgrst, 'reload schema';
