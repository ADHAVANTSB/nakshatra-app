import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, describe, expect, it } from 'vitest';

import { Participant, ParticipantEvent, Event } from '../../core/models';
import { AuthService } from '../../core/services/auth/auth.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { Participants, RegistrationEntry } from './participants';

/**
 * Detail-panel presentation tests.
 *
 * These exercise the pure presentation helpers of the all-in-one detail view:
 * the ACTIVE registration count, category grouping, the "Open event" link
 * target and the source labels. No backend call is made — the component is
 * created without change detection so `ngOnInit` never starts a refresh, and
 * registration state is set directly.
 */

function registration(overrides: Partial<ParticipantEvent>): ParticipantEvent {
  return {
    id: 'reg-1',
    participantId: 'participant-1',
    eventId: 'event-1',
    registrationStatus: 'REGISTERED',
    version: 1,
    ...overrides,
  };
}

function entry(
  registrationOverrides: Partial<ParticipantEvent>,
  overrides: Partial<RegistrationEntry> = {}
): RegistrationEntry {
  const registrationRow = registration(registrationOverrides);

  return {
    registration: registrationRow,
    name: registrationRow.eventName ?? 'Event not in the current event list',
    category: registrationRow.category,
    mode: registrationRow.mode,
    categoryKnown: !!registrationRow.category,
    ...overrides,
  };
}

describe('Participants — detail panel presentation', () => {
  let component: Participants;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Participants],
      providers: [provideRouter([])],
    }).compileComponents();

    component = TestBed.createComponent(Participants).componentInstance;
  });

  describe('activeRegistrationCount', () => {
    it('counts only REGISTERED registrations', () => {
      component.registrations.set([
        registration({ id: 'reg-1', eventId: 'event-1', registrationStatus: 'REGISTERED' }),
        registration({ id: 'reg-2', eventId: 'event-2', registrationStatus: 'CANCELLED' }),
        registration({ id: 'reg-3', eventId: 'event-3', registrationStatus: 'WAITLISTED' }),
        registration({ id: 'reg-4', eventId: 'event-4', registrationStatus: 'REGISTERED' }),
      ]);

      expect(component.activeRegistrationCount()).toBe(2);
    });

    it('reports zero while registrations have not been read yet', () => {
      expect(component.activeRegistrationCount()).toBe(0);
    });
  });

  describe('eventGroups', () => {
    it('follows the ARTS / LITERARY / CULTURAL order', () => {
      component.registrations.set([
        registration({ id: 'reg-1', eventId: 'event-1', category: 'CULTURAL' }),
        registration({ id: 'reg-2', eventId: 'event-2', category: 'ARTS' }),
        registration({ id: 'reg-3', eventId: 'event-3', category: 'LITERARY' }),
      ]);

      expect(component.eventGroups().map(group => group.category))
        .toEqual(['ARTS', 'LITERARY', 'CULTURAL']);
    });

    it('hides categories the participant has no registration for', () => {
      component.registrations.set([
        registration({ id: 'reg-1', eventId: 'event-1', category: 'CULTURAL' }),
      ]);

      expect(component.eventGroups().map(group => group.category)).toEqual(['CULTURAL']);
    });
  });

  describe('eventLinkTarget', () => {
    it('returns the registration event id when one exists', () => {
      const resolved = entry({ eventId: 'event-9' });

      expect(component.eventLinkTarget(resolved)).toBe('event-9');
    });

    it('returns null so no link is rendered for a row without an event id', () => {
      const resolved = entry({ eventId: '', eventName: 'Group Song' });

      expect(component.eventLinkTarget(resolved)).toBeNull();
    });
  });

  describe('source labels', () => {
    const participant = {
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
    } as Participant;

    it('shows an em dash when the source version is absent', () => {
      expect(component.sourceVersionLabel({ ...participant, sourceVersionId: undefined }))
        .toBe('—');
    });

    it('abbreviates a present source version id', () => {
      const label = component.sourceVersionLabel({
        ...participant,
        sourceVersionId: 'import-version-0001-abcd',
      });

      expect(label).not.toBe('—');
      expect(label.length).toBeLessThan('import-version-0001-abcd'.length);
    });

    it('shows an em dash when the source row is absent', () => {
      expect(component.sourceRowLabel({ ...participant, sourceRowNumber: undefined }))
        .toBe('—');
    });

    it('shows the sheet row when present', () => {
      expect(component.sourceRowLabel({ ...participant, sourceRowNumber: 12 }))
        .toBe('Sheet row 12');
    });
  });
});

