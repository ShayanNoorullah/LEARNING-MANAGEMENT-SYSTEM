# AI Course Generation: requirements and design

| Field | Value |
|---|---|
| **Document title** | SDC Learn AI: Course Generation |
| **Version** | 0.1 |
| **Date** | 12 October 2026 |
| **Status** | **Draft, awaiting approval. Nothing in this document is implemented yet.** |
| **Product** | SDC Learn (Skill Development Council Karachi) |
| **Builds on** | [BRD Phase 2: SDC Learn AI](BRD_Phase2_AI_Capabilities.md), [FEATURES.md](../FEATURES.md) |
| **Approver** | ____________________ |
| **Approval date** | ____________________ |

---

## 1. Summary

Today a coordinator builds a course by hand: one form for the course details, then one form per session. A 24-session course means filling about 25 forms before any teaching content exists.

This feature adds a **course generator** to SDC Learn AI. The coordinator describes the course in a short brief (topic, audience, level, length). The AI drafts the course details, learning outcomes, modules and a full session plan. The coordinator reviews and edits the draft, then saves it as a **draft course** in the normal course builder.

Three rules shape the whole design:

1. **The AI drafts, a person decides.** Nothing is saved until the reviewer accepts it, and a generated course is always saved as a draft. It is never published automatically.
2. **The AI writes teaching content only.** Dates, fees, instructors and Zoom links are never invented by the AI. Dates are calculated by the platform from the schedule the coordinator picks.
3. **It reuses what exists.** Same AI proxy, same provider settings, same budget, same course and session records. No new storage and no new framework.

## 2. Decisions needed for approval

Each has a recommendation. Section 12 lists what changes if a different option is chosen.

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| Q1 | Who can generate courses | Anyone with `courses: create` **and** `ai: use`. With the seeded roles that is coordinators only. | Also give instructors `courses: create` so they can draft their own courses. |
| Q2 | What version 1 generates | Course details, outcomes, modules and sessions. | Also draft assignments and quizzes (see section 10). |
| Q3 | Source material | Brief plus optional pasted text (syllabus, notes). | Also accept an uploaded PDF or DOCX. |
| Q4 | Default provider for this capability | The platform's primary provider (OpenAI as shipped), changeable in Settings → Integrations like every other capability. | A fixed, larger model for better quality at higher cost. |
| Q5 | Session visibility after saving | Sessions are saved as visible, and the course's Draft status hides everything until it is published. | Save each session unpublished, so each one is released by hand. |
| Q6 | Size limit per course | Up to 12 modules and 48 sessions. | A lower or higher limit. |

## 3. Goals and non-goals

### 3.1 Goals

| ID | Goal | How it is measured |
|---|---|---|
| CG-G1 | Cut the time to a first complete course draft | Time from "New course" to a reviewable draft with all sessions: target under 10 minutes, measured in the pilot |
| CG-G2 | Consistent course quality | Every generated course has measurable outcomes, and every outcome is covered by at least one session (checked by the platform, section 7.4) |
| CG-G3 | Keep people in control | 100% of generated courses are saved as Draft and carry an AI label until a person edits and publishes them |
| CG-G4 | Predictable cost | One course costs a known, small number of AI calls (section 9) and counts against the existing monthly budget |

### 3.2 Not in scope

- Publishing, enrolling learners, creating batches or issuing anything automatically.
- Generating videos, slides, recordings or downloadable resources.
- Setting fees, instructors, venues or Zoom details.
- Urdu or other languages. Phase 2 is English only (decision D7 of the Phase 2 BRD).
- Rewriting a course that already has learners, submissions or attendance.
- Checking the technical accuracy of the content. The reviewer stays responsible for that.

## 4. Users and permissions

| Role (as seeded) | Can generate | Reason |
|---|---|---|
| Admin | Yes | Built-in full access |
| Coordinator | Yes | Has `courses: create` and `ai: use` |
| Instructor | No (by default) | Has `courses: view, edit` but not `create` |
| Learner | No | No course management permissions |

