import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { Attendance, Event, Participant, Score, Team } from '../../core/models';
import { AttendanceService } from '../../core/services/attendance/attendance.service';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import {
  ScoreLoadState,
  ScoreResult,
  ScoringService,
} from '../../core/services/scoring/scoring.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import { TeamLoadState, TeamService } from '../../core/services/teams/team.service';

/**
 * Read state of the registration request behind the scoring target list.
 *
 * The cache this state guards starts empty, so a request that has not been
 * issued, is in flight, or has failed must never be presented as "no targets".
 */
type RegistrationsState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';

/**
 * What a single button press asked the backend to do.
 *
 * Draft and finalize are two separate backend actions, so the page never sends
 * a "finalize" flag: each maps to its own service method.
 */
type ScoreAction = 'DRAFT' | 'FINALIZE';

interface ScoreTarget {
  /**
   * Stable identity used for `@for` tracking and for the per-target in-flight
   * guard. Event-scoped so switching events cannot collide two busy targets.
   */
  key: string;
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
 * every write to the service, which re-validates the target and persists
 * through the backend. Attendance is displayed as context only and is never a
 * precondition for scoring.
 *
 * Every write is awaited: a draft uses `save*Score`, a finalization uses
 * `finalize*Score`, and both report their outcome as a compact toast rather
 * than by replacing page content. A rejected write leaves the typed value in
 * place so nothing a judge entered is lost.
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
  private readonly route = inject(ActivatedRoute);
  private readonly notify = inject(NotificationService);

  /** True while the shared backend store is filling on direct navigation. */
  readonly loading = this.shelterData.loading;
  /** True while the backend event catalogue is being read. */
  readonly eventsLoading = this.eventService.loading;
  readonly loadError = this.shelterData.homesError;
  readonly eventsError = this.eventService.loadError;

  /**
   * Ensures backend homes, participants and events are available on direct
   * navigation, and reads the event data if an event is already selected.
   */
  ngOnInit(): void {
    void this.shelterData.ensureLoaded();

    // Deep link from the Events page: /scoring?eventId=...
    const deepLinked = this.route.snapshot.queryParamMap.get('eventId');
    if (deepLinked) {
      this.selectedEventId.set(deepLinked);
    }

    const preselected = this.selectedEventId();
    if (preselected) {
      void this.loadEvent(preselected);
    }
  }

  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly search = signal('');

  /**
   * Events whose scores this page has seen load successfully at least once.
   *
   * A write re-reads `listScores`, which briefly reports LOADING; for an event
   * already shown, the list stays rendered (controls disabled) instead of being
   * replaced, so values typed into other entries are not lost.
   */
  private readonly scoresSeen = signal<ReadonlySet<string>>(new Set<string>());

  /** Backend read state of the selected event's scores. */
  readonly scoresState = computed<ScoreLoadState>(() => {
    const id = this.selectedEventId();
    return id ? this.scoringService.loadState(id) : { status: 'IDLE', error: '' };
  });

  /** Backend read state of the selected event's teams (group events only). */
  readonly teamsState = computed<TeamLoadState>(() => {
    const id = this.selectedEventId();
    return id ? this.teamService.loadState(id) : { status: 'IDLE', error: '' };
  });

  /**
   * True when persisted scores for the selected event are known.
   *
   * Entry is blocked otherwise, so a judge can never overwrite a persisted
   * score that failed to load and is therefore invisible here.
   */
  readonly scoresReady = computed(() => {
    const id = this.selectedEventId();
    const status = this.scoresState().status;
    return status === 'LOADED' || (status === 'LOADING' && this.scoresSeen().has(id));
  });

  /** True while a re-read of already-shown scores is open. */
  readonly scoresRefreshing = computed(() =>
    this.scoresState().status === 'LOADING' && this.scoresSeen().has(this.selectedEventId())
  );

  /** True when the selected event needs teams and they are not yet usable. */
  readonly teamsPending = computed(() => {
    const event = this.selectedEvent();
    if (!event || event.mode !== 'GROUP') return false;
    const status = this.teamsState().status;
    return status === 'IDLE' || status === 'LOADING';
  });

