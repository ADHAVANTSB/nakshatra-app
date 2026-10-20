import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { DistributionService } from '../../core/services/certificates/distribution.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { Certificates } from './certificates';

function winner(position: number, name: string, score: number, scoreId = `score-${position}`): Record<string, unknown> {
  return {
    position,
    name,
    className: '5',
    level: 'JUNIOR',
    shelterHomeName: 'Sunrise Home',
    score,
    scoreId,
    participantId: `participant-${position}`,
    teamId: '',
  };
}

/**
 * The winners report shows official scores (the backend-computed average of
 * the judges' submitted totals) with the shared one-decimal display rule.
 */
describe('Certificates — official score display', () => {
  let fixture: ComponentFixture<Certificates>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Certificates],
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

  it('renders winner scores with one decimal where necessary (21.3, never 21.0)', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      if (request.action === 'listWinners') {
        return ok({
          events: [{
            eventId: 'event-1',
            eventCode: 'LIT-006',
            eventName: 'Quiz (S+SS)',
            category: 'LITERARY',
            mode: 'SOLO',
            eventStatus: 'ACTIVE',
            winners: [winner(1, 'Ana', 21.25), winner(2, 'Bhavana', 21)],
          }],
          totalEvents: 1,
          totalWinners: 2,
        });
      }
      if (request.action === 'getPageData') {
        return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
      }
      return ok({});
    });

    fixture = TestBed.createComponent(Certificates);
    fixture.detectChanges();
    // The stubbed fetch chain is microtask-only; one macrotask lets it drain.
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const cells = Array.from(host.querySelectorAll('tbody tr'))
      .map(row => (row.querySelector('td:last-child')?.textContent ?? '').trim());
    expect(cells).toEqual(['21.3', '21']);
    expect(host.textContent).not.toContain('21.25');
    expect(host.textContent).not.toContain('21.0');
  });
});

// =====================================================================
// Physical distribution tracking (medals and certificates handed to
// winners). Every status shown is backend-confirmed (server timestamp +
// recording user); a failed save never shows false success and never
// invents a "not distributed" default for a broken backend.
// =====================================================================

interface RecordedRequest {
  action: string;
  payload: Record<string, unknown>;
}

type StubResponse = { success: true; data: unknown } | { success: false; error: { code: string; message: string } };

const ok = (data: unknown): StubResponse => ({ success: true, data });
const fail = (code: string, message: string): StubResponse => ({ success: false, error: { code, message } });

function distributionEntry(
  scoreId: string,
  awardType: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `dist-${scoreId}-${awardType}`,
    scoreId,
    eventId: 'event-1',
    participantId: 'participant-1',
    teamId: '',
    awardType,
    distributed: false,
    distributedAt: '',
    recordedBy: '',
    recordedByName: '',
    version: 0,
    ...overrides,
  };
}

const AVAILABLE_STORAGE = {
  available: true,
  status: 'AVAILABLE',
  table: 'DistributionTracking',
  reason: '',
  migrationStep: '',
};

