# Implementation — SDC Learn

How the platform is built, where things live, and how to extend it. For installation see [SETUP.md](../SETUP.md); for running and testing see [RUN.md](../RUN.md).

## Architecture

```
Browser                                                     Server (optional)
┌──────────────────────────────────────────────┐            ┌───────────────────────────┐
│ login.html / app.html / verify.html          │            │ backend/server.js (Express)│
│   shell.js  router · menu · top bar           │  upload    │  POST /api/lms/uploads     │
│   pages-*.js  one function per page           │ ─────────► │  GET  /uploads/<file>      │
│   core.js  store · settings · auth · UI kit   │            │  GET  /api/health          │
│        │                                      │            │  serves the static pages   │
│        ▼                                      │            └───────────────────────────┘
│ localStorage "sdcLearnDB_v1"  ◄──►  cloud-sync.js  ◄──►  Supabase row "sdc-learn-main"  │
└──────────────────────────────────────────────┘
```

- **No framework, no build step.** Plain HTML, CSS and JavaScript loaded with `<script>` tags in a fixed order.
- **Browser-first data.** The whole dataset is one JSON object in `localStorage`. Pages read and write it synchronously, so the UI is instant and works offline.
- **Optional cloud mirror.** `cloud-sync.js` pulls the Supabase copy on load and pushes changes (debounced, one at a time so an old snapshot never overwrites a newer one).
- **Server gateway.** When the server has `SDC_STATE_SECRET`, every read and write goes through `/api/sdc` (`backend/state-api.js`) with a signed session token. Passwords are checked on the server, each browser receives only its own password hash, learners can change only their own profile, and accounts, roles and settings need the matching permission. The table itself is closed to the browser (`supabase/gateway.sql`). Without the secret the app falls back to direct sync.
- **Single-page portal.** `app.html` is one page; `#/…` hash routes select which page function renders into `<main>`.
- **Server only where the browser can't do it:** storing uploaded files.

## File map

| Path | Responsibility |
|---|---|
| `login.html`, `js/login.js` | Sign-in page with live showcase, demo shortcuts, password reset info |
| `app.html` | Portal shell; loads every script below |
| `verify.html` | Public certificate verification |
| `index.html` | Redirects to the portal or sign-in |
| `css/app.css` | Design system: tokens, light/dark themes, components, responsive rules, auth page |
| `js/core.js` | Store, settings and terminology, roles & permissions, password hashing, domain rules (`Domain`), notifications, icons, UI kit (toast, modal, confirm, form builder, data table, dropzone, upload, CSV, print) |
| `js/seed.js` | Demo catalogue: roles, users, divisions, programs, courses, sessions, assignments, enrollments and more; dates relative to today |
| `js/shell.js` | `App`: route registry, permission-filtered menu, top bar, notifications, breadcrumbs, page context |
| `js/pages-learn.js` | My Courses, course home, session page, outline, submit assignment, learner assignments, calendar |
| `js/pages-manage.js` | Generic CRUD page (`crudPage`), course list and builder (sessions, resources, assignments, learners), enrollments, programs, divisions, batches |
| `js/pages-users.js` | Learner/instructor/all-user accounts, roles & permissions |
| `js/pages-ops.js` | Dashboards, submissions & grading, attendance, results, certificates, fees, announcements, messages, notifications, reports, settings, profile |
| `js/cloud-config.js`, `js/cloud-sync.js` | Supabase connection and background sync |
| `backend/server.js` | Express app: static files, validated uploads, health, legacy JSON API and passkey endpoints |
| `api/index.js`, `vercel.json` | Vercel serverless entry and routing |
| `assets/brand/` | Logo mark and lockup |
| `assets/resources/` | Sample session resources used by the demo data |
| `backend/state-api.js` | Server gateway: sign-in, state sync, certificate check |
| `tests/` | `core.test.js`, `gateway.test.js` (Node), `e2e.browser.js` (29 workflows) and `suite.browser.js` + `suite.run.js` (the 94-case SDC test suite) |

## Data model

One state object, key `sdcLearnDB_v1`. `normalizeState()` fills missing collections from the seed, merges settings over `DEFAULT_SETTINGS`, and converts any plaintext seed password into a salted hash. Bump the key if the shape changes incompatibly.

