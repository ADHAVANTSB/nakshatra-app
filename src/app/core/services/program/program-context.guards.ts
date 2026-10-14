import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';

import { ProgramContextService } from './program-context.service';

/**
 * Requires a selected program before the guarded route opens. Runs AFTER the
 * authentication guard so the selection flow itself is never public.
 */
export const programSelectedGuard: CanActivateFn = () => {
  const context = inject(ProgramContextService);
  const router = inject(Router);

  return context.program() ? true : router.createUrlTree(['/select-program']);
};

/**
 * Requires a complete scope (program AND zone). A program without a zone
 * continues the flow at zone selection instead of showing scoped pages.
 */
export const zoneSelectedGuard: CanActivateFn = () => {
  const context = inject(ProgramContextService);
  const router = inject(Router);

  if (!context.program()) {
    return router.createUrlTree(['/select-program']);
  }
  return context.zone() ? true : router.createUrlTree(['/select-zone']);
};
