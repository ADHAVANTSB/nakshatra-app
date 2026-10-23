import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  EventCategory,
  EventStatus,
  ParticipantLevel,
  ReportScopePayload,
  ValidationSummarySource,
  ValidationWarning,
} from '../../core/models';
import { ApiClientService } from '../../core/services/api/api-client.service';
import {
  WinnersEventGroup,
  WinnersService,
  WinnerRow,
} from '../../core/services/certificates/winners.service';
import {
  AttendanceSummary,
  CertificateSummary,
  NormalizedEventReport,
  NormalizedHomeReport,
  NormalizedParticipantReport,
  NormalizedReportRows,
  ReportService,
} from '../../core/services/reports/report.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';

type ReportTab = 'SUMMARY' | 'HOMES' | 'EVENTS' | 'PARTICIPANTS' | 'WINNERS' | 'CATEGORY_LEVEL' | 'WARNINGS';

/**
 * What a rows tab renders:
 *  - LOADING   the `getReports` read for this scope is pending;
 *  - ERROR     the read failed (backend message in `rowsError`);
 *  - MISSING   the read succeeded but the backend omitted this collection;
 *  - EMPTY     the backend returned an empty array for this scope;
 *  - FILTERED  rows exist, but the page-only Status/search filter hides all;
 *  - ROWS      rows to render.
 */
type RowsView = 'LOADING' | 'ERROR' | 'MISSING' | 'EMPTY' | 'FILTERED' | 'ROWS';

const NOTHING_REPORTED: AttendanceSummary = { recorded: null, present: null, absent: null };
const NO_CERTIFICATES: CertificateSummary = { generated: null, issued: null };

/**
 * Read-only operational reporting.
 *
 * Figures come from two backend actions only:
 *
 *  - `getDashboardSummary` for the Summary tab, read when that tab opens;
 *  - `getReports(scope)` for the Homes, Events and Participants tabs, scoped
 *    by the active Category, Event and Home filters. One read covers all three
 *    tabs, and a scope already loaded or in flight is never re-sent.
 *
 * The filter dropdowns list the connected homes and the event catalogue from
 * the shared store; they are read once if the store has not loaded them yet
 * and never feed a figure.
 *
 * Every tab has explicit LOADING / ERROR / EMPTY states. Nothing is counted on
 * the client, nothing is written, nothing is sorted by score and no winner or
 * ranking is computed. Raw ids never reach the template.
 */
