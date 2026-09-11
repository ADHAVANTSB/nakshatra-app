import { ApprovalStatus, LockStatus, ValidationStatus } from './common.model';

export type Gender = 'MALE' | 'FEMALE';
export type ParticipantLevel = 'SUB_JUNIOR' | 'JUNIOR' | 'SENIOR' | 'SUPER_SENIOR';
export type EligibilityStatus = 'ELIGIBLE' | 'INELIGIBLE' | 'PENDING';

export interface Participant {
  id: string;
  participantCode: string;
  shelterHomeId: string;
  fullName: string;
  gender: Gender;
  age: number;
  standard: number;
  /** Calculated by Nakshatra; never directly editable. */
  level: ParticipantLevel | null;
  eligibilityStatus: EligibilityStatus;
  validationStatus: ValidationStatus;
  approvalStatus: ApprovalStatus;
  lockStatus: LockStatus;
  version: number;
  sourceVersionId?: string;
  sourceRowNumber?: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