The button and the page are shown only when **all** of these hold:

- `can('courses', 'create')`
- `can('ai', 'use')` or `can('ai', 'configure')`
- `feature('aiCourseGen')` is on (new switch, section 8.3)
- `Domain.aiEnabled()` is true (AI master switch)

No new permission module is added. Roles can be changed in Roles and permissions as usual.

## 5. User flow

Entry point: a **Generate with SDC Learn AI** button next to **New course** on `#/manage/courses`. It opens a new page, `#/manage/courses/generate`, with four steps.

### Step 1: Brief

The coordinator fills in a short form.

| Field | Required | Notes |
|---|---|---|
| Course topic or working title | Yes | For example "Power BI for finance teams" |
| Target audience | Yes | Who the learners are and what they already know |
| Level | Yes | From Settings (Beginner, Intermediate, Advanced, All levels) |
| Program type | Yes | From Settings (Diploma, Certificate, Workshop, Short Course) |
| Delivery | Yes | Online, Onsite or Hybrid |
| Program and division | No | If chosen, their names and descriptions are given to the AI as context |
| Number of weeks | Yes | 1 to 52 |
| Sessions per week | Yes | 1 to 7 |
| Hours per session | Yes | For example 2 |
| What learners should be able to do at the end | No | Free text. Strongly improves the outcomes |
| Tools or software used | No | For example "Excel 365, Power Query" |
| Source material | No | Pasted syllabus or notes, up to about 12,000 characters |
| Start date, class days and start time | No | Used only by the platform to schedule sessions. Not sent to the AI |

The platform shows the totals before generating: sessions = weeks × sessions per week, and total hours.

### Step 2: Outline

One AI call returns the course outline:

- title, tagline, description, prerequisites, suggested course code and icon
- 4 to 8 learning outcomes
- modules, each with a name, a one-line summary and its session titles

The coordinator can edit every field, rename, add, remove and reorder modules and session titles, or press **Regenerate outline** with an extra instruction (for example "more hands-on, less theory").

### Step 3: Session details

When the outline is accepted, the platform makes **one AI call per module** to write the details of that module's sessions: a summary of what is taught, the key topics and one practical activity. Progress is shown per module. A module that fails can be retried on its own without losing the others. Any module can be regenerated with an extra instruction.

### Step 4: Review and create

A single review screen shows the whole course as it will be saved, with:

- the totals (modules, sessions, hours) against what was asked
- the outcome coverage check (section 7.4), with gaps highlighted
- the calculated session dates, if a start date and class days were given
- a clear notice: "Drafted with SDC Learn AI. Review the content before publishing."

**Create draft course** saves the course and its sessions and opens the normal course builder at `#/manage/course/:id`. From there everything works as it does today: edit details, add resources and recordings, create batches, publish.

**Discard** throws the draft away. Nothing is saved.

### Work in progress

The draft lives only in the browser until **Create draft course** is pressed. It is kept in `sessionStorage`, so an accidental reload does not lose it, and it is cleared after the course is created or discarded. It is never written to the shared state and never synced to the cloud.

