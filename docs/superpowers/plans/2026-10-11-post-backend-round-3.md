# Post Backend Round 3 — Implementation Plan

Scope: Angular frontend only. Backend source of truth: `../Code.gs` (read-only).

## Verified backend contracts (read from Code.gs today)

### Session (§1)
- `SESSION_DURATION_HOURS = 8` (line 41) — backend-owned; frontend must not extend.
- Session lookup: any invalid/expired/revoked session → `SESSION_INVALID` (line 2354).
- Frontend login flow already: backend-verified credential → APPROVED check → session required
  → store via session service → `navigateByUrl('/dashboard')` after 900ms.
- App shell (`app.html`) renders `@if (!isAuthenticated()) { <router-outlet> } @else { shell }`.
  **Bug A:** refreshing on `/login` with a persisted session — startup validation completes →
  `isAuthenticated()` flips true while the router still shows `/login` → shell wraps the login card.
  **Bug B:** nothing re-navigates `/login` → `/dashboard` after successful startup validation.
  **Bug C:** `validateStartupSession` treats transient failures (NETWORK_ERROR, REQUEST_TIMEOUT,
  SERVER_RESPONSE_MALFORMED) the same as definitive `SESSION_INVALID` → erases a valid session.

### previewShelterSheet (§2) — router line 265, handler 3826
- Payload `{ spreadsheetUrl }`; read-SHELTER permission.
- Response data (to be confirmed field-by-field from handler 3826–4010 during Task 2):
  `spreadsheetName`, `metadata{homeName,address,contactName,contactPhone}`, `metadataContactSource`
  (`'CARETAKER_LABEL'` ⇒ contact name is inferred, NOT an official contact → warning
  `METADATA_CONTACT_INFERRED_FROM_CARETAKER`), `metadataMissing[]`, `caretakers[]`,
  `participantCount|null`, warnings/errors. Never render any spreadsheet id (response has none).

### connectShelterSheet (§3)
- Payload `{homeName,address,contactName,contactPhone,spreadsheetUrl,runInitialSync?}`;
  `runInitialSync = payload.runInitialSync === true` (line 4012) — **default false**.
- Fresh connect success: `{shelterHome, sheetSource, connection:{status:'SUCCEEDED'}, initialImport:{attempted,status,importVersionId?|errorCode,errorMessage}}`.
- Import failed inside connect: `success:true, code:'CONNECTION_SUCCEEDED_SYNC_FAILED'` — never fold into plain success.
- Already-connected active source: success + `alreadyConnected:true`, `code:'ALREADY_CONNECTED'|'CONNECTION_SUCCEEDED_SYNC_FAILED'`, existing home/source returned.
- Already-connected archived source: error `SHELTER_HOME_ARCHIVED` + `canRestore:true`.
- Api-client maps HTTP 404 / non-JSON to `SERVER_RESPONSE_MALFORMED` (never success) — pin with regression test.
- Lost-response scenario (404 page after backend persisted the connection): frontend must
  verification-re-read `listShelterHomes()` and match by preview `spreadsheetName` (fallback homeName)
  before declaring total failure.

### syncShelterSheet (§3/§4)
- Payload `{shelterHomeId}` → `runShelterHomeSync` (8277). **Does NOT write contact/home metadata**
  back to ShelterHomes — only participants. Contact values on cards come from `listShelterHomes`;
  after sync the store re-read (already implemented) shows whatever backend holds. Backend
  capability note goes in the final report.

### attendance (§6)
- `listAttendance` router 597, handler 16437: payload `{eventId?, participantId?, teamId?, status?}`
  → `{attendance:[...]}` enriched (eventName, eventCode, fullName, shelterHomeId, shelterHomeName,
  teamName). Archived-home participants excluded server-side. **Frontend has no client method today —
  root cause of "existing attendance never displays".**
- `markAttendance` (15926): payload `{eventId, participantId, teamId?, status:'PRESENT'|'ABSENT', expectedVersion?}`;
  fresh mark → `{attendance}`; re-mark → `{attendance, updated:true}`; identical re-mark → idempotent;
  `VERSION_CONFLICT` (with currentVersion) on stale re-mark; archived-home gate rechecked in-lock →
  error message "…belongs to an archived shelter home. Restore …".

### §5 archived rosters
Server-side filtering (14013+). Frontend duty: active operational reads must not request
`includeArchived`; archived/permission errors surfaced verbatim.

### §7 Sync All Homes — verified in earlier rounds (job adoption on refresh, truthful progress).
### §8 — Retry buttons for load errors landed in round 2; this round covers login/preview/connect/attendance.

## Tasks (TDD: RED → GREEN per task)

### Task 1 — Session restoration & login navigation (§1) — files: `src/app/app.ts`, `app.html`, `app.spec.ts`
1. Track the active URL (`currentUrl` signal updated from Router events); shell branch renders only
   when `isAuthenticated() && !isLoginRoute()`; bare `<router-outlet>` otherwise → the shell can
   never wrap the login card.
2. `validateStartupSession`: classify errors —
   - Definitive (`SESSION_INVALID`, `SESSION_REQUIRED`, `USER_NOT_APPROVED`) → logout (current behavior).
   - Transient (`NETWORK_ERROR`, `REQUEST_TIMEOUT`, `SERVER_RESPONSE_MALFORMED`, `INVALID_SESSION_RESPONSE`,
     `API_REQUEST_FAILED`) → KEEP the session, non-destructive warning; next real API call re-checks.
   - Success + current route `/login` → `navigateByUrl('/dashboard')`.
