import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import {
  Event,
  EventJudge,
  EventScoringMode,
  JudgeScoreRow,
  Participant,
  SaveAttendanceBatchItem,
  SaveJudgeScoreEntry,
  Team,
  TeamMember,
} from '../../core/models';
import {
  EVENT_FINALIZED_MESSAGE,
  pendingCriteriaHeading,
  pendingCriteriaMessage,
  persistenceUnconfirmed,
} from '../../core/permissions/friendly-error';
import { canEditModule } from '../../core/permissions/role-matrix';
import { ApiClientService } from '../../core/services/api/api-client.service';
import { AttendanceService } from '../../core/services/attendance/attendance.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import {
  ScoreLoadState,
  ScoringService,
} from '../../core/services/scoring/scoring.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { TeamService } from '../../core/services/teams/team.service';
import { formatScore } from '../../shared/score-format';

/** The exact inline rejection text for any value outside 0–10 in 0.5 steps. */
export const SCORE_VALIDATION_MESSAGE = 'Scores must be 0–10 in increments of 0.5';

/** The finalization gate message while judge submissions are missing. */
export const JUDGES_INCOMPLETE_MESSAGE =
  'Every judge must submit final scores before this event can be finalized.';

export type ScoreValidation = { empty: true } | { value: number } | { error: string };

/** One roster member of a group team with its explicit attendance status. */
export interface TeamRosterEntry {
  participantId: string;
  name: string;
  /** PRESENT, ABSENT, or '' = unmarked (never assumed PRESENT). */
  attendanceStatus: string;
}

/** One GROUP scoring row: the team, its roster state and its scoreability. */
export interface TeamScoringRow {
  teamId: string;
  teamName: string;
  homeName: string;
  roster: TeamRosterEntry[];
  registeredCount: number;
  presentCount: number;
  absentCount: number;
  unmarkedCount: number;
  missingAttendance: Array<{ participantId: string; name: string }>;
  scoreable: boolean;
  blockedReason: string;
}

/**
 * Validates one raw score input: empty, a 0–10 value in 0.5 steps, or the
 * single inline rejection message. Anything else — negative, above 10, or a
 * non-0.5 increment — is rejected before it can reach the backend.
 */
export function validateJudgeScore(raw: string): ScoreValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { empty: true };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 10 || !Number.isInteger(value * 2)) {
    return { error: SCORE_VALIDATION_MESSAGE };
  }
  return { value };
}

type JudgesState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';
type JudgeScoresState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';

/** Per-judge submission state, derived from the stored judge-score rows. */
export type JudgeSubmissionState = 'SUBMITTED' | 'DRAFT' | 'NONE';

/**
 * Read state of the registration request behind the judge grid.
 *
 * The cache this state guards starts empty, so a request that has not been
 * issued, is in flight, or has failed must never be presented as "no targets".
 */
type RegistrationsState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';

/**
 * Judge score entry for one event — the ONE authoritative scoring workflow.
 *
 * Judges are configured on /judging; here each judge scores the PRESENT
 * participants of the event and saves drafts or submits final scores through
 * `saveJudgeScores` (one upsert row per judge + participant). The official
 * score is the arithmetic average of the submitted judge totals — written by
 * the backend into the event's Scores rows and shown read-only in the
 * "Official aggregate" column. The single official finalization path is
 * `finalizeEvent`; nothing on this page writes a score outside the judge
 * workflow.
 *
 * Every write is awaited and reports its outcome as a compact toast. A
 * rejected write leaves the typed values in place so nothing a judge entered
 * is lost, and the page never claims a write it cannot confirm.
 */
@Component({
  selector: 'nk-scoring',
  imports: [ViewOnlyBannerComponent, RouterLink],
  templateUrl: './scoring.html',
  styleUrl: './scoring.scss',
})
export class Scoring implements OnInit {
  private readonly apiClient = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly teamService = inject(TeamService);
  private readonly scoringService = inject(ScoringService);
  private readonly shelterData = inject(ShelterDataService);
  /** Re-runs the full store load after a failed page load (Retry button). */
  async retryStoreLoad(): Promise<void> {
    await this.shelterData.refresh();
  }

  /** Re-reads the event master after a failed load (Retry button). */
  async retryEventsLoad(): Promise<void> {
    await this.eventService.load();
  }
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
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

  /** Backend read state of the selected event's scores. */
  readonly scoresState = computed<ScoreLoadState>(() => {
    const id = this.selectedEventId();
    return id ? this.scoringService.loadState(id) : { status: 'IDLE', error: '' };
  });

  /** Read state of the registrations for the currently selected event. */
  readonly registrationsState = signal<RegistrationsState>('IDLE');
  readonly registrationError = signal('');