## 6. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-CG-1 | A **Generate with SDC Learn AI** button on the courses page, shown only under the conditions in section 4 | Must |
| FR-CG-2 | A brief form with the fields in step 1, with validation and a live total of sessions and hours | Must |
| FR-CG-3 | Outline generation in one AI call, returned as structured data and shown in an editable form | Must |
| FR-CG-4 | Session detail generation, one AI call per module, with per-module progress, retry and regenerate | Must |
| FR-CG-5 | Regenerate the outline or a single module with an extra instruction from the reviewer | Must |
| FR-CG-6 | Every AI response is validated against a fixed shape before it is shown. An invalid response is retried once automatically, then reported as an error | Must |
| FR-CG-7 | The session count, module count and hours are enforced by the platform, not trusted from the AI | Must |
| FR-CG-8 | Session dates and times are calculated by the platform from the start date, class days and start time | Must |
| FR-CG-9 | The AI never sets fee, instructors, venue, Zoom details, status or enrolments | Must |
| FR-CG-10 | A generated course is always saved with status `draft`, even if the user can publish | Must |
| FR-CG-11 | A generated course is marked as AI-drafted, with the provider, model, date and user recorded on the course | Must |
| FR-CG-12 | The builder shows an "AI draft" label until a person edits the course details or publishes it | Should |
| FR-CG-13 | Outcome coverage check on the review screen (section 7.4) | Should |
| FR-CG-14 | The work in progress survives a page reload within the same browser tab | Should |
| FR-CG-15 | Optional pasted source material is used as the main reference for the content | Should |
| FR-CG-16 | A new capability `courseGenerate` appears in Settings → Integrations with its own provider, model and temperature | Must |
| FR-CG-17 | A new feature switch **Course generator** in Settings → Features | Must |
| FR-CG-18 | Generation counts against the existing AI rate limit and monthly budget, and is reported under its own name in AI usage | Must |
| FR-CG-19 | "Generate sessions with AI" inside the builder's Sessions tab, for an existing course that has no sessions yet | Could |
| FR-CG-20 | Draft assignments and quizzes from the course plan (section 10) | Later |

## 7. How good output is achieved

The quality of the course depends more on this section than on the choice of model.

### 7.1 A structured brief

A free-text prompt gives vague courses. The brief asks for audience, level, length and intended results as separate fields, so the AI always has the facts it needs.

### 7.2 Real platform context

Each request includes:

- who SDC Karachi is and who it teaches: working professionals and job seekers, practical and employment-focused training
- the chosen program and division, with their descriptions
- the titles of existing courses, so the new course does not duplicate one and matches the catalogue's naming
- one existing published course as a worked example of the expected style and depth

### 7.3 Two passes instead of one

1. **Outline pass**: the whole course at a high level. This keeps the progression logical from the first session to the last.
2. **Detail pass**: one module at a time. Each request carries the full outline, so the AI knows what came before and what comes after and does not repeat or skip topics.

One large request for a 24-session course would be truncated or shallow. Splitting it also keeps every request well inside the 60-second server limit on Vercel.

### 7.4 Rules the content must follow

Written into the instructions to the AI:

- Outcomes are measurable and start with an action verb (build, analyse, configure). No "understand" or "learn about".
- Difficulty rises through the course, and each module builds on the previous one.
- Every session has one practical activity that fits the tools listed in the brief.
- The final module includes a project or assessment that brings the outcomes together.
- Each session lists which outcomes it supports.

The last rule lets the platform run an **outcome coverage check** without another AI call: an outcome that no session supports, or a session that supports none, is highlighted on the review screen.

### 7.5 Strict, checked output

- The AI is asked for JSON only, in a fixed shape. Where the provider supports a JSON response mode (OpenAI, Azure OpenAI, Gemini), it is switched on.
- The platform validates the shape, trims over-long text, removes unknown fields and corrects the counts. An invalid response is retried once.
- A low temperature (0.4) keeps the structure stable.

### 7.6 A person reviews everything

Every field is editable before saving, single modules can be regenerated, and the result lands in the normal builder as a draft.

## 8. Technical design

### 8.1 Where it fits

```
Brief form (browser)
   │  SDCAI.call('courseGenerate', …)        js/ai-client.js (existing)
   ▼
POST /api/ai/complete                         backend/ai-api.js (existing)
   │  auth → permission → rate limit → budget → PII scrub → provider (with fallback)
   ▼
OpenAI / Gemini / Azure OpenAI
   ▼
JSON text → validated in the browser → review screen
   │  Create draft course
   ▼
saveDB()  → localStorage → SDCCloud.syncNow() → Supabase (existing path)
```

