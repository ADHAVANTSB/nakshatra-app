import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { Scoring } from './scoring';

/**
 * Scoring page — GROUP events score at TEAM level (one entry per judge per
 * team). The backend is the authority on every rule (see
 * backend-verification/test-group-team-scoring.js); these tests prove the
 * workspace presents one row per team, blocks teams with incomplete
 * attendance, builds ONE team entry (never per-member rows), reloads team
 * drafts after refresh and saves roster attendance in one batch.
 */

interface ScoringEventFixture {
  id: string;
  eventCode: string;
  name: string;
  category: string;
  mode: string;
  status: string;
  eligibleLevels: string[];
  scoringMode: 'CRITERIA' | 'SINGLE' | 'PENDING';
  criteria: Array<{ name: string; max: number }>;
}

const EVENT_DEFAULTS: ScoringEventFixture = {
  id: 'event-g1',
  eventCode: 'LIT-005',
  name: 'Quiz (SJ + J)',
  category: 'LITERARY',
  mode: 'GROUP',
  status: 'ACTIVE',
  eligibleLevels: ['JUNIOR'],
  scoringMode: 'SINGLE',
  criteria: [],
};

/** Swapped per test (the GROUP+CRITERIA test installs ART-002 Rangoli). */
let EVENT: ScoringEventFixture = { ...EVENT_DEFAULTS };

const HOME = {
  id: 'home-1',
  homeCode: 'H-01',
  homeName: 'Sunrise Home',
  address: '',
  contactName: '',
  contactPhone: '',
  status: 'ACTIVE',
  version: 1,
};

const TEAM = {
  id: 'team-1',
  teamCode: 'TM-0001',
  eventId: EVENT.id,
  name: 'Sunrise Quiz Team',
  status: 'READY',
  validationStatus: 'PASSED',
  shelterHomeId: 'home-1',
  version: 1,
  createdAt: '',
  createdBy: '',
  updatedAt: '',
  updatedBy: '',
};

/** 7 registered members; `unmarkedIds` stay without any attendance record. */
function members(): Array<Record<string, unknown>> {
  return Array.from({ length: 7 }, (_, index) => ({
    id: `member-${index + 1}`,
    teamId: TEAM.id,
    participantId: `p-${index + 1}`,
    status: 'ACTIVE',
    joinedAt: '',
    joinedBy: '',
  }));
}

function participants(): Array<Record<string, unknown>> {
  return Array.from({ length: 7 }, (_, index) => ({
    id: `p-${index + 1}`,
    participantCode: `P-000${index + 1}`,
    shelterHomeId: 'home-1',
    fullName: `Member ${index + 1}`,
    gender: 'FEMALE',
    age: 10,
    standard: 4,
    level: 'JUNIOR',
    eligibilityStatus: 'ELIGIBLE',
    validationStatus: 'PASSED',
    approvalStatus: 'APPROVED',
    lockStatus: 'UNLOCKED',
    version: 1,
    createdAt: '',
    createdBy: '',
    updatedAt: '',
    updatedBy: '',
  }));
}

function registrations(): Array<Record<string, unknown>> {
  return Array.from({ length: 7 }, (_, index) => ({
    id: `reg-${index + 1}`,
    participantId: `p-${index + 1}`,
    eventId: EVENT.id,
    registrationStatus: 'REGISTERED',
    version: 1,
  }));
}

/** Six PRESENT, one ABSENT (or unmarked when `unmarkedIds` includes it). */
function attendance(unmarkedIds: string[]): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < 7; index++) {
    const participantId = `p-${index + 1}`;
    if (unmarkedIds.includes(participantId)) continue;
    rows.push({
      id: `att-${index + 1}`,
      eventId: EVENT.id,
      participantId,
      teamId: '',
      status: participantId === 'p-7' ? 'ABSENT' : 'PRESENT',
      version: 1,
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
    });
  }
  return rows;
}

interface RecordedCall {
  action: string;
  payload: Record<string, unknown>;
}

