import { Routes } from '@angular/router';

export const PARTICIPANTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/participants-page.component').then(m => m.ParticipantsPageComponent)
  }
];
