# Deploy EAD University Portal on Vercel

The static portal (HTML/CSS/JS) is served by Vercel's CDN. Every `/api/*` and `/uploads/*`
request is routed to one serverless function (`api/index.js`), which loads the Express app
from `backend/server.js`. Configuration lives in `vercel.json`.

## Steps
1. `npx vercel login`
2. From the project folder: `npx vercel` (first run links/creates the project), then `npx vercel --prod`.
3. In the Vercel project settings → Environment Variables, set:
   - `JWT_SECRET` = a long random string (required; otherwise a public development secret is used)
   - `DATABASE_URL` = Neon PostgreSQL connection string (strongly recommended, see below)
   - `PUBLIC_URL`, `WEBAUTHN_ORIGIN` = the production URL, e.g. `https://ead-university.vercel.app`
   - `WEBAUTHN_RP_ID` = the hostname only, e.g. `ead-university.vercel.app`
4. Redeploy after changing environment variables.

## What persists where
- **Portal data** (students, classes, assignments, …) lives in the browser and syncs to Supabase
  (`js/supabase-config.js`). This works on Vercel without any server configuration.
- **Backend data** (passkeys) is written to `/tmp` on Vercel, which is wiped on every cold start.
  Set `DATABASE_URL` so the backend keeps its state in Neon; without it, registered passkeys disappear.
- **File uploads** through `/api/uploads` are also written to `/tmp` and are not shared between
  function instances, so they are not durable on Vercel. Use object storage (e.g. Vercel Blob) for
  real document uploads. Vercel also limits request bodies to 4.5 MB.
