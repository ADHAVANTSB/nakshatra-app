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


describe('Homes — shelter home archive lifecycle', () => {
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

describe('Homes — source metadata preview', () => {
  let component: Homes;

  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/spec-preview-id/edit';

  /** Reproduces the exact data shape of handlePreviewShelterSheet (Code.gs 3898-3922). */
  const PREVIEW_SUCCESS = {
    spreadsheetName: 'Anbu Illam 2026',
    metadata: {
      homeName: 'Anbu Illam',
      address: '12 Lake View Road',
      contactPhone: '+91 98400 12345',
    },
    metadataContactSource: 'EXPLICIT_CONTACT_LABEL',
    metadataEvidence: {},
    metadataMissing: ['contactName'],
    caretakers: [{
      fullName: 'Meena R',
      contactNumber: '+91 90000 11111',
      alternateNumber: '',
      sourceRowNumber: 12,
      participantName: 'Arjun K',
    }],
    caretakerCount: 1,
    participantCount: 18,
    participantSheetDetected: true,
    eventWiseSheetDetected: true,
    workbookStructure: { sheetsInspected: 3, sheetsTotal: 3, sheets: [] },
    warnings: [],
    errors: [],
  };

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

  function stubBackend(previewData?: unknown, previewError?: { code: string; message: string }): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'previewShelterSheet') {
        return previewError ? failure(previewError.code, previewError.message) : envelope(previewData);
      }
      if (request.action === 'listShelterHomes') return envelope({ shelterHomes: [] });
      if (request.action === 'listParticipants') return envelope({ participants: [] });
      if (request.action === 'getImportStatus') return envelope({ imports: [] });
      return failure('UNKNOWN_ACTION', request.action);
    });
  }

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

    // Created without change detection: ngOnInit never runs, so no initial
    // loads race the preview request.
    component = TestBed.createComponent(Homes).componentInstance;
    component.openAddHome();
    component.sheetUrl.set(SHEET_URL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('previews the source metadata and prefills only detected empty fields', async () => {
    stubBackend(PREVIEW_SUCCESS);

    await component.previewSheetMetadata();

    const preview = component.sheetPreview();
    expect(preview).not.toBeNull();
    expect(preview?.spreadsheetName).toBe('Anbu Illam 2026');
    // Detected values prefill the empty form fields.
    expect(component.homeName()).toBe('Anbu Illam');
    expect(component.address()).toBe('12 Lake View Road');
    expect(component.contactPhone()).toBe('+91 98400 12345');
    // contactName was NOT found in the sheet, so it stays empty for the user.
    expect(component.contactName()).toBe('');
    expect(component.previewing()).toBe(false);
    expect(component.previewError()).toBe('');
  });

  it('never presents a caretaker value as the official home contact', async () => {
    stubBackend({
      ...PREVIEW_SUCCESS,
      metadata: { ...PREVIEW_SUCCESS.metadata, contactName: 'Meena R' },
      metadataContactSource: 'CARETAKER_LABEL',
      warnings: ['METADATA_CONTACT_INFERRED_FROM_CARETAKER'],
    });

    await component.previewSheetMetadata();

    // The caretaker's name must not land in the Contact Name field.
    expect(component.contactName()).toBe('');
    expect(component.contactInferredFromCaretaker()).toBe(true);
  });

  it('prompts only for the metadata the sheet does not contain', async () => {
    stubBackend(PREVIEW_SUCCESS);

    await component.previewSheetMetadata();

    expect(component.previewMissingLabels()).toEqual(['Contact name']);
  });

  it('surfaces a failed preview honestly and shows no detected values', async () => {
    stubBackend(undefined, {
      code: 'SPREADSHEET_ACCESS_FAILED',
      message: 'The spreadsheet could not be opened with the connected account.',
    });

    await component.previewSheetMetadata();

    expect(component.sheetPreview()).toBeNull();
    expect(component.previewError()).toContain('could not be opened');
    expect(component.previewing()).toBe(false);
  });

  it('does not prefill a field the user already entered', async () => {
    stubBackend(PREVIEW_SUCCESS);
    component.homeName.set('My Own Name');

    await component.previewSheetMetadata();

    expect(component.homeName()).toBe('My Own Name');
  });

  it('displays the detected values and caretaker details in the connect form', async () => {
    stubBackend(PREVIEW_SUCCESS);
    await component.previewSheetMetadata();

    const fixture = TestBed.createComponent(Homes);
    const target = fixture.componentInstance;
    target.openAddHome();
    target.sheetUrl.set(SHEET_URL);
    await target.previewSheetMetadata();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const panel = element.querySelector('.sheet-preview-panel');
    expect(panel?.textContent).toContain('Anbu Illam');
    expect(panel?.textContent).toContain('12 Lake View Road');
    expect(panel?.textContent).toContain('+91 98400 12345');
    expect(panel?.textContent).toContain('18');
    // Caretaker details appear in their own section, not as official contact.
    expect(panel?.textContent).toContain('Meena R');
    expect(panel?.textContent).not.toContain('spec-preview-id');
  });

  it('renders the caretaker-inferred warning and no false contact prefill', async () => {
    stubBackend({
      ...PREVIEW_SUCCESS,
      metadata: { ...PREVIEW_SUCCESS.metadata, contactName: 'Meena R' },
      metadataContactSource: 'CARETAKER_LABEL',
      warnings: ['METADATA_CONTACT_INFERRED_FROM_CARETAKER'],
    });
    await component.previewSheetMetadata();

    const fixture = TestBed.createComponent(Homes);
    const target = fixture.componentInstance;
    target.openAddHome();
    target.sheetUrl.set(SHEET_URL);
    await target.previewSheetMetadata();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('caretaker');
  });
});

