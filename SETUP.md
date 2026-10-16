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
2. In the SQL Editor, run `supabase/schema.sql`. It creates the `sdc_learn_state` table with row-level security limited to the single app row, so it can safely live in a project shared with another app.
3. Copy the **Project URL** and the **publishable (anon) key** from the project's API settings. Never use the `service_role` key in the browser.
4. Edit `js/cloud-config.js`:

   ```js
   window.SDC_CLOUD_CONFIG = {
     enabled: true,
     url: 'https://YOUR-PROJECT.supabase.co',
     anonKey: 'YOUR_PUBLISHABLE_KEY',
     table: 'sdc_learn_state',
     stateId: 'sdc-learn-main'
   };
   ```

5. Reload the app. **Settings → Data → Cloud sync** should show "Connected", and the table gets a row with id `sdc-learn-main`.

The hosted deployment uses the Supabase project `idchielsujwfqhiwbsui` (shared with another app; SDC Learn only uses `sdc_learn_state`). Set `enabled: false` to run fully offline.

### 5a. Lock the data behind the server (required before real use)

`schema.sql` alone lets anyone holding the publishable key read and overwrite the whole state, including password hashes. The server gateway (`backend/state-api.js`) closes that:

1. Generate a long random secret (for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
2. Set it as the environment variable **`SDC_STATE_SECRET`** on the server (Vercel → Project → Settings → Environment Variables, Production) and redeploy. `GET /api/sdc/status` then returns `{"gateway":true}`.
3. Put the secret's SHA-256 in `supabase/gateway.sql` and run that file in the SQL Editor. It removes browser access to the table; only the server can reach it.
4. Apply `supabase/migrations/20261014000100_sdc_state_put_if.sql` (conflict-safe saving, needed for AI course drafts). Follow [supabase/MIGRATIONS.md](supabase/MIGRATIONS.md). `GET /api/sdc/status` then also returns `"safeWrite":true`.

The same file creates `sdc_learn_kv`, where the server keeps SDC Learn AI provider keys (AES-GCM encrypted) and the monthly AI usage counter, so every Vercel instance shares them.

With the gateway on, passwords are checked on the server, each browser receives only its own password hash, learners can edit only their own profile, and roles/settings/accounts change only for users holding those permissions. Signing out clears the browser's cached copy. Without `SDC_STATE_SECRET` on a deployed server the app keeps using the direct mode above.

**Local development is cloud-off by default.** Outside production (`VERCEL` unset and `NODE_ENV` not `production`) the server answers `/js/cloud-config.js` with `{enabled:false}`, so `npm run dev` never reads or writes the live Supabase project; the file itself is unchanged. To test cloud sync locally, create a separate non-production Supabase project (run `supabase/schema.sql` and `supabase/gateway.sql` there) and set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SDC_STATE_SECRET` in `.env`. The server then serves that project's config to the browser. Starting the gateway from a developer machine against the live project is refused at startup; `SDC_ALLOW_LIVE=1` overrides this and is not recommended. The startup log prints the effective cloud target.

### 5b. SDC Learn AI (Phase 2)

AI calls go through `backend/ai-api.js`. API keys are **never** stored in `localStorage` / demos backups.

1. Copy `.env.example` values for OpenAI / Gemini / Azure OpenAI / Groq, **or** paste keys in **Settings → Integrations** (encrypted on the server under `backend/data/ai-secrets.json`, or in the gateway's key-value store when the gateway is on). For Groq choose a model with **Load models from Groq** (no model is built in); `GROQ_MODEL` sets it for an env key.
2. Optional: set `SDC_AI_SECRETS_KEY` (defaults to `SDC_STATE_SECRET` or `JWT_SECRET`). Changing it later makes the stored keys unreadable, so the keys must be entered again.
3. With the state gateway (`SDC_STATE_SECRET`) on, AI uses the cloud session token. Local `/api/ai/auth` minting stays **off** unless you set `SDC_AI_LOCAL_OPEN=1` (dev only). Without a gateway, local minting stays on for demos.
4. Turn features on/off under **Settings → Features** (`ai`, `quizzes`, `aiTutor`, …) and map providers under **Integrations → Capability map**.
5. **AI course generator.** Off by default: turn on **Settings → Features → AI course generator**, and set the provider, model and temperature (default 0.4) of the `courseGenerate` capability. It needs the state gateway (`SDC_STATE_SECRET`) and the `sdc_state_put_if` database function (supabase/MIGRATIONS.md); without them it refuses to save. Each outline is one request of up to 8,000 output tokens within a 50-second budget. For trying it without a provider on a developer machine only, set `SDC_AI_MOCK=1`: it answers with a clearly labelled sample outline (not AI) and is ignored on Vercel and when `NODE_ENV=production`.

#### AI key encryption (administrator procedure after this update)

Until this update the AES key for the stored provider keys was `sha256(SECRETS_KEY)`. With the default `SECRETS_KEY` (`SDC_STATE_SECRET`) that is exactly the hash kept in `sdc_learn_secret` and written into `supabase/gateway.sql` in this repository, so anyone holding that hash and a copy of the encrypted `ai-secrets` row (a database export or backup, SQL Editor access) could decrypt the provider keys. New saves use a key derived only for this purpose (blob `v: 2`); old (`v: 1`) blobs are still read, and the server log says so once.

The steps below are for the Supabase/Vercel administrator. Nobody else should touch live keys or secrets.

1. After the deploy, open **Settings → Integrations** and save (or **Test**) any one provider profile. The whole store is re-encrypted as `v: 2`. Check in the SQL Editor (read-only): `select value->>'v' from sdc_learn_kv where key = 'ai-secrets';` returns `2`.
2. Decide whether the provider API keys must be rotated. If the repository, a database export or a backup that contains the old `v: 1` blob may have been seen by anyone who should not hold the keys, create new keys at the provider, enter them in Settings → Integrations, then revoke the old ones at the provider.
3. Recommended: set a separate random `SDC_AI_SECRETS_KEY` in Vercel. The stored keys can then no longer be decrypted, so enter them again right after the redeploy. Order: set the variable, redeploy, re-enter the keys.
4. Separately, the committed `sdc_learn_secret` hash in `supabase/gateway.sql` lets anyone with the repository try to guess `SDC_STATE_SECRET` offline. If the secret is not a long random value, rotate it (new value in Vercel, matching hash in `sdc_learn_secret`, then redeploy), and keep only a placeholder in the repository copy.

### 5c. Local PostgreSQL (development and database tests)

Database changes are developed and tested on a private local PostgreSQL cluster; production stays on Supabase. Versioned SQL lives in `supabase/migrations/`; the procedure for applying it to production is in [supabase/MIGRATIONS.md](supabase/MIGRATIONS.md).

Needs an installed PostgreSQL (11 or later; tested with 18). Nothing is installed or changed globally: the cluster lives in `.localdb/` (git-ignored), listens on `127.0.0.1:54329` only, holds dummy data only and never touches the PostgreSQL service on port 5432. If PostgreSQL is not in `C:\Program Files\PostgreSQL\<version>\bin`, set `PG_BIN` to its `bin` folder.

```bash
npm run db:local -- init     # create and start the private cluster (once; later: start / stop / status)
npm run db:local -- setup    # (re)create database sdc_dev: role names, all migrations, demo data
npm run test:db              # SQL and safe-write tests on throwaway sdc_test_* databases
npm run db:local -- dev      # run the app against sdc_dev (gateway mode, local only)
```

`dev` starts a small local stand-in for the Supabase REST endpoint (`scripts/localdb/rest.js`, development only) on `127.0.0.1:54321` and the server with `SUPABASE_URL` pointing at it and a generated secret from `.localdb/dev-secret`. Sign in with the demo accounts. Google sign-in is not available locally. The tools refuse any host other than 127.0.0.1, any database not named `sdc_dev*` or `sdc_test*`, and production environments.

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
- [ ] Configure **SDC Learn AI** (§5b): provider env vars or Integrations UI; set `SDC_AI_LOCAL_OPEN=0` when the gateway is on
- [ ] Enable only the AI feature flags you need under **Settings → Features**
- [ ] Download a backup from **Settings → Data** after initial setup
