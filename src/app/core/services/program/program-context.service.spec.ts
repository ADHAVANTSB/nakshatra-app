import { beforeEach, describe, expect, it } from 'vitest';

import { PROGRAM_SCOPE_STORAGE_KEY } from '../../constants/program-context.config';
import { ProgramContextService } from './program-context.service';

/**
 * Program/zone scope context tests.
 *
 * The scope is chosen after sign-in (program → zone), kept in sessionStorage so
 * a refresh or deep link keeps it, and must never silently reuse a zone that
 * was not explicitly re-selected after a program switch.
 */

describe('ProgramContextService', () => {
  let service: ProgramContextService;

  /**
   * A genuine new instance (the service has no injected dependencies), so the
   * constructor actually re-reads sessionStorage instead of reusing the
   * file-shared TestBed singleton.
   */
  const newService = (): ProgramContextService => new ProgramContextService();

  beforeEach(() => {
    sessionStorage.clear();
    service = newService();
  });

  it('starts with no program and no zone', () => {
    expect(service.program()).toBeNull();
    expect(service.zone()).toBeNull();
    expect(service.scope()).toBeNull();
    expect(service.hasCompleteScope()).toBe(false);
  });

  it('completes the scope after selecting a program and a zone', () => {
    service.selectProgram('ARTS');
    expect(service.program()?.id).toBe('ARTS');
    expect(service.zone()).toBeNull();
    expect(service.hasCompleteScope()).toBe(false);

    service.selectZone('ZONE_1');
    expect(service.zone()?.id).toBe('ZONE_1');
    expect(service.hasCompleteScope()).toBe(true);
    expect(service.scope()?.program.id).toBe('ARTS');
    expect(service.scope()?.zone.id).toBe('ZONE_1');
  });

  it('persists the scope to sessionStorage and restores it in a new instance', () => {
    service.selectProgram('SPORTS');
    service.selectZone('ZONE_2');

    const restored = newService();
    expect(restored.program()?.id).toBe('SPORTS');
    expect(restored.zone()?.id).toBe('ZONE_2');
    expect(restored.hasCompleteScope()).toBe(true);

    const stored = JSON.parse(
      sessionStorage.getItem(PROGRAM_SCOPE_STORAGE_KEY) ?? 'null',
    ) as { programId: string; zoneId: string };
    expect(stored).toEqual({ programId: 'SPORTS', zoneId: 'ZONE_2' });
  });

  it('selecting a program clears a previously selected zone', () => {
    service.selectProgram('ARTS');
    service.selectZone('ZONE_1');
    expect(service.hasCompleteScope()).toBe(true);

    service.selectProgram('SPORTS');
    expect(service.program()?.id).toBe('SPORTS');
    expect(service.zone()).toBeNull();
    expect(service.hasCompleteScope()).toBe(false);
  });

  it('bumps the scope version when the zone changes so consumers can drop stale state', () => {
    service.selectProgram('ARTS');
    const versionBefore = service.scopeVersion();
    service.selectZone('ZONE_1');
    expect(service.scopeVersion()).toBeGreaterThan(versionBefore);

    const versionAfterFirstZone = service.scopeVersion();
    service.selectZone('ZONE_2');
    expect(service.scopeVersion()).toBeGreaterThan(versionAfterFirstZone);
  });

  it('clearing the zone keeps the program selected', () => {
    service.selectProgram('ARTS');
    service.selectZone('ZONE_1');

    service.clearZone();

    expect(service.program()?.id).toBe('ARTS');
    expect(service.zone()).toBeNull();
  });

  it('clear() resets the whole scope and removes the stored entry', () => {
    service.selectProgram('SPORTS');
    service.selectZone('TEST');
    expect(service.hasCompleteScope()).toBe(true);

    service.clear();

    expect(service.program()).toBeNull();
    expect(service.zone()).toBeNull();
    expect(service.hasCompleteScope()).toBe(false);
    expect(sessionStorage.getItem(PROGRAM_SCOPE_STORAGE_KEY)).toBeNull();
  });

  it('ignores corrupted or unknown stored scope values', () => {
    sessionStorage.setItem(
      PROGRAM_SCOPE_STORAGE_KEY,
      JSON.stringify({ programId: 'MAJOR_LEAGUE', zoneId: 'MOON' }),
    );
    const restored = newService();
    expect(restored.program()).toBeNull();
    expect(restored.zone()).toBeNull();
    expect(restored.hasCompleteScope()).toBe(false);
  });

  it('restores only a complete scope; a half-finished selection restarts the flow', () => {
    sessionStorage.setItem(
      PROGRAM_SCOPE_STORAGE_KEY,
      JSON.stringify({ programId: 'ARTS' }),
    );
    const restored = newService();
    expect(restored.program()?.id).toBe('ARTS');
    expect(restored.zone()).toBeNull();
    expect(restored.hasCompleteScope()).toBe(false);
  });
});
