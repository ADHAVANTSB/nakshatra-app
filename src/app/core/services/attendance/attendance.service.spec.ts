import { TestBed } from '@angular/core/testing';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AttendanceService } from './attendance.service';
import { AuthService } from '../auth/auth.service';
import { ShelterDataService } from '../shelter-homes/shelter-data.service';

/**
 * Attendance read tests: the backend's `listAttendance` action is the only
 * source of persisted marks. Existing values must display on load, concurrent
 * reads must be deduplicated, and a forced re-read must genuinely re-request.
 */

const EVENT_ID = 'event-1';

/** A row exactly as buildAttendanceObject returns it (Code.gs 15895+). */
function backendRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ATT-1',
    eventId: EVENT_ID,
    participantId: 'participant-1',
    teamId: '',
    status: 'PRESENT',
    markedAt: '2026-01-01T00:00:00.000Z',
    markedBy: 'user-1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'user-1',
    eventName: 'Vocal',
    fullName: 'Test Participant',
    shelterHomeId: 'home-1',
    shelterHomeName: 'Sunrise Home',
    ...overrides,
  };
}

function attendanceResponse(rows: Record<string, unknown>[]): Promise<Response> {
  return Promise.resolve(new Response(
    JSON.stringify({ success: true, data: { attendance: rows } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
}

describe('AttendanceService — persisted attendance reads', () => {
  let service: AttendanceService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({}).compileComponents();

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

    service = TestBed.inject(AttendanceService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('loads persisted attendance and exposes it by participant and event', async () => {
    vi.stubGlobal('fetch', () => attendanceResponse([backendRow()]));

    const ok = await service.loadEventAttendance(EVENT_ID);

    expect(ok).toBe(true);
    const record = service.getByParticipantEvent('participant-1', EVENT_ID);
    expect(record?.status).toBe('PRESENT');
    expect(record?.version).toBe(1);
    expect(service.getByEvent(EVENT_ID)).toHaveLength(1);
  });

  it('deduplicates concurrent reads for the same event into one request', async () => {
    let listCalls = 0;
    vi.stubGlobal('fetch', () => {
      listCalls += 1;
      return attendanceResponse([backendRow()]);
    });

    const [first, second] = await Promise.all([
      service.loadEventAttendance(EVENT_ID),
      service.loadEventAttendance(EVENT_ID),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(listCalls).toBe(1);
    // A settled load is not re-requested without force.
    await service.loadEventAttendance(EVENT_ID);
    expect(listCalls).toBe(1);
  });

  it('re-reads for real when forced, replacing the stored records', async () => {
    let listCalls = 0;
    vi.stubGlobal('fetch', () => {
      listCalls += 1;
      return listCalls === 1
        ? attendanceResponse([backendRow()])
        : attendanceResponse([backendRow({ status: 'ABSENT', version: 2 })]);
    });

    await service.loadEventAttendance(EVENT_ID);
    expect(service.getByParticipantEvent('participant-1', EVENT_ID)?.status).toBe('PRESENT');

    const ok = await service.loadEventAttendance(EVENT_ID, true);

    expect(ok).toBe(true);
    expect(listCalls).toBe(2);
    expect(service.getByParticipantEvent('participant-1', EVENT_ID)?.status).toBe('ABSENT');
    expect(service.getByParticipantEvent('participant-1', EVENT_ID)?.version).toBe(2);
  });

  it('reports a failed read honestly and keeps already-visible records', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code: 'PERMISSION_DENIED', message: 'Not permitted.' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const ok = await service.loadEventAttendance(EVENT_ID);

    expect(ok).toBe(false);
    expect(service.getByEvent(EVENT_ID)).toHaveLength(0);
  });

  it('forces a fresh read when a mark hits VERSION_CONFLICT', async () => {
    let listCalls = 0;
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listAttendance') {
        listCalls += 1;
        return attendanceResponse([backendRow({ version: listCalls + 1 })]);
      }
      if (request.action === 'markAttendance') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: false,
            error: { code: 'VERSION_CONFLICT', message: 'The attendance record was changed by someone else.' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      // Seed the caches markAttendance validates against.
      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: { events: [{ id: EVENT_ID, eventCode: 'E-01', name: 'Vocal', category: 'ARTS', mode: 'SOLO', status: 'ACTIVE', eligibleLevels: ['JUNIOR'] }] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (request.action === 'listParticipants') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: { participants: [{ id: 'participant-1', participantCode: 'P-0001', shelterHomeId: 'home-1', fullName: 'Test Participant', gender: 'MALE', age: 10, standard: 5, version: 1, approvalStatus: 'APPROVED', lockStatus: 'UNLOCKED', validationStatus: 'PASSED' }] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: { participantEvents: [{ id: 'reg-1', participantId: 'participant-1', eventId: EVENT_ID, registrationStatus: 'REGISTERED', version: 1 }] },
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
    await store.loadEvents();
    await store.loadParticipants('home-1');
    await store.loadEventRegistrations(EVENT_ID);

    await service.loadEventAttendance(EVENT_ID);
    expect(listCalls).toBe(1);

    const result = await service.markAttendance('participant-1', EVENT_ID, 'ABSENT');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('VERSION_CONFLICT');
    // The stale record was dropped AND a forced re-read brought the backend
    // state back, so the displayed values are current.
    expect(listCalls).toBe(2);
    expect(service.getByParticipantEvent('participant-1', EVENT_ID)?.status).toBe('PRESENT');
  });
});
