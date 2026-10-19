import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../core/services/auth/auth.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { formatScore } from '../../shared/score-format';
import { Results } from './results';

const EVENT = {
  id: 'event-1',
  eventCode: 'LIT-006',
  name: 'Quiz (S+SS)',
  category: 'LITERARY',
  mode: 'SOLO',
  status: 'ACTIVE',
  eligibleLevels: ['JUNIOR'],
};

function resultRow(id: string, score: number): Record<string, unknown> {
  return {
    scoreId: id,
    eventId: 'event-1',
    eventCode: 'LIT-006',
    eventName: 'Quiz (S+SS)',
    category: 'LITERARY',
    mode: 'SOLO',
    fullName: id,
    score,
  };
}

function finalizedScore(id: string, value: number): Record<string, unknown> {
  return {
    id,
    eventId: 'event-1',
    participantId: `participant-${id}`,
    value,
    status: 'FINALIZED',
    version: 1,
    createdAt: '',
    createdBy: '',
    updatedAt: '',
    updatedBy: '',
  };
}

/**
 * Official score display rule: one decimal place where necessary. The value
 * comes from the backend (the arithmetic average of the judges' submitted
 * totals) and is rendered, never recomputed here.
 */
describe('formatScore — official score display rule', () => {
  it('renders at most one decimal and drops a whole number’s ".0"', () => {
    expect(formatScore(21.5)).toBe('21.5');
    expect(formatScore(21)).toBe('21');
    expect(formatScore(21.0)).toBe('21');
    expect(formatScore(0)).toBe('0');
    expect(formatScore(10)).toBe('10');
  });

  it('rounds a multi-decimal average to one decimal place', () => {
    expect(formatScore(21.25)).toBe('21.3');
    expect(formatScore(21.75)).toBe('21.8');
    expect(formatScore(15.25)).toBe('15.3');
  });
});

describe('Results — official score display', () => {
  let fixture: ComponentFixture<Results>;

  function stubBackend(overrides: Record<string, unknown>): void {
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      const ok = (data: unknown) => Promise.resolve(new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

      if (request.action in overrides) return ok(overrides[request.action]);
      if (request.action === 'listResults') return ok({ results: [] });
      if (request.action === 'listEvents') return ok({ events: [EVENT] });
      if (request.action === 'listScores') return ok({ scores: [] });
      if (request.action === 'listEventRegistrations') return ok({ participantEvents: [] });
      if (request.action === 'listAttendance') return ok({ attendance: [] });
      if (request.action === 'listEventJudges') return ok({ judges: [] });
      if (request.action === 'listJudgeScores') return ok({ scores: [] });
      if (request.action === 'getPageData') {
        return ok({ shelterHomes: [], participants: [], imports: [], validationResults: [] });
      }
      return ok({});
    });
  }

  async function render(overrides: Record<string, unknown>): Promise<HTMLElement> {
    stubBackend(overrides);

    fixture = TestBed.createComponent(Results);
    fixture.detectChanges();
    // The stubbed fetch chain is microtask-only; one macrotask lets it drain.
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Results],
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('renders ranking boards with one decimal where necessary (21.3, never 21.0)', async () => {
    const host = await render({
      listResults: { results: [resultRow('a', 21.25), resultRow('b', 21)] },
    });

    const cells = Array.from(host.querySelectorAll('.entry-score'))
      .map(cell => (cell.textContent ?? '').trim());
    expect(cells).toEqual(['21.3', '21']);
    expect(host.textContent).not.toContain('21.25');
    expect(host.textContent).not.toContain('21.0');
  });

  it('renders the finalized-score table with the same rule', async () => {
    stubBackend({
      listScores: { scores: [finalizedScore('a', 21.25), finalizedScore('b', 21)] },
    });

    fixture = TestBed.createComponent(Results);
    fixture.detectChanges();
    await fixture.whenStable();

    // The event catalogue backs the selection before rows are ranked.
    await TestBed.inject(ShelterDataService).loadEvents();

    const component = fixture.componentInstance;
    component.selectedEventId.set('event-1');
    await component.loadEvent('event-1');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const cells = Array.from(host.querySelectorAll('td.score'))
      .map(cell => (cell.textContent ?? '').trim());
    expect(cells).toEqual(['21.3', '21']);
    expect(host.textContent).not.toContain('21.25');
  });
});
