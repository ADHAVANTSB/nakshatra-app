import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  ConnectShelterSheetPayload,
  ConnectedShelterHome,
  ImportStatusEntry,
  ShelterHomeDeletionPlanEntry,
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
  imports: [ViewOnlyBannerComponent, FormsModule],
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
  // PERMANENT DELETION (the single lifecycle exit)
  // ---------------------------------------------------------

  /**
   * Shown in the destructive confirmation dialog so no admin can delete a
   * home without seeing what it affects. Deletion removes the home's
   * operational records; official history (finalized results, issued
   * certificates, distribution evidence, audit) is retained, and a verified
   * backup is taken before anything is removed.
   */
  readonly DELETION_CONFIRMATION_NOTE =
    'Permanent deletion removes this home and its operational records. ' +
    'Finalized results, issued certificates, distribution evidence and ' +
    'audit history are retained. A verified backup is taken first. This ' +
    'cannot be undone from the app.';

  readonly deletionPreview = signal<ShelterHomeDeletionPlanEntry | null>(null);
  readonly deletionPreviewHomeId = signal<string | null>(null);
  readonly deletionPreviewLoading = signal(false);
  readonly deletionPreviewError = signal('');
  readonly deleting = signal(false);
  readonly deletionError = signal('');
  readonly deletionNotice = signal('');
  readonly deleteReason = signal('');
  readonly deleteConfirmCode = signal('');

  /** Deletion visibility gate; the backend re-checks authorization. */
  canDelete(): boolean {
    const role = this.auth.currentUser()?.role;
    return role === 'ADMIN' || role === 'SUPPORT';
  }

  /**
   * Read-only deletion manifest for one home. Confirmation is impossible
   * before this has succeeded, so an admin always sees the real dependent
   * record counts and types before anything is deleted.
   */
  async openDeletionPreview(home: ConnectedShelterHome): Promise<void> {
    if (!this.canDelete() || this.deletionPreviewLoading()) {
      return;
    }

    this.deletionPreviewHomeId.set(home.id);
    this.deletionPreviewError.set('');
    this.deletionError.set('');
    this.deletionNotice.set('');
    this.deletionPreviewLoading.set(true);

    const response =
      await this.apiClient.previewShelterHomeDeletion({ shelterHomeId: home.id });

    this.deletionPreviewLoading.set(false);

    if (!response.success) {
      this.deletionPreviewError.set(response.error.message);
      return;
    }

    const plan = response.data.homes[0] ?? null;

    if (!plan) {
      this.deletionPreviewError.set(
        'The backend returned no deletion plan for this home.'
      );
      return;
    }

    this.deletionPreview.set(plan);
    this.deleteReason.set('');
    this.deleteConfirmCode.set('');
  }

  /** Re-runs the preview after a failed read; the pending home id is kept. */
  async retryDeletionPreview(): Promise<void> {
    const homeId = this.deletionPreviewHomeId();

    if (!homeId) {
      return;
    }

    const home = this.shelterData.getHomeById(homeId)
      ?? ({ id: homeId, homeCode: '', homeName: '', address: '', contactName: '', contactPhone: '', status: 'ACTIVE', version: 0 } as ConnectedShelterHome);

    await this.openDeletionPreview(home);
  }

  cancelDeletion(): void {
    this.deletionPreview.set(null);
    this.deletionPreviewHomeId.set(null);
    this.deletionPreviewError.set('');
    this.deletionError.set('');
    this.deleteReason.set('');
    this.deleteConfirmCode.set('');
  }

  updateDeleteReason(value: string): void {
    this.deleteReason.set(value);
  }

  updateDeleteConfirmCode(value: string): void {
    this.deleteConfirmCode.set(value);
  }

  /** Per-table dependent record counts/types shown before confirmation. */
  deletionImpactRows(): Array<{ table: string; remove: number; retain: number; reason: string }> {
    const plan = this.deletionPreview();

    if (!plan) {
      return [];
    }

    return Object.keys(plan.counts)
      .map(table => ({
        table,
        remove: plan.counts[table].delete,
        retain: plan.counts[table].retain,
        reason: plan.counts[table].reason,
      }))
      .filter(row => row.remove > 0 || row.retain > 0);
  }

  /**
   * Performs the permanent deletion only after a manifest was shown and the
   * admin typed the home's own code. The home leaves the active list only
   * after the backend confirms; a failure keeps the dialog so the retry
   * affordance stays available.
   */
  async confirmDeletion(): Promise<void> {
    const preview = this.deletionPreview();
    const reason = this.deleteReason().trim();

    if (!preview || this.deleting()) {
      return;
    }

    if (!reason) {
      this.deletionError.set('A deletion reason is required.');
      return;
    }

    if (this.deleteConfirmCode().trim() !== preview.homeCode) {
      this.deletionError.set(
        'Type ' + preview.homeCode + ' to confirm permanent deletion.'
      );
      return;
    }

    this.deleting.set(true);
    this.deletionError.set('');

    const home = this.shelterData.getHomeById(preview.shelterHomeId);
    const response = await this.apiClient.deleteShelterHome({
      shelterHomeId: preview.shelterHomeId,
      reason,
      confirm: this.deleteConfirmCode().trim(),
      expectedVersion: home?.version,
    });

    this.deleting.set(false);

    if (!response.success) {
      this.deletionError.set(response.error.message);
      return;
    }

    this.deletionPreview.set(null);
    this.deletionPreviewHomeId.set(null);
    this.deleteReason.set('');
    this.deleteConfirmCode.set('');

    await this.shelterData.loadConnectedHomes();

    this.deletionNotice.set(
      response.data.alreadyDeleted
        ? preview.homeName + ' was already deleted. Nothing was changed.'
        : preview.homeName + ' permanently deleted: ' +
          response.data.deleted + ' record(s) removed, ' +
          response.data.retained + ' retained as official history.'
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
  // HOME SHEET CONFIRMATION & LOCKING
  // ---------------------------------------------------------

  readonly sheetBusyHomeId = signal<string | null>(null);
  readonly unlockHomeId = signal<string | null>(null);
  readonly unlockReason = signal('');
  readonly unlockReasonError = signal(false);

  /** Badge text for the sheet lifecycle; backend fields only. */
  sheetStatusLabel(home: ConnectedShelterHome): string {
    switch (home.sheetStatus) {
      case 'LOCKED':
        return 'Locked — editing prevented';
      case 'CONFIRMED':
        return 'Confirmed — unlocked for correction';
      case 'NOT_CONFIRMED':
        return 'Draft — editable';
      default:
        return 'Draft — editable';
    }
  }

  sheetStatusTone(home: ConnectedShelterHome): string {
    switch (home.sheetStatus) {
      case 'LOCKED':
        return 'sheet-pill sheet-pill--locked';
      case 'CONFIRMED':
        return 'sheet-pill sheet-pill--confirmed';
      default:
        return 'sheet-pill sheet-pill--draft';
    }
  }

  isSheetLocked(home: ConnectedShelterHome): boolean {
    return home.sheetStatus === 'LOCKED';
  }

  /**
   * Audit line(s) for the home sheet, composed only from the backend fields
   * (who/when/why). Nothing is invented: a missing field simply leaves its
   * part out.
   */
  sheetAuditLines(home: ConnectedShelterHome): string[] {
    const lines: string[] = [];
    const who = home.sheetConfirmedBy ? ` by ${home.sheetConfirmedBy}` : '';

    if (home.sheetConfirmedAt) {
      lines.push(`Confirmed${who} — ${home.sheetConfirmedAt}`);
    }
    if (home.sheetLockedAt) {
      lines.push(`Locked — confirmation without further changes (${home.sheetLockedAt})`);
    }
    if (home.sheetUnlockReason) {
      const unlockWho = home.sheetUnlockedBy ? ` by ${home.sheetUnlockedBy}` : '';
      const when = home.sheetUnlockedAt ? ` (${home.sheetUnlockedAt})` : '';
      lines.push(`Unlocked for correction — reason: “${home.sheetUnlockReason}”${unlockWho}${when}`);
    }
    return lines;
  }

  /** Confirm Sheet: confirmation and locking in one action. */
  async confirmSheet(home: ConnectedShelterHome): Promise<void> {
    if (this.sheetBusyHomeId() || !this.canManageHomes()) return;

    this.sheetBusyHomeId.set(home.id);
    try {
      const response = await this.apiClient.confirmHomeSheet({ shelterHomeId: home.id });

      if (!response.success) {
        this.notifications.error('The sheet could not be confirmed.', response.error.message);
        return;
      }

      await this.shelterData.loadConnectedHomes();
      this.notifications.success(`${home.homeName} confirmed and locked.`, 'The sheet is now locked against edits.');
    } finally {
      this.sheetBusyHomeId.set(null);
    }
  }

  openUnlockSheet(home: ConnectedShelterHome): void {
    this.unlockHomeId.set(home.id);
    this.unlockReason.set('');
    this.unlockReasonError.set(false);
  }

  cancelUnlockSheet(): void {
    this.unlockHomeId.set(null);
    this.unlockReason.set('');
    this.unlockReasonError.set(false);
  }

  updateUnlockReason(raw: string): void {
    this.unlockReason.set(raw);
    if (raw.trim()) this.unlockReasonError.set(false);
  }

  /** Unlock for correction: a reason is mandatory and lands in the audit line. */
  async confirmUnlockSheet(home: ConnectedShelterHome): Promise<void> {
    const reason = this.unlockReason().trim();
    if (!reason) {
      this.unlockReasonError.set(true);
      return;
    }
    if (this.sheetBusyHomeId() || !this.canManageHomes()) return;

    this.sheetBusyHomeId.set(home.id);
    try {
      const response = await this.apiClient.unlockHomeSheet({ shelterHomeId: home.id, reason });

      if (!response.success) {
        this.notifications.error('The sheet could not be unlocked.', response.error.message);
        return;
      }

      await this.shelterData.loadConnectedHomes();
      this.cancelUnlockSheet();
      this.notifications.success(`${home.homeName} unlocked for correction.`, 'Re-confirm the sheet to re-lock it.');
    } finally {
      this.sheetBusyHomeId.set(null);
    }
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

  /** Backend-reported import number for a home, rendered as "Import #n" or "—". */
  sourceVersion(homeId: string): string {
    const versionNumber =
      this.shelterData.getImportStatusForHome(homeId)?.versionNumber;

    return versionNumber === undefined || versionNumber === null
      ? '—'
      : `Import #${versionNumber}`;
  }

  /** Title-cased sync status for display ('COMPLETED' -> 'Completed'). */
  syncStatusLabel(status: string | null | undefined): string {
    const raw = String(status ?? '').trim();
    return raw ? raw.charAt(0) + raw.slice(1).toLowerCase() : '—';
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
      contactAlternatePhone: 'Alternate phone',
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
      // The backend message already names the only exit (permanent
      // deletion); no restore path exists anymore.
      this.connectionOutcome.set({
        state: 'ARCHIVED_SOURCE',
        message: error.message,
      });
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

