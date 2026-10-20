import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../auth/auth.service';
import { ShelterDataService } from '../shelter-homes/shelter-data.service';
import { EventService } from './event.service';
import { ParticipantEventService } from './participant-event.service';

/**
 * Count-helper tests: category and solo counts must fall back to the
 * registration row's own denormalized `category`/`mode` when the event is not
 * in the cached master (e.g. a row whose event the catalogue no longer
 * returns). Backend rows are always the data source; nothing is inferred.
 */

const REGISTRATION_ROW = {
  id: 'reg-1',
  participantId: 'participant-1',
  eventId: 'event-ghost',
  registrationStatus: 'REGISTERED',
  category: 'CULTURAL',
  mode: 'SOLO',
  version: 1,
};

describe('ParticipantEventService — count helpers', () => {
  let service: ParticipantEventService;
  let store: ShelterDataService;

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

    service = TestBed.inject(ParticipantEventService);
    store = TestBed.inject(ShelterDataService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('counts a registered row by its own category/mode when the event master lacks the event', async () => {
    // The event master is never loaded: 'event-ghost' is unknown to it.
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      if (request.action === 'listParticipantEvents') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { participantEvents: [REGISTRATION_ROW] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    await store.loadParticipantEvents('participant-1');

    expect(service.getParticipantEventCount('participant-1')).toBe(1);
    expect(service.getParticipantCategoryCount('participant-1', 'CULTURAL')).toBe(1);
    expect(service.getParticipantIndividualCount('participant-1')).toBe(1);
  });
});

const SUMMARY_ENTRY_BACKEND = {
  participantId: 'participant-1',
  participantCode: 'P-001',
  fullName: 'Ana Lopez',
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

function summariesEnvelope(summaries: unknown[], issues: unknown[] = []): Response {
  return new Response(
    JSON.stringify({ success: true, data: { summaries, issues } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('ParticipantEventService � batch event summaries', () => {
  let service: ParticipantEventService;

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

    service = TestBed.inject(ParticipantEventService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('loads summaries with exactly one request per home, merged by participantId', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };

      if (request.action === 'getParticipantEventSummaries') {
        payloads.push(request.payload ?? {});
        return Promise.resolve(summariesEnvelope([SUMMARY_ENTRY_BACKEND]));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    const ok = await service.loadSummariesForHomes(['home-1', 'home-2']);

    expect(ok).toBe(true);
    expect(payloads.length).toBe(2);
    expect(payloads[0]['shelterHomeId']).toBe('home-1');
    expect(payloads[1]['shelterHomeId']).toBe('home-2');

    const entry = service.summaryFor('participant-1');
    expect(entry?.activeEventCount).toBe(2);
    expect(entry?.events.map(event => event.eventName)).toEqual(['Clay Modelling', 'Group Dance']);
    expect(entry?.artsCount).toBe(1);
    expect(entry?.soloCount).toBe(1);
  });

  it('does not re-request loaded homes on re-navigation; force re-fires them', async () => {
    let summaryCalls = 0;
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      if (request.action === 'getParticipantEventSummaries') {
        summaryCalls += 1;
        return Promise.resolve(summariesEnvelope([SUMMARY_ENTRY_BACKEND]));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    await service.loadSummariesForHomes(['home-1']);
    await service.loadSummariesForHomes(['home-1']);
    expect(summaryCalls).toBe(1);

    await service.loadSummariesForHomes(['home-1'], true);
    expect(summaryCalls).toBe(2);
  });

  it('surfaces backend duplicate and missing-reference issues per participant', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };

      if (request.action === 'getParticipantEventSummaries') {
        return Promise.resolve(summariesEnvelope(
          [SUMMARY_ENTRY_BACKEND],
          [
            { code: 'DUPLICATE_REGISTRATION_ROWS', participantId: 'participant-1', eventId: 'event-1', count: 2 },
            { code: 'EVENT_REFERENCE_NOT_FOUND', participantId: 'participant-1', eventId: 'event-x', count: 1 },
          ],
        ));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    await service.loadSummariesForHomes(['home-1']);

    const issues = service.issuesFor('participant-1');
    expect(issues.map(issue => issue.code).sort()).toEqual([
      'DUPLICATE_REGISTRATION_ROWS',
      'EVENT_REFERENCE_NOT_FOUND',
    ]);
  });

  it('a failed home read reports failure, skips it, and a retry recovers it', async () => {
    let failHome2 = true;
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };

      if (request.action === 'getParticipantEventSummaries') {
        if (request.payload?.['shelterHomeId'] === 'home-2' && failHome2) {
          return Promise.resolve(new Response(
            JSON.stringify({ success: false, error: { code: 'BACKEND_ERROR', message: 'The summaries read failed.' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ));
        }
        return Promise.resolve(summariesEnvelope([SUMMARY_ENTRY_BACKEND]));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    const first = await service.loadSummariesForHomes(['home-1', 'home-2']);
    expect(first).toBe(false);
    // home-1's data is still usable; home-2 stays unloaded.
    expect(service.summaryFor('participant-1')).not.toBeNull();

    failHome2 = false;
    const retry = await service.loadSummariesForHomes(['home-2'], true);
    expect(retry).toBe(true);
  });
});

/**
 * Event-day registration (check-in for the overall event day).
 *
 * Competition registration requires BOTH a LOCKED home sheet and the
 * event-day check-in; the frontend validation mirrors the backend gate and
 * the check-in itself is an idempotent backend upsert.
 */
describe('ParticipantEventService — event-day registration (check-in)', () => {
  let service: ParticipantEventService;
  let store: ShelterDataService;

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

  const EVENT = {
    id: 'event-1',
    eventCode: 'ART-101',
    name: 'Painting',
    category: 'ARTS',
    mode: 'SOLO',
    eligibleLevels: ['SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR'],
    minimumTeamSize: null,
    maximumTeamSize: null,
    status: 'ACTIVE',
    schedule: '',
    venue: '',
    createdAt: '',
    updatedAt: '',
    programId: '',
    environmentId: '',
  };

  const CHECKED_IN_ENTRY = {
    participantId: 'participant-1',
    participantCode: 'P-0001',
    fullName: 'Test Participant',
    level: 'JUNIOR',
    shelterHomeId: 'home-1',
    homeName: 'Sunrise Home',
    homeSheetStatus: 'LOCKED',
    checkInStatus: 'CHECKED_IN',
    checkedInAt: '2026-01-01T00:00:00.000Z',
    checkedInBy: 'spec-user',
    version: 2,
  };

  const NOT_REGISTERED_ENTRY = { ...CHECKED_IN_ENTRY, checkInStatus: 'NOT_REGISTERED', version: 0 };

  const RECORD = {
    id: 'EDR-1',
    participantId: 'participant-1',
    shelterHomeId: 'home-1',
    status: 'CHECKED_IN',
    checkedInAt: '2026-01-02T00:00:00.000Z',
    checkedInBy: 'spec-user',
    version: 1,
  };

  interface StubOptions {
    sheetStatus: string;
    entries: unknown[];
    markError?: { code: string; message: string };
  }

  function stubBackend(options: StubOptions): { payloads: Record<string, unknown>[]; calls: Record<string, number> } {
    const captured = { payloads: [] as Record<string, unknown>[], calls: {} as Record<string, number> };

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      captured.calls[request.action] = (captured.calls[request.action] ?? 0) + 1;
      if (request.payload) captured.payloads.push(request.payload);

      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'getPageData':
          return ok({
            shelterHomes: [{ id: 'home-1', homeCode: 'H-01', homeName: 'Sunrise Home', status: 'ACTIVE', version: 1, sheetStatus: options.sheetStatus }],
            participants: [PARTICIPANT],
            events: [],
            imports: [],
            validationResults: [],
          });
        case 'listEvents':
          return ok({ events: [EVENT] });
        case 'listEventDayRegistrations':
          return ok({ eventDayRegistrations: options.entries });
        case 'markEventDayRegistration':
          if (options.markError) {
            return Promise.resolve(new Response(
              JSON.stringify({ success: false, error: options.markError }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ));
          }
          // The backend persisted the check-in: the refreshed queue read
          // must now report the participant as CHECKED_IN.
          options.entries = [CHECKED_IN_ENTRY];
          return ok({ eventDayRegistration: RECORD });
        default:
          return ok({});
      }
    });

    return captured;
  }

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

    service = TestBed.inject(ParticipantEventService);
    store = TestBed.inject(ShelterDataService);
  });

  /** Boots the event master and the shared store against the stub. */
  async function boot(): Promise<void> {
    await TestBed.inject(EventService).load();
    await store.ensureLoaded();
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('refuses competition registration while the home sheet is not locked', async () => {
    stubBackend({ sheetStatus: 'NOT_CONFIRMED', entries: [] });
    await boot();

    const validation = service.validateRegistration('participant-1', 'event-1');

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'Confirm and lock this home’s sheet before registering its participants for the event day.'
    );
    expect(service.isRegistrableForEvents('participant-1')).toBe(false);
  });

  it('refuses competition registration until the event-day check-in is done', async () => {
    stubBackend({ sheetStatus: 'LOCKED', entries: [] });
    await boot();
    await service.loadEventDayRegistrations(undefined, true);

    const validation = service.validateRegistration('participant-1', 'event-1');

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'Check this participant in for the event day before registering them for a competition.'
    );
    expect(service.isHomeSheetLocked('home-1')).toBe(true);
    expect(service.isRegistrableForEvents('participant-1')).toBe(false);
  });

  it('allows competition registration once the sheet is locked and the check-in is done', async () => {
    stubBackend({ sheetStatus: 'LOCKED', entries: [CHECKED_IN_ENTRY] });
    await boot();
    await service.loadEventDayRegistrations(undefined, true);

    const validation = service.validateRegistration('participant-1', 'event-1');

    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(service.isCheckedInForEventDay('participant-1')).toBe(true);
    expect(service.isRegistrableForEvents('participant-1')).toBe(true);
  });

  it('saves the check-in through the backend and refreshes the queue', async () => {
    const captured = stubBackend({ sheetStatus: 'LOCKED', entries: [NOT_REGISTERED_ENTRY] });
    await boot();
    await service.loadEventDayRegistrations(undefined, true);

    const result = await service.markEventDayRegistration('participant-1', 'home-1');

    expect(result.success).toBe(true);
    expect(captured.payloads.some(payload =>
      payload['participantId'] === 'participant-1' &&
      payload['shelterHomeId'] === 'home-1' &&
      payload['status'] === 'CHECKED_IN' &&
      payload['expectedVersion'] === 0
    )).toBe(true);
    // The queue is re-read after the write so the UI shows persisted state.
    expect(captured.calls['listEventDayRegistrations']).toBeGreaterThanOrEqual(2);
    expect(service.isCheckedInForEventDay('participant-1')).toBe(true);
  });

  it('reports the backend failure when the check-in is refused', async () => {
    stubBackend({
      sheetStatus: 'LOCKED',
      entries: [NOT_REGISTERED_ENTRY],
      markError: {
        code: 'HOME_SHEET_NOT_LOCKED',
        message: 'Confirm and lock this home’s sheet before registering its participants for the event day.',
      },
    });
    await boot();
    await service.loadEventDayRegistrations(undefined, true);

    const result = await service.markEventDayRegistration('participant-1', 'home-1');

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Confirm and lock');
  });
});
