import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AircraftSpec, HEAVY, MS_TO_KT } from '../src/sim/aircraft';
import { SIM_DT, stepFlight, trimmedState } from '../src/sim/flightModel';
import { ControlInputs, HelicopterState, neutralControls } from '../src/sim/state';
import { DEG, clamp, v3, wrapAngle } from '../src/sim/vec';
import { FlightSession } from '../src/game/session';
import { ALL_LEVELS, CONVERSION, HEAVY_LEVELS, LEVELS, ObjectiveStatus, gateY, heavyStates, nextLevelIndex } from '../src/game/levels';
import { BRIEFINGS } from '../src/ui/briefings';
import { configFromSettings, DEFAULT_SETTINGS, flightSummary, normalizeSettings } from '../src/ui/screens';
import { LAKE, createWorld } from '../src/world/world';

const env = { wind: v3(0, 0, 0), groundHeight: () => -1e5 };
const world = createWorld();

/** Level flight at 3000 m holding a nose-down attitude; returns the airspeed it settles at (kt), or 0 if it cannot hold height. */
function levelSpeed(A: AircraftSpec, pitchDeg: number): number {
  const s = trimmedState({ x: 0, y: 3000, z: 0, yaw: 0, airspeed: 40, wind: env.wind, aircraft: A });
  const c = neutralControls(s.collective);
  for (let t = 0; t < 120; t += SIM_DT) {
    s.pitchCmd = pitchDeg * DEG;
    c.collective = clamp(0.5 + (3000 - s.pos.y) * 0.02 - s.vel.y * 0.1, 0, 1);
    stepFlight(s, c, env);
  }
  return Math.abs(s.vel.y) < 1 ? s.airspeed * MS_TO_KT : 0;
}
const topSpeed = (A: AircraftSpec) => Math.max(...[-6, -8, -10, -12, -14, -16, -18].map((p) => levelSpeed(A, p)));

/** Climb rate (m/s) after 30 s at full collective from a trimmed start at `kt`. */
function climb(A: AircraftSpec, kt: number): HelicopterState {
  const s = trimmedState({ x: 0, y: 3000, z: 0, yaw: 0, airspeed: kt / MS_TO_KT, wind: env.wind, aircraft: A });
  const c = neutralControls(1);
  for (let t = 0; t < 30; t += SIM_DT) stepFlight(s, c, env);
  return s;
}

describe('heavy helicopter: flight model', () => {
  it('trims to a steady cruise, like the light one', () => {
    const s = trimmedState({ x: 0, y: 3000, z: 0, yaw: 0, airspeed: 120 / MS_TO_KT, wind: env.wind, aircraft: HEAVY });
    const c = neutralControls(s.collective);
    for (let t = 0; t < 10; t += SIM_DT) stepFlight(s, c, env);
    expect(Math.abs(s.verticalSpeed)).toBeLessThan(1);
    expect(s.airspeed * MS_TO_KT).toBeGreaterThan(112);
    expect(s.rpmPct).toBeGreaterThan(98);
  });

  it('is much faster than the light helicopter', () => {
    const light = topSpeed(AIRCRAFT), heavy = topSpeed(HEAVY);
    expect(light).toBeGreaterThan(95);
    expect(heavy).toBeGreaterThan(light * 1.4);
    expect(heavy).toBeLessThan(190);
  });

  it('climbs about twice as hard, without drooping the rotor or exceeding its engines', () => {
    for (const kt of [0, 60]) {
      const light = climb(AIRCRAFT, kt), heavy = climb(HEAVY, kt);
      expect(heavy.verticalSpeed).toBeGreaterThan(light.verticalSpeed * 1.8);
      expect(heavy.rpmPct).toBeGreaterThan(97);
      expect(heavy.enginePower).toBeLessThanOrEqual(HEAVY.engineMaxPower);
    }
  });

  it('answers the cyclic more slowly', () => {
    const bankAfter = (A: AircraftSpec) => {
      const s = trimmedState({ x: 0, y: 3000, z: 0, yaw: 0, airspeed: 30, wind: env.wind, aircraft: A });
      const c = { ...neutralControls(s.collective), cyclicRoll: 1 };
      for (let t = 0; t < 0.4; t += SIM_DT) stepFlight(s, c, env);
      return s.roll / A.rollMax;
    };
    expect(bankAfter(HEAVY)).toBeLessThan(bankAfter(AIRCRAFT) * 0.8);
  });

  it('the light helicopter is still the default', () => {
    const s = trimmedState({ x: 0, y: 3000, z: 0, yaw: 0, airspeed: 30, wind: env.wind });
    expect(s.aircraft).toBe(AIRCRAFT);
    expect(new FlightSession(world, { altitudeFt: 1000, airspeedKt: 70, windKt: 0, windFromDeg: 0, failureDelay: 4 }).state.aircraft).toBe(AIRCRAFT);
  });
});

