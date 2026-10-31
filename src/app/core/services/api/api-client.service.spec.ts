import { TestBed } from '@angular/core/testing';

import { ApiClientService } from './api-client.service';
import { AuthService } from '../auth/auth.service';

/**
 * Regression tests for the common request/response layer.
 *
 * Fixtures reproduce EXACTLY what Code.gs constructs:
 * - handleUpdateParticipant returns `sourceWriteBack.status: 'WRITTEN'`
 *   (see writeParticipantBackToSource), never 'UPDATED'.
 * - Apps Script may answer with a non-JSON HTML page (quota / error page).
 * - The backend may answer HTTP 500 with a valid ApiResponse error envelope.
 */

const SESSION_ID = 'spec-session-id';

const VALID_PARTICIPANT = {
  id: 'participant-1',
  participantCode: 'P-0001',
  shelterHomeId: 'home-1',
  fullName: 'Vikram Menon',
  gender: 'MALE',
  age: 12,
  standard: 6,
  level: 'JUNIOR',
  eligibilityStatus: 'ELIGIBLE',
  validationStatus: 'PASSED',
  approvalStatus: 'APPROVED',
  lockStatus: 'UNLOCKED',
  version: 4,
  sourceVersionId: 'import-1',
  sourceRowNumber: 7,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'backend',
  updatedAt: '2026-01-02T00:00:00.000Z',
  updatedBy: 'backend',
};

