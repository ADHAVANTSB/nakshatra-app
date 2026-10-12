# Nakshatra 2026 — Administrator Guide

For ADMIN (and where noted SUPPORT) users. Every action here changes data for
other people — read the safety rules first. Statuses follow the
[README](README.md#reading-the-verification-labels).

## 1. Your responsibilities

- Decide who gets access (Settings) and with which role.
- Manage the shelter-home lifecycle: connect sources, keep them synced, archive
  and restore homes.
- Start bulk operations (Sync All Homes) when safe.
- Uphold data safety: no bulk deletes, no production-data resets, no sharing of
  credentials.

## 2. Roles and what they can open

| Role | Sections |
|---|---|
| ADMIN | Everything, incl. Settings |
| SUPPORT | Everything + Imports (access-management area) |
| EVENTS_TEAM | Dashboard, Participants, Events, Attendance, Scoring, Results |
| LIAISON_TEAM | Dashboard, Homes, Participants, Events, Attendance, Results |
| CERTIFICATE_TEAM | Dashboard, Results, Certificates |

Role checks run in the interface **and** on the backend — hiding a menu item is
never the only protection. *Matrix implemented in the frontend; backend
enforcement not live-verified.*

## 3. User management (Settings — ADMIN only)

*Implemented (not live-verified).*

1. Open **Settings** from the sidebar.
2. The user list shows each user's status, role, and audit details. Filter by
   status or role; use **Refresh** for the latest data.
3. **Add user**: register a new user (name, email, role). The user can sign in
   once approved.
4. Approve / reject pending requests. Approval notifies the user by email
   ("User approved. An email has been sent.").
5. Disable / enable accounts; change roles.
6. Every user record carries a version — if two admins edit the same record, the
   conflicting change is rejected instead of overwriting.

Operational notes:

- Prefer the least-privileged role that lets a person work.
- Disable (do not delete) accounts that leave the programme — history stays
  attributable.

## 4. Shelter-home lifecycle

### 4.1 Onboarding a home
1. Have the home prepare its Google Sheet (participants with name, gender, age,
   standard; registration columns; home metadata). The exact template is **to be
   confirmed** — see the open questions at the end.
2. On **Homes → Add shelter home**, preview the sheet's metadata and complete any
   missing fields (a caretaker is never used as the official contact).
3. Connect and watch the import summary. Fix any validation **errors** in the
   sheet and re-run; **warnings** may stay.
4. Verify the participant list afterwards.

### 4.2 Day-to-day sync
- Sync a single home with the card's **Sync** action; status labels show the
  outcome ("Synced", "Sync needed").
- **Sync All Homes** (button on Homes, ADMIN only) runs one backend-managed job
  across all connected homes in chunks with progress reporting. Start it outside
  event hours; it can be re-opened rather than restarted. *Implemented (not
  live-verified).*
- Write-back behaviour: app-side changes are mirrored to participant sheets where
  supported; when a sheet write fails, the app reports it truthfully and offers
  reconciliation ("Registration updated in Nakshatra, but the Google Sheet was
  not changed."). *Implemented (not live-verified).*

### 4.3 Archive and restore
*Verified (mocked).*

1. **Preview first** — the archive dialog shows the real impact counts from the
   backend (registrations, records affected). Previewing performs no writes.
2. Confirm the archive. The home leaves the active list and appears under
   **Archived homes**; all history is preserved; archived homes are excluded from
   active syncs and rosters.
3. New writes for archived-home participants (attendance, scoring, team
   membership) are **rejected by the backend** — this is protection, not a bug.
4. **Restore** returns the home to active use. The restore path stays reachable
   even when the active-home list is empty.

## 5. Operational safety rules

- Use disposable test homes and spreadsheets for any trial — never experiment on
  production records.
- Never bulk-delete or reset attendance/scoring history.
- Do not share accounts; each person signs in with their own Google identity.
- When reporting problems, include messages and times — never participant
  personal data, tokens, or session values.
- Known open backend issue **DEF-001**: the backend's unauthenticated GET returns
  spreadsheet metadata. Track its fix in the
  [acceptance report](acceptance-report-2026-10-12.md).

## 6. What ADMINs should check periodically

- Settings: pending access requests, roles of people who changed teams.
- Homes: homes stuck in "Sync needed"; homes whose caretaker contact changed.
- Reports: totals that look wrong compared to known attendance/score counts.
- The technical testing checklist (`Nakshatra_2026_Technical_Test_Checklist.xlsx`)
  for cases still marked Not Run / Blocked.

## 7. Open questions needing backend/deployment confirmation

1. Deployed backend version and configured limits (event caps, level rules).
2. Certificate generation enablement ("Generate when configured").
3. Canonical shelter-home workbook template.
4. Status of the DEF-001 backend fix.
