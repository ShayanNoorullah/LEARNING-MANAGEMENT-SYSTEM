# Business Requirements Document (BRD)

## Phase 2 — SDC Learn AI  
### Intelligent Learning Support & Academic Operations Enhancement

| Field | Value |
|---|---|
| **Document title** | BRD — SDC Learn Phase 2: SDC Learn AI |
| **Document reference** | SDC-BRD-AI-2026-P2 (merged) |
| **Version** | 2.0 |
| **Date** | 8 October 2026 |
| **Status** | Baseline for Phase 2 implementation |
| **Product** | **SDC Learn** — Skill Development Council Karachi Online Learning Platform |
| **AI product name** | **SDC Learn AI** |
| **Sources merged** | (1) `BRD_Phase2_AI_Capabilities.md` v1.1 · (2) `SDC Learn AI: Intelligent Learning Support & Academic Operations Enhancement` (SDC-BRD-AI-2026-V1) · (3) Phase 1 LMS BRD / live platform |
| **Predecessor** | [BRD Phase 1](BRD_SDC_Online_Learning_Platform.md) (LMS complete; prior LMS “Phase 2” items shipped) |
| **Base system** | Current SDC Learn (HTML/CSS/Vanilla JS + Express + optional Supabase) |

---

## 1. Executive summary

Phase 1 delivered a full LMS: courses, sessions, assignments, attendance, results, certificates, roles, and admin configuration. **Quizzes and AI do not exist today.**

**Phase 2** adds **SDC Learn AI** — an assistive capability layer embedded in existing workflows. It does **not** redesign or replace the portal. The LMS remains the source of truth for users, records, and transactions.

SDC Learn AI:

1. Is **dynamically configurable** — features, models, prompts, budgets, and credential profiles without redeploy.
2. Is **provider-agnostic at launch** — **OpenAI**, **Google Gemini**, and **Azure OpenAI** under Settings → **Integrations**.
3. Embeds in real workflows — tutoring, summarization, practice & graded quizzes, evaluation drafts, at-risk advisories, cohort narratives, and content assist.
4. Routes all provider calls through a **server-side gateway** (secrets never in the browser).
5. Keeps **humans in control** of every consequential academic decision (**draft-only** grading; no auto certificates or discipline).

---

## 2. Business drivers & goals

### 2.1 Drivers (from SDC context)

- 24/7 asynchronous support for technical/vocational concepts between Zoom/onsite sessions.
- Lower trainer overhead for quizzes, feedback, and repetitive marking (batches often 50–150+).
- Faster formative feedback turnaround.
- Earlier detection of disengaged / at-risk trainees.
- Better use of dense PDFs and session materials.
- Scale hybrid cohorts without proportional headcount growth.
- Avoid on-prem LLM hosting; use commercial APIs under privacy controls.

### 2.2 Business goals (Phase 2)

| ID | Goal | Target (validate in pilot) |
|---|---|---|
| BG-01 | Accelerate formative feedback | ~40% reduction in trainer turnaround using draft evaluations |
| BG-02 | Expand asynchronous support | ≥60% of routine conceptual queries resolved without trainer ticket |
| BG-03 | Accelerate assessment creation | ~50% time savings drafting formative quizzes / question banks |
| BG-04 | Early identification of at-risk trainees | Flag ≥7 days before major milestones (advisory only) |
| BG-05 | Academic integrity | 100% of summative grades, results, certificates, discipline = human-approved |

### 2.3 KPIs (instrument in Phase 2)

| KPI | Metric | Target |
|---|---|---|
| KPI-01 | Student grounding / hallucination rate (sampled tutor logs) | &lt;2% incorrect vs course materials |
| KPI-02 | Query helpfulness (thumbs + no escalate in 48h) | &gt;75% positive |
| KPI-03 | Trainer feedback acceptance (≤25% edit or none) | &gt;70% |
| KPI-04 | Trainer mark override delta (AI vs final) | Monitored; high variance → prompt/rubric review |
| KPI-05 | Practice quiz adoption | ≥3 attempts / student / module (pilot) |
| KPI-06 | At-risk intervention recovery | &gt;50% of flagged+contacted pass (vs baseline) |
| KPI-07 | AI cost per active learner / month | Ceiling set by SDC Finance |

