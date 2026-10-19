import { friendlyError } from '../../permissions/friendly-error';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  AdminCreateUserPayload,
  ApiResponse,
  Attendance,
  AttendanceData,
  CreateTeamPayload,
  GetTeamData,
  ListScoresData,
  ListWinnersData,
  ListWinnersPayload,
  ListTeamsData,
  MarkAttendancePayload,
  Team,
  TeamMember,
  TeamMemberPayload,
  ApplicationRole,
  ApplicationSession,
  ApplicationUser,
  ApproveUserPayload,
  AuthenticatedApiRequest,
  ConnectShelterSheetData,
  ConnectShelterSheetPayload,
  CurrentUserData,
  DashboardSummaryData,
  DatasetRefreshPreviewData,
  Event,
  EventRegistrationData,
  EventRegistrationPayload,
  FinalizeEventData,
  FinalizeEventPayload,
  ReopenEventScoresData,
  ReopenEventScoresPayload,
  ConfirmHomeSheetPayload,
  HomeSheetData,
  ListEventJudgesData,
  ListEventJudgesPayload,
  ListJudgeScoresData,
  ListJudgeScoresPayload,
  SaveEventJudgesData,
  SaveEventJudgesPayload,
  SaveJudgeScoresPayload,
  SaveResultApprovalPayload,
  UnlockHomeSheetPayload,
  GetParticipantData,
  GetReportsData,
  GetValidationResultsData,
  ArchiveShelterHomeData,
  ArchiveShelterHomePayload,
  ImportStatusData,
  ImportStatusPayload,
  ListEventRegistrationsData,
  ListEventsData,
  ListParticipantEventsData,
  ListParticipantsData,
  ListShelterHomesData,
  ListResultsData,
  PageDataData,
  ListAttendanceData,
  ListAttendancePayload,
  PreviewShelterSheetPayload,
  ShelterSheetPreviewData,
  ListShelterHomesPayload,
  ListShelterSheetsData,
  ListUsersData,
  LogoutData,
  OperationalCounts,
  Participant,
  ParticipantEvent,
  ParticipantEventSummariesData,
  ParticipantEventSummariesPayload,
  ReconcileParticipantSheetWritesData,
  ReconcileParticipantSheetWritesPayload,
  RestoreShelterHomeData,
  RestoreShelterHomePayload,
  ShelterHomeArchivePreviewData,
  ShelterHomeIdPayload,
  RegistrationRequestData,
  RegistrationStatus,
  ReportScopePayload,
  RequestRegistrationPayload,
  Score,
  SessionValidationData,
  SessionValidationResponse,
  SourceWriteBackResult,
  StartSyncAllHomesPayload,
  SyncAllHomesData,
  SyncAllHomesJob,
  SyncAllHomesJobPayload,
  SyncAllHomesStatusData,
  SyncShelterSheetData,
  SyncShelterSheetPayload,
  UpdateParticipantData,
  UpdateParticipantPayload,
  UpdateUserRolePayload,
  UserMutationData,
  UserVersionPayload,
} from '../../models';
import { GOOGLE_IDENTITY_CONFIG } from '../../constants/google-identity.config';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private sessionValidationRequest: Promise<SessionValidationResponse> | null = null;

  /**
   * Terminal-state guarantee for every request.
   *
   * The deployed backend measures 8–30s per call on the error path alone
   * (verified 2026-10-07), so this ceiling is deliberately far above the
   * observed latency. It exists so a hung request can never keep a loading
   * signal true forever — it is not a UX delay and not a retry.
   */
  private static readonly REQUEST_TIMEOUT_MS = 120_000;

  /**
   * Calls an authenticated Apps Script action. The session id is an opaque value
   * issued and validated by the backend; Angular never supplies a user or role.
   *
   * Error truthfulness: a JSON body carrying a backend error envelope is
   * returned verbatim even over a non-200 status; only a non-JSON body
   * (Apps Script HTML error/quota pages), an unrecognized envelope, a genuine
   * network failure or a timeout produce a synthesized error.
   */
  async post<TData, TPayload = undefined>(action: string, payload?: TPayload): Promise<ApiResponse<TData>> {
    const session = this.activeSession();
    if (!session) {
      return this.synthesizedFailure('SESSION_REQUIRED', 'Your application session has expired. Please sign in again.');
    }

    const request: AuthenticatedApiRequest<TPayload> = { action, sessionId: session.id };
    if (payload !== undefined) request.payload = payload;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      ApiClientService.REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetch(GOOGLE_IDENTITY_CONFIG.verificationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      let result: unknown;
      try {
        result = await response.json();
      } catch {
        return this.synthesizedFailure(
          'SERVER_RESPONSE_MALFORMED',
          `The server returned a non-JSON response (HTTP ${response.status}). This is usually an Apps Script error or quota page, not an application error.`,
          { action, httpStatus: response.status },
        );
      }

      if (this.isApiResponse<TData>(result)) {
        if (!result.success) {
          // Preserve the real backend error even over a non-200 status;
          // only the presented message is friendly (code stays intact).
          this.handleAuthenticationFailure(result.error.code);
          const friendly = friendlyError(result.error.code, result.error.message, {
            action,
            httpStatus: response.status,
            requestId: this.requestIdOf(result),
          });
          return { success: false, error: { code: friendly.code, message: friendly.message } };
        }
        if (!response.ok) {
          return this.synthesizedFailure('API_REQUEST_FAILED', `The server reported HTTP ${response.status} for a successful payload.`, { action, httpStatus: response.status });
        }
        return result;
      }

      return this.classifyUnrecognizedResponse(action, result, response.status);
    } catch (error) {
      if (controller.signal.aborted) {
        return this.synthesizedFailure(
          'REQUEST_TIMEOUT',
          `The server did not answer within ${ApiClientService.REQUEST_TIMEOUT_MS / 1000} seconds. The request may still have been processed — refresh before retrying.`,
          { action },
        );
      }
      return this.synthesizedFailure('NETWORK_ERROR', 'Unable to reach the server. Please try again.', { action });
    } finally {
      clearTimeout(timeout);
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

  /**
   * Read-only metadata preview for the connect flow: resolves the pasted URL
   * server-side and reports what was detected (home name, address, contacts,
   * caretakers, participant count, warnings). Never writes anything.
   */
  async previewShelterSheet(payload: PreviewShelterSheetPayload): Promise<ApiResponse<ShelterSheetPreviewData>> {
    const response = await this.post<ShelterSheetPreviewData, PreviewShelterSheetPayload>(
      'previewShelterSheet', payload
    );
    if (!response.success) return response;
    return this.isShelterSheetPreviewData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_SHELTER_SHEET_PREVIEW_RESPONSE', message: 'The server returned an invalid sheet preview.' } };
  }

  private isShelterSheetPreviewData(value: unknown): value is ShelterSheetPreviewData {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<ShelterSheetPreviewData>;
    return typeof candidate.spreadsheetName === 'string'
      && typeof candidate.metadata === 'object' && candidate.metadata !== null
      && typeof candidate.metadataContactSource === 'string'
      && Array.isArray(candidate.metadataMissing)
      && Array.isArray(candidate.caretakers)
      && typeof candidate.caretakerCount === 'number'
      && (candidate.participantCount === null || typeof candidate.participantCount === 'number')
      && typeof candidate.participantSheetDetected === 'boolean'
      && typeof candidate.eventWiseSheetDetected === 'boolean'
      && typeof candidate.workbookStructure === 'object' && candidate.workbookStructure !== null
      && Array.isArray(candidate.warnings)
      && Array.isArray(candidate.errors);
  }

  listShelterSheets(): Promise<ApiResponse<ListShelterSheetsData>> {
    return this.post<ListShelterSheetsData>('listShelterSheets');
  }

  /**
   * Reads the connected shelter homes. Archived homes are excluded by the
   * backend unless `includeArchived` is set; archived rows keep their data
   * and history either way.
   */
  listShelterHomes(payload?: ListShelterHomesPayload): Promise<ApiResponse<ListShelterHomesData>> {
    return this.post<ListShelterHomesData, ListShelterHomesPayload | undefined>(
      'listShelterHomes', payload
    );
  }

  /**
   * Batched page snapshot: homes, participants, import status and current
   * validation results in one request, all scoped server-side. Replaces the
   * per-home fan-out on the Homes / Participants pages.
   */
  getPageData(): Promise<ApiResponse<PageDataData>> {
    return this.post<PageDataData>('getPageData');
  }

  /**
   * All finalized results in the session scope (optionally filtered). Used by
   * the Results page to list which events have finalized results.
   */
  listResults(): Promise<ApiResponse<ListResultsData>> {
    return this.post<ListResultsData>('listResults');
  }

  /**
   * Read-only impact preview for archiving a shelter home (ADMIN). Never
   * writes and never audits on the backend.
   */
  async previewShelterHomeArchive(shelterHomeId: string): Promise<ApiResponse<ShelterHomeArchivePreviewData>> {
    const response = await this.post<ShelterHomeArchivePreviewData, ShelterHomeIdPayload>(
      'previewShelterHomeArchive', { shelterHomeId }
    );
    if (!response.success) return response;
    const data = response.data;
    return typeof data === 'object' && data !== null
      && typeof (data as ShelterHomeArchivePreviewData).shelterHome === 'object'
      && typeof (data as ShelterHomeArchivePreviewData).impact === 'object'
      && typeof (data as ShelterHomeArchivePreviewData).triggerCleanupRequired === 'boolean'
      ? response
      : { success: false, error: { code: 'INVALID_ARCHIVE_PREVIEW_RESPONSE', message: 'The server returned an invalid archive preview.' } };
  }

  /**
   * Safe archive lifecycle operation (ADMIN): the home becomes ARCHIVED;
   * nothing is deleted. `expectedVersion` enables optimistic concurrency.
   */
  async archiveShelterHome(payload: ArchiveShelterHomePayload): Promise<ApiResponse<ArchiveShelterHomeData>> {
    const response = await this.post<ArchiveShelterHomeData, ArchiveShelterHomePayload>(
      'archiveShelterHome', payload
    );
    if (!response.success) return response;
    const data = response.data;
    return typeof data === 'object' && data !== null
      && (data as ArchiveShelterHomeData).status === 'ARCHIVED'
      && typeof (data as ArchiveShelterHomeData).triggerRemoved === 'boolean'
      ? response
      : { success: false, error: { code: 'INVALID_ARCHIVE_RESPONSE', message: 'The server returned an invalid archive response.' } };
  }

  /**
   * Restores an archived home to ACTIVE (ADMIN). A `triggerReinstallRequired`
   * outcome must be displayed, never interpreted as a reinstalled trigger.
   */
  async restoreShelterHome(payload: RestoreShelterHomePayload): Promise<ApiResponse<RestoreShelterHomeData>> {
    const response = await this.post<RestoreShelterHomeData, RestoreShelterHomePayload>(
      'restoreShelterHome', payload
    );
    if (!response.success) return response;
    const data = response.data;
    return typeof data === 'object' && data !== null
      && typeof (data as RestoreShelterHomeData).status === 'string'
      && typeof (data as RestoreShelterHomeData).triggerReinstallRequired === 'boolean'
      ? response
      : { success: false, error: { code: 'INVALID_RESTORE_RESPONSE', message: 'The server returned an invalid restore response.' } };
  }

  /**
   * Batch participant event summaries: one request covers one home (or
   * explicit participant ids), so the UI never fires one request per
   * participant. Only REGISTERED rows are counted by the backend.
   */
  async getParticipantEventSummaries(payload?: ParticipantEventSummariesPayload): Promise<ApiResponse<ParticipantEventSummariesData>> {
    const response = await this.post<ParticipantEventSummariesData, ParticipantEventSummariesPayload | undefined>(
      'getParticipantEventSummaries', payload
    );
    if (!response.success) return response;
    const data = response.data;
    return typeof data === 'object' && data !== null
      && Array.isArray((data as ParticipantEventSummariesData).summaries)
      && Array.isArray((data as ParticipantEventSummariesData).issues)
      ? response
      : { success: false, error: { code: 'INVALID_SUMMARIES_RESPONSE', message: 'The server returned an invalid participant event summaries response.' } };
  }

  /** Re-runs the participant's Sheet write-backs after a partial sync. */
  async reconcileParticipantSheetWrites(payload: ReconcileParticipantSheetWritesPayload): Promise<ApiResponse<ReconcileParticipantSheetWritesData>> {
    const response = await this.post<ReconcileParticipantSheetWritesData, ReconcileParticipantSheetWritesPayload>(
      'reconcileParticipantSheetWrites', payload
    );
    if (!response.success) return response;
    const data = response.data;
    return typeof data === 'object' && data !== null
      && typeof (data as ReconcileParticipantSheetWritesData).participantId === 'string'
      && typeof (data as ReconcileParticipantSheetWritesData).sheetsSynchronized === 'boolean'
      && Array.isArray((data as ReconcileParticipantSheetWritesData).reasons)
      ? response
      : { success: false, error: { code: 'INVALID_RECONCILE_RESPONSE', message: 'The server returned an invalid reconcile response.' } };
  }

  syncShelterSheet(payload: SyncShelterSheetPayload): Promise<ApiResponse<SyncShelterSheetData>> {
    return this.post<SyncShelterSheetData, SyncShelterSheetPayload>('syncShelterSheet', payload);
  }

  /**
   * Starts the backend-managed bulk sync job (ADMIN). If a job is already
   * running, the backend reports it with `alreadyRunning: true` and the caller
   * adopts the returned job instead of starting a second one.
   */
  async startSyncAllHomes(payload?: StartSyncAllHomesPayload): Promise<ApiResponse<SyncAllHomesData>> {
    const response = await this.post<SyncAllHomesData, StartSyncAllHomesPayload | undefined>(
      'startSyncAllHomes', payload
    );
    if (!response.success) return response;
    return this.isSyncAllHomesData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_SYNC_JOB_RESPONSE', message: 'The server returned an invalid sync job response.' } };
  }

  /** Processes the next chunk of a running bulk sync job (ADMIN). */
  async continueSyncAllHomes(jobId: string): Promise<ApiResponse<SyncAllHomesData>> {
    const response = await this.post<SyncAllHomesData, SyncAllHomesJobPayload>(
      'continueSyncAllHomes', { jobId }
    );
    if (!response.success) return response;
    return this.isSyncAllHomesData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_SYNC_JOB_RESPONSE', message: 'The server returned an invalid sync job response.' } };
  }

  /** Reads bulk sync progress; without a jobId the active job is returned. */
  async getSyncAllHomesStatus(jobId?: string): Promise<ApiResponse<SyncAllHomesStatusData>> {
    const response = await this.post<SyncAllHomesStatusData, SyncAllHomesJobPayload | undefined>(
      'getSyncAllHomesStatus', jobId ? { jobId } : undefined
    );
    if (!response.success) return response;
    const data = response.data;
    return typeof data === 'object' && data !== null
      && typeof (data as SyncAllHomesStatusData).active === 'boolean'
      && ((data as SyncAllHomesStatusData).job === null
        || this.isSyncAllHomesJob((data as SyncAllHomesStatusData).job as SyncAllHomesJob))
      ? response
      : { success: false, error: { code: 'INVALID_SYNC_JOB_RESPONSE', message: 'The server returned an invalid sync job status response.' } };
  }

  /**
   * Reads the PREVIEW ONLY dataset-refresh report (ADMIN). The backend
   * exposes no destructive reset action, so this endpoint only informs.
   */
  async previewDatasetRefresh(): Promise<ApiResponse<DatasetRefreshPreviewData>> {
    const response = await this.post<DatasetRefreshPreviewData>('previewDatasetRefresh');
    if (!response.success) return response;
    const data = response.data;
    return typeof data === 'object' && data !== null
      && typeof (data as DatasetRefreshPreviewData).scope === 'string'
      && typeof (data as DatasetRefreshPreviewData).tableCounts === 'object'
      && Array.isArray((data as DatasetRefreshPreviewData).connectedHomes)
      ? response
      : { success: false, error: { code: 'INVALID_DATASET_PREVIEW_RESPONSE', message: 'The server returned an invalid dataset refresh preview.' } };
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
   *
   * The participant object alone decides success. The `sourceWriteBack` report
   * is normalized (the backend emits `WRITTEN`; the frontend token is
   * `UPDATED`) and never fails an otherwise-successful response.
   */
  async updateParticipant(payload: UpdateParticipantPayload): Promise<ApiResponse<UpdateParticipantData>> {
    const response = await this.post<UpdateParticipantData, UpdateParticipantPayload>('updateParticipant', payload);
    if (!response.success) return response;
    const data = this.readParticipantMutationData(response.data);
    return data
      ? { success: true, data }
      : { success: false, error: { code: 'INVALID_PARTICIPANT_RESPONSE', message: 'The server returned an invalid participant response.' } };
  }

  /** Event master data. The backend is the source of truth when it supplies it. */
  async listEvents(): Promise<ApiResponse<ListEventsData>> {
    const response = await this.post<ListEventsData>('listEvents');
    if (!response.success) return response;
    return this.isListEventsData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_EVENTS_RESPONSE', message: 'The server returned an invalid events response.' } };
  }

  /**
   * Persisted registrations for one event.
   *
   * The backend may return the rows under `registrations` or `participantEvents`;
   * both are accepted. An empty array is a valid, successful result and is never
   * reported as an invalid response.
   */
  async listEventRegistrations(eventId: string): Promise<ApiResponse<ListEventRegistrationsData>> {
    const response = await this.post<ListEventRegistrationsData, { eventId: string }>('listEventRegistrations', { eventId });
    if (!response.success) return response;

    const normalized = this.normalizeRegistrations(response.data);

    return normalized
      ? { success: true, data: { participantEvents: normalized } }
      : { success: false, error: { code: 'INVALID_REGISTRATIONS_RESPONSE', message: 'The server returned an invalid registrations response.' } };
  }

  /** Persisted registrations for one participant. */
  async listParticipantEvents(participantId: string): Promise<ApiResponse<ListParticipantEventsData>> {
    const response = await this.post<ListParticipantEventsData, { participantId: string }>('listParticipantEvents', { participantId });
    if (!response.success) return response;

    const normalized = this.normalizeRegistrations(response.data);

    return normalized
      ? { success: true, data: { participantEvents: normalized } }
      : { success: false, error: { code: 'INVALID_REGISTRATIONS_RESPONSE', message: 'The server returned an invalid registrations response.' } };
  }

  async registerParticipant(payload: EventRegistrationPayload): Promise<ApiResponse<EventRegistrationData>> {
    return this.readEventRegistration('registerParticipant', payload);
  }

  async cancelRegistration(payload: EventRegistrationPayload): Promise<ApiResponse<EventRegistrationData>> {
    return this.readEventRegistration('cancelRegistration', payload);
  }

  async reactivateRegistration(payload: EventRegistrationPayload): Promise<ApiResponse<EventRegistrationData>> {
    return this.readEventRegistration('reactivateRegistration', payload);
  }

  /**
   * Registration mutations pass the backend payload through with the
   * `sourceWriteBack` report normalized to the frontend token set.
   */
  private async readEventRegistration(
    action: string,
    payload: EventRegistrationPayload
  ): Promise<ApiResponse<EventRegistrationData>> {
    const response = await this.post<EventRegistrationData, EventRegistrationPayload>(action, payload);
    if (!response.success) return response;

    if (!this.normalizeRegistration(response.data.participantEvent)) {
      return { success: false, error: { code: 'INVALID_REGISTRATION_RESPONSE', message: 'The server returned an invalid registration response.' } };
    }

    const sourceWriteBack = this.normalizeSourceWriteBack(response.data.sourceWriteBack);
    return {
      success: true,
      data: {
        participantEvent: response.data.participantEvent,
        ...(sourceWriteBack ? { sourceWriteBack } : {}),
      },
    };
  }

  /* ================================================================
     TEAMS
     ================================================================ */

  /** Persisted teams (and their members) for one group event. */
  async listTeams(eventId: string): Promise<ApiResponse<ListTeamsData>> {
    const response = await this.post<unknown, { eventId: string }>('listTeams', { eventId });
    if (!response.success) return response;
    const data = this.normalizeTeams(response.data);
    return data
      ? { success: true, data }
      : { success: false, error: { code: 'INVALID_TEAMS_RESPONSE', message: 'The server returned an invalid teams response.' } };
  }

  async getTeam(teamId: string): Promise<ApiResponse<GetTeamData>> {
    const response = await this.post<unknown, { teamId: string }>('getTeam', { teamId });
    if (!response.success) return response;
    return this.readTeamWithMembers(response.data);
  }

  async createTeam(payload: CreateTeamPayload): Promise<ApiResponse<GetTeamData>> {
    const response = await this.post<unknown, CreateTeamPayload>('createTeam', payload);
    if (!response.success) return response;
    return this.readTeamWithMembers(response.data);
  }

  async addTeamMember(payload: TeamMemberPayload): Promise<ApiResponse<GetTeamData>> {
    const response = await this.post<unknown, TeamMemberPayload>('addTeamMember', payload);
    if (!response.success) return response;
    return this.readTeamWithMembers(response.data);
  }

  async removeTeamMember(payload: TeamMemberPayload): Promise<ApiResponse<GetTeamData>> {
    const response = await this.post<unknown, TeamMemberPayload>('removeTeamMember', payload);
    if (!response.success) return response;
    return this.readTeamWithMembers(response.data);
  }

  /* ================================================================
     ATTENDANCE
     ================================================================ */

  async markAttendance(payload: MarkAttendancePayload): Promise<ApiResponse<AttendanceData>> {
    const response = await this.post<unknown, MarkAttendancePayload>('markAttendance', payload);
    if (!response.success) return response;
    const record = typeof response.data === 'object' && response.data !== null && 'attendance' in response.data
      ? this.normalizeAttendance((response.data as { attendance: unknown }).attendance)
      : this.normalizeAttendance(response.data);
    return record
      ? { success: true, data: { attendance: record } }
      : { success: false, error: { code: 'INVALID_ATTENDANCE_RESPONSE', message: 'The server returned an invalid attendance response.' } };
  }

  /**
   * Read path for persisted attendance (backend `listAttendance`). Rows arrive
   * enriched with event/participant/home names; the normalized core record is
   * kept. The operational read never requests archived rows.
   */
  async listAttendance(payload: ListAttendancePayload = {}): Promise<ApiResponse<ListAttendanceData>> {
    const response = await this.post<unknown, ListAttendancePayload>('listAttendance', payload);
    if (!response.success) return response;
    const rows = this.collection(response.data, ['attendance']);
    if (rows === null) {
      return { success: false, error: { code: 'INVALID_ATTENDANCE_READ_RESPONSE', message: 'The server returned an invalid attendance response.' } };
    }
    const records = rows
      .map(row => this.normalizeAttendance(row))
      .filter((record): record is Attendance => !!record);
    return { success: true, data: { attendance: records } };
  }

  /* ================================================================
     SCORING
     ================================================================ */

  /** Persisted scores for one event (official display; writes are judge-based). */
  async listScores(eventId: string): Promise<ApiResponse<ListScoresData>> {
    const response = await this.post<unknown, { eventId: string }>('listScores', { eventId });
    if (!response.success) return response;
    const rows = this.collection(response.data, ['scores']);
    if (rows === null) {
      return { success: false, error: { code: 'INVALID_SCORES_RESPONSE', message: 'The server returned an invalid scores response.' } };
    }
    return { success: true, data: { scores: rows.filter((row): row is Score => this.isScore(row)) } };
  }

  /* ================================================================
     JUDGING — per-event judges and per-judge scoring
     ================================================================ */

  /** Judges configured for one event (entered by the event coordinator). */
  listEventJudges(payload: ListEventJudgesPayload): Promise<ApiResponse<ListEventJudgesData>> {
    return this.post<ListEventJudgesData, ListEventJudgesPayload>('listEventJudges', payload);
  }

  /**
   * Confirm & Save Judges for one event. The sent list replaces the stored one;
   * the backend rejects removing judges that already have submitted scores
   * (JUDGES_LOCKED_AFTER_SCORING).
   */
  saveEventJudges(payload: SaveEventJudgesPayload): Promise<ApiResponse<SaveEventJudgesData>> {
    return this.post<SaveEventJudgesData, SaveEventJudgesPayload>('saveEventJudges', payload);
  }

  /**
   * Persists one judge's scores for the present participants of an event.
   * The backend rejects invalid values, scoring before criteria are supplied
   * (CRITERIA_PENDING) and any non-PRESENT participant.
   */
  saveJudgeScores(payload: SaveJudgeScoresPayload): Promise<ApiResponse<unknown>> {
    return this.post<unknown, SaveJudgeScoresPayload>('saveJudgeScores', payload);
  }

  /** Saved judge scores (drafts and submissions) for one judge of an event. */
  listJudgeScores(payload: ListJudgeScoresPayload): Promise<ApiResponse<ListJudgeScoresData>> {
    return this.post<ListJudgeScoresData, ListJudgeScoresPayload>('listJudgeScores', payload);
  }

  /* ================================================================
     HOME SHEET CONFIRMATION & LOCKING
     ================================================================ */

  /** Confirms (and thereby locks) a home's sheet. */
  confirmHomeSheet(payload: ConfirmHomeSheetPayload): Promise<ApiResponse<HomeSheetData>> {
    return this.post<HomeSheetData, ConfirmHomeSheetPayload>('confirmHomeSheet', payload);
  }

  /** Unlocks a locked home sheet for correction; a reason is mandatory. */
  unlockHomeSheet(payload: UnlockHomeSheetPayload): Promise<ApiResponse<HomeSheetData>> {
    return this.post<HomeSheetData, UnlockHomeSheetPayload>('unlockHomeSheet', payload);
  }

  /* ================================================================
     RESULTS APPROVAL
     ================================================================ */

  /**
   * Records the reviewer's results decision. The backend rejects an accept
   * with unresolved discrepancies (RECONCILIATION_INCOMPLETE) unless each is
   * named in `acknowledgedDiscrepancyIds`.
   */
  saveResultApproval(payload: SaveResultApprovalPayload): Promise<ApiResponse<unknown>> {
    return this.post<unknown, SaveResultApprovalPayload>('saveResultApproval', payload);
  }

  /* ================================================================
     ACCESS MANAGEMENT
     ================================================================ */

  /** Backend list of application users; the only source for the Settings module. */
  async listUsers(): Promise<ApiResponse<ListUsersData>> {
    const response = await this.post<ListUsersData>('listUsers');
    if (!response.success) return response;
    return this.isListUsersData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_USERS_RESPONSE', message: 'The server returned an invalid users response.' } };
  }

  async adminCreateUser(payload: AdminCreateUserPayload): Promise<ApiResponse<UserMutationData>> {
    const response = await this.post<UserMutationData, AdminCreateUserPayload>('adminCreateUser', payload);
    if (!response.success) return response;
    return this.isUserMutationData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_USER_RESPONSE', message: 'The server returned an invalid user response.' } };
  }

  async requestRegistration(payload: RequestRegistrationPayload): Promise<ApiResponse<RegistrationRequestData>> {
    const response = await this.post<RegistrationRequestData, RequestRegistrationPayload>('requestRegistration', payload);
    if (!response.success) return response;
    return this.isRegistrationRequestData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_REGISTRATION_RESPONSE', message: 'The server returned an invalid registration response.' } };
  }

  async approveUser(payload: ApproveUserPayload): Promise<ApiResponse<UserMutationData>> {
    return this.postUserMutation('approveUser', payload);
  }

  async rejectUser(payload: UserVersionPayload): Promise<ApiResponse<UserMutationData>> {
    return this.postUserMutation('rejectUser', payload);
  }

  async disableUser(payload: UserVersionPayload): Promise<ApiResponse<UserMutationData>> {
    return this.postUserMutation('disableUser', payload);
  }

  async enableUser(payload: UserVersionPayload): Promise<ApiResponse<UserMutationData>> {
    return this.postUserMutation('enableUser', payload);
  }

  async updateUserRole(payload: UpdateUserRolePayload): Promise<ApiResponse<UserMutationData>> {
    return this.postUserMutation('updateUserRole', payload);
  }

  /* ================================================================
     DASHBOARD + REPORTS
     ================================================================ */

  async getDashboardSummary(): Promise<ApiResponse<DashboardSummaryData>> {
    const response = await this.post<DashboardSummaryData>('getDashboardSummary');
    if (!response.success) return response;
    const summary = this.readOperationalCounts(response.data);
    return summary
      ? { success: true, data: { summary } }
      : { success: false, error: { code: 'INVALID_SUMMARY_RESPONSE', message: 'The server returned an invalid dashboard summary.' } };
  }

  async getReports(payload: ReportScopePayload = {}): Promise<ApiResponse<GetReportsData>> {
    const response = await this.post<GetReportsData, ReportScopePayload>('getReports', payload);
    return response;
  }

  private async postUserMutation<TPayload extends object>(
    action: string,
    payload: TPayload
  ): Promise<ApiResponse<UserMutationData>> {
    const response = await this.post<UserMutationData, TPayload>(action, payload);
    if (!response.success) return response;
    return this.isUserMutationData(response.data)
      ? response
      : { success: false, error: { code: 'INVALID_USER_RESPONSE', message: 'The server returned an invalid user response.' } };
  }

  /**
   * Event-level finalization: commits the official (judge-average) scores.
   * Idempotent on the backend (alreadyFinalized on retry).
   */
  async finalizeEvent(payload: FinalizeEventPayload): Promise<ApiResponse<FinalizeEventData>> {
    const response = await this.post<FinalizeEventData, FinalizeEventPayload>('finalizeEvent', payload);
    return response;
  }

  async reopenEventScores(payload: ReopenEventScoresPayload): Promise<ApiResponse<ReopenEventScoresData>> {
    const response = await this.post<ReopenEventScoresData, ReopenEventScoresPayload>('reopenEventScores', payload);
    return response;
  }

  listWinners(): Promise<ApiResponse<ListWinnersData>> {
    return this.post<ListWinnersData, ListWinnersPayload>('listWinners');
  }

  /**
   * Backend-backed logout: invalidates the server session, then always clears
   * the local session. The backend result is returned so the caller can report
   * a failed server invalidation honestly — the local logout is never faked
   * as a server-confirmed one.
   */
  async invalidateApplicationSession(): Promise<ApiResponse<LogoutData>> {
    let result: ApiResponse<LogoutData> = { success: true, data: { loggedOut: false } };

    if (this.activeSession()) {
      result = await this.post<LogoutData>('logout');
    }

    this.auth.logout();
    return result;
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

  /**
   * Synthesized transport/protocol failure: the technical detail is logged
   * for debugging and the caller receives the plain-English presentation
   * (the error code stays intact).
   */
  private synthesizedFailure(
    code: string,
    technicalMessage: string,
    context?: Record<string, unknown>,
  ): ApiResponse<never> {
    const friendly = friendlyError(code, technicalMessage, context);
    return { success: false, error: { code: friendly.code, message: friendly.message } };
  }

  /** Correlation id the backend echoes in every envelope (additive field). */
  private requestIdOf(value: unknown): string | undefined {
    const requestId = typeof value === 'object' && value !== null
      ? (value as { requestId?: unknown }).requestId
      : undefined;
    return typeof requestId === 'string' && requestId ? requestId : undefined;
  }

  /**
   * A JSON body the envelope contract does not recognise. Deployments older
   * than this app are diagnosed honestly instead of being flattened into one
   * generic failure:
   *
   * - `{ success: false, error: 'text' }` is the failure shape pre-envelope
   *   backends use. Those routers fall unrouted actions through to their
   *   login path, which answers exactly `Missing Google ID token` — i.e.
   *   the action (feature) is not deployed at all. Redeploying the backend
   *   (Code.gs) is the fix; the app can only diagnose it.
   * - Any other JSON body means the endpoint answered something this app
   *   cannot interpret (wrong endpoint or far older deployment).
   *
   * Network failures and authorization errors are separate categories and
   * never land here.
   */
  private classifyUnrecognizedResponse(
    action: string,
    result: unknown,
    httpStatus: number,
  ): ApiResponse<never> {
    const context = {
      action,
      httpStatus,
      requestId: this.requestIdOf(result),
      body: result,
    };

    const legacy = typeof result === 'object' && result !== null
      ? result as { success?: unknown; error?: unknown }
      : null;

    if (legacy?.success === false && typeof legacy.error === 'string') {
      if (legacy.error === 'Missing Google ID token') {
        return this.synthesizedFailure(
          'BACKEND_ACTION_UNKNOWN',
          `The deployed backend did not recognise action "${action}" (HTTP ${httpStatus}) and fell through to its login path — it predates this feature. Redeploying the backend fixes this.`,
          context,
        );
      }
      return this.synthesizedFailure(
        'BACKEND_UNSTRUCTURED_ERROR',
        `The backend reported an unstructured error for "${action}" (HTTP ${httpStatus}): ${legacy.error}`,
        context,
      );
    }

    return this.synthesizedFailure(
      'BACKEND_RESPONSE_UNRECOGNIZED',
      `The server returned an unrecognized JSON response for "${action}" (HTTP ${httpStatus}).`,
      context,
    );
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

  private isScore(value: unknown): value is Score {
    return typeof value === 'object' && value !== null
      && 'id' in value && typeof value.id === 'string'
      && 'eventId' in value && typeof value.eventId === 'string'
      && 'value' in value && typeof value.value === 'number'
      && 'status' in value && (value.status === 'DRAFT' || value.status === 'FINALIZED')
      && 'version' in value && typeof value.version === 'number';
  }

  /**
   * Validates only the participant object of a mutation response; the
   * `sourceWriteBack` report is normalized separately and never fails an
   * otherwise-successful response.
   */
  private readParticipantMutationData(value: unknown): UpdateParticipantData | null {
    if (typeof value !== 'object' || value === null || !('participant' in value)) {
      return null;
    }

    if (!this.isParticipant(value.participant)) {
      return null;
    }

    const sourceWriteBack = this.normalizeSourceWriteBack(
      (value as Record<string, unknown>)['sourceWriteBack']
    );

    return sourceWriteBack
      ? { participant: value.participant, sourceWriteBack }
      : { participant: value.participant };
  }

  /**
   * Normalizes a backend source write-back report to the frontend token set.
   *
   * The backend (Code.gs `writeParticipantBackToSource` /
   * `attemptEventWiseWriteBack`) emits `WRITTEN` or `SKIPPED`; the frontend
   * token for "the Google Sheet was updated" is `UPDATED`. Returns null for an
   * unrecognizable report — the response stays successful but the UI makes no
   * claim about the sheet either way.
   */
  private normalizeSourceWriteBack(value: unknown): SourceWriteBackResult | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const rawStatus = typeof record['status'] === 'string' ? record['status'] : '';

    const status = rawStatus === 'WRITTEN'
      ? 'UPDATED'
      : rawStatus === 'UPDATED' || rawStatus === 'SKIPPED' || rawStatus === 'FAILED' || rawStatus === 'UNVERIFIED'
        ? rawStatus
        : null;

    if (!status) {
      return null;
    }

    const reason = typeof record['reason'] === 'string' && record['reason'].trim()
      ? record['reason']
      : undefined;
    const message = typeof record['message'] === 'string' && record['message'].trim()
      ? record['message']
      : undefined;
    const rowNumber = typeof record['rowNumber'] === 'number' ? record['rowNumber'] : undefined;

    return {
      status,
      ...(message ?? reason ? { message: message ?? reason } : {}),
      ...(rowNumber !== undefined ? { rowNumber } : {}),
    };
  }

  private isApplicationUser(value: unknown): value is ApplicationUser {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const user = value as Record<string, unknown>;

    return typeof user['id'] === 'string'
      && typeof user['email'] === 'string'
      && typeof user['displayName'] === 'string'
      && this.isAccessStatus(user['accessStatus'])
      && typeof user['version'] === 'number';
  }

  private isAccessStatus(value: unknown): value is ApplicationUser['accessStatus'] {
    return value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED' || value === 'DISABLED';
  }

  private isListUsersData(value: unknown): value is ListUsersData {
    return typeof value === 'object' && value !== null
      && 'users' in value && Array.isArray(value.users)
      && value.users.every(user => this.isApplicationUser(user));
  }

  private isUserMutationData(value: unknown): value is UserMutationData {
    return typeof value === 'object' && value !== null
      && 'user' in value && this.isApplicationUser(value.user);
  }

  private isRegistrationRequestData(value: unknown): value is RegistrationRequestData {
    return typeof value === 'object' && value !== null
      && 'request' in value && typeof value.request === 'object' && value.request !== null
      && 'email' in value.request && typeof value.request.email === 'string'
      && 'displayName' in value.request && typeof value.request.displayName === 'string';
  }

  /**
   * Reads the operational counts from a summary payload.
   *
   * Accepts the counts nested under `summary` or at the top level, and accepts
   * attendance/certificates either nested or flattened. Returns null only when no
   * recognisable counter set is present.
   */
  private readOperationalCounts(value: unknown): OperationalCounts | null {
    const root = typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};

    const source = typeof root['summary'] === 'object' && root['summary'] !== null
      ? (root['summary'] as Record<string, unknown>)
      : root;

    const attendance = typeof source['attendance'] === 'object' && source['attendance'] !== null
      ? (source['attendance'] as Record<string, unknown>)
      : source;

    const certificates = typeof source['certificates'] === 'object' && source['certificates'] !== null
      ? (source['certificates'] as Record<string, unknown>)
      : source;

    const counts = {
      homes: this.readCount(source['homes']),
      participants: this.readCount(source['participants']),
      events: this.readCount(source['events']),
      activeEvents: this.readCount(source['activeEvents']),
      registrations: this.readCount(source['registrations']),
      teams: this.readCount(source['teams']),
      finalizedScores: this.readCount(source['finalizedScores']),
    };

    const hasAnyCount = Object.values(counts).some(value => value !== null);

    if (!hasAnyCount) {
      return null;
    }

    return {
      homes: counts.homes ?? 0,
      participants: counts.participants ?? 0,
      events: counts.events ?? 0,
      activeEvents: counts.activeEvents ?? 0,
      registrations: counts.registrations ?? 0,
      teams: counts.teams ?? 0,
      finalizedScores: counts.finalizedScores ?? 0,
      attendance: {
        recorded: this.readCount(attendance['recorded']) ?? 0,
        present: this.readCount(attendance['present']) ?? 0,
        absent: this.readCount(attendance['absent']) ?? 0,
      },
      certificates: {
        generated: this.readCount(certificates['generated']) ?? 0,
        issued: this.readCount(certificates['issued']) ?? 0,
      },
    };
  }

  private readCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private isGetParticipantData(value: unknown): value is GetParticipantData {
    return typeof value === 'object' && value !== null
      && 'participant' in value && this.isParticipant(value.participant);
  }

  /** Minimal structural check of the backend's public sync job shape. */
  private isSyncAllHomesJob(value: unknown): value is SyncAllHomesJob {
    if (typeof value !== 'object' || value === null) return false;
    const job = value as SyncAllHomesJob;
    return typeof job.jobId === 'string' && job.jobId.length > 0
      && typeof job.status === 'string' && job.status.length > 0
      && typeof job.chunkSize === 'number'
      && typeof job.totalHomes === 'number'
      && typeof job.processedHomes === 'number'
      && Array.isArray(job.results);
  }

  private isSyncAllHomesData(value: unknown): value is SyncAllHomesData {
    if (typeof value !== 'object' || value === null) return false;
    const data = value as SyncAllHomesData;
    return typeof data.alreadyRunning === 'boolean'
      && this.isSyncAllHomesJob(data.job);
  }

  private isListEventsData(value: unknown): value is ListEventsData {

    return typeof value === 'object' && value !== null
      && 'events' in value && Array.isArray(value.events)
      && value.events.every(event => this.isEvent(event));
  }

  /**
   * Normalizes a registration collection into `ParticipantEvent` records.
   *
   * Returns `null` only when the payload genuinely violates the contract, i.e.
   * the collection is neither an array nor an object holding one under
   * `registrations` / `participantEvents`, or a row lacks `participantId` or
   * `eventId`. Individual rows missing audit or display fields are accepted and
   * defaulted, because those are optional in the backend contract.
   */
  private normalizeRegistrations(value: unknown): ParticipantEvent[] | null {
    const rows = this.registrationRows(value);

    if (rows === null) {
      return null;
    }

    const normalized: ParticipantEvent[] = [];

    for (const row of rows) {
      const registration = this.normalizeRegistration(row);

      if (registration) {
        normalized.push(registration);
      }
    }

    return normalized;
  }

  private registrationRows(value: unknown): unknown[] | null {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;

    for (const key of ['registrations', 'participantEvents']) {
      const candidate = record[key];

      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private normalizeRegistration(row: unknown): ParticipantEvent | null {
    if (typeof row !== 'object' || row === null) {
      return null;
    }

    const value = row as Record<string, unknown>;
    const participantId = this.readString(value, 'participantId');
    const eventId = this.readString(value, 'eventId');

    if (!participantId || !eventId) {
      return null;
    }

    const registration: ParticipantEvent = {
      id: this.readString(value, 'id')
        ?? this.readString(value, 'participantEventId')
        ?? `${participantId}:${eventId}`,
      participantId,
      eventId,
      registrationStatus: this.readRegistrationStatus(value)
        ?? 'REGISTERED',
      version: typeof value['version'] === 'number' ? value['version'] : 1,
    };

    const source = this.readString(value, 'source');

    if (source === 'GOOGLE_SHEET' || source === 'NAKSHATRA') {
      registration.source = source;
    }

    this.copyIfString(registration, value, 'sourceVersionId');
    this.copyIfString(registration, value, 'createdAt');
    this.copyIfString(registration, value, 'createdBy');
    this.copyIfString(registration, value, 'updatedAt');
    this.copyIfString(registration, value, 'updatedBy');
    this.copyIfString(registration, value, 'participantName');
    this.copyIfString(registration, value, 'participantCode');
    this.copyIfString(registration, value, 'shelterHomeId');
    this.copyIfString(registration, value, 'eventName');
    this.copyIfString(registration, value, 'eventCode');

    const category = this.readString(value, 'category');

    if (category === 'ARTS' || category === 'LITERARY' || category === 'CULTURAL') {
      registration.category = category;
    }

    const mode = this.readString(value, 'mode');

    if (mode === 'SOLO' || mode === 'GROUP') {
      registration.mode = mode;
    }

    const gender = this.readString(value, 'gender');

    if (gender === 'MALE' || gender === 'FEMALE') {
      registration.gender = gender;
    }

    const level = this.readString(value, 'level');

    if (
      level === 'SUB_JUNIOR' ||
      level === 'JUNIOR' ||
      level === 'SENIOR' ||
      level === 'SUPER_SENIOR'
    ) {
      registration.level = level;
    }

    if (typeof value['age'] === 'number') {
      registration.age = value['age'];
    }

    if (typeof value['standard'] === 'number') {
      registration.standard = value['standard'];
    }

    return registration;
  }

  private readString(value: Record<string, unknown>, key: string): string | undefined {
    const candidate = value[key];

    return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
  }

  private readRegistrationStatus(
    value: Record<string, unknown>
  ): RegistrationStatus | undefined {
    const candidate = this.readString(value, 'registrationStatus');

    return candidate === 'REGISTERED' || candidate === 'CANCELLED' || candidate === 'WAITLISTED'
      ? candidate
      : undefined;
  }

  private copyIfString<T extends object, K extends keyof T>(
    target: T,
    value: Record<string, unknown>,
    key: string
  ): void {
    const candidate = this.readString(value, key);

    if (candidate !== undefined) {
      (target as Record<string, unknown>)[key as string] = candidate;
    }
  }

  /**
   * Returns the first array found: the value itself, or one held under any of
   * the given keys. `null` means the payload holds no collection at all, which
   * is a contract violation rather than an empty result.
   */
  private collection(value: unknown, keys: string[]): unknown[] | null {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;

    for (const key of keys) {
      if (Array.isArray(record[key])) {
        return record[key] as unknown[];
      }
    }

    return null;
  }

  private normalizeTeams(value: unknown): ListTeamsData | null {
    const rows = this.collection(value, ['teams']);

    if (rows === null) {
      return null;
    }

    const teams: Team[] = [];
    const members: TeamMember[] = [];

    for (const row of rows) {
      const team = this.normalizeTeam(row);

      if (!team) {
        continue;
      }

      teams.push(team);

      // Members may be nested on each team row.
      const nested = typeof row === 'object' && row !== null
        ? (row as Record<string, unknown>)['members']
        : undefined;

      if (Array.isArray(nested)) {
        members.push(...this.normalizeMembers(nested, team.id));
      }
    }

    // ...or returned as a sibling collection.
    const sibling = this.collection(value, ['members', 'teamMembers']);

    if (sibling && sibling !== rows) {
      members.push(...this.normalizeMembers(sibling));
    }

    return { teams, members: this.uniqueMembers(members) };
  }

  private readTeamWithMembers(value: unknown): ApiResponse<GetTeamData> {
    const root = typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
    const teamRow = root['team'] ?? value;
    const team = this.normalizeTeam(teamRow);

    if (!team) {
      return { success: false, error: { code: 'INVALID_TEAM_RESPONSE', message: 'The server returned an invalid team response.' } };
    }

    const nested = typeof teamRow === 'object' && teamRow !== null
      ? (teamRow as Record<string, unknown>)['members']
      : undefined;
    const sibling = this.collection(root, ['members', 'teamMembers']) ?? [];
    const members = this.uniqueMembers([
      ...(Array.isArray(nested) ? this.normalizeMembers(nested, team.id) : []),
      ...this.normalizeMembers(sibling, team.id),
    ]);

    return { success: true, data: { team, members } };
  }

  private normalizeTeam(row: unknown): Team | null {
    if (typeof row !== 'object' || row === null) {
      return null;
    }

    const value = row as Record<string, unknown>;
    const id = this.readString(value, 'id') ?? this.readString(value, 'teamId');
    const eventId = this.readString(value, 'eventId');

    if (!id || !eventId) {
      return null;
    }

    const status = this.readString(value, 'status');
    const validationStatus = this.readString(value, 'validationStatus');

    return {
      id,
      eventId,
      teamCode: this.readString(value, 'teamCode') ?? '',
      name: this.readString(value, 'name') ?? this.readString(value, 'teamName') ?? 'Unnamed team',
      status: status === 'DRAFT' || status === 'READY' || status === 'LOCKED' || status === 'CANCELLED'
        ? status
        : 'DRAFT',
      validationStatus: validationStatus === 'PASSED' || validationStatus === 'FAILED'
        || validationStatus === 'WARNING' || validationStatus === 'NOT_VALIDATED'
        ? validationStatus
        : 'NOT_VALIDATED',
      version: typeof value['version'] === 'number' ? value['version'] : 1,
      createdAt: this.readString(value, 'createdAt') ?? '',
      createdBy: this.readString(value, 'createdBy') ?? '',
      updatedAt: this.readString(value, 'updatedAt') ?? '',
      updatedBy: this.readString(value, 'updatedBy') ?? '',
    };
  }

  private normalizeMembers(rows: unknown[], teamId?: string): TeamMember[] {
    const members: TeamMember[] = [];

    for (const row of rows) {
      if (typeof row !== 'object' || row === null) {
        continue;
      }

      const value = row as Record<string, unknown>;
      const participantId = this.readString(value, 'participantId');
      const memberTeamId = this.readString(value, 'teamId') ?? teamId;

      if (!participantId || !memberTeamId) {
        continue;
      }

      const status = this.readString(value, 'status');

      members.push({
        id: this.readString(value, 'id') ?? `${memberTeamId}:${participantId}`,
        teamId: memberTeamId,
        participantId,
        status: status === 'REMOVED' ? 'REMOVED' : 'ACTIVE',
        joinedAt: this.readString(value, 'joinedAt') ?? '',
        joinedBy: this.readString(value, 'joinedBy') ?? '',
        removedAt: this.readString(value, 'removedAt'),
        removedBy: this.readString(value, 'removedBy'),
      });
    }

    return members;
  }

  private uniqueMembers(members: TeamMember[]): TeamMember[] {
    const byKey = new Map<string, TeamMember>();

    for (const member of members) {
      byKey.set(`${member.teamId}:${member.participantId}`, member);
    }

    return [...byKey.values()];
  }

  private normalizeAttendance(row: unknown): Attendance | null {
    if (typeof row !== 'object' || row === null) {
      return null;
    }

    const value = row as Record<string, unknown>;
    const participantId = this.readString(value, 'participantId');
    const eventId = this.readString(value, 'eventId');
    const status = this.readString(value, 'status');

    if (!participantId || !eventId || (status !== 'PRESENT' && status !== 'ABSENT')) {
      return null;
    }

    return {
      id: this.readString(value, 'id') ?? `${eventId}:${participantId}`,
      participantId,
      eventId,
      teamId: this.readString(value, 'teamId'),
      status,
      version: typeof value['version'] === 'number' ? value['version'] : 1,
      createdAt: this.readString(value, 'createdAt') ?? '',
      createdBy: this.readString(value, 'createdBy') ?? '',
      updatedAt: this.readString(value, 'updatedAt') ?? '',
      updatedBy: this.readString(value, 'updatedBy') ?? '',
    };
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
