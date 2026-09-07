import { Component } from '@angular/core';
import {
  RouterLink,
  RouterLinkActive,
  RouterOutlet
} from '@angular/router';

interface NavigationItem {
  label: string;
  route: string;
  icon: string;
}

@Component({
  selector: 'nk-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  isMobileMenuOpen = false;

  navigationItems: NavigationItem[] = [
    {
      label: 'Dashboard',
      route: '/dashboard',
      icon: '⌂'
    },
    {
      label: 'Homes',
      route: '/homes',
      icon: '⌂'
    },
    {
      label: 'Participants',
      route: '/participants',
      icon: '◉'
    },
    {
      label: 'Events',
      route: '/events',
      icon: '✦'
    },
    {
      label: 'Attendance',
      route: '/attendance',
      icon: '✓'
    },
    {
      label: 'Scoring',
      route: '/scoring',
      icon: '★'
    },
    {
      label: 'Certificates',
      route: '/certificates',
      icon: '▣'
    },
    {
      label: 'Reports',
      route: '/reports',
      icon: '▤'
    }
  ];

  settingsItem: NavigationItem = {
    label: 'Settings',
    route: '/settings',
    icon: '⚙'
  };

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }
}