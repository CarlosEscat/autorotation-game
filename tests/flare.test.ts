import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, FlightConfig } from '../src/game/session';
import { createWorld } from '../src/world/world';
import { LandingTechnique, flyLanding } from './landingPilot';

const world = createWorld();
// 300 ft in a 60 kt power-off glide toward the meadow, no auto-cushion.
const approach = (difficulty: 'easy' | 'normal'): FlightConfig => ({
  ...DEFAULT_CONFIG,
  difficulty,
  cushion: false,
  windKt: 0,
  altitudeFt: 300,
  airspeedKt: 60,
  start: { x: -380, z: 740, yaw: 0, autorotating: { sinkMs: 7, collective: 0.1 } },
});
const land = (t: LandingTechnique, difficulty: 'easy' | 'normal' = 'normal') => {
  const { session, climbWhileCushioning } = flyLanding(world, approach(difficulty), t);
  const td = session.touchdown!;
  return { fpm: td.verticalSpeed * 196.85, kt: td.groundSpeed * 1.944, crashed: session.crashed, climbFpm: climbWhileCushioning * 196.85 };
};
const good = { flareFt: 75, flarePitchDeg: 12, cushionFt: 5 };

describe('flare and cushion (last 100 ft)', () => {
  it('a flare from 75 ft plus a cushion at about 5 ft lands softly', () => {
    expect(land(good).fpm).toBeLessThan(300);
    expect(land({ ...good, holdW: true }).fpm).toBeLessThan(300);
  });

  it('the collective cushions but never makes the helicopter climb', () => {
    for (const cushionFt of [5, 8, 12, 25]) for (const holdW of [false, true]) {
      expect(land({ ...good, cushionFt, holdW }).climbFpm).toBeLessThan(150);
    }
  });

  it('skipping the cushion, or raising the collective far too early, lands hard', () => {
    const soft = land(good).fpm;
    expect(land({ ...good, cushionFt: 0 }).fpm).toBeGreaterThan(soft + 300);
    expect(land({ ...good, cushionFt: 25 }).fpm).toBeGreaterThan(soft + 300);
  });

  it('no flare means hitting the ground fast', () => {
    const r = land({ flareFt: 0, flarePitchDeg: 0, cushionFt: 5 });
    expect(r.kt).toBeGreaterThan(50);
    expect(r.crashed).toBe(true);
  });

  it('holding the collective up too early does not float: once the rotor weakens it sinks again', () => {
    for (const difficulty of ['easy', 'normal'] as const) {
      expect(land({ ...good, cushionFt: 25, holdW: true }, difficulty).fpm).toBeGreaterThan(800);
    }
  });

  it('easy mode is more forgiving than realistic', () => {
    const late = { ...good, cushionFt: 8 };
    expect(land(late, 'easy').fpm).toBeLessThan(land(late, 'normal').fpm);
  });
});
