# SDC Learn AI Course Builder: release-readiness audit

Audit completed 19 October 2026, Asia/Karachi. Branch: `Noman`. Working changes are intentionally uncommitted.

## Verdict

**LOCAL TEAM ACCEPTANCE: NO-GO for unrestricted, multi-role or concurrent real-course use.** The main builder workflow passes mocked acceptance tests. However, a learner can read draft content and answer keys from the server, can write an unprotected question collection, and two people editing the same record can overwrite each other. These are unresolved P0/P1 issues even when the server is local. Continuing coordinator-only QA with disposable synthetic data and mocked providers is safe; that is not product acceptance.

**PRODUCTION DEPLOYMENT: NO-GO.** The same access/integrity blockers apply. Real-provider behavior, production configuration, Supabase/PostgREST behavior and deployment prerequisites have deliberately not been certified. No production access, deployment, commit or push was performed.

## A. Scope, baseline and independent evidence

The story checked was: brief -> AI outline -> editable review -> atomic draft save -> lesson/practice/assessment generation -> pause/resume/provider switching -> repair proposal/review -> human approval -> learner display -> confirmed server persistence.

The existing `FEATURES.md`, project guide, approved Course Generation Final Plan, application paths and tests were examined. Release 1 of the plan is implemented. Its later scheduling/date generation and Sessions-tab generation work is not silently counted as delivered. The detailed content builder is checked against the current documented requirements, not treated as completion of every later item in the original plan. The current explicit no-automatic-fallback requirement takes precedence over the older plan's fallback wording.

At audit entry the uncommitted tracked files were `FEATURES.md`, `js/pages-coursecontent.js` and `package.json`; the two regeneration regression scripts and the two `PDA-101-repair-proposals` files were untracked. At continuation, the interrupted audit's Course Check and database-test changes and release test scripts were also preserved. The complete tracked diff was inspected. Existing proposal reports were not executed or applied. No dependency or lockfile change was required. No real course database was queried.

Evidence is under [qa/ai-course-builder](qa/ai-course-builder/). Important artifacts:

- [Full browser run](qa/ai-course-builder/release-browser-final.log) and its [completed run record](qa/ai-course-builder/run-sdc_test_release_c48be73fc7c8.json).
- [Additional full run with reload during switch confirmation](qa/ai-course-builder/release-browser-interruption.log) and [completed run record](qa/ai-course-builder/run-sdc_test_release_38f57c04a146.json).
- [Focused security, persistence and published-repair run](qa/ai-course-builder/focused-security-published.log) and [run record](qa/ai-course-builder/run-sdc_test_release_55bb0f27af3f.json). `completed: true` means the audit assertions finished; its explicit security `Fail` rows remain failures.
- [Accidental-regeneration browser regression](qa/ai-course-builder/regeneration-browser.log).
- [Multi-tab baseline reproduction](qa/ai-course-builder/multi-tab-baseline.log) and [fixed regression](qa/ai-course-builder/multi-tab-final.log).
- [Cross-profile counterexample](qa/ai-course-builder/cross-profile.log) and [completed audit record with explicit Fail](qa/ai-course-builder/run-sdc_test_release_573af49036b7.json); [Course Check baseline](qa/ai-course-builder/course-check-baseline.log) and [fixed helper regression](qa/ai-course-builder/course-check-fixed.log).
- [Final logic suite](qa/ai-course-builder/npm-test-final.log), [syntax check](qa/ai-course-builder/npm-check.log), [PostgreSQL suite](qa/ai-course-builder/test-db.log).
- [Rendered desktop](qa/ai-course-builder/builder-desktop-ready.png) and [rendered 390px mobile](qa/ai-course-builder/builder-mobile-ready.png) screenshots. Earlier unsuffixed screenshots caught a route/resize transition and are not visual acceptance evidence.

Every browser run created a random `sdc_test_release_*` or `sdc_test_regen_*` database. Only databases newly created by that invocation were removed. Prior runs' evidence and incomplete JSON records were kept. `sdc_dev`, the original Python course, production and `js/cloud-config.js` were not modified. The local cluster needed startup recovery after the interruption; no `setup`, reset or course-data query was used.

