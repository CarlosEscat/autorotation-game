import { describe, expect, it } from 'vitest';
import { FlightConfig, FlightSession } from '../src/game/session';
import { LEVELS, ObjectiveStatus, TIERS, gateY, isUnlocked, unlocksFromOldLayouts, windAngleDeg } from '../src/game/levels';
import { TouchdownReport } from '../src/game/landing';
import { createWorld } from '../src/world/world';
import { ControlInputs, HelicopterState, neutralControls } from '../src/sim/state';
import { DEG, clamp, wrapAngle } from '../src/sim/vec';
import { BotOptions, makeBot } from './pilotBot';
import { LandingTechnique, flyLanding } from './landingPilot';

const world = createWorld();
const level = (id: string) => LEVELS.find((l) => l.id === id)!;

type Pilot = (s: HelicopterState, c: ControlInputs, session: FlightSession, nextGate: number, st: ObjectiveStatus) => void;

const steerTo = (s: HelicopterState, x: number, z: number) => {
  let err = Math.atan2(-(x - s.pos.x), -(z - s.pos.z)) - s.yaw;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  return clamp(-err * 2.5, -1, 1);
};

/** The scripted autorotation pilot, steering at the level's target while high. */
function botPilot(o: BotOptions = {}, steer = true): Pilot {
  const bot = makeBot(o);
  return (s, c, session) => {
    bot(s, c);
    const t = session.world.areas.find((a) => a.id === 'meadow')!;
    c.cyclicRoll = steer && s.agl > 20 ? steerTo(s, t.cx, t.cz) : 0;
  };
}

function runLevel(id: string, pilot: Pilot, mode: 'keyboard' | 'touch' = 'keyboard', cfg: Partial<FlightConfig> = {}) {
  const def = level(id);
  const session = new FlightSession(world, { ...def.config, ...cfg });
  const objective = def.makeObjective(world);
  const c = neutralControls(session.state.collective);
  let st: ObjectiveStatus = objective.update({ session, targetId: def.target, mode }, 0);
  const texts = new Set<string>();
  for (let n = 0; n < 120 * 300 && st.state === 'running'; n++) {
    pilot(session.state, c, session, st.nextGate ?? 0, st);
    session.step(c);
    st = objective.update({ session, targetId: def.target, mode }, 1 / 120);
    texts.add(st.text);
  }
  return { st, session, texts };
}

/**
 * Holds a hover over a point: cyclic for position, pedals for heading, and the collective either for a
 * height (m AGL) or, with `sinkMs`, for a steady descent.
 */
function hoverAt(s: HelicopterState, c: ControlInputs, trim: number, x: number, z: number, headingDeg: number, height = 3, sinkMs?: number) {
  // Descending: integrate on the sink-rate error, since the collective a hover needs drops in ground effect.
  c.collective = clamp(sinkMs === undefined ? trim + (height - s.agl) * 0.03 - s.vel.y * 0.05 : c.collective + ((-sinkMs - s.vel.y) * 0.3) / 120, 0, 1);
  const fwd = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
  const right = { x: Math.cos(s.yaw), z: -Math.sin(s.yaw) };
  const ex = x - s.pos.x, ez = z - s.pos.z;
  const aF = clamp(0.15 * (ex * fwd.x + ez * fwd.z), -2, 2) - 0.6 * (s.vel.x * fwd.x + s.vel.z * fwd.z);
  const aR = clamp(0.15 * (ex * right.x + ez * right.z), -2, 2) - 0.6 * (s.vel.x * right.x + s.vel.z * right.z);
  const pitchT = clamp(-Math.atan(aF / 9.81), -8 * DEG, 8 * DEG);
  c.cyclicPitch = clamp((pitchT - s.pitchCmd) * 6, -1, 1);
  c.cyclicRoll = clamp(Math.atan(aR / 9.81) / (35 * DEG), -0.25, 0.25);
  c.pedal = clamp(wrapAngle((headingDeg - s.heading) * DEG) / DEG / 20, -1, 1);
}

