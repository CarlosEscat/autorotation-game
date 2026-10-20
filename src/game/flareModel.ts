import { AIRCRAFT as A, GRAVITY } from '../sim/aircraft';
import { HelicopterState } from '../sim/state';
import { Vec3, clamp, smoothstep } from '../sim/vec';

/**
 * Energy-based flare and cushion for the last ~100 ft of an autorotation.
 *
 * The blade-element rotor model is fine for the glide, but close to the ground it
 * makes the flare too abrupt and lets the collective buy a climb from rotor energy.
 * Below ZONE this model takes over the vertical speed and the rotor-RPM losses:
 *  - Sink settles toward the natural autorotation sink for the current airspeed
 *    (about 1300 fpm in a glide, more when slow), a little less in ground effect.
 *  - Flare: decelerating trades forward kinetic energy for lift. The sink is reduced
 *    by FLARE_EFFICIENCY * v * deceleration / g, so it fades as the speed bleeds off.
 *  - Cushion: collective above the autorotation setting spends rotor RPM to cancel
 *    sink, CUSHION_DECEL m/s² at full collective. It can stop a descent but never
 *    turns it into a climb, and it fades as the rotor slows.
 * Horizontal motion, attitude and rotor-RPM gains (the flare spinning the rotor up)
 * still come from the flight model.
 */
export const FLARE = {
  ZONE: 30, // m AGL (~100 ft) where the model is fully in charge (blended over the 6 m above)
  SINK_GLIDE: 6.7, // m/s natural sink at 25 m/s and above
  SINK_SLOW_EXTRA: 2.2, // m/s added at zero airspeed
  GROUND_EFFECT: 0.4, // fraction of sink removed at the skids, fading out by 10 m
  SINK_TAU: 1.5, // s for the sink to settle toward its target
  FLARE_EFFICIENCY: 0.65,
  DECEL_TAU: 0.3, // s smoothing of the measured deceleration
  CUSHION_COLLECTIVE: [0.2, 0.65] as [number, number], // collective range from no cushion to full cushion
  MAX_BALLOON: 0.6, // m/s: the most a flare can lift the helicopter this low (~120 fpm)
  CUSHION_DECEL: 9, // m/s² of sink cancelled at full cushion
  /** Rotor RPM spent per second of full-strength cushioning, in % of nominal. */
  CUSHION_RPM_COST: { easy: 30, normal: 50 },
  CUSHION_RPM_FLOOR: 70, // % NR at which the cushion has faded completely
};

export class FlareModel {
  private prevSpeed = Number.NaN;
  private decel = 0;

  /**
   * Called after the flight-model step. `vyBefore` and `omegaBefore` are the vertical
   * speed and rotor speed before that step; mutates the state.
   */
  apply(s: HelicopterState, wind: Vec3, vyBefore: number, omegaBefore: number, easy: boolean, dt: number): void {
    const F = FLARE;
    const speed = Math.hypot(s.vel.x - wind.x, s.vel.z - wind.z);
    if (Number.isNaN(this.prevSpeed)) this.prevSpeed = speed;
    const rawDecel = (this.prevSpeed - speed) / dt;
    this.prevSpeed = speed;
    this.decel += (rawDecel - this.decel) * Math.min(1, dt / F.DECEL_TAU);

    const blend = smoothstep(F.ZONE + 6, F.ZONE, s.agl);
    if (blend <= 0) return;

    const slow = 1 - Math.min(speed, 25) / 25;
    const ground = 1 - F.GROUND_EFFECT * smoothstep(10, 0, s.agl);
    const natural = (F.SINK_GLIDE + F.SINK_SLOW_EXTRA * slow * slow) * ground;
    const flare = (F.FLARE_EFFICIENCY * speed * Math.max(0, this.decel)) / GRAVITY;
    const target = Math.max(-F.MAX_BALLOON, natural - flare); // negative = the flare is still lifting (a small balloon)

    const rpm = (s.omega / A.rotorOmega0) * 100;
    const [c0, c1] = F.CUSHION_COLLECTIVE;
    const pull = clamp((s.collective - c0) / (c1 - c0), 0, 1);
    const cushion = pull * clamp((rpm - F.CUSHION_RPM_FLOOR) / (100 - F.CUSHION_RPM_FLOOR), 0, 1);

    let vy = vyBefore + (-target - vyBefore) * Math.min(1, dt / F.SINK_TAU);
    // The rotor pays for the sink actually cancelled, not for the lever position.
    let used = 0;
    if (vy < 0) {
      const cancel = Math.min(-vy, cushion * F.CUSHION_DECEL * dt);
      vy += cancel;
      used = cancel / (F.CUSHION_DECEL * dt);
    }

    const physicsVy = s.vel.y;
    s.vel.y = physicsVy + (vy - physicsVy) * blend;
    s.pos.y += (s.vel.y - physicsVy) * dt;

    // Rotor RPM: keep the flight model's gains, replace its losses with the cushion's cost.
    const physicsOmega = s.omega;
    const modelOmega = Math.max(physicsOmega, omegaBefore) - (used * F.CUSHION_RPM_COST[easy ? 'easy' : 'normal'] * A.rotorOmega0 * dt) / 100;
    s.omega = physicsOmega + (modelOmega - physicsOmega) * blend;
  }
}