---

## 3. Locked stakeholder decisions

| # | Decision |
|---|---|
| D1 | Phase name: **Phase 2** |
| D2 | Providers: **OpenAI + Google Gemini + Azure OpenAI** |
| D3 | Secrets: **server-only encrypted store** via gateway (`SDC_STATE_SECRET` / dedicated AI key); masked in UI; never in `sdcLearnDB_v1` |
| D4 | Grading: **draft-only** — no auto-apply |
| D5 | Results: **both** freeform `assessment` % **and** `quizAvg` weight |
| D6 | **AI Tutor** in Phase 2 **Must** |
| D7 | Language: **English only** (Urdu summarizer deferred) |
| D8 | Evaluator files: **all types**; extraction **PDF first**; non-extractable → checklist assist only |
| D9 | Credentials: **dynamic profiles** (org / capability / course / role) |
| D10 | **Strip PII by default** (name, email, phone, regNo, CNIC); optional admin override |
| D11 | Product name: **SDC Learn AI** |
| D12 | Stack: Vanilla JS + Express / Vercel AI proxy |

---

## 4. Operating principles (Must)

1. **Measurable utility** — every AI feature maps to a pain point + KPI + owner.
2. **Workflow preservation** — embed in existing screens (session, submit, grade, reports, course builder); no separate AI app.
3. **Trainer primacy** — AI drafts; trainers decide.
4. **Human accountability** — grades, certificates, standing, discipline require explicit human action.
5. **Transparency** — AI outputs show **SDC Learn AI** attribution.
6. **Curricular grounding** — student Q&A / summaries / practice grounded in approved course materials; refuse when not covered.
7. **Authorization boundary** — AI only sees data the user may already see (`Domain.visibleCourses` / enrollment).
8. **Privacy & zero-training** — PII scrub before API; prefer enterprise API tiers with **no training / zero retention** on prompts.
9. **Graceful fallback** — LMS works if AI is down.
10. **Modular gating** — enable/disable/throttle per feature, course, role.

---

## 5. Scope

### 5.1 Phase 2 — Must (in scope for first release)

| Code | Capability | Primary users |
|---|---|---|
| **PLAT** | Integrations hub, credential profiles, capability map, AI proxy, budgets, audit, feature flags, PII scrubber | Admin / IT |
| **AI-01** | Course-grounded Student Learning Assistant (Tutor) | Learner |
| **AI-02e** | Resource summarizer & concept explainer (**English only**) | Learner (+ instructor pin) |
| **AI-03** | Student private practice quiz generator (non-graded) | Learner |
| **QUIZ** | Graded quiz module (banks, attempts, auto-score objective) | Instructor / Learner |
| **AI-05** | Assignment feedback & rubric evaluation drafter (Evaluator) | Instructor |
| **AI-06** | Question bank & assessment drafting assistant | Instructor |
| **AI-07** | Early-warning / at-risk learner advisory | Instructor / Coordinator |
| **CHK** | AI short-answer quiz checker (override by instructor) | Instructor |

### 5.2 Phase 2 — Should (include if capacity; same platform)

| Code | Capability |
|---|---|
| **AI-08** | Cohort performance narrative reporter |
| **AX-SESS** | Session / outline assist + semantic tags & learning objectives on upload |
| **AX-RUBRIC** | Rubric builder from assignment brief |
| **AX-FEED** | Feedback suggest (expand chips to full comments) |
| **AX-ELIG** | Certificate eligibility explainer (learner-facing, rule-based + plain language) |
| **AX-INSIGHT** | Mid-course feedback theme insights |

### 5.3 Deferred (not Phase 2 Must)

| Item | Reason |
|---|---|
| Urdu / Roman Urdu / RTL (PDF AI-02 full) | Locked English-only (D7) |
| AI-04 Remedial study path recommender | PDF Low / later wave |
| Announcement / message draft | Could |
| Auto-apply grades | Locked draft-only (D4) |
| Full proctoring / biometrics | Out of scope |
| Open-web general chatbot | Out of scope |
| On-prem fine-tuning / hosted LLMs | Out of scope |
| Payment, SCORM, multi-tenant white-label, native apps | Out of scope |

