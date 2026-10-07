import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { EventCategory, EventStatus, ReportScopePayload } from '../../core/models';
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

type ReportTab = 'SUMMARY' | 'HOMES' | 'EVENTS' | 'PARTICIPANTS';

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
  imports: [FormsModule],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports implements OnInit {
  private readonly reportService = inject(ReportService);
  private readonly shelterData = inject(ShelterDataService);

  readonly tab = signal<ReportTab>('SUMMARY');
  readonly category = signal<EventCategory | ''>('');
  readonly eventId = signal('');
  readonly homeId = signal('');
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
    const query = this.participantSearch().trim().toLowerCase();

    return (this.rows()?.participants ?? []).filter(row => {
      if (homeId && row.shelterHomeId && row.shelterHomeId !== homeId) {
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

  ngOnInit(): void {
    this.loadFilterOptions();
    this.reload();
  }

  /** Re-reads what the active tab shows, bypassing the scope cache. */
  reload(): void {
    if (this.tab() === 'SUMMARY') {
      void this.reportService.getBackendSummary();
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
    if (this.tab() === 'SUMMARY') {
      if (this.reportService.summaryState().status === 'IDLE') {
        void this.reportService.getBackendSummary();
      }

      return;
    }

    void this.reportService.loadReports(this.scope());
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
