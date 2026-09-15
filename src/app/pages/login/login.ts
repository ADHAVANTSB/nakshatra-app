import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GOOGLE_IDENTITY_CONFIG } from '../../core/constants/google-identity.config';

interface VerifiedGoogleUser {
  email: string;
}

interface GoogleVerificationResponse {
  success: boolean;
  error?: string;
  user?: VerifiedGoogleUser;
}

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

@Component({ selector: 'nk-login', imports: [RouterLink], templateUrl: './login.html', styleUrl: './login.scss' })
export class Login implements AfterViewInit, OnDestroy {
  private googleButtonElement: HTMLElement | null = null;
  private googleButtonWaiters: Array<(element: HTMLElement | null) => void> = [];
  @ViewChild('googleButton')
  set googleButton(element: ElementRef<HTMLElement> | undefined) {
    this.googleButtonElement = element?.nativeElement ?? null;
    if (this.googleButtonElement) {
      for (const resolve of this.googleButtonWaiters.splice(0)) resolve(this.googleButtonElement);
    }
  }
  readonly error = signal('');
  readonly loading = signal(false);
  readonly verifiedUser = signal<VerifiedGoogleUser | null>(null);
  private destroyed = false;
  private buttonRendered = false;
  private readonly onCredential = (credential: string): void => void this.verifyCredential(credential);
  private readonly onGisError = (): void => {
    if (!this.destroyed) this.error.set('Google Sign-In could not be completed. Please try again.');
  };

  ngAfterViewInit(): void {
    credentialHandler = this.onCredential;
    gisErrorHandler = this.onGisError;
    void this.initializeGoogleSignIn();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
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
        if (!this.destroyed) this.error.set('Google Sign-In button could not be displayed. Please refresh and try again.');
      }
    } catch (error) {
      this.reportGisSetupFailure(error);
    }
  }

  private waitForGoogleButton(): Promise<HTMLElement | null> {
    if (this.googleButtonElement) return Promise.resolve(this.googleButtonElement);
    return new Promise(resolve => this.googleButtonWaiters.push(resolve));
  }

  private async verifyCredential(credential: string): Promise<void> {
    if (this.destroyed || this.loading() || this.verifiedUser()) return;
    if (!credential) {
      this.error.set('Google Sign-In did not return a credential. Please try again.');
      return;
    }

    this.error.set('');
    this.loading.set(true);
    try {
      const response = await fetch(GOOGLE_IDENTITY_CONFIG.verificationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ credential }),
      });
      if (!response.ok) throw new Error('Verification request failed.');
      const result: unknown = await response.json();
      if (this.destroyed) return;
      if (!this.isVerifiedResponse(result)) {
        this.error.set(this.isVerificationFailure(result) ? result.error : 'Google account verification failed.');
        return;
      }
      this.verifiedUser.set({ email: result.user.email });
    } catch (error) {
      console.error('Google account verification request failed.', error);
      if (!this.destroyed) this.error.set('Unable to verify your Google account. Check your connection and try again.');
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }

  private reportGisSetupFailure(error: unknown): void {
    const originalError = error instanceof GisSetupError ? error.originalError ?? error : error;
    console.error('Google Sign-In setup failed.', originalError);
    if (this.destroyed) return;

    if (!(error instanceof GisSetupError)) {
      this.error.set('Google Sign-In setup encountered an unexpected error. Please refresh and try again.');
      return;
    }

    const message: Record<GisSetupFailure, string> = {
      SCRIPT_ELEMENT: 'Google Sign-In could not find its script on this page.',
      SCRIPT_LOAD: 'Google Sign-In script failed to load. Check your connection and try again.',
      SCRIPT_TIMEOUT: 'Google Sign-In script is taking too long to load. Please refresh and try again.',
      API_UNAVAILABLE: 'Google Sign-In loaded, but its API is unavailable. Please refresh and try again.',
      INITIALIZATION: 'Google Sign-In could not be initialized. Please refresh and try again.',
    };
    this.error.set(message[error.failure]);
  }

  private isVerifiedResponse(value: unknown): value is GoogleVerificationResponse & { success: true; user: VerifiedGoogleUser } {
    return typeof value === 'object' && value !== null
      && 'success' in value && value.success === true
      && 'user' in value && typeof value.user === 'object' && value.user !== null
      && 'email' in value.user && typeof value.user.email === 'string';
  }

  private isVerificationFailure(value: unknown): value is { success: false; error: string } {
    return typeof value === 'object' && value !== null
      && 'success' in value && value.success === false
      && 'error' in value && typeof value.error === 'string';
  }
}