describe('training levels', () => {
  it('basics: flying through the gates passes', () => {
    const gates = level('basics').gates;
    let trim = Number.NaN;
    const { st } = runLevel('basics', (s, c, _session, next) => {
      const g = gates[Math.min(next, gates.length - 1)];
      if (Number.isNaN(trim)) trim = c.collective;
      const dy = gateY(g, world) - s.pos.y;
      c.collective = clamp(trim + dy * 0.01 - s.vel.y * 0.04, 0, 1);
      c.cyclicRoll = steerTo(s, g.x, g.z);
      c.cyclicPitch = clamp((-0.08 - s.pitchCmd) * 6, -1, 1);
    });
    expect(st.state).toBe('passed');
    expect(st.stars).toBeGreaterThanOrEqual(2);
  });

  it.each(['failure', 'glide', 'flare'])('%s can be passed by good technique', (id) => {
    const { st } = runLevel(id, botPilot());
    console.log(id, st.state, st.stars, st.reason ?? st.text);
    expect(st.state).toBe('passed');
    expect(st.stars).toBeGreaterThanOrEqual(1);
  });

  it('flare and cushion: both together land softly in the meadow, either one alone fails', () => {
    const def = level('cushion');
    const run = (t: LandingTechnique) => {
      const objective = def.makeObjective(world);
      let st: ObjectiveStatus | null = null;
      const { session } = flyLanding(world, def.config, t, (session) => {
        st = objective.update({ session, targetId: 'meadow', mode: 'keyboard' }, 1 / 120);
        return st.state !== 'running';
      });
      return { st: st!, session };
    };
    for (const [flareFt, flarePitchDeg] of [[50, 10], [60, 8]]) {
      const { st, session } = run({ flareFt, flarePitchDeg, cushionFt: 5 });
      expect(st.state).toBe('passed');
      expect(world.areaAt(session.state.pos.x, session.state.pos.z)?.id).toBe('meadow');
    }
    expect(run({ flareFt: 55, flarePitchDeg: 10, cushionFt: 0 }).st.reason).toMatch(/collective/);
    expect(run({ flareFt: 0, flarePitchDeg: 0, cushionFt: 5 }).st.reason).toMatch(/flare/i);
  });

  it('checkride: a good flight from a reachable height passes', () => {
    const { st } = runLevel('checkride', botPilot(), 'keyboard', { altitudeFt: 560 });
    expect(st.state).toBe('passed');
  });

  it('field: picking the reachable field and gliding to it lands there', () => {
    const def = level('field');
    const session = new FlightSession(world, def.config);
    const objective = def.makeObjective(world);
    const c = neutralControls(session.state.collective);
    const bot = makeBot();
    const meadow = world.areas.find((a) => a.id === 'meadow')!;
    let st = objective.update({ session, targetId: 'clearing', mode: 'keyboard' }, 0);
    expect(st.text).toMatch(/TOO FAR/);
    // One T press selects the meadow, which must already be in reach.
    expect(objective.update({ session, targetId: 'meadow', mode: 'keyboard' }, 0).text).toMatch(/in reach|Heading for/);
    for (let n = 0; n < 120 * 200 && st.state === 'running'; n++) {
      bot(session.state, c);
      c.cyclicRoll = session.state.agl > 20 ? steerTo(session.state, meadow.cx, meadow.cz) : 0;
      session.step(c);
      st = objective.update({ session, targetId: 'meadow', mode: 'keyboard' }, 1 / 120);
    }
    expect(st.state).toBe('passed');
    expect(st.stars).toBeGreaterThanOrEqual(2);
  });

  it('field: staying with the too-far field fails', () => {
    const { st } = runLevel('field', (s, c, session) => {
      c.collective = 0.1;
      const t = session.world.areas.find((a) => a.id === 'clearing')!;
      c.cyclicRoll = s.agl > 20 ? steerTo(s, t.cx, t.cz) : 0;
    });
    expect(st.state).toBe('failed');
  });

  it('failure: never lowering the collective fails', () => {
    const { st } = runLevel('failure', botPilot({ lowerCollective: false }));
    expect(st.state).toBe('failed');
    expect(st.reason).toMatch(/collective/);
  });

  it('flare: no flare fails', () => {
    const { st } = runLevel('flare', botPilot({ flareHeight: 0 }));
    expect(st.state).toBe('failed');
    expect(st.reason).toMatch(/flare/i);
  });

  it('crash fails a non-landing level', () => {
    // Full collective with no engine bleeds the rotor until it stalls.
    const { st } = runLevel('glide', (_s, c) => void (c.collective = 1));
    expect(st.state).toBe('failed');
  });

  it.each(LEVELS.map((l) => l.id))('%s always ends, even with nobody flying', (id) => {
    const { st } = runLevel(id, () => {});
    expect(st.state).not.toBe('running');
  });

  it('instructions use touch wording', () => {
    const { texts } = runLevel('failure', botPilot(), 'touch');
    expect([...texts].some((t) => t.includes('COLL'))).toBe(true);
  });

  it('wind: angle off the wind at touchdown', () => {
    const td = (headwind: number) => ({ headwind }) as TouchdownReport;
    expect(windAngleDeg(td(15 / 1.943844), 15)).toBeCloseTo(0);
    expect(windAngleDeg(td(0), 15)).toBeCloseTo(90);
    expect(windAngleDeg(td(-15 / 1.943844), 15)).toBeCloseTo(180);
  });

  it('unlocking runs in order across tiers; a level with stars stays open', () => {
    const at = (id: string) => LEVELS.findIndex((l) => l.id === id);
    expect(isUnlocked(0, {})).toBe(true);
    expect(isUnlocked(1, {})).toBe(false);
    expect(isUnlocked(1, { basics: 1 })).toBe(true);
    expect(isUnlocked(at('rings'), { basics: 3, hover: 2, takeoff: 1 })).toBe(false);
    expect(isUnlocked(at('rings'), { landing: 1 })).toBe(true);
    expect(isUnlocked(at('failure'), { landing: 1 })).toBe(false);
    expect(isUnlocked(at('failure'), { heliport: 1 })).toBe(true);
    expect(isUnlocked(at('cushion'), { flare: 1 })).toBe(true);
    expect(isUnlocked(at('failure'), {}, ['failure'])).toBe(true);
    // An older save that passed the old level 2 keeps it open.
    expect(isUnlocked(at('failure'), { basics: 3, failure: 2 })).toBe(true);
  });

  it('migration: levels open under an older layout stay open, stars are untouched', () => {
    const at = (id: string) => LEVELS.findIndex((l) => l.id === id);
    // Finished Beginner on the 11-level layout: Engine failure was next.
    const beginnerDone = { basics: 3, hover: 2, takeoff: 2, landing: 1 };
    expect(isUnlocked(at('failure'), beginnerDone)).toBe(false);
    const granted = unlocksFromOldLayouts(beginnerDone);
    expect(granted).toContain('failure');
    expect(isUnlocked(at('failure'), beginnerDone, granted)).toBe(true);
    expect(isUnlocked(at('rings'), beginnerDone, granted)).toBe(true);
    expect(isUnlocked(at('glide'), beginnerDone, granted)).toBe(false);
    // Mid-way through the old 8-level list.
    const old = { basics: 3, failure: 3, glide: 2 };
    expect(unlocksFromOldLayouts(old)).toEqual(expect.arrayContaining(['basics', 'failure', 'glide', 'field', 'hover']));
    expect(isUnlocked(at('field'), old, unlocksFromOldLayouts(old))).toBe(true);
    expect(unlocksFromOldLayouts({})).toEqual(['basics']);
  });

  it('tiers: beginner, intermediate, emergency, expert in order, numbered within each tier', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['beginner', 'intermediate', 'emergency', 'expert']);
    expect(LEVELS.map((l) => l.id)).toEqual([
      'basics', 'hover', 'takeoff', 'landing',
      'rings', 'windfield', 'vtakeoff', 'vlanding', 'heliport',
      'failure', 'glide', 'field', 'flare',
      'cushion', 'wind', 'checkride',
    ]);
    expect(LEVELS.map((l) => l.label)).toEqual([
      'Beginner 1', 'Beginner 2', 'Beginner 3', 'Beginner 4',
      'Intermediate 1', 'Intermediate 2', 'Intermediate 3', 'Intermediate 4', 'Intermediate 5',
      'Emergency 1', 'Emergency 2', 'Emergency 3', 'Emergency 4',
      'Expert 1', 'Expert 2', 'Expert 3',
    ]);
  });

  describe('beginner lessons', () => {
    const def = (id: string) => level(id);

    it('hover: two pedal turns and the hover box pass without touching down', () => {
      const d = def('hover');
      const start = d.config.start!;
      let trim = Number.NaN;
      const { st, session } = runLevel('hover', (s, c, _session, next, status) => {
        if (Number.isNaN(trim)) trim = c.collective;
        const step = Math.round((status.progress ?? 0) * 7);
        const heading = step === 1 ? 270 : 0;
        const g = step >= 3 ? d.gates[next] : { x: start.x, z: start.z };
        hoverAt(s, c, trim, g.x, g.z, heading);
      });
      expect(st.state).toBe('passed');
      expect(st.stars).toBeGreaterThanOrEqual(2);
      expect(session.touchdown).toBeNull();
    });

    it('hover: lowering the collective touches down and fails', () => {
      const { st } = runLevel('hover', (_s, c) => void (c.collective = 0.3));
      expect(st.state).toBe('failed');
      expect(st.reason).toMatch(/Touched the ground/);
    });

    it('hover: starts trimmed, so letting go holds the height', () => {
      const d = def('hover');
      const session = new FlightSession(world, d.config);
      const c = neutralControls(session.state.collective);
      for (let n = 0; n < 120 * 10; n++) session.step(c);
      expect(session.state.agl).toBeGreaterThan(2);
      expect(session.state.agl).toBeLessThan(4);
    });

    /** Light on the skids, nose 7° down to slide and accelerate, then climb at 30 kt. */
    const takeoffPilot = (lightColl: number, climbColl: number): Pilot => (s, c) => {
      const kt = s.airspeed * 1.943844;
      c.collective = clamp(c.collective + 0.5 / 120, 0, kt < 30 ? lightColl : climbColl);
      c.cyclicPitch = clamp(((kt < 30 ? -7 : -4) * DEG - s.pitchCmd) * 6, -1, 1);
      c.cyclicRoll = 0;
    };

    it('running takeoff: slide, lift off and climb through the ring', () => {
      const { st, session } = runLevel('takeoff', takeoffPilot(0.43, 0.44));
      expect(st.state).toBe('passed');
      expect(st.stars).toBeGreaterThanOrEqual(2);
      expect(session.crashed).toBe(false);
    });

    it('running takeoff: starts on the skids and stays there with the collective down', () => {
      const session = new FlightSession(world, def('takeoff').config);
      const c = neutralControls(session.state.collective);
      for (let n = 0; n < 120 * 5; n++) session.step(c);
      expect(session.onSkids).toBe(true);
      expect(session.state.groundSpeed).toBeLessThan(0.1);
      expect(session.touchdown).toBeNull();
    });

    it('running takeoff: pulling straight up fails', () => {
      const { st } = runLevel('takeoff', (_s, c) => void (c.collective = 0.7));
      expect(st.state).toBe('failed');
      expect(st.reason).toMatch(/straight up/);
    });

    /** Powered approach: hold a sink rate with the collective, slow down near the ground. */
    const landingPilot = (sinkMs: number): Pilot => {
      let trim = Number.NaN;
      return (s, c, session) => {
        if (Number.isNaN(trim)) trim = c.collective;
        const kt = s.airspeed * 1.943844;
        const wantVs = s.agl > 3 ? -sinkMs : -0.4;
        c.collective = session.onSkids ? 0 : clamp(trim - 0.04 + (wantVs - s.verticalSpeed) * 0.05, 0, 1);
        c.cyclicPitch = clamp(((kt - (s.agl > 10 ? 40 : 20)) * 0.4 * DEG - s.pitchCmd) * 6, -1, 1);
      };
    };

    it('running landing: a gentle approach touches down moving and stops on the runway', () => {
      const { st, session } = runLevel('landing', landingPilot(2));
      expect(st.state).toBe('passed');
      expect(st.stars).toBeGreaterThanOrEqual(2);
      expect(world.areaAt(session.state.pos.x, session.state.pos.z)?.id).toBe('runway');
      expect(session.touchdown!.groundSpeed * 1.943844).toBeGreaterThan(10);
    });

    it('running landing: diving at the ground is a hard landing', () => {
      const { st } = runLevel('landing', (s, c) => {
        c.collective = 0;
        c.cyclicPitch = clamp((-2 * DEG - s.pitchCmd) * 6, -1, 1);
      });
      expect(st.state).toBe('failed');
    });
  });

  describe('intermediate lessons', () => {
    const def = (id: string) => level(id);

    /** Turns toward each ring with yaw-rate damping, about 64 kt, height from the collective. */
    const ringPilot = (): Pilot => {
      const gates = def('rings').gates;
      let trim = Number.NaN, prevYaw = Number.NaN;
      return (s, c, _session, next) => {
        const g = gates[Math.min(next, gates.length - 1)];
        if (Number.isNaN(trim)) (trim = c.collective), (prevYaw = s.yaw);
        c.collective = clamp(trim + (gateY(g, world) - s.pos.y) * 0.01 - s.vel.y * 0.04, 0, 1);
        const err = wrapAngle(Math.atan2(-(g.x - s.pos.x), -(g.z - s.pos.z)) - s.yaw);
        const rate = wrapAngle(s.yaw - prevYaw) * 120;
        prevYaw = s.yaw;
        c.cyclicRoll = clamp(-(2 * err - rate), -1, 1);
        c.cyclicPitch = clamp((-0.03 - s.pitchCmd) * 6, -1, 1);
      };
    };

    it('precision flying: a steady pilot gets through all rings in time', () => {
      const { st } = runLevel('rings', ringPilot());
      expect(st.state).toBe('passed');
      expect(st.stars).toBeGreaterThanOrEqual(2);
    });

    it('precision flying: ignoring the rings runs out of time', () => {
      const { st } = runLevel('rings', (s, c) => void (c.cyclicPitch = clamp((-0.03 - s.pitchCmd) * 6, -1, 1)));
      expect(st.state).toBe('failed');
    });

    it('precision flying: rings face the way they are flown and are smaller than Basic flying', () => {
      const gates = def('rings').gates;
      expect(gates.length).toBeGreaterThan(def('basics').gates.length);
      for (const g of gates) expect(g.radius).toBeLessThan(def('basics').gates[0].radius);
      expect(gates.every((g) => g.facing !== undefined)).toBe(true);
    });

    /**
     * Wind landing: fly out to a point downwind of the circle, turn onto the into-wind line, slow down along it
     * and finish with a hover-taxi and slow descent over the circle, nose into the wind.
     */
    const windPilot = (headingOffsetDeg = 0): Pilot => {
      const pad = def('windfield').pads![0];
      let trim = Number.NaN, phase: 'out' | 'final' | 'hover' = 'out';
      return (s, c, session) => {
        if (Number.isNaN(trim)) trim = trimmedHover(session);
        const into = session.config.windFromDeg + headingOffsetDeg;
        const dir = { x: Math.sin(into * DEG), z: -Math.cos(into * DEG) };
        const gate = { x: pad.x - dir.x * 450, z: pad.z - dir.z * 450 };
        if (phase === 'out' && Math.hypot(s.pos.x - gate.x, s.pos.z - gate.z) < 60) phase = 'final';
        const d = Math.hypot(s.pos.x - pad.x, s.pos.z - pad.z);
        if (phase === 'final' && d < 40) phase = 'hover';
        if (session.onSkids) return void ((c.collective = 0), (c.cyclicRoll = 0), (c.pedal = 0));
        if (phase === 'hover') {
          const over = d < 1.5 && s.groundSpeed < 0.6;
          return hoverAt(s, c, trim, pad.x, pad.z, into, 8, over ? (s.agl > 2 ? 0.8 : 0.3) : undefined);
        }
        const tx = phase === 'out' ? gate.x : pad.x, tz = phase === 'out' ? gate.z : pad.z;
        const err = wrapAngle(Math.atan2(-(tx - s.pos.x), -(tz - s.pos.z)) - s.yaw);
        c.cyclicRoll = clamp(-err * 1.5, -0.7, 0.7);
        c.pedal = 0;
        const wantKt = phase === 'out' ? 60 : clamp(d / 12, 8, 50);
        const wantAgl = phase === 'out' ? 90 : clamp(d / 12, 8, 60);
        const kt = (phase === 'out' ? s.airspeed : s.groundSpeed) * 1.943844;
        c.cyclicPitch = clamp(((kt - wantKt) * 0.3 * DEG - s.pitchCmd) * 4, -1, 1);
        c.collective = clamp(trim + (wantAgl - s.agl) * 0.01 - s.vel.y * 0.05, 0, 1);
      };
    };

    /** Collective that holds a hover in still air, OGE (the hover lessons' own trim, measured). */
    const trimmedHover = (session: FlightSession) => {
      const probe = new FlightSession(world, { ...def('vlanding').config, windKt: session.config.windKt });
      return probe.state.collective;
    };

    it('landing into the wind: a careful into-wind approach lands in the circle', () => {
      const { st, session } = runLevel('windfield', windPilot());
      expect(st.state).toBe('passed');
      expect(st.stars).toBeGreaterThanOrEqual(2);
      expect(windAngleDeg(session.touchdown!, session.config.windKt)).toBeLessThan(15);
    });

    it('landing into the wind: the same landing facing across the wind fails', () => {
      const { st } = runLevel('windfield', windPilot(90));
      expect(st.state).toBe('failed');
      expect(st.reason).toMatch(/off the wind/);
    });

    /** Lift to a 10 ft hover over the spot, hold it, then nose forward and climb through the ring. */
    const vtakeoffPilot = (): Pilot => {
      const spot = def('vtakeoff').config.start!;
      let trim = Number.NaN;
      return (s, c, session, _next, st) => {
        if (Number.isNaN(trim)) trim = trimmedHover(session);
        if ((st.progress ?? 0) < 0.5) {
          if (session.onSkids) return void (c.collective = clamp(c.collective + 0.4 / 120, 0, 1));
          return hoverAt(s, c, trim, spot.x, spot.z, 0, 3);
        }
        const kt = s.airspeed * 1.943844;
        c.pedal = 0;
        c.cyclicRoll = 0;
        c.cyclicPitch = clamp(((kt < 30 ? -8 : -4) * DEG - s.pitchCmd) * 6, -1, 1);
        c.collective = clamp(trim + (kt > 15 ? 0.02 : 0) + (12 - s.vel.y * 4) * 0.004, 0, 1);
      };
    };

    it('vertical takeoff: hover first, then climb through the ring', () => {
      const { st, session } = runLevel('vtakeoff', vtakeoffPilot());
      expect(st.state).toBe('passed');
      expect(st.stars).toBeGreaterThanOrEqual(2);
      expect(session.crashed).toBe(false);
    });

    it('vertical takeoff: starts on the skids', () => {
      const session = new FlightSession(world, def('vtakeoff').config);
      expect(session.onSkids).toBe(true);
    });

    it('vertical takeoff: leaving without a steady hover fails', () => {
      const { st } = runLevel('vtakeoff', (s, c) => {
        c.collective = clamp(c.collective + 0.4 / 120, 0, 0.5);
        c.cyclicPitch = clamp((-8 * DEG - s.pitchCmd) * 6, -1, 1);
      });
      expect(st.state).toBe('failed');
      expect(st.reason).toMatch(/hover/i);
    });

    /** Hover-taxi over the pad, then a slow, straight descent onto it. */
    const padPilot = (id: string, sinkMs = 0.6): Pilot => {
      const pad = def(id).pads![0];
      let trim = Number.NaN;
      return (s, c, session) => {
        if (Number.isNaN(trim)) trim = c.collective;
        if (session.onSkids) return void (c.collective = 0);
        const over = Math.hypot(s.pos.x - pad.x, s.pos.z - pad.z) < 1 && s.groundSpeed < 0.5;
        hoverAt(s, c, trim, pad.x, pad.z, 0, s.agl, over ? (s.agl > 2 ? sinkMs : 0.3) : undefined);
      };
    };

    it.each(['vlanding', 'heliport'])('%s: a slow, straight descent over the pad lands on it', (id) => {
      const { st, session } = runLevel(id, padPilot(id));
      const pad = def(id).pads![0];
      expect(st.state).toBe('passed');
      expect(st.stars).toBe(3);
      expect(Math.hypot(session.state.pos.x - pad.x, session.state.pos.z - pad.z)).toBeLessThan(pad.radius);
    });

    it.each(['vlanding', 'heliport'])('%s: dropping straight away is too hard or off the pad', (id) => {
      const { st } = runLevel(id, (_s, c) => void (c.collective = 0.25));
      expect(st.state).toBe('failed');
    });

    it('heliport is a smaller target than the vertical landing circle', () => {
      expect(def('heliport').pads![0].radius).toBeLessThan(def('vlanding').pads![0].radius / 2);
      expect(def('heliport').pads![0].kind).toBe('heliport');
    });
  });
});
