import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { WinnersEventGroup, WinnersService, WinnerMember, WinnerRow } from '../../core/services/certificates/winners.service';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { TeamService } from '../../core/services/teams/team.service';
import {
  DistributionAwardType,
  DistributionTrackingEntry,
} from '../../core/models';
import { DistributionService } from '../../core/services/certificates/distribution.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { canEditModule } from '../../core/permissions/role-matrix';
import { persistenceUnconfirmed } from '../../core/permissions/friendly-error';
import { PARTICIPANT_LEVEL_LABELS } from '../../core/constants/nakshatra-rules';
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
  /** Stable event identity - the grouping key; never the display name. */
  eventId: string;
  eventName: string;
  eventCode: string;
  category: string;
  /** Event mode from the winners payload ('SOLO' / 'GROUP'). */
  mode: string;
  /** Non-empty for a group (team) winner entry. */
  teamId: string;
  winnerName: string;
  /** Participant age as displayed ("9"); the neutral placeholder when unavailable. */
  age: string;
  /** Participant class/standard as displayed ("5"); the neutral placeholder when unavailable. */
  className: string;
  /** Labelled level ("Juniors"), never a raw level id; placeholder when unavailable. */
  levelLabel: string;
  /** One "Name - Age 9 - Class 5 - Juniors" line per member of a group winner. */
  memberDetails: string[];
  /**
   * PRESENT roster members only (backend-filtered): a member without
   * PRESENT attendance for the event never rides along on the team
   * result, so no individual certificate is written for them.
   */
  members: WinnerMember[];
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
 * One rendered table row = one participant. A group winner expands to one
 * row per PRESENT member (never a combined names/ages/classes cell); a
 * solo winner is its own row. Certificate states live on the winner entry
 * (one record per score), so members of a team share their team's states.
 */
interface CertificateDisplayRow {
  /** Unique per rendered row (score id, plus member id for team members). */
  key: string;
  /** The winner entry owning the certificate states (shared by team rows). */
  winner: CertificateRow;
  name: string;
  age: string;
  className: string;
  levelLabel: string;
  /** Official score under the name for individual entries; '' for members. */
  scoreText: string;
  /** Member lines only for a legacy team payload without a member list. */
  memberDetails: string[];
}

/** One event's full-width header band + the display rows shown under it. */
interface CertificateEventGroup {
  /** Stable event identity - the grouping key; never the display name. */
  eventId: string;
  eventCode: string;
  eventName: string;
  category: string;
  icon: string;
  /** Applicable level(s) of the participants shown; '' when unavailable. */
  levelLabel: string;
  modeLabel: string;
  rows: CertificateDisplayRow[];
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
  private readonly shelterData = inject(ShelterDataService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);
  private readonly eventService = inject(EventService);

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
        const detail = this.enrichWinner(winner);

