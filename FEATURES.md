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
| AI providers | OpenAI, Google Gemini, Azure OpenAI, Groq, called only from the server |
| Hosting | Vercel (serverless) or Render (long-running service) |

How the pieces fit together:

- The browser renders everything from `localStorage`, so pages open instantly and keep working offline.
- [js/cloud-sync.js](js/cloud-sync.js) pulls the shared copy on load and pushes changes in the background. Pushes are debounced and run one at a time so an older snapshot cannot overwrite a newer one, and a change is only counted as saved when the server says so (section 12).
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
| [js/aiprovider-logic.js](js/aiprovider-logic.js) | Provider-neutral rules for the Course Builder: what an AI failure means, which providers can take over, who wrote what |
| [js/ai-provider-ui.js](js/ai-provider-ui.js) | The Course Builder's temporary provider choice and provider picker (`AIRoute`) |
| [js/seed.js](js/seed.js) | Demo data with dates relative to today |
| [js/migrations.js](js/migrations.js) | One-time state upgrades shared by browser and server |
| [js/shared-rules.js](js/shared-rules.js) | Quiz scoring and the role ceiling, shared by browser and server |
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
- Embedded recording. YouTube, Vimeo and Google Drive links become embedded players; `.mp4` and `.webm` files play directly; anything else becomes an "Open recording" link. A YouTube video found by the AI course generator also shows its title and channel under the player, linking to YouTube.
- Downloadable resources.
- Previous and next session navigation.
- **Mark as complete**, which updates course progress.
- **Ask Tutor**, **Summarize** and **Test my understanding** buttons when the AI features are on.
- **Teaching content** written with the AI course content builder (section 9): objectives, prerequisites, the lesson with worked examples, key terms, tutorials, code examples with a copy button, demonstrations, guided exercises (hint and solution folded away) and practice tasks. Learners see it only when the course is published and a person approved that session's content. Staff see everything, including the time plan, the homework and quiz blueprints and the instructor notes, plus **Preview as learner** (`?view=learner`).

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
- **Content tab**: the AI course content builder (section 9, "AI course content builder"): generate, review, edit, regenerate and approve the written teaching material of every session, the completeness count and the course check. The page header has a **Generate Full Course Content with AI** button when the AI course generator switch is on.
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
| **AI course generator** | Coordinators (anyone who may create courses and use AI) | Drafts a whole course outline (outcomes, modules, session titles and one-line summaries) from a short brief. A person edits and reviews it; it is saved as a **draft** course with its sessions. See "AI course generator" below. |
| **AI course content builder** | Coordinators and anyone who may edit the course and use AI | Writes the complete teaching material of every session of an existing course (lesson, tutorials, code, exercises, homework and quiz blueprints, instructor notes), checks the course for missing topics and repetition, and drafts a capstone project. A person reviews, edits and approves it. See "AI course content builder" below. |

### At-risk rules
A learner is flagged in a course when one or more of these is true:

- Progress is below 30% after at least two past sessions.
- One or more assignments are missing or overdue.
- Attendance is below the warning threshold (default 75%) across at least three marked sessions.
- Quiz average is below the pass mark.

One factor is **Low** risk, two is **Moderate**, three or more is **High**. Staff can refresh the flags and log outreach notes against each one. Notes are kept when flags are recalculated.

### Integrations (Settings → Integrations)
- The course provider chooser shows separate selectable rows with provider name, availability badge, model and key-profile name; unavailable providers include an explanation. The selected row is highlighted.
- Providers share one panel with a compact, shaded left navigation and the selected provider's settings on the right, aligned to the same height. On mobile the tabs sit above the settings. Switching tabs keeps unsaved inputs; saving, testing or removing a profile keeps that provider selected. Arrow keys, Home and End also switch providers.
- Add provider profiles for **OpenAI**, **Gemini**, **Azure OpenAI** or **Groq** with API key, model and endpoint details. Keys can also come from environment variables (`GROQ_API_KEY`, `GROQ_MODEL` for Groq).
- Each provider card shows whether it is configured (masked key only), the result of the last connection test, and this month's answered calls, tokens, average answer time and failed attempts with the last error code. **Save / Update**, **Test** and **Remove** (asks first and names the features set to use that provider; course content and settings are not changed).
- **Groq.** OpenAI-compatible Chat Completions, always at `https://api.groq.com/openai/v1` (a Groq key is never sent to another address, so there is no base-URL field). No model id is built in: **Load models from Groq** reads the authenticated Models API for the saved or pasted key and offers the active text-generation models (speech, text-to-speech, safety-classifier and agentic "compound" models are not offered), with each model's context window and answer limit; the list is cached for 10 minutes. The server keeps every request inside the model's answer limit (`max_completion_tokens`) and refuses a prompt that would not fit its context window (`provider_too_large`) before sending it. JSON features use JSON mode (`response_format: json_object`), or Structured Outputs (`json_schema`, best effort) when a page sends a schema; a model that rejects either gets the next simpler form. When Groq's JSON validation fails it returns what the model wrote, which goes through the page's own JSON repair and checks. Fields Groq rejects (`logprobs`, `logit_bias`, `top_logprobs`, `n` above 1, `messages[].name`) are never sent. A parameter a model rejects (`reasoning_format`, `reasoning_effort`, `max_completion_tokens`, `temperature`, `response_format`) gets one corrected request, remembered for that model while the server runs. GPT-OSS models are asked for `reasoning_effort: low` so the reasoning leaves room for the answer; reasoning in `<think>` tags is removed from the answer. Rate limits: 429 and 498 are `provider_busy` with the wait Groq asks for (`retry-after`, or "try again in 1m2.5s"), a daily limit (RPD/TPD) is `provider_quota`, 413 "Request too large" is `provider_too_large`, a rejected key is `provider_auth`, an unknown or retired model is `provider_model`. Usage records Groq's token counts and `total_time`. For trying the screens without a real Groq request, `SDC_QA_GROQ_BASE_URL` can point at a stand-in on the same machine (loopback addresses only; ignored on Vercel and with `NODE_ENV=production`).
- **Test connection** button for each profile (a 20-second limit; the result is stored with the profile, never the key).
- **YouTube videos** card: the YouTube Data API v3 key the Course Builder uses to find a video for each session (section 9, "Session videos"). **Save / Update key**, **Test** (one sample search, 10-second limit; the result is kept, never the key) and **Remove**. The key can also come from the `YOUTUBE_API_KEY` environment variable, which wins over a saved key. Shows "Demo mode" on a developer machine with `SDC_AI_MOCK=1` and no key, and this month's searches and failures.
- **Gemini models.** Gemini 2.5 models are only open to Google projects that already used them; new API keys use `gemini-3.5-flash-lite` (fast, the default when a Gemini key has no model set) or `gemini-3.8-flash`. For Gemini 3 and later models the server sets thinking by level (`thinkingConfig.thinkingLevel`, never the legacy `thinkingBudget`): the lowest level the model accepts (`minimal` on Flash-Lite, `low` on 3.8 Flash and Pro, which reject `minimal`), adds room for that thinking on top of the answer size (1,024 / 2,048 tokens, because thinking counts against `maxOutputTokens`), and leaves the temperature at the model default (Google advises against lowering it for Gemini 3). A model that rejects the level gets one corrected request. Gemini 2.x requests are unchanged (2.5 Flash: thinking off for JSON answers). The answer reports `usage {input, output, thinking}`; `tokens` is the billed total including thinking.
- **Capability map**: choose the provider, model and temperature for each capability (tutor, summarize, practice quiz, quiz generation, quiz check, evaluate, at-risk, session assist, course outline generation `courseGenerate`, full course content `courseContent`, AI content repair `contentRepair`). Course generation defaults to temperature 0.4. `courseContent` and `contentRepair` start as **Same as …**: content uses the course outline's provider and model, repair uses the content's, so a setup made before these rows existed keeps working unchanged; each can be set to its own provider and model. For a Groq row the model field offers the loaded Groq models. Changing a provider or model affects only new requests: content, a person's edits, generation history and an unfinished run are kept, the next run continues with what is missing, and each part records the provider and model that wrote it.
- **Primary and fallback provider**: if the chosen provider fails, the server tries the fallback, then the primary, then any provider with a key among OpenAI, Gemini and Azure OpenAI. Groq is only used where it was chosen (a capability, the primary or the fallback), never as an automatic extra. Fallback **None: never switch automatically** tries only the capability's own provider. **The Course Builder never uses this automatic fallback**: its requests carry `noFallback`, so when a provider stops the work pauses and a coordinator chooses (see "One Course Builder, any provider" under AI course content builder).
- **Monthly budget**: a call limit (default 5,000) with an optional hard stop.
- **Usage counter**: calls and tokens per month, broken down by feature.

