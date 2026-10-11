# E2E / QA Test Mapping — Nakshatra 2026 (2026-10-12)

Source inventory: `docs/manual-test-checklist-2026-10-12.csv` (58 unique items, A-01…J-03).
This document maps every inventory item to its verification status after the
automated E2E pass. **The CSV is the inventory of record and was not edited.**

## How to read the statuses

| Status | Meaning |
|---|---|
| **Automated (MOCKED)** | Executed by the Playwright suite (`e2e/journeys/*`) against the local dev server with the Apps Script endpoint intercepted. No request reached production. Google sign-in uses a locally stubbed GSI script + crafted credential. |
| **Automated (partial)** | The core journey is automated; parts of the item need human eyes or live data (noted per item). |
| **Unit-covered** | Verified by the existing vitest suite (164 tests) rather than a browser journey. |
| **Manual** | Needs a human (visual judgement, DevTools observation, multi-tab interaction). |
| **Blocked** | Cannot be verified without a non-production backend + disposable test spreadsheet (real OAuth, real Sheets sync, deployed round-3 behaviors). |

## Sign-in & session (A)

| ID | Item | Status | Where |
|---|---|---|---|
| A-01 | Approved sign-in redirects to dashboard | **Automated (MOCKED)** | `login-session.spec.ts` — "signs in an approved user and lands on the dashboard" |
| A-02 | Success only after backend confirms | **Automated (MOCKED)** | same file — success panel appears only after the verification POST resolves; "unregistered account" test proves failure is never shown as success |
| A-03 | Login card disappears after navigation | **Automated (MOCKED)** | same file (Sign in heading count 0 after redirect) |
| A-04 | No app shell behind login card | **Automated (MOCKED)** | same file — no sidebar/header when unauthenticated |
| A-05 | Session survives refresh | **Automated (MOCKED)** | same file — reload re-validates via `validateSession`, dashboard restored |
| A-06 | Refresh on #/login with valid session | **Automated (MOCKED)** | same file — "refresh on #/login with a valid session lands on the dashboard" |
| A-07 | Open #/login while signed in | **Automated (MOCKED)** | same file — sign-in guard redirects |
| A-08 | Transient failure keeps session | **Automated (MOCKED)** | same file — 502 envelope: session kept, warning shown, next sign-in recovers |
| A-09 | Invalid session returns to login | **Automated (MOCKED)** | same file — `SESSION_INVALID` → login card |
| A-10 | Unregistered Google account | **Automated (MOCKED)** | same file — honest `NOT_REGISTERED` panel, no session stored |
| A-11 | Adhavan login after identity recovery | **Blocked** | Requires `runIdentityRecoveryCheck` in Apps Script + Adhavan's real account (production data). Also still pending on the user side. |

## Roles & RBAC (A-12…A-14)

| ID | Item | Status | Where |
|---|---|---|---|
| A-12 | ADMIN sees all sections | **Automated (MOCKED)** | `navigation.spec.ts` — all nine section links present; navigation to two sections; Settings reachable |
| A-13 | Limited role sees only permitted sections | **Automated (MOCKED)** | same file — CERTIFICATE_TEAM nav is filtered; forbidden direct URL redirects to dashboard |
| A-14 | ADMIN-only actions gated | **Automated (partial)** | same file (Settings hidden + URL blocked); archive/restore buttons are admin-gated in `homes.ts` (unit-covered); Sync All gating not browser-verified → Manual remainder |

## Metadata preview (B)

| ID | Item | Status | Where |
|---|---|---|---|
| B-01 | Preview requires a valid URL | **Automated (MOCKED)** | `homes-connect-archive.spec.ts` — button disabled until URL entered |
| B-02 | Detected values display | **Automated (MOCKED)** | same file — name/address/phone/participant count shown |
| B-03 | Caretaker contact never the official contact | **Automated (MOCKED)** | same file — Contact Name input stays empty, caretaker listed, warning shown |
| B-04 | Explicit contact prefilled | **Automated (MOCKED)** | same file — connect-journey preview asserts the input value |
| B-05 | Only missing fields prompt | **Automated (MOCKED)** | same file — only "Contact name" hinted when found fields exist |
| B-06 | Invalid URL error | **Automated (partial)** | same file — backend-error path verified ("failed preview"); pure client-side invalid-URL text is Manual (browser URL input blocks typing nonsense) |
| B-07 | Inaccessible sheet | **Automated (MOCKED)** | same file — `SPREADSHEET_ACCESS_FAILED` message, no fake values |
| B-08 | No spreadsheet id exposed | **Automated (MOCKED)** | same file — body text asserted not to contain the id |