  /** True while an event-level finalize/reopen request is in flight. */
  readonly scoringBusy = signal(false);

  /** The whole event is finalized when every persisted score for it is. */
  readonly eventFinalized = computed(() =>
    this.scoringService.isEventFinalized(this.selectedEventId()));

  /** The finalization lock message shown in place of the write controls. */
  readonly finalizedMessage = EVENT_FINALIZED_MESSAGE;

  /** Precise pending-criteria copy: which event, what is missing, where it is supplied. */
  readonly pendingCriteriaHeading = pendingCriteriaHeading;
  readonly pendingCriteriaMessage = pendingCriteriaMessage;

  /**
   * Official finalization (the ONE official finalization path): the backend
   * gates it on complete judge submissions (JUDGE_SCORES_INCOMPLETE) and
   * commits the official judge-average scores idempotently.
   */
  async finalizeEventAction(): Promise<void> {
    const event = this.selectedEvent();
    if (!event || this.scoringBusy() || this.eventFinalized()) return;

    // PENDING events cannot be finalized: no official criteria, no official results.
    if (this.scoringMode() === 'PENDING') {
      this.notify.warning(
        pendingCriteriaHeading(event.eventCode, event.name),
        pendingCriteriaMessage(event.eventCode, event.name)
      );
      return;
    }

    // The backend blocks this with JUDGE_SCORES_INCOMPLETE; the UI blocks it
    // first with the same plain-English message whenever the facts are known.
    if (!this.allJudgesSubmitted()) {
      this.notify.error(JUDGES_INCOMPLETE_MESSAGE);
      return;
    }

    this.scoringBusy.set(true);
    try {
      const result = await this.scoringService.finalizeEventScores(event.id);
      if (!result.success || !result.data) {
        const code = result.errorCode ?? '';
        // A structured rejection means the backend committed nothing; a
        // transport/protocol failure leaves the outcome unknown, and the
        // user must not be told either way.
        const detail = persistenceUnconfirmed(code)
          ? 'The outcome is unknown — retry (finalization is idempotent) or reload to check what was committed.'
          : 'Nothing was finalized.';
        this.notify.error(
          result.errorMessage || 'The event could not be finalized.',
          code ? `${detail} (code: ${code})` : detail
        );
        return;
      }
      this.notify.success(result.data.alreadyFinalized ? 'This event was already finalized.' : 'Event finalized.', result.data.totalScores + ' score(s) are now official results.');
      // Finalized results feed Results and Certificates — take the user there.
      void this.router.navigateByUrl('/results');
    } finally {
      this.scoringBusy.set(false);
    }
  }

  /** Controlled reopen (correction workflow) with a mandatory reason. */
  readonly reopenRequested = signal(false);
  readonly reopenReason = signal('');

  toggleReopen(): void { this.reopenRequested.update(v => !v); }

  updateReopenReason(raw: string): void { this.reopenReason.set(raw); }

  async reopenEventAction(): Promise<void> {
    const reason = this.reopenReason().trim();
    if (!reason) { this.notify.error('A reason is required to reopen the event.'); return; }
    const event = this.selectedEvent();
    if (!event || this.scoringBusy()) return;

    this.scoringBusy.set(true);
    try {
      const result = await this.scoringService.reopenEventScores(event.id, reason);
      if (!result.success) {
        const code = result.errorCode ?? '';
        const detail = persistenceUnconfirmed(code)
          ? 'The outcome is unknown — reload to check whether the event was reopened.'
          : 'The event stays finalized.';
        this.notify.error(
          result.errorMessage || 'The event could not be reopened.',
          code ? `${detail} (code: ${code})` : detail
        );
        return;
      }
      this.reopenRequested.set(false);
      this.reopenReason.set('');
      this.notify.success('Scores reopened for correction.', 'Official results are suspended until the event is finalized again.');
    } finally {
      this.scoringBusy.set(false);
    }
  }

  readonly selectedEvent = computed(() => this.selectedEventId() ? this.eventService.getById(this.selectedEventId()) : undefined);

