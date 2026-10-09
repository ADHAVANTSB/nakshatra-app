import { Injectable, computed, signal } from '@angular/core';
import { AccessStatus, ApplicationRole, ApplicationSection, ApplicationSession, ApplicationUser } from '../../models';

export interface AuthResult { success: boolean; errors: string[]; }

export interface GoogleAuthenticatedUser {
  id: string;
  googleId: string;
  email: string;
  displayName: string;
  role: ApplicationRole;
  accessStatus: 'APPROVED';
  version: number;
}

/**
 * Session state and role-based section access.
 *
 * This service holds only the signed-in identity and its opaque session. It owns
 * no user directory: application users are server-owned and are read exclusively
 * through `UserAdminService` / `listUsers()`. Authorization decisions here are
 * UX guards that keep navigation consistent with the role; the backend remains
 * authoritative for every real access decision.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private static readonly SESSION_STORAGE_KEY = 'nakshatra.applicationSession';

  private readonly users = signal<ApplicationUser[]>([]);
  private readonly sessionUserId = signal<string | null>(null);
  private readonly applicationSessionState = signal<ApplicationSession | null>(null);

  /** A copy prevents consumers from mutating the in-memory session state. */
  readonly applicationSession = computed(() => {
    const session = this.applicationSessionState();
    return session ? { ...session } : null;
  });
  readonly currentUser = computed(() => this.sessionUserId()
    ? this.users().find(user => user.id === this.sessionUserId())
    : undefined);
  readonly isAuthenticated = computed(() => !!this.currentUser() && this.currentUser()?.accessStatus === 'APPROVED' && !!this.currentUser()?.role);

  logout(): void {
    this.applicationSessionState.set(null);
    this.sessionUserId.set(null);
    this.clearPersistedSession();
  }

  setApplicationSession(session: ApplicationSession): void {
    this.applicationSessionState.set({ ...session });
    this.persistSession(session);
  }

  clearApplicationSession(): void {
    this.applicationSessionState.set(null);
    this.clearPersistedSession();
  }

  /**
   * Persists the session so a page refresh can restore it.
   *
   * Only the opaque session id and its expiry are stored (sessionStorage is
   * tab-scoped and dies with the tab). Nothing else about the user is cached;
   * the identity is re-established exclusively through the backend's
   * `validateSession` action on the next boot.
   */
  private persistSession(session: ApplicationSession): void {
    try {
      sessionStorage.setItem(
        AuthService.SESSION_STORAGE_KEY,
        JSON.stringify({ id: session.id, expiresAt: session.expiresAt })
      );
    } catch {
      // Storage can be unavailable (privacy mode); the session simply stays
      // in memory and the user signs in again after a refresh.
    }
  }

  private clearPersistedSession(): void {
    try {
      sessionStorage.removeItem(AuthService.SESSION_STORAGE_KEY);
    } catch {
      // Nothing to clear if storage is unavailable.
    }
  }

  /**
   * Returns the persisted session from a previous page load, or null.
   *
   * A malformed, expired or unreadable entry is discarded, so a stale local
   * session can never reach the application unvalidated — the backend still
   * re-validates whatever is returned here.
   */
  restorePersistedSession(): ApplicationSession | null {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(AuthService.SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        this.clearPersistedSession();
        return null;
      }

      const id = (parsed as { id?: unknown }).id;
      const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt;

      if (typeof id !== 'string' || !id
        || typeof expiresAt !== 'string'
        || Number.isNaN(Date.parse(expiresAt))
        || Date.parse(expiresAt) <= Date.now()) {
        this.clearPersistedSession();
        return null;
      }

      return { id, expiresAt };
    } catch {
      this.clearPersistedSession();
      return null;
    }
  }

  /** Records the backend-authorized identity issued for the current session. */
  setGoogleAuthenticatedUser(user: GoogleAuthenticatedUser): void {
    const existing = this.users().find(item => item.id === user.id);
    const now = new Date().toISOString();
    const sessionUser: ApplicationUser = {
      ...user,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? 'GOOGLE_SIGN_IN',
      updatedAt: now,
      updatedBy: 'GOOGLE_SIGN_IN',
    };
    this.users.update(current => {
      const index = current.findIndex(item => item.id === user.id);
      return index === -1
        ? [...current, sessionUser]
        : current.map(item => item.id === user.id ? sessionUser : item);
    });
    this.sessionUserId.set(user.id);
  }

  /**
   * Whether the signed-in role may reach a section.
   *
   * Only administrators and support staff reach access management; every other
   * role is limited to the sections it actually works in.
   */
  canAccess(section: ApplicationSection): boolean {
    const role = this.currentUser()?.role;
    if (!this.isAuthenticated() || !role) return false;
    if (role === 'ADMIN') return true;
    if (section === 'ACCESS_MANAGEMENT') return role === 'SUPPORT';
    if (role === 'SUPPORT') return true;
    const allowed: Record<Exclude<ApplicationRole, 'ADMIN' | 'SUPPORT'>, ApplicationSection[]> = {
      EVENTS_TEAM: ['DASHBOARD', 'PARTICIPANTS', 'EVENTS', 'ATTENDANCE', 'SCORING', 'RESULTS'],
      LIAISON_TEAM: ['DASHBOARD', 'HOMES', 'PARTICIPANTS', 'EVENTS', 'ATTENDANCE', 'RESULTS'],
      CERTIFICATE_TEAM: ['DASHBOARD', 'RESULTS', 'CERTIFICATES'],
    };
    return allowed[role].includes(section);
  }
}
