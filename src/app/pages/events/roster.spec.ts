import { describe, expect, it } from 'vitest';

import {
  ROSTER_CSV_HEADER,
  RosterInput,
  buildMasterRoster,
  rosterFileStem,
  rosterToCsv,
  rosterToCsvRows,
  rosterToHtml,
} from './roster';

/**
 * Master roster export tests: one row per participant-event registration,
 * group vs solo structure, cancelled/ineligible exclusion, empty events,
 * CSV escaping (commas, quotes, newlines, non-English names), PDF/CSV
 * count consistency and programme isolation. The builders are pure, so
 * every case runs without TestBed or a network.
 */

function baseInput(overrides: Partial<RosterInput> = {}): RosterInput {
  return {
    programLabel: 'Arts',
    generatedAt: new Date('2026-10-30T10:00:00'),
    events: [
      {
        eventId: 'E-ART-1',
        eventCode: 'ART-001',
        name: 'Clay Modelling',
        category: 'ARTS',
        mode: 'SOLO',
        status: 'ACTIVE',
        eligibleLevels: ['SUB_JUNIOR'],
      },
      {
        eventId: 'E-ART-2',
        eventCode: 'ART-002',
        name: 'Rangoli',
        category: 'ARTS',
        mode: 'GROUP',
        status: 'ACTIVE',
        eligibleLevels: ['SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR'],
      },
    ],
    participants: [
      {
        participantId: 'P-1',
        participantCode: 'NK26-H1-001',
        fullName: 'Asha',
        shelterHomeId: 'H-1',
        homeName: 'Arun Rainbow Nest',
        gender: 'FEMALE',
        age: 9,
        standard: 2,
        level: 'SUB_JUNIOR',
      },
      {
        participantId: 'P-2',
        participantCode: 'NK26-H2-001',
        fullName: 'Bala',
        shelterHomeId: 'H-2',
        homeName: 'Bala Mandir',
        gender: 'MALE',
        age: 13,
        standard: 6,
        level: 'JUNIOR',
      },
    ],
    registrations: [
      { participantId: 'P-1', eventId: 'E-ART-1', status: 'REGISTERED' },
    ],
    teams: [],
    ...overrides,
  };
}

function csvLines(csv: string): string[][] {
  return csv.split('\r\n').map(line => line.split('","').map(cell =>
    cell.replace(/^"/, '').replace(/"$/, '').replace(/""/g, '"'),
  ));
}