function event(overrides: Partial<{
  id: string; eventCode: string; name: string; category: string; mode: string; status: string; eligibleLevels: string[];
}>): Event {
  return {
    id: 'event-1',
    eventCode: 'E-01',
    name: 'Group Song',
    category: 'ARTS',
    mode: 'SOLO',
    status: 'ACTIVE',
    eligibleLevels: ['JUNIOR'],
    ...overrides,
  } as unknown as Event;
}

describe('Participants � event summary counts', () => {
  let fixture: ComponentFixture<Participants>;
  let component: Participants;

  const EVENTS = [
    event({ id: 'event-1', eventCode: 'E-01', name: 'Vocal', category: 'ARTS', mode: 'SOLO' }),
    event({ id: 'event-2', eventCode: 'E-02', name: 'Group Song', category: 'ARTS', mode: 'GROUP' }),
    event({ id: 'event-3', eventCode: 'E-03', name: 'Story', category: 'LITERARY', mode: 'SOLO' }),
    event({ id: 'event-4', eventCode: 'E-04', name: 'Dance', category: 'CULTURAL', mode: 'GROUP' }),
  ];

  function rowsFor(eventId: string): ParticipantEvent[] {
    // participant-1: registered for both ARTS events and CULTURAL; LITERARY row is cancelled.
    const all: ParticipantEvent[] = [
      registration({ id: 'reg-1', participantId: 'participant-1', eventId: 'event-1', registrationStatus: 'REGISTERED' }),
      registration({ id: 'reg-2', participantId: 'participant-1', eventId: 'event-2', registrationStatus: 'REGISTERED' }),
      registration({ id: 'reg-3', participantId: 'participant-1', eventId: 'event-3', registrationStatus: 'CANCELLED' }),
      registration({ id: 'reg-4', participantId: 'participant-1', eventId: 'event-4', registrationStatus: 'REGISTERED' }),
      registration({ id: 'reg-5', participantId: 'participant-2', eventId: 'event-1', registrationStatus: 'REGISTERED' }),
    ];
    return all.filter(row => row.eventId === eventId);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Participants],
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

    fixture = TestBed.createComponent(Participants);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('returns null while the summary has not been loaded', () => {
    expect(component.eventSummary('participant-1')).toBeNull();
    expect(component.registrationSummaryState()).toBe('IDLE');
  });

  it('passes through the backend batch summary figures with authoritative maxima', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'getParticipantEventSummaries') {        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            summaries: [
              {
                participantId: 'participant-1',
                participantCode: 'P-0001',
                fullName: 'Test Participant',
                events: [
                  { eventId: 'event-1', eventName: 'Clay Modelling', category: 'ARTS', mode: 'SOLO', registrationStatus: 'REGISTERED' },
                  { eventId: 'event-2', eventName: 'String Art', category: 'ARTS', mode: 'GROUP', registrationStatus: 'REGISTERED' },
                  { eventId: 'event-3', eventName: 'Group Dance', category: 'CULTURAL', mode: 'GROUP', registrationStatus: 'REGISTERED' },
                ],
                activeEventCount: 3,
                artsCount: 2,
                literaryCount: 0,
                culturalCount: 1,
                soloCount: 1,
              },
              {
                participantId: 'participant-2',
                participantCode: 'P-0002',
                fullName: 'Other Participant',
                events: [
                  { eventId: 'event-1', eventName: 'Clay Modelling', category: 'ARTS', mode: 'SOLO', registrationStatus: 'REGISTERED' },
                ],
                activeEventCount: 1,
                artsCount: 1,
                literaryCount: 0,
                culturalCount: 0,
                soloCount: 1,
              },
            ],
            issues: [],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    // A seeded participant gives the loader a home to request summaries for.
    TestBed.inject(ParticipantService).replaceParticipant({
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
    } as Participant);

    await component.loadRegistrationSummary();

    expect(component.registrationSummaryState()).toBe('LOADED');
    // Figures are the backend's own, never recomputed client-side.
    expect(component.eventSummary('participant-1')).toMatchObject({      total: 3, maxTotal: 6,
      arts: 2, literary: 0, cultural: 1, maxCategory: 2,
      solo: 1, maxSolo: 3,
    });
    expect(component.eventSummary('participant-2')).toMatchObject({
      total: 1, maxTotal: 6,
      arts: 1, literary: 0, cultural: 0, maxCategory: 2,
      solo: 1, maxSolo: 3,
    });
  });

  it('reaches a FAILED terminal state when the summary read fails and recovers on retry', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'getParticipantEventSummaries') {
        return Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'BACKEND_ERROR', message: 'Registrations unavailable' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    // At least one home must be requested for a failure to be possible.
    TestBed.inject(ParticipantService).replaceParticipant({
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
    } as Participant);

    await component.loadRegistrationSummary();

    expect(component.registrationSummaryState()).toBe('FAILED');
    expect(component.eventSummary('participant-1')).toBeNull();

    // Retry through a working backend: the terminal state recovers.
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'getParticipantEventSummaries') {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            summaries: [{
              participantId: 'participant-1',
              participantCode: 'P-0001',
              fullName: 'Test Participant',
              events: [],
              activeEventCount: 3,
              artsCount: 2,
              literaryCount: 0,
              culturalCount: 1,
              soloCount: 1,
            }],
            issues: [],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    await component.loadRegistrationSummary(true);

    expect(component.registrationSummaryState()).toBe('LOADED');
    expect(component.eventSummary('participant-1')?.total).toBe(3);
  });

  it('computes detail-panel counts from the open participant registrations', () => {
    component.registrations.set([
      registration({ id: 'reg-1', eventId: 'event-1', category: 'ARTS', mode: 'SOLO', registrationStatus: 'REGISTERED' }),
      registration({ id: 'reg-2', eventId: 'event-2', category: 'ARTS', mode: 'GROUP', registrationStatus: 'REGISTERED' }),
      registration({ id: 'reg-3', eventId: 'event-3', category: 'LITERARY', mode: 'SOLO', registrationStatus: 'CANCELLED' }),
      registration({ id: 'reg-4', eventId: 'event-4', category: 'CULTURAL', mode: 'GROUP', registrationStatus: 'REGISTERED' }),
    ]);

    expect(component.detailEventSummary()).toEqual({
      total: 3, maxTotal: 6,
      arts: 2, literary: 0, cultural: 1, maxCategory: 2,
      solo: 1, maxSolo: 3,
    });
  });
});

