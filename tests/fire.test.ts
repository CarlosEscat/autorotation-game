import { describe, expect, it } from 'vitest';
import { HEAVY, MS_TO_KT } from '../src/sim/aircraft';
import { ControlInputs, HelicopterState, neutralControls } from '../src/sim/state';
import { DEG, clamp, wrapAngle } from '../src/sim/vec';
import { DROP_FULL_HEIGHT, DROP_MAX_HEIGHT, Fire, SPLASH_RADIUS, dropEffect, fireCells, waterFall } from '../src/game/fire';
import { FlightSession } from '../src/game/session';
import { FIRST_FIRE, FOREST_FIRE, HEAVY_LEVELS, LEVELS, ObjectiveStatus } from '../src/game/levels';
import { LAKE, createWorld } from '../src/world/world';

const world = createWorld();
const level = (id: string) => HEAVY_LEVELS.find((l) => l.id === id)!;

describe('fire', () => {
  const one = () => new Fire({ cells: [{ x: 0, z: 0 }, { x: 30, z: 0 }], waterPerCell: 100 });

  it('water landing on a patch puts it out for good; water landing elsewhere does nothing', () => {
    const f = one();
    f.release(0, 0, 1, 100);
    f.step(0.5, 0.5);
    expect(f.burning).toBe(2); // still falling
    f.step(1, 0.5);
    expect(f.cells[0].heat).toBe(0);
    expect(f.cells[1].heat).toBe(1);
    f.step(60, 59);
    expect(f.cells[0].heat).toBe(0);
    expect(f.out).toBe(false);
    f.release(30 + SPLASH_RADIUS + 1, 0, 61, 1000);
    f.step(61, 1);
    expect(f.cells[1].heat).toBe(1);
  });

  it('water lands hardest in the middle of the splash, and a patch only wetted flares back up', () => {
    const f = one();
    f.release(SPLASH_RADIUS / 2, 0, 0, 100);
    f.step(0, 0);
    expect(f.cells[0].heat).toBeCloseTo(0.5, 5);
    expect(f.progress).toBeCloseTo(0.25, 5);
    f.step(5, 5);
    expect(f.cells[0].heat).toBeGreaterThan(0.6);
    f.step(60, 55);
    expect(f.cells[0].heat).toBe(1);
  });

  it('water falls for longer and carries further from higher up, and scatters above 130 ft', () => {
    expect(waterFall(10).time).toBeLessThan(waterFall(40).time);
    expect(waterFall(10).carry).toBeLessThan(waterFall(40).carry);
    expect(waterFall(0).time).toBe(0);
    expect(waterFall(25).time).toBeGreaterThan(1.5);
    expect(dropEffect(DROP_FULL_HEIGHT - 5)).toBe(1);
    expect(dropEffect((DROP_FULL_HEIGHT + DROP_MAX_HEIGHT) / 2)).toBeCloseTo(0.5, 5);
    expect(dropEffect(DROP_MAX_HEIGHT + 10)).toBe(0);
  });

  it('fireCells fills an ellipse with evenly spaced patches', () => {
    const cells = fireCells(100, 50, 40, 20, 10);
    expect(cells.length).toBeGreaterThan(20);
    for (const c of cells) expect(((c.x - 100) / 40) ** 2 + ((c.z - 50) / 20) ** 2).toBeLessThanOrEqual(1.0001);
    const gaps = cells.map((a) => Math.min(...cells.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.z - b.z))));
    expect(Math.min(...gaps)).toBeGreaterThan(9.9);
  });
});

