import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ProgramContextService } from '../../core/services/program/program-context.service';
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

const EVENT_2 = {
  id: 'event-2',
  eventCode: 'E-02',
  name: 'Rangoli',
  category: 'ARTS',
  mode: 'SOLO',
  status: 'ACTIVE',
  eligibleLevels: ['JUNIOR'],
};

/** A persisted ResultApprovals row exactly as the backend returns it. */
function approvalRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'RA-1',
    eventId: 'event-1',
    decision: 'ACCEPTED',
    comments: 'Verified against the reconciliation.',
    version: 1,
    createdAt: '2026-10-23T09:00:00.000Z',
    createdBy: 'spec-user',
    updatedAt: '2026-10-23T10:00:00.000Z',
    updatedBy: 'reviewer-7',
    programId: 'ARTS',
    environmentId: 'TEST',
    ...overrides,
  };
}

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
  /** Payload the next `listResults` read returns (evaluated at request time). */
  let listResultsPayload: () => Record<string, unknown>;
  /** While true, `listResults` responses are captured and released manually. */
  let holdListResults: boolean;
  let heldListResults: Array<() => void>;

  const ok = (data: unknown) => Promise.resolve(new Response(
    JSON.stringify({ success: true, data }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));

  function stubBackend(
    fixtures: {
      judges?: unknown[];
      judgeScores?: unknown[];
      attendance?: unknown[];
      scores?: unknown[];
    } = {},
  ): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      calls.push({ action: request.action, payload: (request.payload ?? {}) as Record<string, unknown> });

      switch (request.action) {
        case 'listResults': {
          // Evaluated at request time: a held response keeps the payload it
          // was issued with — exactly like a stale in-flight backend read.
          const payload = listResultsPayload();
          const respond = () => ok(payload);
          if (holdListResults) {
            return new Promise<Response>(resolve => {
              heldListResults.push(() => resolve(respond()));
            });
          }
          return respond();
        }
        case 'listEvents':
          return ok({ events: [EVENT, EVENT_2] });
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
            attendance: fixtures.attendance ?? [
              { id: 'att-1', eventId: 'event-1', participantId: 'participant-1', teamId: '', status: 'PRESENT', version: 1, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' },
              { id: 'att-2', eventId: 'event-1', participantId: 'participant-2', teamId: '', status: 'PRESENT', version: 1, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' },
            ],
          });
        case 'listScores':
          // participant-1 scored; participant-2 attended but has no score.
          return ok({
            scores: fixtures.scores ?? [{
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
          return ok({ judges: fixtures.judges ?? [] });
        case 'listJudgeScores':
          return ok({ scores: fixtures.judgeScores ?? [] });
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
    judgeFixtures: { judges?: unknown[]; judgeScores?: unknown[]; attendance?: unknown[]; scores?: unknown[] } = {},
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
    listResultsPayload = () => ({ results: [] });
    holdListResults = false;
    heldListResults = [];

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

  it('never acknowledges an attendance-eligibility violation: acceptance stays blocked', async () => {
    // participant-2 has a FINALIZED score but no PRESENT attendance: the
    // backend excludes it from results/certificates and blocks acceptance.
    await render({
      attendance: [
        { id: 'att-1', eventId: 'event-1', participantId: 'participant-1', teamId: '', status: 'PRESENT', version: 1, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' },
        { id: 'att-2', eventId: 'event-1', participantId: 'participant-2', teamId: '', status: 'ABSENT', version: 1, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' },
      ],
      scores: [
        { id: 'score-1', eventId: 'event-1', participantId: 'participant-1', value: 9, status: 'DRAFT', version: 1, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' },
        { id: 'score-2', eventId: 'event-1', participantId: 'participant-2', value: 8, status: 'FINALIZED', version: 1, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' },
      ],
    });

    const items = component.discrepancies();
    const absent = items.find(item => item.id === 'ABSENT_PARTICIPANT:participant-2');
    const violation = items.find(item => item.id === 'SCORE_WITHOUT_ATTENDANCE:participant-2');

    // The absence is shown clearly; the eligibility violation is not
    // acknowledgeable at all.
    expect(absent).toBeTruthy();
    expect(violation).toBeTruthy();
    expect(violation?.acknowledgeable).toBe(false);

    component.openAccept();
    fixture.detectChanges();

    // Ticking every acknowledgeable item cannot unblock acceptance.
    component.toggleAcknowledgement('ABSENT_PARTICIPANT:participant-2');
    fixture.detectChanges();
    expect(component.allAcknowledged()).toBe(false);

    const confirmButton = Array
      .from((fixture.nativeElement as HTMLElement).querySelectorAll('.modal-actions button'))
      .find(button => (button.textContent ?? '').includes('Accept')) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    await component.confirmAccept();
    expect(calls.some(call => call.action === 'saveResultApproval')).toBe(false);
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

  it('shows both reviewer actions for a pending event to authorized users', async () => {
    await render();

    const buttons = Array.from((fixture.nativeElement as HTMLElement)
      .querySelectorAll('.decision-actions button')) as HTMLButtonElement[];
    expect(buttons.map(button => (button.textContent ?? '').trim())).toEqual([
      'Accept Results',
      'Decline / Return for Correction',
    ]);
    expect(buttons.every(button => !button.disabled)).toBe(true);
    expect(component.reviewStatus()).toBe('UNDER_REVIEW');
  });

  it('a successful accept becomes a completed state with BOTH action buttons gone', async () => {
    saveResultResponse = () => ok({ resultApproval: approvalRecord() });
    await render();

    component.openAccept();
    component.toggleAcknowledgement('MISSING_JUDGE_SCORE:participant-2');
    await component.confirmAccept();
    fixture.detectChanges();

    // The state comes from the persisted backend record, not the toast.
    expect(component.reviewStatus()).toBe('APPROVED');
    expect(component.acceptedAt()).toBe('2026-10-23T10:00:00.000Z');
    expect(component.acceptedBy()).toBe('reviewer-7');

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.decision-actions').length).toBe(0);
    expect(host.textContent).toContain('Results Accepted');
    expect(host.textContent).toContain('Completed');
    expect(host.textContent).toContain('reviewer-7');
  });

  it('the accepted state persists across reload and navigate-away-and-back', async () => {
    listResultsPayload = () => ({ results: [], resultApprovals: [approvalRecord()] });
    await render();

    expect(component.reviewStatus()).toBe('APPROVED');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.decision-actions').length).toBe(0);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Results Accepted');

    // Navigate away and back: a fresh page instance re-reads the same state.
    fixture = TestBed.createComponent(Results);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectedEventId.set('event-1');
    await component.retryData();
    fixture.detectChanges();

    expect(component.reviewStatus()).toBe('APPROVED');
    expect(component.acceptedBy()).toBe('reviewer-7');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.decision-actions').length).toBe(0);
  });

  it('a stale approval read can never restore the Accept button after acceptance', async () => {
    await render();

    // Stateful backend read: a read issued BEFORE any acceptance reports
    // "nothing recorded yet" (legitimately); reads after the acceptance
    // carry the persisted record. The pre-acceptance read is held so it
    // lands after everything else.
    listResultsPayload = () => calls.some(call => call.action === 'saveResultApproval')
      ? { results: [], resultApprovals: [approvalRecord()] }
      : { results: [], resultApprovals: [] };
    holdListResults = true;
    void component.retryData();

    saveResultResponse = () => ok({ resultApproval: approvalRecord() });
    component.openAccept();
    component.toggleAcknowledgement('MISSING_JUDGE_SCORE:participant-2');
    await component.confirmAccept();
    fixture.detectChanges();

    expect(component.reviewStatus()).toBe('APPROVED');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.decision-actions').length).toBe(0);

    // The held responses land LAST, in reverse issue order: the stale
    // pre-acceptance read arrives after everything else. It must never
    // bring the actionable state back.
    holdListResults = false;
    heldListResults.splice(0).reverse().forEach(release => release());
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.reviewStatus()).toBe('APPROVED');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.decision-actions').length).toBe(0);
  });

  it('a different event keeps its own independent approval state', async () => {
    listResultsPayload = () => ({ results: [], resultApprovals: [approvalRecord()] });
    await render();

    expect(component.reviewStatus()).toBe('APPROVED');

    // event-2 has no stored decision: it is pending and actionable again.
    component.setEvent('event-2');
    await component.loadEvent('event-2');
    fixture.detectChanges();

    expect(component.reviewStatus()).toBe('UNDER_REVIEW');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.decision-actions').length).toBe(1);

    // Switching back re-reads event-1's own accepted state.
    component.setEvent('event-1');
    await component.loadEvent('event-1');
    fixture.detectChanges();

    expect(component.reviewStatus()).toBe('APPROVED');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.decision-actions').length).toBe(0);
  });

  it('a scope switch drops the cached review state and reloads from the backend', async () => {
    saveResultResponse = () => ok({ resultApproval: approvalRecord() });
    await render();

    component.openAccept();
    component.toggleAcknowledgement('MISSING_JUDGE_SCORE:participant-2');
    await component.confirmAccept();
    fixture.detectChanges();
    expect(component.reviewStatus()).toBe('APPROVED');

    const readsBefore = calls.filter(call => call.action === 'listResults').length;
    TestBed.inject(ProgramContextService).selectZone('ZONE_2');

    // The cached accepted state is dropped immediately …
    expect(component.reviewStatus()).toBe('UNDER_REVIEW');
    // … and the persisted decision is re-read under the new scope.
    expect(calls.filter(call => call.action === 'listResults').length).toBeGreaterThan(readsBefore);
  });
});
