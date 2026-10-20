import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Event, ParticipantEvent } from '../../core/models';
import { AuthService } from '../../core/services/auth/auth.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { Events } from './events';

/**
 * Events page presentation tests: category grouping, collapsed-card eligible
 * levels, expanded-card rows with registration status, and the lazy
 * one-read-per-card registration load. The component is created without
 * change detection so `ngOnInit` never starts a load; backend data is seeded
 * through the shared store over a stubbed network.
 */

function event(overrides: Partial<Event> & { id: string }): Event {
  return {
    eventCode: `E-${overrides.id}`,
    name: `Event ${overrides.id}`,
    category: 'ARTS',
    mode: 'SOLO',
    status: 'ACTIVE',
    eligibleLevels: ['JUNIOR'],
    ...overrides,
  } as unknown as Event;
}

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

describe('Events — category grouping and card details', () => {
  let component: Events;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Events],
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

    component = TestBed.createComponent(Events).componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  async function seedEvents(events: Event[]): Promise<void> {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { events } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    await TestBed.inject(ShelterDataService).loadEvents();
  }

  it('groups events under ARTS / LITERARY / CULTURAL in canonical order', async () => {
    await seedEvents([
      event({ id: 'event-1', category: 'CULTURAL' }),
      event({ id: 'event-2', category: 'ARTS' }),
      event({ id: 'event-3', category: 'LITERARY' }),
    ]);

    expect(component.groupedEvents().map(group => group.category))
      .toEqual(['ARTS', 'LITERARY', 'CULTURAL']);
    expect(component.groupedEvents().map(group => group.events.length))
      .toEqual([1, 1, 1]);
  });

  it('omits category groups with no matching events', async () => {
    await seedEvents([
      event({ id: 'event-1', category: 'ARTS' }),
      event({ id: 'event-2', category: 'ARTS' }),
    ]);

    expect(component.groupedEvents().map(group => group.category)).toEqual(['ARTS']);
    expect(component.groupedEvents()[0].events.length).toBe(2);
  });

  it('respects the search filter when grouping', async () => {
    await seedEvents([
      event({ id: 'event-1', category: 'ARTS', name: 'Vocal Solo' }),
      event({ id: 'event-2', category: 'ARTS', name: 'Painting' }),
      event({ id: 'event-3', category: 'CULTURAL', name: 'Vocal Group' }),
    ]);

    component.searchTerm.set('Vocal');

    expect(component.groupedEvents().map(group => group.category)).toEqual(['ARTS', 'CULTURAL']);
    expect(component.groupedEvents()[0].events.map(item => item.id)).toEqual(['event-1']);
    expect(component.groupedEvents()[1].events.map(item => item.id)).toEqual(['event-3']);
  });

  it('labels eligible levels for the collapsed card from backend data', () => {
    expect(component.eligibleLevelsLabel(event({ id: 'event-1', eligibleLevels: ['JUNIOR', 'SENIOR'] })))
      .toBe('Juniors, Seniors');
    expect(component.eligibleLevelsLabel(event({ id: 'event-2', eligibleLevels: [] })))
      .toBe('—');
  });

  it('expanded card rows include every registration with its status; the header counts REGISTERED only', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: { eventId?: string } };
      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              participantEvents: [
                registration({ id: 'reg-1', eventId: 'event-1', registrationStatus: 'REGISTERED', participantName: 'Ana' }),
                registration({ id: 'reg-2', eventId: 'event-1', registrationStatus: 'WAITLISTED', participantName: 'Ben' }),
                registration({ id: 'reg-3', eventId: 'event-1', registrationStatus: 'CANCELLED', participantName: 'Cy' }),
              ],
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

    await TestBed.inject(ShelterDataService).loadEventRegistrations('event-1');

    const rows = component.cardParticipants('event-1');
    expect(rows.map(row => row.status)).toEqual(['REGISTERED', 'WAITLISTED', 'CANCELLED']);
    expect(component.activeRegistrationCount('event-1')).toBe(1);
  });

  it('reads registrations lazily — one request per card expand, none on collapse or re-expand', async () => {
    await seedEvents([event({ id: 'event-1' })]);

    let registrationCalls = 0;
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listEventRegistrations') {
        registrationCalls += 1;
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { participantEvents: [registration({ id: 'reg-1', eventId: 'event-1' })] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    const target = component.events()[0];

    component.toggleCard(target);
    await Promise.resolve();
    await Promise.resolve();
    expect(registrationCalls).toBe(1);

    // Collapse, then re-expand: a successful read is never repeated.
    component.toggleCard(target);
    component.toggleCard(target);
    await Promise.resolve();
    await Promise.resolve();
    expect(registrationCalls).toBe(1);
    expect(component.expandedEventId()).toBe('event-1');
  });

  it('resolves the shelter home from the registration row when the participant is not cached', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      if (request.action === 'listShelterHomes') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: { shelterHomes: [{ id: 'home-1', homeCode: 'H-01', homeName: 'Sunrise Home' }] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              participantEvents: [registration({
                id: 'reg-1',
                eventId: 'event-1',
                participantId: 'ghost-participant',
                participantName: 'Ghost Row',
                shelterHomeId: 'home-1',
              })],
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

    const store = TestBed.inject(ShelterDataService);
    await store.loadConnectedHomes();
    await store.loadEventRegistrations('event-1');

    const rows = component.cardParticipants('event-1');

    expect(rows[0].homeName).toBe('Sunrise Home');
  });
});

