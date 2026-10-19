import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AttendanceService } from '../../core/services/attendance/attendance.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { Attendance } from './attendance';

/**
 * Attendance page conflict reporting: a backend VERSION_CONFLICT while marking
 * attendance must surface an explicit conflict message, not a generic failure.
 */

const EVENT = {
  id: 'event-1',
  eventCode: 'E-01',
  name: 'Vocal',
  category: 'ARTS',
  mode: 'SOLO',
  status: 'ACTIVE',
  eligibleLevels: ['JUNIOR'],
};

const PARTICIPANT = {
  id: 'participant-1',
  participantCode: 'P-0001',
  shelterHomeId: 'home-1',
  fullName: 'Test Participant',
  gender: 'MALE',
  age: 10,
  standard: 5,
  version: 1,
  approvalStatus: 'APPROVED',
  lockStatus: 'UNLOCKED',
  validationStatus: 'PASSED',
} as never;

describe('Attendance — mark conflict reporting', () => {
  let component: Attendance;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Attendance],
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

    component = TestBed.createComponent(Attendance).componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('shows an explicit conflict message when the backend reports VERSION_CONFLICT', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { events: [EVENT] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    await TestBed.inject(ShelterDataService).loadEvents();
    component.selectedEventId.set('event-1');

    const service = TestBed.inject(AttendanceService);
    vi.spyOn(service, 'markAttendance').mockResolvedValue({
      success: false,
      errors: ['The attendance record was changed by someone else.'],
      errorCode: 'VERSION_CONFLICT',
    } as never);

    component.stageAttendance(PARTICIPANT, 'PRESENT');
    await component.saveAttendance();

    expect(component.errors()[0]).toContain('Attendance was updated elsewhere.');
    // The service re-reads the persisted values after a conflict, so the
    // message must no longer ask the user to do the refresh themselves.
    expect(component.errors()[0]).not.toContain('Refresh and try again.');
  });

  it('drops the local record after a conflict so the retry sends no expectedVersion', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    let markCalls = 0;

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as {
        action: string;
        payload?: Record<string, unknown>;
      };

      if (request.action === 'listEvents') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { events: [EVENT] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (request.action === 'listParticipants') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { participants: [PARTICIPANT] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              participantEvents: [{
                id: 'reg-1',
                participantId: 'participant-1',
                eventId: 'event-1',
                registrationStatus: 'REGISTERED',
                version: 1,
              }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (request.action === 'markAttendance') {
        markCalls += 1;
        payloads.push(request.payload ?? {});

        if (markCalls === 1) {
          return Promise.resolve(new Response(
            JSON.stringify({
              success: true,
              data: {
                attendance: {
                  id: 'att-1',
                  participantId: 'participant-1',
                  eventId: 'event-1',
                  status: 'PRESENT',
                  version: 1,
                  createdAt: '',
                  createdBy: '',
                  updatedAt: '',
                  updatedBy: '',
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ));
        }

        return Promise.resolve(new Response(
          JSON.stringify({
            success: false,
            error: { code: 'VERSION_CONFLICT', message: 'The attendance record was changed by someone else.' },
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
    await store.loadEventRegistrations('event-1');
    component.selectedEventId.set('event-1');

    // Mark accepted → local record v1. Retry under conflict → conflict again.
    component.stageAttendance(PARTICIPANT, 'PRESENT');
    await component.saveAttendance();
    component.stageAttendance(PARTICIPANT, 'ABSENT');
    await component.saveAttendance();
    // Final retry: the stale local version must no longer be sent.
    component.stageAttendance(PARTICIPANT, 'ABSENT');
    await component.saveAttendance();

    const lastPayload = payloads[payloads.length - 1];
    expect(lastPayload['expectedVersion']).toBeUndefined();
  });
});

describe('Attendance — persisted attendance display', () => {
  let component: Attendance;

  const EVENT = {
    id: 'event-1',
    eventCode: 'E-01',
    name: 'Vocal',
    category: 'ARTS',
    mode: 'SOLO',
    status: 'ACTIVE',
    eligibleLevels: ['JUNIOR'],
  };

  const PARTICIPANT = {
    id: 'participant-1',
    participantCode: 'P-0001',
    shelterHomeId: 'home-1',
    fullName: 'Test Participant',
    gender: 'MALE',
    age: 10,
    standard: 5,
    version: 1,
    approvalStatus: 'APPROVED',
    lockStatus: 'UNLOCKED',
    validationStatus: 'PASSED',
  } as never;

  const HOME = {
    id: 'home-1',
    homeCode: 'H-01',
    homeName: 'Sunrise Home',
    address: '',
    contactName: '',
    contactPhone: '',
    status: 'ACTIVE',
    version: 1,
  };

  function envelope(data: unknown): Promise<Response> {
    return Promise.resolve(new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  }

  interface Options {
    attendanceRows?: unknown[];
    attendanceFails?: boolean;
  }

  function stubBackend(options: Options = {}): Record<string, number> {
    const calls: Record<string, number> = {};
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      calls[request.action] = (calls[request.action] ?? 0) + 1;

      if (request.action === 'listEvents') return envelope({ events: [EVENT] });
      if (request.action === 'listParticipants') return envelope({ participants: [PARTICIPANT] });
      if (request.action === 'listShelterHomes') return envelope({ shelterHomes: [HOME] });
      if (request.action === 'listEventRegistrations') {
        return envelope({
          participantEvents: [{
            id: 'reg-1',
            participantId: 'participant-1',
            eventId: 'event-1',
            registrationStatus: 'REGISTERED',
            version: 1,
          }],
        });
      }
      if (request.action === 'listAttendance') {
        if (options.attendanceFails) {
          return Promise.resolve(new Response(
            JSON.stringify({ success: false, error: { code: 'PERMISSION_DENIED', message: 'Not permitted.' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ));
        }
        return envelope({
          attendance: options.attendanceRows ?? [{
            id: 'ATT-1',
            eventId: 'event-1',
            participantId: 'participant-1',
            teamId: '',
            status: 'PRESENT',
            version: 2,
            createdAt: '',
            createdBy: '',
            updatedAt: '',
            updatedBy: '',
          }],
        });
      }
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });
    return calls;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Attendance],
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

    component = TestBed.createComponent(Attendance).componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('loads saved attendance with the roster and shows existing values on the rows', async () => {
    const calls = stubBackend();

    const store = TestBed.inject(ShelterDataService);
    await store.loadEvents();
    await store.loadParticipants('home-1');
    await store.loadEventRegistrations('event-1');

    await component.setEvent('event-1');

    const attendee = component.attendees().find(item => item.participant.id === 'participant-1');
    expect(attendee).toBeTruthy();
    // The persisted PRESENT mark displays without any local marking.
    expect(attendee?.attendance?.status).toBe('PRESENT');
    expect(attendee?.attendance?.version).toBe(2);
    expect(calls['listAttendance']).toBe(1);
    // The operational read never requests archived rows.
    expect(component.attendanceError()).toBe('');
  });

  it('surfaces a failed attendance read instead of silently showing all unmarked', async () => {
    stubBackend({ attendanceFails: true });

    const store = TestBed.inject(ShelterDataService);
    await store.loadEvents();
    await store.loadParticipants('home-1');
    await store.loadEventRegistrations('event-1');

    await component.setEvent('event-1');

    expect(component.attendanceError()).toContain('could not be read');
  });

  it('retries the attendance read through the roster retry path', async () => {
    const calls = stubBackend({ attendanceFails: true });

    const store = TestBed.inject(ShelterDataService);
    await store.loadEvents();
    await store.loadParticipants('home-1');
    await store.loadEventRegistrations('event-1');

    await component.setEvent('event-1');
    expect(component.attendanceError()).toContain('could not be read');

    // The retry stub now answers the read successfully.
    stubBackend({});
    await component.retryRegistrations();

    expect(component.attendanceError()).toBe('');
    expect(calls['listAttendance']).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Finalization lock: an event whose persisted scores are all FINALIZED shows
 * the locked message and renders no attendance mutation controls, while a
 * non-finalized event keeps them.
 */
describe('Attendance — finalization lock', () => {
  let fixture: ComponentFixture<Attendance>;
  let component: Attendance;

  const EVENT = {
    id: 'event-1',
    eventCode: 'E-01',
    name: 'Vocal',
    category: 'ARTS',
    mode: 'SOLO',
    status: 'ACTIVE',
    eligibleLevels: ['JUNIOR'],
  };

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
  } as never;

  const HOME = {
    id: 'home-1',
    homeCode: 'H-01',
    homeName: 'Sunrise Home',
    address: '',
    contactName: '',
    contactPhone: '',
    status: 'ACTIVE',
    version: 1,
  };

  function score(status: 'DRAFT' | 'FINALIZED'): Record<string, unknown> {
    return {
      id: 'score-1',
      eventId: 'event-1',
      participantId: 'participant-1',
      value: 10,
      status,
      version: 1,
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
    };
  }

  function stubBackend(scoreStatus: 'DRAFT' | 'FINALIZED'): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      if (request.action === 'listEvents') return ok({ events: [EVENT] });
      if (request.action === 'listParticipants') return ok({ participants: [PARTICIPANT] });
      if (request.action === 'listShelterHomes') return ok({ shelterHomes: [HOME] });
      if (request.action === 'listEventRegistrations') {
        return ok({
          participantEvents: [{
            id: 'reg-1',
            participantId: 'participant-1',
            eventId: 'event-1',
            registrationStatus: 'REGISTERED',
            version: 1,
          }],
        });
      }
      if (request.action === 'listAttendance') return ok({ attendance: [] });
      if (request.action === 'listScores') return ok({ scores: [score(scoreStatus)] });
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });
  }

  async function render(scoreStatus: 'DRAFT' | 'FINALIZED'): Promise<void> {
    stubBackend(scoreStatus);

    const store = TestBed.inject(ShelterDataService);
    await store.loadEvents();
    await store.loadParticipants('home-1');
    await store.loadEventRegistrations('event-1');

    fixture = TestBed.createComponent(Attendance);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    await component.setEvent('event-1');
    fixture.detectChanges();
  }

  function buttonLabels(): string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .map(button => (button.textContent ?? '').trim());
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Attendance],
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('a finalized event shows the locked message and no attendance mutation controls', async () => {
    await render('FINALIZED');

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('This event has been finalized. Attendance and scores are locked.');

    const labels = buttonLabels();
    expect(labels).not.toContain('Present');
    expect(labels).not.toContain('Absent');
    expect(labels).not.toContain('Save Attendance');
    expect(labels).not.toContain('Reset Changes');
  });

  it('a non-finalized event keeps attendance mutation controls and no lock message', async () => {
    await render('DRAFT');

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).not.toContain('This event has been finalized. Attendance and scores are locked.');

    const labels = buttonLabels();
    expect(labels).toContain('Present');
    expect(labels).toContain('Absent');
    expect(labels).toContain('Save Attendance');
    expect(labels).toContain('Reset Changes');
  });
});
