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

  async function seedEvents(
    events: Event[],
    registrationCounts?: Record<string, number> | null,
    catalogueMigration?: {
      pending: boolean;
      missingRecordCodes: string[];
      levelBandPendingCodes: string[];
      blockedRecordCodes: string[];
    } | null,
  ): Promise<void> {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              events,
              registrationCounts: registrationCounts ?? {},
              catalogueMigration: catalogueMigration ?? null,
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
      .toBe('Juniors + Seniors');
    // A record open to all four levels is labelled COMMON (not a 5th level).
    expect(component.eligibleLevelsLabel(
      event({ id: 'event-3', eligibleLevels: ['SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR'] })))
      .toBe('COMMON · all levels');
    expect(component.eligibleLevelsLabel(event({ id: 'event-2', eligibleLevels: [] })))
      .toBe('—');
  });

  it('expanded card rows include every registration with its status; the header count comes from the batched aggregate', async () => {
    await seedEvents([event({ id: 'event-1' })], { 'event-1': 1 });

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
    expect(rows.filter(row => row.status === 'REGISTERED').length).toBe(1);
    expect(component.registrationCount('event-1')).toBe(1);
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
 * Batched registration-count aggregate: loaded together with the
 * catalogue at page init for EVERY event, correct in the collapsed and
 * the expanded state, with `0 registered` / `Loading…` / `Unable to load`
 * as distinct states (never an em dash), refreshed by registration saves
 * and Sheets syncs, and never fetched per event.
 */
describe('Events — batched registration counts at page init', () => {
  let fixture: ComponentFixture<Events>;
  let component: Events;

  interface BackendCalls {
    [action: string]: number;
  }

  function jsonResponse(data: unknown): Promise<Response> {
    return Promise.resolve(new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  }

  function failureResponse(action: string): Promise<Response> {
    return Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: action } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  }

  const EVENTS = [
    event({ id: 'event-1', name: 'Clay Modelling' }),
    event({ id: 'event-2', name: 'Rangoli' }),
    event({ id: 'event-3', name: 'Group Song' }),
  ];

  /**
   * Stubs the backend. `countsProvider` returns the aggregate for the
   * NEXT listEvents response, so refreshes can change what is served.
   */
  function stubCountsBackend(
    countsProvider: () => Record<string, number> | null,
    calls: BackendCalls,
  ): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      calls[request.action] = (calls[request.action] ?? 0) + 1;

      switch (request.action) {
        case 'listEvents':
          return jsonResponse({ events: EVENTS, registrationCounts: countsProvider() });
        case 'getPageData':
          return jsonResponse({
            shelterHomes: [],
            participants: [],
            imports: [],
            validationResults: [],
          });
        case 'listEventDayRegistrations':
          return jsonResponse({ eventDayRegistrations: [] });
        case 'listScores':
          return jsonResponse({ scores: [] });
        case 'listEventRegistrations':
          return jsonResponse({ participantEvents: [] });
        case 'listParticipantEvents':
          return jsonResponse({ participantEvents: [] });
        case 'cancelRegistration':
          return jsonResponse({
            participantEvent: registration({ id: 'reg-1', eventId: 'event-1', registrationStatus: 'CANCELLED' }),
          });
        case 'listShelterHomes':
          return jsonResponse({ shelterHomes: [] });
        case 'listParticipants':
          return jsonResponse({ participants: [] });
        case 'getImportStatus':
          return jsonResponse({ imports: [] });
        default:
          return failureResponse(request.action);
      }
    });
  }

  async function renderWithCounts(
    countsProvider: () => Record<string, number> | null,
  ): Promise<BackendCalls> {
    const calls: BackendCalls = {};
    stubCountsBackend(countsProvider, calls);

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

    fixture = TestBed.createComponent(Events);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    await vi.waitFor(() => expect(component.events().length).toBe(3));
    fixture.detectChanges();
    return calls;
  }

  function cardCountLabels(): string[] {
    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.event-card-registered');
    return Array.from(cards).map(card => (card.textContent ?? '').trim());
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

  it('shows every event count at page init without expanding any card, with NO per-event count request', async () => {
    const calls = await renderWithCounts(() => ({ 'event-1': 28, 'event-2': 0, 'event-3': 5 }));

    const labels = cardCountLabels();
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain('Registered: 28');
    expect(labels[1]).toContain('Registered: 0');
    expect(labels[2]).toContain('Registered: 5');

    // No card was expanded and still every count rendered.
    expect(component.expandedEventId()).toBeNull();

    // The counts ride with the catalogue: zero per-event count requests.
    expect(calls['listEventRegistrations'] ?? 0).toBe(0);
    expect(calls['listParticipantEvents'] ?? 0).toBe(0);
    // One batched aggregate request (two at most when the boot fan-out
    // and the catalogue load race); never one per event.
    expect(calls['listEvents']).toBeGreaterThanOrEqual(1);
    expect(calls['listEvents']).toBeLessThanOrEqual(2);
  });

  it('a loaded zero renders "Registered: 0", never an em dash', async () => {
    await renderWithCounts(() => ({ 'event-1': 0, 'event-2': 0, 'event-3': 0 }));

    for (const label of cardCountLabels()) {
      expect(label).toContain('Registered: 0');
      expect(label).not.toContain('—');
    }
  });

  it('renders "Loading…" while the aggregate is pending and the count once it arrives', async () => {
    await renderWithCounts(() => ({ 'event-1': 3, 'event-2': 3, 'event-3': 3 }));
    expect(cardCountLabels()[0]).toContain('Registered: 3');

    // A refetch (after a write or sync) is pending state again.
    let releaseCounts: ((response: Response) => void) | null = null;
    const calls: BackendCalls = {};

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      calls[request.action] = (calls[request.action] ?? 0) + 1;

      if (request.action === 'listEvents') {
        return new Promise<Response>(resolve => {
          releaseCounts = resolve;
        });
      }

      return jsonResponse({
        shelterHomes: [], participants: [], imports: [], validationResults: [],
        eventDayRegistrations: [], scores: [], participantEvents: [],
      });
    });

    void TestBed.inject(ShelterDataService).refreshRegistrationCounts();
    await vi.waitFor(() => expect(releaseCounts).toBeTruthy());

    fixture.detectChanges();
    expect(component.registrationCountsStatus()).toBe('LOADING');
    expect(component.registrationCount('event-1')).toBeNull();
    expect(cardCountLabels()[0]).toContain('Loading…');
    expect(cardCountLabels()[0]).not.toContain('—');

    releaseCounts!(new Response(
      JSON.stringify({ success: true, data: { events: EVENTS, registrationCounts: { 'event-1': 3, 'event-2': 3, 'event-3': 3 } } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await vi.waitFor(() => expect(component.registrationCountsStatus()).toBe('LOADED'));
    fixture.detectChanges();

    expect(cardCountLabels()[0]).toContain('Registered: 3');
  });

  it('renders "Unable to load" when the aggregate cannot be loaded - never a dash or a fake zero', async () => {
    await renderWithCounts(() => null);

    expect(component.registrationCountsStatus()).toBe('ERROR');
    expect(component.registrationCount('event-1')).toBeNull();

    for (const label of cardCountLabels()) {
      expect(label).toContain('Unable to load');
      expect(label).not.toContain('—');
    }
  });

  it('counts stay correct in the expanded card state too', async () => {
    await renderWithCounts(() => ({ 'event-1': 28, 'event-2': 0, 'event-3': 5 }));

    component.toggleCard(component.events()[0]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.expandedEventId()).toBe('event-1');
    expect(cardCountLabels()[0]).toContain('Registered: 28');

    const detail = (fixture.nativeElement as HTMLElement).querySelector('.event-card-details');
    expect((detail?.textContent ?? '').replace(/\s+/g, ' ')).toContain('Registered 28');

    // Collapse again: still the same authoritative count.
    component.toggleCard(component.events()[0]);
    fixture.detectChanges();
    expect(cardCountLabels()[0]).toContain('Registered: 28');
  });

  it('counts update after a registration write (the aggregate is refetched, no full reload)', async () => {
    let counts: Record<string, number> | null = { 'event-1': 28, 'event-2': 0, 'event-3': 5 };
    const calls = await renderWithCounts(() => counts);

    const eventsRequestsAfterLoad = calls['listEvents'];

    counts = { 'event-1': 27, 'event-2': 0, 'event-3': 5 };

    const result = await TestBed.inject(ParticipantEventService)
      .cancelRegistration('participant-1', 'event-1');
    expect(result.success).toBe(true);

    await vi.waitFor(() => expect(component.registrationCount('event-1')).toBe(27));
    fixture.detectChanges();
    expect(cardCountLabels()[0]).toContain('Registered: 27');

    // Exactly ONE extra aggregate request for the write.
    expect(calls['listEvents']).toBe(eventsRequestsAfterLoad + 1);
  });

  it('counts update after a Sheets sync refresh', async () => {
    let counts: Record<string, number> | null = { 'event-1': 28, 'event-2': 0, 'event-3': 5 };
    const calls = await renderWithCounts(() => counts);

    counts = { 'event-1': 30, 'event-2': 1, 'event-3': 5 };

    await TestBed.inject(ShelterDataService).refreshAfterBulkSync(['home-1']);

    await vi.waitFor(() => expect(component.registrationCount('event-1')).toBe(30));
    expect(component.registrationCount('event-2')).toBe(1);
    expect(calls['listEvents']).toBeGreaterThanOrEqual(2);
  });

  it('concurrent aggregate refreshes never settle with stale counts', async () => {
    let counts: Record<string, number> | null = { 'event-1': 1, 'event-2': 1, 'event-3': 1 };
    await renderWithCounts(() => counts);

    const store = TestBed.inject(ShelterDataService);

    counts = { 'event-1': 2, 'event-2': 2, 'event-3': 2 };
    const first = store.refreshRegistrationCounts();

    counts = { 'event-1': 3, 'event-2': 3, 'event-3': 3 };
    const second = store.refreshRegistrationCounts();

    await Promise.all([first, second]);

    await vi.waitFor(() => expect(store.registrationCounts()['event-1']).toBe(3));
    expect(store.registrationCountsStatus()).toBe('LOADED');
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

describe('Events — the official 29-record catalogue served by the backend', () => {
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

  async function seedEvents(
    events: Event[],
    catalogueMigration?: {
      pending: boolean;
      missingRecordCodes: string[];
      levelBandPendingCodes: string[];
      blockedRecordCodes: string[];
    } | null,
  ): Promise<void> {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              events,
              registrationCounts: Object.fromEntries(events.map(e => [e.id, 0])),
              catalogueMigration: catalogueMigration ?? null,
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

    await TestBed.inject(ShelterDataService).loadEvents();
  }

  const ALL = ['SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR'] as const;

  /** The official 29 records exactly as the backend serves them. */
  const OFFICIAL: Array<[string, string, Event['category'], Event['mode'], string[]]> = [
    ['LIT-001', 'Group Discussion', 'LITERARY', 'SOLO', ['SENIOR']],
    ['LIT-001-SS', 'Group Discussion', 'LITERARY', 'SOLO', ['SUPER_SENIOR']],
    ['LIT-002', 'Story Telling (Tamil/English)', 'LITERARY', 'SOLO', ['SUB_JUNIOR']],
    ['LIT-002-J', 'Story Telling (Tamil/English)', 'LITERARY', 'SOLO', ['JUNIOR']],
    ['LIT-003', 'Story Writing (Tamil/English)', 'LITERARY', 'SOLO', ['SENIOR']],
    ['LIT-003-SS', 'Story Writing (Tamil/English)', 'LITERARY', 'SOLO', ['SUPER_SENIOR']],
    ['LIT-004', 'Potpurri (Words Play)', 'LITERARY', 'GROUP', [...ALL]],
    ['LIT-005', 'Quiz (SJ + J)', 'LITERARY', 'GROUP', ['SUB_JUNIOR', 'JUNIOR']],
    ['LIT-006', 'Quiz (S + SS)', 'LITERARY', 'GROUP', ['SENIOR', 'SUPER_SENIOR']],
    ['LIT-007', 'Block and Tackle', 'LITERARY', 'SOLO', ['SENIOR']],
    ['LIT-007-SS', 'Block and Tackle', 'LITERARY', 'SOLO', ['SUPER_SENIOR']],
    ['CUL-001', 'Group Song', 'CULTURAL', 'GROUP', [...ALL]],
    ['CUL-002', 'Skit (Tamil)', 'CULTURAL', 'GROUP', [...ALL]],
    ['CUL-003', 'Group Dance', 'CULTURAL', 'GROUP', [...ALL]],
    ['CUL-004', 'Adapt Tune', 'CULTURAL', 'SOLO', ['SUB_JUNIOR']],
    ['CUL-004-J', 'Adapt Tune', 'CULTURAL', 'SOLO', ['JUNIOR']],
    ['CUL-004-S', 'Adapt Tune', 'CULTURAL', 'SOLO', ['SENIOR']],
    ['CUL-004-SS', 'Adapt Tune', 'CULTURAL', 'SOLO', ['SUPER_SENIOR']],
    ['ART-001', 'Clay Modelling', 'ARTS', 'SOLO', ['SUB_JUNIOR']],
    ['ART-001-J', 'Clay Modelling', 'ARTS', 'SOLO', ['JUNIOR']],
    ['ART-001-S', 'Clay Modelling', 'ARTS', 'SOLO', ['SENIOR']],
    ['ART-001-SS', 'Clay Modelling', 'ARTS', 'SOLO', ['SUPER_SENIOR']],
    ['ART-002', 'Rangoli', 'ARTS', 'GROUP', [...ALL]],
    ['ART-003', 'Greeting Card making', 'ARTS', 'SOLO', ['SUB_JUNIOR']],
    ['ART-003-J', 'Greeting Card making', 'ARTS', 'SOLO', ['JUNIOR']],
    ['ART-003-S', 'Greeting Card making', 'ARTS', 'SOLO', ['SENIOR']],
    ['ART-003-SS', 'Greeting Card making', 'ARTS', 'SOLO', ['SUPER_SENIOR']],
    ['ART-004', 'Waste to wealth', 'ARTS', 'GROUP', [...ALL]],
    ['ART-005', 'String Art', 'ARTS', 'GROUP', [...ALL]],
  ];

  function officialEvents(): Event[] {
    return OFFICIAL.map(([eventCode, name, category, mode, levels], index) =>
      event({
        id: 'EVT-' + String(index + 1).padStart(4, '0'),
        eventCode,
        name,
        category,
        mode,
        eligibleLevels: levels as Event['eligibleLevels'],
      }));
  }

  it('renders exactly the 29 backend records with the 11/7/11 category totals (no hardcoded list)', async () => {
    await seedEvents(officialEvents());

    expect(component.totalEvents()).toBe(29);
    expect(component.groupedEvents().map(group => [group.category, group.events.length]))
      .toEqual([
        ['ARTS', 11],
        ['LITERARY', 11],
        ['CULTURAL', 7],
      ]);
    expect(component.events().map(e => e.eventCode)).toEqual(
      officialEvents().map(e => e.eventCode),
    );
  });

  it('shows every record the backend sends - the catalogue is never consolidated or seeded locally', async () => {
    const arbitrary = [
      event({ id: 'x-1', eventCode: 'ZZ-1', name: 'Zebra Dance', category: 'CULTURAL', eligibleLevels: ['JUNIOR'] }),
      event({ id: 'x-2', eventCode: 'ZZ-2', name: 'Yodel Solo', category: 'ARTS', eligibleLevels: ['SENIOR'] }),
      event({ id: 'x-3', eventCode: 'ZZ-3', name: 'Quiz (SJ + J)', category: 'LITERARY', eligibleLevels: ['SUB_JUNIOR', 'JUNIOR'] }),
    ];

    await seedEvents(arbitrary);

    expect(component.events().map(e => [e.id, e.name]))
      .toEqual([['x-1', 'Zebra Dance'], ['x-2', 'Yodel Solo'], ['x-3', 'Quiz (SJ + J)']]);
  });

  it('keeps same-name records separate and shows the level prominently on each', async () => {
    await seedEvents(officialEvents());

    const clay = component.events().filter(e => e.eventCode.startsWith('ART-001'));

    expect(clay.map(e => e.name)).toEqual([
      'Clay Modelling — Sub Junior (SJ)',
      'Clay Modelling — Junior (J)',
      'Clay Modelling — Senior (S)',
      'Clay Modelling — Super Senior (SS)',
    ]);
    expect(new Set(clay.map(e => e.id)).size).toBe(4);
  });

  it('normalizes official display names without touching identity', async () => {
    await seedEvents(officialEvents());

    const greeting = component.events().find(e => e.eventCode === 'ART-003-J');
    const waste = component.events().find(e => e.eventCode === 'ART-004');

    expect(greeting?.name).toBe('Greeting Card Making — Junior (J)');
    expect(greeting?.eventCode).toBe('ART-003-J');
    expect(waste?.name).toBe('Waste to Wealth');
  });

  it('surfaces the catalogue migration state from the same backend read', async () => {
    await seedEvents(officialEvents(), {
      pending: true,
      missingRecordCodes: ['ART-001-J', 'ART-001-S', 'ART-001-SS'],
      levelBandPendingCodes: ['ART-001'],
      blockedRecordCodes: [],
    });

    expect(component.catalogueMigration()?.pending).toBe(true);
    expect(component.catalogueMigration()?.missingRecordCodes.length).toBe(3);
    expect(component.catalogueMigration()?.levelBandPendingCodes).toEqual(['ART-001']);
  });

  it('reports no migration state outside the official catalogue scope', async () => {
    await seedEvents([event({ id: 'z-1', eventCode: 'ART-Z1', name: 'Zone Contest' })]);

    expect(component.catalogueMigration()).toBeNull();
    expect(component.totalEvents()).toBe(1);
  });
});
