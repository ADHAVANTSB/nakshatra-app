import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GOOGLE_IDENTITY_CONFIG } from '../../core/constants/google-identity.config';
import { ApplicationRole, ApplicationSession } from '../../core/models';
import { ApiClientService } from '../../core/services/api/api-client.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { NotificationService } from '../../core/services/notifications/notification.service';

/**
 * The identity Google proved for this visitor. Only `email` is guaranteed; the
 * display name is a pre-fill convenience and is never trusted for access.
 */
interface VerifiedGoogleUser {
  email: string;
  displayName?: string;
  /** Alias used by the backend's NOT_REGISTERED response shape. */
  name?: string;
}

interface ApprovedGoogleUser extends VerifiedGoogleUser {
  id: string;
  googleId: string;
  displayName: string;
  role: ApplicationRole;
  accessStatus: 'APPROVED';
  version: number;
}

type NakshatraAccess = 'NOT_REGISTERED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED' | 'DENIED';

interface ApplicationRoleOption {
  value: ApplicationRole;
  label: string;
}

const APPLICATION_ROLE_OPTIONS: readonly ApplicationRoleOption[] = [
  { value: 'ADMIN', label: 'Administrator' },
  { value: 'SUPPORT', label: 'Support' },
  { value: 'EVENTS_TEAM', label: 'Events team' },
  { value: 'LIAISON_TEAM', label: 'Liaison team' },
  { value: 'CERTIFICATE_TEAM', label: 'Certificate team' },
];

interface GoogleVerificationResponse {
  success: boolean;
  access?: NakshatraAccess;
  error?: string;
  errorCode?: string;
  user?: VerifiedGoogleUser;
  data?: { applicationSession?: unknown };
}

/** The user-facing login page state machine. Every attempt terminates. */
type LoginPhase = 'IDLE' | 'SIGNING_IN' | 'VERIFYING' | 'SUCCESS' | 'ERROR';

/**
 * How long the "Sign-in successful" confirmation stays visible before the
 * redirect into the application. Brief, but long enough to be read.
 */
const SIGN_IN_SUCCESS_REDIRECT_MS = 900;

/**
 * A failed authentication attempt, rendered as a friendly error card.
 *
 * `code` and `backendMessage` preserve the real backend response for
 * diagnostics; `title`/`message`/`detail`/`help` are the user-facing text and
 * never expose technical details such as scope names or token claims.
 */
interface LoginErrorState {
  code: string;
  backendMessage: string;
  title: string;
  message: string;
  detail?: string;
  /** The concrete next step the user should take. */
  nextStep?: string;
  help?: string;
  action: 'TRY_ANOTHER_ACCOUNT' | 'RETRY';
}

/** Friendly panel text for the backend's non-APPROVED access outcomes. */
const ACCESS_PANELS: Record<NakshatraAccess, { title: string; message: string }> = {
  NOT_REGISTERED: {
    title: 'Account not registered',
    message: 'This Google account does not have access to Nakshatra yet. Please ask a Nakshatra administrator to add this Google email.',
  },
  PENDING: {
    title: 'Access pending',
    message: 'Your Nakshatra access request is waiting for administrator approval.',
  },
  APPROVED: {
    title: 'Signed in',
    message: 'Google account verified and Nakshatra access approved.',
  },
  REJECTED: {
    title: 'Access request rejected',
    message: 'Your Nakshatra access request was not approved.',
  },
  DISABLED: {
    title: 'Account disabled',
    message: 'Your Nakshatra account has been disabled by an administrator.',
  },
  DENIED: {
    title: 'Access denied',
    message: 'Your Nakshatra access is denied. Contact a Nakshatra administrator.',
  },
};

type GisSetupFailure = 'SCRIPT_ELEMENT' | 'SCRIPT_LOAD' | 'SCRIPT_TIMEOUT' | 'API_UNAVAILABLE' | 'INITIALIZATION';

class GisSetupError extends Error {
  constructor(readonly failure: GisSetupFailure, message: string, readonly originalError?: unknown) {
    super(message);
    this.name = 'GisSetupError';
  }
}

