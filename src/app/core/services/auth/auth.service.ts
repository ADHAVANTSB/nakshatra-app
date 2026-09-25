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

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly users = signal<ApplicationUser[]>([this.createSeedAdmin()]);
  private readonly sessionUserId = signal<string | null>(null);
  private readonly applicationSessionState = signal<ApplicationSession | null>(null);
  readonly users$ = this.users.asReadonly();
  /** A copy prevents consumers from mutating the in-memory session state. */
  readonly applicationSession = computed(() => {
    const session = this.applicationSessionState();
    return session ? { ...session } : null;
  });
  readonly currentUser = computed(() => this.sessionUserId()
    ? this.users().find(user => user.id === this.sessionUserId())
    : undefined);
  readonly isAuthenticated = computed(() => !!this.currentUser() && this.currentUser()?.accessStatus === 'APPROVED' && !!this.currentUser()?.role);

  login(email: string, password: string): AuthResult {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return { success: false, errors: ['Email and password are required.'] };
    const user = this.users().find(item => item.email.toLowerCase() === normalizedEmail);
    if (!user) return { success: false, errors: ['No approved account was found for these login details.'] };
    if (user.accessStatus !== 'APPROVED' || !user.role) return { success: false, errors: ['This account does not currently have approved application access.'] };
    // Deliberately no password is stored, compared, or persisted in this frontend adapter.
    this.sessionUserId.set(user.id);
    return { success: true, errors: [] };
  }

  logout(): void {
    this.applicationSessionState.set(null);
    this.sessionUserId.set(null);
  }

  setApplicationSession(session: ApplicationSession): void {
    this.applicationSessionState.set({ ...session });
  }

  clearApplicationSession(): void {
    this.applicationSessionState.set(null);
  }

  setGoogleAuthenticatedUser(user: GoogleAuthenticatedUser): void {
    const existing = this.getUser(user.id);
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

  register(displayName: string, email: string): AuthResult {
    const name = displayName.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!name) return { success: false, errors: ['Name is required.'] };
    if (!this.isEmail(normalizedEmail)) return { success: false, errors: ['Enter a valid email address.'] };
    if (this.users().some(user => user.email.toLowerCase() === normalizedEmail)) {
      return { success: false, errors: ['A registration request already exists for this email address.'] };
    }
    const now = new Date().toISOString();
    const user: ApplicationUser = { id: crypto.randomUUID(), displayName: name, email: normalizedEmail, accessStatus: 'PENDING', version: 1, createdAt: now, createdBy: 'SELF_REGISTRATION', updatedAt: now, updatedBy: 'SELF_REGISTRATION' };
    this.users.update(current => [...current, user]);
    return { success: true, errors: [] };
  }

  approve(userId: string, role: ApplicationRole): AuthResult { return this.updateUser(userId, { accessStatus: 'APPROVED', role }, 'ADMIN'); }
  reject(userId: string): AuthResult { return this.updateUser(userId, { accessStatus: 'REJECTED' }, 'ADMIN'); }
  disable(userId: string): AuthResult {
    if (this.currentUser()?.id === userId) return { success: false, errors: ['You cannot disable the active frontend session.'] };
    return this.updateUser(userId, { accessStatus: 'DISABLED' }, 'ADMIN');
  }
  enable(userId: string): AuthResult {
    const user = this.getUser(userId);
    if (!user?.role) return { success: false, errors: ['Assign an application role before enabling access.'] };
    return this.updateUser(userId, { accessStatus: 'APPROVED' }, 'ADMIN');
  }
  assignRole(userId: string, role: ApplicationRole): AuthResult { return this.updateUser(userId, { role }, 'ADMIN'); }

  canAccess(section: ApplicationSection): boolean {
    const role = this.currentUser()?.role;
    if (!this.isAuthenticated() || !role) return false;
    if (role === 'ADMIN' || role === 'SUPPORT') return true;
    const allowed: Record<Exclude<ApplicationRole, 'ADMIN' | 'SUPPORT'>, ApplicationSection[]> = {
      EVENTS_TEAM: ['DASHBOARD', 'PARTICIPANTS', 'EVENTS', 'ATTENDANCE', 'SCORING', 'RESULTS'],
      LIAISON_TEAM: ['DASHBOARD', 'HOMES', 'PARTICIPANTS', 'EVENTS', 'ATTENDANCE', 'RESULTS'],
      CERTIFICATE_TEAM: ['DASHBOARD', 'RESULTS', 'CERTIFICATES'],
    };
    return allowed[role].includes(section);
  }

  private updateUser(userId: string, changes: Partial<Pick<ApplicationUser, 'accessStatus' | 'role'>>, updatedBy: string): AuthResult {
    const existing = this.getUser(userId);
    if (!existing) return { success: false, errors: ['User not found.'] };
    const now = new Date().toISOString();
    this.users.update(current => current.map(user => user.id === userId ? { ...user, ...changes, version: user.version + 1, updatedAt: now, updatedBy } : user));
    return { success: true, errors: [] };
  }

  private getUser(userId: string): ApplicationUser | undefined { return this.users().find(user => user.id === userId); }
  private isEmail(email: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
  private createSeedAdmin(): ApplicationUser {
    const now = new Date().toISOString();
    return { id: 'demo-admin', displayName: 'Demo Administrator', email: 'admin@nakshatra.local', role: 'ADMIN', accessStatus: 'APPROVED', version: 1, createdAt: now, createdBy: 'FRONTEND_DEMO', updatedAt: now, updatedBy: 'FRONTEND_DEMO' };
  }
}
