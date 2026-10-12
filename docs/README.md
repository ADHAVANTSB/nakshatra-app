# Nakshatra 2026 — Documentation Index

Nakshatra 2026 is a web application for managing an arts event programme for
shelter homes: it connects to each home's Google Sheet, imports participants,
manages event registrations, tracks attendance and scoring, produces results and
certificate records, and reports on the whole programme.

## Who the documentation is for

| Document | Audience |
|---|---|
| [User guide](user-guide.md) | Any first-time user. Sign-in, navigation, screen-by-screen instructions, glossary. |
| [Features & workflows](features-and-workflows.md) | Daily users. Each feature: purpose, who can use it, steps, validation, limitations. |
| [Troubleshooting & FAQ](troubleshooting-faq.md) | All users. Common errors, likely causes, safe checks, when to escalate. |
| [Administrator guide](administrator-guide.md) | ADMIN and SUPPORT users. User management, home lifecycle, archive/restore, operational safety. |
| [Technical architecture](technical-architecture.md) | Developers. Frontend, Apps Script backend, API contract, data flow, concurrency. |
| [Deployment & maintenance](deployment-and-maintenance.md) | Developers/operators. Configuration, deployment, testing, rollback, maintenance. |

## Reading the verification labels

Documentation statuses reflect what is actually verified:

- **Verified (mocked)** — the behaviour is covered by this project's automated
  browser tests (local dev server + simulated backend). Frontend behaviour is
  proven; the real backend was not part of those tests.
- **Implemented (not live-verified)** — the feature exists in the code but has
  not been exercised against the deployed backend (no safe test environment was
  available; see the acceptance report).
- **Partial** — implemented in part; the rest is planned or conditional.
- **Not available** — does not exist in the current code.

A full picture of what was tested and what is blocked is in
[QA report 2026-10-12](qa-report-2026-10-12.md) and
[Acceptance report 2026-10-12](acceptance-report-2026-10-12.md). The master test
inventory is
`Nakshatra_2026_Technical_Test_Checklist.xlsx` (100 cases; do not edit the
`*.backup-*.xlsx` files).

## Terms used everywhere (short form)

The complete glossary is in the [user guide](user-guide.md#glossary). The most
common ones:

- **Shelter home** — a participating institution, connected to one Google Sheet.
- **Participant** — a child registered by a shelter home (imported from its sheet).
- **Caretaker** — a contact person at a home; never treated as the official contact.
- **Synchronization (sync)** — copying data between the app and a home's Google Sheet.
- **Archive** — taking a home out of active use while preserving its history.
- **Version conflict** — two people edited the same record; the older edit is rejected.
