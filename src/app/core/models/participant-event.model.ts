import { DataSource } from './common.model';

export type RegistrationStatus = 'REGISTERED' | 'CANCELLED' | 'WAITLISTED';

export interface ParticipantEvent {
  id: string;
  participantId: string;
  eventId: string;
  registrationStatus: RegistrationStatus;
  source: Extract<DataSource, 'GOOGLE_SHEET' | 'NAKSHATRA'>;
  sourceVersionId?: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
