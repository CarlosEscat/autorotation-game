import { Vec3, v3 } from './vec';

/** Pilot inputs, produced by any input device and consumed by the flight model. */
export interface ControlInputs {
  /** Collective lever position, 0 = full down, 1 = full up. */
  collective: number;
  /** Longitudinal cyclic, -1 = full forward (nose down) … +1 = full aft (nose up). */
  cyclicPitch: number;
  /** Lateral cyclic, -1 = full left … +1 = full right. */
  cyclicRoll: number;
  /** Anti-torque pedals, -1 = left … +1 = right. */
  pedal: number;
}

export const neutralControls = (collective = 0.4): ControlInputs => ({
  collective,
  cyclicPitch: 0,
  cyclicRoll: 0,
  pedal: 0,
});

/** World the aircraft flies in, as far as the flight model needs to know. */
export interface FlightEnvironment {
  /** Velocity of the air mass (m/s, world frame). */
  wind: Vec3;
  /** Terrain elevation under a world position (m). */
  groundHeight(x: number, z: number): number;
}

export interface HelicopterState {
  time: number;
  pos: Vec3; // reference point (roughly the CG), world frame, m
  vel: Vec3; // inertial velocity, m/s
  yaw: number; // rad, 0 = north (-Z), positive = left
  pitch: number; // rad, positive nose up
  roll: number; // rad, positive right wing down
  pitchCmd: number; // attitude the cyclic is currently asking for
  yawKick: number; // decaying yaw rate after torque loss, rad/s
  collective: number; // 0..1

  omega: number; // rotor speed, rad/s
  inducedVel: number; // lagged momentum-theory induced velocity, m/s
  thrust: number; // N, along the disk normal

  engineRunning: boolean;
  enginePower: number; // W currently delivered to the rotor
  engineAvail: number; // 0..1, spools down after failure

  // Derived quantities refreshed every step (for HUD, scoring, tests)
  airspeed: number; // m/s, magnitude of velocity relative to air
  groundSpeed: number; // m/s, horizontal inertial speed
  verticalSpeed: number; // m/s, positive up
  agl: number; // m, skid bottom above terrain
  rpmPct: number; // % of nominal NR
  bladeAlpha: number; // rad, effective blade AoA
  loadFactor: number; // g along disk normal
  powerRequired: number; // W the rotor is absorbing
  heading: number; // deg 0..360
}

export function createState(init: {
  pos: Vec3;
  yaw: number;
  speed: number;
  collective: number;
  pitch: number;
  omega: number;
  inducedVel: number;
  thrust: number;
}): HelicopterState {
  const fwd = v3(-Math.sin(init.yaw), 0, -Math.cos(init.yaw));
  return {
    time: 0,
    pos: { ...init.pos },
    vel: v3(fwd.x * init.speed, 0, fwd.z * init.speed),
    yaw: init.yaw,
    pitch: init.pitch,
    roll: 0,
    pitchCmd: init.pitch,
    yawKick: 0,
    collective: init.collective,
    omega: init.omega,
    inducedVel: init.inducedVel,
    thrust: init.thrust,
    engineRunning: true,
    enginePower: 0,
    engineAvail: 1,
    airspeed: init.speed,
    groundSpeed: init.speed,
    verticalSpeed: 0,
    agl: 0,
    rpmPct: 100,
    bladeAlpha: 0,
    loadFactor: 1,
    powerRequired: 0,
    heading: 0,
  };
}
