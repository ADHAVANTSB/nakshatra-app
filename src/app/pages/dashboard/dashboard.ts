import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';

import { ReportService } from '../../core/services/reports/report.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';

/** Lifecycle of the connected-homes read. */
type HomesStatus = 'LOADING' | 'LOADED' | 'ERROR';

/** Compact shelter home row rendered in the connected-homes overview. */
interface DashboardHome {
  readonly id: string;
  readonly name: string;
  readonly homeCode: string;
  readonly status: string;
}

/** Navigation target for a dashboard quick action. */
interface QuickAction {
  readonly label: string;
  readonly path: string;
  readonly description: string;
}

/**
 * Operational landing view.
 *
 * Exactly two backend reads feed this page: `getDashboardSummary` for the stat
 * cards and `listShelterHomes` (through `loadConnectedHomes()`) for the
 * connected-homes list. No per-event or per-participant read is issued.
 *
 * Stat cards render only the counters the backend summary reported. While it
 * loads they show a loading state, and when it fails they show the backend
 * error with a Retry — never zeros and never figures counted on the client.
 * This page writes nothing and derives no ranking or winner.
 */
@Component({
  selector: 'nk-dashboard',
  imports: [],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard implements OnInit {
  private readonly router = inject(Router);
  private readonly reportService = inject(ReportService);
  private readonly shelterData = inject(ShelterDataService);

  private readonly homesStatusState = signal<HomesStatus>('LOADING');
  private readonly homesErrorState = signal('');

  /** State of the connected-homes read. */
  readonly homesStatus = this.homesStatusState.asReadonly();
  /** Backend message from the failed connected-homes read. */
  readonly homesError = this.homesErrorState.asReadonly();

  /** Backend counters; null unless the summary read succeeded. */
  readonly summary = this.reportService.summary;
  readonly summaryLoading = this.reportService.summaryLoading;
  /** Backend message from the failed summary read. */
  readonly summaryError = this.reportService.summaryError;

  /** Any read in flight. */
  readonly busy = computed(() => this.homesStatus() === 'LOADING' || this.summaryLoading());

  /**
   * First run: the backend answered and reports zero connected homes, so the
   * page invites the user to connect one instead of showing empty panels.
   * A failed or still-pending summary is never treated as first run — the
   * summary's own loading or error state stays visible instead.
   */
  readonly firstRun = computed(() => {
    const summary = this.summary();

    return (
      this.homesStatus() === 'LOADED' &&
      this.shelterData.homes().length === 0 &&
      summary !== null &&
      summary.homes === 0
    );
  });

  /** Computed once so the template never touches the clock. */
  readonly greeting = this.resolveGreeting();

  /** "P present · A absent" for the attendance card. */
  readonly attendanceCaption = computed(() => {
    const summary = this.summary();
    return summary
      ? `${summary.attendance.present} present · ${summary.attendance.absent} absent`
      : '';
  });

  /** "G generated · I issued" for the certificates card. */
  readonly certificateCaption = computed(() => {
    const summary = this.summary();
    return summary
      ? `${summary.certificates.generated} generated · ${summary.certificates.issued} issued`
      : '';
  });

  /** Number of homes the backend returned to `listShelterHomes`. */
  readonly totalHomes = computed(() => this.shelterData.homes().length);

  /** First six connected homes, exactly as the backend returned them. */
  readonly homes = computed<DashboardHome[]>(() =>
    this.shelterData.homes().slice(0, 6).map(home => ({
      id: home.id,
      name: home.homeName,
      homeCode: home.homeCode,
      status: home.status === 'ACTIVE' ? 'Active' : 'Inactive',
    }))
  );

  readonly quickActions: readonly QuickAction[] = [
    {
      label: 'Shelter homes',
      path: '/homes',
      description: 'Connect and manage homes',
    },
    {
      label: 'Participants',
      path: '/participants',
      description: 'Browse imported participants',
    },
    {
      label: 'Events',
      path: '/events',
      description: 'Plan and track events',
    },
    {
      label: 'Attendance',
      path: '/attendance',
      description: 'Record event attendance',
    },
    {
      label: 'Scoring',
      path: '/scoring',
      description: 'Capture and finalize scores',
    },
    {
      label: 'Results',
      path: '/results',
      description: 'Review published results',
    },
    {
      label: 'Reports',
      path: '/reports',
      description: 'Operational reporting',
    },
  ];

  ngOnInit(): void {
    this.reload();
  }

  goTo(path: string): void {
    void this.router.navigateByUrl(path);
  }

  /** Re-reads the backend summary and the connected homes; nothing else. */
  reload(): void {
    void this.loadHomes();
    void this.loadSummary();
  }

  /** Re-reads only the backend summary. */
  retrySummary(): void {
    void this.loadSummary();
  }

  /** Re-reads only the connected homes. */
  retryHomes(): void {
    void this.loadHomes();
  }

  /** Reads the connected homes. No participant, import or event read is issued. */
  private async loadHomes(): Promise<void> {
    this.homesStatusState.set('LOADING');
    this.homesErrorState.set('');

    const loaded = await this.shelterData.loadConnectedHomes();

    if (!loaded) {
      this.homesErrorState.set(
        this.shelterData.homesError() || 'Connected shelter homes could not be read from the backend.'
      );
      this.homesStatusState.set('ERROR');
      return;
    }

    this.homesStatusState.set('LOADED');
  }

  /** Reads the backend counters; failure is surfaced through `summaryError`. */
  private async loadSummary(): Promise<void> {
    await this.reportService.getBackendSummary();
  }

  private resolveGreeting(): string {
    const hour = new Date().getHours();

    if (hour < 12) {
      return 'Good morning';
    }

    if (hour < 17) {
      return 'Good afternoon';
    }

    return 'Good evening';
  }
}