describe('fire missions', () => {
  const small = level('firstfire'), big = level('forestfire');

  it('only the two fire missions have a fire; both are flown in the heavy helicopter', () => {
    expect(LEVELS.every((l) => !l.config.fire)).toBe(true);
    expect(level('conversion').config.fire).toBeUndefined();
    for (const l of [small, big]) expect(l.config).toMatchObject({ aircraft: 'heavy', freeFlight: true });
  });

  it('the small fire is a handful of patches; the big one is several times its size', () => {
    expect(small.config.fire!.cells.length).toBeLessThanOrEqual(8);
    expect(big.config.fire!.cells.length).toBeGreaterThan(small.config.fire!.cells.length * 3);
  });

  it('the fires burn on dry land beside trees, the small one in the open', () => {
    for (const l of [small, big]) {
      const cells = l.config.fire!.cells;
      for (const c of cells) expect(world.surfaceAt(c.x, c.z)).not.toBe('water');
      const mid = cells[Math.floor(cells.length / 2)];
      expect(world.obstaclesNear(mid.x, mid.z, 45).filter((o) => o.kind === 'tree').length).toBeGreaterThan(4);
    }
    for (const c of small.config.fire!.cells) expect(world.obstaclesNear(c.x, c.z, 3)).toHaveLength(0);
  });

  /** Open water on the fire's side of the lake, clear of the helipad. */
  const lakeSpot = { x: LAKE.x + 70, z: LAKE.z - 120 };

  /**
   * A careful pilot: flies to the nearest burning patch, hovers over it above the treetops and drops until it is out,
   * then moves to the next; with an empty tank, goes to the lake, hovers low over the water until full, and comes back.
   */
  function fight(def: typeof small, opts: { drop?: boolean; refill?: boolean } = {}) {
    const session = new FlightSession(world, def.config);
    const objective = def.makeObjective(world);
    const s = session.state, fire = session.fire!;
    const c: ControlInputs = neutralControls(s.collective);
    const trim = new FlightSession(world, { ...def.config, airspeedKt: 0, altitudeFt: 100, start: { ...def.config.start!, settle: 'hover' } }).state.collective;
    let st: ObjectiveStatus = objective.update({ session, targetId: null, mode: 'keyboard' }, 0);
    let prevYaw = s.yaw, refills = 0, wasFilling = false, cell = fire.nearestBurning(s.pos.x, s.pos.z);
    // Water takes about two seconds to land from this height, so drop in short bursts and watch each one arrive.
    const burst = (def.config.fire!.waterPerCell / HEAVY.waterDropRate) * 1.3;
    let burstAt = -10;
    const texts = new Set<string>();
    for (let n = 0; n < 120 * 600 && st.state === 'running'; n++) {
      const rate = wrapAngle(s.yaw - prevYaw) * 120;
      prevYaw = s.yaw;
      const empty = session.water === 0 || (session.filling && session.water < HEAVY.waterCapacity);
      const toLake = empty && opts.refill !== false;
      if (!cell || cell.heat <= 0) cell = fire.nearestBurning(s.pos.x, s.pos.z);
      const tx = toLake ? lakeSpot.x : cell!.x, tz = toLake ? lakeSpot.z : cell!.z;
      // Wheels 4 m above the water to refill; 28 m above the ground, clear of the trees, over the fire.
      const aimY = toLake ? world.waterLevel + HEAVY.skidHeight + 4 : world.heightAt(tx, tz) + HEAVY.skidHeight + 28;
      const d = Math.hypot(tx - s.pos.x, tz - s.pos.z);
      c.pedal = 0;
      if (d > 50) {
        const err = wrapAngle(Math.atan2(-(tx - s.pos.x), -(tz - s.pos.z)) - s.yaw);
        c.cyclicRoll = clamp(-(1.5 * err - rate * 0.5), -0.7, 0.7);
        const gs = s.groundSpeed * MS_TO_KT;
        c.cyclicPitch = clamp((clamp((gs - clamp(d / 6, 8, 60)) * DEG, -8 * DEG, 15 * DEG) - s.pitchCmd) * 4, -1, 1);
        // Stay above the treetops until close in.
        const y = Math.max(aimY, world.heightAt(s.pos.x, s.pos.z) + HEAVY.skidHeight + 28);
        c.collective = clamp(trim + (clamp((y - s.pos.y) * 0.4, -4, 4) - s.vel.y) * 0.04, 0, 1);
      } else {
        const fwd = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) }, right = { x: Math.cos(s.yaw), z: -Math.sin(s.yaw) };
        const ex = tx - s.pos.x, ez = tz - s.pos.z;
        const aF = clamp(0.12 * (ex * fwd.x + ez * fwd.z), -2, 2) - 0.6 * (s.vel.x * fwd.x + s.vel.z * fwd.z);
        const aR = clamp(0.12 * (ex * right.x + ez * right.z), -2, 2) - 0.6 * (s.vel.x * right.x + s.vel.z * right.z);
        c.cyclicPitch = clamp((clamp(-Math.atan(aF / 9.81), -8 * DEG, 8 * DEG) - s.pitchCmd) * 6, -1, 1);
        c.cyclicRoll = clamp(Math.atan(aR / 9.81) / HEAVY.rollMax, -0.25, 0.25);
        const y = d < 12 ? aimY : Math.max(aimY, s.pos.y - 0.5);
        c.collective = clamp(trim + (clamp((y - s.pos.y) * 0.4, -3, 3) - s.vel.y) * 0.05, 0, 1);
      }
      const steady = opts.drop !== false && !toLake && d < 4 && s.groundSpeed < 4;
      if (steady && s.time - burstAt > 3) burstAt = s.time;
      c.dropWater = steady && s.time - burstAt < burst;
      session.step(c);
      if (session.filling && !wasFilling) refills++;
      wasFilling = session.filling;
      st = objective.update({ session, targetId: null, mode: 'keyboard' }, 1 / 120);
      texts.add(st.text.replace(/\d+/g, '#'));
    }
    return { st, session, refills, texts: [...texts] };
  }

  it('first fire: hovering over each patch and dropping puts it out on one tank', () => {
    const { st, session, refills, texts } = fight(small);
    expect(st.state).toBe('passed');
    expect(st.text).toMatch(/Fire out in \d+ s/);
    expect(refills).toBe(0);
    expect(session.waterLevel).toBeGreaterThan(0.3);
    expect(session.state.time).toBeLessThan(FIRST_FIRE.twoS);
    expect(st.stars).toBeGreaterThanOrEqual(2);
    expect(session.crashed).toBe(false);
    expect(texts.some((t) => /follow the smoke/.test(t))).toBe(true);
    expect(texts.some((t) => /hold Space to drop/.test(t))).toBe(true);
  });

  it('first fire: never dropping runs out of time', () => {
    const { st } = fight(small, { drop: false });
    expect(st.state).toBe('failed');
    expect(st.reason).toMatch(/Out of time/);
  });

  it('forest fire: one tank runs dry, a refill at the lake finishes it', () => {
    const { st, session, refills, texts } = fight(big);
    expect(st.state).toBe('passed');
    expect(refills).toBeGreaterThanOrEqual(1);
    expect(refills).toBeLessThanOrEqual(2);
    expect(session.state.time).toBeLessThan(FOREST_FIRE.limitS);
    expect(session.crashed).toBe(false);
    expect(texts.some((t) => /Tank empty/.test(t))).toBe(true);
    expect(texts.some((t) => /Filling the tank/.test(t))).toBe(true);
  });

  it('forest fire: without a refill the tank runs dry and the fire wins', () => {
    const { st, session } = fight(big, { refill: false });
    expect(session.water).toBe(0);
    expect(st.state).toBe('failed');
    expect(session.fire!.burning).toBeGreaterThan(0);
  });

  it('the refill spot the test pilot uses is open water', () => {
    expect(world.surfaceAt(lakeSpot.x, lakeSpot.z)).toBe('water');
    expect(world.areaAt(lakeSpot.x, lakeSpot.z)).toBeUndefined();
  });
});
