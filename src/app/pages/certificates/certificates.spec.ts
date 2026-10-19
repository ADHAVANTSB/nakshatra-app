import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { Certificates } from './certificates';

function winner(position: number, name: string, score: number): Record<string, unknown> {
  return {
    position,
    name,
    className: '5',
    level: 'JUNIOR',
    shelterHomeName: 'Sunrise Home',
    score,
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
