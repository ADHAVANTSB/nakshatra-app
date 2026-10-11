import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  ConnectShelterSheetPayload,
  ConnectedShelterHome,
  ImportStatusEntry,
  ShelterHomeArchivePreviewData,
  ShelterSheetMetadataField,
  ShelterSheetPreviewData,
  SyncShelterSheetData,
  ValidationResult,
} from '../../core/models';
import { ApiClientService } from '../../core/services/api/api-client.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { SyncAllHomesService } from '../../core/services/imports/sync-all-homes.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';

/**
 * Shelter home registration and Google Sheet connection.
 *
 * This module is the only place a shelter home can be created or connected.
 * Connected homes are read from the shared backend store, which is populated by
 * `listShelterHomes()`, so closing this form never discards connected state.
 */
@Component({
  selector: 'nk-homes',
  imports: [FormsModule],
  templateUrl: './homes.html',
  styleUrl: './homes.scss',
})
export class Homes implements OnInit {
  private readonly shelterData = inject(ShelterDataService);
  private readonly apiClient = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  readonly showAddHome = signal(false);
  readonly homeName = signal('');
  readonly address = signal('');
  readonly contactName = signal('');
  readonly contactPhone = signal('');
  readonly sheetUrl = signal('');
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly successMessage = signal('');
  readonly progressMessage = signal('');
  readonly syncSummary = signal<SyncSummary | null>(null);
  readonly validationResults = signal<ValidationResult[]>([]);
  readonly importedParticipantCount = signal<number | null>(null);
  readonly connectedHome = signal<ConnectedHome | null>(null);
  readonly selectedHomeId = signal<string | null>(null);

  /**
   * Read-only source-workbook metadata preview (backend `previewShelterSheet`).
   * `previewing` covers the request in flight; `previewError` holds the real
   * backend failure message when the preview could not be produced.
   */
  readonly previewing = signal(false);
  readonly sheetPreview = signal<ShelterSheetPreviewData | null>(null);
  readonly previewError = signal('');

  /** Terminal result of the last connect/import attempt (see ConnectionOutcome). */
  readonly connectionOutcome = signal<ConnectionOutcome | null>(null);
  readonly retryingImport = signal(false);
  readonly retryImportAvailable = computed(() => {
    const outcome = this.connectionOutcome();
    return outcome?.state === 'SYNC_FAILED' && !!outcome.shelterHomeId;
  });

  /** Id of the home whose Google Sheet sync is currently in flight, if any. */
  readonly syncingHomeId = signal<string | null>(null);

  /**
   * Syncing is a backend mutation, so the Sync button follows the same section
   * gate that lets a user reach this page at all.
   */
  readonly canManageHomes = computed(() => this.auth.canAccess('HOMES'));

  // ---------------------------------------------------------
  // BACKEND STATE
  // ---------------------------------------------------------

  readonly loading = this.shelterData.loading;
  readonly connectedHomes = this.shelterData.homes;
  readonly homesError = this.shelterData.homesError;

  /** Backend-managed bulk sync driver (Sync All Homes). */
  readonly syncAll = inject(SyncAllHomesService);

  /** The backend allows only administrators to start the bulk sync job. */
  readonly isAdmin = computed(() => this.auth.currentUser()?.role === 'ADMIN');

  // ---------------------------------------------------------
  // SHELTER HOME ARCHIVE LIFECYCLE (backend round 2)
  // ---------------------------------------------------------

  /**
   * Shown before confirmation so no admin can archive a home without seeing
   * what the archive affects. Archive deactivates the home; nothing is ever
   * deleted by the frontend.
   */
  readonly ARCHIVE_CONFIRMATION_NOTE =
    'The home will be archived (deactivated) and removed from the active list — ' +
    'it is not permanently deleted. No participant, registration, attendance, ' +
    'score, certificate or audit record will be removed.';

  readonly archivePreview = signal<ShelterHomeArchivePreviewData | null>(null);
  readonly archivePreviewHomeId = signal<string | null>(null);
  readonly archivePreviewLoading = signal(false);
  readonly archivePreviewError = signal('');
  readonly archiving = signal(false);
  readonly archiveError = signal('');
  readonly archiveNotice = signal('');

