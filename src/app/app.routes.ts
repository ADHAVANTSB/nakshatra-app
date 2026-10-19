import { Routes } from '@angular/router';
import { adminAccessGuard, frontendAuthGuard, sectionAccessGuard, signInGuard } from './core/services/auth/auth.guards';
import { programSelectedGuard, zoneSelectedGuard } from './core/services/program/program-context.guards';
import { ApplicationSection } from './core/models';

const protectedRoute = (section: ApplicationSection) => ({
  canActivate: [frontendAuthGuard, programSelectedGuard, zoneSelectedGuard, sectionAccessGuard],
  data: { section },
});

export const routes: Routes = [
  { path: 'login', canActivate: [signInGuard], loadComponent: () => import('./pages/login/login').then(m => m.Login) },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  // Post-sign-in scope flow. Session-guarded only: the zone step additionally
  // requires a chosen programme via programSelectedGuard.
  { path: 'select-program', canActivate: [frontendAuthGuard], loadComponent: () => import('./pages/select-program/select-program').then(m => m.SelectProgram) },
  { path: 'select-zone', canActivate: [frontendAuthGuard, programSelectedGuard], loadComponent: () => import('./pages/select-zone/select-zone').then(m => m.SelectZone) },
  { path: 'dashboard', ...protectedRoute('DASHBOARD'), loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
  { path: 'homes', ...protectedRoute('HOMES'), loadComponent: () => import('./pages/homes/homes').then(m => m.Homes) },
  { path: 'participants', ...protectedRoute('PARTICIPANTS'), loadComponent: () => import('./pages/participants/participants').then(m => m.Participants) },
  { path: 'events', ...protectedRoute('EVENTS'), loadComponent: () => import('./pages/events/events').then(m => m.Events) },
  { path: 'imports', ...protectedRoute('ACCESS_MANAGEMENT'), loadChildren: () => import('./features/imports/imports.routes').then(m => m.IMPORTS_ROUTES) },
  { path: 'attendance', ...protectedRoute('ATTENDANCE'), loadComponent: () => import('./pages/attendance/attendance').then(m => m.Attendance) },
  { path: 'scoring', ...protectedRoute('SCORING'), loadComponent: () => import('./pages/scoring/scoring').then(m => m.Scoring) },
  { path: 'judging', ...protectedRoute('SCORING'), loadComponent: () => import('./pages/judging/judging').then(m => m.Judging) },
  { path: 'results', ...protectedRoute('RESULTS'), loadComponent: () => import('./pages/results/results').then(m => m.Results) },
  // Legacy approval URL: guard-protected redirect into the unified Results workspace.
  { path: 'results-approval', ...protectedRoute('RESULTS'), loadComponent: () => import('./pages/results/results-approval-redirect').then(m => m.ResultsApprovalRedirect) },
  { path: 'certificates', ...protectedRoute('CERTIFICATES'), loadComponent: () => import('./pages/certificates/certificates').then(m => m.Certificates) },
  { path: 'reports', ...protectedRoute('REPORTS'), loadComponent: () => import('./pages/reports/reports').then(m => m.Reports) },
  { path: 'settings', canActivate: [frontendAuthGuard, programSelectedGuard, zoneSelectedGuard, adminAccessGuard], loadComponent: () => import('./pages/settings/settings').then(m => m.Settings) },

  // Legacy feature-foundation paths. Every module has exactly one canonical
  // route, so these resolve to the real page instead of a duplicate stub.
  { path: 'shelter-homes', redirectTo: '/homes', pathMatch: 'full' },
  { path: 'participant-management', redirectTo: '/participants', pathMatch: 'full' },
  { path: 'event-management', redirectTo: '/events', pathMatch: 'full' },

  { path: '**', redirectTo: 'dashboard' },
];
