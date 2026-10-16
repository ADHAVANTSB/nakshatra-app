import { Injectable, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';

/**
 * Winners report for the Certificate Team.
 *
 * One backend read (`listWinners`) returns every finalized event in the
 * session's programme/environment with its top-three ranked entries. The
 * certificate team writes certificates by hand from this list — nothing on
 * this page generates or mutates certificate records.
 */
export interface WinnerRow {
  position: number;
  name: string;
  className: string;
  level: string;
  shelterHomeName: string;
  score: number;
  participantId: string;
  teamId: string;
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

export interface WinnersReport {
  events: WinnersEventGroup[];
  totalEvents: number;
  totalWinners: number;
}

@Injectable({ providedIn: 'root' })
export class WinnersService {
  private readonly apiClient = inject(ApiClientService);
  private readonly report = signal<WinnersReport | null>(null);
  private readonly loading = signal(false);
  private readonly error = signal('');

  readonly report$ = this.report.asReadonly();
  readonly loading$ = this.loading.asReadonly();
  readonly error$ = this.error.asReadonly();

  async load(force = false): Promise<WinnersReport | null> {
    if (this.loading()) return this.report();
    if (!force && this.report()) return this.report();

    this.loading.set(true);
    this.error.set('');

    try {
      const response = await this.apiClient.listWinners();
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
