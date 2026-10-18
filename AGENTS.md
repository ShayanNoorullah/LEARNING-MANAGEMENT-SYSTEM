# Project guide for AI coding agents

This file is read automatically by Codex (as `AGENTS.md`) and by Claude Code (through `CLAUDE.md`, which imports it). Keep the two in sync by editing only this file.

## Read first

Before changing or explaining anything, read [FEATURES.md](FEATURES.md). It describes every feature, how each part works, what connects to what, and the end-to-end flows (section 20).

Other references:
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md): file map, data model fields, how to add a page, permission or setting.
- [SETUP.md](SETUP.md): environment variables, Supabase, Google sign-in, deployment.
- [RUN.md](RUN.md): running, demo accounts, tests, troubleshooting.

## Git workflow

- Develop on a feature branch (for example `Noman`) and push there.
- `main` is the release branch: every push to it deploys to production (Vercel). Do not push to `main` or open pull requests into it on your own; changes reach `main` only when the project owner asks for a merge.
- Before a merge into `main`: `npm run check`, `npm test` and the browser suites in [RUN.md](RUN.md) must pass, and any database migration it needs must already be applied to the live Supabase project (see [supabase/MIGRATIONS.md](supabase/MIGRATIONS.md)).

## What the project is

SDC Learn is the online learning platform of Skill Development Council Karachi: courses, live Zoom sessions, recordings, assignments, quizzes, attendance, results, certificates, fees, and AI features (tutor, summarizer, practice quizzes, quiz generation, draft grading, at-risk flags).

## Architecture in brief

- **Frontend**: plain HTML, CSS and JavaScript. No framework, no bundler, no build step. Scripts are loaded with `<script>` tags in a fixed order in `app.html`.
- **Data**: the whole state is one JSON object in `localStorage` (key `sdcLearnDB_v1`), seeded from `js/seed.js`. Read and write it only through the store functions in `js/core.js` (`db`, `saveDB`, `addRecord`, `updateRecord`, `deleteRecord`, `findRecord`).
- **Cloud copy**: `js/cloud-sync.js` mirrors the state to one Supabase row, directly or through the server gateway `/api/sdc/*` (`backend/state-api.js`) when `SDC_STATE_SECRET` is set.
- **Server**: Express in `backend/server.js`. It serves the pages, stores uploads (`/api/lms/uploads`), runs the state gateway and the AI proxy `/api/ai/*` (`backend/ai-api.js`). On Vercel the same app runs through `api/index.js`.
- **Pages**: `js/shell.js` is the router and menu. Each page is registered with `App.route()` in a `js/pages-*.js` file.
- **Permissions**: `can(module, action)` in `js/core.js` gates menus, routes and buttons. Modules are declared once in `PERMISSIONS`.
- **Courses are blueprints; batches own the work.** Assignments and quizzes carry a `batchId`, and learners only see their own batch's work.

## Rules when changing code

- Match the existing style: vanilla JS, no new frameworks or build tools.
- Use `t('term')` for user-facing terms so Settings → Terminology keeps working.
- Gate new pages and buttons with `can()` and, where relevant, `feature()`.
- A new script file must be added to `app.html` and to the `check` script in `package.json`.
- AI provider keys stay on the server. Never put them in the browser state or in `js/`.
- Do not change `js/cloud-config.js`; it points at the live Supabase project and is bundled into the deployment.
- Never run `tests/e2e.browser.js` against live data; it resets the shared state.

## Running and checking

- `npm install`, then `npm run dev`, then open http://localhost:3000.
- Demo accounts are on the sign-in page (see [RUN.md](RUN.md)).
- `npm run check` and `npm test` must pass before pushing.

## Keeping the docs current

When a feature, flow, route, permission or setting changes, update [FEATURES.md](FEATURES.md) in the same change.
