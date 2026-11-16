import { describe, expect, it } from 'vitest';
import { NAME_MAX, acknowledge, cleanName, newPilot, normalizePilot, pendingPromotion, updateRank } from '../src/game/pilot';

describe('pilot', () => {
  it('a missing or damaged block becomes a new pilot', () => {
    for (const raw of [undefined, null, 'x', 42, [], { logbook: 'no' }]) expect(normalizePilot(raw)).toEqual(newPilot());
  });

  it('bad numbers and unknown values are dropped, good ones kept', () => {
    const p = normalizePilot({
      name: '  Ana   Ruiz ',
      callsign: 'x'.repeat(40),
      rank: 'admiral',
      shownRatings: ['heavy', 'bogus'],
      logbook: { airSeconds: { light: 120, heavy: NaN }, flights: -3, landings: 7.9, crashes: '2', firesOut: Infinity },
    });
    expect(p.name).toBe('Ana Ruiz');
    expect(p.callsign).toHaveLength(12);
    expect(p.rank).toBe('student');
    expect(p.shownRatings).toEqual(['heavy']);
    expect(p.logbook).toEqual({ airSeconds: { light: 120, heavy: 0 }, nightSeconds: 0, flights: 0, landings: 7, crashes: 0, firesOut: 0 });
  });

  it('cleanName clamps and never returns only spaces', () => {
    expect(cleanName('   ', NAME_MAX)).toBe('');
    expect(cleanName('a'.repeat(200), NAME_MAX)).toHaveLength(20);
  });

  it('rank rises with the logbook and never falls', () => {
    const p = newPilot();
    const stars = { basics: 2, collective: 2, hover: 2, takeoff: 2, landing: 2 };
    p.logbook.airSeconds.light = 900;
    updateRank(p, stars);
    expect(p.rank).toBe('private');
    updateRank(p, {});
    expect(p.rank).toBe('private');
  });

  it('a promotion is pending until acknowledged, then gone', () => {
    const p = newPilot();
    const stars = { checkride: 1 };
    expect(pendingPromotion(p, stars)).toEqual({ rank: null, ratings: ['emergency'] });
    acknowledge(p, stars);
    expect(pendingPromotion(p, stars)).toBeNull();
    p.rank = 'private';
    expect(pendingPromotion(p, stars)).toEqual({ rank: 'private', ratings: [] });
  });

  it('an old save with stars gets its ratings announced once', () => {
    const p = normalizePilot(undefined);
    expect(pendingPromotion(p, { checkride: 3, conversion: 1 })?.ratings).toEqual(['emergency', 'heavy']);
  });

  it('loads a logbook with no night total, or a bad one, as 0', () => {
    expect(normalizePilot({ logbook: { flights: 3 } }).logbook.nightSeconds).toBe(0);
    expect(normalizePilot({ logbook: { nightSeconds: -5 } }).logbook.nightSeconds).toBe(0);
    expect(normalizePilot({ logbook: { nightSeconds: NaN } }).logbook.nightSeconds).toBe(0);
    expect(normalizePilot({ logbook: { nightSeconds: 90.5 } }).logbook.nightSeconds).toBe(90.5);
  });
});
