/**
 * Master Roster export builders (PDF + CSV) for the Events page.
 *
 * Pure, dependency-free assembly of the master roster from real backend
 * data the page already reads: the scoped event catalogue (listEvents),
 * the registration matrix (getReports participants -> events[], the
 * shared ACTIVE-registration counting core) and the GROUP-event team
 * rosters (listTeams). Nothing here counts, ranks or invents anything on
 * the client: every value is passed in from a backend response field.
 *
 * Shared export rules:
 *   - the SELECTED PROGRAMME only; every read is already scoped by the
 *     server-side session, and the program label here is display text;
 *   - ACTIVE registrations only (status 'REGISTERED'). Cancelled rows are
 *     history and never appear;
 *   - one row per participant-event registration - a participant in three
 *     events appears three times;
 *   - a missing category or participant code stays empty, never invented;
 *   - an event with no registrations is still printed in the PDF with an
 *     explicit "No registrations" line; a flat CSV carries no rows for it.
 *
 * Output split (approved review feedback):
 *   - PDF: presentation-ready roster. Individual events list
 *     Home Name | Child Name | Category | Code, grouped by home.
 *     Group events list participating HOME NAMES ONLY - never child
 *     names, participant codes or individual rows, and no age/category
 *     breakdowns. No registration counts anywhere: no totals beside
 *     headings, no event-level totals, no summaries and no derived
 *     replacement counts.
 *   - CSV: detailed registration data for administrative use - one row
 *     per registration, keeping participant names, codes, categories and
 *     team names even where the PDF hides them (e.g. group events).
 */

import {
  EVENT_CATEGORY_LABELS,
  PARTICIPANT_LEVEL_LABELS,
} from '../../core/constants/nakshatra-rules';

/** Programme season printed on the roster (branding text, not data). */
export const ROSTER_SEASON = '2026-27';

/** Canonical wing (category) order of the roster. */
const WING_ORDER = ['ARTS', 'LITERARY', 'CULTURAL'] as const;

/** Canonical age-category (level) order of roster tables. */
const LEVEL_ORDER = ['SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR'] as const;

export interface RosterEventInput {
  eventId: string;
  eventCode: string;
  name: string;
  category: string;
  mode: 'SOLO' | 'GROUP';
  status: string;
  eligibleLevels: readonly string[];
}

export interface RosterParticipantInput {
  participantId: string;
  participantCode: string;
  fullName: string;
  shelterHomeId: string;
  homeName: string;
  gender: string;
  age: number | null;
  standard: number | null;
  /** Age category (level); '' when the record carries none - never invented. */
  level: string;
}

export interface RosterRegistrationInput {
  participantId: string;
  eventId: string;
  /** Only 'REGISTERED' rows are exported; cancelled rows are history. */
  status: string;
}

export interface RosterTeamInput {
  eventId: string;
  teamId: string;
  teamName: string;
  memberParticipantIds: readonly string[];
}

export interface RosterRow {
  participantCode: string;
  participantName: string;
  homeName: string;
  ageCategory: string;
  teamName: string;
}

export interface RosterTeamAllocation {
  teamName: string;
  members: RosterRow[];
}

export interface RosterSubEvent {
  eventId: string;
  eventCode: string;
  eventName: string;
  /** 'ART-001-J · Juniors' - the record identity plus its age-category band. */
  subEventLabel: string;
  participationType: string;
  eventStatus: string;
  /** Rows in this sub-event (empty-event detection); never printed in the PDF. */
  registeredCount: number;
  /** SOLO: every registered participant, sorted home -> age category -> name. */
  soloRows: RosterRow[];
  /** GROUP: team allocations, plus registered members without a team. */
  teamAllocations: RosterTeamAllocation[];
  unteamedMembers: RosterRow[];
  /** GROUP: the full registered ensemble (same people as teams + unteamed). */
  ensemble: RosterRow[];
}

export interface RosterEventGroup {
  eventName: string;
  subEvents: RosterSubEvent[];
}

export interface RosterWing {
  wing: string;
  eventGroups: RosterEventGroup[];
}

export interface MasterRoster {
  title: string;
  programLabel: string;
  season: string;
  generatedAt: string;
  wings: RosterWing[];
  /**
   * Total exported registrations - equals the CSV row count by
   * construction. Bookkeeping only: the PDF prints no counts.
   */
  totalRegistrations: number;
}

export interface RosterInput {
  programLabel: string;
  generatedAt?: Date;
  events: readonly RosterEventInput[];
  participants: readonly RosterParticipantInput[];
  registrations: readonly RosterRegistrationInput[];
  teams: readonly RosterTeamInput[];
}