## Connect & import (C)

| ID | Item | Status | Where |
|---|---|---|---|
| C-01 | Fresh connect succeeds | **Automated (MOCKED)** | `homes-connect-archive.spec.ts` — connected outcome, home listed without manual refresh |
| C-02 | Connect success + import failure distinct | **Automated (MOCKED)** | same file — `CONNECTION_SUCCEEDED_SYNC_FAILED`-style outcome with backend reason + Retry sync |
| C-03 | Retry sync reuses identity | **Automated (MOCKED)** | same file — asserts exactly 1 `connectShelterSheet`, 1 `syncShelterSheet` |
| C-04 | Already-connected active source | **Automated (MOCKED)** | same file — ALREADY_CONNECTED outcome, no duplicate card |
| C-05 | Archived source | **Automated (MOCKED)** | same file — archived message + restore path pointed out |
| C-06 | HTTP 404 / non-JSON never success | **Automated (MOCKED)** | `api-errors.spec.ts` — HTML 404 page → could-not-confirm outcome, technical detail preserved, no success claim |
| C-07 | Ambiguous failure re-checks homes | **Automated (MOCKED)** | `homes-connect-archive.spec.ts` — 504 HTML + persisted home found → ALREADY_CONNECTED, no false failure |

## Status & contact display (D)

| ID | Item | Status | Where |
|---|---|---|---|
| D-01 | Friendly status labels | **Automated (MOCKED)** | `homes-connect-archive.spec.ts` — Synced/Sync needed labels; raw codes asserted absent |
| D-02 | Contact updates without full refresh | **Manual** | Needs a real sync round-trip changing backend contact values (live Sheets data) |
| D-03 | Technical detail stays in diagnostics | **Automated (partial)** | C-06 journey asserts the friendly message is primary and the raw code appears as detail; other failure surfaces are Manual |

## Archived homes (E)

| ID | Item | Status | Where |
|---|---|---|---|
| E-01 | Archive preview truthful | **Automated (MOCKED)** | `homes-connect-archive.spec.ts` — backend impact counts rendered, no invented numbers |
| E-02 | Archive removes from active list | **Automated (MOCKED)** | same file — truthful banner, card gone, archived section lists home |
| E-03 | Archived participants leave rosters | **Blocked** | Needs backend-enforced roster semantics with real archived data (mock would only re-assert the stub) |
| E-04 | Protected writes rejected clearly | **Automated (MOCKED)** | `attendance.spec.ts` — archived-home mark rejected, backend message surfaced verbatim, nothing marked |
| E-05 | Restore returns the home | **Automated (MOCKED)** | `homes-connect-archive.spec.ts` — restore from empty active list (also covers the fixed archive-lifecycle rendering) |
| E-06 | History preserved after archive | **Blocked** | Requires real historical records; the mock cannot prove non-deletion |

## Attendance (F)

| ID | Item | Status | Where |
|---|---|---|---|
| F-01 | Saved attendance displays on load | **Automated (MOCKED)** | `attendance.spec.ts` — persisted Present on open |
| F-02 | Mark persists and survives refresh | **Automated (MOCKED, partial)** | marks are persisted in the stub store and re-read via `listAttendance` after every write; the literal F5 step is Manual |
| F-03 | Idempotent identical re-save | **Automated (MOCKED)** | same file — double Present save, no conflict |
| F-04 | Update uses expectedVersion | **Automated (MOCKED, partial)** | stub enforces expectedVersion matching (a stale write returns VERSION_CONFLICT); successful version increments asserted indirectly |
| F-05 | VERSION_CONFLICT recovery | **Automated (MOCKED)** | same file — conflict message, forced re-read shows the other writer's value, buttons usable again |
| F-06 | Failed save never shows success | **Automated (MOCKED)** | same file — aborted request: error toast, no success, row back to idle |
| F-07 | Archived/ineligible backend rejection | **Automated (MOCKED)** | same file — exact backend error surfaced (see E-04) |

