import { AIRCRAFT as A } from '../sim/aircraft';
import { HelicopterState } from '../sim/state';
import { DEG, Vec3, add, bodyAxes, dot, rotateBody, v3 } from '../sim/vec';
import { LandingArea, Obstacle, Surface, World } from '../world/world';

export type Outcome = 'excellent' | 'safe' | 'damaged' | 'crash';

/** Points on the airframe that can touch the ground, in body frame. */
const SKID_POINTS: Vec3[] = [v3(-1.1, -A.skidHeight, -1.5), v3(1.1, -A.skidHeight, -1.5), v3(-1.1, -A.skidHeight, 1.4), v3(1.1, -A.skidHeight, 1.4)];
const TAIL_POINT = v3(0, -0.2, A.tailBoomLength);

export function worldPoint(s: HelicopterState, p: Vec3): Vec3 {
  return add(s.pos, rotateBody(p, s.yaw, s.pitch, s.roll));
}

export interface GroundContact {
  tailFirst: boolean;
}

/** Returns contact info if any skid or the tail is at or below the terrain. */
export function checkGroundContact(s: HelicopterState, world: World): GroundContact | null {
  let skidHit = false;
  for (const p of SKID_POINTS) {
    const w = worldPoint(s, p);
    if (w.y <= world.heightAt(w.x, w.z)) skidHit = true;
  }
  const t = worldPoint(s, TAIL_POINT);
  const tailHit = t.y <= world.heightAt(t.x, t.z);
  if (!skidHit && !tailHit) return null;
  return { tailFirst: tailHit && !skidHit };
}

export interface StrikeResult {
  part: 'main rotor' | 'tail rotor' | 'fuselage';
  obstacle: Obstacle;
}

const OBSTACLE_NAMES: Record<Obstacle['kind'], string> = { tree: 'a tree', rock: 'a boulder', building: 'a building', tower: 'the control tower' };
const obstacleName = (o: Obstacle) => OBSTACLE_NAMES[o.kind];
export const describeStrike = (s: StrikeResult) => `${s.part[0].toUpperCase()}${s.part.slice(1)} struck ${obstacleName(s.obstacle)}`;

/** In-flight collision of rotor disk, tail rotor or fuselage with obstacles. */
export function checkObstacleStrike(s: HelicopterState, world: World): StrikeResult | null {
  const near = world.obstaclesNear(s.pos.x, s.pos.z, A.rotorRadius + A.tailBoomLength);
  if (near.length === 0) return null;
  const hub = worldPoint(s, v3(0, A.hubHeight, 0));
  const tail = worldPoint(s, v3(0, 0.4, A.tailBoomLength + 0.3));
  const skid = s.pos.y - A.skidHeight;
  for (const o of near) {
    const top = o.base + o.height;
    if (o.kind !== 'rock') {
      const dHub = Math.hypot(hub.x - o.x, hub.z - o.z);
      // Tree crowns are cones: the radius available at hub height shrinks toward the top.
      const crown = o.kind === 'tree' ? o.radius * Math.min(1, (top - hub.y) / (o.height * 0.75)) : o.radius;
      if (hub.y < top && hub.y > o.base && dHub < A.rotorRadius + Math.max(crown, 0)) return { part: 'main rotor', obstacle: o };
      const dTail = Math.hypot(tail.x - o.x, tail.z - o.z);
      if (tail.y < top && dTail < 0.9 + o.radius * 0.8) return { part: 'tail rotor', obstacle: o };
    }
    const dBody = Math.hypot(s.pos.x - o.x, s.pos.z - o.z);
    if (skid < top && dBody < 1.6 + o.radius * 0.8) return { part: 'fuselage', obstacle: o };
  }
  return null;
}

export interface TouchdownReport {
  verticalSpeed: number; // m/s, positive = descending
  groundSpeed: number;
  forwardSpeed: number;
  lateralSpeed: number;
  pitch: number;
  roll: number;
  rpmPct: number;
  surface: Surface;
  area?: LandingArea;
  slope: number;
  headwind: number; // m/s component of wind on the nose at touchdown
  tailFirst: boolean;
  rocksUnderfoot: boolean;
  /** Multiplier on every touchdown limit (1 = realistic, larger = more forgiving). */
  leniency: number;
  rollover: boolean;
  damage: number;
  /** Ranked list of what caused damage. */
  damageReasons: { amount: number; text: string }[];
}

/** Ground speed a skid-equipped helicopter tolerates on each surface. */
export const RUN_ON_TOLERANCE: Record<Surface, number> = {
  field: 8,
  strip: 7,
  paved: 8,
  grass: 4,
  rough: 1.5,
  water: 0,
};

