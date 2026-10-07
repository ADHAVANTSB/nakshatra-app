import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth/auth.service';
import { Login } from './login';

/**
 * Login page regression tests for honest, terminating error states.
 *
 * The deployed backend currently answers sign-in verifications with an Apps
 * Script authorization error ("You do not have permission to call
 * UrlFetchApp.fetch..."). The page must display that backend message verbatim,
 * always terminate its loading state, and stay retryable.
 */

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const URLFETCHAPP_ERROR =
  'You do not have permission to call UrlFetchApp.fetch. Required permissions: https://www.googleapis.com/auth/script.external_request.';

const APPROVED_RESPONSE = {
  success: true,
  access: 'APPROVED',
  user: {
    id: 'user-1',
    googleId: 'google-1',
    email: 'asha.admin@nakshatra.local',
    displayName: 'Asha Rao',
    role: 'ADMIN',
    accessStatus: 'APPROVED',
    version: 2,
  },
  data: {
    applicationSession: { id: 'session-1', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  },
};

async function verify(component: Login, credential = 'spec-credential'): Promise<void> {
  await (component as unknown as { verifyCredential: (c: string) => Promise<void> })
    .verifyCredential(credential);
}

describe('Login — verification error states', () => {
  let fixture: ComponentFixture<Login>;
  let component: Login;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.inject(AuthService).logout();
  });

  it('shows the backend authorization error verbatim and clears loading', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: URLFETCHAPP_ERROR,
    })));

    await verify(component);

    expect(component.error()).toBe(URLFETCHAPP_ERROR);
    expect(component.loading()).toBe(false);
  });

  it('shows the backend error verbatim even when the HTTP status is not OK', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ success: false, error: URLFETCHAPP_ERROR }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )));

    await verify(component);

    expect(component.error()).toBe(URLFETCHAPP_ERROR);
    expect(component.loading()).toBe(false);
  });

  it('reports a non-JSON (HTML) server page without blaming the connection', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      '<html>Apps Script error</html>',
      { status: 302, headers: { 'Content-Type': 'text/html' } },
    )));

    await verify(component);

    expect(component.error()).toContain('non-JSON');
    expect(component.error()).not.toBe('Unable to verify your Google account. Check your connection and try again.');
    expect(component.loading()).toBe(false);
  });

  it('reports a network failure and clears loading', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    await verify(component);

    expect(component.error()).toBe('Unable to verify your Google account. Check your connection and try again.');
    expect(component.loading()).toBe(false);
  });

  it('clears loading when the request is still pending (terminal state)', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { release = resolve; }));

    const pending = verify(component);
    expect(component.loading()).toBe(true);

    release(okResponse({ success: false, error: 'Invalid Google ID token' }));
    await pending;

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('Invalid Google ID token');
  });

  it('establishes the session and navigates to the dashboard on success', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse(APPROVED_RESPONSE)));
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await verify(component);

    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.applicationSession()?.id).toBe('session-1');
    expect(auth.currentUser()?.displayName).toBe('Asha Rao');
    expect(navigate).toHaveBeenCalledWith('/dashboard');
    expect(component.loading()).toBe(false);
  });

  it('is retryable: a new verification can succeed after a failure', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: URLFETCHAPP_ERROR,
    })));

    await verify(component);
    expect(component.error()).toBe(URLFETCHAPP_ERROR);

    vi.stubGlobal('fetch', () => Promise.resolve(okResponse(APPROVED_RESPONSE)));
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await verify(component);

    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(true);
    expect(component.error()).toBe('');
  });
});
