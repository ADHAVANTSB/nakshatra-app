import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Event, ParticipantEvent } from '../../core/models';
import { AuthService } from '../../core/services/auth/auth.service';
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