| Collection | Key fields |
|---|---|
| `roles` | `id, name, base (admin\|teacher\|student), courseScope (all\|assigned\|enrolled\|selected), courseIds[], permissions{module:[actions]}, system` |
| `users` | `id, role (role id), name, email, salt, passwordHash, status, phone, city, regNo, designation, specialization, bio, lastLoginAt` |
| `divisions` | `id, name, code, head, description, status` |
| `programs` | `id, name, code, type, divisionId, duration, description, status` |
| `courses` | `id, slug, code, title, tagline, description, level, programId, divisionId, programType, delivery, status (draft\|published\|archived), instructorIds[], startDate, endDate, duration, schedule, venue, fee, accent, icon, outcomes[], modules[{name,summary}], prerequisites, helpUrl, zoom{registerUrl,meetingId,password}` |
| `batches` | `id, courseId, name, instructorId, startDate, endDate, delivery, venue, capacity, status` |
| `sessions` | `id, courseId, order, moduleName, title, date, time, duration, summary, videoUrl, resources[{id,title,type,url,size}], delivery, statusOverride, zoom{…}, published` |
| `assignments` | `id, courseId, sessionId, title, description, dueAt, maxMarks, lateAllowed, status` |
| `enrollments` | `id, learnerId, courseId, batchId, enrolledAt, accessMode (full\|restricted), allowedSessionIds[], status` |
| `submissions` | `id, assignmentId, sessionId, courseId, learnerId, email, fileName, fileUrl, size, stored (server\|inline), uploadedAt, status (Submitted\|Late\|Graded), grade, feedback, history[]` |
| `progress` | `id, learnerId, courseId, completedSessionIds[], lastSessionId` |
| `attendance` | `id, sessionId, courseId, batchId, learnerId, status (Present\|Late\|Absent\|Excused), notes, markedBy` |
| `results` | `id, learnerId, courseId, assessment, assignmentAvg, attendancePct, finalPct, grade, remarks, published` |
| `fees` | `id, learnerId, courseId, type, amount, dueDate, status, paidOn, method, reference, remarks` |
| `certificates` | `id, code, learnerId, courseId, issuedAt, grade, status (Valid\|Revoked)` |
| `announcements` | `id, title, message, audience (everyone\|learners\|instructors\|course), courseId, priority, pinned, date, expiry, authorId` |
| `messages` | `id, from, to, subject, body, date, read` |
| `notifications` | `id, userId, title, message, type, link, date, read` |
| `feedback` | `id, learnerId, courseId, rating, comment, publish, date` |
| `settings` | `brand, theme, terms, lms, features, general` — see `DEFAULT_SETTINGS` in `core.js` |

Store API (all in `core.js`): `db()`, `saveDB(state)`, `getData(key)`, `addRecord(key, rec)`, `updateRecord(key, id, patch)`, `deleteRecord(key, id)`, `findRecord(key, id)`, `resetDemoData()`.

## Roles & permissions

A role has three independent parts:

1. **Experience (`base`)** decides the portal layout: `admin` staff console, `teacher` instructor console, `student` learner portal. Code asks `kind(user)` for this, never the raw role id.
2. **Course access (`courseScope`)** decides which courses the role sees through `Domain.visibleCourses(user)`:
   - `all` — every course
   - `assigned` — courses listing the user in `instructorIds`
   - `enrolled` — published courses with an active enrollment
   - `selected` — only `courseIds`

   Learners, submissions, attendance, results, announcements, messaging recipients and badges are all derived from the visible courses.
3. **Permissions** — `can(module, action)` checks `role.permissions[module]`. Modules and their actions are declared once in `PERMISSIONS` (`core.js`):

   `dashboard, learn, courses (view/create/edit/delete/publish), programs, divisions, batches, enrollments, learners, staff, roles, submissions (view/edit = grade), attendance (view/edit = mark), results (view/edit), certificates (view/create = issue/edit = revoke), fees, announcements, messages (view/create = send), calendar, feedback (view/delete), reports, settings (view/edit)`

Enforcement points:
- **Routes** declare `perm` (and optionally `base`, `feature`); `App.allowed()` blocks the page otherwise.
- **Menu** items use the same fields, so hidden pages never appear.
- **Buttons and handlers** call `can()` (e.g. create/edit/delete in `crudPage` via `perm`, Publish, Grade, Save attendance, Issue certificate).
- `Domain.canManageCourse(user, course)` = `can('courses','edit')` **and** the course is visible.

Safety rules: the built-in `admin` role always has full access and its matrix is locked; system roles keep their experience; a role in use cannot be deleted; users cannot change their own role.

> All checks run in the browser. They shape what each person can do in the UI but are not a server-side security boundary — see `supabase/PRODUCTION_SECURITY_NOTES.md`.

## Routing and pages

`App.route(pattern, { perm, base, feature, render(ctx) })` registers a page. `ctx` gives `user`, `params`, `query`, `root`, `setCrumbs()`, `setTools()` (header buttons such as Zoom/Help) and `refresh()`.

