import { ParticipantLevel } from './participant.model';

export type EventCategory = 'ARTS' | 'LITERARY' | 'CULTURAL';
export type EventMode = 'SOLO' | 'GROUP';
export type EventStatus = 'ACTIVE' | 'CANCELLED' | 'INACTIVE';

export interface Event {
  id: string;
  eventCode: string;
  name: string;
  category: EventCategory;
  mode: EventMode;
  eligibleLevels: ParticipantLevel[];
  minimumTeamSize?: number;
  maximumTeamSize?: number;
  status: EventStatus;
  schedule?: string;
  venue?: string;
  createdAt: string;
  updatedAt: string;
}
