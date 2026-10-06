# Business Requirements Document (BRD)

## SDC Karachi Online Learning Platform

| Field | Value |
|---|---|
| **Document title** | BRD — SDC Karachi Online Learning Platform |
| **Version** | 1.0 |
| **Date** | 5 October 2026 |
| **Status** | Draft for implementation |
| **Product name** | **SDC Learn** (working title) — *Skill Development Council Karachi Online Learning Platform* |
| **Base system** | Existing EAD University Management Portal (HTML/CSS/Vanilla JS + optional Express) |
| **Reference LMS** | [SDI Central](https://atihelps.awesometechinc.com/sdi/lms/index.php) (Awesome Tech / Skills Development Initiative) |
| **Brand source** | [Skill Development Council Karachi](https://sdckarachi.org.pk/) |

---

## 1. Executive summary

Transform the existing university-style portal into an **online learning platform** for **Skill Development Council (SDC) Karachi**, combining:

1. **SDI-style course delivery** — learner-first courses, sessions, videos, resources, Zoom, assignment upload, progress.
2. **Existing admin / instructor / learner operations** — users, enrollments, attendance, grades, fees, announcements, messaging (adapted to training vocabulary).
3. **SDC Karachi branding** — institutional identity, training programs (diplomas, certificates, workshops), and online + onsite delivery model.

The result is a single platform where SDC can **publish training programs**, **deliver live/recorded sessions**, and **manage learners and instructors**, aligned with SDC’s mandate under the National Training Ordinance and Ministry of Federal Education & Professional Training, Government of Pakistan.

---

## 2. Business objectives

| ID | Objective | Success measure |
|---|---|---|
| BO-1 | Deliver courses like SDI Central (sessions, materials, Zoom, submissions) | Learners can complete a full course path online |
| BO-2 | Rebrand fully as SDC Karachi | No residual “EAD University” branding in UI/docs |
| BO-3 | Preserve multi-role operations | Admin / Instructor / Learner workflows remain usable |
| BO-4 | Support SDC program types | Diplomas, certificates, workshops, short courses |
| BO-5 | Support hybrid delivery | Online Zoom + recorded access + onsite session flags |
| BO-6 | Enable certification workflow | Completion → certificate eligibility / verification hook |

---

## 3. Scope

### 3.1 In scope (Phase 1 — MVP)

- Full **SDC rebrand** (name, logo placeholders, colors, copy, footers, emails).
- **Learner “My Courses”** dashboard (SDI-style).
- **Course → Sessions** hierarchy with outline, status badges, prev/next navigation.
- **Session pages**: video embed, downloadable resources, assignment CTA.
- **Zoom / live class** panel (meeting register URL, ID, password, copy).
- **Help / support** link (Google Form or configurable URL).
- **Assignment file submission** (real upload via existing Express `/api/uploads` where possible).
- **Course outline** page (module roadmap).
- Role rename & nav remap: Student → **Learner**, Teacher → **Instructor**, Admin → **Admin / Coordinator**.
- Seed data for **1–2 sample SDC courses** (e.g. Excel/AI analytics, Tableau, HSE, Supply Chain).
- Light/dark theme retained; visual language updated for SDC.

### 3.2 In scope (Phase 2)

- Per-learner **session access control** (module unlock / restricted folders by enrollment).
- Progress tracking (% complete, last session).
- Feedback / testimonials mid-course flow (optional promo course).
- Certificate generation + public **certificate verification** page (mirror SDC site capability).
- Training calendar view (2026-style calendar).
- Instructor tools to publish sessions/resources without editing code.

### 3.3 Out of scope (for now)

- Full payment gateway / ecommerce checkout.
- Mobile native apps.
- SCORM / xAPI packages.
- AI tutoring / auto-grading of notebooks.
- Partner-institute multi-tenant white-label (can be Phase 3).
- Replacing SDC’s public WordPress marketing site (platform is the LMS, not the brochure site).

---

## 4. Stakeholders & roles

| Role (new name) | Former name | Primary goals |
|---|---|---|
| **Learner** | Student | Browse enrolled courses, attend sessions, download resources, submit assignments, view results/certificates |
| **Instructor** | Teacher | Manage sessions for assigned courses, mark attendance, grade submissions, upload materials |
| **Admin / Coordinator** | Admin | Create programs/courses, enroll learners, manage instructors, fees, announcements, reports, settings |
| **Guest** | — | Login only; optional public certificate verification |

---

## 5. Current system vs target

| Capability | Current (EAD) | SDI reference | Target (SDC Learn) |
|---|---|---|---|
| Branding | EAD University | SDI Central | **SDC Karachi** |
| Primary UX | Institutional dashboard | My Courses → Sessions | **Learner-first course delivery + admin ops** |
| Content model | Subjects / materials list | Course → 24 sessions | **Course → Modules → Sessions** |
| Live class | Absent | Zoom popover | **Zoom/live class tools** |
| Video | Absent | Session video region | **Embedded session video** |
| Assignments | Demo filename/link | File upload form | **Real file submit + replace** |
| Outline | Thin | Rich course outline | **Full roadmap page** |
| Access control | Role pages | Email session filter | **Enrollment + optional session unlock** |
| Fees / attendance / messaging | Strong | Weak / external form | **Keep, rebrand vocabulary** |
| Auth | Demo + optional passkey/OAuth | Email-derived password | **Keep proper role auth (improve security)** |

---

## 6. Functional requirements

### 6.1 Rebranding (FR-BRAND)

| ID | Requirement | Priority |
|---|---|---|
| FR-B1 | Replace all “EAD University” strings with **Skill Development Council Karachi** / **SDC Learn** | Must |
| FR-B2 | Update login, dashboards, titles, meta, README, footers, `package.json` name | Must |
| FR-B3 | Apply SDC-inspired visual identity: institutional blues/greens, professional training aesthetic; support light + dark | Must |
| FR-B4 | Logo: use placeholder path `assets/brand/sdc-logo.svg` (or PNG) with swap instructions | Must |
| FR-B5 | Contact strip / footer: phone `(021) 99334387, 99334388`, email `sdckar@sdckarachi.org.pk`, link to [sdckarachi.org.pk](https://sdckarachi.org.pk/) | Should |
| FR-B6 | Vocabulary: Student→Learner, Teacher→Instructor, Subject→Course/Module, Class→Batch/Section, Fees→Fee / Registration fee | Must |

### 6.2 Learner experience — SDI-style (FR-LEARN)

| ID | Requirement | Priority |
|---|---|---|
| FR-L1 | **My Courses** home after login for learners: searchable course cards (title, tagline, session count, level, accent) | Must |
| FR-L2 | Course home lists **sessions** with number, title, summary, date, duration, status (`Upcoming` / `Today` / `Available` / `Outline` / `Submit`) | Must |
| FR-L3 | Special items: **Course Outline**, **Submit Assignment** always near top | Must |
| FR-L4 | Session detail: breadcrumb, title, date, **video player region**, **resources list** (download), assignment CTA, prev/next session nav | Must |
| FR-L5 | Header tools on course/session pages: **Help**, **Zoom**, theme toggle, user email, logout | Must |
| FR-L6 | Zoom panel: register/join URL, meeting ID, password, copy buttons | Must |
| FR-L7 | Help panel: opens configurable support form URL | Must |
| FR-L8 | Assignment submit: select session, confirm email, drag-drop file (types: xlsx, docx, pptx, pdf, pbix, ipynb, sql, txt; max ~30MB); replace prior submission | Must |
| FR-L9 | Empty states: “No courses”, “No classes yet”, “No resources yet” | Should |
| FR-L10 | Optional mid-course **feedback** entry (SDI testimonials pattern) | Could |

### 6.3 Instructor experience (FR-INST)

| ID | Requirement | Priority |
|---|---|---|
| FR-I1 | View assigned courses and batches | Must |
| FR-I2 | Upload/edit session resources; mark attendance; grade assignment submissions | Must |
| FR-I3 | Publish announcements to course audience | Should |
| FR-I4 | Add/edit session metadata (date, duration, summary, video URL) via UI (Phase 2 if timeboxed) | Should |

### 6.4 Admin experience (FR-ADMIN)

| ID | Requirement | Priority |
|---|---|---|
| FR-A1 | CRUD: Learners, Instructors, Departments/Divisions, Programs (Diploma/Certificate/Workshop), Courses, Batches | Must |
| FR-A2 | Enroll learners into courses/batches | Must |
| FR-A3 | Configure Zoom + Help URLs per course | Must |
| FR-A4 | Fees, reports, announcements, settings retained | Must |
| FR-A5 | Seed SDC sample catalog from public programs (IT, HSE, Supply Chain, Excel/AI, Tableau, etc.) | Should |

### 6.5 Data model additions (FR-DATA)

Extend existing LocalStorage / DB schema with:

```
courses[] {
  id, slug, title, tagline, description, level,
  sessionCount, startDate, icon, accent,
  helpUrl, zoom: { registerUrl, meetingId, password },
  programType: 'diploma'|'certificate'|'workshop'|'short',
  delivery: 'online'|'onsite'|'hybrid',
  status: 'draft'|'published'
}

sessions[] {
  id, courseId, folder, title, date, duration, summary,
  moduleName, order, videoUrl, videoType,
  resources: [{ id, title, type, url, size }],
  assignmentDueAt, statusOverride
}

enrollments[] { id, learnerId, courseId, batchId?, enrolledAt, accessMode: 'full'|'restricted', allowedSessionIds?[] }

submissions[] { id, sessionId, courseId, learnerId, email, fileName, fileUrl, uploadedAt, status, grade?, feedback? }

progress[] { learnerId, courseId, completedSessionIds[], lastSessionId, percent }
```

Map/adapt existing `subjects`, `classes`, `materials`, `assignments`, `submissions` where possible instead of duplicating blindly.

### 6.6 Non-functional requirements (NFR)

| ID | Requirement |
|---|---|
| NFR-1 | Keep stack: HTML5, CSS3, Vanilla JS; Express for uploads/auth where already present |
| NFR-2 | Mobile-responsive; session pages usable on phone |
| NFR-3 | Light/dark theme |
| NFR-4 | Do not break existing LocalStorage migration path — version bump DB key if schema changes |
| NFR-5 | Accessible basics: labels, focus states, reduced-motion respect |
| NFR-6 | No plaintext production passwords in seed for real deployments; demo accounts OK labeled as demo |
| NFR-7 | File uploads validated by type/size on server |

---

## 7. Information architecture (target)

### Learner

```
Login → My Courses
         → Course Home (session list + outline + submit)
              → Session Detail (video + resources + assignment)
              → Course Outline
              → Submit Assignment
         → (Existing) Attendance | Results | Fees | Messages | Profile
```

### Instructor

```
Login → Dashboard → My Courses → Sessions / Attendance / Grades / Materials
```

### Admin

```
Login → Dashboard → Users | Programs | Courses | Sessions | Enrollments
                 → Fees | Announcements | Reports | Settings
```

---

## 8. Brand guidelines (SDC-inspired)

Source: [sdckarachi.org.pk](https://sdckarachi.org.pk/)

| Element | Guidance |
|---|---|
| **Organization** | Skill Development Council Karachi (SDC Karachi) |
| **Established** | 1995 · National Training Ordinance-1980 / 2002 · MoFEPT, GoP |
| **Tagline options** | “Demand-driven skills training” · “Erasing unemployability through quality training” |
| **Program families** | Diplomas, Certificates, Workshops; IT, Management, HSE, Supply Chain, Import/Export, Data Analytics, etc. |
| **Delivery** | Online via Zoom with recorded access + onsite at SDC Karachi |
| **Contact** | (021) 99334387 / 99334388 · sdckar@sdckarachi.org.pk |
| **Visual** | Clean institutional training portal; prefer deep navy/teal primary, gold or amber accents for CTAs/certificates; avoid remaining “EAD” olive-only identity; do **not** copy SDI’s violet–cyan glass theme literally — use SDC institutional feel with modern LMS UX patterns from SDI |
| **Logo** | Official SDC logo from brand assets (placeholder until provided) |

---

## 9. Sample content for MVP seed

1. **Microsoft Excel with AI-Driven Analytics & Automation** (map to multi-session structure inspired by SDI data-analysis path).
2. **Tableau for Data Visualization & Analytics**.
3. Optional third: **Diploma in Supply Chain & Operations Management with Six Sigma** or an **HSE / OSHA** certificate short course.

Each course must include: outline, ≥3 real session stubs with resources, Zoom placeholders, one assignment due date.

---

## 10. Acceptance criteria (Phase 1)

1. Login shows **SDC** branding; no “EAD University” in primary UI.
2. Learner lands on **My Courses** with at least one enrolled course card.
3. Opening a course shows ordered sessions with status badges.
4. Opening a session shows video area + ≥1 downloadable resource + link to submit.
5. Zoom and Help header tools work with configured URLs.
6. Learner can upload an assignment file and see confirmation / replace behavior.
7. Admin can still manage learners/instructors and enrollments.
8. Instructor can see submissions for their courses.
9. Light/dark toggle works on new pages.
10. Mobile layout does not break session list or session detail.

---

## 11. Risks & dependencies

| Risk | Mitigation |
|---|---|
| Scope too large (SIS + LMS) | Phase 1 focuses on learner course delivery + rebrand; defer certificate verification |
| LocalStorage size limits for files | Store files via Express uploads / cloud URLs, not LocalStorage blobs |
| Official logo/colors not provided | Use placeholders + document swap points |
| SDI auth model insecure | Do **not** copy email-derived passwords; keep role-based auth |
| Content authoring without UI | Phase 1 seed + JSON/admin fields; Phase 2 richer CMS |

---

## 12. Phased delivery plan

| Phase | Focus | Duration (indicative) |
|---|---|---|
| **P0** | Rebrand + vocabulary + My Courses shell | 2–3 days |
| **P1** | Course/session pages, Zoom/Help, outline, seed | 4–6 days |
| **P2** | Real assignment uploads + instructor grading link | 2–3 days |
| **P3** | Progress, session unlock, certificates, calendar | 1–2 weeks |

---

## 13. Open questions

1. Final product name: **SDC Learn** vs **SDC LMS** vs **SDC Digital Campus**?
2. Will official logo/brand book be provided?
3. Are Zoom meetings one-per-course (SDI model) or per-session?
4. Should certificates integrate with existing SDC “Certificate Verification” on the public site?
5. Multi-institute / partner portals needed in v1?

---

## 14. Appendix — Reference links

- SDC Karachi: https://sdckarachi.org.pk/
- SDI Central LMS (feature reference): https://atihelps.awesometechinc.com/sdi/lms/index.php
- Existing codebase: EAD University Management Portal (this repository)
