# Final Delivery QA Checklist

This delivery has been hardened for all 11 requested points:

1. Dark mode: teal + black palette enforced.
2. EAD logo: clickable scaffolding/sidebar control; no duplicate scaffold button.
3. Closed dashboard scaffolding: collapsed content consumes no height and has hidden overflow.
4. Ayesha Khan `AK` mark: top-action mark is explicitly rendered with white lettering.
5. Profile image: upload/change image control available on profile pages.
6. Notification bell: dropdown includes the exact action `View all notifications`.
7. Route loading: content-area loading overlay is bound to same-window navigation and leaves the persistent scaffold visible.
8. Table/Board: standard data tables use a top-right dropdown; board cards expose only the primary name + academic summary and open remaining details in a dialog.
9. Authentication: implemented portal authentication screen retained. Exact pixel comparison requires the original reference asset.
10. Google OAuth: sign-in and OAuth callback handling included.
11. Passkeys: registration and sign-in flows included through WebAuthn.

## Run

Install dependencies with `npm install` and start with `npm start` from the project root.


## User-requested final QA

The uploaded reference requested five concrete corrections/features:

- [x] **Light-mode table/board readability:** fixed the light-theme `--text-primary` token so board/detail values render in dark text instead of white/light text on white cards. Dark mode still overrides the same token with a light value.
- [x] **Passkey setup:** profile registration uses WebAuthn and the backend now supports the SimpleWebAuthn v10 `registrationInfo.credential` shape as well as the legacy shape.
- [x] **Passkey sign-in:** login uses the WebAuthn authentication options/verification endpoints and keeps the transaction/challenge separate from browser `publicKey` options.
- [x] **Clickable assignment actions:** Submit, View Submission, View Submissions, Edit and Delete actions are bound to live handlers; pagination/search/filter redraws preserve those handlers.
- [x] **Timetable export:** Export Timetable generates a sorted, print-ready official timetable from the current filtered dataset.
- [x] **Dynamic tables/boards:** standard tables receive table/board controls plus search, status filtering and pagination; pages with their own specialized controls retain them.
- [x] **Settings-driven behavior:** page size, search, filters, default table/board view, late submissions and passkeys are configurable from Admin → Settings.

### Static verification performed on this ZIP

- Node syntax checks should pass for `backend/server.js`, `js/app.js`, and `js/database.js`.
- The project contains the Express WebAuthn dependencies in `package.json`/`package-lock.json`.
- The light-mode board text token is now dark in `css/variables.css`.
- The project documentation now explicitly states that `npm start` is required for passkeys.


## Added in this update
- [x] Learning Materials/Documents module for Admin, Teacher and Student roles.
- [x] Document upload through the existing Express upload API with configured size/type limits.
- [x] Optional Neon PostgreSQL connection, health endpoint, bootstrap endpoint and background state sync.
- [x] Deployment environment documentation and demo credentials.
