import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Attendance as AttendanceRecord, AttendanceStatus, Event, Participant, Team } from '../../core/models';
import { AttendanceService } from '../../core/services/attendance/attendance.service';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
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
  imports: [FormsModule],
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss',
})
export class Attendance implements OnInit {
  private readonly attendanceService = inject(AttendanceService);
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly shelterData = inject(ShelterDataService);
  private readonly shelterHomeService = inject(ShelterHomeService);
  private readonly teamService = inject(TeamService);

  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly message = signal('');
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

  /** Ensures backend homes, participants and events are available on direct navigation. */
  ngOnInit(): void {
    void this.shelterData.refresh();
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

  setEvent(eventId: string): void {
    this.selectedEventId.set(eventId);
    this.message.set('');
    this.errors.set([]);
    void this.loadRegistrations(eventId);
  }

  markAttendance(participantId: string, status: AttendanceStatus, teamId?: string): void {
    const event = this.selectedEvent();
    if (!event) return;
    const result = this.attendanceService.markAttendance(
      participantId, event.id, status, teamId, 'ADMIN'
    );
    this.errors.set(result.errors);
    this.message.set(result.success ? `Attendance marked ${status.toLowerCase()}.` : '');
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