### AI safeguards
- Keys are encrypted with AES-256-GCM on the server and shown masked in the UI. The encryption key is derived for this purpose only (not the secret hash the database stores); keys saved before this change are re-encrypted the next time a provider is saved or tested (SETUP.md).
- **PII scrubbing** before every provider call: emails, phone numbers, CNIC numbers, registration numbers and the learner's own name are replaced with `[redacted]`.
- **Rate limit** of 60 calls per user per hour (20 for connection tests). The three course features (`courseGenerate`, `courseContent`, `contentRepair`) count in their own bucket of **300 per user per hour** (`SDC_AI_CONTENT_RATE`, never below 60), because a 24-session course is 72 requests before any retry; everything else stays at 60.
- Permission checks on the server: `ai → use` to call AI, `ai → configure` or `settings → edit` to change integrations.
- AI output is labelled with an "SDC Learn AI" badge.
- **Answer size and time.** A page can ask for at most 8,000 output tokens (2,048 when it asks for nothing). One request has a 50-second budget: each attempt is cut off with the time that is left, the fallback provider is tried only when at least 15 seconds remain, and a request that ran out of time ends with a clear "took too long" error (`timeout`) and is not repeated. The browser stops waiting after 58 seconds.
- **One error vocabulary for all four providers.** OpenAI, Gemini, Azure OpenAI and Groq are mapped to the same codes: a rejected key is `provider_auth` (401/403, Gemini's `API_KEY_INVALID`), a used-up quota is `provider_quota` (a per-day quota, OpenAI `insufficient_quota`, a wait of an hour or more such as Azure's "retry after 86400 seconds") and a temporary limit is `provider_busy` with the wait the provider asked for, an unknown or unavailable model (including OpenAI/Azure 404s) is `provider_model`, and an oversized request (OpenAI/Azure `context_length_exceeded`, Groq 413, Gemini "exceeds the maximum number of tokens") is `provider_too_large`. A model that does not write text (speech, image, embedding, safety) is refused before anything is sent. Every error answer names the `provider` (and `model`) that failed and never contains a key (a key echoed by a provider is replaced by `[key]`). Every successful answer has the same shape: `text`, `model`, `provider`, `tokens`, `usage { input, output }`, `truncated`. A model that rejects JSON mode gets one corrected request without it (OpenAI, Azure and Groq alike).
- **Error codes.** AI errors carry a `code`: `rate_limit` (this platform's limit), `budget`, `not_configured`, `forbidden`, `unauthorized`, `provider`, `timeout`, `provider_busy` (the provider's own per-minute limit or overload, HTTP 503 with `retryAfterMs` taken from the provider's answer), `provider_quota` (the provider's daily quota is used up; waiting a minute does not help), `provider_model` (the configured model is unknown, retired or not open to this API key, for example Gemini 2.5 on a new Google project; the message names the model and points to Settings → Integrations) `provider_too_large` (the request is larger than the model's context or the account's per-minute token limit; sending it again cannot help), `provider_auth` (Groq rejected the API key), `invalid_json` (Groq JSON mode produced nothing readable) and `provider_blocked` (Gemini declined to answer, with the reason such as `SAFETY`). Answers that stopped because they reached the size limit are flagged `truncated: true`.

### AI course generator
The coordinator describes a course and SDC Learn AI drafts the outline; a person always decides. Nothing is published, enrolled, priced or assigned by the AI (Final Plan: [docs/SDC Learn AI - Course Generation - Final Plan.pdf](docs/SDC%20Learn%20AI%20-%20Course%20Generation%20-%20Final%20Plan.pdf)). **Release 1** is built: brief → one AI request → editable outline → review → draft course with all its sessions. Release 2 (session detail in groups, regenerate with an instruction, dates, coverage check, Sessions-tab button) is not built.

**Who and when.** The "Generate with SDC Learn AI" button (Manage Courses) and the page `#/manage/courses/generate` appear only when all four hold: the user may create courses, the user may use AI, **Settings → Features → "AI course generator" is on** (off by default; the server checks it too), and the AI master switch is on. Other users see no button and get the normal "not available" page from a direct link. The server repeats the permission and switch checks for the AI request and for saving.

**Steps**
1. **Brief.** Topic (required), audience (required), level, program type and delivery (lists from Settings → Learning), weeks, sessions per week and hours per session (live total of sessions and hours), optional program and division (all-courses coordinators only, as on the course form), learning goals, tools, and pasted source material (up to 12,000 characters; longer text is refused, never cut; personal details are removed before sending). More than 48 sessions in total is refused on the form, before any AI request. Start date and class days are not asked yet (Release 2).
2. **Outline.** One AI request returns title, tagline, description, prerequisites, a suggested code and icon, 4 to 8 learning outcomes, and the modules with their session titles and one-line summaries. Every field can be edited; outcomes, modules and sessions can be added, removed and reordered (a session moves across modules at the edges); each session lists the outcome numbers it supports. Warnings are recomputed on every edit.
3. **Review and create.** The whole course as it will be saved, with totals and the notice "Drafted with SDC Learn AI. Review the content before publishing." A YouTube video is found automatically for every session (see "Session videos" below) and shown under it with its thumbnail, title, channel and length. **Create draft course** saves it and opens the Course Builder. **Discard** throws the draft away.

**Session videos.** Like the other courses, every generated session can carry a video. The AI never writes video links (it would invent them): for each session it writes a short YouTube search phrase (`video` in its answer, kept as `videoQuery`). When the review step opens, the server searches YouTube's official Data API once per phrase (`POST /api/ai/videos`, section 14) and the page gives each session its best result that no other session in the course already shows. Only public, embeddable, safe-search videos between 2 minutes and 3 hours that are not live are offered (up to 5 per session). Per session the person can open the video, choose **Another video** (the next result not used elsewhere), **Remove** it, or **Paste a YouTube link**; **Find videos for sessions without one** searches again for the sessions left empty. Nothing is saved until **Create draft course**; the session then gets `videoUrl` (`https://www.youtube.com/watch?v=…`), `videoTitle` and `videoChannel` (a pasted link has no title). Changing the link later in the session form clears the stored title and channel. For an existing course, Course Builder → **Content** has **Find YouTube videos (N)**, which does the same for the sessions that have no video or recording and attaches the results directly (sessions that have one are never changed).
Without a YouTube key the review says so and the course is saved without videos; links can be pasted or added later. Each search costs 100 of the 10,000 free daily YouTube units (about 100 sessions a day); results are cached per phrase for 12 hours and a phrase repeated in one request is searched once. A used-up quota or a refused key stops the search with a clear message (`provider_quota`, `provider_auth`) and keeps what was already found. In demo mode (`SDC_AI_MOCK=1`, no key) the results are labelled placeholders, not real videos.

**What the platform fixes, marks or refuses** (`js/coursegen-logic.js`)
| | Cases | Result |
|---|---|---|
| Fixed quietly | code fences or text around the answer; module/session numbering ("Module 1:"); a line break or `\|` inside a name or outcome; unknown fields; an icon outside the list; spaces | format only; meaning unchanged |
| Kept and marked | text over its limit (blocks saving until shortened, never cut); an outcome number that does not exist; a session with no outcome; an outcome with no session; an outcome that does not start with an action word; a duplicate module name; an empty module; a different number of sessions than the brief; a web address already in use | shown whole with a mark; warnings do not block, except over-limit text, empty names and a web address in use |
| Refused | a broken, empty or cut-off answer; a missing title, outcomes, module name or session title; more than 12 modules or 48 sessions | one automatic retry, then an error for that request; never saved |

A different session count after the retry is shown as returned (nothing is added, deleted or shortened by the platform); saving it needs an explicit confirmation of the new count.

**Saving.** The course and all its sessions are written in one conditional save on the server (`POST /api/sdc/courses/ai-draft`, section 14). One generation id (`genId`, created with the draft and kept with it) decides duplicates: the server derives the record ids from it, so pressing save twice, retrying after a lost response, or saving on this device and syncing later never makes a second course. If no answer arrives, the page sends the same request again (up to three times); the server returns the course if it was already saved. A web address already in use is reported (the user changes the title or the address; it is never renamed silently). The course is always `draft`; fee, venue, Zoom details, dates, instructors and enrolments are never set. A coordinator whose course access is not "all" also gets a first batch with themselves as instructor, exactly as the manual form does. Learners cannot see the draft until a person publishes it.

**Records.** The course gets `aiGenerated: true` and `aiMeta: {genId, createdBy, createdAt, version, provider, model, mock, coverage}` (`coverage` = the outcome numbers each session supports, in session order). Sessions get `moduleName` (the exact module name), `summary`, `duration` (hours per session, e.g. `2h`), `order` and `published: true`; they are hidden from learners because the course is a draft. The course builder shows an **AI draft** label and the "Drafted with SDC Learn AI. Review the content before publishing." notice until the course is published.

**Unfinished work.** The brief, outline, edits and generation id are kept in `sessionStorage` per user, so a reload in the same tab restores the draft at the step it was on (also when the reload happened during saving: the same request is repeated and saves once). The draft is removed on discard, on a confirmed save and on sign-out.

**AI request.** `SDCAI.call('courseGenerate', {system, prompt, maxTokens, json: true, timeoutMs})` → `POST /api/ai/complete`. The prompt carries a short description of SDC Karachi and its learners, the chosen program and division, the titles of existing courses and one published course as a style example, the brief and the pasted material. JSON mode is requested from OpenAI, Azure OpenAI and Gemini (for Gemini 2.5 models thinking is switched off for this request, because thinking tokens count against the answer size and cut the outline off); the answer is checked against the fixed format in the browser. The answer size is `min(8000, 1500 + 110 × sessions)` tokens. Provider, model and temperature come from Settings → Integrations → `courseGenerate`; the model that answered is recorded on the course. Usage is counted under `courseGenerate` in the usage report and against the monthly budget. One retry adds one call.

**Demo mode.** On a developer machine, `SDC_AI_MOCK=1` (never honoured on Vercel or with `NODE_ENV=production`) lets the server answer course generation with a built-in sample outline when **no provider is configured**. Everything it produces is labelled: a "Demo mode … not written by AI" banner, "Demo sample (not AI)" on the review screen and the course (`aiMeta.mock: true`, provider `mock-demo`), and the sample's description says so. A configured provider always wins over demo mode.

### AI course content builder
Turns an existing course (usually an AI draft) into complete written teaching material, one session at a time. It never regenerates the outline: session titles, summaries and modules are not written by it, and nothing is published, enrolled, priced or assigned.

**Who and when.** Course Builder → **Content** tab, for anyone who may manage the course (`courses:edit` plus course scope). Generating needs `ai:use`, **Settings → Features → "AI course generator" on** and the AI master switch; the server checks `courses:edit` and the switch for every request (`feature: 'courseContent'`). Without them the tab still shows, reviews and edits existing content.

**What each session gets** (`session.content`, schema in `js/coursecontent-logic.js`), written in three parts, one AI request each:

The session content viewer groups its status and Repair with AI action in the top row, with equally sized Lesson, Practice and Assessment edit buttons in a separate row (stacked on narrow mobile screens).

