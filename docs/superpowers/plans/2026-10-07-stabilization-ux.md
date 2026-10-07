# Stabilization + UX + E2E Flow Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Angular app production-robust: honest login error states, guaranteed terminal async states everywhere, all-in-one participant detail, collapsible event navigation, backend-backed logout with user menu, and source-sync UX — without masking the known backend blocker (Apps Script `script.external_request` scope).

**Architecture:** Shared `ApiClientService` remains the single transport (already preserves backend envelopes, distinguishes timeout/network/malformed, 120s ceiling). Login gets the same error semantics via a tolerant fetch wrapper. Shell gets a real user menu + backend-backed logout. Page UX tasks touch disjoint page folders so they can run in parallel.

**Tech Stack:** Angular 21 standalone + signals, vitest via `ng test`, no new dependencies.

**Spec:** User message "APPLICATION STABILIZATION + UX + END-TO-END FLOW AUDIT" (2026-10-07).

## Global Constraints
- Frontend only; never touch `Code.gs`, Apps Script, DB schema.
- No mock/fallback data; no fabricated sync timestamps; backend errors preserved verbatim.
- Never render raw IDs (shelterHomeId, participantId, spreadsheet IDs) — use backend display fields.
- No ranking/winners; certificates stay disabled; attendance is context only.
- Native `@if`/`@for` with `track`; no `ngClass`/`ngStyle`; keep Nakshatra visual language and existing class names.
- No artificial delays; the 120s request ceiling already exists — do not add others.
- Exact strings preserved: "Google Sheet updated.", "Registration updated in Nakshatra, but the Google Sheet was not changed.", "This participant was updated elsewhere. Refresh and try again.", "Attendance is context only; it is not required to score.", "This view does not assign rankings or winners."

## Review Focus
- Login response that is HTML (not JSON): must show SERVER_RESPONSE_MALFORMED-style message, never "check your connection", loading must clear — pinned in Task 1 tests.
- Login HTTP 500 with valid error body (the UrlFetchApp case): backend message shown verbatim — Task 1 test.
- Double-click Refresh during in-flight refresh: no duplicate request, button returns to idle — pinned in Task 2 tests.
- Logout when backend call fails: user still logged out locally, warning shown, redirected — Task 2 test.
- Participant detail with zero registered events: shows empty state, not error — Task 3 step check.
- Event card expand for GROUP event with zero registrations: empty state "No participants registered." — Task 4 step check.
- Homes with `lastSyncedAt: ''` (backend line 2752): "Never synced", never a fabricated date — Task 5 step check.

---

### Task 1: Login error semantics (auth-critical, owner: main agent)

**Files:**
- Modify: `src/app/pages/login/login.ts` (`verifyCredential`, lines ~204-250)
- Test: `src/app/pages/login/login.spec.ts` (new)

**Interfaces:**
- Produces: `verifyCredential` behavior — backend error body shown verbatim in `error()` signal; non-JSON body → "The sign-in server returned a non-JSON response (HTTP n)."; network failure → "Unable to verify your Google account. Check your connection and try again."; timeout (AbortController, 120s, reuse semantics) → timeout message; `loading()` always terminates in `finally`.

- [ ] Write failing tests: (a) HTML 302 body → malformed message, loading false; (b) HTTP 500 + `{success:false,error:{code:'PERMISSION_DENIED',message:'You do not have permission to call UrlFetchApp.fetch…'}}` → message shown verbatim; (c) successful `{access:'APPROVED',user…,data:{session}}` → navigates to /dashboard; (d) retry: second click after failure issues a new request; (e) rejected fetch → network message, loading false.
- [ ] Run `ng test` — new tests fail.
- [ ] Implement tolerant handling in `verifyCredential` (mirror ApiClientService.post: try-parse JSON, preserve error body over !ok, AbortController 120s, distinguish abort/network).
- [ ] Run `ng test` — pass. **Known backend blocker (do not workaround, do not code-fix):** UrlFetchApp scope missing in deployed Apps Script — report only.

### Task 2: User menu + backend-backed logout (owner: main agent)

**Files:**
- Modify: `src/app/app.ts`, `src/app/app.html`, `src/app/app.scss` (minimal), `src/app/pages/login/login.scss` if needed
- Test: extend `src/app/app.spec.ts`

**Interfaces:**
- Consumes: `ApiClientService.invalidateApplicationSession()` (already: `post('logout')` + `auth.logout()`).
- Produces: `loggingOut` signal; `signOut()` = busy → backend logout → local clear → `/login`; on backend failure: warning notification with backend message, STILL clears local session and redirects (never traps the user); user dropdown: name, role, My Account (→ /settings or disabled), Settings (role-gated), Logout.

- [ ] Write failing tests: backend logout action invoked once; session cleared; redirect to /login; protected route (App shell) unrenders; backend failure → warning + still logged out.
- [ ] Implement menu + `loggingOut` terminal states.
- [ ] Run tests → pass.

### Task 3: Participant detail all-in-one view (owner: subagent A)

**Files:** `src/app/pages/participants/participants.ts/.html/.scss` only.

**Requirements:** Identity grid with: Name, Participant ID (participantCode — backend display code, not raw id), Shelter Home (name), Gender, Age, Standard, Level, Eligibility, Validation status, Approval status, Lock status, Source row (`sourceRowNumber`), Source version (`sourceVersionId` shown as backend value or "—"), Registered event count. Registered events grouped ARTS/LITERARY/CULTURAL with event name, type (Individual/Group from `mode`), registration status, Cancel where permitted (existing rules). [Add Event] opens existing picker flow; duplicate registration prevented by existing checks. Empty groups hidden; zero events → "No registered events". Loading/error/empty distinct. Participant→Event link: /events?eventId=…&expand=1.

### Task 4: Collapsible event cards (owner: subagent B)

**Files:** `src/app/pages/events/events.ts/.html/.scss` only.

**Requirements:** Events render as collapsible cards: header "▼/▶ Name" + "CATEGORY • Individual/Group" + "Registered: N" (N = ACTIVE registrations; "—" if registrations failed to load). Expanding lazy-loads registrations (existing per-event loads). Expanded body: event fields incl. eligible levels + participant list (Name/Age/Standard/Level/Shelter Home) or loading/empty/error state. Actions: Participants (→ /participants?shelterHomeId=… no — → /participants with focus), Attendance, Scoring, Results — router links preserving event context via query params; each target page must accept `eventId` query param to preselect. No new data, no ranking.

### Task 5: Source-sync UX on Homes (owner: subagent C)

**Files:** `src/app/pages/homes/homes.ts/.html/.scss` only.

**Requirements:** Connected-home source section from `listShelterHomes` metadata only: Source Sheet (name, opens `spreadsheetOpenUrl` in new tab), Source Version (import versionNumber from cached import records), Last Synced (`lastSyncedAt` formatted; empty/absent → "Never synced"), Sync Status (`sourceStatus` verbatim). [Sync from Google Sheet] button calls existing `syncShelterSheet`, busy terminal state, result surfaces sync summary + errors verbatim; refreshes homes/imports after. If a metadata field is absent → "—", never fabricated.

### Task 6: Full verification (owner: main agent)

- [ ] `npx tsc -p tsconfig.app.json --noEmit` clean.
- [ ] `npm test` all pass.
- [ ] `npm run build` clean.
- [ ] Cross-check exact strings from Global Constraints survive in subagent output (grep).