describe('Homes — connect outcome handling', () => {
  let component: Homes;
  let calls: Record<string, number>;

  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/spec-connect-id/edit';

  const CONNECT_SUCCESS = {
    shelterHome: { id: 'home-9', homeCode: 'H-09', homeName: 'Lotus Home', status: 'ACTIVE' },
    sheetSource: { id: 'src-9', spreadsheetName: 'Lotus Participants', sourceStatus: 'CONNECTED' },
    connection: { status: 'SUCCEEDED' },
    initialImport: { attempted: true, status: 'SUCCEEDED', importVersionId: 'import-9' },
  };

  const IMPORT_RECORD = {
    id: 'import-9',
    importVersionId: 'import-9',
    shelterHomeId: 'home-9',
    versionNumber: 1,
    recordCount: 20,
    validParticipantCount: 20,
    errorCount: 0,
    warningCount: 0,
    status: 'COMPLETED',
  };

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

  /**
   * Generic stub. `connectData`/`connectFailure` decide what connectShelterSheet
   * answers; every pipeline read (imports, validations, participants, homes)
   * answers with small success payloads.
   */
  function stubBackend(options: {
    connectData?: unknown;
    connectFailure?: { code: string; message: string };
    connectRaw?: () => Promise<Response>;
    homes?: unknown[];
  } = {}): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      calls[request.action] = (calls[request.action] ?? 0) + 1;

      if (request.action === 'connectShelterSheet') {
        if (options.connectRaw) return options.connectRaw();
        if (options.connectFailure) return failure(options.connectFailure.code, options.connectFailure.message);
        return envelope(options.connectData ?? CONNECT_SUCCESS);
      }
      if (request.action === 'syncShelterSheet') {
        return envelope({
          shelterHomeId: 'home-9',
          shelterHomeName: 'Lotus Home',
          spreadsheetName: 'Lotus Participants',
          importVersionId: 'import-9',
          versionNumber: 1,
          status: 'COMPLETED',
        });
      }
      if (request.action === 'getImportStatus') return envelope({ imports: [IMPORT_RECORD] });
      if (request.action === 'getValidationResults') return envelope({ validationResults: [] });
      if (request.action === 'listParticipants') return envelope({ participants: [] });
      if (request.action === 'listShelterHomes') return envelope({ shelterHomes: options.homes ?? [] });
      return failure('UNKNOWN_ACTION', request.action);
    });
  }

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
    component.openAddHome();
    component.homeName.set('Lotus Home');
    component.sheetUrl.set(SHEET_URL);
    calls = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('reports a connected home with a succeeded initial import as CONNECTED', async () => {
    stubBackend();

    await component.connectSheet();

    expect(component.connectionOutcome()?.state).toBe('CONNECTED');
    expect(component.saving()).toBe(false);
    expect(component.connectedHome()?.id).toBe('home-9');
    expect(component.successMessage()).toContain('connected');
  });

  it('reports connect success with a failed initial import as SYNC_FAILED and offers Retry', async () => {
    stubBackend({
      connectData: {
        ...CONNECT_SUCCESS,
        code: 'CONNECTION_SUCCEEDED_SYNC_FAILED',
        initialImport: {
          attempted: true,
          status: 'FAILED',
          errorCode: 'PARTICIPANT_SHEET_NOT_DETECTED',
          errorMessage: 'No participant sheet was detected in the workbook.',
        },
      },
    });

    await component.connectSheet();

    const outcome = component.connectionOutcome();
    expect(outcome?.state).toBe('SYNC_FAILED');
    expect(outcome?.shelterHomeId).toBe('home-9');
    expect(outcome?.message).toContain('No participant sheet was detected');
    // A connected sheet must not be reported as a total failure...
    expect(component.connectedHome()?.id).toBe('home-9');
    // ...and the import must not be re-run behind the user's back.
    expect(calls['syncShelterSheet']).toBeUndefined();
    expect(component.retryImportAvailable()).toBe(true);
    expect(component.successMessage()).toBe('');
  });

  it('retry reuses the existing home identity and never reconnects', async () => {
    stubBackend({
      connectData: {
        ...CONNECT_SUCCESS,
        code: 'CONNECTION_SUCCEEDED_SYNC_FAILED',
        initialImport: { attempted: true, status: 'FAILED', errorCode: 'X', errorMessage: 'first attempt failed' },
      },
    });
    await component.connectSheet();
    calls = {};

    await component.retryConnectionImport();

    expect(calls['connectShelterSheet']).toBeUndefined();
    expect(calls['syncShelterSheet']).toBe(1);
    expect(component.connectionOutcome()?.state).toBe('CONNECTED');
    expect(component.retryingImport()).toBe(false);
    expect(component.retryImportAvailable()).toBe(false);
  });

  it('reports a retry that fails again without faking success', async () => {
    stubBackend({
      connectData: {
        ...CONNECT_SUCCESS,
        code: 'CONNECTION_SUCCEEDED_SYNC_FAILED',
        initialImport: { attempted: true, status: 'FAILED', errorCode: 'X', errorMessage: 'first attempt failed' },
      },
    });
    await component.connectSheet();

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      calls[request.action] = (calls[request.action] ?? 0) + 1;
      if (request.action === 'syncShelterSheet') {
        return failure('SOURCE_SHEET_ACCESS_FAILED', 'The connected Google Spreadsheet could not be accessed.');
      }
      return failure('UNKNOWN_ACTION', request.action);
    });

    await component.retryConnectionImport();

    expect(component.connectionOutcome()?.state).toBe('SYNC_FAILED');
    expect(component.connectionOutcome()?.message).toContain('could not be accessed');
    expect(component.retryingImport()).toBe(false);
    expect(component.successMessage()).toBe('');
  });

  it('reports an already-connected active source with its existing home', async () => {
    stubBackend({
      connectData: {
        ...CONNECT_SUCCESS,
        shelterHome: { id: 'home-1', homeCode: 'H-01', homeName: 'Sunrise Home', status: 'ACTIVE' },
        alreadyConnected: true,
        code: 'ALREADY_CONNECTED',
      },
    });

    await component.connectSheet();

    const outcome = component.connectionOutcome();
    expect(outcome?.state).toBe('ALREADY_CONNECTED');
    expect(outcome?.shelterHomeId).toBe('home-1');
    expect(component.connectedHome()?.id).toBe('home-1');
    // No duplicate home was created: only the existing identity is used.
    expect(calls['connectShelterSheet']).toBe(1);
  });

  it('treats an archived source distinctly and points to the restore path', async () => {
    stubBackend({
      connectFailure: {
        code: 'SHELTER_HOME_ARCHIVED',
        message: 'This Google Spreadsheet is connected to an archived shelter home. Restore the home before reconnecting it.',
      },
    });

    await component.connectSheet();

    const outcome = component.connectionOutcome();
    expect(outcome?.state).toBe('ARCHIVED_SOURCE');
    expect(outcome?.message).toContain('Restore');
    expect(component.successMessage()).toBe('');
    expect(component.connectedHome()).toBeNull();
    // The archived homes section (with the authorized Restore action) loads.
    expect(calls['listShelterHomes']).toBeGreaterThanOrEqual(1);
  });

  it('never reports success when the connect response is an HTTP 404 non-JSON page', async () => {
    stubBackend({
      connectRaw: () => Promise.resolve(new Response('<html>Not Found</html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      })),
    });

    await component.connectSheet();

    const outcome = component.connectionOutcome();
    expect(outcome?.state).toBe('REQUEST_ERROR');
    expect(component.successMessage()).toBe('');
    expect(component.connectedHome()).toBeNull();
    expect(component.saving()).toBe(false);
    // The error code is preserved for diagnostics (technical detail is only
    // logged to the console).
    expect(outcome?.technicalDetail).toContain('SERVER_RESPONSE_MALFORMED');
  });

  it('confirms an ambiguous connect failure against the homes list before giving up', async () => {
    // The user previewed the sheet first, so the workbook name is known.
    component.sheetPreview.set({
      spreadsheetName: 'Sunrise Participants',
      metadata: {},
      metadataContactSource: 'ABSENT',
      metadataEvidence: {},
      metadataMissing: [],
      caretakers: [],
      caretakerCount: 0,
      participantCount: null,
      participantSheetDetected: false,
      eventWiseSheetDetected: false,
      workbookStructure: { sheetsInspected: 0, sheetsTotal: 0, sheets: [] },
      warnings: [],
      errors: [],
    });

    stubBackend({
      connectRaw: () => Promise.resolve(new Response('<html>Not Found</html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      })),
      homes: [{
        id: 'home-1',
        homeCode: 'H-01',
        homeName: 'Sunrise Home',
        address: '',
        contactName: '',
        contactPhone: '',
        status: 'ACTIVE',
        version: 1,
        spreadsheetName: 'Sunrise Participants',
        sourceStatus: 'CONNECTED',
      }],
    });

    await component.connectSheet();

    const outcome = component.connectionOutcome();
    expect(outcome?.state).toBe('ALREADY_CONNECTED');
    expect(outcome?.shelterHomeId).toBe('home-1');
    expect(component.connectedHome()?.id).toBe('home-1');
    expect(component.successMessage()).toBe('');
  });

  it('reports a definitive validation failure without an outcome success', async () => {
    stubBackend({
      connectFailure: {
        code: 'SPREADSHEET_ACCESS_FAILED',
        message: 'The selected Google Spreadsheet could not be accessed',
      },
    });

    await component.connectSheet();

    expect(component.connectionOutcome()?.state).toBe('SOURCE_ACCESS_FAILED');
    expect(component.successMessage()).toBe('');
    expect(component.saving()).toBe(false);
  });
});

describe('Homes — friendly connection status labels', () => {
  let component: Homes;
  let shelterData: ShelterDataService;

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
    shelterData = TestBed.inject(ShelterDataService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  function labelFor(
    importStatus: string | undefined,
    homeOverrides: Record<string, unknown> = {}
  ): string {
    vi.spyOn(shelterData, 'getImportStatusForHome').mockReturnValue(
      importStatus === undefined ? undefined as never : { status: importStatus } as never
    );
    return component.connectionStatusLabel({ ...HOME, ...homeOverrides } as never);
  }

  it('maps backend import statuses to friendly labels', () => {
    expect(labelFor('RUNNING')).toBe('Syncing');
    expect(labelFor('COMPLETED')).toBe('Synced');
    expect(labelFor('COMPLETED_WITH_ERRORS')).toBe('Synced with warnings');
    expect(labelFor('FAILED')).toBe('Sync failed');
  });

  it('labels a connected source that was never imported as needing a sync', () => {
    expect(labelFor(undefined)).toBe('Sync needed');
  });

  it('labels a home with a prior import but no loaded status as checking', () => {
    expect(labelFor(undefined, { currentImportVersionId: 'import-1' })).toBe('Checking status');
  });

  it('labels an archived home as Archived regardless of import state', () => {
    expect(labelFor('COMPLETED', { status: 'ARCHIVED' })).toBe('Archived');
  });

  it('never shows a raw backend status code in the primary label', () => {
    for (const raw of ['RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED']) {
      expect(labelFor(raw)).not.toBe(raw);
    }
  });
});

/**
 * Home sheet confirmation & locking (prototype screen C): confirm locks the
 * sheet, unlocking requires a mandatory reason, and the audit line is composed
 * only from the backend's who/when/why fields.
 */
describe('Homes — home sheet confirmation & locking', () => {
  let component: Homes;
  let calls: Array<{ action: string; payload: Record<string, unknown> }>;
  let sheetRow: Record<string, unknown>;

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
    calls = [];
    sheetRow = { ...HOME, sheetStatus: 'NOT_CONFIRMED' };

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      calls.push({ action: request.action, payload: (request.payload ?? {}) as Record<string, unknown> });

      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'listShelterHomes':
          return ok({ shelterHomes: [sheetRow] });
        case 'confirmHomeSheet':
          sheetRow = {
            ...sheetRow,
            sheetStatus: 'LOCKED',
            sheetConfirmedAt: '12 Feb 2026, 16:40',
            sheetConfirmedBy: 'R. Kalyani',
            sheetLockedAt: '12 Feb 2026, 16:40',
          };
          return ok(sheetRow);
        case 'unlockHomeSheet':
          sheetRow = {
            ...sheetRow,
            sheetStatus: 'CONFIRMED',
            sheetUnlockedAt: '13 Feb 2026, 08:51',
            sheetUnlockedBy: 'A. Nirmala',
            sheetUnlockReason: (request.payload as { reason?: string } | undefined)?.reason ?? '',
          };
          return ok(sheetRow);
        default:
          return ok({});
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('confirms and locks the sheet through the backend and shows the locked status', async () => {
    await component.confirmSheet({ ...sheetRow } as never);

    expect(calls.find(call => call.action === 'confirmHomeSheet')?.payload)
      .toEqual({ shelterHomeId: 'home-1' });

    const updated = TestBed.inject(ShelterDataService).homes()[0];
    expect(component.sheetStatusLabel(updated)).toBe('Locked — editing prevented');
    expect(component.isSheetLocked(updated)).toBe(true);
  });

  it('requires a reason to unlock a locked sheet', async () => {
    component.openUnlockSheet({ ...sheetRow } as never);
    component.updateUnlockReason('   ');
    await component.confirmUnlockSheet({ ...sheetRow } as never);

    expect(component.unlockReasonError()).toBe(true);
    expect(calls.some(call => call.action === 'unlockHomeSheet')).toBe(false);
  });

  it('unlocks with a mandatory reason and closes the unlock box', async () => {
    component.openUnlockSheet({ ...sheetRow } as never);
    component.updateUnlockReason('Age correction for Bhavana M');
    await component.confirmUnlockSheet({ ...sheetRow } as never);

    expect(calls.find(call => call.action === 'unlockHomeSheet')?.payload)
      .toEqual({ shelterHomeId: 'home-1', reason: 'Age correction for Bhavana M' });
    expect(component.unlockHomeId()).toBeNull();
    expect(component.unlockReasonError()).toBe(false);
  });

  it('composes the audit line from the backend who/when/why fields only', () => {
    const lines = component.sheetAuditLines({
      ...sheetRow,
      sheetStatus: 'CONFIRMED',
      sheetConfirmedAt: '12 Feb 2026, 16:40',
      sheetConfirmedBy: 'R. Kalyani',
      sheetLockedAt: '12 Feb 2026, 16:40',
      sheetUnlockReason: 'Age correction for Bhavana M',
      sheetUnlockedBy: 'A. Nirmala',
      sheetUnlockedAt: '13 Feb 2026, 08:51',
    } as never);

    const joined = lines.join(' | ');
    expect(joined).toContain('Confirmed by R. Kalyani — 12 Feb 2026, 16:40');
    expect(joined).toContain('Locked — confirmation without further changes (12 Feb 2026, 16:40)');
    expect(joined).toContain('Unlocked for correction — reason: “Age correction for Bhavana M” by A. Nirmala (13 Feb 2026, 08:51)');
  });

  it('shows no audit line for a sheet the backend has no history for', () => {
    expect(component.sheetAuditLines({ ...sheetRow } as never)).toEqual([]);
  });
});
