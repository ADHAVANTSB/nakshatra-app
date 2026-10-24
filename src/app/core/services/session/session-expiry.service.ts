import { Injectable, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { friendlyError } from '../../permissions/friendly-error';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notifications/notification.service';

/** How long before the inactivity deadline the warning banner appears. */
export const SESSION_EXPIRY_WARNING_LEAD_MS = 5 * 60 * 1000;

/**
 * Client-side UX around the server-enforced session lifetime.
 *
 * The backend is authoritative: it expires a session after 2 hours of
 * inactivity — or at the absolute maximum lifetime, whichever comes first —
 * and rejects expired sessions server-side. Browser time is NEVER trusted for
 * enforcement; this service only schedules a non-blocking warning before the
 * last known deadline and a clean sign-in redirect when that deadline passes
 * without activity. Every successful authenticated response refreshes the
 * deadline estimate (ApiClientService → AuthService.updateSessionExpiry), so
 * continuous work keeps the banner away and "stay signed in" is simply one
 * more authenticated call.
 */
@Injectable({ providedIn: 'root' })
export class SessionExpiryService {
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  private readonly warningState = signal(false);
  /** True while the "session about to expire" banner should be shown. */
  readonly warningVisible = this.warningState.asReadonly();

  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // The session signal is the single source of truth (sign-in, restore,
    // activity-driven deadline refreshes and sign-out all flow through it);
    // the effect cleanup cancels pending timers on every change and on
    // teardown so no stray timer can fire after sign-out.
    effect(onCleanup => {
      this.schedule(this.auth.applicationSession()?.expiresAt ?? null);
      onCleanup(() => this.cancelTimers());
    });
  }

  /** Hides the warning banner; the session itself is untouched. */
  dismissWarning(): void {
    this.warningState.set(false);
  }

  private schedule(expiresAt: string | null): void {
    this.cancelTimers();

    if (!expiresAt) {
      this.warningState.set(false);
      return;
    }

    const msLeft = Date.parse(expiresAt) - Date.now();
    if (Number.isNaN(msLeft)) {
      this.warningState.set(false);
      return;
    }

    if (msLeft <= 0) {
      this.expireNow();
      return;
    }

    const warnInMs = msLeft - SESSION_EXPIRY_WARNING_LEAD_MS;
    if (warnInMs <= 0) {
      this.warningState.set(true);
    } else {
      // A fresh window clears a previously shown warning (activity renewed).
      this.warningState.set(false);
      this.warningTimer = setTimeout(() => this.warningState.set(true), warnInMs);
    }

    this.expiryTimer = setTimeout(() => this.expireNow(), msLeft);
  }

  private cancelTimers(): void {
    if (this.warningTimer !== null) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  /**
   * The last known deadline passed with no activity: sign out cleanly, say it
   * with the same friendly message the server rejection maps to, and return
   * to sign-in. Never blocks or corrupts work — saves are confirmed by their
   * own calls before this point.
   */
  private expireNow(): void {
    this.cancelTimers();
    this.warningState.set(false);
    const friendly = friendlyError('SESSION_INVALID', 'Session is invalid or expired');
    this.notifications.warning(friendly.message);
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