### 5.4 Explicitly prohibited

- Publishing final summative marks without trainer confirmation.
- Autonomous certificate / graduation / enrollment changes.
- Autonomous disciplinary actions from at-risk flags.
- Showing at-risk labels to learners.
- Using AI to write full solutions to **active graded** assignments (conceptual help only).

---

## 6. Stakeholders & roles

| Role | Phase 2 goals |
|---|---|
| **Learner** | Tutor, English summaries, private practice quizzes, graded quizzes, AI-assisted feedback labels, eligibility explainer (Should) |
| **Instructor** | Generate/check quizzes, draft evaluations, rubrics/session assist, review at-risk cards, override all AI drafts |
| **Admin / Coordinator** | Integrations, budgets, flags, audit, at-risk outreach, cohort narratives, QA sampling |
| **Guest** | Unchanged (login + certificate verify) |

---

## 7. Functional requirements

Priority legend: **M** = Phase 2 Must · **S** = Should · **C** = Could/deferred

### 7.1 Platform — Integrations & AI services (PLAT) — Must

| ID | Requirement | P |
|---|---|---|
| FR-INT-1 | Settings tab **Integrations** (SDC Learn AI) | M |
| FR-INT-2 | Provider cards: **OpenAI**, **Gemini**, **Azure OpenAI** — enable, credentials (key, endpoint, API version, deployment), default model, Test connection | M |
| FR-INT-3 | Secrets in server encrypted store only; UI masked key + last-validated; never in client state or JSON backup | M |
| FR-INT-4 | **Credential profiles** + bindings: default, per capability, course, role | M |
| FR-INT-5 | **Capability map**: feature → provider + model + profile + temperature/max tokens | M |
| FR-INT-6 | Primary + fallback provider; timeouts; retries (≤3 with backoff) | M |
| FR-INT-7 | Usage dashboard (calls, tokens/cost if available, errors by feature/day) | S |
| FR-INT-8 | Soft/hard monthly budget; disable AI actions on hard stop; notify admin | M |
| FR-INT-9 | Editable prompt templates per capability + reset to default | S |
| FR-AIP-1 | Authenticated AI proxy routes (`/api/ai/...`); permission-checked | M |
| FR-AIP-2 | `aiJobs` audit records (feature, provider, model, user, course, status, tokens, error) — prefer server-side | M |
| FR-AIP-3 | Rate limits per user and org | M |
| FR-AIP-4 | PII scrubber default on (name, email, phone, regNo, CNIC); per-capability override | M |
| FR-AIP-5 | Prefer/require commercial tiers with **zero retention / no training** on customer data | M |
| FR-AIP-6 | Prompt-injection sanitization; block harmful content; tutor refuses graded-assignment solution dumping | M |
| FR-AIP-7 | Offline/degraded: clear message; core LMS unaffected | M |
| FR-AIP-8 | UI product label **SDC Learn AI**; English-only generation/evaluation | M |
| FR-ADM-1 | Permissions: `ai` view / use / configure; `quizzes` CRUD/publish | M |
| FR-ADM-2 | Feature flags: `ai`, `quizzes`, and per-capability toggles; course-level AI settings where needed | M |
| FR-ADM-3 | Schema: bump storage key / migrate when collections added (NFR alignment with Phase 1) | M |

### 7.2 AI-01 — Course-grounded Tutor — Must

| ID | Requirement | P |
|---|---|---|
| FR-T1 | Chat on course / session / resource screens for enrolled learners | M |
| FR-T2 | Ground answers in approved course materials (outline, session text, extractable resources, transcripts when available) | M |
| FR-T3 | Refuse with standard message when not covered — do not invent | M |
| FR-T4 | Citations: document/session title + section/page or timestamp when available | M |
| FR-T5 | Permanent disclaimer: AI-generated from course materials; not official grading advice | M |
| FR-T6 | Helpful / Unhelpful rating; one-click **Escalate to instructor** | M |
| FR-T7 | Coexists with existing **Help** URL panel (does not replace it) | M |
| FR-T8 | Mobile-usable drawer; light/dark | S |