/** Display label of one age category; '' stays ''. */
function levelLabel(level: string): string {
  if (!level) {
    return '';
  }

  return (PARTICIPANT_LEVEL_LABELS as Record<string, string>)[level] ?? level;
}

/** 'Sub Juniors' / 'Juniors + Seniors' / 'COMMON — all levels' / '-'. */
function ageBandLabel(eligibleLevels: readonly string[]): string {
  if (!eligibleLevels.length) {
    return '-';
  }

  if (eligibleLevels.length === 4) {
    return 'COMMON — all levels';
  }

  return eligibleLevels.map(levelLabel).join(' + ');
}

/** 'ART-001-J · Juniors' - the sub-event heading of the roster. */
function subEventLabel(eventCode: string, eligibleLevels: readonly string[]): string {
  return eventCode + ' · ' + ageBandLabel(eligibleLevels);
}

function participationType(mode: string): string {
  return mode === 'GROUP' ? 'Group' : 'Individual';
}

function levelRank(level: string): number {
  const index = (LEVEL_ORDER as readonly string[]).indexOf(level);
  return index === -1 ? LEVEL_ORDER.length : index;
}

/** Roster table order: shelter home, then age category, then name. */
function compareRows(a: RosterRow, b: RosterRow): number {
  return (
    a.homeName.localeCompare(b.homeName) ||
    levelRankAgeCategory(a.ageCategory) - levelRankAgeCategory(b.ageCategory) ||
    a.participantName.localeCompare(b.participantName)
  );
}

/** Age category label -> canonical order rank (unknown labels last). */
function levelRankAgeCategory(label: string): number {
  const entry = (Object.keys(PARTICIPANT_LEVEL_LABELS) as string[]).find(
    (level) => levelLabel(level) === label,
  );
  return entry === undefined ? LEVEL_ORDER.length : levelRank(entry);
}

/**
 * Assembles the master roster. Registrations whose participant or event
 * cannot be resolved are skipped (they cannot be positioned in a wing);
 * the backend's own issue lists report those rows. Unknown categories
 * sort after the three canonical wings.
 */
export function buildMasterRoster(input: RosterInput): MasterRoster {
  const participantsById = new Map<string, RosterParticipantInput>();
  input.participants.forEach((participant) => {
    participantsById.set(participant.participantId, participant);
  });

  const eventsById = new Map<string, RosterEventInput>();
  input.events.forEach((event) => {
    eventsById.set(event.eventId, event);
  });

  // (eventId|participantId) -> team name. One team per participant per
  // event is the backend rule; a pathological second team wins by order.
  const teamNameByMember = new Map<string, string>();
  input.teams.forEach((team) => {
    team.memberParticipantIds.forEach((participantId) => {
      teamNameByMember.set(team.eventId + '|' + participantId, team.teamName);
    });
  });

  const rowsByEvent = new Map<string, RosterRow[]>();

  input.registrations.forEach((registration) => {
    if (registration.status !== 'REGISTERED') {
      return;
    }

    const event = eventsById.get(registration.eventId);
    const participant = participantsById.get(registration.participantId);

    if (!event || !participant) {
      return;
    }

    const row: RosterRow = {
      participantCode: participant.participantCode,
      participantName: participant.fullName,
      homeName: participant.homeName,
      ageCategory: levelLabel(participant.level),
      teamName:
        teamNameByMember.get(event.eventId + '|' + participant.participantId) ??
        '',
    };

    const rows = rowsByEvent.get(event.eventId);

    if (rows) {
      rows.push(row);
    } else {
      rowsByEvent.set(event.eventId, [row]);
    }
  });

  // Event order inside a wing: category, then event name family, then
  // the record code - a total order, so the same input always prints
  // the same roster.
  const eventsInWingOrder = [...input.events].sort((a, b) =>
    a.category.localeCompare(b.category) ||
    a.name.localeCompare(b.name) ||
    a.eventCode.localeCompare(b.eventCode),
  );

  const wingNames = [
    ...WING_ORDER,
    ...[...new Set(input.events.map((event) => event.category))]
      .filter((category) => !(WING_ORDER as readonly string[]).includes(category))
      .sort(),
  ];

  let totalRegistrations = 0;

  const wings: RosterWing[] = wingNames
    .map((category) => {
      const eventGroups: RosterEventGroup[] = [];

      eventsInWingOrder
        .filter((event) => event.category === category)
        .forEach((event) => {
          const rows = (rowsByEvent.get(event.eventId) ?? []).sort(compareRows);
          totalRegistrations += rows.length;

          const isGroup = event.mode === 'GROUP';

          const teamNames = [
            ...new Set(
              input.teams
                .filter((team) => team.eventId === event.eventId)
                .map((team) => team.teamName),
            ),
          ].sort();

          const teamAllocations: RosterTeamAllocation[] = teamNames.map(
            (teamName) => ({
              teamName,
              members: rows.filter((row) => row.teamName === teamName),
            }),
          );

          const subEvent: RosterSubEvent = {
            eventId: event.eventId,
            eventCode: event.eventCode,
            eventName: event.name,
            subEventLabel: subEventLabel(event.eventCode, event.eligibleLevels),
            participationType: participationType(event.mode),
            eventStatus: event.status,
            registeredCount: rows.length,
            soloRows: isGroup ? [] : rows,
            teamAllocations: isGroup ? teamAllocations : [],
            unteamedMembers: isGroup ? rows.filter((row) => !row.teamName) : [],
            ensemble: isGroup ? rows : [],
          };

          const existing = eventGroups.find(
            (group) => group.eventName === event.name,
          );

          if (existing) {
            existing.subEvents.push(subEvent);
          } else {
            eventGroups.push({ eventName: event.name, subEvents: [subEvent] });
          }
        });

      return {
        wing: (EVENT_CATEGORY_LABELS as Record<string, string>)[category] ??
          category,
        eventGroups,
      };
    })
    .filter((wing) => wing.eventGroups.length > 0);

  const generatedAt = input.generatedAt ?? new Date();

  return {
    title:
      'Nakshatra ' + input.programLabel + ' ' + ROSTER_SEASON +
      ' Master Event Roster',
    programLabel: input.programLabel,
    season: ROSTER_SEASON,
    generatedAt: generatedAt.toLocaleString(),
    wings,
    totalRegistrations,
  };
}