| Part | Content |
|---|---|
| Lesson | 3–6 learning objectives, prerequisites, a time plan that adds up to the session length, 4–6 lesson sections (explanation + worked example), key terms |
| Practice | step-by-step tutorials, code examples (when the topic needs code, `codeRelevant`), live demonstrations, guided exercises with hint and solution, independent practice tasks with success criteria |
| Assessment | a homework brief with deliverables and a marking rubric (maximum = sum of the rubric), 6–8 quiz questions with the correct option and an explanation, instructor teaching notes, learning resources by name only |

Each part sees the course description, outcomes, the whole outline (to build on earlier sessions and not repeat later ones), the session length and level, the outcomes the session supports, the previous session's objectives, what was already written for the session, and the coordinator's instructions. Answer sizes: 6,000 / 7,000 / 5,000 tokens (under the 8,000 cap); JSON mode; Gemini 2.5 thinking off, Gemini 3 lowest thinking level (see Integrations, "Gemini models").

**Checks on every answer.** Unknown fields dropped; lists and texts bounded; a part missing its required content (for example fewer than 3 real lesson sections, a tutorial with fewer than 3 steps, fewer than 3 usable quiz questions) is refused and retried once; quiz items without a valid correct option are removed; links in prose are removed (the AI cannot verify them; code, `localhost` and `example.com` addresses are kept) and the number removed is recorded. Only the place a link was taken from is tidied: code written outside a code block keeps its `()` calls and its indentation. (Before this fix every `()` outside code was deleted and runs of spaces were collapsed, which damaged unfenced code such as `plt.show()`; content generated before it can be checked with a read-only audit, and is repaired only by a person.) The prompt asks for every piece of code (exercise solutions, tutorial steps, examples) inside a fenced code block, with exact indentation and the brackets of calls. A cut-off, unreadable or incomplete answer or a time-out gets one retry (a cut-off or time-out asks for the shorter version). The provider's own rate limit (`provider_busy`) is waited out as the provider asks, up to 6 times, without using the retry; the run then sends one request at a time, at least 13 s apart (remembered in the tab for an hour). Limits, budget, permissions, a missing provider or a used-up daily quota stop the run.

**Generating.** **Generate Full Course Content with AI** (header or tab) asks for confirmation, showing how many parts and requests it will make, then works on two sessions at a time (one after a rate limit), a session's parts in order. Each finished part is saved to the session immediately (normal session edit, synced through the gateway), so stopping, an error, a reload or closing the tab loses nothing finished; the button then reads **Generate missing content (n)** and only fills what is missing or out of date. Per session the row shows each part as done, writing, queued, failed (with the reason, kept after a reload) or out of date, and **Retry**, **Regenerate** (choose parts, add instructions for this run) and **View**. Progress, requests, tokens and time are shown while it runs; totals for the course (requests, failed requests, tokens, generation time, model, links removed) stay on the tab.

