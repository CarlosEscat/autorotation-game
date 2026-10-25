import { MS_TO_FPM, MS_TO_KT, M_TO_FT } from '../sim/aircraft';
import { DEG, wrapAngle } from '../sim/vec';
import { LAKE, World } from '../world/world';
import { computeGuidance } from './guidance';
import { KEY_WORDS, Mode } from './hints';
import { TouchdownReport } from './landing';
import { FlightConfig, FlightSession, START } from './session';
import { HelicopterState } from '../sim/state';

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
  /** Seconds left on a timed level's countdown. */
  timeLeft?: number;
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
  /** Ring orientation (rotation about Y); by default it faces along the path to the next gate. */
  facing?: number;
  /** Stay hidden until it is the next gate (e.g. a ring around the start position). */
  hiddenUntilNext?: boolean;
}

/** A landing spot painted on the ground: a large circle, or a small heliport pad. */
export interface Pad {
  x: number;
  z: number;
  radius: number;
  kind: 'circle' | 'heliport';
}

export type TierId = 'beginner' | 'intermediate' | 'emergency' | 'expert';

/** A section of the training menu. Its lessons are the levels with this tier, in list order. */
export interface TierDef {
  id: TierId;
  title: string;
  blurb: string;
}

export const TIERS: TierDef[] = [
  { id: 'beginner', title: 'Beginner', blurb: 'Airfield basics: fly, hover, take off and land.' },
  { id: 'intermediate', title: 'Intermediate', blurb: 'Open fields and shrinking landing zones, engine running.' },
  { id: 'expert', title: 'Expert', blurb: 'Valley runs and tight spots. Fun first, still scored.' },
  { id: 'emergency', title: 'Emergency', blurb: 'The full autorotation sequence, ending in the checkride.' },
];

/** A level as written below; its place in the menu (`num`, `label`) is worked out from its tier. */
interface LevelSpec {
  id: string;
  tier: TierId;
  title: string;
  teaches: string;
  config: FlightConfig;
  /** Landing area selected at the start, or null to hide the beacon. */
  target: string | null;
  gates: Gate[];
  /** Landing spots to paint on the ground. */
  pads?: Pad[];
  makeObjective(world: World): Objective;
}

export interface LevelDef extends LevelSpec {
  /** 1-based position within its tier. */
  num: number;
  /** Tier and position, e.g. "Beginner 2". */
  label: string;
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

/** Over the lake a ring's height is measured from the water, not the lake bed. */
export const gateY = (g: Gate, world: World) => (world.surfaceAt(g.x, g.z) === 'water' ? world.waterLevel : world.heightAt(g.x, g.z)) + g.agl;

/** Angle between the nose at touchdown and the direction the wind comes from, degrees. */
export function windAngleDeg(td: TouchdownReport, windKt: number): number {
  if (windKt < 1) return 0;
  const cos = Math.max(-1, Math.min(1, td.headwind / (windKt / MS_TO_KT)));
  return Math.acos(cos) / DEG;
}

const BASE: FlightConfig = { altitudeFt: 1000, airspeedKt: 70, windKt: 0, windFromDeg: 0, failureDelay: 4, difficulty: 'easy' };
const NEVER = 1e9;
const MEADOW_APPROACH = { x: -380, z: 700, yaw: 0 };
/** Engine running the whole time, and resting on the skids is allowed (beginner lessons near the ground). */
const POWERED: FlightConfig = { ...BASE, airspeedKt: 0, failureDelay: NEVER, freeFlight: true };
/** Centreline of the north–south airport runway; its south end is at z = -175. */
const RUNWAY_X = -180;
const HOVER_SPOT = { x: RUNWAY_X + 8, z: -300 };
/** The hover lesson's one ring, 25 m straight ahead of the start, facing the way you fly into it. */
const HOVER_RING: Gate = { x: HOVER_SPOT.x, z: HOVER_SPOT.z - 25, agl: 7.5, radius: 7, facing: Math.PI };

// ---------- Intermediate: the open field (Big Meadow, centre -380, 360) ----------

const RINGS_TIME_LIMIT = 95;
const WIND_CIRCLE: Pad = { x: -380, z: 360, radius: 25, kind: 'circle' };
const VLANDING_CIRCLE: Pad = { x: -400, z: 370, radius: 12, kind: 'circle' };
const HELIPORT: Pad = { x: -350, z: 330, radius: 5, kind: 'heliport' };
const VTAKEOFF_SPOT = { x: -400, z: 420 };

// ---------- Expert: the valley course and the farm strip ----------

/** Lake run: the countdown, and the finish time (from the start) that earns the speed star. */
export const LAKE_RUN = { limitS: 150, fastS: 95 };
const LAKE_RUN_START = { x: 0, z: 1100, yaw: 0 };
/** Middle of the farm strip, between its tree lines. */
const CONFINED_SPOT: Pad = { x: 400, z: 470, radius: 6, kind: 'circle' };

/**
 * Lake run stars, each earned on its own: one for landing on the pad in time, one for flying through every ring,
 * one for a fast finish. Rings missed by a little still count as flown, but the whole course must be flown for speed.
 */
export function lakeRunStars(r: { hits: number; flown: number; rings: number; time: number }): number {
  return 1 + Number(r.hits === r.rings) + Number(r.flown === r.rings && r.time <= LAKE_RUN.fastS);
}

/** Sets each ring to face the way it is flown: from the previous ring (or `from`) toward it. */
function withFacing(from: { x: number; z: number }, gates: Gate[]): Gate[] {
  return gates.map((g, i) => {
    const p = gates[i - 1] ?? from;
    return { ...g, facing: Math.atan2(g.x - p.x, g.z - p.z) };
  });
}

/**
 * Detects flying through a ring's plane (it faces `facing`). Returns null until the helicopter crosses
 * the plane within `reach` radii of the centre (inside the rim by default), then how far from the centre
 * it passed, as a share of the radius.
 */
function ringCrossing(world: World, reach = 1) {
  let ring: Gate | null = null, prev = 0;
  return (s: HelicopterState, g: Gate): number | null => {
    const dir = { x: Math.sin(g.facing ?? 0), z: Math.cos(g.facing ?? 0) };
    const along = (s.pos.x - g.x) * dir.x + (s.pos.z - g.z) * dir.z;
    const was = ring === g ? prev : along;
    ring = g;
    prev = along;
    if (!(was < 0 && along >= 0)) return null;
    const lateral = (s.pos.x - g.x) * dir.z - (s.pos.z - g.z) * dir.x;
    const off = Math.hypot(lateral, s.pos.y - gateY(g, world)) / g.radius;
    return off < reach ? off : null;
  };
}

/** Where a point is relative to the nose, in words: "12 m ahead and 3 m left". */
function relativeTo(s: HelicopterState, x: number, z: number): string {
  const dx = x - s.pos.x, dz = z - s.pos.z;
  const fwd = -dx * Math.sin(s.yaw) - dz * Math.cos(s.yaw);
  const right = dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw);
  const part = (v: number, pos: string, neg: string) => (Math.abs(v) < 1.5 ? '' : `${Math.round(Math.abs(v))} m ${v > 0 ? pos : neg}`);
  return [part(fwd, 'ahead', 'behind'), part(right, 'right', 'left')].filter(Boolean).join(' and ') || 'right below you';
}

