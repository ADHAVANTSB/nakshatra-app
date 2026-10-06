import { ApplicationRole, ApplicationSession } from './auth.model';
import { Event } from './event.model';
import { Gender, Participant } from './participant.model';
import { ParticipantEvent } from './participant-event.model';
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

export interface UpdateParticipantData {
  participant: Participant;
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
}
