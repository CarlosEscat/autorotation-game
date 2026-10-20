import { describe, expect, it } from 'vitest';
import { FlightSession, DEFAULT_CONFIG, FlightConfig } from '../src/game/session';
import { createWorld } from '../src/world/world';
import { neutralControls } from '../src/sim/state';
import { makeBot, BotOptions } from './pilotBot';

const world = createWorld();

/** Fly a full attempt with the scripted pilot, steering toward a landing area. */
export function fly(bot: BotOptions = {}, cfg: Partial<FlightConfig> = {}, targetId = 'meadow') {
  const session = new FlightSession(world, { ...DEFAULT_CONFIG, altitudeFt: 560, ...cfg });
  const c = neutralControls(session.state.collective);
  const pilot = makeBot(bot);
  const target = world.areas.find((a) => a.id === targetId)!;
  let steps = 0;
  while (session.phase !== 'done' && steps++ < 120 * 300) {
    const s = session.state;
    pilot(s, c);
    // Simple heading hold toward target with lateral cyclic.
    // Head straight for the area (start height is chosen so a straight glide arrives at flare height).
    const dist = Math.hypot(target.cx - s.pos.x, target.cz - s.pos.z);
    const desired = Math.atan2(-(target.cx - s.pos.x), -(target.cz - s.pos.z));
    let err = desired - s.yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    void dist;
    c.cyclicRoll = s.agl > 20 ? Math.max(-1, Math.min(1, -err * 2.5)) : 0;
    session.step(c);
  }
  return session;
}

describe('full attempts', () => {
  it('good technique lands safely in the meadow with a high score', () => {
    const s = fly();
    const r = s.result!;
    console.log(JSON.stringify({ outcome: r.outcome, total: r.score.total, cats: r.score.categories.map((c) => `${c.id}:${c.score}`), td: { vs: r.touchdown?.verticalSpeed, gs: r.touchdown?.groundSpeed, area: r.touchdown?.area?.id, reasons: r.touchdown?.damageReasons }, imp: r.score.improvements }, null, 1));
    expect(['excellent', 'safe']).toContain(r.outcome);
    expect(r.touchdown?.area?.id).toBe('meadow');
    expect(r.score.total).toBeGreaterThanOrEqual(75);
  });

  it('is deterministic for identical inputs', () => {
    const a = fly().result!;
    const b = fly().result!;
    expect(b.score).toEqual(a.score);
    expect(b.damage).toBe(a.damage);
  });

  it('never lowering the collective ends in a crash', () => {
    const r = fly({ lowerCollective: false }).result!;
    expect(r.outcome).toBe('crash');
    expect(r.score.categories.find((c) => c.id === 'reaction')!.score).toBe(0);
  });

  it('slow reaction costs reaction and RPM points', () => {
    const quick = fly().result!.score;
    const slow = fly({ reactionDelay: 2.5 }).result!.score;
    const cat = (s: typeof quick, id: string) => s.categories.find((c) => c.id === id)!.score;
    expect(cat(slow, 'reaction')).toBeLessThan(cat(quick, 'reaction'));
    expect(cat(slow, 'rpm')).toBeLessThanOrEqual(cat(quick, 'rpm'));
  });

  it('no flare gives a hard, fast touchdown', () => {
    const good = fly().result!;
    const r = fly({ flareHeight: 0 }).result!;
    console.log('noflare', r.outcome, r.score.total, r.touchdown?.verticalSpeed, r.touchdown?.groundSpeed);
    expect(r.touchdown!.verticalSpeed).toBeGreaterThan(good.touchdown!.verticalSpeed + 2);
    expect(r.score.total).toBeLessThan(good.score.total - 20);
  });

  it('no cushion lands harder than cushioned', () => {
    const good = fly().result!;
    const r = fly({ cushion: false }).result!;
    expect(r.touchdown!.verticalSpeed).toBeGreaterThan(good.touchdown!.verticalSpeed);
  });

  it('easy mode forgives a sloppy approach that crashes in realistic mode', () => {
    const sloppy: BotOptions = { flareHeight: 0, cushion: false, reactionDelay: 2 };
    const normal = fly(sloppy).result!;
    const easy = fly(sloppy, { difficulty: 'easy' }).result!;
    console.log('sloppy', normal.outcome, normal.damage, '| easy', easy.outcome, easy.damage, easy.touchdown?.verticalSpeed, easy.touchdown?.groundSpeed);
    expect(normal.outcome).toBe('crash');
    expect(['excellent', 'safe']).toContain(easy.outcome);
  });

  it('easy mode: a late collective pull cushions instead of climbing', () => {
    const session = new FlightSession(world, {
      ...DEFAULT_CONFIG,
      difficulty: 'easy',
      altitudeFt: 40,
      airspeedKt: 10,
      start: { x: -380, z: 400, yaw: 0, autorotating: { sinkMs: 4, collective: 0.15 } },
    });
    const c = neutralControls(session.state.collective);
    let maxClimb = 0;
    for (let n = 0; n < 120 * 15 && session.phase === 'autorotation'; n++) {
      if (session.state.agl < 2) c.collective = Math.min(1, c.collective + 0.75 / 120); // hold W from ~6 ft
      session.step(c);
      maxClimb = Math.max(maxClimb, session.state.verticalSpeed);
    }
    expect(maxClimb).toBeLessThanOrEqual(0);
    expect(session.touchdown!.verticalSpeed).toBeLessThan(1); // under ~200 fpm
  });

  it('easy mode still crashes if the collective is never lowered', () => {
    expect(fly({ lowerCollective: false }, { difficulty: 'easy' }).result!.outcome).toBe('crash');
  });

});
