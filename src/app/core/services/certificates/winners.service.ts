import { Injectable, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import { ProgramContextService } from '../program/program-context.service';

/**
 * Winners report for the Certificate Team.
 *
 * One backend read (`listWinners`) returns every finalized event in the
 * session's programme/environment with its top-three ranked entries. The
 * certificate team writes certificates by hand from this list — nothing on
 * this page generates or mutates certificate records.
 */
export interface WinnerMember {
  participantId: string;
  name: string;
  age: string;
  className: string;
  level: string;
}

export interface WinnerRow {
  position: number;
  name: string;
  /** Participant age as displayed ("9"); empty when not applicable (teams). */
  age: string;
  className: string;
  level: string;
  shelterHomeName: string;
  score: number;
  /** Stable id of the finalized score row (the distribution tracking reference). */
  scoreId: string;
  participantId: string;
  teamId: string;
  /** PRESENT roster members of a team winner (never absent/unmarked members). */
  members: WinnerMember[];
}

export interface WinnersEventGroup {
  eventId: string;
  eventCode: string;
  eventName: string;
  category: string;
  mode: string;
  eventStatus: string;
  winners: WinnerRow[];
}

/** A calculated (finalized) result that is NOT yet reviewer-accepted. */
export interface PendingApprovalEvent {
  eventId: string;
  eventCode: string;
  eventName: string;
  /** 'RETURNED' when the reviewer sent it back; null when never reviewed. */
  decision: string | null;
  calculatedWinnerCount: number;
}

export interface WinnersReport {
  events: WinnersEventGroup[];
  totalEvents: number;
  totalWinners: number;
  /** Calculated-but-unaccepted results: never winners, reported as pending. */
  pendingApprovalEvents?: PendingApprovalEvent[];
}

@Injectable({ providedIn: 'root' })
export class WinnersService {
  private readonly apiClient = inject(ApiClientService);
  private readonly programContext = inject(ProgramContextService);
  private readonly report = signal<WinnersReport | null>(null);
  private readonly loading = signal(false);
  private readonly error = signal('');

  constructor() {
    // Winners are scoped; a programme/zone switch drops the cached report
    // so another zone's winners are never displayed.
    this.programContext.onScopeChange(() => {
      this.report.set(null);
      this.loading.set(false);
      this.error.set('');
    });
  }

  readonly report$ = this.report.asReadonly();
  readonly loading$ = this.loading.asReadonly();
  readonly error$ = this.error.asReadonly();

  async load(force = false): Promise<WinnersReport | null> {
    if (this.loading()) return this.report();
    if (!force && this.report()) return this.report();

    this.loading.set(true);
    this.error.set('');

    try {
      const scopeVersion = this.programContext.scopeVersion();
      const response = await this.apiClient.listWinners();

      if (this.programContext.scopeVersion() !== scopeVersion) {
        // Scope changed while this read was in flight: never land the
        // previous zone's winners.
        return null;
      }

      if (!response.success) {
        this.error.set(response.error.message);
        return null;
      }
      this.report.set(response.data);
      return response.data;
    } catch {
      this.error.set('The winners report could not be read from the backend.');
      return null;
    } finally {
      this.loading.set(false);
    }
  }
}
