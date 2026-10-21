/**
 * Permanent shelter-home deletion - backend contracts.
 *
 * Deletion is the single lifecycle exit (archive/restore was retired).
 * It is destructive and gated: ADMIN only, a non-empty reason, the
 * explicit confirm=<homeCode> token and the deployment authorization
 * switch. A verified recoverable backup is written before any removal;
 * official history (finalized results, issued certificates, distribution
 * evidence, audit) is retained. Field names mirror the backend exactly;
 * raw spreadsheet ids are never returned and never modeled - only the
 * redacted source reference.
 */

import { SourceWriteBackResult } from './api.model';

/** One table's planned deletion/retention counts in the manifest. */
export interface ShelterHomeDeletionTableCount {
  delete: number;
  retain: number;
  class: string;
  reason: string;
}

/** `previewShelterHomeDeletion` per-home manifest entry. Read-only. */
export interface ShelterHomeDeletionPlanEntry {
  shelterHomeId: string;
  homeCode: string;
  homeName: string;
  programId: string;
  environmentId: string;
  homeStatus: string;
  sheetConfirmation: string;
  source: {
    spreadsheetName: string;
    sourceStatus: string;
    sourceRefRedacted: string;
  };
  counts: Record<string, ShelterHomeDeletionTableCount>;
  sharedUntouched: Record<string, number>;
  deletableRows: number;
  retainedRows: number;
  sourceReuseEligible: boolean;
  backupStorageReady: boolean;
  validation: string;
  blockers: string[];
}

/** One already-deleted home as recorded in the backup ledger. */
export interface ShelterHomeDeletionLedgerEntry {
  backupId: string;
  shelterHomeId: string;
  homeCode: string;
  homeName: string;
  programId: string;
  environmentId: string;
  sourceRefRedacted: string;
  backupVerified: boolean;
  deletedAt: string;
}

/** `previewShelterHomeDeletion` response (dry-run CLEANUP MANIFEST). */
export interface ShelterHomeDeletionPreviewData {
  dryRun: boolean;
  generatedAt: string;
  authorized?: boolean;
  approvalSteps?: string[];
  backupStorageReady?: boolean;
  homes: ShelterHomeDeletionPlanEntry[];
  deletedHomes: ShelterHomeDeletionLedgerEntry[];
}

export interface ShelterHomeIdPayload {
  shelterHomeId: string;
}

export interface DeleteShelterHomePayload {
  shelterHomeId: string;
  reason: string;
  confirm: string;
  expectedVersion?: number;
}

/** `deleteShelterHome` response. Idempotent: `alreadyDeleted` repeats. */
export interface DeleteShelterHomeData {
  shelterHomeId: string;
  alreadyDeleted?: boolean;
  backupId: string;
  backupVerified: boolean;
  deletedAt?: string;
  deleted: number;
  retained: number;
  deletedCounts?: Record<string, number>;
  retainedCounts?: Record<string, number>;
}

/** `reconcileParticipantSheetWrites` response. */
export interface ReconcileParticipantSheetWritesData {
  participantId: string;
  reconciled: boolean;
  sheetsSynchronized: boolean;
  reasons: string[];
  source: SourceWriteBackResult;
  eventWise: Record<string, unknown>;
}

export interface ReconcileParticipantSheetWritesPayload {
  participantId: string;
}
