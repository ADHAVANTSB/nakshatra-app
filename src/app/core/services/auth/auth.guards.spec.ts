import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';

import {
  adminAccessGuard,
  frontendAuthGuard,
  sectionAccessGuard,
  signInGuard,
} from './auth.guards';
import { AuthService, type GoogleAuthenticatedUser } from './auth.service';

/** Route-guard unit tests run the CanActivateFn in the injection context. */
const GUARD_SNAPSHOT = {} as ActivatedRouteSnapshot;
const GUARD_STATE = {} as RouterStateSnapshot;

type Guard = (snapshot: ActivatedRouteSnapshot, state: RouterStateSnapshot) => unknown;

function runGuard(guard: Guard, routeData: Record<string, unknown> = {}): boolean | UrlTree {
  const snapshot = { data: routeData } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => guard(snapshot, GUARD_STATE)) as boolean | UrlTree;
}

const ADMIN_USER: GoogleAuthenticatedUser = {
  id: 'spec-admin-user',
  googleId: 'spec-google-id-admin',
  email: 'asha.admin@nakshatra.local',
  displayName: 'Asha Rao',
  role: 'ADMIN',
  accessStatus: 'APPROVED',
  version: 1,
};

const CERTIFICATE_TEAM_USER: GoogleAuthenticatedUser = {
  ...ADMIN_USER,
  id: 'spec-certificate-user',
  role: 'CERTIFICATE_TEAM',
};

function signIn(user: GoogleAuthenticatedUser): void {
  TestBed.inject(AuthService).setGoogleAuthenticatedUser(user);
}

describe('auth guards', () => {
  afterEach(() => {
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  describe('signInGuard', () => {
    it('allows the sign-in page for an anonymous visitor', () => {
      expect(runGuard(signInGuard)).toBe(true);
    });

    it('redirects an already-authenticated visitor to the dashboard', () => {
      signIn(ADMIN_USER);

      const result = runGuard(signInGuard);

      expect(result).toBeInstanceOf(UrlTree);
      expect((result as UrlTree).toString()).toBe('/dashboard');
    });
  });

  describe('frontendAuthGuard', () => {
    it('redirects an anonymous visitor to the login page', () => {
      const result = runGuard(frontendAuthGuard);

      expect(result).toBeInstanceOf(UrlTree);
      expect((result as UrlTree).toString()).toBe('/login');
    });

    it('allows an authenticated user', () => {
      signIn(ADMIN_USER);
      expect(runGuard(frontendAuthGuard)).toBe(true);
    });
  });

  describe('sectionAccessGuard', () => {
    it('redirects a role without access to the requested section', () => {
      signIn(CERTIFICATE_TEAM_USER);

      const result = runGuard(sectionAccessGuard, { section: 'PARTICIPANTS' });

      expect(result).toBeInstanceOf(UrlTree);
      expect((result as UrlTree).toString()).toBe('/dashboard');
    });

    it('allows a role with access to the requested section', () => {
      signIn(CERTIFICATE_TEAM_USER);
      expect(runGuard(sectionAccessGuard, { section: 'RESULTS' })).toBe(true);
    });
  });

  describe('adminAccessGuard', () => {
    it('redirects a non-admin away from admin-only routes', () => {
      signIn(CERTIFICATE_TEAM_USER);

      const result = runGuard(adminAccessGuard);

      expect(result).toBeInstanceOf(UrlTree);
      expect((result as UrlTree).toString()).toBe('/dashboard');
    });

    it('allows an admin', () => {
      signIn(ADMIN_USER);
      expect(runGuard(adminAccessGuard)).toBe(true);
    });
  });
});