3. Session expiry unchanged (backend 8h; no local extension).
Tests (app.spec.ts): transient failure keeps session; definitive failure logs out; successful
validation while on `/login` navigates to dashboard; authenticated user on `/login` renders no shell.

### Task 2 — `previewShelterSheet` client + models (§2) — files: `api.model.ts`, `api-client.service.ts` (+specs)
1. Read handler 3826–4010 field-by-field; model `ShelterSheetPreviewData` + `PreviewShelterSheetPayload`.
2. Client `previewShelterSheet(payload)` with the same validation discipline as the round-2 actions.
Tests: valid response accepted; `success:false` and malformed shapes rejected with preserved error.

### Task 3 — Metadata preview UI (§2) — files: `pages/homes/homes.ts/.html` (+spec)
1. Preview button (enabled iff URL valid); signals `previewing/preview/previewError`.
2. Detected-values panel: home name, address, contact phone, participant count (when non-null),
   caretaker details in their own section, warnings listed verbatim.
3. Prefill ONLY empty fields with detected values; contact name prefilled only when the backend
   explicitly identifies it (not `CARETAKER_LABEL`); caretaker-inferred contact stays in the
   caretaker section with the backend warning shown.
4. `metadataMissing` drives "not found in the sheet — please enter" hints; no spreadsheet ids anywhere.
Tests: preview displays returned values; caretaker-inferred contact not silently used; only-missing
prompts; no spreadsheet id rendered.

### Task 4 — Connect/import outcome states (§3) — files: `pages/homes/homes.ts/.html` (+spec)
1. `ConnectShelterSheetPayload += runInitialSync: true`; connect performs connection + initial
   import in one round-trip; outcome machine from the response:
   `CONNECTED` (import SUCCEEDED) / `SYNC_FAILED` (code `CONNECTION_SUCCEEDED_SYNC_FAILED` or
   `initialImport.status==='FAILED'`) / `ALREADY_CONNECTED` (`alreadyConnected:true` → existing home,
   View + Sync actions) / `ARCHIVED_SOURCE` (`SHELTER_HOME_ARCHIVED`, `canRestore:true` → restore path) /
   `SOURCE_ACCESS_FAILED` / `REQUEST_ERROR` (concise message + raw technical detail preserved).
2. Ambiguous connect transport failure (malformed/timeout/network) → verification re-read
   `listShelterHomes()`; match preview `spreadsheetName` (fallback homeName): found active →
   `ALREADY_CONNECTED`; found archived → `ARCHIVED_SOURCE`; not found → `REQUEST_ERROR`.
3. `retryConnectionImport()`: `syncShelterSheet({shelterHomeId})` with the EXISTING id only — never a
   second connect → no duplicate homes. Retry returns controls to idle in every terminal path.
Tests: 404/non-JSON connect response never shows success; verification re-read finds the home;
connect success + import failed represented distinctly + Retry; Retry reuses identity (connect
called once); archived source shows restore path; sync failure keeps connection state.

### Task 5 — Friendly status labels + contact refresh (§4) — files: `pages/homes/homes.ts` (+spec)
1. `connectionStatusLabel(home)` mapping: `ARCHIVED`→'Archived'; import `RUNNING`→'Syncing';
   `COMPLETED`→'Synced'; `COMPLETED_WITH_ERRORS`→'Synced with warnings'; `FAILED`→'Sync failed';
   source connected, no completed import → 'Sync needed'; otherwise 'Connected'. Backend fields stay
   in the model; technical detail available in the detail/tooltip, not in the primary label.
2. Contact refresh after sync = existing store re-read (regression test kept/pinned); report notes
   backend does not write contact metadata on sync.
Tests: label mapping table; raw codes absent from primary labels.

### Task 6 — Attendance read + VERSION_CONFLICT recovery (§6) — files: `api.model.ts`, `api-client.service.ts`, `core/services/attendance/attendance.service.ts`, `pages/attendance/attendance.ts` (+specs)
1. `ListAttendancePayload`/data models; client `listAttendance` (validated; no `includeArchived`).
2. `AttendanceService.loadEventAttendance(eventId, force?)` — deduped concurrent, per-event cache;
   records merged so `getByParticipantEvent` returns persisted values.
3. `attendance.ts` `loadEventData` also loads attendance for the selected event; VERSION_CONFLICT
   on save → drop stale local record (existing) + forced `loadEventAttendance(eventId, true)` +
   clear user feedback; failed saves never render as saved; every path returns buttons to idle.
Tests: existing values display on load; idempotent identical re-save handled; VERSION_CONFLICT →
forced fresh read issued + feedback; roster read sends no `includeArchived`; archived-home backend
error surfaced verbatim; failed save not successful.

### Task 7 — Full verification (§10)
`npm test`; `npx tsc --noEmit -p tsconfig.app.json`; `npm run build`; `git diff --check`; bundle
string smoke; 13-section final report separating offline tests from live blockers (backend round-3
code not yet deployed to /exec).

## Hard rules carried through
- No edits to `Code.gs`, `appsscript.json`, backend tests, DATABASE_SCHEMA.
- No mock success; no invented actions; exact contract names only.
- Preserve uncommitted work; leave changes uncommitted.
