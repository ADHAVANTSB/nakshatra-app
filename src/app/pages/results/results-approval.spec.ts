import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { Results } from './results';

const EVENT = {
  id: 'event-1',
  eventCode: 'E-01',
  name: 'Clay Modelling',
  category: 'ARTS',
  mode: 'SOLO',
  status: 'ACTIVE',
  eligibleLevels: ['JUNIOR'],
};

function participant(id: string, name: string): Record<string, unknown> {
  return {
    id,
    participantCode: `P-${id}`,
    shelterHomeId: 'home-1',
    fullName: name,
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
}

const PARTICIPANT_1 = participant('participant-1', 'Bhavana M');
const PARTICIPANT_2 = participant('participant-2', 'Pradhiba S');

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

/**
 * Unified Results workspace — reconciliation and reviewer decision tests:
 * the counts are backed by the participant-level reconciliation, accepting
 * with unresolved discrepancies needs an explicit per-item acknowledgement,
 * and returning results requires a comment.
 */
describe('Results — reconciliation and reviewer decision', () => {
  let fixture: ComponentFixture<Results>;
  let component: Results;
  let calls: Array<{ action: string; payload: Record<string, unknown> }>;
  let saveResultResponse: () => Promise<Response>;

  const ok = (data: unknown) => Promise.resolve(new Response(
    JSON.stringify({ success: true, data }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));

  function stubBackend(
    judgeFixtures: { judges?: unknown[]; judgeScores?: unknown[] } = {},
  ): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      calls.push({ action: request.action, payload: (request.payload ?? {}) as Record<string, unknown> });

      switch (request.action) {
        case 'listResults':
          return ok({ results: [] });
        case 'listEvents':
          return ok({ events: [EVENT] });
        case 'listShelterHomes':
          return ok({ shelterHomes: [HOME] });
        case 'listParticipants':
          return ok({ participants: [PARTICIPANT_1, PARTICIPANT_2] });
        case 'listEventRegistrations':
          return ok({
            participantEvents: [
              { id: 'reg-1', participantId: 'participant-1', eventId: 'event-1', registrationStatus: 'REGISTERED', version: 1 },
              { id: 'reg-2', participantId: 'participant-2', eventId: 'event-1', registrationStatus: 'REGISTERED', version: 1 },
            ],
          });
        case 'listAttendance':
          return ok({
            attendance: [
              { id: 'att-1', eventId: 'event-1', participantId: 'participant-1', teamId: '', status: 'PRESENT', version: 1, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' },
              { id: 'att-2', eventId: 'event-1', participantId: 'participant-2', teamId: '', status: 'PRESENT', version: 1, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' },
            ],
          });
        case 'listScores':
          // participant-1 scored; participant-2 attended but has no score.
          return ok({
            scores: [{
              id: 'score-1',
              eventId: 'event-1',
              participantId: 'participant-1',
              value: 9,
              status: 'DRAFT',
              version: 1,
              createdAt: '',
              createdBy: '',
              updatedAt: '',
              updatedBy: '',
            }],
          });
        case 'listEventJudges':
          return ok({ judges: judgeFixtures.judges ?? [] });
        case 'listJudgeScores':
          return ok({ scores: judgeFixtures.judgeScores ?? [] });
        case 'getPageData':
          return ok({ shelterHomes: [HOME], participants: [PARTICIPANT_1, PARTICIPANT_2], imports: [], validationResults: [] });
        case 'saveResultApproval':
          return saveResultResponse();
        default:
          return ok({});
      }
    });
  }

  async function render(
    judgeFixtures: { judges?: unknown[]; judgeScores?: unknown[] } = {},
  ): Promise<void> {
    stubBackend(judgeFixtures);

    const store = TestBed.inject(ShelterDataService);
    await store.loadEvents();
    await store.loadParticipants('home-1');

    fixture = TestBed.createComponent(Results);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    component.selectedEventId.set('event-1');
    await component.retryData();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    calls = [];
    saveResultResponse = () => ok({});

    await TestBed.configureTestingModule({
      imports: [Results],
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

  it('shows the three count cards backed by the participant rows', async () => {
    await render();

    expect(component.registeredCount()).toBe(2);
    expect(component.attendanceCount()).toBe(2);
    expect(component.scoringCompletedCount()).toBe(1);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Registered');
    expect(host.textContent).toContain('Event Attendance');
    expect(host.textContent).toContain('Scoring Completed');
  });

  it('names exactly what each participant is missing in the reconciliation table', async () => {
    await render();

    const rows = component.rows();
    expect(rows).toHaveLength(2);

    const complete = rows.find(row => row.participantId === 'participant-1');
    const missing = rows.find(row => row.participantId === 'participant-2');
    expect(complete?.statusText).toBe('Registration, attendance and scoring complete');
    expect(complete?.ok).toBe(true);
    expect(missing?.statusText).toBe('Registered — missing: scoring');
    expect(missing?.ok).toBe(false);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Registered — missing: scoring');
    expect(host.querySelectorAll('tr.discrepancy').length).toBe(1);
  });

  it('counts judge submissions into the scoring check and names them per row', async () => {
    // Two active judges; only one has submitted for participant-2.
    await render({
      judges: [
        { id: 'judge-1', eventId: 'event-1', judgeNumber: 1, name: 'Aadhavan', status: 'ACTIVE' },
        { id: 'judge-2', eventId: 'event-1', judgeNumber: 2, name: 'Gopalan', status: 'ACTIVE' },
      ],
      judgeScores: [
        { id: 'js-1', eventId: 'event-1', judgeId: 'judge-1', participantId: 'participant-1', criteria: [], score: 8, status: 'SUBMITTED', version: 1, updatedAt: '', updatedBy: '' },
        { id: 'js-2', eventId: 'event-1', judgeId: 'judge-2', participantId: 'participant-1', criteria: [], score: 9, status: 'SUBMITTED', version: 1, updatedAt: '', updatedBy: '' },
        { id: 'js-3', eventId: 'event-1', judgeId: 'judge-1', participantId: 'participant-2', criteria: [], score: 7, status: 'SUBMITTED', version: 1, updatedAt: '', updatedBy: '' },
        { id: 'js-4', eventId: 'event-1', judgeId: 'judge-2', participantId: 'participant-2', criteria: [], score: 0, status: 'DRAFT', version: 1, updatedAt: '', updatedBy: '' },
      ],
    });

    const rows = component.rows();
    const complete = rows.find(row => row.participantId === 'participant-1');
    const pending = rows.find(row => row.participantId === 'participant-2');
    expect(complete?.scored).toBe(true);
    expect(complete?.judgeNote).toBe('2 of 2 judge submission(s) complete');
    // A missing judge submission keeps the scoring check incomplete.
    expect(pending?.scored).toBe(false);
    expect(pending?.judgeNote).toBe('1 of 2 judge submission(s) complete');
    expect(component.discrepancies().map(item => item.id)).toContain('MISSING_JUDGE_SCORE:participant-2');
  });

  it('blocks accepting until every unresolved discrepancy is acknowledged', async () => {
    await render();

    component.openAccept();
    fixture.detectChanges();

    // Not acknowledged yet: the confirm must do nothing at all.
    await component.confirmAccept();
    expect(calls.some(call => call.action === 'saveResultApproval')).toBe(false);

    const confirmButton = Array
      .from((fixture.nativeElement as HTMLElement).querySelectorAll('.modal-actions button'))
      .find(button => (button.textContent ?? '').includes('Accept with acknowledgement')) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    component.toggleAcknowledgement('MISSING_JUDGE_SCORE:participant-2');
    fixture.detectChanges();
    expect(confirmButton.disabled).toBe(false);

    await component.confirmAccept();

    const save = calls.find(call => call.action === 'saveResultApproval');
    expect(save?.payload).toEqual({
      eventId: 'event-1',
      decision: 'ACCEPTED',
      comments: '',
      acknowledgedDiscrepancyIds: ['MISSING_JUDGE_SCORE:participant-2'],
    });
    expect(component.reviewStatus()).toBe('APPROVED');
  });

  it('keeps the review open when the backend rejects an accept as incomplete', async () => {
    saveResultResponse = () => Promise.resolve(new Response(
      JSON.stringify({
        success: false,
        error: { code: 'RECONCILIATION_INCOMPLETE', message: 'participants still missing' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    await render();

    component.openAccept();
    component.toggleAcknowledgement('MISSING_JUDGE_SCORE:participant-2');
    await component.confirmAccept();

    expect(component.reviewStatus()).toBe('UNDER_REVIEW');
    expect(component.approvalError()).toContain('missing');
  });

  it('requires a reviewer comment to decline / return for correction', async () => {
    await render();

    await component.decline();
    expect(component.declineError()).toBe(true);
    expect(calls.some(call => call.action === 'saveResultApproval')).toBe(false);

    component.updateComments('Scoring missing for 1 participant — return to judge panel.');
    await component.decline();

    const save = calls.find(call => call.action === 'saveResultApproval');
    expect(save?.payload).toEqual({
      eventId: 'event-1',
      decision: 'RETURNED',
      comments: 'Scoring missing for 1 participant — return to judge panel.',
    });
    expect(component.reviewStatus()).toBe('RETURNED');
    expect(component.declineError()).toBe(false);
  });

  it('reports the returned decision through the notification channel', async () => {
    const notify = TestBed.inject(NotificationService);
    const successSpy = vi.spyOn(notify, 'success');
    await render();

    component.updateComments('Please re-check the scoring.');
    await component.decline();

    expect(successSpy).toHaveBeenCalledWith('Results returned for correction.', expect.anything());
  });

  it('enforces roles: Events and Liaison cannot record a reviewer decision', async () => {
    await render();

    // Re-sign in as the Events role: view-only on reconciliation/approval.
    TestBed.inject(AuthService).logout();
    const auth = TestBed.inject(AuthService);
    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google-id',
      email: 'tester@nakshatra.local',
      displayName: 'Test User',
      role: 'EVENTS_TEAM',
      accessStatus: 'APPROVED',
      version: 1,
    });
    auth.setApplicationSession({
      id: 'spec-session',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    fixture = TestBed.createComponent(Results);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectedEventId.set('event-1');
    await component.retryData();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.canEdit()).toBe(false);
    component.updateComments('Please fix the scoring gap.');
    await component.decline();
    expect(calls.some(call => call.action === 'saveResultApproval')).toBe(false);

    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.decision-actions button')) as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    for (const button of buttons) expect(button.disabled).toBe(true);

    // Liaison is view-only here too — same RESULT_APPROVAL rule.
    TestBed.inject(AuthService).logout();
    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google-id',
      email: 'tester@nakshatra.local',
      displayName: 'Test User',
      role: 'LIAISON_TEAM',
      accessStatus: 'APPROVED',
      version: 1,
    });
    auth.setApplicationSession({
      id: 'spec-session',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    fixture = TestBed.createComponent(Results);
    component = fixture.componentInstance;
    expect(component.canEdit()).toBe(false);
  });

  it('sends the stored decision version back as expectedVersion on the next decision', async () => {
    saveResultResponse = () => ok({ resultApproval: { id: 'RA-1', eventId: 'event-1', decision: 'RETURNED', comments: 'x', version: 4 } });
    await render();

    component.updateComments('First pass.');
    await component.decline();
    expect(calls.find(call => call.action === 'saveResultApproval')?.payload).not.toHaveProperty('expectedVersion');

    component.updateComments('Second pass.');
    await component.decline();

    const saves = calls.filter(call => call.action === 'saveResultApproval');
    expect(saves[1]?.payload).toHaveProperty('expectedVersion', 4);
  });
});
