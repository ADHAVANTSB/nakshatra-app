import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { EventJudge, EventScoringMode, JudgeScoreRow } from '../../core/models';
import { persistenceUnconfirmed } from '../../core/permissions/friendly-error';
import { canEditModule } from '../../core/permissions/role-matrix';
import { ApiClientService } from '../../core/services/api/api-client.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { EventService } from '../../core/services/events/event.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';

type JudgesState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';
type JudgeScoresState = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED';

/**
 * Judge Setup / administration (prototype screen A) — configuration ONLY.
 *
 * The event coordinator enters each judge — the judge count derives from that
 * list and is never pre-filled — and confirms the list with an explicit
 * "Confirm & Save Judges" action. The stored list is shown with each judge's
 * status (ACTIVE / REMOVED) and submission state. Once any judge has
 * submitted scores the backend rejects removals
 * (JUDGES_LOCKED_AFTER_SCORING), so the editor is disabled then and the
 * locked truth is re-read after any rejection.
 *
 * Score entry itself lives on the Scoring page: this page configures judges
 * and shows the official criteria, nothing more. Criteria are only ever shown
 * as officially supplied — events whose criteria are pending (PENDING) show
 * the pending placeholder and no scoring claims.
 */
@Component({
  selector: 'nk-judging',
  imports: [ViewOnlyBannerComponent, RouterLink],
  templateUrl: './judging.html',
  styleUrl: './judging.scss',
})
export class Judging implements OnInit {
  private readonly apiClient = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly eventService = inject(EventService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly shelterData = inject(ShelterDataService);

  /** Judging is the Scoring module for the approved role matrix. */
  readonly canEdit = computed(() => canEditModule(this.auth.currentUser()?.role, 'SCORING'));

  readonly loading = this.shelterData.loading;
  readonly eventsLoading = this.eventService.loading;
  readonly loadError = this.shelterData.homesError;
  readonly eventsError = this.eventService.loadError;

  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly selectedEvent = computed(() =>
    this.selectedEventId() ? this.eventService.getById(this.selectedEventId()) : undefined
  );

  ngOnInit(): void {
    void this.shelterData.ensureLoaded();

    // Deep link: /judging?eventId=...
    const deepLinked = this.route.snapshot.queryParamMap.get('eventId');
    if (deepLinked) {
      this.selectedEventId.set(deepLinked);
      void this.loadEvent(deepLinked);
    }
  }

  setEvent(id: string): void {
    this.selectedEventId.set(id);
    this.judgesState.set('IDLE');
    this.judges.set([]);
    this.judgeNames.set([]);
    this.judgeScoresState.set('IDLE');
    this.judgeRowsByJudge.set({});
    void this.loadEvent(id);
  }

  async retryEventsLoad(): Promise<void> {
    await this.eventService.load();
  }

  async retryStoreLoad(): Promise<void> {
    await this.shelterData.refresh();
  }

  /* ------------------------------------------------------------------
     Judge setup (entered by the event coordinator)
     ------------------------------------------------------------------ */

  readonly judgesState = signal<JudgesState>('IDLE');
  readonly judges = signal<EventJudge[]>([]);
  readonly judgeError = signal('');
  /** Working copy of the judge names being edited; nothing is pre-filled. */
  readonly judgeNames = signal<string[]>([]);
  readonly judgesBusy = signal(false);

  /** Judges allocated for this event — derived from the entered list only. */
  readonly judgeCount = computed(() => this.judgeNames().length);

  addJudge(): void {
    this.judgeNames.update(names => [...names, '']);
  }

  removeJudge(index: number): void {
    this.judgeNames.update(names => names.filter((_, i) => i !== index));
  }

  updateJudgeName(index: number, raw: string): void {
    this.judgeNames.update(names => names.map((name, i) => (i === index ? raw : name)));
  }

  /**
   * Confirm & Save Judges: the sent list replaces the stored one. The backend
   * rejects removing judges that already have submitted scores
   * (JUDGES_LOCKED_AFTER_SCORING) — reported kindly, without a Retry, and the
   * stored judges are re-read so the screen shows the locked truth.
   *
   * Retry safety: this save is an UPSERT keyed by judge name (an existing
   * judge of the same name keeps its identity and scores; missing names are
   * removed; new names are added), so re-sending the same list converges and
   * can never duplicate judges. A structured rejection wrote nothing; a
   * transport/protocol failure leaves persistence unknown, and then the
   * stored list is re-read so the screen shows exactly what the backend
   * holds — while the coordinator's typed entries are kept for a re-save.
   */
  async saveJudges(): Promise<void> {
    const event = this.selectedEvent();
    if (!event || this.judgesBusy() || !this.canEdit()) return;

    const names = this.judgeNames().map(name => name.trim());
    if (!names.length) {
      this.notify.error('Add at least one judge.', 'The number of judges follows from the list the coordinator enters.');
      return;
    }
    if (names.some(name => !name)) {
      this.notify.error('Every judge needs a name.', 'Fill in each judge name before confirming.');
      return;
    }

    this.judgesBusy.set(true);
    try {
      const response = await this.apiClient.saveEventJudges({
        eventId: event.id,
        judges: names.map(name => ({ name })),
      });

      if (!response.success) {
        if (response.error.code === 'JUDGES_LOCKED_AFTER_SCORING') {
          this.notify.warning(
            'Judges can no longer be changed.',
            `${response.error.message} (code: ${response.error.code})`
          );
          await this.loadJudges(event.id, true);
          await this.loadJudgeScores(event.id);
          return;
        }

        const code = response.error.code;
        if (persistenceUnconfirmed(code)) {
          // Whether anything was stored is unknown: show what the backend
          // actually holds and say so — never claim either outcome.
          await this.loadJudges(event.id, true, true);
          this.notify.error(
            'Judges could not be saved.',
            `We couldn’t confirm whether anything was saved — the stored judge list below was re-read. Saving again is safe (it replaces the list; nothing duplicates). (code: ${code})`
          );
          return;
        }

        // A structured rejection wrote nothing; the typed list stays put and
        // the stored list below is unchanged. Saving again is safe (upsert).
        this.notify.error(
          'Judges could not be saved.',
          `${response.error.message} Nothing was saved — your entries above are kept and the stored list below is unchanged. (code: ${code})`
        );
        return;
      }

      const saved = response.data.judges ?? [];
      this.judges.set(saved);
      this.judgeNames.set(saved.map(judge => judge.name));
      this.notify.success('Judges confirmed and saved.', `${saved.length} judge(s) allocated for ${event.name}.`);
    } finally {
      this.judgesBusy.set(false);
    }
  }

  private async loadJudges(eventId: string, force = false, keepWorkingCopy = false): Promise<void> {
    if (!eventId) {
      this.judgesState.set('IDLE');
      this.judges.set([]);
      this.judgeNames.set([]);
      return;
    }
    if (!force && this.judgesState() === 'LOADED') return;

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
    if (!keepWorkingCopy) {
      this.judgeNames.set(judges.map(judge => judge.name));
    }
    this.judgesState.set('LOADED');
  }

  async retryJudges(): Promise<void> {
    await this.loadJudges(this.selectedEventId(), true);
    await this.loadJudgeScores(this.selectedEventId());
  }

  /* ------------------------------------------------------------------
     Submission state (drives the JUDGES_LOCKED_AFTER_SCORING protection)
     ------------------------------------------------------------------ */

  readonly judgeScoresState = signal<JudgeScoresState>('IDLE');
  readonly judgeScoresError = signal('');

  /** Saved judge-score rows keyed by judge id (their status drives the lock). */
  private readonly judgeRowsByJudge = signal<Record<string, JudgeScoreRow[]>>({});

  private async loadJudgeScores(eventId: string): Promise<void> {
    if (!eventId) {
      this.judgeScoresState.set('IDLE');
      this.judgeRowsByJudge.set({});
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

    const grouped: Record<string, JudgeScoreRow[]> = {};
    for (const row of response.data.scores ?? []) {
      grouped[row.judgeId] = [...(grouped[row.judgeId] ?? []), row];
    }
    this.judgeRowsByJudge.set(grouped);
    this.judgeScoresState.set('LOADED');
  }

  async retryJudgeScores(): Promise<void> {
    await this.loadJudgeScores(this.selectedEventId());
  }

  /** Whether this judge already has at least one SUBMITTED score row. */
  judgeSubmitted(judgeId: string): boolean {
    return (this.judgeRowsByJudge()[judgeId] ?? []).some(row => row.status === 'SUBMITTED');
  }

  /** Whether this judge has saved rows but no submission yet. */
  judgeHasDrafts(judgeId: string): boolean {
    return (this.judgeRowsByJudge()[judgeId] ?? []).length > 0;
  }

  /**
   * Submitted scores lock the judge list: the backend rejects any removal
   * then (JUDGES_LOCKED_AFTER_SCORING), so rename/remove are disabled.
   */
  readonly judgesLocked = computed(() =>
    Object.values(this.judgeRowsByJudge()).some(rows => rows.some(row => row.status === 'SUBMITTED'))
  );

  judgeStatusLabel(judge: EventJudge): string {
    return (judge.status ?? 'ACTIVE').toUpperCase() === 'REMOVED' ? 'REMOVED' : 'ACTIVE';
  }

  judgeSubmissionLabel(judge: EventJudge): string {
    if (this.judgeSubmitted(judge.id)) return 'Scores submitted';
    if (this.judgeHasDrafts(judge.id)) return 'Draft scores only';
    return 'No scores yet';
  }

  /* ------------------------------------------------------------------
     Official criteria panel (only where officially supplied)
     ------------------------------------------------------------------ */

  readonly scoringMode = computed<EventScoringMode>(() => this.selectedEvent()?.scoringMode ?? 'PENDING');

  /** The one-column label for SINGLE events, one column per criterion otherwise. */
  readonly scoreFields = computed<string[]>(() => {
    const event = this.selectedEvent();
    if (!event) return [];
    if (this.scoringMode() === 'CRITERIA') return (event.criteria ?? []).map(criterion => criterion.name);
    return ['Overall'];
  });

  readonly maxJudgeOverall = computed(() =>
    this.scoringMode() === 'CRITERIA' ? this.scoreFields().length * 10 : 10
  );

  /* ------------------------------------------------------------------
     Event data loading
     ------------------------------------------------------------------ */

  async loadEvent(eventId: string): Promise<void> {
    if (!eventId) return;

    if (!this.eventService.loaded()) {
      await this.eventService.load();
    }

    await this.loadJudges(eventId, true);
    await this.loadJudgeScores(eventId);
  }

  judgeLabel(judge: EventJudge): string {
    return `Judge ${judge.judgeNumber} — ${judge.name || '(unnamed)'}`;
  }
}
