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
  /** Ring orientation (rotation about Y); by default it faces along the path to the next gate. */
  facing?: number;
}

export type TierId = 'beginner' | 'intermediate' | 'expert';

/** A section of the training menu. Its lessons are the levels with this tier, in list order. */
export interface TierDef {
  id: TierId;
  title: string;
  blurb: string;
}

export const TIERS: TierDef[] = [
  { id: 'beginner', title: 'Beginner', blurb: 'Learn to fly: engine running, no emergencies.' },
  { id: 'intermediate', title: 'Intermediate', blurb: 'The engine quits: save the rotor, glide and flare.' },
  { id: 'expert', title: 'Expert', blurb: 'Full autorotations to the ground, by hand.' },
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
  /** Show only the next gate instead of every one still ahead (rings close together). */
  nextGateOnly?: boolean;
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
/** Engine running the whole time, and resting on the skids is allowed (beginner lessons near the ground). */
const POWERED: FlightConfig = { ...BASE, airspeedKt: 0, failureDelay: NEVER, freeFlight: true };
/** Centreline of the north–south airport runway; its south end is at z = -175. */
const RUNWAY_X = -180;
const HOVER_SPOT = { x: RUNWAY_X + 8, z: -300 };
/** Hover box corners, 15 m apart: forward, left, back, then right to the start. Each ring faces the way you arrive. */
const HOVER_BOX: Gate[] = [
  [0, -15, Math.PI],
  [-15, -15, -Math.PI / 2],
  [-15, 0, 0],
  [0, 0, Math.PI / 2],
].map(([dx, dz, facing]) => ({ x: HOVER_SPOT.x + dx, z: HOVER_SPOT.z + dz, agl: 7.5, radius: 7, facing }));

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
    teaches: 'Pedals turn the nose, small cyclic inputs move you a few metres, the collective holds the height.',
    config: { ...POWERED, altitudeFt: 10, start: { ...HOVER_SPOT, yaw: 0, settle: 'hover' } },
    target: null,
    gates: HOVER_BOX,
    nextGateOnly: true,
    makeObjective() {
      const gates = this.gates;
      const headings = [270, 360];
      // Settle, two pedal turns, then the four corners of the hover box.
      const steps = 1 + headings.length + gates.length;
      let step = 0, held = 0, peakSpeed = 0;
      return lesson(({ session, mode }, dt) => {
        const s = session.state;
        const k = KEY_WORDS[mode];
        if (session.touchdown) return fail(`Touched the ground. Keep a little collective (${k.up}) to stay a few feet up.`);
        if (s.agl > 12) return fail(`Too high (${ft(s.agl)} ft): a hover is just above the ground. Lower the collective (${k.down}) sooner.`);
        if (Math.hypot(s.pos.x - HOVER_SPOT.x, s.pos.z - HOVER_SPOT.z) > 60) return fail('Drifted too far. Small cyclic inputs, and stop each move before it runs away.');
        if (s.time > 180) return fail('Out of time. Small, steady inputs work best.');
        peakSpeed = Math.max(peakSpeed, s.groundSpeed);
        const steady = s.groundSpeed < 1.5 && Math.abs(s.verticalSpeed) < 0.6;
        const g = step > headings.length ? gates[step - 1 - headings.length] : null;
        const want = step >= 1 && step <= headings.length ? headings[step - 1] : null;
        const off = want === null ? 0 : Math.abs(wrapAngle((s.heading - want) * DEG)) / DEG;
        const there = g ? Math.hypot(s.pos.x - g.x, s.pos.z - g.z) < 3 : want !== null ? off < 8 : true;
        held = there && steady ? held + dt : 0;
        if (held >= (step === 0 ? 3 : 1)) (step++, (held = 0));
        const nextGate = Math.max(0, step - 1 - headings.length);
        if (step === steps) return { ...pass(s.time < 75 && peakSpeed < 4 ? 3 : s.time < 120 ? 2 : 1, 'Hover box done!'), nextGate };
        const height =
          s.agl < 1 ? ` Low: a touch of collective (${k.up}).` : s.agl > 6 ? ` High: ease the collective down (${k.down}).` : '';
        const turn = (dir: string, key: string) => `${dir} pedal (${key}): turn the nose to ${String(want).padStart(3, '0')}° (now ${String(Math.round(s.heading) % 360).padStart(3, '0')}°), then let go.`;
        const text = [
          `You are hovering at about 10 ft. Hold still: small collective inputs (${k.up} / ${k.down}) keep the height.`,
          turn('Left', k.yawLeft),
          turn('Right', k.yawRight),
          `Ease forward (${k.fwd}) into the yellow ring ahead, then stop over it (${k.aft}).`,
          `Slide left (${k.left}) to the next ring, then stop (${k.right}).`,
          `Ease back (${k.aft}) to the ring behind you, then stop (${k.fwd}).`,
          `Slide right (${k.right}) back to where you started, then stop (${k.left}).`,
        ][step];
        return { text: text + height, progress: step / steps, nextGate };
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
    id: 'failure',
    tier: 'intermediate',
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
    tier: 'intermediate',
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
    tier: 'intermediate',
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
    tier: 'intermediate',
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
    tier: 'expert',
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
    tier: 'expert',
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
    tier: 'expert',
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
 * Level `index` is open once the one before it has been passed, across tier boundaries.
 * A level that already has stars stays open (older saves predate the newer lessons).
 */
export function isUnlocked(index: number, progress: Record<string, number>): boolean {
  return index === 0 || (progress[LEVELS[index - 1]?.id] ?? 0) > 0 || (progress[LEVELS[index]?.id] ?? 0) > 0;
}