## B. Feature acceptance matrix

Pass means the stated layer and test conditions passed, not that a real AI model was verified.

| Requirement | Status | Evidence and boundary |
|---|---|---|
| Brief, totals, modules, outcomes, outline editing | Pass | Real browser outlines at 2, 8 and 24 sessions; limit/format/count tests in `coursegen.test.js` |
| Draft-only creation, deterministic IDs, duplicate-save protection | Pass | Browser draft save/reload; gateway and PostgreSQL safe-write scenarios |
| Unfinished outline survives reload | Pass | Edited title restored before saving in browser runs |
| Lesson, Practice, Assessment generation | Pass | 24-session courses both directions; 8-session course; 2-session Azure course |
| Stop, reload, resume only missing parts | Pass | Browser stopped at 6 saved parts and sent exactly 18 missing requests for an 8-session course |
| Representative scale | Pass | 24 sessions in Chrome; 8/24/48 in real runner with mock providers; two 48-session payloads in PostgreSQL |
| Four provider adapters, common workflow and attribution | Pass (mocked) | `providerswitch.test.js`, `groq.test.js`, `coursegen.test.js`; browser repairs on all four providers |
| Bad credentials, quota, busy, unavailable models, size/output limits, JSON failures | Pass (mocked) | Provider-specific wire-format tests; no real provider contacted |
| No unexpected automatic fallback | Pass | Native-format quota mocks paused both directions; no other provider called before explicit confirmation |
| Gemini -> Groq at 10 completed sessions of 24 | Pass | 30 completed parts and a manual edit preserved; remaining parts only; Settings unchanged; reload after pause |
| Groq -> Gemini at the same boundary | Pass | Reverse browser scenario, same preservation and attribution assertions |
| Reload during unconfirmed provider switch | Pass | Additional completed 24-session run reloads the confirmation before consent: 0 requests, pause retained, explicit switch then resumes only missing parts |
| Ordinary course/session/content saves and cancel send zero AI requests | Pass | Actual buttons in regeneration browser regression |
| Protected defaults, selected-part confirmation, history/restore | Pass | Browser regeneration/restore plus pure regression tests; explicit Lesson replacement only |
| Late response cannot replace newer same-part edit | Pass | Delayed browser response discarded after a newer manual edit; no replacement history entry |
| Select fields -> proposal -> Before/After -> accept/reject | Pass | Browser objectives accepted and notes rejected on Gemini, Groq, OpenAI and Azure; field-repair tests cover every supported schema field |
| Field-only requests, concurrent proposal conflicts, Python/JS formatting and changed-answer warnings | Pass (automated) | `fieldrepair.test.js`, `repair.test.js`, `codesafe.test.js`; not every field combination clicked in Chrome |
| Repair proposal preserves live text; acceptance withdraws approval | Pass | Published synthetic session: proposal leaves approval, explicit acceptance withdraws it; course stays published; learner no longer sees changed content |
| Course Check reads saved examples and instructions | Pass | Original omission reproduced; fixed `savefig` example reaches both identical browser review prompts; stamp stays current after JSONB reload |
| Course Check additions do not regenerate content | Pass | Browser Add to content marks outdated and records instructions; no AI request; protected selection and cancel verified |
| All semantic equivalents recognized; repeat real checks never contradict | Not Tested | Mocks cannot establish a model's semantic judgment or consistency; excerpts are bounded |
| Server-confirmed saves, network retry, expired sign-in recovery | Pass | Actual gateway 401, reload and same-account reauthentication; aborted PUT retains pending state and later persists |
| Storage-full error and in-memory recovery | Pass | Chrome `QuotaExceededError` through real persist path; storage warning and exact PostgreSQL recovery |
| Account-specific rescue/conflict isolation | Pass (automated) | `syncrecover.test.js` includes same/other accounts, newer server records and full storage; this is distinct from the raw-state disclosure below |
| Same-browser duplicate AI run prevention | Pass after fix | Baseline: 2 requests for the same missing part; fixed: 1; real Chrome tabs, shared origin |
| Same-record online conflict detection across devices | Fail | Last-write-wins deliberately reproduced in shared server scenarios on PostgreSQL |
| Protected collections, role ceiling, gateway conditional writes | Pass | `access.test.js`, `gateway.test.js`, 26 safe-write scenarios on fake DB and PostgreSQL |
| Learner UI gating and staff preview | Pass | Enrolled learner sees approved published lesson but not quiz/notes/timings; unapproved content and manage route hidden |
| Server read isolation and all collection write permissions | Fail | Learner GET returns synthetic draft/quiz answers; learner PUT adds a synthetic question |
| Server-only provider keys | Pass within mocks/code inspection | Four dummy encrypted profiles; browser status has no raw dummy keys; no real key accessed |
| Desktop/mobile layout smoke | Pass with P2 note | Rendered 1440px/390px screenshots inspected; no document horizontal overflow; mobile content header is narrow beside its button |
| Real-model educational accuracy and production readiness | Blocked | Requires explicit provider-call authorization and separate security/configuration clearance |

