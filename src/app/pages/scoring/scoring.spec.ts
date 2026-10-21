import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import {
  JUDGES_INCOMPLETE_MESSAGE,
  SCORE_VALIDATION_MESSAGE,
  Scoring,
  validateJudgeScore,
} from './scoring';

/**
 * Scoring page state tests: a failed registrations read must offer a working
 * Retry. The component is created without change detection so `ngOnInit`
 * never starts a load.
 */

describe('Scoring — registrations retry and conflict reporting', () => {
  let component: Scoring;

  beforeEach(async () => {
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

    component = TestBed.createComponent(Scoring).componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  function registrationEnvelope(ok: boolean): Response {
    return new Response(
      JSON.stringify(ok
        ? { success: true, data: { participantEvents: [] } }
        : { success: false, error: { code: 'BACKEND_ERROR', message: 'Registrations unavailable' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('re-issues the registrations read when the retry control is used', async () => {
    let listingWorks = false;
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(registrationEnvelope(listingWorks));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    component.selectedEventId.set('event-1');

    await component.loadRegistrations('event-1');
    expect(component.registrationsState()).toBe('FAILED');

    listingWorks = true;
    await component.retryRegistrations();

    expect(component.registrationsState()).toBe('LOADED');
    expect(component.registrationError()).toBe('');
  });
});

/**
 * Finalization lock: an event whose persisted scores are all FINALIZED shows
 * the locked message and renders no score write controls, while a
 * non-finalized event keeps them.
 */
describe('Scoring — finalization lock', () => {
  let fixture: ComponentFixture<Scoring>;
  let component: Scoring;

  const EVENT = {
    id: 'event-1',
    eventCode: 'E-01',
    name: 'Vocal Solo',
    category: 'ARTS',
    mode: 'SOLO',
    status: 'ACTIVE',
    eligibleLevels: ['JUNIOR'],
    scoringMode: 'CRITERIA',
    criteria: [{ name: 'Creativity', max: 10 }],
  };

  const PARTICIPANT = {
    id: 'participant-1',
    participantCode: 'P-0001',
    shelterHomeId: 'home-1',
    fullName: 'Test Participant',
    gender: 'MALE',
    age: 10,
    standard: 5,
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
  } as never;

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

  function score(status: 'DRAFT' | 'FINALIZED'): Record<string, unknown> {
    return {
      id: 'score-1',
      eventId: 'event-1',
      participantId: 'participant-1',
      value: 10,
      status,
      version: 1,
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
    };
  }

  /** Error envelope finalizeEvent answers with; null = successful finalize. */
  let finalizeError: { code: string; message: string } | null = null;

  function stubBackend(scoreStatus: 'DRAFT' | 'FINALIZED'): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      if (request.action === 'listEvents') return ok({ events: [EVENT] });
      if (request.action === 'listParticipants') return ok({ participants: [PARTICIPANT] });
      if (request.action === 'listShelterHomes') return ok({ shelterHomes: [HOME] });
      if (request.action === 'finalizeEvent') {
        return finalizeError
          ? Promise.resolve(new Response(
              JSON.stringify({ success: false, error: finalizeError }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ))
          : ok({
              eventId: 'event-1',
              operationId: 'op-1',
              alreadyFinalized: false,
              finalizedCount: 1,
              totalScores: 1,
              scores: [],
            });
      }
      if (request.action === 'listEventRegistrations') {
        return ok({
          participantEvents: [{
            id: 'reg-1',
            participantId: 'participant-1',
            eventId: 'event-1',
            registrationStatus: 'REGISTERED',
            version: 1,
          }],
        });
      }
      if (request.action === 'listAttendance') {
        return ok({
          attendance: [{
            id: 'att-1',
            eventId: 'event-1',
            participantId: 'participant-1',
            teamId: '',
            status: 'PRESENT',
            version: 1,
            createdAt: '',
            createdBy: '',
            updatedAt: '',
            updatedBy: '',
          }],
        });
      }
      if (request.action === 'listScores') return ok({ scores: [score(scoreStatus)] });
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });
  }

  async function render(scoreStatus: 'DRAFT' | 'FINALIZED'): Promise<void> {
    stubBackend(scoreStatus);

    const store = TestBed.inject(ShelterDataService);
    await store.loadEvents();
    await store.loadParticipants('home-1');
    await store.loadEventRegistrations('event-1');

    fixture = TestBed.createComponent(Scoring);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    component.selectedEventId.set('event-1');
    await component.loadEvent('event-1');
    fixture.detectChanges();
  }

  function buttonLabels(): string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .map(button => (button.textContent ?? '').trim());
  }

  beforeEach(async () => {
    finalizeError = null;

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

  it('a finalized event shows the locked message and no finalize controls', async () => {
    await render('FINALIZED');

    const host = fixture.nativeElement as HTMLElement;
    expect(component.eventFinalized()).toBe(true);
    expect(host.textContent).toContain('This event has been finalized. Attendance and scores are locked.');

    const labels = buttonLabels();
    expect(labels).not.toContain('Save scores');
    expect(labels).not.toContain('Finalize Event');
    expect(labels).not.toContain('Edit');
    expect(labels).toContain('Reopen for correction');
  });

  it('a non-finalized event keeps finalization and no legacy manual score controls', async () => {
    await render('DRAFT');

    const host = fixture.nativeElement as HTMLElement;
    expect(component.eventFinalized()).toBe(false);
    expect(host.textContent).not.toContain('This event has been finalized. Attendance and scores are locked.');

    const labels = buttonLabels();
    // The one official scoring path is judge-based: the legacy manual
    // entry controls (Save scores / per-row Edit) are gone for good.
    expect(labels).toContain('Finalize Event');
    expect(labels).not.toContain('Save scores');
    expect(labels).not.toContain('Edit');
    expect(labels).not.toContain('Reopen for correction');
  });

  it('surfaces JUDGE_SCORES_INCOMPLETE from finalizeEvent in plain English', async () => {
    finalizeError = { code: 'JUDGE_SCORES_INCOMPLETE', message: 'missing judge/submission ids' };
    await render('DRAFT');

    const notify = TestBed.inject(NotificationService);
    const errorSpy = vi.spyOn(notify, 'error');

    await component.finalizeEventAction();

    expect(errorSpy).toHaveBeenCalledWith(
      'Every judge must submit final scores before this event can be finalized.',
      expect.stringContaining('code: JUDGE_SCORES_INCOMPLETE'),
    );
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('missing judge/submission ids');
  });
});

describe('Scoring — judge score validation (0–10 in 0.5 steps)', () => {
  it('accepts empty input, endpoints and valid 0.5 increments', () => {
    expect(validateJudgeScore('')).toEqual({ empty: true });
    expect(validateJudgeScore('   ')).toEqual({ empty: true });
    expect(validateJudgeScore('0')).toEqual({ value: 0 });
    expect(validateJudgeScore('10')).toEqual({ value: 10 });
    expect(validateJudgeScore('0.5')).toEqual({ value: 0.5 });
    expect(validateJudgeScore('7.5')).toEqual({ value: 7.5 });
  });

  it('rejects values below 0, above 10 and non-0.5 increments with the exact message', () => {
    for (const raw of ['-1', '-0.5', '10.5', '11', '0.25', '7.3', 'abc', '1e2']) {
      expect(validateJudgeScore(raw)).toEqual({ error: SCORE_VALIDATION_MESSAGE });
    }
    expect(SCORE_VALIDATION_MESSAGE).toBe('Scores must be 0–10 in increments of 0.5');
  });
});

const WORKSPACE_EVENT = {
  id: 'event-1',
  eventCode: 'E-01',
  name: 'Clay Modelling',
  category: 'ARTS',
  mode: 'SOLO',
  status: 'ACTIVE',
  eligibleLevels: ['JUNIOR'],
};

const WORKSPACE_PARTICIPANT = {
  id: 'participant-1',
  participantCode: 'P-0001',
  shelterHomeId: 'home-1',
  fullName: 'Bhavana M',
  gender: 'FEMALE',
  age: 10,
  standard: 5,
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
};

const WORKSPACE_HOME = {
  id: 'home-1',
  homeCode: 'H-01',
  homeName: 'Sunrise Home',
  address: '',
  contactName: '',
  contactPhone: '',
  status: 'ACTIVE',
  version: 1,
};

const WORKSPACE_JUDGE = {
  id: 'judge-1',
  eventId: 'event-1',
  judgeNumber: 1,
  name: 'Aadhavan',
  status: 'ACTIVE',
};

/** A saved judge-score row as `listJudgeScores` returns it (DRAFT or SUBMITTED). */
function savedScoreRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'score-row-1',
    eventId: 'event-1',
    judgeId: 'judge-1',
    participantId: 'participant-1',
    criteria: [],
    score: 0,
    status: 'DRAFT',
    version: 3,
    updatedAt: '',
    updatedBy: 'coordinator',
    ...overrides,
  };
}

/**
 * The combined judging + scoring workspace: judges configured on /judging
 * appear here automatically, a judge selector reviews/enters each judge's
 * scores, and the per-judge total stays clearly distinct from the official
 * aggregate (the average of submitted judge totals).
 */
describe('Scoring — judge scoring workspace', () => {
  let fixture: ComponentFixture<Scoring>;
  let component: Scoring;
  /** Rows returned by listJudgeScores for the event (all judges). */
  let judgeScoresRows: Record<string, unknown>[];
  /** Judges returned by listEventJudges; empty drives the empty state. */
  let judgesRows: Record<string, unknown>[];
  let requests: Array<{ action: string; payload: Record<string, unknown> }>;

  async function render(event: Record<string, unknown>): Promise<void> {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      requests.push({ action: request.action, payload: (request.payload ?? {}) as Record<string, unknown> });
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'listEvents':
          return ok({ events: [event] });
        case 'listShelterHomes':
          return ok({ shelterHomes: [WORKSPACE_HOME] });
        case 'listParticipants':
          return ok({ participants: [WORKSPACE_PARTICIPANT] });
        case 'listEventRegistrations':
          return ok({
            participantEvents: [{
              id: 'reg-1',
              participantId: 'participant-1',
              eventId: 'event-1',
              registrationStatus: 'REGISTERED',
              version: 1,
            }],
          });
        case 'listAttendance':
          return ok({
            attendance: [{
              id: 'att-1',
              eventId: 'event-1',
              participantId: 'participant-1',
              teamId: '',
              status: 'PRESENT',
              version: 1,
              createdAt: '',
              createdBy: '',
              updatedAt: '',
              updatedBy: '',
            }],
          });
        case 'listEventJudges':
          return ok({ judges: judgesRows });
        case 'listJudgeScores':
          return ok({ scores: judgeScoresRows });
        case 'listScores':
          return ok({ scores: [] });
        case 'getPageData':
          return ok({ shelterHomes: [WORKSPACE_HOME], participants: [WORKSPACE_PARTICIPANT], imports: [], validationResults: [] });
        default:
          return ok({});
      }
    });

    const store = TestBed.inject(ShelterDataService);
    await store.loadEvents();
    await store.loadParticipants('home-1');

    fixture = TestBed.createComponent(Scoring);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    component.selectedEventId.set('event-1');
    await component.loadEvent('event-1');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function scoreInputs(): HTMLElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('input.score-input'));
  }

  beforeEach(async () => {
    judgeScoresRows = [];
    judgesRows = [WORKSPACE_JUDGE];
    requests = [];

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

  it('PENDING events show the precise pending placeholder (which event, what is needed) and no score inputs', async () => {
    // Only an eventCode outside EVENT_SCORING_RULES is PENDING now that every
    // official catalogue event carries its official judging rule.
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-999', name: 'Unmapped Event', scoringMode: 'PENDING' });

    const host = fixture.nativeElement as HTMLElement;
    // WHICH event + WHAT is missing + WHERE the authorized administrator supplies it.
    expect(host.textContent).toContain('Official judging criteria for LIT-999 Unmapped Event have not been supplied');
    expect(host.textContent).toContain('EVENT_SCORING_RULES');
    expect(host.textContent).toContain('CRITERIA list');
    expect(host.textContent).toContain('SINGLE overall score');
    expect(scoreInputs().length).toBe(0);
  });

  it('CUL-002 Skit (Tamil) renders one column per official criterion (exact official list)', async () => {
    await render({
      ...WORKSPACE_EVENT,
      eventCode: 'CUL-002',
      name: 'Skit (Tamil)',
      scoringMode: 'CRITERIA',
      criteria: [
        { name: 'Concept & Creativity', max: 10 },
        { name: 'Coordination', max: 10 },
        { name: 'Dialogue Delivery', max: 10 },
        { name: 'Acting and Expressions', max: 10 },
        { name: 'Usage of Stage,costume, props', max: 10 },
      ],
    });

    const host = fixture.nativeElement as HTMLElement;
    for (const name of [
      'Concept & Creativity',
      'Coordination',
      'Dialogue Delivery',
      'Acting and Expressions',
      'Usage of Stage,costume, props',
    ]) {
      expect(host.textContent).toContain(name);
    }
    expect(scoreInputs().length).toBe(5);
  });

  it('SINGLE events show one overall column per judge with the rounds note', async () => {
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-004', name: 'Potpourri', scoringMode: 'SINGLE' });

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Rounds are one event-level entry');
    expect(host.textContent).toContain('Overall');
    // One present participant — one overall column.
    expect(scoreInputs().length).toBe(1);
  });

  it('CRITERIA events show one column per official criterion', async () => {
    await render({
      ...WORKSPACE_EVENT,
      scoringMode: 'CRITERIA',
      criteria: [{ name: 'Creativity', max: 10 }, { name: 'Perfection', max: 10 }],
    });

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Creativity');
    expect(host.textContent).toContain('Perfection');
    expect(scoreInputs().length).toBe(2);
  });

  it('rejects an invalid score inline and blocks the save until it is fixed', async () => {
    await render({
      ...WORKSPACE_EVENT,
      scoringMode: 'CRITERIA',
      criteria: [{ name: 'Creativity', max: 10 }, { name: 'Perfection', max: 10 }],
    });

    const notify = TestBed.inject(NotificationService);
    const errorSpy = vi.spyOn(notify, 'error');

    component.setJudgeScore('participant-1', 'Creativity', '7.3');
    expect(component.judgeFieldError('participant-1', 'Creativity')).toBe(SCORE_VALIDATION_MESSAGE);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(SCORE_VALIDATION_MESSAGE);

    await component.saveJudgeDraft();
    expect(errorSpy).toHaveBeenCalledWith('Fix invalid scores first.', expect.stringContaining('0–10'));

    component.setJudgeScore('participant-1', 'Creativity', '7.5');
    component.setJudgeScore('participant-1', 'Perfection', '8');
    expect(component.judgeFieldError('participant-1', 'Creativity')).toBe('');
    expect(component.judgeRowTotal('participant-1')).toEqual({ label: '15.5 / 20', tone: 'complete' });
  });

  it('LIT-006 Quiz (S+SS) renders as SINGLE — one overall column and the rounds note', async () => {
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-006', name: 'Quiz (S+SS)', scoringMode: 'SINGLE' });

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Rounds are one event-level entry');
    expect(host.textContent).toContain('Overall');
    expect(scoreInputs().length).toBe(1);
  });

  it('SINGLE drives the one-column grid regardless of the event name', async () => {
    await render({ ...WORKSPACE_EVENT, name: 'Clay Modelling', scoringMode: 'SINGLE' });

    expect(scoreInputs().length).toBe(1);
  });

  it('an event named Quiz keeps per-criterion columns when its mode is CRITERIA (no name matching)', async () => {
    await render({
      ...WORKSPACE_EVENT,
      eventCode: 'LIT-006',
      name: 'Quiz (S+SS)',
      scoringMode: 'CRITERIA',
      criteria: [{ name: 'Creativity', max: 10 }, { name: 'Perfection', max: 10 }],
    });

    expect(scoreInputs().length).toBe(2);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Rounds are one event-level entry');
  });

  it('fills the grid from saved DRAFT scores when the event is opened', async () => {
    judgeScoresRows = [savedScoreRow({
      criteria: [{ name: 'Creativity', score: 7.5 }, { name: 'Perfection', score: 8 }],
      score: 15.5,
    })];
    await render({
      ...WORKSPACE_EVENT,
      scoringMode: 'CRITERIA',
      criteria: [{ name: 'Creativity', max: 10 }, { name: 'Perfection', max: 10 }],
    });

    expect(component.judgeScoreValue('participant-1', 'Creativity')).toBe('7.5');
    expect(component.judgeScoreValue('participant-1', 'Perfection')).toBe('8');
    const inputs = scoreInputs() as HTMLInputElement[];
    expect(inputs[0].value).toBe('7.5');
    expect(inputs[1].value).toBe('8');
  });

  it('fills the grid from a saved SINGLE draft (overall score)', async () => {
    judgeScoresRows = [savedScoreRow({ score: 8.5 })];
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-006', name: 'Quiz (S+SS)', scoringMode: 'SINGLE' });

    expect(component.judgeScoreValue('participant-1', 'Overall')).toBe('8.5');
    expect((scoreInputs()[0] as HTMLInputElement).value).toBe('8.5');
  });

  it('reloads saved scores on a judge switch and keeps in-progress edits', async () => {
    judgeScoresRows = [savedScoreRow({
      criteria: [{ name: 'Creativity', score: 7.5 }, { name: 'Perfection', score: 8 }],
      score: 15.5,
    })];
    await render({
      ...WORKSPACE_EVENT,
      scoringMode: 'CRITERIA',
      criteria: [{ name: 'Creativity', max: 10 }, { name: 'Perfection', max: 10 }],
    });

    component.setJudgeScore('participant-1', 'Creativity', '9');

    // The stored sheet changes elsewhere while the judge is typing.
    judgeScoresRows = [savedScoreRow({
      criteria: [{ name: 'Creativity', score: 6 }, { name: 'Perfection', score: 6 }],
      score: 12,
    })];
    await component.setJudge('judge-1');

    // In-progress edits win; untouched cells adopt the reloaded values.
    expect(component.judgeScoreValue('participant-1', 'Creativity')).toBe('9');
    expect(component.judgeScoreValue('participant-1', 'Perfection')).toBe('6');
  });

  it('sends the loaded row version as expectedVersion when saving', async () => {
    judgeScoresRows = [savedScoreRow({ score: 8.5 })];
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-006', name: 'Quiz (S+SS)', scoringMode: 'SINGLE' });

    await component.saveJudgeDraft();

    const save = requests.find(request => request.action === 'saveJudgeScores');
    expect(save?.payload).toEqual({
      eventId: 'event-1',
      judgeId: 'judge-1',
      entries: [{ participantId: 'participant-1', score: 8.5, expectedVersion: 3 }],
      status: 'DRAFT',
    });
  });

  it('omits expectedVersion for a participant with no saved row', async () => {
    judgeScoresRows = [];
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-006', name: 'Quiz (S+SS)', scoringMode: 'SINGLE' });

    component.setJudgeScore('participant-1', 'Overall', '7');
    await component.saveJudgeDraft();

    const save = requests.find(request => request.action === 'saveJudgeScores');
    expect(save?.payload).toEqual({
      eventId: 'event-1',
      judgeId: 'judge-1',
      entries: [{ participantId: 'participant-1', score: 7 }],
      status: 'DRAFT',
    });
  });

  it('shows the judges configured on /judging automatically, with submission status', async () => {
    judgesRows = [
      WORKSPACE_JUDGE,
      { id: 'judge-2', eventId: 'event-1', judgeNumber: 2, name: 'Gopalan', status: 'ACTIVE' },
    ];
    judgeScoresRows = [savedScoreRow({ score: 8.5, status: 'SUBMITTED' })];
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-006', name: 'Quiz (S+SS)', scoringMode: 'SINGLE' });

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Aadhavan');
    expect(host.textContent).toContain('Gopalan');
    expect(host.textContent).toContain('2 active judge(s)');
    expect(host.textContent).toContain('Submitted');
    expect(host.textContent).toContain('Not started');
    // Saved scores are loaded as part of the same event read.
    expect(requests.some(request => request.action === 'listEventJudges')).toBe(true);
    expect(requests.some(request => request.action === 'listJudgeScores')).toBe(true);
  });

  it('offers an empty state with a link to /judging when no judges are configured', async () => {
    judgesRows = [];
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-006', name: 'Quiz (S+SS)', scoringMode: 'SINGLE' });

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('No judges configured yet');
    expect(host.textContent).toContain('Set up judges on the Judging page');
  });

  it('keeps each judge’s scores separate — switching judges never cross-overwrites', async () => {
    judgesRows = [
      WORKSPACE_JUDGE,
      { id: 'judge-2', eventId: 'event-1', judgeNumber: 2, name: 'Gopalan', status: 'ACTIVE' },
    ];
    judgeScoresRows = [
      savedScoreRow({ judgeId: 'judge-1', score: 8.5, version: 3 }),
      savedScoreRow({ id: 'score-row-2', judgeId: 'judge-2', score: 7, version: 1 }),
    ];
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-006', name: 'Quiz (S+SS)', scoringMode: 'SINGLE' });

    expect(component.selectedJudgeId()).toBe('judge-1');
    expect(component.judgeScoreValue('participant-1', 'Overall')).toBe('8.5');

    component.setJudgeScore('participant-1', 'Overall', '9');
    await component.setJudge('judge-2');
    expect(component.judgeScoreValue('participant-1', 'Overall')).toBe('7');

    await component.setJudge('judge-1');
    expect(component.judgeScoreValue('participant-1', 'Overall')).toBe('9');
  });

  it('survives a page refresh: a fresh workspace reloads drafts and submissions', async () => {
    judgeScoresRows = [savedScoreRow({ score: 8.5, status: 'SUBMITTED', version: 5 })];
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-006', name: 'Quiz (S+SS)', scoringMode: 'SINGLE' });

    // A refresh is a brand-new component reading the same persisted rows.
    fixture = TestBed.createComponent(Scoring);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectedEventId.set('event-1');
    await component.loadEvent('event-1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.judgeScoreValue('participant-1', 'Overall')).toBe('8.5');
    expect((scoreInputs()[0] as HTMLInputElement).value).toBe('8.5');
    expect(component.judgeSubmission('judge-1')).toBe('SUBMITTED');
  });

  it('distinguishes the judge total from the official aggregate (average of submitted totals)', async () => {
    judgesRows = [
      WORKSPACE_JUDGE,
      { id: 'judge-2', eventId: 'event-1', judgeNumber: 2, name: 'Gopalan', status: 'ACTIVE' },
      { id: 'judge-3', eventId: 'event-1', judgeNumber: 3, name: 'Removed Judge', status: 'REMOVED' },
    ];
    judgeScoresRows = [
      savedScoreRow({
        judgeId: 'judge-1',
        status: 'SUBMITTED',
        criteria: [{ name: 'Creativity', score: 7.5 }, { name: 'Perfection', score: 8 }],
        score: 15.5,
      }),
      savedScoreRow({
        id: 'score-row-2',
        judgeId: 'judge-2',
        status: 'SUBMITTED',
        criteria: [{ name: 'Creativity', score: 6 }, { name: 'Perfection', score: 6 }],
        score: 12,
      }),
      // Removed judges and drafts are excluded from the official aggregate.
      savedScoreRow({
        id: 'score-row-3',
        judgeId: 'judge-3',
        status: 'SUBMITTED',
        criteria: [{ name: 'Creativity', score: 10 }, { name: 'Perfection', score: 10 }],
        score: 20,
      }),
    ];
    await render({
      ...WORKSPACE_EVENT,
      scoringMode: 'CRITERIA',
      criteria: [{ name: 'Creativity', max: 10 }, { name: 'Perfection', max: 10 }],
    });

    // (15.5 + 12) / 2 = 13.75 — displayed with the official one-decimal rule.
    expect(component.officialAggregate('participant-1')).toBe(13.75);
    expect(component.officialAggregateLabel('participant-1')).toBe('13.8');
    // The judge total is the judge's own criteria sum, distinct from the aggregate.
    expect(component.judgeRowTotal('participant-1')).toEqual({ label: '15.5 / 20', tone: 'complete' });

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Official aggregate');
    expect(host.textContent).toContain('13.8');
  });

  it('blocks finalization until every active judge has submitted — JUDGE_SCORES_INCOMPLETE in plain English', async () => {
    judgesRows = [
      WORKSPACE_JUDGE,
      { id: 'judge-2', eventId: 'event-1', judgeNumber: 2, name: 'Gopalan', status: 'ACTIVE' },
    ];
    judgeScoresRows = [savedScoreRow({ score: 8.5, status: 'SUBMITTED' })];
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-006', name: 'Quiz (S+SS)', scoringMode: 'SINGLE' });

    expect(component.allJudgesSubmitted()).toBe(false);
    expect(component.missingJudgeSubmissions()).toEqual(['Gopalan → Bhavana M']);

    const notify = TestBed.inject(NotificationService);
    const errorSpy = vi.spyOn(notify, 'error');
    await component.finalizeEventAction();

    expect(errorSpy).toHaveBeenCalledWith(JUDGES_INCOMPLETE_MESSAGE);
    expect(requests.some(request => request.action === 'finalizeEvent')).toBe(false);

    // Once the second judge submits, the gate opens.
    judgeScoresRows = [
      savedScoreRow({ score: 8.5, status: 'SUBMITTED' }),
      savedScoreRow({ id: 'score-row-2', judgeId: 'judge-2', score: 7, status: 'SUBMITTED', version: 1 }),
    ];
    await component.loadJudgeScores('event-1');
    expect(component.allJudgesSubmitted()).toBe(true);
  });

  it('keeps PENDING events unfinalizable and judge-score free', async () => {
    await render({ ...WORKSPACE_EVENT, eventCode: 'LIT-999', name: 'Unmapped Event', scoringMode: 'PENDING' });

    const notify = TestBed.inject(NotificationService);
    const warningSpy = vi.spyOn(notify, 'warning');
    await component.finalizeEventAction();

    // Precise and actionable: WHICH event, WHAT is missing, WHERE it is supplied.
    expect(warningSpy).toHaveBeenCalledWith(
      'Official judging criteria for LIT-999 Unmapped Event have not been supplied',
      expect.stringContaining('EVENT_SCORING_RULES'),
    );
    expect(requests.some(request => request.action === 'finalizeEvent')).toBe(false);
  });
});
