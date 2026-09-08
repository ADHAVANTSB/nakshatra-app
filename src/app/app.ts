import { Component } from '@angular/core';
import {
  RouterLink,
  RouterLinkActive,
  RouterOutlet
} from '@angular/router';

interface NavItem {
  label: string;
  route: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {

  /**
   * Controls the mobile navigation drawer.
   */
  //mobileMenuOpen = false;

  /**
   * Main application navigation.
   *
   * Keeping this in one place means the same navigation
   * can be reused by desktop and mobile layouts.
   */
  navItems: NavItem[] = [
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
      icon: '○'
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
      icon: '□'
    },
    {
      label: 'Reports',
      route: '/reports',
      icon: '▤'
    }
  ];


sidebarExpanded = false;
mobileMenuOpen = false;

  /**
   * Open or close the mobile navigation drawer.
   */
  // toggleMobileMenu(): void {
  //   this.mobileMenuOpen = !this.mobileMenuOpen;
  // }

  /**
   * Close the mobile navigation drawer.
   */
  // closeMobileMenu(): void {
  //   this.mobileMenuOpen = false;
  // }

  toggleSidebar(event?: Event): void {
  event?.stopPropagation();

  this.sidebarExpanded = !this.sidebarExpanded;
}

onShellClick(event: MouseEvent): void {
  if (!this.sidebarExpanded) {
    return;
  }

  const target = event.target as HTMLElement;

  if (!target.closest('.nk-sidebar')) {
    this.sidebarExpanded = false;
  }
}

toggleMobileMenu(): void {
  this.mobileMenuOpen = !this.mobileMenuOpen;
}

closeMobileMenu(): void {
  this.mobileMenuOpen = false;
}

}