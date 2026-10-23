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
    const scores = Array.from(host.querySelectorAll('.winner-score'))
      .map(span => (span.textContent ?? '').trim());
    expect(scores).toEqual(['21.3', '21']);
    expect(host.textContent).not.toContain('21.25');
    expect(host.textContent).not.toContain('21.0');
  });
});

// =====================================================================
// Certificate workflow tracking: Certificate WRITTEN (prepared) and
// Certificate DISTRIBUTED (handed over). Every status shown is
// backend-confirmed (server timestamp + recording user); a failed save
// never shows false success; distribution before written is rejected;
// print/export/view never record a status.
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

describe('Certificates — written/distributed workflow tracking', () => {
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

  /**
   * A stub store with the REAL backend rules: three award types per
   * winner (MEDAL, CERTIFICATE_WRITTEN, CERTIFICATE - the page shows
   * only the two certificate states and ignores MEDAL) and the
   * written-before-distributed rejection.
   */
  function stubWithStore(): { saved: Record<string, Record<string, unknown>> } {
    const saved: Record<string, Record<string, unknown>> = {};

    stubBackend(body => {
      if (body.action === 'listWinners') return ok(WINNERS_DATA);
      if (body.action === 'getPageData') {
        return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
      }
      if (body.action === 'listDistributionTracking') {
        const distributions = ['score-1', 'score-2'].flatMap(scoreId =>
          ['MEDAL', 'CERTIFICATE_WRITTEN', 'CERTIFICATE'].map(awardType => {
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
        const writtenKey = `${payload.scoreId}|CERTIFICATE_WRITTEN`;
        const previous = saved[key];

        // The real backend rule: distributed only after written.
        if (
          payload.awardType === 'CERTIFICATE' &&
          payload.distributed &&
          saved[writtenKey]?.['distributed'] !== true
        ) {
          return fail('CERTIFICATE_NOT_WRITTEN', 'Mark the certificate as written before recording its distribution.');
        }

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
    const rows = Array.from(host.querySelectorAll('tbody tr:not(.empty-row)'));
    return Array.from(rows[rowIndex].querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  }

  /** Data rows only (the empty-state row is not a winner row). */
  function dataRows(host: HTMLElement): Element[] {
    return Array.from(host.querySelectorAll('tbody tr:not(.empty-row)'));
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
          distributionEntry('score-1', 'CERTIFICATE_WRITTEN', {
            distributed: true,
            distributedAt: '2026-10-25T11:42:00.000Z',
            recordedBy: 'user-praveen',
            recordedByName: 'Praveen (E2E)',
            version: 1,
          }),
          distributionEntry('score-1', 'CERTIFICATE'),
          distributionEntry('score-2', 'CERTIFICATE_WRITTEN'),
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
    const [written, distributed] = rowCheckboxes(host);

    expect(written.checked).toBe(true);
    expect(distributed.checked).toBe(false);

    const stateText = host.textContent ?? '';
    expect(stateText).toContain('Written —');
    expect(stateText).toMatch(/\d{1,2} Oct 2026, \d{1,2}:\d{2} [AP]M/);
    expect(stateText).toContain('by Praveen (E2E)');
    expect(stateText).toContain('Not distributed');
    expect(stateText).toContain('Not written');
    expect(stateText).not.toContain('Unavailable');
  });

  it('a certificate cannot be distributed before it is written (UI gate + backend rejection)', async () => {
    stubWithStore();

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const [written, distributed] = rowCheckboxes(host);

    // UI gate: the distributed checkbox is disabled while not written.
    expect(distributed.disabled).toBe(true);
    expect(host.textContent).toContain('Written first');

    // Belt-and-braces: even a forced change sends nothing while the
    // ordering rule is unmet, and the backend rejects it too.
    distributed.checked = true;
    distributed.dispatchEvent(new Event('change'));
    await flush();
    fixture.detectChanges();

    expect(requests.some(item => item.action === 'saveDistributionStatus')).toBe(false);

    // Writing first unlocks distribution.
    written.click();
    await flush();
    fixture.detectChanges();

    expect(rowCheckboxes(host)[1].disabled).toBe(false);
  });

  it('persists written and distributed independently and toasts only after the backend confirms', async () => {
    stubWithStore();

    const fixture = await setupPage();
    const notifications = TestBed.inject(NotificationService);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const [written, distributed] = rowCheckboxes(host);

    // A slow backend confirms nothing yet: no success toast while pending.
    written.click();
    fixture.detectChanges();
    expect(notifications.notifications().filter(item => item.tone === 'success')).toHaveLength(0);
    expect((host.textContent ?? '').includes('Saving…') || written.disabled).toBe(true);

    await flush();
    fixture.detectChanges();

    const writtenRequest = requests.find(item => item.action === 'saveDistributionStatus');
    expect(writtenRequest?.payload).toMatchObject({
      scoreId: 'score-1',
      awardType: 'CERTIFICATE_WRITTEN',
      distributed: true,
      expectedVersion: 0,
    });
    expect(notifications.notifications().some(item => item.tone === 'success')).toBe(true);
    expect(written.checked).toBe(true);
    expect((host.textContent ?? '')).toContain('by Test User');

    // Rapid repeat clicks while saving cannot duplicate the request.
    distributed.click();
    distributed.click();
    await flush();
    fixture.detectChanges();

    const saves = requests.filter(item => item.action === 'saveDistributionStatus');
    expect(saves).toHaveLength(2);
    expect(saves[1].payload).toMatchObject({ scoreId: 'score-1', awardType: 'CERTIFICATE', distributed: true });
    expect(rowCheckboxes(host)[1].checked).toBe(true);

    // The written record survived the distributed save untouched.
    const service = TestBed.inject(DistributionService);
    expect(service.entryFor('score-1', 'CERTIFICATE_WRITTEN')?.distributed).toBe(true);
    expect(service.entryFor('score-1', 'CERTIFICATE')?.distributed).toBe(true);
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
    const [written, distributed] = rowCheckboxes(host);
    expect(written.checked).toBe(true);
    expect(distributed.checked).toBe(false);
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
            distributionEntry('score-1', 'CERTIFICATE_WRITTEN'),
            distributionEntry('score-1', 'CERTIFICATE'),
            distributionEntry('score-2', 'CERTIFICATE_WRITTEN'),
            distributionEntry('score-2', 'CERTIFICATE'),
          ],
          recordedCount: 0,
          totalWinners: 2,
        });
      }
      return fail('VERSION_CONFLICT', 'This certificate status was changed by someone else. Reload and try again.');
    });

    const fixture = await setupPage();
    const notifications = TestBed.inject(NotificationService);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const [written] = rowCheckboxes(host);

    written.click();
    await flush();
    fixture.detectChanges();

    // No false success: the checkbox is restored to the confirmed state.
    expect(written.checked).toBe(false);
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
            distributionEntry('score-1', 'CERTIFICATE_WRITTEN'),
            distributionEntry('score-1', 'CERTIFICATE'),
            distributionEntry('score-2', 'CERTIFICATE_WRITTEN'),
            distributionEntry('score-2', 'CERTIFICATE'),
          ],
          recordedCount: 0,
          totalWinners: 2,
        });
      }
      if (saveFails) return fail('NETWORK_ERROR', 'Unable to reach the server. Please try again.');
      return ok({
        distribution: distributionEntry('score-1', 'CERTIFICATE_WRITTEN', {
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
    const [written] = rowCheckboxes(host);

    written.click();
    await flush();
    fixture.detectChanges();

    // Unconfirmed: the change is clearly marked as not saved, with Retry.
    expect(written.checked).toBe(false);
    expect(host.textContent).toContain('not confirmed');
    expect(host.querySelector('[data-testid="distribution-retry"]')).not.toBeNull();

    saveFails = false;
    (host.querySelector('[data-testid="distribution-retry"]') as HTMLButtonElement).click();
    await flush();
    fixture.detectChanges();

    expect(rowCheckboxes(host)[0].checked).toBe(true);
    expect(host.textContent).toContain('by Test User');
    expect(TestBed.inject(NotificationService).notifications().some(item => item.tone === 'success')).toBe(true);
  });

  for (const role of ['LIAISON_TEAM', 'EVENTS_TEAM']) {
    it(`${role} cannot edit certificate statuses (view-only, writes rejected in the UI)`, async () => {
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
      const [written] = rowCheckboxes(host);
      written.dispatchEvent(new Event('change'));
      await flush();
      fixture.detectChanges();

      expect(requests.some(item => item.action === 'saveDistributionStatus')).toBe(false);
      expect(written.checked).toBe(false);
      expect(host.textContent).toContain('Not written');
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
    expect(dataRows(host)).toHaveLength(2);
    expect(host.textContent).toContain('Quiz (S+SS)');

    // The missing storage is named, with the exact migration step.
    expect(host.textContent).toContain('Certificate status storage is missing.');
    expect(host.textContent).toContain('DistributionTracking');
    expect(host.textContent).toContain('Create the sheet');
    // Never misread as "nothing recorded" and never a false default.
    expect(host.textContent).not.toContain('No statuses recorded yet');
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
    expect(dataRows(host)).toHaveLength(2);

    // A failed read is its own retryable state - not "nothing recorded".
    mode = 'read-error';
    await fixture.componentInstance.retryTracking();
    fixture.detectChanges();

    expect(host.textContent).toContain('Certificate statuses could not be read.');
    expect(host.textContent).not.toContain('No statuses recorded yet');
    expect(
      Array.from(host.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Retry'),
    ).toBe(true);
  });

  it('the medal award type is never shown on the certificate page', async () => {
    stubWithStore();

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).not.toContain('Medal');
    expect(host.textContent).toContain('Certificate Written');
    expect(host.textContent).toContain('Certificate Distributed');
    expect(requests.filter(item => item.action === 'saveDistributionStatus')).toHaveLength(0);
  });

  it('summary cards count each winner once (eligible / written / distributed / pending)', async () => {
    stubWithStore();

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const summary = host.querySelector('[data-testid="certificate-summary"]');
    expect(summary?.textContent).toContain('2'); // 2 eligible winners
    expect(summary?.textContent).toContain('Pending writing');

    // Mark one written: summary moves one from pending writing to
    // written-but-not-distributed.
    rowCheckboxes(host)[0].click();
    await flush();
    fixture.detectChanges();

    const after = host.querySelector('[data-testid="certificate-summary"]')?.textContent ?? '';
    expect(after).toContain('Certificates written');
    expect(after).toContain('Written but not distributed');
  });

  it('the views separate written & distributed, pending distribution and pending writing', async () => {
    const { saved } = stubWithStore();
    saved['score-1|CERTIFICATE_WRITTEN'] = distributionEntry('score-1', 'CERTIFICATE_WRITTEN', {
      distributed: true,
      distributedAt: '2026-10-25T11:42:00.000Z',
      recordedBy: 'spec-user',
      recordedByName: 'Test User',
      version: 1,
    });
    saved['score-1|CERTIFICATE'] = distributionEntry('score-1', 'CERTIFICATE', {
      distributed: true,
      distributedAt: '2026-10-25T11:43:00.000Z',
      recordedBy: 'spec-user',
      recordedByName: 'Test User',
      version: 1,
    });
    saved['score-2|CERTIFICATE_WRITTEN'] = distributionEntry('score-2', 'CERTIFICATE_WRITTEN', {
      distributed: true,
      distributedAt: '2026-10-25T11:44:00.000Z',
      recordedBy: 'spec-user',
      recordedByName: 'Test User',
      version: 1,
    });

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="certificate-views"] button'));
    const clickView = (label: string) => {
      buttons.find(button => button.textContent?.trim() === label)?.click();
    };

    clickView('Written & Distributed');
    fixture.detectChanges();
    expect(dataRows(host)).toHaveLength(1);
    expect(host.textContent).toContain('Ana');

    clickView('Pending Distribution');
    fixture.detectChanges();
    expect(dataRows(host)).toHaveLength(1);
    expect(host.textContent).toContain('Bhavana');

    clickView('Pending Writing');
    fixture.detectChanges();
    expect(dataRows(host)).toHaveLength(0);

    clickView('All certificates');
    fixture.detectChanges();
    expect(dataRows(host)).toHaveLength(2);
  });

  it('filters narrow by position and written status without touching other rows', async () => {
    stubWithStore();

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;

    component.setPosition('1');
    fixture.detectChanges();
    expect(dataRows(host)).toHaveLength(1);
    expect(host.textContent).toContain('Ana');

    component.setPosition('');
    component.setWrittenFilter('WRITTEN');
    fixture.detectChanges();
    expect(dataRows(host)).toHaveLength(0);

    component.setWrittenFilter('NOT_WRITTEN');
    fixture.detectChanges();
    expect(dataRows(host)).toHaveLength(2);
  });

  it('print and export never record a status (no write, no auto-mark)', async () => {
    stubWithStore();
    vi.stubGlobal('print', vi.fn());
    let createdBlob: Blob | null = null;
    const originalCreate = (URL as unknown as Record<string, unknown>)['createObjectURL'];
    const originalRevoke = (URL as unknown as Record<string, unknown>)['revokeObjectURL'];
    (URL as unknown as Record<string, unknown>)['createObjectURL'] = (blob: Blob) => {
      createdBlob = blob;
      return 'blob:spec';
    };
    (URL as unknown as Record<string, unknown>)['revokeObjectURL'] = vi.fn();

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.print();
    fixture.componentInstance.exportCsv(false);
    fixture.componentInstance.exportCsv(true);
    await flush();
    fixture.detectChanges();

    expect(requests.some(item => item.action === 'saveDistributionStatus')).toBe(false);
    // Every status stays exactly as confirmed - nothing auto-marked.
    const [written, distributed] = rowCheckboxes(host);
    expect(written.checked).toBe(false);
    expect(distributed.checked).toBe(false);
    expect(host.textContent).toContain('Not written');

    // The CSV export is real and carries readable columns only.
    expect(createdBlob).not.toBeNull();
    const csv = await (createdBlob as unknown as Blob).text();
    expect(csv).toContain('Event');
    expect(csv).toContain('Certificate Written');
    expect(csv).not.toContain('score-1');
    expect(csv).not.toContain('participant-');

    (URL as unknown as Record<string, unknown>)['createObjectURL'] = originalCreate;
    (URL as unknown as Record<string, unknown>)['revokeObjectURL'] = originalRevoke;
  });

  it('keeps winners and the print control and adds no generation actions', async () => {
    stubWithStore();

    const fixture = await setupPage();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;

    // Scores stay in the row exactly as before (one-decimal rule).
    const scores = Array.from(host.querySelectorAll('.winner-score'))
      .map(span => (span.textContent ?? '').trim());
    expect(scores).toEqual(['21.3', '21']);

    // Event identity and the print/export controls are present.
    expect(host.textContent).toContain('Quiz (S+SS)');
    expect(host.textContent).toContain('LIT-006');
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Print this view')).toBe(true);

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
