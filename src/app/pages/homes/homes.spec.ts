import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { SyncAllHomesService } from '../../core/services/imports/sync-all-homes.service';
import { friendlyError } from '../../core/permissions/friendly-error';
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


describe('Homes - permanent deletion', () => {
  let component: Homes;
  let calls: Record<string, number>;
  let lastPayload: Record<string, unknown>;

  const DELETION_PLAN = {
    shelterHomeId: 'home-1',
    homeCode: 'H-01',
    homeName: 'Sunrise Home',
    programId: '',
    environmentId: '',
    homeStatus: 'ACTIVE',
    sheetConfirmation: 'LOCKED',
    source: {
      spreadsheetName: 'Sunrise Participants',
      sourceStatus: 'CONNECTED',
      sourceRefRedacted: 'Sunrise Participants (...WXYZ)',
    },
    counts: {
      Participants: {
        delete: 10,
        retain: 2,
        class: 'MIXED',
        reason: 'TOMBSTONE: participant referenced by official records',
      },
      ParticipantEvents: { delete: 30, retain: 0, class: 'OPERATIONAL', reason: '' },
      Scores: { delete: 2, retain: 26, class: 'MIXED', reason: 'FINALIZED official result' },
    },
    sharedUntouched: { Events: 5 },
    deletableRows: 42,
    retainedRows: 30,
    sourceReuseEligible: true,
    backupStorageReady: true,
    validation: 'READY',
    blockers: [],
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

  function stubDeletionBackend(overrides: {
    previewFails?: boolean;
    deleteFails?: boolean;
  } = {}): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      calls[request.action] = (calls[request.action] ?? 0) + 1;
      if (request.payload) {
        lastPayload[request.action] = request.payload;
      }

      switch (request.action) {
        case 'previewShelterHomeDeletion':
          if (overrides.previewFails) {
            return failure('PREVIEW_FAILED', 'The deletion preview failed.');
          }
          return envelope({
            dryRun: true,
            generatedAt: '2026-01-01T00:00:00.000Z',
            authorized: true,
            approvalSteps: [],
            backupStorageReady: true,
            homes: [DELETION_PLAN],
            deletedHomes: [],
          });

        case 'deleteShelterHome':
          if (overrides.deleteFails) {
            return failure('DELETE_FAILED', 'The deletion could not be completed.');
          }
          return envelope({
            shelterHomeId: 'home-1',
            backupId: 'HDB-1',
            backupVerified: true,
            deleted: 42,
            retained: 30,
          });

        case 'listShelterHomes':
          return envelope({
            shelterHomes: lastPayload['deleteShelterHome'] ? [] : [HOME],
          });

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

  it('previews the real dependent record counts and never fires a deletion before confirmation', async () => {
    stubDeletionBackend();

    await component.openDeletionPreview(HOME);

    expect(calls['previewShelterHomeDeletion']).toBe(1);
    expect(calls['deleteShelterHome']).toBeUndefined();

    const preview = component.deletionPreview();
    expect(preview?.homeName).toBe('Sunrise Home');
    expect(preview?.homeCode).toBe('H-01');
    expect(preview?.deletableRows).toBe(42);
    expect(preview?.retainedRows).toBe(30);

    const rows = component.deletionImpactRows();
    expect(rows.map(row => row.table)).toEqual(['Participants', 'ParticipantEvents', 'Scores']);
    expect(rows[0]).toEqual({
      table: 'Participants',
      remove: 10,
      retain: 2,
      reason: 'TOMBSTONE: participant referenced by official records',
    });
  });

  it('states plainly that deletion is permanent, keeps official history and takes a backup', () => {
    expect(component.DELETION_CONFIRMATION_NOTE).toContain('Permanent deletion');
    expect(component.DELETION_CONFIRMATION_NOTE).toContain('retained');
    expect(component.DELETION_CONFIRMATION_NOTE).toContain('verified backup');
  });

  it('refuses to delete without a reason or without the exact home code', async () => {
    stubDeletionBackend();

    await TestBed.inject(ShelterDataService).loadConnectedHomes();
    await component.openDeletionPreview(HOME);

    await component.confirmDeletion();
    expect(component.deletionError()).toContain('reason');
    expect(calls['deleteShelterHome']).toBeUndefined();

    component.updateDeleteReason('duplicate home');
    component.updateDeleteConfirmCode('WRONG');
    await component.confirmDeletion();
    expect(component.deletionError()).toContain('H-01');
    expect(calls['deleteShelterHome']).toBeUndefined();
  });

  it('deletes with the stable home id + code confirmation, refreshes the list and reports counts', async () => {
    stubDeletionBackend();

    await TestBed.inject(ShelterDataService).loadConnectedHomes();
    await component.openDeletionPreview(HOME);
    component.updateDeleteReason('duplicate home');
    component.updateDeleteConfirmCode('H-01');
    await component.confirmDeletion();

    expect(calls['deleteShelterHome']).toBe(1);

    const payload = lastPayload['deleteShelterHome'] as {
      shelterHomeId: string;
      confirm: string;
      reason: string;
      expectedVersion?: number;
    };
    expect(payload.shelterHomeId).toBe('home-1');
    expect(payload.confirm).toBe('H-01');
    expect(payload.reason).toBe('duplicate home');
    expect(payload.expectedVersion).toBe(1);

    // Removed from the active list only after confirmed success.
    expect(TestBed.inject(ShelterDataService).getHomeById('home-1')).toBeUndefined();
    expect(component.deletionPreview()).toBeNull();
    expect(component.deletionNotice()).toContain('permanently deleted');
    expect(component.deletionNotice()).toContain('42');
    expect(component.deletionNotice()).toContain('30');
  });

  it('keeps the home and the dialog, and offers retry, when the deletion fails', async () => {
    stubDeletionBackend({ deleteFails: true });

    await TestBed.inject(ShelterDataService).loadConnectedHomes();
    await component.openDeletionPreview(HOME);
    component.updateDeleteReason('duplicate home');
    component.updateDeleteConfirmCode('H-01');
    await component.confirmDeletion();

    expect(component.deletionError()).toContain('could not be completed');
    // The home is NOT removed from the active list on failure.
    expect(TestBed.inject(ShelterDataService).getHomeById('home-1')).toBeDefined();
    // The dialog survives so the retry affordance stays available.
    expect(component.deletionPreview()).not.toBeNull();
  });

  it('restricts the delete control to Support/Admin users', () => {
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
    expect(component.canDelete()).toBe(true);

    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google-id',
      email: 'tester@nakshatra.local',
      displayName: 'Test User',
      role: 'LIAISON_TEAM',
      accessStatus: 'APPROVED',
      version: 1,
    });
    expect(component.canDelete()).toBe(false);
  });

  it('reports a failed preview and can retry it', async () => {
    stubDeletionBackend({ previewFails: true });

    await component.openDeletionPreview(HOME);
    expect(component.deletionPreviewError()).toContain('failed');
    expect(component.deletionPreview()).toBeNull();
    expect(calls['deleteShelterHome']).toBeUndefined();
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

  it('keeps the alternate phone in its own field (never the primary phone)', async () => {
    stubBackend({
      ...PREVIEW_SUCCESS,
      metadata: {
        homeName: 'Anbu Illam',
        address: '12 Lake View Road',
        contactPhone: '+91 98400 12345',
        contactAlternatePhone: '+91 98400 67890',
      },
      metadataMissing: ['contactName'],
    });

    await component.previewSheetMetadata();

    const preview = component.sheetPreview();
    expect(preview?.metadata['contactPhone']).toBe('+91 98400 12345');
    expect(preview?.metadata['contactAlternatePhone']).toBe('+91 98400 67890');
    // A provided alternate phone is not "missing".
    expect(component.previewMissingLabels()).not.toContain('Alternate phone');
  });

  it('reports a genuinely missing alternate phone and never fabricates one', async () => {
    stubBackend({
      ...PREVIEW_SUCCESS,
      metadataMissing: ['contactName', 'contactAlternatePhone'],
    });

    await component.previewSheetMetadata();

    expect(component.previewMissingLabels()).toContain('Alternate phone');
    expect(component.sheetPreview()?.metadata['contactAlternatePhone']).toBeUndefined();
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

  it('treats an archived source distinctly and points to the permanent-deletion exit', async () => {
    stubBackend({
      connectFailure: {
        code: 'SHELTER_HOME_ARCHIVED',
        message: 'This Google Spreadsheet is connected to an archived shelter home. Permanently delete that home before registering the sheet again.',
      },
    });

    await component.connectSheet();

    const outcome = component.connectionOutcome();
    expect(outcome?.state).toBe('ARCHIVED_SOURCE');
    expect(outcome?.message).toContain('Permanently delete');
    expect(outcome?.message).not.toContain('Restore');
    expect(component.successMessage()).toBe('');
    expect(component.connectedHome()).toBeNull();
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

  it('emits no archive status label (archive/restore retired)', () => {
    expect(labelFor('COMPLETED', { status: 'ARCHIVED' })).toBe('Synced');
    expect(labelFor('COMPLETED', { status: 'ARCHIVED' })).not.toContain('Archiv');
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

// =====================================================================
// Zone 2 Step 6: cross-zone preview advisory + cross-zone connect
// outcomes. The SERVER-side gate is the enforcement authority; the
// preview advisory is display-only and must never gate the connection.
// =====================================================================
describe('Homes - Step 6 cross-zone advisory and outcomes', () => {
  let component: Homes;
  let fixture: ComponentFixture<Homes>;
  let calls: Record<string, number>;

  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/spec-connect-id/edit';

  const PREVIEW_BASE = {
    spreadsheetName: 'Anbu Illam 2026',
    metadata: {},
    metadataContactSource: 'ABSENT',
    metadataEvidence: {},
    metadataMissing: [],
    caretakers: [],
    caretakerCount: 0,
    participantCount: null,
    participantSheetDetected: false,
    eventWiseSheetDetected: false,
    workbookStructure: { sheetsInspected: 1, sheetsTotal: 1, sheets: [] },
    warnings: [],
    errors: [],
  };

  const CONNECT_SUCCESS = {
    shelterHome: { id: 'home-9', homeCode: 'H-09', homeName: 'Lotus Home', status: 'ACTIVE' },
    sheetSource: { id: 'src-9', spreadsheetName: 'Lotus Participants', sourceStatus: 'CONNECTED' },
    connection: { status: 'SUCCEEDED' },
    initialImport: { attempted: true, status: 'SUCCEEDED', importVersionId: 'import-9' },
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

  function stubBackend(options: {
    previewData?: Record<string, unknown>;
    connectFailure?: { code: string; message: string };
  } = {}): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      calls[request.action] = (calls[request.action] ?? 0) + 1;

      if (request.action === 'previewShelterSheet') {
        return envelope(options.previewData ?? PREVIEW_BASE);
      }
      if (request.action === 'connectShelterSheet') {
        if (options.connectFailure) {
          return failure(options.connectFailure.code, options.connectFailure.message);
        }
        return envelope(CONNECT_SUCCESS);
      }
      if (request.action === 'syncShelterSheet') {
        return failure('SHEET_SOURCE_AMBIGUOUS',
          'This shelter home has more than one connected Google Sheet');
      }
      if (request.action === 'getImportStatus') return envelope({ imports: [] });
      if (request.action === 'getValidationResults') return envelope({ validationResults: [] });
      if (request.action === 'listParticipants') return envelope({ participants: [] });
      if (request.action === 'listShelterHomes') return envelope({ shelterHomes: [] });
      return failure('UNKNOWN_ACTION', request.action);
    });
  }

  function rendered(): HTMLElement {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
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

    fixture = TestBed.createComponent(Homes);
    component = fixture.componentInstance;
    component.openAddHome();
    component.sheetUrl.set(SHEET_URL);
    component.homeName.set('Lotus Home');
    calls = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  // ---- U1: claims advisory is display-only --------------------------
  it('U1 surfaces a claims advisory at preview and never gates the connect', async () => {
    stubBackend({
      previewData: {
        ...PREVIEW_BASE,
        crossZoneConflict: {
          claims: [{
            environmentIds: ['ZONE_1'],
            spreadsheetId: 'zone-1-registry',
            sourceId: 'src-1',
            shelterHomeId: 'home-1',
            homeStatus: 'ACTIVE',
            sourceStatus: 'CONNECTED',
          }],
          uninitializedRegistries: [],
          unreachableRegistries: [],
        },
      },
    });

    await component.previewSheetMetadata();

    const conflict = component.sheetPreview()?.crossZoneConflict;
    expect(conflict?.claims.length).toBe(1);
    const el = rendered();
    expect(el.querySelector('.cross-zone-conflict')).not.toBeNull();
    expect(el.textContent ?? '').toContain('already connected to a shelter home');

    // Display only: the connection attempt still goes to the server,
    // which alone decides (preview is never authorization).
    await component.connectSheet();
    expect(calls['connectShelterSheet']).toBe(1);
  });

  // ---- U2: uninitialized + unreachable registry advisories --------
  it('U2 reports uninitialized and unreachable registries in the advisory', async () => {
    stubBackend({
      previewData: {
        ...PREVIEW_BASE,
        crossZoneConflict: {
          claims: [],
          uninitializedRegistries: [{
            environmentIds: ['ZONE_2'],
            spreadsheetId: 'zone-2-registry',
            error: 'SheetSources table is missing - the registry is not initialized',
          }],
          unreachableRegistries: [{
            environmentIds: ['ZONE_1'],
            spreadsheetId: 'zone-1-registry',
            error: 'Registry read timed out',
          }],
        },
      },
    });

    await component.previewSheetMetadata();

    const el = rendered();
    expect(el.querySelector('.cross-zone-conflict')).not.toBeNull();
    const text = el.textContent ?? '';
    expect(text).toContain('not initialized');
    expect(text).toContain('ZONE_1');
    expect(text).toContain('could not be read');
  });

  // ---- U3: no conflict -> no advisory ------------------------------
  it('U3 renders no advisory when the scan found nothing', async () => {
    stubBackend({
      previewData: {
        ...PREVIEW_BASE,
        crossZoneConflict: {
          claims: [],
          uninitializedRegistries: [],
          unreachableRegistries: [],
        },
      },
    });

    await component.previewSheetMetadata();

    const el = rendered();
    expect(el.querySelector('.cross-zone-conflict')).toBeNull();

    // The literal null/absent case from the plan renders nothing either.
    stubBackend({ previewData: { ...PREVIEW_BASE, crossZoneConflict: null } });
    await component.previewSheetMetadata();
    expect(rendered().querySelector('.cross-zone-conflict')).toBeNull();
  });

  // ---- U4: SOURCE_CONNECTED_IN_OTHER_ZONE is terminal --------------
  it('U4 maps SOURCE_CONNECTED_IN_OTHER_ZONE to a terminal outcome without retry', async () => {
    stubBackend({
      connectFailure: {
        code: 'SOURCE_CONNECTED_IN_OTHER_ZONE',
        message: 'This Google Spreadsheet is already connected to a shelter home in another zone',
      },
    });

    await component.connectSheet();

    const outcome = component.connectionOutcome();
    expect(outcome?.state).toBe('CONNECTED_IN_OTHER_ZONE');
    expect(outcome?.message).toContain('another zone');
    expect(outcome?.technicalDetail).toBe('SOURCE_CONNECTED_IN_OTHER_ZONE');
    // A definitive verdict never offers Retry (retrying cannot change it).
    expect(component.retryImportAvailable()).toBe(false);
    const el = rendered();
    expect(el.textContent ?? '').toContain('cannot be connected here');
  });

  // ---- U5: SOURCE_CROSS_ZONE_CHECK_FAILED may be retried ------------
  it('U5 maps SOURCE_CROSS_ZONE_CHECK_FAILED to an unverified outcome with retry guidance', async () => {
    stubBackend({
      connectFailure: {
        code: 'SOURCE_CROSS_ZONE_CHECK_FAILED',
        message: 'Another zone registry could not be verified, so registration is refused',
      },
    });

    await component.connectSheet();

    const outcome = component.connectionOutcome();
    expect(outcome?.state).toBe('CROSS_ZONE_UNVERIFIED');
    expect(outcome?.technicalDetail).toBe('SOURCE_CROSS_ZONE_CHECK_FAILED');
    expect(component.retryImportAvailable()).toBe(false);
    const el = rendered();
    expect(el.textContent ?? '').toContain('try again');
    expect(el.textContent ?? '').toContain('Nothing was registered');
  });

  // ---- U6: SOURCE_REGISTRY_NOT_INITIALIZED explains init -----------
  it('U6 maps SOURCE_REGISTRY_NOT_INITIALIZED to an outcome naming the required initialization', async () => {
    stubBackend({
      connectFailure: {
        code: 'SOURCE_REGISTRY_NOT_INITIALIZED',
        message: 'Another zone registry is not initialized (its SheetSources table is missing), so registration is refused',
      },
    });

    await component.connectSheet();

    const outcome = component.connectionOutcome();
    expect(outcome?.state).toBe('REGISTRY_NOT_INITIALIZED');
    expect(outcome?.technicalDetail).toBe('SOURCE_REGISTRY_NOT_INITIALIZED');
    expect(component.retryImportAvailable()).toBe(false);
    const el = rendered();
    const text = el.textContent ?? '';
    expect(text).toContain('initialize');
    // It must NOT encourage repeated ordinary retries.
    expect(text).toContain('will not succeed');
  });

  // ---- U7: SHEET_SOURCE_AMBIGUOUS surfaces on sync -----------------
  it('U7 surfaces the ambiguous-mapping message on a failed sync', async () => {
    stubBackend();
    const notifications = TestBed.inject(NotificationService);
    const errorSpy = vi.spyOn(notifications, 'error');

    await component.syncFromSheet({
      id: 'home-1', homeCode: 'H-01', homeName: 'Sunrise Home',
      spreadsheetName: 'Sunrise Participants', status: 'ACTIVE',
    } as never);

    expect(calls['syncShelterSheet']).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const detail = String(errorSpy.mock.calls[0]?.[1] ?? '');
    expect(detail).toContain('more than one connected Google Sheet');
  });

  // ---- U8: friendly-error retry semantics --------------------------
  it('U8 maps the Step 5 codes to correct retry semantics', () => {
    expect(friendlyError('SOURCE_CONNECTED_IN_OTHER_ZONE', 'raw').retryable).toBe(false);
    expect(friendlyError('SOURCE_CROSS_ZONE_CHECK_FAILED', 'raw').retryable).toBe(true);
    expect(friendlyError('SOURCE_REGISTRY_NOT_INITIALIZED', 'raw').retryable).toBe(false);
    expect(friendlyError('SHEET_SOURCE_AMBIGUOUS', 'raw').retryable).toBe(false);
    expect(friendlyError('SHEET_SOURCE_NOT_FOUND', 'raw').retryable).toBe(false);
    // Initialization message names the required action and discourages retries.
    const init = friendlyError('SOURCE_REGISTRY_NOT_INITIALIZED', 'raw');
    expect(init.message).toContain('initialize');
    expect(init.message).toContain('not succeed');
    // Unmapped codes keep the existing fall-through semantics.
    expect(friendlyError('SOME_UNKNOWN_CODE', 'raw').retryable).toBe(true);
  });

  // ---- U10: generic fall-through unchanged -------------------------
  it('U10 keeps the generic failure path for unhandled codes', async () => {
    stubBackend({
      connectFailure: {
        code: 'SOME_BRAND_NEW_CODE',
        message: 'A failure the UI has no special case for',
      },
    });

    await component.connectSheet();

    expect(component.connectionOutcome()).toBeNull();
    expect(component.formError()).toContain('A failure the UI has no special case for');
  });
});
