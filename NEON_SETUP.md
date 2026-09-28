# EAD University — Neon Connection POC

1. Create a Neon PostgreSQL project.
2. Copy the pooled/direct connection string into the deployment environment as `DATABASE_URL`.
3. Do not commit the connection string.
4. Deploy with `npm install` and `npm start`.
5. Open `/api/neon/health`; a successful response reports `connected: true`.
6. Sign in as the EAD Admin demo account and POST `/api/neon/bootstrap` using an API client if you want to seed the current portal dataset into Neon.
7. The backend creates the `ead_portal_state` table automatically.

The application deliberately keeps the existing local JSON fallback. This means the UI and academic workflows do not depend on a live Neon connection during development or temporary database outages.
