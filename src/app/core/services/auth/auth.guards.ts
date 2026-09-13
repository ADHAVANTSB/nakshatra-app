import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { ApplicationSection } from '../../models';
import { AuthService } from './auth.service';

/** Frontend UX guards only; backend authorization must replace these later. */
export const frontendAuthGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() || inject(Router).createUrlTree(['/login']);
};

export const adminAccessGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.canAccess('ACCESS_MANAGEMENT') || router.createUrlTree(['/dashboard']);
};

/** Keeps direct URL navigation consistent with the role-aware application navigation. */
export const sectionAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const section = route.data['section'] as ApplicationSection | undefined;
  return !section || auth.canAccess(section) || router.createUrlTree(['/dashboard']);
};