| Route | Page |
|---|---|
| `/dashboard` | Staff dashboard |
| `/courses`, `/assignments` | Learner: My Courses, my assignments |
| `/course/:id` · `/session/:sid` · `/outline` · `/submit` | Course home, session, outline, submission |
| `/manage/courses`, `/manage/course/:id?tab=` | Course list and builder (overview, sessions, assignments, learners) |
| `/programs` `/divisions` `/batches` `/enrollments` | Catalogue and enrollment |
| `/learners` `/instructors` `/users` `/roles` | People and access |
| `/submissions` `/attendance` `/results` `/certificates` `/fees` `/calendar` | Delivery and operations |
| `/announcements` `/messages` `/notifications` `/reports` `/settings?tab=` `/profile` | Communication and system |

## Key flows

- **Session status:** `statusOverride`, else date vs today → Today / Upcoming / Available; learners also see Completed (progress) and Locked (restricted enrollment).
- **Video:** `videoEmbed()` turns YouTube, Vimeo and Google Drive links into embeds and plays `.mp4/.webm` directly; anything else becomes an "Open recording" link.
- **Submission:** email must match the account → `uploadFile()` validates type/size → `POST /api/lms/uploads` → record saved (previous file kept in `history`) → instructors notified. Graded work cannot be replaced; closed deadlines respect `lateAllowed` and the global late policy.
- **Uploads:** the server stores files under random names and serves them as downloads with `nosniff`. If the server is unreachable, files up to the fallback limit are stored inline as data URLs.
- **Results:** final % = weighted average of assignment average, assessment and attendance using the weights in Settings; grade from the configurable grade bands.
- **Certificates:** eligible when enrollment is Completed, progress ≥ the eligibility %, or a published passing result. Codes are `PREFIX-YEAR-0001` and can be checked on `verify.html`.
- **Theme:** `applyTheme()` writes brand colours to CSS variables (`--brand`, `--accent`, `--highlight`, `--radius`); the per-user light/dark choice is stored as `sdcTheme`.
- **Google sign-in:** `login.js` uses a separate Supabase Auth client (PKCE) only to obtain the Google-verified email, matches it to a platform user (or registers one with `settings.auth.googleSignUpRole`), signs out of Supabase and starts the normal platform session. The button appears only when Supabase reports Google enabled and `settings.auth.googleEnabled` is on.
- **Passwords:** salted, iterated SHA-256 (`hashPassword`), synchronous so it works offline and on `file://`.

## Extending

**Add a page:** register it in the relevant `pages-*.js`, add a menu item in `App.nav()` (`shell.js`) with the same `perm`, and use `pageHead()`, `dataTable()` or `crudPage()` for consistent UI.

**Add a CRUD screen:** `crudPage(ctx, { collection, perm, title, singular, columns, fields: rec => [...], validate, transform, afterSave, beforeDelete })` gives search, filters, sorting, pagination, CSV export and add/edit/delete modals.

**Add a permission:** append `['module', 'Label', ['view', …]]` to `PERMISSIONS`. It appears in the role matrix automatically; gate the route with `perm: 'module'` and buttons with `can('module', 'action')`. Grant it to the default roles in `seed.js` if needed.

**Add a setting:** add a default under `DEFAULT_SETTINGS` (merged into existing data automatically), a field in the Settings tab in `pages-ops.js`, and read it with `settings()`, `lms()`, `brand()` or `feature()`.

**Add a term:** add it to `DEFAULT_SETTINGS.terms` and use `t('key')` in the UI; it becomes editable under Settings → Terminology.

Run `npm run check`, `npm test` and the browser workflow test after changes.

## Requirement coverage

| BRD area | Where |
|---|---|
| FR-B Rebrand, logo, contact, vocabulary | Settings → Branding/Terminology, `assets/brand/`, login and footer |
| FR-L Learner experience (courses, sessions, video, resources, Zoom, Help, submit, empty states, feedback) | `pages-learn.js` |
| FR-I Instructor tools (sessions, resources, attendance, grading, announcements) | course builder, `pages-ops.js` |
| FR-A Admin CRUD, enrollments, Zoom/Help per course, fees, reports, settings, seed catalogue | `pages-manage.js`, `pages-users.js`, `pages-ops.js`, `seed.js` |
| FR-DATA courses, sessions, enrollments, submissions, progress | data model above |
| Phase 2: session access control, progress, feedback, certificates & verification, calendar, instructor publishing UI | implemented |
| NFR: vanilla stack, responsive, light/dark, versioned storage key, accessibility basics, no plaintext passwords, server-validated uploads | throughout |