describe('Participants � source write-back messaging', () => {
  let component: Participants;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Participants],
      providers: [provideRouter([])],
    }).compileComponents();

    // Created without change detection: ngOnInit never runs, no backend calls.
    component = TestBed.createComponent(Participants).componentInstance;
  });

  it('labels every backend source write-back outcome it reports', () => {
    const describeSourceWriteBack = (
      component as unknown as {
        describeSourceWriteBack: (
          writeBack: { status: string; message?: string } | undefined
        ) => { label: string; detail: string };
      }
    ).describeSourceWriteBack;

    expect(describeSourceWriteBack.call(component, undefined)).toEqual({ label: '', detail: '' });
    expect(describeSourceWriteBack.call(component, { status: 'UPDATED' }).label)
      .toBe('Google Sheet updated');
    expect(describeSourceWriteBack.call(component, { status: 'SKIPPED', message: 'row locked' }).label)
      .toBe('Google Sheet not updated');
    expect(describeSourceWriteBack.call(component, { status: 'FAILED', message: 'sheet offline' }).label)
      .toBe('Google Sheet not updated');
    expect(describeSourceWriteBack.call(component, { status: 'UNVERIFIED', message: 'ambiguous' }).label)
      .toBe('Source identity could not be verified');
  });

  it('pins the registration write-back toast strings', () => {
    const notifications = TestBed.inject(NotificationService);
    const successSpy = vi.spyOn(notifications, 'success');
    const warningSpy = vi.spyOn(notifications, 'warning');

    const notifyRegistrationSuccess = (
      component as unknown as {
        notifyRegistrationSuccess: (
          message: string,
          writeBack: { status: string; message?: string } | undefined
        ) => void;
      }
    ).notifyRegistrationSuccess;

    notifyRegistrationSuccess.call(component, 'Event participation updated.', { status: 'UPDATED' });
    expect(successSpy).toHaveBeenCalledWith('Event participation updated.', 'Google Sheet updated.');

    notifyRegistrationSuccess.call(component, 'Event participation updated.', { status: 'SKIPPED' });
    expect(successSpy).toHaveBeenCalledWith(
      'Event participation updated.',
      'Registration updated in Nakshatra, but the Google Sheet was not changed.'
    );

    notifyRegistrationSuccess.call(component, 'Event participation updated.', undefined);
    // No report from the backend: no sheet claim either way.
    expect(successSpy).toHaveBeenLastCalledWith('Event participation updated.');
  });
});

