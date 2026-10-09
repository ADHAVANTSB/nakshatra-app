import { Routes } from '@angular/router';
import { adminAccessGuard, frontendAuthGuard, sectionAccessGuard, signInGuard } from './core/services/auth/auth.guards';
import { ApplicationSection } from './core/models';

const protectedRoute = (section: ApplicationSection) => ({
  canActivate: [frontendAuthGuard, sectionAccessGuard],
  data: { section },
});

export const routes: Routes = [
  { path: 'login', canActivate: [signInGuard], loadComponent: () => import('./pages/login/login').then(m => m.Login) },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', ...protectedRoute('DASHBOARD'), loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
  { path: 'homes', ...protectedRoute('HOMES'), loadComponent: () => import('./pages/homes/homes').then(m => m.Homes) },
  { path: 'participants', ...protectedRoute('PARTICIPANTS'), loadComponent: () => import('./pages/participants/participants').then(m => m.Participants) },
  { path: 'events', ...protectedRoute('EVENTS'), loadComponent: () => import('./pages/events/events').then(m => m.Events) },
  { path: 'imports', ...protectedRoute('ACCESS_MANAGEMENT'), loadChildren: () => import('./features/imports/imports.routes').then(m => m.IMPORTS_ROUTES) },
  { path: 'attendance', ...protectedRoute('ATTENDANCE'), loadComponent: () => import('./pages/attendance/attendance').then(m => m.Attendance) },
  { path: 'scoring', ...protectedRoute('SCORING'), loadComponent: () => import('./pages/scoring/scoring').then(m => m.Scoring) },
  { path: 'results', ...protectedRoute('RESULTS'), loadComponent: () => import('./pages/results/results').then(m => m.Results) },
  { path: 'certificates', ...protectedRoute('CERTIFICATES'), loadComponent: () => import('./pages/certificates/certificates').then(m => m.Certificates) },
  { path: 'reports', ...protectedRoute('REPORTS'), loadComponent: () => import('./pages/reports/reports').then(m => m.Reports) },
  { path: 'settings', canActivate: [frontendAuthGuard, adminAccessGuard], loadComponent: () => import('./pages/settings/settings').then(m => m.Settings) },

  // Legacy feature-foundation paths. Every module has exactly one canonical
  // route, so these resolve to the real page instead of a duplicate stub.
  { path: 'shelter-homes', redirectTo: '/homes', pathMatch: 'full' },
  { path: 'participant-management', redirectTo: '/participants', pathMatch: 'full' },
  { path: 'event-management', redirectTo: '/events', pathMatch: 'full' },

  { path: '**', redirectTo: 'dashboard' },
];
