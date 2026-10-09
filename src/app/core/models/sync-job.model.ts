/**
 * Sync All Homes — backend-managed bulk sync job.
 *
 * Shapes mirror `publicSyncAllJob` in the backend: internal bookkeeping
 * (pending slice, performing user) is never exposed and never modeled here.
 * Results are rendered exactly as the backend reported them; nothing is
 * inferred from a `RUNNING` status.
 */

export type SyncAllHomesJobStatus =
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'FAILED';

/** Per-home changes the backend counted during that home's sync. */
export interface SyncAllHomesResultChanges {
  createdParticipantCount: number;
  updatedParticipantCount: number;
  unchangedParticipantCount: number;
  createdRegistrationCount: number;
  updatedRegistrationCount: number;
  sourceChanged: boolean;
  reorderingDetected: boolean;
}

/** One home's outcome inside a sync job's results array. */
export interface SyncAllHomesHomeResult {
  shelterHomeId: string;
  status: 'SYNCED' | 'FAILED';
  changes?: SyncAllHomesResultChanges;
  error?: {
    code: string;
    message: string;
  };
}

/** The externally visible job state (backend `publicSyncAllJob`). */
export interface SyncAllHomesJob {
  jobId: string;
  status: SyncAllHomesJobStatus;
  chunkSize: number;
  totalHomes: number;
  processedHomes: number;
  results: SyncAllHomesHomeResult[];
  startedAt: string;
  updatedAt: string;
  finishedAt: string;
}

/** `startSyncAllHomes` / `continueSyncAllHomes` response. */
export interface SyncAllHomesData {
  alreadyRunning: boolean;
  job: SyncAllHomesJob;
}

/** `getSyncAllHomesStatus` response; no active job yields `job: null`. */
export interface SyncAllHomesStatusData {
  active: boolean;
  job: SyncAllHomesJob | null;
}

export interface StartSyncAllHomesPayload {
  chunkSize?: number;
}

export interface SyncAllHomesJobPayload {
  jobId: string;
}
