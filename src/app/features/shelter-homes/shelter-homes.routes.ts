import { Routes } from '@angular/router';

export const SHELTER_HOMES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/shelter-homes-page.component').then(m => m.ShelterHomesPageComponent)
  }
];
