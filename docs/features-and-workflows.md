# Nakshatra 2026 — Features & Workflows

Each feature below lists its purpose, who can use it, the steps, validation, and
limitations. Status labels follow the [README](README.md#reading-the-verification-labels):
**Verified (mocked)** means automated browser tests cover it (frontend proven,
simulated backend); **Implemented (not live-verified)** means the feature exists
but has not been exercised against the deployed backend.

Contents:

1. [Sign-in and sessions](#1-sign-in-and-sessions)
2. [Shelter homes](#2-shelter-homes)
3. [Participants](#3-participants)
4. [Events, registration and teams](#4-events-registration-and-teams)
5. [Attendance](#5-attendance)
6. [Scoring and results](#6-scoring-and-results)
7. [Certificates](#7-certificates)
8. [Reports](#8-reports)
9. [Settings (access management)](#9-settings-access-management)
10. [Error behaviour everywhere](#10-error-behaviour-everywhere)

---

## 1. Sign-in and sessions

**Purpose:** identify approved users with their Google account. **Who:** everyone
with an approved account. **Status: Verified (mocked).**

Steps:

1. Open the app. The Sign in page shows a Google button.
2. Sign in with your Google account.
3. Nakshatra verifies the account is approved and creates a session (valid up to
   8 hours) before the Dashboard appears.

Validation and rules:

- Unregistered accounts see an honest "not registered" panel; no session is
  stored and no account is created.
- The session survives page refreshes; it is re-checked with the backend on boot.
- An expired or revoked session returns you to the Sign in page.
- A temporary network failure during the start-up check keeps your session and
  shows a warning — you are not thrown out.
- Opening `/#/login` while signed in redirects to the Dashboard.
- Logout (account menu → Logout) invalidates the session on the server and clears
  it in the browser.

## 2. Shelter homes

**Purpose:** register a home and connect its Google Sheet as the source of its
participant data. **Who:** roles with the Homes section (ADMIN, SUPPORT,
LIAISON_TEAM). **Status:** connect/preview/import/retry/already-connected/
archived-source/error handling — **Verified (mocked)**; Sync-All job UI —
**Implemented (not live-verified)**; actual Google Sheet reads/writes —
**not live-verified**.

### 2.1 Connect a home (first import)

1. Open **Homes** → **Add shelter home**.
2. Paste the Google Sheet link. The Preview/Connect buttons stay disabled until a
   link is entered.
3. Click **Preview source metadata**. The app shows the detected home name,
   address, phone, and available participant count.
   - Only fields the sheet could **not** provide need typing in; a clear warning
     tells you which ones are missing.
   - If a caretaker is found in the sheet, it is displayed **separately** and is
     never silently used as the home's official contact.
   - If the sheet contains an explicit official contact, the Contact Name field
     is prefilled from it.
4. Click **Connect Google Sheet**.
5. Read the outcome — one of:
   - **Connected and imported** (with import summary: records processed, valid
     participants, warnings).
   - **Connected but import failed** — shows the backend's reason and a
     **Retry sync** button that reuses the same home identity (no duplicate home
     is created).
   - **Already connected** — the existing home is shown with View/Sync actions.
   - **Archived** — the source belongs to an archived home; restore it instead.
   - **Failure** — invalid or inaccessible sheets produce a structured error; no
     half-created home is left behind; an HTTP error page is never shown as
     success.

Import warnings: rows with data problems produce a **Validation results** list
(warnings do not stop the import; errors do). Note: if the sheet's Category
column uses the shorthand `SJ`/`J`/`S`/`SS`, every row may show a "Source
category does not match" warning due to a known backend comparison gap — the
calculated level is still authoritative.

Privacy: the spreadsheet identifier is never displayed in the interface.

### 2.2 Sync a home

Click **Sync** on a home card to re-read its sheet. The card's status label
("Synced", "Sync needed") updates from the result. **Sync All Homes** (ADMIN,
button on the Homes page) starts one backend-managed job that syncs every
connected home in chunks and reports progress; it can be re-opened instead of
restarted. *Both: Implemented (not live-verified).*

### 2.3 Archive and restore

1. On a home card use the archive action; the app first shows an **impact
   preview** (what will be affected) straight from the backend — no invented
   numbers.
2. Confirm to archive. The home leaves the active list, appears under
   "Archived homes", and its history is preserved.
3. **Restore** returns it to active use — reachable even when the active list is
   empty. **Verified (mocked).**

## 3. Participants

**Purpose:** view and verify imported participants. **Who:** roles with the
Participants section. **Status:** listing — **Verified (mocked)**; detail edit
flow — **Implemented (not live-verified)**.

- The list shows name, code, home, gender, age, standard, and level.
- **Level is calculated by Nakshatra** from age and standard (Sub Junior 1–3,
  Junior 4–6, Senior 7–9, Super Senior 10–12) and cannot be typed in.
- Validation status per participant: PASSED / WARNING / FAILED / NOT_VALIDATED.
- Search by name/code; filters narrow the list.
- "Participating events" summarises each participant's registrations.
- Participant updates use optimistic concurrency: if another user saved a change
  first, your save is rejected with "This participant was updated elsewhere.
  Refresh and try again."

## 4. Events, registration and teams

**Purpose:** manage the competition catalogue, registrations, and teams.
**Who:** roles with the Events section. **Status:** catalogue — **Verified
(mocked)**; registration, limits, and teams — **Implemented (not
live-verified)**.

- The catalogue supports search and category/mode/status filters; each card shows
  registered counts. An **Event Master** section lists the full catalogue.
- Opening an event shows its registered participants (registration status
  badges).
- Registrations: register / cancel / reactivate a participant for an event. The
  **server validates** event limits (total events per participant, per-category
  caps, solo limits, quiz level pairings) — invalid requests are rejected with
  the exact reason and nothing is partially written. The precise limit values are
  owned by the backend configuration.
- Teams (group events): **+ Create Team**, add members from a searchable
  participant list (with a shelter-home filter), remove members. Memberships
  persist with audit fields.
- Cancelled registrations stay in history (status badge), they are not deleted.

## 5. Attendance

**Purpose:** record who attended an event. **Who:** roles with the Attendance
section. **Status: Verified (mocked).**

1. Select the event from the dropdown.
2. Saved marks appear (Present / Absent / Not marked).
3. Click **Present** or **Absent** to mark and save immediately.
4. Re-saving the same status is safe (idempotent — no duplicate or version bump
   as specified).
5. Changing a mark updates the record in place using its version. If another user
   saved first, you see "Attendance was updated elsewhere. The latest saved
   values have been reloaded - try again." and the fresh values — no silent
   overwrite.
6. Read failures show an error with **Retry**; a failed save never reports
   success.
7. Participants from archived homes are rejected by the server for new marks;
   history is untouched.

## 6. Scoring and results

**Purpose:** enter scores and publish locked results. **Who:** Scoring roles
enter scores; Results is visible to more roles. **Status: Implemented (not
live-verified).**

- Scores are saved per event with the same version-conflict protection.
- **Finalize** locks the scores ("Scores are locked at finalization" — Results
  states this explicitly).
- Results show only finalized scores; drafts never leak into Results.
- This view does not assign rankings or winners.

## 7. Certificates

**Purpose:** track certificate records for finalized results. **Who:
CERTIFICATE_TEAM** and admins. **Status: Partial.**

- Lists finalized-score entries (draft scores are excluded) with participant /
  team, shelter home, final score, and certificate status/audit.
- A certificate status does **not** indicate a placement or award.
- Generation appears as "Generate when configured" — the generate action depends
  on configuration and has not been verified.

## 8. Reports

**Purpose:** programme totals. **Who:** roles with the Reports section.
**Status: Implemented (not live-verified).** Totals are read from the backend for
the selected scope; failures show an error with Retry, never zero-filled fakes.

## 9. Settings (access management)

**Purpose:** manage application users. **Who: ADMIN only** (the route is
admin-guarded; SUPPORT uses the related Imports area). **Status: Implemented
(not live-verified).**

- User list with status and role filters, search, refresh.
- **Add user**, approve, reject, disable, enable, and change role. Approval sends
  the user an email ("User approved. An email has been sent.").
- Each user record carries a version; conflicting administrative changes are
  rejected rather than overwritten.

## 10. Error behaviour everywhere

Across the app (Verified (mocked)):

- Success is shown **only** after the server confirmed the action.
- HTTP errors, non-JSON responses, and aborted requests are reported as failures
  with a plain-English message; technical codes stay in a diagnostics detail.
- Failed reads replace content with an error + **Retry** (no fabricated or
  stale-as-current data); the session is kept.
- Concurrency conflicts reload the latest values instead of overwriting.
