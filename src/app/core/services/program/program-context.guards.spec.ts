import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';

import { programSelectedGuard, zoneSelectedGuard } from './program-context.guards';
import { ProgramContextService } from './program-context.service';

/** Route-guard unit tests run the CanActivateFn in the injection context. */
const GUARD_SNAPSHOT = {} as ActivatedRouteSnapshot;
const GUARD_STATE = {} as RouterStateSnapshot;

type Guard = (snapshot: ActivatedRouteSnapshot, state: RouterStateSnapshot) => unknown;

function runGuard(guard: Guard): boolean | UrlTree {
  const snapshot = {} as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => guard(snapshot, GUARD_STATE)) as boolean | UrlTree;
}

describe('program context guards', () => {
  let service: ProgramContextService;

  beforeEach(() => {
    sessionStorage.clear();
    service = TestBed.inject(ProgramContextService);
  });

  describe('programSelectedGuard', () => {
    it('redirects to program selection when no program is chosen', () => {
      const result = runGuard(programSelectedGuard);

      expect(result).toBeInstanceOf(UrlTree);
      expect((result as UrlTree).toString()).toBe('/select-program');
    });

    it('allows the route once a program is selected', () => {
      service.selectProgram('ARTS');
      expect(runGuard(programSelectedGuard)).toBe(true);
    });
  });

  describe('zoneSelectedGuard', () => {
    it('redirects to program selection when not even a program is chosen', () => {
      const result = runGuard(zoneSelectedGuard);

      expect(result).toBeInstanceOf(UrlTree);
      expect((result as UrlTree).toString()).toBe('/select-program');
    });

    it('redirects to zone selection when only a program is chosen', () => {
      service.selectProgram('ARTS');

      const result = runGuard(zoneSelectedGuard);

      expect(result).toBeInstanceOf(UrlTree);
      expect((result as UrlTree).toString()).toBe('/select-zone');
    });

    it('allows the route once a program and a zone are selected', () => {
      service.selectProgram('ARTS');
      service.selectZone('TEST');
      expect(runGuard(zoneSelectedGuard)).toBe(true);
    });
  });
});
