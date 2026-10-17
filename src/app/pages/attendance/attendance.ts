import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Attendance as AttendanceRecord, AttendanceStatus, Event, Participant, Team } from '../../core/models';
import { AttendanceService } from '../../core/services/attendance/attendance.service';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import { TeamService } from '../../core/services/teams/team.service';

/**
 * Read state of the registration request behind the attendee list.
 *
 * This state exists because the registration cache starts empty. Without it a
 * request that is still in flight, or one that failed, would be
 * indistinguishable from an event that genuinely has no registrations.
 */
type RegistrationsState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';

/** One registered participant resolved into a renderable attendance row. */
interface Attendee {
  readonly participant: Participant;
  readonly homeName: string;
  readonly homeCode: string;
  readonly team: Team | undefined;
  readonly attendance: AttendanceRecord | undefined;
}

/**
 * Attendance capture for one event.
 *
 * The only attendance targets are the registrations that the backend holds for
 * the selected event, so an unregistered participant can never be marked. Those
 * registrations are read on demand: `getEventRegistrations()` is a synchronous
 * read of a cache that only the request fills, so a pending, failed or never
 * issued read is reported as such instead of as a count of zero. Backend
 * `shelterHomeId` values are resolved to the human-readable home name and code
 * for display; internal ids are never rendered.
 */
@Component({
  selector: 'nk-attendance',
  imports: [ViewOnlyBannerComponent, FormsModule],
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss',
})
export class Attendance implements OnInit {
  private readonly attendanceService = inject(AttendanceService);
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly shelterData = inject(ShelterDataService);
  /** Re-runs the full store load after a failed page load (Retry button). */
  async retryStoreLoad(): Promise<void> {
    await this.shelterData.refresh();
  }

  /** Re-reads the event master after a failed load (Retry button). */
  async retryEventsLoad(): Promise<void> {
    await this.eventService.load();
  }
  private readonly shelterHomeService = inject(ShelterHomeService);
  private readonly teamService = inject(TeamService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);

  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly errors = signal<string[]>([]);

  /** True while the shared backend store is filling on direct navigation. */
  readonly loading = this.shelterData.loading;
  /** True while the backend event catalogue is being read. */
  readonly eventsLoading = this.eventService.loading;
  readonly loadError = this.shelterData.homesError;
  readonly eventsError = this.eventService.loadError;

  /** Read state of the registrations for the currently selected event. */
  readonly registrationsState = signal<RegistrationsState>('IDLE');
  readonly registrationError = signal('');

  /**
   * Read state of the persisted attendance for the selected event. A failed
   * read is reported explicitly: rows would otherwise all show "Not marked",
   * which reads as "nothing was ever saved".
   */
  readonly attendanceState = signal<RegistrationsState>('IDLE');
  readonly attendanceError = signal('');

  /** Ensures backend homes, participants and events are available on direct navigation. */
  ngOnInit(): void {
    void this.shelterData.ensureLoaded();

    // Deep link from the Events page: /attendance?eventId=...
    const deepLinked = this.route.snapshot.queryParamMap.get('eventId');
    if (deepLinked) {
      this.setEvent(deepLinked);
    }
  }

  readonly selectedEvent = computed(() => this.selectedEventId()
    ? this.eventService.getById(this.selectedEventId())
    : undefined);

  /** True only while a registration request for the selected event is open. */
  readonly attendeesLoading = computed(() => this.registrationsState() === 'LOADING');

  /**
   * Registered participants of the selected event.
   *
   * Derived exclusively from the registrations the backend returned for this
   * event: a participant who is not registered can never become an attendance
   * target here, and a cancelled registration is no longer an active target.
   */
  readonly attendees = computed<Attendee[]>(() => {
    const event = this.selectedEvent();
    if (!event) return [];

    return this.registrationService.getEventRegistrations(event.id)
      .filter(registration => registration.registrationStatus === 'REGISTERED')
      .map(registration => {
        const participant = this.participantService.getParticipantById(registration.participantId);
        return participant ? {
          participant,
          homeName: this.homeName(participant.shelterHomeId),
          homeCode: this.homeCode(participant.shelterHomeId),
          team: event.mode === 'GROUP'
            ? this.teamService.getParticipantTeam(participant.id, event.id)
            : undefined,
          attendance: this.attendanceService.getByParticipantEvent(participant.id, event.id)
        } : undefined;
      })
      .filter((item): item is Attendee => !!item);
  });

  /**
   * Active registrations the backend returned for the selected event, whether or
   * not their participant record could be resolved. Used to avoid reporting
   * "no participants registered" when only the participant records are missing.
   */
  readonly activeRegistrationCount = computed(() => {
    const event = this.selectedEvent();
    if (!event) return 0;
    return this.registrationService.getEventRegistrations(event.id)
      .filter(registration => registration.registrationStatus === 'REGISTERED').length;
  });

