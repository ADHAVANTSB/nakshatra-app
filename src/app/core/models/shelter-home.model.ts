import { ApprovalStatus, LockStatus, RecordStatus, ValidationStatus } from './common.model';

export type TransportationType = 'OWN_TRANSPORT' | 'TO_BE_ARRANGED';

export interface ShelterHome {
  id: string;
  homeCode: string;
  name: string;
  address: string;
  contactPhone: string;
  transportationType: TransportationType;
  status: RecordStatus;
  validationStatus: ValidationStatus;
  approvalStatus: ApprovalStatus;
  lockStatus: LockStatus;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
