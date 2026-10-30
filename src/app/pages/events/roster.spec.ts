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
 * CSV escaping (commas, quotes, newlines, non-English names), CSV row
 * count consistency, programme isolation and the approved PDF review
 * feedback (individual columns Home Name/Child Name/Category/Code, group
 * events home-names-only, no registration counts in the PDF, no invented
 * codes or categories). The builders are pure, so every case runs without
 * TestBed or a network.
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

  it('CSV keeps one detailed row per registration while the PDF prints no counts', () => {
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
    // The PDF carries no registration counts at all: no header total, no
    // event-level totals, no summaries and no derived replacement counts.
    expect(html).not.toContain('active registration');
    expect(html).not.toContain('ensemble');
    expect(html).not.toMatch(/\(\d+\)/);
    expect(html).not.toMatch(/\d+\s+active\s+registrations?/i);
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

describe('master roster PDF review feedback', () => {
  function soloRoster() {
    return buildMasterRoster(baseInput({
      participants: [
        { participantId: 'P-1', participantCode: 'NK26-H1-001', fullName: 'Asha',
          shelterHomeId: 'H-1', homeName: 'Arun Rainbow Nest', gender: 'FEMALE',
          age: 9, standard: 2, level: 'SUB_JUNIOR' },
        { participantId: 'P-2', participantCode: 'NK26-H1-002', fullName: 'Chandra',
          shelterHomeId: 'H-1', homeName: 'Arun Rainbow Nest', gender: 'MALE',
          age: 9, standard: 2, level: 'SUB_JUNIOR' },
        { participantId: 'P-3', participantCode: 'NK26-H2-001', fullName: 'Deepa',
          shelterHomeId: 'H-2', homeName: 'Bala Mandir', gender: 'FEMALE',
          age: 12, standard: 5, level: 'JUNIOR' },
      ],
      registrations: [
        { participantId: 'P-1', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-2', eventId: 'E-ART-1', status: 'REGISTERED' },
        { participantId: 'P-3', eventId: 'E-ART-1', status: 'REGISTERED' },
      ],
    }));
  }

  function groupRoster() {
    return buildMasterRoster(baseInput({
      // Group-only catalogue: the assertions below are about the
      // group-event PDF section in isolation.
      events: [
        { eventId: 'E-ART-2', eventCode: 'ART-002', name: 'Rangoli', category: 'ARTS',
          mode: 'GROUP', status: 'ACTIVE',
          eligibleLevels: ['SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR'] },
      ],
      participants: [
        { participantId: 'P-1', participantCode: 'NK26-H1-001', fullName: 'Asha',
          shelterHomeId: 'H-1', homeName: 'Arun Rainbow Nest', gender: 'FEMALE',
          age: 9, standard: 2, level: 'SUB_JUNIOR' },
        { participantId: 'P-2', participantCode: 'NK26-H2-001', fullName: 'Chandra',
          shelterHomeId: 'H-2', homeName: 'Bala Mandir', gender: 'MALE',
          age: 13, standard: 6, level: 'JUNIOR' },
      ],
      registrations: [
        { participantId: 'P-1', eventId: 'E-ART-2', status: 'REGISTERED' },
        { participantId: 'P-2', eventId: 'E-ART-2', status: 'REGISTERED' },
      ],
      teams: [{
        eventId: 'E-ART-2', teamId: 'T-1', teamName: 'Rainbow Stars',
        memberParticipantIds: ['P-1', 'P-2'],
      }],
    }));
  }

  it('individual events show Home Name, Child Name, Category, Code in that order', () => {
    const html = rosterToHtml(soloRoster());

    expect(html).toContain(
      '<thead><tr><th>Home Name</th><th>Child Name</th><th>Category</th><th>Code</th></tr></thead>',
    );

    // Row cells follow the same order: home, child name, category, code.
    const homeCell = html.indexOf('<td class="home">Arun Rainbow Nest</td>');
    const nameCell = html.indexOf('<td>Asha</td>');
    const categoryCell = html.indexOf('<td>Sub Juniors</td>');
    const codeCell = html.indexOf('<td>NK26-H1-001</td>');

    expect(homeCell).toBeGreaterThan(-1);
    expect(homeCell).toBeLessThan(nameCell);
    expect(nameCell).toBeLessThan(categoryCell);
    expect(categoryCell).toBeLessThan(codeCell);
  });

  it('uses the heading Category and never Age Category', () => {
    const html = rosterToHtml(soloRoster());

    expect(html).toContain('<th>Category</th>');
    expect(html).not.toContain('Age Category');
    expect(html).not.toContain('Age category');
    expect(ROSTER_CSV_HEADER as readonly string[]).not.toContain('Age category');
    expect(ROSTER_CSV_HEADER as readonly string[]).toContain('Category');
  });

  it('group events list participating home names only', () => {
    const html = rosterToHtml(groupRoster());

    // The group heading is the code plus participation type - no age band.
    expect(html).toContain('ART-002 · Group');
    expect(html).toContain('<table class="group-table">');
    expect(html).toContain('Arun Rainbow Nest');
    expect(html).toContain('Bala Mandir');

    // No child names, no participant codes, no team names.
    expect(html).not.toContain('Asha');
    expect(html).not.toContain('Chandra');
    expect(html).not.toContain('NK26-');
    expect(html).not.toContain('Rainbow Stars');

    // No age/category breakdowns in a group-event PDF.
    expect(html).not.toContain('Sub Juniors');
    expect(html).not.toContain('all levels');
  });

  it('lists each participating home once, never one row per child', () => {
    const html = rosterToHtml(groupRoster());

    // Two children across two homes -> exactly two home rows.
    expect(html.split('<td class="home">').length - 1).toBe(2);
    expect(html).not.toContain('<th>Child Name</th>');
  });

  it('never invents missing participant codes or categories', () => {
    const roster = buildMasterRoster(baseInput({
      participants: [{
        participantId: 'P-1', participantCode: '', fullName: 'Asha',
        shelterHomeId: 'H-1', homeName: 'Arun Rainbow Nest', gender: '',
        age: null, standard: null, level: '',
      }],
    }));

    const html = rosterToHtml(roster);

    expect(html).toContain('<td>Asha</td>');
    expect(html).toContain('<td>-</td>');
    expect(html).not.toContain('NK26');
  });

  it('keeps CSV participant-level detail hidden by the group PDF', () => {
    const roster = groupRoster();
    const csvRows = rosterToCsvRows(roster);

    // CSV: detailed registration records - names, codes and team names.
    expect(csvRows.map(row => row[7])).toEqual(['Asha', 'Chandra']);
    expect(csvRows.every(row => row[6].startsWith('NK26-'))).toBe(true);
    expect(csvRows.map(row => row[9])).toEqual(['Rainbow Stars', 'Rainbow Stars']);
    expect(rosterToHtml(roster)).not.toContain('Asha');
  });

  it('groups individual entries by home, printing each home once', () => {
    const html = rosterToHtml(soloRoster());

    // Two of the three children share a home; the grouped home cell
    // prints each home name exactly once.
    expect(html.split('Arun Rainbow Nest').length - 1).toBe(1);
    expect(html.split('Bala Mandir').length - 1).toBe(1);
  });

  it('renders long home and child names in full with wrapped cells', () => {
    const longName = 'Aishwarya Venkatesan Ramanathan Subramanian Ganapathy';
    const longHome = "St. Joseph's Charitable Shelter Home for Children, Chennai";
    const roster = buildMasterRoster(baseInput({
      participants: [{
        participantId: 'P-1', participantCode: 'NK26-H1-001', fullName: longName,
        shelterHomeId: 'H-1', homeName: longHome, gender: 'FEMALE',
        age: 9, standard: 2, level: 'SUB_JUNIOR',
      }],
    }));

    const html = rosterToHtml(roster);

    expect(html).toContain(longName);
    expect(html).toContain(longHome);
    expect(html).toContain('overflow-wrap: anywhere');
  });

  it('keeps the branding, repeated headers and page-break rules', () => {
    const html = rosterToHtml(soloRoster());

    expect(html).toContain('NAKSHATRA 2026-27');
    expect(html).toContain('@page');
    expect(html).toContain('table-header-group');
  });
});

describe('roster file naming', () => {
  it('builds a timestamped, lowercase file stem', () => {
    const stem = rosterFileStem('Arts', new Date('2026-10-30T13:45:00'));

    expect(stem).toBe('nakshatra-arts-master-roster-2026-10-30-1345');
  });
});
