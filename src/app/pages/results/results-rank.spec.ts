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

  it('shares a position on ties and continues densely (1, 2, 2, 3)', () => {
    const ranked = rankResultRows([
      row('a', 30), row('b', 20), row('c', 20), row('d', 10),
    ]);

    expect(ranked.map(entry => entry.position)).toEqual([1, 2, 2, 3]);
  });

  it('shares the winning position when the leaders tie', () => {
    const ranked = rankResultRows([
      row('a', 30), row('b', 30), row('c', 20), row('d', 10),
    ]);

    expect(ranked.map(entry => entry.position)).toEqual([1, 1, 2, 3]);
  });

  it('renders every row at position 1 when all scores are equal', () => {
    const ranked = rankResultRows([row('a', 5), row('b', 5), row('c', 5)]);

    expect(ranked.length).toBe(3);
    expect(ranked.map(entry => entry.position)).toEqual([1, 1, 1]);
  });

  it('takes consecutive positions after ties (20, 18, 18, 16, 14 → 1, 2, 2, 3, 4)', () => {
    const ranked = rankResultRows([
      row('a', 20), row('b', 18), row('c', 18), row('d', 16), row('e', 14),
    ]);

    expect(ranked.map(entry => entry.row.scoreId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ranked.map(entry => entry.position)).toEqual([1, 2, 2, 3, 4]);
  });
});
