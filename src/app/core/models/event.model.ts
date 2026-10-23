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
  /**
   * SINGLE mode only: the official scale of the one overall score per judge
   * (Potpurri (Words Play) is out of 20; other SINGLE events keep 10).
   * null/absent for CRITERIA and PENDING events.
   */
  singleScoreMax?: number | null;
  /** Official judging criteria; only rendered where the backend supplies them. */
  criteria?: EventCriterion[];
  createdAt: string;
  updatedAt: string;
}

/** Catalogue-migration state reported with the events list (null = not an official catalogue scope). */
export interface CatalogueMigrationStatus {
  pending: boolean;
  missingRecordCodes: string[];
  levelBandPendingCodes: string[];
  blockedRecordCodes: string[];
}

/** Short level labels with their official codes (display only). */
const LEVEL_DISPLAY: Record<ParticipantLevel, string> = {
  SUB_JUNIOR: 'Sub Junior (SJ)',
  JUNIOR: 'Junior (J)',
  SENIOR: 'Senior (S)',
  SUPER_SENIOR: 'Super Senior (SS)'
};

const EVENT_NAME_DISPLAY: Record<string, string> = {
  'Greeting Card making': 'Greeting Card Making',
  'Waste to wealth': 'Waste to Wealth'
};

/**
 * Display labels for one backend catalogue read (NEVER identity: ids and
 * codes stay the identity). Official-name spellings are normalized for
 * display only, and a record whose display name REPEATS inside the
 * catalogue - the level-split families - carries its level in the label
 * so same-name entries never look merged ("Clay Modelling — Sub Junior
 * (SJ)"). Multi-level records (COMMON, the two Quizzes) keep their name
 * and show their levels where the level chips render.
 */
export function displayEventNames(events: readonly Event[]): Event[] {
  const nameCounts = new Map<string, number>();

  for (const event of events) {
    nameCounts.set(event.name, (nameCounts.get(event.name) ?? 0) + 1);
  }

  return events.map(event => {
    const repeatedName = (nameCounts.get(event.name) ?? 0) > 1;
    const name = EVENT_NAME_DISPLAY[event.name] ?? event.name;

    return {
      ...event,
      name:
        repeatedName && event.eligibleLevels.length === 1
          ? `${name} — ${LEVEL_DISPLAY[event.eligibleLevels[0]]}`
          : name,
    };
  });
}
