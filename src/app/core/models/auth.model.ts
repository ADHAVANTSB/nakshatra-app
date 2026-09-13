export type ApplicationRole = 'ADMIN' | 'SUPPORT' | 'EVENTS_TEAM' | 'LIAISON_TEAM' | 'CERTIFICATE_TEAM';
export type AccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';

export interface ApplicationUser {
  id: string;
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

export type ApplicationSection =
  | 'DASHBOARD' | 'HOMES' | 'PARTICIPANTS' | 'EVENTS' | 'ATTENDANCE'
  | 'SCORING' | 'RESULTS' | 'CERTIFICATES' | 'REPORTS' | 'ACCESS_MANAGEMENT';
