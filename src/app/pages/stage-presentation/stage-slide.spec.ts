import { describe, expect, it } from 'vitest';

import {
  HOME_FIT_FLOOR,
  POSITION_BANNER_LABELS,
  POSITION_LABELS,
  PrizePosition,
  StageSlide,
  homeFitScale,
  homeTeamDisplay,
  isVerifiedWinner,
  validateSlide,
} from './stage-slide';
import { DEMO_DATA_NOTICE, DEMO_SLIDES } from './demo-slides';

/**
 * Stage slide tests: prize labels, slide validation (SOLO vs GROUP
 * name rules), the official-winner source rule and the demo deck.
 * Everything is pure, so every case runs without TestBed or a network.
 */

function soloSlide(overrides: Partial<StageSlide> = {}): StageSlide {
  return {
    id: 'S-1',
    eventId: 'E-1',
    eventCode: 'ART-001',
    eventName: 'Quiz (Junior)',
    mode: 'SOLO',
    position: 'FIRST',
    homeName: 'Sunrise Home',
    childName: 'Karthik',
    teamName: '',
    subtitle: '',
    source: 'OFFICIAL_RESULT',
    ...overrides,
  };
}

function groupSlide(overrides: Partial<StageSlide> = {}): StageSlide {
  return {
    id: 'S-2',
    eventId: 'E-2',
    eventCode: 'CUL-003',
    eventName: 'Group Dance',
    mode: 'GROUP',
    position: 'SECOND',
    homeName: 'Rainbow Children Home',
    childName: '',
    teamName: '',
    subtitle: '',
    source: 'OFFICIAL_RESULT',
    ...overrides,
  };
}

describe('prize position labels', () => {
  it('labels every position for lists and banners', () => {
    expect(POSITION_LABELS).toEqual({
      FIRST: 'First Prize',
      SECOND: 'Second Prize',
      THIRD: 'Third Prize',
      SPECIAL_MENTION: 'Special Mention',
      PARTICIPATION: 'Participation',
    });

    expect(POSITION_BANNER_LABELS).toEqual({
      FIRST: 'FIRST PRIZE',
      SECOND: 'SECOND PRIZE',
      THIRD: 'THIRD PRIZE',
      SPECIAL_MENTION: 'SPECIAL MENTION',
      PARTICIPATION: 'PARTICIPATION',
    });
  });
});

describe('slide validation', () => {
  it('accepts a valid SOLO slide and a valid GROUP slide', () => {
    expect(validateSlide(soloSlide())).toEqual([]);
    expect(validateSlide(groupSlide({ teamName: 'Rainbow Stars' }))).toEqual([]);
    expect(validateSlide(groupSlide())).toEqual([]);
  });

  it('requires the event name', () => {
    expect(validateSlide(soloSlide({ eventName: '' })))
      .toEqual(['Event is required.']);
  });

  it('requires the home name', () => {
    expect(validateSlide(soloSlide({ homeName: '' })))
      .toEqual(['Home name is required.']);
  });

  it('requires a child name for individual events', () => {
    expect(validateSlide(soloSlide({ childName: '' })))
      .toEqual(['Child name is required for individual events.']);
  });

  it('rejects individual children on group slides', () => {
    expect(validateSlide(groupSlide({ childName: 'Ananya' })))
      .toEqual(['Group slides must not list individual children.']);
  });

  it('rejects a team name on individual events', () => {
    expect(validateSlide(soloSlide({ teamName: 'Rainbow Stars' })))
      .toEqual(['Team name does not apply to individual events.']);
  });

  it('rejects an unknown prize position', () => {
    expect(validateSlide(soloSlide({ position: 'GRAND' as unknown as PrizePosition })))
      .toEqual(['Unknown prize position.']);
  });
});

describe('verified winner rule', () => {
  it('is true only for official results', () => {
    expect(isVerifiedWinner(soloSlide({ source: 'OFFICIAL_RESULT' }))).toBe(true);
    expect(isVerifiedWinner(soloSlide({ source: 'MANUAL_ADMIN' }))).toBe(false);
    expect(isVerifiedWinner(soloSlide({ source: 'DEMO' }))).toBe(false);
  });
});

