import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../auth/auth.service';
import { ProgramContextService } from '../program/program-context.service';
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

/** The single batched request that now assembles the whole page. */
const PAGE_DATA_ROUTES: Routes = {
  getPageData: {
    shelterHomes: [HOME],
    participants: [PARTICIPANT],
    imports: [],
    validationResults: [],
  },
  // loadAll also force-reloads the events catalogue (one shared request).
  listEvents: { events: [EVENT] },
};

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
    stubBackend(PAGE_DATA_ROUTES);

    await service.refresh();
    expect(service.loaded()).toBe(true);

    clearCalls();
    const result = await service.ensureLoaded();

    expect(result.success).toBe(true);
    expect(Object.keys(calls)).toEqual([]);
  });

  it('ensureLoaded performs the full load on first use', async () => {
    stubBackend(PAGE_DATA_ROUTES);

    const result = await service.ensureLoaded();

    expect(result.success).toBe(true);
    expect(service.loaded()).toBe(true);
    expect(calls['getPageData']).toBe(1);
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

  it('loadEvents keeps every backend record distinct - display labels never consolidate or re-identify', async () => {
    stubBackend({
      listEvents: {
        events: [
          { ...EVENT, id: 'EVT-0024', eventCode: 'ART-001-J', name: 'Clay Modelling', eligibleLevels: ['JUNIOR'] },
          { ...EVENT, id: 'EVT-0025', eventCode: 'ART-001-S', name: 'Clay Modelling', eligibleLevels: ['SENIOR'] },
          { ...EVENT, id: 'EVT-0004', eventCode: 'ART-004', name: 'Waste to wealth', eligibleLevels: ['SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR'] },
        ],
      },
    });

    await service.loadEvents();

    // Same-name siblings keep their own identity and show their level.
    expect(service.events().map(e => [e.id, e.eventCode, e.name])).toEqual([
      ['EVT-0024', 'ART-001-J', 'Clay Modelling — Junior (J)'],
      ['EVT-0025', 'ART-001-S', 'Clay Modelling — Senior (S)'],
      ['EVT-0004', 'ART-004', 'Waste to Wealth'],
    ]);
  });

  it('loadEvents surfaces the catalogue migration state from the same read', async () => {
    stubBackend({
      listEvents: {
        events: [EVENT],
        catalogueMigration: {
          pending: true,
          missingRecordCodes: ['ART-001-J'],
          levelBandPendingCodes: ['ART-001'],
          blockedRecordCodes: [],
        },
      },
    });

    await service.loadEvents();

    expect(service.catalogueMigration()).toEqual({
      pending: true,
      missingRecordCodes: ['ART-001-J'],
      levelBandPendingCodes: ['ART-001'],
      blockedRecordCodes: [],
    });

    stubBackend({ listEvents: { events: [EVENT] } });
    await service.loadEvents(true);

    expect(service.catalogueMigration()).toBeNull();
  });

  it('ensureLoaded re-fires the full load after a failed load so navigation can recover', async () => {
    // Nothing is stubbed: every action returns the failure envelope.
    stubBackend({});

    const failed = await service.ensureLoaded();
    expect(failed.success).toBe(false);

    stubBackend(PAGE_DATA_ROUTES);
    clearCalls();

    const recovered = await service.ensureLoaded();

    expect(recovered.success).toBe(true);
    expect(calls['getPageData']).toBe(1);
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

  it('refresh assembles the whole page with ONE getPageData request (no per-home fan-out)', async () => {
    stubBackend(PAGE_DATA_ROUTES);

    const result = await service.refresh();

    expect(result.success).toBe(true);
    expect(calls['getPageData']).toBe(1);
    // The former fan-out (listShelterHomes + listEvents + 3 x N homes) must
    // not reappear: none of those actions may be called here.
    expect(calls['listShelterHomes']).toBeUndefined();
    expect(calls['listParticipants']).toBeUndefined();
    expect(calls['getImportStatus']).toBeUndefined();
    expect(calls['getValidationResults']).toBeUndefined();
    // The stores are populated from the single response.
    expect(service.homes().length).toBe(1);
    expect(service.participants().length).toBe(1);
  });
});

/**
 * Zone-switch isolation: every cached collection belongs to exactly one
 * programme/zone scope. A switch drops it synchronously and in-flight
 * responses for the previous scope are discarded instead of repopulating
 * the store (the live-zone leakage regression test).
 */
describe('ShelterDataService · programme/zone scope isolation', () => {
  let service: ShelterDataService;
  let scope: ProgramContextService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
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

    service = TestBed.inject(ShelterDataService);
    scope = TestBed.inject(ProgramContextService);
    clearCalls();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
    TestBed.resetTestingModule();
  });

  it('a zone switch drops every cached collection and forces a scoped reload', async () => {
    stubBackend(PAGE_DATA_ROUTES);

    await service.refresh();
    expect(service.participants().length).toBe(1);
    expect(service.homes().length).toBe(1);
    expect(service.loaded()).toBe(true);

    scope.selectProgram('ARTS');
    scope.selectZone('ZONE_1');

    // Nothing from the previous scope survives the switch.
    expect(service.participants()).toEqual([]);
    expect(service.homes()).toEqual([]);
    expect(service.events()).toEqual([]);
    expect(service.registrations()).toEqual([]);
    expect(service.loaded()).toBe(false);
    expect(service.eventsLoaded()).toBe(false);

    // The next navigation re-reads from the backend for the new scope.
    stubBackend(PAGE_DATA_ROUTES);
    clearCalls();
    await service.ensureLoaded();

    expect(calls['getPageData']).toBe(1);
  });

  it('an in-flight read for the previous scope never lands after a zone switch', async () => {
    let releasePageData!: (value: Response) => void;
    const pageDataGate = new Promise<Response>(resolve => {
      releasePageData = resolve;
    });

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      if (request.action === 'getPageData') {
        return pageDataGate;
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: true, data: { events: [EVENT] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    const inFlight = service.refresh();

    // Rapid zone switching while the previous scope's read is still open.
    scope.selectProgram('ARTS');
    scope.selectZone('ZONE_1');

    releasePageData(new Response(
      JSON.stringify({
        success: true,
        data: {
          shelterHomes: [HOME],
          participants: [PARTICIPANT],
          imports: [],
          validationResults: [],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await inFlight;

    // The stale response was discarded: no old-zone row, no "loaded" state.
    expect(service.participants()).toEqual([]);
    expect(service.homes()).toEqual([]);
    expect(service.loaded()).toBe(false);
  });

  it('in-flight registrations of the previous scope are discarded on switch', async () => {
    let releaseRegs!: (value: Response) => void;
    const regsGate = new Promise<Response>(resolve => {
      releaseRegs = resolve;
    });

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      return request.action === 'listEventRegistrations'
        ? regsGate
        : Promise.resolve(new Response(
            JSON.stringify({ success: true, data: { events: [EVENT] } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ));
    });

    const inFlight = service.loadEventRegistrations('event-1');

    scope.selectProgram('SPORTS');
    scope.selectZone('ZONE_2');

    releaseRegs(new Response(
      JSON.stringify({ success: true, data: { participantEvents: [REGISTRATION] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await inFlight;

    expect(service.registrations()).toEqual([]);
  });
});