  readonly teamsFailed = computed(() => {
    const event = this.selectedEvent();
    return !!event && event.mode === 'GROUP' && this.teamsState().status === 'ERROR';
  });

  /** Read state of the registrations for the currently selected event. */
  readonly registrationsState = signal<RegistrationsState>('IDLE');
  readonly registrationError = signal('');

  /** Keys of targets with a write in flight; a second click is ignored. */
  private readonly busyTargets = signal<ReadonlySet<string>>(new Set<string>());

  readonly selectedEvent = computed(() => this.selectedEventId() ? this.eventService.getById(this.selectedEventId()) : undefined);

  /** True only while a registration request for the selected event is open. */
  readonly targetsLoading = computed(() => this.registrationsState() === 'LOADING');

  /** True when the registrations for the selected event could not be read. */
  readonly registrationsFailed = computed(() => this.registrationsState() === 'FAILED');

  /**
   * Registrations the backend returned for the selected event.
   *
   * Kept separate from `targets` so an empty list can distinguish "the backend
   * holds no registrations" from "registrations exist but none are scorable".
   */
  readonly registeredRegistrations = computed(() => {
    const event = this.selectedEvent();
    if (!event) return [];
    return this.registrationService.getEventRegistrations(event.id)
      .filter(item => item.registrationStatus === 'REGISTERED');
  });

  /** Teams held locally for the selected event. */
  readonly eventTeams = computed(() => {
    const event = this.selectedEvent();
    return event ? this.teamService.getTeamsByEvent(event.id) : [];
  });

  /**
   * Entries a judge may score for the selected event.
   *
   * Individual events resolve to registered and eligible participants; group
   * events resolve to teams that pass `TeamService.validateTeam()`, which itself
   * requires every member to be registered. Attendance never removes a target.
   */
  readonly targets = computed<ScoreTarget[]>(() => {
    const event = this.selectedEvent();
    const query = this.search().trim().toLowerCase();
    if (!event) return [];

    if (event.mode === 'SOLO') {
      return this.registeredRegistrations()
        .map(item => this.participantService.getParticipantById(item.participantId))
        .filter((participant): participant is Participant => !!participant)
        .filter(participant => this.isValidParticipant(event, participant))
        .filter(participant => !query || participant.fullName.toLowerCase().includes(query) || participant.participantCode.toLowerCase().includes(query) || this.homeName(participant.shelterHomeId).toLowerCase().includes(query) || this.homeCode(participant.shelterHomeId).toLowerCase().includes(query))
        .map(participant => ({
          key: `${event.id}:P:${participant.id}`,
          participant,
          reference: participant.participantCode,
          homeLabel: this.homeName(participant.shelterHomeId),
          score: this.scoringService.getParticipantScore(event.id, participant.id),
          attendance: this.attendanceService.getByParticipantEvent(participant.id, event.id),
        }));
    }

    return this.eventTeams()
      .filter(team => this.teamService.validateTeam(team.id).valid)
      .filter(team => !query || team.name.toLowerCase().includes(query) || team.teamCode.toLowerCase().includes(query))
      .map(team => ({
        key: `${event.id}:T:${team.id}`,
        team,
        reference: team.teamCode,
        homeLabel: '',
        score: this.scoringService.getTeamScore(event.id, team.id),
      }));
  });

