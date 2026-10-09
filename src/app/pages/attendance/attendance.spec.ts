import { TestBed } from '@angular/core/testing';
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

    await component.markAttendance(PARTICIPANT, 'PRESENT');

    expect(component.errors()).toContain('Attendance was updated elsewhere. Refresh and try again.');
  });
});
