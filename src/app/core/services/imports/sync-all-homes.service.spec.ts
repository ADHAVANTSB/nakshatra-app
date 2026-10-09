import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncAllHomesHomeResult, SyncAllHomesJob } from '../../models';import { AuthService } from '../auth/auth.service';
import { ShelterDataService } from '../shelter-homes/shelter-data.service';
import { SyncAllHomesService } from './sync-all-homes.service';

/**
 * Sync All Homes job-driver tests.
 *
 * The backend owns the job: `start` begins it (processing the first chunk),
 * each `continue` processes the next chunk, and the frontend drives the loop
 * until the job reports a terminal status. The service must adopt
 * `alreadyRunning` jobs, distinguish COMPLETED from COMPLETED_WITH_ERRORS,
 * refresh only affected cached data, and never stay busy indefinitely.
 */

const HOME_IDS = ['home-1', 'home-2', 'home-3'];

function job(overrides: Partial<SyncAllHomesJob>): SyncAllHomesJob {
  return {
    jobId: 'SYNCJOB-1',
    status: 'RUNNING',
    chunkSize: 2,
    totalHomes: 3,
    processedHomes: 0,
    results: [],
    startedAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    finishedAt: '',
    ...overrides,
  };
}

function syncedResult(shelterHomeId: string): SyncAllHomesHomeResult {
  return {
    shelterHomeId,
    status: 'SYNCED',
    changes: {
      createdParticipantCount: 1,
      updatedParticipantCount: 0,
      unchangedParticipantCount: 2,
      createdRegistrationCount: 0,
      updatedRegistrationCount: 1,
      sourceChanged: true,
      reorderingDetected: false,
    },
  };
}

function failedResult(shelterHomeId: string): SyncAllHomesHomeResult {
  return {
    shelterHomeId,
    status: 'FAILED',
    error: { code: 'SOURCE_UNAVAILABLE', message: 'The source workbook could not be read.' },
  };
}