  /**
   * Honest empty-list copy.
   *
   * Only ever rendered when the registrations genuinely loaded; a failed read
   * keeps its own error state, and an active search is never described as an
   * event that has no registrations.
   */
  readonly emptyState = computed<string>(() => {
    if (this.registrationsState() !== 'LOADED') return '';

    const query = this.search().trim();
    if (query) return `No entries match "${query}".`;

    const event = this.selectedEvent();
    if (!event) return '';

    if (event.mode === 'SOLO') {
      return this.registeredRegistrations().length
        ? 'No registered, eligible participants were returned for this event.'
        : 'No participants registered for this event.';
    }

    return this.eventTeams().length
      ? 'No registered, eligible teams were returned for this event.'
      : 'No teams are available to score for this event.';
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

  /**
   * Reads everything the selected event needs, in parallel: registrations,
   * persisted scores and, for group events, persisted teams.
   *
   * Score and team load state is held per event by the services and read here
   * through the current selection, so a response for an event the user has
   * already left can never be shown against the new one.
   */
  async loadEvent(eventId: string): Promise<void> {
    if (!eventId) {
      await this.loadRegistrations(eventId);
      return;
    }

    // A cold deep link can arrive before the event catalogue has loaded; the
    // group check below must not silently miss the event and skip its teams.
    if (!this.eventService.loaded()) {
      await this.eventService.load();
    }

    const isGroup = this.eventService.getById(eventId)?.mode === 'GROUP';

    await Promise.allSettled([
      this.loadRegistrations(eventId),
      this.loadScores(eventId, false),
      isGroup ? this.teamService.loadTeams(eventId) : Promise.resolve(true),
    ]);
  }

  /** Re-reads the selected event's scores after a failed read. */
  async retryScores(): Promise<void> {
    const id = this.selectedEventId();
    if (id) await this.loadScores(id, true);
  }

  /** Re-reads the selected event's teams after a failed read. */
  async retryTeams(): Promise<void> {
    const id = this.selectedEventId();
    if (id) await this.teamService.loadTeams(id, true);
  }

  /** Re-reads the selected event's registrations after a failed read. */
  async retryRegistrations(): Promise<void> {
    const id = this.selectedEventId();
    if (id) await this.loadRegistrations(id);
  }

  private async loadScores(eventId: string, force: boolean): Promise<void> {
    const loaded = await this.scoringService.loadScores(eventId, force);
    if (loaded) this.markScoresSeen(eventId);
  }

  private markScoresSeen(eventId: string): void {
    if (this.scoresSeen().has(eventId)) return;
    this.scoresSeen.update(current => new Set(current).add(eventId));
  }

  setEvent(id: string): void {
    this.selectedEventId.set(id);
    void this.loadEvent(id);
  }

  setSearch(value: string): void {
    this.search.set(value);
  }

  /** Persists a draft. The backend keeps the score editable. */
  async saveDraft(event: Event, target: ScoreTarget, rawValue: string): Promise<void> {
    await this.submit(event, target, rawValue, 'DRAFT');
  }

  /** Finalizes a score. The backend locks it against any further edit. */
  async finalize(event: Event, target: ScoreTarget, rawValue: string): Promise<void> {
    await this.submit(event, target, rawValue, 'FINALIZE');
  }

  /** True while this target has an open write; used to disable its controls. */
  isBusy(target: ScoreTarget): boolean {
    return this.busyTargets().has(target.key);
  }

  /**
   * True when this target's controls must not accept input: a write is open
   * for it, or the persisted scores are not confirmed current.
   */
  isLocked(target: ScoreTarget): boolean {
    return this.isBusy(target) || this.scoresState().status !== 'LOADED';
  }

  /** Status and version line for a persisted score, e.g. "DRAFT · v3". */
  scoreStatusLabel(score: Score): string {
    return `${score.status} · v${score.version}`;
  }

  /** A finalized score is immutable and is rendered read-only. */
  isFinalized(target: ScoreTarget): boolean {
    return target.score?.status === 'FINALIZED';
  }

  modeLabel(event: Event): string {
    return event.mode === 'SOLO' ? 'Individual' : 'Group';
  }

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

  /**
   * One write: guard, delegate, report.
   *
   * Draft and finalize differ only in the service method used; everything
   * around them — input validation, the in-flight guard, and the outcome report
   * — is shared so neither path can double-submit or silently claim success.
   */
  private async submit(
    event: Event,
    target: ScoreTarget,
    rawValue: string,
    action: ScoreAction
  ): Promise<void> {
    // Belt-and-braces: the UI never renders controls for a finalized score.
    if (this.isFinalized(target)) {
      this.notify.warning(
        'Score is already final.',
        `${this.targetName(target)} was finalized and cannot be changed.`
      );
      return;
    }

    // A second click while the first request is open must not submit again.
    if (this.isBusy(target)) return;

    // Never write over a persisted score this page could not read.
    if (this.scoresState().status !== 'LOADED' || this.selectedEventId() !== event.id) {
      this.notify.warning(
        'Scores are not loaded.',
        `Wait for the persisted scores to load before scoring ${this.targetName(target)}.`
      );
      return;
    }

    const entered = rawValue.trim();
    if (!entered) {
      this.notify.error(
        action === 'FINALIZE' ? 'Enter a score before finalizing.' : 'Enter a score before saving.',
        `${this.targetName(target)} is unchanged.`
      );
      return;
    }

    const value = Number(entered);
    if (!Number.isFinite(value)) {
      this.notify.error(
        'Enter a valid numeric score.',
        `"${entered}" is not a number, so nothing was written for ${this.targetName(target)}.`
      );
      return;
    }

    const participantId = target.participant?.id ?? '';
    const teamId = target.team?.id ?? '';

    if (!participantId && !teamId) {
      this.notify.error('This entry cannot be scored.', 'No participant or team is attached to it.');
      return;
    }

    this.setBusy(target.key, true);

    try {
      let result: ScoreResult;

      if (participantId) {
        result = action === 'FINALIZE'
          ? await this.scoringService.finalizeParticipantScore(event.id, participantId, value)
          : await this.scoringService.saveParticipantScore(event.id, participantId, value);
      } else {
        result = action === 'FINALIZE'
          ? await this.scoringService.finalizeTeamScore(event.id, teamId, value)
          : await this.scoringService.saveTeamScore(event.id, teamId, value);
      }

      this.report(result, action, target);
    } catch {
      this.notify.error(
        action === 'FINALIZE' ? 'Score could not be finalized.' : 'Score could not be saved.',
        `${this.targetName(target)} is unchanged. Please try again.`
      );
    } finally {
      this.setBusy(target.key, false);
    }
  }

  /**
   * Reports one backend outcome without replacing page content.
   *
   * A rejected write only raises a toast, which leaves the typed value in the
   * input for the judge to correct. A successful write refreshes the cached
   * score, so the audit line renders the version the backend returned.
   *
   * The Google Sheet is only mentioned when the backend said something about
   * it; an absent `sourceWriteBack` makes no claim either way.
   */
  private report(result: ScoreResult, action: ScoreAction, target: ScoreTarget): void {
    const name = this.targetName(target);
    const headline = action === 'FINALIZE' ? 'Score finalized.' : 'Draft saved.';

    if (!result.success) {
      if (result.errorCode === 'SCORE_FINALIZED') {
        this.notify.warning('Score is already final.', `${name} was finalized and cannot be changed.`);
        return;
      }

      if (result.errorCode === 'VERSION_CONFLICT') {
        // Another judge saved this score first: nothing was overwritten, but
        // the conflict must be explicit so the judge re-reads before retyping.
        // The persisted scores are re-read immediately so the retry uses the
        // version the backend actually has.
        const eventId = this.selectedEventId();

        if (eventId) {
          void this.loadScores(eventId, true);
        }

        this.notify.warning(
          'Score could not be saved.',
          `This score was updated elsewhere. Refresh and try again. ${name} is unchanged.`
        );
        return;
      }

      this.notify.error(
        action === 'FINALIZE' ? 'Score could not be finalized.' : 'Score could not be saved.',
        `${result.errors.join(' ') || 'The backend did not accept the score.'} ${name} is unchanged.`
      );
      return;
    }

    const writeBack = result.sourceWriteBack;

    if (!writeBack) {
      this.notify.success(headline);
      return;
    }

    if (writeBack.status === 'UPDATED') {
      this.notify.success(headline, 'Google Sheet updated.');
      return;
    }

    if (writeBack.status === 'SKIPPED') {
      this.notify.success(headline, 'Updated in Nakshatra; the Google Sheet was not changed.');
      return;
    }

    this.notify.warning(
      headline,
      writeBack.message
        || (writeBack.status === 'FAILED'
          ? 'Updated in Nakshatra; the Google Sheet could not be updated.'
          : 'Updated in Nakshatra; the Google Sheet could not be verified.')
    );
  }

  private setBusy(key: string, busy: boolean): void {
    this.busyTargets.update(current => {
      const next = new Set(current);
      if (busy) next.add(key); else next.delete(key);
      return next;
    });
  }

  private isValidParticipant(event: Event, participant: Participant): boolean {
    return participant.eligibilityStatus === 'ELIGIBLE'
      && participant.validationStatus !== 'FAILED'
      && (!participant.level || event.eligibleLevels.includes(participant.level));
  }
}