### 7.3 AI-02e — English resource summarizer — Must

| ID | Requirement | P |
|---|---|---|
| FR-S1 | “Summarize resource” / “Explain in simple English” on text-based session materials | M |
| FR-S2 | Structured output: objectives, key concepts, practical steps, glossary | M |
| FR-S3 | Instructor may edit and **pin** an official summary on a session/resource | M |
| FR-S4 | Cache summaries per resource to control cost | S |
| FR-S5 | Urdu / bilingual toggle | C (deferred) |

### 7.4 AI-03 — Private practice quizzes — Must

| ID | Requirement | P |
|---|---|---|
| FR-P1 | Learner “Test my understanding” on a session — generate private practice quiz from session materials | M |
| FR-P2 | Choose count (3/5/10), difficulty, types (MCQ, T/F); English | M |
| FR-P3 | Instant score + explanations + links back to session content | M |
| FR-P4 | Results only in personal study log — **never** gradebook / `quizAvg` / transcripts | M |
| FR-P5 | Aggregate misconception trends visible to instructor (no student ranking required) | S |

### 7.5 QUIZ — Graded quiz module — Must

| ID | Requirement | P |
|---|---|---|
| FR-Q1 | Collections: `questionBanks`, `questions`, `quizzes`, `quizAttempts` | M |
| FR-Q2 | Types: MCQ single/multi, true/false, short text | M |
| FR-Q3 | Attempt UI: timer optional, attempt limit, shuffle | M |
| FR-Q4 | Auto-score objective items | M |
| FR-Q5 | Results: configurable **`quizAvg`** weight **plus** existing freeform **`assessment`** | M |
| FR-Q6 | Feature flag `features.quizzes` | M |

### 7.6 AI-06 — Quiz / question bank generator — Must

| ID | Requirement | P |
|---|---|---|
| FR-G1 | SDC Learn AI → Generate from sessions/outline/PDF (PDF preferred) | M |
| FR-G2 | Types + Bloom-style cognitive level (Recall → Application/Troubleshooting) | M |
| FR-G3 | Draft staging only; never auto-publish | M |
| FR-G4 | Instructor accept/edit/reject each item; MCQ distractors + rationale | M |
| FR-G5 | Flag near-duplicates vs existing bank | S |

### 7.7 CHK — AI quiz checker — Must

| ID | Requirement | P |
|---|---|---|
| FR-C1 | Objective items: rules engine (no LLM) | M |
| FR-C2 | Short text: AI score suggestion + rationale vs model answer/rubric | M |
| FR-C3 | Instructor override required before score is final for graded quizzes | M |

### 7.8 AI-05 — Evaluator (assignment feedback drafter) — Must

| ID | Requirement | P |
|---|---|---|
| FR-E1 | “SDC Learn AI → Evaluate” on grading UI | M |
| FR-E2 | Inputs: brief, rubric, model answer, extractable submission (PDF first, then other types) | M |
| FR-E3 | Output: strengths, deficiencies vs rubric, actionable guidance, provisional marks per criterion, confidence note | M |
| FR-E4 | **Draft-only**; Publish/Save locked until instructor confirms; log AI draft vs final | M |
| FR-E5 | Non-extractable files: checklist assist only — no invented numeric grade | M |
| FR-E6 | Batch draft for Submitted/Late (still per-item confirm) | S |
| FR-E7 | Label learner-visible feedback when AI-assisted | S |
| FR-E8 | QA: support sampling / override-delta metrics (KPI-03/04) | S |

### 7.9 AI-07 — At-risk early warning — Must

| ID | Requirement | P |
|---|---|---|
| FR-R1 | Periodic (e.g. weekly) synthesis of engagement signals: login gap, incomplete sessions, late/missed submissions, weak formative/practice/quiz signals | M |
| FR-R2 | Staff-only dashboard cards: Low/Moderate/High + plain-language factors | M |
| FR-R3 | Never show risk status to learners; no auto penalties | M |
| FR-R4 | Suggested outreach templates; outreach log for coordinator notes | M |
| FR-R5 | Explainable factors only — no opaque score without narrative | M |

### 7.10 Should capabilities

