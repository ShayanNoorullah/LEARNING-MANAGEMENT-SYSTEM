# Supabase PostgreSQL Setup — EAD University Portal

## Why Supabase was selected
Supabase was selected instead of Neon for this project because the existing application is a browser-based HTML/CSS/Vanilla JavaScript portal. Supabase provides PostgreSQL together with a browser-friendly JavaScript client, Data API, and Row Level Security. Neon is an excellent serverless PostgreSQL platform, but a direct browser integration generally requires an additional backend/API layer to keep database credentials protected.

## Step 1 — Create a Supabase project
Create a project in Supabase and wait for the PostgreSQL database to become available.

## Step 2 — Create the database structure
Open the Supabase SQL Editor, open `supabase/schema.sql` from this project, paste it, and run it.

## Step 3 — Copy browser-safe credentials
From your Supabase project settings/API area, copy the Project URL and the publishable key (or anon key for compatible projects). Never copy a service_role or secret key into this frontend.

## Step 4 — Configure the project
Open `js/supabase-config.js` and replace:
- `YOUR_SUPABASE_PROJECT_URL`
- `YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`

## Step 5 — Run the portal
Use VS Code Live Server or another static HTTP server. The first configured page load creates/synchronizes the `ead-main` JSONB application state in PostgreSQL.

## Step 6 — Verify
Make a change such as adding a student. Refresh the browser and verify the change remains. Open the Supabase Table Editor and confirm the `ead_app_state` row has an updated timestamp.

## Integration design
Existing UI → existing JavaScript CRUD → LocalStorage cache (immediate UI response) → Supabase bridge → PostgreSQL JSONB state.

If Supabase is not configured or temporarily unavailable, the portal continues to operate in LocalStorage fallback mode.
