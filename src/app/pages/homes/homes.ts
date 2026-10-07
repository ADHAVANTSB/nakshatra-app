import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  ConnectShelterSheetPayload,
  ConnectedShelterHome,
  ImportStatusEntry,
  SyncShelterSheetData,
  ValidationResult,
} from '../../core/models';
import { ApiClientService } from '../../core/services/api/api-client.service';
import { AuthService } from '../../core/services/auth/auth.service';
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
    void this.shelterData.refresh();
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

    const sync = await this.apiClient.syncShelterSheet({
      shelterHomeId: home.id,
    });

    if (!sync.success) {
      this.syncingHomeId.set(null);
      this.notifications.error('Google Sheet sync failed', sync.error.message);
      return;
    }

    const importVersionId =
      sync.data.importVersionId ?? sync.data.importVersion?.id;

    await this.shelterData.loadImportStatus(home.id, importVersionId);
    await this.shelterData.loadConnectedHomes();

    this.syncingHomeId.set(null);

    this.notifications.success(
      `${home.homeName} synced`,
      this.syncResultDetail(sync.data)
    );
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
  }

  closeAddHome(): void {
    this.showAddHome.set(false);
    this.formError.set('');
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

    // The same value the user pasted is what the backend receives.
    const payload: ConnectShelterSheetPayload = {
      homeName,
      address: this.address().trim(),
      contactName: this.contactName().trim(),
      contactPhone: this.contactPhone().trim(),
      spreadsheetUrl,
    };

    this.saving.set(true);
    this.formError.set('');
    this.progressMessage.set('Connecting Google Sheet...');

    const response = await this.apiClient.connectShelterSheet(payload);

    if (!response.success) {
      this.finishWithError(
        response.error.code === 'SPREADSHEET_ALREADY_CONNECTED'
          ? `This Google Sheet is already connected. ${response.error.message}`
          : response.error.message
      );
      return;
    }

    const shelterHomeId = response.data.shelterHome.id;

    this.connectedHome.set({
      id: shelterHomeId,
      name: response.data.shelterHome.homeName,
      spreadsheetName: response.data.sheetSource.spreadsheetName,
    });

    // ---------------------------------------------------------
    // SYNC
    // ---------------------------------------------------------

    this.progressMessage.set('Syncing participant data...');

    const sync = await this.apiClient.syncShelterSheet({ shelterHomeId });

    if (!sync.success) {
      this.finishWithError(
        `Google Sheet connected, but participant sync failed: ${sync.error.message}`
      );
      return;
    }

    const importVersionId = this.importVersionId(sync.data);

    // ---------------------------------------------------------
    // IMPORT STATUS
    // ---------------------------------------------------------

    this.progressMessage.set('Checking import status...');

    const imports = await this.shelterData.loadImportStatus(
      shelterHomeId,
      importVersionId
    );

    if (!imports) {
      this.finishWithError(this.shelterData.errorFor('IMPORTS', shelterHomeId));
      return;
    }

    // ---------------------------------------------------------
    // VALIDATION
    // ---------------------------------------------------------

    this.progressMessage.set('Loading validation results...');

    const validations = await this.shelterData.loadValidationResults(
      shelterHomeId,
      importVersionId
    );

    if (!validations) {
      this.finishWithError(
        this.shelterData.errorFor('VALIDATIONS', shelterHomeId)
      );
      return;
    }

    // ---------------------------------------------------------
    // PARTICIPANTS
    // ---------------------------------------------------------

    this.progressMessage.set('Refreshing participant data...');

    const participants = await this.shelterData.loadParticipants(shelterHomeId);

    if (!participants) {
      this.finishWithError(
        this.shelterData.errorFor('PARTICIPANTS', shelterHomeId)
      );
      return;
    }

    // ---------------------------------------------------------
    // REFRESH CONNECTED HOMES
    // ---------------------------------------------------------

    if (!await this.shelterData.loadConnectedHomes()) {
      this.finishWithError(this.shelterData.homesError());
      return;
    }

    const currentImport = this.currentImport(
      imports,
      shelterHomeId,
      importVersionId
    );

    this.validationResults.set(validations);
    this.importedParticipantCount.set(participants.length);
    this.syncSummary.set(
      this.toSyncSummary(currentImport, sync.data, participants.length)
    );
    this.successMessage.set(this.connectionMessage(response, participants.length));
    this.progressMessage.set('');
    this.saving.set(false);
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
    sync: SyncProgress,
    participantCount: number
  ): SyncSummary {
    return {
      version: status?.versionNumber ?? sync.versionNumber ?? sync.importVersion?.versionNumber ?? null,
      recordsProcessed: status?.recordCount ?? sync.recordCount ?? null,
      validParticipants:
        status?.validParticipantCount ?? sync.validParticipantCount ?? participantCount,
      validationErrors: status?.errorCount ?? sync.errorCount ?? null,
      warnings: status?.warningCount ?? sync.warningCount ?? null,
      syncStatus: status?.status ?? sync.status ?? 'COMPLETED',
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
