import { FlightConfig, FlightSession } from '../src/game/session';
import { ControlInputs, HelicopterState, neutralControls } from '../src/sim/state';
import { DEG, clamp } from '../src/sim/vec';
import { World } from '../src/world/world';

/** How a keyboard player flies the last part of an autorotation. Used only by tests. */
export interface LandingTechnique {
  /** Height to start the flare (0 = no flare). */
  flareFt: number;
  /** Nose-up attitude to hold in the flare. */
  flarePitchDeg: number;
  /** Height to start raising the collective (0 = no cushion). */
  cushionFt: number;
  /** Keep W held instead of easing off once the sink stops. */
  holdW?: boolean;
}

export interface LandingRun {
  session: FlightSession;
  /** Highest climb rate while the collective was cushioning, m/s. */
  climbWhileCushioning: number;
}

/**
 * Glide at ~62 kt, hold ↓ to the flare attitude, hold ↑ to level at 10 ft, then hold W
 * (1.5 per second, like the keyboard) while sinking, easing off if climbing.
 * `onStep` runs after every step (e.g. to update a level objective) and can stop the run.
 */
export function flyLanding(world: World, config: FlightConfig, t: LandingTechnique, onStep?: (s: FlightSession) => boolean): LandingRun {
  const session = new FlightSession(world, config);
  const c: ControlInputs = neutralControls(session.state.collective);
  let phase: 'glide' | 'flare' | 'level' = 'glide';
  let smooth = 0;
  let climbWhileCushioning = -Infinity;
  const dt = 1 / 120;
  for (let n = 0; n < 120 * 120 && session.phase !== 'done'; n++) {
    const s: HelicopterState = session.state;
    const ft = s.agl * 3.28;
    let key: number;
    if (phase === 'glide') {
      key = clamp((-0.02 * (32 - s.airspeed) - 0.05 - s.pitchCmd) * 6, -1, 1);
      if (session.phase === 'autorotation') c.collective = clamp(0.1 + (s.rpmPct - 100) * 0.015, 0, 1);
      if (t.flareFt && ft < t.flareFt) phase = 'flare';
      else if (!t.flareFt && ft < 10) phase = 'level';
    } else if (phase === 'flare') {
      key = s.pitch < t.flarePitchDeg * DEG ? 1 : 0;
      if (ft < 10) phase = 'level';
    } else key = s.pitch > 3 * DEG ? -1 : s.pitch < -1 * DEG ? 1 : 0;
    // Keyboard ramp, as in InputManager.
    const rate = key === 0 ? 10 : 4;
    smooth += clamp(key - smooth, -rate * dt, rate * dt);
    c.cyclicPitch = phase === 'glide' ? key : smooth;
    const cushioning = t.cushionFt > 0 && ft < t.cushionFt;
    if (cushioning) c.collective = clamp(c.collective + (t.holdW || s.verticalSpeed < -0.3 ? 1.5 : s.verticalSpeed > 0.3 ? -1.5 : 0) * dt, 0, 1);
    session.step(c);
    if (cushioning && session.phase === 'autorotation') climbWhileCushioning = Math.max(climbWhileCushioning, s.verticalSpeed);
    if (onStep?.(session)) break;
  }
  return { session, climbWhileCushioning };
}
