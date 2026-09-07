import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard'
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard/dashboard').then(m => m.Dashboard)
  },
  {
    path: 'homes',
    loadComponent: () =>
      import('./pages/homes/homes').then(m => m.Homes)
  },
  {
    path: 'participants',
    loadComponent: () =>
      import('./pages/participants/participants').then(m => m.Participants)
  },
  {
    path: 'events',
    loadComponent: () =>
      import('./pages/events/events').then(m => m.Events)
  },
  {
    path: 'attendance',
    loadComponent: () =>
      import('./pages/attendance/attendance').then(m => m.Attendance)
  },
  {
    path: 'scoring',
    loadComponent: () =>
      import('./pages/scoring/scoring').then(m => m.Scoring)
  },
  {
    path: 'certificates',
    loadComponent: () =>
      import('./pages/certificates/certificates').then(m => m.Certificates)
  },
  {
    path: 'reports',
    loadComponent: () =>
      import('./pages/reports/reports').then(m => m.Reports)
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings').then(m => m.Settings)
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];