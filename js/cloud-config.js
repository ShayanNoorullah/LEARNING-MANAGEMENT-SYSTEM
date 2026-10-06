/* SDC Learn — optional Supabase cloud sync.
   The platform always works from browser storage first. When configured, the full state is
   mirrored to one row of a Supabase table so every device sees the same data.
   1) Create a Supabase project and the table from supabase/schema.sql (see SETUP.md §5).
   2) Paste the Project URL and publishable (anon) key below. Never use a service_role key here.
   3) Set enabled:false to run fully offline. */
window.SDC_CLOUD_CONFIG = {
  enabled: true,
  url: 'https://idchielsujwfqhiwbsui.supabase.co',
  anonKey: 'sb_publishable_-vM6GOFTc5IwkY4Dhbuaqw_7v2z3bBk',
  table: 'sdc_learn_state',
  stateId: 'sdc-learn-main'
};
