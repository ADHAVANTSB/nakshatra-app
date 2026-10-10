# Post-Backend-Round-2 Finalization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native inline, per established session convention).

**Goal:** Integrate backend round-2 contracts (archive lifecycle, batch event summaries, rename sync verdict + reconcile, archived-home exclusion) and finish table redesign + remaining review fixes — frontend only.

**Architecture:** New contracts enter through `api-client.service.ts` with strict response validation; batch summaries live in `ParticipantEventService` (one request per home, deduped, merged by `participantId`); archive lifecycle is a Homes-page flow (preview → confirm → archive → refresh; restore from an archived section); rename sync verdict extends the existing save flow with a reconcile retry.

**Tech Stack:** Angular 21 signals, vitest (ng test), existing store/dedup patterns.

**Spec:** user message 2026-10-11 "FRONTEND FINALIZATION AFTER BACKEND ROUND 2".

## Global Constraints
- Frontend only; never edit `Code.gs`, `appsscript.json`, backend verification, DATABASE_SCHEMA.
- No mock/fake success; no fabricated data; exact backend errors preserved.
- Only ADMIN performs archive/restore (frontend visibility is not the security boundary).
- Never delete any records/spreadsheets from the frontend.
- Maxima come from `NAKSHATRA_EVENT_RULES` (6 total / 2 per category / 3 solo), never hardcoded.
- Work on top of HEAD `9ff05ac` (tree is clean; user commits themselves — no commits by me).

## Verified backend contracts (Code.gs, read-only)
- `previewShelterHomeArchive` {shelterHomeId} → `{shelterHome{id,homeCode,homeName,status}, source{spreadsheetName,sourceStatus,spreadsheetOpenUrl}, impact{participantCount,activeRegistrationCount,attendanceCount,scoreCount,certificateCount,auditHistoryCount}, triggerCleanupRequired}` (ADMIN).
- `archiveShelterHome` {shelterHomeId, expectedVersion?, reason?} → `{shelterHomeId, status:'ARCHIVED', alreadyArchived?, version, triggerRemoved, impact}`; `VERSION_CONFLICT` w/ currentVersion (ADMIN).
- `restoreShelterHome` {shelterHomeId, expectedVersion?, reason?} → `{shelterHomeId, status:'ACTIVE', alreadyActive?, version, triggerReinstallRequired}` (ADMIN).
- `listShelterHomes` accepts `{includeArchived:true}`; archived excluded by default; rows carry `status`.
- `getParticipantEventSummaries` {shelterHomeId?, participantIds?} → `{summaries:[{participantId,participantCode,fullName,events:[{eventId,eventName,category,mode,registrationStatus:'REGISTERED'}],activeEventCount,artsCount,literaryCount,culturalCount,soloCount}], issues:[{code:'EVENT_REFERENCE_NOT_FOUND'|'DUPLICATE_REGISTRATION_ROWS',participantId,eventId?,count?}]}`; REGISTERED-only.
- `updateParticipant` response now also `{sheetsSynchronized:boolean, syncReasons:string[]}` (legacy `sourceWriteBack` still present).
- `reconcileParticipantSheetWrites` {participantId} → `{participantId, reconciled, sheetsSynchronized, reasons[], source, eventWise}` (write PARTICIPANTS).

## Already complete (verified, no rework)
- Sync All Homes panel + job driver + terminal states + targeted refresh (§6) — reuse; archived homes never reach it because the active list excludes them and the backend checks home status.
- §8 review findings I-1/I-2/I-3/I-4/M-1/M-4/M-6 fixed with regression tests. Remaining: load-error panels lack Refresh/Retry buttons (Task 6).

### Task 1: Models + api-client (archive trio, summaries, reconcile, includeArchived)
- [x] Models: `ShelterHomeArchiveImpact`, `ShelterHomeArchivePreviewData`, `ArchiveShelterHomeData`, `RestoreShelterHomeData`, `ParticipantEventSummaryEntry/Issue/SummariesData` + payloads; `UpdateParticipantData += sheetsSynchronized?, syncReasons?`; `ListShelterHomesPayload` add `includeArchived?`.
- [x] api-client: `previewShelterHomeArchive`, `archiveShelterHome`, `restoreShelterHome`, `getParticipantEventSummaries`, `reconcileParticipantSheetWrites` with strict validation (INVALID_* envelope on shape mismatch).
- [x] Test: spec-level (via Task 2/4 service specs exercising these routes through stubbed fetch).

