# Final UI Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audited frontend gaps — participant event summaries, events category grouping, post-sync home refresh, request dedupe/refresh economy, and conflict/retry states — against the real backend contract only.

**Architecture:** All reads stay on the existing shared `ShelterDataService` store (root signals). Participant event summaries are computed from per-event `listEventRegistrations` reads cached in that store (no bulk-read action exists in the backend; per-participant reads would fan out N≈150+ requests, per-event is bounded by the active event catalogue and shared with the Events page). Counts use the existing `ParticipantEventService` helpers and `NAKSHATRA_EVENT_RULES` denominators. No mock data, no fabricated success.

**Tech Stack:** Angular 21 standalone components + signals, Vitest, existing `ApiClientService` (120s abort ceiling, non-throwing envelopes).

**Spec:** conversation spec "NAKSHATRA 2026 — FRONTEND CONTINUATION AND FINAL UI STABILIZATION" (sections 1–15).

## Global Constraints

- FRONTEND ONLY. Never modify `Code.gs`, `appsscript.json`, backend tests, `DATABASE_SCHEMA`.
- Do not change Google identity binding or auth rules; preserve the 11 uncommitted login/session files as-is; do not commit.
- No mock/fake data; every count/label computed from backend-returned registrations; no fabricated Sheet-sync success.
- Preserve exact strings: "Google Sheet updated.", "Registration updated in Nakshatra, but the Google Sheet was not changed.", "This participant was updated elsewhere. Refresh and try again.", "This view does not assign rankings or winners.", "User approved. An email has been sent."
- Results = finalized scores only, no ranking/winners; certificates stay disabled.
- Every async operation reaches a terminal state; duplicates prevented without blocking the first request.

## Review Focus

- Registrations not yet loaded (page just opened): rows must show "—"/loading, never `0` — pinned by participants.spec "shows a placeholder until the summary loads".
- Summary read failure: retry offered, no fabricated zero counts — participants.spec.
- Duplicate concurrent per-id reads must collapse to one fetch — shelter-data.service.spec.
- Page re-navigation must not re-fire the full 3N+2 fan-out — shelter-data.service.spec `ensureLoaded` test.
- Cancelled/waitlisted rows must never be counted as registered — participants/events specs assert REGISTERED-only counting.

---

### Task 1: ShelterDataService — dedupe, ensureLoaded, loadEvents guard

**Files:**
- Modify: `src/app/core/services/shelter-homes/shelter-data.service.ts`
- Test: `src/app/core/services/shelter-homes/shelter-data.service.spec.ts` (new)

**Interfaces:**
- Produces: `ensureLoaded(): Promise<ShelterDataResult>` — resolves immediately (`{success:true, errors:[]}`) when `loaded()` is true, else delegates to `refresh()`; `loadEvents(force = false)` — no-op returning cached events when `eventsLoaded()` and not forced; private in-flight `Map` dedupe for `loadEventRegistrations`, `loadParticipantEvents`, `loadParticipants`, `loadImportStatus`, `loadValidationResults`, `loadConnectedHomes`.

- [ ] **Step 1: Write failing tests** — concurrent `loadEventRegistrations('e1')` x2 → 1 `listEventRegistrations` fetch, both callers get the same rows; `ensureLoaded()` with populated store → 0 fetches; `loadEvents()` twice → 1 `listEvents` fetch, `loadEvents(true)` re-fetches; concurrent `loadParticipants('h1')` x2 → 1 fetch.
- [ ] **Step 2: Run** `npx vitest run src/app/core/services/shelter-homes/shelter-data.service.spec.ts` → FAIL.
- [ ] **Step 3: Implement** per interfaces above (promise maps + `finally` cleanup; existing cache `Set`s unchanged).
- [ ] **Step 4: Run spec** → PASS.

### Task 2: Page inits stop re-firing the full fan-out

**Files:**
- Modify: `src/app/pages/participants/participants.ts`, `events/events.ts`, `attendance/attendance.ts`, `scoring/scoring.ts`, `results/results.ts`, `certificates/certificates.ts`, `homes/homes.ts` — replace `void this.shelterData.refresh()` at `ngOnInit` with `void this.shelterData.ensureLoaded()`.
- Refresh buttons keep `refresh()` (forced re-read).

- [ ] **Step 1:** Grep all `shelterData.refresh()` call sites; change init calls only.
- [ ] **Step 2:** Run full `npm test` → all existing suites PASS (behavior change is fewer requests, not different states).

### Task 3: Participants — event summary on rows, per-category counts + sectioned detail

**Files:**
- Modify: `src/app/pages/participants/participants.ts`, `participants.html`, `participants.scss`
- Test: `src/app/pages/participants/participants.spec.ts` (extend)