/**
 * Registration mutation controls (Add Participant / Cancel / Reactivate) are
 * hidden for the Events role and kept for ADMIN. Rendered through the real
 * template so a hidden control is proven absent from the DOM, not disabled.
 */
describe('Events — registration controls per role', () => {
  let fixture: ComponentFixture<Events>;
  let component: Events;

  function stubBackend(): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      if (request.action === 'listEvents' || request.action === 'getPageData') {
        return ok({
          events: [event({ id: 'event-1' })],
          shelterHomes: [],
          participants: [],
          imports: [],
          validationResults: [],
        });
      }
      if (request.action === 'listEventRegistrations') {
        return ok({
          participantEvents: [
            registration({ id: 'reg-1', eventId: 'event-1', registrationStatus: 'REGISTERED', participantName: 'Ana' }),
            registration({ id: 'reg-2', eventId: 'event-1', registrationStatus: 'CANCELLED', participantName: 'Cy' }),
          ],
        });
      }
      if (request.action === 'listScores') {
        return ok({ scores: [] });
      }
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });
  }

  async function renderDrawerWithRole(role: 'ADMIN' | 'EVENTS_TEAM'): Promise<void> {
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

    fixture = TestBed.createComponent(Events);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    await vi.waitFor(() => expect(component.events().length).toBe(1));
    component.openParticipants(component.events()[0]);
    await vi.waitFor(() => expect(component.registrationsReady()).toBe(true));
    fixture.detectChanges();
  }

  function drawerButtonLabels(): string[] {
    const drawer = (fixture.nativeElement as HTMLElement).querySelector('.participant-drawer');
    expect(drawer).toBeTruthy();
    return Array.from(drawer!.querySelectorAll('button')).map(button => (button.textContent ?? '').trim());
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Events],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('ADMIN keeps Add Participant, Cancel and Reactivate in the Event Participants drawer', async () => {
    await renderDrawerWithRole('ADMIN');

    const labels = drawerButtonLabels();
    expect(labels).toContain('+ Add Participant');
    expect(labels).toContain('Cancel');
    expect(labels).toContain('Reactivate');
  });

  it('the Events role sees no Add Participant, Cancel or Reactivate controls', async () => {
    await renderDrawerWithRole('EVENTS_TEAM');

    const labels = drawerButtonLabels();
    expect(labels.some(label => label.includes('Add Participant'))).toBe(false);
    expect(labels).not.toContain('Cancel');
    expect(labels).not.toContain('Reactivate');
  });
});

/**
 * Registration candidates require BOTH a LOCKED home sheet and the
 * event-day check-in. Participants outside that gate never appear in the
 * add-participant candidate list (the backend enforces the same rule on
 * every write).
 */
