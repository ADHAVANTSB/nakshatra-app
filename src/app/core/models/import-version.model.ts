export type ImportStatus =
  | 'IMPORTED'
  | 'VALIDATION_FAILED'
  | 'READY_FOR_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUPERSEDED';

export interface ImportVersion {
  id: string;
  shelterHomeId: string;
  sheetSourceId: string;
  versionNumber: number;
  importedAt: string;
  importedBy: string;
  status: ImportStatus;
  sourceHash?: string;
  recordCount: number;
  errorCount: number;
  warningCount: number;
  validationStatus?: 'NOT_VALIDATED' | 'PASSED' | 'FAILED' | 'WARNING';
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  lockStatus?: 'UNLOCKED' | 'LOCKED';
  lockedAt?: string;
  lockedBy?: string;
  unlockReason?: string;
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
}