**Code safety** ([js/codecheck-logic.js](js/codecheck-logic.js), applied by the content builder to AI answers and to a person's edits alike; nothing is silent):
- **Valid code is not touched.** Brackets, chained calls, multi-line code and indentation are kept byte for byte, including indentation of the first line of a field. Code written outside a code block is put in a code block (language guessed from the code, the course's language only as a fallback; a common indent is removed, nothing else changes) so the viewer shows it with its indentation. A code field wrapped in a fence by the AI is unwrapped. Raw line breaks inside a JSON string and a comma before a closing bracket are repaired before parsing; nothing else about an answer is guessed.
- **Language-aware checks** on every code block (Python, JavaScript/TypeScript, JSON, SQL, CSS): unclosed or mismatched brackets, unclosed strings, a block header with no indented body, unexpected or inconsistent indentation, mixed tabs and spaces, `print "x"`; and "to confirm" findings for a call that looks like it lost its brackets (`plt.show`, `df.info`, `.then(r => r.json)`; names the same content calls elsewhere count as evidence, real attributes such as `df.shape` never do). Incomplete teaching snippets are allowed: a block with an elision marker (`...`, `# ...`) is never an error, and an indented excerpt is judged by its own structure. Nothing is rewritten to "fix" it.
- **Nothing is cut inside a line of code.** A text or code field over its limit is cut at the end of a line (code) or paragraph (prose), a cut code block is closed and flagged as an error, and every cut, dropped item and link taken out of a line that looks like code is recorded with the part (`meta.parts.<part>.cuts`).
- **One more try for code that cannot be valid.** If the checks find an error in a generated part the AI is asked once more (with the problem named); the better answer is kept and flagged if it is still wrong. A call that may have lost its brackets costs no extra request.
- **Flagged content cannot be approved.** A session with open code checks shows **Code checks to review** (list with the exact field and line), its completeness gets one extra item that is not met, and **Approve** is refused (the check is made where approval happens, not only by hiding the button). A person fixes the code with **Edit** or confirms **I have checked this code**; the confirmation covers only the findings it was made for and stops applying when they change. Regenerating a part clears the confirmation and the approval.
- **A person's edit is never cut.** Over a limit the edit is refused with the field and its limit named (nothing is saved or shortened); the editor reports how many code blocks were added and how many checks are open.
- **One Course Builder, any provider; pause and switch (Course Builder → Content, and the outline page).** Outline, full content, resume, regenerate, Repair with AI and the course check all go through one place, `AIRoute` (`js/ai-provider-ui.js`), and behave the same on OpenAI, Gemini, Azure OpenAI and Groq; nothing is built in for a provider. Each page shows **AI provider: Gemini · model (from Settings → Integrations)** with **Change provider**. A coordinator can choose any configured provider for this course (the list shows every provider: **Ready**, **Cannot be used** with the reason such as no Groq model chosen, an embedding model, a missing Azure deployment or a rejected key at the last test, or **Not set up**). That choice is *temporary*: it is kept in this browser tab only (`sessionStorage`), is labelled **Temporary choice**, and never changes Settings → Integrations; **Use the Settings choice** removes it. Every Course Builder request is sent with `noFallback`, so the server uses exactly that provider and never another one on its own, whatever the organisation's fallback setting says.
  When the provider stops the run (a used-up quota, a rejected key, an unusable or retired model, a request too large for it, no key saved, or three requests in a row with no answer), **generation pauses** instead of failing part by part. Everything already written stays saved. The **Generation paused** panel (rebuilt from the saved parts after a reload) says in words what happened ("Gemini's quota is used up", "Gemini is limiting requests right now" for a temporary limit, "OpenAI rejected the API key"), how many parts are written (and how many sessions complete) and how many are left, and offers **Switch Provider & Resume** (pick any ready provider; a confirmation says how many parts the new provider will write, that finished parts and people's edits are not touched and that Settings are not changed), **Retry <provider>** (disabled when retrying cannot help, such as a rejected key) and **Pause and Resume Later** (folds the panel into a one-line banner). Nothing is sent to another provider until the coordinator confirms. Resuming asks only for what is still missing: parts that exist, including ones a person wrote or edited while the course was paused, are not requested again, and a part someone else filled in while a request was in flight is not overwritten by the late answer (it is reported as such). A paused regenerate or Repair resumes as that regenerate or repair, not as new generation. Session expiry, a used-up platform allowance, the monthly budget and a browser that cannot store a result stop the run with their own message and offer no provider switch, since another provider would not help. Each part records the provider and model that wrote it: the Content tab says **Written by Gemini · model (30 parts in 10 sessions) · Groq · model (41 parts in 14 sessions)**, each session row and **View** say who wrote its lesson, practice and assessment, and the change history keeps the provider of every regeneration or repair.
- **Repair with AI on any field (select → proposal → compare → accept or reject → save).** Every session that has content offers **Repair with AI**: in its row in Course Builder → Content, in **View**, and next to **I have checked this code** when code checks are open. It needs permission to edit the course and the AI features, like generation. The dialog names the provider that will do the work (Settings → Integrations → AI content repair, for example Groq · openai/gpt-oss-120b), and when that provider has no key saved it shows the setup steps in red and **Write a proposal** stays disabled (`SDCAI.status()` returns only names and whether a key exists, never a key). It lists every text field of the session by part: learning objectives, prerequisites, time allocation, lesson content, key terms, tutorials, code examples, demonstrations, guided exercises, independent practice, homework brief, quiz questions (options and explanations), instructor notes and resources. **Fields with open code checks start ticked; nothing else is, and a code finding is not required**, so damage the checks cannot see (quiz options that lost their `()`, a cut-off instruction, an example output that does not match) can be repaired. The coordinator may describe what is wrong.
  **Write a proposal** sends, per part (a long field is split over requests, a cut-off answer for several fields is asked again one field at a time), the current text of the chosen fields exactly as stored, the course and session context, the session's objectives and lesson headings, the code checks found in those fields (when there are any) and the description, and tells the provider to repair only what is damaged and to keep the meaning, difficulty, order and number of items, the quiz's correct options, and everything that is already correct unchanged. The request carries `noFallback`: the server uses only the provider chosen for `contentRepair` and never another one, whatever the general fallback setting; a missing key or a failure is reported in the session's row and in **View** ("Groq could not repair this: … No other provider was tried and nothing was changed"). The answer is shaped to the schema for the requested fields only (anything else is dropped, a field the AI did not return is listed as not returned and left alone) and checked with the same code checks.
  **Nothing is written to the session.** The answer is stored as a proposal limited to the chosen fields (`content.meta.repairs.pending`, one per part; repairing other fields of the same part keeps the undecided fields of the earlier proposal, a repeat of the same fields replaces it). The session keeps its text, its approval and its code checks, and its row shows "N AI repair proposals waiting" with **Review repair**. The review window lists each field with the current text beside the AI's (removed lines red, added lines green, unchanged stretches folded), badges for what changed and the code checks before → after, and a **Keep current / Use the AI version** choice per field (default: keep). A field gets **Needs your review**, with the reasons, when the checks cannot confirm the change: code that still has errors, a field that would drop below what approval needs, a changed number of items, a changed heading or title, a quiz question whose correct option moved or whose text changed, a changed marks total, a length that changed by more than 40 %, or `[redacted]` appearing (the privacy filter replaced something before the AI saw it). **Use the AI version for all that need no extra review** never ticks those or fields changed since the AI saw them. **Apply N fields** always asks for confirmation (naming the fields to look at again, edits by a person, and the withdrawn approval) and replaces only the chosen fields; **Reject proposal** discards it. Both decisions are recorded. Applying withdraws the session's approval and the "I checked this code" confirmation (the window and the confirmation say so, and say when the course is published and learners would stop seeing the session until it is approved again). Repair never approves or publishes anything, and a passing code check or an answer from the provider is never treated as proof that the text is right.
- **Concurrent changes.** A proposal remembers a fingerprint of every field as the AI was shown it. A field that is different when a person decides (edited by hand, regenerated, or synced from another device since) is flagged **Changed since the AI saw it** and is not replaced unless the person explicitly chooses the AI version for it, after a confirmation. The check is repeated against the saved record at the moment of **Apply**, so a window left open cannot overwrite newer text (and a proposal already applied or removed elsewhere is refused). A part with a person's edits is marked; applying to it asks for confirmation. If the browser cannot store the result, the previous content is put back. Accepting needs permission to edit the course, not AI; writing a proposal needs the same rights as generation. Parts that do not exist yet are still written directly. Not covered: two people accepting the same proposal at the same moment on different devices (the whole-state save is last-write-wins, see section 12).
- **Change history and restore.** Every accepted repair, **Regenerate** over existing text, rejected proposal and restore is kept in `content.meta.history` (the last 12, newest first, bounded in size): when, who, provider and model, and the text each field had before. **View → Change history → Restore earlier text** puts it back after a confirmation; if the field changed since, the newer text is replaced only on explicit confirmation. A restore is itself an entry, so it can be undone. Restoring withdraws approval like any change of text. Cut and link notes follow the text they describe. Requests for proposals count in the usage line whether or not they are accepted.

**People's work is protected.** **View → Edit lesson / practice / assessment** opens an editor built from the schema (short lists one per line, pairs as `a | b`, longer items as repeatable groups, code kept exactly). **Time plans that do not add up**: AI models often plan 130 minutes for a 2-hour session. A generated lesson whose plan is off by up to a quarter is fitted at once without AI (minutes taken from or added to the longest teaching blocks, 5 at a time; breaks are kept), recorded on the part and shown under the plan ("the AI planned 130 minutes; fitted automatically"). For content generated before, the completeness card offers **Fit N time plans to the session length**: it lists each change, makes no AI request and saves the plans as the person's edit. A text cut at its size limit inside a code block is stored with the block closed, and the editor closes such a block before showing it, so saving never merges the following steps or notes into it. Saving records `meta.edited {by, at, parts}`. In **Regenerate**, parts a person edited start unticked; ticking one and generating needs a confirmation naming it ("Replace edits", which also says when the content is approved); regenerating approved content warns that it needs a new approval. Generation re-reads the session before saving, so edits made meanwhile in other parts are kept.

**Approval and learners.** **Approve** (only when all three parts are present and no code check is open) sets `meta.approved {by, at}`; new AI text clears it, a person's edit keeps it. Learners see a session's content only when the course is **published**, the session is unlocked for them and the content is approved; they never see the time plan, homework, quiz or instructor notes. While the course is a draft, learners cannot open it at all.

**Assessment blueprints.** Homework and quizzes stay blueprints in the session content. From **View**, a person can create a **draft** assignment (no due date, status Draft, linked to the session) or a **draft** quiz (questions added to the question bank, status draft) in a batch they choose, after a confirmation. Nothing is created without a batch, and nothing is published.

**Course check.** **Check the course with AI** (one request) reviews the outline and, once written, the session objectives and lesson headings: which sessions teach each outcome (strong / weak / missing), missing essential topics with severity, repetition, the order of concepts, up to 4 **proposed corrections** to existing sessions (the session count is fixed), and a **capstone project** (brief, requirements, deliverables, milestones per session, rubric). Nothing changes until a person acts on a proposal: **Add to content** keeps the session's title and summary and adds the proposal to the session's standing generation instructions (generated parts become out of date); **Also change title and summary** shows both versions first; **Dismiss**. Decisions are kept when the check runs again. The capstone can be edited; an edited capstone is not replaced by a later check. An AI capstone replaced by a later check is kept as the previous version (`aiContent.capstonePrev`), and **Previous version** swaps the two back without AI. Similar lesson sections, tutorials or code examples in different sessions are also listed without AI (word overlap). Stored as `course.aiContent {review, proposals, capstone}`.

**Completeness.** "N of M required items present", counted from what is stored, never estimated: per session the objectives, prerequisites, 3+ lesson sections, worked examples, a tutorial, code examples (only where the topic needs code), a demonstration, a guided exercise, a practice task, a homework brief, a quiz of 5+ answered questions, instructor notes and a time plan within 5 minutes of the session length; for the course every outcome taught, a capstone, an up-to-date course check (it goes out of date when what the check reads changes: course title and outcomes, session titles, summaries, lengths, objectives, lesson headings or instructions; edits to timings, quizzes or notes and downloading the same course again leave it current) and no open essential gap. The missing items are listed. The Overview checklist shows "Teaching content complete" for AI courses and courses that have content.



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
- **Role ceiling.** Anyone other than the built-in Coordinator can only grant what their own role has. Saving a role, assigning a role to an account and choosing the Google sign-up role need every permission of that role to be one their own role has (or one the built-in learner role has, so learner-account managers can still create learners), and course access no wider than their own ("All" needs "All"; "Selected" needs the same or more courses). Setting a new password or email on someone else's account needs the same, because it would let them sign in as that person. Only a Coordinator can delete a Coordinator account. Ordinary profile edits and deletions of other accounts follow the matrix alone. The screens show the reason; the server enforces it ([js/shared-rules.js](js/shared-rules.js)).

## 11. Settings

Everything below is changed in the UI by a coordinator, with no code changes.

| Tab | What it controls |
|---|---|
| **Branding** | Product and organisation names, tagline, square logo, full logo lockup, website, phone, email, address, footer text |
| **Appearance** | Primary, accent and highlight colours, corner radius, default light or dark theme |
| **Terminology** | The name of every term: Learner, Instructor, Coordinator, Course, Session, Module, Batch, Program, Division, Assignment, Fee, Quiz, Attempt, AI Tutor |
| **Learning** | Help URL, upload endpoint, upload size and file types, browser fallback limit, late policy, completion threshold, attendance warning threshold, result weights, grade bands, pass mark, certificate prefix, currency, program types, levels, delivery modes, fee types, feedback prompt percentage, demo-account shortcuts |
| **Features** | On/off switches for attendance, results, certificates, fees, messages, announcements, calendar, feedback, quizzes, each AI feature and the AI course generator (off by default). A switch is saved as soon as it is flipped |
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
- **Accounts and roles are checked per record**, with the same rules as the screens: a learner account needs `learners:create/edit/delete`, any other account `staff:create/edit/delete` (both when a role change moves an account between the two), and only existing roles can be assigned. Nobody can change their own role or delete their own account. Roles need `roles:create/edit/delete`; built-in roles cannot be deleted. Settings need `settings:edit`. The role ceiling (section 10) applies to roles, role assignments, other people's passwords and emails, and the Google sign-up role. Refused changes are undone and listed in `rejected`.
- Signing out clears the cached copy from the browser.
- The Supabase table is closed to the browser entirely ([supabase/gateway.sql](supabase/gateway.sql)).
- **Conflict-safe saving.** Each save is conditional (`sdc_state_put_if`, [supabase/migrations/](supabase/migrations/)): it succeeds only if nobody saved since the server read the state; otherwise the server reloads, re-applies the change and tries again (3 retries, then `503 busy` with nothing written). Two people saving at the same moment no longer overwrite each other. Until the migration is applied, saves use the old unconditional write.
- **The 14 protected collections are checked per record** against the server's copy (create, edit, delete), following the same rules as the screens. "In scope" means the record's course is one the role's course access covers:

  | Record | Create | Edit | Delete |
  |---|---|---|---|
  | Course | `courses:create` (+ `courses:publish` unless it starts as a draft) | `courses:edit`, in scope; status change also needs `courses:publish` | `courses:delete`, in scope |
  | Session | `courses:edit` on its course (in scope) | same (including the pinned AI summary and `published`) | same |
  | Batch | `batches:create`, or the first batch of a course you create in the same save | `batches:edit`, or only clearing the instructor of an account deleted in the same save | `batches:delete` |
  | Assignment | Batch workspace: `courses:edit` and the course in scope or you teach the batch | same | same, unless it has submissions |
  | Quiz | as assignments, or `quizzes:create` | as assignments, or `quizzes:edit`; publishing needs `courses:edit` or `quizzes:publish` | as assignments, or `quizzes:delete` |
  | Quiz attempt | Learner: own attempt at a published quiz of their batch, within the attempt limit; **the score is recomputed on the server** from the answer key (short-answer points capped at the question's points) | Instructor review: as a quiz edit; answers, learner and quiz cannot change | Coordinator only |
  | Submission | Learner: own upload for a published assignment of their batch, no marks, not when late work is closed; past due in every time zone it is saved as `Late` | Learner: replace own upload until graded (history kept); grader: `submissions:edit` in scope, marks 0 to the assignment maximum | Coordinator only |
  | Attendance | `attendance:edit`, in scope | same | Coordinator only |
  | Result | `results:edit`, in scope | same | Coordinator only |
  | Progress | Learner: own, enrolled course, only that course's sessions | same | Coordinator only |
  | Feedback | Learner: own rating 1 to 5, enrolled course | Coordinator only | `feedback:delete`, in scope |
  | Certificate | `certificates:create`; a code already taken gets the next free number; issued by you | `certificates:edit`: status and revocation only (code, learner, course and grade stay) | Coordinator only |
  | Fee | `fees:create`, or the course fee created while enrolling (`enrollments:create`, pending, course price) | `fees:edit` | `fees:delete` |
  | Enrollment | `enrollments:create`, one per learner and course | `enrollments:edit` | `enrollments:delete` |

  Enrollments, fees and certificates are organisation-wide on their screens, so they have no course scope. A learner's own records need an active enrollment in a published course. Deletions that are part of a cascade need no separate permission (see below). Scope is taken from the stored state, so nobody can widen their own scope in the same save (it matches `Domain.visibleCourses`, including published courses an enrolled-scope role is enrolled in). Changes that fail a check are undone record by record and listed in `rejected`; the rest of the save is kept.
- **Sync base.** The browser keeps, inside its copy of the state (`_sync`, never stored on the server), the id and a content hash of every record of the 14 protected collections it last received from or saved to the server. Because it travels with the copy, two tabs sharing `localStorage` never mix up each other's base. Each save sends `base.known` (those ids) and `base.fresh` (the ones it has not changed since).
- **Deletion needs proof.** A record missing from a save is deleted only if its id is in `base.known`. A stale tab, a browser still running an older app version, or a copy that never saw a record (for example a course someone else just created) can therefore never delete it. A deletion from such a browser is ignored and the record reappears after the next download.
- **Stale copies do not overwrite.** A record listed in `base.fresh` that differs from the server's copy is out of date, so the server keeps its own version; one the server no longer has was deleted by someone else and is not brought back. Edits to the same record by two people are still last-write-wins, and browsers without `base` (older app versions) keep the old last-write-wins behaviour for edits.
- **A change is local, saved or failed, and the app says which.** `SDCCloud.status()` (js/cloud-sync.js) reports `saved` (the server answered the save; only then is the pending marker removed), `saving`, `local` (kept in this browser, the server has not confirmed it yet), `failed` (no connection or the server refused it; retried after 3, 10, 30, 60 and 120 s, at once when the browser comes back online, and by **Try now**), `auth` (the sign-in expired), `storage` (the browser cannot store) and `off` (cloud sync is off: "This device only", never "saved"). The top bar shows a chip (Saved / Saving… / Not saved yet / Not saved / Sign in again / Storage full), and a bar at the top of the page appears whenever work could be lost. A save without a sign-in, or one the server did not answer, never clears the pending marker (before this it did, which is how a save after the token expired disappeared).
- **When the sign-in expires** (a token lasts 12 hours, 30 days with "Keep me signed in"): the server answers 401 `auth_expired`. The app no longer signs out. The copy and the pending marker stay, the unsent changes are also set aside under the account (`sdcRescue:<userId>`: only the records changed since the server last confirmed them, with the hash each had then), the red bar says "Your sign-in expired. Your latest changes are kept on this device but are not saved to the server" with **Sign in again** and **Download unsaved changes**, and further edits go on being kept. Other tabs of the same browser show the same bar. A reload keeps all of it.
- **Signing in again replays the work onto the server's current copy.** Only the same account gets its work back. The server's copy is downloaded first; then each set-aside record is compared with it by content hash (key order ignored, because the database reorders keys): if the server still has the record as it was when this browser last saw it, the change is applied; if it already has the same record, nothing is done; if the server's record changed or was deleted meanwhile (or a different record took the same id), the **server's version stays** and the person's version is kept as a conflict. Nothing newer on the server is ever overwritten by a stale change. The recovered changes are pending until the server confirms them (the normal save, with `base.known`/`base.fresh` and the conditional write), and the set-aside copy is removed once they are saved. Conflicts are listed in the bar (**Review**): **Keep the server's** or **Use mine** (or **Delete it anyway**) per item; only an explicit choice overwrites. A different account signing in on the same browser neither receives nor sees them (they wait for their owner), and a copy of an older app version (order-sensitive hashes, no `_v`) is recovered too. If the set-aside copy cannot be stored (browser full), the sign-in is refused with **Download unsaved changes** / **Discard them and continue**; nothing is discarded silently.
- **Signing out with unsent changes** (`logout()`) sets them aside first. If that fails, a copy is downloaded and the person confirms before they are discarded. Signing out always clears the copy, so the next person on the computer sees nothing; the set-aside records stay for their owner only.
- **Several tabs.** Tabs of one browser take turns pushing (Web Locks), so a change is sent once and a tab never sends an old in-memory copy over a newer one another tab stored; the expiry bar and the end of an expiry (another tab signed in again) reach every tab through `storage` events.
- **Browser storage.** Everything lives in one `localStorage` value of about 5 million characters per site (a browser limit; measured as characters). The whole state is also sent to the server in one request and Vercel rejects requests over 4.5 MB, so the working limit is 4.3 million characters (`STATE_MAX` in `js/core.js`): every meter and check below uses it, and `persist()` refuses a save that would grow the data past it (saves that shrink it still go through, so drafts can be deleted). A 48-session AI course is about 1.4 MB of text and at most about 3.4 MB when every answer is at its size limit, so one very large course or a few large ones can reach it. Safeguards: `SDCCloud.usage()` (Settings → Storage shows it); a warning bar at 80 % with **Download a backup**; the content builder checks the room before it spends AI requests and asks first if the run may not fit; a write the browser refuses is never hidden (the toast says the change was **not** stored, the status turns to `storage`, the bar offers **Save to the server**, which sends the in-memory copy, and **Download a backup**, and closing the tab asks first); a run stops at the first part that cannot be stored, so no more AI requests are spent, and the text is kept in memory for **Save to the server**; the change is rolled back where the caller can (accepting a repair, creating a draft). If even the pending marker cannot be stored, it is kept in memory and sent. **Not solved:** the state is still one JSON value in `localStorage`; moving large content to IndexedDB or loading it from the server on demand would remove the limit but is a storage redesign that was not done (it needs approval and a migration).
- **Concurrent edits to the same record by two people online** are still last write wins (see above); the replay after an expired sign-in is stricter, as described.
- **Cascades.** These deletions remove their related records without a separate permission or proof for each:
  - a course: its sessions, batches, assignments, submissions, attendance, enrollments, progress, results, feedback, quizzes and quiz attempts;
  - a session: its attendance (assignments lose the link);
  - a batch: its assignments, quizzes and their attempts;
  - an enrollment: that learner's progress in the course;
  - an account: that learner's enrollments, progress, submissions, attendance, results, certificates and feedback.

  When the deletion is refused or not proven, the related records the save removed with it are put back.
- **Not protected yet:** programs, divisions, announcements, messages, notifications, question banks and questions, practice attempts, rubrics and at-risk flags are still saved as a whole, so a hand-made request from any signed-in user can change them (section 21).
- When the server kept or undid something, it answers `resync: true` and the browser downloads the server copy (unless the user changed more meanwhile); if that download fails, the next regular download still takes it. The saved time stamp is the server's `updatedAt` in microseconds, so pull decisions compare server versions exactly. Backup restore and "Reset to demo data" keep the current sync base, so their save replaces what the old copy had.

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
| `GET /api/sdc/status` | `{gateway, safeWrite}`: whether gateway mode is on and whether conflict-safe saving (`sdc_state_put_if`) is installed |
| `POST /api/sdc/login` | Email and password sign-in (gateway) |
| `POST /api/sdc/google` | Google sign-in (gateway) |
| `GET /api/sdc/state` · `PUT /api/sdc/state` | Read and save the shared state (gateway). `PUT` takes `{state, base:{known, fresh}}` and may answer `rejected` and `resync` (section 12) |
| `POST /api/sdc/courses/ai-draft` | Save an AI course draft `{genId, outline}` as a draft course with sessions (and the creator's first batch). Needs `courses:create`, `features.courseGen` explicitly on and `safeWrite`. Body also carries `meta: {provider, model, mock}` (labels, strings only, clipped) and the outline carries `level`, `programType`, `delivery`, `programId`, `divisionId`, `hoursPerSession`, `code`, `icon`, and per-session `refs`. Same `genId` = same course (`alreadyCommitted:true`), never a duplicate. Text over its limit is refused (`limits`), never cut. Program and division are kept only for all-courses coordinators and only if they exist. Codes: `bad_request`, `limits` (12 modules / 48 sessions / text limits), `forbidden`, `disabled`, `slug_in_use`, `id_conflict`, `safe_save_unavailable`, `busy`. Used by the generator page (section 9) |
| `GET /api/sdc/courses/ai-draft/:genId` | Was this draft saved? `{committed, courseId}`. Creator or admin only |
| `GET /api/sdc/verify?code=` | Public certificate check |
| `GET /api/sdc/public` | Branding for the sign-in page |
| `GET /api/ai/status` | AI providers, usage and configuration status |
| `POST /api/ai/auth` | Local AI token for development without the gateway |
| `POST /api/ai/configure` | Add, update or remove an AI provider profile |
| `POST /api/ai/test` | Test an AI provider connection |
| `POST /api/ai/models` | Groq only: the models a saved or pasted Groq key can use (`{models: [{id, ownedBy, contextWindow, maxOutput}], other}`), from Groq's Models API. Needs `ai → configure` or `settings → edit` |
| `POST /api/ai/videos` | YouTube videos for the Course Builder: `{feature: 'courseGenerate' \| 'courseContent', queries: [phrase]}` (1 to 48 phrases) → `{source, results: [[{id, title, channel, duration}] \| null], failed, stopped?}`. Same permission and switch checks as the matching `/api/ai/complete` feature; not counted against the AI call budget. Errors: `not_configured` (no key), `provider_quota`, `provider_auth` |
| `POST /api/ai/youtube` | Save (`{apiKey}`), test (`{test: true}`) or remove (`{remove: true}`) the YouTube Data API key. Needs `ai → configure` or `settings → edit`; the key is never returned |
| `POST /api/ai/complete` | Run an AI capability. `feature: 'courseGenerate'` additionally needs `courses:create`, and `feature: 'courseContent'` / `'contentRepair'` (the content builder) `courses:edit`; all need `features.courseGen` explicitly on (checked on the server). Optional `json: true` (JSON mode), `schema` (Structured Outputs on Groq), `noFallback: true` (use only the provider asked for: Repair with AI; a missing key is `not_configured` naming the provider) and `maxTokens` (capped at 8,000). The answer carries `truncated`, `ms` and, for Gemini and Groq, `usage {input, output[, thinking]}`; errors carry `code` (section 9, AI safeguards). With `SDC_AI_MOCK=1` and no provider, course generation answers with a labelled sample (`mock: true`) |
| `POST /api/lms/uploads` | Upload a file |
| `GET /api/lms/upload-config` | Upload limits and storage type |
| `GET /uploads/<file>` | Download a stored file |
| `GET /api/neon/health` | Neon connection status |

The server also contains a legacy JSON API (`/api/auth/login`, per-collection CRUD, `/api/dashboard/summary`, `/api/admin/export`) and passkey endpoints (`/api/auth/passkey/*`). The current UI does not use them.

## 15. Security

- Passwords are stored only as salted, iterated SHA-256 hashes.
- In gateway mode, sign-in and state changes are enforced on the server (section 12). That covers accounts, roles, settings and the 14 protected collections, including grades, payments and certificates. Nobody but the Coordinator can grant more than their own role has (section 10).
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
| `/manage/courses` | Course list (with the "Generate with SDC Learn AI" button when allowed) |
| `/manage/courses/generate` | AI course generator (brief → outline → review) |
| `/manage/course/:id` | Course builder (`?tab=` overview, sessions, content, batches or learners; `?tab=content&start=1` opens the "Generate Full Course Content" confirmation, `&session=<id>` opens that session's content) |
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
| `courses` | Course blueprints: details, outcomes, modules, Zoom, help URL. No instructor field. `aiContent` holds the course check, proposals and capstone of the content builder |
| `sessions` | Sessions of a course: schedule, recording, resources; `content` holds AI-built teaching material (section 9, "AI course content builder") |
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
| Logic tests | `npm test` | Permissions, course scoping, grading, gateway merge rules, AI helpers, local-development safety, the per-record guard, server permissions for the 14 protected collections and the role ceiling ([tests/access.test.js](tests/access.test.js)), the AI connection and the course generator rules ([tests/coursegen.test.js](tests/coursegen.test.js)), the course content builder rules and what learners see ([tests/coursecontent.test.js](tests/coursecontent.test.js)), the generator at 8, 24 and 48 sessions with the real generation runner, failures, an interruption and the resume ([tests/coursescale.test.js](tests/coursescale.test.js)), YouTube session videos: search, filters, picking, cache, quota and key errors ([tests/videos.test.js](tests/videos.test.js)), browser sync (sync base, server versions, resync, tabs sharing storage), account and role rules, and 26 safe-write scenarios through the real server code on an in-memory database |
| Database tests | `npm run test:db` | The migrations on local PostgreSQL: fresh database, production-shaped database with LMS data (nothing changed), concurrent transactions, failed writes, grants, rollback, two 48-session AI courses with full content (about 4.8 MB of state) and five concurrent saves of one version (one accepted, the others refused, reloaded and saved, nothing lost), and the same 26 scenarios. Needs the local cluster ([SETUP.md](SETUP.md#5c-local-postgresql-development-and-database-tests)) |
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
  seed.js → cloud-config.js → migrations.js → coursegen-logic.js → shared-rules.js → core.js → ai-client.js
  → cloud-sync.js → shell.js → pages-learn / manage / users / ops / ai

  pages-*.js ──► core.js (db, saveDB, can, Domain) ──► localStorage "sdcLearnDB_v1"
       │                    │
       │                    └─► cloud-sync.js ──► /api/sdc/*  (gateway mode)
       │                                     └──► Supabase row (direct mode)
       ├─► ai-client.js (SDCAI) ──► /api/ai/*
       └─► uploadFile() ──► /api/lms/uploads

Server (backend/server.js, also the Vercel function via api/index.js)
  state-api.js  /api/sdc/*  ──► Supabase functions sdc_state_get / sdc_state_put_if (sdc_state_put until migrated)
  ai-api.js     /api/ai/*   ──► OpenAI / Gemini / Azure OpenAI / Groq
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
4. The push sends the whole state to `PUT /api/sdc/state` (gateway) or upserts the Supabase row (direct mode). If `/api/sdc/status` cannot be reached or gives no valid answer, the mode is `offline`: nothing is written to the cloud, changes stay pending on the device and are retried once the server answers. Outside production, [backend/dev-safety.js](backend/dev-safety.js) makes `/js/cloud-config.js` serve `{enabled:false}` (or a non-live project from `SUPABASE_URL`), so local development never touches the live row.
5. In gateway mode the server merges the change against the stored state: it keeps password hashes the browser never had, and undoes changes to accounts, roles or settings that the signed-in user is not permitted to make. Accounts, roles and the 14 protected collections are checked record by record, deletions need proof, and unchanged stale copies never overwrite newer records (`base.known`, `base.fresh`, section 12). The 14 are: courses, sessions, batches, enrollments, assignments, quizzes, quiz attempts, submissions, attendance, progress, results, feedback, certificates and fees. The save is conditional: if someone else saved first, the server reloads and re-applies the change.
6. If the push fails, the change stays pending and is sent on the next pull.

### Submitting and grading an assignment
1. The learner picks an assignment on `/course/:id/submit` and drops a file.
2. The browser checks the account email, file type, size and deadline.
3. The file goes to `POST /api/lms/uploads`. The server validates it again, stores it under a random name and returns its URL.
4. A `submissions` record is saved (the earlier file moves to `history`) and the instructor of the assignment's batch receives a notification. In gateway mode the server accepts it only as the learner's own, unmarked upload for a published assignment of their batch.
5. The instructor opens `/submissions`, clicks **Grade**, optionally asks for an AI draft, then saves marks and feedback.
6. The submission becomes `Graded`, the learner is notified, and the grade feeds the assignment average in results.

### Calling SDC Learn AI
1. A page calls `SDCAI.call(feature, …)` in [js/ai-client.js](js/ai-client.js).
2. The client checks the AI master switch and the `ai` permission, then looks up the provider, model and temperature for that capability in Settings → Integrations.
3. It sends the request to `POST /api/ai/complete` with the gateway session token. In local development without the gateway it first gets a token from `POST /api/ai/auth`.
4. The server verifies the token, checks the user's permission and the AI switches, applies the hourly rate limit and the monthly budget.
5. The prompt is scrubbed of personal data.
6. The server calls the capability's provider. If it fails, it tries the fallback provider, then the primary, then any other provider that has a key (OpenAI, Gemini, Azure OpenAI; Groq only where chosen). With fallback "None" only the capability's own provider is tried.
7. Usage (calls, tokens, feature) is recorded and the text is returned to the page.

### Generating a course with AI
1. On Manage Courses the coordinator opens **Generate with SDC Learn AI** (`#/manage/courses/generate`). The page re-checks the four conditions (section 9) and restores an unfinished draft from `sessionStorage` if there is one.
2. The brief is validated on the form (`CourseGenLogic.briefCheck`); a total above 48 sessions or 12,000 characters of source material cannot be submitted.
3. `CourseGenLogic.generate` builds the prompt and calls `SDCAI.call('courseGenerate', …)` (JSON mode, answer size from the session count, 58 s client timeout). The server checks permission and the switch, applies the rate limit and budget, scrubs personal data, calls the provider and returns text, model and `truncated`.
4. The answer is read, normalised and checked (fix / mark / refuse). A broken or cut-off answer is retried once. The outline appears for editing; every edit saves the draft in `sessionStorage` and refreshes the warnings.
5. On **Create draft course** the page flushes pending saves and sends `POST /api/sdc/courses/ai-draft` with the generation id. The server checks `courses:create` and the switch, builds the records with deterministic ids and saves them in one conditional write.
6. The returned records are put into the browser state in one step (so a background sync cannot undo them), the draft is cleared and the Course Builder opens on the new draft course. The normal sync then sends the same records with the same ids, so nothing is duplicated.

### Building course content with AI
1. In the Course Builder the coordinator opens **Content** (or **Generate Full Course Content with AI** in the header). Optionally **Check the course with AI** first: missing topics and proposals appear; nothing changes until a proposal is applied.
2. **Generate** lists the missing or out-of-date parts and asks for confirmation. `TCRun` (`js/pages-coursecontent.js`) works through them, two sessions at a time.
3. For each part `CourseContentLogic.generatePart` builds the prompt and calls `AIRoute.call(courseId, 'courseContent', {json: true, …})`, which is `SDCAI.call` with the course's provider (the temporary choice, else Settings') and `noFallback`. The server checks `courses:edit` and the switch, then rate limit, budget, PII scrubbing, provider call. A provider rate limit comes back as `provider_busy` with the wait; the page waits and slows down.
4. The answer is checked against the schema; the part is merged into a fresh copy of the session's `content` and saved with `updateRecord` (whole-state save through the gateway, where the per-record guard checks the session edit). Failures are saved too, with the reason.
5. A person reviews (**View**), edits, regenerates or approves each session, applies or dismisses course-check proposals, and later turns blueprints into draft batch work. Learners see approved content once the course is published.

### Taking a quiz
1. An instructor builds a quiz in the batch workspace and publishes it.
2. The learner opens `/course/:id/quizzes`, which lists only their batch's published quizzes.
3. On submit, objective questions are scored in the browser. Short answers are sent to AI for a suggested score when AI is on; otherwise they are marked pending.
4. A `quizAttempts` record is saved with the score and percentage. In gateway mode the server checks the attempt limit and recomputes the score from the stored answer key ([js/shared-rules.js](js/shared-rules.js)), so a changed score in the request is not kept.
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
- Any signed-in user receives the full state except other users' password hashes (including quiz answer keys). Per-role filtering of what is downloaded is not implemented.
- In gateway mode, the server checks accounts, roles, settings and the 14 protected collections. Programs, divisions, announcements, messages, notifications, question banks and questions, practice attempts, rubrics and at-risk flags are not checked yet, so a hand-made request from any signed-in user can change them.
- AI short-answer quiz points are suggested in the learner's browser and capped on the server, not re-checked there.
- When two people edit the **same** record at the same time, the later save wins.
- Deadlines and the "mark attendance only on the day" rule are checked in the browser. The server only refuses a submission when it is past due in every time zone.
- On Vercel, uploads are limited to 4.5 MB and need Vercel Blob to persist.
- The AI rate limit is held in memory per server instance, so it is approximate on serverless hosting.
- The summarizer works from the resource title and session summary. It does not read the resource file itself.
- AI responses are English only.
- **AI course generator (Release 1).** The outline is one AI request; the facts in it are not checked, so the reviewer stays responsible for correctness. Session summaries are one line (detailed session content now comes from the content builder); dates and class days and the Sessions-tab button are not built. The generator needs the shared-data gateway and the `sdc_state_put_if` database function; without them it refuses to save (fail closed) and says so. Progress through a reload is kept per browser tab (`sessionStorage`), not across devices. Demo mode produces a fixed sample, not AI output.
- **Switching provider.** The temporary provider choice lives in one browser tab; another tab or another coordinator uses Settings' provider until they choose too. A provider's quota is only known when a request is refused, so the panel appears after the first refusal (it costs no tokens). A pause that happened in a regenerate or repair is remembered only while the page stays open; after a reload the Content tab shows the parts still missing and the failure message on the session.
- **AI course content builder.** Facts, code and quiz answers are not verified by the platform: a person must review each session before approving it (an ambiguous quiz question or a time plan that overruns is possible and is not always caught). Resources are named without links and may not exist. A run lives in the open app: closing the tab stops it (finished parts are kept; "Generate missing content" continues). A free provider plan limits how much can be generated per minute and per day; with Gemini's free tier for gemini-2.5-flash (20 requests a day) one 8-session course (24 parts plus the course check) does not fit in one day. Parts written at different times may come from different models (the model is recorded per part); in a test, `gemini-3.5-flash-lite` wrote shorter material than 2.5 Flash (fewer exercises and code examples), so it needs closer review. Like all course data, the content travels in the shared state, so it is hidden from learners in the app but readable by any signed-in user who inspects the raw state (an existing limitation of the single-state design). Each session's content is about 30–40 KB, which counts against the browser's storage for the whole state. No video, slides or audio. **Groq** was tested only with stubbed answers; real models differ in context size, answer limit, JSON support and free-plan limits (a per-minute token limit can be lower than one content part needs, which shows as `provider_too_large`), so test the chosen model with **Test** and one session before a full run. The Groq model list does not say which models support Structured Outputs; the server tries and falls back to JSON mode.

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
│   ├── coursegen-logic.js
│   ├── shared-rules.js
│   ├── core.js
│   ├── ai-client.js
│   ├── aiprovider-logic.js
│   ├── ai-provider-ui.js
│   ├── sync-recover.js
│   ├── cloud-sync.js
│   ├── sync-ui.js
│   ├── shell.js
│   ├── pages-learn.js
│   ├── pages-manage.js
│   ├── pages-users.js
│   ├── pages-ops.js
│   ├── pages-ai.js
│   ├── pages-coursegen.js
│   └── login.js
├── backend/                The Express server
│   ├── server.js
│   ├── state-api.js
│   ├── ai-api.js
│   ├── data/               database.json (legacy), ai-secrets.json and ai-usage.json (local, not in git)
│   └── uploads/            Uploaded files on disk (not in git)
├── api/
│   └── index.js            Vercel entry: re-exports the Express app
├── supabase/               SQL to run in Supabase or Neon, versioned migrations/, rollback/, local/, security notes
├── scripts/localdb/        Local PostgreSQL tools for development and database tests (never deployed)
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
| [js/coursegen-logic.js](js/coursegen-logic.js) | 346 | `CourseGenLogic`: AI course draft limits (12 modules / 48 sessions), outline validation, ids derived from the generation id, and the allow-listed course, session and batch records. Loaded by the browser and by the server |
| [js/coursecontent-logic.js](js/coursecontent-logic.js) | 1176 | `CourseContentLogic`: the session content schema, prompts for the three parts and the course check, answer checking (bounds, link removal, required content), retries and provider waits, merging parts with people's edits, completeness counts, duplicate detection, blueprints to draft assignments and quizzes. Loaded by the browser and the tests |
| [js/shared-rules.js](js/shared-rules.js) | 60 | `SharedRules`: quiz scoring (`scoreObjective`, `gradeAttempt`) and the role ceiling (`covers`). Loaded by the browser and by the server, so both decide the same way |
| [js/core.js](js/core.js) | 880 | The platform layer: store (`db`, `saveDB`, `addRecord`, `updateRecord`, `deleteRecord`, `findRecord`), `DEFAULT_SETTINGS`, terminology `t()`, feature switches `feature()`, `PERMISSIONS` and `can()`, password hashing and `login()`, the `Domain` rules (visible courses, batches, progress, results, at-risk), notifications, formatting helpers, icons and the UI kit (toast, modal, confirm, form builder, data table, dropzone, upload, CSV, print) |
| [js/ai-client.js](js/ai-client.js) | 82 | `SDCAI`: browser client for `/api/ai/*`. Picks the provider and model for a capability (or the `route` a page passes for one request) and sends the request with the session token |
| [js/aiprovider-logic.js](js/aiprovider-logic.js) | 127 | `AIProviderLogic`: the same words for every provider's failure, which providers can take over and why not, the pause found in saved content, who wrote what |
| [js/ai-provider-ui.js](js/ai-provider-ui.js) | 120 | `AIRoute`: the Course Builder's temporary provider choice, `AIRoute.call` (every Course Builder request) and the provider picker |
| [js/cloud-sync.js](js/cloud-sync.js) | 385 | `SDCCloud`: detects gateway or direct mode (fails closed to offline when the status call fails), pulls the shared state, pushes changes (debounced, serialised across tabs) with the sync base stored in the copy (`base.known`, `base.fresh`), compares server versions in microseconds, takes the server copy after `resync`, the save status (`status()`: saved / saving / local / failed / auth / storage / off), retries, 401 handling (keeps the copy and the pending marker, sets the unsent changes aside), sign-in that replays them for the same account, conflicts, sign-out that keeps them, the storage meter, and the AI draft calls (`aiDraft`, `aiDraftStatus`, `safeWrite`) |
| [js/sync-recover.js](js/sync-recover.js) | 115 | `SyncRecover`: pure logic. Order-independent record hashes, the sync base (`baseOf`), what a copy changed since (`delta`), replay onto the server's copy with conflicts (`apply`), `useMine`. Loaded before `cloud-sync.js`; also run by the tests |
| [js/sync-ui.js](js/sync-ui.js) | 107 | `SDCSyncUI`: the status chip, the warning bar (sign-in expired, not reaching the server, storage full, storage 80 % full, conflicts), the conflicts dialog, backup and unsaved-changes downloads, and the "restored" message after signing in again |
| [js/shell.js](js/shell.js) | 247 | `App`: route registry (`App.route`), access check (`App.allowed`), permission-filtered sidebar, top bar, notifications bell, breadcrumbs, page context |
| [js/pages-learn.js](js/pages-learn.js) | 446 | Learner pages: My Courses, course home, session page, outline, submit assignment, my assignments, calendar |
| [js/pages-manage.js](js/pages-manage.js) | 617 | The generic list-and-form page (`crudPage`), course list, course builder (overview, sessions, batches, learners), batch workspace (assignments, quizzes, learners, copy from another batch), enrollments, programs, divisions, batches |
| [js/pages-users.js](js/pages-users.js) | 158 | Learner, instructor and all-user accounts; roles and the permission matrix |
| [js/pages-ops.js](js/pages-ops.js) | 807 | Dashboards, at-risk panel, submissions and grading (with AI draft), attendance, results, certificates, fees, announcements, messages, notifications, reports, feedback, settings (all tabs, including Integrations) and profile |
| [js/pages-ai.js](js/pages-ai.js) | 411 | AI drawer, tutor, resource summarizer, practice quizzes, graded quiz list and player, quiz editor, attempts review, AI quiz generation |
| [js/pages-coursegen.js](js/pages-coursegen.js) | 402 | The AI course generator: `courseGenAllowed()`, the route `#/manage/courses/generate`, brief form, outline editor, review, save and recovery, draft restore |
| [js/pages-coursecontent.js](js/pages-coursecontent.js) | 965 | The AI course content builder: Course Builder → Content tab (`builderContent`), the generation runner (`TCRun`), course check and proposals, completeness, content view, editor, regenerate and capstone dialogs, and `tcSessionBlock` used by the session page |
| [js/login.js](js/login.js) | 164 | Sign-in page logic. Loaded only by `login.html` |

### Styles

| File | Lines | What it contains |
|---|---|---|
| [css/app.css](css/app.css) | 885 | Colour and spacing tokens, light and dark themes, every component, responsive rules, the sign-in page and print styles |

### Server (`backend/` and `api/`)

| File | Lines | What it contains |
|---|---|---|
| [backend/server.js](backend/server.js) | 189 | The Express app: serves the static pages, validates and stores uploads (`/api/lms/uploads`, `/uploads/*`), health checks, and mounts the two routers below. Also holds the unused legacy JSON API and passkey endpoints |
| [backend/state-api.js](backend/state-api.js) | 612 | The state gateway `/api/sdc/*`: sign-in, Google sign-in, read and save the shared state with merge rules, conditional saves with conflict retries (`commit`), the per-record account, role, course, session and batch guard, AI draft save and status, public certificate check, public branding |
| [backend/ai-api.js](backend/ai-api.js) | 397 | The AI proxy `/api/ai/*`: encrypted provider profiles, permission checks, rate limit, budget, PII scrubbing, provider calls with fallback, usage tracking |
| [backend/data/database.json](backend/data/database.json) | | Data for the legacy JSON API only. The current UI does not use it |
| [api/index.js](api/index.js) | 3 | Vercel serverless entry. Re-exports the Express app |

### Database scripts (`supabase/`)

| File | Purpose |
|---|---|
| [supabase/schema.sql](supabase/schema.sql) | Creates the `sdc_learn_state` table that holds the single shared state row (direct sync mode) |
| [supabase/gateway.sql](supabase/gateway.sql) | Locks that table behind the server: only the gateway can read and write it, through two functions |
| [supabase/migrations/](supabase/migrations/) | Versioned migrations: the baseline (what the two files above created; not run on production) and `sdc_state_put_if` (conflict-safe save). Procedure in [supabase/MIGRATIONS.md](supabase/MIGRATIONS.md) |
| [supabase/rollback/](supabase/rollback/), [supabase/local/roles.sql](supabase/local/roles.sql) | Rollback per migration; Supabase role names for local PostgreSQL only |
| [supabase/NEON_STATE_SCHEMA.sql](supabase/NEON_STATE_SCHEMA.sql) | Optional Neon table for the server's legacy state |
| [supabase/PRODUCTION_SECURITY_NOTES.md](supabase/PRODUCTION_SECURITY_NOTES.md) | Security checklist for a public deployment |

### Tests (`tests/`)

| File | Runs with | Covers |
|---|---|---|
| [tests/core.test.js](tests/core.test.js) | `npm test` | Permissions, course scoping, batches, grading, state migrations |
| [tests/gateway.test.js](tests/gateway.test.js) | `npm test` | Server password hashing matches the browser; account, role, course, session and batch rules; stale copies; related records |
| [tests/access.test.js](tests/access.test.js) | `npm test` | Server permissions for the 14 protected collections (learner, instructor and office roles, allowed and refused), cascades, deletion proof, stale copies, quiz scoring on the server, certificate codes, the role ceiling |
| [tests/ai.test.js](tests/ai.test.js) | `npm test` | PII scrubbing, key masking, quiz scoring |
| [tests/coursegen.test.js](tests/coursegen.test.js) | `npm test` | AI course generation: brief limits, answer reading, fix/mark/refuse rules, retry rules, outline editing, saved records, demo outline; the AI connection (JSON mode, stop reason, answer-size cap, deadline and fallback, error codes, demo mode) with stubbed providers |
| [tests/coursescale.test.js](tests/coursescale.test.js) | `npm test` | The AI course generator at 8, 24 and 48 sessions, simulated: outline, draft records, all content through the real runner (`TCRun`) with a stub AI that fails on purpose (busy, cut-off, unreadable, time-out, server error), a stop and the resume (only missing parts, nothing generated twice, a person's edit kept, at most two requests at once), completeness, the course check, stored size, a used-up daily quota and full browser storage |
| [tests/codecheck.test.js](tests/codecheck.test.js) | `npm test` | Code safety: valid Python / JavaScript / JSON / SQL / CSS gets no finding, broken code does, incomplete snippets are allowed, brackets that went missing are found, fences are only added around code (idempotent, nothing lost, prose and lists untouched) |
| [tests/codesafe.test.js](tests/codesafe.test.js) | `npm test` | Generated Python and JavaScript through the whole pipeline: the normalizer, limits and cuts, JSON repair, the extra try, flagged content that cannot be approved, a person's edits, links, and the real browser runner (generate, store, reload, render for staff and learners, resume) |
| [tests/groq.test.js](tests/groq.test.js) | `npm test` | Groq with stubbed answers: model list, JSON mode and Structured Outputs, answer and context limits, parameters Groq rejects, JSON validation failures, rate limits, daily quota, size, busy, rejected key, time-out, usage per provider; Settings routes (save, models, test, update, remove, key never returned); fallback rules (Groq never an automatic extra, "None"); capability inheritance; and a Python course that runs out of Gemini quota, is switched to Groq, resumes with only the missing parts (earlier parts and a person's edit unchanged) and is repaired with AI |
| [tests/repair.test.js](tests/repair.test.js) | `npm test` | The repair workflow rules: a proposal never touches the content, field-by-field changes and code-check counts, accepting some fields and rejecting others, approval and confirmation withdrawn, concurrent edits flagged and refused unless forced, removal and addition of fields, history bounds, restore (also of a restore, partial, with conflicts), Regenerate recorded, cut notes follow the text, line comparison and aligned columns. The end-to-end run with the real runner (a person edits while the AI works) is in groq.test.js. |
| [tests/fieldrepair.test.js](tests/fieldrepair.test.js) | `npm test` | Repair with AI on chosen fields: a repair with no automatic finding (quiz options that lost `()`), what the provider is shown, proposals limited to the chosen fields, Before/After rows, partial acceptance, approval withdrawn, history and restore, a field edited meanwhile (refused unless forced) and edits elsewhere kept, the "Needs your review" reasons, Python indentation repair, failures (no retry for a missing key or used-up quota), cut-off answers split per field, request sizes, carried-over proposals, and the real runner, client and server with Groq stubbed: only Groq is called although the general fallback is Gemini, a failure and a missing key are reported with nothing sent elsewhere, a browser that cannot store the proposal stops the run |
| [tests/providerswitch.test.js](tests/providerswitch.test.js) | `npm test` | One Course Builder, four providers (each stubbed in its own wire format): the same error words and result shape for OpenAI, Gemini, Azure OpenAI and Groq, models that do not write text, JSON-mode fallback, the course-content hourly allowance; the identical outline, full-content, regenerate and Repair with AI workflow on each provider; a 12-session course whose Gemini quota runs out at 10 parts, pauses, is switched to Groq in the Course Builder and writes only the remaining parts (a person's edit and the finished parts untouched, no part requested twice, Settings unchanged, the organisation's Groq fallback not used on its own), the same after a reload, the reverse direction, Retry, a temporary limit, a rejected key, an unusable model, a provider that stops answering, a stopped repair resumed as a repair, session expiry, a browser that cannot store, and a part written by someone else while a request was in flight |
| [tests/coursecontent.test.js](tests/coursecontent.test.js) | `npm test` | AI course content builder: schema checks, link removal (code outside a code block kept), durations, prompts, retries and provider waits, merging parts with people's edits, approval, completeness, course check and proposals, duplicate detection, blueprints, and what learners see (the real page code in a sandbox) |
| [tests/devsafety.test.js](tests/devsafety.test.js) | `npm test` | Local development never reaches the live project; offline fallback |
| [tests/cloudsync.test.js](tests/cloudsync.test.js) | `npm test` | Browser sync: sync base, tabs sharing storage, server versions, resync after a failed download, AI draft calls |
| [tests/syncrecover.test.js](tests/syncrecover.test.js) | `npm test` | The data-loss bug found in QA and its fix: the replay logic (order-independent hashes, changes, conflicts, idempotence, older copies) and the real `core.js` + `cloud-sync.js` in browser tabs against a gateway that applies saves with the real server guard: sign-in expires and the person keeps editing (the pending marker stays, nothing is reported as saved, the work is set aside), signing in again restores it without overwriting another person's newer record, conflicts (changed, deleted, id taken) and the decisions, another account never receives it, signing out offline, network failures and retries, reload, two tabs (one save, shared warning), the database reordering keys, copies from the previous version, and full browser storage (failure raised, "Save to the server" from memory, the pending marker kept in memory, refusing a sign-in that would discard unprotected work). Harness: tests/support/browser.js |
| [tests/safewrite.test.js](tests/safewrite.test.js) | `npm test` | The scenarios in [tests/support/scenarios.js](tests/support/scenarios.js) on an in-memory database ([tests/support/fake-db.js](tests/support/fake-db.js)) |
| [tests/db.test.js](tests/db.test.js) | `npm run test:db` | Migrations, 48-session courses and concurrent saves, and the same scenarios on local PostgreSQL |
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
| [docs/SDC Learn AI - Course Generation - Final Plan.pdf](docs/SDC%20Learn%20AI%20-%20Course%20Generation%20-%20Final%20Plan.pdf) | The approved plan for the AI course generator (source of truth). Release 1 is implemented |
| [docs/BRD_AI_Course_Generation.md](docs/BRD_AI_Course_Generation.md) | Earlier requirements draft, replaced by the Final Plan |
| `docs/testing/` | Excel workbooks with manual test cases and recorded results, and the script that builds them |
| `docs/screenshots/` | Screenshots of the main pages |

### Configuration files

| File | Purpose |
|---|---|
| [package.json](package.json) | Scripts (`start`, `dev`, `check`, `test`, `test:db`, `db:local`) and dependencies: `express`, `multer`, `jsonwebtoken`, `bcryptjs`, `cors`, `dotenv`, `@vercel/blob`, `@neondatabase/serverless`, `@simplewebauthn/server`. Node 20 to 24 |
| [vercel.json](vercel.json) | Sends `/api/*` and `/uploads/*` to `api/index.js`, blocks `/backend/`, sets region `bom1` and a 60-second limit, and bundles `js/seed.js` and `js/cloud-config.js` into the function |
| [.vercelignore](.vercelignore) | Keeps `.env`, uploads, tests, `supabase/` and the local database tools out of the Vercel deployment |
| [render.yaml](render.yaml) | Render web service: `npm ci`, `npm start`, health check on `/api/health` |
| [.env.example](.env.example) | Template for `.env`: port, JWT secret, upload size, AI keys, gateway secret |
| [.gitignore](.gitignore) | Keeps `node_modules`, `.env`, uploads, the local AI secrets and usage files, and the local PostgreSQL cluster (`.localdb/`) out of git |

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
| Sign-in or state rules on the server | [backend/state-api.js](backend/state-api.js) (rules the browser shares: [js/shared-rules.js](js/shared-rules.js)) |
| AI providers, limits or scrubbing | [backend/ai-api.js](backend/ai-api.js) |
| Uploads | [backend/server.js](backend/server.js) |
| Look and feel | [css/app.css](css/app.css) |

A new script file must also be added to [app.html](app.html) and to the `check` script in [package.json](package.json).
