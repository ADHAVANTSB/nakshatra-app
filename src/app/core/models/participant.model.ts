import { ApprovalStatus, LockStatus, ValidationStatus } from './common.model';

export type Gender = 'MALE' | 'FEMALE';
export type ParticipantLevel = 'SUB_JUNIOR' | 'JUNIOR' | 'SENIOR' | 'SUPER_SENIOR';
export type EligibilityStatus = 'ELIGIBLE' | 'INELIGIBLE' | 'PENDING';

/**
 * Source-row lifecycle of a participant record. `SOURCE_REMOVED` marks a
 * participant whose source sheet row disappeared in a complete, validated
 * sync: the record is kept for history only (registrations, attendance,
 * scores and certificates are never touched) and is excluded from the
 * active roster and active counts. A missing value reads as ACTIVE.
 */
export type ParticipantRowStatus = 'ACTIVE' | 'SOURCE_REMOVED';

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
  /** Source-row lifecycle; absent/blank reads as ACTIVE. */
  rowStatus?: ParticipantRowStatus;
  version: number;
  sourceVersionId?: string;
  sourceRowNumber?: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}