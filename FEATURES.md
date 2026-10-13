# SDC Learn — Features and Functionality

A detailed reference of what the platform does, how each part works, how the parts connect (section 20) and what every file is for (section 22). For installation see [SETUP.md](SETUP.md), for running and demo walkthroughs see [RUN.md](RUN.md), and for field-level data detail see [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Contents

1. [What the platform is](#1-what-the-platform-is)
2. [Technology and architecture](#2-technology-and-architecture)
3. [User roles](#3-user-roles)
4. [Sign-in and accounts](#4-sign-in-and-accounts)
5. [Learner features](#5-learner-features)
6. [Instructor features](#6-instructor-features)
7. [Coordinator and staff features](#7-coordinator-and-staff-features)
8. [Quizzes](#8-quizzes)
9. [SDC Learn AI](#9-sdc-learn-ai)
10. [Roles and permissions](#10-roles-and-permissions)
11. [Settings](#11-settings)
12. [Data storage and cloud sync](#12-data-storage-and-cloud-sync)
13. [File uploads](#13-file-uploads)
14. [Server API](#14-server-api)
15. [Security](#15-security)
16. [Pages and routes](#16-pages-and-routes)
17. [Data model](#17-data-model)
18. [Testing](#18-testing)
19. [Deployment](#19-deployment)
20. [How everything connects (end-to-end flows)](#20-how-everything-connects-end-to-end-flows)
21. [Known limitations](#21-known-limitations)
22. [File structure](#22-file-structure)

---

## 1. What the platform is

SDC Learn is the online learning platform of Skill Development Council Karachi. It delivers diplomas, certificates, workshops and short courses through live Zoom classes, recorded sessions, downloadable resources, assignments, quizzes and verifiable certificates. Phase 2 added **SDC Learn AI**: a course tutor, a resource summarizer, practice quizzes, AI quiz generation, AI draft grading and at-risk learner flags.

The platform serves three kinds of people:

| Audience | What they do |
|---|---|
| Learners | Attend classes, watch recordings, submit assignments, take quizzes, track progress, earn certificates |
| Instructors | Build course sessions, set assignments and quizzes, grade, take attendance, publish results |
| Coordinators and staff | Manage the catalogue, people, enrollments, fees, certificates, reports and every setting |

## 2. Technology and architecture

| Layer | Technology |
|---|---|
| Frontend | Plain HTML, CSS and JavaScript. No framework and no build step. |
| Routing | A single page ([app.html](app.html)) with `#/…` hash routes |
| Data | One JSON state object in the browser's `localStorage` (key `sdcLearnDB_v1`) |
| Cloud copy | Optional Supabase row that mirrors the state so all devices share the same data |
| Server | Node.js 20–24 with Express ([backend/server.js](backend/server.js)) |
| AI providers | OpenAI, Google Gemini, Azure OpenAI, called only from the server |
| Hosting | Vercel (serverless) or Render (long-running service) |

How the pieces fit together:

- The browser renders everything from `localStorage`, so pages open instantly and keep working offline.
- [js/cloud-sync.js](js/cloud-sync.js) pulls the shared copy on load and pushes changes in the background. Pushes are debounced and run one at a time so an older snapshot cannot overwrite a newer one.
- The server is used for what the browser cannot do safely: storing uploaded files, checking passwords against the shared state, and holding AI provider keys.

Main code files (the full file-by-file map is in [section 22](#22-file-structure)):

| File | Responsibility |
|---|---|
| [js/core.js](js/core.js) | Store, settings, terminology, permissions, password hashing, domain rules, UI kit |
| [js/shell.js](js/shell.js) | Router, permission-aware menu, top bar, notifications |
| [js/pages-learn.js](js/pages-learn.js) | Learner pages: courses, sessions, outline, submission, calendar |
| [js/pages-manage.js](js/pages-manage.js) | Course builder, batch workspace, enrollments, programs, divisions, batches |
| [js/pages-users.js](js/pages-users.js) | Learner, instructor and user accounts; roles and permissions |
| [js/pages-ops.js](js/pages-ops.js) | Dashboards, grading, attendance, results, certificates, fees, messaging, reports, settings |
| [js/pages-ai.js](js/pages-ai.js) | Tutor, summarizer, practice quizzes, graded quizzes, quiz editor |
| [js/ai-client.js](js/ai-client.js) | Browser client for the AI proxy |
| [js/seed.js](js/seed.js) | Demo data with dates relative to today |
| [js/migrations.js](js/migrations.js) | One-time state upgrades shared by browser and server |
| [backend/state-api.js](backend/state-api.js) | Server gateway for sign-in and shared state |
| [backend/ai-api.js](backend/ai-api.js) | AI proxy with encrypted keys, limits and PII scrubbing |

## 3. User roles

Four roles ship with the demo data. Coordinators can create any number of additional roles.

| Role | Experience | Course access | Summary |
|---|---|---|---|
| Coordinator | Staff console | All courses | Full access. Locked so nobody can lock themselves out. |
| Instructor | Instructor console | Assigned courses (courses where they teach a batch) | Edits own courses, grades, marks attendance, enters results |
| Learner | Learner portal | Enrolled courses | Learns, submits work, views own progress |
| Accounts Officer (example custom role) | Staff console | All courses | Fees, read-only learners, reports |

## 4. Sign-in and accounts

- **Email and password** sign-in with a "Keep me signed in on this device" option.
- **Sign in with Google** through Supabase Auth. Google confirms the email; the platform then matches it to an existing account, so roles and courses still come from SDC Learn.
  - Unknown Google emails are either rejected (default) or registered automatically with a role the coordinator chooses. Coordinators are notified of each new sign-up.
  - The Google button only appears when Google is enabled both in Supabase and in Settings.
- **Demo account shortcuts** on the sign-in page fill in the demo credentials. They can be hidden in Settings.
- **Forgot password** shows guidance; a coordinator sets a new password under People → All users.
- **Profile page** where each user edits their own details and changes their password.
- **Account status**: only `Active` accounts can sign in.
- The sign-in page shows a live showcase with real counts of courses, learners and sessions, and the session that is live today.

## 5. Learner features

### My Courses
- A card for each enrolled course with progress percentage.
- "Live today" and "Due soon" cards highlight what needs attention.

### Course home
- Sessions grouped by module with a status badge on each: **Upcoming**, **Today**, **Available**, **Completed** or **Locked**.
- **Zoom panel** with join link, meeting ID and passcode, each with a copy button.
- **Help panel** linking to the course's support URL.
- Progress bar and shortcuts to the outline, assignments and quizzes.
- A feedback prompt appears once progress reaches the configured percentage (default 40%), asking for a rating and comment.

### Session page
- Embedded recording. YouTube, Vimeo and Google Drive links become embedded players; `.mp4` and `.webm` files play directly; anything else becomes an "Open recording" link.
- Downloadable resources.
- Previous and next session navigation.
- **Mark as complete**, which updates course progress.
- **Ask Tutor**, **Summarize** and **Test my understanding** buttons when the AI features are on.

### Course outline
- Learning outcomes, module roadmap and prerequisites.

### Assignments
- A list of all assignments across enrolled courses with their state (pending, submitted, late, graded, missing).
- **Submission page**: choose the assignment, confirm the account email, drag and drop a file, upload.
- A file can be replaced until the work is graded. The previous version is kept in the submission history.
- Deadlines respect both the per-assignment "late allowed" flag and the global late-submission policy.
- A confirmation receipt is shown after upload, and the instructor of the assignment's batch is notified.

### Restricted access
- An enrollment can give full access or access to selected sessions only. Sessions outside the selection show as **Locked**.

### Other learner pages
- **Calendar** of upcoming sessions and due dates.
- **Attendance** record per course.
- **Results** once published by the instructor, showing the assignment, quiz, assessment and attendance parts. Courses without a published result show the learner's in-progress standing.
- **Certificates** to view and print.
- **Fees** showing dues and payments.
- **Messages**, **Announcements** and **Notifications**.

## 6. Instructor features

### Course builder
A course is a blueprint made of modules and sessions. A course has no instructor field of its own: **instructors belong to batches**. The instructors of a course are the instructors of its batches.

- **Overview tab**: title, tagline, description, level, program, delivery mode, schedule, venue, fee, outcomes, modules, prerequisites, Zoom details and help URL. An **Instructors** card lists each batch's instructor, and a launch checklist shows what is still missing.
- **Sessions tab**: add, edit, delete and reorder sessions. Each session has a module name, date, time, duration, summary, recording link, resources and optional per-session Zoom details.
- **Batches tab**: the batches running this course.
- **Learners tab**: who is enrolled.
- **Publish** makes the course visible to enrolled learners.
- When a user who only sees their own courses (an instructor) creates a course, a first batch is created automatically with them as its instructor, so the course stays visible to them.

### Batch workspace
Assignments and quizzes belong to a batch, not to the course. Work set for one batch never reaches another. Each batch has one instructor, who can manage that batch.

- **Assignments tab**: create assignments with description, due date, maximum marks, linked session and late policy. Learners in the batch are notified.
- **Quizzes tab**: create, edit, publish, unpublish and delete quizzes; review attempts.
- **Learners tab**: the batch roster.
- **Copy from another batch**: reuse assignments and quizzes from another batch of the same course.

### Grading
- **Submissions** page listing work awaiting review, with a badge count in the menu.
- Grade modal with file download, marks, quick-feedback chips ("Excellent work", "Good effort", "Needs improvement", "Please resubmit") and free-text feedback.
- Optional **AI draft** that suggests a grade and feedback for the instructor to review.
- The learner is notified when work is graded.

### Attendance
- Pick a course and session, then mark each learner **Present**, **Late**, **Absent** or **Excused**, with notes.
- Bulk marking for the whole session.

### Results
- Enter an assessment percentage per learner.
- The final percentage is a weighted average of four parts. Default weights:

  | Part | Default weight |
  |---|---|
  | Assignment average | 35% |
  | Assessment | 25% |
  | Quiz average | 20% |
  | Attendance | 20% |

- The grade comes from configurable grade bands (default `A+ 90, A 80, B 70, C 60, D 50`) and the pass mark (default 50%).
- Results are visible to learners only after they are published.

## 7. Coordinator and staff features

### Dashboard
- Stat cards: active learners, published courses, submissions to grade, fees collected and outstanding.
- This week's sessions, work awaiting grading, enrollment by course with average progress, and announcements.
- **At-risk advisories** panel (see section 9).

### Catalogue
- **Divisions**, **Programs**, **Courses** and **Batches**, each with create, edit and delete.
- Every list has search, filters, sorting, pagination and CSV export.

### People
- **Learners**, **Instructors** and **All users**: create accounts, edit details, set passwords, activate or deactivate.
- **Enrollments**: enroll a learner into a course and batch with full or per-session access, and optionally create the fee record in the same step.
- **Roles & permissions**: see section 10.

### Certificates
- A learner is eligible when the enrollment is completed, progress reaches the completion threshold (default 80%), or a passing result has been published.
- Issue and revoke certificates. Codes follow `PREFIX-YEAR-0001` (default prefix `SDC`).
- **Public verification page** ([verify.html](verify.html)): anyone can enter a code and see the learner name, course, grade, issue date and status. Nothing else is exposed.

### Fees
- Fee records per learner and course with type, amount, due date, status, payment date, method and reference.
- Fee types are configurable (default: Registration, Course, Examination, Certificate, Miscellaneous). Currency defaults to PKR.

### Communication
- **Announcements** to everyone, learners, instructors or one course, with priority, pinning and expiry.
- **Messages** between users with an unread indicator.
- **Notifications** generated by system events (new assignment, graded work, new submission, Google sign-up, tutor escalation), with a bell badge.

### Reports
- Totals for learners, enrollments and certificates, and the average feedback rating.
- **Course performance table**: learners, average progress, attendance, submission rate, certificates and revenue per course.
- **CSV export** of learners, enrollments, submissions, attendance, results, fees, certificates and feedback.

### Feedback
- A page listing learner ratings and comments, with delete.

## 8. Quizzes

### Question types
| Type | Scoring |
|---|---|
| Multiple choice, one answer | Automatic |
| Multiple choice, several answers | Automatic |
| True / False | Automatic |
| Short answer | AI suggestion when AI is on, otherwise pending instructor review |

### Quiz settings
- Title, description, attempt limit (0 means unlimited, default 2), pass percentage (default 50) and shuffle questions per attempt.
- Each question has its own points. Short-answer questions carry a model answer and keywords.
- A quiz starts as a draft and must be published before learners can attempt it.

### Learner side
- Learners see only the quizzes of their own batch.
- Objective questions are scored instantly on submit.
- The quiz list shows the learner's best score.
- Once the attempt limit is reached, the quiz is closed for that learner.

### Instructor review
- The attempts view shows every learner's short answers with the AI score and rationale.
- The instructor can set the points for each short answer. The instructor's score is final and the attempt total is recalculated.
- Attempts with unreviewed short answers are marked as pending.

Quiz averages feed into results through the quiz weight.

## 9. SDC Learn AI

All AI calls go through the server proxy. Provider keys never reach the browser. Every AI feature has its own on/off switch under Settings → Features, plus a master switch.

| Feature | Who uses it | What it does |
|---|---|---|
| **AI Tutor** | Learners | A chat drawer on a course or session. Answers only from the course outline and session materials, and lists the sources it used. If the topic is not covered, it says so and refers the learner to the instructor. It gives guidance on graded assignments instead of solving them. Each answer can be marked helpful or unhelpful, or **escalated** as a notification to the instructor of the learner's batch. Enter sends a question; Shift+Enter starts a new line. |
| **Resource summarizer** | Learners and instructors | Produces a structured English summary of a resource: learning objectives, key concepts, practical steps and glossary. An instructor can pin it as the official summary for the session. |
| **Private practice quiz** | Learners | Generates 3, 5 or 10 questions at easy, medium or hard difficulty from a session. Scores go to a private study log and never enter the gradebook. |
| **AI quiz generation** | Instructors | Generates up to 20 draft questions from one session or the whole course outline. The instructor picks which to keep; they become a new draft quiz. Nothing is published automatically. |
| **Short-answer checking** | Automatic | Suggests points and a rationale for short-answer quiz questions. The instructor can override. |
| **AI draft grading** | Instructors | Reads the submitted file where possible and proposes a grade and feedback covering strengths, deficiencies and guidance, with a confidence level. If the file cannot be read, it gives checklist-style comments with no grade. Nothing is saved until the instructor clicks Save. |
| **At-risk advisories** | Staff | Flags learners using platform signals (below) and keeps an outreach log. |

### At-risk rules
A learner is flagged in a course when one or more of these is true:

- Progress is below 30% after at least two past sessions.
- One or more assignments are missing or overdue.
- Attendance is below the warning threshold (default 75%) across at least three marked sessions.
- Quiz average is below the pass mark.

One factor is **Low** risk, two is **Moderate**, three or more is **High**. Staff can refresh the flags and log outreach notes against each one. Notes are kept when flags are recalculated.

### Integrations (Settings → Integrations)
- Add provider profiles for **OpenAI**, **Gemini** or **Azure OpenAI** with API key, model and endpoint details. Keys can also come from environment variables.
- **Test connection** button for each profile.
- **Capability map**: choose the provider, model and temperature for each capability (tutor, summarize, practice quiz, quiz generation, quiz check, evaluate, at-risk).
- **Primary and fallback provider**: if the chosen provider fails, the server tries the fallback, then the primary, then any provider with a key.
- **Monthly budget**: a call limit (default 5,000) with an optional hard stop.
- **Usage counter**: calls and tokens per month, broken down by feature.

### AI safeguards
- Keys are encrypted with AES-256-GCM on the server and shown masked in the UI.
- **PII scrubbing** before every provider call: emails, phone numbers, CNIC numbers, registration numbers and the learner's own name are replaced with `[redacted]`.
- **Rate limit** of 60 calls per user per hour (20 for connection tests).
- Permission checks on the server: `ai → use` to call AI, `ai → configure` or `settings → edit` to change integrations.
- AI output is labelled with an "SDC Learn AI" badge.

## 10. Roles and permissions

Every role combines three independent parts.

1. **Experience** decides the layout and home page: staff console, instructor console or learner portal.
2. **Course access** decides which courses the role can see:

   | Scope | Courses visible |
   |---|---|
   | All | Every course |
   | Assigned | Courses where the user is the instructor of at least one batch |
   | Enrolled | Published courses with an active enrollment |
   | Selected | A hand-picked list of courses |

   Learners, submissions, attendance, results, announcements and message recipients are all derived from the visible courses.

3. **Permission matrix** of modules and actions:

   | Module | Actions |
   |---|---|
   | Dashboard | view |
   | My courses & learning | view |
   | Courses, sessions & assignments | view, create, edit, delete, publish |
   | Programs | view, create, edit, delete |
   | Divisions | view, create, edit, delete |
   | Batches | view, create, edit, delete |
   | Enrollments | view, create, edit, delete |
   | Learner accounts | view, create, edit, delete |
   | Staff accounts | view, create, edit, delete |
   | Roles & permissions | view, create, edit, delete |
   | Submissions & grading | view, edit (grade) |
   | Attendance | view, edit (mark) |
   | Results | view, edit |
   | Certificates | view, create (issue), edit (revoke) |
   | Fees | view, create, edit, delete |
   | Announcements | view, create, edit, delete |
   | Messages | view, create (send) |
   | Calendar | view |
   | Learner feedback | view, delete |
   | Reports | view |
   | Settings | view, edit |
   | SDC Learn AI | view, use, configure |
   | Quizzes | view, create, edit, delete, publish |

One function, `can(module, action)`, decides what appears in the menu, which pages open and which buttons show.

Role management:
- Create, edit, duplicate and delete roles.
- The built-in Coordinator role always has full access and its matrix is locked.
- A role that is in use cannot be deleted.
- Users cannot change their own role.

## 11. Settings

Everything below is changed in the UI by a coordinator, with no code changes.

| Tab | What it controls |
|---|---|
| **Branding** | Product and organisation names, tagline, square logo, full logo lockup, website, phone, email, address, footer text |
| **Appearance** | Primary, accent and highlight colours, corner radius, default light or dark theme |
| **Terminology** | The name of every term: Learner, Instructor, Coordinator, Course, Session, Module, Batch, Program, Division, Assignment, Fee, Quiz, Attempt, AI Tutor |
| **Learning** | Help URL, upload endpoint, upload size and file types, browser fallback limit, late policy, completion threshold, attendance warning threshold, result weights, grade bands, pass mark, certificate prefix, currency, program types, levels, delivery modes, fee types, feedback prompt percentage, demo-account shortcuts |
| **Features** | On/off switches for attendance, results, certificates, fees, messages, announcements, calendar, feedback, quizzes, and each AI feature. A switch is saved as soon as it is flipped |
| **Sign-in** | Show or hide "Continue with Google", and what happens to unknown Google emails |
| **Integrations** | AI providers, capability map, budget and usage |
| **Data** | Backup and restore as JSON, reset to demo data, storage and upload-server status, cloud sync status |

Each user also has their own light/dark toggle in the top bar.

## 12. Data storage and cloud sync

The app works in three modes, chosen automatically.

| Mode | When | Behaviour |
|---|---|---|
| **Local only** | Cloud sync is off, or the cloud is unreachable | All data stays in this browser's `localStorage` |
| **Direct sync** | Supabase is configured and the server has no `SDC_STATE_SECRET` | The browser reads and writes the Supabase row with the publishable key |
| **Gateway** | The server has `SDC_STATE_SECRET` | Every read and write goes through `/api/sdc` with a signed session token |

In gateway mode:
- Passwords are checked on the server.
- Each browser receives only its own password hash.
- Learners can change only their own profile fields. They cannot change their role, status or email.
- Changing accounts, roles or settings requires the matching permission.
- Signing out clears the cached copy from the browser.
- The Supabase table is closed to the browser entirely ([supabase/gateway.sql](supabase/gateway.sql)).

The hosted deployment runs in gateway mode. A local copy without the secret cannot reach the live data and falls back to local-only storage.

**Backup and restore**: Settings → Data downloads the full state as JSON and restores from a file. **Reset to demo data** rebuilds the demo catalogue.

**Neon (optional)**: `DATABASE_URL` lets the server persist its own small legacy state file. It does not hold course or learner data.

## 13. File uploads

- Used for assignment submissions, session resources and logos.
- The server validates the **extension** and the **size**. Defaults: 30 MB and `xlsx, xls, xlsm, csv, docx, doc, pptx, ppt, pdf, pbix, twbx, twb, ipynb, sql, txt, md, zip, png, jpg, jpeg, webp, svg, mp4`.
- Files are stored under random names and served as downloads with content sniffing disabled, so an upload can never run as a page.
- Storage location depends on the host:

  | Host | Storage |
  |---|---|
  | Local or Render | `backend/uploads/` on disk |
  | Vercel with a Blob token | Vercel Blob, limited to 4.5 MB per file |
  | Vercel without a Blob token | Temporary `/tmp`, lost when the function restarts |

- If the server is unreachable, files up to the browser fallback limit (default 1.5 MB) are stored inside the browser state instead.

## 14. Server API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Server health |
| `GET /api/sdc/status` | Whether gateway mode is on |
| `POST /api/sdc/login` | Email and password sign-in (gateway) |
| `POST /api/sdc/google` | Google sign-in (gateway) |
| `GET /api/sdc/state` · `PUT /api/sdc/state` | Read and save the shared state (gateway) |
| `GET /api/sdc/verify?code=` | Public certificate check |
| `GET /api/sdc/public` | Branding for the sign-in page |
| `GET /api/ai/status` | AI providers, usage and configuration status |
| `POST /api/ai/auth` | Local AI token for development without the gateway |
| `POST /api/ai/configure` | Add, update or remove an AI provider profile |
| `POST /api/ai/test` | Test an AI provider connection |
| `POST /api/ai/complete` | Run an AI capability |
| `POST /api/lms/uploads` | Upload a file |
| `GET /api/lms/upload-config` | Upload limits and storage type |
| `GET /uploads/<file>` | Download a stored file |
| `GET /api/neon/health` | Neon connection status |

The server also contains a legacy JSON API (`/api/auth/login`, per-collection CRUD, `/api/dashboard/summary`, `/api/admin/export`) and passkey endpoints (`/api/auth/passkey/*`). The current UI does not use them.

## 15. Security

- Passwords are stored only as salted, iterated SHA-256 hashes.
- In gateway mode, sign-in and state changes are enforced on the server (section 12).
- AI keys are encrypted at rest and never sent to the browser (section 9).
- Uploads are validated on the server and served as downloads only (section 13).
- The `/backend/` folder is blocked from public access on Vercel.
- Without gateway mode, permission checks run in the browser only. They shape the UI but are not a security boundary. For a public deployment follow [supabase/PRODUCTION_SECURITY_NOTES.md](supabase/PRODUCTION_SECURITY_NOTES.md) and the production checklist in [SETUP.md](SETUP.md).

## 16. Pages and routes

| Route | Page |
|---|---|
| `/dashboard` | Staff and instructor dashboard |
| `/courses` | Learner: My Courses |
| `/assignments` | Learner: my assignments |
| `/course/:id` | Course home |
| `/course/:id/session/:sid` | Session page |
| `/course/:id/outline` | Course outline |
| `/course/:id/submit` | Submit assignment |
| `/course/:id/quizzes` | Quiz list |
| `/course/:id/quiz/:qid` | Take a quiz |
| `/manage/courses` | Course list |
| `/manage/course/:id` | Course builder |
| `/manage/batch/:id` | Batch workspace |
| `/programs` · `/divisions` · `/batches` | Catalogue |
| `/learners` · `/instructors` · `/users` | People |
| `/enrollments` | Enrollments |
| `/roles` | Roles and permissions |
| `/submissions` | Submissions and grading |
| `/attendance` | Attendance |
| `/results` | Results |
| `/certificates` | Certificates |
| `/fees` | Fees |
| `/calendar` | Calendar |
| `/announcements` · `/messages` · `/notifications` | Communication |
| `/reports` | Reports |
| `/feedback` | Learner feedback |
| `/settings` | Settings |
| `/profile` | My profile |

Standalone pages: [login.html](login.html), [verify.html](verify.html), [privacy.html](privacy.html), [terms.html](terms.html).

## 17. Data model

All collections live in one state object.

| Collection | Holds |
|---|---|
| `roles` | Role name, experience, course scope, permission matrix |
| `users` | Accounts for learners, instructors and staff |
| `divisions` · `programs` | The organisational catalogue |
| `courses` | Course blueprints: details, outcomes, modules, Zoom, help URL. No instructor field |
| `sessions` | Sessions of a course: schedule, recording, resources |
| `batches` | A run of a course with dates, its instructor (`instructorId`), venue and capacity |
| `enrollments` | Learner in a course and batch, with full or restricted access |
| `assignments` | Assignments owned by a batch |
| `submissions` | Uploaded work with grade, feedback and history |
| `quizzes` · `questions` · `quizAttempts` | Graded quizzes, their questions and learner attempts |
| `practiceAttempts` | Private practice quiz scores |
| `progress` | Completed sessions per learner and course |
| `attendance` | Attendance mark per learner and session |
| `results` | Final percentage and grade per learner and course |
| `certificates` | Issued certificates with code and status |
| `fees` | Fee records and payments |
| `announcements` · `messages` · `notifications` | Communication |
| `feedback` | Learner ratings and comments |
| `atRiskFlags` | At-risk flags with outreach notes |
| `settings` | Branding, theme, terminology, learning rules, features, sign-in, integrations |

The state carries a `schema` version (currently 4). [js/migrations.js](js/migrations.js) upgrades older states step by step, in the browser and on the server: version 3 moved assignments and quizzes onto batches, and version 4 moved instructors from the course (`instructorIds`) onto batches (`instructorId`), creating a batch where a course instructor had none.

Field-level detail is in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md#data-model). That file still lists `instructorIds` on courses, which no longer exists.

## 18. Testing

| Suite | How to run | Covers |
|---|---|---|
| Logic tests | `npm test` | Permissions, course scoping, grading, gateway merge rules, AI helpers |
| Syntax check | `npm run check` | Every script parses |
| UI workflow test | Browser console, see [RUN.md](RUN.md#tests) | 29 workflows across modules and roles |
| SDC test suite | `node tests/suite.run.js http://localhost:3000` | 94 cases; needs `puppeteer-core`; blocks all Supabase traffic |
| Phase 2 suite | `node tests/phase2.run.js` | AI and quizzes against a mock Supabase and mock AI provider |
| Manual suite | [docs/testing/](docs/testing/) | Excel workbooks with test cases and recorded results |

## 19. Deployment

- **Vercel**: static pages are served from the CDN; `/api/*` and `/uploads/*` go to the Express app through [api/index.js](api/index.js). Region `bom1`, 60-second function limit.
- **Render**: one web service running `npm start`, with a persistent disk at `backend/uploads`.
- **Static host only**: the pages work without the server. Uploads then fall back to browser storage and AI is unavailable.

Environment variables are listed in [SETUP.md](SETUP.md#3-environment-variables) and [.env.example](.env.example).

## 20. How everything connects (end-to-end flows)

### Connection map

```
Browser
  index.html ──► login.html (js/login.js) ──► app.html
                                                │
  app.html loads scripts in this order:         ▼
  seed.js → cloud-config.js → migrations.js → core.js → ai-client.js
  → cloud-sync.js → shell.js → pages-learn / manage / users / ops / ai

  pages-*.js ──► core.js (db, saveDB, can, Domain) ──► localStorage "sdcLearnDB_v1"
       │                    │
       │                    └─► cloud-sync.js ──► /api/sdc/*  (gateway mode)
       │                                     └──► Supabase row (direct mode)
       ├─► ai-client.js (SDCAI) ──► /api/ai/*
       └─► uploadFile() ──► /api/lms/uploads

Server (backend/server.js, also the Vercel function via api/index.js)
  state-api.js  /api/sdc/*  ──► Supabase functions sdc_state_get / sdc_state_put
  ai-api.js     /api/ai/*   ──► OpenAI / Gemini / Azure OpenAI
                            ──► keys + usage in Supabase sdc_learn_kv (gateway)
                                or backend/data/*.json (local)
  uploads       /api/lms/uploads ──► backend/uploads, /tmp, or Vercel Blob
  static files  login.html, app.html, js/, css/, assets/
```

### Opening the app
1. [index.html](index.html) checks for a session (`sdcSession` in session storage or `sdcRemember` in local storage) and redirects to `app.html` or `login.html`.
2. `app.html` loads the scripts in the order above. `core.js` reads the state from `localStorage`; if nothing is stored it builds the state from `seed.js`.
3. `shell.js` (`App.start`) finds the signed-in user, draws the sidebar and top bar, and renders the page for the current `#/route`.
4. About 100 ms later `cloud-sync.js` pulls the shared copy in the background. If the cloud copy is newer, it replaces the local one and the page re-renders.

### Signing in
1. `login.js` asks `/api/sdc/status` whether gateway mode is on.
2. **Gateway mode**: the email and password go to `POST /api/sdc/login`. The server loads the state from Supabase, checks the password hash and account status, and returns a signed token plus the state with other users' hashes removed. The browser stores the token as `sdcCloudToken` and the state in `localStorage`.
3. **Without the gateway**: `login()` in `core.js` checks the password against the hash in the browser's own state.
4. The user id is saved as `sdcSession` (and `sdcRemember` when "keep me signed in" is ticked), then the browser moves to `app.html`.
5. **Google**: a Supabase Auth client gets a Google-verified access token, which is sent to `POST /api/sdc/google`. The server matches the email to a platform account (or creates one if sign-up is allowed) and returns the same session as step 2.

### Opening a page
1. `App.route()` entries in the `pages-*.js` files register each page with its permission, experience and feature flag.
2. On every hash change the shell checks `App.allowed()`: the role's experience, the feature switch and `can(module, 'view')`.
3. If allowed, the page's `render(ctx)` draws into `<main>`. Otherwise "Page not available" is shown.
4. The sidebar uses the same check, so pages a role cannot open never appear in the menu.

### Saving any change
1. A page calls `addRecord`, `updateRecord`, `deleteRecord` or `saveDB`.
2. `core.js` writes the state to `localStorage` and fires `sdc-db-change`.
3. `SDCCloud.syncNow()` marks the change as pending and schedules a push 400 ms later.
4. The push sends the whole state to `PUT /api/sdc/state` (gateway) or upserts the Supabase row (direct mode).
5. In gateway mode the server merges the change against the stored state: it keeps password hashes the browser never had, and discards changes to users, roles or settings that the signed-in user is not permitted to make.
6. If the push fails, the change stays pending and is sent on the next pull.

### Submitting and grading an assignment
1. The learner picks an assignment on `/course/:id/submit` and drops a file.
2. The browser checks the account email, file type, size and deadline.
3. The file goes to `POST /api/lms/uploads`. The server validates it again, stores it under a random name and returns its URL.
4. A `submissions` record is saved (the earlier file moves to `history`) and the instructor of the assignment's batch receives a notification.
5. The instructor opens `/submissions`, clicks **Grade**, optionally asks for an AI draft, then saves marks and feedback.
6. The submission becomes `Graded`, the learner is notified, and the grade feeds the assignment average in results.

### Calling SDC Learn AI
1. A page calls `SDCAI.call(feature, …)` in [js/ai-client.js](js/ai-client.js).
2. The client checks the AI master switch and the `ai` permission, then looks up the provider, model and temperature for that capability in Settings → Integrations.
3. It sends the request to `POST /api/ai/complete` with the gateway session token. In local development without the gateway it first gets a token from `POST /api/ai/auth`.
4. The server verifies the token, checks the user's permission and the AI switches, applies the hourly rate limit and the monthly budget.
5. The prompt is scrubbed of personal data.
6. The server calls the capability's provider. If it fails, it tries the fallback provider, then the primary, then any other provider that has a key.
7. Usage (calls, tokens, feature) is recorded and the text is returned to the page.

### Taking a quiz
1. An instructor builds a quiz in the batch workspace and publishes it.
2. The learner opens `/course/:id/quizzes`, which lists only their batch's published quizzes.
3. On submit, objective questions are scored in the browser. Short answers are sent to AI for a suggested score when AI is on; otherwise they are marked pending.
4. A `quizAttempts` record is saved with the score and percentage.
5. The instructor reviews short answers in the attempts view and can override the points.
6. The quiz average counts toward the final result through the quiz weight.

### From enrollment to certificate
1. A coordinator creates a batch for the course and assigns its instructor, then enrolls a learner into the course and batch (`enrollments`), optionally creating a `fees` record.
2. The learner marks sessions complete (`progress`), submits assignments and takes quizzes; the instructor marks `attendance`.
3. The instructor enters the assessment mark; the final percentage and grade are calculated and published (`results`).
4. When the learner is eligible, a coordinator issues a certificate with a generated code (`certificates`).
5. Anyone can check the code on [verify.html](verify.html). It asks `GET /api/sdc/verify`; if the gateway is not available it looks in the local state.

## 21. Known limitations

- The whole dataset is a single JSON document. This suits a training council's scale but is not designed for very large numbers of learners or heavy concurrent editing.
- Any signed-in user receives the full state except other users' password hashes. Per-role filtering of what is downloaded is not implemented.
- On Vercel, uploads are limited to 4.5 MB and need Vercel Blob to persist.
- The AI rate limit is held in memory per server instance, so it is approximate on serverless hosting.
- The summarizer works from the resource title and session summary. It does not read the resource file itself.
- AI responses are English only.

## 22. File structure

About 7,200 lines of code in total. There is no build output: the files below are what runs.

### Folder tree

```
LEARNING-MANAGEMENT-SYSTEM/
├── index.html              Entry: redirects to the portal or the sign-in page
├── login.html              Sign-in page
├── app.html                The portal (single page, all #/ routes)
├── verify.html             Public certificate verification
├── privacy.html            Privacy policy
├── terms.html              Terms of use
├── css/
│   └── app.css             The whole design system
├── js/                     All browser code
│   ├── seed.js
│   ├── cloud-config.js
│   ├── migrations.js
│   ├── core.js
│   ├── ai-client.js
│   ├── cloud-sync.js
│   ├── shell.js
│   ├── pages-learn.js
│   ├── pages-manage.js
│   ├── pages-users.js
│   ├── pages-ops.js
│   ├── pages-ai.js
│   └── login.js
├── backend/                The Express server
│   ├── server.js
│   ├── state-api.js
│   ├── ai-api.js
│   ├── data/               database.json (legacy), ai-secrets.json and ai-usage.json (local, not in git)
│   └── uploads/            Uploaded files on disk (not in git)
├── api/
│   └── index.js            Vercel entry: re-exports the Express app
├── supabase/               SQL to run in Supabase or Neon, and security notes
├── assets/
│   ├── brand/              Logo mark and logo lockup
│   └── resources/          Sample files used by the demo sessions
├── tests/                  Automated tests
├── docs/                   Requirements, implementation notes, screenshots, test workbooks
├── package.json            Scripts and dependencies
├── vercel.json             Vercel routing and function settings
├── render.yaml             Render service definition
├── .env.example            Template for the local .env file
├── README.md, SETUP.md, RUN.md, FEATURES.md
└── AGENTS.md, CLAUDE.md    Rules for AI coding agents
```

### HTML pages

| File | Purpose |
|---|---|
| [index.html](index.html) | Checks for a saved session and redirects to `app.html` or `login.html` |
| [login.html](login.html) | Sign-in form, Google button, demo account shortcuts, live showcase. Runs [js/login.js](js/login.js) |
| [app.html](app.html) | The portal shell. Loads every script in `js/` in a fixed order; all pages render inside it |
| [verify.html](verify.html) | Public page to check a certificate code |
| [privacy.html](privacy.html), [terms.html](terms.html) | Static legal pages |

### Browser code (`js/`)

Listed in the order `app.html` loads them. Later files depend on earlier ones.

| File | Lines | What it contains |
|---|---|---|
| [js/seed.js](js/seed.js) | 272 | `SEED`: the demo data (roles, users, divisions, programs, courses, sessions, batches, assignments, enrollments, quizzes and more). Dates are relative to today |
| [js/cloud-config.js](js/cloud-config.js) | 13 | `SDC_CLOUD_CONFIG`: Supabase URL, publishable key, table and row id. Points at the live project; do not change |
| [js/migrations.js](js/migrations.js) | 57 | `migrateState()`: upgrades an older state to the current schema. Loaded by the browser and by the server |
| [js/core.js](js/core.js) | 882 | The platform layer: store (`db`, `saveDB`, `addRecord`, `updateRecord`, `deleteRecord`, `findRecord`), `DEFAULT_SETTINGS`, terminology `t()`, feature switches `feature()`, `PERMISSIONS` and `can()`, password hashing and `login()`, the `Domain` rules (visible courses, batches, progress, results, at-risk), notifications, formatting helpers, icons and the UI kit (toast, modal, confirm, form builder, data table, dropzone, upload, CSV, print) |
| [js/ai-client.js](js/ai-client.js) | 64 | `SDCAI`: browser client for `/api/ai/*`. Picks the provider and model for a capability and sends the request with the session token |
| [js/cloud-sync.js](js/cloud-sync.js) | 95 | `SDCCloud`: detects gateway or direct mode, pulls the shared state, pushes changes (debounced, one at a time), and handles gateway sign-in and sign-out |
| [js/shell.js](js/shell.js) | 247 | `App`: route registry (`App.route`), access check (`App.allowed`), permission-filtered sidebar, top bar, notifications bell, breadcrumbs, page context |
| [js/pages-learn.js](js/pages-learn.js) | 446 | Learner pages: My Courses, course home, session page, outline, submit assignment, my assignments, calendar |
| [js/pages-manage.js](js/pages-manage.js) | 606 | The generic list-and-form page (`crudPage`), course list, course builder (overview, sessions, batches, learners), batch workspace (assignments, quizzes, learners, copy from another batch), enrollments, programs, divisions, batches |
| [js/pages-users.js](js/pages-users.js) | 154 | Learner, instructor and all-user accounts; roles and the permission matrix |
| [js/pages-ops.js](js/pages-ops.js) | 806 | Dashboards, at-risk panel, submissions and grading (with AI draft), attendance, results, certificates, fees, announcements, messages, notifications, reports, feedback, settings (all tabs, including Integrations) and profile |
| [js/pages-ai.js](js/pages-ai.js) | 411 | AI drawer, tutor, resource summarizer, practice quizzes, graded quiz list and player, quiz editor, attempts review, AI quiz generation |
| [js/login.js](js/login.js) | 149 | Sign-in page logic. Loaded only by `login.html` |

### Styles

| File | Lines | What it contains |
|---|---|---|
| [css/app.css](css/app.css) | 885 | Colour and spacing tokens, light and dark themes, every component, responsive rules, the sign-in page and print styles |

### Server (`backend/` and `api/`)

| File | Lines | What it contains |
|---|---|---|
| [backend/server.js](backend/server.js) | 189 | The Express app: serves the static pages, validates and stores uploads (`/api/lms/uploads`, `/uploads/*`), health checks, and mounts the two routers below. Also holds the unused legacy JSON API and passkey endpoints |
| [backend/state-api.js](backend/state-api.js) | 139 | The state gateway `/api/sdc/*`: sign-in, Google sign-in, read and save the shared state with merge rules, public certificate check, public branding |
| [backend/ai-api.js](backend/ai-api.js) | 344 | The AI proxy `/api/ai/*`: encrypted provider profiles, permission checks, rate limit, budget, PII scrubbing, provider calls with fallback, usage tracking |
| [backend/data/database.json](backend/data/database.json) | | Data for the legacy JSON API only. The current UI does not use it |
| [api/index.js](api/index.js) | 3 | Vercel serverless entry. Re-exports the Express app |

### Database scripts (`supabase/`)

| File | Purpose |
|---|---|
| [supabase/schema.sql](supabase/schema.sql) | Creates the `sdc_learn_state` table that holds the single shared state row (direct sync mode) |
| [supabase/gateway.sql](supabase/gateway.sql) | Locks that table behind the server: only the gateway can read and write it, through two functions |
| [supabase/NEON_STATE_SCHEMA.sql](supabase/NEON_STATE_SCHEMA.sql) | Optional Neon table for the server's legacy state |
| [supabase/PRODUCTION_SECURITY_NOTES.md](supabase/PRODUCTION_SECURITY_NOTES.md) | Security checklist for a public deployment |

### Tests (`tests/`)

| File | Runs with | Covers |
|---|---|---|
| [tests/core.test.js](tests/core.test.js) | `npm test` | Permissions, course scoping, batches, grading, state migrations |
| [tests/gateway.test.js](tests/gateway.test.js) | `npm test` | Server password hashing matches the browser; gateway merge rules |
| [tests/ai.test.js](tests/ai.test.js) | `npm test` | PII scrubbing, key masking, quiz scoring |
| [tests/e2e.browser.js](tests/e2e.browser.js) | Pasted into the browser console | 29 UI workflows. Resets the data, so never run it on live data |
| [tests/suite.browser.js](tests/suite.browser.js), [tests/suite.run.js](tests/suite.run.js) | `node tests/suite.run.js <url>` | The 94-case SDC test suite. Needs `puppeteer-core` and Chrome |
| [tests/phase2.run.js](tests/phase2.run.js) | `node tests/phase2.run.js` | AI and quizzes against a local server with a mock Supabase and a mock AI provider. Needs `puppeteer-core` and Chrome |

### Documents (`docs/` and root)

| File | Purpose |
|---|---|
| [README.md](README.md) | Short introduction |
| [SETUP.md](SETUP.md) | Environment variables, Supabase, Google sign-in, deployment |
| [RUN.md](RUN.md) | Running locally, demo accounts, tests, troubleshooting |
| [FEATURES.md](FEATURES.md) | This file |
| [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md) | Rules for AI coding agents (Codex reads the first, Claude the second, which imports the first) |
| [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Data model fields, how to add a page, a permission or a setting |
| [docs/BRD_SDC_Online_Learning_Platform.md](docs/BRD_SDC_Online_Learning_Platform.md) | Phase 1 requirements |
| [docs/BRD_Phase2_AI_Capabilities.md](docs/BRD_Phase2_AI_Capabilities.md) | Phase 2 (SDC Learn AI) requirements |
| [docs/BRD_AI_Course_Generation.md](docs/BRD_AI_Course_Generation.md) | Proposed AI course generator. Draft awaiting approval, not implemented |
| `docs/testing/` | Excel workbooks with manual test cases and recorded results, and the script that builds them |
| `docs/screenshots/` | Screenshots of the main pages |

### Configuration files

| File | Purpose |
|---|---|
| [package.json](package.json) | Scripts (`start`, `dev`, `check`, `test`) and dependencies: `express`, `multer`, `jsonwebtoken`, `bcryptjs`, `cors`, `dotenv`, `@vercel/blob`, `@neondatabase/serverless`, `@simplewebauthn/server`. Node 20 to 24 |
| [vercel.json](vercel.json) | Sends `/api/*` and `/uploads/*` to `api/index.js`, blocks `/backend/`, sets region `bom1` and a 60-second limit, and bundles `js/seed.js` and `js/cloud-config.js` into the function |
| [.vercelignore](.vercelignore) | Keeps `.env`, uploads, tests and `supabase/` out of the Vercel deployment |
| [render.yaml](render.yaml) | Render web service: `npm ci`, `npm start`, health check on `/api/health` |
| [.env.example](.env.example) | Template for `.env`: port, JWT secret, upload size, AI keys, gateway secret |
| [.gitignore](.gitignore) | Keeps `node_modules`, `.env`, uploads and the local AI secrets and usage files out of git |

### Where to change what

| To change | Edit |
|---|---|
| A learner page | [js/pages-learn.js](js/pages-learn.js) |
| Course builder, batches, enrollments | [js/pages-manage.js](js/pages-manage.js) |
| Accounts or roles | [js/pages-users.js](js/pages-users.js) |
| Grading, attendance, results, fees, reports, settings | [js/pages-ops.js](js/pages-ops.js) |
| Quizzes or an AI feature in the UI | [js/pages-ai.js](js/pages-ai.js) |
| A business rule, permission, default setting or shared UI component | [js/core.js](js/core.js) |
| The menu or routing | [js/shell.js](js/shell.js) |
| Demo data | [js/seed.js](js/seed.js) |
| The shape of stored data | [js/migrations.js](js/migrations.js) (add a new schema step) |
| Sign-in or state rules on the server | [backend/state-api.js](backend/state-api.js) |
| AI providers, limits or scrubbing | [backend/ai-api.js](backend/ai-api.js) |
| Uploads | [backend/server.js](backend/server.js) |
| Look and feel | [css/app.css](css/app.css) |

A new script file must also be added to [app.html](app.html) and to the `check` script in [package.json](package.json).
