import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Event, EventCategory, Participant, Score, Team } from '../../core/models';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ScoreLoadState, ScoringService } from '../../core/services/scoring/scoring.service';
import { ApiClientService } from '../../core/services/api/api-client.service';
import { ListResultRow } from '../../core/models/api.model';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import { TeamLoadState, TeamService } from '../../core/services/teams/team.service';

interface ResultRow {
  score: Score;
  position: number;
  participant?: Participant;
  team?: Team;
}

/**
 * Read-only view of finalized scores.
 *
 * Only `status === 'FINALIZED'` scores are read from `ScoringService` and this
 * page writes nothing: there is no ranking, winner, total or ordering by score.
 * Rows keep the order the scoring store holds them in, so a higher score never
 * implies a better placing. Backend shelter home ids are resolved to readable
 * names and codes so internal identifiers are never surfaced.
 */
@Component({
  selector: 'nk-results',
  imports: [DatePipe, FormsModule],
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class Results implements OnInit {
  private readonly eventService = inject(EventService);
  private readonly scoringService = inject(ScoringService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);
  private readonly shelterHomeService = inject(ShelterHomeService);
  private readonly shelterData = inject(ShelterDataService);
  private readonly apiClient = inject(ApiClientService);
  /** Re-runs the full store load after a failed page load (Retry button). */
  async retryStoreLoad(): Promise<void> {
    await this.shelterData.refresh();
  }

  /** Re-reads the event master after a failed load (Retry button). */
  async retryEventsLoad(): Promise<void> {
    await this.eventService.load();
  }
  private readonly route = inject(ActivatedRoute);

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
      void this.loadEvent(preselected);
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
    this.resultRows.set(response.data.results);
    this.resultEventIds.set(
      new Set(response.data.results.map(row => row.eventId)),
    );
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
   * No sorting, no place column and no totals: this is a projection of the
   * finalized score records and nothing more.
   */
  readonly results = computed<ResultRow[]>(() => {
    const event = this.selectedEvent();
    if (!event) return [];

    // Rank the FULL finalized set first — positions must not renumber when
    // the search field filters the view (equal scores share a position:
    // 1, 2, 2, 4) — then apply the search filter.
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
 * Competition ranking, highest score first: ties share a position and the
 * next position skips (1, 2, 2, 4) — the same rule the winners report uses.
 */
export function rankResultRows(rows: ListResultRow[]): RankedResultRow[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  let position = 0;
  let prevScore: number | null = null;

  return sorted.map((row, index) => {
    if (prevScore === null || row.score < prevScore) {
      position = index + 1;
      prevScore = row.score;
    }
    return { row, position };
  });
}
