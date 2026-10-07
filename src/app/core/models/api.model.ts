import { Attendance, AttendanceStatus } from './attendance.model';
import { AccessStatus, ApplicationRole, ApplicationSession, ApplicationUser } from './auth.model';
import { Team, TeamMember } from './team.model';
import { Event } from './event.model';
import { Gender, Participant } from './participant.model';
import { ParticipantEvent } from './participant-event.model';
import { Score } from './score.model';
import { ValidationResult } from './validation-result.model';

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

export interface ConnectShelterSheetPayload {
  homeName: string;
  address: string;
  contactName: string;
  contactPhone: string;
  /** The Google Sheets URL exactly as entered; the backend resolves the sheet. */
  spreadsheetUrl: string;
}

export interface ShelterSheet {
  id: string;
  name: string;
  modifiedAt?: string;
}

export interface ListShelterSheetsData {
  sheets: ShelterSheet[];
}

export interface ConnectShelterSheetData {
  shelterHome: { id: string; homeCode: string; homeName: string; status: 'ACTIVE' };
  sheetSource: { id: string; spreadsheetName?: string; sourceStatus: 'CONNECTED' };
}

export interface SyncShelterSheetPayload {
  shelterHomeId: string;
}

export interface ImportProgressData {
  importVersion?: {
    id: string;
    versionNumber?: number;
    recordCount?: number;
    errorCount?: number;
    warningCount?: number;
    status?: string;
    validationStatus?: string;
  };
  importVersionId?: string;
  versionNumber?: number;
  recordCount?: number;
  validParticipantCount?: number;
  errorCount?: number;
  warningCount?: number;
  status?: string;
}

export interface ImportStatusEntry {
  id?: string;
  importVersionId?: string;
  shelterHomeId: string;
  versionNumber?: number;
  recordCount?: number;
  validParticipantCount?: number;
  errorCount?: number;
  warningCount?: number;
  status?: string;
}

export interface ImportStatusPayload {
  shelterHomeId: string;
  importVersionId?: string;
}

export interface SyncShelterSheetData extends ImportProgressData {
  shelterHomeId: string;
  shelterHomeName: string;
  spreadsheetName: string;
  importVersionId: string;
  versionNumber: number;
  status: string;
  recordCount: number;
  validParticipantCount: number;
  errorCount: number;
  warningCount: number;
}
export interface ImportStatusData {
  imports: ImportStatusEntry[];
}

export interface GetValidationResultsData {
  validationResults: ValidationResult[];
}

export interface ListParticipantsData {
  participants: Participant[];
}

export interface ConnectedShelterHome {
  id: string;
  homeCode: string;
  homeName: string;
  address: string;
  contactName: string;
  contactPhone: string;
  status: string;
  version: number;
  spreadsheetName?: string;
  /** Backend-supplied link that opens the connected sheet; never built locally. */
  spreadsheetOpenUrl?: string;
  sourceStatus?: string;
  currentImportVersionId?: string;
  lastSyncedAt?: string;
}

export interface ListShelterHomesData {
  shelterHomes: ConnectedShelterHome[];
}

/* ================================================================
   PARTICIPANTS
   ================================================================ */

/** Optimistic-concurrency payload; the backend rejects a stale `expectedVersion`. */
export interface UpdateParticipantPayload {
  participantId: string;
  expectedVersion: number;
  fullName: string;
  gender: Gender;
  age: number;
  standard: number;
}

export interface GetParticipantData {
  participant: Participant;
}

/**
 * Reports whether the backend also wrote the change back to the source
 * Google Sheet. `SKIPPED` means Nakshatra stored the change but the sheet was
 * intentionally left untouched; `UNVERIFIED` means the sheet could not be
 * confirmed as updated.
 */
export type SourceWriteBackStatus = 'UPDATED' | 'SKIPPED' | 'FAILED' | 'UNVERIFIED';

export interface SourceWriteBackResult {
  status: SourceWriteBackStatus;
  message?: string;
  rowNumber?: number;
}

export interface UpdateParticipantData {
  participant: Participant;
  sourceWriteBack?: SourceWriteBackResult;
}