let gisInitialization: Promise<GoogleIdentity> | null = null;
let credentialHandler: ((credential: string) => void) | null = null;
let gisErrorHandler: (() => void) | null = null;

function initializeGoogleIdentity(): Promise<GoogleIdentity> {
  if (!gisInitialization) {
    gisInitialization = waitForGoogleIdentity().then(google => {
      try {
        google.accounts.id.initialize({
          client_id: GOOGLE_IDENTITY_CONFIG.clientId,
          callback: response => credentialHandler?.(response.credential),
          auto_select: false,
          error_callback: () => gisErrorHandler?.(),
        });
      } catch (error) {
        throw new GisSetupError('INITIALIZATION', 'Google Sign-In initialization failed.', error);
      }
      return google;
    }).catch(error => {
      gisInitialization = null;
      throw error;
    });
  }
  return gisInitialization;
}

function waitForGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);

  const script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
  if (!script) {
    return Promise.reject(new GisSetupError('SCRIPT_ELEMENT', 'Google Sign-In script element was not found.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      callback();
    };
    const onLoad = (): void => finish(() => {
      const google = window.google;
      if (google?.accounts?.id) {
        resolve(google);
      } else {
        reject(new GisSetupError('API_UNAVAILABLE', 'Google Sign-In loaded but its API is unavailable.'));
      }
    });
    const onError = (event: Event): void => finish(() => reject(
      new GisSetupError('SCRIPT_LOAD', 'Google Sign-In script failed to load.', event),
    ));
    const timeoutId = window.setTimeout(() => finish(() => reject(
      new GisSetupError('SCRIPT_TIMEOUT', 'Google Sign-In script did not finish loading.'),
    )), 10_000);

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);

    // Covers the small interval between the initial check and listener registration.
    const google = window.google;
    if (google?.accounts?.id) finish(() => resolve(google));
  });
}

/**
 * Extracts only the display identity (email, name) from a Google ID token's
 * payload for the "Signed in as" block. The credential is Google-signed and
 * still fully verified by the backend; nothing here is trusted for access and
 * the token itself is never rendered, stored, or logged.
 */
function readCredentialIdentity(credential: string): { name?: string; email?: string } | null {
  const parts = credential.split('.');
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));

    if (typeof payload !== 'object' || payload === null) return null;

    const email = 'email' in payload && typeof payload.email === 'string' ? payload.email : undefined;
    const name = 'name' in payload && typeof payload.name === 'string' ? payload.name : undefined;

    return email || name ? { email, name } : null;
  } catch {
    return null;
  }
}