The save uses the same store functions and the same cloud path as creating a course by hand. The generator adds no new way to write data.

### 8.2 AI calls

| Call | When | Input | Output | Max output tokens |
|---|---|---|---|---|
| Outline | Step 2, and on Regenerate outline | Brief, platform context, example course | Course details, outcomes, modules, session titles | about 3,000 |
| Module detail | Step 3, once per module, and on Regenerate module | Brief, full outline, the module to expand | Per session: summary, topics, activity, outcome numbers | about 3,000 |

Module calls run two at a time, to finish sooner without hitting the per-user rate limit.

Outline shape (what the AI must return):

```json
{
  "title": "", "tagline": "", "description": "", "prerequisites": "",
  "code": "", "icon": "book",
  "outcomes": ["…"],
  "modules": [
    { "name": "Module 1 · …", "summary": "…", "sessions": ["Session title", "…"] }
  ]
}
```

Module detail shape:

```json
{
  "sessions": [
    { "title": "", "summary": "", "topics": ["…"], "activity": "", "outcomes": [1, 3] }
  ]
}
```

### 8.3 Files that change

| File | Change |
|---|---|
| `js/pages-coursegen.js` (new) | The generator page: route, brief form, prompts, validation, review screen, save |
| `app.html` | Load the new script after `pages-ai.js` |
| `package.json` | Add the new file to the `check` script |
| `js/pages-manage.js` | Add the **Generate with SDC Learn AI** button on the courses page, and the "AI draft" label in the builder header |
| `js/core.js` | `DEFAULT_SETTINGS`: add `features.aiCourseGen: true` and `integrations.capabilities.courseGenerate` |
| `js/pages-ops.js` | Add the label "Course generator" to the Settings → Features list. The Integrations table picks up the new capability by itself |
| `backend/ai-api.js` | Add `courseGenerate` to `CAPABILITIES` so usage is reported under its own name. Add an optional JSON response mode to the three provider calls |
| `tests/ai.test.js`, `tests/core.test.js` | Tests for the validator, the date scheduling and the capability name |
| `FEATURES.md`, `docs/IMPLEMENTATION.md` | Describe the feature, the flow, the new route, the switch and the capability |

Not changed: `js/cloud-config.js`, `js/cloud-sync.js`, `backend/state-api.js`, `js/seed.js`, the roles, and the learner pages.

### 8.4 Data model

No new collection. Existing settings pick up the two new defaults automatically, because saved settings are merged over `DEFAULT_SETTINGS` on load. No migration is needed.

**Course record.** Uses the existing fields, plus two optional new ones:

| Field | Source |
|---|---|
| `title`, `tagline`, `description`, `prerequisites`, `outcomes[]`, `modules[] {name, summary}` | AI, edited by the reviewer |
| `code`, `icon` | AI suggestion, edited by the reviewer. `icon` is limited to the existing icon list |
| `slug` | Platform, from the title, made unique |
| `level`, `programType`, `delivery`, `programId`, `divisionId` | The brief |
| `duration` | Platform, for example "8 weeks · 16 hours" |
| `startDate`, `endDate`, `schedule` | Platform, from the brief |
| `status` | Always `draft` |
| Instructor | Not stored on the course: instructors belong to batches. For a user limited to their own courses, a first batch is created with them as its instructor (same rule as manual creation) |
| `fee`, `venue`, `zoom`, `helpUrl` | Left empty for a person to fill in |
| `aiGenerated` (new) | `true` |
| `aiMeta` (new) | `{ provider, model, generatedAt, by }` |

**Session records.** Existing fields only:

| Field | Source |
|---|---|
| `title`, `moduleName` | AI outline, edited by the reviewer |
| `summary` | AI: the summary, then the key topics and the activity, as plain text |
| `duration` | Platform, from hours per session |
| `date`, `time` | Platform, from start date, class days and start time. Empty if not given |
| `order` | Platform |
| `published` | Per decision Q5 |
| `resources`, `videoUrl`, `zoom` | Empty |

