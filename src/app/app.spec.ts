import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { AuthService, type GoogleAuthenticatedUser } from './core/services/auth/auth.service';
import { ProgramContextService } from './core/services/program/program-context.service';

/** Bare stand-in for the login page used to exercise shell/routing behavior. */
@Component({
  selector: 'login-route-stub',
  template: 'login-route-stub',
})
class LoginRouteStub {}

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

  it('shows the header line flow: greeting, brand, section', async () => {
    signIn(CERTIFICATE_TEAM_USER);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const context = (fixture.nativeElement as HTMLElement).querySelector('.nk-header-context');
    expect(context).not.toBeNull();
    const text = context!.textContent ?? '';
    const greeting = text.indexOf('Happy Volunteering');
    const brand = text.indexOf('Nakshatra 2026');
    const section = text.indexOf('Event Management');
    expect(greeting).toBeGreaterThanOrEqual(0);
    expect(brand).toBeGreaterThan(greeting);
    expect(section).toBeGreaterThan(brand);
  });

  it('limits sidebar navigation to the sections the current role can access', async () => {
    signIn(CERTIFICATE_TEAM_USER);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = host(fixture);

    // Dashboard, Results and Certificates — in `navItems` declaration order.
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
      'Judging',
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

    // A successful boot restore navigates into the application; this spec's
    // empty route table has no /dashboard route, so stub the navigation.
    const router = TestBed.inject(Router);
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl =
      vi.fn(() => Promise.resolve(true));

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

  // Zone 2 Step 6 (U9): a stale local scope must never outlive a
  // SUCCESSFULLY validated session that carries no scope. Clearing
  // happens only in that case - never before validation completes.
  it('clears a stale local scope when a validated session carries no scope', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    sessionStorage.setItem(
      'nakshatra.applicationSession',
      JSON.stringify({ id: 'persisted-session-1', expiresAt: future }),
    );
    // A scope remembered from an earlier session sits in local storage.
    sessionStorage.setItem(
      'nakshatra.programScope',
      JSON.stringify({ programId: 'ARTS', zoneId: 'ZONE_1' }),
    );

    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      fetchCallCount += 1;
      expect(String(JSON.parse(init.body).action)).toBe('validateSession');
      return Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          access: 'APPROVED',
          user: ADMIN_USER,
          // Validation succeeded but the session carries NO scope.
          data: { session: { expiresAt: future } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    const router = TestBed.inject(Router);
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl =
      vi.fn(() => Promise.resolve(true));

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const context = TestBed.inject(ProgramContextService);
    expect(context.hasCompleteScope()).toBe(false);
    expect(sessionStorage.getItem('nakshatra.programScope')).toBeNull();

    vi.unstubAllGlobals();
  });

  it('keeps the local scope when session validation does not succeed', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    sessionStorage.setItem(
      'nakshatra.applicationSession',
      JSON.stringify({ id: 'persisted-session-1', expiresAt: future }),
    );
    sessionStorage.setItem(
      'nakshatra.programScope',
      JSON.stringify({ programId: 'ARTS', zoneId: 'ZONE_1' }),
    );

    // Ambiguous transport failure: the backend never said the session is
    // invalid, so nothing is cleared (scope included).
    vi.stubGlobal('fetch', () => {
      fetchCallCount += 1;
      return Promise.reject(new Error('network down'));
    });

    const router = TestBed.inject(Router);
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl =
      vi.fn(() => Promise.resolve(true));

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const context = TestBed.inject(ProgramContextService);
    expect(context.hasCompleteScope()).toBe(true);
    expect(sessionStorage.getItem('nakshatra.programScope')).not.toBeNull();

    vi.unstubAllGlobals();
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

  it('shows the session expiry warning banner with a Stay signed in action that renews', async () => {
    // Create the shell unauthenticated first: boot session validation must
    // not fire here (this test drives the warning purely from the session).
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    signIn(ADMIN_USER);
    // Inside the 5-minute warning lead: the banner shows immediately.
    const soon = new Date(Date.now() + 60_000).toISOString();
    TestBed.inject(AuthService).setApplicationSession({ id: 'warning-session', expiresAt: soon });

    // "Stay signed in" is one authenticated call; answer it with the renewed
    // deadline the backend reports (mirrors getCurrentUser's session field).
    const renewed = new Date(Date.now() + 7_200_000).toISOString();
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      fetchCallCount += 1;
      expect(String(JSON.parse(init.body).action)).toBe('getCurrentUser');
      return Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: { user: ADMIN_USER, session: { expiresAt: renewed } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    TestBed.flushEffects();
    fixture.detectChanges();

    const element = host(fixture);
    const banner = element.querySelector('.nk-toast--session');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Your session is about to expire');
    expect(TestBed.inject(AuthService).applicationSession()?.expiresAt).toBe(soon);

    const stayButton = banner?.querySelector<HTMLButtonElement>('.nk-session-stay');
    expect(stayButton?.textContent?.trim()).toBe('Stay signed in');
    stayButton?.click();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(fetchCallCount).toBe(1);
    expect(TestBed.inject(AuthService).applicationSession()?.expiresAt).toBe(renewed);
    expect(element.querySelector('.nk-toast--session')).toBeNull();
  });

  it('dismisses the session expiry warning without renewing the session', async () => {
    // Same as above: no boot validation fetch must interfere with the count.
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    signIn(ADMIN_USER);
    const soon = new Date(Date.now() + 60_000).toISOString();
    TestBed.inject(AuthService).setApplicationSession({ id: 'warning-session', expiresAt: soon });

    TestBed.flushEffects();
    fixture.detectChanges();

    const element = host(fixture);
    const closeButton = element.querySelector<HTMLButtonElement>(
      '.nk-toast--session [aria-label="Dismiss session warning"]');
    expect(closeButton).not.toBeNull();
    closeButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('.nk-toast--session')).toBeNull();
    // Dismissal is UX-only: the session itself is untouched and nothing called
    // the backend.
    expect(TestBed.inject(AuthService).applicationSession()?.expiresAt).toBe(soon);
    expect(fetchCallCount).toBe(0);
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

  it('keeps the persisted session when startup validation fails transiently', async () => {
    sessionStorage.setItem(
      'nakshatra.applicationSession',
      JSON.stringify({ id: 'transient-session-1', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );

    // The suite default stub rejects every fetch -> ApiClientService maps the
    // rejection to NETWORK_ERROR. That is an ambiguous transport failure: the
    // backend never said the session is invalid, so the session must survive.
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const auth = TestBed.inject(AuthService);
    expect(auth.applicationSession()?.id).toBe('transient-session-1');
    expect(sessionStorage.getItem('nakshatra.applicationSession')).not.toBeNull();

    // The failure is reported honestly as a recoverable warning, not as an
    // expired session.
    const notifications = fixture.componentInstance.notifications();
    const last = notifications[notifications.length - 1];
    expect(last?.tone).toBe('warning');
  });

  it('distinguishes a malformed validation response from a definitive rejection', async () => {
    sessionStorage.setItem(
      'nakshatra.applicationSession',
      JSON.stringify({ id: 'malformed-response-session', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );

    // An HTML error page (HTTP 404 from Apps Script, for example) is mapped to
    // SERVER_RESPONSE_MALFORMED — ambiguous, so the session is kept.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      '<html>Not Found</html>',
      { status: 404, headers: { 'Content-Type': 'text/html' } },
    )));

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const auth = TestBed.inject(AuthService);
    expect(auth.applicationSession()?.id).toBe('malformed-response-session');
    expect(sessionStorage.getItem('nakshatra.applicationSession')).not.toBeNull();

    vi.unstubAllGlobals();
  });
});

describe('App programme/zone scope chip', () => {
  const SCOPE_KEY = 'nakshatra.programScope';

  beforeEach(async () => {
    fetchCallCount = 0;
    vi.stubGlobal('fetch', () => {
      fetchCallCount += 1;
      return Promise.reject(new TypeError('Network access is disabled for App unit tests.'));
    });

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
    // Reset the file-shared context singleton for later suites.
    TestBed.inject(ProgramContextService).clear();
  });

  function selectScope(program: 'ARTS' | 'SPORTS', zone: 'ZONE_1' | 'ZONE_2' | 'TEST'): void {
    const context = TestBed.inject(ProgramContextService);
    context.selectProgram(program);
    context.selectZone(zone);
  }

  it('shows the programme, zone and environment in the header scope chip', async () => {
    signIn(ADMIN_USER);
    selectScope('ARTS', 'ZONE_1');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const chip = (fixture.nativeElement as HTMLElement).querySelector('.nk-scope-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('Arts');
    expect(chip?.textContent).toContain('Zone 1');
    expect(chip?.textContent).toContain('Live');
  });

  it('marks the Test zone environment in the scope chip', async () => {
    signIn(ADMIN_USER);
    selectScope('SPORTS', 'TEST');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const chip = (fixture.nativeElement as HTMLElement).querySelector('.nk-scope-chip');
    expect(chip?.textContent).toContain('Sports');
    expect(chip?.textContent).toContain('Nakshatra Arts 25OCT');
  });

  it('renders no scope chip before a programme and zone are chosen', async () => {
    signIn(ADMIN_USER);

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.nk-scope-chip')).toBeNull();
  });

  it('opens the scope switcher from the header chip', async () => {
    signIn(ADMIN_USER);
    selectScope('ARTS', 'ZONE_2');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const router = TestBed.inject(Router);
    const navigate = vi.fn<(url: string) => Promise<boolean>>(() => Promise.resolve(true));
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl = navigate;

    const chip = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.nk-scope-chip');
    chip?.click();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/select-program');
  });

  it('removes the stored scope on sign-out so the next sign-in starts the flow again', async () => {
    signIn(ADMIN_USER);
    selectScope('ARTS', 'ZONE_1');
    TestBed.inject(AuthService).setApplicationSession({
      id: 'scope-logout-session',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(sessionStorage.getItem(SCOPE_KEY)).not.toBeNull();

    const router = TestBed.inject(Router);
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl =
      vi.fn(() => Promise.resolve(true));

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.logout();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(TestBed.inject(ProgramContextService).hasCompleteScope()).toBe(false);
    expect(sessionStorage.getItem(SCOPE_KEY)).toBeNull();
  });
});

describe('App on the login route', () => {
  const SESSION_KEY = 'nakshatra.applicationSession';

  beforeEach(async () => {
    fetchCallCount = 0;

    await TestBed.configureTestingModule({
      imports: [App, LoginRouteStub],
      providers: [
        provideRouter([
          { path: 'login', component: LoginRouteStub },
          { path: 'dashboard', component: LoginRouteStub },
        ]),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
  });

  it('never renders the app shell around the login page, even when authenticated', async () => {
    signIn(ADMIN_USER);
    await TestBed.inject(Router).navigateByUrl('/login');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = host(fixture);
    expect(element.querySelector('.nk-shell')).toBeNull();
    expect(element.querySelector('header.nk-header')).toBeNull();
    // The login route content renders bare, without the authenticated shell.
    expect(element.querySelector('login-route-stub')).not.toBeNull();
  });

  it('navigates to the dashboard after startup validation succeeds on /login', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ id: 'login-route-session', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );
    await TestBed.inject(Router).navigateByUrl('/login');

    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      fetchCallCount += 1;
      expect(String(JSON.parse(init.body).action)).toBe('validateSession');
      return Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          access: 'APPROVED',
          user: ADMIN_USER,
          data: { session: { expiresAt: new Date(Date.now() + 3_600_000).toISOString() } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const router = TestBed.inject(Router);
    expect(router.url).toBe('/dashboard');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
    expect(fetchCallCount).toBeGreaterThanOrEqual(1);
  });

  it('stays on /login when the visitor has no session to restore', async () => {
    await TestBed.inject(Router).navigateByUrl('/login');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(TestBed.inject(Router).url).toBe('/login');
    expect(fetchCallCount).toBe(0);
  });
});

/**
 * Shell layout for the post-sign-in scope selection screens.
 *
 * The programme/zone selection screens render WITHOUT the sidebar, hamburger
 * buttons, expand/collapse controls or navigation icons, while keeping
 * Nakshatra branding and the signed-in account menu. Operational pages keep
 * the full shell. (Server-side scope enforcement is covered by the backend
 * suites; the frontend renders normal empty states for live zones.)
 */
describe('App scope selection layout', () => {
  const SCOPE_KEY = 'nakshatra.programScope';

  @Component({
    selector: 'scope-route-stub',
    template: 'scope-route-stub-content',
  })
  class ScopeRouteStub {}

  beforeEach(async () => {
    fetchCallCount = 0;
    vi.stubGlobal('fetch', () => {
      fetchCallCount += 1;
      return Promise.reject(new TypeError('Network access is disabled for unit tests.'));
    });

    await TestBed.configureTestingModule({
      imports: [App, ScopeRouteStub],
      providers: [
        provideRouter([
          { path: 'select-program', component: ScopeRouteStub },
          { path: 'select-zone', component: ScopeRouteStub },
          { path: 'dashboard', component: ScopeRouteStub },
          { path: 'settings', component: ScopeRouteStub },
        ]),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
    TestBed.inject(ProgramContextService).clear();
  });

  function selectScope(program: 'ARTS' | 'SPORTS', zone: 'ZONE_1' | 'ZONE_2' | 'TEST'): void {
    const context = TestBed.inject(ProgramContextService);
    context.selectProgram(program);
    context.selectZone(zone);
  }

  async function open(url: string): Promise<HTMLElement> {
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the selection screens without sidebar, hamburger or navigation controls', async () => {
    signIn(ADMIN_USER);
    const element = await open('/select-program');

    expect(element.querySelector('.nk-shell')).toBeNull();
    expect(element.querySelector('aside.nk-sidebar')).toBeNull();
    expect(element.querySelector('.nk-sidebar-toggle')).toBeNull();
    expect(element.querySelector('#sidebar-toggle')).toBeNull();
    expect(element.querySelector('.nk-menu-button')).toBeNull();
    expect(element.querySelector('.nk-mobile-drawer')).toBeNull();
    expect(element.querySelector('.nk-sidebar-nav')).toBeNull();
    expect(element.querySelector('.nk-scope-chip')).toBeNull();

    // Branding and the signed-in account stay available.
    expect(element.querySelector('.nk-selection-shell')).not.toBeNull();
    expect(element.querySelector('.nk-selection-logo')).not.toBeNull();
    expect(element.querySelector('.nk-user-details strong')?.textContent?.trim())
      .toBe('Asha Rao');
    // The selection page itself renders inside the minimal shell.
    expect(element.querySelector('scope-route-stub')).not.toBeNull();
  });

  it('keeps branding and account on the zone selection screen too', async () => {
    signIn(ADMIN_USER);
    TestBed.inject(ProgramContextService).selectProgram('ARTS');
    const element = await open('/select-zone');

    expect(element.querySelector('aside.nk-sidebar')).toBeNull();
    expect(element.querySelector('.nk-selection-shell')).not.toBeNull();
    expect(element.querySelector('.nk-user-details strong')?.textContent?.trim())
      .toBe('Asha Rao');
    expect(element.querySelector('scope-route-stub')).not.toBeNull();
  });

  it('keeps the full sidebar shell on operational pages after a complete scope', async () => {
    signIn(ADMIN_USER);
    selectScope('ARTS', 'ZONE_1');
    const element = await open('/dashboard');

    expect(element.querySelector('aside.nk-sidebar')).not.toBeNull();
    expect(element.querySelector('header.nk-header')).not.toBeNull();
    expect(element.querySelector('.nk-scope-chip')).not.toBeNull();
    // Live zones render the normal operational pages (server-enforced data).
    expect(element.querySelector('scope-route-stub')).not.toBeNull();
    expect(element.querySelector('.nk-zone-pending')).toBeNull();
  });

  it('renders Zone 2 operationally like any other scope', async () => {
    signIn(ADMIN_USER);
    selectScope('SPORTS', 'ZONE_2');
    const element = await open('/dashboard');

    expect(element.querySelector('scope-route-stub')).not.toBeNull();
    expect(element.querySelector('.nk-scope-chip')?.textContent).toContain('Zone 2');
  });

  it('keeps settings reachable for an admin inside a live zone', async () => {
    signIn(ADMIN_USER);
    selectScope('ARTS', 'ZONE_1');
    const element = await open('/settings');

    expect(element.querySelector('scope-route-stub')).not.toBeNull();
  });

  it('keeps the full shell when the scope switches back to Test', async () => {
    signIn(ADMIN_USER);
    selectScope('ARTS', 'ZONE_1');
    await TestBed.inject(Router).navigateByUrl('/dashboard');
    const live = TestBed.createComponent(App);
    live.detectChanges();
    await live.whenStable();
    expect((live.nativeElement as HTMLElement).querySelector('.nk-scope-chip')?.textContent)
      .toContain('Zone 1');

    TestBed.inject(ProgramContextService).clear();
    selectScope('ARTS', 'TEST');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.nk-scope-chip')?.textContent).toContain('Nakshatra Arts 25OCT');
    expect(element.querySelector('aside.nk-sidebar')).not.toBeNull();
  });
});

