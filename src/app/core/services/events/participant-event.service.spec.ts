import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../auth/auth.service';
import { ShelterDataService } from '../shelter-homes/shelter-data.service';
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

describe('ParticipantEventService â€” count helpers', () => {
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

describe('ParticipantEventService — batch event summaries', () => {
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
