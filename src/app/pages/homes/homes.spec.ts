import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { SyncAllHomesService } from '../../core/services/imports/sync-all-homes.service';
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
  address: '',
  contactName: '',
  contactPhone: '',
  status: 'ACTIVE',
  version: 1,
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

  it('exposes the shared bulk-sync driver with admin gating', () => {
    expect(component.syncAll).toBeTruthy();
    expect(component.isAdmin()).toBe(true);
  });

  it('delegates the Sync All Homes start to the shared driver', async () => {
    const syncAll = TestBed.inject(SyncAllHomesService);
    const startSpy = vi.spyOn(syncAll, 'start').mockResolvedValue();

    await component.startSyncAll();

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves a home display name by id for bulk-sync results', () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'listShelterHomes') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: { shelterHomes: [HOME] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    return TestBed.inject(ShelterDataService).loadConnectedHomes().then(() => {
      expect(component.homeNameById('home-1')).toBe('Sunrise Home');
      // An unknown id renders as the raw id, never an invented name.
      expect(component.homeNameById('home-ghost')).toBe('home-ghost');
    });
  });
});


describe('Homes � shelter home archive lifecycle', () => {
  let component: Homes;
  let calls: Record<string, number>;
  let lastPayload: Record<string, unknown>;

  const ARCHIVED_IMPACT = {
    participantCount: 12,
    activeRegistrationCount: 30,
    attendanceCount: 45,
    scoreCount: 28,
    certificateCount: 3,
    auditHistoryCount: 57,
  };

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

    // Created without change detection: ngOnInit never runs.
    component = TestBed.createComponent(Homes).componentInstance;
    calls = {};
    lastPayload = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  function envelope(data: unknown): Promise<Response> {
    return Promise.resolve(new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  }

  function failure(code: string, message: string): Promise<Response> {
    return Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code, message } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  }

  function stubArchiveBackend(overrides: {
    previewFails?: boolean;
    archiveFails?: boolean;
    restoreTriggerReinstall?: boolean;
  } = {}): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      calls[request.action] = (calls[request.action] ?? 0) + 1;
      if (request.payload) {
        lastPayload[request.action] = request.payload;
      }

      switch (request.action) {
        case 'previewShelterHomeArchive':
          if (overrides.previewFails) {
            return failure('PREVIEW_FAILED', 'The archive preview failed.');
          }
          return envelope({
            shelterHome: { id: 'home-1', homeCode: 'H-01', homeName: 'Sunrise Home', status: 'ACTIVE' },
            source: { spreadsheetName: 'Sunrise Participants', sourceStatus: 'CONNECTED', spreadsheetOpenUrl: '' },
            impact: ARCHIVED_IMPACT,
            triggerCleanupRequired: false,
          });

        case 'archiveShelterHome':
          if (overrides.archiveFails) {
            return failure('ARCHIVE_FAILED', 'The archive could not be completed.');
          }
          return envelope({
            shelterHomeId: 'home-1',
            status: 'ARCHIVED',
            version: 2,
            triggerRemoved: true,
            impact: ARCHIVED_IMPACT,
          });

        case 'restoreShelterHome':
          return envelope({
            shelterHomeId: 'home-1',
            status: 'ACTIVE',
            version: 3,
            triggerReinstallRequired: overrides.restoreTriggerReinstall === true,
          });

        case 'listShelterHomes': {
          // After a successful archive the default (active) list no longer
          // contains the home; the includeArchived read shows both.
          const archived = calls['archiveShelterHome'] > 0 || overrides.restoreTriggerReinstall === undefined;
          void archived;
          const activeRows = lastPayload['archiveShelterHome'] && (calls['restoreShelterHome'] ?? 0) === 0
            ? []
            : [HOME];
          if (request.payload?.['includeArchived'] === true) {
            return envelope({
              shelterHomes: [
                ...activeRows,
                { ...HOME, id: 'home-2', homeCode: 'H-02', homeName: 'Archived Home', status: 'ARCHIVED', version: 4 },
              ],
            });
          }
          return envelope({ shelterHomes: activeRows });
        }

        case 'getImportStatus':
          return envelope({ imports: [] });

        case 'getValidationResults':
          return envelope({ validationResults: [] });

        case 'listParticipants':
          return envelope({ participants: [] });

        default:
          return failure('UNKNOWN_ACTION', request.action);
      }
    });
  }

  it('previews the real backend impact and never fires an archive before confirmation', async () => {
    stubArchiveBackend();

    await component.openArchivePreview(HOME);

    expect(calls['previewShelterHomeArchive']).toBe(1);
    expect(calls['archiveShelterHome']).toBeUndefined();

    const preview = component.archivePreview();
    expect(preview?.impact.participantCount).toBe(12);
    expect(preview?.impact.activeRegistrationCount).toBe(30);
    expect(preview?.impact.attendanceCount).toBe(45);
    expect(preview?.impact.scoreCount).toBe(28);
    expect(preview?.impact.certificateCount).toBe(3);
  });

  it('states plainly that confirmation archives rather than deletes', () => {
    expect(component.ARCHIVE_CONFIRMATION_NOTE).toContain('archived');
    expect(component.ARCHIVE_CONFIRMATION_NOTE).toContain('not permanently deleted');
  });

  it('archives with optimistic version, refreshes the active list, reports the truthful outcome', async () => {
    stubArchiveBackend();

    await TestBed.inject(ShelterDataService).loadConnectedHomes();
    await component.openArchivePreview(HOME);
    await component.confirmArchive();

    expect(calls['archiveShelterHome']).toBe(1);
    expect((lastPayload['archiveShelterHome'] as { expectedVersion?: number }).expectedVersion).toBe(1);

    // Removed from the active list only after confirmed success.
    expect(TestBed.inject(ShelterDataService).getHomeById('home-1')).toBeUndefined();
    expect(component.archivePreview()).toBeNull();
    expect(component.archiveNotice()).toContain('archived');
    expect(component.archiveNotice()).toContain('trigger');
  });

  it('keeps the home and the preview, and offers retry, when the archive fails', async () => {
    stubArchiveBackend({ archiveFails: true });

    await TestBed.inject(ShelterDataService).loadConnectedHomes();
    await component.openArchivePreview(HOME);
    await component.confirmArchive();

    expect(component.archiveError()).toContain('could not be completed');
    // The home is NOT removed from the active list on failure.
    expect(TestBed.inject(ShelterDataService).getHomeById('home-1')).toBeDefined();
    // The preview survives so the retry affordance stays available.
    expect(component.archivePreview()).not.toBeNull();
  });

  it('restricts archive and restore controls to ADMIN users', () => {
    const auth = TestBed.inject(AuthService);
    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google-id',
      email: 'tester@nakshatra.local',
      displayName: 'Test User',
      role: 'SUPPORT',
      accessStatus: 'APPROVED',
      version: 1,
    });

    expect(component.canArchive(HOME)).toBe(false);
    expect(component.canRestore()).toBe(false);
  });

  it('loads archived homes through the includeArchived read and restores truthfully', async () => {
    stubArchiveBackend({ restoreTriggerReinstall: true });

    await component.loadArchivedHomes(true);

    expect(calls['listShelterHomes']).toBe(1);
    expect(component.archivedHomes().length).toBe(1);
    expect(component.archivedHomes()[0].status).toBe('ARCHIVED');

    await component.restoreArchivedHome(component.archivedHomes()[0]);

    expect(calls['restoreShelterHome']).toBe(1);
    // The backend said the trigger was NOT reinstalled; the UI must not
    // pretend it was.
    expect(component.archiveNotice()).toContain('needs reinstall');
  });
});