const TABLE_SUMMARY_ENTRY = {
  participantId: 'participant-1',
  participantCode: 'P-0001',
  fullName: 'Test Participant',
  events: [
    { eventId: 'event-1', eventName: 'Clay Modelling', category: 'ARTS', mode: 'SOLO', registrationStatus: 'REGISTERED' },
    { eventId: 'event-2', eventName: 'Group Dance', category: 'CULTURAL', mode: 'GROUP', registrationStatus: 'REGISTERED' },
  ],
  activeEventCount: 2,
  artsCount: 1,
  literaryCount: 0,
  culturalCount: 1,
  soloCount: 1,
};

const MANY_EVENT_SUMMARY_ENTRY = {
  participantId: 'participant-1',
  participantCode: 'P-0001',
  fullName: 'Test Participant',
  events: [
    { eventId: 'e1', eventName: 'Clay Modelling', category: 'ARTS', mode: 'SOLO', registrationStatus: 'REGISTERED' },
    { eventId: 'e2', eventName: 'String Art', category: 'ARTS', mode: 'SOLO', registrationStatus: 'REGISTERED' },
    { eventId: 'e3', eventName: 'Origami', category: 'ARTS', mode: 'SOLO', registrationStatus: 'REGISTERED' },
    { eventId: 'e4', eventName: 'Quiz', category: 'LITERARY', mode: 'SOLO', registrationStatus: 'REGISTERED' },
    { eventId: 'e5', eventName: 'Group Dance', category: 'CULTURAL', mode: 'GROUP', registrationStatus: 'REGISTERED' },
  ],
  activeEventCount: 5,
  artsCount: 3,
  literaryCount: 1,
  culturalCount: 1,
  soloCount: 4,
};

