# Setup — SDC Learn

## 1. Requirements

- Node.js 20–24 (`node -v`)
- npm
- Optional: a Supabase project (to share data across devices) and a hosting account (Render or Vercel)

## 2. Install

```bash
npm install
```

Copy the environment template and edit it:

```bash
cp .env.example .env
```

## 3. Environment variables

All are optional for local use. Set them in `.env` locally, or in your host's dashboard in production. Never commit `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the Express server listens on |
| `JWT_SECRET` | development value | Signs server tokens. **Set a long random value in production.** |
| `UPLOAD_MAX_MB` | `30` | Maximum upload size enforced by the server |
| `UPLOAD_ALLOWED_TYPES` | `xlsx,xls,xlsm,csv,docx,doc,pptx,ppt,pdf,pbix,twbx,twb,ipynb,sql,txt,md,zip,png,jpg,jpeg,webp,svg,mp4` | File extensions the server accepts |
| `DATABASE_URL` | — | Neon PostgreSQL connection string for the server's own state (see §6) |
| `PUBLIC_URL`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_ID` | — | Only used by the legacy passkey API endpoints (not shown in the current UI) |

The upload limits in **Settings → Learning** control what the browser offers; the server variables above are the final check. Keep them consistent.

## 4. Configure the platform (no code)

Sign in as the coordinator (`admin@sdclearn.demo` / `Demo@123`) and open **Settings**:

| Tab | Configure |
|---|---|
| Branding | Product and organisation names, tagline, square logo mark, full logo lockup, contact details, footer |
| Appearance | Primary, accent and highlight colours, corner radius, default light/dark theme |
| Terminology | What every term is called (Learner, Instructor, Course, Session, Batch, Fee…) |
| Learning | Default help/support URL, upload endpoint, size and file types, late policy, attendance threshold, result weights, grade bands, pass mark, certificate prefix and eligibility, program types, levels, delivery modes, fee types, demo-account shortcuts |
| Features | Turn attendance, results, certificates, fees, messages, announcements, calendar and feedback on or off |
| Data | Backup and restore (JSON), reset to demo data, storage and upload-server status |

Then, under **People → Roles & permissions**, review the roles (see [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md#roles--permissions)).

**Logos** live in `assets/brand/`: `sdc-logo.png` (square mark: sidebar, favicon, certificates) and `sdc-lockup.png` (SDC + Council seal + Government of Pakistan emblem: sign-in and verification pages). Replace the files or upload new ones in Settings → Branding.

## 5. Shared data with Supabase (recommended for real use)

Without Supabase, all data lives in each browser separately. With it, every device reads and writes the same data.

1. Create a project at supabase.com.
2. In the SQL Editor, run `supabase/schema.sql`. It creates the `ead_app_state` table (the name is kept for compatibility with existing projects).
3. Copy the **Project URL** and the **publishable (anon) key** from the project's API settings. Never use the `service_role` key in the browser.
4. Edit `js/cloud-config.js`:

   ```js
   window.SDC_CLOUD_CONFIG = {
     enabled: true,
     url: 'https://YOUR-PROJECT.supabase.co',
     anonKey: 'YOUR_PUBLISHABLE_KEY',
     table: 'ead_app_state',
     stateId: 'sdc-learn-main'
   };
   ```

5. Reload the app. **Settings → Data → Cloud sync** should show "Connected", and the table gets a row with id `sdc-learn-main`.

Set `enabled: false` to run fully offline. The included policies are for evaluation; read `supabase/PRODUCTION_SECURITY_NOTES.md` before going public.

## 6. Sign in with Google

Google sign-in runs through **Supabase Auth**, using the same project as §5. Google confirms who the person is; SDC Learn then finds the platform account with the same email, so roles, permissions and courses still come from SDC Learn.

1. **Google Cloud Console** → APIs & Services → Credentials → *Create OAuth client ID* (Web application).
   - Authorised redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
2. **Supabase** → Authentication → Providers → **Google**: enable it and paste the client ID and secret.
3. **Supabase** → Authentication → URL Configuration → **Redirect URLs**: add every address people sign in from, for example:
   - `https://ead-university-portal-ten.vercel.app/login.html`
   - `http://localhost:3000/login.html`
4. **SDC Learn** → Settings → **Sign-in**: keep *Show "Continue with Google"* on, and choose what happens to unknown emails:
   - *Do not create accounts* (default) — only people a coordinator has already added can sign in;
   - or *Create an account with role: …* — first-time Google users are registered automatically (coordinators are notified).

The Sign-in tab shows whether Google is enabled in Supabase and the exact redirect URL for the current domain. The button only appears when Google is enabled, so it is never shown broken. Accounts created through Google have no password; a coordinator can set one in People → All users if needed.

## 7. Optional: Neon for the server's own state

The Express server keeps a small state file (`backend/data/database.json`: server-side demo accounts and passkey data). On hosts with temporary disks you can persist it in Neon:

1. Create a Neon project and set `DATABASE_URL`.
2. Start the server; it creates the `ead_portal_state` table automatically.
3. Check `GET /api/neon/health` → `connected: true`.

This does **not** store course, learner or enrollment data — that is the browser/Supabase state from §5.

## 8. Deploy

The same Express app serves the pages and the upload API, so one service is enough.

### Render (recommended — persistent uploads with a disk)

1. Create a **Web Service** from your Git repository.
2. Build command `npm install` · Start command `npm start`.
3. Set `JWT_SECRET` (and any other variables from §3).
4. Add a **persistent disk** mounted at `backend/uploads` so uploaded files survive redeploys.
5. Deploy and open the service URL.

### Vercel

`vercel.json` serves the static pages from the CDN and routes `/api/*` and `/uploads/*` to `api/index.js` (the Express app).

```bash
npx vercel
```

```bash
npx vercel --prod
```

Set `JWT_SECRET` in the project's environment variables, and add the Vercel URL to Supabase Redirect URLs (§6) for Google sign-in. `.vercelignore` keeps `.env` files and local uploads out of deployments. Limitations: uploads go to `/tmp` and disappear when the function restarts, and request bodies are capped at 4.5 MB. Use Render, or connect object storage (S3, Supabase Storage, Vercel Blob) and point **Settings → Learning → Upload endpoint** at it, for real submissions.

### Static hosting only

The pages work from any static host (including opening `login.html` from a local web server). Without the Express server, uploads fall back to browser storage for files up to **Settings → Learning → Browser fallback limit** (default 1.5 MB).

## 9. Production checklist

- [ ] Turn off **Settings → Learning → Demo accounts**
- [ ] Deactivate or delete the demo users, and create real coordinator accounts
- [ ] Set a strong `JWT_SECRET`
- [ ] Configure Supabase (§5) and tighten its policies
- [ ] Use persistent upload storage (Render disk or object storage)
- [ ] Add the production URL to Supabase Redirect URLs and choose the Google sign-up policy (§6)
- [ ] Set the real help/support form URL and per-course Zoom links
- [ ] Download a backup from **Settings → Data** after initial setup
