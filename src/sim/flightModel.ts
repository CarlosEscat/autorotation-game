import { AIRCRAFT as A, AIR_DENSITY as RHO, DISK_AREA, GRAVITY, RPM } from './aircraft';
import { ControlInputs, FlightEnvironment, HelicopterState, createState } from './state';
import {
  BodyAxes,
  Vec3,
  add,
  bodyAxes,
  clamp,
  dot,
  hlen,
  len,
  scale,
  smoothstep,
  sub,
  v3,
  wrapAngle,
} from './vec';

/** Fixed simulation step. Rendering interpolates nothing; it simply shows the latest state. */
export const SIM_DT = 1 / 120;

export interface RotorResult {
  thrust: number;
  alpha: number;
  powerRequired: number;
  inducedTarget: number;
}

/**
 * Rotor aerodynamics in one place:
 *  - Blade-element thrust grows with Ω² and with effective blade angle of attack
 *    α = θ(collective) − k·λ, where λ is the inflow through the disk. Air coming
 *    *up* through the disk (descent, flare) raises α; air going down lowers it.
 *  - Momentum-theory induced velocity, reduced by edgewise (forward) flow.
 *  - Power the rotor absorbs: P = T·(v_i + V_n) + P_profile.
 *    In a descent V_n < 0, so the air does work on the rotor. That is
 *    autorotation: if P < 0 the rotor speeds up, if P > 0 it slows down.
 */
export function rotorAero(
  omega: number,
  collective: number,
  vAir: Vec3,
  axes: BodyAxes,
  inducedVel: number,
  hubAgl: number,
): RotorResult {
  const vn = dot(vAir, axes.up); // > 0: moving "up the shaft" (air flows down through the disk)
  const inPlane = len(sub(vAir, scale(axes.up, vn)));
  const tipSpeed = Math.max(omega * A.rotorRadius, 1);
  const theta = A.pitchMin + clamp(collective, 0, 1) * (A.pitchMax - A.pitchMin);
  const lambda = (inducedVel + vn) / tipSpeed;
  const alpha = theta - A.inflowGain * lambda;

  // Blade stall above stallAlpha: lift falls off, drag rises sharply.
  const over = Math.max(0, alpha - A.stallAlpha);
  const liftAlpha = alpha <= A.stallAlpha ? alpha : A.stallAlpha - 1.5 * over;

  // Low rotor RPM: blades lose centrifugal stiffening and the retreating blade
  // stalls. Modeled as a thrust-efficiency loss plus extra drag below ~78 %.
  const rpmPct = (omega / A.rotorOmega0) * 100;
  const rpmHealth = smoothstep(RPM.lowStall - 12, RPM.lowStall + 8, rpmPct);

  // Ground effect (Cheeseman–Bennett), capped.
  const z = Math.max(hubAgl, A.rotorRadius / 2);
  const ge = clamp(1 / (1 - (A.rotorRadius / (4 * z)) ** 2), 1, 1.25);

  const thrust = Math.max(0, A.kThrust * omega * omega * liftAlpha * (0.35 + 0.65 * rpmHealth) * ge);

  const mu = inPlane / tipSpeed;
  const omegaRatio = omega / A.rotorOmega0;
  const profile =
    A.profilePower0 *
    omegaRatio ** 3 *
    (1 + 4.65 * mu * mu) *
    (1 + A.profileAlphaK * alpha * alpha + 20 * over) *
    (1 + 6 * (1 - rpmHealth));

  const vh2 = thrust / (2 * RHO * DISK_AREA);
  const inducedTarget = vh2 > 0 ? vh2 / Math.sqrt(inPlane * inPlane + vh2) : 0;

  return {
    thrust,
    alpha,
    powerRequired: thrust * (inducedVel + vn) + profile,
    inducedTarget,
  };
}

