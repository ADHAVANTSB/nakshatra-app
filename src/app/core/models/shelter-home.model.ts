import { ApprovalStatus, LockStatus, RecordStatus, ValidationStatus } from './common.model';

export type TransportationType = 'OWN_TRANSPORT' | 'TO_BE_ARRANGED';

/**
 * Frontend read model for a backend-connected shelter home.
 *
 * Optional fields are optional because the backend contract does not provide
 * them for every home; they are never fabricated from unrelated data.
 */
export interface ShelterHome {
  id: string;
  homeCode: string;
  name: string;
  address: string;
  contactName?: string;
  contactPhone: string;
  spreadsheetName?: string;
  /** Backend-supplied link that opens the connected sheet. Never built locally. */
  spreadsheetOpenUrl?: string;
  sourceStatus?: string;
  currentImportVersionId?: string;
  lastSyncedAt?: string;
  transportationType: TransportationType;
  status: RecordStatus;
  validationStatus?: ValidationStatus;
  approvalStatus?: ApprovalStatus;
  lockStatus?: LockStatus;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
