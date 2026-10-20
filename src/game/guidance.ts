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
const BEST_GLIDE_DESCENT = 7.2; // m/s (~1400 fpm)

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
  const needed = distance / height;
  // Turning toward the target costs height; penalise large bearing errors a little.
  const turnPenalty = 1 + Math.abs(relBearing) / Math.PI * 0.35;
  const reach: Reach = needed * turnPenalty < ratio * 0.8 ? 'ok' : needed * turnPenalty < ratio * 1.05 ? 'marginal' : 'short';
  return { distance, relBearing, reach, headwindOnApproach: -tailwind };
}
