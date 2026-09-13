import { Injectable, inject, signal } from '@angular/core';
import { Score } from '../../models';
import { EventService } from '../events/event.service';
import { ParticipantEventService } from '../events/participant-event.service';
import { ParticipantService } from '../participants/participant.service';
import { TeamService } from '../teams/team.service';

export interface ScoreResult { success: boolean; score?: Score; errors: string[]; }

@Injectable({ providedIn: 'root' })
export class ScoringService {
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);
  private readonly scores = signal<Score[]>([]);
  readonly scores$ = this.scores.asReadonly();

  getByEvent(eventId: string): Score[] { return this.scores().filter(score => score.eventId === eventId); }
  getParticipantScore(eventId: string, participantId: string): Score | undefined {
    return this.scores().find(score => score.eventId === eventId && score.participantId === participantId);
  }
  getTeamScore(eventId: string, teamId: string): Score | undefined {
    return this.scores().find(score => score.eventId === eventId && score.teamId === teamId);
  }

  saveParticipantScore(eventId: string, participantId: string, value: number, finalize = false, updatedBy = 'ADMIN'): ScoreResult {
    return this.saveScore(eventId, value, finalize, updatedBy, participantId);
  }
  saveTeamScore(eventId: string, teamId: string, value: number, finalize = false, updatedBy = 'ADMIN'): ScoreResult {
    return this.saveScore(eventId, value, finalize, updatedBy, undefined, teamId);
  }

  private saveScore(eventId: string, value: number, finalize: boolean, updatedBy: string, participantId?: string, teamId?: string): ScoreResult {
    const errors = this.validateTarget(eventId, participantId, teamId);
    if (!Number.isFinite(value)) errors.push('Enter a valid numeric score.');
    if (errors.length) return { success: false, errors };

    const existing = participantId
      ? this.getParticipantScore(eventId, participantId)
      : this.getTeamScore(eventId, teamId!);
    if (existing?.status === 'FINALIZED') return { success: false, errors: ['This score is finalized and cannot be edited.'] };
    const now = new Date().toISOString();
    const score: Score = existing ? { ...existing, value, status: finalize ? 'FINALIZED' : 'DRAFT', version: existing.version + 1, updatedAt: now, updatedBy } : {
      id: `SCORE-${Date.now()}`, eventId, participantId, teamId, value,
      status: finalize ? 'FINALIZED' : 'DRAFT', version: 1,
      createdAt: now, createdBy: updatedBy, updatedAt: now, updatedBy
    };
    this.scores.update(current => existing ? current.map(item => item.id === existing.id ? score : item) : [...current, score]);
    return { success: true, score, errors: [] };
  }

  private validateTarget(eventId: string, participantId?: string, teamId?: string): string[] {
    const event = this.eventService.getById(eventId);
    if (!event) return ['Event not found.'];
    if (event.status !== 'ACTIVE') return ['Scoring is only available for an active event.'];
    if (event.mode === 'SOLO') {
      if (!participantId || teamId) return ['Individual events must be scored for a registered participant.'];
      const participant = this.participantService.getParticipantById(participantId);
      if (!participant) return ['Participant not found.'];
      if (!this.registrationService.isAlreadyRegistered(participantId, eventId)) {
        return ['Participant is not registered for this event.'];
      }
      if (participant.eligibilityStatus !== 'ELIGIBLE') {
        return ['Participant is not eligible for this event.'];
      }
      if (participant.validationStatus === 'FAILED') {
        return ['Participant validation has failed.'];
      }
      if (participant.level && !event.eligibleLevels.includes(participant.level)) {
        return ['Participant level is not eligible for this event.'];
      }
      return [];
    }
    if (!teamId || participantId) return ['Group events must be scored for a valid team.'];
    const team = this.teamService.getById(teamId);
    if (!team || team.eventId !== eventId) return ['Team does not belong to this event.'];
    const validation = this.teamService.validateTeam(teamId);
    return validation.valid ? [] : validation.errors.map(error => error.message);
  }
}