describe('roster row assembly', () => {
  it('emits one CSV row per participant-event registration', () => {
    const roster = buildMasterRoster(baseInput({
      registrations: [
        { participantId: 'P-1', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-1', eventId: 'E-ART-2', status: 'REGISTERED' },
        { participantId: 'P-2', eventId: 'E-ART-2', status: 'REGISTERED' },
      ],
    }));

    expect(roster.totalRegistrations).toBe(3);
    expect(rosterToCsvRows(roster)).toHaveLength(3);
  });

  it('lists a multi-event participant once per event, never merged', () => {
    const roster = buildMasterRoster(baseInput({
      registrations: [
        { participantId: 'P-1', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-1', eventId: 'E-ART-2', status: 'REGISTERED' },
      ],
    }));

    const rows = rosterToCsvRows(roster);
    const ashaRows = rows.filter(row => row[7] === 'Asha');

    expect(ashaRows).toHaveLength(2);
    expect(ashaRows.map(row => row[3]).sort()).toEqual([
      'ART-001 · Sub Juniors',
      'ART-002 · COMMON — all levels',
    ].sort());
  });

  it('excludes cancelled and any non-REGISTERED registration', () => {
    const roster = buildMasterRoster(baseInput({
      registrations: [
        { participantId: 'P-1', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-1', eventId: 'E-ART-2', status: 'CANCELLED' },
        { participantId: 'P-2', eventId: 'E-ART-2', status: 'WAITLISTED' },
      ],
    }));

    expect(roster.totalRegistrations).toBe(1);
    expect(rosterToCsvRows(roster).map(row => row[7])).toEqual(['Asha']);
  });

  it('skips registrations whose participant or event cannot be resolved', () => {
    const roster = buildMasterRoster(baseInput({
      registrations: [
        { participantId: 'P-1', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-GHOST', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-1', eventId: 'E-GHOST', status: 'REGISTERED' },
      ],
    }));

    expect(roster.totalRegistrations).toBe(1);
  });

  it('keeps an empty event in the roster with no rows invented', () => {
    const roster = buildMasterRoster(baseInput());
    const subEvent = roster.wings[0].eventGroups
      .find(group => group.eventName === 'Rangoli')!.subEvents[0];

    expect(subEvent.registeredCount).toBe(0);
    expect(rosterToCsvRows(roster)).toHaveLength(1);

    const html = rosterToHtml(roster);
    expect(html).toContain('No registrations for this sub-event.');
  });

  it('renders a missing age category as empty - never invented', () => {
    const roster = buildMasterRoster(baseInput({
      participants: [{
        participantId: 'P-1',
        participantCode: 'NK26-H1-001',
        fullName: 'Asha',
        shelterHomeId: 'H-1',
        homeName: 'Arun Rainbow Nest',
        gender: '',
        age: null,
        standard: null,
        level: '',
      }],
    }));

    expect(rosterToCsvRows(roster)[0][8]).toBe('');
  });
});

describe('roster grouping', () => {
  it('groups solo rows by shelter home then age category', () => {
    const roster = buildMasterRoster(baseInput({
      participants: [
        { participantId: 'P-1', participantCode: 'NK26-H1-001', fullName: 'Asha',
          shelterHomeId: 'H-1', homeName: 'Arun Rainbow Nest', gender: 'FEMALE',
          age: 9, standard: 2, level: 'SUB_JUNIOR' },
        { participantId: 'P-2', participantCode: 'NK26-H1-002', fullName: 'Chandra',
          shelterHomeId: 'H-1', homeName: 'Arun Rainbow Nest', gender: 'MALE',
          age: 15, standard: 8, level: 'SENIOR' },
        { participantId: 'P-3', participantCode: 'NK26-H1-003', fullName: 'Deepa',
          shelterHomeId: 'H-1', homeName: 'Arun Rainbow Nest', gender: 'FEMALE',
          age: 12, standard: 5, level: 'JUNIOR' },
      ],
      registrations: [
        { participantId: 'P-1', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-2', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-3', eventId: 'E-ART-1', status: 'REGISTERED' },
      ],
    }));

    const subEvent = roster.wings[0].eventGroups
      .find(group => group.eventName === 'Clay Modelling')!.subEvents[0];

    expect(subEvent.soloRows.map(row => row.ageCategory)).toEqual([
      'Sub Juniors', 'Juniors', 'Seniors',
    ]);
  });

  it('splits group participation into team allocations plus the full ensemble', () => {
    const roster = buildMasterRoster(baseInput({
      registrations: [
        { participantId: 'P-1', eventId: 'E-ART-2', status: 'REGISTERED' },
        { participantId: 'P-2', eventId: 'E-ART-2', status: 'REGISTERED' },
      ],
      teams: [{
        eventId: 'E-ART-2',
        teamId: 'T-1',
        teamName: 'Rainbow Stars',
        memberParticipantIds: ['P-1'],
      }],
    }));

    const subEvent = roster.wings[0].eventGroups
      .find(group => group.eventName === 'Rangoli')!.subEvents[0];

    expect(subEvent.teamAllocations).toHaveLength(1);
    expect(subEvent.teamAllocations[0].teamName).toBe('Rainbow Stars');
    expect(subEvent.teamAllocations[0].members.map(row => row.participantName))
      .toEqual(['Asha']);
    expect(subEvent.unteamedMembers.map(row => row.participantName))
      .toEqual(['Bala']);
    expect(subEvent.ensemble).toHaveLength(2);
    expect(subEvent.soloRows).toHaveLength(0);
  });

  it('sorts wings Arts, Literary, Cultural and groups events by name family', () => {
    const roster = buildMasterRoster(baseInput({
      events: [
        { eventId: 'E-2', eventCode: 'CUL-003', name: 'Group Dance', category: 'CULTURAL',
          mode: 'GROUP', status: 'ACTIVE', eligibleLevels: ['JUNIOR'] },
        { eventId: 'E-1', eventCode: 'ART-001-J', name: 'Clay Modelling', category: 'ARTS',
          mode: 'SOLO', status: 'ACTIVE', eligibleLevels: ['JUNIOR'] },
        { eventId: 'E-3', eventCode: 'ART-001', name: 'Clay Modelling', category: 'ARTS',
          mode: 'SOLO', status: 'ACTIVE', eligibleLevels: ['SUB_JUNIOR'] },
      ],
      registrations: [],
      participants: [],
    }));

    expect(roster.wings.map(wing => wing.wing))
      .toEqual(['Arts', 'Cultural']);
    expect(roster.wings[0].eventGroups).toHaveLength(1);
    expect(roster.wings[0].eventGroups[0].subEvents.map(sub => sub.eventCode))
      .toEqual(['ART-001', 'ART-001-J']);
    expect(roster.wings[0].eventGroups[0].subEvents[1].subEventLabel)
      .toBe('ART-001-J · Juniors');
  });
});

describe('master roster CSV', () => {
  it('uses the agreed header and quotes every cell', () => {
    const roster = buildMasterRoster(baseInput());
    const csv = rosterToCsv(roster);

    expect(csv.split('\r\n')[0]).toBe(
      ROSTER_CSV_HEADER.map(label => '"' + label + '"').join(','),
    );
  });

  it('escapes commas, quotes, newlines and non-English names', () => {
    const roster = buildMasterRoster(baseInput({
      participants: [{
        participantId: 'P-1',
        participantCode: 'NK26-H1-001',
        fullName: 'Ravi, "The Star"\nமுருகன்',
        shelterHomeId: 'H-1',
        homeName: "St. Joseph's, Chennai",
        gender: 'MALE',
        age: 10,
        standard: 3,
        level: 'SUB_JUNIOR',
      }],
    }));

    const csv = rosterToCsv(roster);
    const dataRow = csv.split('\r\n')[1];

    expect(dataRow).toContain('"St. Joseph\'s, Chennai"');
    expect(dataRow).toContain('"Ravi, ""The Star""');
    expect(dataRow).toContain('முருகன்');
    // The newline lives inside one quoted cell: splitting on the CRLF row
    // separator still yields exactly header + one data row - a name can
    // never smuggle in a phantom CSV row.
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('CSV row count always equals the PDF registration count', () => {
    const roster = buildMasterRoster(baseInput({
      registrations: [
        { participantId: 'P-1', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-1', eventId: 'E-ART-2', status: 'REGISTERED' },
        { participantId: 'P-2', eventId: 'E-ART-2', status: 'REGISTERED' },
      ],
      teams: [{
        eventId: 'E-ART-2', teamId: 'T-1', teamName: 'Rainbow Stars',
        memberParticipantIds: ['P-1', 'P-2'],
      }],
    }));

    const csvRows = rosterToCsvRows(roster);
    const html = rosterToHtml(roster);

    expect(csvRows).toHaveLength(roster.totalRegistrations);
    // The PDF prints the same count in its header line.
    expect(html).toContain(roster.totalRegistrations + ' active registrations');
  });

  it('carries the programme name in the title and every CSV row', () => {
    const roster = buildMasterRoster(baseInput({ programLabel: 'Arts' }));

    expect(roster.title).toBe('Nakshatra Arts 2026-27 Master Event Roster');
    expect(rosterToCsvRows(roster).every(row => row[0] === 'Arts')).toBe(true);
  });
});

describe('master roster PDF print view', () => {
  it('repeats table headers per page and keeps rows unbroken', () => {
    const html = rosterToHtml(buildMasterRoster(baseInput()));

    expect(html).toContain('<thead>');
    expect(html).toContain('table-header-group');
    expect(html).toContain('break-inside: avoid');
  });

  it('shows every event of the programme, including empty ones', () => {
    const html = rosterToHtml(buildMasterRoster(baseInput()));

    expect(html).toContain('Clay Modelling');
    expect(html).toContain('Rangoli');
    expect(html).toContain('ART-001');
    expect(html).toContain('ART-002');
  });

  it('marks non-ACTIVE events instead of hiding them', () => {
    const html = rosterToHtml(buildMasterRoster(baseInput({
      events: [{
        eventId: 'E-ART-1', eventCode: 'ART-001', name: 'Clay Modelling',
        category: 'ARTS', mode: 'SOLO', status: 'CANCELLED',
        eligibleLevels: ['SUB_JUNIOR'],
      }],
    })));

    expect(html).toContain('CANCELLED');
  });
});

describe('roster file naming', () => {
  it('builds a timestamped, lowercase file stem', () => {
    const stem = rosterFileStem('Arts', new Date('2026-10-30T13:45:00'));

    expect(stem).toBe('nakshatra-arts-master-roster-2026-10-30-1345');
  });
});
