# Program & Zone Scope (frontend + backend session) — 2026-10-13/14

Status: **Implemented end-to-end (frontend flow + backend session persistence + server-side scope enforcement, mocked-verified)** — not live-verified, not deployed.

## What was built

After sign-in, every user must complete a two-step scope selection before any
application page opens:

1. **Programme** — Arts or Sports (`/#/select-program`)
2. **Zone** — Zone 1, Zone 2 or Test (`/#/select-zone`)

The selection screens run in a minimal shell (no sidebar / hamburger /
navigation controls; branding + account menu retained). After selection the
scope is persisted **on the server-side session** via the `selectScope` action,
restored by `validateSession` (so refreshes/deep links keep it), and displayed
via the header scope chip and the dashboard scope card. Operational pages keep
the full shell and render normal empty states for live zones.

## Server-side enforcement (backend)

`Code.gs` (implemented, mocked-verified):

- `DATABASE_SCHEMA`: `ShelterHomes` and `Events` gained appended
  `programId` / `environmentId` columns (append-at-end; positional writers
  unaffected). New schema fingerprint:
  `5f0c06081caef3db91077d177412d88ebc8ccaa8c7326e43c6b908c307f7d320`.
- `Sessions` gained the same two columns (production header append via the
  migration; `selectScope` writes them; legacy scope-less sessions fall back
  to the shared TEST data — documented + tested).
- Scope helpers: `resolveSessionScope`, `homeInScope` / `eventInScope`
  (empty environmentId = pre-migration TEST), `buildScopeHomeIdSet` /
  `buildScopeEventIdSet`, `participantInScope`, `scopeMismatchResponse`.
- Enforcement on every scoped read (homes, participants, events, teams,
  attendance, scores, results, certificates, dashboard, reports) and every
  scoped write (registration, teams, attendance upsert, scores, certificates,
  connect/sync/import status+review, archive/restore), all inside the
  existing `withScriptLock` sections.
- New actions: `selectScope` (session persistence + audit), `createEvent`
  (per-scope catalogue), `cancelEvent` (explicit <5-registrations
  cancellation workflow, audited).
- Sync All Homes: candidate homes filtered to the session scope; the job
  record carries `programId`/`environmentId`; continue/status validate scope.
- Source triggers: operate on the home's own stored scope (no session).
- Cross-scope access → `SCOPE_MISMATCH` (flat extras, safe labels);
  missing scope → legacy TEST fallback (documented + tested).

**Legacy Test compatibility rule:** pre-migration rows (empty
`programId`/`environmentId`) are treated as TEST with an unresolved
programme: visible in both programme selections of TEST, never in a live
zone, and never reclassified automatically.

## Key files

| File | Purpose |
| --- | --- |
| `src/app/core/models/program-context.model.ts` | Typed `ProgramId` / `ZoneId` / `ProgramScope` model |
| `src/app/core/constants/program-context.config.ts` | Zone catalogue + dates (Zone 1 `2026-10-25`, Zone 2 `2026-11-01`, Test date not set) |
| `src/app/core/services/program/program-context.service.ts` | Signal-based scope state + server-persistence state (`scopeSaving`/`scopeSaveError`) + `restoreFromBackend` |
| `src/app/core/services/program/program-context.guards.ts` | `programSelectedGuard` / `zoneSelectedGuard` |
| `src/app/app.routes.ts` | Guard chain on every protected route |
| `src/app/pages/select-program/*`, `select-zone/*` | Selection pages (minimal shell, server persistence) |
| `src/app/app.html` / `app.ts` / `app.scss` | Minimal selection shell + header scope chip |
| `src/app/pages/dashboard/*` | Dashboard scope card |
| `Code.gs` | Schema columns, `selectScope`/`createEvent`/`cancelEvent`, scope helpers + gates |
| `backend-verification/proposals/zone-isolation-schema-migration-draft.gs` | Review-only production migration (dry-run/apply, idempotent, fail-safe) |

## Migration + deployment steps (require approval)

1. **Run the migration** against the production DB spreadsheet: DRY_RUN first,
   review the report, then APPLY (appends the columns, stamps existing
   homes/events `TEST`, leaves programmes unresolved and reports them).
   Full runbook: `backend-verification/proposals/README-zone-isolation-migration.md`.
2. **Deploy** the updated `Code.gs` (no new OAuth scopes).
3. Live smoke test: Test workflows, first ZONE_1/ZONE_2 home connection,
   cross-scope denial spot-checks.

## Verification

- Backend: `npm run verify` — **22 suites, 1757 PASS / 0 FAIL** including the
  new `test-zone-isolation.js` (36 checks: scope persistence, read/write
  isolation across TEST/ZONE_1/ZONE_2, catalogue management, <5 cancellation
  rule, legacy fallback, dashboard scoping, sync gating).
- Frontend unit: `ng test` — **199 PASS** (18 files).
- Production build: `ng build` — PASS.
- Playwright: **164 passed / 10 skipped / 0 failed** (desktop + mobile +
  tablet): selection flow, minimal selection shell (no sidebar/hamburger),
  refresh + deep links, switch flows, Test workflows, role guards.
- `git diff --check`: PASS.
- Reference screenshots: `docs/screenshots/` (program-selection,
  zone-selection, scoped-dashboard).
