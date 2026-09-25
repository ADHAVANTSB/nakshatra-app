import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  ApiResponse,
  ApplicationRole,
  ApplicationSession,
  AuthenticatedApiRequest,
  CurrentUserData,
  LogoutData,
  SessionValidationData,
  SessionValidationResponse,
} from '../../models';
import { GOOGLE_IDENTITY_CONFIG } from '../../constants/google-identity.config';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private sessionValidationRequest: Promise<SessionValidationResponse> | null = null;

  /**
   * Calls an authenticated Apps Script action. The session id is an opaque value
   * issued and validated by the backend; Angular never supplies a user or role.
   */
  async post<TData, TPayload = undefined>(action: string, payload?: TPayload): Promise<ApiResponse<TData>> {
    const session = this.activeSession();
    if (!session) {
      return { success: false, error: { code: 'SESSION_REQUIRED', message: 'Your application session has expired. Please sign in again.' } };
    }

    const request: AuthenticatedApiRequest<TPayload> = { action, sessionId: session.id };
    if (payload !== undefined) request.payload = payload;

    try {
      const response = await fetch(GOOGLE_IDENTITY_CONFIG.verificationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(request),
      });
      const result: unknown = await response.json();
      if (!response.ok || !this.isApiResponse<TData>(result)) {
        return { success: false, error: { code: 'API_REQUEST_FAILED', message: 'The server could not process the request.' } };
      }
      if (!result.success) this.handleAuthenticationFailure(result.error.code);
      return result;
    } catch {
      return { success: false, error: { code: 'NETWORK_ERROR', message: 'Unable to reach the server. Please try again.' } };
    }
  }

  /** Returns the current backend-authorized application user for this session. */
  async getCurrentUser(): Promise<ApiResponse<CurrentUserData>> {
    const response = await this.post<CurrentUserData>('getCurrentUser');
    if (!response.success) return response;
    return this.isCurrentUserData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_CURRENT_USER_RESPONSE', message: 'The server returned an invalid current user response.' } };
  }

  /** Best-effort server invalidation; local session state is always cleared. */
  async invalidateApplicationSession(): Promise<void> {
    if (this.activeSession()) await this.post<LogoutData>('logout');
    this.auth.logout();
  }

  validateApplicationSession(): Promise<SessionValidationResponse> {
    if (!this.sessionValidationRequest) {
      this.sessionValidationRequest = this.requestSessionValidation()
        .finally(() => { this.sessionValidationRequest = null; });
    }
    return this.sessionValidationRequest;
  }

  private async requestSessionValidation(): Promise<SessionValidationResponse> {
    const response = await this.post<SessionValidationData>('validateSession');
    if (!response.success) return response;
    return this.isSessionValidationResponse(response)
      ? response
      : { success: false, error: { code: 'INVALID_SESSION_RESPONSE', message: 'The server returned an invalid session response.' } };
  }

  private activeSession(): ApplicationSession | null {
    const session = this.auth.applicationSession();
    if (!session) return null;
    if (Number.isNaN(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
      this.auth.logout();
      return null;
    }
    return session;
  }

  private handleAuthenticationFailure(code: string): void {
    if (code !== 'SESSION_INVALID' && code !== 'SESSION_REQUIRED' && code !== 'USER_NOT_APPROVED') return;
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  private isApiResponse<T>(value: unknown): value is ApiResponse<T> {
    if (typeof value !== 'object' || value === null || !('success' in value) || typeof value.success !== 'boolean') return false;
    if (value.success) return 'data' in value;
    return 'error' in value && typeof value.error === 'object' && value.error !== null
      && 'code' in value.error && typeof value.error.code === 'string'
      && 'message' in value.error && typeof value.error.message === 'string';
  }

  private isSessionValidationResponse(value: ApiResponse<SessionValidationData>): value is Extract<SessionValidationResponse, { success: true }> {
    if (!value.success) return false;
    const candidate: unknown = value;
    if (typeof candidate !== 'object' || candidate === null || !('access' in candidate) || candidate.access !== 'APPROVED'
      || !('user' in candidate) || !('data' in candidate)) return false;
    const user = candidate.user;
    const session = candidate.data && typeof candidate.data === 'object' && 'session' in candidate.data
      ? candidate.data.session : undefined;
    return typeof user === 'object' && user !== null
      && 'id' in user && typeof user.id === 'string'
      && 'googleId' in user && typeof user.googleId === 'string'
      && 'email' in user && typeof user.email === 'string'
      && 'displayName' in user && typeof user.displayName === 'string'
      && 'role' in user && this.isApplicationRole(user.role)
      && 'accessStatus' in user && user.accessStatus === 'APPROVED'
      && 'version' in user && typeof user.version === 'number'
      && typeof session === 'object' && session !== null
      && 'expiresAt' in session && typeof session.expiresAt === 'string'
      && !Number.isNaN(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > Date.now();
  }

  private isCurrentUserData(value: unknown): value is CurrentUserData {
    return typeof value === 'object' && value !== null && 'user' in value
      && this.isAuthenticatedApiUser(value.user);
  }

  private isAuthenticatedApiUser(value: unknown): value is CurrentUserData['user'] {
    return typeof value === 'object' && value !== null
      && 'id' in value && typeof value.id === 'string'
      && 'googleId' in value && typeof value.googleId === 'string'
      && 'email' in value && typeof value.email === 'string'
      && 'displayName' in value && typeof value.displayName === 'string'
      && 'role' in value && this.isApplicationRole(value.role)
      && 'accessStatus' in value && value.accessStatus === 'APPROVED'
      && 'version' in value && typeof value.version === 'number';
  }

  private isApplicationRole(value: unknown): value is ApplicationRole {
    return value === 'ADMIN' || value === 'SUPPORT' || value === 'EVENTS_TEAM'
      || value === 'LIAISON_TEAM' || value === 'CERTIFICATE_TEAM';
  }
}
