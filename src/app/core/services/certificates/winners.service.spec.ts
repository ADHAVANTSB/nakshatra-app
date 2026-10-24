import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientService } from '../api/api-client.service';
import { ProgramContextService } from '../program/program-context.service';
import { WinnersService } from './winners.service';

const REPORT = {
  events: [{
    eventId: 'event-1',
    eventCode: 'LIT-006',
    eventName: 'Quiz (S+SS)',
    category: 'LITERARY',
    mode: 'SOLO',
    eventStatus: 'ACTIVE',
    winners: [{
      position: 1,
      name: 'Ana',
      age: '9',
      className: '5',
      level: 'JUNIOR',
      shelterHomeName: 'Sunrise Home',
      score: 21.3,
      scoreId: 'score-1',
      participantId: 'participant-1',
      teamId: '',
    }],
  }],
  totalEvents: 1,
  totalWinners: 1,
};

/**
 * Scope isolation: the winners report is scoped to the session's
 * programme/environment. A read that started in one scope must never land
 * after the scope switched - the previous zone's winners are dropped.
 */
describe('WinnersService - scope isolation', () => {
  it('drops a winners read that lands after the programme/zone scope changed', async () => {
    let scopeVersion = 1;
    const apiClient = {
      listWinners: vi.fn(async () => {
        // The zone switches while the request is in flight.
        scopeVersion = 2;
        return { success: true, data: REPORT };
      }),
    };
    const programContext = { scopeVersion: vi.fn(() => scopeVersion), onScopeChange: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        WinnersService,
        { provide: ApiClientService, useValue: apiClient },
        { provide: ProgramContextService, useValue: programContext },
      ],
    });

    const service = TestBed.inject(WinnersService);
    const result = await service.load();

    expect(result).toBeNull();
    expect(service.report$()).toBeNull();
  });

  it('lands the report normally while the scope stays the same', async () => {
    const apiClient = {
      listWinners: vi.fn(async () => ({ success: true, data: REPORT })),
    };
    let onScopeChange: (() => void) | undefined;
    const programContext = {
      scopeVersion: vi.fn(() => 1),
      onScopeChange: vi.fn((callback: () => void) => {
        onScopeChange = callback;
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        WinnersService,
        { provide: ApiClientService, useValue: apiClient },
        { provide: ProgramContextService, useValue: programContext },
      ],
    });

    const service = TestBed.inject(WinnersService);
    const result = await service.load();

    expect(result).toEqual(REPORT);
    expect(service.report$()).toEqual(REPORT);

    // A scope change drops the cached report so another zone's winners
    // are never displayed.
    onScopeChange?.();
    expect(service.report$()).toBeNull();
  });
});
