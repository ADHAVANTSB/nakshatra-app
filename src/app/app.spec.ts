import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
});