import { describe, expect, it } from 'vitest';

import { rankResultRows } from './results';
import { ListResultRow } from '../../core/models/api.model';

function row(id: string, score: number): ListResultRow {
  return {
    scoreId: id,
    eventId: 'evt-1',
    eventCode: 'ART-001',
    eventName: 'Clay Modelling',
    category: 'ARTS',
    mode: 'SOLO',
    fullName: id,
    score,
  };
}

describe('rankResultRows', () => {
  it('ranks highest score first and awards medal positions in order', () => {
    const ranked = rankResultRows([row('a', 12), row('b', 30), row('c', 21)]);

    expect(ranked.map(entry => entry.row.scoreId)).toEqual(['b', 'c', 'a']);
    expect(ranked.map(entry => entry.position)).toEqual([1, 2, 3]);
  });

  it('shares a position on ties and skips the next (1, 2, 2, 4)', () => {
    const ranked = rankResultRows([
      row('a', 30), row('b', 20), row('c', 20), row('d', 10),
    ]);

    expect(ranked.map(entry => entry.position)).toEqual([1, 2, 2, 4]);
  });

  it('renders every row even when all scores are equal', () => {
    const ranked = rankResultRows([row('a', 5), row('b', 5)]);

    expect(ranked.length).toBe(2);
    expect(ranked.map(entry => entry.position)).toEqual([1, 1]);
  });
});