  readonly archivedHomes = signal<ConnectedShelterHome[]>([]);
  readonly archivedLoading = signal(false);
  readonly archivedLoaded = signal(false);
  readonly archivedError = signal('');
  readonly restoringHomeId = signal<string | null>(null);
  readonly restoreError = signal('');

  /** Archive/restore visibility gate; the backend re-checks authorization. */
  canArchive(home: ConnectedShelterHome): boolean {
    return this.isAdmin() && home.status !== 'ARCHIVED';
  }

  canRestore(): boolean {
    return this.isAdmin();
  }

  /**
   * Read-only impact preview for archiving a home. Confirmation is impossible
   * before this has succeeded, so an admin always sees the real counts.
   */
  async openArchivePreview(home: ConnectedShelterHome): Promise<void> {
    if (!this.canArchive(home) || this.archivePreviewLoading()) {
      return;
    }

    this.archivePreviewHomeId.set(home.id);
    this.archivePreviewError.set('');
    this.archiveError.set('');
    this.archiveNotice.set('');
    this.archivePreviewLoading.set(true);

    const response = await this.apiClient.previewShelterHomeArchive(home.id);

    this.archivePreviewLoading.set(false);

    if (!response.success) {
      this.archivePreviewError.set(response.error.message);
      return;
    }

    this.archivePreview.set(response.data);
  }

  /** Re-runs the preview after a failed read; the pending home id is kept. */
  async retryArchivePreview(): Promise<void> {
    const homeId = this.archivePreviewHomeId();

    if (!homeId) {
      return;
    }

    const home = this.shelterData.getHomeById(homeId)
      ?? ({ id: homeId, homeCode: '', homeName: '', address: '', contactName: '', contactPhone: '', status: 'ACTIVE', version: 0 } as ConnectedShelterHome);

    await this.openArchivePreview(home);
  }

  cancelArchive(): void {
    this.archivePreview.set(null);
    this.archivePreviewHomeId.set(null);
    this.archivePreviewError.set('');
    this.archiveError.set('');
  }

  /**
   * Performs the archive only after a preview was shown. The home leaves the
   * active list only after the backend confirms the archive; a failure keeps
   * the preview so the retry affordance stays available.
   */
  async confirmArchive(): Promise<void> {
    const preview = this.archivePreview();

    if (!preview || this.archiving()) {
      return;
    }

    this.archiving.set(true);
    this.archiveError.set('');

    const home = this.shelterData.getHomeById(preview.shelterHome.id);
    const response = await this.apiClient.archiveShelterHome({
      shelterHomeId: preview.shelterHome.id,
      expectedVersion: home?.version,
    });

    if (!response.success) {
      this.archiving.set(false);
      this.archiveError.set(response.error.message);
      return;
    }

    this.archiving.set(false);
    this.archivePreview.set(null);

    // Confirmed success: refresh the active list from the backend and pull
    // the archived section so both views stay truthful.
    await this.shelterData.loadConnectedHomes();

    this.archiveNotice.set(
      `${preview.shelterHome.homeName} archived. ` +
      (response.data.triggerRemoved
        ? 'The source change trigger was removed.'
        : 'The source change trigger could not be removed — it can be removed again later.')
    );

    await this.loadArchivedHomes(true);
  }

  /**
   * Reads the archived homes through the backend's includeArchived option —
   * one request, filtered by the backend's own status field. ADMIN-gated.
   */
  async loadArchivedHomes(force = false): Promise<void> {
    if (!this.canRestore() || this.archivedLoading()) {
      return;
    }

    if (!force && this.archivedLoaded()) {
      return;
    }

    this.archivedLoading.set(true);
    this.archivedError.set('');

    const response = await this.apiClient.listShelterHomes({ includeArchived: true });

    this.archivedLoading.set(false);

    if (!response.success) {
      this.archivedError.set(response.error.message);
      return;
    }

    this.archivedHomes.set(
      response.data.shelterHomes.filter(home => home.status === 'ARCHIVED')
    );
    this.archivedLoaded.set(true);
  }

