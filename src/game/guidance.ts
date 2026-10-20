import { HelicopterState } from '../sim/state';
import { Vec3, wrapAngle } from '../sim/vec';
import { LandingArea } from '../world/world';

export type Reach = 'ok' | 'marginal' | 'short';

export interface Guidance {
  distance: number; // m, horizontal to area centre
  relBearing: number; // rad, + = target to the right of the nose
  reach: Reach;
  /** Wind component along the area's long axis relative to the approach, for the HUD. */
  headwindOnApproach: number; // m/s, + = headwind if flying straight to the target
}

const BEST_GLIDE_AIRSPEED = 28; // m/s (~55 kt)
const BEST_GLIDE_DESCENT = 6.7; // m/s (~1300 fpm), measured from the flight model at 55 kt
/** You only need to reach the near part of a field, not its centre. */
const FIELD_MARGIN = 60; // m

/**
 * Advisory information only: where the selected area is and whether a straight
 * glide at best-glide speed could reach it. It never moves the controls.
 */
export function computeGuidance(s: HelicopterState, area: LandingArea, wind: Vec3): Guidance {
  const dx = area.cx - s.pos.x, dz = area.cz - s.pos.z;
  const distance = Math.hypot(dx, dz);
  const bearing = Math.atan2(-dx, -dz); // same convention as yaw
  const relBearing = -wrapAngle(bearing - s.yaw);
  const ux = dx / Math.max(distance, 1), uz = dz / Math.max(distance, 1);
  const tailwind = wind.x * ux + wind.z * uz;
  const ratio = Math.max(1, (BEST_GLIDE_AIRSPEED + tailwind) / BEST_GLIDE_DESCENT);
  const height = Math.max(s.agl, 1);
  const needed = Math.max(0, distance - FIELD_MARGIN) / height;
  // Turning toward the target costs height; penalise large bearing errors a little.
  const turnPenalty = 1 + Math.abs(relBearing) / Math.PI * 0.35;
  const reach: Reach = needed * turnPenalty <= ratio ? 'ok' : needed * turnPenalty <= ratio * 1.15 ? 'marginal' : 'short';
  return { distance, relBearing, reach, headwindOnApproach: -tailwind };
}

/** Fields further than this from the nose are behind the pilot and can't be selected. */
export const SELECT_MAX_ANGLE = (75 * Math.PI) / 180;

/**
 * Next landing area the pilot can see (within SELECT_MAX_ANGLE of the nose),
 * cycling in list order after `current`. Returns null when no other field is ahead.
 */
export function nextTargetAhead(s: HelicopterState, areas: LandingArea[], current: number | null): number | null {
  for (let step = 1; step <= areas.length; step++) {
    const i = ((current ?? -1) + step) % areas.length;
    if (i === current) continue;
    const a = areas[i];
    const rel = -wrapAngle(Math.atan2(-(a.cx - s.pos.x), -(a.cz - s.pos.z)) - s.yaw);
    if (Math.abs(rel) <= SELECT_MAX_ANGLE) return i;
  }
  return null;
}