@Component({ selector: 'nk-login', imports: [FormsModule], templateUrl: './login.html', styleUrl: './login.scss' })
export class Login implements AfterViewInit, OnDestroy {  private readonly auth = inject(AuthService);
  private readonly apiClient = inject(ApiClientService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private googleButtonElement: HTMLElement | null = null;
  private googleButtonWaiters: Array<(element: HTMLElement | null) => void> = [];
  @ViewChild('googleButton')
  set googleButton(element: ElementRef<HTMLElement> | undefined) {
    this.googleButtonElement = element?.nativeElement ?? null;
    if (this.googleButtonElement) {
      for (const resolve of this.googleButtonWaiters.splice(0)) resolve(this.googleButtonElement);
    }
  }
  readonly phase = signal<LoginPhase>('IDLE');
  readonly errorState = signal<LoginErrorState | null>(null);
  /** The Google identity currently used for sign-in, for the "Signed in as" block. */
  readonly currentGoogleAccount = signal<{ name?: string; email?: string } | null>(null);
  readonly verifiedUser = signal<(VerifiedGoogleUser & { access: NakshatraAccess }) | null>(null);

  /** True while an authentication attempt is in flight. */
  readonly loading = computed(() => this.phase() === 'SIGNING_IN' || this.phase() === 'VERIFYING');

  /** Human-readable progress label for the in-flight phase. */
  statusLabel(): string {
    switch (this.phase()) {
      case 'SIGNING_IN': return 'Signing in…';
      case 'VERIFYING': return 'Verifying Google account…';
      default: return '';
    }
  }

  /** Friendly panel text for a backend access outcome (non-APPROVED). */
  statusPanel(access: NakshatraAccess): { title: string; message: string } {
    return ACCESS_PANELS[access];
  }

  /* ================================================================
     REGISTRATION REQUEST
     ================================================================ */

  readonly roles = APPLICATION_ROLE_OPTIONS;
  readonly registrationOpen = signal(false);
  readonly registrationSubmitting = signal(false);
  readonly registrationSubmitted = signal(false);
  readonly registrationDisplayName = signal('');
  readonly registrationRole = signal<ApplicationRole | ''>('');
  readonly registrationError = signal('');

  private destroyed = false;
  private buttonRendered = false;
  private successRedirectHandle: number | null = null;
  private readonly onCredential = (credential: string): void => void this.verifyCredential(credential);
  private readonly onGisError = (): void => {
    if (this.destroyed || this.loading()) return;
    this.errorState.set({
      code: 'GOOGLE_SIGN_IN',
      backendMessage: 'Google Identity Services reported a sign-in error.',
      title: 'Google Sign-In failed',
      message: 'Google Sign-In could not be completed. Please try again.',
      action: 'RETRY',
    });
    this.phase.set('ERROR');
  };

  ngAfterViewInit(): void {
    credentialHandler = this.onCredential;
    gisErrorHandler = this.onGisError;
    void this.initializeGoogleSignIn();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.successRedirectHandle !== null) {
      window.clearTimeout(this.successRedirectHandle);
      this.successRedirectHandle = null;
    }
    for (const resolve of this.googleButtonWaiters.splice(0)) resolve(null);
    if (credentialHandler === this.onCredential) credentialHandler = null;
    if (gisErrorHandler === this.onGisError) gisErrorHandler = null;
  }

  private async initializeGoogleSignIn(): Promise<void> {
    try {
      const google = await initializeGoogleIdentity();
      if (this.destroyed || this.buttonRendered) return;
      const button = await this.waitForGoogleButton();
      if (this.destroyed || !button || this.buttonRendered) return;
      try {
        google.accounts.id.renderButton(button, {
          theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 376, ux_mode: 'popup',
        });
        this.buttonRendered = true;
      } catch (error) {
        console.error('Google Sign-In button rendering failed.', error);
        if (!this.destroyed) this.fail({
          code: 'GOOGLE_SIGN_IN_BUTTON',
          backendMessage: 'Google Sign-In button rendering failed.',
          title: 'Google Sign-In failed',
          message: 'Google Sign-In button could not be displayed. Please refresh and try again.',
          action: 'RETRY',
        });
      }
    } catch (error) {
      this.reportGisSetupFailure(error);
    }
  }

  private waitForGoogleButton(): Promise<HTMLElement | null> {
    if (this.googleButtonElement) return Promise.resolve(this.googleButtonElement);
    return new Promise(resolve => this.googleButtonWaiters.push(resolve));
  }

