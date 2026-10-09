import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AuthService } from '../../core/services/auth/auth.service';
import { Login } from './login';

/**
 * Login page UX regression tests.
 *
 * Every authentication attempt must reach a terminal state; backend outcomes
 * (access statuses and structured error codes) must be mapped to friendly,
 * actionable panels; the backend response is preserved internally and never
 * faked as success.
 */

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Minimal three-part JWT carrying only the claims the UI displays. */
function makeCredential(email: string, name: string): string {
  const encode = (value: object): string =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ email, name })}.signature`;
}

const CREDENTIAL = makeCredential('adhavan955@gmail.com', 'Adhavan');
const CREDENTIAL_EMAIL = 'adhavan955@gmail.com';

const URLFETCHAPP_ERROR =
  'You do not have permission to call UrlFetchApp.fetch. Required permissions: https://www.googleapis.com/auth/script.external_request.';

const APPROVED_RESPONSE = {
  success: true,
  access: 'APPROVED',
  user: {
    id: 'user-1',
    googleId: 'google-1',
    email: CREDENTIAL_EMAIL,
    displayName: 'Adhavan',
    role: 'ADMIN',
    accessStatus: 'APPROVED',
    version: 2,
  },
  data: {
    applicationSession: { id: 'session-1', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  },
};

async function verify(component: Login, credential: string = CREDENTIAL): Promise<void> {
  await (component as unknown as { verifyCredential: (c: string) => Promise<void> })
    .verifyCredential(credential);
}

function textOf(fixture: ComponentFixture<Login>): string {
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

/**
 * A working Google Identity Services stub so change detection (which starts
 * the GIS bootstrap) never produces nondeterministic setup failures.
 */
function stubGoogleIdentity(): void {
  (window as { google?: unknown }).google = {
    accounts: {
      id: {
        initialize: vi.fn(),
        renderButton: vi.fn(),
        disableAutoSelect: vi.fn(),
        prompt: vi.fn(),
      },
    },
  };
}

describe('Login — idle and loading states', () => {
  let fixture: ComponentFixture<Login>;
  let component: Login;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    stubGoogleIdentity();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    delete (window as { google?: unknown }).google;
    TestBed.inject(AuthService).logout();
  });

  it('renders the idle sign-in screen without any error or status panel', () => {
    const text = textOf(fixture);

    expect(text).toContain('Sign in');
    expect(text).toContain('Sign in with your approved Google account');
    expect(component.phase()).toBe('IDLE');
    expect(component.errorState()).toBeNull();
    expect(component.verifiedUser()).toBeNull();
  });

  it('shows the signing-in progress state while the request is in flight', () => {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined));

    void verify(component);

    expect(component.phase()).toBe('SIGNING_IN');
    expect(component.loading()).toBe(true);
    expect(component.statusLabel()).toBe('Signing in…');
  });

  it('always terminates: a resolved failure leaves a terminal error state', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { release = resolve; }));

    const pending = verify(component);
    expect(component.loading()).toBe(true);

    release(okResponse({ success: false, error: 'Google token verification failed', errorCode: 'INVALID_GOOGLE_TOKEN' }));
    await pending;

    expect(component.loading()).toBe(false);
    expect(component.phase()).toBe('ERROR');
    expect(component.errorState()?.title).toBe('Google verification failed');
  });
});

describe('Login — approved and status outcomes', () => {
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
    stubGoogleIdentity();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    delete (window as { google?: unknown }).google;
    TestBed.inject(AuthService).logout();
  });

  it('shows Sign-in successful, then navigates only for APPROVED', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse(APPROVED_RESPONSE)));
    const navigate = vi.fn<(url: string) => Promise<boolean>>(() => Promise.resolve(true));
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl = navigate;

    await verify(component);

    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.applicationSession()?.id).toBe('session-1');
    expect(component.phase()).toBe('SUCCESS');

    // The confirmation is visible BEFORE the redirect happens.
    const text = textOf(fixture);
    expect(text).toContain('Sign-in successful');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the pending panel and never navigates', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: true,
      access: 'PENDING',
      user: { email: CREDENTIAL_EMAIL, name: 'Adhavan' },
    })));
    const navigate = vi.fn<(url: string) => Promise<boolean>>(() => Promise.resolve(true));
    (router as unknown as { navigateByUrl: (url: string) => Promise<boolean> }).navigateByUrl = navigate;

    await verify(component);

    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(component.verifiedUser()?.access).toBe('PENDING');

    const text = textOf(fixture);
    expect(text).toContain('Access pending');
    expect(text).toContain('waiting for administrator approval');
    expect(text).toContain(CREDENTIAL_EMAIL);
  });

  it('shows the rejected panel and still offers the registration request', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: true,
      access: 'REJECTED',
      user: { email: CREDENTIAL_EMAIL, name: 'Adhavan' },
    })));

    await verify(component);

    const text = textOf(fixture);
    expect(text).toContain('Access request rejected');
    expect(text).toContain('Try another Google account');
    expect(text).toContain('Register');
  });

  it('shows the disabled panel', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: true,
      access: 'DISABLED',
      user: { email: CREDENTIAL_EMAIL, name: 'Adhavan' },
    })));

    await verify(component);

    const text = textOf(fixture);
    expect(text).toContain('Account disabled');
    expect(text).toContain('disabled by an administrator');
  });

  it('shows the not-registered panel and still offers the registration request', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: true,
      access: 'NOT_REGISTERED',
      user: { email: CREDENTIAL_EMAIL, name: 'Adhavan' },
    })));

    await verify(component);

    const text = textOf(fixture);
    expect(text).toContain('Account not registered');
    expect(text).toContain('does not have access to Nakshatra yet');
    expect(text).toContain('Try another Google account');
    expect(text).toContain('Register');
  });
});

describe('Login — backend error mapping', () => {
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
    stubGoogleIdentity();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    delete (window as { google?: unknown }).google;
    TestBed.inject(AuthService).logout();
  });

  it('maps GOOGLE_ACCOUNT_CONFLICT to the friendly mismatch panel with the signing-in email', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: 'This Nakshatra user is already linked to a different Google account.',
      errorCode: 'GOOGLE_ACCOUNT_CONFLICT',
    })));

    await verify(component);

    const failure = component.errorState();
    expect(failure?.title).toBe('Google account mismatch');
    expect(failure?.message).toContain('already linked to a different Google account');
    expect(failure?.detail).toContain(CREDENTIAL_EMAIL);
    expect(failure?.action).toBe('TRY_ANOTHER_ACCOUNT');
    // The real backend response is preserved internally, never faked away.
    expect(failure?.backendMessage).toBe('This Nakshatra user is already linked to a different Google account.');
    expect(failure?.code).toBe('GOOGLE_ACCOUNT_CONFLICT');

    const text = textOf(fixture);
    expect(text).toContain('Google account mismatch');
    expect(text).toContain('Please use the Google account originally linked');
    expect(text).toContain('Need account recovery? Contact a Nakshatra administrator.');
  });

  it('maps INVALID_GOOGLE_TOKEN to the verification-failed panel without token details', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: 'Google token verification failed',
      errorCode: 'INVALID_GOOGLE_TOKEN',
    })));

    await verify(component);

    const failure = component.errorState();
    expect(failure?.title).toBe('Google verification failed');
    expect(failure?.message).toBe('Google could not verify this sign-in attempt. Please try again.');
    expect(failure?.action).toBe('RETRY');

    const text = textOf(fixture);
    expect(text).not.toContain('id_token');
    expect(text).not.toContain('JWT');
  });

  it('maps INVALID_TOKEN_AUDIENCE (and its alias) to the configuration-problem panel', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: 'Invalid token audience',
      errorCode: 'INVALID_TOKEN_AUDIENCE',
    })));

    await verify(component);

    const failure = component.errorState();
    expect(failure?.title).toBe('Sign-in configuration problem');
    expect(failure?.message).toContain('could not verify this Google sign-in configuration');
    expect(failure?.action).toBe('RETRY');
  });

  it('maps the Apps Script authorization failure to a friendly unavailable panel and hides scope names', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: URLFETCHAPP_ERROR,
    })));

    await verify(component);

    const failure = component.errorState();
    expect(failure?.title).toBe('Sign-in temporarily unavailable');
    expect(failure?.message).toContain('administrator attention');
    // Preserved internally for diagnostics…
    expect(failure?.backendMessage).toContain('script.external_request');
    // …but never shown to the user.
    const text = textOf(fixture);
    expect(text).not.toContain('script.external_request');
    expect(text).not.toContain('UrlFetchApp');
  });

  it('maps USER_EMAIL_AMBIGUOUS honestly and points to an administrator', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: 'Multiple Nakshatra users share this email address. Contact an administrator.',
      errorCode: 'USER_EMAIL_AMBIGUOUS',
    })));

    await verify(component);

    const failure = component.errorState();
    expect(failure?.title).toBe('Sign-in could not be completed');
    expect(failure?.message).toContain('Multiple Nakshatra users share this email address');
    expect(failure?.help).toContain('administrator');
  });

  it('preserves an unrecognized backend error message verbatim', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: 'The user directory is locked for maintenance.',
      errorCode: 'DIRECTORY_LOCKED',
    })));

    await verify(component);

    const failure = component.errorState();
    expect(failure?.title).toBe('Sign-in could not be completed');
    expect(failure?.message).toBe('The user directory is locked for maintenance.');
  });
});

describe('Login — transport failures', () => {
  let fixture: ComponentFixture<Login>;
  let component: Login;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    stubGoogleIdentity();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    delete (window as { google?: unknown }).google;
    TestBed.inject(AuthService).logout();
  });

  it('maps a network failure to the unreachable-server panel', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    await verify(component);

    const failure = component.errorState();
    expect(failure?.title).toBe('Unable to reach Nakshatra');
    expect(failure?.message).toBe('The Nakshatra server did not respond in time.');
    expect(component.phase()).toBe('ERROR');
    expect(component.loading()).toBe(false);
  });

  it('maps a timeout to the same unreachable-server panel', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const pending = verify(component);
    await vi.advanceTimersByTimeAsync(120_000);
    await pending;

    const failure = component.errorState();
    expect(failure?.title).toBe('Unable to reach Nakshatra');
    expect(failure?.message).toBe('The Nakshatra server did not respond in time.');
    expect(component.loading()).toBe(false);
  });

  it('maps a non-JSON (HTML) server page to the temporarily-unavailable panel', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      '<html>Apps Script error</html>',
      { status: 302, headers: { 'Content-Type': 'text/html' } },
    )));

    await verify(component);

    const failure = component.errorState();
    expect(failure?.title).toBe('Sign-in temporarily unavailable');
    expect(component.loading()).toBe(false);
  });
});

describe('Login — account switch and retry', () => {
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
    stubGoogleIdentity();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    delete (window as { google?: unknown }).google;
    TestBed.inject(AuthService).logout();
  });

  it('Try another Google account restarts identity selection and clears transient state', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: 'This Nakshatra user is already linked to a different Google account.',
      errorCode: 'GOOGLE_ACCOUNT_CONFLICT',
    })));

    await verify(component);
    expect(component.errorState()).not.toBeNull();

    const disableAutoSelect = vi.fn();
    const prompt = vi.fn();
    (window as { google?: unknown }).google = {
      accounts: { id: { disableAutoSelect, prompt } },
    };

    component.tryAnotherAccount();

    expect(disableAutoSelect).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(component.errorState()).toBeNull();
    expect(component.verifiedUser()).toBeNull();
    expect(component.phase()).toBe('IDLE');
  });

  it('[Try again] clears the failed attempt and returns to the idle sign-in screen', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: 'Google token verification failed',
      errorCode: 'INVALID_GOOGLE_TOKEN',
    })));

    await verify(component);
    expect(component.errorState()?.title).toBe('Google verification failed');

    component.retryFromError();

    expect(component.errorState()).toBeNull();
    expect(component.phase()).toBe('IDLE');
    expect(component.loading()).toBe(false);
  });

  it('clears the previous error when a new attempt starts and can then succeed', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: 'Google token verification failed',
      errorCode: 'INVALID_GOOGLE_TOKEN',
    })));

    await verify(component);
    expect(component.errorState()?.title).toBe('Google verification failed');

    vi.stubGlobal('fetch', () => Promise.resolve(okResponse(APPROVED_RESPONSE)));

    await verify(component);

    // No stale error remains after the successful retry; the redirect itself
    // is covered by the dedicated success test.
    expect(component.errorState()).toBeNull();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
    expect(component.phase()).toBe('SUCCESS');

    fixture.destroy();
  });

  it('displays the current Google email safely without exposing the credential', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(okResponse({
      success: false,
      error: 'This Nakshatra user is already linked to a different Google account.',
      errorCode: 'GOOGLE_ACCOUNT_CONFLICT',
    })));

    await verify(component);

    const text = textOf(fixture);
    expect(text).toContain('Signed in as');
    expect(text).toContain(CREDENTIAL_EMAIL);
    expect(text).toContain('Adhavan');
    // The signed credential itself is never rendered.
    expect(text).not.toContain('signature');
    expect(text).not.toContain(CREDENTIAL);
  });
});
