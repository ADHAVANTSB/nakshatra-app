# Nakshatra 2026 — User Guide

This guide is for anyone using Nakshatra 2026 for the first time. It explains how
to sign in, move around the application, and what each screen shows.

Everything described here reflects the application as it is built today. Where a
behaviour has not yet been verified against the real Google backend, it is marked
**Implemented (not live-verified)** — the screen exists and works as described in
the application, but the Google-side steps were not part of testing.

---

## 1. What Nakshatra 2026 does

Nakshatra 2026 manages an arts event programme for shelter homes:

- Each **shelter home** keeps its participant details in a Google Sheet.
- Nakshatra connects to that sheet, imports the **participants**, and checks their
  details (age, school standard, category) automatically.
- Staff register participants for **events** (Arts, Literary, Cultural — solo or
  group), mark **attendance**, enter **scores**, and publish **results**.
- **Certificates** are tracked against finalized results, and **reports** summarise
  the whole programme.
- Changes made in the app can be written back to the participant's Google Sheet
  (for example a name change) so both stay in step. *Implemented (not
  live-verified).*

## 2. Who can sign in

Only people whose Google account has been **approved** by a Nakshatra
administrator. If you try to sign in with an unregistered Google account, the
application tells you clearly that the account is not registered — no account is
created automatically.

What you can see depends on your **role**:

| Role | What you can open |
|---|---|
| ADMIN | Everything, including Settings (user management) |
| SUPPORT | Everything, plus the Imports area |
| EVENTS_TEAM | Dashboard, Participants, Events, Attendance, Scoring, Results |
| LIAISON_TEAM | Dashboard, Homes, Participants, Events, Attendance, Results |
| CERTIFICATE_TEAM | Dashboard, Results, Certificates |

Menu items you have no permission for are simply not shown, and typing their
address directly returns you to the Dashboard.

## 3. Signing in

1. Open the Nakshatra web address in your browser.
2. You will see the **Sign in** page with a Google button.
3. Click the Google button and choose your Google account.
4. After Google confirms your identity, Nakshatra checks that your account is
   approved. This takes a moment — the app only enters the dashboard **after**
   the check succeeds.
5. You land on the **Dashboard**.

Notes:

- Your session stays valid for up to 8 hours. Refreshing the page keeps you
  signed in.
- If you were signed out (expired session), you are returned to the Sign in page
  with a clear message.
- Signing out: click the account button (top-right corner, shows your name and
  role), then click **Logout**.

## 4. Moving around

The sidebar on the left lists the sections you may open (desktop). On a phone,
tap the menu button at the top-left and a drawer slides out with the same links.

| Section | What it is for |
|---|---|
| Dashboard | Overview numbers and quick links |
| Homes | Register shelter homes and connect their Google Sheets |
| Participants | See and check imported participants |
| Events | The event catalogue, registrations, and teams |
| Attendance | Mark who attended an event |
| Scoring | Enter and finalize scores |
| Results | Published (locked) results |
| Certificates | Certificate records for finalized results |
| Reports | Programme totals |
| Settings | User and role management (ADMIN only) |

The header always shows which screen you are on. A footer notes the application
name.

## 5. The screens

### 5.1 Dashboard
Shows summary tiles — homes, participants, events (with active events),
registrations, teams, attendance recorded/present/absent, finalized scores, and
certificate counts — plus quick-action buttons. If the summary cannot be loaded,
the panel shows an error with a **Retry** button instead of pretending the
numbers are fine.