| ID | Requirement | P |
|---|---|---|
| FR-N1 | **AI-08** Generate anonymized cohort narrative (overview, strengths, bottlenecks, recommendations); coordinator sign-off before export | S |
| FR-X1 | Session assist: title, summary, outcomes, tags on upload | S |
| FR-X2 | Rubric builder from assignment description | S |
| FR-X3 | Feedback suggest from short notes/chips | S |
| FR-X4 | Eligibility explainer vs certificate rules + progress/results | S |
| FR-X5 | Feedback insights over mid-course `feedback` collection | S |

---

## 8. Non-functional requirements (Phase 2 Must unless noted)

| ID | Requirement |
|---|---|
| NFR-1 | Interactive tutor/summary: first tokens / useful response target ≤ ~3s under normal conditions (S if streaming not ready day-one: ≤8s full) |
| NFR-2 | Evaluation draft ≤ ~15s for ≤1,500 words extract |
| NFR-3 | Support large PDFs via chunking / long-context (practical limit documented; e.g. up to tens of MB) |
| NFR-4 | Concurrent AI routing sized for evening peak (pilot: tens–low hundreds of concurrent requests) |
| NFR-5 | Keys never in browser; TLS to providers; encrypt secrets at rest |
| NFR-6 | Role/course isolation enforced on every AI call |
| NFR-7 | Mobile + light/dark for quiz attempt, tutor, evaluate |
| NFR-8 | Accessibility basics (labels, focus, reduced motion) |
| NFR-9 | AI failure never blocks learn / submit / manual grade |
| NFR-10 | Document what leaves SDC to providers (SETUP / privacy) |

---

## 9. Information architecture (additions)

```
Settings → Integrations (SDC Learn AI)
         → Providers (OpenAI, Gemini, Azure OpenAI)
         → Credential profiles
         → Capability map
         → Prompts & PII policy
         → Usage & budget
         → AI audit log

Course / Session → SDC Learn AI Tutor | Summarize | Practice quiz
Course builder   → Quizzes (graded) | Generate questions | Session assist / tags
Submissions      → Evaluate with SDC Learn AI → Accept / Edit → Save
Dashboard (staff)→ At-risk advisories | (Should) Cohort narrative
Results settings → weights: assignmentAvg + assessment + quizAvg + attendance
```

Help URL panel remains; Tutor is separate.

---

## 10. Data model (additions)

```
settings.integrations {  # non-secret only
  aiEnabled, productName: 'SDC Learn AI', language: 'en',
  stripPiiDefault: true,
  primaryProvider, fallbackProvider,
  budget { period, maxCalls?, maxTokens?, hardStop },
  credentialProfileBindings { defaultProfileId, byCapability, byCourseId, byRoleId },
  capabilities { tutor, summarize, practiceQuiz, quizGenerate, quizCheck,
                 evaluate, atRisk, cohortNarrative, sessionAssist, ... },
  prompts { [capability]: { system, userTemplate } }
}

settings.lms.weights { assignmentAvg, assessment, quizAvg, attendancePct }

# SERVER ONLY encrypted:
# credentialProfiles[] { id, name, provider, encryptedSecret, endpoint?, apiVersion?, deployment?, ... }

questionBanks[], questions[], quizzes[], quizAttempts[]
practiceAttempts[] { id, learnerId, sessionId, score, ... }  # never gradebook
aiJobs[]  # prefer server
rubrics[] { id, assignmentId, criteria[] }
atRiskFlags[] { id, learnerId, courseId, level, factors[], status, outreachNotes[] }
courseAiSettings[] { courseId, tutorEnabled, evaluatorEnabled, practiceEnabled? }
```

---

## 11. Human oversight & governance (Must)

**Core rule:** AI drafts, summarizes, and advises. Nothing becomes an official academic record without authorized human approval.

| Area | Rule |
|---|---|
| Grades | Mandatory human confirm; trainer accountable for published mark |
| Questions | Draft staging → human accept before live graded use |
| Certificates / standing | Human only; AI may explain rules, never issue |
| At-risk | Advisory; human outreach; never shown to learner as a stigma label |
| Appeals | Learner may request human re-mark; AI draft kept in audit only |
| QA | Periodic sample audit of tutor logs & graded AI-assist cases (e.g. 5%) |

