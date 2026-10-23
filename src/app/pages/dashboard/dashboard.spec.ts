import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dashboard } from './dashboard';
import { AuthService } from '../../core/services/auth/auth.service';

/**
 * Quick actions must cover the whole event-day workflow in the same
 * order the sidebar uses: Events -> Attendance -> Judging -> Scoring ->
 * Results -> Certificates -> Reports.
 */
describe('Dashboard - quick actions', () => {
  let fixture: ComponentFixture<Dashboard>;
  let component: Dashboard;

  async function render(): Promise<void> {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      return Promise.resolve(new Response(
        JSON.stringify({ success: true, data: request.action === 'getDashboardSummary' ? {} : { shelterHomes: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

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

    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('offers a Certificates quick link in the sidebar workflow order', async () => {
    await render();

    const workflow = ['Events', 'Attendance', 'Judging', 'Scoring', 'Results', 'Certificates', 'Reports'];
    const labels = component.quickActions.map(action => action.label);

    // Every workflow step is present, in sidebar order.
    expect(labels.filter(label => workflow.includes(label))).toEqual(workflow);

    // The Certificates link targets the Certificates page and renders as a button.
    const certificates = component.quickActions.find(action => action.label === 'Certificates');
    expect(certificates?.path).toBe('/certificates');

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map(button => (button.textContent ?? '').trim());
    expect(buttons).toContain('Certificates');
  });
});