/** The exact shape writeParticipantBackToSource returns on success. */
const BACKEND_WRITTEN_WRITE_BACK = {
  status: 'WRITTEN',
  code: '',
  reason: '',
  writtenFields: ['fullName', 'gender', 'age', 'standard'],
  skippedFields: [],
  sourceSheetName: 'Participants',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetchOnce(response: Response | Promise<Response>): void {
  vi.stubGlobal('fetch', () => Promise.resolve(response));
}

function stubFailingFetch(): void {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
}

describe('ApiClientService — response contract alignment', () => {
  let client: ApiClientService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({}).compileComponents();

    client = TestBed.inject(ApiClientService);
    const auth = TestBed.inject(AuthService);
    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google',
      email: 'spec@nakshatra.local',
      displayName: 'Spec User',
      role: 'ADMIN',
      accessStatus: 'APPROVED',
      version: 1,
    });
    auth.setApplicationSession({
      id: SESSION_ID,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.inject(AuthService).logout();
  });

  it('accepts updateParticipant success with backend WRITTEN write-back and normalizes it to UPDATED', async () => {
    stubFetchOnce(jsonResponse({
      success: true,
      data: {
        dbUpdated: true,
        sourceSyncStatus: 'IN_SYNC',
        participant: { ...VALID_PARTICIPANT, version: 5 },
        sourceWriteBack: BACKEND_WRITTEN_WRITE_BACK,
        eventWiseRename: null,
      },
    }));

    const result = await client.updateParticipant({
      participantId: 'participant-1',
      expectedVersion: 4,
      fullName: 'Vikram Menon',
      gender: 'MALE',
      age: 12,
      standard: 6,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.participant.version).toBe(5);
      // The backend token WRITTEN means the Google Sheet WAS updated.
      expect(result.data.sourceWriteBack?.status).toBe('UPDATED');
    }
  });

  it('accepts updateParticipant success when the write-back was skipped (SKIPPED)', async () => {
    stubFetchOnce(jsonResponse({
      success: true,
      data: {
        dbUpdated: true,
        sourceSyncStatus: 'SOURCE_NOT_UPDATED',
        participant: { ...VALID_PARTICIPANT, version: 5 },
        sourceWriteBack: {
          status: 'SKIPPED',
          code: 'PARTICIPANT_SOURCE_MAPPING_UNAVAILABLE',
          reason: 'NO_CONNECTED_SOURCE',
          writtenFields: [],
          skippedFields: ['fullName'],
        },
      },
    }));

    const result = await client.updateParticipant({
      participantId: 'participant-1',
      expectedVersion: 4,
      fullName: 'Vikram Menon',
      gender: 'MALE',
      age: 12,
      standard: 6,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceWriteBack?.status).toBe('SKIPPED');
    }
  });

  it('accepts a registration whose source write-back is WRITTEN', async () => {
    stubFetchOnce(jsonResponse({
      success: true,
      data: {
        participantEvent: {
          id: 'reg-1',
          eventId: 'event-1',
          participantId: 'participant-1',
          registrationStatus: 'REGISTERED',
          version: 1,
        },
        sourceWriteBack: BACKEND_WRITTEN_WRITE_BACK,
      },
    }));

    const result = await client.registerParticipant({
      eventId: 'event-1',
      participantId: 'participant-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceWriteBack?.status).toBe('UPDATED');
    }
  });

  it('keeps the inlined participant row status on normalized registrations (historical indication)', async () => {
    stubFetchOnce(jsonResponse({
      success: true,
      data: {
        participantEvents: [
          {
            id: 'reg-1',
            eventId: 'event-1',
            participantId: 'participant-1',
            registrationStatus: 'REGISTERED',
            participantName: 'CHANDRAN V B',
            participantRowStatus: 'SOURCE_REMOVED',
            version: 1,
          },
          {
            id: 'reg-2',
            eventId: 'event-1',
            participantId: 'participant-2',
            registrationStatus: 'REGISTERED',
            participantName: 'Asha',
            version: 1,
          },
        ],
      },
    }));

    const result = await client.listEventRegistrations('event-1');

    expect(result.success).toBe(true);
    if (result.success) {
      const registrations = result.data.participantEvents;
      expect(registrations?.[0]?.participantRowStatus).toBe('SOURCE_REMOVED');
      expect(registrations?.[1]?.participantRowStatus).toBeUndefined();
    }
  });

  it('reports a non-JSON (HTML) server page as SERVER_RESPONSE_MALFORMED, not a network error', async () => {
    stubFetchOnce(new Response('<html>Quota exceeded</html>', {
      status: 302,
      headers: { 'Content-Type': 'text/html' },
    }));

    const result = await client.listEvents();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('SERVER_RESPONSE_MALFORMED');
      expect(result.error.message).toBe('We couldn’t load this information right now. Please try again later.');
    }
  });

  it('preserves the real backend error when HTTP status is not OK but the body is a valid ApiResponse', async () => {
    stubFetchOnce(jsonResponse({
      success: false,
      error: { code: 'HOME_CAPACITY_EXCEEDED', message: 'This shelter home already exceeds the maximum of 35 participants' },
    }, 500));

    const result = await client.listEvents();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('HOME_CAPACITY_EXCEEDED');
      expect(result.error.message).toContain('exceeds the maximum');
    }
  });

  it('reports a genuine network failure as NETWORK_ERROR', async () => {
    stubFailingFetch();

    const result = await client.listEvents();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NETWORK_ERROR');
      expect(result.error.message).toBe('We couldn’t load this information right now. Please try again later.');
    }
  });

  it('presents synthesized errors in plain English while keeping their codes', async () => {
    // Unrecognized envelope: diagnosed as a backend version mismatch, not a
    // generic failure — the deployed backend is the actionable cause.
    stubFetchOnce(jsonResponse({ ok: true }));
    const unrecognized = await client.listEvents();
    expect(unrecognized.success).toBe(false);
    if (!unrecognized.success) {
      expect(unrecognized.error.code).toBe('BACKEND_RESPONSE_UNRECOGNIZED');
      expect(unrecognized.error.message).toContain('out of date');
    }

    // Success payload behind a non-OK status.
    stubFetchOnce(jsonResponse({ success: true, data: { events: [] } }, 500));
    const failed = await client.listEvents();
    expect(failed.success).toBe(false);
    if (!failed.success) {
      expect(failed.error.code).toBe('API_REQUEST_FAILED');
      expect(failed.error.message).toBe('We couldn’t load this information right now. Please try again later.');
    }

    // No application session at all.
    TestBed.inject(AuthService).logout();
    const noSession = await client.listEvents();
    expect(noSession.success).toBe(false);
    if (!noSession.success) {
      expect(noSession.error.code).toBe('SESSION_REQUIRED');
      expect(noSession.error.message).toBe('Your session has expired. Please sign in again.');
    }
  });

  it('diagnoses a pre-envelope backend that rejected an unrouted action as BACKEND_ACTION_UNKNOWN', async () => {
    // Deployments predating a feature answer unrouted actions from their
    // login fall-through with exactly this bare-string error.
    stubFetchOnce(jsonResponse({ success: false, error: 'Missing Google ID token' }));

    const result = await client.listEventJudges({ eventId: 'event-1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('BACKEND_ACTION_UNKNOWN');
      expect(result.error.message).toContain('out of date');
    }
  });

  it('keeps other pre-envelope string errors visible as BACKEND_UNSTRUCTURED_ERROR', async () => {
    stubFetchOnce(jsonResponse({ success: false, error: 'Users sheet not found' }));

    const result = await client.listEvents();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('BACKEND_UNSTRUCTURED_ERROR');
      expect(result.error.message).toContain('older format');
    }
  });

  it('reports a hung request as REQUEST_TIMEOUT with the friendly message', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }));

      const pending = client.listEvents();
      await vi.advanceTimersByTimeAsync(120_000); // ApiClientService.REQUEST_TIMEOUT_MS
      const result = await pending;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('REQUEST_TIMEOUT');
        expect(result.error.message).toBe('This is taking longer than expected. Your request may still have been processed — refresh before retrying.');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  describe('previewShelterSheet', () => {
    /** Reproduces the exact data shape of handlePreviewShelterSheet (Code.gs 3898-3922). */
    const BACKEND_PREVIEW = {
      spreadsheetName: 'Anbu Illam 2026',
      metadata: {
        homeName: 'Anbu Illam',
        address: '12 Lake View Road',
        contactPhone: '+91 98400 12345',
      },
      metadataContactSource: 'EXPLICIT_CONTACT_LABEL',
      metadataEvidence: { homeName: { sheet: 'Overall - Final', row: 6 } },
      metadataMissing: ['contactName'],
      caretakers: [{
        fullName: 'Meena R',
        contactNumber: '+91 90000 11111',
        alternateNumber: '',
        sourceRowNumber: 12,
        participantName: 'Arjun',
      }],
      caretakerCount: 1,
      participantCount: 18,
      participantSheetDetected: true,
      eventWiseSheetDetected: true,
      workbookStructure: { sheetsInspected: 3, sheetsTotal: 3, sheets: [] },
      warnings: [],
      errors: [],
    };

    it('sends the pasted URL and accepts the backend metadata result', async () => {
      let sentAction = '';
      let sentPayload: unknown;
      stubFetchOnce(jsonResponse({ success: true, data: BACKEND_PREVIEW }));
      const originalFetch = globalThis.fetch;
      vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
        const parsed = JSON.parse(init.body);
        sentAction = parsed.action;
        sentPayload = parsed.payload;
        return Promise.resolve(jsonResponse({ success: true, data: BACKEND_PREVIEW }));
      });
      void originalFetch;

      const result = await client.previewShelterSheet({
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/spec-id/edit',
      });

      expect(sentAction).toBe('previewShelterSheet');
      expect((sentPayload as { spreadsheetUrl: string }).spreadsheetUrl)
        .toBe('https://docs.google.com/spreadsheets/d/spec-id/edit');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spreadsheetName).toBe('Anbu Illam 2026');
        expect(result.data.metadata.homeName).toBe('Anbu Illam');
        expect(result.data.metadataMissing).toEqual(['contactName']);
        expect(result.data.caretakerCount).toBe(1);
        expect(result.data.participantCount).toBe(18);
        expect(result.data.metadataContactSource).toBe('EXPLICIT_CONTACT_LABEL');
      }
    });

    it('accepts a caretaker-inferred contact source so the UI can present it honestly', async () => {
      stubFetchOnce(jsonResponse({
        success: true,
        data: {
          ...BACKEND_PREVIEW,
          metadata: { ...BACKEND_PREVIEW.metadata, contactName: 'Meena R' },
          metadataContactSource: 'CARETAKER_LABEL',
          warnings: ['METADATA_CONTACT_INFERRED_FROM_CARETAKER'],
        },
      }));

      const result = await client.previewShelterSheet({
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/spec-id/edit',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadataContactSource).toBe('CARETAKER_LABEL');
        expect(result.data.warnings).toContain('METADATA_CONTACT_INFERRED_FROM_CARETAKER');
      }
    });

    it('rejects a malformed preview response instead of trusting it', async () => {
      stubFetchOnce(jsonResponse({
        success: true,
        data: { spreadsheetName: 'Broken', /* everything else missing */ },
      }));

      const result = await client.previewShelterSheet({
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/spec-id/edit',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_SHELTER_SHEET_PREVIEW_RESPONSE');
      }
    });

    it('preserves the real backend error when the sheet cannot be previewed', async () => {
      stubFetchOnce(jsonResponse({
        success: false,
        error: { code: 'SPREADSHEET_ACCESS_FAILED', message: 'The spreadsheet could not be opened with the connected account.' },
      }));

      const result = await client.previewShelterSheet({
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/other-id/edit',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SPREADSHEET_ACCESS_FAILED');
      }
    });
  });

  describe('listAttendance', () => {
    /** A row exactly as buildAttendanceObject returns it (Code.gs 15895+). */
    const BACKEND_ATTENDANCE_ROW = {
      id: 'ATT-1',
      eventId: 'event-1',
      participantId: 'participant-1',
      teamId: '',
      status: 'PRESENT',
      markedAt: '2026-01-01T00:00:00.000Z',
      markedBy: 'user-1',
      version: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'user-1',
      // enrichment added by handleListAttendance
      eventName: 'Vocal',
      eventCode: 'E-01',
      fullName: 'Test Participant',
      shelterHomeId: 'home-1',
      shelterHomeName: 'Sunrise Home',
      teamName: '',
    };

    it('reads persisted attendance for an event and never requests archived rows', async () => {
      let sentAction = '';
      let sentPayload: Record<string, unknown> | undefined;
      vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
        const parsed = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
        sentAction = parsed.action;
        sentPayload = parsed.payload;
        return Promise.resolve(jsonResponse({ success: true, data: { attendance: [BACKEND_ATTENDANCE_ROW] } }));
      });

      const result = await client.listAttendance({ eventId: 'event-1' });

      expect(sentAction).toBe('listAttendance');
      expect(sentPayload).toEqual({ eventId: 'event-1' });
      expect(sentPayload && 'includeArchived' in sentPayload).toBe(false);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.attendance).toHaveLength(1);
        expect(result.data.attendance[0].status).toBe('PRESENT');
        expect(result.data.attendance[0].version).toBe(2);
      }
    });

    it('rejects a malformed attendance read response instead of trusting it', async () => {
      stubFetchOnce(jsonResponse({ success: true, data: { attendance: 'nope' } }));

      const result = await client.listAttendance({ eventId: 'event-1' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_ATTENDANCE_READ_RESPONSE');
      }
    });

    it('preserves the real backend error when the read is not permitted', async () => {
      stubFetchOnce(jsonResponse({
        success: false,
        error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to read attendance.' },
      }));

      const result = await client.listAttendance({ eventId: 'event-1' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  describe('event-day registration (check-in)', () => {
    const ENTRY = {
      participantId: 'participant-1',
      participantCode: 'NK26-001',
      fullName: 'Asha',
      level: 'SUB_JUNIOR',
      shelterHomeId: 'home-1',
      homeName: 'Sunrise Home',
      homeSheetStatus: 'LOCKED',
      checkInStatus: 'CHECKED_IN',
      checkedInAt: '2026-01-01T00:00:00.000Z',
      checkedInBy: 'spec-user',
      version: 1,
    };

    const RECORD = {
      id: 'EDR-1',
      participantId: 'participant-1',
      shelterHomeId: 'home-1',
      status: 'CHECKED_IN',
      checkedInAt: '2026-01-01T00:00:00.000Z',
      checkedInBy: 'spec-user',
      version: 1,
    };

    it('reads the event-day queue and accepts the backend entries', async () => {
      stubFetchOnce(jsonResponse({
        success: true,
        data: { eventDayRegistrations: [ENTRY] },
      }));

      const result = await client.listEventDayRegistrations({ shelterHomeId: 'home-1' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.eventDayRegistrations).toHaveLength(1);
        expect(result.data.eventDayRegistrations[0].checkInStatus).toBe('CHECKED_IN');
      }
    });

    it('rejects a malformed event-day queue response instead of trusting it', async () => {
      stubFetchOnce(jsonResponse({ success: true, data: { eventDayRegistrations: 'nope' } }));

      const result = await client.listEventDayRegistrations();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_EVENT_DAY_REGISTRATIONS_RESPONSE');
      }
    });

    it('sends the check-in payload and accepts the persisted record', async () => {
      let sentBody = '';
      vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
        sentBody = init.body;
        return Promise.resolve(jsonResponse({
          success: true,
          data: { eventDayRegistration: RECORD },
        }));
      });

      const result = await client.markEventDayRegistration({
        participantId: 'participant-1',
        shelterHomeId: 'home-1',
        status: 'CHECKED_IN',
        expectedVersion: 0,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.eventDayRegistration.id).toBe('EDR-1');
        expect(result.data.eventDayRegistration.version).toBe(1);
      }

      const request = JSON.parse(sentBody) as { action: string; payload: Record<string, unknown> };
      expect(request.action).toBe('markEventDayRegistration');
      expect(request.payload).toMatchObject({
        ['participantId']: 'participant-1',
        ['shelterHomeId']: 'home-1',
        ['status']: 'CHECKED_IN',
        ['expectedVersion']: 0,
      });
    });

    it('rejects a malformed check-in response instead of trusting it', async () => {
      stubFetchOnce(jsonResponse({ success: true, data: { eventDayRegistration: { id: 7 } } }));

      const result = await client.markEventDayRegistration({
        participantId: 'participant-1',
        shelterHomeId: 'home-1',
        status: 'CHECKED_IN',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_EVENT_DAY_REGISTRATION_RESPONSE');
      }
    });

    it('keeps the HOME_SHEET_NOT_LOCKED rejection and its friendly message', async () => {
      stubFetchOnce(jsonResponse({
        success: false,
        error: {
          code: 'HOME_SHEET_NOT_LOCKED',
          message: 'Confirm and lock this home’s sheet before registering its participants for the event day.',
        },
      }));

      const result = await client.markEventDayRegistration({
        participantId: 'participant-1',
        shelterHomeId: 'home-1',
        status: 'CHECKED_IN',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('HOME_SHEET_NOT_LOCKED');
        expect(result.error.message).toContain('Confirm and lock');
      }
    });
  });
});

describe('ApiClientService — sliding session window mirror (UX only)', () => {
  let client: ApiClientService;
  let auth: AuthService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({}).compileComponents();

    client = TestBed.inject(ApiClientService);
    auth = TestBed.inject(AuthService);
    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google',
      email: 'spec@nakshatra.local',
      displayName: 'Spec User',
      role: 'ADMIN',
      accessStatus: 'APPROVED',
      version: 1,
    });
    auth.setApplicationSession({
      id: SESSION_ID,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.inject(AuthService).logout();
  });

  it('takes the exact deadline from responses that carry data.session.expiresAt', async () => {
    const authoritative = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    stubFetchOnce(jsonResponse({
      success: true,
      data: { session: { expiresAt: authoritative } },
    }));

    await client.post('validateSession');

    expect(auth.applicationSession()?.expiresAt).toBe(authoritative);
  });

  it('mirrors the 2h sliding window after authenticated activity without a session field', async () => {
    const before = Date.now();
    stubFetchOnce(jsonResponse({ success: true, data: {} }));

    await client.post('listShelterHomes');

    const expiresAt = auth.applicationSession()?.expiresAt ?? '';
    const msLeft = Date.parse(expiresAt) - before;
    // The backend rewards authenticated activity with a fresh 2h inactivity
    // window (SESSION_INACTIVITY_TIMEOUT_HOURS); ±10s test slack.
    expect(msLeft).toBeGreaterThan(2 * 60 * 60 * 1000 - 10_000);
    expect(msLeft).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 10_000);
  });

  it('never creates a session from a session-less request', async () => {
    stubFetchOnce(jsonResponse({ success: true, data: {} }));
    auth.logout();

    await client.post('listShelterHomes');

    expect(auth.applicationSession()).toBeNull();
  });
});
