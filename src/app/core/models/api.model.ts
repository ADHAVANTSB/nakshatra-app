import { ApplicationRole, ApplicationSession } from './auth.model';

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

/** Request body sent to the Apps Script Web App for authenticated API actions. */
export interface AuthenticatedApiRequest<TPayload = undefined> {
  action: string;
  sessionId: string;
  payload?: TPayload;
}

export interface AuthenticatedApiUser {
  id: string;
  googleId: string;
  email: string;
  displayName: string;
  role: ApplicationRole;
  accessStatus: 'APPROVED';
  version: number;
}

export interface SessionValidationData {
  session: Pick<ApplicationSession, 'expiresAt'>;
}

export type SessionValidationResponse =
  | {
      success: true;
      access: 'APPROVED';
      user: AuthenticatedApiUser;
      data: SessionValidationData;
    }
  | { success: false; error: ApiError };

export interface LogoutData {
  loggedOut: boolean;
}

/** Payload returned by the authenticated getCurrentUser action. */
export interface CurrentUserData {
  user: AuthenticatedApiUser;
}
