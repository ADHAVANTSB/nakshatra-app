import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Event, EventCategory, Participant, Score, Team } from '../../core/models';
import { canEditModule } from '../../core/permissions/role-matrix';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ScoringService } from '../../core/services/scoring/scoring.service';
import { ApiClientService } from '../../core/services/api/api-client.service';
import { AttendanceService } from '../../core/services/attendance/attendance.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ListResultRow, EventJudge, JudgeScoreRow } from '../../core/models/api.model';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import { formatScore } from '../../shared/score-format';
import { TeamLoadState, TeamService } from '../../core/services/teams/team.service';

interface ResultRow {
  score: Score;
  position: number;
  participant?: Participant;
  team?: Team;
}

export type ReviewStatus = 'UNDER_REVIEW' | 'APPROVED' | 'RETURNED';

/** One participant's registration → attendance → scoring chain for one event. */
export interface ReconciliationRow {
  participantId: string;
  name: string;
  code: string;
  home: string;
  registered: boolean;
  attended: boolean;
  scored: boolean;
  /** Explicit text naming exactly what this participant is missing. */
  statusText: string;
  /** Judge submission detail behind the scoring check ("2 of 3 submitted"). */
  judgeNote: string;
  ok: boolean;
}

/**
 * One unresolved discrepancy: one participant missing one step. The id uses
 * the backend's discrepancy-id shape (`MISSING_ATTENDANCE:<pid>`,
 * `MISSING_JUDGE_SCORE:<pid>`, …) and is what `acknowledgedDiscrepancyIds`
 * sends, so acknowledging matches what the backend checks.
 */
export interface DiscrepancyItem {
  id: string;
  participantId: string;
  name: string;
  label: string;
}

type DataState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';
type JudgeScoresState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';

/**
 * The unified Results workspace: results status, reconciliation, reviewer
 * decision (prototype screen D) and the official results in ONE page.
 *
 * Only `status === 'FINALIZED'` scores are ever shown as official; draft
 * scores are never presented as results. The reviewer sees three counts
 * (Registered / Event Attendance / Scoring Completed) and the participant-level
 * reconciliation table that proves — per participant, never in totals — what is
 * still missing, including judge submissions that are not complete. Accepting
 * with unresolved discrepancies opens a dialog that lists each one and requires
 * an explicit per-item acknowledgement; the acknowledged discrepancy ids are
 * sent with the decision. Declining requires a reviewer comment. The backend
 * remains authoritative and rejects an unacknowledged accept with
 * RECONCILIATION_INCOMPLETE. Approval and finalization stay distinct: nothing
 * here finalizes scores or issues certificates.
 */
