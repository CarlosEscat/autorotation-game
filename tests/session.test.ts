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

  it('easy mode still crashes if the collective is never lowered', () => {
    expect(fly({ lowerCollective: false }, { difficulty: 'easy' }).result!.outcome).toBe('crash');
  });

});

describe('free flight', () => {
  const free = (cfg: Partial<FlightConfig> = {}) =>
    new FlightSession(world, { ...DEFAULT_CONFIG, windKt: 0, failureDelay: 1e9, freeFlight: true, ...cfg });

  /** Hold a vertical speed with the collective (integral control), wings level. */
  const holdVs = (session: FlightSession, c: ReturnType<typeof neutralControls>, vs: number, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 120) {
      c.collective = Math.max(0, Math.min(1, c.collective + (vs - session.state.verticalSpeed) * 0.004));
      c.cyclicPitch = Math.max(-1, Math.min(1, -session.state.pitch * 3));
      session.step(c);
    }
  };

  it('never fails the engine', () => {
    const session = free({ altitudeFt: 1000 });
    holdVs(session, neutralControls(session.state.collective), 0, 120);
    expect(session.state.engineRunning).toBe(true);
    expect(session.phase).toBe('cruise');
  });

  it('a gentle touchdown rests on the ground, and the collective lifts off again', () => {
    const session = free({ altitudeFt: 40, airspeedKt: 0, start: { x: -380, z: 360, yaw: 0 } });
    const c = neutralControls(session.state.collective);
    holdVs(session, c, -1, 30);
    expect(session.crashed).toBe(false);
    expect(session.phase).toBe('cruise');
    expect(session.state.agl).toBeLessThan(0.05);
    expect(session.events.some((e) => e.type === 'touchdown')).toBe(true);

    holdVs(session, c, 2, 8);
    expect(session.state.agl).toBeGreaterThan(5);
    expect(session.phase).toBe('cruise');
  });

  it('lands on the lake helipad deck, not in the water', () => {
    const pad = world.areas.find((a) => a.id === 'helipad')!;
    const session = free({ altitudeFt: 30, airspeedKt: 0, start: { x: pad.cx, z: pad.cz, yaw: 0 } });
    holdVs(session, neutralControls(session.state.collective), -1, 30);
    expect(session.crashed).toBe(false);
    expect(session.state.agl).toBeLessThan(0.05);
    expect(session.state.pos.y).toBeGreaterThan(world.waterLevel + 2);
    expect(world.surfaceAt(session.state.pos.x, session.state.pos.z)).toBe('paved');
    expect(world.areaAt(session.state.pos.x, session.state.pos.z)?.id).toBe('helipad');
  });

  it('a hard impact still crashes and ends the flight', () => {
    const session = free({ altitudeFt: 300, airspeedKt: 0, start: { x: -380, z: 360, yaw: 0 } });
    const c = neutralControls(0);
    for (let n = 0; n < 120 * 40 && session.phase !== 'done'; n++) session.step(c);
    expect(session.crashed).toBe(true);
    expect(session.phase).toBe('done');
  });
});