  /**
   * Reads the registrations for one event from the backend. The judge grid is
   * derived from them (PRESENT attendees only), so they load with the event.
   */
  async loadRegistrations(eventId: string): Promise<void> {
    if (!eventId) {
      this.registrationsState.set('IDLE');
      this.registrationError.set('');
      return;
    }

    this.registrationsState.set('LOADING');
    this.registrationError.set('');

    // PRESENT attendees are the scoring targets — the persisted attendance
    // must be read alongside the registrations. GROUP events score their
    // team rosters, so the teams load with the event too.
    void this.attendanceService.loadEventAttendance(eventId);
    void this.teamService.loadTeams(eventId);

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
   * Reads everything the selected event needs: registrations, the persisted
   * official scores (they drive the finalization lock) and, in order, the
   * configured judges and the saved judge scores that fill the grid.
   */
  async loadEvent(eventId: string): Promise<void> {
    if (!eventId) {
      await this.loadRegistrations(eventId);
      return;
    }

    // A cold deep link can arrive before the event catalogue has loaded; the
    // scoring rule below must not silently miss the event.
    if (!this.eventService.loaded()) {
      await this.eventService.load();
    }

    await Promise.allSettled([
      this.loadRegistrations(eventId),
      this.loadScores(eventId, false),
      this.loadJudges(eventId).then(() => this.loadJudgeScores(eventId)),
    ]);
  }

  /** Re-reads the selected event's scores after a failed read. */
  async retryScores(): Promise<void> {
    const id = this.selectedEventId();
    if (id) await this.loadScores(id, true);
  }

  /** Re-reads the selected event's registrations after a failed read. */
  async retryRegistrations(): Promise<void> {
    const id = this.selectedEventId();
    if (id) await this.loadRegistrations(id);
  }

  private loadScores(eventId: string, force: boolean): Promise<boolean> {
    return this.scoringService.loadScores(eventId, force);
  }

  /**
   * Switches the event. Unsaved judge edits survive a judge switch (they are
   * keyed per judge) but cannot survive an event switch, so the user is warned
   * before anything typed is discarded.
   */
  setEvent(id: string): void {
    if (id === this.selectedEventId()) return;

    if (this.hasUnsavedJudgeEdits() &&
        !window.confirm('Unsaved judge scores will be lost if you switch events. Discard them and switch?')) {
      return;
    }

    this.selectedEventId.set(id);
    this.selectedJudgeId.set('');
    this.judgeDrafts.set({});
    this.editedCells.set(new Set());
    this.savedRows.set({});
    this.judges.set([]);
    this.judgesState.set('IDLE');
    this.judgeScoresState.set('IDLE');
    void this.loadEvent(id);
  }

  modeLabel(event: Event): string {
    return event.mode === 'SOLO' ? 'Individual' : 'Group';
  }

  /* ------------------------------------------------------------------
     Judge scoring workspace (judges are configured on /judging)
     ------------------------------------------------------------------ */

  /** Judging is the Scoring module for the approved role matrix. */
  readonly canEdit = computed(() => canEditModule(this.auth.currentUser()?.role, 'SCORING'));

  /** Attendance edits are their own domain (Liaison/Events/Support/Admin). */
  readonly canEditAttendance = computed(() =>
    canEditModule(this.auth.currentUser()?.role, 'ATTENDANCE'));

  readonly scoringMode = computed<EventScoringMode>(() => this.selectedEvent()?.scoringMode ?? 'PENDING');

  readonly judgesState = signal<JudgesState>('IDLE');
  readonly judges = signal<EventJudge[]>([]);
  readonly judgeError = signal('');
  readonly judgeScoresState = signal<JudgeScoresState>('IDLE');
  readonly judgeScoresError = signal('');

  /** Saved judge-score rows keyed `${judgeId}|${participantId}`; `version` guards saves. */
  private readonly savedRows = signal<Record<string, JudgeScoreRow>>({});

  /** Active (non-REMOVED) judges; removed judges never enter any calculation. */
  readonly activeJudges = computed(() =>
    this.judges().filter(judge => (judge.status ?? 'ACTIVE').toUpperCase() !== 'REMOVED')
  );

  readonly activeJudgeCount = computed(() => this.activeJudges().length);

  readonly selectedJudgeId = signal('');
  readonly selectedJudge = computed(() =>
    this.judges().find(judge => judge.id === this.selectedJudgeId())
  );

  private async loadJudges(eventId: string): Promise<void> {
    if (!eventId) {
      this.judgesState.set('IDLE');
      this.judges.set([]);
      return;
    }

    this.judgesState.set('LOADING');
    this.judgeError.set('');

    const response = await this.apiClient.listEventJudges({ eventId });
    if (this.selectedEventId() !== eventId) return;

    if (!response.success) {
      this.judgeError.set(`${response.error.message} (code: ${response.error.code})`);
      this.judgesState.set('FAILED');
      return;
    }

    const judges = response.data.judges ?? [];
    this.judges.set(judges);
    this.judgesState.set('LOADED');

    // Keep the workspace on a judge that still exists after a config change.
    if (!judges.some(judge => judge.id === this.selectedJudgeId())) {
      this.selectedJudgeId.set(judges[0]?.id ?? '');
    }
  }

  /** Re-reads the configured judges after a failed read (safe, read-only). */
  async retryJudges(): Promise<void> {
    const id = this.selectedEventId();
    if (id) {
      await this.loadJudges(id);
      await this.loadJudgeScores(id);
    }
  }

  /** Re-reads the saved judge scores after a failed read (safe, read-only). */
  async retryJudgeScores(): Promise<void> {
    const id = this.selectedEventId();
    if (id) await this.loadJudgeScores(id);
  }

  /**
   * Loads every judge's saved scores for the event — drafts and submissions —
   * and fills the grid, so the workspace survives refresh and navigation.
   * Cells edited this session keep their in-progress value; every other cell
   * adopts the stored one.
   */
  async loadJudgeScores(eventId: string): Promise<void> {
    if (!eventId) {
      this.judgeScoresState.set('IDLE');
      return;
    }

    this.judgeScoresState.set('LOADING');
    this.judgeScoresError.set('');

    const response = await this.apiClient.listJudgeScores({ eventId });
    if (this.selectedEventId() !== eventId) return;

    if (!response.success) {
      this.judgeScoresError.set(`${response.error.message} (code: ${response.error.code})`);
      this.judgeScoresState.set('FAILED');
      return;
    }

    const rows = (response.data.scores ?? []).filter(row => row.eventId === eventId);
    this.savedRows.update(saved => {
      const next = { ...saved };
      for (const row of rows) next[`${row.judgeId}|${row.teamId || row.participantId}`] = row;
      return next;
    });
    this.mergeSavedJudgeScores(rows);
    this.judgeScoresState.set('LOADED');
  }

  /** Applies saved rows to the grid; only untouched cells take saved values. */
  private mergeSavedJudgeScores(rows: JudgeScoreRow[]): void {
    const fields = this.judgeScoreFields();
    this.judgeDrafts.update(drafts => {
      const next = { ...drafts };
      for (const row of rows) {
        const saved = new Map<string, string>();
        if (this.scoringMode() === 'CRITERIA') {
          for (const criterion of row.criteria ?? []) saved.set(criterion.name, String(criterion.score));
        } else if (typeof row.score === 'number') {
          saved.set('Overall', String(row.score));
        }
        const merged = { ...(next[row.judgeId] ?? {}) };
        const rowKey = row.teamId || row.participantId;
        for (const field of fields) {
          const key = `${rowKey}|${field}`;
          if (this.editedCells().has(`${row.judgeId}|${key}`)) continue;
          merged[key] = saved.get(field) ?? '';
        }
        next[row.judgeId] = merged;
      }
      return next;
    });
  }

  /** Submission state of one judge, derived from the stored rows. */
  judgeSubmission(judgeId: string): JudgeSubmissionState {
    const rows = Object.values(this.savedRows()).filter(row => row.judgeId === judgeId);
    if (rows.some(row => row.status === 'SUBMITTED')) return 'SUBMITTED';
    if (rows.length) return 'DRAFT';
    return 'NONE';
  }

  /** Friendly per-judge submission label for the judge chips and roster. */
  judgeStatusLabel(judge: EventJudge): string {
    switch (this.judgeSubmission(judge.id)) {
      case 'SUBMITTED': return 'Submitted';
      case 'DRAFT': return 'Draft saved';
      default: return 'Not started';
    }
  }

  judgeLabel(judge: EventJudge): string {
    return `Judge ${judge.judgeNumber} — ${judge.name || '(unnamed)'}`;
  }

  /**
   * True when the judging record is complete: every active judge has a
   * SUBMITTED row for every scoreable row (PRESENT participant on
   * individual events, eligible team on group events). Unknown reads
   * never block here — the backend stays the authority and rejects an
   * incomplete finalize with JUDGE_SCORES_INCOMPLETE.
   */
  readonly allJudgesSubmitted = computed(() => {
    if (this.judgesState() !== 'LOADED' || this.judgeScoresState() !== 'LOADED') return true;
    const active = this.activeJudges();
    if (!active.length) return true;
    return this.workspaceRowKeys().every(rowKey =>
      active.every(judge => this.savedRows()[`${judge.id}|${rowKey}`]?.status === 'SUBMITTED'));
  });

  /** Judge → target pairs still missing a submission, in plain words. */
  readonly missingJudgeSubmissions = computed(() => {
    const missing: string[] = [];
    if (this.judgesState() !== 'LOADED' || this.judgeScoresState() !== 'LOADED') return missing;
    for (const rowKey of this.workspaceRowKeys()) {
      for (const judge of this.activeJudges()) {
        if (this.savedRows()[`${judge.id}|${rowKey}`]?.status !== 'SUBMITTED') {
          missing.push(`${judge.name || `Judge ${judge.judgeNumber}`} → ${this.rowLabel(rowKey)}`);
        }
      }
    }
    return missing;
  });

  /** The one-column label for SINGLE events, one column per criterion otherwise. */
  readonly judgeScoreFields = computed<string[]>(() => {
    const event = this.selectedEvent();
    if (!event) return [];
    if (this.scoringMode() === 'CRITERIA') return (event.criteria ?? []).map(criterion => criterion.name);
    return ['Overall'];
  });

  readonly maxJudgeOverall = computed(() =>
    this.scoringMode() === 'CRITERIA' ? this.judgeScoreFields().length * 10 : 10
  );

  /** Registered participants of the selected event (any registration state). */
  private readonly registeredParticipants = computed<Participant[]>(() => {
    const event = this.selectedEvent();
    if (!event) return [];
    return this.registrationService.getEventRegistrations(event.id)
      .filter(item => item.registrationStatus === 'REGISTERED')
      .map(item => this.participantService.getParticipantById(item.participantId))
      .filter((participant): participant is Participant => !!participant);
  });

  /**
   * Judge grid rows: PRESENT participants only. Absent and unmarked
   * participants are excluded entirely and cannot be judge-scored.
   */
  readonly judgeRows = computed<Participant[]>(() =>
    this.registeredParticipants().filter(participant =>
      this.attendanceService.getByParticipantEvent(participant.id, this.selectedEventId())?.status === 'PRESENT')
  );

  /** Registered participants excluded from judge scoring (absent or unmarked). */
  readonly judgeExcludedCount = computed(() => this.registeredParticipants().length - this.judgeRows().length);

  /* ------------------------------------------------------------------
     GROUP workspace: ONE scoring row per eligible home/team
     ------------------------------------------------------------------ */

  /** GROUP events are scored at team level; SOLO events per participant. */
  readonly isGroupEvent = computed(() => this.selectedEvent()?.mode === 'GROUP');

  /**
   * One scoring row per team of the event with its full roster state:
   * registered / present / absent counts and the exact members whose
   * attendance record is missing. A team is scoreable only with complete
   * explicit attendance and at least one PRESENT member — unmarked is
   * never assumed PRESENT.
   */
  readonly teamRows = computed<TeamScoringRow[]>(() => {
    const event = this.selectedEvent();
    if (!event) return [];

    return this.teamService.getTeamsByEvent(event.id).map(team => {
      const roster = this.teamService.getMembers(team.id).map(member => {
        const participant = this.participantService.getParticipantById(member.participantId);
        return {
          participantId: member.participantId,
          name: participant?.fullName ?? member.participantId,
          attendanceStatus:
            this.attendanceService.getByParticipantEvent(member.participantId, event.id)?.status ?? '',
        };
      });

      const missingAttendance = roster
        .filter(entry => !entry.attendanceStatus)
        .map(entry => ({ participantId: entry.participantId, name: entry.name }));
      const presentCount = roster.filter(entry => entry.attendanceStatus === 'PRESENT').length;
      const absentCount = roster.filter(entry => entry.attendanceStatus === 'ABSENT').length;

      const blockedReason = !roster.length
        ? 'This team has no active members to score.'
        : missingAttendance.length
          ? `Attendance is not marked for: ${missingAttendance.map(entry => entry.name).join(', ')}.`
          : presentCount === 0
            ? 'No member is marked PRESENT — there is nothing to score.'
            : '';

      return {
        teamId: team.id,
        teamName: team.name,
        homeName: this.shelterData.getHomeById(
          team.shelterHomeId ?? this.rosterHomeId(team.id)
        )?.homeName ?? '',
        roster,
        registeredCount: roster.length,
        presentCount,
        absentCount,
        unmarkedCount: roster.length - presentCount - absentCount,
        missingAttendance,
        scoreable: !blockedReason,
        blockedReason,
      };
    });
  });

  /** Legacy teams carry no home id: fall back to the roster's home. */
  private rosterHomeId(teamId: string): string {
    const first = this.teamService.getMembers(teamId)[0];
    return first
      ? (this.participantService.getParticipantById(first.participantId)?.shelterHomeId ?? '')
      : '';
  }

  /** Every scoring row of the workspace: participants (SOLO) or teams (GROUP). */
  readonly workspaceRowKeys = computed<string[]>(() =>
    this.isGroupEvent()
      ? this.teamRows().map(row => row.teamId)
      : this.judgeRows().map(row => row.id));

  /** Rows the selected judge may actually score (blocked teams are excluded). */
  readonly eligibleRowKeys = computed<string[]>(() =>
    this.isGroupEvent()
      ? this.teamRows().filter(row => row.scoreable).map(row => row.teamId)
      : this.judgeRows().map(row => row.id));

  /** Display label of one scoring row (participant name or team name). */
  rowLabel(rowKey: string): string {
    if (!this.isGroupEvent()) {
      return this.judgeRows().find(row => row.id === rowKey)?.fullName ?? rowKey;
    }
    return this.teamRows().find(row => row.teamId === rowKey)?.teamName ?? rowKey;
  }

  /** Raw judge score inputs, keyed judgeId → `${participantId}|${field}`. */
  readonly judgeDrafts = signal<Record<string, Record<string, string>>>({});

  /**
   * Cells typed into this session (`${judgeId}|${participantId}|${field}`).
   * A reload of saved scores never overwrites them: in-progress edits win.
   */
  private readonly editedCells = signal<ReadonlySet<string>>(new Set());

  /** True while any judge score edit is unsaved; switching events must warn. */
  hasUnsavedJudgeEdits(): boolean {
    return this.editedCells().size > 0;
  }

  /** True while a judge score save/submit request is in flight. */
  readonly judgeScoringBusy = signal(false);

  /**
   * Judge switch: drafts are keyed per judge, so unsaved edits for other
   * judges are preserved and only the stored rows are re-read.
   */
  async setJudge(judgeId: string): Promise<void> {
    this.selectedJudgeId.set(judgeId);
    await this.loadJudgeScores(this.selectedEventId());
  }

  judgeScoreValue(participantId: string, field: string): string {
    return this.judgeDrafts()[this.selectedJudgeId()]?.[`${participantId}|${field}`] ?? '';
  }

  setJudgeScore(participantId: string, field: string, raw: string): void {
    const judgeId = this.selectedJudgeId();
    if (!judgeId) return;
    this.editedCells.update(cells => {
      const next = new Set(cells);
      next.add(`${judgeId}|${participantId}|${field}`);
      return next;
    });
    this.judgeDrafts.update(drafts => ({
      ...drafts,
      [judgeId]: { ...(drafts[judgeId] ?? {}), [`${participantId}|${field}`]: raw },
    }));
  }

  /** Inline rejection message for one cell; empty when the value is usable. */
  judgeFieldError(participantId: string, field: string): string {
    const result = validateJudgeScore(this.judgeScoreValue(participantId, field));
    return 'error' in result ? result.error : '';
  }

  private judgeRowValues(participantId: string): ScoreValidation[] {
    return this.judgeScoreFields().map(field => validateJudgeScore(this.judgeScoreValue(participantId, field)));
  }

  /** Per-participant total for the selected judge; incomplete rows say so. */
  judgeRowTotal(participantId: string): { label: string; tone: 'complete' | 'draft' | 'invalid' } {
    const values = this.judgeRowValues(participantId);
    if (values.some(value => 'error' in value)) return { label: 'fix errors', tone: 'invalid' };
    const total = values.reduce<number>((sum, value) => sum + ('value' in value ? value.value : 0), 0);
    const complete = values.every(value => 'value' in value);
    return { label: `${total} / ${this.maxJudgeOverall()}`, tone: complete ? 'complete' : 'draft' };
  }

  /** Per-criterion (column) totals for the selected judge. */
  judgeColumnTotal(field: string): number {
    return this.eligibleRowKeys().reduce((sum, rowKey) => {
      const result = validateJudgeScore(this.judgeScoreValue(rowKey, field));
      return sum + ('value' in result ? result.value : 0);
    }, 0);
  }

  /** The selected judge's grand total across all scoreable rows. */
  judgeOverallTotal(): number {
    return this.eligibleRowKeys().reduce((sum, rowKey) => {
      const values = this.judgeRowValues(rowKey);
      return sum + values.reduce<number>((rowSum, value) => rowSum + ('value' in value ? value.value : 0), 0);
    }, 0);
  }

  formatTotal(value: number): string {
    return formatScore(value);
  }

  /**
   * One judge's total from a stored row: the criteria sum in CRITERIA mode,
   * the overall score otherwise. An incomplete row yields null and is
   * excluded from the official average — exactly like the backend.
   */
  private judgeTotalOf(row: JudgeScoreRow): number | null {
    if (this.scoringMode() === 'CRITERIA') {
      const criteria = row.criteria ?? [];
      if (criteria.length !== this.judgeScoreFields().length) return null;
      return criteria.reduce((sum, criterion) => sum + criterion.score, 0);
    }
    return typeof row.score === 'number' ? row.score : null;
  }

  /**
   * OFFICIAL AGGREGATE for one participant: the arithmetic average of the
   * valid SUBMITTED totals of the active judges. Drafts, removed judges and
   * incomplete submissions are excluded — the same rule the backend applies
   * when it writes the official Scores row. Displayed read-only; never edited.
   */
  officialAggregate(participantId: string): number | null {
    const totals = this.activeJudges()
      .map(judge => this.savedRows()[`${judge.id}|${participantId}`])
      .filter((row): row is JudgeScoreRow => !!row && row.status === 'SUBMITTED')
      .map(row => this.judgeTotalOf(row))
      .filter((total): total is number => total !== null);
    if (!totals.length) return null;
    return totals.reduce((sum, total) => sum + total, 0) / totals.length;
  }

  /** Display form of the official aggregate ("13.8"), or "—" when unknown. */
  officialAggregateLabel(participantId: string): string {
    const aggregate = this.officialAggregate(participantId);
    return aggregate === null ? '—' : formatScore(aggregate);
  }

  /** True when finalization must stay blocked (pending criteria or judge gaps). */
  readonly finalizeBlocked = computed(() =>
    this.scoringMode() === 'PENDING' || !this.allJudgesSubmitted());

  /** Plain-English reason finalization is blocked; empty when it is not. */
  readonly finalizeBlockedMessage = computed(() => {
    if (this.scoringMode() !== 'PENDING') return JUDGES_INCOMPLETE_MESSAGE;
    const event = this.selectedEvent();
    return event
      ? pendingCriteriaMessage(event.eventCode, event.name)
      : JUDGES_INCOMPLETE_MESSAGE;
  });

  /* ------------------------------------------------------------------
     Judge save draft / submit final (saveJudgeScores)
     ------------------------------------------------------------------ */

  /**
   * Built entries for the selected judge; invalid values block the save.
   * SOLO events build per-participant entries; GROUP events build ONE
   * team entry per eligible team (never per-member rows).
   */
  private buildJudgeEntries(): { entries: SaveJudgeScoreEntry[]; invalid: number; scored: number } {
    const judgeId = this.selectedJudgeId();
    const fields = this.judgeScoreFields();
    const entries: SaveJudgeScoreEntry[] = [];
    let invalid = 0;
    let scored = 0;
    const group = this.isGroupEvent();

    for (const rowKey of this.eligibleRowKeys()) {
      const values = fields.map(field => ({ field, result: validateJudgeScore(this.judgeScoreValue(rowKey, field)) }));
      invalid += values.filter(value => 'error' in value.result).length;

      const entered = values.filter(
        (value): value is { field: string; result: { value: number } } => 'value' in value.result
      );
      if (!entered.length) continue;
      scored++;

      // Rows read back from listJudgeScores carry a version; sending it lets the
      // backend reject a stale write with VERSION_CONFLICT.
      const expectedVersion = this.savedRows()[`${judgeId}|${rowKey}`]?.version;
      const target = group ? { teamId: rowKey } : { participantId: rowKey };

      if (this.scoringMode() === 'CRITERIA') {
        entries.push({
          ...target,
          criteria: entered.map(value => ({ name: value.field, score: value.result.value })),
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        });
      } else {
        entries.push({
          ...target,
          score: entered[0].result.value,
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        });
      }
    }

    return { entries, invalid, scored };
  }

  /** Draft: persists every entered (valid) score for the selected judge. */
  async saveJudgeDraft(): Promise<void> {
    await this.submitJudgeScores('DRAFT');
  }

  /** Final: requires every present participant fully scored before saving. */
  async submitJudgeFinal(): Promise<void> {
    await this.submitJudgeScores('SUBMITTED');
  }

  private async submitJudgeScores(action: 'DRAFT' | 'SUBMITTED'): Promise<void> {
    const event = this.selectedEvent();
    const judge = this.selectedJudge();
    if (!event || !judge || this.judgeScoringBusy() || !this.canEdit()) return;

    if (this.scoringMode() === 'PENDING') {
      // Belt-and-braces: the grid renders no inputs in PENDING mode.
      this.notify.warning(
        pendingCriteriaHeading(event.eventCode, event.name),
        pendingCriteriaMessage(event.eventCode, event.name)
      );
      return;
    }

    if (this.eventFinalized()) {
      this.notify.warning('Event is finalized.', this.finalizedMessage);
      return;
    }

    const { entries, invalid, scored } = this.buildJudgeEntries();

    if (invalid) {
      this.notify.error('Fix invalid scores first.', `${invalid} value(s) — ${SCORE_VALIDATION_MESSAGE}`);
      return;
    }

    const total = this.eligibleRowKeys().length;
    const targets = this.isGroupEvent() ? 'eligible teams' : 'present participants';
    if (!entries.length) {
      this.notify.error('Enter at least one score.', `${judge.name} has no scores to save.`);
      return;
    }

    if (action === 'SUBMITTED' && scored < total) {
      this.notify.error(
        `Every ${this.isGroupEvent() ? 'eligible team' : 'present participant'} needs a score before submitting.`,
        `${scored} of ${total} ${targets} fully scored.`
      );
      return;
    }

    this.judgeScoringBusy.set(true);
    try {
      // saveJudgeScores is an UPSERT keyed by judge + participant: retrying
      // can never duplicate a row, so a failed save may simply be repeated.
      const response = await this.apiClient.saveJudgeScores({
        eventId: event.id,
        judgeId: judge.id,
        entries,
        status: action,
      });

      if (!response.success) {
        const code = response.error.code;
        if (persistenceUnconfirmed(code)) {
          // Whether anything was stored is unknown: re-read the stored rows
          // so the grid shows exactly what the backend holds.
          await this.loadJudgeScores(event.id);
          this.notify.error(
            action === 'SUBMITTED' ? 'Scores could not be submitted.' : 'Scores could not be saved.',
            `We couldn’t confirm whether anything was saved — the stored scores were re-read. (code: ${code})`
          );
          return;
        }
        // A structured rejection changed nothing; the typed values stay put.
        this.notify.error(
          action === 'SUBMITTED' ? 'Scores could not be submitted.' : 'Scores could not be saved.',
          `${response.error.message} Nothing was saved — your entries stay in the grid. (code: ${code})`
        );
        return;
      }

      this.notify.success(
        action === 'SUBMITTED' ? 'Final scores submitted.' : 'Draft scores saved.',
        `${scored} of ${total} ${targets} scored by ${judge.name}.`
      );

      // Everything entered for THIS judge is now stored: clear only its edit
      // marks (other judges' unsaved edits survive) and re-read so the next
      // save carries the fresh versions.
      this.editedCells.update(cells => {
        const next = new Set(cells);
        for (const key of [...next]) {
          if (key.startsWith(`${judge.id}|`)) next.delete(key);
        }
        return next;
      });
      await this.loadJudgeScores(event.id);
    } finally {
      this.judgeScoringBusy.set(false);
    }
  }

  /* ------------------------------------------------------------------
     Bulk per-event attendance for the group rosters (saveAttendanceBatch)
     ------------------------------------------------------------------ */

  /** Queued (unsaved) attendance marks, keyed participantId. */
  readonly pendingAttendance = signal<Record<string, 'PRESENT' | 'ABSENT'>>({});

  /** True while the bulk attendance save is in flight. */
  readonly attendanceBusy = signal(false);

  readonly pendingAttendanceCount = computed(() => Object.keys(this.pendingAttendance()).length);

  /** Queues one member's explicit mark (never auto-PRESENT). */
  queueAttendance(participantId: string, status: 'PRESENT' | 'ABSENT'): void {
    this.pendingAttendance.update(pending => ({ ...pending, [participantId]: status }));
  }

  /** Queues the same explicit mark for every roster member of one team. */
  queueTeamAttendance(teamId: string, status: 'PRESENT' | 'ABSENT'): void {
    const row = this.teamRows().find(item => item.teamId === teamId);
    if (!row) return;
    this.pendingAttendance.update(pending => {
      const next = { ...pending };
      for (const entry of row.roster) next[entry.participantId] = status;
      return next;
    });
  }

  /** The mark shown for a member: the queued one, else the persisted one. */
  rosterAttendanceStatus(entry: TeamRosterEntry): string {
    return this.pendingAttendance()[entry.participantId] ?? entry.attendanceStatus;
  }

  /**
   * Saves every queued mark in ONE batch request. The eligible-team list
   * refreshes from the backend after the save, so a team's scoreability
   * always reflects what was actually persisted.
   */
  async saveAttendanceBatch(): Promise<void> {
    const event = this.selectedEvent();
    if (!event || this.attendanceBusy()) return;

    const items: SaveAttendanceBatchItem[] = Object.entries(this.pendingAttendance()).map(
      ([participantId, status]) => ({ participantId, status })
    );

    if (!items.length) return;

    this.attendanceBusy.set(true);
    try {
      const response = await this.apiClient.saveAttendanceBatch({ eventId: event.id, items });

      if (!response.success) {
        this.notify.error(
          'Attendance could not be saved.',
          `${response.error.message} Nothing was written. (code: ${response.error.code})`
        );
        return;
      }

      const { results, summary } = response.data;
      const failed = results.filter(result =>
        result.outcome === 'INVALID' || result.outcome === 'VERSION_CONFLICT');

      // Re-read what the backend actually holds so the team rows and their
      // scoreability are exactly the persisted state.
      this.pendingAttendance.set({});
      await this.attendanceService.loadEventAttendance(event.id, true);
      await this.teamService.loadTeams(event.id, true);

      if (failed.length) {
        this.notify.error(
          'Some attendance marks were not saved.',
          `${summary.created + summary.updated} saved, ${failed.length} rejected — ` +
            failed.map(result => `${result.participantId}: ${result.message ?? result.outcome}`).join('; ')
        );
        return;
      }

      this.notify.success(
        'Attendance saved.',
        `${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged.`
      );
    } finally {
      this.attendanceBusy.set(false);
    }
  }
}