  readonly presentCount = computed(() => this.attendees()
    .filter(item => item.attendance?.status === 'PRESENT').length);
  readonly absentCount = computed(() => this.attendees()
    .filter(item => item.attendance?.status === 'ABSENT').length);

  /**
   * Registration-derived figures.
   *
   * While the read is pending or failed these render as an em dash, because a
   * `0` would claim the backend confirmed there are no registrations.
   */
  readonly registeredFigure = computed(() =>
    this.registrationsState() === 'LOADED' ? String(this.attendees().length) : '—');
  readonly presentFigure = computed(() =>
    this.registrationsState() === 'LOADED' ? String(this.presentCount()) : '—');
  readonly absentFigure = computed(() =>
    this.registrationsState() === 'LOADED' ? String(this.absentCount()) : '—');

  /**
   * Reads the registrations for one event from the backend.
   *
   * This must run whenever the selection changes; the synchronous
   * `getEventRegistrations()` read below only reflects whatever this request
   * put in the cache.
   */
  async loadRegistrations(eventId: string): Promise<void> {
    if (!eventId) {
      this.registrationsState.set('IDLE');
      this.registrationError.set('');
      return;
    }

    this.registrationsState.set('LOADING');
    this.registrationError.set('');

    const result = await this.registrationService.loadEventRegistrations(eventId);

    // A newer selection may have replaced this one while the request was open.
    if (this.selectedEventId() !== eventId) {
      return;
    }

    if (result === null) {
      this.registrationError.set(
        this.shelterData.registrationError(eventId)
          || 'Registrations could not be read from the backend.'
      );
      this.registrationsState.set('FAILED');
      return;
    }

    this.registrationsState.set('LOADED');
  }

  setEvent(eventId: string): Promise<void> {
    this.selectedEventId.set(eventId);
    this.errors.set([]);
    this.attendanceError.set('');
    this.attendanceState.set('IDLE');
    return this.loadEventData(eventId);
  }

  /** Re-issues the registration (and, for group events, team) reads after a failure. */
  retryRegistrations(): void {
    const eventId = this.selectedEventId();
    if (!eventId || this.attendeesLoading()) return;
    void this.loadEventData(eventId, true);
  }

  /**
   * Reads everything the attendee table needs for one event: its registrations
   * and, for group events, its persisted teams so the Team column is real.
   * The persisted attendance for the event is read alongside them, so saved
   * Present/Absent values display on load.
   */
  private async loadEventData(eventId: string, forceTeams = false): Promise<void> {
    // A cold deep link can arrive before the catalogue has loaded; the group
    // check must not silently miss the event and skip its team read.
    if (!this.eventService.loaded()) {
      await this.eventService.load();
    }

    const event = eventId ? this.eventService.getById(eventId) : undefined;

    await Promise.all([
      this.loadRegistrations(eventId),
      event?.mode === 'GROUP' ? this.teamService.loadTeams(event.id, forceTeams) : Promise.resolve(true),
      this.loadEventAttendanceState(eventId, forceTeams),
    ]);
  }

  private async loadEventAttendanceState(eventId: string, force = false): Promise<void> {
    if (!eventId) return;

    this.attendanceState.set('LOADING');
    this.attendanceError.set('');

    const ok = await this.attendanceService.loadEventAttendance(eventId, force);

    // A newer selection may have replaced this one while the request was open.
    if (this.selectedEventId() !== eventId) return;

    if (!ok) {
      this.attendanceError.set(
        'Saved attendance could not be read. Existing marks may be hidden — use Retry to read them again.'
      );
      this.attendanceState.set('FAILED');
      return;
    }

    this.attendanceState.set('LOADED');
  }

  /** Team read state for the selected group event. */
  readonly teamsState = computed(() => {
    const event = this.selectedEvent();
    return event?.mode === 'GROUP' ? this.teamService.loadState(event.id) : undefined;
  });

  /** Team cell text; a failed or pending team read is never shown as "no team". */
  teamLabel(item: Attendee): string {
    const state = this.teamsState();
    if (item.team) return item.team.name;
    if (!state || state.status === 'LOADING' || state.status === 'IDLE') return 'Loading teams…';
    if (state.status === 'ERROR') return 'Team unavailable';
    return 'No team assigned';
  }

  /** Exactly one of: Not marked / Present / Absent (pending choice wins). */
  statusLabel(attendance: AttendanceRecord | AttendanceStatus | undefined): string {
    const status = typeof attendance === 'string'
      ? attendance
      : attendance?.status;
    if (status === 'PRESENT') return 'Present';
    if (status === 'ABSENT') return 'Absent';
    return 'Not marked';
  }

