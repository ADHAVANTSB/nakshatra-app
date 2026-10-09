import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { Homes } from './homes';

/**
 * Homes page sync tests: a successful `syncShelterSheet` must refresh the
 * synced home's participant records through the backend read path (so the
 * card's participant count is never stale), and a failed sync must change
 * nothing and report the backend's own error.
 */

const HOME = {
  id: 'home-1',
  homeCode: 'H-01',
  homeName: 'Sunrise Home',
  currentImportVersionId: 'import-1',
};

describe('Homes — sync from Google Sheet', () => {
  let component: Homes;
  let calls: Record<string, number>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Homes],
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

    component = TestBed.createComponent(Homes).componentInstance;
    calls = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  function respond(action: string): unknown {
    switch (action) {
      case 'syncShelterSheet':
        return {
          shelterHomeId: 'home-1',
          shelterHomeName: 'Sunrise Home',
          spreadsheetName: 'Sunrise Participants',
          importVersionId: 'import-2',
          versionNumber: 2,
          status: 'COMPLETED',
        };
      case 'getImportStatus':
        return { imports: [] };
      case 'listShelterHomes':
        return { shelterHomes: [HOME] };
      case 'listParticipants':
        return {
          participants: [
            {
              id: 'participant-1',
              participantCode: 'P-0001',
              shelterHomeId: 'home-1',
              fullName: 'Synced Participant',
              gender: 'MALE',
              age: 10,
              standard: 5,
              version: 1,
              approvalStatus: 'APPROVED',
              lockStatus: 'UNLOCKED',
              validationStatus: 'PASSED',
            },
          ],
        };
      default:
        return undefined;
    }
  }

  function stubBackend(syncSucceeds: boolean): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      calls[request.action] = (calls[request.action] ?? 0) + 1;

      if (request.action === 'syncShelterSheet' && !syncSucceeds) {
        return Promise.resolve(new Response(
          JSON.stringify({ success: false, error: { code: 'SYNC_FAILED', message: 'The sheet could not be read.' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      const data = respond(request.action);

      if (data === undefined) {
        return Promise.resolve(new Response(
          JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });
  }

  it('re-reads the synced home participants after a confirmed sync', async () => {
    stubBackend(true);

    await component.syncFromSheet(HOME as never);

    expect(calls['syncShelterSheet']).toBe(1);
    expect(calls['listParticipants']).toBe(1);
    expect(component.syncingHomeId()).toBeNull();
  });

  it('leaves the store untouched on a failed sync and releases the busy state', async () => {
    stubBackend(false);

    await component.syncFromSheet(HOME as never);

    expect(calls['syncShelterSheet']).toBe(1);
    expect(calls['listParticipants']).toBeUndefined();
    expect(calls['getImportStatus']).toBeUndefined();
    expect(component.syncingHomeId()).toBeNull();
  });
});

