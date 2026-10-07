import { Injectable, inject } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';

/**
 * Server-owned application users.
 *
 * This is the only source for the Settings access-management module. Every
 * mutation calls the backend and carries the row `expectedVersion`, so a stale
 * write is rejected with VERSION_CONFLICT rather than silently overwriting a
 * concurrent change. Hiding a control is never treated as authorization — the
 * backend remains authoritative.
 */
@Injectable({ providedIn: 'root' })
export class UserAdminService {
  private readonly apiClient = inject(ApiClientService);

  listUsers() {
    return this.apiClient.listUsers();
  }

  createUser(email: string, displayName: string, role: UserAdminServiceRole) {
    return this.apiClient.adminCreateUser({ email, displayName, role });
  }

  approveUser(userId: string, expectedVersion: number, role: UserAdminServiceRole) {
    return this.apiClient.approveUser({ userId, expectedVersion, role });
  }

  rejectUser(userId: string, expectedVersion: number) {
    return this.apiClient.rejectUser({ userId, expectedVersion });
  }

  disableUser(userId: string, expectedVersion: number) {
    return this.apiClient.disableUser({ userId, expectedVersion });
  }

  enableUser(userId: string, expectedVersion: number) {
    return this.apiClient.enableUser({ userId, expectedVersion });
  }

  updateUserRole(userId: string, expectedVersion: number, role: UserAdminServiceRole) {
    return this.apiClient.updateUserRole({ userId, expectedVersion, role });
  }
}

export type UserAdminServiceRole =
  | 'ADMIN'
  | 'SUPPORT'
  | 'EVENTS_TEAM'
  | 'LIAISON_TEAM'
  | 'CERTIFICATE_TEAM';
