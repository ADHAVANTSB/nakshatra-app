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
