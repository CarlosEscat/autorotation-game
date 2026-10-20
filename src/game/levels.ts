import { MS_TO_FPM, MS_TO_KT, M_TO_FT } from '../sim/aircraft';
import { DEG, wrapAngle } from '../sim/vec';
import { World } from '../world/world';
import { computeGuidance } from './guidance';
import { KEY_WORDS, Mode } from './hints';
import { TouchdownReport } from './landing';
import { FlightConfig, FlightSession } from './session';

export type ObjectiveState = 'running' | 'passed' | 'failed';

export interface ObjectiveStatus {
  state: ObjectiveState;
  /** What the player should do right now. */
  text: string;
  /** 0..1 toward the goal, or null when the goal has no meter. */
  progress: number | null;
  /** 1–3 once passed, otherwise 0. */
  stars: number;
  reason: string | null;
  /** Index of the next gate to fly through (gate levels only). */
  nextGate?: number;
}

export interface LevelContext {
  session: FlightSession;
  targetId: string | null;
  mode: Mode;
}

/** Watches a flight and decides the lesson. Call after every `session.step`. */
export interface Objective {
  update(ctx: LevelContext, dt: number): ObjectiveStatus;
}

/** A ring to fly through; `agl` is the centre's height above the terrain. */
export interface Gate {
  x: number;
  z: number;
  agl: number;
  radius: number;
}

export interface LevelDef {
  id: string;
  num: number;
  title: string;
  teaches: string;
  config: FlightConfig;
  /** Landing area selected at the start, or null to hide the beacon. */
  target: string | null;
  gates: Gate[];
  makeObjective(world: World): Objective;
}

type Update = Partial<ObjectiveStatus> & { text: string };
const pass = (stars: number, text = 'Goal reached!'): Update => ({ state: 'passed', stars, text, progress: 1 });
const fail = (reason: string): Update => ({ state: 'failed', reason, text: reason });

/**
 * Wraps a per-step lesson function: a crash always fails the level, so does a
 * flight that stops before the goal is met, and once decided the result never changes.
 */
function lesson(step: (ctx: LevelContext, dt: number) => Update): Objective {
  let final: ObjectiveStatus | null = null;
  return {
    update(ctx, dt) {
      if (final) return final;
      const r = ctx.session.crashed && !ctx.session.result ? fail(ctx.session.crashReason ?? 'Crashed') : step(ctx, dt);
      const st: ObjectiveStatus = { state: 'running', progress: null, stars: 0, reason: null, ...r };
      if (st.state === 'running' && ctx.session.result) Object.assign(st, fail('The flight ended before the goal was reached.'));
      if (st.state !== 'running') final = st;
      return st;
    },
  };
}

const ft = (m: number) => Math.round(m * M_TO_FT);
const fpm = (ms: number) => Math.round(ms * MS_TO_FPM);

export const gateY = (g: Gate, world: World) => world.heightAt(g.x, g.z) + g.agl;

/** Angle between the nose at touchdown and the direction the wind comes from, degrees. */
export function windAngleDeg(td: TouchdownReport, windKt: number): number {
  if (windKt < 1) return 0;
  const cos = Math.max(-1, Math.min(1, td.headwind / (windKt / MS_TO_KT)));
  return Math.acos(cos) / DEG;
}

const BASE: FlightConfig = { altitudeFt: 1000, airspeedKt: 70, windKt: 0, windFromDeg: 0, failureDelay: 4, difficulty: 'easy' };
const NEVER = 1e9;
const MEADOW_APPROACH = { x: -380, z: 700, yaw: 0 };