describe('demo slides', () => {
  it('carries the demo data notice', () => {
    expect(DEMO_DATA_NOTICE).toBe('DEMO DATA — NOT OFFICIAL RESULTS');
  });

  it('lists exactly five slides in the agreed order', () => {
    expect(DEMO_SLIDES.map((slide) => slide.id)).toEqual([
      'DEMO-S1', 'DEMO-S2', 'DEMO-S3', 'DEMO-S4', 'DEMO-S5',
    ]);
    expect(DEMO_SLIDES.map((slide) => slide.eventCode)).toEqual([
      'DEMO-01', 'DEMO-02', 'DEMO-03', 'DEMO-04', 'DEMO-05',
    ]);
    expect(DEMO_SLIDES.map((slide) => slide.eventName)).toEqual([
      'Group Dance', 'Group Song', 'Story Telling', 'Quiz (Junior)', 'Skit (Tamil)',
    ]);
  });

  it('matches the agreed mode, names, team and position per slide', () => {
    expect(DEMO_SLIDES.map((slide) => [slide.mode, slide.homeName, slide.position]))
      .toEqual([
        ['GROUP', 'Rainbow Children Home', 'FIRST'],
        ['GROUP', 'Little Hearts Home', 'SECOND'],
        ['SOLO', 'Rainbow Children Home', 'THIRD'],
        ['SOLO', 'Sunrise Home', 'FIRST'],
        ['GROUP', 'Hope Children Home', 'SECOND'],
      ]);

    expect(DEMO_SLIDES.map((slide) => slide.childName)).toEqual([
      '', '', 'Ananya', 'Karthik', '',
    ]);
    expect(DEMO_SLIDES.map((slide) => slide.teamName)).toEqual(['', '', '', '', '']);
  });

  it('is all demo-sourced, valid, and never an official winner', () => {
    expect(DEMO_SLIDES.every((slide) => slide.source === 'DEMO')).toBe(true);
    expect(DEMO_SLIDES.every((slide) => slide.subtitle === '')).toBe(true);
    expect(DEMO_SLIDES.every((slide) => validateSlide(slide).length === 0)).toBe(true);
    expect(DEMO_SLIDES.every((slide) => !isVerifiedWinner(slide))).toBe(true);
  });
});

describe('home/team display rule', () => {
  it('shows the home once with a SHELTER HOME label when home and team are identical', () => {
    expect(homeTeamDisplay('HOME FOR POOR BOYS', 'HOME FOR POOR BOYS', 'GROUP'))
      .toEqual({ text: 'HOME FOR POOR BOYS', label: 'SHELTER HOME' });
  });

  it('dedupes case-only differences', () => {
    expect(homeTeamDisplay('Rainbow Home', 'rainbow home', 'GROUP'))
      .toEqual({ text: 'Rainbow Home', label: 'SHELTER HOME' });
  });

  it('dedupes leading, trailing and inner whitespace differences', () => {
    const display = homeTeamDisplay('  Rainbow   Home ', 'rainbow home', 'GROUP');

    // The home keeps its original casing/spelling; whitespace is only
    // collapsed for comparison, never shown as a second name.
    expect(display.label).toBe('SHELTER HOME');
    expect(display.text.trim().replace(/\s+/g, ' ')).toBe('Rainbow Home');
    expect(display.text).not.toContain('·');
  });

  it('joins different names as Home · Team with a HOME / TEAM label', () => {
    expect(homeTeamDisplay('Rainbow Children Home', 'Rainbow Stars', 'GROUP'))
      .toEqual({ text: 'Rainbow Children Home · Rainbow Stars', label: 'HOME / TEAM' });
  });

  it('shows the home alone when the team is missing or empty', () => {
    expect(homeTeamDisplay('Rainbow Children Home', '', 'GROUP'))
      .toEqual({ text: 'Rainbow Children Home', label: 'SHELTER HOME' });
    expect(homeTeamDisplay('Rainbow Children Home', '   ', 'GROUP'))
      .toEqual({ text: 'Rainbow Children Home', label: 'SHELTER HOME' });
    expect(homeTeamDisplay('Rainbow Children Home', null, 'GROUP'))
      .toEqual({ text: 'Rainbow Children Home', label: 'SHELTER HOME' });
    expect(homeTeamDisplay('Rainbow Children Home', undefined, 'GROUP'))
      .toEqual({ text: 'Rainbow Children Home', label: 'SHELTER HOME' });
  });

  it('shows the team alone (HOME / TEAM) when the home is empty', () => {
    expect(homeTeamDisplay('', 'Rainbow Stars', 'GROUP'))
      .toEqual({ text: 'Rainbow Stars', label: 'HOME / TEAM' });
    expect(homeTeamDisplay('', '', 'GROUP'))
      .toEqual({ text: '', label: 'SHELTER HOME' });
  });

  it('keeps the committed Home / Team label for individual (SOLO) slides', () => {
    // Requirement pin: SHELTER HOME is the GROUP single-name case only;
    // individual slides render as "HOME / TEAM" (CSS uppercase).
    expect(homeTeamDisplay('Rainbow Children Home', '', 'SOLO'))
      .toEqual({ text: 'Rainbow Children Home', label: 'Home / Team' });
    expect(homeTeamDisplay('Rainbow Children Home', '', 'SOLO').label)
      .not.toBe('SHELTER HOME');
  });
});

describe('home line fit scale', () => {
  it('keeps the base size when the text fits', () => {
    expect(homeFitScale(800, 800)).toBe(1);
    expect(homeFitScale(800, 500)).toBe(1);
  });

  it('shrinks over-long text but never below the floor', () => {
    const shrunk = homeFitScale(800, 1200);

    expect(shrunk).toBeLessThan(1);
    expect(shrunk).toBeGreaterThanOrEqual(HOME_FIT_FLOOR);
    expect(shrunk).toBeCloseTo(800 / 1200);

    expect(homeFitScale(800, 4000)).toBe(HOME_FIT_FLOOR);
  });

  it('leaves the base size when widths are unmeasurable', () => {
    expect(homeFitScale(0, 1200)).toBe(1);
    expect(homeFitScale(800, 0)).toBe(1);
    expect(homeFitScale(0, 0)).toBe(1);
  });
});
