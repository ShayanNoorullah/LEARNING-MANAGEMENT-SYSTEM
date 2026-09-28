# Deploy EAD University Portal (Production-Ready)

## Recommended: Render (one live URL)
This project serves the frontend and API from the same Express application. That is important for passkeys because WebAuthn credentials are tied to the website domain.

1. Create a new Web Service on Render.
2. Upload/push this project to a Git repository and connect it, or use Render's supported deployment workflow.
3. Build command: `npm install`
4. Start command: `npm start`
5. After the first deploy, copy the exact public HTTPS URL, for example `https://ead-university-portal.onrender.com`.
6. In the service environment variables set:
   - `PUBLIC_URL` = exact HTTPS URL
   - `WEBAUTHN_RP_ID` = hostname only, e.g. `ead-university-portal.onrender.com`
   - `WEBAUTHN_ORIGIN` = exact HTTPS URL
   - `JWT_SECRET` = a long random secret
   - `DATABASE_URL` = your Neon PostgreSQL connection string (keep this secret)
7. Redeploy after changing environment variables.

## Important passkey rule
Register and use the passkey on the same HTTPS domain. If the public URL changes, register the passkey again on the new domain.

## Persistence note
The current project stores application data in `backend/data/database.json`. For a true multi-user production deployment, replace this with a persistent database/volume before relying on user data long term.


## Neon PostgreSQL POC
The portal keeps its local JSON fallback so existing workflows remain available if Neon is unavailable. When `DATABASE_URL` is configured, the Express backend creates `ead_portal_state`, pulls the saved state at startup, and syncs changes in the background.

After deployment, check `/api/neon/health`. An authenticated Admin can also POST to `/api/neon/bootstrap` to push the current demo dataset into Neon.

### Demo accounts
- Admin: `admin@ead.edu` / `admin123`
- Teacher: `teacher@ead.edu` / `teacher123`
- Student: `student@ead.edu` / `student123`

Change these demo passwords before any public production deployment. Never place `DATABASE_URL`, `JWT_SECRET`, or other secrets in frontend JavaScript or Git.