  /**
   * Restores an archived home. A `triggerReinstallRequired` outcome is shown
   * exactly as the backend reported it — the frontend never claims triggers
   * were restored.
   */
  async restoreArchivedHome(home: ConnectedShelterHome): Promise<void> {
    if (!this.canRestore() || this.restoringHomeId()) {
      return;
    }

    this.restoringHomeId.set(home.id);
    this.restoreError.set('');
    this.archiveNotice.set('');

    const response = await this.apiClient.restoreShelterHome({
      shelterHomeId: home.id,
      expectedVersion: home.version,
    });

    this.restoringHomeId.set(null);

    if (!response.success) {
      this.restoreError.set(response.error.message);
      return;
    }

    await this.shelterData.loadConnectedHomes();
    await this.loadArchivedHomes(true);

    this.archiveNotice.set(
      `${home.homeName} restored.` +
      (response.data.triggerReinstallRequired
        ? ' The source change trigger needs reinstall — use Install source trigger on the home before syncing.'
        : '')
    );
  }

  /** Starts (or adopts) the backend bulk sync job; the driver owns the loop. */
  startSyncAll(): void {
    void this.syncAll.start();
  }

  /** Display name for a bulk-sync result row; unknown ids stay raw ids. */
  homeNameById(homeId: string): string {
    return this.connectedHomes().find(home => home.id === homeId)?.homeName ?? homeId;
  }
  /** True once a first backend read has settled; refreshes keep it true. */
  readonly loaded = this.shelterData.loaded;

  /** Participant totals per home, derived from the shared backend store. */
  readonly participantCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {};

    for (const participant of this.shelterData.participants()) {
      counts[participant.shelterHomeId] =
        (counts[participant.shelterHomeId] ?? 0) + 1;
    }