describe('heavy helicopter: free flight', () => {
  it('the helicopter choice is saved, defaults to the trainer, and starts the heavy one faster', () => {
    expect(normalizeSettings({}).aircraft).toBe('light');
    expect(normalizeSettings({ aircraft: 'heavy' }).aircraft).toBe('heavy');
    expect(normalizeSettings({ aircraft: 'jet' as never }).aircraft).toBe('light');
    const light = configFromSettings({ ...DEFAULT_SETTINGS, airspeedKt: 75 });
    const heavy = configFromSettings({ ...DEFAULT_SETTINGS, airspeedKt: 75, aircraft: 'heavy' });
    expect(light).toMatchObject({ aircraft: 'light', airspeedKt: 75 });
    expect(heavy).toMatchObject({ aircraft: 'heavy', airspeedKt: 120 });
    expect(flightSummary({ ...DEFAULT_SETTINGS, aircraft: 'heavy' })).toMatch(/^Heavy · 1500 ft · 150 kt/);
  });

  it('cruises in free flight, then rests on its wheels after a gentle touchdown and lifts off again', () => {
    const session = new FlightSession(world, {
      aircraft: 'heavy', altitudeFt: 0, airspeedKt: 0, windKt: 0, windFromDeg: 0, failureDelay: 1e9, freeFlight: true, difficulty: 'easy',
      start: { x: -180, z: -500, yaw: 0, settle: 'skids' },
    });
    const c = neutralControls(session.state.collective);
    for (let n = 0; n < 120 * 3; n++) session.step(c);
    expect(session.onSkids).toBe(true);
    expect(session.state.agl).toBeCloseTo(0, 1);
    c.collective = 0.8;
    for (let n = 0; n < 120 * 6; n++) session.step(c);
    expect(session.onSkids).toBe(false);
    expect(session.state.agl).toBeGreaterThan(10);
    expect(session.crashed).toBe(false);
  });
});