/* ================================================================
   EVENTS
   ================================================================ */

export interface ListEventsData {
  events: Event[];
}

export interface ListEventRegistrationsData {
  participantEvents: ParticipantEvent[];
}

export interface ListParticipantEventsData {
  participantEvents: ParticipantEvent[];
}

export interface EventRegistrationPayload {
  participantId: string;
  eventId: string;
}

export interface EventRegistrationData {
  participantEvent: ParticipantEvent;
  /** Present when the backend reported whether the Event wise sheet was written. */
  sourceWriteBack?: SourceWriteBackResult;
}

/* ================================================================
   TEAMS
   ================================================================ */

export interface ListTeamsData {
  teams: Team[];
  members: TeamMember[];
}

export interface GetTeamData {
  team: Team;
  members: TeamMember[];
}

export interface CreateTeamPayload {
  eventId: string;
  name: string;
}

export interface TeamMemberPayload {
  teamId: string;
  participantId: string;
}

/* ================================================================
   ATTENDANCE
   ================================================================ */

export interface MarkAttendancePayload {
  eventId: string;
  participantId: string;
  status: AttendanceStatus;
  teamId?: string;
  expectedVersion?: number;
}

export interface AttendanceData {
  attendance: Attendance;
}

/* ================================================================
   SCORING
   ================================================================ */

export interface ListScoresData {
  scores: Score[];
}

/** Exactly one of participantId or teamId identifies the scored target. */
export interface SaveScorePayload {
  eventId: string;
  participantId?: string;
  teamId?: string;
  value: number;
  expectedVersion?: number;
}

export interface FinalizeScorePayload {
  eventId: string;
  participantId?: string;
  teamId?: string;
  value?: number;
  expectedVersion?: number;
}

export interface ScoreData {
  score: Score;
}

export interface FinalizeScoreData {
  score: Score;
  sourceWriteBack?: SourceWriteBackResult;
}

/* ================================================================
   ACCESS MANAGEMENT
   ================================================================ */

export interface ListUsersData {
  users: ApplicationUser[];
}

export interface AdminCreateUserPayload {
  email: string;
  displayName: string;
  role: ApplicationRole;
}

export interface RequestRegistrationPayload {
  email: string;
  displayName: string;
  requestedRole: ApplicationRole;
}

/** Every user mutation carries the row version for optimistic concurrency. */
export interface UserVersionPayload {
  userId: string;
  expectedVersion: number;
}

export interface ApproveUserPayload extends UserVersionPayload {
  role: ApplicationRole;
}

export interface UpdateUserRolePayload extends UserVersionPayload {
  role: ApplicationRole;
}

/** `notified` reflects whether the backend sent the transactional email. */
export interface UserMutationData {
  user: ApplicationUser;
  notified?: boolean;
  message?: string;
}

export interface RegistrationRequestData {
  request: {
    id: string;
    email: string;
    displayName: string;
    requestedRole: ApplicationRole;
    accessStatus: AccessStatus;
    requestedAt: string;
  };
}

/* ================================================================
   DASHBOARD + REPORTS
   ================================================================ */

/** Shape produced by the backend dashboard summary action. */
export interface DashboardSummaryData {
  summary: OperationalCounts;
}

export interface OperationalCounts {
  homes: number;
  participants: number;
  events: number;
  activeEvents: number;
  registrations: number;
  teams: number;
  attendance: AttendanceCounts;
  finalizedScores: number;
  certificates: CertificateCounts;
}

export interface AttendanceCounts {
  recorded: number;
  present: number;
  absent: number;
}

export interface CertificateCounts {
  generated: number;
  issued: number;
}

/**
 * Backend report payload. Each collection is optional because a report may be
 * requested for a single scope (for example one event or one home).
 */
export interface GetReportsData {
  summary?: OperationalCounts;
  homes?: unknown[];
  events?: unknown[];
  participants?: unknown[];
}

/** Optional report scoping; an empty scope requests every collection. */
export interface ReportScopePayload {
  homeId?: string;
  eventId?: string;
  category?: Event['category'];
}
