# EAD University — Final Corrected Build

Build: 2026-09-15.4

This build includes:
- Shared portal boot/error recovery and cache-busted assets.
- Working Admin, Teacher and Student page renderers.
- Student assignment submission modal and save/update workflow.
- Assignment create/edit/delete/view-submissions/grade workflows.
- Timetable Board/Table view, search/filter, pagination and official print/export.
- Dynamic table search/filter/pagination and Board/Table switching.
- Configurable page size, default view, search, filtering, late submissions and passkeys in Settings.
- WebAuthn passkey registration/sign-in API integration for HTTPS deployments.
- LocalStorage-first operation so the UI does not become blank when cloud sync is unavailable.

For production passkeys, deploy the project through the included Node/Express server using HTTPS. Static-only hosting cannot execute the included `/api/auth/passkey/*` endpoints unless those endpoints are separately deployed.


## Final pointer corrections in v4
- Light-mode board/detail values use dark text tokens and remain readable against white/light surfaces.
- Passkey registration is compatible with SimpleWebAuthn v10 credential output and validates missing credential data cleanly.
- Passkey sign-in removes the server-only transaction ID from browser WebAuthn options before `navigator.credentials.get()` and preserves it for verification.
- Assignment action bindings were hardened so edit actions no longer rely on accidental globals.
- RUN guide now distinguishes frontend-only Live Server use from the Express server required for passkeys.