### 5.2 Homes
This is where a home joins the programme. See
[Features & workflows — Shelter homes](features-and-workflows.md#2-shelter-homes)
for the full walk-through. In brief:

- **Add shelter home**: paste the home's Google Sheet link, click **Preview
  source metadata**; the app shows the detected home name, address, phone, and
  participant count. Only fields the sheet could not provide need typing in.
- **Connect Google Sheet** starts the import. The outcome is shown honestly:
  connected and imported, connected-but-import-failed (with the reason and a
  Retry), already connected, or archived.
- Each connected home card offers **View** and **Sync** actions and shows a sync
  status label (for example "Synced", "Sync needed") — never raw error codes.
- **Sync All Homes** (ADMIN only) starts one bulk job that syncs every connected
  home in the background and reports progress.
- **Archive/Restore**: archiving removes a home from active use (counts and
  impact are previewed first); restoring brings it back.

### 5.3 Participants
Lists every imported participant with their home, code, gender, age, standard,
level (Sub Junior / Junior / Senior / Super Senior), and validation status.
Search and filters narrow the list. The level is **calculated by Nakshatra** from
age and standard — it cannot be typed in. "Participating events" shows each
participant's event summary. If the list cannot be loaded, you get an error and a
Retry button.

### 5.4 Events
The **event catalogue** with filters (category, mode, status, search). Each event
card shows its details and how many participants are registered. Opening an event
shows the **registered participants** (with their registration status) and, for
group events, the **teams**: create a team, add or remove members from a
searchable participant list. Registration and team changes are validated by the
server — if a rule is broken (for example an event limit), the server rejects it
and the app shows the exact reason. *Registration/teams: Implemented (not
live-verified).*

### 5.5 Attendance
1. Choose the event from the dropdown.
2. The list shows each registered participant with their saved status
   (Present / Absent / Not marked).
3. Click **Present** or **Absent** to mark and save; clicking the same status
   again is safe (no duplicate is created).
4. If someone else changed the record while you worked, the app tells you
   "Attendance was updated elsewhere…" and reloads the latest values — just mark
   again.
5. If the list cannot be read, an error with **Retry** appears; retry issues a
   fresh request.

### 5.6 Scoring and Results
Scoring lets you enter scores for an event's participants/teams and **finalize**
them. Finalizing locks the scores — Results then shows the locked values. Draft
scores never appear in Results. *Implemented (not live-verified).*

### 5.7 Certificates
Review finalized-score entries and their certificate record status. Draft scores
are excluded. A certificate status does not indicate a placement or award — it
only tracks the record. Generation appears as "Generate when configured" —
**Partial**: the record tracking is implemented; generation depends on
configuration that has not been verified.

### 5.8 Reports
Programme totals across participants, registrations, attendance, and scores.
If the data cannot be read, an error with Retry is shown instead of empty totals.
*Data correctness not yet verified against live data.*

### 5.9 Settings (ADMIN only)
Access management: the user list with status/role filters, **Add user**, and
approve / reject / disable / enable / change-role actions. The user's own account
menu (top right) is where you sign out. *Implemented (not live-verified).*

## 6. Messages you will see

The application is deliberately honest about what happened:

- Success messages (green) appear **only** after the server confirmed the action.
- Warning lists (for example during import) describe what needs review without
  failing the import.
- Errors show what went wrong and usually offer **Retry**. Raw technical codes
  stay in a small diagnostics line — the main message is always plain English.
- If two people edit the same record, the later save is rejected with a clear
  message and the latest values are reloaded.

## Glossary

| Term | Meaning |
|---|---|
| Shelter home | A participating institution; connected to exactly one Google Sheet (its "source"). |
| Participant | A child registered by a shelter home, imported from that home's sheet. |
| Caretaker | A contact person at a home. Caretaker details are never used as the home's official contact. |
| Event | A competition item (Arts, Literary, or Cultural; solo or group). |
| Registration | A participant's entry into an event. |
| Team | A named group of participants competing together in a group event. |
| Synchronization (sync) | Copying data between the app and a home's Google Sheet, in either direction. |
| Import | The first (or repeated) read of a home's sheet into Nakshatra. |
| Level | Sub Junior / Junior / Senior / Super Senior — calculated from age and school standard. |
| Archive | Taking a home out of active use while keeping all its history. |
| Version conflict | Two people edited the same record; the older save is rejected to protect data. |
| Validation | Automatic checks on imported data (errors block a participant; warnings only inform). |
