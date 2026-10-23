/**
 * Physical distribution tracking (medals and certificates handed to winners).
 *
 * This is a separate, later stage of the workflow:
 *   finalized -> generated -> issued (existing app workflow)
 *   -> PHYSICALLY distributed (this feature only).
 * A record here says a physical item reached a winner - it is never
 * implied by generation or issuance.
 */

export type DistributionAwardType = 'MEDAL' | 'CERTIFICATE_WRITTEN' | 'CERTIFICATE';

export interface ListDistributionTrackingPayload {
  eventId?: string;
}

/**
 * Storage health of the backend table. The page must never present a
 * missing/mismatched table as "no distributions recorded".
 */
export interface DistributionTrackingStorage {
  available: boolean;
  status: 'AVAILABLE' | 'TABLE_MISSING' | 'SCHEMA_INCOMPATIBLE';
  table: string;
  /** Plain-English reason (missing sheet / missing columns). */
  reason: string;
  /** The exact admin migration step for a missing or mismatched table. */
  migrationStep: string;
}

export interface DistributionTrackingEntry {
  id: string;
  scoreId: string;
  eventId: string;
  participantId: string;
  teamId: string;
  awardType: DistributionAwardType;
  distributed: boolean;
  /** Server-set on a hand-over; preserved as evidence after a correction. */
  distributedAt: string;
  /** User id of the recorder; display name is resolved server-side. */
  recordedBy: string;
  recordedByName: string;
  /** 0 = no row yet ("not distributed"). */
  version: number;
}

export interface ListDistributionTrackingData {
  storage: DistributionTrackingStorage;
  distributions: DistributionTrackingEntry[];
  recordedCount: number;
  totalWinners: number;
}

export interface SaveDistributionStatusPayload {
  scoreId: string;
  awardType: DistributionAwardType;
  distributed: boolean;
  /** Optimistic-concurrency check; omit for an idempotent retry. */
  expectedVersion?: number;
}

export interface SaveDistributionStatusData {
  distribution: DistributionTrackingEntry;
}