describe('SyncAllHomesService', () => {
  let service: SyncAllHomesService;
  let calls: Record<string, number>;
  let continueEnvelopes: Array<{ success: boolean; data?: unknown; error?: unknown }>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
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

    service = TestBed.inject(SyncAllHomesService);
    calls = {};
    continueEnvelopes = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  function stubBackend(startJob: SyncAllHomesJob | { errorCode: string }, alreadyRunning = false): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: { jobId?: string } };
      calls[request.action] = (calls[request.action] ?? 0) + 1;

      if (request.action === 'startSyncAllHomes') {
        if ('errorCode' in startJob) {
          return Promise.resolve(new Response(
            JSON.stringify({ success: false, error: { code: startJob.errorCode, message: 'No connected shelter source workbooks to sync' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ));
        }
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { alreadyRunning, job: startJob } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'continueSyncAllHomes') {
        const next = continueEnvelopes.shift();
        return Promise.resolve(new Response(
          JSON.stringify(next ?? { success: false, error: { code: 'SYNC_JOB_ALREADY_FINISHED', message: 'This sync job has already finished' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'listShelterHomes') {
        return Promise.resolve(new Response(
          JSON.stringify({
            success: true,
            data: {
              shelterHomes: HOME_IDS.map((id, index) => ({
                id,
                homeCode: `H-0${index + 1}`,
                homeName: `Home ${index + 1}`,
                currentImportVersionId: `import-${index + 1}`,
              })),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'listParticipants') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { participants: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'getImportStatus') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { imports: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      if (request.action === 'listEventRegistrations') {
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, data: { participantEvents: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code: 'UNKNOWN_ACTION', message: request.action } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });
  }

  it('drives the chunk loop to COMPLETED and reports final progress', async () => {
    stubBackend(job({ processedHomes: 1, results: [syncedResult('home-1')] }));
    continueEnvelopes.push(
      { success: true, data: { alreadyRunning: false, job: job({ processedHomes: 2, results: [syncedResult('home-1'), syncedResult('home-2')] }) } },
      {
        success: true,
        data: {
          alreadyRunning: false,
          job: job({
            status: 'COMPLETED',
            processedHomes: 3,
            finishedAt: '2026-10-10T00:05:00.000Z',
            results: [syncedResult('home-1'), syncedResult('home-2'), syncedResult('home-3')],
          }),
        },
      },
    );

    await service.start();

    expect(service.state()).toBe('COMPLETED');
    expect(service.job()?.processedHomes).toBe(3);
    expect(calls['continueSyncAllHomes']).toBe(2);
    expect(service.running()).toBe(false);
  });

  it('reports COMPLETED_WITH_ERRORS when any home failed', async () => {    stubBackend(job({ processedHomes: 1, results: [failedResult('home-1')] }));
    continueEnvelopes.push(
      { success: true, data: { alreadyRunning: false, job: job({ processedHomes: 2, results: [failedResult('home-1'), syncedResult('home-2')] }) } },
      {
        success: true,
        data: {
          alreadyRunning: false,
          job: job({
            status: 'COMPLETED_WITH_ERRORS',
            processedHomes: 3,
            finishedAt: '2026-10-10T00:05:00.000Z',
            results: [failedResult('home-1'), syncedResult('home-2'), failedResult('home-3')],
          }),
        },
      },
    );

    await service.start();

    expect(service.state()).toBe('COMPLETED_WITH_ERRORS');
    expect(service.job()?.results.filter(result => result.status === 'FAILED').length).toBe(2);
  });

  it('adopts an already-running job instead of failing', async () => {
    stubBackend(job({ processedHomes: 1, results: [syncedResult('home-1')] }), true);
    continueEnvelopes.push(
      { success: true, data: { alreadyRunning: true, job: job({ processedHomes: 2, results: [syncedResult('home-1'), syncedResult('home-2')] }) } },
      {
        success: true,
        data: {
          alreadyRunning: false,
          job: job({ status: 'COMPLETED', processedHomes: 3, finishedAt: '2026-10-10T00:05:00.000Z', results: [syncedResult('home-1'), syncedResult('home-2'), syncedResult('home-3')] }),
        },
      },
    );

    await service.start();

    expect(service.state()).toBe('COMPLETED');
    expect(service.job()?.jobId).toBe('SYNCJOB-1');
    expect(calls['startSyncAllHomes']).toBe(1);
  });

  it('refreshes only affected cached data after completion', async () => {
    stubBackend(job({ processedHomes: 1, results: [syncedResult('home-1')] }));
    continueEnvelopes.push({
      success: true,
      data: {
        alreadyRunning: false,
        job: job({ status: 'COMPLETED', processedHomes: 3, finishedAt: '2026-10-10T00:05:00.000Z', results: [syncedResult('home-1'), syncedResult('home-2'), syncedResult('home-3')] }),
      },
    });

    // Pre-load one event's registrations: it must be re-read after the job.
    const store = TestBed.inject(ShelterDataService);
    await store.loadEventRegistrations('event-1');
    const readsBefore = calls['listEventRegistrations'] ?? 0;

    await service.start();

    expect(service.state()).toBe('COMPLETED');

    // The job is terminal immediately; the targeted cache refresh runs in the
    // background and must complete with exactly these re-reads.
    await vi.waitFor(() => {
      expect(calls['listShelterHomes']).toBe(1);
      // Participants re-read for every synced home; import status likewise.
      expect(calls['listParticipants']).toBe(3);
      expect(calls['getImportStatus']).toBe(3);
      // The previously loaded event registration was force re-read.
      expect(calls['listEventRegistrations']).toBe(readsBefore + 1);
    });
  });

  it('never stays busy indefinitely when the backend keeps failing', async () => {
    stubBackend(job({ processedHomes: 1, results: [syncedResult('home-1')] }));

    // All continue calls fail hard; the loop must stop on its own.
    await service.start();

    expect(service.state()).toBe('ERROR');
    expect(service.errorMessage()).not.toBe('');
    expect(service.running()).toBe(false);
    expect(calls['continueSyncAllHomes']).toBeLessThanOrEqual(service.job()!.totalHomes + 2);
  });

  it('surfaces the backend error when no connected homes exist', async () => {
    stubBackend({ errorCode: 'NO_CONNECTED_HOMES' });

    await service.start();

    expect(service.state()).toBe('ERROR');
    expect(service.errorMessage()).toContain('No connected shelter source workbooks');
    expect(calls['continueSyncAllHomes']).toBeUndefined();
  });
});
