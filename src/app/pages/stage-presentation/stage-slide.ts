/**
 * Stage presentation slide model, labels, display rules and validation.
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

/** Label and value for the combined home/team line on a slide. */
export interface HomeTeamDisplay {
  text: string;
  /**
   * Label literal, rendered uppercase by the slide CSS. 'Home / Team' is
   * the label kept exactly as committed for individual slides (it shows
   * as "HOME / TEAM"); 'HOME / TEAM' is the group-slide literal when the
   * team contributes a second name.
   */
  label: 'SHELTER HOME' | 'HOME / TEAM' | 'Home / Team';
}

/**
 * Display rule for the combined home/team line. Pure and display-only:
 * it never edits the stored names, it only decides what the stage shows
 * and which label heads it. Final rule matrix:
 *
 *   mode  | names                        | value         | label
 *   ------|------------------------------|---------------|-------------
 *   GROUP | team empty/missing           | home once     | SHELTER HOME
 *   GROUP | home == team (normalized)    | home once     | SHELTER HOME
 *   GROUP | home & team distinct         | 'Home · Team' | HOME / TEAM
 *   GROUP | home empty, team present (*) | team once     | HOME / TEAM
 *   SOLO  | any; team is '' (validateSlide) | home once  | Home / Team
 *
 * Comparison normalizes (trim, collapse whitespace, case-insensitive);
 * the home's original casing/spelling is what is shown. The SOLO label
 * is unchanged from the committed state; the SHELTER HOME label is the
 * GROUP single-name case only. The "home empty, team present" GROUP row
 * is defensive - validateSlide requires homeName for GROUP.
 */
export function homeTeamDisplay(
  homeName: string | null | undefined,
  teamName: string | null | undefined,
  mode: StageMode,
): HomeTeamDisplay {
  const home = (homeName ?? '').trim();
  const team = (teamName ?? '').trim();
  const normalize = (value: string) => value.replace(/\s+/g, ' ').toLowerCase();

  // Individual slides: the team must be '' (validateSlide), so the home
  // name is the value and the label stays as committed.
  if (mode === 'SOLO') {
    return { text: home === '' ? team : home, label: 'Home / Team' };
  }

  if (team === '' || (home !== '' && normalize(home) === normalize(team))) {
    return { text: home, label: 'SHELTER HOME' };
  }
  if (home === '') {
    return { text: team, label: 'HOME / TEAM' };
  }
  return { text: `${home} · ${team}`, label: 'HOME / TEAM' };
}

/** Never shrink the home line below this fraction of its base size. */
export const HOME_FIT_FLOOR = 0.55;

/**
 * Font scale for the single-line home/team value: the text measures
 * `textWidth` px inside an `availableWidth` px box, so the font must
 * shrink by available/text to fit. Clamped to [HOME_FIT_FLOOR, 1];
 * unmeasurable (zero) widths leave the base size untouched.
 */
export function homeFitScale(
  availableWidth: number,
  textWidth: number,
  floor = HOME_FIT_FLOOR,
): number {
  if (availableWidth <= 0 || textWidth <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(floor, availableWidth / textWidth));
}
