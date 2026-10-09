import { Injectable, inject, computed, signal } from '@angular/core';

import { SyncAllHomesHomeResult, SyncAllHomesJob } from '../../models';

import { ApiClientService } from '../api/api-client.service';
import { ShelterDataService } from '../shelter-homes/shelter-data.service';

export type SyncAllHomesRunState =
  | 'IDLE'
  | 'STARTING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'ERROR';

function isTerminalStatus(status: SyncAllHomesJob['status']): boolean {
  return status === 'COMPLETED'
    || status === 'COMPLETED_WITH_ERRORS'
    || status === 'FAILED';
}

/**
 * Frontend driver for the backend-managed Sync All Homes job.
 *
 * The backend owns the job state (`startSyncAllHomes` starts it and processes
 * the first chunk; `continueSyncAllHomes` processes the next chunk per call).
 * This service drives that loop until the job reports a terminal status, and
 * never stays busy indefinitely: the iteration cap is derived from
 * `totalHomes`, and every failure path lands in an explicit terminal state.
 *
 * No home is ever synced by the frontend itself — the backend performs every
 * sync inside a chunk; this service only reports what the backend returned.
 */
@Injectable({ providedIn: 'root' })
export class SyncAllHomesService {
  private readonly apiClient = inject(ApiClientService);
  private readonly shelterData = inject(ShelterDataService);

  readonly state = signal<SyncAllHomesRunState>('IDLE');
  readonly job = signal<SyncAllHomesJob | null>(null);
  readonly errorMessage = signal('');

  readonly running = computed(() =>
    this.state() === 'STARTING' || this.state() === 'RUNNING'
  );

  readonly progress = computed(() => {
    const job = this.job();
    return job ? { processed: job.processedHomes, total: job.totalHomes } : null;
  });

  readonly results = computed(() => this.job()?.results ?? []);

  /**
   * Starts (or adopts) a bulk sync job and drives it to a terminal state.
   * Safe to call repeatedly: a running job is never started twice.
   */
  async start(): Promise<void> {
    if (this.running()) {
      return;
    }

    this.state.set('STARTING');
    this.errorMessage.set('');

    const startResult = await this.apiClient.startSyncAllHomes();

    if (!startResult.success) {
      this.state.set('ERROR');
      this.errorMessage.set(startResult.error.message);
      return;
    }

    await this.driveJob(startResult.data.job);
  }

  private async driveJob(started: SyncAllHomesJob): Promise<void> {
    this.job.set(started);
    this.state.set('RUNNING');

    let current = started;
    let iterations = 0;
    // Each `continue` processes at least one home (chunkSize >= 1), so a
    // healthy loop terminates well inside this cap; a stuck backend can
    // never keep this service busy forever.
    const cap = current.totalHomes + 2;

    while (current.status === 'RUNNING' && iterations < cap) {
      iterations += 1;

      const result = await this.apiClient.continueSyncAllHomes(current.jobId);

      if (!result.success) {
        // A concurrent finisher can make a `continue` arrive after the job
        // completed; the status read decides instead of failing hard.
        const status = await this.apiClient.getSyncAllHomesStatus(current.jobId);

        if (status.success && status.data.job && isTerminalStatus(status.data.job.status)) {
          current = status.data.job;
          break;
        }

        this.state.set('ERROR');
        this.errorMessage.set(result.error.message);
        return;
      }

      current = result.data.job;
      this.job.set(current);
    }

    this.finish(current);
  }

  private finish(job: SyncAllHomesJob): void {
    this.job.set(job);

    if (job.status === 'COMPLETED' || job.status === 'COMPLETED_WITH_ERRORS') {
      this.state.set(job.status);
      this.refreshAffectedData(job.results);
      return;
    }

    if (job.status === 'RUNNING') {
      this.state.set('ERROR');
      this.errorMessage.set(
        'The sync job is still running on the backend. Check its status before starting again.'
      );
      return;
    }

    this.state.set('ERROR');
    this.errorMessage.set(
      job.results.some(result => result.error)
        ? job.results.filter(result => result.error).map(result => result.error!.message).join(' ')
        : 'The sync job ended without completing.'
    );
  }

  /** Re-reads only the cached data the completed job may have changed. */
  private refreshAffectedData(results: SyncAllHomesHomeResult[]): void {
    void this.shelterData.refreshAfterBulkSync(
      results
        .filter(result => result.status === 'SYNCED')
        .map(result => result.shelterHomeId)
    );
  }
}
