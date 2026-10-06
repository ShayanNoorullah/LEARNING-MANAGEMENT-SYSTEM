# AI Implementation Prompt — SDC Learn (SDI Features → Existing Portal)

You are a senior full-stack engineer working in this existing repository: an HTML/CSS/Vanilla JS multi-page portal with optional Express backend (`backend/server.js`), LocalStorage DB (`js/database.js`, `js/seed-data.js`), and role portals under `admin/`, `teacher/`, `student/`.

### Mission

Transform this project into **SDC Learn** — an online learning platform for **Skill Development Council Karachi (SDC)**, by:

1. **Rebranding** fully from “EAD University” to SDC Karachi per https://sdckarachi.org.pk/
2. **Implementing SDI Central–style course delivery** (reference: https://atihelps.awesometechinc.com/sdi/lms/index.php) on top of the existing system — not as a rewrite from scratch
3. Keeping useful institutional features (users, enrollments, attendance, grades, fees, announcements, messaging) under SDC training vocabulary

Read `docs/BRD_SDC_Online_Learning_Platform.md` and implement **Phase 0 + Phase 1** (and Phase 2 file uploads if Express already supports them).

---

### Hard constraints

- **Do not rewrite the app in React/Vue/Next.** Stay on HTML + CSS + Vanilla JS + existing Express.
- **Do not copy SDI’s insecure auth** (password derived from email). Keep role-based login; improve naming only.
- **Do not delete** admin/instructor operational modules wholesale — remap and rebrand them.
- Prefer **extending** `js/database.js`, `js/seed-data.js`, `js/app.js`, `js/layout.js`, `css/variables.css` over parallel duplicate systems.
- Bump LocalStorage DB key if schema changes (e.g. `eadUniversityDB_v5` → `sdcLearnDB_v1`) and migrate or reseed cleanly.
- Match existing code style; no drive-by refactors unrelated to this mission.
- Mobile-responsive; light + dark theme must work on new pages.

---

### Product identity

| Item | Value |
|---|---|
| Product name | **SDC Learn** |
| Organization | Skill Development Council Karachi |
| Short name | SDC Karachi |
| Public site | https://sdckarachi.org.pk/ |
| Contact | (021) 99334387, 99334388 · sdckar@sdckarachi.org.pk |
| Roles | Admin / Coordinator · Instructor (was Teacher) · Learner (was Student) |
| Tagline | Demand-driven skills training · Online Zoom + recorded access · Onsite at SDC Karachi |

**Brand visuals (SDC-inspired, not a clone of SDI violet-cyan glass):**

- Primary: deep navy / institutional blue (`#0B1F3A`–`#123A6B` range)
- Accent: teal/green for growth/skills (`#0F766E` / `#14967F`)
- Highlight/CTA secondary: amber/gold for certificates & promos (`#C9A227`)
- Surfaces: clean light mode; professional dark mode (optional, keep toggle)
- Typography: distinctive, professional (not Inter-only if you introduce fonts — e.g. a strong display + readable body); keep performance reasonable
- Logo path: `assets/brand/sdc-logo.svg` (create a simple text/mark placeholder if no asset exists)

Replace every user-visible “EAD University”, “EAD”, and demo `.edu` branding with SDC equivalents. Update `README.md`, `package.json` name/description, page `<title>`s, login hero, sidebars, footers.

---

### Feature reference — what “work like SDI” means

Implement these learner UX patterns from SDI Central:

1. **Login** → branded SDC Learn sign-in (keep demo credential helpers for Admin/Instructor/Learner).
2. **My Courses** dashboard for learners: course cards with title, tagline, session count, search.
3. **Course home**: ordered list of sessions + **Course Outline** + **Submit Assignment** entries; status pills (Upcoming / Today / Available / Outline / Submit).
4. **Session detail**: breadcrumb; date; **video embed region**; **Resources** downloads; assignment CTA; prev/next navigation.
5. **Header tools** on course/session pages: Help (external form URL), Zoom (register URL + meeting ID + password + copy), theme, user, logout.
6. **Course outline** page: module roadmap (Excel / Power BI / Python / etc. style content OK for seed).
7. **Assignment submit**: session select, email confirm, drag-and-drop file upload, replace previous submission.
8. Empty states for no courses / no sessions / no resources.

Also support **per-course Zoom + Help config** (like SDI’s `courseSupport` object), stored in data model / admin settings — not hardcoded only in JS if avoidable.

---

### Data model (add / adapt)

Extend the DB with (names can align to existing collections if you map carefully):

```js
// courses — published training programs
{ id, slug, title, tagline, description, level, sessionCount, startDate,
  icon, accent, programType, delivery, status,
  helpUrl, zoom: { registerUrl, meetingId, password } }

// sessions — units inside a course
{ id, courseId, folder, title, date, duration, summary, moduleName, order,
  videoUrl, resources: [{ id, title, type, url }], assignmentDueAt }

// enrollments
{ id, learnerId, courseId, batchId?, enrolledAt, accessMode: 'full'|'restricted', allowedSessionIds? }

// submissions (enhance existing)
{ id, sessionId, courseId, learnerId, email, fileName, fileUrl, uploadedAt, status, grade?, feedback? }
```

Seed **at least two SDC-relevant courses**, for example:

- Microsoft Excel with AI-Driven Analytics & Automation (multi-session)
- Tableau for Data Visualization & Analytics

Include outline + ≥3 sessions each with placeholder video URL and sample resource links.

Wire demo learner enrollment so login as learner immediately shows courses on **My Courses**.

---

### Information architecture changes

**Learner portal** (`student/` may be renamed to `learner/` **or** keep folder names and only change labels — prefer rename if low-risk; if rename is too breaking, keep paths but update all visible labels and redirects):

- Primary home after login: **My Courses** (new page; can replace or sit above current dashboard)
- New routes/pages:
  - `learner/courses.html` or enhance `student/courses.html` → My Courses grid
  - `learner/course.html?slug=` or `/courses/{slug}/` style multi-page under `courses/<slug>/`
  - Session page template
  - Outline page
  - Submit assignment page
- Keep: profile, attendance, results, fees, messages, notifications, announcements (rebranded)

**Instructor** (`teacher/`): show assigned courses; link to materials, attendance, grading for those courses; surface assignment submissions from new submit flow.

**Admin**: course CRUD (or seed + settings editor), enrollment management, Zoom/Help fields per course; keep students→learners, teachers→instructors labels.

Suggested pragmatic structure (pick one and stay consistent):

**Option A (recommended for this codebase):**  
`student/my-courses.html`, `student/course.html`, `student/session.html`, `student/outline.html`, `student/submit-assignment.html`  
with query params `?courseId=` / `?sessionId=`.

**Option B:** static folders `courses/<slug>/index.html` like SDI — only if you can generate/maintain them cleanly from seed data via JS templates on a single HTML shell.

Prefer **Option A** unless you have a strong reason.

---

### UI implementation notes

- Reuse sidebar/topbar shell from `js/layout.js` / existing dashboard CSS where possible.
- On course/session pages, a **lighter header** (SDI-like) with Help/Zoom is acceptable instead of the full admin sidebar — learner focus.
- Status badge colors: Available=green, Upcoming=blue/gray, Today=accent, Submit=amber, Outline=purple/navy.
- Video: support YouTube/Vimeo iframe URL or HTML5 `<video src>`; if no URL, show polished empty player state.
- Resources: list with type icon + Download button.
- Assignment upload: if `backend/server.js` upload API exists, use it; otherwise store metadata + object URL with clear “demo without server” note, and implement server path when `npm start` is running.

---

### Auth & demo accounts

Update demo accounts branding, e.g.:

- `admin@sdc.learn` / `admin123`
- `instructor@sdc.learn` / `instructor123`
- `learner@sdc.learn` / `learner123`

Update login page marketing copy for SDC training (online Zoom + recorded access, certificates, industry programs). Remove leftover “Schedule Sender” / WhatsApp-only promo if still present unless it maps to a real SDC feature.

---

### Acceptance checklist (you must verify)

- [ ] No primary UI string says “EAD University”
- [ ] Learner login → My Courses with enrolled course card(s)
- [ ] Course opens → session list with Outline + Submit Assignment
- [ ] Session opens → video region + resource download(s) + assignment CTA
- [ ] Help + Zoom header tools open/copy correctly from course config
- [ ] Assignment submit accepts a file and records a submission visible to instructor/admin
- [ ] Admin/Instructor portals still load with SDC labels
- [ ] Dark/light theme works on new pages
- [ ] README updated for SDC Learn + how to run
- [ ] Seed/reset still works from settings

---

### Implementation order (follow this)

1. Brand tokens + global string replace + login/README/`package.json`
2. Schema + seed (courses, sessions, enrollments) + DB key bump
3. Learner My Courses page
4. Course home (session list)
5. Session detail (video + resources)
6. Outline + Submit Assignment pages
7. Header Help/Zoom tools
8. Wire submissions into instructor/admin views
9. Nav labels role rename across portals
10. Polish empty states, mobile, QA checklist

---

### Deliverables in your final response

1. Summary of files created/changed
2. How to run (`npm start` / open login)
3. Demo credentials
4. Any deferred Phase 2/3 items explicitly listed

Start implementing now. Work in the existing repo; do not create a separate app.

## END PROMPT
