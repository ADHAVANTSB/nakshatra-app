import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { WinnersEventGroup, WinnersService, WinnerRow } from '../../core/services/certificates/winners.service';
import {
  DistributionAwardType,
  DistributionTrackingEntry,
} from '../../core/models';
import { DistributionService } from '../../core/services/certificates/distribution.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { canEditModule } from '../../core/permissions/role-matrix';
import { persistenceUnconfirmed } from '../../core/permissions/friendly-error';
import { formatScore } from '../../shared/score-format';

/** One winner's toggle view state for one certificate-workflow state. */
interface DistributionUiState {
  /** Checkbox view state (the requested target while a save is running). */
  checked: boolean;
  saving: boolean;
  /** Friendly message of the last failed save, if any. */
  error: string | null;
  errorCode: string | null;
  /** The save that failed, so Retry can re-attempt it. */
  failedTarget: boolean | null;
}

interface TrackingNotice {
  kind: 'missing' | 'incompatible' | 'read-error';
  title: string;
  message: string;
  retryable: boolean;
}

/** The two certificate-workflow states, in workflow order. */
type CertificateState = 'CERTIFICATE_WRITTEN' | 'CERTIFICATE';

/** Which rows the active view shows. */
type CertificateView = 'ALL' | 'WRITTEN_DISTRIBUTED' | 'PENDING_DISTRIBUTION' | 'PENDING_WRITING';

/** One flattened winner row joined with its certificate-workflow state. */
export interface CertificateRow {
  scoreId: string;
  eventName: string;
  eventCode: string;
  category: string;
  winnerName: string;
  /** "5A · Junior" - class and level together, never a raw id. */
  classAndLevel: string;
  shelterHomeName: string;
  position: number;
  score: number;
  written: boolean;
  writtenLabel: string;
  distributed: boolean;
  distributedLabel: string;
  /** Timestamp + user of the most recent confirmed status change. */
  lastUpdate: string;
}

/**
 * Certificate workflow for the Certificate Team.
 *
 * Every finalized event in the session's programme/environment is listed
 * automatically with its top-three ranked entries. Each winner row tracks
 * exactly TWO certificate-workflow states - **Certificate Written**
 * (prepared) and **Certificate Distributed** (handed over) - and nothing
 * else: medals are a separate operation and never appear here. A
 * certificate can only be marked distributed AFTER it is written (the
 * backend enforces this too); a certificate is never written or
 * distributed merely because a winner exists, a box was clicked, or a
 * list was printed or exported - print/export/view never record anything.
 *
 * Statuses are only ever what the backend confirmed (server timestamp +
 * recording user), so no view can show an unsaved checkbox state.
 */