The session summary matters beyond this feature: the AI Tutor, the summarizer and the quiz generator all use it as their reference text, so richer summaries improve those features too.

### 8.5 Saving

The course and all its sessions are written in **one** `saveDB()` call, so the cloud copy never holds a half-created course. If the browser storage is full, nothing is saved and the draft stays on screen.

### 8.6 Errors

| Situation | What the user sees |
|---|---|
| No AI provider configured | The existing message asking the coordinator to add a provider in Settings → Integrations |
| AI switched off, or no permission | The button is hidden. A direct link shows the normal "no access" page |
| Monthly budget reached | The existing budget message. The draft so far is kept |
| Rate limit reached | The existing rate limit message, with a retry button |
| Invalid or cut-off response | One automatic retry, then "Could not generate this part. Try again." for that part only |
| Provider failure | The existing fallback to the next configured provider, then an error with a retry button |
| Page reloaded mid-way | The draft is restored from `sessionStorage` |

## 9. Cost and limits

| Item | Value |
|---|---|
| AI calls per course | 1 + number of modules. A typical 6-module course is 7 calls. Each regenerate is 1 more |
| Tokens per course | Roughly 20,000 to 30,000 in total for a 6-module course. This is an estimate and will be measured during the pilot |
| Rate limit | Existing: 60 calls per user per hour. Enough for about 8 typical courses per hour |
| Monthly budget | Existing: counts against the call budget in Settings → Integrations (5,000 calls as shipped) |
| Time per call | Target under 30 seconds. Server limit on Vercel is 60 seconds |
| Size limits | Per decision Q6: up to 12 modules and 48 sessions. Source material up to about 12,000 characters |

## 10. Later phase: assignments and quizzes from the course plan

In SDC Learn, assignments and quizzes belong to a **batch**, not to the course. A newly generated course has no batch, so the generator cannot create them as real records without breaking that rule.

The proposed later phase:

1. The generator also drafts an **assessment plan**: assignment briefs and quiz topics per module. It is stored on the course as a blueprint, not as live assignments.
2. In a batch workspace, **Add from course plan** turns chosen items into real draft assignments, or opens the existing quiz generator for that module.

This needs one more field on the course and changes in the batch workspace, so it is kept out of version 1 unless decision Q2 says otherwise.

## 11. Privacy, safety and integrity

- **Keys stay on the server.** The feature uses the existing AI proxy. No provider key reaches the browser.
- **No learner data is sent.** The request contains the brief, program and division descriptions, and course titles. PII stripping stays on by default, as for every other capability.
- **Source material is the user's responsibility.** A notice on the form says not to paste personal data or material SDC has no right to use.
- **AI label.** Generated courses are marked, and the mark is stored with the provider, model, date and user.
- **Human approval.** The course is a draft until a person with `courses: publish` publishes it. This matches the Phase 2 rule that people approve every consequential academic decision.
- **Accuracy.** AI text can be wrong or out of date, especially on software versions and tool features. The review screen says so, and the reviewer is responsible for the content.
- **Server-side checks.** In production (gateway mode) the server checks that the caller is an active user with AI permission and that AI is switched on, as it does today. The `courses: create` check is made in the browser, the same as for manual course creation.

## 12. Effect of the alternative decisions

| Decision | If the alternative is chosen |
|---|---|
| Q1 instructors too | No code change. Grant `courses: create` to the Instructor role in Roles and permissions. Instructors then also get the manual **New course** button |
| Q2 assignments and quizzes now | Section 10 moves into version 1: more AI calls per course, one new course field, changes in the batch workspace, more testing |
| Q3 file upload | PDF can reuse the browser-side text extraction the assignment evaluator already has (pdf.js, first 20 pages). DOCX has no extraction today and would need a new library |
| Q4 larger model | No code change. Set the model for `courseGenerate` in Settings → Integrations. Higher cost per course |
| Q5 unpublished sessions | One line of difference. The coordinator then releases each session by hand |
| Q6 different limit | A constant. Larger courses mean more calls and a longer wait |