@Component({
  selector: 'nk-reports',
  imports: [ViewOnlyBannerComponent, FormsModule],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports implements OnInit {
  private readonly reportService = inject(ReportService);
  private readonly shelterData = inject(ShelterDataService);
  private readonly apiClient = inject(ApiClientService);
  private readonly winnersService = inject(WinnersService);
  private readonly router = inject(Router);

  readonly tab = signal<ReportTab>('SUMMARY');
  readonly category = signal<EventCategory | ''>('');
  readonly eventId = signal('');
  readonly homeId = signal('');
  /** Page-only level filter (SJ/J/S/SS); "" is "All levels" and changes nothing. */
  readonly level = signal<ParticipantLevel | ''>('');
  readonly eventStatus = signal<EventStatus | ''>('');
  readonly participantSearch = signal('');

  /** Filter options: the event catalogue and connected homes in the shared store. */
  readonly events = this.shelterData.events;
  readonly homes = this.shelterData.homes;

  /** A filter list could not be read; the filters still work with "All". */
  readonly filterOptionsError = computed(() => {
    const homesError = this.shelterData.homesError();
    const eventsError = this.shelterData.eventsError();

    if (homesError && eventsError) {
      return 'The home and event filter lists could not be loaded.';
    }

    if (homesError) {
      return 'The home filter list could not be loaded.';
    }

    return eventsError ? 'The event filter list could not be loaded.' : '';
  });

  /* ---------------- SUMMARY ---------------- */

  /** Backend counters; null unless the summary read succeeded. */
  readonly summary = this.reportService.summary;
  readonly summaryError = this.reportService.summaryError;
  /** Pending or not yet requested: the Summary tab shows its loading state. */
  readonly summaryPending = computed(() => {
    const status = this.reportService.summaryState().status;
    return status === 'IDLE' || status === 'LOADING';
  });

  /** Total certificates, from the two backend counters. */
  readonly certificateTotal = computed(() => {
    const summary = this.summary();
    return summary ? summary.certificates.generated + summary.certificates.issued : null;
  });

  /* ---------------- ROWS ---------------- */

  /** Backend message from the failed `getReports` read. */
  readonly rowsError = this.reportService.reportsError;

  /** Normalized rows, only when the loaded state answers the active scope. */
  private readonly rows = computed<NormalizedReportRows | null>(() => {
    const state = this.reportService.reportsState();
    return state.status === 'LOADED' && this.reportService.isCurrentScope(this.scope())
      ? state.data
      : null;
  });

  /** Shared request state of the three rows tabs for the active scope. */
  private readonly rowsRequest = computed<'LOADING' | 'ERROR' | 'LOADED'>(() => {
    const state = this.reportService.reportsState();

    if (!this.reportService.isCurrentScope(this.scope())) {
      return 'LOADING';
    }

    if (state.status === 'ERROR') {
      return 'ERROR';
    }

    return state.status === 'LOADED' ? 'LOADED' : 'LOADING';
  });

  readonly homeRows = computed<NormalizedHomeReport[]>(() => {
    const homeId = this.homeId();
    return (this.rows()?.homes ?? []).filter(row => !homeId || !row.homeId || row.homeId === homeId);
  });

  /** Event rows; the Status filter is page-only, the rest is the backend scope. */
  readonly eventRows = computed<NormalizedEventReport[]>(() => {
    const category = this.category();
    const eventId = this.eventId();
    const status = this.eventStatus();

    return (this.rows()?.events ?? []).filter(
      row =>
        (!eventId || !row.eventId || row.eventId === eventId) &&
        (!category || !row.category || row.category === category) &&
        (!status || row.status === status)
    );
  });

  /** Participant rows; the search box is page-only and matches readable labels. */
  readonly participantRows = computed<NormalizedParticipantReport[]>(() => {
    const homeId = this.homeId();
    const level = this.level();
    const query = this.participantSearch().trim().toLowerCase();

    return (this.rows()?.participants ?? []).filter(row => {
      if (homeId && row.shelterHomeId && row.shelterHomeId !== homeId) {
        return false;
      }

      if (level && row.level && row.level !== level) {
        return false;
      }

      return (
        !query ||
        `${row.fullName} ${row.participantCode} ${row.homeName} ${row.homeCode}`
          .toLowerCase()
          .includes(query)
      );
    });
  });

  readonly homesView = computed<RowsView>(() =>
    this.viewFor(rows => rows.supplied.homes, rows => rows.homes.length, this.homeRows().length)
  );

  readonly eventsView = computed<RowsView>(() =>
    this.viewFor(rows => rows.supplied.events, rows => rows.events.length, this.eventRows().length)
  );

  readonly participantsView = computed<RowsView>(() =>
    this.viewFor(
      rows => rows.supplied.participants,
      rows => rows.participants.length,
      this.participantRows().length
    )
  );

  /** Any read in flight. */
  readonly busy = computed(
    () => this.reportService.summaryLoading() || this.reportService.reportsLoading()
  );

  /* ---------------- WINNERS (finalized official results only) ---------------- */

  /** Winners report state (loaded lazily by the Winners tabs). */
  readonly winnersGroups = signal<WinnersEventGroup[]>([]);
  readonly winnersLoading = signal(false);
  readonly winnersError = signal('');

  /** Winners rows narrowed by the active event/category/level filters. */
  readonly winnerRows = computed(() => {
    const category = this.category();
    const eventId = this.eventId();
    const level = this.level();
    const rows: Array<WinnerRow & { eventName: string; eventCode: string; category: string }> = [];

    for (const group of this.winnersGroups()) {
      if (eventId && group.eventId !== eventId) continue;
      if (category && group.category !== category) continue;

      for (const winner of group.winners) {
        if (level && winner.level && winner.level.toUpperCase() !== level) continue;

        rows.push({
          ...winner,
          eventName: group.eventName,
          eventCode: group.eventCode,
          category: group.category,
        });
      }
    }

    return rows;
  });

  /**
   * Winners grouped by shelter home - factual rows and counts ONLY.
   * No ranking between homes and no champion formula is computed.
   */
  readonly winnersByHome = computed(() => {
    const grouped = new Map<string, Array<(WinnerRow & { eventName: string; eventCode: string; category: string })>>();

    for (const row of this.winnerRows()) {
      const home = row.shelterHomeName || 'Unknown home';
      const rows = grouped.get(home) ?? [];
      rows.push(row);
      grouped.set(home, rows);
    }

    return [...grouped.entries()]
      .map(([home, rows]) => ({ home, rows, winnerCount: rows.length }))
      .sort((a, b) => a.home.localeCompare(b.home));
  });

  /** Category/level report (ARTS, LITERARY, CULTURALS / SJ, J, S, SS). */
  readonly categoryLevelReport = computed(() => {
    const workflow = this.summary()?.workflow ?? null;
    const rows = this.winnerRows();

    const categories: Array<{ category: string; registrations: number | null; winners: number }> = [
      'ARTS', 'LITERARY', 'CULTURAL',
    ].map(category => ({
      category,
      registrations: workflow
        ? workflow.registrationsByCategory[category] ?? 0
        : null,
      winners: rows.filter(row => row.category === category).length,
    }));

    const levels: Array<{ level: string; label: string; participants: number | null; winners: number }> =
      this.levelOptions.map(level => ({
      level,
      label: this.levelLabel(level),
      participants: workflow ? workflow.levelDistribution[level] ?? 0 : null,
      winners: rows.filter(row => (row.level || '').toUpperCase() === level).length,
    }));

    return { categories, levels };
  });

  /** Level filter options, in SJ/J/S/SS report order. */
  readonly levelOptions: readonly ParticipantLevel[] = [
    'SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR',
  ];

  /** "SJ — Sub Junior" style label for the category/level report. */
  levelLabel(level: string): string {
    switch (level) {
      case 'SUB_JUNIOR': return 'SJ — Sub Junior';
      case 'JUNIOR': return 'J — Junior';
      case 'SENIOR': return 'S — Senior';
      case 'SUPER_SENIOR': return 'SS — Super Senior';
      default: return level || '—';
    }
  }

  /** Renders a nullable counter; null is "Not available", never zero. */
  figureOrNull(value: number | null): string {
    return value === null ? 'Not available' : String(value);
  }

  /** Participation (registrations) of one home, from the reports rows. */
  homeParticipation(homeName: string): string {
    const row = this.homeRows().find(home => home.name === homeName);
    return row ? this.figure(row.registrations) : '—';
  }

  /** CSV export of the active winners/category-level view (read-only). */
  exportCsv(kind: 'winners' | 'winners-by-home' | 'category-level'): void {
    let lines: string[][];

    if (kind === 'winners-by-home') {
      lines = [
        ['Shelter home', 'Event', 'Category', 'Winner', 'Position', 'Final score'],
        ...this.winnersByHome().flatMap(group =>
          group.rows.map(row => [
            group.home, `${row.eventName} (${row.eventCode})`, row.category,
            row.name, String(row.position), this.figure(row.score),
          ]),
        ),
      ];
    } else if (kind === 'category-level') {
      const report = this.categoryLevelReport();
      lines = [
        ['Dimension', 'Name', 'Registrations / participants', 'Winners'],
        ...report.categories.map(row => [
          'Category', row.category, this.figureOrNull(row.registrations), String(row.winners),
        ]),
        ...report.levels.map(row => [
          'Level', row.label, this.figureOrNull(row.participants), String(row.winners),
        ]),
      ];
    } else {
      lines = [
        ['Event', 'Category', 'Winner', 'Shelter home', 'Level', 'Position', 'Final score'],
        ...this.winnerRows().map(row => [
          `${row.eventName} (${row.eventCode})`, row.category, row.name,
          row.shelterHomeName || '—', row.level || '—', String(row.position), this.figure(row.score),
        ]),
      ];
    }

    const csv = lines
      .map(line => line.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `reports-${kind}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  ngOnInit(): void {
    this.loadFilterOptions();
    this.reload();
  }

  /* ---------------- VALIDATION & WARNING CENTRE ---------------- */

  /**
   * Warning-centre state. The read is one backend request that
   * aggregates every check; `sources` keeps each check's own query
   * status so an empty list is never mistaken for "no problems" when a
   * check could not run.
   */
  readonly warningsState = signal<'IDLE' | 'LOADING' | 'LOADED' | 'ERROR'>('IDLE');
  readonly warnings = signal<ValidationWarning[]>([]);
  readonly warningSources = signal<ValidationSummarySource[]>([]);
  /** True only when every check ran; false means "some checks could not run". */
  readonly warningsComplete = signal(true);
  readonly warningsError = signal('');

  readonly warningSeverityFilter = signal<'' | 'ERROR' | 'WARNING' | 'INFO'>('');

  readonly warningRows = computed(() => {
    const severity = this.warningSeverityFilter();
    return this.warnings().filter(warning => !severity || warning.severity === severity);
  });

  readonly warningCounts = computed(() => {
    const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
    for (const warning of this.warnings()) {
      counts[warning.severity]++;
    }
    return counts;
  });

  readonly failedWarningSources = computed(() =>
    this.warningSources().filter(source => source.status !== 'OK'));

  async loadWarnings(force = false): Promise<void> {
    if (this.warningsState() === 'LOADING') {
      return;
    }

    if (!force && this.warningsState() === 'LOADED') {
      return;
    }

    this.warningsState.set('LOADING');
    this.warningsError.set('');

    const response = await this.apiClient.getValidationSummary();

    if (!response.success) {
      this.warningsState.set('ERROR');
      this.warningsError.set(response.error.message);
      return;
    }

    this.warnings.set(response.data.warnings ?? []);
    this.warningSources.set(response.data.sources ?? []);
    this.warningsComplete.set(response.data.complete !== false);
    this.warningsState.set('LOADED');
  }

  retryWarnings(): void {
    void this.loadWarnings(true);
  }

  setWarningSeverityFilter(value: '' | 'ERROR' | 'WARNING' | 'INFO'): void {
    this.warningSeverityFilter.set(value);
  }

  /** Plain-language label for one check's status. */
  warningSourceLabel(source: ValidationSummarySource): string {
    return source.status === 'OK' ? 'Checked' : 'Could not check';
  }

  /**
   * Navigates to the surface that fixes the warning. Only the page
   * route and a readable search filter are used - internal ids never
   * appear in a warning link.
   */
  openWarning(warning: ValidationWarning): void {
    const link = warning.link;

    if (!link || !link.page) {
      return;
    }

    if (link.page === 'participants' && link.filter) {
      void this.router.navigate(['/participants'], { queryParams: { q: link.filter } });
      return;
    }

    void this.router.navigate(['/' + link.page]);
  }

  /** Re-reads what the active tab shows, bypassing the scope cache. */
  reload(): void {
    if (this.tab() === 'WARNINGS') {
      void this.loadWarnings(true);
      return;
    }

    if (this.tab() === 'SUMMARY') {
      void this.reportService.getBackendSummary();
    } else if (this.tab() === 'WINNERS' || this.tab() === 'CATEGORY_LEVEL') {
      void this.loadWinners(true);
      if (this.tab() === 'CATEGORY_LEVEL') {
        void this.reportService.getBackendSummary();
      }
    } else {
      void this.reportService.loadReports(this.scope(), true);
    }
  }

  /** Retries the backend summary. */
  retrySummary(): void {
    void this.reportService.getBackendSummary();
  }

  /** Retries `getReports` for the active scope. */
  retryRows(): void {
    void this.reportService.loadReports(this.scope(), true);
  }

  setTab(tab: ReportTab): void {
    this.tab.set(tab);
    this.ensureTabData();
  }

  setCategory(category: EventCategory | ''): void {
    this.category.set(category);
    this.clearEventIfFilteredOut();
    this.ensureTabData();
  }

  setEvent(eventId: string): void {
    this.eventId.set(eventId);
    this.ensureTabData();
  }

  setHome(homeId: string): void {
    this.homeId.set(homeId);
    this.ensureTabData();
  }

  setLevel(level: ParticipantLevel | ''): void {
    this.level.set(level);
  }

  setEventStatus(status: EventStatus | ''): void {
    this.eventStatus.set(status);
  }

  setParticipantSearch(value: string): void {
    this.participantSearch.set(value);
  }

  /** Clears the page-only Status filter. */
  clearEventStatus(): void {
    this.eventStatus.set('');
  }

  /** Clears the page-only participant search. */
  clearParticipantSearch(): void {
    this.participantSearch.set('');
  }

  /** Renders a counter, or an em dash when the backend row never carried one. */
  figure(value: number | null): string {
    return this.reportService.figure(value);
  }

  attendanceOf(attendance: AttendanceSummary | null): AttendanceSummary {
    return attendance ?? NOTHING_REPORTED;
  }

  certificatesOf(certificates: CertificateSummary | null): CertificateSummary {
    return certificates ?? NO_CERTIFICATES;
  }

  /** "P present · A absent", or an explicit note when nothing was reported. */
  attendanceBreakdown(attendance: AttendanceSummary | null): string {
    if (!attendance) {
      return 'Not reported';
    }

    return `${this.figure(attendance.present)} present · ${this.figure(attendance.absent)} absent`;
  }

  /**
   * Requests what the active tab needs. The summary is read once and then only
   * on Retry/Reload; rows are deduplicated by scope in the service.
   */
  private ensureTabData(): void {
    if (this.tab() === 'WARNINGS') {
      void this.loadWarnings();
      return;
    }

    if (this.tab() === 'SUMMARY') {
      if (this.reportService.summaryState().status === 'IDLE') {
        void this.reportService.getBackendSummary();
      }

      return;
    }

    if (this.tab() === 'WINNERS' || this.tab() === 'CATEGORY_LEVEL') {
      void this.loadWinners();
      void this.reportService.loadReports(this.scope());

      if (this.tab() === 'CATEGORY_LEVEL' && this.reportService.summaryState().status === 'IDLE') {
        void this.reportService.getBackendSummary();
      }

      return;
    }

    void this.reportService.loadReports(this.scope());
  }

  /**
   * Winners report (finalized official results only). Loading it is
   * read-only: it never marks, approves or changes anything.
   */
  private async loadWinners(force = false): Promise<void> {
    if (this.winnersLoading()) {
      return;
    }

    if (!force && this.winnersGroups().length) {
      return;
    }

    this.winnersLoading.set(true);
    this.winnersError.set('');

    const report = await this.winnersService.load(force);

    if (report) {
      this.winnersGroups.set(report.events);
    } else {
      this.winnersError.set('The winners report could not be read.');
    }

    this.winnersLoading.set(false);
  }

  /** Reads the filter option lists only when the shared store lacks them. */
  private loadFilterOptions(): void {
    if (!this.shelterData.homes().length) {
      void this.shelterData.loadConnectedHomes();
    }

    if (!this.shelterData.eventsLoaded()) {
      void this.shelterData.loadEvents();
    }
  }

  private viewFor(
    supplied: (rows: NormalizedReportRows) => boolean,
    total: (rows: NormalizedReportRows) => number,
    visible: number
  ): RowsView {
    const request = this.rowsRequest();

    if (request !== 'LOADED') {
      return request;
    }

    const rows = this.rows();

    if (!rows || !supplied(rows)) {
      return 'MISSING';
    }

    if (!total(rows)) {
      return 'EMPTY';
    }

    return visible ? 'ROWS' : 'FILTERED';
  }

  /** The active filters, sent verbatim as the report scope. */
  private scope(): ReportScopePayload {
    const scope: ReportScopePayload = {};
    const home = this.homeId();
    const event = this.eventId();
    const category = this.category();

    if (home) {
      scope.homeId = home;
    }

    if (event) {
      scope.eventId = event;
    }

    if (category) {
      scope.category = category;
    }

    return scope;
  }

  /** Drops an event selection the category filter excludes. */
  private clearEventIfFilteredOut(): void {
    if (
      this.eventId() &&
      !this.events().some(
        event =>
          event.id === this.eventId() && (!this.category() || event.category === this.category())
      )
    ) {
      this.eventId.set('');
    }
  }
}