/** Advance the helicopter by one fixed step. Mutates `s`. */
export function stepFlight(s: HelicopterState, c: ControlInputs, env: FlightEnvironment, dt = SIM_DT): void {
  s.collective = clamp(c.collective, 0, 1);

  const axes = bodyAxes(s.yaw, s.pitch, s.roll);
  const vAir = sub(s.vel, env.wind);
  const ground = env.groundHeight(s.pos.x, s.pos.z);
  const hubAgl = s.pos.y + A.hubHeight - ground;

  const rotor = rotorAero(s.omega, s.collective, vAir, axes, s.inducedVel, hubAgl);
  s.inducedVel += (rotor.inducedTarget - s.inducedVel) * Math.min(1, dt / 0.12);
  s.thrust = rotor.thrust;

  // --- Engine and governor -------------------------------------------------
  if (!s.engineRunning) s.engineAvail = Math.max(0, s.engineAvail - dt / A.engineSpoolDown);
  const governed = rotor.powerRequired + A.governorGain * A.rotorInertia * s.omega * (A.rotorOmega0 - s.omega);
  s.enginePower = clamp(governed, 0, A.engineMaxPower) * s.engineAvail;

  // --- Rotor speed: I Ω dΩ/dt = P_engine − P_required ----------------------
  s.omega += ((s.enginePower - rotor.powerRequired) / (A.rotorInertia * Math.max(s.omega, 5))) * dt;
  s.omega = clamp(s.omega, 0, A.rotorOmega0 * 1.4);

  // --- Translational dynamics ----------------------------------------------
  const vf = dot(vAir, axes.forward);
  const vu = dot(vAir, axes.up);
  const vr = dot(vAir, axes.right);
  const q = 0.5 * RHO;
  const drag = add(
    add(scale(axes.forward, -q * A.dragAreaForward * vf * Math.abs(vf)), scale(axes.up, -q * A.dragAreaVertical * vu * Math.abs(vu))),
    scale(axes.right, -q * A.dragAreaSide * vr * Math.abs(vr)),
  );
  const force = add(add(scale(axes.up, rotor.thrust), v3(0, -A.mass * GRAVITY, 0)), drag);
  s.vel = add(s.vel, scale(force, dt / A.mass));
  s.pos = add(s.pos, scale(s.vel, dt));

  // --- Attitude --------------------------------------------------------------
  // Cyclic tilts the disk; the fuselage follows. Authority fades with NR,
  // since a slow rotor produces less control moment.
  const authority = clamp((s.omega / A.rotorOmega0) ** 2, 0.15, 1.2);
  s.pitchCmd = clamp(s.pitchCmd + c.cyclicPitch * A.pitchRateMax * dt, A.pitchLimitDown, A.pitchLimitUp);
  const rollCmd = clamp(c.cyclicRoll, -1, 1) * A.rollMax;
  const k = Math.min(1, (dt / A.attitudeLag) * authority);
  s.pitch += (s.pitchCmd - s.pitch) * k;
  s.roll += (rollCmd - s.roll) * k;

  // Yaw: pedals + tail-fin weathervaning toward the relative wind + the
  // nose-left kick when engine torque disappears.
  const airH = Math.hypot(vAir.x, vAir.z);
  const airHeading = Math.atan2(-vAir.x, -vAir.z);
  const slip = wrapAngle(airHeading - s.yaw);
  const vane = A.weathervaneGain * slip * smoothstep(5, 20, airH);
  s.yawKick *= Math.exp(-dt / 0.8);
  s.yaw = wrapAngle(s.yaw + (-c.pedal * A.yawPedalRate + vane + s.yawKick) * dt);

  s.time += dt;
  updateDerived(s, env, rotor);
}

export function updateDerived(s: HelicopterState, env: FlightEnvironment, rotor?: RotorResult): void {
  const vAir = sub(s.vel, env.wind);
  s.airspeed = len(vAir);
  s.groundSpeed = hlen(s.vel);
  s.verticalSpeed = s.vel.y;
  s.agl = s.pos.y - A.skidHeight - env.groundHeight(s.pos.x, s.pos.z);
  s.rpmPct = (s.omega / A.rotorOmega0) * 100;
  s.heading = ((((-s.yaw * 180) / Math.PI) % 360) + 360) % 360;
  if (rotor) {
    s.bladeAlpha = rotor.alpha;
    s.loadFactor = rotor.thrust / (A.mass * GRAVITY);
    s.powerRequired = rotor.powerRequired;
  }
}

export function failEngine(s: HelicopterState): void {
  if (!s.engineRunning) return;
  s.engineRunning = false;
  s.yawKick = A.failureYawKick;
}

/**
 * Build a state trimmed for straight and level flight at the given airspeed:
 * thrust tilts forward just enough to balance fuselage drag, and collective is
 * solved from the same blade-element/momentum relations the rotor model uses.
 */
export function trimmedState(opts: { x: number; y: number; z: number; yaw: number; airspeed: number; wind: Vec3 }): HelicopterState {
  const V = opts.airspeed;
  const weight = A.mass * GRAVITY;
  const drag = 0.5 * RHO * A.dragAreaForward * V * V;
  const tilt = Math.atan2(drag, weight);
  const thrust = Math.hypot(weight, drag);
  const vn = V * Math.sin(tilt);
  const inPlane = V * Math.cos(tilt);
  const vh2 = thrust / (2 * RHO * DISK_AREA);
  const vi = vh2 / Math.sqrt(inPlane * inPlane + vh2);
  const alpha = thrust / (A.kThrust * A.rotorOmega0 ** 2);
  const theta = alpha + (A.inflowGain * (vi + vn)) / (A.rotorOmega0 * A.rotorRadius);
  const collective = clamp((theta - A.pitchMin) / (A.pitchMax - A.pitchMin), 0, 1);

  const s = createState({
    pos: v3(opts.x, opts.y, opts.z),
    yaw: opts.yaw,
    speed: 0,
    collective,
    pitch: -tilt,
    omega: A.rotorOmega0,
    inducedVel: vi,
    thrust,
  });
  const fwd = v3(-Math.sin(opts.yaw), 0, -Math.cos(opts.yaw));
  s.vel = add(scale(fwd, V), opts.wind);
  updateDerived(s, { wind: opts.wind, groundHeight: () => -1e5 });
  return s;
}
