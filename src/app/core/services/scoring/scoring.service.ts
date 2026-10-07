import { Injectable, inject, signal } from '@angular/core';

import { Score, SourceWriteBackResult } from '../../models';
import { ApiClientService } from '../api/api-client.service';
import { EventService } from '../events/event.service';
import { ParticipantEventService } from '../events/participant-event.service';
import { ParticipantService } from '../participants/participant.service';
import { TeamService } from '../teams/team.service';

export interface ScoreLoadState {
  status: 'IDLE' | 'LOADING' | 'LOADED' | 'ERROR';
  error: string;
}

export interface ScoreResult {
  success: boolean;
  score?: Score;
  errors: string[];
  errorCode?: string;
  sourceWriteBack?: SourceWriteBackResult;
}

/**
 * Scores.
 *
 * Drafts and finalization are persisted by the backend (`saveScore` /
 * `finalizeScore`). The local signal is only a read cache of what the backend
 * has confirmed; it is never the system of record and a save is never reported
 * as successful unless the backend accepted it.
 */
@Injectable({ providedIn: 'root' })
export class ScoringService {
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);
  private readonly apiClient = inject(ApiClientService);

  private readonly scores = signal<Score[]>([]);
  private readonly loadStates = signal<Record<string, ScoreLoadState>>({});
  private readonly pending = new Map<string, Promise<boolean>>();

  readonly scores$ = this.scores.asReadonly();

  /** Load state for one event's scores; distinguishes empty from failed. */
  loadState(eventId: string): ScoreLoadState {
    return this.loadStates()[eventId] ?? { status: 'IDLE', error: '' };
  }

  /**
   * Reads persisted scores for one event via `listScores`. Concurrent callers
   * share one request; a cached result is reused unless `force` is set.
   */
  loadScores(eventId: string, force = false): Promise<boolean> {
    const inFlight = this.pending.get(eventId);

    if (inFlight) {
      return inFlight;
    }

    if (!force && this.loadState(eventId).status === 'LOADED') {
      return Promise.resolve(true);
    }

    const request = this.fetchScores(eventId).finally(() => {
      this.pending.delete(eventId);
    });

    this.pending.set(eventId, request);
    return request;
  }

  private async fetchScores(eventId: string): Promise<boolean> {
    this.setLoadState(eventId, { status: 'LOADING', error: '' });

    const response = await this.apiClient.listScores(eventId);

    if (!response.success) {
      this.setLoadState(eventId, { status: 'ERROR', error: response.error.message });
      return false;
    }

    this.replaceScores(
      eventId,
      response.data.scores.filter(score => score.eventId === eventId)
    );
    this.setLoadState(eventId, { status: 'LOADED', error: '' });
    return true;
  }

  private setLoadState(eventId: string, state: ScoreLoadState): void {
    this.loadStates.update(current => ({ ...current, [eventId]: state }));
  }

  /** Replaces the cached scores for one event with a backend-confirmed set. */
  replaceScores(eventId: string, scores: Score[]): void {
    this.scores.update(current => [
      ...current.filter(score => score.eventId !== eventId),
      ...scores,
    ]);
  }

  getByEvent(eventId: string): Score[] {
    return this.scores().filter(score => score.eventId === eventId);
  }

  getParticipantScore(eventId: string, participantId: string): Score | undefined {
    return this.scores().find(
      score => score.eventId === eventId && score.participantId === participantId
    );
  }

  getTeamScore(eventId: string, teamId: string): Score | undefined {
    return this.scores().find(score => score.eventId === eventId && score.teamId === teamId);
  }

  /** Persists a draft score through the backend. */
  async saveParticipantScore(
    eventId: string,
    participantId: string,
    value: number
  ): Promise<ScoreResult> {
    return this.write('saveScore', eventId, { participantId }, value);
  }

  async saveTeamScore(eventId: string, teamId: string, value: number): Promise<ScoreResult> {
    return this.write('saveScore', eventId, { teamId }, value);
  }

  /** Finalizes a score. A finalized score can no longer be edited. */
  async finalizeParticipantScore(
    eventId: string,
    participantId: string,
    value: number
  ): Promise<ScoreResult> {
    return this.write('finalizeScore', eventId, { participantId }, value);
  }

  async finalizeTeamScore(
    eventId: string,
    teamId: string,
    value: number
  ): Promise<ScoreResult> {
    return this.write('finalizeScore', eventId, { teamId }, value);
  }

  private async write(
    action: 'saveScore' | 'finalizeScore',
    eventId: string,
    target: { participantId: string } | { teamId: string },
    value: number
  ): Promise<ScoreResult> {
    const errors = this.validateTarget(eventId, 'participantId' in target ? target.participantId : undefined, 'teamId' in target ? target.teamId : undefined);

    if (errors.length) {
      return { success: false, errors };
    }

    if (!Number.isFinite(value)) {
      return { success: false, errors: ['Enter a valid numeric score.'] };
    }

    const existing = 'participantId' in target
      ? this.getParticipantScore(eventId, target.participantId)
      : this.getTeamScore(eventId, target.teamId);

    if (existing?.status === 'FINALIZED') {
      return {
        success: false,
        errors: ['This score is finalized and cannot be edited.'],
        errorCode: 'SCORE_FINALIZED',
      };
    }

    const payload = {
      eventId,
      ...target,
      value,
      ...(existing ? { expectedVersion: existing.version } : {}),
    };

    const response = action === 'saveScore'
      ? await this.apiClient.saveScore(payload)
      : await this.apiClient.finalizeScore(payload);

    if (!response.success) {
      return { success: false, errors: [response.error.message], errorCode: response.error.code };
    }

    const score = response.data.score;
    const sourceWriteBack: SourceWriteBackResult | undefined =
      'sourceWriteBack' in response.data
        ? response.data.sourceWriteBack as SourceWriteBackResult | undefined
        : undefined;

    this.replaceScores(eventId, [
      ...this.getByEvent(eventId).filter(item => item.id !== score.id),
      score,
    ]);

    // Re-read the persisted set so other entries' versions are current too.
    await this.loadScores(eventId, true);

    return {
      success: true,
      score,
      errors: [],
      sourceWriteBack,
    };
  }

  /**
   * Admissibility of a scoring target.
   *
   * A finalized score is immutable; every other check mirrors the registration
   * and team rules so only valid, registered entries can be scored.
   */
  private validateTarget(
    eventId: string,
    participantId?: string,
    teamId?: string
  ): string[] {
    const event = this.eventService.getById(eventId);

    if (!event) {
      return ['Event not found.'];
    }

    if (event.status !== 'ACTIVE') {
      return ['Scoring is only available for an active event.'];
    }

    if (event.mode === 'SOLO') {
      if (!participantId || teamId) {
        return ['Individual events must be scored for a registered participant.'];
      }

      const participant = this.participantService.getParticipantById(participantId);

      if (!participant) {
        return ['Participant not found.'];
      }

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

    if (!teamId || participantId) {
      return ['Group events must be scored for a valid team.'];
    }

    const team = this.teamService.getById(teamId);

    if (!team || team.eventId !== eventId) {
      return ['Team does not belong to this event.'];
    }

    const validation = this.teamService.validateTeam(teamId);

    return validation.valid ? [] : validation.errors.map(error => error.message);
  }
}