## 13. Testing

**Automated (added to `npm test`):**

- the validator accepts a correct outline and module response, and rejects or repairs: missing fields, wrong types, extra fields, too many or too few sessions, over-long text, text wrapped in code fences
- session counts and hours always match the brief after correction
- date scheduling: correct class days, correct order, no dates when no start date is given
- the outcome coverage check finds an uncovered outcome
- slug uniqueness when a course with the same title exists
- the server reports usage under `courseGenerate`

**Manual:**

- each role sees or does not see the button, as in section 4
- the feature switch and the AI master switch both hide the feature
- a full run with each configured provider
- regenerate outline, regenerate one module, retry a failed module
- reload mid-way and continue
- budget reached and rate limit reached
- the saved course opens in the builder, is a draft, shows the AI label, and its sessions group under the right modules
- a learner cannot see the course until it is published
- in gateway mode, the course appears on a second browser after sync

`tests/e2e.browser.js` is not run against live data.

## 14. Acceptance criteria

The feature is done when:

1. A coordinator can go from an empty brief to a saved draft course with all sessions without leaving the generator.
2. The number of sessions and the total hours of the saved course equal what the brief asked for.
3. A generated course is always a draft, is labelled as AI-drafted, and is invisible to learners until published.
4. No fee, instructor, Zoom detail or enrolment is ever set by the generator.
5. A user without `courses: create` or `ai: use`, or with the feature switched off, cannot reach the generator.
6. A failed AI call never loses the work done so far and never saves a partial course.
7. Usage appears under "courseGenerate" in AI usage and counts against the monthly budget.
8. `npm run check` and `npm test` pass, and `FEATURES.md` describes the feature.

## 15. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Generic or shallow content | Low trust, heavy rewriting | Structured brief, platform context, example course, two passes, regenerate with instructions |
| Wrong or outdated technical content | Learners taught wrong material | Mandatory human review, draft status, AI label, accuracy notice |
| Response is not valid JSON or is cut off | Generation fails | JSON response mode, validation, one automatic retry, small per-module requests |
| A request runs past 60 seconds on Vercel | Error for that part | Small per-module requests, retry per part |
| Cost grows through repeated regeneration | Budget used up | Existing rate limit and monthly budget, usage reported under its own name |
| Near-duplicate courses in the catalogue | Clutter | Existing course titles are given to the AI, and the result is only ever a draft |
| Pasted material contains personal or copyrighted content | Privacy or rights issue | Notice on the form, PII stripping on by default |

## 16. Implementation plan (after approval)

| Step | Work | Depends on |
|---|---|---|
| 1 | Server: `courseGenerate` capability name and JSON response mode. Defaults in `js/core.js`. Settings labels | Approval |
| 2 | Generator page: brief form, validation, totals | Step 1 |
| 3 | Outline call, validator, editable outline, regenerate | Step 2 |
| 4 | Module detail calls with progress, retry and regenerate | Step 3 |
| 5 | Review screen, coverage check, date scheduling, save as draft, AI label in the builder | Step 4 |
| 6 | Tests, manual test pass, update `FEATURES.md` and `docs/IMPLEMENTATION.md` | Step 5 |
| 7 | Push to the `Noman` branch | Step 6 |

Work starts only after the decisions in section 2 are answered and this document is approved.

## 17. Approval

| | Name | Decision | Date |
|---|---|---|---|
| Approver | | Approved / Changes requested | |

Answers to section 2:

| # | Answer |
|---|---|
| Q1 | |
| Q2 | |
| Q3 | |
| Q4 | |
| Q5 | |
| Q6 | |
