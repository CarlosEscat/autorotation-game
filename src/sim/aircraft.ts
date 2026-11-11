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
  // Game simplifications while the engine runs (none apply after a failure):
  powerLimitMargin: 0.97, // collective is held where the rotor needs at most this share of max power
  governorBrakePower: 60_000, // W the governor may take out to keep NR down in a powered descent

  // Attitude response (arcade "attitude command" layer on top of the physics)
  pitchRateMax: 20 * DEG, // rad/s of commanded attitude change at full cyclic
  rollMax: 35 * DEG, // full lateral cyclic bank angle
  pitchLimitUp: 40 * DEG,
  pitchLimitDown: -30 * DEG,
  attitudeLag: 0.28, // s, first-order lag from command to attitude
  yawPedalRate: 45 * DEG, // rad/s at full pedal
  weathervaneGain: 2.2, // 1/s, tail fin aligning nose with relative wind
  failureYawKick: 30 * DEG, // rad/s initial nose-left yaw when torque disappears

  skidHeight: 1.25, // m from reference point down to skid (or wheel) bottom
  hubHeight: 2.2, // m from reference point up to rotor hub
  tailBoomLength: 6.5, // m behind reference point

  // Where the landing gear meets the ground (body frame) and how wide the fuselage is for collisions
  gear: 'skids',
  gearHalfTrack: 1.1, // m either side, front contact points
  gearRearHalfTrack: 1.1, // m either side, rear contact points
  gearFront: 1.5, // m ahead of the reference point
  gearRear: 1.4, // m behind the reference point
  bodyRadius: 1.6, // m

  bladeChord: 0.28, // m, for the model
  soundPitch: 1, // rotor sound relative to the light helicopter
} as const;

/** Everything the flight model, the game rules and the 3D model need to know about one helicopter type. */
export type AircraftSpec = { readonly [K in Exclude<keyof typeof AIRCRAFT, 'gear'>]: number } & { readonly gear: 'skids' | 'wheels' };

/**
 * A generic heavy, four-blade, twin-engine firefighting helicopter with a belly water tank.
 * About seven times the weight of the light one, with far more power for its weight: it climbs
 * harder and cruises about twice as fast, but answers the controls more slowly and takes longer to stop.
 * Like the light type, the numbers are tuned for play and are not data for any real aircraft.
 */
export const HEAVY: AircraftSpec = {
  mass: 8000,
  rotorRadius: 8.2,
  rotorOmega0: 27, // tip speed 221 m/s
  rotorInertia: 12_000,
  bladeCount: 4,

  kThrust: 1540,
  inflowGain: 1.5,
  pitchMin: 0.5 * DEG,
  pitchMax: 18 * DEG,
  stallAlpha: 0.2,

  profilePower0: 300_000,
  profileAlphaK: 40,

  dragAreaForward: 4.2,
  dragAreaVertical: 12,
  dragAreaSide: 11,

  engineMaxPower: 2_600_000,
  engineSpoolDown: 0.6,
  governorGain: 3.0,
  powerLimitMargin: 0.97,
  governorBrakePower: 600_000,

  pitchRateMax: 14 * DEG,
  rollMax: 40 * DEG,
  pitchLimitUp: 35 * DEG,
  pitchLimitDown: -25 * DEG,
  attitudeLag: 0.5,
  yawPedalRate: 30 * DEG,
  weathervaneGain: 1.8,
  failureYawKick: 20 * DEG,

  skidHeight: 1.8,
  hubHeight: 2.1,
  tailBoomLength: 9.6,

  gear: 'wheels',
  gearHalfTrack: 1.35,
  gearRearHalfTrack: 0.2, // single tail wheel
  gearFront: 1.5,
  gearRear: 5.5,
  bodyRadius: 2.4,

  bladeChord: 0.5,
  soundPitch: 0.62,
};

export type AircraftId = 'light' | 'heavy';

export interface AircraftType {
  id: AircraftId;
  name: string;
  /** One line for the menu. */
  blurb: string;
  spec: AircraftSpec;
}

export const AIRCRAFT_TYPES: Record<AircraftId, AircraftType> = {
  light: { id: 'light', name: 'Trainer', blurb: 'Light and nimble two-seater', spec: AIRCRAFT },
  heavy: { id: 'heavy', name: 'Heavy', blurb: 'Fast, powerful firefighter', spec: HEAVY },
};

export const diskArea = (a: AircraftSpec) => Math.PI * a.rotorRadius ** 2;

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