export function evaluateTouchdown(s: HelicopterState, world: World, contact: GroundContact, wind: Vec3, leniency = 1): TouchdownReport {
  const L = leniency;
  const axes = bodyAxes(s.yaw, 0, 0);
  const vs = -s.vel.y;
  const fwd = dot(s.vel, axes.forward);
  const lat = dot(s.vel, axes.right);
  const gs = Math.hypot(s.vel.x, s.vel.z);
  const surface = world.surfaceAt(s.pos.x, s.pos.z);
  const area = world.areaAt(s.pos.x, s.pos.z);
  const slope = world.slopeAt(s.pos.x, s.pos.z);
  const pitchDeg = s.pitch / DEG;
  const rollDeg = Math.abs(s.roll / DEG);
  const headwind = -dot(wind, axes.forward);
  const rocks = world.obstaclesNear(s.pos.x, s.pos.z, 2.2).some((o) => o.kind === 'rock');

  const reasons: { amount: number; text: string }[] = [];
  const hit = (amount: number, text: string) => {
    if (amount > 0.5) reasons.push({ amount, text });
  };
  let rollover = false;

  // Vertical impact: skids absorb up to ~1 m/s (200 fpm) without damage.
  const fpm = Math.round(vs * 196.85);
  const v = vs / L;
  if (v > 7) hit(100, `Vertical impact of ${fpm} fpm destroyed the airframe`);
  else if (v > 4.5) hit(42 + (v - 4.5) * 16, `Very hard vertical impact (${fpm} fpm)`);
  else if (v > 2.5) hit(12 + (v - 2.5) * 15, `Hard touchdown (${fpm} fpm) spread the skids`);
  else if (v > 1) hit((v - 1) * 8, `Firm touchdown (${fpm} fpm)`);

  const tol = RUN_ON_TOLERANCE[surface] * L;
  const kt = (m: number) => Math.round(m * 1.944);
  if (surface === 'water') hit(100, 'Ditched in the lake');
  else if (gs > tol) hit((gs - tol) * 6, `Touched down at ${kt(gs)} kt ground speed on ${surface === 'grass' ? 'unprepared ground' : surface + ' surface'}`);
  if (gs > tol + 10 * L) rollover = true;

  if (Math.abs(lat) > 1.5 * L) hit((Math.abs(lat) - 1.5 * L) * 15, `Skidding sideways at ${kt(Math.abs(lat))} kt`);
  if (Math.abs(lat) > 4 * L) rollover = true;
  if (fwd < -1 * L) hit(25, 'Moving backwards at touchdown: tail rotor struck the ground');

  if ((contact.tailFirst && L === 1) || pitchDeg > 12 * L) hit(15 + Math.max(0, pitchDeg - 12 * L) * 3, `Tail struck the ground (${pitchDeg.toFixed(0)}° nose up)`);
  if (pitchDeg < -4 * L && gs > 3 * L) hit((-pitchDeg - 4 * L) * 3 + 5, `Nose-low touchdown (${(-pitchDeg).toFixed(0)}° down) dug in the skid toes`);
  if (pitchDeg < -8 * L && gs > 8 * L) rollover = true;

  if (rollDeg > 6 * L) hit((rollDeg - 6 * L) * 4, `Landed with ${rollDeg.toFixed(0)}° of bank`);
  if (rollDeg > 15 * L) rollover = true;

  const slopeDeg = Math.atan(slope) / DEG;
  if (slopeDeg > 12 * L) rollover = true;
  else if (slopeDeg > 6 * L) hit((slopeDeg - 6 * L) * 4, `Sloping ground (${slopeDeg.toFixed(0)}°)`);

  if (s.rpmPct < 60 / L) hit(15, `Rotor RPM only ${s.rpmPct.toFixed(0)}% at touchdown: drooping blades hit the tail boom`);
  if (surface === 'rough') hit(8, 'Rough ground damaged the skids');
  if (rocks) hit(25, 'A skid landed on a boulder');

  if (rollover) hit(100, 'Dynamic rollover: the helicopter tipped onto its side');

  reasons.sort((a, b) => b.amount - a.amount);
  const damage = Math.min(100, reasons.reduce((t, r) => t + r.amount, 0));
  return {
    verticalSpeed: vs,
    groundSpeed: gs,
    forwardSpeed: fwd,
    lateralSpeed: lat,
    pitch: s.pitch,
    roll: s.roll,
    rpmPct: s.rpmPct,
    surface,
    area,
    slope,
    headwind,
    tailFirst: contact.tailFirst,
    rocksUnderfoot: rocks,
    leniency: L,
    rollover,
    damage,
    damageReasons: reasons,
  };
}

export function classify(damage: number, crashed: boolean, td: TouchdownReport | null): Outcome {
  if (crashed || !td || damage >= 60) return 'crash';
  if (damage >= 20) return 'damaged';
  if (damage < 5 && td.area && td.verticalSpeed < 1.5 * td.leniency && td.groundSpeed <= RUN_ON_TOLERANCE[td.surface] * td.leniency * 0.8) return 'excellent';
  return 'safe';
}