describe('heavy helicopter: missions', () => {
  const def = HEAVY_LEVELS.find((l) => l.id === 'conversion')!;

  it('has its own path: the training lessons are unchanged and the first mission is always open', () => {
    expect(LEVELS.some((l) => l.tier === 'heavy')).toBe(false);
    expect(LEVELS.every((l) => (l.config.aircraft ?? 'light') === 'light')).toBe(true);
    expect(HEAVY_LEVELS.map((l) => l.label)).toEqual(['Heavy 1', 'Heavy 2', 'Heavy 3']);
    expect(HEAVY_LEVELS.map((l) => l.id)).toEqual(['conversion', 'firstfire', 'forestfire']);
    expect(HEAVY_LEVELS.every((l) => l.config.aircraft === 'heavy')).toBe(true);
    expect(heavyStates({})).toEqual(['next', 'locked', 'locked']);
    expect(heavyStates({ conversion: 2 })).toEqual(['passed', 'next', 'locked']);
    // The checkride ends the training path; it does not lead into the heavy missions.
    expect(nextLevelIndex(LEVELS.length - 1)).toBeNull();
    expect(nextLevelIndex(ALL_LEVELS.indexOf(def))).toBe(ALL_LEVELS.indexOf(def) + 1);
    expect(nextLevelIndex(ALL_LEVELS.length - 1)).toBeNull();
    expect(nextLevelIndex(0)).toBe(1);
    for (const l of ALL_LEVELS) expect(BRIEFINGS[l.id], l.id).toBeDefined();
  });

  const hoverTrim = () =>
    new FlightSession(world, { ...def.config, altitudeFt: 30, start: { x: def.pads![0].x, z: def.pads![0].z, yaw: 0, settle: 'hover' } }).state.collective;

  /** Holds a hover over a point, or with `sinkMs` descends steadily onto it. */
  function hoverAt(s: HelicopterState, c: ControlInputs, trim: number, x: number, z: number, height: number, sinkMs?: number) {
    c.collective = clamp(sinkMs === undefined ? trim + (height - s.agl) * 0.03 - s.vel.y * 0.05 : c.collective + ((-sinkMs - s.vel.y) * 0.3) / 120, 0, 1);
    const fwd = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
    const right = { x: Math.cos(s.yaw), z: -Math.sin(s.yaw) };
    const ex = x - s.pos.x, ez = z - s.pos.z;
    const aF = clamp(0.12 * (ex * fwd.x + ez * fwd.z), -2, 2) - 0.6 * (s.vel.x * fwd.x + s.vel.z * fwd.z);
    const aR = clamp(0.12 * (ex * right.x + ez * right.z), -2, 2) - 0.6 * (s.vel.x * right.x + s.vel.z * right.z);
    c.cyclicPitch = clamp((clamp(-Math.atan(aF / 9.81), -8 * DEG, 8 * DEG) - s.pitchCmd) * 6, -1, 1);
    c.cyclicRoll = clamp(Math.atan(aR / 9.81) / HEAVY.rollMax, -0.25, 0.25);
    c.pedal = 0;
  }

  /** Lifts off, flies the straights at `fastKt` and the bends at `turnKt`, then slows down, hovers over the circle and settles. */
  function fly(fastKt: number, turnKt: number, skip: number[] = []) {
    const gates = def.gates, pad = def.pads![0];
    const session = new FlightSession(world, def.config);
    const objective = def.makeObjective(world);
    const c = neutralControls(session.state.collective);
    const s = session.state;
    const trim = hoverTrim();
    let st: ObjectiveStatus = objective.update({ session, targetId: null, mode: 'keyboard' }, 0);
    let prevYaw = s.yaw, topKt = 0;
    const texts = new Set<string>();
    for (let n = 0; n < 120 * 400 && st.state === 'running'; n++) {
      const next = st.nextGate ?? 0;
      const rate = wrapAngle(s.yaw - prevYaw) * 120;
      prevYaw = s.yaw;
      c.pedal = 0;
      if (session.onSkids && next > 0) {
        c.collective = 0;
        c.cyclicRoll = 0;
      } else if (next < gates.length) {
        const g = gates[next];
        const aimY = gateY(g, world);
        // A skipped ring is flown past 70 m to one side.
        const gx = g.x + (skip.includes(next) ? 70 : 0);
        c.collective = clamp(trim + (clamp((aimY - s.pos.y) * 0.6, -6, 6) - s.vel.y) * 0.06, 0, 1);
        const err = wrapAngle(Math.atan2(-(gx - s.pos.x), -(g.z - s.pos.z)) - s.yaw);
        c.cyclicRoll = s.agl < 4 ? 0 : clamp(-(2 * err - rate), -1, 1);
        const kt = next >= 2 && next <= 6 ? turnKt : next === 8 ? Math.min(fastKt, 90) : fastKt;
        const want = s.agl < 4 ? 0 : clamp((s.airspeed * MS_TO_KT - kt) * 0.8 * DEG, -20 * DEG, 12 * DEG);
        c.cyclicPitch = clamp((want - s.pitchCmd) * 4, -1, 1);
      } else {
        const d = Math.hypot(s.pos.x - pad.x, s.pos.z - pad.z);
        if (d < 40) {
          const over = d < 2.5 && s.groundSpeed < 0.8;
          hoverAt(s, c, trim, pad.x, pad.z, 10, over ? (s.agl > 3 ? 1 : 0.4) : undefined);
        } else {
          const err = wrapAngle(Math.atan2(-(pad.x - s.pos.x), -(pad.z - s.pos.z)) - s.yaw);
          c.cyclicRoll = clamp(-(1.5 * err - rate * 0.5), -0.7, 0.7);
          const gs = s.groundSpeed * MS_TO_KT;
          c.cyclicPitch = clamp((clamp((gs - clamp(d / 6, 5, 60)) * DEG, -6 * DEG, 15 * DEG) - s.pitchCmd) * 4, -1, 1);
          const aimY = world.heightAt(pad.x, pad.z) + 20;
          c.collective = clamp(trim + (clamp((aimY - s.pos.y) * 0.4, -3, 3) - s.vel.y) * 0.03, 0, 1);
        }
      }
      session.step(c);
      st = objective.update({ session, targetId: null, mode: 'keyboard' }, 1 / 120);
      texts.add(st.text);
      topKt = Math.max(topKt, s.airspeed * MS_TO_KT);
    }
    return { st, session, topKt, texts };
  }

  it('conversion flight: starts on the runway in the heavy helicopter', () => {
    const session = new FlightSession(world, def.config);
    expect(session.state.aircraft).toBe(HEAVY);
    expect(session.onSkids).toBe(true);
    expect(world.areaAt(session.state.pos.x, session.state.pos.z)?.id).toBe('runway');
    expect(world.areaAt(def.pads![0].x, def.pads![0].z)?.id).toBe('runway');
  });

  it('conversion flight: a brisk run through every ring lands in the circle with three stars', () => {
    const { st, session, topKt } = fly(140, 85);
    expect(st.state).toBe('passed');
    expect(st.text).toMatch(/all rings/);
    expect(topKt).toBeGreaterThan(125);
    expect(session.state.time).toBeLessThan(CONVERSION.fastS);
    expect(st.stars).toBe(3);
    expect(session.crashed).toBe(false);
  });

  it('conversion flight: a careful run still passes but misses the speed star', () => {
    const { st, session } = fly(80, 70);
    expect(st.state).toBe('passed');
    expect(session.state.time).toBeGreaterThan(CONVERSION.fastS);
    expect(session.state.time).toBeLessThan(CONVERSION.limitS);
    expect(st.stars).toBe(2);
  });

  it('conversion flight: flying wide of a ring costs the rings star but the flight goes on', () => {
    const { st } = fly(140, 85, [1]);
    expect(st.state).toBe('passed');
    // At this speed, running wide of one ring can cost the next one too.
    expect(st.text).toMatch(/[78] of 9 rings/);
    expect(st.stars).toBe(2);
  });

  it('conversion flight: sitting on the runway runs out of time', () => {
    const session = new FlightSession(world, def.config);
    const objective = def.makeObjective(world);
    const c = neutralControls(session.state.collective);
    let st = objective.update({ session, targetId: null, mode: 'touch' }, 0);
    expect(st.text).toMatch(/On the runway/);
    for (let n = 0; n < 120 * (CONVERSION.limitS + 2) && st.state === 'running'; n++) {
      session.step(c);
      st = objective.update({ session, targetId: null, mode: 'touch' }, 1 / 120);
    }
    expect(st.state).toBe('failed');
    expect(st.reason).toMatch(/Out of time/);
  });
});

