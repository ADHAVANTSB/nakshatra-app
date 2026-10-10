/**
 * Shelter-home archive lifecycle — backend round 2 contracts.
 *
 * Archive is a safe lifecycle operation: the home's status becomes ARCHIVED
 * and NO participant, registration, attendance, score, certificate or audit
 * record is ever deleted. Field names mirror the backend exactly; the raw
 * spreadsheet id is never returned and never modeled.
 */

import { SourceWriteBackResult } from './api.model';

/** Counts the backend computed for what an archive would affect. */
export interface ShelterHomeArchiveImpact {
  participantCount: number;
  activeRegistrationCount: number;
  attendanceCount: number;
  scoreCount: number;
  certificateCount: number;
  auditHistoryCount: number;
}

/** `previewShelterHomeArchive` response. Read-only; never writes or audits. */
export interface ShelterHomeArchivePreviewData {
  shelterHome: {
    id: string;
    homeCode: string;
    homeName: string;
    status: string;
  };
  source: {
    spreadsheetName: string;
    sourceStatus: string;
    spreadsheetOpenUrl: string;
  };
  impact: ShelterHomeArchiveImpact;
  triggerCleanupRequired: boolean;
}

export interface ShelterHomeIdPayload {
  shelterHomeId: string;
}

export interface ArchiveShelterHomePayload {
  shelterHomeId: string;
  expectedVersion?: number;
  reason?: string;
}

/** `archiveShelterHome` response. Idempotent: `alreadyArchived` repeats. */
export interface ArchiveShelterHomeData {
  shelterHomeId: string;
  status: 'ARCHIVED';
  alreadyArchived?: boolean;
  version: number;
  triggerRemoved: boolean;
  impact: ShelterHomeArchiveImpact;
}

export interface RestoreShelterHomePayload {
  shelterHomeId: string;
  expectedVersion?: number;
  reason?: string;
}

/**
 * `restoreShelterHome` response. `triggerReinstallRequired` is reported when
 * the restored home's connected source has no installed source-change
 * trigger — the frontend must display it, never claim triggers were restored.
 */
export interface RestoreShelterHomeData {
  shelterHomeId: string;
  status: string;
  alreadyActive?: boolean;
  version: number;
  triggerReinstallRequired: boolean;
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
