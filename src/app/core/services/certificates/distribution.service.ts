import { Injectable, inject, signal } from '@angular/core';
import {
  DistributionAwardType,
  DistributionTrackingEntry,
  DistributionTrackingStorage,
} from '../../models';
import { ApiClientService } from '../api/api-client.service';

export interface DistributionSaveResult {
  success: boolean;
  entry?: DistributionTrackingEntry;
  error?: { code: string; message: string };
}

export interface DistributionReadError {
  code: string;
  message: string;
}

/**
 * Physical distribution tracking (medals and certificates handed to
 * winners). Persisted state only: the backend is authoritative for every
 * status, timestamp and recording user, and it reports storage health
 * explicitly so a missing table never reads as "nothing recorded".
 */
@Injectable({ providedIn: 'root' })
export class DistributionService {
  private readonly apiClient = inject(ApiClientService);

  private readonly entriesState = signal<DistributionTrackingEntry[]>([]);
  private readonly storageState = signal<DistributionTrackingStorage | null>(null);
  private readonly loadingState = signal(false);
  private readonly readErrorState = signal<DistributionReadError | null>(null);

  readonly entries$ = this.entriesState.asReadonly();
  readonly storage$ = this.storageState.asReadonly();
  readonly loading$ = this.loadingState.asReadonly();
  readonly readError$ = this.readErrorState.asReadonly();

  /** How many winner+award records are currently marked distributed. */
  recordedCount(): number {
    return this.entriesState().filter(entry => entry.distributed).length;
  }

  /** The backend-confirmed record for one winner and award (or null). */
  entryFor(
    scoreId: string,
    awardType: DistributionAwardType,
  ): DistributionTrackingEntry | null {
    return (
      this.entriesState().find(
        entry => entry.scoreId === scoreId && entry.awardType === awardType,
      ) ?? null
    );
  }

  /**
   * Reads the distribution state for the eligible finalized winners in
   * scope. A failed read keeps the winners page usable: the caller shows
   * the read error and never a false "not distributed" default.
   */
  async load(force = false): Promise<boolean> {
    if (this.loadingState()) return false;
    if (!force && this.storageState()) return true;

    this.loadingState.set(true);
    this.readErrorState.set(null);

    try {
      const response = await this.apiClient.listDistributionTracking();

      if (!response.success) {
        this.readErrorState.set({
          code: response.error.code,
          message: response.error.message,
        });
        return false;
      }

      const data = response.data as Partial<{
        storage: DistributionTrackingStorage;
        distributions: DistributionTrackingEntry[];
      }> | null;

      // A response without explicit storage health is unusable: showing
      // it as "no distributions recorded" would hide a real problem.
      if (!data?.storage || !Array.isArray(data.distributions)) {
        this.readErrorState.set({
          code: 'INVALID_DISTRIBUTION_TRACKING_RESPONSE',
          message:
            'The backend returned an unexpected distribution tracking response. The deployed backend is likely out of date — please ask your administrator to update the backend.',
        });
        return false;
      }

      this.storageState.set(data.storage);
      this.entriesState.set(data.distributions);
      return true;
    } catch {
      this.readErrorState.set({
        code: 'NETWORK_ERROR',
        message: 'We couldn’t load this information right now. Please try again later.',
      });
      return false;
    } finally {
      this.loadingState.set(false);
    }
  }

  /**
   * Records or corrects one physical hand-over. The backend upsert is
   * idempotent, so a retry can never duplicate a record; the returned
   * entry is the confirmed state (server timestamp + recorder included).
   */
  async save(
    scoreId: string,
    awardType: DistributionAwardType,
    distributed: boolean,
    expectedVersion?: number,
  ): Promise<DistributionSaveResult> {
    const response = await this.apiClient.saveDistributionStatus({
      scoreId,
      awardType,
      distributed,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    });

    if (!response.success) {
      return {
        success: false,
        error: { code: response.error.code, message: response.error.message },
      };
    }

    const entry = (response.data as { distribution?: DistributionTrackingEntry } | null)
      ?.distribution;

    if (!entry) {
      return {
        success: false,
        error: {
          code: 'INVALID_DISTRIBUTION_SAVE_RESPONSE',
          message:
            'The backend returned an unexpected distribution response. The deployed backend is likely out of date — please ask your administrator to update the backend.',
        },
      };
    }

    this.entriesState.update(current => [
      ...current.filter(
        existing =>
          !(existing.scoreId === entry.scoreId && existing.awardType === entry.awardType),
      ),
      entry,
    ]);

    return { success: true, entry };
  }
}
