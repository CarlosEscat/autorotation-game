import { describe, expect, it } from 'vitest';
import { MAX_STARS, RATINGS, Stars, earnedRank, formatFlightTime, nextRank, ratingsHeld, requirementsFor, totalStars } from '../src/game/licence';
import { ALL_LEVELS } from '../src/game/levels';
import { Logbook, emptyLogbook } from '../src/game/logbook';

const all = (n: number): Stars => Object.fromEntries(ALL_LEVELS.map((l) => [l.id, n]));
const book = (seconds: number, landings: number): Logbook => ({ ...emptyLogbook(), airSeconds: { light: seconds, heavy: 0 }, landings });

describe('licence', () => {
  it('ratings come from stars', () => {
    expect(ratingsHeld({})).toEqual([]);
    expect(ratingsHeld({ checkride: 1 })).toEqual(['emergency']);
    expect(ratingsHeld({ firstfire: 3 })).toEqual([]); // needs both fire missions
    expect(ratingsHeld({ checkride: 1, conversion: 2, firstfire: 1, forestfire: 1 })).toEqual(['emergency', 'heavy', 'firefighter']);
  });

  it('every rating points at levels that exist', () => {
    for (const r of RATINGS) for (const id of r.levels) expect(ALL_LEVELS.some((l) => l.id === id)).toBe(true);
  });

  it('a new pilot is a student', () => expect(earnedRank({}, emptyLogbook())).toBe('student'));

  it('private needs beginner lessons, 10 stars and 15 minutes', () => {
    const beginner: Stars = { basics: 2, collective: 2, hover: 2, takeoff: 2, landing: 2 };
    expect(earnedRank(beginner, book(899, 0))).toBe('student');
    expect(earnedRank(beginner, book(900, 0))).toBe('private');
    expect(earnedRank({ ...beginner, landing: 0, rings: 3 }, book(900, 0))).toBe('student');
  });

  it('commercial and captain boundaries', () => {
    expect(earnedRank(all(3), book(5400, 39))).toBe('private');
    expect(earnedRank(all(3), book(5400, 40))).toBe('commercial');
    expect(earnedRank(all(3), book(18000, 149))).toBe('commercial');
    expect(earnedRank(all(3), book(18000, 150))).toBe('captain');
  });

  it('ranks are earned in order: captain numbers without the checkride stay private', () => {
    expect(earnedRank({ ...all(3), checkride: 0 }, book(18000, 150))).toBe('private');
  });

  it('requirements report progress', () => {
    const r = requirementsFor('commercial', all(1), book(2700, 12));
    expect(r.map((x) => [x.id, x.have, x.need, x.met])).toEqual([
      ['rating-emergency', 1, 1, true],
      ['stars', 23, 35, false],
      ['time', 2700, 5400, false],
      ['landings', 12, 40, false],
    ]);
    expect(requirementsFor('student', {}, emptyLogbook())).toEqual([]);
  });

  it('stars for levels that no longer exist are ignored', () => {
    expect(totalStars({ basics: 3, gone: 3 })).toBe(3);
  });

  it('formats flight time', () => {
    expect(formatFlightTime(0)).toBe('0 min');
    expect(formatFlightTime(900)).toBe('15 min');
    expect(formatFlightTime(3599)).toBe('59 min');
    expect(formatFlightTime(5400)).toBe('1.5 h');
  });

  it('max stars is three per level', () => expect(MAX_STARS).toBe(69));

  it('the ladder ends at captain', () => {
    expect(nextRank('student')).toBe('private');
    expect(nextRank('captain')).toBeNull();
  });
});
