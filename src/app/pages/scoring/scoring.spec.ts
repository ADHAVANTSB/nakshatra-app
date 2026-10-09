import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ScoringService } from '../../core/services/scoring/scoring.service';
import { Scoring } from './scoring';

/** A minimal backend-validated event used by the group deep-link test. */
const EVENT_FIXTURE = {
  id: 'event-1',
  eventCode: 'E-01',
  name: 'Group Song',
  category: 'ARTS',
  mode: 'SOLO',
  status: 'ACTIVE',
  eligibleLevels: ['JUNIOR'],
};

/**
 * Scoring page state tests: a failed registrations read must offer a working
 * Retry, and a backend version conflict must be reported as a conflict, not a
 * generic failure. The component is created without change detection so
 * `ngOnInit` never starts a load.
 */

describe('Scoring — registrations retry and conflict reporting', () => {
  let component: Scoring;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Scoring],
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

    component = TestBed.createComponent(Scoring).componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  function registrationEnvelope(ok: boolean): Response {
    return new Response(
      JSON.stringify(ok
        ? { success: true, data: { participantEvents: [] } }
        : { success: false, error: { code: 'BACKEND_ERROR', message: 'Registrations unavailable' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('re-issues the registrations read when the retry control is used', async () => {
    let listingWorks = false;
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(registrationEnvelope(listingWorks));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    component.selectedEventId.set('event-1');

    await component.loadRegistrations('event-1');
    expect(component.registrationsState()).toBe('FAILED');

    listingWorks = true;
    await component.retryRegistrations();

    expect(component.registrationsState()).toBe('LOADED');
    expect(component.registrationError()).toBe('');
  });

  it('reports a backend version conflict as a conflict, preserving the typed value path', () => {
    const notify = TestBed.inject(NotificationService);
    const warningSpy = vi.spyOn(notify, 'warning');
    const errorSpy = vi.spyOn(notify, 'error');

    const report = (component as unknown as {
      report: (result: unknown, action: string, target: unknown) => void;
    }).report;

    report.call(component,
      { success: false, errorCode: 'VERSION_CONFLICT', errors: ['Version conflict detected'] },
      'SAVE',
      { key: 'participant-1', participant: { id: 'participant-1', fullName: 'Ana' } },
    );

    const messages = [...warningSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(messages).toContain('updated elsewhere');
    expect(messages).toContain('Refresh');
  });

  it('re-reads the persisted scores after a version conflict so the next save can succeed', () => {
    component.selectedEventId.set('event-1');

    const scoringService = TestBed.inject(ScoringService);
    const loadSpy = vi.spyOn(scoringService, 'loadScores').mockResolvedValue(true);

    const report = (component as unknown as {
      report: (result: unknown, action: string, target: unknown) => void;
    }).report;

    report.call(component,
      { success: false, errorCode: 'VERSION_CONFLICT', errors: ['Version conflict detected'] },
      'SAVE',
      { key: 'participant-1', participant: { id: 'participant-1', fullName: 'Ana' } },
    );

    expect(loadSpy).toHaveBeenCalledWith('event-1', true);
  });

  it('loads the event master before resolving group teams on a cold deep link', async () => {
    const calls: Record<string, number> = {};
    const groupEvent = { ...EVENT_FIXTURE, mode: 'GROUP' };

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      calls[request.action] = (calls[request.action] ?? 0) + 1;

      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { events: [groupEvent] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { participantEvents: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (request.action === 'listTeams') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { teams: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (request.action === 'listScores') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { scores: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    await component.loadEvent('event-1');

    expect(calls['listTeams']).toBe(1);
  });
});
