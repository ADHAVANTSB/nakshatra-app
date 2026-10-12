# Nakshatra 2026 — Technical Architecture

Developer-facing overview of how the system is built. Statuses per the
[README](README.md#reading-the-verification-labels).

## 1. High-level shape

```
Browser
  └── Angular SPA (static hosting, hash routing)
        │  Google Identity Services (OAuth/OIDC) → ID token (credential)
        │  fetch POST (JSON envelope) → Apps Script Web App endpoint
        ▼
Google Apps Script backend (Code.gs, single deployment)
  └── Google Sheets as the persistence layer
        ├── production source spreadsheet (programme data)
        └── per-home shelter spreadsheets (participant sources)
```

- **Frontend:** Angular standalone components with signals (zoneless change
  detection), lazy-loaded route components, SCSS design system in
  `src/styles.scss` + per-page SCSS. Source: `src/app`.
- **Backend:** one Apps Script project (`Code.gs`, ~26 000 lines) exposing
  `doPost` (API router) and `doGet`. Backend files are outside the frontend
  repository scope and are **not modified** by frontend work.
- **Data:** Google Sheets. One authoritative programme spreadsheet plus one
  source spreadsheet per shelter home.

## 2. Frontend structure

```
src/app/
  app.{ts,html,scss}          shell: sidebar, header, footer, account menu,
                              session boot/restore, role-filtered navigation
  app.routes.ts               routes with section guards
  core/
    services/auth/            session storage, guards, role→section matrix
    services/api/             api-client.service.ts — the only backend caller
    models/                   Participant, Event, Team, common enums, etc.
  pages/                      login, dashboard, homes, participants, events,
                              attendance, scoring, results, certificates,
                              reports, settings
  features/                   shelter-homes, imports, events (feature routes)
  e2e/ (repo root)            Playwright suite: stubs + journeys
```

Key frontend decisions:

- **Single API client** — every backend call goes through
  `api-client.service.ts` with envelope validation; malformed responses are
  rejected, never silently accepted.
- **Honest error states** — read failures replace content with an error + Retry;
  success messages appear only after a confirmed response; non-JSON/HTTP error
  pages can never satisfy a success path.
- **Optimistic concurrency** — records carry `version`; updates send
  `expectedVersion`; conflicts surface as reloadable messages.
- **Accessibility** — axe-core smoke in the E2E suite; fixes for focus, labels,
  and contrast are tracked in the QA report.

## 3. Authentication and sessions

1. The app loads Google Identity Services and renders the sign-in button.
2. Google returns a credential (ID token). The app POSTs it to the backend
   (login/verification action).
3. The backend checks the token and its user registry; on success it returns the
   user (role) and an application session (`id`, `expiresAt`, ≤ 8 h).
4. The session is kept in `sessionStorage` (`nakshatra.applicationSession`); on
   boot the app re-validates it (`validateSession`) before restoring the
   authenticated state.
5. Logout calls the backend to invalidate the session, then clears local state.

Authorisation model (frontend `auth.service.ts`):

| Role | Sections |
|---|---|
| ADMIN | all |
| SUPPORT | all + ACCESS_MANAGEMENT |
| EVENTS_TEAM | DASHBOARD, PARTICIPANTS, EVENTS, ATTENDANCE, SCORING, RESULTS |
| LIAISON_TEAM | DASHBOARD, HOMES, PARTICIPANTS, EVENTS, ATTENDANCE, RESULTS |
| CERTIFICATE_TEAM | DASHBOARD, RESULTS, CERTIFICATES |

Guards: `frontendAuthGuard` (session), `sectionAccessGuard` (section), `adminAccessGuard`
(Settings), `signInGuard` (login route redirects authenticated users). The
backend is expected to enforce the same rules server-side; backend-side
enforcement was **not live-verified**.

## 4. API contract

- Single endpoint: the deployed Apps Script `/exec` URL (configured in
  `core/constants/google-identity.config.ts`).
- Transport: `POST`, `Content-Type: text/plain;charset=utf-8`, JSON body:
  `{ action, sessionId?, payload? }`.
- Response envelope: `{ success: true, data, requestId? }` or
  `{ success: false, error: { code, message }, requestId }`. Non-JSON bodies are
  treated as failures — the frontend reports them as "could not be confirmed"
  rather than guessing.
- Actions implemented in the client (30+): `getCurrentUser`, `validateSession`,
  `logout`, `getDashboardSummary`, `listShelterSheets`, `previewShelterSheet`,
  `connectShelterSheet`, `syncShelterSheet`, `getImportStatus`,
  `getValidationResults`, `previewShelterHomeArchive`, `archiveShelterHome`,
  `restoreShelterHome`, `listParticipants`, `getParticipant`,
  `updateParticipant`, `getParticipantEventSummaries`,
  `reconcileParticipantSheetWrites`, `listEvents`, `listEventRegistrations`,
  `listParticipantEvents`, `registerParticipant`, `cancelRegistration`,
  `reactivateRegistration`, `listTeams`, `getTeam`, `createTeam`,
  `addTeamMember`, `removeTeamMember`, `markAttendance`, `listAttendance`,
  `listScores`, `saveScore`, `finalizeScore`, `listUsers`, `adminCreateUser`,
  `requestRegistration`, `approveUser`, `rejectUser`, `disableUser`,
  `enableUser`, `updateUserRole`, `getReports`, `previewDatasetRefresh`,
  `startSyncAllHomes`, `continueSyncAllHomes`, `getSyncAllHomesStatus`.

Known backend contract issues (tracked, not fixable frontend-side):

- **DEF-001 (HIGH):** `doGet` performs no session check and returns production
  spreadsheet metadata. See the
  [acceptance report](acceptance-report-2026-10-12.md).
- `SOURCE_CATEGORY_MISMATCH` warnings fire for valid shorthand categories
  (`SJ`/`J`/`S`/`SS`) because the comparison does not normalise through
  `resolveLevelLabel`.

## 5. Google Sheets data flow

- **Import (sheet → app):** `previewShelterSheet` reads metadata (home name,
  address, phone, participant count, caretaker) without side effects;
  `connectShelterSheet` creates the home/source and imports participants with
  per-row validation (errors vs warnings) and an import version.
  `getImportStatus` / `getValidationResults` report progress and outcomes.
- **Sync (sheet → app):** `syncShelterSheet` re-reads a connected source;
  `startSyncAllHomes` / `continueSyncAllHomes` / `getSyncAllHomesStatus` drive a
  chunked bulk job with a job id.
- **Write-back (app → sheet):** participant renames/updates are written to the
  source row (`reconcileParticipantSheetWrites` reconciles failed writes).
  Verdicts are explicit and pinned by tests, e.g. "Google Sheet updated." and
  "Registration updated in Nakshatra, but the Google Sheet was not changed." —
  the app never claims a sheet write succeeded unless it did.
- **Levels:** calculated from age/standard (Sub Junior 1–3 ≤10, Junior 4–6 ≤13,
  Senior 7–9 ≤16, Super Senior 10–12 ≤19); workbook shorthands SJ/J/S/SS are
  accepted for workbook labels.

*All sheet I/O is implemented against the documented contract but was not
verified against live Google Sheets — no safe test backend/spreadsheet existed
(see the acceptance report).*

## 6. Concurrency and auditing

- Every mutating record (participants, attendance, scores, users) carries
  `version` + audit fields (`createdAt/By`, `updatedAt/By`, source versions).
- Updates must send the expected version; stale writes get `VERSION_CONFLICT`
  (attendance) or equivalent messages, and the UI reloads the authoritative
  values.
- Identical idempotent re-saves are handled without duplicate rows.
- The backend uses request-scoped caches and lock handling (LockService) —
  details live in `Code.gs`.

## 7. Testing landscape

- **Unit:** 164 vitest tests (`npm test`) covering services, guards, and page
  logic.
- **E2E:** Playwright (`npx playwright test`), 3 Chromium projects (desktop /
  tablet / mobile emulation), 44 journeys. A local stub backend intercepts the
  production endpoint; **any unmocked request to production is aborted** (fail-
  closed). Axe-core smoke runs on desktop. See `playwright.config.ts`,
  `e2e/stubs/backend.ts`, `e2e/fixtures.ts`, `e2e/journeys/`.
- **Acceptance status:** `Nakshatra_2026_Technical_Test_Checklist.xlsx`
  (100 cases) and the reports listed in the [README](README.md).

## 8. Not available / not yet built

- Physical-device testing, WCAG conformance certification, OWASP certification.
- Live verification of OAuth, Sheets I/O, and backend-enforced limits.
- Ranking/winner assignment in Results (explicitly out of scope by design).
