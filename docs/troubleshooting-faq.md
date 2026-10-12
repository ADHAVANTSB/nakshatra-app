# Nakshatra 2026 — Troubleshooting & FAQ

Common symptoms, what they mean, safe checks you can do, and when to escalate.
Nothing here requires technical privileges. Statuses: behaviours marked
**Verified (mocked)** are proven by automated tests (frontend + simulated
backend); the Google-side steps of some flows are **not live-verified** yet.

## Sign-in problems

### "My Google account is not registered" (not registered panel)
- **Meaning:** your Google account is valid but no Nakshatra user record is
  approved for it. Nothing was signed in; no session was stored.
- **Fix:** ask an ADMIN to add/approve your account in **Settings** (or via the
  registration request flow). Then sign in again.

### Sign-in succeeds in Google, but the app stays on the sign-in card
- **Meaning:** the backend check did not complete (network/backend hiccup).
- **Safe checks:** refresh the page; try again in a minute. The app is designed
  to show success **only after** the check passed — it will never fake it.
- **Escalate** if it happens repeatedly; include the approximate time.

### You were signed out unexpectedly
- Sessions last up to 8 hours and are re-checked when the app starts. Being
  returned to the Sign in page means the backend reported the session invalid or
  expired — sign in again. If this happens constantly, escalate.

### Someone else's data appears / wrong role visible
- Roles come from the backend user record. Ask an ADMIN to check your role in
  Settings. Menu items you lack permission for are hidden by design.

## Shelter homes & import problems

### Preview shows "could not be confirmed" / SERVER_RESPONSE_MALFORMED
- **Meaning:** the backend could not read the source (for example the sheet link
  returned an error page). Nothing was created.
- **Safe checks:** confirm the sheet link opens in your browser; confirm the
  account that owns the sheet granted access; retry the preview.

### "Already connected" when connecting a sheet
- **Meaning:** that spreadsheet is already the source of an existing home (or an
  archived one). No duplicate is created.
- **Safe checks:** look for the home card in the list (or under Archived homes)
  and use **View / Sync** or restore it.

### "Connected, but the import failed"
- **Meaning:** the connection succeeded; reading/validating rows failed. The
  backend's reason is displayed.
- **Safe checks:** use **Retry sync** — it reuses the same home (no duplicate);
  check the sheet's participant columns for empty names or invalid ages.

### Import shows many "Source category does not match Nakshatra calculated level" warnings
- **Meaning:** the sheet's Category column does not match the level Nakshatra
  calculates from Age + Standard. **Known quirk:** if the column uses the
  shorthand `SJ`, `J`, `S`, or `SS`, the comparison reports a mismatch even when
  the data is right (backend comparison gap, recorded as a defect).
- **Safe checks:** compare a participant's Age/Standard against the level table
  in the [user guide](user-guide.md#glossary); prefer full labels
  ("Sub Junior") in the sheet. Nakshatra's calculated level is authoritative.

### "Participant … appears more than once for event … The duplicate row was ignored"
- **Meaning:** the same participant is listed twice for that event in the sheet;
  only the first row was imported.
- **Fix:** remove the duplicate row in the sheet and sync again.

### "This home is archived" when connecting its sheet
- **Meaning:** the spreadsheet belongs to a home that was archived.
- **Fix:** an ADMIN can restore the home from the Homes page, or connect a
  different sheet.

### Sync status says "Sync needed"
- **Meaning:** the last sync did not fully succeed (or has not run). Use the
  card's **Sync** action; use **Sync All Homes** (ADMIN) for a bulk refresh.
  *Sync itself is Implemented (not live-verified).*

## Editing & concurrency problems

### "This participant was updated elsewhere. Refresh and try again."
- **Meaning:** another user saved a change to the same record first. Your save
  was **rejected** so nothing was overwritten.
- **Fix:** refresh/reload the record, re-apply your change, save again.

### "Attendance was updated elsewhere. The latest saved values have been reloaded - try again."
- **Meaning:** the same protection for attendance. The list already shows the
  latest saved values — mark again.

### "Registration updated in Nakshatra, but the Google Sheet was not changed."
- **Meaning:** the app-side change succeeded but the write-back to the
  participant's sheet failed. The app-side data is correct and the app says so
  honestly; use the sheet reconciliation/retry path offered by the screen.
  *Write-back: Implemented (not live-verified).*

## Loading & network problems

### A page shows an error with a Retry button
- **Meaning:** the read failed (network or backend). The app replaces the content
  with the error instead of showing numbers it cannot verify — this is by design.
- **Safe checks:** press **Retry** (it issues a real new request); check your
  connection. Your session is not lost by a failed read.

### An action "hangs" or a button stays busy
- Buttons return to a normal state when the request finishes (success or
  failure). If a bulk **Sync All Homes** job is running, progress is shown and
  the button is intentionally disabled until the job ends.

### Duplicate submissions worry
- Repeating an identical attendance save is safe by design. Registration and
  connection flows are protected against creating duplicates (the backend
  reuses the existing identity).

## Security & privacy expectations

- Only approved accounts get in; the session is stored only in your browser's
  session storage and is cleared on logout.
- Never paste tokens, session values, or participant details into public issue
  trackers. When reporting an error, include the **error message, time, and
  screen** — not personal data.
- Known open backend issue (DEF-001, tracked in the acceptance report): an
  unauthenticated request to the backend URL can return the production
  spreadsheet's name and sheet structure. This is a backend fix; it does not
  expose participant rows.

## Escalation guidance

1. Note the screen, the exact message, and the time.
2. Try the safe checks above once.
3. Report to an ADMIN (or the support contact) with those details. If the ADMIN
   cannot resolve it, they escalate to the development team with the same
   information — plus, for recurring failures, the browser and network used.

## Questions that still need confirmation

These cannot be answered from the current code and tests, and are deliberately
not guessed:

- Which event-limit values are configured in the deployed backend (limits exist
  and are enforced server-side; the deployed values were not verified).
- Whether certificate generation is enabled in production ("Generate when
  configured").
- Whether live Google Sheets sync behaves identically to the documented
  contract in every case (no live test environment was available; see the
  [acceptance report](acceptance-report-2026-10-12.md)).
