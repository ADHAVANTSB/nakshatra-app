import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';

import { EventService } from '../../core/services/events/event.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ReportService } from '../../core/services/reports/report.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';

/** Compact shelter home row rendered in the connected-homes overview. */
interface DashboardHome {
  readonly id: string;
  readonly name: string;
  readonly homeCode: string;
  readonly participants: number;
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
 * `ShelterDataService.refresh()` reads connected homes, the event catalogue and
 * participants; registrations are read separately because the shared store fills
 * them per event. Until that read has answered, the registration card says so
 * rather than claiming a count of zero. Every figure is a read of
 * `ReportService`: this page writes nothing and derives no ranking or winner.
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
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly shelterData = inject(ShelterDataService);
  private readonly shelterHomeService = inject(ShelterHomeService);
  private readonly participantService = inject(ParticipantService);

  /** Backend read state, surfaced verbatim from the shared store. */
  readonly loading = this.shelterData.loading;
  /** True while the backend event catalogue is being read. */
  readonly eventsLoading = this.eventService.loading;
  readonly error = computed(() => this.eventService.loadError() || this.shelterData.homesError());
  readonly hasHomes = this.shelterData.hasHomes;
  readonly totalParticipants = this.shelterData.totalParticipants;

  /** Computed once so the template never touches the clock. */
  readonly greeting = this.resolveGreeting();

  /** Aggregated operational counts across every module. */
  readonly summary = computed(() => this.reportService.getSummary());

  /** First six connected homes with their backend participant counts. */
  readonly homes = computed<DashboardHome[]>(() =>
    this.shelterHomeService
      .homes$()
      .slice(0, 6)
      .map(home => ({
        id: home.id,
        name: home.name,
        homeCode: home.homeCode,
        participants: this.participantService.getParticipantCount(home.id),
      }))
  );

  /** Registration read state, tracked apart from the base store load. */
  readonly registrationsLoading = signal(false);
  readonly registrationsError = signal('');
  private readonly loadedRegistrationEvents = signal<readonly string[]>([]);

  /**
   * True once the backend has answered the registration read for every event.
   * A catalogue that loaded but is empty counts as ready: without events there
   * can be no registrations, so zero is a truthful figure there.
   */
  readonly registrationsReady = computed(() => {
    if (!this.shelterData.eventsLoaded()) {
      return false;
    }

    const events = this.eventService.getAll();

    if (events.length === 0) {
      return true;
    }

    const loaded = new Set(this.loadedRegistrationEvents());
    return events.every(event => loaded.has(event.id));
  });

  /**
   * Registration total, or an explicit "Not loaded" while the read is pending
   * or has failed. A `0` here would assert the backend confirmed no
   * registrations, which an unanswered request cannot say.
   */
  readonly registrationFigure = computed(() =>
    this.registrationsReady() ? String(this.summary().registrations) : 'Not loaded'
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

  /** Re-reads homes, the event catalogue, participants and registrations. */
  reload(): void {
    void this.shelterData.refresh().then(() => this.loadRegistrations());
  }

  /**
   * Reads the registrations of every event from the backend.
   *
   * `ReportService` only reads the shared store, so this request is what makes
   * the registration total meaningful. Events already read are skipped, so a
   * refresh does not re-request them.
   */
  async loadRegistrations(): Promise<void> {
    const alreadyRead = new Set(this.loadedRegistrationEvents());
    const pending = this.eventService
      .getAll()
      .map(event => event.id)
      .filter(eventId => !alreadyRead.has(eventId));

    if (!pending.length) {
      return;
    }

    this.registrationsLoading.set(true);
    this.registrationsError.set('');

    const results = await Promise.all(
      pending.map(eventId => this.registrationService.loadEventRegistrations(eventId))
    );

    this.registrationsLoading.set(false);

    const failed = pending.filter((eventId, index) => results[index] === null);

    if (failed.length) {
      this.registrationsError.set(
        this.shelterData.registrationError(failed[0])
          || 'Registrations could not be read from the backend.'
      );
    }

    const succeeded = pending.filter((eventId, index) => results[index] !== null);

    if (succeeded.length) {
      this.loadedRegistrationEvents.update(current => [...current, ...succeeded]);
    }
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