## C. Tests executed

| Command | Result |
|---|---|
| `npm run check` | Pass, including audit scripts through `postcheck` |
| `npm test` | Pass, including Course Check regression through `posttest` |
| `npm run test:db` | Pass on local PostgreSQL 18.6; 26 gateway scenarios, grants/preconditions/rollback, concurrency and content round trips |
| `npm run test:audit` | Pass: saved evidence, calls, decisions/instructions, stable ordering, read-only behavior and bounded prompt |
| `node tests/regeneration.browser.run.js` | Pass: actual Save/cancel, selected replacement, late-edit protection, persistence, reload and restore |
| `node tests/release.browser.run.js` | Pass for full functional run; 4 expected injected quota HTTP failures, zero uncaught browser errors |
| `node tests/release.browser.run.js --focused` | Completed: persistence/approval cases pass; explicit read-isolation and question-write acceptance rows fail |
| `node tests/release.browser.run.js --tabs-only --reproduce-tabs` | Original HEAD served only inside disposable harness: duplicate request defect reproduced |
| `node tests/release.browser.run.js --tabs-only` | Fixed: exactly one request, second tab refused |
| `node tests/release.browser.run.js --profiles-only` | Completed counterexample: two independent browser contexts sent two requests; cross-profile exclusion acceptance is Fail |
| `node tests/release-audit.test.js --reproduce-original` | Original HEAD helper reproduces saved-example omission and unchanged check stamp; fixed helper regression passes |
| Cleanup self-check with a deliberately open HTTP request | Pass: `server.close()` waits; `closeAllConnections()` releases it without a database |
| Synthetic Python code smoke | Pass: mocked `print("plot")` example parsed and executed with Python `-I`; quiz answer bounds, rubric total and 120-minute plan checked |
| `git diff --check` | Pass; only existing Windows line-ending notices |

The unit suite was run with `NODE_OPTIONS=--require ./tests/support/isolate-ai-stores.cjs`. Existing tests use fixed `/tmp` AI secret/usage filenames. The preload redirects only those test files to a fresh per-process temporary directory, preserving other runs' stores. It does not replace the application AI adapters or database behavior. Existing error-injection tests intentionally log provider failures, encryption negative tests and a simulated connection reset; their assertions and exit status passed.

Browser scripts need the existing Playwright bundle on `NODE_PATH`, installed Chrome, and the already running local PostgreSQL cluster. They never load `.env` or `backend/server.js`. Real state and AI routers run against a loopback REST stand-in backed by PostgreSQL; outbound provider HTTP is answered in memory in each provider's native response format. Browser external requests, including fonts, are blocked. This is not a real Supabase/PostgREST integration or real-provider test.

## D. Browser scenarios and incomplete attempts

The completed scenarios include outline editing/reload/save, both 24-session quota switches, 8-session stop/reload/resume, all-provider repair selection/comparison/accept/reject, explicit regeneration and restore, late responses, Course Check reads/additions, actual expired token recovery, failed PUT retry, storage errors, human approval, published repair withdrawal, learner routes and two-tab generation exclusion.

