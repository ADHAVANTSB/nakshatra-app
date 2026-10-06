import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EventCategory, EventStatus } from '../../core/models';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { ReportService } from '../../core/services/reports/report.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';

type ReportTab = 'SUMMARY' | 'HOMES' | 'EVENTS' | 'PARTICIPANTS';

/**
 * Read-only operational reporting.
 *
 * Homes, participants and events come from the shared backend store, but that
 * store fills registrations per event, so this page issues that read itself.
 * Until the backend has answered for every event in scope, registration-derived
 * figures are labelled as not loaded: a `0` shown before the read would claim
 * the backend confirmed there are no registrations.
 *
 * Nothing here writes, and no ranking, ordering by score or winner is derived.
 * Shelter home ids are always resolved to the readable name and code.
 */
@Component({
  selector: 'nk-reports',
  imports: [FormsModule],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports implements OnInit {
  private readonly reportService = inject(ReportService);
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly homeService = inject(ShelterHomeService);
  private readonly shelterData = inject(ShelterDataService);

  readonly tab = signal<ReportTab>('SUMMARY');
  readonly category = signal<EventCategory | ''>('');
  readonly eventId = signal('');
  readonly homeId = signal('');
  readonly eventStatus = signal<EventStatus | ''>('');
  readonly participantSearch = signal('');
  readonly events = this.eventService.events$;
  readonly homes = this.homeService.homes$;

  /** True while the shared backend cache is being filled. */
  readonly loading = this.shelterData.loading;

  /** Registration read state, tracked apart from the base store load. */
  readonly registrationsLoading = signal(false);
  readonly registrationsError = signal('');
  private readonly loadedRegistrationEvents = signal<readonly string[]>([]);

  /**
   * Only the homes, participants and events scopes can invalidate the base
   * numbers shown here; registration failures are reported separately so the
   * unaffected columns stay readable.
   */
  readonly error = computed(() => {
    const eventsError = this.shelterData.eventsError();

    if (eventsError) {
      return `The event catalogue could not be loaded. ${eventsError}`;
    }

    const homesError = this.shelterData.homesError();

    if (homesError) {
      return homesError;
    }

    const participantsError = this.shelterData.errorFor('PARTICIPANTS');

    return participantsError
      ? `Participant records could not be loaded. ${participantsError}`
      : '';
  });

  readonly summary = computed(() => this.reportService.getSummary());
  readonly homeReports = computed(() => this.reportService.getHomeReports(this.eventId())
    .filter(report => !this.homeId() || report.home.id === this.homeId()));
  readonly eventReports = computed(() => this.reportService.getEventReports(this.category(), this.eventId())
    .filter(item => !this.eventStatus() || item.event.status === this.eventStatus()));
  readonly participantReports = computed(() => this.reportService.getParticipantReports(this.homeId(), this.eventId(), this.participantSearch()));

  /**
   * True once the backend has answered the registration read for every event in
   * scope. An event catalogue that loaded but is empty counts as ready: with no
   * events there can be no registrations, so zero is a truthful figure.
   */
  readonly registrationsReady = computed(() => {
    if (!this.shelterData.eventsLoaded()) {
      return false;
    }

    const events = this.events();

    if (events.length === 0) {
      return true;
    }

    const loaded = new Set(this.loadedRegistrationEvents());
    return events.every(event => loaded.has(event.id));
  });

  ngOnInit(): void {
    this.reload();
  }

  /** Re-reads backend homes, participants, events and registrations. Reports stay read-only. */
  reload(): void {
    void this.reportService.load().then(() => this.loadRegistrations());
  }

  /**
   * Reads the registrations of every event in scope from the backend.
   *
   * `ReportService` only reads the shared store, so this request is what makes
   * the registration figures meaningful. Events already read are skipped, so a
   * reload does not re-request them.
   */
  async loadRegistrations(): Promise<void> {
    const alreadyRead = new Set(this.loadedRegistrationEvents());
    const pending = this.events()
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

  /**
   * Registration-derived figure.
   *
   * Rendered as "Not loaded" while the read is pending or has failed, so a
   * figure the backend never confirmed is never shown as a count of zero.
   */
  registrationFigure(value: number): string {
    return this.registrationsReady() ? String(value) : 'Not loaded';
  }

  /** Caption that explains a withheld registration figure. */
  registrationsNote(): string {
    if (this.registrationsReady()) {
      return 'Counted from backend registrations';
    }

    return this.registrationsLoading()
      ? 'Registrations are being read…'
      : 'Registrations have not been loaded yet';
  }

  setTab(tab: ReportTab): void { this.tab.set(tab); }
  setCategory(category: EventCategory | ''): void { this.category.set(category); this.clearEventIfFilteredOut(); }
  setEvent(eventId: string): void { this.eventId.set(eventId); }
  setHome(homeId: string): void { this.homeId.set(homeId); }
  setEventStatus(status: EventStatus | ''): void { this.eventStatus.set(status); }
  setParticipantSearch(value: string): void { this.participantSearch.set(value); }

  /** Resolves a shelter home id to its display name. Ids are never rendered. */
  getHomeName(homeId: string): string { return this.reportService.getHomeName(homeId); }

  /** Resolves a shelter home id to its home code. Ids are never rendered. */
  getHomeCode(homeId: string): string { return this.reportService.getHomeCode(homeId); }

  private clearEventIfFilteredOut(): void {
    if (this.eventId() && !this.events().some(event => event.id === this.eventId() && (!this.category() || event.category === this.category()))) {
      this.eventId.set('');
    }
  }
}