  /** Participant ids whose attendance write is currently in flight. */
  readonly markingIds = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * Unsaved Present/Absent choices, staged separately from the persisted
   * values until Save Attendance commits them. Reset Changes discards them.
   */
  readonly pendingChanges = signal<Record<string, { status: AttendanceStatus; teamId?: string; participantName: string }>>({});

  readonly hasUnsavedChanges = computed(() => Object.keys(this.pendingChanges()).length > 0);
  readonly pendingCount = computed(() => Object.keys(this.pendingChanges()).length);
  readonly savingAttendance = signal(false);

  isMarking(participantId: string): boolean {
    return this.markingIds().has(participantId);
  }

  /**
   * Effective status for one attendee row: a staged (unsaved) choice wins
   * over the persisted value until Save or Reset resolves it.
   */
  statusFor(item: { participant: Participant; attendance?: AttendanceRecord }): AttendanceStatus | undefined {
    const pending = this.pendingChanges()[item.participant.id];
    return pending ? pending.status : item.attendance?.status;
  }

  hasPendingChoice(participantId: string): boolean {
    return this.pendingChanges()[participantId] !== undefined;
  }

  /** Stages one Present/Absent choice — nothing is written to the backend yet. */
  stageAttendance(participant: Participant, status: AttendanceStatus, teamId?: string): void {
    if (!this.selectedEvent()) return;
    this.errors.set([]);
    this.pendingChanges.update(current => ({
      ...current,
      [participant.id]: { status, teamId, participantName: participant.fullName },
    }));
  }

  /** Discards every unsaved choice; the last saved state stays untouched. */
  resetChanges(): void {
    if (!this.hasUnsavedChanges()) return;
    this.pendingChanges.set({});
    this.errors.set([]);
  }

  /**
   * Commits the staged choices to the backend, one record at a time with the
   * existing per-record version checks. Failed records stay staged so the
   * coordinator can retry them without re-entering the other choices.
   */
  async saveAttendance(): Promise<void> {
    const event = this.selectedEvent();
    if (!event || this.savingAttendance()) return;

    const entries = Object.entries(this.pendingChanges());
    if (!entries.length) return;

    this.savingAttendance.set(true);
    this.errors.set([]);
    const failures: string[] = [];
    let savedCount = 0;

    try {
      for (const [participantId, change] of entries) {
        const result = await this.attendanceService.markAttendance(
          participantId, event.id, change.status, change.teamId
        );

        if (result.success) {
          savedCount++;
          this.pendingChanges.update(current => {
            const next = { ...current };
            delete next[participantId];
            return next;
          });
          continue;
        }

        // Every attempted record leaves the staged state — succeeded records
        // are persisted, failed records are reported and the row returns to
        // its persisted value ('Not marked' included).
        this.pendingChanges.update(current => {
          const next = { ...current };
          delete next[participantId];
          return next;
        });

        if (result.errorCode === 'VERSION_CONFLICT') {
          // The latest persisted values have been reloaded by the service;
          // surface the conflict without asking the user to refresh.
          failures.push('Attendance was updated elsewhere. The latest saved values have been reloaded.');
          continue;
        }

        failures.push(`Attendance for ${change.participantName} was not saved. ${
          result.errors.length > 0 ? result.errors.join(' ') : ''
        }`.trim());
      }
    } finally {
      this.savingAttendance.set(false);
    }

    if (savedCount > 0) {
      this.notifications.success(
        `Attendance saved for ${savedCount} participant${savedCount === 1 ? '' : 's'}.`,
        failures.length ? `${failures.length} record(s) could not be saved.` : undefined,
      );
    }

    if (failures.length) {
      this.errors.set(failures);
      this.notifications.error('Some attendance records were not saved.', failures[0]);
    }
  }

  private setMarking(participantId: string, active: boolean): void {
    this.markingIds.update(current => {
      const next = new Set(current);
      if (active) {
        next.add(participantId);
      } else {
        next.delete(participantId);
      }
      return next;
    });
  }

  levelLabel(participant: Participant): string {
    return participant.level?.replace('_', ' ') ?? 'No level';
  }

  eventModeLabel(event: Event): string {
    return event.mode === 'SOLO' ? 'Individual' : 'Group';
  }

  /** Resolves a backend shelter home id to its readable name. */
  homeName(homeId: string | null | undefined): string {
    if (!homeId) return 'Unknown Home';
    return this.shelterHomeService.getHomeById(homeId)?.name ?? 'Unknown Home';
  }

  /** Resolves a backend shelter home id to its short code. */
  homeCode(homeId: string | null | undefined): string {
    if (!homeId) return '—';
    return this.shelterHomeService.getHomeById(homeId)?.homeCode ?? '—';
  }
}
