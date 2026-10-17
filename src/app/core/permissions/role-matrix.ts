/**
 * Presentation-only view of the approved Nakshatra role permission table.
 *
 * This module does NOT authorize anything: the backend remains the security
 * boundary and every request is still validated server-side. It only decides
 * what the UI shows (view-only banners, hidden edit controls) so volunteers
 * see plain language instead of rejected writes.
 */

export type PermissionSection =
  | 'DASHBOARD'
  | 'HOMES'
  | 'PARTICIPANTS'
  | 'EVENTS'
  | 'ATTENDANCE'
  | 'SCORING'
  | 'RESULTS'
  | 'RESULT_APPROVAL'
  | 'CERTIFICATES'
  | 'REPORTS'
  | 'SETTINGS';

export type PermissionRole = 'ADMIN' | 'SUPPORT' | 'EVENTS_TEAM' | 'LIAISON_TEAM' | 'CERTIFICATE_TEAM';

/** Modules each non-admin role may edit (everything else is view-only). */
const EDITABLE: Record<Exclude<PermissionRole, 'ADMIN' | 'SUPPORT'>, PermissionSection[]> = {
  LIAISON_TEAM: ['HOMES', 'PARTICIPANTS'],
  EVENTS_TEAM: ['ATTENDANCE', 'SCORING'],
  CERTIFICATE_TEAM: ['RESULT_APPROVAL'],
};

/** The friendly banner shown on pages the role can view but not edit. */
export const VIEW_ONLY_TITLE = 'View-only access';
export const VIEW_ONLY_MESSAGE =
  'You can view the information on this page, but editing is not available for your role. ' +
  'Please contact your administrator if you need editing access.';

/** Whether the role may edit the module according to the approved matrix. */
export function canEditModule(role: string | undefined | null, section: PermissionSection): boolean {
  if (!role) return false;
  if (role === 'ADMIN' || role === 'SUPPORT') return true;
  return EDITABLE[role as Exclude<PermissionRole, 'ADMIN' | 'SUPPORT'>]?.includes(section) ?? false;
}
