# SDC Learn — Skill Development Council Karachi

SDC Learn is the online learning platform for **Skill Development Council (SDC) Karachi**. It combines SDI-style course delivery (courses → sessions, recordings, resources, Zoom, assignment uploads) with the operational tools SDC needs to run training: enrollments, attendance, grading, results, certificates, fees, announcements and messaging.

- **Stack:** HTML5, CSS3, Vanilla JavaScript (no framework) + optional Express API
- **Data:** browser storage (`sdcLearnDB_v1`) with optional Supabase cloud sync
- **Roles:** Learner · Instructor · Coordinator (admin)

## Run it

```bash
npm install
```

```bash
npm start
```

Open http://localhost:3000. The Express server serves the app **and** stores uploaded files (assignment submissions, session resources, logos) in `backend/uploads/`.

You can also open `login.html` from any static server; everything works except shared file storage — small files (≤ 1.5 MB by default) then fall back to browser storage.

### Demo accounts (evaluation only)

| Role | Email | Password |
|---|---|---|
| Coordinator | `admin@sdclearn.demo` | `Demo@123` |
| Instructor | `instructor@sdclearn.demo` | `Demo@123` |
| Learner | `learner@sdclearn.demo` | `Demo@123` |

Turn off the demo shortcuts on the sign-in page in **Settings → Learning → Demo accounts**, and change or deactivate the demo users before going live.

## What's inside

**Learners** land on *My Courses* (search, filter, progress, "live today" and "due soon" cards). Each course has a session list grouped by module with status badges (Upcoming / Today / Available / Completed / Locked), a pinned **Course Outline** and **Submit Assignment** entry, Help and Zoom tools in the header, session pages with embedded video (YouTube, Vimeo, Google Drive or MP4), downloadable resources, prev/next navigation and "mark as complete". Submissions use drag-and-drop with type/size validation, email confirmation and replace-until-graded. Learners also get a calendar, attendance, results, certificates, fees, announcements and messages.

**Instructors** manage their courses in a course builder (sessions, recordings, resources, per-session Zoom overrides, assignments), grade submissions, mark attendance per session, compute and publish results, and message their learners.

**Coordinators** additionally manage courses, programs (diploma / certificate / workshop / short course), divisions, batches, enrollments (full or restricted per-session access), users, fees, certificates (with public verification at `verify.html`), reports with CSV exports, and platform settings.

## Roles & permissions

Coordinators manage roles under **People → Roles & permissions** (full CRUD, duplicate, delete-protection while a role is in use). Each role has:

- **Experience** — which portal layout it uses: staff console, instructor console or learner portal.
- **Course access** — all courses, courses they teach, courses they are enrolled in, or a hand-picked list. This scopes every course-related page (sessions, learners, submissions, attendance, results, announcements).
- **Page & action permissions** — a matrix of 20 modules × view / create / edit / delete / publish. Menu items, pages and buttons appear only when allowed.

Built-in roles: Coordinator (full access, locked so nobody can lock themselves out), Instructor and Learner. An example custom role, **Accounts Officer** (`accounts@sdclearn.demo` / `Demo@123`), manages fees only. Assign any role to any user in **People → All users**.

## Everything is configurable (Settings)

| Tab | What you can change |
|---|---|
| Branding | Product name, organisation, tagline, logo (upload or URL), contact details, footer |
| Appearance | Primary / accent / highlight colours, corner radius, default light or dark theme |
| Terminology | Rename any term (Learner, Instructor, Course, Session, Batch, Fee…) across the UI |
| Learning | Help URL, upload limits and file types, late policy, attendance threshold, result weights, grade bands, pass mark, certificate rules, program types, levels, delivery modes, fee types |
| Features | Toggle attendance, results, certificates, fees, messages, announcements, calendar, feedback |
| Data | Backup / restore JSON, reset demo data, storage and upload-server status |

Per course: Zoom link / meeting ID / passcode, help URL, accent colour, icon, modules, outcomes, schedule, venue and fee.

**Logo:** the official marks live in `assets/brand/` — `sdc-logo.png` (square SDC mark: sidebar, favicon, certificates) and `sdc-lockup.png` (SDC + Council seal + Government of Pakistan emblem: sign-in and verification pages). Both can be replaced in Settings → Branding.

## Project structure

```
login.html, app.html, verify.html   Pages (app.html is the single-page portal)
css/app.css                          Design system (light + dark, responsive)
js/core.js                           Store, settings, auth, helpers, UI kit
js/seed.js                           Demo catalogue (dates are relative to today)
js/shell.js                          Router, navigation, top bar
js/pages-learn.js                    Learner course delivery
js/pages-manage.js                   Courses, sessions, enrollments, catalogue
js/pages-users.js                    User accounts, roles & permissions
js/pages-ops.js                      Dashboards, grading, attendance, results, certificates, fees, comms, reports, settings
js/cloud-config.js, cloud-sync.js    Optional Supabase sync
backend/server.js                    Express API: /api/lms/uploads, health, passkey endpoints
assets/resources/                    Sample session resources
docs/                                BRD and implementation notes
```

## Tests

```bash
npm test
```

Runs `tests/core.test.js` (permissions, course scoping, grading, restricted access, password hashing). For the full UI workflow test (29 workflows across all roles), sign in on `app.html` and run in the browser console:

```js
await (await fetch('tests/e2e.browser.js')).text().then(eval)
```

It resets to demo data before and after — never run it against live data.

## Uploads

`POST /api/lms/uploads` (multipart field `file`) validates the extension and size on the server (`UPLOAD_ALLOWED_TYPES`, `UPLOAD_MAX_MB`, default 30 MB), stores the file under a random name and serves it back as a download with `nosniff`. On Vercel, files go to `/tmp` and are not permanent — use persistent storage (e.g. S3/Supabase Storage) for production.

## Security notes

This is a browser-first platform: accounts, passwords and records live in the browser (and in Supabase when cloud sync is on). Passwords are stored only as salted, iterated SHA-256 hashes, never in plain text. For a public production deployment, move authentication and data to the server (Supabase Auth + row-level security, or the Express API) as described in `supabase/PRODUCTION_SECURITY_NOTES.md`. The cloud table keeps its existing name (`ead_app_state`) so current Supabase projects keep working; SDC data is stored under the row id `sdc-learn-main`.