describe('Scoring — GROUP events score at team level', () => {
  let component: Scoring;
  let calls: RecordedCall[];
  let unmarkedIds: string[];
  let judgeScores: Array<Record<string, unknown>>;

  function ok(data: unknown): Promise<Response> {
    return Promise.resolve(new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  }

  function stubBackend(): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      calls.push({ action: request.action, payload: request.payload ?? {} });

      switch (request.action) {
        case 'listEvents':
          return ok({ events: [EVENT] });
        case 'listParticipants':
          return ok({ participants: participants() });
        case 'listShelterHomes':
          return ok({ shelterHomes: [HOME] });
        case 'listEventRegistrations':
          return ok({ participantEvents: registrations() });
        case 'listTeams':
          return ok({ teams: [TEAM], members: members() });
        case 'listAttendance':
          return ok({ attendance: attendance(unmarkedIds) });
        case 'listEventJudges':
          return ok({ judges: [{ id: 'judge-1', eventId: EVENT.id, judgeNumber: 1, name: 'Judge One', status: 'ACTIVE' }] });
        case 'listJudgeScores':
          return ok({ scores: judgeScores });
        case 'listScores':
          return ok({ scores: [] });
        case 'saveJudgeScores': {
          const payload = request.payload as {
            entries: Array<Record<string, unknown>>;
            status?: string;
          };
          judgeScores = payload.entries.map((entry, index) => ({
            id: `jsc-${index}`,
            eventId: EVENT.id,
            judgeId: 'judge-1',
            participantId: '',
            scoringEntity: 'TEAM',
            teamId: entry['teamId'] ?? '',
            criteria: [],
            score: entry['score'] ?? 0,
            status: payload.status ?? 'DRAFT',
            version: 1,
            updatedAt: '',
            updatedBy: '',
          }));
          return ok({ scores: judgeScores });
        }
        case 'saveAttendanceBatch':
          return ok({
            results: (request.payload as { items: Array<{ participantId: string; status: string }> }).items.map(item => ({
              participantId: item.participantId,
              outcome: 'UPDATED',
              status: item.status,
              version: 2,
            })),
            summary: { total: 1, created: 0, updated: 1, unchanged: 0, versionConflicts: 0, invalid: 0 },
          });
        default:
          return Promise.resolve(new Response(
            JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ));
      }
    });
  }

  async function loadWorkspace(): Promise<void> {
    stubBackend();

    const store = TestBed.inject(ShelterDataService);
    await store.loadEvents();
    await store.loadParticipants('home-1');
    await store.loadEventRegistrations(EVENT.id);

    component = TestBed.createComponent(Scoring).componentInstance;
    component.selectedEventId.set(EVENT.id);
    await component.loadEvent(EVENT.id);
  }

  beforeEach(async () => {
    calls = [];
    unmarkedIds = [];
    judgeScores = [];
    EVENT = { ...EVENT_DEFAULTS };

    await TestBed.configureTestingModule({
      imports: [Scoring],
      providers: [provideRouter([])],
    }).compileComponents();

    const auth = TestBed.inject(AuthService);
    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google-id',
      email: 'tester@nakshatra.local',
      displayName: 'Test User',
      role: 'ADMIN',
      accessStatus: 'APPROVED',
      version: 1,
    });
    auth.setApplicationSession({
      id: 'spec-session',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('shows ONE row per team with registered / present / absent counts (7 / 6 / 1)', async () => {
    await loadWorkspace();

    const rows = component.teamRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].teamId).toBe(TEAM.id);
    expect(rows[0].teamName).toBe('Sunrise Quiz Team');
    expect(rows[0].registeredCount).toBe(7);
    expect(rows[0].presentCount).toBe(6);
    expect(rows[0].absentCount).toBe(1);
    expect(rows[0].scoreable).toBe(true);
  });

  it('the judge saves ONE team entry per team — never six member rows', async () => {
    await loadWorkspace();

    component.selectedJudgeId.set('judge-1');
    component.setJudgeScore(TEAM.id, 'Overall', '8');
    await component.submitJudgeFinal();

    const save = calls.find(call => call.action === 'saveJudgeScores');
    expect(save).toBeDefined();

    const entries = save?.payload['entries'] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]['teamId']).toBe(TEAM.id);
    expect(entries[0]['participantId']).toBeUndefined();
  });

  it('blocks the team and lists the missing members when attendance is incomplete', async () => {
    unmarkedIds = ['p-3'];
    await loadWorkspace();

    const row = component.teamRows()[0];
    expect(row.scoreable).toBe(false);
    expect(row.missingAttendance.map(entry => entry.participantId)).toEqual(['p-3']);
    expect(row.blockedReason).toContain('Member 3');
    expect(component.eligibleRowKeys()).not.toContain(TEAM.id);
  });

  it('renders the incomplete-attendance banner and disables that team\'s scoring', async () => {
    unmarkedIds = ['p-3'];
    stubBackend();

    const store = TestBed.inject(ShelterDataService);
    await store.loadEvents();
    await store.loadParticipants('home-1');
    await store.loadEventRegistrations(EVENT.id);

    const fixture: ComponentFixture<Scoring> = TestBed.createComponent(Scoring);
    component = fixture.componentInstance;
    // First render before any selection: ngOnInit must not start a load.
    fixture.detectChanges();
    await fixture.whenStable();

    component.selectedEventId.set(EVENT.id);
    await component.loadEvent(EVENT.id);
    component.selectedJudgeId.set('judge-1');
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(component.teamRows().length).toBe(1);
    expect(component.isGroupEvent()).toBe(true);
    expect(host.querySelector('[data-testid="team-attendance-incomplete"]')).not.toBeNull();
    expect(host.textContent).toContain('Team scoring is disabled — attendance incomplete.');

    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input.score-input'));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every(input => input.disabled)).toBe(true);
  });

  it('restores team drafts after a refresh (saved rows keyed judge + team)', async () => {
    judgeScores = [{
      id: 'jsc-1',
      eventId: EVENT.id,
      judgeId: 'judge-1',
      participantId: '',
      scoringEntity: 'TEAM',
      teamId: TEAM.id,
      criteria: [],
      score: 7.5,
      status: 'DRAFT',
      version: 4,
      updatedAt: '',
      updatedBy: '',
    }];
    await loadWorkspace();

    component.selectedJudgeId.set('judge-1');
    await component.loadJudgeScores(EVENT.id);

    expect(component.judgeScoreValue(TEAM.id, 'Overall')).toBe('7.5');
    // A draft reloads its value but never counts as an official aggregate.
    expect(component.officialAggregateLabel(TEAM.id)).toBe('—');
  });

  it('saves roster attendance as ONE batch and refreshes the eligible teams', async () => {
    unmarkedIds = ['p-3', 'p-4'];
    await loadWorkspace();

    expect(component.teamRows()[0].scoreable).toBe(false);

    component.queueTeamAttendance(TEAM.id, 'ABSENT');
    component.queueAttendance('p-3', 'PRESENT');
    await component.saveAttendanceBatch();

    const batch = calls.filter(call => call.action === 'saveAttendanceBatch');
    expect(batch).toHaveLength(1);

    const items = batch[0].payload['items'] as Array<{ participantId: string; status: string }>;
    expect(items).toHaveLength(7);
    expect(items.find(item => item.participantId === 'p-3')?.status).toBe('PRESENT');
    expect(items.every(item => item.status === 'PRESENT' || item.status === 'ABSENT')).toBe(true);

    // The team state is re-read from the backend after the save.
    expect(calls.filter(call => call.action === 'listAttendance').length).toBeGreaterThanOrEqual(2);
    expect(calls.filter(call => call.action === 'listTeams').length).toBeGreaterThanOrEqual(2);
  });

  it('a GROUP event on CRITERIA rules builds ONE team entry with the exact official criteria (ART-002 Rangoli)', async () => {
    EVENT = {
      ...EVENT_DEFAULTS,
      eventCode: 'ART-002',
      name: 'Rangoli',
      scoringMode: 'CRITERIA',
      criteria: [
        { name: 'Creativity', max: 10 },
        { name: 'Relevancy to topic', max: 10 },
        { name: 'Usage of colours', max: 10 },
        { name: 'Perfection', max: 10 },
      ],
    };
    await loadWorkspace();

    component.selectedJudgeId.set('judge-1');
    expect(component.judgeScoreFields()).toEqual([
      'Creativity', 'Relevancy to topic', 'Usage of colours', 'Perfection',
    ]);

    component.setJudgeScore(TEAM.id, 'Creativity', '5');
    component.setJudgeScore(TEAM.id, 'Relevancy to topic', '5.5');
    component.setJudgeScore(TEAM.id, 'Usage of colours', '6');
    component.setJudgeScore(TEAM.id, 'Perfection', '6');
    // The judge total is the criteria sum (22.5 of the 40-point maximum).
    expect(component.judgeRowTotal(TEAM.id)).toEqual({ label: '22.5 / 40', tone: 'complete' });

    await component.submitJudgeFinal();

    const save = calls.find(call => call.action === 'saveJudgeScores');
    expect(save).toBeDefined();

    // ONE entry per judge per team — never per-member rows — carrying the
    // exact official criteria; the judge total is their sum.
    const entries = save?.payload['entries'] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]['teamId']).toBe(TEAM.id);
    expect(entries[0]['participantId']).toBeUndefined();

    const criteria = entries[0]['criteria'] as Array<{ name: string; score: number }>;
    expect(criteria.map(criterion => criterion.name)).toEqual([
      'Creativity', 'Relevancy to topic', 'Usage of colours', 'Perfection',
    ]);
    expect(criteria.reduce((total, criterion) => total + criterion.score, 0)).toBe(22.5);
  });
});
