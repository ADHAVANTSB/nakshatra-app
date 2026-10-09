# Sync All Homes, Preview Refresh & Carry-over Fixes — Plan

**Spec:** "NAKSHATRA 2026 — FRONTEND ONLY: Participant Workflow, Event Summary and Global Synchronization".
**Constraints:** frontend only; real backend contracts; no fabricated success; every request terminal.

## Backend contracts verified in Code.gs (read-only; DO NOT EDIT)

- `startSyncAllHomes` (ADMIN) → `{alreadyRunning:boolean, job:publicSyncAllJob}`; processes first chunk synchronously (chunkSize default 2). Errors: `NO_CONNECTED_HOMES`, `LOCK_TIMEOUT`, `SYNC_ALL_ACTIVE_*` handled via `alreadyRunning:true`.
- `continueSyncAllHomes` (ADMIN) `{jobId}` → same envelope; terminal job → `SYNC_JOB_ALREADY_FINISHED`.
- `getSyncAllHomesStatus` (read IMPORT) `{jobId?}` → `{active:boolean, job|null}` (active job when no id).
- `publicSyncAllJob`: `{jobId, status:'RUNNING'|'COMPLETED'|'COMPLETED_WITH_ERRORS'|'FAILED', chunkSize, totalHomes, processedHomes, results[], startedAt, updatedAt, finishedAt}`.
- result per home: `{shelterHomeId, status:'SYNCED', changes:{createdParticipantCount, updatedParticipantCount, unchangedParticipantCount, createdRegistrationCount, updatedRegistrationCount, sourceChanged, reorderingDetected}} | {shelterHomeId, status:'FAILED', error:{code,message}}`.
- `previewDatasetRefresh` (ADMIN) → `{scope:'PREVIEW_ONLY', destructive:false, generatedAt, backupRequired, separateTestDeploymentRecommended, tableCounts{participants,participantEvents,attendance,scores,certificates}, preservedTables[], cleanupOrder[], orphanRisks[], connectedHomes[{shelterHomeId,spreadsheetName,participantCount,registrationCount,rowsProposedForArchive}], triggerInventory[]}`. **No destructive reset action exists — implement preview panel only.**

## Tasks

### Task A — carry-over review fixes (from 2026-10-09 review; serve spec §5/§7)
RED→GREEN, batched:
- [ ] A1 (I-1) scoring.spec: VERSION_CONFLICT → `scoringService.loadScores(eventId, true)` re-issued. Fix: conflict branch in `report()` force re-reads scores (guarded by selectedEventId).
- [ ] A2 (I-2) shelter-data.spec: `ensureLoaded()` after a failed full load re-fires the load. Fix: `lastLoadHadErrors` flag consulted by `ensureLoaded`. Pages: add `retryStoreLoad()` + Refresh button to each main load-error alert (participants, events, scoring, attendance, results, certificates).
- [ ] A3 (I-3) scoring.spec + attendance.spec: cold deep-link GROUP event triggers `listTeams`. Fix: await `eventService.load()` before resolving `isGroup` in `loadEvent`/`loadEventData`.
- [ ] A4 (I-4) shelter-data.spec: forced read queued behind an in-flight read returns fresh rows. Fix: chain forced read after pending (`loadEventRegistrations`, `loadParticipantEvents`, `loadEvents`).
- [ ] A5 (M-1) events.spec: `cardParticipants` resolves shelter home from `registration.shelterHomeId` when participant not cached.
- [ ] A6 (M-4) attendance.spec: after VERSION_CONFLICT the local record for that pair is dropped so the retry mark sends no `expectedVersion`.
- [ ] A7 (M-6) participant-event.service.spec (new): category/solo counts fall back to the registration row's own `category`/`mode` when the event master lacks the event.
- [ ] A8 (M-2/M-3/M-5) template/refactor one-liners: drawer "6" → rules constant; syncFromSheet try/finally; space-key a11y on events card. (No observable behavior change → refactor ruling; ledger.)

### Task B — api client + models
- [ ] Models: `SyncAllHomesJob`, `SyncAllHomesResult`, `SyncAllHomesData {alreadyRunning, job}`, `SyncAllHomesStatusData {active, job}`, `DatasetRefreshPreviewData` (+ payload types).
- [ ] api-client: `startSyncAllHomes(payload?)`, `continueSyncAllHomes({jobId})`, `getSyncAllHomesStatus({jobId?})`, `previewDatasetRefresh()`; strict response validation (`isSyncAllHomesJob` minimal: jobId/status strings, numeric counters, results array).

### Task C — SyncAllHomesService (core/services/imports/sync-all-homes.service.ts)
- Signals: `state` ('IDLE'|'STARTING'|'RUNNING'|'COMPLETED'|'COMPLETED_WITH_ERRORS'|'ERROR'), `job`, `startedAt`.
- Drive: start → loop `continue` while `job.status === 'RUNNING'`; iteration cap `totalHomes + 2` → never busy forever; adopt `alreadyRunning:true` jobs.
- Terminal: on COMPLETED*/COMPLETED with synced homes → `shelterData.refreshAfterBulkSync(syncedHomeIds)` (homes + their participants + import status + force-reload of loaded event registrations). COMPLETED_WITH_ERRORS stays retryable (new start).
- Targeted refresh test: after terminal job, exactly one `listShelterHomes`, one `listParticipants` per synced home, one `listEvents`, registrations re-read only for previously loaded events.

### Task D — Homes page: Sync All Homes panel
- Prominent card: Start button (ADMIN — hide/disable for non-admin with note), progress `processedHomes / totalHomes`, per-home result list (SYNCED + change counts / FAILED + backend message), final outcome banner, Retry.
- Never blocks page load; leaving page does not abort (service is root-provided).

### Task E — Settings: Preview Dataset Refresh panel
- "Preview Dataset Refresh" section: Load preview → renders tableCounts, preserved tables, cleanup order, connected-home impact. Explicit note: preview only; no reset action exists in the backend, so no destructive button is rendered.
- Error/empty/retry states; `generatedAt` shown.

### Task F — verification + final report
- `npm test`, `npm run build`, tsc; smoke strings; final report with API actions consumed and blockers (listAttendance now exists backend-side but is out of scope here).

## Review Focus
- No request fan-out: one `continue` per chunk; no polling loops that could run away (iteration cap).
- `COMPLETED_WITH_ERRORS` ≠ success; banner must say so and offer Retry.
- Preview panel renders backend numbers verbatim; no reset button.
- Rename flow keeps pinned write-back strings and refreshes counts in place (verify, extend tests only if absent).