        rows.push({
          scoreId: winner.scoreId,
          eventId: group.eventId,
          eventName: group.eventName,
          eventCode: group.eventCode,
          category: group.category,
          mode: group.mode,
          teamId: winner.teamId,
          winnerName: winner.name,
          age: Certificates.valueOrPlaceholder(detail.age),
          className: Certificates.valueOrPlaceholder(detail.className),
          levelLabel: Certificates.levelLabel(detail.level),
          memberDetails: this.memberDetails(winner),
          members: winner.members || [],
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
    [...new Map(this.rows().map(row => [row.eventId, row])).values()]
      .map(row => ({ key: row.eventId, label: `${row.eventName} (${row.eventCode})` }))
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
      if (event && row.eventId !== event) return false;
      if (home && row.shelterHomeName !== home) return false;
      if (position && row.position !== Number(position)) return false;
      if (written === 'WRITTEN' && !row.written) return false;
      if (written === 'NOT_WRITTEN' && row.written) return false;
      if (distributed === 'DISTRIBUTED' && !row.distributed) return false;
      if (distributed === 'NOT_DISTRIBUTED' && row.distributed) return false;

      return true;
    });
  });

  /* ------------------------------------------------------------------
     EVENT GROUPS (one full-width header band per event, member rows for
     group winners)
     ------------------------------------------------------------------ */

  /** Collapsed event groups (presentation only; never affects counts). */
  private readonly collapsedEvents = signal<ReadonlySet<string>>(new Set());

  /**
   * Display rows grouped under their event's header band. Grouping is by
   * the stable event id - never the display name - so same-name events
   * (the level-split families) keep separate headers and separate rows.
   */
  readonly eventGroups = computed<CertificateEventGroup[]>(() => {
    const groups: CertificateEventGroup[] = [];
    const byEvent = new Map<string, CertificateEventGroup>();
    const levelsById = new Map(
      this.eventService.getAll().map(event => [event.id, event.eligibleLevels]),
    );

    for (const row of this.filteredRows()) {
      let group = byEvent.get(row.eventId);
      if (!group) {
        group = {
          eventId: row.eventId,
          eventCode: row.eventCode,
          eventName: row.eventName,
          category: row.category,
          icon: Certificates.eventIcon(row.mode, row.category),
          levelLabel: '',
          modeLabel: row.mode === 'GROUP' ? 'Group Event' : 'Individual Event',
          rows: [],
        };
        byEvent.set(row.eventId, group);
        groups.push(group);
      }
      group.rows.push(...this.displayRowsFor(row));
    }

    for (const group of groups) {
      group.levelLabel = Certificates.eventLevelLabel(levelsById.get(group.eventId), group.rows);
    }

    return groups;
  });

  isCollapsed(eventId: string): boolean {
    return this.collapsedEvents().has(eventId);
  }

  toggleEventGroup(eventId: string): void {
    this.collapsedEvents.update(current => {
      const next = new Set(current);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  /** One row per PRESENT member for a team winner; one row otherwise. */
  private displayRowsFor(row: CertificateRow): CertificateDisplayRow[] {
    const members = row.members;
    if (row.teamId && members.length) {
      // The backend already filtered the roster to PRESENT members, so an
      // absent team member can never earn a row (or a certificate) here.
      return members.map((member, index) => ({
        key: `${row.scoreId}::${member.participantId || index}`,
        winner: row,
        name: Certificates.valueOrPlaceholder(member.name),
        age: Certificates.valueOrPlaceholder(member.age),
        className: Certificates.valueOrPlaceholder(member.className),
        levelLabel: Certificates.levelLabel(member.level),
        scoreText: '',
        memberDetails: [],
      }));
    }
    return [
      {
        key: row.scoreId,
        winner: row,
        name: row.winnerName,
        age: row.age,
        className: row.className,
        levelLabel: row.levelLabel,
        scoreText: formatScore(row.score),
        memberDetails: row.memberDetails,
      },
    ];
  }

  /** Header icon from the authoritative mode/category values only. */
  private static eventIcon(mode: string, category: string): string {
    if (mode === 'GROUP') {
      return '👥';
    }
    return Certificates.CATEGORY_ICONS[category] ?? '🏅';
  }

  private static readonly CATEGORY_ICONS: Record<string, string> = {
    ARTS: '🎨',
    LITERARY: '📚',
    CULTURAL: '🌸',
  };

  /**
   * "Sub Juniors" / "Common" from the authoritative event catalogue's
   * eligible levels; falls back to the shown rows' own level when the
   * catalogue has no entry. Empty when no level is available at all.
   */
  private static eventLevelLabel(
    levels: readonly string[] | undefined,
    rows: CertificateDisplayRow[],
  ): string {
    if (levels && levels.length) {
      return levels.length >= 4
        ? 'Common'
        : levels
            .map(
              level =>
                PARTICIPANT_LEVEL_LABELS[level as keyof typeof PARTICIPANT_LEVEL_LABELS] ?? level,
            )
            .join(' + ');
    }
    const shown = [
      ...new Set(rows.map(row => row.levelLabel).filter(label => label && label !== '-')),
    ];
    return shown.length === 1 ? shown[0] : '';
  }

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
    // Participant store backs the age / class / level fallback and the
    // per-member details of group winners.
    void this.shelterData.ensureLoaded();
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
      'Event', 'Winner', 'Age', 'Class', 'Category / Level', 'Shelter home', 'Position',
      'Certificate Written', 'Certificate Distributed', 'Last status update',
    ];
    const lines = [header, ...rows.map(row => [
      `${row.eventName} (${row.eventCode})`,
      row.memberDetails.length
        ? `${row.winnerName} (${row.memberDetails.join(' | ')})`
        : row.winnerName,
      row.age,
      row.className,
      row.levelLabel,
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

    // The authoritative event catalogue supplies each event's applicable
    // level for its header band (shared cached store - one read per page
    // load, never a per-row lookup).
    void this.eventService.load().catch(() => false);

    // Group winners list their members without details until the team roster
    // is loaded - fetch it so each member's age / class / level can be shown.
    for (const group of this.events()) {
      if (group.winners.some(winner => winner.teamId)) {
        void this.teamService.loadTeams(group.eventId).catch(() => false);
      }
    }

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

  /**
   * "Age 9 · Class 5 · Juniors" - age, class and labelled level together;
   * a missing value shows "—" (never invented). Team winners carry no
   * age/class/level at all and keep the plain "—".
   */
  /**
   * Fills missing age / class / level from the participant store. Older
   * backend deployments omit `age` in the winners payload; a missing value is
   * never invented - only the recorded participant data is reused.
   */
  private enrichWinner(winner: WinnerRow): WinnerRow {
    const participant = winner.participantId
      ? this.participantService.getParticipantById(winner.participantId)
      : undefined;
    return {
      ...winner,
      age: winner.age || String(participant?.age ?? ''),
      className: winner.className || String(participant?.standard ?? ''),
      level: winner.level || (participant?.level ?? ''),
    };
  }

  /** Per-member age / class / level for a group winner - one certificate each. */
  private memberDetails(winner: WinnerRow): string[] {
    if (!winner.teamId) return [];
    // Backend-filtered roster: only members PRESENT for the event are
    // listed, so an absent team member never earns an individual
    // certificate line. Frontend-only hiding would not be enough - the
    // payload itself carries the eligible members.
    return (winner.members || []).map(
      member =>
        `${member.name} - ${Certificates.ageClassLevelText({
          ...winner,
          participantId: member.participantId,
          name: member.name,
          age: member.age,
          className: member.className,
          level: member.level,
        })}`,
    );
  }

  /** Trimmed display value; the neutral placeholder when unavailable. */
  private static valueOrPlaceholder(value: string | number | null | undefined): string {
    return String(value ?? '').trim() || '—';
  }

  /** Labelled level ("Juniors") from a level id; placeholder when unavailable. */
  private static levelLabel(level: string | null | undefined): string {
    const levelKey = String(level ?? '').trim();
    return levelKey
      ? (PARTICIPANT_LEVEL_LABELS[levelKey as keyof typeof PARTICIPANT_LEVEL_LABELS] ?? levelKey)
      : '—';
  }

  private static ageClassLevelText(winner: WinnerRow): string {
    const age = String(winner.age ?? '').trim();
    const className = String(winner.className ?? '').trim();
    const levelKey = String(winner.level ?? '').trim();
    const level = levelKey
      ? (PARTICIPANT_LEVEL_LABELS[levelKey as keyof typeof PARTICIPANT_LEVEL_LABELS] ?? levelKey)
      : '';
    if (!age && !className && !level) {
      return '—';
    }
    return `Age ${age || '—'} · Class ${className || '—'} · ${level || '—'}`;
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
