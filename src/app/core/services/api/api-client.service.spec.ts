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

  it('accepts a score save with the backend payload (scores carry no source write-back)', async () => {
    stubFetchOnce(jsonResponse({
      success: true,
      data: {
        score: {
          id: 'score-1',
          eventId: 'event-1',
          participantId: 'participant-1',
          value: 8,
          status: 'DRAFT',
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'backend',
          updatedAt: '2026-01-01T00:00:00.000Z',
          updatedBy: 'backend',
        },
      },
    }));

    const result = await client.saveScore({
      eventId: 'event-1',
      participantId: 'participant-1',
      value: 8,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.score.value).toBe(8);
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

  it('reports a non-JSON (HTML) server page as SERVER_RESPONSE_MALFORMED, not a network error', async () => {
    stubFetchOnce(new Response('<html>Quota exceeded</html>', {
      status: 302,
      headers: { 'Content-Type': 'text/html' },
    }));

    const result = await client.listEvents();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('SERVER_RESPONSE_MALFORMED');
      expect(result.error.message).not.toBe('Unable to reach the server. Please try again.');
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
      expect(result.error.message).toBe('Unable to reach the server. Please try again.');
    }
  });
});
