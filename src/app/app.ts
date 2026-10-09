import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  Router
} from '@angular/router';
import { ApplicationSection } from './core/models';
import { AuthService } from './core/services/auth/auth.service';
import { ApiClientService } from './core/services/api/api-client.service';
import { NotificationService } from './core/services/notifications/notification.service';

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
  templateUrl: './app.html',
  host: {
    '(document:click)': 'closeUserMenu()'
  }
})
export class App implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly apiClient = inject(ApiClientService);
  private readonly notificationService = inject(NotificationService);
  private readonly router = inject(Router);
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly currentUser = this.auth.currentUser;
  readonly notifications = this.notificationService.notifications;

  ngOnInit(): void {
    void this.validateStartupSession();
  }

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
  dismissNotification(id: number): void { this.notificationService.dismiss(id); }

  /** Header user menu (My Account / Settings / Logout). */
  readonly userMenuOpen = signal(false);
  /** Backend-backed logout in flight; the button is disabled until it terminates. */
  readonly loggingOut = signal(false);

  toggleUserMenu(): void { this.userMenuOpen.update(open => !open); }

  closeUserMenu(): void { this.userMenuOpen.set(false); }

  logout(): void {
    void this.signOut();
  }

  /**
   * Backend-backed logout with a guaranteed terminal state.
   *
   * The server session is invalidated first; the local session is always
   * cleared and the user is always returned to the login page, because a
   * failed server call must never trap someone inside the application. A
   * failed server invalidation is reported honestly as a device-level sign
   * out, never as a server-confirmed one.
   */
  private async signOut(): Promise<void> {
    if (this.loggingOut()) return;

    this.loggingOut.set(true);
    this.userMenuOpen.set(false);

    try {
      const result = await this.apiClient.invalidateApplicationSession();
      await this.router.navigateByUrl('/login');

      if (!result.success) {
        this.notificationService.warning(
          'You have been signed out on this device.',
          `The server session could not be invalidated: ${result.error.message}`
        );
      }
    } finally {
      this.loggingOut.set(false);
    }
  }

  private async validateStartupSession(): Promise<void> {
    let session = this.auth.applicationSession();

    // A page refresh clears the in-memory session. The backend session may
    // still be alive, so rehydrate the persisted id and let the backend
    // decide; an expired or malformed entry is discarded by the service.
    if (!session) {
      const restored = this.auth.restorePersistedSession();
      if (!restored) return;
      this.auth.setApplicationSession(restored);
      session = restored;
    }

    const result = await this.apiClient.validateApplicationSession();
    // Do not let a delayed validation clear a newer session created by sign-in.
    if (this.auth.applicationSession()?.id !== session.id) return;

    if (!result.success) {
      this.auth.logout();
      return;
    }

    this.auth.setGoogleAuthenticatedUser(result.user);
    this.auth.setApplicationSession({ id: session.id, expiresAt: result.data.session.expiresAt });
  }


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