const WINNERS_DATA = {
  events: [
    {
      eventId: 'event-1',
      eventCode: 'LIT-006',
      eventName: 'Quiz (S+SS)',
      category: 'LITERARY',
      mode: 'SOLO',
      eventStatus: 'ACTIVE',
      winners: [winner(1, 'Ana', 21.25, 'score-1'), winner(2, 'Bhavana', 21, 'score-2')],
    },
  ],
  totalEvents: 1,
  totalWinners: 2,
};

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('Certificates — physical distribution tracking', () => {
  let requests: RecordedRequest[];

  function stubBackend(handler: (body: RecordedRequest) => StubResponse | Promise<StubResponse>): void {
    requests = [];
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as RecordedRequest;
      requests.push({ action: body.action, payload: body.payload ?? {} });
      return Promise.resolve(handler(body)).then(response =>
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  }

  /** A stub store so saves persist across the list reads (and reloads). */
  function stubWithStore(): { saved: Record<string, Record<string, unknown>> } {
    const saved: Record<string, Record<string, unknown>> = {};

    stubBackend(body => {
      if (body.action === 'listWinners') return ok(WINNERS_DATA);
      if (body.action === 'getPageData') {
        return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
      }
      if (body.action === 'listDistributionTracking') {
        const distributions = ['score-1', 'score-2'].flatMap(scoreId =>
          ['MEDAL', 'CERTIFICATE'].map(awardType => {
            const key = `${scoreId}|${awardType}`;
            return saved[key] ?? distributionEntry(scoreId, awardType);
          }),
        );
        return ok({
          storage: AVAILABLE_STORAGE,
          distributions,
          recordedCount: distributions.filter(entry => entry['distributed']).length,
          totalWinners: 2,
        });
      }
      if (body.action === 'saveDistributionStatus') {
        const payload = body.payload as {
          scoreId: string;
          awardType: string;
          distributed: boolean;
        };
        const key = `${payload.scoreId}|${payload.awardType}`;
        const previous = saved[key];
        const entry = distributionEntry(payload.scoreId, payload.awardType, {
          id: (previous?.['id'] as string) ?? `dist-${payload.scoreId}-${payload.awardType}`,
          distributed: payload.distributed,
          distributedAt: payload.distributed ? '2026-10-25T11:42:00.000Z' : (previous?.['distributedAt'] ?? ''),
          recordedBy: payload.distributed ? 'spec-user' : (previous?.['recordedBy'] ?? ''),
          recordedByName: payload.distributed ? 'Test User' : (previous?.['recordedByName'] ?? ''),
          version: ((previous?.['version'] as number) ?? 0) + 1,
        });
        saved[key] = entry;
        return ok({ distribution: entry });
      }
      return fail('UNKNOWN_ACTION', 'unexpected action ' + body.action);
    });

    return { saved };
  }

  async function setupPage(role = 'ADMIN'): Promise<ComponentFixture<Certificates>> {
    await TestBed.configureTestingModule({ imports: [Certificates] }).compileComponents();

    const auth = TestBed.inject(AuthService);
    auth.setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google-id',
      email: 'tester@nakshatra.local',
      displayName: 'Test User',
      role,
      accessStatus: 'APPROVED',
      version: 1,
    } as never);
    auth.setApplicationSession({
      id: 'spec-session',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    return TestBed.createComponent(Certificates);
  }

  function rowCheckboxes(host: HTMLElement, rowIndex = 0): HTMLInputElement[] {
    const rows = Array.from(host.querySelectorAll('tbody tr'));
    return Array.from(rows[rowIndex].querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('checkboxes reflect the saved states with the timestamp and who recorded it', async () => {
    stubBackend(body => {
      if (body.action === 'listWinners') return ok(WINNERS_DATA);
      if (body.action === 'getPageData') {
        return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
      }
      return ok({
        storage: AVAILABLE_STORAGE,
        distributions: [
          distributionEntry('score-1', 'MEDAL', {
            distributed: true,
            distributedAt: '2026-10-25T11:42:00.000Z',
            recordedBy: 'user-praveen',
            recordedByName: 'Praveen (E2E)',
            version: 1,
          }),
          distributionEntry('score-1', 'CERTIFICATE'),
          distributionEntry('score-2', 'MEDAL'),
          distributionEntry('score-2', 'CERTIFICATE'),
        ],
        recordedCount: 1,
        totalWinners: 2,
      });
    });

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const [medal, certificate] = rowCheckboxes(host);

    expect(medal.checked).toBe(true);
    expect(certificate.checked).toBe(false);

    const stateText = host.textContent ?? '';
    expect(stateText).toContain('Distributed —');
    expect(stateText).toMatch(/\d{1,2} Oct 2026, \d{1,2}:\d{2} [AP]M/);
    expect(stateText).toContain('by Praveen (E2E)');
    expect(stateText).toContain('Not distributed');
    expect(stateText).not.toContain('Unavailable');
  });

  it('persists medal and certificate independently and toasts only after the backend confirms', async () => {
    stubWithStore();

    const fixture = await setupPage();
    const notifications = TestBed.inject(NotificationService);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const [medal, certificate] = rowCheckboxes(host);

    // A slow backend confirms nothing yet: no success toast while pending.
    medal.click();
    fixture.detectChanges();
    expect(notifications.notifications().filter(item => item.tone === 'success')).toHaveLength(0);
    expect((host.textContent ?? '').includes('Saving…') || medal.disabled).toBe(true);

    await flush();
    fixture.detectChanges();

    const medalRequest = requests.find(item => item.action === 'saveDistributionStatus');
    expect(medalRequest?.payload).toMatchObject({
      scoreId: 'score-1',
      awardType: 'MEDAL',
      distributed: true,
      expectedVersion: 0,
    });
    expect(notifications.notifications().some(item => item.tone === 'success')).toBe(true);
    expect(medal.checked).toBe(true);
    expect((host.textContent ?? '')).toContain('by Test User');

    // The certificate row is untouched by the medal save (independent).
    expect(certificate.checked).toBe(false);

    // Rapid repeat clicks while saving cannot duplicate the request.
    certificate.click();
    certificate.click();
    await flush();
    fixture.detectChanges();

    const saves = requests.filter(item => item.action === 'saveDistributionStatus');
    expect(saves).toHaveLength(2);
    expect(saves[1].payload).toMatchObject({ scoreId: 'score-1', awardType: 'CERTIFICATE', distributed: true });
    expect(certificate.checked).toBe(true);

    // The medal record survived the certificate save untouched.
    const lastSave = TestBed.inject(DistributionService);
    expect(lastSave.entryFor('score-1', 'MEDAL')?.distributed).toBe(true);
    expect(lastSave.entryFor('score-1', 'CERTIFICATE')?.distributed).toBe(true);
  });

  it('a reload restores the persisted statuses from the backend', async () => {
    stubWithStore();

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    rowCheckboxes(fixture.nativeElement as HTMLElement)[0].click();
    await flush();
    fixture.detectChanges();

    // Full reload: a fresh module, fresh services, state re-read from the
    // stub backend store.
    fixture.destroy();
    TestBed.resetTestingModule();
    const reloaded = await setupPage();
    reloaded.detectChanges();
    await flush();
    reloaded.detectChanges();

    const host = reloaded.nativeElement as HTMLElement;
    const [medal, certificate] = rowCheckboxes(host);
    expect(medal.checked).toBe(true);
    expect(certificate.checked).toBe(false);
    expect(host.textContent).toContain('by Test User');
  });

  it('a rejected write restores the last confirmed state and offers no false success', async () => {
    stubBackend(body => {
      if (body.action === 'listWinners') return ok(WINNERS_DATA);
      if (body.action === 'getPageData') {
        return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
      }
      if (body.action === 'listDistributionTracking') {
        return ok({
          storage: AVAILABLE_STORAGE,
          distributions: [
            distributionEntry('score-1', 'MEDAL'),
            distributionEntry('score-1', 'CERTIFICATE'),
            distributionEntry('score-2', 'MEDAL'),
            distributionEntry('score-2', 'CERTIFICATE'),
          ],
          recordedCount: 0,
          totalWinners: 2,
        });
      }
      return fail('VERSION_CONFLICT', 'This distribution status was changed by someone else. Reload and try again.');
    });

    const fixture = await setupPage();
    const notifications = TestBed.inject(NotificationService);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const [medal] = rowCheckboxes(host);

    medal.click();
    await flush();
    fixture.detectChanges();

    // No false success: the checkbox is restored to the confirmed state.
    expect(medal.checked).toBe(false);
    expect(notifications.notifications().some(item => item.tone === 'success')).toBe(false);
    expect(notifications.notifications().some(item => item.tone === 'error')).toBe(true);
    expect(host.textContent).toContain('changed by someone else');
    // Rule rejection: retrying the same write cannot succeed, so no Retry.
    expect(host.querySelector('[data-testid="distribution-retry"]')).toBeNull();
  });

  it('an unconfirmed failure is marked unsaved and Retry re-attempts it safely', async () => {
    let saveFails = true;
    stubBackend(body => {
      if (body.action === 'listWinners') return ok(WINNERS_DATA);
      if (body.action === 'getPageData') {
        return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
      }
      if (body.action === 'listDistributionTracking') {
        return ok({
          storage: AVAILABLE_STORAGE,
          distributions: [
            distributionEntry('score-1', 'MEDAL'),
            distributionEntry('score-1', 'CERTIFICATE'),
            distributionEntry('score-2', 'MEDAL'),
            distributionEntry('score-2', 'CERTIFICATE'),
          ],
          recordedCount: 0,
          totalWinners: 2,
        });
      }
      if (saveFails) return fail('NETWORK_ERROR', 'Unable to reach the server. Please try again.');
      return ok({
        distribution: distributionEntry('score-1', 'MEDAL', {
          distributed: true,
          distributedAt: '2026-10-25T11:42:00.000Z',
          recordedBy: 'spec-user',
          recordedByName: 'Test User',
          version: 1,
        }),
      });
    });

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const [medal] = rowCheckboxes(host);

    medal.click();
    await flush();
    fixture.detectChanges();

    // Unconfirmed: the change is clearly marked as not saved, with Retry.
    expect(medal.checked).toBe(false);
    expect(host.textContent).toContain('not confirmed');
    expect(host.querySelector('[data-testid="distribution-retry"]')).not.toBeNull();

    saveFails = false;
    (host.querySelector('[data-testid="distribution-retry"]') as HTMLButtonElement).click();
    await flush();
    fixture.detectChanges();

    expect(medal.checked).toBe(true);
    expect(host.textContent).toContain('by Test User');
    expect(TestBed.inject(NotificationService).notifications().some(item => item.tone === 'success')).toBe(true);
  });

  for (const role of ['LIAISON_TEAM', 'EVENTS_TEAM']) {
    it(`${role} cannot edit distribution (view-only, writes rejected in the UI)`, async () => {
      stubWithStore();

      const fixture = await setupPage(role);
      fixture.detectChanges();
      await flush();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('View-only access');

      for (const checkbox of rowCheckboxes(host)) {
        expect(checkbox.disabled).toBe(true);
      }

      // An attempted toggle (even a forced one) never sends a write.
      const [medal] = rowCheckboxes(host);
      medal.dispatchEvent(new Event('change'));
      await flush();
      fixture.detectChanges();

      expect(requests.some(item => item.action === 'saveDistributionStatus')).toBe(false);
      expect(medal.checked).toBe(false);
      expect(host.textContent).toContain('Not distributed');
    });
  }

  it('missing storage is named precisely and winners still load', async () => {
    stubBackend(body => {
      if (body.action === 'listWinners') return ok(WINNERS_DATA);
      if (body.action === 'getPageData') {
        return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
      }
      return ok({
        storage: {
          available: false,
          status: 'TABLE_MISSING',
          table: 'DistributionTracking',
          reason: 'DistributionTracking sheet is missing from the Nakshatra database.',
          migrationStep:
            'Create the sheet "DistributionTracking" with the exact header from ' +
            'backend-verification/proposals/distribution-tracking-migration.md ' +
            '(or run initializeDatabase() after deploying this Code.gs version).',
        },
        distributions: [],
        recordedCount: 0,
        totalWinners: 0,
      });
    });

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;

    // The winners list loads regardless of the tracking failure.
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(host.textContent).toContain('Quiz (S+SS)');

    // The missing storage is named, with the exact migration step.
    expect(host.textContent).toContain('Distribution tracking storage is missing.');
    expect(host.textContent).toContain('DistributionTracking');
    expect(host.textContent).toContain('Create the sheet');
    // Never misread as "nothing recorded" and never a false default.
    expect(host.textContent).not.toContain('No distributions recorded yet');
    expect(host.textContent).toContain('Unavailable');
    for (const checkbox of rowCheckboxes(host)) {
      expect(checkbox.disabled).toBe(true);
    }
  });

  it('a schema mismatch and a failed read are shown as their own states', async () => {
    let mode: 'incompatible' | 'read-error' = 'incompatible';
    stubBackend(body => {
      if (body.action === 'listWinners') return ok(WINNERS_DATA);
      if (body.action === 'getPageData') {
        return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
      }
      if (mode === 'incompatible') {
        return ok({
          storage: {
            available: false,
            status: 'SCHEMA_INCOMPATIBLE',
            table: 'DistributionTracking',
            reason: 'DistributionTracking sheet is missing required columns: scoreId',
            migrationStep: 'Create the sheet "DistributionTracking" with the exact header.',
          },
          distributions: [],
          recordedCount: 0,
          totalWinners: 0,
        });
      }
      return fail('NETWORK_ERROR', 'Unable to reach the server. Please try again.');
    });

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('does not match the expected layout');
    expect(host.textContent).toContain('scoreId');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);

    // A failed read is its own retryable state - not "nothing recorded".
    mode = 'read-error';
    await fixture.componentInstance.retryTracking();
    fixture.detectChanges();

    expect(host.textContent).toContain('Distribution statuses could not be read.');
    expect(host.textContent).not.toContain('No distributions recorded yet');
    expect(
      Array.from(host.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Retry'),
    ).toBe(true);
  });

  it('keeps winners, scores and the Print List intact and adds no generation actions', async () => {
    stubWithStore();

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;

    // Scores stay in the row exactly as before (one-decimal rule).
    const cells = Array.from(host.querySelectorAll('tbody tr'))
      .map(row => (row.querySelector('td:last-child')?.textContent ?? '').trim());
    expect(cells).toEqual(['21.3', '21']);

    // Event grouping and the Print List control are unchanged.
    expect(host.textContent).toContain('Quiz (S+SS)');
    expect(host.textContent).toContain('LIT-006');
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Print list')).toBe(true);

    // No certificate generation/issuance controls or actions appear.
    expect(host.textContent).not.toMatch(/generate|issue certificate/i);
    expect(Array.from(host.querySelectorAll('button')).map(button => button.textContent?.trim()))
      .not.toContain('Generate');

    rowCheckboxes(host)[0].click();
    await flush();
    fixture.detectChanges();

    const actions = requests.map(item => item.action);
    expect(actions).toContain('listDistributionTracking');
    expect(actions).toContain('saveDistributionStatus');
    expect(actions).not.toContain('issueCertificate');
    expect(actions).not.toContain('listCertificates');
  });
});
