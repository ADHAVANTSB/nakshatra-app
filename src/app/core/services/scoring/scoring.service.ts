import { Injectable, inject, signal } from '@angular/core';

import { Score } from '../../models';
import { ApiClientService } from '../api/api-client.service';
import { ProgramContextService } from '../program/program-context.service';

export interface ScoreLoadState {
  status: 'IDLE' | 'LOADING' | 'LOADED' | 'ERROR';
  error: string;
}

export interface FinalizeEventResult {
  success: boolean;
  data?: {
    eventId: string;
    operationId: string;
    alreadyFinalized: boolean;
    finalizedCount: number;
    totalScores: number;
  };
  errorCode?: string;
  errorMessage?: string;
  error?: { code: string; message: string };
}

export interface ReopenEventResult {
  success: boolean;
  data?: {
    eventId: string;
    reopenedCount: number;
    reason: string;
    existingCertificates: { generated: number; issued: number };
  };
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Scores (read cache + the one official finalization path).
 *
 * The only authoritative scoring workflow is judge-based: judges submit
 * per-judge scores (`saveJudgeScores`) and the backend writes the official
 * score (the average of submitted judge totals) into the Scores rows. This
 * service reads those rows for display and drives `finalizeEvent` /
 * `reopenEventScores` — the single official finalization path. The local
 * signal is only a read cache of what the backend has confirmed; it is never
 * the system of record and nothing here writes a score.
 */
@Injectable({ providedIn: 'root' })
export class ScoringService {
  private readonly apiClient = inject(ApiClientService);
  private readonly programContext = inject(ProgramContextService);

  private readonly scores = signal<Score[]>([]);
  private readonly loadStates = signal<Record<string, ScoreLoadState>>({});
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor() {
    // Scores belong to one programme/zone scope; a switch drops them so a
    // previous zone's rows can never be displayed or aggregated again.
    this.programContext.onScopeChange(() => {
      this.scores.set([]);
      this.loadStates.set({});
      this.pending.clear();
    });
  }

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
    const scopeVersion = this.programContext.scopeVersion();
    this.setLoadState(eventId, { status: 'LOADING', error: '' });

    const response = await this.apiClient.listScores(eventId);

    if (this.programContext.scopeVersion() !== scopeVersion) {
      // Scope changed while this read was in flight: never land old-zone rows.
      return false;
    }

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

  /**
   * Presentation lock for a finalized event: every persisted score the backend
   * holds for the event is FINALIZED. An event with no read scores is never
   * treated as finalized, so the lock can only tighten as facts arrive.
   */
  isEventFinalized(eventId: string): boolean {
    const scores = this.getByEvent(eventId);
    return scores.length > 0 && scores.every(score => score.status === 'FINALIZED');
  }

  /** The persisted (official) score row for one participant of an event. */
  getParticipantScore(eventId: string, participantId: string): Score | undefined {
    return this.scores().find(
      score => score.eventId === eventId && score.participantId === participantId
    );
  }

  /** The persisted (official) score row for one team of an event. */
  getTeamScore(eventId: string, teamId: string): Score | undefined {
    return this.scores().find(score => score.eventId === eventId && score.teamId === teamId);
  }

  /** Controlled event-level finalization (idempotent on the backend). */
  async finalizeEventScores(eventId: string, operationId?: string): Promise<FinalizeEventResult> {
    const response = await this.apiClient.finalizeEvent(operationId ? { eventId, operationId } : { eventId });
    if (!response.success) {
      return { success: false, errorCode: response.error.code, errorMessage: response.error.message, error: response.error };
    }
    await this.loadScores(eventId, true);
    return { success: true, data: response.data };
  }

  /** Reopens a finalized event's scores with a mandatory reason. */
  async reopenEventScores(eventId: string, reason: string): Promise<ReopenEventResult> {
    const response = await this.apiClient.reopenEventScores({ eventId, reason });
    if (!response.success) {
      return { success: false, errorCode: response.error.code, errorMessage: response.error.message };
    }
    await this.loadScores(eventId, true);
    return { success: true, data: response.data };
  }
}