describe('Events — registration candidates require home lock + event-day check-in', () => {
  let component: Events;

  const PARTICIPANT_LOCKED_CHECKED = {
    id: 'p-1',
    participantCode: 'P-0001',
    shelterHomeId: 'home-1',
    fullName: 'Checked In',
    gender: 'MALE',
    age: 10,
    standard: 5,
    level: 'JUNIOR',
    eligibilityStatus: 'ELIGIBLE',
    validationStatus: 'PASSED',
    approvalStatus: 'APPROVED',
    lockStatus: 'UNLOCKED',
    version: 1,
  };

  const PARTICIPANT_LOCKED_UNCHECKED = {
    ...PARTICIPANT_LOCKED_CHECKED,
    id: 'p-2',
    participantCode: 'P-0002',
    fullName: 'Not Checked In',
  };

  const PARTICIPANT_UNLOCKED_HOME = {
    ...PARTICIPANT_LOCKED_CHECKED,
    id: 'p-3',
    participantCode: 'P-0003',
    shelterHomeId: 'home-2',
    fullName: 'Unlocked Home',
  };

  function stubBackend(entries: unknown[]): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'listShelterHomes':
          return ok({
            shelterHomes: [
              { id: 'home-1', homeCode: 'H-01', homeName: 'Sunrise Home', status: 'ACTIVE', version: 1, sheetStatus: 'LOCKED' },
              { id: 'home-2', homeCode: 'H-02', homeName: 'Second Home', status: 'ACTIVE', version: 1, sheetStatus: 'NOT_CONFIRMED' },
            ],
          });
        case 'listParticipants': {
          const payload = JSON.parse(init.body) as { payload?: { shelterHomeId?: string } };
          const homeId = payload.payload?.shelterHomeId;
          return ok({
            participants: [PARTICIPANT_LOCKED_CHECKED, PARTICIPANT_LOCKED_UNCHECKED, PARTICIPANT_UNLOCKED_HOME]
              .filter(participant => !homeId || participant.shelterHomeId === homeId),
          });
        }
        case 'listEventDayRegistrations':
          return ok({ eventDayRegistrations: entries });
        case 'getPageData':
          return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
        case 'listEvents':
          return ok({ events: [] });
        default:
          return ok({});
      }
    });
  }

  async function seedCandidates(entries: unknown[]): Promise<void> {
    stubBackend(entries);

    const store = TestBed.inject(ShelterDataService);
    await store.loadConnectedHomes();
    await store.loadParticipants('home-1');
    await store.loadParticipants('home-2');
    await TestBed.inject(ParticipantEventService).loadEventDayRegistrations(undefined, true);

    component.selectedEvent.set(event({ id: 'event-1' }));
    component.participantSearch.set('');
    component.participantHomeFilter.set('ALL');
    component.selectedParticipantId.set('');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Events],
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

    component = TestBed.createComponent(Events).componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('hides participants of unlocked homes and unchecked-in participants from the candidate list', async () => {
    await seedCandidates([
      {
        participantId: 'p-1',
        participantCode: 'P-0001',
        fullName: 'Checked In',
        level: 'JUNIOR',
        shelterHomeId: 'home-1',
        homeName: 'Sunrise Home',
        homeSheetStatus: 'LOCKED',
        checkInStatus: 'CHECKED_IN',
        checkedInAt: '2026-01-01T00:00:00.000Z',
        checkedInBy: 'spec-user',
        version: 1,
      },
    ]);

    expect(component.availableParticipants().map(participant => participant.id)).toEqual(['p-1']);
  });

  it('offers nobody while no home has completed the event-day gate', async () => {
    await seedCandidates([]);

    expect(component.availableParticipants()).toEqual([]);
  });

  it('reads the event-day check-in queue when the events page initialises', async () => {
    // Regression: without this read the candidate gate saw an empty queue
    // and the events page offered nobody until the participants page was
    // visited first.
    stubBackend([{
      participantId: 'p-1',
      participantCode: 'P-0001',
      fullName: 'Checked In',
      level: 'JUNIOR',
      shelterHomeId: 'home-1',
      homeName: 'Sunrise Home',
      homeSheetStatus: 'LOCKED',
      checkInStatus: 'CHECKED_IN',
      checkedInAt: '2026-01-01T00:00:00.000Z',
      checkedInBy: 'spec-user',
      version: 1,
    }]);

    component.ngOnInit();

    await vi.waitFor(() => {
      expect(TestBed.inject(ParticipantEventService).eventDayEntries()).toHaveLength(1);
    });
  });

  it('keeps listing checked-in participants of locked homes after a refresh re-read', async () => {
    await seedCandidates([
      {
        participantId: 'p-1',
        participantCode: 'P-0001',
        fullName: 'Checked In',
        level: 'JUNIOR',
        shelterHomeId: 'home-1',
        homeName: 'Sunrise Home',
        homeSheetStatus: 'LOCKED',
        checkInStatus: 'CHECKED_IN',
        checkedInAt: '2026-01-01T00:00:00.000Z',
        checkedInBy: 'spec-user',
        version: 1,
      },
    ]);

    const before = component.availableParticipants().map(participant => participant.id);

    // A forced queue re-read restores exactly the persisted state.
    await TestBed.inject(ParticipantEventService).loadEventDayRegistrations(undefined, true);

    expect(component.availableParticipants().map(participant => participant.id)).toEqual(before);
  });
});
