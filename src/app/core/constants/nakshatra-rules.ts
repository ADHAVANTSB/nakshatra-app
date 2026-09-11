import { EventRuleConfig } from './nakshatra-rules.types';

export const NAKSHATRA_EVENT_RULES: EventRuleConfig = {
  maxParticipantsPerHome: 35,
  maxCaretakersPerHome: 2,
  maxTotalEventsPerParticipant: 6,
  maxEventsPerCategory: 2,
  maxIndividualEvents: 3
};

export const PARTICIPANT_LEVEL_LABELS = {
  SUB_JUNIOR: 'Sub Juniors',
  JUNIOR: 'Juniors',
  SENIOR: 'Seniors',
  SUPER_SENIOR: 'Super Seniors'
} as const;

export const EVENT_CATEGORY_LABELS = {
  ARTS: 'Arts',
  LITERARY: 'Literary',
  CULTURAL: 'Cultural'
} as const;

export const GOOGLE_SHEET_NAMES = {
  OVERALL: 'Overall - Final',
  EVENT_WISE: 'Event wise'
} as const;
