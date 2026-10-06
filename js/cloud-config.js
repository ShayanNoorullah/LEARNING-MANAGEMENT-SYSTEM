/* SDC Learn — optional Supabase cloud sync.
   The platform always works from browser storage first. When configured, the full state is
   mirrored to one row of a Supabase table so every device sees the same data.
   1) Create a Supabase project and the table from supabase/schema.sql (see SETUP.md §5).
   2) Paste the Project URL and publishable (anon) key below. Never use a service_role key here.
   3) Set enabled:false to run fully offline. */
window.SDC_CLOUD_CONFIG = {
  enabled: true,
  url: 'https://kjbramwiuiwytriedzlk.supabase.co',
  anonKey: 'sb_publishable_GxOrHTg0VS-oKImvdz633w_OZos27Zv',
  table: 'ead_app_state',
  stateId: 'sdc-learn-main'
};
