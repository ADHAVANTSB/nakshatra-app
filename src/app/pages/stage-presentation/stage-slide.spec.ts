import { describe, expect, it } from 'vitest';

import {
  POSITION_BANNER_LABELS,
  POSITION_LABELS,
  PrizePosition,
  StageSlide,
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
