# Run — SDC Learn

## Start

```bash
npm start
```

Open http://localhost:3000. For automatic restarts while editing the server:

```bash
npm run dev
```

Another port:

```bash
PORT=4000 npm start
```

The server serves the pages, stores uploads in `backend/uploads/`, and answers `GET /api/health`.

## Demo accounts

All use the password `Demo@123`. They are also one-click buttons on the sign-in page (hide them in Settings → Learning).

| Role | Email | Lands on |
|---|---|---|
| Coordinator | `admin@sdclearn.demo` | Dashboard, full menu |
| Instructor | `instructor@sdclearn.demo` | Dashboard for their courses (Excel AI, Power BI) |
| Learner | `learner@sdclearn.demo` | My Courses (4 enrollments) |
| Accounts Officer | `accounts@sdclearn.demo` | Dashboard, fees-focused menu |

Other demo learners and instructors use `@sdclearn.demo` emails too (e.g. `mariam@`, `nida@`). Demo dates are relative to the day the data is created, so there is always a session "today".

**Reset everything:** Settings → Data → Reset to demo data.

## Walkthroughs

### Learner
1. **My Courses** → open *Microsoft Excel with AI-Driven Analytics*.
2. The session marked **Today** is live: use **Zoom** in the header (copy meeting ID/passcode) or **Help**.
3. Open a past session: watch the recording, download resources, **Mark as complete** (progress updates).
4. **Submit Assignment** → choose the assignment, confirm your email, drag a file in, upload. Upload again to replace it.
5. Open *Tableau*: session 4 shows **Locked** (restricted enrollment).
6. Check **Calendar**, **Results**, **Certificates** (view/print SDC-2026-0001), **Fees**, **Messages**.

### Instructor
1. **My Courses** → **Manage** Excel AI → **Sessions**: add a session with a video link and resources, reorder with the arrows.
2. **Assignments** tab: add an assignment (learners are notified).
3. **Submissions** → **Grade** Mariam's work with marks and feedback.
4. **Attendance** → pick course and session → mark and save.
5. **Results** → enter assessment %, tick publish, save.

### Coordinator
1. **Courses** → **New course**, fill in details including Zoom and help URL → **Publish**.
2. **Enrollments** → enroll a learner with full or restricted (per-session) access; optionally create the fee record.
3. **Roles & permissions** → **New role**, pick experience, course access and tick permissions. Assign it in **All users**, then sign in as that user to see the effect.
4. **Certificates** → **Issue** to an eligible learner; verify at `/verify.html`.
5. **Settings** → change the product name or rename "Learner" to "Trainee" and watch the whole UI update.

### SDC Learn AI (Phase 2)
1. As coordinator: **Settings → Integrations** → enable a provider (or set env keys) → **Test connection**. Map capabilities under the capability map; turn on AI feature flags in **Features**.
2. As instructor: open a course → **Quizzes** → **Generate with AI** → review/check → publish. Grade a submission with **AI draft** (accept/edit before save).
3. As learner: open a session → **Ask Tutor** / **Summarize**; take a graded quiz; run a private practice quiz.
4. As staff: **At-risk** list → log outreach.

Manual checklist: [docs/testing/SDC-Learn-Manual-Test-Suite-Phase2.xlsx](docs/testing/SDC-Learn-Manual-Test-Suite-Phase2.xlsx).

## Tests

Logic tests (permissions, course scoping, grading, AI helpers, gateway):

```bash
npm test
```

Syntax check of every script:

```bash
npm run check
```

UI workflow test — 29 workflows across every module and role, driving real clicks and forms. Start the server, sign in on `app.html`, open the browser console and run:

```js
await (await fetch('tests/e2e.browser.js')).text().then(eval)
```

It prints a table and returns `{ passed, failed }`. It resets to demo data before and after, and with cloud sync on it also resets the shared Supabase row — **never run it against live data**.

The full SDC test suite (94 cases, results per test-case ID) runs against a local server with puppeteer-core installed:

```bash
node tests/suite.run.js http://localhost:3000
```

It blocks all Supabase traffic, so it never touches live data.

Phase 2 (SDC Learn AI and graded quizzes) starts its own in-process server in gateway mode with a mock Supabase and a mock AI provider, so no AI key is needed:

```bash
node tests/phase2.run.js
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE` / port in use | Another process uses 3000. Stop it or run with `PORT=4000 npm start`. |
| "The upload server is unavailable" | The page was opened without `npm start` (e.g. file preview). Start the server, or keep files under the browser fallback limit. |
| Upload rejected (`.xyz files are not accepted`) | Add the extension in Settings → Learning **and** in `UPLOAD_ALLOWED_TYPES`. |
| Changes don't appear on another device | Configure Supabase ([SETUP.md](SETUP.md#5-shared-data-with-supabase-recommended-for-real-use)); otherwise each browser has its own data. |
| A page says "Page not available" | The signed-in role lacks permission for that page — adjust it in Roles & permissions. |
| Locked out of an account | A coordinator can set a new password in People → All users. The built-in Coordinator role always keeps full access. |
| Old data or layout after an update | Hard-refresh (Ctrl+Shift+R). To start clean, Settings → Data → Reset to demo data. |