    return counts;
  });

  ngOnInit(): void {
    void this.shelterData.ensureLoaded();
    // ADMIN-gated inside; loads the archived homes section once per session.
    void this.loadArchivedHomes();
  }

  // ---------------------------------------------------------
  // IMPORT STATUS
  // ---------------------------------------------------------

  importStatus(homeId: string): string {
    return this.shelterData.getImportStatusForHome(homeId)?.status ?? '';
  }

  /** Participant total for a home, or null while that home is still loading. */
  participantCount(homeId: string): number | null {
    return this.participantCounts()[homeId] ?? null;
  }

  /** Human-readable import status, avoiding technical version identifiers. */
  importStatusLabel(home: ConnectedShelterHome): string {
    const status = this.importStatus(home.id);

    if (status) {
      return status;
    }

    return home.currentImportVersionId ? 'Loading status' : 'Not imported yet';
  }

  /**
   * Friendly primary status for the home card. Backend status fields are kept
   * in the data model untouched; only the presentation label is translated,
   * and no raw backend code ever reaches the primary UI.
   */
  connectionStatusLabel(home: ConnectedShelterHome): string {
    if (home.status === 'ARCHIVED') {
      return 'Archived';
    }

    switch ((this.importStatus(home.id) || '').toUpperCase()) {
      case 'RUNNING':
      case 'IN_PROGRESS':
        return 'Syncing';
      case 'COMPLETED':
        return 'Synced';
      case 'COMPLETED_WITH_ERRORS':
      case 'COMPLETED_WITH_WARNINGS':
        return 'Synced with warnings';
      case 'FAILED':
      case 'ERROR':
        return 'Sync failed';
      default:
        break;
    }

    // A home with a prior import but no loaded status is being checked;
    // a connected source that was never imported needs its first sync.
    return home.currentImportVersionId ? 'Checking status' : 'Sync needed';
  }

  /**
   * Opens the backend-supplied spreadsheet link in a new tab.
   *
   * The URL always comes from `listShelterHomes`; it is never constructed from a
   * spreadsheet identifier here. Plain left-click is intercepted so the sheet
   * always opens in a new tab, while middle-click and Ctrl/Cmd-click keep the
   * browser's native "open in new tab" behaviour.
   */
  openSpreadsheet(event: MouseEvent, url: string): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    window.open(url, '_blank', 'noopener');
  }

  /**
   * First per-home backend error, so a failed participant, import or validation
   * read is visible on the card it belongs to instead of disappearing.
   */
  homeError(homeId: string): string {
    return (
      this.shelterData.errorFor('PARTICIPANTS', homeId) ||
      this.shelterData.errorFor('IMPORTS', homeId) ||
      this.shelterData.errorFor('VALIDATIONS', homeId)
    );
  }

  // ---------------------------------------------------------
  // SOURCE SECTION
  // ---------------------------------------------------------

  /**
   * True while this home's sheet sync is in flight; drives that home's
   * Sync button only, never the whole page.
   */
  isSyncing(homeId: string): boolean {
    return this.syncingHomeId() === homeId;
  }

  /** Backend-reported import version for a home, rendered as "v<n>" or "—". */
  sourceVersion(homeId: string): string {
    const versionNumber =
      this.shelterData.getImportStatusForHome(homeId)?.versionNumber;

    return versionNumber === undefined || versionNumber === null
      ? '—'
      : `v${versionNumber}`;
  }

  /**
   * Readable local date-time for the backend-supplied `lastSyncedAt`.
   * Absent or unparseable values render as "Never synced"; a date is never
   * invented here.
   */
  lastSyncedLabel(home: ConnectedShelterHome): string {
    if (!home.lastSyncedAt) {
      return 'Never synced';
    }

    const syncedAt = new Date(home.lastSyncedAt);

    return Number.isNaN(syncedAt.getTime())
      ? 'Never synced'
      : syncedAt.toLocaleString();
  }

  // ---------------------------------------------------------
  // SYNC FROM GOOGLE SHEET
  // ---------------------------------------------------------

  /**
   * Re-syncs one connected home from its Google Sheet.
   *
   * The api client always resolves, so `syncingHomeId` is always cleared and
   * the button always returns to idle. On success the homes list and that
   * home's import status are refreshed through the existing read paths and a
   * notification summarises the real fields the backend returned. On failure
   * the backend's own message is shown. No polling, no auto-sync.
   */
  async syncFromSheet(home: ConnectedShelterHome): Promise<void> {
    if (this.syncingHomeId() !== null) {
      return;
    }

    this.syncingHomeId.set(home.id);

    try {
      const sync = await this.apiClient.syncShelterSheet({
        shelterHomeId: home.id,
      });

      if (!sync.success) {
        this.notifications.error('Google Sheet sync failed', sync.error.message);
        return;
      }

      const importVersionId =
        sync.data.importVersionId ?? sync.data.importVersion?.id;

      await this.shelterData.loadImportStatus(home.id, importVersionId);
      // The sync may have changed the home's participant rows; re-read them so
      // the card's participant count reflects the backend, not the last page load.
      await this.shelterData.loadParticipants(home.id);
      await this.shelterData.loadConnectedHomes();

      this.notifications.success(
        `${home.homeName} synced`,
        this.syncResultDetail(sync.data)
      );
    } finally {
      // The busy state always releases; the api client resolves every
      // failure, so this only guards truly unexpected throws.
      this.syncingHomeId.set(null);
    }
  }

  /** Summarises only the fields the backend actually returned for a sync. */
  private syncResultDetail(data: SyncShelterSheetData): string {
    const parts: string[] = [];

    if (data.versionNumber != null) {
      parts.push(`version v${data.versionNumber}`);
    }

    if (data.recordCount != null) {
      parts.push(`${data.recordCount} records`);
    }

    if (data.validParticipantCount != null) {
      parts.push(`${data.validParticipantCount} valid participants`);
    }

    if (data.errorCount != null) {
      parts.push(`${data.errorCount} validation errors`);
    }

    if (data.warningCount != null) {
      parts.push(`${data.warningCount} warnings`);
    }

    return parts.length ? parts.join(' · ') : data.status || 'Synced';
  }

  // ---------------------------------------------------------
  // NAVIGATION
  // ---------------------------------------------------------

  /** Participants for this home, preserving the shelterHomeId filter. */
  viewParticipants(homeId: string): void {
    void this.router.navigate(['/participants'], {
      queryParams: { shelterHomeId: homeId },
    });
  }

  /** Home detail stays inside the shelter home module. */
  viewHome(homeId: string): void {
    this.selectedHomeId.update(current => (current === homeId ? null : homeId));
  }

  // ---------------------------------------------------------
  // ADD HOME
  // ---------------------------------------------------------

  /** Opening the form never clears the connected homes below it. */
  openAddHome(): void {
    this.resetForm();
    this.showAddHome.set(true);
    this.formError.set('');
    this.successMessage.set('');
    this.progressMessage.set('');
    this.syncSummary.set(null);
    this.validationResults.set([]);
    this.importedParticipantCount.set(null);
    this.connectedHome.set(null);
    this.sheetPreview.set(null);
    this.previewError.set('');
    this.previewing.set(false);
    this.connectionOutcome.set(null);
    this.retryingImport.set(false);
  }

  closeAddHome(): void {
    this.showAddHome.set(false);
    this.formError.set('');
    this.sheetPreview.set(null);
    this.previewError.set('');
    this.previewing.set(false);
    this.connectionOutcome.set(null);
    this.retryingImport.set(false);
  }

  /** Whether the source metadata preview can be requested right now. */
  canPreviewSheet(): boolean {
    return !this.previewing() && !this.saving()
      && this.isValidSheetUrl(this.sheetUrl().trim());
  }

  /**
   * Read-only metadata preview for the pasted URL (backend `previewShelterSheet`).
   *
   * Detected values prefill only EMPTY form fields — the backend's
   * `metadataMissing` list, not a guess, decides what the user is asked to
   * enter. A contact value found under a caretaker/warden label is never
   * treated as the home's official contact.
   */
  async previewSheetMetadata(): Promise<void> {
    if (this.previewing() || this.saving()) {
      return;
    }

    const spreadsheetUrl = this.sheetUrl().trim();

    if (!this.isValidSheetUrl(spreadsheetUrl)) {
      this.previewError.set('Enter a valid Google Sheets URL to preview its metadata.');
      return;
    }

    this.previewing.set(true);
    this.previewError.set('');

    const response = await this.apiClient.previewShelterSheet({ spreadsheetUrl });
    this.previewing.set(false);

    if (!response.success) {
      this.sheetPreview.set(null);
      this.previewError.set(response.error.message);
      return;
    }

    this.sheetPreview.set(response.data);
    this.applyPreviewMetadata(response.data);
  }

  /** True when the detected contact value came from a caretaker/warden column. */
  contactInferredFromCaretaker(): boolean {
    return this.sheetPreview()?.metadataContactSource === 'CARETAKER_LABEL';
  }

  /** Human-readable labels for the metadata fields missing from the sheet. */
  previewMissingLabels(): string[] {
    const labels: Record<ShelterSheetMetadataField, string> = {
      homeName: 'Home name',
      address: 'Address',
      contactName: 'Contact name',
      contactPhone: 'Contact phone',
    };
    return (this.sheetPreview()?.metadataMissing ?? [])
      .filter(field => Object.prototype.hasOwnProperty.call(labels, field))
      .map(field => labels[field]);
  }

  /** Known backend warning codes get plain-language text; unknown ones pass through. */
  friendlyPreviewWarning(code: string): string {
    switch (code) {
      case 'METADATA_CONTACT_INFERRED_FROM_CARETAKER':
        return 'A contact value was inferred from caretaker details. It is listed under Caretakers and was not filled in as the official contact.';
      default:
        return code;
    }
  }

  private applyPreviewMetadata(preview: ShelterSheetPreviewData): void {
    const metadata = preview.metadata;

    if (!this.homeName().trim() && metadata.homeName) {
      this.homeName.set(metadata.homeName);
    }
    if (!this.address().trim() && metadata.address) {
      this.address.set(metadata.address);
    }
    if (!this.contactPhone().trim() && metadata.contactPhone) {
      this.contactPhone.set(metadata.contactPhone);
    }
    // Only an explicitly identified contact populates the official field;
    // caretaker-derived names stay in the caretaker section.
    if (
      !this.contactName().trim() && metadata.contactName
      && preview.metadataContactSource === 'EXPLICIT_CONTACT_LABEL'
    ) {
      this.contactName.set(metadata.contactName);
    }
  }

  async connectSheet(): Promise<void> {
    if (this.saving()) {
      return;
    }

    const homeName = this.homeName().trim();
    const spreadsheetUrl = this.sheetUrl().trim();

    if (!homeName) {
      this.formError.set('Shelter Home Name is required.');
      return;
    }

    if (!this.isValidSheetUrl(spreadsheetUrl)) {
      this.formError.set('Enter a valid Google Sheets URL.');
      return;
    }

    // The same value the user pasted is what the backend receives. The initial
    // import runs as part of the connect call and its real outcome comes back
    // in the response, so no duplicate sync request is ever issued.
    const payload: ConnectShelterSheetPayload = {
      homeName,
      address: this.address().trim(),
      contactName: this.contactName().trim(),
      contactPhone: this.contactPhone().trim(),
      spreadsheetUrl,
      runInitialSync: true,
    };

    this.saving.set(true);
    this.formError.set('');
    this.successMessage.set('');
    this.connectionOutcome.set(null);
    this.progressMessage.set('Connecting Google Sheet...');

    const response = await this.apiClient.connectShelterSheet(payload);

    if (!response.success) {
      await this.handleConnectFailure(response.error);
      return;
    }

    const data = response.data;
    const shelterHomeId = data.shelterHome.id;
    const alreadyConnected = data.alreadyConnected === true
      || data.connection?.status === 'ALREADY_CONNECTED';

    this.connectedHome.set({
      id: shelterHomeId,
      name: data.shelterHome.homeName,
      spreadsheetName: data.sheetSource.spreadsheetName,
    });

    const initialImport = data.initialImport;

    // A connected sheet with a failed import is a distinct outcome: the
    // connection is persisted, only the import needs a Retry.
    if (initialImport?.attempted && initialImport.status === 'FAILED') {
      this.saving.set(false);
      this.progressMessage.set('');
      this.connectionOutcome.set({
        state: 'SYNC_FAILED',
        shelterHomeId,
        homeName: data.shelterHome.homeName,
        message: `Google Sheet connected, but the participant import failed: ${
          initialImport.errorMessage || 'the backend reported an unspecified import failure'
        }`,
      });
      return;
    }

    if (initialImport?.attempted) {
      // The backend already ran the import; verify and display its outcome.
      this.progressMessage.set('Checking import status...');
      const ok = await this.runPostSyncPipeline(shelterHomeId, undefined, initialImport.importVersionId);
      if (!ok) return;
    } else {
      // Older backend response without an in-call import: run the explicit sync.
      this.progressMessage.set('Syncing participant data...');
      const sync = await this.apiClient.syncShelterSheet({ shelterHomeId });
      if (!sync.success) {
        this.saving.set(false);
        this.progressMessage.set('');
        this.connectionOutcome.set({
          state: 'SYNC_FAILED',
          shelterHomeId,
          homeName: data.shelterHome.homeName,
          message: `Google Sheet connected, but participant sync failed: ${sync.error.message}`,
        });
        return;
      }
      this.progressMessage.set('Checking import status...');
      const ok = await this.runPostSyncPipeline(shelterHomeId, sync.data);
      if (!ok) return;
    }

    this.successMessage.set(this.connectionMessage(response, this.importedParticipantCount() ?? 0));
    this.connectionOutcome.set({
      state: alreadyConnected ? 'ALREADY_CONNECTED' : 'CONNECTED',
      shelterHomeId,
      homeName: data.shelterHome.homeName,
      message: alreadyConnected
        ? `${data.shelterHome.homeName} was already connected — showing the existing home below.`
        : `${data.shelterHome.homeName} is connected${data.sheetSource.spreadsheetName ? ` to ${data.sheetSource.spreadsheetName}` : ''}.`,
    });
    this.progressMessage.set('');
    this.saving.set(false);
  }

  /**
   * Re-runs ONLY the participant import for an existing connection after a
   * SYNC_FAILED outcome. The home/source identity is reused exactly; the
   * connect action is never issued again, so no duplicate home can appear.
   */
  async retryConnectionImport(): Promise<void> {
    const outcome = this.connectionOutcome();
    if (!outcome?.shelterHomeId || this.retryingImport() || this.saving()) {
      return;
    }

    this.retryingImport.set(true);
    this.progressMessage.set('Retrying participant sync...');

    const sync = await this.apiClient.syncShelterSheet({ shelterHomeId: outcome.shelterHomeId });

    if (!sync.success) {
      this.retryingImport.set(false);
      this.progressMessage.set('');
      this.connectionOutcome.set({
        ...outcome,
        message: `Participant sync failed again: ${sync.error.message}`,
        technicalDetail: sync.error.code,
      });
      return;
    }

    const ok = await this.runPostSyncPipeline(outcome.shelterHomeId, sync.data);
    this.retryingImport.set(false);

    if (!ok) return;

    const message = outcome.homeName
      ? `${outcome.homeName} is synced.`
      : 'Participant sync completed.';
    this.successMessage.set(message);
    this.connectionOutcome.set({
      state: 'CONNECTED',
      shelterHomeId: outcome.shelterHomeId,
      homeName: outcome.homeName,
      message,
    });
    this.progressMessage.set('');
  }

  /**
   * Maps a failed connect call to a truthful outcome. Transport-level
   * ambiguity (HTTP 404 page, timeout, network error) is checked against the
   * homes list before being reported as a failure, because the backend may
   * have persisted the connection even though the response was lost.
   */
  private async handleConnectFailure(error: { code: string; message: string }): Promise<void> {
    this.progressMessage.set('');

    if (error.code === 'SHELTER_HOME_ARCHIVED') {
      this.saving.set(false);
      this.connectionOutcome.set({
        state: 'ARCHIVED_SOURCE',
        message: `${error.message} Open the Archived homes section to restore it.`,
      });
      // Make sure the restore path (with its ADMIN gate) is visible.
      void this.loadArchivedHomes();
      return;
    }

    if (error.code === 'SPREADSHEET_ACCESS_FAILED' || error.code === 'SOURCE_SHEET_ACCESS_FAILED') {
      this.saving.set(false);
      this.connectionOutcome.set({
        state: 'SOURCE_ACCESS_FAILED',
        message: error.message,
        technicalDetail: error.code,
      });
      return;
    }

    if (error.code === 'SPREADSHEET_ALREADY_CONNECTED') {
      this.saving.set(false);
      this.connectionOutcome.set({
        state: 'ALREADY_CONNECTED',
        message: `This Google Sheet is already connected. ${error.message}`,
      });
      return;
    }

    if (AMBIGUOUS_CONNECT_CODES.has(error.code)) {
      this.saving.set(false);

      // Verification re-read: an active home whose workbook name matches the
      // previewed sheet means the connection DID persist.
      const previewName = this.sheetPreview()?.spreadsheetName?.trim();
      if (previewName && await this.shelterData.loadConnectedHomes()) {
        const match = this.connectedHomes().find(
          home => home.status !== 'ARCHIVED'
            && (home.spreadsheetName ?? '').trim() === previewName
        );
        if (match) {
          this.connectedHome.set({
            id: match.id,
            name: match.homeName,
            spreadsheetName: match.spreadsheetName,
          });
          this.connectionOutcome.set({
            state: 'ALREADY_CONNECTED',
            shelterHomeId: match.id,
            homeName: match.homeName,
            message: `This Google Sheet is already connected to ${match.homeName}. Use the View and Sync actions below.`,
          });
          return;
        }
      }

      this.connectionOutcome.set({
        state: 'REQUEST_ERROR',
        message: 'The connection could not be confirmed. Check the connected homes list below before retrying — the sheet may have been connected despite the error.',
        technicalDetail: `${error.code}: ${error.message}`,
      });
      return;
    }

    this.finishWithError(error.message);
  }

  /**
   * Shared read pipeline after a confirmed import: import status, validation
   * results, participants, then the connected-homes re-read. Returns false and
   * records the failure when any read fails.
   */
  private async runPostSyncPipeline(
    shelterHomeId: string,
    syncData: SyncProgress | undefined,
    importVersionId?: string
  ): Promise<boolean> {
    const versionId = importVersionId ?? (syncData ? this.importVersionId(syncData) : undefined);

    const imports = await this.shelterData.loadImportStatus(shelterHomeId, versionId);
    if (!imports) {
      this.finishWithError(this.shelterData.errorFor('IMPORTS', shelterHomeId));
      return false;
    }

    this.progressMessage.set('Loading validation results...');
    const validations = await this.shelterData.loadValidationResults(shelterHomeId, versionId);
    if (!validations) {
      this.finishWithError(this.shelterData.errorFor('VALIDATIONS', shelterHomeId));
      return false;
    }

    this.progressMessage.set('Refreshing participant data...');
    const participants = await this.shelterData.loadParticipants(shelterHomeId);
    if (!participants) {
      this.finishWithError(this.shelterData.errorFor('PARTICIPANTS', shelterHomeId));
      return false;
    }

    if (!await this.shelterData.loadConnectedHomes()) {
      this.finishWithError(this.shelterData.homesError());
      return false;
    }

    const currentImport = this.currentImport(imports, shelterHomeId, versionId);
    this.validationResults.set(validations);
    this.importedParticipantCount.set(participants.length);
    this.syncSummary.set(this.toSyncSummary(currentImport, syncData, participants.length));
    return true;
  }

  /**
 * Re-reads connected homes, participants, imports and validation results.
 *
 * Only backend-owned data is replaced: the Add Home form, its typed values and
 * the open/closed state of a home detail panel are deliberately left untouched.
 */
  async refreshConnectedHomes(): Promise<void> {
    await this.shelterData.refresh();
  }

  // ---------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------

  private connectionMessage(
    response: Extract<
      Awaited<ReturnType<ApiClientService['connectShelterSheet']>>,
      { success: true }
    >,
    participantCount: number
  ): string {
    const homeName = response.data.shelterHome.homeName;
    const spreadsheetName = response.data.sheetSource.spreadsheetName;
    const participants =
      participantCount === 1 ? '1 participant' : `${participantCount} participants`;

    return spreadsheetName
      ? `${homeName} is connected to ${spreadsheetName}. ${participants} synced.`
      : `${homeName} is connected. ${participants} synced.`;
  }

  private finishWithError(message: string): void {
    this.saving.set(false);
    this.progressMessage.set('');
    this.formError.set(message || 'The shelter home could not be connected.');
  }

  private importVersionId(data: SyncProgress): string | undefined {
    return data.importVersion?.id ?? data.importVersionId;
  }

  private currentImport(
    imports: ImportStatusEntry[],
    shelterHomeId: string,
    importVersionId?: string
  ): ImportStatusEntry | undefined {
    const homeImports = imports.filter(
      item => item.shelterHomeId === shelterHomeId
    );

    return (
      homeImports.find(
        item => item.id === importVersionId || item.importVersionId === importVersionId
      ) ??
      homeImports.sort(
        (a, b) => (b.versionNumber ?? -1) - (a.versionNumber ?? -1)
      )[0]
    );
  }

  private toSyncSummary(
    status: ImportStatusEntry | undefined,
    sync: SyncProgress | undefined,
    participantCount: number
  ): SyncSummary {
    return {
      version: status?.versionNumber ?? sync?.versionNumber ?? sync?.importVersion?.versionNumber ?? null,
      recordsProcessed: status?.recordCount ?? sync?.recordCount ?? null,
      validParticipants:
        status?.validParticipantCount ?? sync?.validParticipantCount ?? participantCount,
      validationErrors: status?.errorCount ?? sync?.errorCount ?? null,
      warnings: status?.warningCount ?? sync?.warningCount ?? null,
      syncStatus: status?.status ?? sync?.status ?? 'COMPLETED',
    };
  }

  private resetForm(): void {
    this.homeName.set('');
    this.address.set('');
    this.contactName.set('');
    this.contactPhone.set('');
    this.sheetUrl.set('');
  }

  /**
   * Accepts any Google Sheets URL a user is likely to paste. The sheet does not
   * need to appear in `listShelterSheets()` to be connected; the full URL is
   * forwarded to the backend, which resolves it.
   */
  private isValidSheetUrl(value: string): boolean {
    return /^https?:\/\/(?:docs|drive|sheets)\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/i.test(
      value
    );
  }
}

