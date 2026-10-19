import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { Judging } from './judging';

const EVENT_BASE = {
  id: 'event-1',
  eventCode: 'E-01',
  name: 'Clay Modelling',
  category: 'ARTS',
  mode: 'SOLO',
  status: 'ACTIVE',
  eligibleLevels: ['JUNIOR'],
};

const JUDGE = {
  id: 'judge-1',
  eventId: 'event-1',
  judgeNumber: 1,
  name: 'Aadhavan',
  status: 'ACTIVE',
};

/**
 * Judge configuration tests. Score entry itself lives on the Scoring page;
 * this page configures the judges and reports their stored status.
 */
describe('Judging — judge setup flow', () => {
  let component: Judging;
  let calls: Array<{ action: string; payload: Record<string, unknown> }>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Judging],
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

    component = TestBed.createComponent(Judging).componentInstance;
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  function stubBackend(saveJudgesResponse?: unknown): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      calls.push({ action: request.action, payload: (request.payload ?? {}) as Record<string, unknown> });

      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'listEvents':
          return ok({ events: [EVENT_BASE] });
        case 'listEventJudges':
          return ok({ judges: [{ ...JUDGE, name: 'Aadhavan' }] });
        case 'listJudgeScores':
          return ok({ scores: [] });
        case 'saveEventJudges':
          return saveJudgesResponse ?? ok({
            judges: ((request.payload?.['judges'] ?? []) as Array<{ name: string }>).map((judge, index) => ({
              id: `judge-${index + 1}`,
              eventId: 'event-1',
              judgeNumber: index + 1,
              name: judge.name,
              status: 'ACTIVE',
            })),
          });
        default:
          return ok({});
      }
    });
  }

  it('adds, renames and removes judges without pre-filling anything', async () => {
    stubBackend();
    await TestBed.inject(ShelterDataService).loadEvents();
    component.selectedEventId.set('event-1');

    // Nothing is pre-filled: the count derives from what the coordinator enters.
    expect(component.judgeNames()).toEqual([]);
    expect(component.judgeCount()).toBe(0);

    component.addJudge();
    component.addJudge();
    expect(component.judgeCount()).toBe(2);

    component.updateJudgeName(0, 'Aadhavan');
    component.updateJudgeName(1, 'Gopalan');
    component.removeJudge(1);

    expect(component.judgeNames()).toEqual(['Aadhavan']);
  });

  it('saves the entered judge list through saveEventJudges and adopts the response', async () => {
    stubBackend();
    await TestBed.inject(ShelterDataService).loadEvents();
    component.selectedEventId.set('event-1');

    component.addJudge();
    component.updateJudgeName(0, 'Aadhavan');
    await component.saveJudges();

    const save = calls.find(call => call.action === 'saveEventJudges');
    expect(save?.payload).toEqual({ eventId: 'event-1', judges: [{ name: 'Aadhavan' }] });
    expect(component.judges()).toEqual([
      { id: 'judge-1', eventId: 'event-1', judgeNumber: 1, name: 'Aadhavan', status: 'ACTIVE' },
    ]);
  });

  it('refuses to save an empty judge list or unnamed judges', async () => {
    stubBackend();
    const notify = TestBed.inject(NotificationService);
    const errorSpy = vi.spyOn(notify, 'error');
    await TestBed.inject(ShelterDataService).loadEvents();
    component.selectedEventId.set('event-1');

    await component.saveJudges();
    expect(errorSpy).toHaveBeenCalledWith('Add at least one judge.', expect.anything());

    component.addJudge();
    await component.saveJudges();
    expect(errorSpy).toHaveBeenCalledWith('Every judge needs a name.', expect.anything());
    expect(calls.some(call => call.action === 'saveEventJudges')).toBe(false);
  });

  it('reports JUDGES_LOCKED_AFTER_SCORING kindly and re-reads the stored judges', async () => {
    stubBackend(new Promise(resolve => resolve(new Response(
      JSON.stringify({
        success: false,
        error: { code: 'JUDGES_LOCKED_AFTER_SCORING', message: 'locked after scoring' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))));

    const notify = TestBed.inject(NotificationService);
    const warningSpy = vi.spyOn(notify, 'warning');
    const errorSpy = vi.spyOn(notify, 'error');

    await TestBed.inject(ShelterDataService).loadEvents();
    component.selectedEventId.set('event-1');
    component.addJudge();
    component.updateJudgeName(0, 'Gopalan');
    await component.saveJudges();

    expect(warningSpy).toHaveBeenCalledWith('Judges can no longer be changed.', expect.stringContaining('scoring has already been submitted'));
    expect(errorSpy).not.toHaveBeenCalled();
    // The stored list is re-read after the rejection so the screen shows the truth.
    const saveIndex = calls.findIndex(call => call.action === 'saveEventJudges');
    expect(calls.findIndex(call => call.action === 'listEventJudges')).toBeGreaterThan(saveIndex);
  });
});

describe('Judging — configured judges list and submitted protection', () => {
  let fixture: ComponentFixture<Judging>;
  let component: Judging;
  /** Rows returned by listJudgeScores for the event. */
  let judgeScoresRows: Record<string, unknown>[];

  function stubBackend(): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'listEvents':
          return ok({ events: [EVENT_BASE] });
        case 'listShelterHomes':
          return ok({ shelterHomes: [] });
        case 'listParticipants':
          return ok({ participants: [] });
        case 'getPageData':
          return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
        case 'listEventJudges':
          return ok({
            judges: [
              { ...JUDGE, judgeNumber: 1, name: 'Aadhavan', status: 'ACTIVE' },
              { id: 'judge-2', eventId: 'event-1', judgeNumber: 2, name: 'Gopalan', status: 'REMOVED' },
            ],
          });
        case 'listJudgeScores':
          return ok({ scores: judgeScoresRows });
        default:
          return ok({});
      }
    });
  }

  beforeEach(async () => {
    judgeScoresRows = [];

    await TestBed.configureTestingModule({
      imports: [Judging],
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

    fixture = TestBed.createComponent(Judging);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  async function load(): Promise<void> {
    stubBackend();
    await TestBed.inject(ShelterDataService).loadEvents();
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectedEventId.set('event-1');
    await component.loadEvent('event-1');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('lists the configured judges with ACTIVE/REMOVED status and submission state', async () => {
    judgeScoresRows = [{
      id: 'score-row-1', eventId: 'event-1', judgeId: 'judge-1', participantId: 'participant-1',
      criteria: [], score: 8, status: 'SUBMITTED', version: 1, updatedAt: '', updatedBy: '',
    }];
    await load();

    expect(component.judges()).toHaveLength(2);
    expect(component.judgeStatusLabel(component.judges()[0])).toBe('ACTIVE');
    expect(component.judgeStatusLabel(component.judges()[1])).toBe('REMOVED');
    expect(component.judgeSubmissionLabel(component.judges()[0])).toBe('Scores submitted');
    expect(component.judgeSubmissionLabel(component.judges()[1])).toBe('No scores yet');

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('ACTIVE');
    expect(host.textContent).toContain('REMOVED');
    expect(host.textContent).toContain('Scores submitted');
  });

  it('disables rename and removal once any judge has submitted scores', async () => {
    judgeScoresRows = [{
      id: 'score-row-1', eventId: 'event-1', judgeId: 'judge-1', participantId: 'participant-1',
      criteria: [], score: 8, status: 'SUBMITTED', version: 1, updatedAt: '', updatedBy: '',
    }];
    await load();

    expect(component.judgesLocked()).toBe(true);

    const host = fixture.nativeElement as HTMLElement;
    const nameInput = host.querySelector('.judge-row input') as HTMLInputElement;
    const removeButton = Array
      .from(host.querySelectorAll('.judge-row button'))
      .find(button => (button.textContent ?? '').includes('Remove')) as HTMLButtonElement;
    expect(nameInput.disabled).toBe(true);
    expect(removeButton.disabled).toBe(true);
  });

  it('keeps the judge editor unlocked while only drafts exist', async () => {
    judgeScoresRows = [{
      id: 'score-row-1', eventId: 'event-1', judgeId: 'judge-1', participantId: 'participant-1',
      criteria: [], score: 8, status: 'DRAFT', version: 1, updatedAt: '', updatedBy: '',
    }];
    await load();

    expect(component.judgesLocked()).toBe(false);
    const nameInput = fixture.nativeElement.querySelector('.judge-row input') as HTMLInputElement;
    expect(nameInput.disabled).toBe(false);
    expect(component.judgeSubmissionLabel(component.judges()[0])).toBe('Draft scores only');
  });
});

/**
 * Error reporting: every judging load/save failure shows the safe error
 * category (code) so users can report it, and a failed save leaves the screen
 * showing exactly what is (not) persisted. Retrying a save is safe: it is an
 * upsert keyed by judge name and can never duplicate judges.
 */
describe('Judging — error reporting and persisted-state accuracy', () => {
  let component: Judging;
  let calls: Array<{ action: string; payload: Record<string, unknown> }>;
  /** Error envelope for saveEventJudges; null = success. */
  let saveFailure: { code: string; message: string } | null;
  /** Simulate a hard transport failure for saveEventJudges. */
  let saveTransportFailure: boolean;
  /** Judges the "backend" currently holds (for re-reads). */
  let storedJudges: Array<Record<string, unknown>>;

  beforeEach(async () => {
    saveFailure = null;
    saveTransportFailure = false;
    storedJudges = [{ ...JUDGE, name: 'Aadhavan' }];

    await TestBed.configureTestingModule({
      imports: [Judging],
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

    component = TestBed.createComponent(Judging).componentInstance;
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  function stubBackend(listJudgesFailure?: { code: string; message: string }): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      calls.push({ action: request.action, payload: (request.payload ?? {}) as Record<string, unknown> });

      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
      const fail = (error: { code: string; message: string }) => Promise.resolve(new Response(
        JSON.stringify({ success: false, error }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'listEvents':
          return ok({ events: [EVENT_BASE] });
        case 'listEventJudges':
          return listJudgesFailure ? fail(listJudgesFailure) : ok({ judges: storedJudges });
        case 'listJudgeScores':
          return ok({ scores: [] });
        case 'saveEventJudges':
          if (saveTransportFailure) return Promise.reject(new TypeError('Failed to fetch'));
          return saveFailure ? fail(saveFailure) : ok({
            judges: ((request.payload?.['judges'] ?? []) as Array<{ name: string }>).map((judge, index) => ({
              id: `judge-${index + 1}`,
              eventId: 'event-1',
              judgeNumber: index + 1,
              name: judge.name,
              status: 'ACTIVE',
            })),
          });
        default:
          return ok({});
      }
    });
  }

  async function loadWithTypedJudge(name: string): Promise<void> {
    await TestBed.inject(ShelterDataService).loadEvents();
    component.selectedEventId.set('event-1');
    await component.loadEvent('event-1');
    // The coordinator replaces the list with one entered judge.
    component.judgeNames.set([name]);
    await component.saveJudges();
  }

  it('shows the error category (code) in the load-failure banner so it can be reported', async () => {
    stubBackend({ code: 'BACKEND_ACTION_UNKNOWN', message: 'This feature isn’t available in the deployed backend yet — the backend is out of date.' });
    await TestBed.inject(ShelterDataService).loadEvents();
    component.selectedEventId.set('event-1');
    await component.loadEvent('event-1');

    expect(component.judgesState()).toBe('FAILED');
    expect(component.judgeError()).toContain('code: BACKEND_ACTION_UNKNOWN');
  });

  it('a rejected save claims nothing was saved, keeps the typed entries and shows the code', async () => {
    stubBackend();
    saveFailure = { code: 'JUDGE_NAME_DUPLICATE', message: 'Two judges of one event cannot share the same name.' };

    const notify = TestBed.inject(NotificationService);
    const errorSpy = vi.spyOn(notify, 'error');

    await loadWithTypedJudge('Gopalan');

    const detail = String(errorSpy.mock.calls.at(-1)?.[1] ?? '');
    expect(errorSpy.mock.calls.at(-1)?.[0]).toBe('Judges could not be saved.');
    expect(detail).toContain('code: JUDGE_NAME_DUPLICATE');
    expect(detail).toContain('Nothing was saved');
    // The typed entry survives for a corrected re-save; the stored list was
    // not re-read because a structured rejection wrote nothing.
    expect(component.judgeNames()).toEqual(['Gopalan']);
    expect(calls.filter(call => call.action === 'listEventJudges')).toHaveLength(1);
  });

  it('an unconfirmed save re-reads the stored judges but keeps the typed entries', async () => {
    stubBackend();
    saveTransportFailure = true;

    const notify = TestBed.inject(NotificationService);
    const errorSpy = vi.spyOn(notify, 'error');

    await loadWithTypedJudge('Gopalan');

    const detail = String(errorSpy.mock.calls.at(-1)?.[1] ?? '');
    expect(detail).toContain('couldn’t confirm');
    expect(detail).toContain('code: NETWORK_ERROR');
    // The stored truth is re-read (a second listEventJudges after the save)…
    const listCalls = calls.filter(call => call.action === 'listEventJudges');
    const saveIndex = calls.findIndex(call => call.action === 'saveEventJudges');
    expect(calls.filter((call, index) => call.action === 'listEventJudges' && index > saveIndex)).toHaveLength(1);
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
    // …while the coordinator's typed entry survives for a safe re-save.
    expect(component.judgeNames()).toEqual(['Gopalan']);
    expect(component.judges()).toEqual(storedJudges);
  });

  it('re-saving the same judge list after a failure never duplicates (upsert)', async () => {
    stubBackend();
    saveFailure = { code: 'UNHANDLED_ERROR', message: 'boom' };

    await loadWithTypedJudge('Gopalan');
    expect(calls.filter(call => call.action === 'saveEventJudges')).toHaveLength(1);

    // The failure is resolved and the same list is saved again.
    saveFailure = null;
    saveTransportFailure = false;
    await component.saveJudges();

    const saves = calls.filter(call => call.action === 'saveEventJudges');
    expect(saves).toHaveLength(2);
    expect(saves[1].payload).toEqual(saves[0].payload);
    // The adopted response holds exactly the sent list — one judge, one row.
    expect(component.judges()).toHaveLength(1);
    expect(component.judges()[0].name).toBe('Gopalan');
    expect(component.judgeNames()).toEqual(['Gopalan']);
  });
});
