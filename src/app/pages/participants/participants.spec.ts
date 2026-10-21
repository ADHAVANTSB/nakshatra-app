import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApplicationRole, Participant, ParticipantEvent, Event } from '../../core/models';
import { AuthService } from '../../core/services/auth/auth.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { ProgramContextService } from '../../core/services/program/program-context.service';
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

    it('reports Imported for an imported record instead of the raw source version id', () => {
      const label = component.sourceVersionLabel({
        ...participant,
        sourceVersionId: 'import-version-0001-abcd',
      });

      expect(label).toBe('Imported');
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

      if (request.action === 'getPageData') {
        // Batched page snapshot: the same home and participant fixtures the
        // per-home actions above serve, in one response.
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
              imports: [],
              validationResults: [],
            },
          }),
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

/**
 * Registration mutation controls (Add event / Cancel / Reactivate) are hidden
 * for the Events role and kept for ADMIN. Rendered through the real template
 * so a hidden control is proven absent from the DOM, not disabled.
 */
describe('Participants — registration controls per role', () => {
  let fixture: ComponentFixture<Participants>;
  let component: Participants;

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
  };

  const HOME = {
    id: 'home-1',
    homeCode: 'H-01',
    homeName: 'Sunrise Home',
    address: '',
    contactName: '',
    contactPhone: '',
    status: 'ACTIVE',
    version: 1,
    // The event-day gate reads the authoritative home-sheet state: with a
    // LOCKED sheet and a CHECKED_IN row the add-event action is offered.
    sheetStatus: 'LOCKED',
  };

  const EVENT_DAY_ENTRY = {
    participantId: 'participant-1',
    participantCode: 'NK26-001',
    fullName: 'Asha',
    level: 'SUB_JUNIOR',
    shelterHomeId: 'home-1',
    homeName: 'Sunrise Home',
    homeSheetStatus: 'LOCKED',
    checkInStatus: 'CHECKED_IN',
    checkedInAt: '2026-01-01T00:00:00.000Z',
    checkedInBy: 'spec-user',
    version: 1,
  };

  function stubBackend(): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      if (request.action === 'getPageData') {
        return ok({ shelterHomes: [HOME], participants: [PARTICIPANT], events: [], imports: [], validationResults: [] });
      }
      if (request.action === 'listEvents') return ok({ events: [] });
      if (request.action === 'getParticipantEventSummaries') return ok({ summaries: [], issues: [] });
      if (request.action === 'listEventDayRegistrations') {
        return ok({ eventDayRegistrations: [EVENT_DAY_ENTRY] });
      }
      return ok({});
    });
  }

  async function renderDetailWithRole(role: 'ADMIN' | 'EVENTS_TEAM'): Promise<void> {
    stubBackend();

    const auth = TestBed.inject(AuthService);
    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google-id',
      email: 'tester@nakshatra.local',
      displayName: 'Test User',
      role,
      accessStatus: 'APPROVED',
      version: 1,
    });
    auth.setApplicationSession({
      id: 'spec-session',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    fixture = TestBed.createComponent(Participants);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(component.participants().length).toBe(1));

    component.openParticipantId.set('participant-1');
    component.registrations.set([
      registration({ id: 'reg-1', eventId: 'event-1', registrationStatus: 'REGISTERED', category: 'ARTS' }),
      registration({ id: 'reg-2', eventId: 'event-2', registrationStatus: 'CANCELLED', category: 'ARTS' }),
    ]);
    fixture.detectChanges();
  }

  function buttonLabels(): string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .map(button => (button.textContent ?? '').trim());
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Participants],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('ADMIN keeps Add event, Cancel and Reactivate in the detail panel', async () => {
    await renderDetailWithRole('ADMIN');

    const labels = buttonLabels();
    expect(labels).toContain('Cancel');
    expect(labels).toContain('Reactivate');
    expect(labels).toContain('Add event');
  });

  it('the Events role sees no Add event, Cancel or Reactivate controls', async () => {
    await renderDetailWithRole('EVENTS_TEAM');

    const labels = buttonLabels();
    expect(labels).not.toContain('Cancel');
    expect(labels).not.toContain('Reactivate');
    expect(labels).not.toContain('Add event');
  });
});

