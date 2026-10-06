import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  ApiResponse,
  ApplicationRole,
  ApplicationSession,
  AuthenticatedApiRequest,
  ConnectShelterSheetData,
  ConnectShelterSheetPayload,
  CurrentUserData,
  Event,
  EventRegistrationData,
  EventRegistrationPayload,
  GetParticipantData,
  GetValidationResultsData,
  ImportStatusData,
  ImportStatusPayload,
  ListEventRegistrationsData,
  ListEventsData,
  ListParticipantEventsData,
  ListParticipantsData,
  ListShelterSheetsData,
  ListShelterHomesData,
  LogoutData,
  Participant,
  ParticipantEvent,
  SessionValidationData,
  SessionValidationResponse,
  SyncShelterSheetData,
  SyncShelterSheetPayload,
  UpdateParticipantData,
  UpdateParticipantPayload,
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

  async connectShelterSheet(payload: ConnectShelterSheetPayload): Promise<ApiResponse<ConnectShelterSheetData>> {
    const response = await this.post<ConnectShelterSheetData, ConnectShelterSheetPayload>('connectShelterSheet', payload);
    if (!response.success) return response;
    return this.isConnectShelterSheetData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_SHELTER_SHEET_CONNECTION_RESPONSE', message: 'The server returned an invalid shelter sheet connection.' } };
  }

  listShelterSheets(): Promise<ApiResponse<ListShelterSheetsData>> {
    return this.post<ListShelterSheetsData>('listShelterSheets');
  }

  syncShelterSheet(payload: SyncShelterSheetPayload): Promise<ApiResponse<SyncShelterSheetData>> {
    return this.post<SyncShelterSheetData, SyncShelterSheetPayload>('syncShelterSheet', payload);
  }

  getImportStatus(payload: ImportStatusPayload): Promise<ApiResponse<ImportStatusData>> {
    return this.post<ImportStatusData, ImportStatusPayload>('getImportStatus', payload);
  }

  getValidationResults(payload: ImportStatusPayload): Promise<ApiResponse<GetValidationResultsData>> {
    return this.post<GetValidationResultsData, ImportStatusPayload>('getValidationResults', payload);
  }

  listParticipants(shelterHomeId: string): Promise<ApiResponse<ListParticipantsData>> {
    return this.post<ListParticipantsData, { shelterHomeId: string }>('listParticipants', { shelterHomeId });
  }

  /** Reads one participant; the backend owns the record and its version. */
  async getParticipant(participantId: string): Promise<ApiResponse<GetParticipantData>> {
    const response = await this.post<GetParticipantData, { participantId: string }>('getParticipant', { participantId });
    if (!response.success) return response;
    return this.isGetParticipantData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_PARTICIPANT_RESPONSE', message: 'The server returned an invalid participant response.' } };
  }

  /**
   * Persists an authorized participant edit. The backend compares
   * `expectedVersion` and rejects a stale write with VERSION_CONFLICT.
   */
  async updateParticipant(payload: UpdateParticipantPayload): Promise<ApiResponse<UpdateParticipantData>> {
    const response = await this.post<UpdateParticipantData, UpdateParticipantPayload>('updateParticipant', payload);
    if (!response.success) return response;
    return this.isUpdateParticipantData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_PARTICIPANT_RESPONSE', message: 'The server returned an invalid participant response.' } };
  }

  listShelterHomes(): Promise<ApiResponse<ListShelterHomesData>> {
    return this.post<ListShelterHomesData>('listShelterHomes');
  }

  /** Event master data. The backend is the source of truth when it supplies it. */
  async listEvents(): Promise<ApiResponse<ListEventsData>> {
    const response = await this.post<ListEventsData>('listEvents');
    if (!response.success) return response;
    return this.isListEventsData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_EVENTS_RESPONSE', message: 'The server returned an invalid events response.' } };
  }

  /** Persisted registrations for one event. */
  async listEventRegistrations(eventId: string): Promise<ApiResponse<ListEventRegistrationsData>> {
    const response = await this.post<ListEventRegistrationsData, { eventId: string }>('listEventRegistrations', { eventId });
    if (!response.success) return response;
    return this.isListParticipantEventsData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_REGISTRATIONS_RESPONSE', message: 'The server returned an invalid registrations response.' } };
  }

  /** Persisted registrations for one participant. */
  async listParticipantEvents(participantId: string): Promise<ApiResponse<ListParticipantEventsData>> {
    const response = await this.post<ListParticipantEventsData, { participantId: string }>('listParticipantEvents', { participantId });
    if (!response.success) return response;
    return this.isListParticipantEventsData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_REGISTRATIONS_RESPONSE', message: 'The server returned an invalid registrations response.' } };
  }

  registerParticipant(payload: EventRegistrationPayload): Promise<ApiResponse<EventRegistrationData>> {
    return this.post<EventRegistrationData, EventRegistrationPayload>('registerParticipant', payload);
  }

  cancelRegistration(payload: EventRegistrationPayload): Promise<ApiResponse<EventRegistrationData>> {
    return this.post<EventRegistrationData, EventRegistrationPayload>('cancelRegistration', payload);
  }

  reactivateRegistration(payload: EventRegistrationPayload): Promise<ApiResponse<EventRegistrationData>> {
    return this.post<EventRegistrationData, EventRegistrationPayload>('reactivateRegistration', payload);
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

  private isConnectShelterSheetData(value: unknown): value is ConnectShelterSheetData {
    if (typeof value !== 'object' || value === null || !('shelterHome' in value) || !('sheetSource' in value)) return false;
    const { shelterHome, sheetSource } = value;
    return typeof shelterHome === 'object' && shelterHome !== null
      && 'id' in shelterHome && typeof shelterHome.id === 'string'
      && 'homeCode' in shelterHome && typeof shelterHome.homeCode === 'string'
      && 'homeName' in shelterHome && typeof shelterHome.homeName === 'string'
      && 'status' in shelterHome && shelterHome.status === 'ACTIVE'
      && typeof sheetSource === 'object' && sheetSource !== null
      && 'id' in sheetSource && typeof sheetSource.id === 'string'
      && (!('spreadsheetName' in sheetSource) || typeof sheetSource.spreadsheetName === 'string')
      && 'sourceStatus' in sheetSource && sheetSource.sourceStatus === 'CONNECTED';
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

  private isParticipant(value: unknown): value is Participant {
    return typeof value === 'object' && value !== null
      && 'id' in value && typeof value.id === 'string'
      && 'participantCode' in value && typeof value.participantCode === 'string'
      && 'shelterHomeId' in value && typeof value.shelterHomeId === 'string'
      && 'fullName' in value && typeof value.fullName === 'string'
      && 'gender' in value && (value.gender === 'MALE' || value.gender === 'FEMALE')
      && 'age' in value && typeof value.age === 'number'
      && 'standard' in value && typeof value.standard === 'number'
      && 'version' in value && typeof value.version === 'number'
      && 'approvalStatus' in value && this.isApprovalStatus(value.approvalStatus)
      && 'lockStatus' in value && this.isLockStatus(value.lockStatus)
      && 'validationStatus' in value && this.isValidationStatus(value.validationStatus);
  }

  private isEvent(value: unknown): value is Event {
    return typeof value === 'object' && value !== null
      && 'id' in value && typeof value.id === 'string'
      && 'eventCode' in value && typeof value.eventCode === 'string'
      && 'name' in value && typeof value.name === 'string'
      && 'category' in value
      && (value.category === 'ARTS' || value.category === 'LITERARY' || value.category === 'CULTURAL')
      && 'mode' in value && (value.mode === 'SOLO' || value.mode === 'GROUP')
      && 'eligibleLevels' in value && Array.isArray(value.eligibleLevels)
      && 'status' in value
      && (value.status === 'ACTIVE' || value.status === 'CANCELLED' || value.status === 'INACTIVE');
  }

  private isParticipantEvent(value: unknown): value is ParticipantEvent {
    return typeof value === 'object' && value !== null
      && 'id' in value && typeof value.id === 'string'
      && 'participantId' in value && typeof value.participantId === 'string'
      && 'eventId' in value && typeof value.eventId === 'string'
      && 'registrationStatus' in value
      && (value.registrationStatus === 'REGISTERED' || value.registrationStatus === 'CANCELLED' || value.registrationStatus === 'WAITLISTED')
      && 'version' in value && typeof value.version === 'number';
  }

  private isGetParticipantData(value: unknown): value is GetParticipantData {
    return typeof value === 'object' && value !== null
      && 'participant' in value && this.isParticipant(value.participant);
  }

  private isUpdateParticipantData(value: unknown): value is UpdateParticipantData {
    return typeof value === 'object' && value !== null
      && 'participant' in value && this.isParticipant(value.participant);
  }

  private isListEventsData(value: unknown): value is ListEventsData {
    return typeof value === 'object' && value !== null
      && 'events' in value && Array.isArray(value.events)
      && value.events.every(event => this.isEvent(event));
  }

  private isListParticipantEventsData(
    value: unknown
  ): value is ListEventRegistrationsData & ListParticipantEventsData {
    return typeof value === 'object' && value !== null
      && 'participantEvents' in value && Array.isArray(value.participantEvents)
      && value.participantEvents.every(item => this.isParticipantEvent(item));
  }

  private isApprovalStatus(value: unknown): boolean {
    return value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED';
  }

  private isLockStatus(value: unknown): boolean {
    return value === 'LOCKED' || value === 'UNLOCKED';
  }

  private isValidationStatus(value: unknown): boolean {
    return value === 'NOT_VALIDATED' || value === 'PASSED' || value === 'FAILED' || value === 'WARNING';
  }
}
