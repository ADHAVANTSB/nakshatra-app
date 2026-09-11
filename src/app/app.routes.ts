import { Routes } from '@angular/router';

export const routes: Routes = [

  // ---------------------------------------------------------
  // DEFAULT
  // ---------------------------------------------------------
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard'
  },

  // ---------------------------------------------------------
  // DASHBOARD - EXISTING UI
  // ---------------------------------------------------------
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard/dashboard')
        .then(m => m.Dashboard)
  },

  // ---------------------------------------------------------
  // SHELTER HOMES
  // Existing UI: /pages/homes
  // New Phase 1 foundation: /features/shelter-homes
  // ---------------------------------------------------------
  {
    path: 'homes',
    loadComponent: () =>
      import('./pages/homes/homes')
        .then(m => m.Homes)
  },

  {
    path: 'shelter-homes',
    loadChildren: () =>
      import('./features/shelter-homes/shelter-homes.routes')
        .then(m => m.SHELTER_HOMES_ROUTES)
  },

  // ---------------------------------------------------------
  // PARTICIPANTS
  // Existing UI
  // ---------------------------------------------------------
  {
    path: 'participants',
    loadComponent: () =>
      import('./pages/participants/participants')
        .then(m => m.Participants)
  },

  // New feature route - foundation for future functionality
  {
    path: 'participant-management',
    loadChildren: () =>
      import('./features/participants/participants.routes')
        .then(m => m.PARTICIPANTS_ROUTES)
  },

  // ---------------------------------------------------------
  // EVENTS
  // Existing UI
  // ---------------------------------------------------------
  {
    path: 'events',
    loadComponent: () =>
      import('./pages/events/events')
        .then(m => m.Events)
  },

  // New feature route - event management foundation
  {
    path: 'event-management',
    loadChildren: () =>
      import('./features/events/events.routes')
        .then(m => m.EVENTS_ROUTES)
  },

  // ---------------------------------------------------------
  // IMPORTS
  // Google Sheet import / validation / sync
  // ---------------------------------------------------------
  {
    path: 'imports',
    loadChildren: () =>
      import('./features/imports/imports.routes')
        .then(m => m.IMPORTS_ROUTES)
  },

  // ---------------------------------------------------------
  // ATTENDANCE - EXISTING UI
  // ---------------------------------------------------------
  {
    path: 'attendance',
    loadComponent: () =>
      import('./pages/attendance/attendance')
        .then(m => m.Attendance)
  },

  // ---------------------------------------------------------
  // SCORING - EXISTING UI
  // ---------------------------------------------------------
  {
    path: 'scoring',
    loadComponent: () =>
      import('./pages/scoring/scoring')
        .then(m => m.Scoring)
  },

  // ---------------------------------------------------------
  // CERTIFICATES - EXISTING UI
  // ---------------------------------------------------------
  {
    path: 'certificates',
    loadComponent: () =>
      import('./pages/certificates/certificates')
        .then(m => m.Certificates)
  },

  // ---------------------------------------------------------
  // REPORTS - EXISTING UI
  // ---------------------------------------------------------
  {
    path: 'reports',
    loadComponent: () =>
      import('./pages/reports/reports')
        .then(m => m.Reports)
  },

  // ---------------------------------------------------------
  // SETTINGS - EXISTING UI
  // ---------------------------------------------------------
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings')
        .then(m => m.Settings)
  },

  // ---------------------------------------------------------
  // FALLBACK
  // ---------------------------------------------------------
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];