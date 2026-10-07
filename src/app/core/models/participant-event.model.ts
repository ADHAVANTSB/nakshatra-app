import { DataSource } from './common.model';
import { EventCategory, EventMode } from './event.model';
import { Gender, ParticipantLevel } from './participant.model';

export type RegistrationStatus = 'REGISTERED' | 'CANCELLED' | 'WAITLISTED';

/**
 * A persisted ParticipantEvent.
 *
 * Identity is `participantId` + `eventId`. Audit fields are optional because the
 * backend may return a lean registration row. The `*Label` fields are populated
 * only when the backend inlines display data on the registration; callers must
 * fall back to resolving the participant/event from their own store when absent.
 */
export interface ParticipantEvent {
  id: string;
  participantId: string;
  eventId: string;
  registrationStatus: RegistrationStatus;
  source?: Extract<DataSource, 'GOOGLE_SHEET' | 'NAKSHATRA'>;
  sourceVersionId?: string;
  version: number;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;

  /** Denormalized participant fields, when supplied by the backend. */
  participantName?: string;
  participantCode?: string;
  shelterHomeId?: string;

  /** Denormalized event fields, when supplied by the backend. */
  eventName?: string;
  eventCode?: string;
  category?: EventCategory;
  mode?: EventMode;

  /** Denormalized participant attributes, when supplied by the backend. */
  gender?: Gender;
  level?: ParticipantLevel;
  age?: number;
  standard?: number;
}