Incomplete runs are **not** acceptance passes. Preserved `incomplete-*.json` and `completed:false` run records include:

- Initial browser attempt before the local PostgreSQL cluster was available.
- The interrupted harness's ambiguous `Generate` locator: it could click an underlying session's Generate before the asynchronous global confirmation appeared. The test now targets the named confirmation's `data-ok` button.
- A raw seed-vs-normalized-settings assertion. It was corrected to compare the actual settings snapshot before and after the switch.
- An approval test targeting a session intentionally marked outdated by an earlier proposal. Approval correctly refused; the test now uses the other complete session.

Open HTTP connections made cleanup wait after failures. Both browser harnesses now close their owned connections before awaiting server shutdown. Failures are written before cleanup, so a cleanup problem cannot hide the original assertion. No failed assertion was disabled to obtain a pass.

## E. Verified fixes made during this audit

1. **Course Check omitted saved teaching content.** `CourseContentLogic.buildReviewMessages()` previously sent objectives/headings only. A `savefig()` call present solely in a saved example was absent from the prompt, and changing that example did not change the check stamp. The shared helper now includes bounded teaching excerpts, demonstrated calls, actual standing instructions and past human decisions. It explicitly distinguishes requested additions from demonstrated coverage. Canonical key ordering and full-field fingerprints keep checks sensitive to content changes and stable across JSONB reloads. Tests cover the shared helper and actual browser requests. This fixes evidence omission, not arbitrary model hallucinations.
2. **Duplicate AI requests from two tabs.** `TCRun.start()` had a tab-local Map only. Two Chrome tabs requested the same missing lesson twice. A per-course Web Lock now excludes the second same-origin browser tab for the lifetime of the run. The existing runner, provider choice, pause/resume and proposals are unchanged. No backend job system was added.
3. **Audit safety/reliability.** `tests/db.test.js` now uses random database suffixes rather than dropping fixed existing names. Harness confirmation selectors, normalized-settings comparisons, negative-case fixtures, cleanup and per-run evidence were corrected. Test-only AI stores are isolated.

The earlier accidental-regeneration fix was preserved, not rewritten: ordinary saves remain non-AI, outdated regeneration opens part selection, repaired/edited/restored parts start unchecked, replacements require named confirmation, and history/restore remains available.

## F. Remaining confirmed issues

| Priority | Finding and concrete evidence | Required action |
|---|---|---|
| P0 | **Unauthorized reads:** `backend/state-api.js` `forClient()` strips other users' password hashes, but returns the rest of the shared state. An unenrolled learner received a synthetic draft course, teaching content and quiz answer keys. UI approval/publication hiding is not a server read boundary. | Introduce reviewed role/course-scoped server read responses and a compatible scoped write/sync contract. A one-line response filter would break the whole-state client contract; do not deploy it as an untested patch. |
| P0 | **Unauthorized question writes:** an authenticated learner's hand-made state PUT inserted `QA-UNAUTHORIZED` into the unprotected `questions` collection; read-back confirmed persistence. FEATURES already lists other unprotected collections. | Extend server record authorization to these collections with existing feature callers, scope rules and regression coverage. Do not infer that the 14 protected collections cover the whole database. |
| P1 | **Same-record lost updates:** shared server scenarios verify that the later dirty-record save replaces the earlier record. Conditional database saves prevent transaction races, not application edit conflicts for the same course/session. | Add record-level versions/conflict decisions or enforce exclusive editing before multi-user acceptance. No concurrency redesign was attempted in this audit. |
| P1 for concurrent paid use | **AI run coordination stops at one browser profile:** after the fix, two independent Chrome storage/lock contexts still sent two requests for the same missing lesson. Web Locks do not coordinate separate devices/profiles; there is no backend job ownership/idempotency contract for generation. | Server-owned run coordination, or explicitly restricted single-writer operation until designed and approved. Same-browser exclusion alone is not a production guarantee. |
| P2 | **Course Check remains advisory:** bounded excerpts can omit middle-of-field prose; API-call evidence is not an AST/semantic proof. A model may still repeat equivalent recommendations or disagree between checks. New 48-session check prompt measured about 115k characters versus 18k before. | Human review; verify selected model context/cost on a non-production fixture. Do not chase a score of 100 or automatically suppress safety findings using text similarity. |
| P2 | **Browser capacity/history bounds:** one shared localStorage value, approximately 5 million characters, and bounded 12-entry/240k-character session history. Worst-case 48-session content is about 3.4 MB before other state/recovery copies. | Use backups and server-confirmed saves; plan a separately approved storage change if this scale is normal. Full history is not unlimited undo. |
| P2 | **Diagnostic wording:** injected no-fallback failures still log “trying the next provider”; request traces prove no second provider was called. Mobile header text uses a narrow column beside its action button. | Improve wording/layout later; neither is grounds to spend more AI requests or redesign this builder now. |