interface PadLimits {
  maxSinkMs: number;
  maxDriftMs: number;
  /** Distance from the centre and sink rate needed for three stars, then for two. */
  three: { dist: number; sinkMs: number };
  two: { dist: number; sinkMs: number };
}

/** Judges a vertical touchdown `dist` metres from the centre of `pad`. */
function judgePadTouchdown(td: TouchdownReport, dist: number, pad: Pad, noun: string, lim: PadLimits, k: (typeof KEY_WORDS)[Mode]): Update {
  if (dist > pad.radius) return fail(`Touched down ${Math.round(dist - pad.radius)} m off the ${noun}. Stop right over it before you come down.`);
  if (td.verticalSpeed > lim.maxSinkMs) return fail(`Too hard (${fpm(td.verticalSpeed)} fpm). Slow the descent with the collective (${k.up}) in the last few feet.`);
  if (td.groundSpeed > lim.maxDriftMs) return fail(`Still drifting at touchdown (${Math.round(td.groundSpeed * MS_TO_KT)} kt). Stop all movement, then come straight down.`);
  const stars =
    dist < lim.three.dist && td.verticalSpeed < lim.three.sinkMs && td.groundSpeed < 0.8 ? 3 : dist < lim.two.dist && td.verticalSpeed < lim.two.sinkMs ? 2 : 1;
  return pass(stars, `On the ${noun}, ${dist.toFixed(1)} m from the centre, at ${Math.max(0, fpm(td.verticalSpeed))} fpm.`);
}

/** Start in a hover near `pad`, move over it and come straight down onto it. */
function padLanding(pad: Pad, noun: string, lim: PadLimits): Objective {
  let td: TouchdownReport | null = null;
  return lesson(({ session, mode }) => {
    const s = session.state;
    const k = KEY_WORDS[mode];
    const d = Math.hypot(s.pos.x - pad.x, s.pos.z - pad.z);
    if (!td && session.touchdown) {
      td = session.touchdown;
      return judgePadTouchdown(td, d, pad, noun, lim, k);
    }
    if (s.time > 150) return fail(`Out of time. Hover over the ${noun}, then lower the collective slowly.`);
    if (d > 150) return fail(`Too far from the ${noun}. Small cyclic inputs, and stop each move before it runs away.`);
    if (s.agl > 40) return fail(`Too high (${ft(s.agl)} ft). Lower the collective (${k.down}) to come down, not up.`);
    const over = d < Math.min(2, pad.radius * 0.5) && s.groundSpeed < 1;
    const text = !over
      ? `The ${noun} is ${relativeTo(s, pad.x, pad.z)}. Move over it with small cyclic inputs, then stop.`
      : s.verticalSpeed < -1.5
        ? `Coming down too fast (${fpm(-s.verticalSpeed)} fpm): raise the collective a little (${k.up}).`
        : s.agl > 3
          ? `Over the ${noun}. Lower the collective a little (${k.down}) and come straight down, slowly.`
          : `Nearly down. A touch of collective (${k.up}) to slow the sink, and keep still.`;
    return { text };
  });
}

