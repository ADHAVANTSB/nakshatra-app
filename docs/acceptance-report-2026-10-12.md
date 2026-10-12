# Nakshatra 2026 — Full-Stack Acceptance Test Report (2026-10-12, run 2)

QA lead acceptance run against the 100-case workbook
(`docs/Nakshatra_2026_Technical_Test_Checklist.xlsx`, 99 cases + SEC-003 added by this run).
Companion documents: `docs/qa-report-2026-10-12.md`, `docs/e2e-test-mapping-2026-10-12.md`,
`docs/manual-test-checklist-2026-10-12.csv`.

## 1. Environment & preflight (performed before any request)

| # | Prerequisite | Finding |
|---|---|---|
| 1 | Non-production backend URL | **MISSING.** The only configured endpoint (`google-identity.config.ts`) is the production Apps Script `/exec` deployment. No staging URL exists anywhere in the repo. |
| 2 | Deployed backend supporting frontend actions | Deployed and reachable (live probes below); deployment version is not recorded in the repo or reports. |
| 3 | Authorized test account/role | **MISSING.** Real OAuth requires interactive human Google sign-in; no test credentials were provided to the agent. |
| 4 | Disposable shelter home + test spreadsheet | **MISSING.** None exists; creating one requires the owner's Google account. |
| 5 | Approved real OAuth / Sheets access | **MISSING.** |
| 6 | Backend failure-log correlation | **MISSING** for a test deployment; production Apps Script logs were not accessed. |

**Verdict: safe live acceptance testing was NOT possible.** Per the preflight rule, no
mutating request was sent to production at any point — zero writes, zero credential
attempts, no identity recovery, no permission changes. Exactly three credential-free,
read-only probe requests were made (section 3). All live write-path scenarios are
**Blocked**, each with its missing prerequisite and unblock action.

## 2. Automated gates — actual outputs from this run (2026-10-12, 12:19–12:35)

