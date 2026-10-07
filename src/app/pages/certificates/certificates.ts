import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Certificate, Event, Participant, Score, Team } from '../../core/models';
import { CertificateService } from '../../core/services/certificates/certificate.service';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ScoreLoadState, ScoringService } from '../../core/services/scoring/scoring.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import { TeamLoadState, TeamService } from '../../core/services/teams/team.service';

interface CertificateCandidate {
  score: Score;
  participant?: Participant;
  team?: Team;
  certificate?: Certificate;
}

/**
 * Read-only review of finalized-score entries and their certificate status.
 *
 * Candidates come exclusively from `status === 'FINALIZED'` scores, so a draft
 * score can never reach this page. Generation stays unavailable: eligibility
 * rules and a template are not configured, so the generate control remains
 * disabled and no certificate wording or eligibility is inferred here. Backend
 * ids are always resolved to readable home names, codes and entry references.
 */
@Component({
  selector: 'nk-certificates',
  imports: [DatePipe, FormsModule],
  templateUrl: './certificates.html',
  styleUrl: './certificates.scss',
})
export class Certificates implements OnInit {
  private readonly eventService = inject(EventService);
  private readonly scoringService = inject(ScoringService);
  private readonly certificateService = inject(CertificateService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);
  private readonly shelterHomeService = inject(ShelterHomeService);
  private readonly shelterData = inject(ShelterDataService);

  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly search = signal('');
  readonly errors = signal<string[]>([]);
  readonly message = signal('');
  readonly workflowConfigured = this.certificateService.workflowConfigured;
  /** True while the shared backend store is filling. */
  readonly loading = this.shelterData.loading;
  /** True while the backend event catalogue is being read. */
  readonly eventsLoading = this.eventService.loading;
  readonly loadError = this.shelterData.homesError;
  readonly eventsError = this.eventService.loadError;
  readonly selectedEvent = computed(() => this.selectedEventId()
    ? this.eventService.getById(this.selectedEventId())
    : undefined);

  /** Ensures backend homes, participants and events are available on direct navigation. */
  ngOnInit(): void {
    void this.shelterData.refresh();

    const preselected = this.selectedEventId();
    if (preselected) {
      void this.loadEvent(preselected);
    }
  }

  /** Human-readable shelter home name; internal ids are never rendered. */
  homeName(homeId: string | null | undefined): string {
    return homeId
      ? this.shelterHomeService.getHomeById(homeId)?.name ?? 'Unknown Home'
      : 'Unavailable';
  }

  homeCode(homeId: string | null | undefined): string {
    return homeId
      ? this.shelterHomeService.getHomeById(homeId)?.homeCode ?? '—'
      : '—';
  }

  /** Readable entry label; never falls back to an internal id. */
  entryName(candidate: CertificateCandidate): string {
    return candidate.participant?.fullName
      ?? candidate.team?.name
      ?? 'Unavailable entry';
  }

  entryReference(candidate: CertificateCandidate): string {
    return candidate.participant?.participantCode
      ?? candidate.team?.teamCode
      ?? 'No reference available';
  }

  /**
   * Finalized-score entries for the selected event.
   *
   * Filtered to `FINALIZED` before anything else: draft scores are never
   * presented, and no ordering is applied, so a score value never implies a
   * placement or an award.
   */
  readonly candidates = computed<CertificateCandidate[]>(() => {
    const event = this.selectedEvent();
    if (!event) return [];
    const query = this.search().trim().toLowerCase();
    return this.scoringService.getByEvent(event.id)
      .filter(score => score.status === 'FINALIZED')
      .map(score => ({
        score,
        participant: score.participantId
          ? this.participantService.getParticipantById(score.participantId)
          : undefined,
        team: score.teamId ? this.teamService.getById(score.teamId) : undefined,
        certificate: this.certificateService.getByScoreId(score.id),
      }))
      .filter(candidate => this.matchesSearch(candidate, query));
  });

  readonly finalizedCount = computed(() => {
    const event = this.selectedEvent();
    return event ? this.scoringService.getByEvent(event.id)
      .filter(score => score.status === 'FINALIZED').length : 0;
  });

  /** Backend read state of the selected event's scores. */
  readonly scoresState = computed<ScoreLoadState>(() => {
    const id = this.selectedEventId();
    return id ? this.scoringService.loadState(id) : { status: 'IDLE', error: '' };
  });

  /** Backend read state of the selected event's teams (used for team names). */
  readonly teamsState = computed<TeamLoadState>(() => {
    const id = this.selectedEventId();
    return id ? this.teamService.loadState(id) : { status: 'IDLE', error: '' };
  });

  /** True when team names for a group event could not be read. */
  readonly teamsFailed = computed(() =>
    this.selectedEvent()?.mode === 'GROUP' && this.teamsState().status === 'ERROR'
  );

  setEvent(eventId: string): void {
    this.selectedEventId.set(eventId);
    this.search.set('');
    this.errors.set([]);
    this.message.set('');
    void this.loadEvent(eventId);
  }

  /**
   * Reads persisted scores (and, for group events, teams so names resolve).
   *
   * Load state is held per event by the services and read through the current
   * selection, so a late response for a previous event never shows here.
   */
  async loadEvent(eventId: string): Promise<void> {
    if (!eventId) return;
    const isGroup = this.eventService.getById(eventId)?.mode === 'GROUP';
    await Promise.allSettled([
      this.scoringService.loadScores(eventId),
      isGroup ? this.teamService.loadTeams(eventId) : Promise.resolve(true),
    ]);
  }

  async retryScores(): Promise<void> {
    const id = this.selectedEventId();
    if (id) await this.scoringService.loadScores(id, true);
  }

  async retryTeams(): Promise<void> {
    const id = this.selectedEventId();
    if (id) await this.teamService.loadTeams(id, true);
  }

  setSearch(value: string): void {
    this.search.set(value);
  }

  /**
   * Writes are blocked upstream: generation is not configured, so this is
   * retained purely so the disabled control has a single, explicit entry point.
   */
  generate(candidate: CertificateCandidate): void {
    const result = this.certificateService.generate(candidate.score.id);
    this.errors.set(result.errors);
    this.message.set(result.success ? 'Certificate record generated.' : '');
  }

  eventModeLabel(event: Event): string {
    return event.mode === 'SOLO' ? 'Individual' : 'Group';
  }

  private matchesSearch(candidate: CertificateCandidate, query: string): boolean {
    if (!query) return true;
    const values = candidate.participant
      ? [
          candidate.participant.fullName,
          candidate.participant.participantCode,
          this.homeName(candidate.participant.shelterHomeId),
          this.homeCode(candidate.participant.shelterHomeId),
        ]
      : [candidate.team?.name ?? '', candidate.team?.teamCode ?? ''];
    return values.some(value => value.toLowerCase().includes(query));
  }
}
