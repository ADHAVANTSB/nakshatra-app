import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Event, EventCategory, Participant, Score, Team } from '../../core/models';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ScoringService } from '../../core/services/scoring/scoring.service';
import { TeamService } from '../../core/services/teams/team.service';

interface ResultRow {
  score: Score;
  participant?: Participant;
  team?: Team;
}

@Component({
  selector: 'nk-results',
  imports: [DatePipe, FormsModule],
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class Results {
  private readonly eventService = inject(EventService);
  private readonly scoringService = inject(ScoringService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);

  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly category = signal<EventCategory | ''>('');
  readonly search = signal('');

  readonly filteredEvents = computed(() => this.events().filter(event =>
    !this.category() || event.category === this.category()
  ));

  readonly selectedEvent = computed(() => this.selectedEventId()
    ? this.eventService.getById(this.selectedEventId())
    : undefined);

  readonly results = computed<ResultRow[]>(() => {
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
      }))
      .filter(row => this.matchesSearch(row, query));
  });

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

  setEvent(eventId: string): void {
    this.selectedEventId.set(eventId);
    this.search.set('');
  }

  setSearch(value: string): void {
    this.search.set(value);
  }

  eventModeLabel(event: Event): string {
    return event.mode === 'SOLO' ? 'Individual' : 'Group';
  }

  private matchesSearch(row: ResultRow, query: string): boolean {
    if (!query) return true;
    const values = row.participant
      ? [row.participant.fullName, row.participant.participantCode, row.participant.shelterHomeId]
      : [row.team?.name ?? '', row.team?.teamCode ?? ''];
    return values.some(value => value.toLowerCase().includes(query));
  }
}