describe('Participants � participant table presentation', () => {
  let fixture: ComponentFixture<Participants>;
  let component: Participants;

  function stubBackend(summaries: unknown[], issues: unknown[] = []): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      if (request.action === 'getParticipantEventSummaries') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { summaries, issues } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'listShelterHomes') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              shelterHomes: [{
                id: 'home-1',
                homeCode: 'H-01',
                homeName: 'Sunrise Home',
                contactPhone: '',
                status: 'ACTIVE',
                version: 1,
              }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'listParticipants') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              participants: [{
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
              }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { events: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'getImportStatus') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { imports: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'getValidationResults') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { validationResults: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: true, data: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Participants],
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

  async function renderWith(summaries: unknown[], issues: unknown[] = []): Promise<void> {
    stubBackend(summaries, issues);

    // The participant arrives through the (stubbed) backend store, exactly as
    // in production; ngOnInit's ensureLoaded populates the list.
    fixture = TestBed.createComponent(Participants);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    // ngOnInit already kicked off the batch summary load; wait for its
    // terminal state instead of racing it with a second call.
    await vi.waitFor(() => {
      expect(component.registrationSummaryState()).toBe('LOADED');
    });
    fixture.detectChanges();
  }

  it('hides internal codes and the removed status columns from the primary table', async () => {
    await renderWith([TABLE_SUMMARY_ENTRY]);

    const host = fixture.nativeElement as HTMLElement;
    const tbody = host.querySelector('tbody');
    expect(tbody).toBeTruthy();
    expect(tbody!.textContent).not.toContain('P-0001');
    expect(tbody!.textContent).not.toContain('H-01');

    const headers = Array.from(host.querySelectorAll('th'))
      .map(th => (th.textContent ?? '').trim());
    expect(headers).not.toContain('Eligibility');
    expect(headers).not.toContain('Validation');
    expect(headers).not.toContain('Approval');
    // The name is emphasized; the code line is gone from the identity cell.
    const identityCell = tbody!.querySelector('td');
    expect(identityCell?.textContent).toContain('Test Participant');
  });

  it('renders real event names grouped by category with authoritative counts', async () => {
    await renderWith([TABLE_SUMMARY_ENTRY]);

    const host = fixture.nativeElement as HTMLElement;
    const text = host.querySelector('tbody')!.textContent ?? '';

    expect(text).toContain('Arts: Clay Modelling');
    expect(text).toContain('Literary: None');
    expect(text).toContain('Cultural: Group Dance');
    expect(text).toContain('2 / 6');
    expect(text).toContain('Arts 1/2');
    expect(text).toContain('Literary 0/2');
    expect(text).toContain('Cultural 1/2');
    expect(text).toContain('Solo 1/3');
  });

  it('keeps long event lists compact until View all is used', async () => {
    await renderWith([MANY_EVENT_SUMMARY_ENTRY]);

    const host = fixture.nativeElement as HTMLElement;
    const cell = host.querySelector('tbody .cell-events') as HTMLElement;
    expect(cell).toBeTruthy();

    // Compact: not every name is dumped into the row.
    expect(cell.textContent).toContain('View all');
    expect(cell.textContent).not.toContain('Origami');

    (cell.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect((host.querySelector('tbody .cell-events') as HTMLElement).textContent).toContain('Origami');
  });

  it('surfaces backend duplicate/missing-reference issues on the row', async () => {
    await renderWith(
      [TABLE_SUMMARY_ENTRY],
      [{ code: 'DUPLICATE_REGISTRATION_ROWS', participantId: 'participant-1', eventId: 'event-1', count: 2 }],
    );

    const host = fixture.nativeElement as HTMLElement;
    const cell = host.querySelector('tbody .cell-events') as HTMLElement;
    expect(cell.textContent).toContain('Duplicate registration');
  });

  it('offers View/Edit and Manage events actions that open the detail', async () => {
    await renderWith([TABLE_SUMMARY_ENTRY]);

    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector('tbody tr') as HTMLElement;
    const buttons = Array.from(row.querySelectorAll('button'))
      .map(button => (button.textContent ?? '').trim());

    expect(buttons.some(label => label.includes('View'))).toBe(true);
    expect(buttons.some(label => label.includes('Manage events'))).toBe(true);

    (Array.from(row.querySelectorAll('button'))
      .find(button => (button.textContent ?? '').includes('Manage events')) as HTMLButtonElement)
      .click();
    fixture.detectChanges();

    expect(component.openParticipantId()).toBe('participant-1');
  });
});


describe('Participants � rename sheet-sync outcome', () => {
  let component: Participants;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Participants],
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

    // Created without change detection: ngOnInit never runs.
    component = TestBed.createComponent(Participants).componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  function applyVerdict(
    sheetsSynchronized: boolean | undefined,
    syncReasons: string[] | undefined,
  ): void {
    const apply = (component as unknown as {
      applySheetSyncVerdict: (
        participantId: string,
        sheetsSynchronized: boolean | undefined,
        syncReasons: string[] | undefined,
        toastDetail: string,
      ) => void;
    }).applySheetSyncVerdict;

    apply.call(component, 'participant-1', sheetsSynchronized, syncReasons, 'Google Sheet updated');
  }

  it('shows a truthful recovery state when the backend reports sheets not synchronized', () => {
    const notifications = TestBed.inject(NotificationService);
    const warningSpy = vi.spyOn(notifications, 'warning');

    applyVerdict(false, ['Event-wise sheet write skipped: AMBIGUOUS_SOURCE_ROW']);

    expect(component.sheetSyncRecovery()).toEqual({
      participantId: 'participant-1',
      reasons: ['Event-wise sheet write skipped: AMBIGUOUS_SOURCE_ROW'],
    });
    // No success claim is made when the backend says a write did not land.
    expect(warningSpy).toHaveBeenCalled();
    const warned = warningSpy.mock.calls.map(call => call.join(' ')).join(' ');
    expect(warned).toContain('AMBIGUOUS_SOURCE_ROW');
    expect(warned).not.toContain('Google Sheet updated.');
  });

  it('clears any recovery state when the backend reports full synchronization', () => {
    const notifications = TestBed.inject(NotificationService);
    const successSpy = vi.spyOn(notifications, 'success');

    applyVerdict(true, []);

    expect(component.sheetSyncRecovery()).toBeNull();
    expect(successSpy).toHaveBeenCalled();
  });

  it('recovers through the real reconcile route and refreshes backend data', async () => {
    let reconcileCalls = 0;
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      if (request.action === 'reconcileParticipantSheetWrites') {
        reconcileCalls += 1;
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              participantId: 'participant-1',
              reconciled: true,
              sheetsSynchronized: true,
              reasons: [],
              source: { status: 'UPDATED' },
              eventWise: {},
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'getParticipant') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              participant: {
                id: 'participant-1',
                participantCode: 'P-0001',
                shelterHomeId: 'home-1',
                fullName: 'Renamed Participant',
                gender: 'MALE',
                age: 10,
                standard: 5,
                level: 'JUNIOR',
                eligibilityStatus: 'ELIGIBLE',
                validationStatus: 'PASSED',
                approvalStatus: 'APPROVED',
                lockStatus: 'UNLOCKED',
                version: 2,
                createdAt: '',
                createdBy: '',
                updatedAt: '',
                updatedBy: '',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'getParticipantEventSummaries') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { summaries: [], issues: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    applyVerdict(false, ['not synchronized yet']);
    expect(component.sheetSyncRecovery()).not.toBeNull();

    await component.retrySheetSync();

    expect(reconcileCalls).toBe(1);
    expect(component.sheetSyncRecovery()).toBeNull();
    expect(component.reconciling()).toBe(false);
  });

  it('keeps the recovery state and the retry available when reconciliation still fails', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      if (request.action === 'reconcileParticipantSheetWrites') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              participantId: 'participant-1',
              reconciled: false,
              sheetsSynchronized: false,
              reasons: ['Source row identity could not be verified'],
              source: { status: 'UNVERIFIED' },
              eventWise: {},
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    applyVerdict(false, ['not synchronized yet']);

    await component.retrySheetSync();

    expect(component.sheetSyncRecovery()).not.toBeNull();
    expect(component.sheetSyncRecovery()?.reasons).toEqual(['Source row identity could not be verified']);
    expect(component.reconciling()).toBe(false);
  });
});

describe('Participants � load error recovery', () => {
  let component: Participants;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Participants],
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

    // Created without change detection: ngOnInit never runs.
    component = TestBed.createComponent(Participants).componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('retryStoreLoad forces a fresh full store read', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code: 'BACKEND_ERROR', message: 'offline' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const store = TestBed.inject(ShelterDataService);
    const spy = vi.spyOn(store, 'refresh');

    await component.retryStoreLoad();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retryEventsLoad re-reads the event master', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code: 'BACKEND_ERROR', message: 'offline' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const store = TestBed.inject(ShelterDataService);
    const spy = vi.spyOn(store, 'loadEvents');

    await component.retryEventsLoad();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
