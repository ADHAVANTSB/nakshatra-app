import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Attendance, Event, Participant, Score, Team } from '../../core/models';
import { AttendanceService } from '../../core/services/attendance/attendance.service';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ScoringService } from '../../core/services/scoring/scoring.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import { TeamService } from '../../core/services/teams/team.service';

/**
 * Read state of the registration request behind the scoring target list.
 *
 * The cache this state guards starts empty, so a request that has not been
 * issued, is in flight, or has failed must never be presented as "no targets".
 */
type RegistrationsState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';

interface ScoreTarget {
  participant?: Participant;
  team?: Team;
  attendance?: Attendance;
  score?: Score;
  /** Readable reference for the entry; never a raw backend id. */
  reference: string;
  /** Shelter home name for participant entries, empty for team entries. */
  homeLabel: string;
}

/**
 * Judge score entry for one event.
 *
 * The draft → finalize → locked lifecycle lives entirely in `ScoringService`;
 * this page only decides which registered entries may be scored and delegates
 * every write to the service, which re-validates the target. Attendance is
 * displayed as context only and is never a precondition for scoring.
 *
 * Scorable entries are derived from the registrations the backend holds for the
 * selected event, so those are read on selection: the synchronous
 * `getEventRegistrations()` read only reflects what that request cached.
 */
@Component({
  selector: 'nk-scoring',
  imports: [FormsModule],
  templateUrl: './scoring.html',
  styleUrl: './scoring.scss',
})
export class Scoring implements OnInit {
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly scoringService = inject(ScoringService);
  private readonly shelterHomeService = inject(ShelterHomeService);
  private readonly shelterData = inject(ShelterDataService);

  /** True while the shared backend store is filling on direct navigation. */
  readonly loading = this.shelterData.loading;
  /** True while the backend event catalogue is being read. */
  readonly eventsLoading = this.eventService.loading;
  readonly loadError = this.shelterData.homesError;
  readonly eventsError = this.eventService.loadError;

  /** Ensures backend homes, participants and events are available on direct navigation. */
  ngOnInit(): void {
    void this.shelterData.refresh();
  }

  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly search = signal('');
  readonly errors = signal<string[]>([]);
  readonly message = signal('');

  /** Read state of the registrations for the currently selected event. */
  readonly registrationsState = signal<RegistrationsState>('IDLE');
  readonly registrationError = signal('');

  readonly selectedEvent = computed(() => this.selectedEventId() ? this.eventService.getById(this.selectedEventId()) : undefined);

  /** True only while a registration request for the selected event is open. */
  readonly targetsLoading = computed(() => this.registrationsState() === 'LOADING');

  /**
   * Entries a judge may score for the selected event.
   *
   * Individual events resolve to registered and eligible participants; group
   * events resolve to teams that pass `TeamService.validateTeam()`, which itself
   * requires every member to be registered. Attendance never removes a target.
   */
  readonly targets = computed<ScoreTarget[]>(() => {
    const event = this.selectedEvent(); const query = this.search().toLowerCase();
    if (!event) return [];
    if (event.mode === 'SOLO') return this.registrationService.getEventRegistrations(event.id)
      .filter(item => item.registrationStatus === 'REGISTERED')
      .map(item => this.participantService.getParticipantById(item.participantId))
      .filter((participant): participant is Participant => !!participant)
      .filter(participant => this.isValidParticipant(event, participant))
      .filter(participant => !query || participant.fullName.toLowerCase().includes(query) || participant.participantCode.toLowerCase().includes(query) || this.homeName(participant.shelterHomeId).toLowerCase().includes(query) || this.homeCode(participant.shelterHomeId).toLowerCase().includes(query))
      .map(participant => ({ participant, reference: participant.participantCode, homeLabel: this.homeName(participant.shelterHomeId), score: this.scoringService.getParticipantScore(event.id, participant.id), attendance: this.attendanceService.getByParticipantEvent(participant.id, event.id) }));
    return this.teamService.getTeamsByEvent(event.id)
      .filter(team => this.teamService.validateTeam(team.id).valid)
      .filter(team => !query || team.name.toLowerCase().includes(query) || team.teamCode.toLowerCase().includes(query))
      .map(team => ({ team, reference: team.teamCode, homeLabel: '', score: this.scoringService.getTeamScore(event.id, team.id) }));
  });

  /**
   * Reads the registrations for one event from the backend.
   *
   * Group events depend on this too, because team validity is evaluated against
   * the same registration cache.
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

  setEvent(id: string): void {
    this.selectedEventId.set(id);
    this.errors.set([]);
    this.message.set('');
    void this.loadRegistrations(id);
  }

  setSearch(value: string): void { this.search.set(value); }

  save(event: Event, target: { participant?: Participant; team?: Team }, rawValue: string, finalize: boolean): void {
    const value = Number(rawValue);
    const result = target.participant
      ? this.scoringService.saveParticipantScore(event.id, target.participant.id, value, finalize)
      : this.scoringService.saveTeamScore(event.id, target.team!.id, value, finalize);
    this.errors.set(result.errors); this.message.set(result.success ? `Score ${finalize ? 'finalized' : 'saved'}.` : '');
  }

  modeLabel(event: Event): string { return event.mode === 'SOLO' ? 'Individual' : 'Group'; }

  /** Display name for a scoring target, falling back to a readable label. */
  targetName(target: ScoreTarget): string {
    return target.participant?.fullName ?? target.team?.name ?? 'Unnamed entry';
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

  private isValidParticipant(event: Event, participant: Participant): boolean {
    return participant.eligibilityStatus === 'ELIGIBLE' &&
      participant.validationStatus !== 'FAILED' &&
      (!participant.level || event.eligibleLevels.includes(participant.level));
  }
}