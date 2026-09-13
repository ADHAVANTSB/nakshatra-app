import { Component, computed, inject } from '@angular/core';
import {
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  Router
} from '@angular/router';
import { ApplicationSection } from './core/models';
import { AuthService } from './core/services/auth/auth.service';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  section: ApplicationSection;
}

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive
  ],
  templateUrl: './app.html'
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly currentUser = this.auth.currentUser;

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
      icon: '⌂', section: 'DASHBOARD'
    },
    {
      label: 'Homes',
      route: '/homes',
      icon: '⌂', section: 'HOMES'
    },
    {
      label: 'Participants',
      route: '/participants',
      icon: '○', section: 'PARTICIPANTS'
    },
    {
      label: 'Events',
      route: '/events',
      icon: '✦', section: 'EVENTS'
    },
    {
      label: 'Attendance',
      route: '/attendance',
      icon: '✓', section: 'ATTENDANCE'
    },
    {
      label: 'Scoring',
      route: '/scoring',
      icon: '★', section: 'SCORING'
    },
    {
      label: 'Results',
      route: '/results',
      icon: '▤', section: 'RESULTS'
    },
    {
      label: 'Certificates',
      route: '/certificates',
      icon: '□', section: 'CERTIFICATES'
    },
    {
      label: 'Reports',
      route: '/reports',
      icon: '▤', section: 'REPORTS'
    }
  ];

  readonly visibleNavItems = computed(() => this.navItems.filter(item => this.auth.canAccess(item.section)));
  canAccess(section: ApplicationSection): boolean { return this.auth.canAccess(section); }
  userInitial(): string { return this.currentUser()?.displayName.charAt(0).toUpperCase() ?? '?'; }
  logout(): void { this.auth.logout(); void this.router.navigateByUrl('/login'); }


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