type SyncProgress = SyncShelterSheetData;

/**
 * Terminal state of a connect/import attempt, kept separate from the form
 * error so a persisted connection is never reported as a total failure just
 * because a later step failed.
 */
export type ConnectionOutcomeState =
  | 'CONNECTED'
  | 'SYNC_FAILED'
  | 'ALREADY_CONNECTED'
  | 'ARCHIVED_SOURCE'
  | 'SOURCE_ACCESS_FAILED'
  | 'REQUEST_ERROR';

export interface ConnectionOutcome {
  state: ConnectionOutcomeState;
  /** User-facing summary; backend messages are preserved verbatim. */
  message: string;
  shelterHomeId?: string;
  homeName?: string;
  /** Raw transport/code detail kept for diagnostics, hidden from the primary text. */
  technicalDetail?: string;
}

/** Codes that never reached a definitive backend verdict on the connect call. */
const AMBIGUOUS_CONNECT_CODES: ReadonlySet<string> = new Set([
  'SERVER_RESPONSE_MALFORMED',
  'REQUEST_TIMEOUT',
  'NETWORK_ERROR',
  'API_REQUEST_FAILED',
  'INVALID_SHELTER_SHEET_CONNECTION_RESPONSE',
]);

interface SyncSummary {
  version: number | null;
  recordsProcessed: number | null;
  validParticipants: number;
  validationErrors: number | null;
  warnings: number | null;
  syncStatus: string;
}

interface ConnectedHome {
  id: string;
  name: string;
  spreadsheetName?: string;
}

