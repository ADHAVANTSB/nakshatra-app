import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Reports } from './reports';
import { AuthService } from '../../core/services/auth/auth.service';

/**
 * Validation & Warning Centre tab (read-only).
 *
 * The tab renders the backend's aggregated warnings with severity,
 * plain-language explanation, affected row/field, suggested correction
 * and an Open navigation control. A failed check is reported as such -
 * an empty list is only shown as "all clear" when every check ran.
 */
describe('Reports - validation & warning centre', () => {
  let fixture: ComponentFixture<Reports>;
  let component: Reports;

  const WARNING = {
    severity: 'ERROR',
    code: 'SYNC_FAILED',
    entityType: 'IMPORT',
    entityLabel: 'Sunrise Home (AAI01)',
    relatedLabel: 'import v2 (2026-01-02)',
    message: 'The latest import of this home failed validation (2 error(s)).',
    field: '',
    rowReference: null,
    suggestedAction: 'Fix the reported rows in the source sheet and sync again.',
    resolved: false,
    link: { page: 'homes', filter: 'Sunrise Home (AAI01)' },
  };

  interface StubOptions {
    warnings?: unknown[];
    sources?: { name: string; status: 'OK' | 'FAILED'; detail?: string }[];
    complete?: boolean;
  }

  function stubBackend(options: StubOptions): { navigations: string[] } {
    const navigations: string[] = [];

    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'getValidationSummary':
          return ok({
            warnings: options.warnings ?? [],
            sources: options.sources ?? [{ name: 'participants', status: 'OK' }],
            complete: options.complete !== false,
          });
        case 'getPageData':
          return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
        case 'getDashboardSummary':
          return ok({});
        case 'getReports':
          return ok({});
        default:
          return ok({});
      }
    });

    return { navigations };
  }

  async function renderWarnings(options: StubOptions): Promise<void> {
    stubBackend(options);

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

    fixture = TestBed.createComponent(Reports);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    component.setTab('WARNINGS');
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.warningsState()).toBe('LOADED'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function pageText(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Reports],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('lists warnings with severity, explanation, suggestion and status', async () => {
    await renderWarnings({ warnings: [WARNING], complete: true });

    expect(pageText()).toContain('ERROR');
    expect(pageText()).toContain('The latest import of this home failed validation');
    expect(pageText()).toContain('Sunrise Home (AAI01)');
    expect(pageText()).toContain('Fix the reported rows in the source sheet and sync again.');
    expect(pageText()).toContain('Unresolved');
    expect(pageText()).toContain('Open');
  });

  it('shows "no open warnings" only when every check ran', async () => {
    await renderWarnings({ warnings: [], sources: [{ name: 'imports', status: 'OK' }], complete: true });

    expect(pageText()).toContain('No open warnings.');
    expect(pageText()).toContain('Every check ran and found nothing to report.');
    expect(pageText()).not.toContain('Some checks could not run.');
  });

  it('reports a failed check as incomplete, never as all clear', async () => {
    await renderWarnings({
      warnings: [],
      sources: [{ name: 'imports', status: 'FAILED', detail: 'sheet missing' }],
      complete: false,
    });

    expect(pageText()).toContain('Some checks could not run.');
    expect(pageText()).toContain('imports');
    expect(pageText()).not.toContain('Every check ran and found nothing to report.');
  });

  it('keeps internal ids out of the rendered warning text', async () => {
    await renderWarnings({ warnings: [WARNING], complete: true });

    const text = pageText();
    expect(text).not.toContain('participantId');
    expect(text).not.toContain('shelterHomeId');
  });

  it('navigates from a warning to the surface that fixes it', async () => {
    await renderWarnings({ warnings: [WARNING], complete: true });

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');

    const openButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find(button => (button.textContent ?? '').trim() === 'Open');

    expect(openButton).toBeTruthy();
    openButton!.click();

    // Page route only - never an internal record id.
    expect(navigate).toHaveBeenCalledWith(['/homes']);
  });
});

// =====================================================================
// Reports contract + Winners + Category/Level tabs (2026-10-23).
//
// Regression for the "Unable to load reports. Unknown report type"
// defect: every visible tab loads from the backend contract or shows a
// truthful error - never an empty success. Winners use ONLY finalized
// official results; the home view is factual (no champion formula).
// =====================================================================