No additional P3 change is required for acceptance. The original scheduling and media-generation ideas remain later-scope features, not fixes.

## G. Architecture and security limits

Permissions are meaningfully enforced only through the gateway. Direct-state mode or old/unconditional writers can bypass these protections. The AI proxy enforces module permissions, switches, budget and request limits, but its rate counter is per server instance and its cached role state can lag briefly. It does not supply record-level generation leases. The saved session gateway enforces course scope; this does not repair raw-state disclosure.

Expired-session replay protects newer server records and keeps conflicts for explicit decisions. That tested recovery behavior must not be confused with online same-record conflict prevention. Account-specific rescue tests also do not excuse the independent whole-state read vulnerability.

Code/quiz/schema checks are structural safeguards, not proof that a lesson teaches the right thing. Only the synthetic mock example was executed; the original Python course was neither read from its database nor changed. Manual edits currently preserve approval by existing design; AI repair acceptance, regeneration and restore withdraw it. Coordinators must understand that distinction.

## H. Real-provider checks awaiting authorization

All four providers were mocked. No claim is made about current model availability, actual account quotas, latency, output quality, pricing, live JSON-mode support or real semantic Course Check consistency. Configured Gemini/Groq credentials were neither accessed nor displayed.

After explicit spending approval, use a disposable non-production fixture: test one outline, one full session, one field repair and one export-covered Course Check on each chosen model; inspect code/answers manually and review actual token/cost/error attribution. OpenAI and Azure additionally need an approved configured test profile/deployment. No production course should be used as the fixture.

## I. Production prerequisites, not performed

1. Resolve the P0 server read/write authorization gaps and P1 edit/run ownership risks; rerun multi-role and concurrency acceptance.
2. Have the database owner review `supabase/MIGRATIONS.md`, backups and the additive `20261014000100_sdc_state_put_if.sql` migration. Verify `gateway:true`, `safeWrite:true`, intended RPC grants and no direct table access in a separate approved project. Production's actual migration state is unknown; nothing was applied there.
3. Approve and test the environment: strong secrets, gateway enabled, local token minting disabled, correct origin/host restrictions, server-only encryption key, persistent encrypted profiles/usage and production-safe mock flags. Verify any legacy v1 encrypted profiles are re-encrypted/rotated by the owner where required. No real secret was inspected.
4. Verify non-production Supabase/PostgREST RPC serialization/schema-cache behavior and deployed request/time/payload limits; local REST stand-in tests do not establish these.
5. Authorize and finish the real-provider checks above, plus human educational review and controlled publication.
6. Obtain team acceptance, deployment/rollback authorization and a reviewed release snapshot. This audit does not authorize a commit, push, deployment or production migration.

## J. Exact actions needed from the owner

1. Review these uncommitted fixes and the two P0 proofs.
2. Approve a separate scoped authorization/conflict-safety remediation; keep real learner data and concurrent real-course editing out of team acceptance until it passes.
3. If desired, explicitly authorize a small non-production AI-call budget and designate approved test profiles/models.
4. Assign the production owner to verify backups, gateway/migration/configuration prerequisites only after security acceptance. Do not deploy yet.

Unexecuted checks remain explicitly Not Tested/Blocked; no production or real-provider readiness is implied by passing mocks.