@Component({
  selector: 'nk-certificates',
  imports: [ViewOnlyBannerComponent, FormsModule],
  templateUrl: './certificates.html',
  styleUrl: './certificates.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Certificates implements OnInit {
  /** Official score display rule: one decimal where necessary — "21.5", never "21.0". */
  readonly formatScore = formatScore;

  readonly states: CertificateState[] = ['CERTIFICATE_WRITTEN', 'CERTIFICATE'];

  private readonly winnersService = inject(WinnersService);
  private readonly distributionService = inject(DistributionService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);

  readonly loading = this.winnersService.loading$;
  readonly loadError = this.winnersService.error$;
  readonly events = signal<WinnersEventGroup[]>([]);
  readonly totalWinners = signal(0);

  readonly trackingStorage = this.distributionService.storage$;
  readonly trackingEntries = this.distributionService.entries$;
  readonly trackingLoading = this.distributionService.loading$;
  readonly trackingReadError = this.distributionService.readError$;

  private readonly uiStates = signal<Record<string, DistributionUiState>>({});

  /** Certificate statuses are edited by Support/Admin + the certificates role. */
  readonly canEditDistribution = computed(() =>
    canEditModule(this.auth.currentUser()?.role ?? null, 'DISTRIBUTION'),
  );

  /** Tracking can only be edited and shown when its storage is usable. */
  readonly trackingAvailable = computed(() => this.trackingStorage()?.available === true);

  /** Storage health problems, kept strictly apart from "nothing recorded yet". */
  readonly trackingNotice = computed<TrackingNotice | null>(() => {
    const readError = this.trackingReadError();
    if (readError) {
      return {
        kind: 'read-error',
        title: 'Certificate statuses could not be read.',
        message: readError.message,
        retryable: persistenceUnconfirmed(readError.code),
      };
    }
    const storage = this.trackingStorage();
    if (!storage || storage.available) {
      return null;
    }
    return storage.status === 'TABLE_MISSING'
      ? {
          kind: 'missing',
          title: 'Certificate status storage is missing.',
          message:
            `The "${storage.table}" sheet has not been created yet. Migration step: ${storage.migrationStep} ` +
            'Winners load normally, but written/distributed statuses cannot be saved until an administrator applies this migration.',
          retryable: false,
        }
      : {
          kind: 'incompatible',
          title: 'Certificate status storage is out of date.',
          message:
            `The "${storage.table}" sheet does not match the expected layout (${storage.reason}). ` +
            `Migration step: ${storage.migrationStep}`,
          retryable: false,
        };
  });

  /** True only when tracking works and nothing has been recorded yet. */
  readonly noDistributionsRecorded = computed(
    () =>
      this.trackingAvailable() &&
      !this.trackingLoading() &&
      this.distributionService.recordedCount() === 0,
  );

  /* ------------------------------------------------------------------
     ROWS, SUMMARY, FILTERS, VIEWS
     ------------------------------------------------------------------ */

  /** Every eligible winner flattened with its confirmed certificate state. */
  readonly rows = computed<CertificateRow[]>(() => {
    const events = this.events();
    const rows: CertificateRow[] = [];

    for (const group of events) {
      const groupWinners: WinnerRow[] = group.winners;

      for (const winner of groupWinners) {
        const written = this.confirmedEntry(winner.scoreId, 'CERTIFICATE_WRITTEN');
        const distributed = this.confirmedEntry(winner.scoreId, 'CERTIFICATE');

        rows.push({
          scoreId: winner.scoreId,
          eventName: group.eventName,
          eventCode: group.eventCode,
          category: group.category,
          winnerName: winner.name,
          classAndLevel: [winner.className, winner.level].filter(part => !!part).join(' · ') || '—',
          shelterHomeName: winner.shelterHomeName || '—',
          position: winner.position,
          score: winner.score,
          written: !!written?.distributed,
          writtenLabel: this.stateLabel(written, 'Written', 'Not written'),
          distributed: !!distributed?.distributed,
          distributedLabel: this.stateLabel(distributed, 'Distributed', 'Not distributed'),
          lastUpdate: this.lastUpdateOf(written, distributed),
        });
      }
    }

    return rows;
  });

  /** Summary cards: one row is counted exactly once per figure. */
  readonly summary = computed(() => {
    const rows = this.rows();
    return {
      eligible: rows.length,
      written: rows.filter(row => row.written).length,
      distributed: rows.filter(row => row.distributed).length,
      pendingWriting: rows.filter(row => !row.written).length,
      writtenNotDistributed: rows.filter(row => row.written && !row.distributed).length,
    };
  });

  /** Filter option lists derived from the loaded rows. */
  readonly filterCategories = computed(() => [...new Set(this.rows().map(row => row.category))].sort());
  readonly filterHomes = computed(() => [...new Set(this.rows().map(row => row.shelterHomeName))].sort());
  readonly filterEvents = computed(() =>
    [...new Map(this.rows().map(row => [row.eventCode + '|' + row.eventName, row])).values()]
      .map(row => ({ key: row.eventCode + '|' + row.eventName, label: `${row.eventName} (${row.eventCode})` }))
      .sort((a, b) => a.label.localeCompare(b.label)));

  readonly view = signal<CertificateView>('ALL');
  readonly categoryFilter = signal('');
  readonly eventFilter = signal('');
  readonly homeFilter = signal('');
  readonly positionFilter = signal<'' | '1' | '2' | '3'>('');
  readonly writtenFilter = signal<'' | 'WRITTEN' | 'NOT_WRITTEN'>('');
  readonly distributedFilter = signal<'' | 'DISTRIBUTED' | 'NOT_DISTRIBUTED'>('');

  readonly views: Array<{ id: CertificateView; label: string }> = [
    { id: 'ALL', label: 'All certificates' },
    { id: 'WRITTEN_DISTRIBUTED', label: 'Written & Distributed' },
    { id: 'PENDING_DISTRIBUTION', label: 'Pending Distribution' },
    { id: 'PENDING_WRITING', label: 'Pending Writing' },
  ];

  /** Rows narrowed by the view first, then by every active filter. */
  readonly filteredRows = computed<CertificateRow[]>(() => {
    const view = this.view();
    const category = this.categoryFilter();
    const event = this.eventFilter();
    const home = this.homeFilter();
    const position = this.positionFilter();
    const written = this.writtenFilter();
    const distributed = this.distributedFilter();

    return this.rows().filter(row => {
      if (view === 'WRITTEN_DISTRIBUTED' && !(row.written && row.distributed)) return false;
      if (view === 'PENDING_DISTRIBUTION' && !(row.written && !row.distributed)) return false;
      if (view === 'PENDING_WRITING' && row.written) return false;

      if (category && row.category !== category) return false;
      if (event && `${row.eventCode}|${row.eventName}` !== event) return false;
      if (home && row.shelterHomeName !== home) return false;
      if (position && row.position !== Number(position)) return false;
      if (written === 'WRITTEN' && !row.written) return false;
      if (written === 'NOT_WRITTEN' && row.written) return false;
      if (distributed === 'DISTRIBUTED' && !row.distributed) return false;
      if (distributed === 'NOT_DISTRIBUTED' && row.distributed) return false;

      return true;
    });
  });

  setView(view: CertificateView): void {
    this.view.set(view);
  }

  setCategory(value: string): void {
    this.categoryFilter.set(value);
  }

  setEvent(value: string): void {
    this.eventFilter.set(value);
  }

  setHome(value: string): void {
    this.homeFilter.set(value);
  }

  setPosition(value: '' | '1' | '2' | '3'): void {
    this.positionFilter.set(value);
  }

  setWrittenFilter(value: '' | 'WRITTEN' | 'NOT_WRITTEN'): void {
    this.writtenFilter.set(value);
  }

  setDistributedFilter(value: '' | 'DISTRIBUTED' | 'NOT_DISTRIBUTED'): void {
    this.distributedFilter.set(value);
  }

  /* ------------------------------------------------------------------
     LIFECYCLE
     ------------------------------------------------------------------ */

  ngOnInit(): void {
    void this.load();
  }

  async retry(): Promise<void> {
    await this.load(true);
  }

  /** Retries only the distribution read; the winners list stays untouched. */
  async retryTracking(): Promise<void> {
    await this.distributionService.load(true);
    this.logStorageDiagnostics();
  }

  /** Prints the CURRENT view exactly as filtered; printing records nothing. */
  print(): void {
    window.print();
  }

  /**
   * CSV export of the current view (or every row for the overall status
   * report). Exporting records nothing: it only reads confirmed states.
   */
  exportCsv(overall = false): void {
    const rows = overall ? this.rows() : this.filteredRows();
    const header = [
      'Event', 'Winner', 'Class & Level', 'Shelter home', 'Position',
      'Certificate Written', 'Certificate Distributed', 'Last status update',
    ];
    const lines = [header, ...rows.map(row => [
      `${row.eventName} (${row.eventCode})`,
      row.winnerName,
      row.classAndLevel,
      row.shelterHomeName,
      String(row.position),
      row.writtenLabel,
      row.distributedLabel,
      row.lastUpdate || '—',
    ])];

    const csv = lines
      .map(line => line.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = overall
      ? 'certificate-status-report.csv'
      : `certificate-${this.view().toLowerCase()}-view.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private async load(force = false): Promise<void> {
    const report = await this.winnersService.load(force);
    this.events.set(report ? report.events : []);
    this.totalWinners.set(report ? report.totalWinners : 0);

    // Tracking is a separate read: if it fails the winners list above is
    // still shown and the toggles fall into an explicit unavailable state.
    await this.distributionService.load(force);
    this.logStorageDiagnostics();
  }

  /** Safe diagnostics for admins: storage state only, never record data. */
  private logStorageDiagnostics(): void {
    const storage = this.trackingStorage();
    if (storage && !storage.available) {
      console.warn('[nakshatra] certificate status tracking unavailable', {
        table: storage.table,
        status: storage.status,
        reason: storage.reason,
        migrationStep: storage.migrationStep,
      });
    }
    const readError = this.trackingReadError();
    if (readError) {
      console.warn('[nakshatra] certificate status tracking read failed', {
        code: readError.code,
        message: readError.message,
      });
    }
  }

  // ---------------------------------------------------------
  // CERTIFICATE WRITTEN / DISTRIBUTED TOGGLES
  // (one row = one winner + one workflow state)
  // ---------------------------------------------------------

  private stateKey(scoreId: string, state: CertificateState): string {
    return `${scoreId}|${state}`;
  }

  private confirmedEntry(
    scoreId: string,
    state: CertificateState,
  ): DistributionTrackingEntry | null {
    return this.distributionService.entryFor(scoreId, state);
  }

  stateFor(row: CertificateRow, state: CertificateState): DistributionUiState {
    const stored = this.uiStates()[this.stateKey(row.scoreId, state)];
    if (stored) {
      return stored;
    }
    return {
      checked: this.confirmedEntry(row.scoreId, state)?.distributed ?? false,
      saving: false,
      error: null,
      errorCode: null,
      failedTarget: null,
    };
  }

  awardLabel(state: CertificateState): string {
    return state === 'CERTIFICATE_WRITTEN' ? 'Certificate Written' : 'Certificate Distributed';
  }

  /**
   * Backend-confirmed state text: "Written — 25 Oct 2026, 11:42 AM by
   * Praveen" or "Not written" — never a checkbox state that has not
   * been confirmed by the backend.
   */
  distributionLabel(row: CertificateRow, state: CertificateState): string {
    if (!this.trackingAvailable()) {
      return 'Unavailable';
    }
    const entry = this.confirmedEntry(row.scoreId, state);
    return this.stateLabel(entry, state === 'CERTIFICATE_WRITTEN' ? 'Written' : 'Distributed',
      state === 'CERTIFICATE_WRITTEN' ? 'Not written' : 'Not distributed');
  }

  /** The DISTRIBUTED toggle is disabled until the certificate is written. */
  canToggle(row: CertificateRow, state: CertificateState): boolean {
    if (!this.canEditDistribution() || !this.trackingAvailable()) {
      return false;
    }
    if (state === 'CERTIFICATE') {
      return this.stateFor(row, 'CERTIFICATE_WRITTEN').checked;
    }
    return true;
  }

  /**
   * Saves one toggle through the backend. Rapid clicks are ignored while
   * a save is running (the backend upsert is idempotent as well); a
   * failure restores the last confirmed state and offers Retry only when
   * retrying can actually succeed. The checkbox element is restored
   * explicitly because a property binding that did not change never
   * rewrites the DOM.
   */
  async toggleDistribution(
    row: CertificateRow,
    state: CertificateState,
    input: HTMLInputElement,
  ): Promise<void> {
    await this.saveDistribution(row, state, input.checked, input);
  }

  /** Re-attempts the save that failed (safe: the backend upsert is idempotent). */
  async retryDistribution(row: CertificateRow, state: CertificateState): Promise<void> {
    const ui = this.stateFor(row, state);
    if (ui.failedTarget === null) {
      return;
    }
    await this.saveDistribution(row, state, ui.failedTarget);
  }

  private async saveDistribution(
    row: CertificateRow,
    state: CertificateState,
    checked: boolean,
    input?: HTMLInputElement,
  ): Promise<void> {
    const key = this.stateKey(row.scoreId, state);
    const ui = this.stateFor(row, state);

    if (!this.canToggle(row, state) || ui.saving) {
      // A click during a save (or an unauthorized / out-of-order attempt)
      // changes nothing.
      if (input) {
        input.checked = ui.checked;
      }
      return;
    }

    this.patchState(key, {
      checked,
      saving: true,
      error: null,
      errorCode: null,
      failedTarget: checked,
    });

    const confirmed = this.confirmedEntry(row.scoreId, state);
    const result = await this.distributionService.save(
      row.scoreId,
      state,
      checked,
      confirmed?.version,
    );

    if (result.success && result.entry) {
      // Success is only ever reported after the backend confirmed.
      this.patchState(key, {
        checked: result.entry.distributed,
        saving: false,
        error: null,
        errorCode: null,
        failedTarget: null,
      });
      if (input) {
        input.checked = result.entry.distributed;
      }
      this.notifications.success(
        checked
          ? `${this.awardLabel(state)} recorded for ${row.winnerName}.`
          : `${this.awardLabel(state)} corrected: now not ${state === 'CERTIFICATE_WRITTEN' ? 'written' : 'distributed'} for ${row.winnerName}.`,
      );
      return;
    }

    const code = result.error?.code ?? 'NETWORK_ERROR';
    const message = result.error?.message ?? 'This change could not be saved.';
    const unconfirmed = persistenceUnconfirmed(code);
    const restored = confirmed?.distributed ?? false;

    // Never claim a save that was not confirmed: restore the last
    // confirmed state and keep the failure visible.
    this.patchState(key, {
      checked: restored,
      saving: false,
      error: unconfirmed ? `${message} This change is not confirmed.` : message,
      errorCode: code,
      failedTarget: checked,
    });
    if (input) {
      input.checked = restored;
    }
    this.notifications.error(`${this.awardLabel(state)} was not saved.`, message);
  }

  canRetry(row: CertificateRow, state: CertificateState): boolean {
    const ui = this.stateFor(row, state);
    return !!ui.errorCode && persistenceUnconfirmed(ui.errorCode);
  }

  private patchState(key: string, patch: Partial<DistributionUiState>): void {
    this.uiStates.update(current => {
      const existing: DistributionUiState = current[key] ?? {
        checked: false,
        saving: false,
        error: null,
        errorCode: null,
        failedTarget: null,
      };
      return { ...current, [key]: { ...existing, ...patch } };
    });
  }

  /** Confirmed-state label with its server timestamp and recorder. */
  private stateLabel(
    entry: DistributionTrackingEntry | null,
    doneLabel: string,
    undoneLabel: string,
  ): string {
    if (!entry?.distributed) {
      return undoneLabel;
    }
    const timestamp = Certificates.formatTimestamp(entry.distributedAt);
    const recorder = entry.recordedByName || entry.recordedBy;
    return `${doneLabel}${timestamp ? ` — ${timestamp}` : ''}${recorder ? ` by ${recorder}` : ''}`;
  }

  /** Timestamp + recorder of the most recent confirmed status change. */
  private lastUpdateOf(
    written: DistributionTrackingEntry | null,
    distributed: DistributionTrackingEntry | null,
  ): string {
    const entries = [written, distributed].filter(
      (entry): entry is DistributionTrackingEntry => !!entry?.distributed,
    );

    if (!entries.length) {
      return '—';
    }

    const latest = entries.sort(
      (a, b) => new Date(b.distributedAt).getTime() - new Date(a.distributedAt).getTime(),
    )[0];
    const timestamp = Certificates.formatTimestamp(latest.distributedAt);
    const recorder = latest.recordedByName || latest.recordedBy;

    return `${timestamp || '—'}${recorder ? ` by ${recorder}` : ''}`;
  }

  /** "25 Oct 2026, 11:42 AM" — the format shown on rows and printouts. */
  private static formatTimestamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .format(date)
      .replace(/\s?(am|pm)/i, match => match.toUpperCase());
  }
}