const SPECS: LevelSpec[] = [
  {
    id: 'basics',
    tier: 'beginner',
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
    id: 'hover',
    tier: 'beginner',
    title: 'Hover',
    teaches: 'Pedals turn the nose on the spot; then ease forward through a ring.',
    config: { ...POWERED, altitudeFt: 10, start: { ...HOVER_SPOT, yaw: 0, settle: 'hover' } },
    target: null,
    gates: [HOVER_RING],
    makeObjective(world) {
      const ring = this.gates[0];
      const crossed = ringCrossing(world);
      const headings = [270, 360];
      // Settle, then the two pedal turns; after them, fly forward through the ring.
      const ringStep = 1 + headings.length;
      let step = 0, held = 0, lastHeading = Number.NaN;
      return lesson(({ session, mode }, dt) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        if (session.touchdown) return fail(`Touched the ground. Keep a little collective (${k.up}) to stay a few feet up.`);
        if (s.agl > 12) return fail(`Too high (${ft(s.agl)} ft): a hover is just above the ground. Lower the collective (${k.down}) sooner.`);
        if (Math.hypot(s.pos.x - HOVER_SPOT.x, s.pos.z - HOVER_SPOT.z) > 60) return fail('Drifted too far. Ease forward gently, then let the cyclic go.');
        if (s.time > 150) return fail('Out of time. Tap the pedals and let go a little before the heading you want.');
        const turnRate = Number.isNaN(lastHeading) || dt === 0 ? 0 : Math.abs(wrapAngle((s.heading - lastHeading) * DEG)) / DEG / dt;
        lastHeading = s.heading;
        const want = step >= 1 && step < ringStep ? headings[step - 1] : null;
        const off = want === null ? 0 : Math.abs(wrapAngle((s.heading - want) * DEG)) / DEG;
        held = step < ringStep && off < 8 && turnRate < 10 ? held + dt : 0;
        if (held >= (step === 0 ? 2 : 1)) (step++, (held = 0));
        if (step === ringStep) {
          if (crossed(s, ring) !== null) return { ...pass(s.time < 45 ? 3 : s.time < 75 ? 2 : 1, 'Through the ring. Hover lesson done!'), nextGate: 1 };
          const text = `Ease forward (${k.fwd}) and fly slowly through the yellow ring ahead.`;
          return { text, progress: step / (ringStep + 1), nextGate: 0 };
        }
        const turn = (dir: string, key: string) => `${dir} pedal (${key}): turn the nose to ${String(want).padStart(3, '0')}° (now ${String(Math.round(s.heading) % 360).padStart(3, '0')}°), then let go.`;
        const text = [
          'You are hovering at about 10 ft and the helicopter holds the height for you. Just watch for a moment.',
          turn('Left', k.yawLeft),
          turn('Right', k.yawRight),
        ][step];
        return { text, progress: step / (ringStep + 1), nextGate: 0 };
      });
    },
  },
  {
    id: 'takeoff',
    tier: 'beginner',
    title: 'Running takeoff',
    teaches: 'Get light on the skids, slide forward to build speed, then climb away.',
    config: { ...POWERED, altitudeFt: 0, start: { x: RUNWAY_X, z: -200, yaw: 0, settle: 'skids' } },
    target: null,
    gates: [{ x: RUNWAY_X, z: -1000, agl: 75, radius: 30 }],
    makeObjective(world) {
      const gate = this.gates[0];
      let earlyClimb = false, drifted = false;
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const kt = s.airspeed * MS_TO_KT;
        if (s.agl > 3 && kt < 15) earlyClimb = true;
        if (s.agl < 3 && Math.abs(s.pos.x - RUNWAY_X) > 10) drifted = true;
        if (s.agl > 15 && kt < 15) return fail('Climbed straight up. Build speed low over the runway first, then climb.');
        // The ring faces down the runway: count it when the helicopter crosses its plane inside the rim.
        if (s.pos.z <= gate.z && Math.hypot(s.pos.x - gate.x, s.pos.y - gateY(gate, world)) < gate.radius) {
          if (kt < 35) return fail(`Too slow through the ring (${Math.round(kt)} kt). Keep the nose down longer to build 40 kt.`);
          const faults = Number(earlyClimb) + Number(drifted) + Number(kt < 45);
          return { ...pass(3 - Math.min(2, faults), `Through the ring at ${Math.round(kt)} kt!`), nextGate: 1 };
        }
        if (s.pos.z <= gate.z) return fail(`Missed the ring (${s.pos.y > gateY(gate, world) ? 'too high' : 'too low'}). It sits at about ${ft(gate.agl)} ft beyond the runway end.`);
        if (s.time > 120) return fail('Out of time. Raise the collective until the helicopter gets light, then ease the nose forward.');
        const text = session.onSkids
          ? s.groundSpeed < 1
            ? `Raise the collective slowly (${k.up}) until the helicopter gets light, then ease the nose forward (${k.fwd}) to start sliding.`
            : `Sliding! Keep the nose a little down (${k.fwd}) and let the speed build. It lifts off by itself.`
          : kt < 30
            ? s.agl > 3
              ? `Too high for this speed. Lower the nose (${k.fwd}) and build speed before you climb.`
              : 'Airborne! Stay low over the runway and keep accelerating.'
            : s.pos.y > gateY(gate, world) + gate.radius * 0.6
              ? `Above the ring: lower the collective a little (${k.down}) and keep 40+ kt.`
              : `Good speed (${Math.round(kt)} kt). Raise the collective (${k.up}) and climb toward the ring past the runway end. Keep 40+ kt.`;
        return { text, progress: Math.min(1, kt / 40), nextGate: 0 };
      });
    },
  },
  {
    id: 'landing',
    tier: 'beginner',
    title: 'Running landing',
    teaches: 'Descend gently onto the runway and touch down while still moving forward.',
    config: { ...POWERED, altitudeFt: 80, airspeedKt: 45, start: { x: RUNWAY_X, z: 150, yaw: 0 } },
    target: null,
    gates: [],
    makeObjective(world) {
      let td: TouchdownReport | null = null;
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        if (!td && session.touchdown) {
          td = session.touchdown;
          if (td.area?.id !== 'runway') return fail('Touched down off the runway. Line up with it and land on the paved strip.');
          if (td.verticalSpeed > 2.03) return fail(`Hard landing (${fpm(td.verticalSpeed)} fpm). Raise the collective (${k.up}) near the ground to soften it.`);
          if (td.groundSpeed > 20.6) return fail(`Too fast (${Math.round(td.groundSpeed * MS_TO_KT)} kt). Raise the nose (${k.aft}) on the way down to slow to 20–30 kt.`);
        }
        if (td) {
          if (session.onSkids && s.groundSpeed < 0.5) {
            const tdKt = td.groundSpeed * MS_TO_KT;
            const centred = Math.abs(world.areas.find((a) => a.id === 'runway')!.cx - s.pos.x) < 8;
            const stars = td.verticalSpeed < 0.76 && tdKt >= 10 && tdKt <= 30 && centred ? 3 : td.verticalSpeed < 1.52 ? 2 : 1;
            return pass(stars, `Touched down at ${Math.max(0, fpm(td.verticalSpeed))} fpm, ${Math.round(tdKt)} kt.`);
          }
          return { text: `Touchdown! Lower the collective (${k.down}) and let it slide to a stop.` };
        }
        if (s.pos.z < -925) return fail('Flew past the end of the runway. Start the descent earlier.');
        if (s.time > 90) return fail('Out of time. Lower the collective a little to descend onto the runway.');
        const text =
          s.verticalSpeed < -3
            ? `Sinking fast (${fpm(-s.verticalSpeed)} fpm). Raise the collective a little (${k.up}).`
            : s.agl > 15
              ? `Runway straight ahead. Lower the collective a little (${k.down}) for a gentle descent; hold about 40 kt.`
              : s.agl > 3
                ? `Keep coming down gently. Raise the nose a touch (${k.aft}) to slow to 20–30 kt.`
                : `Almost down. A little collective (${k.up}) to soften the touchdown, and keep moving forward.`;
        return { text };
      });
    },
  },
  {
    id: 'rings',
    tier: 'intermediate',
    title: 'Precision flying',
    teaches: 'Plan each turn and height change early, and fly through the middle of the ring.',
    config: { ...BASE, altitudeFt: 450, failureDelay: NEVER },
    target: null,
    // One left-hand circuit: 260 m legs, 40° more turn at every ring, and a new height each time.
    gates: withFacing(START, [
      { x: 0, z: 550, agl: 110, radius: 18 },
      { x: -167, z: 351, agl: 80, radius: 18 },
      { x: -423, z: 306, agl: 55, radius: 18 },
      { x: -648, z: 436, agl: 85, radius: 18 },
      { x: -737, z: 680, agl: 115, radius: 18 },
      { x: -648, z: 924, agl: 70, radius: 18 },
      { x: -423, z: 1054, agl: 95, radius: 18 },
    ]),
    makeObjective(world) {
      const gates = this.gates;
      const limit = RINGS_TIME_LIMIT;
      const cross = ringCrossing(world);
      let next = 0, offsetSum = 0;
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const hit = cross(s, gates[next]);
        if (hit !== null) (offsetSum += hit), next++;
        if (next === gates.length) {
          const margin = (limit - s.time) / limit;
          const centred = offsetSum / gates.length < 0.4;
          const stars = margin >= 0.2 && centred ? 3 : margin >= 0.1 || centred ? 2 : 1;
          return { ...pass(stars, `All rings with ${Math.round(limit - s.time)} s to spare!`), nextGate: next };
        }
        if (s.time > limit) return fail(`Out of time with ${gates.length - next} ring${gates.length - next === 1 ? '' : 's'} to go. Turn toward the next ring earlier.`);
        if (s.agl < 15) return fail(`Too low! Raise the collective (${k.up}) to climb.`);
        const g = gates[next];
        const dy = gateY(g, world) - s.pos.y;
        const left = `${Math.ceil(limit - s.time)} s left.`;
        const text =
          dy > g.radius * 0.5
            ? `Ring ${next + 1} of ${gates.length} is higher: raise the collective (${k.up}). ${left}`
            : dy < -g.radius * 0.5
              ? `Ring ${next + 1} of ${gates.length} is lower: lower the collective (${k.down}). ${left}`
              : `Ring ${next + 1} of ${gates.length}: line up early (${k.turn}) and aim for the middle. ${left}`;
        return { text, progress: next / gates.length, nextGate: next };
      });
    },
  },
  {
    id: 'windfield',
    tier: 'intermediate',
    title: 'Landing into the wind',
    teaches: 'Read the windsock, then approach and touch down facing into the wind.',
    config: { ...POWERED, altitudeFt: 300, airspeedKt: 60, windKt: 12, windFromDeg: 240, start: { x: -380, z: 800, yaw: 0 } },
    target: null,
    gates: [],
    pads: [WIND_CIRCLE],
    makeObjective() {
      const pad = WIND_CIRCLE;
      let td: TouchdownReport | null = null;
      let angle = 0;
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const into = session.config.windFromDeg;
        const dist = Math.hypot(s.pos.x - pad.x, s.pos.z - pad.z);
        if (!td && session.touchdown) {
          td = session.touchdown;
          angle = windAngleDeg(td, session.config.windKt);
          if (dist > pad.radius) return fail(`Touched down ${Math.round(dist - pad.radius)} m outside the circle. Line up earlier so you arrive over it.`);
          if (angle > 30) return fail(`Landed ${Math.round(angle)}° off the wind. Point the nose toward ${into}° before you touch down.`);
          if (td.verticalSpeed > 2.03) return fail(`Hard landing (${fpm(td.verticalSpeed)} fpm). Raise the collective (${k.up}) near the ground to soften it.`);
          if (td.groundSpeed > 10.3) return fail(`Too fast over the ground (${Math.round(td.groundSpeed * MS_TO_KT)} kt). Into the wind you can slow right down before touchdown.`);
        }
        if (td) {
          if (session.onSkids && s.groundSpeed < 0.5) {
            const stars = angle < 10 && td.verticalSpeed < 0.76 ? 3 : angle < 20 && td.verticalSpeed < 1.52 ? 2 : 1;
            return pass(stars, `Landed ${Math.round(angle)}° off the wind at ${Math.max(0, fpm(td.verticalSpeed))} fpm.`);
          }
          return { text: `Touchdown! Lower the collective (${k.down}) and let it settle.` };
        }
        if (s.time > 180) return fail('Out of time. Line up into the wind and descend onto the circle.');
        const off = Math.abs(wrapAngle((s.heading - into) * DEG)) / DEG;
        const text =
          s.agl > 30 && dist > 400
            ? `Wind: ${session.config.windKt} kt from ${into}°. Check the windsock beside the meadow and the WIND readout, then plan to land facing ${into}°.`
            : s.agl > 30
              ? `Fly a wide circuit around the meadow and line up on a heading of about ${into}°, with the yellow circle ahead.`
              : off > 30
                ? `Turn into the wind: nose toward ${into}° (now ${Math.round(s.heading)}°).`
                : `Lined up into the wind. Come down gently and slow right down; touch down in the yellow circle.`;
        return { text };
      });
    },
  },
  {
    id: 'vtakeoff',
    tier: 'intermediate',
    title: 'Vertical takeoff',
    teaches: 'Lift straight up into a steady hover, then nose forward and climb away.',
    config: { ...POWERED, altitudeFt: 0, start: { ...VTAKEOFF_SPOT, yaw: 0, settle: 'skids' } },
    target: null,
    gates: withFacing(VTAKEOFF_SPOT, [{ x: VTAKEOFF_SPOT.x, z: 230, agl: 35, radius: 20 }]),
    makeObjective(world) {
      const gate = this.gates[0];
      const cross = ringCrossing(world);
      let steady = 0, hovered = -1, maxDrift = 0, prevSide: number | null = null;
      return lesson(({ session, mode }, dt) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const kt = s.airspeed * MS_TO_KT;
        const drift = Math.hypot(s.pos.x - VTAKEOFF_SPOT.x, s.pos.z - VTAKEOFF_SPOT.z);
        if (session.touchdown) return fail(`Set back down. Keep enough collective (${k.up}) to stay in the hover.`);
        if (s.time > 120) return fail('Out of time. Lift into a hover, hold it, then fly through the ring.');
        if (hovered < 0) {
          maxDrift = Math.max(maxDrift, drift);
          if (drift > 8) return fail(`Drifted ${Math.round(drift)} m from the spot before the hover was steady. Lift straight up, with tiny cyclic inputs.`);
          if (s.groundSpeed > 3) return fail('Moved off before the hover was steady. Hover first, then go.');
          if (s.agl > 9) return fail(`Climbed too high (${ft(s.agl)} ft). Stop in a low hover first, at about 10 ft.`);
          const ok = !session.onSkids && s.agl > 1.5 && s.agl < 5 && s.groundSpeed < 1 && Math.abs(s.verticalSpeed) < 0.5;
          steady = ok ? steady + dt : 0;
          if (steady >= 3) hovered = s.time;
          const text = session.onSkids
            ? `Raise the collective slowly (${k.up}) and lift straight up. Keep the skids level, no forward input yet.`
            : s.agl < 1.5
              ? `Light on the skids: a little more collective (${k.up}) to about 10 ft.`
              : s.agl > 5
                ? `A bit high. Ease the collective down (${k.down}) to about 10 ft.`
                : `Hold the hover still over the spot${steady > 0 ? '…' : ': stop any drift with small cyclic inputs'}.`;
          return { text, progress: steady / 3 / 2, nextGate: 0 };
        }
        const hit = cross(s, gate);
        if (hit !== null) {
          const stars = maxDrift < 2 && hovered < 20 ? 3 : maxDrift < 4 ? 2 : 1;
          return { ...pass(stars, `Through the ring! The hover drifted ${maxDrift.toFixed(1)} m.`), nextGate: 1 };
        }
        const side = (s.pos.z - gate.z) * -1;
        if (prevSide !== null && prevSide < 0 && side >= 0) return fail('Missed the ring. Climb so you pass through its middle.');
        prevSide = side;
        const text =
          kt < 20
            ? `Steady hover! Now ease the nose forward (${k.fwd}) to start moving, and keep the height.`
            : `Flying! Raise the collective (${k.up}) and climb through the ring ahead.`;
        return { text, progress: 0.5 + Math.min(0.5, kt / 80), nextGate: 0 };
      });
    },
  },
  {
    id: 'vlanding',
    tier: 'intermediate',
    title: 'Vertical landing',
    teaches: 'Stop over the spot, then come straight down slowly and touch down without drifting.',
    config: { ...POWERED, altitudeFt: 40, start: { x: VLANDING_CIRCLE.x, z: VLANDING_CIRCLE.z + 20, yaw: 0, settle: 'hover' } },
    target: null,
    gates: [],
    pads: [VLANDING_CIRCLE],
    makeObjective() {
      return padLanding(VLANDING_CIRCLE, 'circle', { maxSinkMs: 1.52, maxDriftMs: 2.6, three: { dist: 3, sinkMs: 0.5 }, two: { dist: 6, sinkMs: 1 } });
    },
  },
  {
    id: 'heliport',
    tier: 'intermediate',
    title: 'Heliport',
    teaches: 'The same vertical landing, onto a pad only a little wider than the helicopter.',
    config: { ...POWERED, altitudeFt: 60, start: { x: HELIPORT.x, z: HELIPORT.z + 50, yaw: 0, settle: 'hover' } },
    target: null,
    gates: [],
    pads: [HELIPORT],
    makeObjective() {
      return padLanding(HELIPORT, 'pad', { maxSinkMs: 1.52, maxDriftMs: 2, three: { dist: 1.5, sinkMs: 0.5 }, two: { dist: 3, sinkMs: 1 } });
    },
  },
  {
    id: 'lakerun',
    tier: 'expert',
    title: 'Lake run',
    teaches: 'Fly a fast, flowing line: plan each bend early, stay low, then stop and land on a small pad.',
    config: { ...POWERED, altitudeFt: 150, airspeedKt: 60, start: LAKE_RUN_START },
    target: null,
    // Down the valley, a slalom past the meadow, a low pass over the forest on the north shore,
    // then low over the water to finish on the Lake Helipad. The last ring is angled to line you up on the pad.
    gates: withFacing(LAKE_RUN_START, [
      { x: -40, z: 880, agl: 40, radius: 15 },
      { x: -230, z: 720, agl: 35, radius: 15 },
      { x: -290, z: 500, agl: 30, radius: 15 },
      { x: -170, z: 330, agl: 25, radius: 15 },
      { x: -110, z: 120, agl: 30, radius: 15 },
      { x: -20, z: -10, agl: 34, radius: 14 },
      { x: 170, z: -10, agl: 34, radius: 14 },
      { x: 230, z: 160, agl: 15, radius: 13 },
      { x: 190, z: 250, agl: 15, radius: 13 },
    ]).map((g, i, all) => (i === all.length - 1 ? { ...g, facing: Math.atan2(LAKE.x - g.x, LAKE.z - g.z) } : g)),
    makeObjective(world) {
      const gates = this.gates;
      const deck = world.areas.find((a) => a.id === 'helipad')!;
      // A ring counts as missed when you fly past it within 8 radii, so one slip never ends the run.
      const cross = ringCrossing(world, 8);
      let next = 0, hits = 0;
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const timeLeft = Math.max(0, LAKE_RUN.limitS - s.time);
        if (next < gates.length) {
          const off = cross(s, gates[next]);
          if (off !== null) (hits += Number(off < 1)), next++;
        }
        const missed = next - hits;
        const td = session.touchdown;
        if (td) {
          if (td.area?.id !== deck.id) return fail(`Touched down off the helipad. Slow down early and stop right over the H.`);
          if (td.verticalSpeed > 2.54) return fail(`Too hard onto the pad (${fpm(td.verticalSpeed)} fpm). Come to a hover first, then lower the collective gently (${k.down}).`);
          if (td.groundSpeed > 5.2) return fail(`Still moving at ${Math.round(td.groundSpeed * MS_TO_KT)} kt on touchdown. Stop over the pad before you put it down.`);
          const stars = lakeRunStars({ hits, flown: next, rings: gates.length, time: s.time });
          const rings = hits === gates.length ? 'all rings' : `${hits} of ${gates.length} rings`;
          return { ...pass(stars, `On the pad in ${Math.round(s.time)} s, ${rings}.`), nextGate: next, timeLeft };
        }
        if (timeLeft <= 0) return fail('Out of time! Keep your speed up between the rings and start slowing down for the pad sooner.');
        const left = `${Math.ceil(timeLeft)} s left.`;
        const slip = missed > 0 ? ` (${missed} missed)` : '';
        let text: string;
        if (next < gates.length) {
          const g = gates[next];
          const dy = gateY(g, world) - s.pos.y;
          const water = world.surfaceAt(g.x, g.z) === 'water';
          text =
            next === 5 || next === 6
              ? `Ring ${next + 1} of ${gates.length}${slip}: low over the treetops. Hold your height and keep it smooth.`
              : water
                ? `Ring ${next + 1} of ${gates.length}${slip}: low over the water. Ease down (${k.down}), not too far.`
                : dy > g.radius * 0.5
                  ? `Ring ${next + 1} of ${gates.length}${slip} is higher: raise the collective (${k.up}). ${left}`
                  : dy < -g.radius * 0.5
                    ? `Ring ${next + 1} of ${gates.length}${slip} is lower: lower the collective (${k.down}). ${left}`
                    : `Ring ${next + 1} of ${gates.length}${slip}: start the bend early (${k.turn}) and aim for the middle. ${left}`;
        } else {
          const d = Math.hypot(s.pos.x - deck.cx, s.pos.z - deck.cz);
          text =
            d > 120
              ? `Last stretch! Head for the helipad in the middle of the lake and start slowing down (${k.aft}). ${left}`
              : d > 8 || s.groundSpeed > 2
                ? `The pad is ${relativeTo(s, deck.cx, deck.cz)}. Slow down and stop right over the H. Watch for drift.`
                : `Over the pad. Lower the collective gently (${k.down}) and touch down. ${left}`;
        }
        return { text, progress: next / gates.length, nextGate: next, timeLeft };
      });
    },
  },
  {
    id: 'confined',
    tier: 'expert',
    title: 'Confined area',
    teaches: 'Look the spot over from above, come in steeply over the trees, then straight down between them.',
    config: { ...POWERED, altitudeFt: 250, airspeedKt: 40, start: { x: 640, z: 470, yaw: Math.PI / 2 } },
    target: null,
    gates: [],
    pads: [CONFINED_SPOT],
    makeObjective() {
      const pad = CONFINED_SPOT;
      const lim: PadLimits = { maxSinkMs: 1.52, maxDriftMs: 2.6, three: { dist: 2, sinkMs: 0.5 }, two: { dist: 4, sinkMs: 1 } };
      let td: TouchdownReport | null = null;
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const d = Math.hypot(s.pos.x - pad.x, s.pos.z - pad.z);
        if (!td && session.touchdown) {
          td = session.touchdown;
          return judgePadTouchdown(td, d, pad, 'spot', lim, k);
        }
        if (s.time > 180) return fail('Out of time. Get over the spot above the treetops, then come straight down.');
        if (d > 700) return fail('Too far from the farm strip. Stay close and circle it while you look it over.');
        const over = d < Math.min(2, pad.radius * 0.5) && s.groundSpeed < 1;
        const text =
          d > 60
            ? s.agl < 25
              ? `Too low to cross the trees: climb (${k.up}). Approach the strip at about 100–150 ft.`
              : `The farm strip is ${relativeTo(s, pad.x, pad.z)}, between two lines of tall trees. Slow down as you get close.`
            : !over
              ? s.agl < 22 && d > pad.radius
                ? `Careful, the trees are close! Stop moving sideways and line up over the yellow circle first.`
                : `Come to a hover over the yellow circle, above the treetops. It is ${relativeTo(s, pad.x, pad.z)}.`
              : s.verticalSpeed < -1.5
                ? `Coming down too fast (${fpm(-s.verticalSpeed)} fpm): raise the collective a little (${k.up}).`
                : s.agl > 3
                  ? `Over the spot. Lower the collective (${k.down}) and come straight down between the trees.`
                  : `Nearly down. A touch of collective (${k.up}) to slow the sink, and keep still.`;
        return { text };
      });
    },
  },
  {
    id: 'failure',
    tier: 'emergency',
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
    tier: 'emergency',
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
    tier: 'emergency',
    title: 'Pick a field',
    teaches: 'Choose a field you can reach, glide to it and land.',
    // Facing east: the preselected Rocky Clearing is too far; one T press selects Big Meadow, in reach just right of the nose.
    config: { ...BASE, altitudeFt: 500, airspeedKt: 60, start: { x: -1000, z: 200, yaw: -Math.PI / 2, autorotating: { sinkMs: 7, collective: 0.1 } } },
    target: 'clearing',
    gates: [],
    makeObjective(world) {
      return lesson(({ session, targetId, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const area = world.areas.find((a) => a.id === targetId) ?? world.areas[0];
        const r = session.result;
        if (r) {
          // Generous: stopping within 60 m of the field's edge counts as landing in it.
          if (world.areaAt(s.pos.x, s.pos.z, 60)?.id !== area.id) return fail(`Landed outside ${area.name}. Pick a field that says IN REACH and fly straight to it.`);
          return pass(r.outcome === 'excellent' ? 3 : r.outcome === 'safe' ? 2 : 1, `Landed in ${area.name}!`);
        }
        if (session.phase === 'ground') return { text: 'Touchdown! Rolling to a stop…' };
        if (s.agl < 45) {
          return { text: s.agl > 18 ? `Almost there. Flare at about 50 ft: pull back (${k.aft}).` : `Level the skids (${k.fwd}). The assist cushions the landing.` };
        }
        const g = computeGuidance(s, area, session.wind);
        const text =
          g.reach === 'short'
            ? `${area.name} is TOO FAR. Press ${k.target} to cycle fields until one says IN REACH.`
            : g.reach === 'marginal'
              ? `${area.name} is MARGINAL. You might make it, but a closer field (${k.target}) is safer.`
              : Math.abs(g.relBearing) > 15 * DEG
                ? `${area.name} is in reach. Turn toward the beacon (${k.turn}) and hold 55–70 kt.`
                : `Heading for ${area.name}. Hold 55–70 kt and fly straight at the beacon.`;
        return { text };
      });
    },
  },
  {
    id: 'flare',
    tier: 'emergency',
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
    tier: 'emergency',
    title: 'Flare and cushion',
    teaches: 'Flare at 50–60 ft, level the skids at about 10 ft, then cushion with the collective at about 5 ft.',
    // No auto-cushion: the flare has to take off the speed and the collective the last of the sink.
    // Easy rotor (the cushion costs less RPM); touchdown limits a little tighter than easy.
    config: {
      ...BASE,
      cushion: false,
      leniency: 2,
      altitudeFt: 200,
      airspeedKt: 60,
      // Placed so the recommended flare (45–65 ft, 8–12° nose up) ends in the meadow.
      start: { x: -380, z: 720, yaw: 0, autorotating: { sinkMs: 7, collective: 0.1 } },
    },
    target: 'meadow',
    gates: [],
    makeObjective() {
      return lesson(({ session, mode }) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        const flareAt = session.rec.flareStartAgl;
        const r = session.result;
        if (r) {
          const td = r.touchdown!;
          const vs = td.verticalSpeed;
          if (td.pitch / DEG > 10) return fail(`Touched down ${Math.round(td.pitch / DEG)}° nose up. Level the skids (${k.fwd}) after the flare.`);
          if (vs > 2.54 && flareAt !== null && flareAt > 21) return fail(`Flared too high (${ft(flareAt)} ft): you stopped up there and dropped. Flare at about 50–60 ft.`);
          if (vs > 2.54) return fail(`Touched down at ${fpm(vs)} fpm. Raise the collective (${k.up}) at about 5 ft to cushion, not earlier.`);
          const soft = vs < 1.27 && td.groundSpeed < 4.1;
          return pass(soft ? 3 : vs < 1.8 ? 2 : 1, `Touched down at ${Math.max(0, fpm(vs))} fpm, ${Math.round(td.groundSpeed * MS_TO_KT)} kt.`);
        }
        if (flareAt === null && s.agl < 3) return fail(`No flare (or too late): pull the cyclic back (${k.aft}) at about 50 ft to brake the speed and the sink.`);
        if (session.phase === 'ground') return { text: 'Touchdown! Rolling to a stop…' };
        if (flareAt === null) {
          const kt = s.airspeed * MS_TO_KT;
          if (s.agl > 20) {
            return { text: kt < 55 || kt > 70 ? `Hold 55–65 kt (${kt < 55 ? k.fwd : k.aft}). Flare at about 50–60 ft.` : `Steady glide. At about 50–60 ft, flare: pull the cyclic back (${k.aft}).` };
          }
          return { text: `FLARE NOW: pull the cyclic back (${k.aft}).` };
        }
        if (s.verticalSpeed > 1.5) return { text: `The flare is lifting you. Ease the nose down a little (${k.fwd}) so you don't balloon.` };
        if (s.agl > 4.5 && s.groundSpeed > 8) return { text: 'Good flare: speed and sink are coming off. Hold it.' };
        if (s.agl > 1.8) return { text: `Level the skids now (${k.fwd}), nose just above the horizon. Cushion at about 5 ft.` };
        return { text: `NOW: raise the collective (${k.up}) to cushion. Ease off (${k.down}) once the sink stops.` };
      });
    },
  },
  {
    id: 'wind',
    tier: 'emergency',
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
    tier: 'emergency',
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

/** Every level in play order: tier by tier, each tier's lessons in list order. */
export const LEVELS: LevelDef[] = TIERS.flatMap((t) =>
  SPECS.filter((l) => l.tier === t.id).map((l, i) => ({ ...l, num: i + 1, label: `${t.title} ${i + 1}` })),
);

export const tierOf = (def: LevelDef) => TIERS.find((t) => t.id === def.tier)!;

/**
 * Where each level stands on the one training path, across tier boundaries:
 * a level with stars is passed, the first one without stars is next, and the rest are locked
 * unless they were opened under an earlier training layout (`granted`, see `unlocksFromOldLayouts`).
 */
export type LessonState = 'passed' | 'next' | 'open' | 'locked';

export function lessonStates(progress: Record<string, number>, granted: readonly string[] = []): LessonState[] {
  const next = LEVELS.findIndex((l) => !((progress[l.id] ?? 0) > 0));
  return LEVELS.map((l, i) => ((progress[l.id] ?? 0) > 0 ? 'passed' : i === next ? 'next' : granted.includes(l.id) ? 'open' : 'locked'));
}

export const isUnlocked = (index: number, progress: Record<string, number>, granted: readonly string[] = []) =>
  lessonStates(progress, granted)[index] !== 'locked';

/** Bump when levels move between tiers or change order, and add the old order to OLD_LAYOUTS. */
export const TRAINING_LAYOUT = 3;
const OLD_LAYOUTS = [
  // 1: one flat list of 8.
  ['basics', 'failure', 'glide', 'field', 'flare', 'cushion', 'wind', 'checkride'],
  // 2: Beginner / Intermediate / Expert, 11 levels.
  ['basics', 'hover', 'takeoff', 'landing', 'failure', 'glide', 'field', 'flare', 'cushion', 'wind', 'checkride'],
  // 3: Beginner / Intermediate / Emergency / Expert, 16 levels.
  [
    'basics', 'hover', 'takeoff', 'landing',
    'rings', 'windfield', 'vtakeoff', 'vlanding', 'heliport',
    'failure', 'glide', 'field', 'flare',
    'cushion', 'wind', 'checkride',
  ],
];

/**
 * Levels a save had open under the earlier layouts, so moving levels never locks one a player could already fly.
 * Saves did not record their layout, so every old order is tried.
 */
export function unlocksFromOldLayouts(progress: Record<string, number>): string[] {
  const open = new Set<string>();
  for (const order of OLD_LAYOUTS) {
    order.forEach((id, i) => {
      if (i === 0 || (progress[order[i - 1]] ?? 0) > 0 || (progress[id] ?? 0) > 0) open.add(id);
    });
  }
  return [...open];
}
