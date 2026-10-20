import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';

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

/** One winner's toggle view state for one award type. */
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

/**
 * Winners report for the Certificate Team.
 *
 * Every finalized event in the session's programme/environment is listed
 * automatically with its top-three ranked entries — individual winners show
 * name, class, level and shelter home; team winners show the team name and
 * its member names. Certificates are written by hand from this list; this
 * page generates nothing and has no event filter.
 *
 * Each winner row also carries the PHYSICAL distribution toggles ("Medal
 * Distributed" / "Certificate Distributed"). This is a separate, later
 * stage than the app's certificate generation/issuance workflow: a toggle
 * records that a physical item reached the winner. Statuses are only ever
 * what the backend confirmed (server timestamp + recording user), so the
 * Print List can never show an unsaved checkbox state.
 */
@Component({
  selector: 'nk-certificates',
  imports: [ViewOnlyBannerComponent, ],
  templateUrl: './certificates.html',
  styleUrl: './certificates.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Certificates implements OnInit {
  /** Official score display rule: one decimal where necessary — "21.5", never "21.0". */
  readonly formatScore = formatScore;

  readonly awards: DistributionAwardType[] = ['MEDAL', 'CERTIFICATE'];

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

  /** Physical distribution is edited by Support/Admin + the certificates role. */
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
        title: 'Distribution statuses could not be read.',
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
          title: 'Distribution tracking storage is missing.',
          message:
            `The "${storage.table}" sheet has not been created yet. Migration step: ${storage.migrationStep} ` +
            'Winners load normally, but distribution statuses cannot be saved until an administrator applies this migration.',
          retryable: false,
        }
      : {
          kind: 'incompatible',
          title: 'Distribution tracking storage is out of date.',
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

  print(): void {
    window.print();
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
      console.warn('[nakshatra] distribution tracking unavailable', {
        table: storage.table,
        status: storage.status,
        reason: storage.reason,
        migrationStep: storage.migrationStep,
      });
    }
    const readError = this.trackingReadError();
    if (readError) {
      console.warn('[nakshatra] distribution tracking read failed', {
        code: readError.code,
        message: readError.message,
      });
    }
  }

  // ---------------------------------------------------------
  // DISTRIBUTION TOGGLES (one row = one winner + one award type)
  // ---------------------------------------------------------

  private stateKey(winner: WinnerRow, awardType: DistributionAwardType): string {
    return `${winner.scoreId}|${awardType}`;
  }

  private confirmedEntry(
    winner: WinnerRow,
    awardType: DistributionAwardType,
  ): DistributionTrackingEntry | null {
    return this.distributionService.entryFor(winner.scoreId, awardType);
  }

  stateFor(winner: WinnerRow, awardType: DistributionAwardType): DistributionUiState {
    const stored = this.uiStates()[this.stateKey(winner, awardType)];
    if (stored) {
      return stored;
    }
    return {
      checked: this.confirmedEntry(winner, awardType)?.distributed ?? false,
      saving: false,
      error: null,
      errorCode: null,
      failedTarget: null,
    };
  }

  awardLabel(awardType: DistributionAwardType): string {
    return awardType === 'MEDAL' ? 'Medal Distributed' : 'Certificate Distributed';
  }

  /**
   * Backend-confirmed state text: "Distributed — 25 Oct 2026, 11:42 AM by
   * Praveen" or "Not distributed" — never a checkbox state that has not
   * been confirmed by the backend.
   */
  distributionLabel(winner: WinnerRow, awardType: DistributionAwardType): string {
    if (!this.trackingAvailable()) {
      return 'Unavailable';
    }
    const entry = this.confirmedEntry(winner, awardType);
    if (!entry?.distributed) {
      return 'Not distributed';
    }
    const timestamp = Certificates.formatTimestamp(entry.distributedAt);
    const recorder = entry.recordedByName || entry.recordedBy;
    return `Distributed${timestamp ? ` — ${timestamp}` : ''}${recorder ? ` by ${recorder}` : ''}`;
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
    winner: WinnerRow,
    awardType: DistributionAwardType,
    input: HTMLInputElement,
  ): Promise<void> {
    await this.saveDistribution(winner, awardType, input.checked, input);
  }

  /** Re-attempts the save that failed (safe: the backend upsert is idempotent). */
  async retryDistribution(winner: WinnerRow, awardType: DistributionAwardType): Promise<void> {
    const state = this.stateFor(winner, awardType);
    if (state.failedTarget === null) {
      return;
    }
    await this.saveDistribution(winner, awardType, state.failedTarget);
  }

  private async saveDistribution(
    winner: WinnerRow,
    awardType: DistributionAwardType,
    checked: boolean,
    input?: HTMLInputElement,
  ): Promise<void> {
    const key = this.stateKey(winner, awardType);
    const state = this.stateFor(winner, awardType);

    if (!this.canEditDistribution() || !this.trackingAvailable() || state.saving) {
      // A click during a save (or an unauthorized attempt) changes nothing.
      if (input) {
        input.checked = state.checked;
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

    const confirmed = this.confirmedEntry(winner, awardType);
    const result = await this.distributionService.save(
      winner.scoreId,
      awardType,
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
          ? `${this.awardLabel(awardType)} recorded for ${winner.name}.`
          : `${this.awardLabel(awardType)} corrected: now not distributed for ${winner.name}.`,
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
    this.notifications.error(`${this.awardLabel(awardType)} was not saved.`, message);
  }

  canRetry(winner: WinnerRow, awardType: DistributionAwardType): boolean {
    const state = this.stateFor(winner, awardType);
    return !!state.errorCode && persistenceUnconfirmed(state.errorCode);
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
