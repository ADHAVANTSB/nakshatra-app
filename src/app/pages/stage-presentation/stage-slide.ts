/**
 * Stage presentation slide model, labels and validation.
 *
 * Pure, dependency-free. A StageSlide is one winner announcement shown
 * on the projector during a prize-distribution ceremony. Business rules:
 *   - SOLO slides name exactly one child and never a team;
 *   - GROUP slides name the home (and optionally a team) and never list
 *     individual children;
 *   - only slides sourced from an OFFICIAL_RESULT may be presented as
 *     verified winners - manual admin entries and demo slides must never
 *     be shown as official results.
 */

export type StageMode = 'SOLO' | 'GROUP';

export type PrizePosition =
  | 'FIRST'
  | 'SECOND'
  | 'THIRD'
  | 'SPECIAL_MENTION'
  | 'PARTICIPATION';

export type SlideSource = 'OFFICIAL_RESULT' | 'MANUAL_ADMIN' | 'DEMO';

export interface StageSlide {
  id: string;

  /**
   * Stable identity of the official result behind this slide
   * (`eventId|scoreId`), empty for manual and demo slides. Refresh
   * matches on it to update a slide in place instead of duplicating it.
   */
  resultKey?: string;
  eventId: string;
  eventCode: string;
  eventName: string;
  /**
   * Event category straight from the event catalogue ('ARTS',
   * 'LITERARY', 'CULTURAL', ...). OPTIONAL: slides persisted before
   * categories existed are cast back from localStorage as-is, so the
   * template must tolerate it being missing.
   */
  category?: string;
  mode: StageMode;
  position: PrizePosition;
  /** Required for both modes. */
  homeName: string;
  /** Required for SOLO; MUST be '' for GROUP. */
  childName: string;
  /** Optional for GROUP; MUST be '' for SOLO. */
  teamName: string;
  /** Optional announcement text. */
  subtitle: string;
  source: SlideSource;
}

export const POSITION_LABELS: Record<PrizePosition, string> = {
  FIRST: 'First Prize',
  SECOND: 'Second Prize',
  THIRD: 'Third Prize',
  SPECIAL_MENTION: 'Special Mention',
  PARTICIPATION: 'Participation',
};

export const POSITION_BANNER_LABELS: Record<PrizePosition, string> = {
  FIRST: 'FIRST PRIZE',
  SECOND: 'SECOND PRIZE',
  THIRD: 'THIRD PRIZE',
  SPECIAL_MENTION: 'SPECIAL MENTION',
  PARTICIPATION: 'PARTICIPATION',
};

const KNOWN_POSITIONS: readonly string[] = Object.keys(POSITION_LABELS);

/**
 * Human-readable validation errors for one slide; a valid slide
 * returns []. Every rule that can fail is reported, so the admin UI
 * can show all problems at once.
 */
export function validateSlide(slide: StageSlide): string[] {
  const errors: string[] = [];

  if (!slide.eventName) {
    errors.push('Event is required.');
  }

  if (!slide.homeName) {
    errors.push('Home name is required.');
  }

  if (slide.mode === 'SOLO') {
    if (!slide.childName) {
      errors.push('Child name is required for individual events.');
    }
    if (slide.teamName) {
      errors.push('Team name does not apply to individual events.');
    }
  } else {
    if (slide.childName) {
      errors.push('Group slides must not list individual children.');
    }
  }

  if (!KNOWN_POSITIONS.includes(slide.position)) {
    errors.push('Unknown prize position.');
  }

  return errors;
}

/**
 * True only for slides taken from an official result: manually entered
 * or demo slides must never be presented as official winners.
 */
export function isVerifiedWinner(slide: StageSlide): boolean {
  return slide.source === 'OFFICIAL_RESULT';
}