  /**
   * Verifies a Google credential with the backend.
   *
   * Transport error semantics mirror ApiClientService.post: a backend error
   * body is honoured even over a non-200 status; a non-JSON body (Apps Script
   * error or quota page) is reported as such instead of being blamed on the
   * connection; a hung request is aborted at the same 120s ceiling the
   * authenticated client uses. Every path ends in a terminal phase:
   * APPROVED (session established), a status panel (verifiedUser), or an
   * ERROR state with a friendly, actionable message.
   */
  private async verifyCredential(credential: string): Promise<void> {
    if (this.destroyed || this.loading()) return;
    if (!credential) {
      this.fail({
        code: 'MISSING_GOOGLE_CREDENTIAL',
        backendMessage: 'Google Sign-In returned no credential.',
        title: 'Google verification failed',
        message: 'Google Sign-In did not return a credential. Please try again.',
        action: 'RETRY',
      });
      return;
    }

    this.errorState.set(null);
    this.phase.set('SIGNING_IN');

    // The verified identity is shown as "Signed in as" so a visitor can see
    // immediately when the browser picked the wrong Google account. Only the
    // email and display name are extracted; the credential itself is never
    // rendered or stored.
    const claimed = readCredentialIdentity(credential);
    this.currentGoogleAccount.set(claimed);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch(GOOGLE_IDENTITY_CONFIG.verificationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ credential }),
        signal: controller.signal,
      });

      if (this.destroyed) return;
      this.phase.set('VERIFYING');

      let result: unknown;
      try {
        result = await response.json();
      } catch {
        this.fail({
          code: 'SERVER_RESPONSE_MALFORMED',
          backendMessage: `Non-JSON response with HTTP status ${response.status}.`,
          title: 'Sign-in temporarily unavailable',
          message: 'Nakshatra sign-in needs administrator attention.',
          action: 'RETRY',
        });
        return;
      }

      if (this.isVerificationFailure(result)) {
        this.fail(this.describeLoginFailure(result.errorCode ?? '', result.error, claimed?.email));
        return;
      }

      if (!this.isVerifiedResponse(result)) {
        this.fail({
          code: 'UNKNOWN_RESPONSE',
          backendMessage: 'The sign-in response could not be interpreted.',
          title: 'Sign-in could not be completed',
          message: 'Google account verification failed.',
          action: 'RETRY',
        });
        return;
      }

      // The backend-confirmed identity supersedes the decoded one.
      const confirmedEmail = result.user.email;
      const confirmedName = result.user.displayName ?? result.user.name;
      this.currentGoogleAccount.set({
        name: claimed?.name ?? confirmedName,
        email: confirmedEmail,
      });

      if (result.access === 'APPROVED') {
        if (!this.isApprovedGoogleUser(result.user)) {
          this.fail({
            code: 'UNKNOWN_RESPONSE',
            backendMessage: 'The approved user response was invalid.',
            title: 'Sign-in could not be completed',
            message: 'Google account verification failed.',
            action: 'RETRY',
          });
          return;
        }
        const applicationSession = this.readApplicationSession(result);
        if (applicationSession === null) {
          this.fail({
            code: 'UNKNOWN_RESPONSE',
            backendMessage: 'The application session returned by the server was invalid.',
            title: 'Sign-in could not be completed',
            message: 'The application session returned by the server was invalid.',
            action: 'RETRY',
          });
          return;
        }
        this.auth.setGoogleAuthenticatedUser(result.user);
        this.auth.setApplicationSession(applicationSession);
        this.phase.set('SUCCESS');
        this.scheduleSuccessRedirect();
        return;
      }

      // Anything other than APPROVED stops here: no session is established and
      // no protected route is reachable from this page.
      this.verifiedUser.set({
        email: result.user.email,
        displayName: result.user.displayName,
        name: result.user.name,
        access: result.access,
      });
      this.phase.set('IDLE');
    } catch (error) {
      if (this.destroyed) return;
      if (controller.signal.aborted) {
        this.fail(this.describeTransportFailure('TIMEOUT'));
      } else {
        console.error('Google account verification request failed.', error);
        this.fail(this.describeTransportFailure('NETWORK'));
      }
    } finally {
      clearTimeout(timeout);
      // Guarantee a terminal state even if a path above silently slipped past.
      if (!this.destroyed && this.loading()) {
        this.phase.set('ERROR');
      }
    }
  }

  /** Moves the page into its terminal ERROR state with the given panel. */
  private fail(failure: LoginErrorState): void {
    if (this.destroyed) return;
    this.errorState.set(failure);
    this.phase.set('ERROR');
  }

  /**
   * Shows the success confirmation briefly, then enters the application.
   * The timer is cleared on destruction so a destroyed page never navigates.
   */
  private scheduleSuccessRedirect(): void {
    this.successRedirectHandle = window.setTimeout(() => {
      this.successRedirectHandle = null;
      void this.router.navigateByUrl('/dashboard');
    }, SIGN_IN_SUCCESS_REDIRECT_MS);
  }

  /**
   * Maps a structured backend login failure to a friendly, actionable panel.
   *
   * The backend's errorCode (additive on the login contract) is authoritative;
   * known legacy aliases from the spec are accepted too. Backend messages are
   * always preserved in `backendMessage`; raw technical text (scope names,
   * token details) is never shown to the user.
   */
  private describeLoginFailure(errorCode: string, backendMessage: string, email?: string): LoginErrorState {
    const code = errorCode.toUpperCase();
    const base = { code, backendMessage };

    switch (code) {
      case 'GOOGLE_ACCOUNT_CONFLICT':
        return {
          ...base,
          title: 'Google account mismatch',
          message: 'This Nakshatra account is already linked to a different Google account.',
          detail: email ? `You're currently signing in with: ${email}` : undefined,
          nextStep: 'Please use the Google account originally linked to your Nakshatra account.',
          help: 'Need account recovery? Contact a Nakshatra administrator.',
          action: 'TRY_ANOTHER_ACCOUNT',
        };

      case 'GOOGLE_TOKEN_INVALID':
      case 'INVALID_GOOGLE_TOKEN':
      case 'MISSING_GOOGLE_CREDENTIAL':
      case 'INVALID_TOKEN_ISSUER':
      case 'MISSING_GOOGLE_SUBJECT':
        return {
          ...base,
          title: 'Google verification failed',
          message: 'Google could not verify this sign-in attempt. Please try again.',
          action: 'RETRY',
        };

      case 'GOOGLE_TOKEN_AUDIENCE_MISMATCH':
      case 'INVALID_TOKEN_AUDIENCE':
        return {
          ...base,
          title: 'Sign-in configuration problem',
          message: 'Nakshatra could not verify this Google sign-in configuration.',
          help: 'This is a technical application configuration issue that the Nakshatra team needs to resolve.',
          action: 'RETRY',
        };

      case 'GOOGLE_EMAIL_UNVERIFIED':
      case 'EMAIL_NOT_VERIFIED':
        return {
          ...base,
          title: 'Google email not verified',
          message: 'Google has not verified the email address of this account. Verify it with Google and try again.',
          action: 'RETRY',
        };

      case 'BACKEND_AUTHORIZATION_REQUIRED':
        return this.describeTransportFailure('BACKEND_AUTHORIZATION', base.backendMessage || backendMessage);
    }

    // The UrlFetchApp authorization failure of a partially deployed backend
    // surfaces as a raw Apps Script message without a structured code.
    if (/UrlFetchApp|script\.external_request|permission to call/i.test(backendMessage)) {
      return this.describeTransportFailure('BACKEND_AUTHORIZATION', backendMessage);
    }

    return {
      ...base,
      title: 'Sign-in could not be completed',
      message: backendMessage || 'Google account verification failed.',
      help: 'If this keeps happening, contact a Nakshatra administrator.',
      action: 'RETRY',
    };
  }

  /** Friendly panels for transport-level failures. */
  private describeTransportFailure(kind: 'NETWORK' | 'TIMEOUT' | 'BACKEND_AUTHORIZATION', backendMessage = ''): LoginErrorState {
    if (kind === 'BACKEND_AUTHORIZATION') {
      return {
        code: 'BACKEND_AUTHORIZATION_REQUIRED',
        backendMessage,
        title: 'Sign-in temporarily unavailable',
        message: 'Nakshatra sign-in needs administrator attention.',
        action: 'RETRY',
      };
    }

    return {
      code: kind,
      backendMessage,
      title: 'Unable to reach Nakshatra',
      message: 'The Nakshatra server did not respond in time.',
      action: 'RETRY',
    };
  }

  private reportGisSetupFailure(error: unknown): void {
    const originalError = error instanceof GisSetupError ? error.originalError ?? error : error;
    console.error('Google Sign-In setup failed.', originalError);
    // A late setup failure must never clobber an in-flight or already
    // terminated verification attempt.
    if (this.destroyed || this.loading() || this.phase() === 'SUCCESS') return;

    if (!(error instanceof GisSetupError)) {
      this.fail({
        code: 'GOOGLE_SIGN_IN_SETUP',
        backendMessage: 'Google Sign-In setup encountered an unexpected error.',
        title: 'Google Sign-In failed',
        message: 'Google Sign-In setup encountered an unexpected error. Please refresh and try again.',
        action: 'RETRY',
      });
      return;
    }

    const message: Record<GisSetupFailure, string> = {
      SCRIPT_ELEMENT: 'Google Sign-In could not find its script on this page.',
      SCRIPT_LOAD: 'Google Sign-In script failed to load. Check your connection and try again.',
      SCRIPT_TIMEOUT: 'Google Sign-In script is taking too long to load. Please refresh and try again.',
      API_UNAVAILABLE: 'Google Sign-In loaded, but its API is unavailable. Please refresh and try again.',
      INITIALIZATION: 'Google Sign-In could not be initialized. Please refresh and try again.',
    };
    this.fail({
      code: `GOOGLE_SIGN_IN_SETUP_${error.failure}`,
      backendMessage: error.message,
      title: 'Google Sign-In failed',
      message: message[error.failure],
      action: 'RETRY',
    });
  }

  /**
   * [Try another Google account]: restarts identity selection with the
   * official GIS APIs. `disableAutoSelect` stops the browser from silently
   * reusing the previous account; `prompt` re-opens the One Tap account
   * chooser, which offers "Use another account". Transient login state for
   * the previous identity is cleared; nothing about the application itself
   * changes (there is no session to clear — it was never created).
   */
  tryAnotherAccount(): void {
    try {
      window.google?.accounts.id.disableAutoSelect();
      window.google?.accounts.id.prompt(notification => {
        // A skipped or dismissed chooser leaves the page idle with the
        // standard sign-in button still available — no state is changed.
        void notification;
      });
    } catch (error) {
      // GIS may be unavailable (script blocked, third-party cookies...). The
      // standard sign-in button remains the reliable fallback.
      console.error('Google account chooser could not be opened.', error);
    }

    this.errorState.set(null);
    this.verifiedUser.set(null);
    this.currentGoogleAccount.set(null);
    this.registrationOpen.set(false);
    this.registrationError.set('');
    this.registrationSubmitted.set(false);
    this.phase.set('IDLE');
  }

  /** [Try again]: clears the failed attempt so the sign-in button can be used directly. */
  retryFromError(): void {
    if (this.loading()) return;
    this.errorState.set(null);
    this.phase.set('IDLE');
    this.googleButtonElement?.focus();
  }

  /* ================================================================
     REGISTRATION REQUEST
     ================================================================ */

  /**
   * Only an unregistered or rejected identity may request access. A visitor
   * who is already pending is never offered a second request.
   */
  canRegister(access: NakshatraAccess | undefined): boolean {
    return access === 'NOT_REGISTERED' || access === 'REJECTED';
  }

  openRegistration(): void {
    const user = this.verifiedUser();

    if (!user || !this.canRegister(user.access)) return;

    this.registrationError.set('');
    this.registrationRole.set('');
    this.registrationDisplayName.set(user.displayName ?? '');
    this.registrationOpen.set(true);
  }

  cancelRegistration(): void {
    if (this.registrationSubmitting()) return;

    this.registrationOpen.set(false);
    this.registrationError.set('');
  }

  setRegistrationDisplayName(value: unknown): void {
    this.registrationDisplayName.set(typeof value === 'string' ? value : '');
  }

  setRegistrationRole(value: unknown): void {
    this.registrationRole.set(this.isApplicationRole(value) ? value : '');
  }

  /**
   * Submits a pending registration request for the verified identity.
   *
   * This deliberately establishes no application session, sets no
   * authenticated user, and never navigates: a submitted request is not an
   * approval. Only the APPROVED branch of `verifyCredential` may sign in.
   */
  async submitRegistration(): Promise<void> {
    if (this.registrationSubmitting() || this.registrationSubmitted()) return;

    const user = this.verifiedUser();

    if (!user || !this.canRegister(user.access)) {
      this.registrationError.set('Verify your Google account again before requesting access.');
      return;
    }

    const email = user.email.trim();
    const displayName = this.registrationDisplayName().trim();
    const selectedRole = this.registrationRole();

    const invalid: string[] = [];
    if (!displayName) invalid.push('Enter your display name.');
    if (!this.isEmail(email)) invalid.push('The verified Google email address is not valid.');
    if (invalid.length) {
      this.registrationError.set(invalid.join(' '));
      return;
    }

    if (!this.isApplicationRole(selectedRole)) {
      this.registrationError.set('Select the role you are requesting.');
      return;
    }

    const requestedRole: ApplicationRole = selectedRole;
    this.registrationError.set('');
    this.registrationSubmitting.set(true);
    try {
      const response = await this.apiClient.requestRegistration({ email, displayName, requestedRole });
      if (this.destroyed) return;
      if (!response.success) {
        // The backend message is shown as-is; a request is never faked as accepted.
        this.registrationError.set(response.error.message);
        return;
      }
      this.registrationSubmitted.set(true);
      this.registrationOpen.set(false);
      this.notifications.success(
        'Registration request submitted.',
        'An administrator must approve it before any Nakshatra access is granted.'
      );
    } catch (error) {
      console.error('Registration request submission failed.', error);
      if (!this.destroyed) this.registrationError.set('Unable to submit your registration request. Please try again.');
    } finally {
      if (!this.destroyed) this.registrationSubmitting.set(false);
    }
  }

  private isVerifiedResponse(value: unknown): value is GoogleVerificationResponse & {
    success: true;
    access: NakshatraAccess;
    user: VerifiedGoogleUser;
  } {
    return typeof value === 'object' && value !== null
      && 'success' in value && value.success === true
      && 'access' in value && this.isNakshatraAccess(value.access)
      && 'user' in value && typeof value.user === 'object' && value.user !== null
      && 'email' in value.user && typeof value.user.email === 'string'
      && (!('displayName' in value.user) || value.user.displayName === undefined || typeof value.user.displayName === 'string')
      && (!('name' in value.user) || value.user.name === undefined || typeof value.user.name === 'string');
  }

  private isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private isNakshatraAccess(value: unknown): value is NakshatraAccess {
    return value === 'NOT_REGISTERED' || value === 'PENDING' || value === 'APPROVED'
      || value === 'REJECTED' || value === 'DISABLED' || value === 'DENIED';
  }

  private isApplicationRole(value: unknown): value is ApplicationRole {
    return value === 'ADMIN' || value === 'SUPPORT' || value === 'EVENTS_TEAM'
      || value === 'LIAISON_TEAM' || value === 'CERTIFICATE_TEAM';
  }

  private readApplicationSession(response: GoogleVerificationResponse): ApplicationSession | null {
    const value = response.data?.applicationSession;
    if (typeof value !== 'object' || value === null || !('id' in value) || !('expiresAt' in value)
      || typeof value.id !== 'string' || !value.id || typeof value.expiresAt !== 'string'
      || Number.isNaN(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) {
      return null;
    }
    return { id: value.id, expiresAt: value.expiresAt };
  }

  private isApprovedGoogleUser(value: VerifiedGoogleUser): value is ApprovedGoogleUser {
    const user = value as Partial<ApprovedGoogleUser>;
    return typeof user.id === 'string'
      && typeof user.googleId === 'string'
      && typeof user.displayName === 'string'
      && this.isApplicationRole(user.role)
      && user.accessStatus === 'APPROVED'
      && typeof user.version === 'number';
  }

  private isVerificationFailure(value: unknown): value is { success: false; error: string; errorCode?: string } {
    return typeof value === 'object' && value !== null
      && 'success' in value && value.success === false
      && 'error' in value && typeof value.error === 'string';
  }
}
