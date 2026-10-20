import { DEG } from './vec';

/**
 * Parameters of a generic light, two-blade, single-engine helicopter.
 * Values are plausible for a ~1100 kg machine but tuned for arcade play;
 * they are not data for any real type.
 */
export const AIRCRAFT = {
  mass: 1100, // kg
  rotorRadius: 5.0, // m
  rotorOmega0: 40, // rad/s at 100 % NR (tip speed 200 m/s)
  rotorInertia: 650, // kg m^2 – sets how fast NR decays after a failure
  bladeCount: 2,

  // Blade-element thrust: T = kThrust * Ω² * α, where α = θ - inflowGain * λ
  kThrust: 114,
  inflowGain: 1.5,
  pitchMin: 0.5 * DEG, // blade pitch at collective full down
  pitchMax: 14 * DEG, // blade pitch at collective full up
  stallAlpha: 0.2, // rad, effective blade AoA where thrust stops growing

  // Profile power P0 (Ω/Ω0)³ (1 + 4.65 μ²)(1 + kα α²)
  profilePower0: 30_000, // W
  profileAlphaK: 40,

  // Fuselage equivalent flat-plate areas (m²) along body axes
  dragAreaForward: 1.1,
  dragAreaVertical: 4.0,
  dragAreaSide: 3.5,

  engineMaxPower: 190_000, // W
  engineSpoolDown: 0.6, // s for power to decay after failure
  governorGain: 3.0, // 1/s

  // Attitude response (arcade "attitude command" layer on top of the physics)
  pitchRateMax: 20 * DEG, // rad/s of commanded attitude change at full cyclic
  rollMax: 35 * DEG, // full lateral cyclic bank angle
  pitchLimitUp: 40 * DEG,
  pitchLimitDown: -30 * DEG,
  attitudeLag: 0.28, // s, first-order lag from command to attitude
  yawPedalRate: 45 * DEG, // rad/s at full pedal
  weathervaneGain: 2.2, // 1/s, tail fin aligning nose with relative wind
  failureYawKick: 30 * DEG, // rad/s initial nose-left yaw when torque disappears

  skidHeight: 1.25, // m from reference point down to skid bottom
  hubHeight: 2.2, // m from reference point up to rotor hub
  tailBoomLength: 6.5, // m behind reference point
} as const;

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.225;
export const DISK_AREA = Math.PI * AIRCRAFT.rotorRadius ** 2;

/** Rotor RPM bands, in percent of nominal. */
export const RPM = {
  lowStall: 75, // around this the rotor progressively stalls
  lowWarn: 90,
  highWarn: 110,
  overspeed: 115, // structural damage accumulates above this
} as const;

export const MS_TO_KT = 1.943844;
export const M_TO_FT = 3.28084;
export const MS_TO_FPM = 196.8504;
