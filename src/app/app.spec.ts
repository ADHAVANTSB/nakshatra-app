import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { AuthService, type GoogleAuthenticatedUser } from './core/services/auth/auth.service';

/**
 * CERTIFICATE_TEAM may only reach DASHBOARD, RESULTS and CERTIFICATES
 * (see AuthService.canAccess), so the shell must hide every other section.
 */
const CERTIFICATE_TEAM_USER: GoogleAuthenticatedUser = {
  id: 'spec-certificate-user',
  googleId: 'spec-google-id-certificate',
  email: 'chitra.rao@nakshatra.local',
  displayName: 'Chitra Rao',
  role: 'CERTIFICATE_TEAM',
  accessStatus: 'APPROVED',
  version: 1,
};

/** ADMIN passes AuthService.canAccess for every section. */
const ADMIN_USER: GoogleAuthenticatedUser = {
  id: 'spec-admin-user',
  googleId: 'spec-google-id-admin',
  email: 'asha.admin@nakshatra.local',
  displayName: 'Asha Rao',
  role: 'ADMIN',
  accessStatus: 'APPROVED',
  version: 1,
};

/**
 * Counts calls to the global `fetch`. The app shell must never reach the
 * network from a unit test, and ApiClientService would otherwise call a live
 * Google Apps Script endpoint.
 */
let fetchCallCount = 0;

function signIn(user: GoogleAuthenticatedUser): void {
  // Only the user is needed for AuthService.isAuthenticated; no application
  // session is issued, so ApiClientService.post() short-circuits.
  TestBed.inject(AuthService).setGoogleAuthenticatedUser(user);
}