## Sync All Homes (G)

| ID | Item | Status |
|---|---|---|
| G-01 | Job starts with real id and progress | **Not Run** (candidate for a mocked journey; needs job-polling stubs) |
| G-02 | No duplicate job on refresh | **Not Run** (same) |
| G-03 | Accurate counts | **Not Run** (same) |
| G-04 | Archived homes excluded | **Not Run** (same) |
| G-05 | Cache updated after completion | **Not Run** (same) |

## Loading & reliability (H)

| ID | Item | Status | Where |
|---|---|---|---|
| H-01 | Retry buttons issue real new requests | **Automated (partial)** | `api-errors.spec.ts` (dashboard summary retry re-issues and recovers) + `attendance.spec.ts` (attendance read retry recovers); other pages' Retry buttons are the same component pattern — spot-check Manual |
| H-02 | Existing data stays visible during refresh | **Automated (partial)** | `api-errors.spec.ts` — failed refresh shows an honest error with Retry and keeps the session. Note: the dashboard/homes design REPLACES stale figures with the error panel rather than showing them as current; no data is fabricated or blanked |
| H-03 | No duplicate or stale requests | **Manual** (partial) | C-03 asserts no duplicate connect; full Network-panel observation is Manual |

## Settings & reports (I)

| ID | Item | Status |
|---|---|---|
| I-01 | Settings user management (ADMIN) | **Not Run** — needs `listUsers`/`approveUser` etc. stubs (safety: the E2E stub aborts these today; the aborted-read honesty IS automated in `api-errors.spec.ts`) |
| I-02 | Reports load with real data | **Automated (partial)** — Reports renders in the responsive sweep (heading + no overflow); real-data assertions need stubs → candidate |

## Regression (J)

| ID | Item | Status | Where |
|---|---|---|---|
| J-01 | Login / RBAC / logout intact | **Automated (MOCKED)** | `navigation.spec.ts` — logout calls backend, clears session, returns to login; guards verified across the suite |
| J-02 | Rename sheet-sync verdicts truthful | **Unit-covered** | Round-1/2 vitest suites pin the verdict strings; E2E not attempted (needs real sheet write-back semantics) |
| J-03 | Participant summaries correct | **Automated (partial)** | `participants-events.spec.ts` — page lists participants with home; per-event summary correctness stays Manual/Unit-covered |

## Additional automated coverage beyond the CSV

- `a11y-responsive.spec.ts` — axe-core smoke (login, dashboard, homes, participants, events, attendance; critical/serious = fail) and no-horizontal-overflow sweeps on desktop 1280px, tablet 768×1024 (touch), mobile Pixel 7 emulation; mobile drawer open/navigate journey.
- `api-errors.spec.ts` — safety journey: an unmocked action is aborted at the network layer, never proxied to production.

## Coverage gaps (honest summary)

1. **Blocked on live backend**: A-11, E-03, E-06, and all real-OAuth / real-Sheets behaviors. A non-production Apps Script deployment + disposable test spreadsheet would unlock these.
2. **Not Run**: G-01…G-05 (Sync All job lifecycle) and I-01 (user management) are the largest unautomated areas; both are mockable but need job/user stubs.
3. **Manual by nature**: DevTools-dependent observations (H-03, B-06 client-side variant, F-02 literal F5, D-02), visual design judgement, and multi-tab checks.
4. **Automated axe checks are a smoke screen, not compliance**: they cover the six main routes on one engine (Chromium) in emulated viewports only. They found and verified fixes for real issues (below), but WCAG conformance still needs manual review (keyboard-only walks, screen reader, zoom).