describe('heavy helicopter: water tank', () => {
  const overLake = { x: LAKE.x - 110, z: LAKE.z };
  const heavyAt = (altitudeFt: number, airspeedKt = 0) =>
    new FlightSession(world, {
      aircraft: 'heavy', altitudeFt, airspeedKt, windKt: 0, windFromDeg: 0, failureDelay: 1e9, freeFlight: true, difficulty: 'easy',
      start: { ...overLake, yaw: 0, ...(airspeedKt === 0 ? { settle: 'hover' as const } : {}) },
    });
  /** Flies `seconds` holding the starting collective, with the drop control held or not. */
  const run = (session: FlightSession, seconds: number, dropWater: boolean) => {
    const c = { ...neutralControls(session.state.collective), dropWater };
    for (let n = 0; n < 120 * seconds; n++) session.step(c);
  };

  it('starts full, and holding the drop control empties it in about six seconds', () => {
    const session = heavyAt(1000, 90);
    expect(session.waterLevel).toBe(1);
    run(session, 2, false);
    expect(session.waterLevel).toBe(1);
    expect(session.dropping).toBe(false);
    run(session, 3, true);
    expect(session.dropping).toBe(true);
    expect(session.waterLevel).toBeCloseTo(0.5, 1);
    run(session, 4, true);
    expect(session.waterLevel).toBe(0);
    expect(session.dropping).toBe(false);
  });

  it('letting go stops the drop and keeps what is left', () => {
    const session = heavyAt(1000, 90);
    run(session, 1.5, true);
    const left = session.waterLevel!;
    run(session, 3, false);
    expect(session.waterLevel).toBe(left);
    expect(left).toBeCloseTo(0.75, 1);
  });

  it('refills hovering low over the lake, but not from high up or at speed', () => {
    expect(world.surfaceAt(overLake.x, overLake.z)).toBe('water');
    // Heights are given above the lake bed; put the wheels about 4 m above the water.
    const bedToWater = world.waterLevel - world.heightAt(overLake.x, overLake.z);
    const low = heavyAt((bedToWater + 4) * 3.28084);
    low.water = 0;
    run(low, 5, false);
    expect(low.filling).toBe(true);
    expect(low.waterLevel).toBeCloseTo(0.5, 1);
    expect(low.crashed).toBe(false);

    const high = heavyAt((bedToWater + 40) * 3.28084);
    high.water = 0;
    run(high, 3, false);
    expect(high.waterLevel).toBe(0);

    const fast = heavyAt((bedToWater + 4) * 3.28084, 60);
    fast.water = 0;
    run(fast, 1, false);
    expect(fast.waterLevel).toBe(0);
  });

  it('the trainer has no tank', () => {
    const session = new FlightSession(world, { altitudeFt: 1000, airspeedKt: 70, windKt: 0, windFromDeg: 0, failureDelay: 1e9, freeFlight: true });
    expect(session.waterLevel).toBeNull();
    run(session, 1, true);
    expect(session.dropping).toBe(false);
    expect(session.filling).toBe(false);
  });
});
