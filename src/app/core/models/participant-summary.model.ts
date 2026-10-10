import { EventCategory, EventMode } from './event.model';

/**
 * Batch participant event summaries — backend `getParticipantEventSummaries`.
 *
 * One request covers many participants (per-home filter optional); the
 * frontend must never fire one request per participant. Only REGISTERED
 * rows are counted by the backend, so cancelled registrations never appear
 * in active counts. Issues are reported, never repaired silently.
 */

/** One active registered event inside a summary. */
export interface ParticipantEventSummaryEvent {
  eventId: string;
  eventName: string;
  category: EventCategory | string;
  mode: EventMode | string;
  registrationStatus: string;
}

/** Per-participant summary exactly as the backend returned it. */
export interface ParticipantEventSummaryEntry {
  participantId: string;
  participantCode: string;
  fullName: string;
  events: ParticipantEventSummaryEvent[];
  activeEventCount: number;
  artsCount: number;
  literaryCount: number;
  culturalCount: number;
  soloCount: number;
}

/** Duplicate/missing-reference issues reported by the backend. */
export interface ParticipantEventSummaryIssue {
  code: string;
  participantId: string;
  eventId?: string;
  count?: number;
}

export interface ParticipantEventSummariesData {
  summaries: ParticipantEventSummaryEntry[];
  issues: ParticipantEventSummaryIssue[];
}

export interface ParticipantEventSummariesPayload {
  shelterHomeId?: string;
  participantIds?: string[];
}