describe('Reports â€” contract, winners and category/level', () => {
  let fixture: ComponentFixture<Reports>;
  let component: Reports;

  const WORKFLOW = {
    uniqueParticipantsRegistered: 12,
    registrations: 20,
    registrationsWithoutAttendance: 3,
    registrationsByCategory: { ARTS: 8, LITERARY: 7, CULTURAL: 5 },
    levelDistribution: { SUB_JUNIOR: 3, JUNIOR: 4, SENIOR: 3, SUPER_SENIOR: 2 },
    genderDistribution: { MALE: 7, FEMALE: 5, OTHER: 0 },
    eventsWithJudges: 4,
    judgeSubmissionsPending: 1,
    eventsAwaitingFinalization: 2,
    finalizedEvents: 3,
    resultsAwaitingApproval: 1,
    approvedResults: 2,
    returnedResults: 0,
    eligibleWinners: 6,
    certificatesWritten: null,
    certificatesDistributed: null,
    certificatesPendingWriting: null,
    certificatesPendingDistribution: null,
  };

  const WINNERS = {
    events: [
      {
        eventId: 'event-1',
        eventCode: 'LIT-004',
        eventName: 'Potpurri (Words Play)',
        category: 'LITERARY',
        mode: 'GROUP',
        eventStatus: 'ACTIVE',
        winners: [
          { position: 1, name: 'Team A', className: '', level: '', shelterHomeName: 'Sunrise Home', score: 18.5, scoreId: 's1', participantId: '', teamId: 't1' },
          { position: 2, name: 'Team B', className: '', level: '', shelterHomeName: 'Hope Home', score: 15, scoreId: 's2', participantId: '', teamId: 't2' },
        ],
      },
    ],
    totalEvents: 1,
    totalWinners: 2,
  };

  function stubBackend(options: { getReportsFails?: boolean } = {}): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string; payload?: Record<string, unknown> };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
      const failed = (code: string, message: string) => Promise.resolve(new Response(
        JSON.stringify({ success: false, error: { code, message } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'getPageData':
          return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
        case 'getDashboardSummary':
          return ok({
            summary: {
              homes: 2,
              participants: 12,
              events: 6,
              activeEvents: 6,
              registrations: 20,
              teams: 4,
              attendance: { recorded: 17, present: 15, absent: 2 },
              finalizedScores: 9,
              certificates: { generated: 2, issued: 1 },
              workflow: WORKFLOW,
            },
          });
        case 'getReports':
          if (options.getReportsFails) {
            return failed('UNKNOWN_REPORT', 'Unknown report type');
          }
          return ok({
            homes: [
              { id: 'h1', homeName: 'Sunrise Home', homeCode: 'AAI01', participants: 6, boys: 3, girls: 3, registrations: 10, teams: 2, attendance: { recorded: 9, present: 8, absent: 1 }, finalizedSoloScores: 3, participantCertificates: 1 },
              { id: 'h2', homeName: 'Hope Home', homeCode: 'AAI02', participants: 6, boys: 4, girls: 2, registrations: 10, teams: 2, attendance: { recorded: 8, present: 7, absent: 1 }, finalizedSoloScores: 3, participantCertificates: 1 },
            ],
            events: [
              { id: 'e1', eventCode: 'LIT-004', name: 'Potpurri (Words Play)', category: 'LITERARY', mode: 'GROUP', status: 'ACTIVE', registrations: 4, teams: 2, attendance: { recorded: 4, present: 4, absent: 0 }, finalizedScores: 2, certificates: { generated: 1, issued: 1 } },
            ],
            participants: [
              { id: 'p1', participantCode: 'NK26-P001', fullName: 'Asha', shelterHomeId: 'h1', homeName: 'Sunrise Home', homeCode: 'AAI01', level: 'SUB_JUNIOR', registrations: 2, attendance: { recorded: 2, present: 2, absent: 0 }, finalizedSoloScores: 1, certificates: 1 },
            ],
          });
        case 'listWinners':
          return ok(WINNERS);
        default:
          return ok({});
      }
    });
  }

  const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

  async function render(): Promise<void> {
    stubBackend();

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

    fixture = TestBed.createComponent(Reports);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.summary()).toBeTruthy());
    fixture.detectChanges();
  }

  function pageText(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Reports],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('every visible tab loads from the backend contract (no "Unknown report type")', async () => {
    await render();

    for (const tab of ['SUMMARY', 'HOMES', 'EVENTS', 'PARTICIPANTS', 'WINNERS', 'CATEGORY_LEVEL', 'WARNINGS'] as const) {
      component.setTab(tab);
      fixture.detectChanges();
      await flush();
      fixture.detectChanges();

      expect(pageText()).not.toContain('Unknown report type');
    }
  });

  it('the summary shows unique participants vs registrations and "Not available" for null figures', async () => {
    await render();

    expect(pageText()).toContain('Unique participants registered');
    expect(pageText()).toContain('12');
    expect(pageText()).toContain('20 registrations');
    // Null figures render as "Not available", never as a fake zero.
    expect(pageText()).toContain('Certificates written');
    expect(pageText()).toContain('Not available');
    expect(pageText()).toContain('Pending writing:');
  });

  it('the winners tab lists finalized winners by event and by shelter home without any champion formula', async () => {
    await render();
    component.setTab('WINNERS');
    fixture.detectChanges();
    await flush();
    await vi.waitFor(() => expect(component.winnersLoading()).toBe(false));
    fixture.detectChanges();

    expect(pageText()).toContain('Winners by event');
    expect(pageText()).toContain('Potpurri (Words Play)');
    expect(pageText()).toContain('Team A');
    expect(pageText()).toContain('Winners by shelter home');
    expect(pageText()).toContain('Sunrise Home');
    expect(pageText()).toContain('No home ranking or champion is computed');
  });

  it('the category & level tab reports categories and SJ/J/S/SS levels', async () => {
    await render();
    component.setTab('CATEGORY_LEVEL');
    fixture.detectChanges();
    await flush();
    await vi.waitFor(() => expect(component.winnersLoading()).toBe(false));
    fixture.detectChanges();

    expect(pageText()).toContain('By category');
    expect(pageText()).toContain('LITERARY');
    expect(pageText()).toContain('By level');
    expect(pageText()).toContain('Sub Junior');
    expect(pageText()).toContain('Super Senior');
  });

  it('a backend report failure shows the error state with Retry - never an empty success', async () => {
    stubBackend({ getReportsFails: true });

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

    fixture = TestBed.createComponent(Reports);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flush();

    component.setTab('HOMES');
    component.setCategory('LITERARY');
    fixture.detectChanges();
    await flush();
    await vi.waitFor(() => expect(component.rowsError()).toContain('Unknown report type'));
    fixture.detectChanges();

    expect(pageText()).toContain('Unable to load reports.');
    expect(pageText()).toContain('Unknown report type');

    // Retry/Reload preserve the selected report and filters.
    component.retryRows();
    fixture.detectChanges();
    expect(component.tab()).toBe('HOMES');
    expect(component.category()).toBe('LITERARY');
  });
});

