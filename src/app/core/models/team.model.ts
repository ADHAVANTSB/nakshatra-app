import { ValidationStatus } from './common.model';

export type TeamStatus =
  | 'DRAFT'
  | 'READY'
  | 'LOCKED'
  | 'CANCELLED';

export type TeamMemberStatus =
  | 'ACTIVE'
  | 'REMOVED';

export interface Team {
  id: string;
  teamCode: string;

  eventId: string;
  name: string;

  status: TeamStatus;

  validationStatus: ValidationStatus;

  version: number;

  createdAt: string;
  createdBy: string;

  updatedAt: string;
  updatedBy: string;
}

export interface TeamMember {
  id: string;

  teamId: string;
  participantId: string;

  status: TeamMemberStatus;

  joinedAt: string;
  joinedBy: string;

  removedAt?: string;
  removedBy?: string;
}