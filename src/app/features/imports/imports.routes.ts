import { Routes } from '@angular/router';

export const IMPORTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/imports-page.component').then(m => m.ImportsPageComponent)
  }
];