**Interfaces:**
- Consumes: `ShelterDataService.loadEventRegistrations(eventId, force?)`, `EventService.load()`, `ParticipantEventService.getParticipantEventCount/getParticipantCategoryCount/getParticipantIndividualCount`, `NAKSHATRA_EVENT_RULES` (maxTotalEventsPerParticipant=6, maxEventsPerCategory=2, maxIndividualEvents=3).
- Produces: `readonly registrationSummaryState: Signal<'IDLE'|'LOADING'|'LOADED'|'FAILED'>`; `loadRegistrationSummary(force = false): Promise<void>` (loads event master, then all ACTIVE events' registrations in parallel; always terminal); `retryRegistrationSummary(): void`; `eventSummary(participantId): {total:number; maxTotal:number; arts:number; literary:number; cultural:number; solo:number; maxCategory:number; maxSolo:number} | null` (null while summary not loaded/failed).

- [ ] **Step 1: Write failing tests** — stubbed store with 3 REGISTERED rows across ARTS/LITERARY/CULTURAL (one SOLO): row shows `3 / 6`, `Arts 2 / 2`-style counts, solo `1 / 3`; cancelled rows not counted; summary loading shows placeholder (not `0`); failed summary shows retry; `loadRegistrationSummary` failure is terminal (no stuck spinner); detail panel shows "Personal details" and "Operational status" headings and per-category counts in the Registered events section.
- [ ] **Step 2: Run participants.spec** → new tests FAIL.
- [ ] **Step 3: Implement** per interfaces; row cell = compact `total / maxTotal` + per-category line; detail identity grid split into the two labelled sections (template reorg only, all fields kept); Registered events header gains `Total 3 / 6 · Arts 2 / 2 · Literary 0 / 2 · Cultural 1 / 2 · Solo 1 / 3` computed from the open participant's own registrations.
- [ ] **Step 4: Run participants.spec** → PASS.

### Task 4: Events — category grouping, collapsed eligible levels, registration status column

**Files:**
- Modify: `src/app/pages/events/events.ts`, `events.html`, `events.scss`
- Test: `src/app/pages/events/events.spec.ts` (new)

**Interfaces:**
- Produces: `groupedEvents(): Array<{category: EventCategory; events: Event[]}>` — canonical ARTS/LITERARY/CULTURAL order, respects existing search/category filter, omits empty groups.

- [ ] **Step 1: Write failing tests** — stub 3 events (one per category): three category headers render in canonical order with cards under each; search filter removes a group header; collapsed card shows eligible levels text; expanding triggers exactly one `listEventRegistrations` and the expanded table renders WAITLISTED/CANCELLED rows with a status badge (REGISTERED count on header unchanged); Attendance/Scoring/Results links carry `eventId`.
- [ ] **Step 2: Run events.spec** → FAIL.
- [ ] **Step 3: Implement** — wrap existing card loop in category sections; add collapsed levels line (backend `event.eligibleLevels` via `PARTICIPANT_LEVEL_LABELS`); widen `cardParticipants` to all rows + status badge column (header count stays REGISTERED-only).
- [ ] **Step 4: Run events.spec** → PASS.

### Task 5: Homes — sync success refreshes that home's participant count

**Files:**
- Modify: `src/app/pages/homes/homes.ts`
- Test: `src/app/pages/homes/homes.spec.ts` (new)

- [ ] **Step 1: Write failing test** — after `syncShelterSheet` success, `listParticipants(home.id)` is re-read and the card count updates without a full page `refresh()`; failure leaves prior state and shows the existing error toast.
- [ ] **Step 2: Run homes.spec** → FAIL.
- [ ] **Step 3: Implement** — in the success branch add `await this.shelterData.loadParticipants(home.id)` (existing import-status reload stays).
- [ ] **Step 4: Run homes.spec** → PASS.

### Task 6: Scoring + attendance — conflict states and registrations retry

**Files:**
- Modify: `src/app/pages/scoring/scoring.ts`, `scoring.html`; `src/app/core/services/attendance/attendance.service.ts`
- Test: `src/app/pages/scoring/scoring.spec.ts` (new), `src/app/core/services/attendance/attendance.service.spec.ts` (new)

**Interfaces:**
- Produces: `Scoring.retryRegistrations(): Promise<void>` (reuses the existing registrations load path at scoring.ts:278–302); scoring save failure `VERSION_CONFLICT` → "This score was updated elsewhere. Refresh and try again."; attendance mark failure `VERSION_CONFLICT` → "Attendance was updated elsewhere. Refresh and try again." (backend `error.code` already available in `AttendanceService.markAttendance` result mapping).

- [ ] **Step 1: Write failing tests** — registrations FAILED state renders a Retry control that re-issues `listEventRegistrations`; saving with backend `VERSION_CONFLICT` shows the conflict message (score input preserved); attendance mark with `VERSION_CONFLICT` shows the attendance conflict message.
- [ ] **Step 2: Run new specs** → FAIL.
- [ ] **Step 3: Implement** per interfaces.
- [ ] **Step 4: Run new specs** → PASS.

### Task 7: Whole-suite verification

- [ ] `npm test` → all suites pass; regressions fixed; pre-existing unrelated failures reported separately.
- [ ] `npm run build` and `npx tsc -p tsconfig.app.json --noEmit` → clean.
- [ ] Serve `dist/nakshatra-app/browser` locally and confirm 200 + new bundle strings (no authenticated browser flows possible without real Google accounts — report honestly).