function host(fixture: ComponentFixture<App>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/**
 * Labels rendered by the desktop sidebar navigation. The mobile drawer repeats
 * them, and the optional settings link lives outside `.nk-sidebar-nav`, so this
 * selector returns exactly the role-filtered navigation entries.
 */
function sidebarNavLabels(element: HTMLElement): string[] {
  return Array.from(
    element.querySelectorAll('.nk-sidebar-nav .nk-nav-item .nk-nav-text'),
    node => node.textContent?.trim() ?? ''
  );
}

describe('App', () => {
  beforeEach(async () => {
    fetchCallCount = 0;
    vi.stubGlobal('fetch', () => {
      fetchCallCount += 1;
      return Promise.reject(new TypeError('Network access is disabled for App unit tests.'));
    });

    await TestBed.configureTestingModule({
      imports: [App],
      // An empty route table satisfies the Router injection used by App and
      // ApiClientService without pulling in the real application routes.
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('creates the shell root component unauthenticated', () => {
    const fixture = TestBed.createComponent(App);

    expect(fixture.componentInstance).toBeTruthy();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(fixture.componentInstance.visibleNavItems()).toEqual([]);
  });

  it('renders only the router outlet while no user is authenticated', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = host(fixture);

    // app.html uses `@if (!isAuthenticated()) { <router-outlet> } @else { ... }`.
    expect(element.querySelector('router-outlet')).not.toBeNull();
    expect(element.querySelector('.nk-shell')).toBeNull();
    expect(element.querySelector('.nk-sidebar')).toBeNull();
    expect(element.querySelector('.nk-header')).toBeNull();
    expect(element.querySelector('footer')).toBeNull();
  });

  it('renders the sidebar and header shell for an authenticated user', async () => {
    signIn(CERTIFICATE_TEAM_USER);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = host(fixture);

    expect(element.querySelector('.nk-shell')).not.toBeNull();
    expect(element.querySelector('aside.nk-sidebar')).not.toBeNull();
    expect(element.querySelector('header.nk-header')).not.toBeNull();
    expect(element.querySelector('main.nk-content')).not.toBeNull();
    expect(element.querySelector('.nk-content-inner > router-outlet')).not.toBeNull();

    // userInitial() returns the first letter of the display name.
    expect(element.querySelector('.nk-user-avatar')?.textContent?.trim()).toBe('C');
    expect(element.querySelector('.nk-user-details strong')?.textContent?.trim())
      .toBe('Chitra Rao');
    expect(element.querySelector('.nk-user-details span')?.textContent?.trim())
      .toBe('CERTIFICATE TEAM');
  });

  it('limits sidebar navigation to the sections the current role can access', async () => {
    signIn(CERTIFICATE_TEAM_USER);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = host(fixture);

    // Dashboard, Results and Certificates â€” in `navItems` declaration order.
    expect(sidebarNavLabels(element)).toEqual(['Dashboard', 'Results', 'Certificates']);
    // ACCESS_MANAGEMENT is not granted to CERTIFICATE_TEAM, so no settings link.
    expect(element.querySelector('.nk-sidebar-bottom')).toBeNull();
  });

  it('shows every nav section and the settings link for an ADMIN user', async () => {
    signIn(ADMIN_USER);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = host(fixture);

    expect(sidebarNavLabels(element)).toEqual([
      'Dashboard',
      'Homes',
      'Participants',
      'Events',
      'Attendance',
      'Scoring',
      'Results',
      'Certificates',
      'Reports',
    ]);
    expect(element.querySelector('.nk-sidebar-bottom .nk-nav-text')?.textContent?.trim())
      .toBe('Settings');
  });

  it('never issues a network request while booting the shell', async () => {
    signIn(CERTIFICATE_TEAM_USER);
    const authenticated = TestBed.createComponent(App);
    authenticated.detectChanges();
    await authenticated.whenStable();

    TestBed.inject(AuthService).logout();
    const anonymous = TestBed.createComponent(App);
    anonymous.detectChanges();
    await anonymous.whenStable();

    // ngOnInit -> validateStartupSession() returns early without an application
    // session, so ApiClientService.post() never issues its fetch.
    expect(fetchCallCount).toBe(0);
  });

  it('invokes the backend logout, clears the session and returns to the login page', async () => {
    signIn(ADMIN_USER);
    const auth = TestBed.inject(AuthService);
    auth.setApplicationSession({
      id: 'spec-session-logout',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const logoutCalls: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      logoutCalls.push(String(JSON.parse(init.body).action));
      return Promise.resolve(new Response(
        JSON.stringify({ success: true, data: { loggedOut: true } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.isAuthenticated()).toBe(true);

    const router = TestBed.inject(Router);
    const navigate = vi.fn<(url: string) => Promise<boolean>>(() => Promise.resolve(true));
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl = navigate;

    fixture.componentInstance.logout();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    // Exactly one backend logout action (concurrency guard holds); the shell
    // also issues its normal validateSession on boot.
    expect(logoutCalls.filter(action => action === 'logout')).toEqual(['logout']);
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.applicationSession()).toBeNull();
    expect(fixture.componentInstance.loggingOut()).toBe(false);

    vi.unstubAllGlobals();
  });

  it('still signs the user out locally when the backend logout fails', async () => {
    signIn(ADMIN_USER);
    const auth = TestBed.inject(AuthService);
    auth.setApplicationSession({
      id: 'spec-session-logout-fail',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code: 'SERVER_ERROR', message: 'Logout action failed.' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    // A failed server invalidation must never trap the user in the app, so the
    // navigation is stubbed (no /login route in this spec's empty table) and
    // only the sign-out guarantees are asserted.
    const router = TestBed.inject(Router);
    const navigate = vi.fn<(url: string) => Promise<boolean>>(() => Promise.resolve(true));
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl = navigate;

    fixture.componentInstance.logout();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    // A failed server invalidation must never trap the user in the app.
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.applicationSession()).toBeNull();
    expect(fixture.componentInstance.loggingOut()).toBe(false);

    // ...but it is reported honestly, not swallowed.
    const notifications = fixture.componentInstance.notifications();
    const last = notifications[notifications.length - 1];
    expect(last?.tone).toBe('warning');
    expect(last?.detail).toContain('Logout action failed.');

    vi.unstubAllGlobals();
  });

  it('restores a persisted session on boot and re-establishes the identity from the backend', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    sessionStorage.setItem(
      'nakshatra.applicationSession',
      JSON.stringify({ id: 'persisted-session-1', expiresAt: future }),
    );

    // Override the suite's network-disabled stub: boot now legitimately
    // validates the persisted session against the backend.
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      fetchCallCount += 1;
      expect(String(JSON.parse(init.body).action)).toBe('validateSession');
      return Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          access: 'APPROVED',
          user: ADMIN_USER,
          data: { session: { expiresAt: future } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.currentUser()?.displayName).toBe('Asha Rao');
    expect(auth.applicationSession()?.id).toBe('persisted-session-1');
    expect(fetchCallCount).toBeGreaterThanOrEqual(1);
  });

  it('clears a stale persisted session when the backend rejects it', async () => {
    sessionStorage.setItem(
      'nakshatra.applicationSession',
      JSON.stringify({ id: 'stale-session', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );

    // SESSION_INVALID makes the api client redirect to /login; this spec's
    // empty route table has no /login route, so stub the navigation.
    const router = TestBed.inject(Router);
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl =
      vi.fn(() => Promise.resolve(true));

    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code: 'SESSION_INVALID', message: 'Session is invalid or expired' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.applicationSession()).toBeNull();
    expect(sessionStorage.getItem('nakshatra.applicationSession')).toBeNull();
  });

  it('logout also removes the persisted session', async () => {
    signIn(ADMIN_USER);
    const auth = TestBed.inject(AuthService);
    auth.setApplicationSession({
      id: 'persisted-logout-session',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(sessionStorage.getItem('nakshatra.applicationSession')).not.toBeNull();

    auth.logout();

    expect(sessionStorage.getItem('nakshatra.applicationSession')).toBeNull();
  });

  it('discards a malformed persisted session entry on boot', async () => {
    sessionStorage.setItem('nakshatra.applicationSession', 'not-json');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(TestBed.inject(AuthService).applicationSession()).toBeNull();
    expect(sessionStorage.getItem('nakshatra.applicationSession')).toBeNull();
    // No validation request can be issued without a session id.
    expect(fetchCallCount).toBe(0);
  });
});

