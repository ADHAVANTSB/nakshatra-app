# 2026-10-10 — Sync All Homes, Preview Dataset Refresh & carry-over fixes — LEDGER

## Task A — carry-over review fixes (from 2026-10-09 review) — COMPLETE
- I-1: scoring VERSION_CONFLICT → `loadScores(eventId, true)` re-issued (guarded by selection).
- I-2: `lastLoadHadErrors` in ShelterDataService; `ensureLoaded()` re-fires after a failed full load.
- I-3: scoring.loadEvent + attendance.loadEventData await `eventService.load()` before the GROUP check (cold deep links now read teams).
- I-4: forced reads (loadEvents / loadEventRegistrations / loadParticipantEvents) chain behind an in-flight read and resolve with fresh rows.
- M-1: events cardParticipants resolves homeName from `registration.shelterHomeId ?? participant?.shelterHomeId`.
- M-4: attendance service drops the local record on VERSION_CONFLICT → retry sends no `expectedVersion`.
- M-6: category/solo count helpers fall back to the registration row's own `category`/`mode`.
- M-3: homes.syncFromSheet wrapped in try/finally (busy state always releases).
- M-2/M-5: do not exist in the current tree (constants already used; event cards are native buttons). Reviewer findings against an older tree.
- TDD: 7 RED failures observed, then 21/21 GREEN across 5 spec files.

## Task B — api client + models — COMPLETE
- New models: `sync-job.model.ts` (SyncAllHomesJob + results/changes + envelopes), `dataset-refresh.model.ts` (full preview payload).
- api-client: `startSyncAllHomes`, `continueSyncAllHomes`, `getSyncAllHomesStatus`, `previewDatasetRefresh` with strict response validation (`isSyncAllHomesJob`, `isSyncAllHomesData`, preview shape check).

## Task C — SyncAllHomesService — COMPLETE (6/6 tests)
- Drives the backend chunk loop; adopts `alreadyRunning` jobs; COMPLETED vs COMPLETED_WITH_ERRORS distinguished; iteration cap `totalHomes + 2` → never busy forever; continue-failure falls back to a status read before erroring.
- `ShelterDataService.refreshAfterBulkSync(syncedHomeIds)`: homes list + participants + import status for synced homes + force re-read of already-loaded event registrations only (no speculative fan-out).

## Task D — Homes page Sync All panel — COMPLETE (5/5 tests)
- Prominent panel: ADMIN-gated start button, progress `processed / total`, per-home results (SYNCED + change counts / FAILED + backend message), final outcome banners, non-admin note.
- Component: `syncAll` driver exposure, `isAdmin`, `startSyncAll()`, `homeNameById` (unknown ids stay raw).

## Task E — Settings Preview Dataset Refresh panel — COMPLETE (6/6 tests)
- Read-only panel: load/reload + FAILED→retry, tables-to-clear counts, preserved tables, per-workbook impact table, cleanup order, orphan risks, `PREVIEW_ONLY` scope + generatedAt rendered verbatim.
- Asserted NO destructive control renders (no reset/delete/wipe/clear button).
- Junk stub helpers accidentally appended to participants.spec were removed before running.

## §5 rename write-back — VERIFIED + PINNED (16/16 participants tests)
- Flow already implemented (read-back, in-place replace, version, write-back labels). Added regression pins for `describeSourceWriteBack` labels and the pinned toast strings ("Google Sheet updated.", "Registration updated in Nakshatra, but the Google Sheet was not changed.").

## Task F — verification — COMPLETE
- `npm test`: 102/102 across 13 files (was 81/81).
- `npx tsc -p tsconfig.app.json --noEmit`: clean.
- `npm run build`: clean (initial total 339.78 kB raw / 87.17 kB transfer).
- Bundle smoke: 12/12 strings verified (Sync All panel, Preview panel, all five pinned backend-outcome strings, results no-rankings string). Smoke server stopped.
