import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../auth/auth.service';
import { ShelterDataService } from './shelter-data.service';

/**
 * Store-economy tests.
 *
 * The shared backend store must collapse concurrent identical reads into one
 * request and must not re-fire its full load fan-out when a page navigates in
 * with data already loaded. Real ApiClientService is used; the network is
 * stubbed at `fetch` with per-action envelopes and per-action call counts.
 */

type Routes = Record<string, unknown>;

const EVENT = {
  id: 'event-1',
  eventCode: 'E-01',
  name: 'Group Song',
  category: 'ARTS',
  mode: 'GROUP',
  status: 'ACTIVE',
  eligibleLevels: ['JUNIOR'],
};

const REGISTRATION = {
  id: 'reg-1',
  participantId: 'participant-1',
  eventId: 'event-1',
  registrationStatus: 'REGISTERED',
  version: 1,
};

const PARTICIPANT = {
  id: 'participant-1',
  shelterHomeId: 'home-1',
  fullName: 'Test Participant',
  version: 1,
};

const HOME = {
  id: 'home-1',
  homeCode: 'H-01',
  homeName: 'Test Home',
};

let calls: Record<string, number> = {};

function stubBackend(routes: Routes): void {
  vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
    const action = (JSON.parse(init.body) as { action: string }).action;
    calls[action] = (calls[action] ?? 0) + 1;

    if (!(action in routes)) {
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: `No stub for ${action}` } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    }

    return Promise.resolve(new Response(
      JSON.stringify({ success: true, data: routes[action] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  });
}

function clearCalls(): void {
  calls = {};
}

describe('ShelterDataService', () => {
  let service: ShelterDataService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([])],
    }).compileComponents();

    // The api client refuses to send requests without an active session.
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

    service = TestBed.inject(ShelterDataService);
    clearCalls();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
    TestBed.resetTestingModule();
  });

  it('collapses two concurrent loadEventRegistrations calls into one request', async () => {
    stubBackend({ listEventRegistrations: { participantEvents: [REGISTRATION] } });

    const [a, b] = await Promise.all([
      service.loadEventRegistrations('event-1'),
      service.loadEventRegistrations('event-1'),
    ]);

    expect(calls['listEventRegistrations']).toBe(1);
    expect(a).toEqual([REGISTRATION]);
    expect(b).toEqual([REGISTRATION]);
  });

  it('collapses two concurrent loadParticipants calls into one request', async () => {
    stubBackend({ listParticipants: { participants: [PARTICIPANT] } });

    const [a, b] = await Promise.all([
      service.loadParticipants('home-1'),
      service.loadParticipants('home-1'),
    ]);

    expect(calls['listParticipants']).toBe(1);
    expect(a).toEqual([PARTICIPANT]);
    expect(b).toEqual([PARTICIPANT]);
  });

  it('ensureLoaded does not refire the full fan-out when the store is already loaded', async () => {
    stubBackend({
      listShelterHomes: { shelterHomes: [HOME] },
      listEvents: { events: [EVENT] },
      getImportStatus: { imports: [] },
      getValidationResults: { validationResults: [] },
      listParticipants: { participants: [PARTICIPANT] },
    });

    await service.refresh();
    expect(service.loaded()).toBe(true);

    clearCalls();
    const result = await service.ensureLoaded();

    expect(result.success).toBe(true);
    expect(Object.keys(calls)).toEqual([]);
  });

  it('ensureLoaded performs the full load on first use', async () => {
    stubBackend({
      listShelterHomes: { shelterHomes: [HOME] },
      listEvents: { events: [EVENT] },
      getImportStatus: { imports: [] },
      getValidationResults: { validationResults: [] },
      listParticipants: { participants: [PARTICIPANT] },
    });

    const result = await service.ensureLoaded();

    expect(result.success).toBe(true);
    expect(service.loaded()).toBe(true);
    expect(calls['listShelterHomes']).toBe(1);
  });

  it('loadEvents reuses the cached catalogue; only force re-reads', async () => {
    stubBackend({ listEvents: { events: [EVENT] } });

    await service.loadEvents();
    await service.loadEvents();

    expect(calls['listEvents']).toBe(1);

    await service.loadEvents(true);

    expect(calls['listEvents']).toBe(2);
    expect(service.eventsLoaded()).toBe(true);
  });

  it('ensureLoaded re-fires the full load after a failed load so navigation can recover', async () => {
    // Nothing is stubbed: every action returns the failure envelope.
    stubBackend({});

    const failed = await service.ensureLoaded();
    expect(failed.success).toBe(false);

    stubBackend({
      listShelterHomes: { shelterHomes: [HOME] },
      listEvents: { events: [EVENT] },
      getImportStatus: { imports: [] },
      getValidationResults: { validationResults: [] },
      listParticipants: { participants: [PARTICIPANT] },
    });
    clearCalls();

    const recovered = await service.ensureLoaded();

    expect(recovered.success).toBe(true);
    expect(calls['listShelterHomes']).toBe(1);
  });

  it('a forced read queued behind an in-flight read resolves with the fresh rows', async () => {
    let registrationCalls = 0;
    let releaseFirst!: (value: Response) => void;
    const firstGate = new Promise<Response>(resolve => {
      releaseFirst = resolve;
    });

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      if (request.action === 'listEventRegistrations') {
        registrationCalls += 1;

        if (registrationCalls === 1) {
          return firstGate;
        }

        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: { participantEvents: [{ ...REGISTRATION, participantId: 'participant-new' }] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    const first = service.loadEventRegistrations('event-1');
    const forced = service.loadEventRegistrations('event-1', true);

    releaseFirst(new Response(
      JSON.stringify({
        success: true,
        data: { participantEvents: [{ ...REGISTRATION, participantId: 'participant-old' }] },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await forced;

    const cached = await service.loadEventRegistrations('event-1');

    expect(cached?.[0]?.participantId).toBe('participant-new');
  });
});
