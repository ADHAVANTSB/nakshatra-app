import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notifications/notification.service';
import { SESSION_EXPIRY_WARNING_LEAD_MS, SessionExpiryService } from './session-expiry.service';

/**
 * Session expiry UX (MOCKED timers; no backend involved).
 *
 * The backend is authoritative for real expiry — these tests pin only the
 * client behavior around the last known deadline: the 5-minute warning
 * banner, dismissal, the "stay signed in" deadline refresh and the clean
 * sign-in redirect with the friendly message on expiry.
 */

const MINUTE = 60 * 1000;

describe('SessionExpiryService', () => {
  let auth: AuthService;
  let notifications: NotificationService;
  let router: Router;
  let sessionExpiry: SessionExpiryService;

  beforeEach(async () => {
    vi.useFakeTimers();

    await TestBed.configureTestingModule({
      providers: [provideRouter([])],
    }).compileComponents();

    auth = TestBed.inject(AuthService);
    notifications = TestBed.inject(NotificationService);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    sessionExpiry = TestBed.inject(SessionExpiryService);
  });

  afterEach(() => {
    auth.logout();
    TestBed.flushEffects();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function signInWith(expiresAt: string): void {
    auth.setApplicationSession({ id: 'spec-session', expiresAt });
    TestBed.flushEffects();
  }

  it('shows the warning 5 minutes before the inactivity deadline and signs out cleanly at expiry', () => {
    signInWith(new Date(Date.now() + 2 * 60 * MINUTE).toISOString());
    expect(sessionExpiry.warningVisible()).toBe(false);

    // 1h55m of quiet: the banner appears exactly at the 5-minute lead.
    vi.advanceTimersByTime(2 * 60 * MINUTE - SESSION_EXPIRY_WARNING_LEAD_MS);
    expect(sessionExpiry.warningVisible()).toBe(true);
    // The warning is a banner, not a toast.
    expect(notifications.notifications()).toEqual([]);

    // The 2h inactivity window passes with no activity at all.
    vi.advanceTimersByTime(SESSION_EXPIRY_WARNING_LEAD_MS);
    expect(sessionExpiry.warningVisible()).toBe(false);
    expect(auth.applicationSession()).toBeNull();
    expect(notifications.notifications().map(n => n.message))
      .toContain('Your session has expired. Please sign in again.');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('shows the warning immediately when less than the lead time remains', () => {
    signInWith(new Date(Date.now() + 2 * MINUTE).toISOString());

    expect(sessionExpiry.warningVisible()).toBe(true);
  });

  it('dismiss hides the warning without touching the session', () => {
    signInWith(new Date(Date.now() + 2 * MINUTE).toISOString());
    expect(sessionExpiry.warningVisible()).toBe(true);

    sessionExpiry.dismissWarning();

    expect(sessionExpiry.warningVisible()).toBe(false);
    expect(auth.applicationSession()).not.toBeNull();
  });

  it('a renewed deadline (stay signed in) clears the warning and re-arms the window', () => {
    signInWith(new Date(Date.now() + 2 * MINUTE).toISOString());
    expect(sessionExpiry.warningVisible()).toBe(true);

    // "Stay signed in" is one authenticated call; its response refreshes the
    // deadline through AuthService.updateSessionExpiry (ApiClientService).
    auth.updateSessionExpiry(new Date(Date.now() + 2 * 60 * MINUTE).toISOString());
    TestBed.flushEffects();

    expect(sessionExpiry.warningVisible()).toBe(false);

    // The new window is watched too: quiet again → warning at the new lead.
    vi.advanceTimersByTime(2 * 60 * MINUTE - SESSION_EXPIRY_WARNING_LEAD_MS);
    expect(sessionExpiry.warningVisible()).toBe(true);
  });

  it('signing out cancels the pending expiry timers', () => {
    signInWith(new Date(Date.now() + 2 * MINUTE).toISOString());

    auth.logout();
    TestBed.flushEffects();
    vi.advanceTimersByTime(10 * 60 * MINUTE);

    expect(sessionExpiry.warningVisible()).toBe(false);
    expect(notifications.notifications()).toEqual([]);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('never warns or redirects without a session', () => {
    TestBed.flushEffects();
    vi.advanceTimersByTime(10 * 60 * MINUTE);

    expect(sessionExpiry.warningVisible()).toBe(false);
    expect(notifications.notifications()).toEqual([]);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
