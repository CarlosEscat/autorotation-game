import { describe, expect, it } from 'vitest';
import { FlightConfig, FlightSession } from '../src/game/session';
import { LEVELS, ObjectiveStatus, gateY, isUnlocked, windAngleDeg } from '../src/game/levels';
import { TouchdownReport } from '../src/game/landing';
import { createWorld } from '../src/world/world';
import { ControlInputs, HelicopterState, neutralControls } from '../src/sim/state';
import { clamp } from '../src/sim/vec';
import { BotOptions, makeBot } from './pilotBot';

const world = createWorld();
const level = (id: string) => LEVELS.find((l) => l.id === id)!;

type Pilot = (s: HelicopterState, c: ControlInputs, session: FlightSession, nextGate: number) => void;

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
    pilot(session.state, c, session, st.nextGate ?? 0);
    session.step(c);
    st = objective.update({ session, targetId: def.target, mode }, 1 / 120);
    texts.add(st.text);
  }
  return { st, session, texts };
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

  it('flare and cushion: both together land softly, either one alone fails', () => {
    /** Glide at 58 kt, flare at `flareFt`, level the skids, hold W while sinking below `cushionFt` (earlier if sinking fast). */
    const pilot = (flareFt: number, cushionFt: number): Pilot => {
      let phase = 'glide';
      return (s, c) => {
        const ft = s.agl * 3.28;
        const pitchTo = (t: number) => (c.cyclicPitch = clamp((t - s.pitchCmd) * 6, -1, 1));
        if (phase === 'glide') {
          pitchTo(clamp(-0.02 * (30 - s.airspeed) - 0.05, -0.25, 0.15));
          c.collective = clamp(0.1 + (s.rpmPct - 100) * 0.015, 0, 1);
          if (flareFt && ft < flareFt) phase = 'flare';
        } else if (phase === 'flare') {
          pitchTo(s.verticalSpeed > 0 ? Math.min(s.pitchCmd, 0.17) : 0.31);
          if (ft < 25 || s.groundSpeed < 8) phase = 'level';
        } else pitchTo(0.05);
        const cue = ft < cushionFt || (ft < 20 && cushionFt > 0 && cushionFt < 20 && s.verticalSpeed < -5.1);
        if (cue && s.verticalSpeed < -0.5) c.collective = clamp(c.collective + 0.75 / 120, 0, 1);
      };
    };
    // The start is placed so flares from about 45 to 80 ft all end in the meadow.
    for (const flareFt of [50, 60, 75]) {
      const { st, session } = runLevel('cushion', pilot(flareFt, 12));
      expect(st.state).toBe('passed');
      expect(world.areaAt(session.state.pos.x, session.state.pos.z)?.id).toBe('meadow');
    }
    expect(runLevel('cushion', pilot(55, 0)).st.reason).toMatch(/collective/);
    expect(runLevel('cushion', pilot(0, 12)).st.reason).toMatch(/flare/i);
    // Raising the collective far too early only holds you up until the rotor slows, then you drop.
    expect(runLevel('cushion', pilot(55, 40)).st.state).toBe('failed');
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

  it('unlocking', () => {
    expect(isUnlocked(0, {})).toBe(true);
    expect(isUnlocked(1, {})).toBe(false);
    expect(isUnlocked(1, { basics: 1 })).toBe(true);
  });
});