---

## 12. Acceptance criteria (Phase 2 Must)

1. Integrations configures OpenAI, Gemini, Azure OpenAI; Test connection; credential profiles; capability map.
2. API keys absent from browser storage and demo JSON backups.
3. Tutor answers with grounding + citations (or refusal); Helpful/Unhelpful + Escalate work; Help panel still works.
4. English summarize available on a text/PDF resource; instructor can pin.
5. Learner can run a **private** practice quiz that does **not** affect results/`quizAvg`.
6. Instructor can generate, edit, publish a **graded** quiz; learner attempts; objective auto-score; `assessment` + `quizAvg` weights configurable.
7. Short-answer AI check is overridable by instructor.
8. Evaluator produces draft only; Save/Publish requires instructor; AI draft vs final logged.
9. At-risk cards appear for staff with explainable factors; not visible to learners; no auto penalty.
10. Budget hard-stop disables AI actions; LMS core remains usable.
11. Roles without `ai:use` / `ai:configure` cannot invoke / configure AI.
12. PII scrubber strips identifiers from outbound prompts by default.

---

## 13. Delivery waves (inside Phase 2)

| Wave | Focus | Must items |
|---|---|---|
| **W0** | Integrations + secrets + profiles + proxy + PII + flags + budgets | PLAT |
| **W1** | Graded quiz module + Results weights | QUIZ |
| **W2** | Generator (AI-06) + Checker + private practice (AI-03) | AI-06, CHK, AI-03 |
| **W3** | Evaluator (AI-05) draft-only + audit trail | AI-05 |
| **W4** | Tutor (AI-01) + English summarizer (AI-02e) | AI-01, AI-02e |
| **W5** | At-risk (AI-07) | AI-07 |
| **W6** | Should: AI-08, session assist/tags, rubric/feedback suggest, eligibility, insights | S |

Waves may overlap after W0 is stable.

---

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hallucination / unsafe vocational guidance | Grounding + refusal + citations + KPI-01 audits |
| Trainer rubber-stamping | Draft vs final log; override metrics; QA samples |
| Cost overrun | Budgets, throttles, caching summaries, cheaper models for practice |
| PII leakage | Scrubber + zero-retention tiers + no keys in client |
| Provider outage / drift | Fallback provider; LMS decoupled; prompt regression checks |
| False at-risk alerts | Explainable factors; human triage; tune thresholds |
| Scope creep (Urdu, remedial path, auto-grade) | Explicit deferrals §5.3–5.4 |

---

## 15. Assumptions & dependencies

- Session resources are largely machine-readable (not scan-only images).
- Video grounding needs transcripts where video is the only content.
- SDC approves commercial OpenAI / Gemini / Azure use under privacy terms.
- Trainers will review AI drafts (governance + product design assume this).
- Existing LMS data (attendance, submissions, progress) feeds AI-07.

---

## 16. Traceability

| Concern | Where in codebase today |
|---|---|
| Settings / features | `js/core.js` `DEFAULT_SETTINGS`, `js/pages-ops.js` |
| Permissions | `PERMISSIONS` in `js/core.js` |
| Grading UI | `js/pages-ops.js` submissions / grade modal |
| Course builder | `js/pages-manage.js` |
| Learner session / Help / Zoom | `js/pages-learn.js` |
| Uploads | Express `POST /api/lms/uploads` |
| Gateway pattern | `backend/state-api.js` |
| Certificates / feedback / progress | Already shipped (Phase 1 LMS) |
| Prior AI deferral | Phase 1 BRD §3.3 — **superseded by this Phase 2 BRD** |

---

## 17. Document control

| Version | Date | Notes |
|---|---|---|
| 1.0–1.1 | 8 Oct 2026 | Initial Phase 2 AI BRD + stakeholder locks |
| **2.0** | **8 Oct 2026** | **Merged with SDC-BRD-AI-2026-V1**; Phase 2 Must set locked; Urdu/AI-04 deferred |

**Next step:** Technical design / implementation against §5.1 Must and waves W0–W5.