/** CSV header row of the master roster export. */
export const ROSTER_CSV_HEADER = [
  'Program',
  'Wing',
  'Event',
  'Sub-event',
  'Participation type',
  'Shelter home',
  'Participant code',
  'Participant name',
  'Category',
  'Team/ensemble name',
  'Registration status',
] as const;

/**
 * One CSV row per participant-event registration, in roster order - the
 * DETAILED administrative export: participant names, codes, categories
 * and team names are kept even where the PDF hides them (e.g. group
 * events, whose PDF shows home names only). The returned row count
 * equals `totalRegistrations` by construction.
 */
export function rosterToCsvRows(roster: MasterRoster): string[][] {
  const rows: string[][] = [];

  roster.wings.forEach((wing) => {
    wing.eventGroups.forEach((group) => {
      group.subEvents.forEach((subEvent) => {
        const source = subEvent.soloRows.length
          ? subEvent.soloRows
          : subEvent.ensemble;

        source.forEach((row) => {
          rows.push([
            roster.programLabel,
            wing.wing,
            subEvent.eventName,
            subEvent.subEventLabel,
            subEvent.participationType,
            row.homeName,
            row.participantCode,
            row.participantName,
            row.ageCategory,
            row.teamName,
            'REGISTERED',
          ]);
        });
      });
    });
  });

  return rows;
}

