import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Attendance, Event, Participant, Score, Team } from '../../core/models';
import { AttendanceService } from '../../core/services/attendance/attendance.service';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ScoringService } from '../../core/services/scoring/scoring.service';
import { TeamService } from '../../core/services/teams/team.service';

interface ScoreTarget {
  participant?: Participant;
  team?: Team;
  attendance?: Attendance;
  score?: Score;
}

@Component({
  selector: 'nk-scoring',
  imports: [FormsModule],
  templateUrl: './scoring.html',
  styleUrl: './scoring.scss',
})
export class Scoring {
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly scoringService = inject(ScoringService);
  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly search = signal('');
  readonly errors = signal<string[]>([]);
  readonly message = signal('');
  readonly selectedEvent = computed(() => this.selectedEventId() ? this.eventService.getById(this.selectedEventId()) : undefined);
  readonly targets = computed<ScoreTarget[]>(() => {
    const event = this.selectedEvent(); const query = this.search().toLowerCase();
    if (!event) return [];
    if (event.mode === 'SOLO') return this.registrationService.getEventRegistrations(event.id)
      .map(item => this.participantService.getParticipantById(item.participantId))
      .filter((participant): participant is Participant => !!participant)
      .filter(participant => this.isValidParticipant(event, participant))
      .filter(participant => !query || participant.fullName.toLowerCase().includes(query) || participant.participantCode.toLowerCase().includes(query))
      .map(participant => ({ participant, score: this.scoringService.getParticipantScore(event.id, participant.id), attendance: this.attendanceService.getByParticipantEvent(participant.id, event.id) }));
    return this.teamService.getTeamsByEvent(event.id)
      .filter(team => this.teamService.validateTeam(team.id).valid)
      .filter(team => !query || team.name.toLowerCase().includes(query) || team.teamCode.toLowerCase().includes(query))
      .map(team => ({ team, score: this.scoringService.getTeamScore(event.id, team.id) }));
  });
  setEvent(id: string): void { this.selectedEventId.set(id); this.errors.set([]); this.message.set(''); }
  setSearch(value: string): void { this.search.set(value); }
  save(event: Event, target: { participant?: Participant; team?: Team }, rawValue: string, finalize: boolean): void {
    const value = Number(rawValue);
    const result = target.participant
      ? this.scoringService.saveParticipantScore(event.id, target.participant.id, value, finalize)
      : this.scoringService.saveTeamScore(event.id, target.team!.id, value, finalize);
    this.errors.set(result.errors); this.message.set(result.success ? `Score ${finalize ? 'finalized' : 'saved'}.` : '');
  }
  modeLabel(event: Event): string { return event.mode === 'SOLO' ? 'Individual' : 'Group'; }

  private isValidParticipant(event: Event, participant: Participant): boolean {
    return participant.eligibilityStatus === 'ELIGIBLE' &&
      participant.validationStatus !== 'FAILED' &&
      (!participant.level || event.eligibleLevels.includes(participant.level));
  }
}
