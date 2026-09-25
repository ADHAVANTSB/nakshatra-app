export type ApplicationRole = 'ADMIN' | 'SUPPORT' | 'EVENTS_TEAM' | 'LIAISON_TEAM' | 'CERTIFICATE_TEAM';
export type AccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';

export interface ApplicationUser {
  id: string;
  googleId?: string;
  displayName: string;
  email: string;
  role?: ApplicationRole;
  accessStatus: AccessStatus;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/**
 * Opaque, short-lived application session issued by the Apps Script backend.
 * It intentionally contains no user identity, role, or Google credential.
 */
export interface ApplicationSession {
  id: string;
  expiresAt: string;
}

export type ApplicationSection =
  | 'DASHBOARD' | 'HOMES' | 'PARTICIPANTS' | 'EVENTS' | 'ATTENDANCE'
  | 'SCORING' | 'RESULTS' | 'CERTIFICATES' | 'REPORTS' | 'ACCESS_MANAGEMENT';
