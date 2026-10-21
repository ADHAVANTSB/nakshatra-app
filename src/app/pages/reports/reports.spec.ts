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
