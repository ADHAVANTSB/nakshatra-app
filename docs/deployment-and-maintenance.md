# Nakshatra 2026 — Deployment & Maintenance

For developers/operators. Statuses per the [README](README.md#reading-the-verification-labels).
This document describes the frontend project's verified build/test tooling and
the deployment considerations that follow from the architecture. Anything that
could not be confirmed from this repository is listed as an open question rather
than invented.

## 1. Configuration

| Item | Where | Notes |
|---|---|---|
| Backend endpoint | `src/app/core/constants/google-identity.config.ts` (`verificationEndpoint`) | Currently the **production** Apps Script `/exec` URL. There is no staging configuration — changing this file is how you would point the app at a test backend. |
| Google OAuth client | same constants file | Client ID used by Google Identity Services. |
| Session storage key | `sessionStorage['nakshatra.applicationSession']` | `{id, expiresAt}`; cleared on logout. |
| Frontend tests config | `playwright.config.ts` | 3 projects; webServer `ng serve --port 4200`. |

**Important:** with the endpoint pointing at production, treat all local
Playwright runs against the real URL as forbidden — the E2E suite therefore
intercepts the endpoint (fail-closed) and aborts any unmocked request.

## 2. Build and test commands (all verified in this repository)

```
npm ci                # install dependencies
npm test              # 164 vitest unit tests
npx tsc --noEmit -p tsconfig.app.json   # type check
npm run build         # production build -> dist/nakshatra-app
npx playwright test   # E2E (mocked backend, 3 projects) - 124 pass / 8 skips
git diff --check      # whitespace hygiene
```

Continuous integration: `.github/workflows/qa.yml` runs the same gates on
pull requests and pushes to `main` (added 2026-10-12; kept separate from any
deployment workflow).

## 3. Deployment

- The frontend is a static Angular bundle (`dist/nakshatra-app`) served via hash
  routing, designed for static hosting (e.g. GitHub Pages). The deployment
  workflow (`deploy-pages.yml`) is referenced by project documentation but is
  **not present in this working copy** — confirm its location before relying on
  it.
- The backend is a Google Apps Script Web App (`Code.gs`) deployed separately.
  Frontend work never modifies it.

Deployment checklist (frontend):

1. All gates from section 2 pass.
2. `google-identity.config.ts` points at the intended backend (production vs
   test).
3. The deployed backend supports **all** actions the frontend sends (see the
   action list in [technical-architecture](technical-architecture.md#4-api-contract)).
4. The build output hash/name is noted for rollback comparison.

## 4. Rollback considerations

- **Frontend:** static hosting makes rollback a re-deploy of the previous build
  output. Keep the last known-good `dist/` artefact (or rely on the hosting
  provider's versioning).
- **Backend:** Apps Script deployments are versioned; use "Deploy → Manage
  deployments" to redirect the web app to a previous version. Coordinate with
  the spreadsheet schema — a backend rollback must match the data version the
  frontend expects.
- **Config-only rollback:** reverting `verificationEndpoint` to the previous URL
  is itself a deployable change.
- No database exists outside Google Sheets; "data rollback" means restoring
  spreadsheet versions (Google Sheets file version history) — use with extreme
  care and never on production without owner approval.

## 5. Maintenance procedures

- **Dependency updates:** run the full gate set after any update; Playwright and
  axe-core are dev-only and low-risk.
- **Endpoint health check:** a credential-free `POST {"action":"validateSession"}`
  must return the structured `SESSION_REQUIRED` error envelope (2–4 s). *(Do not
  rely on `GET` — see known issue below.)*
- **Known open backend issue DEF-001:** unauthenticated `GET /exec` returns
  production spreadsheet metadata. Track the fix; after the fix, the GET probe
  should return a rejection, which becomes the new health check.
- **Test inventory upkeep:** record executed checks in
  `Nakshatra_2026_Technical_Test_Checklist.xlsx` (keep the backups intact).
- **Documentation upkeep:** when a screen changes, update the
  [user guide](user-guide.md) and [features](features-and-workflows.md) pages in
  the same change set.

## 6. Environment safety

- There is currently **no non-production backend**. Until one exists:
  - do not run write-path acceptance tests against production;
  - keep the E2E suite's interception/fail-closed behaviour intact;
  - use disposable spreadsheets for any manual Google-side experiment.
- See the [acceptance report](acceptance-report-2026-10-12.md) for the standing
  blocker list and the smallest safe unblock actions.

## 7. Open questions

1. Location/contents of the deployment workflow (`deploy-pages.yml`) — not in
   this working copy.
2. Deployed backend version identifier and change log.
3. Production frontend URL(s) and who owns the hosting.
4. Backend rollback procedure ownership (Apps Script deployment management).