export const LEVELS: LevelDef[] = [
  {
    id: 'basics',
    num: 1,
    title: 'Basic flying',
    teaches: 'Cyclic to bank and change speed, collective to climb and descend.',
    config: { ...BASE, altitudeFt: 600, failureDelay: NEVER },
    target: null,
    gates: [
      { x: 0, z: 750, agl: 175, radius: 22 },
      { x: -230, z: 430, agl: 150, radius: 22 },
      { x: -470, z: 160, agl: 130, radius: 22 },
    ],
    makeObjective(world) {
      const gates = this.gates;
      let next = 0;
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const g = gates[next];
        if (Math.hypot(s.pos.x - g.x, s.pos.z - g.z) < g.radius && Math.abs(s.pos.y - gateY(g, world)) < g.radius) next++;
        if (next === gates.length) {
          const t = s.time;
          return { ...pass(t < 70 ? 3 : t < 110 ? 2 : 1, 'All gates done!'), nextGate: next };
        }
        if (s.agl < 15) return fail('Too low! Raise the collective to climb.');
        const text = [
          `Fly through gate 1 (the yellow ring). Bank with ${k.turn} to turn; ${k.fwd} / ${k.aft} tilts the nose to speed up or slow down.`,
          `Gate 2 is lower and to the left. Lower the collective (${k.down}) to descend, raise it (${k.up}) to climb.`,
          'Last gate! Line up early and fly straight through.',
        ][next];
        return { text, progress: next / gates.length, nextGate: next };
      });
    },
  },
  {
    id: 'failure',
    num: 2,
    title: 'Engine failure!',
    teaches: 'Lower the collective at once and keep rotor RPM in the green.',
    config: { ...BASE, altitudeFt: 3000, failureDelay: 3 },
    target: null,
    gates: [],
    makeObjective() {
      let green = 0, watched = 0;
      return lesson(({ session, mode }, dt) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        if (session.phase === 'cruise') return { text: `Cruising, engine running. It is about to fail: when it does, lower the collective (${k.down}) at once.` };
        const reaction = session.rec.reactionTime;
        if (reaction === null) {
          if (session.timeSinceFailure > 3) return fail('Too slow: lower the collective within 3 seconds of the failure, or the rotor slows down.');
          return { text: `ENGINE FAILURE! Lower the collective now (${k.down}).`, progress: 0 };
        }
        watched += dt;
        const rpm = s.rpmPct;
        if (rpm >= 90 && rpm <= 110) green += dt;
        if (green >= 15) {
          const ratio = green / watched;
          return pass(reaction < 1 && ratio > 0.85 ? 3 : reaction < 1.6 ? 2 : 1, 'Rotor saved!');
        }
        const text =
          rpm < 90
            ? `Rotor RPM low: lower the collective more (${k.down}).`
            : rpm > 110
              ? `Rotor RPM high: raise the collective a little (${k.up}).`
              : 'In the green. Keep it there: collective down = RPM up, collective up = RPM down.';
        return { text, progress: green / 15 };
      });
    },
  },
  {
    id: 'glide',
    num: 3,
    title: 'Glide speed',
    teaches: 'Hold 55–70 kt: slower or faster than that, you sink faster.',
    config: { ...BASE, altitudeFt: 2500, airspeedKt: 65, start: { x: 0, z: 1100, yaw: 0, autorotating: { sinkMs: 7, collective: 0.1 } } },
    target: null,
    gates: [],
    makeObjective() {
      let good = 0, watched = 0;
      return lesson(({ session, mode }, dt) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        watched += dt;
        const kt = s.airspeed * MS_TO_KT;
        const inBand = kt >= 55 && kt <= 70;
        if (inBand && s.rpmPct > 80) good += dt;
        if (good >= 20) {
          const eff = good / watched;
          return pass(eff > 0.8 ? 3 : eff > 0.55 ? 2 : 1, 'Nice, steady glide!');
        }
        if (s.agl < 91) return fail('Ran out of height. Settle at 55–70 kt sooner.');
        const text =
          s.rpmPct < 90
            ? `Rotor RPM low: lower the collective (${k.down}).`
            : kt < 55
              ? `Too slow (${Math.round(kt)} kt): the sink rate goes up. Lower the nose (${k.fwd}).`
              : kt > 70
                ? `Too fast (${Math.round(kt)} kt). Raise the nose a little (${k.aft}).`
                : `Good: ${Math.round(kt)} kt, sinking ${fpm(-s.verticalSpeed)} fpm. This is about as slow as you can sink.`;
        return { text, progress: good / 20 };
      });
    },
  },
  {
    id: 'field',
    num: 4,
    title: 'Pick a field',
    teaches: 'Choose a field you can reach and glide to it.',
    // Facing south: the meadow is too far, one T press selects the Farm Strip, in reach ahead and to the right.
    config: { ...BASE, altitudeFt: 1000, airspeedKt: 65, start: { x: 700, z: -100, yaw: Math.PI, autorotating: { sinkMs: 7, collective: 0.1 } } },
    target: 'meadow',
    gates: [],
    makeObjective(world) {
      return lesson(({ session, targetId, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const area = world.areas.find((a) => a.id === targetId) ?? world.areas[0];
        // Generous finish: anywhere within 80 m of the field counts as arriving.
        const near = world.areaAt(s.pos.x, s.pos.z, 80)?.id === area.id;
        if (near && s.agl > 30) {
          const left = s.agl;
          return pass(left > 90 ? 3 : left > 55 ? 2 : 1, `Made it to ${area.name} with ${ft(left)} ft to spare!`);
        }
        if (s.agl <= 30) return fail(`Too low before reaching ${area.name}. Pick a field that says IN REACH.`);
        const g = computeGuidance(s, area, session.wind);
        const text =
          g.reach === 'short'
            ? `${area.name} is TOO FAR. Press ${k.target} to cycle fields until one says IN REACH.`
            : g.reach === 'marginal'
              ? `${area.name} is MARGINAL. You might make it, but a closer field (${k.target}) is safer.`
              : Math.abs(g.relBearing) > 20 * DEG
                ? `${area.name} is in reach. Turn toward the beacon (${k.turn}) and hold 55–70 kt.`
                : `Heading for ${area.name}. Keep 55–70 kt and arrive above 100 ft.`;
        return { text };
      });
    },
  },
  {
    id: 'flare',
    num: 5,
    title: 'The flare',
    teaches: 'Pull back at about 50 ft to stop the sink and slow down.',
    config: { ...BASE, altitudeFt: 300, airspeedKt: 60, start: { ...MEADOW_APPROACH, autorotating: { sinkMs: 7, collective: 0.1 } } },
    target: 'meadow',
    gates: [],
    makeObjective() {
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const flareAt = session.rec.flareStartAgl;
        const r = session.result;
        if (r) {
          if (flareAt === null || flareAt < 7.6) return fail('Flared too late: start pulling back at about 50 ft.');
          const td = r.touchdown!;
          const good = flareAt >= 10.7 && flareAt <= 21.3 && td.groundSpeed < 4.1;
          return pass(good ? 3 : r.outcome !== 'damaged' ? 2 : 1, `Flare started at ${ft(flareAt)} ft.`);
        }
        if (flareAt === null && s.agl < 6) return fail(`No flare: pull the cyclic back (${k.aft}) at about 50 ft to slow down.`);
        if (session.phase === 'ground') return { text: 'Touchdown! Rolling to a stop…' };
        const text =
          flareAt !== null
            ? `Good flare! Hold it, then level the skids (${k.fwd}). The assist will cushion the landing.`
            : s.agl > 18
              ? `Hold 55–65 kt toward the meadow. At about 50 ft, pull the cyclic back (${k.aft}) to flare.`
              : `FLARE NOW: pull back (${k.aft})!`;
        return { text };
      });
    },
  },
  {
    id: 'cushion',
    num: 6,
    title: 'Level and cushion',
    teaches: 'Level the skids, then raise the collective just before touchdown.',
    config: {
      ...BASE,
      cushion: false,
      altitudeFt: 30,
      airspeedKt: 15,
      start: { x: -380, z: 400, yaw: 0, autorotating: { sinkMs: 3, collective: 0.15, pitchDeg: 6, rpmPct: 105 } },
    },
    target: 'meadow',
    gates: [],
    makeObjective() {
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const r = session.result;
        if (r) {
          const vs = r.touchdown!.verticalSpeed;
          if (vs > 2.54) return fail(`Touched down at ${fpm(vs)} fpm. Raise the collective just before the skids touch.`);
          return pass(vs < 1.02 ? 3 : vs < 1.52 ? 2 : 1, `Touched down at ${Math.max(0, fpm(vs))} fpm.`);
        }
        if (session.phase === 'ground') return { text: 'Touchdown! Rolling to a stop…' };
        const text =
          s.agl > 4
            ? `No auto-cushion now. Keep the skids level and wait: don't raise the collective yet.`
            : s.verticalSpeed < -0.3
              ? `NOW: raise the collective (${k.up}) to cushion. The rotor's stored energy only lasts a moment.`
              : `Ease off (${k.down}) so you don't climb back up.`;
        return { text };
      });
    },
  },
  {
    id: 'wind',
    num: 7,
    title: 'Wind',
    teaches: 'Land facing into the wind, it cuts your ground speed.',
    config: { ...BASE, windKt: 15, windFromDeg: 330, start: { x: 300, z: 400, yaw: Math.PI / 2, autorotating: { sinkMs: 7, collective: 0.1 } } },
    target: 'meadow',
    gates: [],
    makeObjective() {
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const into = session.config.windFromDeg;
        const r = session.result;
        if (r) {
          const td = r.touchdown!;
          if (!td.area) return fail('Landed outside a field. Keep the meadow in reach.');
          const a = windAngleDeg(td, session.config.windKt);
          if (a > 30) return fail(`Landed ${Math.round(a)}° off the wind. Turn to face ${into}° before you flare.`);
          return pass(r.outcome === 'excellent' ? 3 : r.outcome === 'safe' ? 2 : 1, `Landed ${Math.round(a)}° off the wind.`);
        }
        if (session.phase === 'ground') return { text: 'Touchdown! Rolling to a stop…' };
        const off = Math.abs(wrapAngle((s.heading - into) * DEG)) / DEG;
        const dist = Math.hypot(s.pos.x + 380, s.pos.z - 360);
        const text =
          s.agl > 60 && dist > 350
            ? `Wind: ${session.config.windKt} kt from ${into}° (see WIND and the windsocks). Plan to land facing into it.`
            : s.agl > 60
              ? `Lose height beside the field, then turn to face about ${into}° for the final glide (${k.turn}).`
              : off > 30
                ? `Turn into the wind: nose toward ${into}° (now ${Math.round(s.heading)}°).`
                : 'Lined up into the wind. Flare at about 50 ft, then cushion.';
        return { text };
      });
    },
  },
  {
    id: 'checkride',
    num: 8,
    title: 'Checkride',
    teaches: 'Everything together, realistic mode, no assist.',
    config: { ...BASE, difficulty: 'normal', windKt: 8 },
    target: 'meadow',
    gates: [],
    makeObjective() {
      return lesson(({ session }) => {
        const r = session.result;
        if (r) {
          if (r.outcome === 'damaged') return fail(r.touchdown?.damageReasons[0]?.text ?? 'The helicopter was damaged.');
          const total = r.score.total;
          return pass(total >= 85 ? 3 : total >= 70 ? 2 : 1, `Score ${total}/100.`);
        }
        if (session.phase === 'ground') return { text: 'Touchdown! Rolling to a stop…' };
        return { text: 'Checkride: realistic mode, no landing assist, no coaching. Land safely to graduate.' };
      });
    },
  },
];

/** Level `index` is open once the one before it has been passed. */
export function isUnlocked(index: number, progress: Record<string, number>): boolean {
  return index === 0 || (progress[LEVELS[index - 1]?.id] ?? 0) > 0;
}