| Command | Result |
|---|---|
| `npm test` | **164/164 passed** (14 files), 41 s |
| `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `npm run build` | success (`dist/nakshatra-app`) |
| `npx playwright test` (desktop/tablet/mobile) | **124 passed, 8 project-skips, 0 failed** (132 executions = 44 journeys × 3 projects), 8.5 min — includes the axe-core accessibility smoke |
| `git diff --check` | exit 0 |

Fail-closed protection held: the suite aborts any unmocked request to the production
endpoint; no production call occurred during the entire Playwright run.

## 3. Live probes (the only live executions — read-only, credential-free)

| Probe | Request | Timestamp (local) | Result | Latency |
|---|---|---|---|---|
| L1 | `POST {"action":"validateSession"}` without sessionId | 2026-10-12 ~12:05 | HTTP 200, structured JSON envelope `{"success":false,"error":{"code":"SESSION_REQUIRED",...}}`, no sensitive data — **correct rejection** | 2 550 ms |
| L2 | Plain `GET /exec` (no session) | 2026-10-12 ~12:07 | **DEF-001 (HIGH):** HTTP 200 JSON `success:true` carrying the real production spreadsheet name and its sheet names with row/column counts — an unauthorized information-disclosure path | 3 378 ms |

Cross-check: `Code.gs` `doGet()` (line 126, read-only inspection — **not modified**)
opens `SOURCE_SPREADSHEET_ID` and returns spreadsheet metadata with **no session
check**; the POST router enforces sessions, doGet does not. This is a backend defect.

**Defect register:**

| ID | Severity | Summary | Component | Smallest safe next action |
|---|---|---|---|---|
| DEF-001 | HIGH | Unauthenticated GET returns production spreadsheet metadata (name + sheet structure). No participant PII observed in the response — metadata only — but it is an unauthorized access path. | `Code.gs` `doGet` (backend — outside my permitted scope) | Owner: gate `doGet` to require a valid session (or return no metadata), redeploy, then re-run probe L2 expecting a rejection. No frontend change needed. |

## 4. Results by journey (workbook IDs)

### A. Authentication & authorization — mocked PASS, live BLOCKED
- AUTH-001…006, 009…012, 014: **Pass (mocked)** (Playwright, GSI stub, this run).
- AUTH-007 (multi-profile isolation): **Not Run** — manual.
- AUTH-008: **Pass (mocked)** (UI gating + forbidden-URL redirect); backend enforcement remainder noted.
- AUTH-013: **Blocked** — identity recovery + real account (untouched per instructions).
- Live OAuth: **Blocked** — missing prerequisite #3/#5.

### B. Shelter homes & import — mocked PASS, live BLOCKED
- HOME-001…009, 011, 012, 014…016, IMPORT-001: **Pass (mocked)** — preview metadata, missing-field prompts, contact provenance/prefill, connect, connected-but-import-failed + retry reusing identity, already-connected, archived source, inaccessible sheet, 404/non-JSON never success, ambiguous-failure re-check, friendly labels, ID hidden.
- HOME-010, HOME-013: **Blocked / Not Run** — live sync round-trip / manual URL-typing variant.
- **Defect regression verified:** archive lifecycle reachable from zero active homes (fix re-proven this run).

### C. Participants & event rules — server-side rules NOT verifiable safely
- PART-001: **Pass (mocked)** (page render + home mapping); PART-002…007: **Not Run** (mockable).
- Live business-rule enforcement (age/class eligibility, 35-participant & 2-caretaker home limits, 6-event / 2-per-category / 3-solo limits, quiz SJ+J & S+SS pairings): **Blocked** — these are *server-enforced* rules; verifying them requires write requests with an authorized account against a disposable home. The workbook's PART-004…006 rows were **not** relabeled.
- Quiz pairing logic remains covered by unit tests only (frontend-side eligibility helpers).

### D. Google Sheets synchronization — BLOCKED (all)
- SYNC-001…009: **Blocked** — two-way sync, rename reconciliation, retries, conflicts, Sync-All all require a non-production backend + disposable spreadsheet. No sync success was inferred from mocks; all SYNC rows remain `Blocked` with the prerequisite stated.

### E. Attendance, teams, scoring — mocked PASS, live BLOCKED
- ATT-001…009 (incl. persistence, idempotency, expectedVersion, VERSION_CONFLICT recovery, archived-home rejection, failed-save honesty): **Pass (mocked)**.
- SCORE-001…003, TEAM-001/002, RESULT-001, CERT-001: **Not Run** (mockable; flows exist in UI but no browser journeys were written for them this run).

### F. Reports & certificates
- REPORT-001: **Not Run** (page renders in responsive sweep; totals comparison needs disposable data). CERT-001: **Not Run**. No real certificates were issued or sent.

### G. Responsive web & accessibility — mocked PASS
- COMP-003…005, RESP-001/002: **Pass (mocked/emulation)** — desktop 1280, tablet 768×1024 touch, mobile Pixel 7; no horizontal overflow; mobile drawer journey passes.
- A11Y-001: **Pass (mocked)** — axe smoke clean on six routes after the 2026-10-12 fixes. **This is a smoke signal, not WCAG compliance.**
- A11Y-002/003 (keyboard-only, screen reader): **Not Run** — manual.
- COMP-006 (physical devices): **Not Run** — emulation does not prove physical-device compatibility.

### H. Reliability, security & data integrity
- API-001/003/005/006, ATT-008/009, DATA-005: **Pass (mocked)** — errors/malformed responses never display success; unknown actions aborted; honest empty/error states.
- **API-004: `Pass (live)`** — live probe L1: structured `SESSION_REQUIRED` rejection, no data leak, no bypass used.
- **SEC-003: `Fail` (DEF-001, HIGH)** — live probe L2: unauthenticated metadata disclosure.
- SEC-001: **Pass (mocked)** (session cleared on logout; no tokens in evidence). SEC-002 (XSS): **Not Run**.
- PERF-001/002: timing evidence limited to the live probe latencies (2.55 s / 3.38 s round-trip, residential network, n=1 each — no performance claim made); page-level timings not measured this run.

## 5. Workbook update (this run)

- Backup: `docs/Nakshatra_2026_Technical_Test_Checklist.backup-2026-10-12_123124.xlsx`.
- `API-004` → `Pass (live)` with probe evidence (prior `Not Run` noted in Notes).
- New `SEC-003` → `Fail`, defect DEF-001, P0.
- Execution Guide: `Pass (live)` added to allowed statuses with its definition.
- Coverage Map: X-03 → `API-004; SEC-003` = `Fail | Pass (live)`; all statuses recomputed.
- Final tally (100 cases): **53 Pass (mocked) · 1 Pass (live) · 1 Fail · 12 Blocked · 2 Retest · 31 Not Run.**
- No mocked result was relabeled as a live pass; prior evidence preserved.

## 6. Release decision

**FAIL.**

Grounds (per the gate criteria): a **high-severity unauthorized access path remains** —
DEF-001 exposes production spreadsheet metadata to unauthenticated callers (verified
live, confirmed in code). Independently, all two-way-synchronization, live-OAuth and
server-enforced business-rule acceptance tests are Blocked (missing prerequisites), so
"required tests passed" is not satisfiable today either.

Not failing on: the frontend itself — 164/164 unit, clean build/type-check, 124/124
applicable E2E, zero open frontend defects from this run.

**Smallest safe next actions:**
1. **DEF-001 (owner, backend):** add a session check to `doGet` (or return no metadata), redeploy, re-run probe L2 expecting rejection → then re-evaluate the gate.
2. **Live acceptance enablement (owner):** create a non-production Apps Script deployment + disposable test spreadsheet + authorized test account; record the deployment version. This unblocks the 12 Blocked cases (auth, RBAC server-side, all SYNC, HOME-010, ADMIN-006, E-03/E-06 remnants).
3. **QA (frontend, unblocked):** mocked journeys for PART-004…007, SCORE-001…003, TEAM-001/002 to shrink the 31 Not Run cases.

## 7. Explicit non-claims

No production readiness, no live synchronization verification, no real-OAuth
verification, no physical-device verification, no WCAG/OWASP compliance certification,
and no performance benchmark is claimed. Evidence above covers exactly what was executed.
