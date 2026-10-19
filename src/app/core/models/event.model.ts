import { ParticipantLevel } from './participant.model';

export type EventCategory = 'ARTS' | 'LITERARY' | 'CULTURAL';
export type EventMode = 'SOLO' | 'GROUP';
export type EventStatus = 'ACTIVE' | 'CANCELLED' | 'INACTIVE';

/**
 * How judges score the event.
 *
 * `CRITERIA` has official per-criterion scoring, `SINGLE` is one event-level
 * overall score per judge (e.g. Potpourri, Quiz), and `PENDING` means the
 * official judging criteria have not been supplied yet — scoring stays closed
 * and no criteria are invented.
 */
export type EventScoringMode = 'CRITERIA' | 'SINGLE' | 'PENDING';

/** One official judging criterion as supplied by the backend. */
export interface EventCriterion {
  name: string;
  max: number;
}

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
  /** Absent rows are treated as PENDING: scoring opens only on official criteria. */
  scoringMode?: EventScoringMode;
  /** Official judging criteria; only rendered where the backend supplies them. */
  criteria?: EventCriterion[];
  createdAt: string;
  updatedAt: string;
}