/**
 * Event-day check-in: the queue lists eligible participants of LOCKED home
 * sheets (the backend excludes every other home), the check-in is saved
 * through the backend, and the distinct four-state status is shown wherever
 * the UI shows a participant's status.
 */
describe('Participants — event-day check-in', () => {
  let fixture: ComponentFixture<Participants>;
  let component: Participants;

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
  };

  const HOME_LOCKED = {
    id: 'home-1',
    homeCode: 'H-01',
    homeName: 'Sunrise Home',
    address: '',
    contactName: '',
    contactPhone: '',
    status: 'ACTIVE',
    version: 1,
    sheetStatus: 'LOCKED',
  };

  const HOME_NOT_CONFIRMED = { ...HOME_LOCKED, sheetStatus: 'NOT_CONFIRMED' };

  const ENTRY = {
    participantId: 'participant-1',
    participantCode: 'P-0001',
    fullName: 'Test Participant',
    level: 'JUNIOR',
    shelterHomeId: 'home-1',
    homeName: 'Sunrise Home',
    homeSheetStatus: 'LOCKED',
    checkInStatus: 'NOT_REGISTERED',
    checkedInAt: '',
    checkedInBy: '',
    version: 0,
  };

  const ENTRY_CHECKED_IN = { ...ENTRY, checkInStatus: 'CHECKED_IN', version: 1 };

  const ENTRY_OTHER_HOME = {
    ...ENTRY,
    participantId: 'participant-2',
    participantCode: 'P-0002',
    fullName: 'Second Participant',
    shelterHomeId: 'home-2',
    homeName: 'Second Home',
    checkInStatus: 'CHECKED_IN',
    version: 1,
  };

  interface QueueStubOptions {
    homes: unknown[];
    entries: unknown[];
    /** Role shown by the session; defaults to ADMIN. */
    role?: ApplicationRole;
    markError?: { code: string; message: string };
    /** A batch-level failure: nothing is written, everything stays staged. */
    batchError?: { code: string; message: string };
    /**
     * Per-record outcome for saveEventDayAttendanceBatch; default marks
     * every record UPDATED (CREATED when expectedVersion is 0).
     */
    onBatchSave?: (items: Record<string, unknown>[]) => { results: Record<string, unknown>[] };
  }

  function stubQueueBackend(
    options: QueueStubOptions
  ): {
    payloads: Record<string, unknown>[];
    actions: string[];
    batchPayloads: Record<string, unknown>[];
    batchCalls: () => number;
    markCalls: () => number;
  } {
    const payloads: Record<string, unknown>[] = [];
    const actions: string[] = [];
    const batchPayloads: Record<string, unknown>[] = [];
    let marks = 0;
    let batches = 0;

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      if (request.payload) payloads.push(request.payload);
      actions.push(request.action);

      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'getPageData':
          return ok({
            shelterHomes: options.homes,
            participants: [PARTICIPANT],
            events: [],
            imports: [],
            validationResults: [],
          });
        case 'listEvents':
          return ok({ events: [] });
        case 'getParticipantEventSummaries':
          return ok({ summaries: [], issues: [] });
        case 'listEventDayRegistrations':
          return ok({ eventDayRegistrations: options.entries });
        case 'saveEventDayAttendanceBatch': {
          batches++;
          batchPayloads.push(request.payload as Record<string, unknown>);
          if (options.batchError) {
            return Promise.resolve(new Response(
              JSON.stringify({ success: false, error: options.batchError }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ));
          }
          const items = (request.payload?.['items'] ?? []) as Record<string, unknown>[];
          const outcome = options.onBatchSave
            ? options.onBatchSave(items)
            : {
                results: items.map(item => ({
                  participantId: item['participantId'],
                  outcome: item['expectedVersion'] === 0 ? 'CREATED' : 'UPDATED',
                  status: item['status'],
                  version: (item['expectedVersion'] as number) + 1,
                })),
              };
          // The stub workbook converges exactly like the real backend
          // (idempotent upsert keyed on participantId), so the post-save
          // list refresh sees the saved state.
          options.entries = options.entries.map(entry => {
            const result = (outcome.results as Record<string, unknown>[]).find(candidate =>
              candidate['participantId'] === (entry as { participantId: string }).participantId);
            const settled = result && (result['outcome'] === 'CREATED'
              || result['outcome'] === 'UPDATED' || result['outcome'] === 'UNCHANGED');
            return settled
              ? { ...(entry as object), checkInStatus: result['status'], version: result['version'] }
              : entry;
          });
          return ok({
            results: outcome.results,
            summary: {
              total: outcome.results.length,
              created: outcome.results.filter(r => r['outcome'] === 'CREATED').length,
              updated: outcome.results.filter(r => r['outcome'] === 'UPDATED').length,
              unchanged: outcome.results.filter(r => r['outcome'] === 'UNCHANGED').length,
              versionConflicts: outcome.results.filter(r => r['outcome'] === 'VERSION_CONFLICT').length,
              invalid: outcome.results.filter(r => r['outcome'] === 'INVALID').length,
            },
          });
        }
        case 'markEventDayRegistration':
          marks++;
          if (options.markError) {
            return Promise.resolve(new Response(
              JSON.stringify({ success: false, error: options.markError }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ));
          }
          options.entries = options.entries.map(entry =>
            (entry as { participantId: string }).participantId === (request.payload?.['participantId'])
              ? { ...ENTRY_CHECKED_IN }
              : entry
          );
          return ok({
            eventDayRegistration: {
              id: 'EDR-1',
              participantId: request.payload?.['participantId'],
              shelterHomeId: request.payload?.['shelterHomeId'],
              status: 'CHECKED_IN',
              checkedInAt: '2026-01-02T00:00:00.000Z',
              checkedInBy: 'spec-user',
              version: 1,
            },
          });
        default:
          return ok({});
      }
    });

    return {
      payloads,
      actions,
      batchPayloads,
      batchCalls: () => batches,
      markCalls: () => marks,
    };
  }

  type QueueStub = ReturnType<typeof stubQueueBackend>;

  async function renderQueue(options: QueueStubOptions): Promise<QueueStub> {
    const captured = stubQueueBackend(options);

    const auth = TestBed.inject(AuthService);
    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google-id',
      email: 'tester@nakshatra.local',
      displayName: 'Test User',
      role: options.role ?? 'ADMIN',
      accessStatus: 'APPROVED',
      version: 1,
    });
    auth.setApplicationSession({
      id: 'spec-session',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    fixture = TestBed.createComponent(Participants);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(component.eventDayEntries().length).toBeGreaterThan(0));
    fixture.detectChanges();

    return captured;
  }

  function pageText(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function buttonLabels(): string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .map(button => (button.textContent ?? '').trim());
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Participants],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('shows the check-in queue with distinct Not registered / Checked in statuses', async () => {
    await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY, ENTRY_OTHER_HOME] });

    expect(component.eventDayRows().length).toBe(2);
    expect(component.eventDayCheckInLabel(component.eventDayRows()[0])).toBe('Not registered');
    expect(component.eventDayCheckInLabel(component.eventDayRows()[1])).toBe('Checked in');
    expect(pageText()).toContain('Event Day Check-In');
    expect(pageText()).toContain('Not registered');
    expect(pageText()).toContain('Checked in');
  });

  it('filters the queue by home and by check-in status', async () => {
    await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY, ENTRY_OTHER_HOME] });

    component.setEventDayStatusFilter('CHECKED_IN');
    fixture.detectChanges();
    expect(component.eventDayRows().map(row => row.participantId)).toEqual(['participant-2']);

    component.setEventDayStatusFilter('');
    component.setEventDayHomeFilter('home-1');
    fixture.detectChanges();
    expect(component.eventDayRows().map(row => row.participantId)).toEqual(['participant-1']);
  });

  function eventDaySection(): HTMLElement {
    const section = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.section-card'))
      .find(card => (card.textContent ?? '').includes('Event Day Check-In'));
    if (!section) throw new Error('event-day section not found');
    return section as HTMLElement;
  }

  function rowForName(name: string): HTMLElement {
    const row = Array.from(eventDaySection().querySelectorAll('tbody tr'))
      .find(tr => (tr.textContent ?? '').includes(name));
    if (!row) throw new Error('row not found: ' + name);
    return row as HTMLElement;
  }

  function clickIn(row: HTMLElement, label: string): void {
    const button = Array.from(row.querySelectorAll('button'))
      .find(candidate => (candidate.textContent ?? '').trim() === label);
    if (!button) throw new Error('button not found: ' + label);
    button.click();
    fixture.detectChanges();
  }

  function clickToolbar(label: string): void {
    const button = Array.from(eventDaySection().querySelectorAll('button'))
      .find(candidate => (candidate.textContent ?? '').trim() === label);
    if (!button) throw new Error('toolbar button not found: ' + label);
    button.click();
    fixture.detectChanges();
  }

  it('stages Present/Absent locally with NO network call and never auto-marks anyone', async () => {
    const captured = await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY, ENTRY_OTHER_HOME] });

    // Nothing is auto-marked: no write request exists until the user saves.
    expect(captured.actions.filter(action =>
      action === 'saveEventDayAttendanceBatch' || action === 'markEventDayRegistration')).toHaveLength(0);

    const requestsBefore = captured.actions.length;

    clickIn(rowForName('Test Participant'), 'Present');
    expect(captured.actions.length).toBe(requestsBefore);
    expect(captured.batchCalls()).toBe(0);

    // Present on an already checked-in row is the saved state: no change.
    clickIn(rowForName('Second Participant'), 'Present');
    expect(captured.actions.length).toBe(requestsBefore);
    expect(component.eventDayUnsavedCount()).toBe(1);

    // Staging the saved state cancels the pending change again.
    clickIn(rowForName('Test Participant'), 'Absent');
    expect(component.eventDayUnsavedCount()).toBe(0);
    expect(captured.batchCalls()).toBe(0);

    clickIn(rowForName('Test Participant'), 'Present');
    expect(component.eventDayTotals()).toEqual({ participants: 2, present: 2, absent: 0, unsaved: 1 });
    expect(pageText()).toContain('Unsaved');
  });

  it('saves every pending change in ONE batch request and settles the saved state', async () => {
    const captured = await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY, ENTRY_OTHER_HOME] });

    clickIn(rowForName('Test Participant'), 'Present');
    clickIn(rowForName('Second Participant'), 'Absent');
    expect(component.eventDayUnsavedCount()).toBe(2);

    clickToolbar('Save Attendance');
    await vi.waitFor(() => expect(component.eventDaySaving()).toBe(false));
    await vi.waitFor(() => expect(component.eventDaySuccess()).toContain('Attendance saved for 2 participants'));
    fixture.detectChanges();

    expect(captured.batchCalls()).toBe(1);
    const items = captured.batchPayloads[0]['items'] as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    expect(items).toContainEqual({
      participantId: 'participant-1', shelterHomeId: 'home-1', status: 'CHECKED_IN', expectedVersion: 0,
    });
    expect(items).toContainEqual({
      participantId: 'participant-2', shelterHomeId: 'home-2', status: 'NOT_REGISTERED', expectedVersion: 1,
    });
    // The legacy one-by-one action is never used by this UI any more.
    expect(captured.markCalls()).toBe(0);

    expect(component.eventDayUnsavedCount()).toBe(0);
    const savedRow = rowForName('Test Participant');
    expect(savedRow.textContent).toContain('Checked in');
    expect(rowForName('Second Participant').textContent).toContain('Not registered');
  });

  it('keeps successful records, shows per-record failures and retries ONLY the failed ones', async () => {
    let attempts = 0;
    const captured = await renderQueue({
      homes: [HOME_LOCKED],
      entries: [ENTRY, ENTRY_OTHER_HOME],
      onBatchSave: (items) => {
        attempts++;
        return {
          results: items.map(item => (item['participantId'] === 'participant-2' && attempts === 1)
            ? {
                participantId: item['participantId'],
                outcome: 'INVALID',
                code: 'HOME_SHEET_NOT_LOCKED',
                message: 'Confirm and lock this home’s sheet before recording the event-day check-in.',
                status: 'NOT_REGISTERED',
                version: 1,
              }
            : {
                participantId: item['participantId'],
                outcome: item['expectedVersion'] === 0 ? 'CREATED' : 'UPDATED',
                status: item['status'],
                version: (item['expectedVersion'] as number) + 1,
              }),
        };
      },
    });

    clickIn(rowForName('Test Participant'), 'Present');
    clickIn(rowForName('Second Participant'), 'Absent');
    clickToolbar('Save Attendance');
    await vi.waitFor(() => expect(component.eventDaySaving()).toBe(false));
    fixture.detectChanges();

    // The successful record is settled and preserved; the failed one is
    // reported per record and stays staged.
    expect(component.eventDaySuccess()).toContain('1 failed');
    expect(component.eventDayFailureCount()).toBe(1);
    expect(rowForName('Second Participant').textContent).toContain('Confirm and lock');
    expect(rowForName('Second Participant').textContent).toContain('Unsaved');
    expect(component.eventDayUnsavedCount()).toBe(1);

    // Retry submits ONLY the failed record.
    clickToolbar('Save Attendance');
    await vi.waitFor(() => expect(component.eventDaySuccess()).toContain('1 participant'));
    fixture.detectChanges();

    expect(captured.batchCalls()).toBe(2);
    const retryItems = captured.batchPayloads[1]['items'] as Record<string, unknown>[];
    expect(retryItems).toHaveLength(1);
    expect(retryItems[0]['participantId']).toBe('participant-2');
    expect(component.eventDayFailureCount()).toBe(0);
    expect(component.eventDayUnsavedCount()).toBe(0);
  });

  it('keeps every change staged when the whole batch fails', async () => {
    const captured = await renderQueue({
      homes: [HOME_LOCKED],
      entries: [ENTRY, ENTRY_OTHER_HOME],
      batchError: {
        code: 'BATCH_WRITE_FAILED',
        message: 'The batch could not be written completely. Retrying the batch is safe.',
      },
    });

    clickIn(rowForName('Test Participant'), 'Present');
    clickIn(rowForName('Second Participant'), 'Absent');
    clickToolbar('Save Attendance');
    await vi.waitFor(() => expect(component.eventDayError()).toContain('Retrying the batch is safe'));
    fixture.detectChanges();

    expect(captured.batchCalls()).toBe(1);
    expect(component.eventDayUnsavedCount()).toBe(2);
    expect(component.eventDayFailureCount()).toBe(0);
    expect(component.eventDaySuccess()).toBe('');
  });

  it('preserves unsaved edits when the list refreshes in the background', async () => {
    await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY, ENTRY_OTHER_HOME] });

    clickIn(rowForName('Test Participant'), 'Present');
    expect(component.eventDayUnsavedCount()).toBe(1);

    // Another user's change arrives through a list refresh; the staged
    // local edit must survive it untouched.
    stubQueueBackend({
      homes: [HOME_LOCKED],
      entries: [ENTRY, { ...ENTRY_OTHER_HOME, checkInStatus: 'NOT_REGISTERED', version: 2 }],
    });
    await TestBed.inject(ParticipantEventService).loadEventDayRegistrations(undefined, true);
    fixture.detectChanges();

    expect(component.eventDayUnsavedCount()).toBe(1);
    expect(rowForName('Test Participant').textContent).toContain('Checked in (unsaved)');
    // The refreshed (other-user) state is visible on the untouched row.
    expect(rowForName('Second Participant').textContent).toContain('Not registered');
  });

  it('a scope switch clears and reloads the queue instead of leaking it', async () => {
    const captured = await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY, ENTRY_OTHER_HOME] });
    expect(component.eventDayEntries().length).toBe(2);

    const listReadsBefore = captured.actions.filter(action => action === 'listEventDayRegistrations').length;

    TestBed.inject(ProgramContextService).selectProgram('SPORTS');

    // A NON-forced read after the switch must not serve the old scope's
    // cache: the queue is dropped and re-read.
    await TestBed.inject(ParticipantEventService).loadEventDayRegistrations();

    const listReadsAfter = captured.actions.filter(action => action === 'listEventDayRegistrations').length;
    expect(listReadsAfter).toBeGreaterThan(listReadsBefore);
    expect(component.eventDayUnsavedCount()).toBe(0);
  });

  it('Reset Unsaved Changes restores the last backend-confirmed state', async () => {
    const captured = await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY, ENTRY_OTHER_HOME] });

    clickIn(rowForName('Test Participant'), 'Present');
    clickIn(rowForName('Second Participant'), 'Absent');
    clickToolbar('Reset Unsaved Changes');
    fixture.detectChanges();

    expect(component.eventDayUnsavedCount()).toBe(0);
    expect(rowForName('Test Participant').textContent).toContain('Not registered');
    expect(rowForName('Second Participant').textContent).toContain('Checked in');
    expect(captured.batchCalls()).toBe(0);
  });

  it('Select All Present / Mark All Absent stage the filtered rows in bulk', async () => {
    await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY, ENTRY_OTHER_HOME] });

    clickToolbar('Select All Present');
    expect(component.eventDayTotals()).toEqual({ participants: 2, present: 2, absent: 0, unsaved: 1 });

    clickToolbar('Mark All Absent');
    expect(component.eventDayTotals()).toEqual({ participants: 2, present: 0, absent: 2, unsaved: 1 });

    component.setEventDayHomeFilter('home-1');
    fixture.detectChanges();
    clickToolbar('Mark All Absent');
    // The bulk action touches only the filtered row; the hidden row's
    // earlier staged change is preserved, not silently dropped.
    expect(component.eventDayTotals().participants).toBe(1);
    expect(component.eventDayUnsavedCount()).toBe(1);
  });

  it('hides the add-event action until the home sheet is locked and the check-in is done', async () => {
    await renderQueue({ homes: [HOME_NOT_CONFIRMED], entries: [ENTRY_OTHER_HOME] });

    component.openParticipantId.set('participant-1');
    component.registrations.set([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(buttonLabels()).not.toContain('Add event');
    expect(pageText()).toContain('Participant record exists');
  });

  it('offers add-event once the sheet is locked and the participant is checked in', async () => {
    await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY_CHECKED_IN] });

    component.openParticipantId.set('participant-1');
    component.registrations.set([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(buttonLabels()).toContain('Add event');
    expect(pageText()).toContain('Event-day check-in completed');
  });

  it('shows the distinct four-state participant status', async () => {
    await renderQueue({ homes: [HOME_NOT_CONFIRMED], entries: [ENTRY_OTHER_HOME] });

    expect(component.eventDayStatusLabel(PARTICIPANT as unknown as Participant))
      .toBe('Participant record exists');

    // Locked home, no check-in yet.
    stubQueueBackend({ homes: [HOME_LOCKED], entries: [] });
    await TestBed.inject(ShelterDataService).refresh();
    expect(component.eventDayStatusLabel(PARTICIPANT as unknown as Participant))
      .toBe('Home sheet confirmed');

    // Locked home + event-day check-in completed.
    stubQueueBackend({ homes: [HOME_LOCKED], entries: [ENTRY_CHECKED_IN] });
    await TestBed.inject(ParticipantEventService).loadEventDayRegistrations(undefined, true);
    expect(component.eventDayStatusLabel(PARTICIPANT as unknown as Participant))
      .toBe('Event-day check-in completed');

    // A real competition registration outranks the earlier states.
    const store = TestBed.inject(ShelterDataService);
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
      return request.action === 'listParticipantEvents'
        ? ok({
            participantEvents: [
              registration({ id: 'reg-1', eventId: 'event-1', registrationStatus: 'REGISTERED', category: 'ARTS' }),
            ],
          })
        : ok({});
    });
    await store.loadParticipantEvents('participant-1', true);
    expect(component.eventDayStatusLabel(PARTICIPANT as unknown as Participant))
      .toBe('Registered for competition');
  });

  it('shows real participation facts in the queue rows, not just the lock text', async () => {
    const entry = {
      ...ENTRY,
      homeCode: 'AAI01',
      gender: 'FEMALE',
      age: 9,
      standard: 2,
      registeredEvents: [
        { eventId: 'event-1', eventName: 'Clay Modelling', category: 'ARTS' },
        { eventId: 'event-2', eventName: 'Quiz', category: 'LITERARY' },
      ],
      competitionAttendance: [
        { eventId: 'event-1', eventName: 'Clay Modelling', status: 'PRESENT' },
        { eventId: 'event-2', eventName: 'Quiz', status: '' },
      ],
    };
    await renderQueue({ homes: [HOME_LOCKED], entries: [entry] });

    const text = pageText();
    // Compact participation summary from REAL registration records.
    expect(text).toContain('2 events registered (Arts 1, Literary 1)');
    expect(text).toContain('Competition attendance: 1 present, 0 absent, 1 not marked');
    // Expandable details: registered events + per-event attendance.
    expect(text).toContain('Clay Modelling');
    expect(text).toContain('Quiz');
    // Identity: name + code, home name + code, demographics, level.
    expect(text).toContain('P-0001');
    expect(text).toContain('AAI01');
    expect(text).toContain('Age 9');
    // The home lock is a prerequisite indicator only, never the
    // participation content itself.
    expect(text).toContain('Home sheet confirmed and locked');
  });

  it('never fabricates registrations or attendance in the queue rows', async () => {
    await renderQueue({ homes: [HOME_LOCKED], entries: [ENTRY] });

    const text = pageText();
    expect(text).toContain('No competition events registered');
    expect(text).toContain('No competition attendance marked');
  });

  it('lets a Liaison correct attendance after a save (re-editable, batched)', async () => {
    const stub = await renderQueue({
      role: 'LIAISON_TEAM',
      homes: [HOME_LOCKED],
      entries: [ENTRY],
    });

    component.stageEventDay(component.eventDayEntries()[0], 'CHECKED_IN');
    fixture.detectChanges();
    await component.saveEventDayAttendance();
    fixture.detectChanges();

    expect(stub.batchCalls()).toBe(1);
    expect(stub.batchPayloads[0]).toEqual({
      items: [
        { participantId: 'participant-1', shelterHomeId: 'home-1', status: 'CHECKED_IN', expectedVersion: 0 },
      ],
    });

    // Post-save correction on the SAME saved row: Present -> Absent.
    component.stageEventDay(component.eventDayEntries()[0], 'NOT_REGISTERED');
    fixture.detectChanges();
    await component.saveEventDayAttendance();
    fixture.detectChanges();

    expect(stub.batchCalls()).toBe(2);
    expect(stub.batchPayloads[1]).toEqual({
      items: [
        { participantId: 'participant-1', shelterHomeId: 'home-1', status: 'NOT_REGISTERED', expectedVersion: 1 },
      ],
    });
    expect(pageText()).toContain('Attendance saved for 1 participant');
    expect(component.eventDayHasUnsaved()).toBe(false);
  });

  it('keeps staged rows and shows the backend reason when a save is rejected', async () => {
    await renderQueue({
      role: 'LIAISON_TEAM',
      homes: [HOME_LOCKED],
      entries: [ENTRY],
      batchError: {
        code: 'AUTHORIZATION_FAILED',
        message: "This action isn't available for your role.",
      },
    });

    component.stageEventDay(component.eventDayEntries()[0], 'CHECKED_IN');
    fixture.detectChanges();
    await component.saveEventDayAttendance();
    fixture.detectChanges();

    expect(pageText()).toContain('Attendance was not fully saved.');
    expect(pageText()).toContain('available for your role');
    // Nothing was written: the choice stays staged for a retry.
    expect(component.eventDayHasUnsaved()).toBe(true);
    expect(component.eventDayPending()['participant-1']).toBe('CHECKED_IN');
  });
});