// =====================================================================
// Level filter (SJ/J/S/SS/All) - page-only, like the Status/search
// filters. "All levels" (default) changes nothing; a selected level
// narrows the participant and winners rows and the CSV exports.
// =====================================================================

describe('Reports - level filter', () => {
  let fixture: ComponentFixture<Reports>;
  let component: Reports;

  const WINNERS = {
    events: [
      {
        eventId: 'event-1',
        eventCode: 'LIT-004',
        eventName: 'Potpurri (Words Play)',
        category: 'LITERARY',
        mode: 'GROUP',
        eventStatus: 'ACTIVE',
        winners: [
          { position: 1, name: 'Asha', className: '5A', level: 'JUNIOR', shelterHomeName: 'Sunrise Home', score: 18.5, scoreId: 's1', participantId: 'p1', teamId: '' },
          { position: 2, name: 'Ravi', className: '7B', level: 'SENIOR', shelterHomeName: 'Hope Home', score: 15, scoreId: 's2', participantId: 'p2', teamId: '' },
        ],
      },
    ],
    totalEvents: 1,
    totalWinners: 2,
  };

  const PARTICIPANTS = [
    { id: 'p1', participantCode: 'NK26-P001', fullName: 'Asha', shelterHomeId: 'h1', homeName: 'Sunrise Home', homeCode: 'AAI01', level: 'JUNIOR', registrations: 2, attendance: { recorded: 2, present: 2, absent: 0 }, finalizedSoloScores: 1, certificates: 1 },
    { id: 'p2', participantCode: 'NK26-P002', fullName: 'Ravi', shelterHomeId: 'h2', homeName: 'Hope Home', homeCode: 'AAI02', level: 'SENIOR', registrations: 3, attendance: { recorded: 3, present: 3, absent: 0 }, finalizedSoloScores: 2, certificates: 1 },
  ];

  function stubBackend(): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      switch (request.action) {
        case 'getPageData':
          return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
        case 'getDashboardSummary':
          return ok({ summary: { homes: 2, participants: 2, events: 1, activeEvents: 1, registrations: 5, teams: 0, attendance: { recorded: 5, present: 5, absent: 0 }, finalizedScores: 3, certificates: { generated: 2, issued: 2 } } });
        case 'getReports':
          return ok({
            homes: [],
            events: [],
            participants: PARTICIPANTS,
          });
        case 'listWinners':
          return ok(WINNERS);
        default:
          return ok({});
      }
    });
  }

  const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

  async function render(): Promise<void> {
    stubBackend();

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

    fixture = TestBed.createComponent(Reports);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.summary()).toBeTruthy());
    fixture.detectChanges();
  }

  function pageText(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Reports],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('offers a Level filter defaulting to "All levels"', async () => {
    await render();

    expect(component.level()).toBe('');

    const select = (fixture.nativeElement as HTMLElement).querySelector('#report-level');
    expect(select).toBeTruthy();
    const optionTexts = Array.from(select!.querySelectorAll('option')).map(
      option => (option.textContent ?? '').trim(),
    );
    expect(optionTexts[0]).toBe('All levels');
    expect(optionTexts.join(' | ')).toContain('SJ');
    expect(optionTexts.join(' | ')).toContain('SS');
  });

  it('"All levels" (the default) keeps every participant and winner row visible', async () => {
    await render();

    component.setTab('PARTICIPANTS');
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    expect(component.participantRows().map(row => row.fullName).sort()).toEqual(['Asha', 'Ravi']);

    component.setTab('WINNERS');
    fixture.detectChanges();
    await flush();
    await vi.waitFor(() => expect(component.winnersLoading()).toBe(false));
    fixture.detectChanges();

    expect(component.winnerRows().map(row => row.name).sort()).toEqual(['Asha', 'Ravi']);
  });

  it('a selected level narrows the participant and winners rows client-side', async () => {
    await render();

    component.setTab('PARTICIPANTS');
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();

    component.setLevel('JUNIOR');
    fixture.detectChanges();

    expect(component.participantRows().map(row => row.fullName)).toEqual(['Asha']);
    expect(pageText()).toContain('Asha');
    expect(pageText()).not.toContain('Ravi');

    component.setTab('WINNERS');
    fixture.detectChanges();
    await flush();
    await vi.waitFor(() => expect(component.winnersLoading()).toBe(false));
    fixture.detectChanges();

    expect(component.winnerRows().map(row => row.name)).toEqual(['Asha']);
    expect(pageText()).not.toContain('Ravi');

    // Back to "All levels" restores every row.
    component.setLevel('');
    fixture.detectChanges();
    expect(component.winnerRows().map(row => row.name).sort()).toEqual(['Asha', 'Ravi']);
  });

  it('the winners CSV export carries the level filter', async () => {
    await render();

    component.setTab('WINNERS');
    fixture.detectChanges();
    await flush();
    await vi.waitFor(() => expect(component.winnersLoading()).toBe(false));
    fixture.detectChanges();

    const blobs: Blob[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      blobs.push(blob);
      return 'blob:reports-spec';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as unknown as typeof URL.revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    try {
      component.setLevel('JUNIOR');
      component.exportCsv('winners');
      const filteredCsv = await blobs[0].text();
      expect(filteredCsv).toContain('Asha');
      expect(filteredCsv).not.toContain('Ravi');

      component.setLevel('');
      component.exportCsv('winners');
      const allCsv = await blobs[1].text();
      expect(allCsv).toContain('Asha');
      expect(allCsv).toContain('Ravi');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });
});
