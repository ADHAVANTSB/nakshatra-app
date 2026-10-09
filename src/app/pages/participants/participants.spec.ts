import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, describe, expect, it } from 'vitest';

import { Participant, ParticipantEvent, Event } from '../../core/models';
import { AuthService } from '../../core/services/auth/auth.service';
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

  it('computes total, per-category and solo counts from backend registrations', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: { eventId?: string } };
      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { events: EVENTS } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { participantEvents: rowsFor(request.payload?.eventId ?? '') } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    await component.loadRegistrationSummary();

    expect(component.registrationSummaryState()).toBe('LOADED');
    expect(component.eventSummary('participant-1')).toEqual({
      total: 3, maxTotal: 6,
      arts: 2, literary: 0, cultural: 1, maxCategory: 2,
      solo: 1, maxSolo: 3,
    });
    // Only the requested participant's rows count.
    expect(component.eventSummary('participant-2')).toEqual({
      total: 1, maxTotal: 6,
      arts: 1, literary: 0, cultural: 0, maxCategory: 2,
      solo: 1, maxSolo: 3,
    });
  });

  it('reaches a FAILED terminal state when the summary read fails and recovers on retry', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { events: EVENTS } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'BACKEND_ERROR', message: 'Registrations unavailable' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    await component.loadRegistrationSummary();

    expect(component.registrationSummaryState()).toBe('FAILED');
    expect(component.eventSummary('participant-1')).toBeNull();

    // Retry through a working backend: the terminal state recovers.
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: { eventId?: string } };
      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { events: EVENTS } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { participantEvents: rowsFor(request.payload?.eventId ?? '') } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
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