### Task 2: Batch event summaries in ParticipantEventService (§4)
- [x] State: `summaryEntries` (map by participantId), `summaryIssues`, per-home state map + in-flight dedupe, `loadSummariesForHomes(homeIds, force=false)` — one request per home, `LOADED` only when every requested home read succeeded, never re-fires on cache hit unless force.
- [x] `summaryFor(participantId)` → entry|null; `issuesFor(participantId)`.
- [x] Spec: batch single request per home; dedupe on re-navigation; force re-fires; cancelled rows absent; issues surfaced; merge keyed by participantId; failure → per-home FAILED + retry.

### Task 3: Participants table redesign (§3)
- [x] Remove Eligibility/Validation/Approval/Lock/Source columns from primary table; columns = Participant | Shelter Home | Gender/Age/Standard | Level | Participating Events | Actions.
- [x] Hide participantCode, homeCode, source/import/version identifiers in rows (keep in state/detail/search matching).
- [x] Identity cell: name emphasized, no code line. Actions: "View/Edit" + "Manage events" buttons (buttons stop propagation; keyboard accessible).
- [x] CSS: word-break/ellipsis so long names/events never overlap columns; responsive.
- [x] Spec (DOM, rendered fixture): codes absent from tbody; removed column headers absent; actions buttons present; long-name safety class applied.

### Task 4: Event-name summary display (§4)
- [x] Row Events cell: grouped real event names — "Arts: A, B / Literary: None / Cultural: C" + counts `3 / 6`, `2 / 2` ×3, solo `1 / 3` from `NAKSHATRA_EVENT_RULES`; compact when >4 events with "View all"/"Manage events" expansion; issues chip (duplicate/missing reference) with truthful tooltip; LOADING/FAILED/Retry states preserved.
- [x] Spec: names grouped from backend entry; counts from entry (not recomputed); cancelled names never shown; unknown category grouped under "Uncategorised" without inventing counts; issues chip text.

### Task 5: Rename sync verdict + reconcile retry (§5)
- [x] participants.ts save flow: `sheetsSynchronized === true` → existing success; `false` → truthful partial-sync warning listing `syncReasons` + "Retry sheet write" button → `reconcileParticipantSheetWrites({participantId})` → on success refresh participant read-back + batch summaries; on failure show backend error + keep retry. No "Google Sheet updated" claim when false.
- [x] Spec: VERDICT false renders recovery state with reason; reconcile success refreshes (read-back + summaries called); reconcile failure keeps retry; true path unchanged (existing pins).

### Task 6: Load-error Retry buttons (§7/§8 leftover)
- [x] `retryStoreLoad()` on participants/events/scoring/attendance/results/certificates pages (forces re-read via store `refresh()`); wire a Retry button into each main load-error alert (homes already has Refresh).
- [x] Spec: one helper-level test per page asserting the delegate (force refresh invoked once).

### Task 7: Archive lifecycle on Homes (§2)
- [x] Per-home row menu (ADMIN only): "Archive home…" → preview panel/modal via `previewShelterHomeArchive` showing impact counts + source + `triggerCleanupRequired`; confirmation text explicitly states "archived/deactivated — not permanently deleted"; confirm → `archiveShelterHome` with `expectedVersion` → busy → success removes home from active list (`loadConnectedHomes()` force re-read) → truthful banner incl. `triggerRemoved`; failure → backend message + Retry; VERSION_CONFLICT → re-read + re-preview.
- [x] Archived homes section: `listShelterHomes({includeArchived:true})` merged client-side (one request); ARCHIVED rows get Restore (ADMIN) → `restoreShelterHome` → refresh → if `triggerReinstallRequired === true` show explicit notice "source trigger needs reinstall — use Install source trigger on the home" (never claim restored).
- [x] No deletions anywhere; historical data untouched.
- [x] Spec: preview called before confirm + counts rendered; archive success removes from active list; failure keeps home + retry; ADMIN gating; restore success + triggerReinstallRequired notice.

### Task 8: Verification
- [x] `npm test` (all files), `npx tsc -p tsconfig.app.json --noEmit`, `npm run build`, bundle smoke strings; final 14-section report.

## Review Focus
- Cancelled registrations must not appear in any active count/name (summaries API guarantees; pin in Task 2/4 tests).
- No "Google Sheet updated" claim when `sheetsSynchronized === false` (Task 5 test pins the warning path).
- Archive confirm flow must never fire `archiveShelterHome` before a preview was shown (Task 7 test).
- Batch discipline: exactly one summaries request per home per load; dedupe on re-navigation (Task 2 test).
- Internal codes (participantCode/homeCode/import ids/versions) absent from the rendered participant rows (Task 3 DOM test).