/** RFC-4180-style CSV text: every cell quoted, `"` doubled, CRLF rows. */
export function rosterToCsv(roster: MasterRoster): string {
  const lines = [ROSTER_CSV_HEADER as unknown as string[], ...rosterToCsvRows(roster)];

  return lines
    .map((line) =>
      line.map((value) => '"' + String(value).replace(/"/g, '""') + '"').join(','),
    )
    .join('\r\n');
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One individual-event row: Home Name | Child Name | Category | Code. */
function rosterRowHtml(row: RosterRow, previousHome: string): string {
  const home = row.homeName === previousHome ? '' : row.homeName;

  return (
    '<tr>' +
    '<td class="home">' + escapeHtml(home) + '</td>' +
    '<td>' + escapeHtml(row.participantName) + '</td>' +
    '<td>' + escapeHtml(row.ageCategory || '-') + '</td>' +
    '<td>' + escapeHtml(row.participantCode || '-') + '</td>' +
    '</tr>'
  );
}

/** Distinct participating home names of a group event; blanks dropped, sorted. */
function participatingHomes(subEvent: RosterSubEvent): string[] {
  return [...new Set(subEvent.ensemble.map((row) => row.homeName))]
    .filter((homeName) => homeName.trim() !== '')
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The complete, self-contained print document (its own styles) rendered
 * inside a hidden iframe and printed to PDF by the browser. Page numbers
 * come from the browser print dialog's "Headers and footers" option;
 * table headers repeat per page natively (`table-header-group`).
 */
export function rosterToHtml(roster: MasterRoster): string {
  const body: string[] = [];

  body.push('<div class="doc-head">');
  body.push('<div class="brand">NAKSHATRA ' + escapeHtml(roster.season) + '</div>');
  body.push('<h1>' + escapeHtml(roster.title) + '</h1>');
  body.push(
    '<div class="meta">' + escapeHtml(roster.programLabel) +
      ' programme · Generated ' + escapeHtml(roster.generatedAt) + '</div>',
  );
  body.push(
    '<div class="note">Presentation roster. Individual events list Home Name, ' +
      'Child Name, Category and Code; group events list participating home ' +
      'names only. Detailed registration data is in the CSV export.</div>',
  );
  body.push('</div>');

  roster.wings.forEach((wing) => {
    body.push('<h2>' + escapeHtml(wing.wing) + '</h2>');

    wing.eventGroups.forEach((group) => {
      body.push('<h3>' + escapeHtml(group.eventName) + '</h3>');

      group.subEvents.forEach((subEvent) => {
        // GROUP sub-event headings carry no age/category band - the PDF
        // avoids age/category breakdowns for group events entirely.
        const identity =
          subEvent.participationType === 'Group'
            ? escapeHtml(subEvent.eventCode)
            : escapeHtml(subEvent.subEventLabel);

        body.push(
          '<h4>' + identity + ' · ' + escapeHtml(subEvent.participationType) +
            (subEvent.eventStatus === 'ACTIVE'
              ? ''
              : ' · ' + escapeHtml(subEvent.eventStatus)) +
            '</h4>',
        );

        if (!subEvent.registeredCount) {
          body.push('<p class="empty">No registrations for this sub-event.</p>');
          return;
        }

        if (subEvent.soloRows.length) {
          body.push(
            '<table class="solo-table"><thead><tr><th>Home Name</th><th>Child Name</th>' +
              '<th>Category</th><th>Code</th></tr></thead><tbody>',
          );

          let previousHome = '';

          subEvent.soloRows.forEach((row) => {
            body.push(rosterRowHtml(row, previousHome));
            previousHome = row.homeName;
          });

          body.push('</tbody></table>');
          return;
        }

        // GROUP: participating home names ONLY - child names, codes,
        // team rosters and age/category detail live in the CSV export.
        const homes = participatingHomes(subEvent);

        if (!homes.length) {
          body.push('<p class="empty">No participating homes recorded.</p>');
          return;
        }

        body.push(
          '<p class="note">Participating homes only. Child names, codes and ' +
            'team rosters are listed in the CSV export.</p>',
        );
        body.push(
          '<table class="group-table"><thead><tr><th>Home Name</th></tr></thead><tbody>',
        );

        homes.forEach((homeName) => {
          body.push('<tr><td class="home">' + escapeHtml(homeName) + '</td></tr>');
        });

        body.push('</tbody></table>');
      });
    });
  });

  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>' + escapeHtml(roster.title) + '</title>' +
    '<style>' +
    '@page { margin: 14mm 12mm; }' +
    'body { font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Arial, sans-serif;' +
    ' color: #1f2430; font-size: 11px; margin: 0; }' +
    '.doc-head { border-bottom: 2px solid #1a5276; padding-bottom: 8px; margin-bottom: 16px; }' +
    '.brand { color: #1a5276; font-weight: 700; letter-spacing: 2px; font-size: 11px; }' +
    'h1 { font-size: 20px; margin: 4px 0; }' +
    '.meta { color: #4a5561; font-size: 10px; }' +
    'h2 { font-size: 15px; margin: 18px 0 6px; border-bottom: 1px solid #c9d2dc;' +
    ' padding-bottom: 3px; }' +
    'h3 { font-size: 13px; margin: 14px 0 4px; }' +
    'h4 { font-size: 11px; margin: 10px 0 4px; color: #37474f; }' +
    '.note { color: #4a5561; font-size: 9px; margin: 2px 0 8px; }' +
    '.empty { color: #6b7280; font-style: italic; margin: 2px 0 8px; }' +
    'table { border-collapse: collapse; width: 100%; margin: 2px 0 8px; }' +
    'th, td { border: 1px solid #c9d2dc; padding: 3px 6px; text-align: left;' +
    ' overflow-wrap: anywhere; }' +
    'th { background: #eef2f6; font-weight: 600; }' +
    '.group-table th { background: #d8e4ee; }' +
    'thead { display: table-header-group; }' +
    'tr { break-inside: avoid; }' +
    'h2, h3, h4 { break-after: avoid; }' +
    '.home { font-weight: 600; }' +
    '</style></head><body>' +
    body.join('') +
    '</body></html>'
  );
}

/** `nakshatra-arts-master-roster-2026-10-30-1345` file-name stem. */
export function rosterFileStem(programLabel: string, now = new Date()): string {
  const slug = programLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const pad = (value: number) => String(value).padStart(2, '0');

  const stamp =
    now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    '-' + pad(now.getHours()) + pad(now.getMinutes());

  return 'nakshatra-' + (slug || 'programme') + '-master-roster-' + stamp;
}