@Component({
  selector: 'nk-results',
  imports: [ViewOnlyBannerComponent, DatePipe, FormsModule, RouterLink],
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class Results implements OnInit {
  /** Official score display rule: one decimal where necessary — "21.5", never "21.0". */
  readonly formatScore = formatScore;

  private readonly eventService = inject(EventService);
  private readonly scoringService = inject(ScoringService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);
  private readonly shelterHomeService = inject(ShelterHomeService);
  private readonly shelterData = inject(ShelterDataService);
  private readonly apiClient = inject(ApiClientService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly registrationService = inject(ParticipantEventService);
  /** Re-runs the full store load after a failed page load (Retry button). */
  async retryStoreLoad(): Promise<void> {
    await this.shelterData.refresh();
  }

  /** Re-reads the event master after a failed load (Retry button). */
  async retryEventsLoad(): Promise<void> {
    await this.eventService.load();
  }
  private readonly route = inject(ActivatedRoute);

  /** Reviewer decision is the RESULT_APPROVAL module of the approved role matrix. */
  readonly canEdit = computed(() => canEditModule(this.auth.currentUser()?.role, 'RESULT_APPROVAL'));

  /** Certificate eligibility info is shown only where the role may see it. */
  readonly canSeeCertificates = computed(() => this.auth.canAccess('CERTIFICATES'));

  /** True while the shared backend store is filling. */
  readonly loading = this.shelterData.loading;
  /** True while the backend event catalogue is being read. */
  readonly eventsLoading = this.eventService.loading;
  readonly loadError = this.shelterData.homesError;
  readonly eventsError = this.eventService.loadError;

  /** Ensures backend homes, participants and events are available on direct navigation. */
  ngOnInit(): void {
    void this.shelterData.ensureLoaded();
    void this.loadEventsWithResults();

    // Deep link from the Events page: /results?eventId=...
    const deepLinked = this.route.snapshot.queryParamMap.get('eventId');
    if (deepLinked) {
      this.selectedEventId.set(deepLinked);
    }

    const preselected = this.selectedEventId();
    if (preselected) {
      void this.loadData(preselected);
    }
  }

  /**
   * Events the backend holds finalized results for. Loaded once from the
   * scope-filtered `listResults` (finalized scores only), so the page can
   * list every event whose results are out without per-event requests.
   */
  private readonly resultEventIds = signal<ReadonlySet<string>>(new Set());

  readonly eventsWithResults = computed(() =>
    this.events().filter(event => this.resultEventIds().has(event.id)));

  /** Raw finalized result rows as returned by the backend (display-ready). */
  private readonly resultRows = signal<ListResultRow[]>([]);

  private async loadEventsWithResults(): Promise<void> {
    const response = await this.apiClient.listResults();
    if (!response.success) {
      return;
    }
    const rows = response.data.results ?? [];
    this.resultRows.set(rows);
    this.resultEventIds.set(new Set(rows.map(row => row.eventId)));
  }

  /** One ranked board per event whose results are out. */
  readonly resultBoards = computed<ResultBoard[]>(() => {
    const byEvent = new Map<string, ListResultRow[]>();
    for (const row of this.resultRows()) {
      const list = byEvent.get(row.eventId) ?? [];
      list.push(row);
      byEvent.set(row.eventId, list);
    }

    return [...byEvent.entries()].map(([eventId, rows]) => {
      const ranked = rankResultRows(rows);
      return {
        eventId,
        eventCode: ranked[0].row.eventCode,
        eventName: ranked[0].row.eventName,
        category: ranked[0].row.category,
        mode: ranked[0].row.mode,
        ranked,
      };
    });
  });

  /** Boards honour the category filter. */
  readonly visibleBoards = computed(() =>
    this.resultBoards().filter(board => !this.category() || board.category === this.category()));

  /** Display name for a board row: participant first, then team. */
  boardName(row: ListResultRow): string {
    return row.fullName || row.teamName || 'Unnamed entry';
  }

  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly category = signal<EventCategory | ''>('');
  readonly search = signal('');

  // The Event dropdown offers only events whose results are out.
  readonly filteredEvents = computed(() => this.eventsWithResults().filter(event =>
    !this.category() || event.category === this.category()
  ));

  readonly selectedEvent = computed(() => this.selectedEventId()
    ? this.eventService.getById(this.selectedEventId())
    : undefined);

  /**
   * Finalized scores for the selected event, ranked highest first.
   *
   * No weighting, no adjustments: this is a projection of the finalized score
   * records and nothing more. Draft scores never appear here.
   */
  readonly results = computed<ResultRow[]>(() => {
    const event = this.selectedEvent();
    if (!event) return [];

    // Rank the FULL finalized set first — positions must not renumber when
    // the search field filters the view (equal scores share a position:
    // 1, 2, 2, 3) — then apply the search filter.
    const ranked = this.scoringService.getByEvent(event.id)
      .filter(score => score.status === 'FINALIZED')
      .map(score => ({
        score,
        participant: score.participantId
          ? this.participantService.getParticipantById(score.participantId)
          : undefined,
        team: score.teamId ? this.teamService.getById(score.teamId) : undefined,
      }));

    const sorted = ranked.sort((a, b) =>
      (b.score?.value ?? 0) - (a.score?.value ?? 0));

    let lastValue: number | null = null;
    let lastPosition = 0;

    const query = this.search().trim().toLowerCase();

    return sorted
      .map(row => {
        const value = row.score?.value ?? 0;
        const position = lastValue !== null && value === lastValue
          ? lastPosition
          : lastPosition + 1;
        lastValue = value;
        lastPosition = position;
        return { ...row, position };
      })
      .filter(row => this.matchesSearch(row, query));
  });

  /** The first three ranked positions are the winners. */
  readonly winners = computed(() => this.results().filter(row => row.position <= 3));

  readonly finalizedCount = computed(() => {
    const event = this.selectedEvent();
    return event
      ? this.scoringService.getByEvent(event.id)
        .filter(score => score.status === 'FINALIZED').length
      : 0;
  });

  setCategory(category: EventCategory | ''): void {
    this.category.set(category);
    if (!this.filteredEvents().some(event => event.id === this.selectedEventId())) {
      this.selectedEventId.set('');
    }
  }

  /** Backend read state of the selected event's scores. */
  readonly scoresState = computed(() => {
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

  /** One event selection drives every section of the workspace. */
  setEvent(eventId: string): void {
    this.selectedEventId.set(eventId);
    this.search.set('');
    this.comments.set('');
    this.declineError.set(false);
    this.approvalError.set('');
    this.approvalVersion.set(undefined);
    this.reviewStatus.set('UNDER_REVIEW');
    this.closeAccept();
    void this.loadData(eventId);
  }

  /**
   * Reads everything the unified workspace needs: persisted scores (and, for
   * group events, teams so names resolve), attendance, registrations and the
   * judge configuration/submissions behind the reconciliation.
   */
  async loadEvent(eventId: string): Promise<void> {
    await this.loadData(eventId);
  }

  /** Re-issues the full read after a failed page load (Retry button). */
  async retryData(): Promise<void> {
    await this.loadData(this.selectedEventId());
  }

  private async loadData(eventId: string): Promise<void> {
    if (!eventId) {
      this.dataState.set('IDLE');
      return;
    }

    if (!this.eventService.loaded()) {
      await this.eventService.load();
    }

    this.dataState.set('LOADING');
    this.dataError.set('');

    const isGroup = this.eventService.getById(eventId)?.mode === 'GROUP';
    void this.attendanceService.loadEventAttendance(eventId);

    await Promise.allSettled([
      this.scoringService.loadScores(eventId),
      isGroup ? this.teamService.loadTeams(eventId) : Promise.resolve(true),
      this.loadJudges(eventId).then(() => this.loadJudgeScores(eventId)),
    ]);

    const registrations = await this.registrationService.loadEventRegistrations(eventId);
    if (this.selectedEventId() !== eventId) return;

    if (registrations === null) {
      this.dataError.set('Registrations could not be read from the backend.');
      this.dataState.set('FAILED');
      return;
    }
    this.dataState.set('LOADED');
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

  eventModeLabel(event: Event): string {
    return event.mode === 'SOLO' ? 'Individual' : 'Group';
  }

  /** Entry name; falls back to a readable label, never to a raw id. */
  entryName(row: ResultRow): string {
    return row.participant?.fullName
      ?? row.team?.name
      ?? 'Unavailable entry';
  }

  /** Entry reference code; falls back to a readable label, never to a raw id. */
  entryReference(row: ResultRow): string {
    return row.participant?.participantCode
      ?? row.team?.teamCode
      ?? 'No reference available';
  }

  /** Category / level cell of the official results table. */
  entryLevel(row: ResultRow): string {
    return row.participant?.level ?? (row.team ? 'Team' : '—');
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

  private matchesSearch(row: ResultRow, query: string): boolean {
    if (!query) return true;
    const values = row.participant
      ? [
          row.participant.fullName,
          row.participant.participantCode,
          this.homeName(row.participant.shelterHomeId),
          this.homeCode(row.participant.shelterHomeId),
        ]
      : [row.team?.name ?? '', row.team?.teamCode ?? ''];
    return values.some(value => value.toLowerCase().includes(query));
  }

  /* ------------------------------------------------------------------
     Judges and their submissions (behind the scoring reconciliation)
     ------------------------------------------------------------------ */

  readonly judgesState = signal<DataState>('IDLE');
  readonly judges = signal<EventJudge[]>([]);
  readonly judgeScoresState = signal<JudgeScoresState>('IDLE');

  /** Saved judge-score rows keyed `${judgeId}|${participantId}`. */
  private readonly judgeRows = signal<Record<string, JudgeScoreRow>>({});

  /** Active (non-REMOVED) judges; removed judges never gate reconciliation. */
  readonly activeJudges = computed(() =>
    this.judges().filter(judge => (judge.status ?? 'ACTIVE').toUpperCase() !== 'REMOVED'));

  private async loadJudges(eventId: string): Promise<void> {
    if (!eventId) {
      this.judgesState.set('IDLE');
      this.judges.set([]);
      return;
    }
    this.judgesState.set('LOADING');
    const response = await this.apiClient.listEventJudges({ eventId });
    if (this.selectedEventId() !== eventId) return;
    if (!response.success) {
      this.judgesState.set('FAILED');
      return;
    }
    this.judges.set(response.data.judges ?? []);
    this.judgesState.set('LOADED');
  }

  private async loadJudgeScores(eventId: string): Promise<void> {
    if (!eventId) {
      this.judgeScoresState.set('IDLE');
      return;
    }
    this.judgeScoresState.set('LOADING');
    const response = await this.apiClient.listJudgeScores({ eventId });
    if (this.selectedEventId() !== eventId) return;
    if (!response.success) {
      this.judgeScoresState.set('FAILED');
      return;
    }
    const rows: Record<string, JudgeScoreRow> = {};
    for (const row of response.data.scores ?? []) {
      rows[`${row.judgeId}|${row.teamId || row.participantId}`] = row;
    }
    this.judgeRows.set(rows);
    this.judgeScoresState.set('LOADED');
  }

  /** GROUP events are scored per team; SOLO events per participant. */
  private isGroupEvent(): boolean {
    return this.selectedEvent()?.mode === 'GROUP';
  }

  /**
   * Whether this judge has a SUBMITTED score for that target: a participant
   * id on individual events, a team id on group events.
   */
  judgeSubmittedFor(judgeId: string, targetId: string): boolean {
    return this.judgeRows()[`${judgeId}|${targetId}`]?.status === 'SUBMITTED';
  }

  /* ------------------------------------------------------------------
     Reconciliation (participant level — totals alone prove nothing)
     ------------------------------------------------------------------ */

  private participantRows(): Participant[] {
    const event = this.selectedEvent();
    if (!event) return [];

    const ids = new Set<string>();
    for (const registration of this.registrationService.getEventRegistrations(event.id)) {
      ids.add(registration.participantId);
    }
    for (const attendance of this.attendanceService.getByEvent(event.id)) {
      ids.add(attendance.participantId);
    }

    return [...ids]
      .map(id => this.participantService.getParticipantById(id))
      .filter((participant): participant is Participant => !!participant);
  }

  readonly rows = computed<ReconciliationRow[]>(() => {
    const event = this.selectedEvent();
    if (!event) return [];

    const activeJudges = this.activeJudges();

    return this.participantRows().map(participant => {
      const registration = this.registrationService
        .getEventRegistrations(event.id)
        .find(item => item.participantId === participant.id);
      const registered = registration?.registrationStatus === 'REGISTERED';
      const attended =
        this.attendanceService.getByParticipantEvent(participant.id, event.id)?.status === 'PRESENT';

      // A group entry is scored through its team; individuals through their own score.
      const hasScoreRow =
        !!this.scoringService.getParticipantScore(event.id, participant.id) ||
        this.teamService.getTeamsByEvent(event.id).some(team =>
          this.teamService.getMembers(team.id).some(member =>
            member.participantId === participant.id &&
            member.status !== 'REMOVED' &&
            !!this.scoringService.getTeamScore(event.id, team.id)
          )
        );

      // Scoring completeness includes judge submissions: where judges are
      // configured, every active judge must have submitted for the target —
      // the participant on individual events, the TEAM on group events (a
      // team is never "scored" because individual rows exist).
      let scored: boolean;
      let judgeNote = '';
      if (activeJudges.length) {
        if (this.isGroupEvent()) {
          const team = this.teamService.getParticipantTeam(participant.id, event.id);
          const submitted = team
            ? activeJudges.filter(judge => this.judgeSubmittedFor(judge.id, team.id)).length
            : 0;
          scored = !!team && submitted === activeJudges.length;
          judgeNote = team
            ? `${submitted} of ${activeJudges.length} judge submission(s) complete for team ${team.name}`
            : 'not on any team roster';
        } else {
          const submitted = activeJudges.filter(judge =>
            this.judgeSubmittedFor(judge.id, participant.id)).length;
          scored = submitted === activeJudges.length;
          judgeNote = `${submitted} of ${activeJudges.length} judge submission(s) complete`;
        }
      } else {
        scored = hasScoreRow;
      }

      const missing: string[] = [];
      if (!registered) missing.push('registration');
      if (!attended) missing.push('attendance');
      if (!scored) missing.push('scoring');

      return {
        participantId: participant.id,
        name: participant.fullName,
        code: participant.participantCode,
        home: this.homeName(participant.shelterHomeId),
        registered,
        attended,
        scored,
        judgeNote,
        ok: missing.length === 0,
        statusText: missing.length === 0
          ? 'Registration, attendance and scoring complete'
          : `${registered ? 'Registered' : 'Not registered'} — missing: ${missing.join(', ')}`,
      };
    });
  });

  /** The three count cards. Counts are shown beside the table that proves them. */
  readonly registeredCount = computed(() =>
    this.selectedEvent()
      ? this.registrationService.getEventRegistrations(this.selectedEventId())
          .filter(item => item.registrationStatus === 'REGISTERED').length
      : 0
  );

  readonly attendanceCount = computed(() =>
    this.rows().filter(row => row.attended).length
  );

  readonly scoringCompletedCount = computed(() =>
    this.rows().filter(row => row.scored).length
  );

  /**
   * Unresolved discrepancies: one item per participant per missing step,
   * carrying the backend-shaped discrepancy id. On GROUP events judge
   * scoring reconciles at TEAM level (`MISSING_JUDGE_SCORE:<teamId>`,
   * exactly the backend's id), while attendance stays per participant.
   */
  readonly discrepancies = computed<DiscrepancyItem[]>(() => {
    const items: DiscrepancyItem[] = this.rows().flatMap(row => {
      const rowItems: DiscrepancyItem[] = [];
      if (!row.registered) {
        rowItems.push({ id: `MISSING_REGISTRATION:${row.participantId}`, participantId: row.participantId, name: row.name, label: 'registration missing' });
      }
      if (!row.attended) {
        rowItems.push({ id: `MISSING_ATTENDANCE:${row.participantId}`, participantId: row.participantId, name: row.name, label: 'attendance not recorded' });
      }
      if (!row.scored && !this.isGroupEvent()) {
        rowItems.push({ id: `MISSING_JUDGE_SCORE:${row.participantId}`, participantId: row.participantId, name: row.name, label: 'scoring not completed' });
      }
      return rowItems;
    });

    const event = this.selectedEvent();

    if (event && this.isGroupEvent()) {
      // Team-level judge scoring gaps mirror the backend rule: every team
      // with at least one PRESENT member needs one submission per judge.
      for (const team of this.teamService.getTeamsByEvent(event.id)) {
        const members = this.teamService.getMembers(team.id);
        const hasPresentMember = members.some(member =>
          this.attendanceService.getByParticipantEvent(member.participantId, event.id)?.status === 'PRESENT');

        if (!hasPresentMember) continue;

        const missingJudges = this.activeJudges().filter(
          judge => !this.judgeSubmittedFor(judge.id, team.id));

        if (missingJudges.length) {
          items.push({
            id: `MISSING_JUDGE_SCORE:${team.id}`,
            participantId: team.id,
            name: team.name,
            label: `team scoring not completed (${missingJudges.length} of ${this.activeJudges().length} judge(s))`,
          });
        }
      }
    }

    return items;
  });

  /* ------------------------------------------------------------------
     Reviewer decision
     ------------------------------------------------------------------ */

  readonly reviewStatus = signal<ReviewStatus>('UNDER_REVIEW');
  readonly comments = signal('');
  readonly declineError = signal(false);
  readonly approvalError = signal('');
  readonly busy = signal(false);

  /** Version of the stored decision, sent back as expectedVersion next time. */
  private readonly approvalVersion = signal<number | undefined>(undefined);

  readonly dataState = signal<DataState>('IDLE');
  readonly dataError = signal('');

  /** Accept dialog state: per-item acknowledgement, never totals-only. */
  readonly acceptDialogOpen = signal(false);
  readonly acknowledged = signal<ReadonlySet<string>>(new Set<string>());

  updateComments(raw: string): void {
    this.comments.set(raw);
    if (raw.trim()) this.declineError.set(false);
  }

  openAccept(): void {
    this.approvalError.set('');
    this.acknowledged.set(new Set());
    this.acceptDialogOpen.set(true);
  }

  closeAccept(): void {
    this.acceptDialogOpen.set(false);
    this.acknowledged.set(new Set());
  }

  toggleAcknowledgement(discrepancyId: string): void {
    this.acknowledged.update(current => {
      const next = new Set(current);
      if (next.has(discrepancyId)) next.delete(discrepancyId);
      else next.add(discrepancyId);
      return next;
    });
  }

  /** Accept stays disabled until every unresolved item is acknowledged. */
  readonly allAcknowledged = computed(() =>
    this.discrepancies().every(item => this.acknowledged().has(item.id))
  );

  async confirmAccept(): Promise<void> {
    const event = this.selectedEvent();
    if (!event || this.busy() || !this.canEdit() || !this.allAcknowledged()) return;

    const discrepancies = this.discrepancies();
    await this.saveDecision('ACCEPTED', {
      // Each unresolved item is named explicitly — totals-only approval never passes.
      ...(discrepancies.length
        ? { acknowledgedDiscrepancyIds: discrepancies.map(item => item.id) }
        : {}),
    });
  }

  /** Decline / Return for Correction: a reviewer comment is mandatory. */
  async decline(): Promise<void> {
    const comment = this.comments().trim();
    if (!comment) {
      this.declineError.set(true);
      return;
    }
    if (this.busy() || !this.canEdit()) return;

    await this.saveDecision('RETURNED');
  }

  private async saveDecision(
    decision: 'ACCEPTED' | 'RETURNED',
    extra: { acknowledgedDiscrepancyIds?: string[] } = {}
  ): Promise<void> {
    const event = this.selectedEvent();
    if (!event) return;

    this.busy.set(true);
    this.approvalError.set('');
    try {
      const response = await this.apiClient.saveResultApproval({
        eventId: event.id,
        decision,
        comments: this.comments().trim(),
        ...extra,
        // Optimistic concurrency: the recorded decision's version is sent back
        // to the backend on the next change (absent on the first decision).
        ...(this.approvalVersion() !== undefined ? { expectedVersion: this.approvalVersion() } : {}),
      });

      if (!response.success) {
        // RECONCILIATION_INCOMPLETE and rule rejections arrive pre-translated
        // and are shown in place, without a Retry.
        this.approvalError.set(response.error.message);
        this.closeAccept();
        this.notify.error(
          decision === 'ACCEPTED' ? 'Results could not be accepted.' : 'Results could not be returned.',
          response.error.message
        );
        return;
      }

      const version = (response.data as { resultApproval?: { version?: number } } | undefined)
        ?.resultApproval?.version;
      if (typeof version === 'number') {
        this.approvalVersion.set(version);
      }

      this.reviewStatus.set(decision === 'ACCEPTED' ? 'APPROVED' : 'RETURNED');
      this.closeAccept();
      this.notify.success(
        decision === 'ACCEPTED' ? 'Results accepted.' : 'Results returned for correction.',
        decision === 'ACCEPTED'
          ? (extra.acknowledgedDiscrepancyIds?.length
              ? `${extra.acknowledgedDiscrepancyIds.length} discrepancy(ies) were explicitly acknowledged.`
              : 'Every registered participant has attendance and scoring recorded.')
          : 'The reviewer comment was recorded with the decision.'
      );
    } finally {
      this.busy.set(false);
    }
  }

  statusLabel(): string {
    switch (this.reviewStatus()) {
      case 'APPROVED': return 'Approved';
      case 'RETURNED': return 'Returned for Correction';
      default: return 'Under Review';
    }
  }

  /* ------------------------------------------------------------------
     Results status + "what remains" before results become official
     ------------------------------------------------------------------ */

  /** True when the selected event's persisted scores are all finalized. */
  readonly eventFinalized = computed(() =>
    !!this.selectedEvent() && this.scoringService.isEventFinalized(this.selectedEventId()));

  /** Section 1 status: never presents draft scores as official results. */
  readonly resultsStatusLabel = computed(() =>
    this.eventFinalized()
      ? `Finalized — ${this.finalizedCount()} official result(s)`
      : 'Not finalized — draft scores are not official results');

  /** Plain-English list of what is still missing before results are official. */
  readonly remainingItems = computed(() => {
    const event = this.selectedEvent();
    if (!event) return [];
    if (this.eventFinalized()) return [];

    const items: string[] = [];
    const rows = this.rows();
    const missingRegistration = rows.filter(row => !row.registered).length;
    const missingAttendance = rows.filter(row => !row.attended).length;
    const missingScoring = rows.filter(row => !row.scored).length;
    if (missingRegistration) items.push(`${missingRegistration} participant(s) missing registration`);
    if (missingAttendance) items.push(`${missingAttendance} participant(s) missing event attendance`);
    if (missingScoring) items.push(`${missingScoring} participant(s) missing scoring or judge submissions`);

    const pending = this.missingJudgeSubmissions();
    if (pending.length) items.push(`judge submissions pending: ${pending.join(', ')}`);

    items.push('the event is not finalized — finalization locks the official scores');
    return items;
  });

  /** Judge → participant pairs still missing a submission, in plain words. */
  readonly missingJudgeSubmissions = computed(() => {
    const missing: string[] = [];
    if (this.judgesState() !== 'LOADED' || this.judgeScoresState() !== 'LOADED') return missing;
    for (const row of this.rows()) {
      for (const judge of this.activeJudges()) {
        if (!this.judgeSubmittedFor(judge.id, row.participantId)) {
          missing.push(`${judge.name || `Judge ${judge.judgeNumber}`} → ${row.name}`);
        }
      }
    }
    return missing;
  });
}


/** One ranked entry on a results board. */
export interface RankedResultRow {
  row: ListResultRow;
  position: number;
}

/** One event's finalized results, ranked. */
export interface ResultBoard {
  eventId: string;
  eventCode: string;
  eventName: string;
  category: string;
  mode: string;
  ranked: RankedResultRow[];
}

/**
 * Dense ranking, highest score first: ties share a position and the next
 * distinct score takes the next consecutive position (1, 2, 2, 3).
 */
export function rankResultRows(rows: ListResultRow[]): RankedResultRow[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  let position = 0;
  let prevScore: number | null = null;

  return sorted.map(row => {
    if (prevScore === null || row.score < prevScore) {
      position += 1;
      prevScore = row.score;
    }
    return { row, position };
  });
}
