import { AIRCRAFT as A, M_TO_FT, MS_TO_KT } from '../sim/aircraft';
import { SIM_DT, failEngine, stepFlight, trimmedState, updateDerived } from '../sim/flightModel';
import { ControlInputs, FlightEnvironment, HelicopterState } from '../sim/state';
import { DEG, Vec3, clamp, hlen, scale, smoothstep, v3 } from '../sim/vec';
import { World } from '../world/world';
import {
  GroundContact,
  Outcome,
  StrikeResult,
  TouchdownReport,
  checkGroundContact,
  checkObstacleStrike,
  classify,
  describeStrike,
  evaluateTouchdown,
} from './landing';
import { FlareModel } from './flareModel';
import { FlightRecorder, ScoreResult, computeScore } from './scoring';

export type Difficulty = 'easy' | 'normal';

export interface FlightConfig {
  altitudeFt: number;
  airspeedKt: number;
  windKt: number;
  /** Direction the wind blows FROM, degrees (0 = north). */
  windFromDeg: number;
  failureDelay: number; // s of normal flight before the failure
  /** 'easy' adds arcade assists: slower NR decay, auto-cushion near the ground, wider touchdown limits. */
  difficulty?: Difficulty;
  /** Where the flight starts; defaults to START. `autorotating` starts already in a power-off glide. */
  start?: StartOverride;
  /** Set false to turn off easy mode's auto-cushion (the slower NR decay stays). */
  cushion?: boolean;
  /** Multiplier on touchdown limits; defaults to 2.5 in easy mode, 1 otherwise. */
  leniency?: number;
}

export interface StartOverride {
  x: number;
  z: number;
  yaw: number;
  autorotating?: { sinkMs: number; collective: number };
}

export const DEFAULT_CONFIG: FlightConfig = { altitudeFt: 1000, airspeedKt: 70, windKt: 8, windFromDeg: 0, failureDelay: 4 };
/** Touchdown limits are multiplied by this in easy mode. */
const EASY_LENIENCY = 2.5;

export const START = { x: 0, z: 1100, yaw: 0 };

export type Phase = 'cruise' | 'autorotation' | 'ground' | 'done';

export interface FlightEvent {
  type: 'failure' | 'touchdown' | 'strike' | 'crash' | 'stopped' | 'lowG' | 'assist';
  text: string;
}

export interface FlightResult {
  outcome: Outcome;
  damage: number;
  touchdown: TouchdownReport | null;
  crashReason: string | null;
  score: ScoreResult;
  flightTime: number;
}

/**
 * One flight attempt: owns the helicopter state, advances it in fixed steps and
 * applies the game rules (failure trigger, collisions, touchdown, scoring).
 * It has no knowledge of rendering or input devices.
 */
export class FlightSession {
  readonly state: HelicopterState;
  readonly env: FlightEnvironment;
  readonly wind: Vec3;
  readonly rec = new FlightRecorder();
  phase: Phase = 'cruise';
  /** Airframe damage accumulated in flight (overspeed, low-G). */
  flightDamage = 0;
  touchdown: TouchdownReport | null = null;
  crashed = false;
  crashReason: string | null = null;
  result: FlightResult | null = null;
  events: FlightEvent[] = [];
  /** Continuous time spent below 0.2 g at speed (mast-bumping risk). */
  private lowGRun = 0;
  /** Visual-only: roll angle of a helicopter that tipped over. */
  tipOver = 0;
  private groundTime = 0;
  private assistAnnounced = false;
  private flare = new FlareModel();

  constructor(
    readonly world: World,
    readonly config: FlightConfig,
  ) {
    const from = config.windFromDeg * DEG;
    // Air moves toward the opposite of where it comes from. North = -Z, east = +X.
    this.wind = scale(v3(-Math.sin(from), 0, Math.cos(from)), config.windKt / MS_TO_KT);
    this.env = { wind: this.wind, groundHeight: world.heightAt };
    const start = config.start ?? START;
    const ground = world.heightAt(start.x, start.z);
    this.state = trimmedState({
      x: start.x,
      y: ground + A.skidHeight + config.altitudeFt / M_TO_FT,
      z: start.z,
      yaw: start.yaw,
      airspeed: config.airspeedKt / MS_TO_KT,
      wind: this.wind,
    });
    updateDerived(this.state, this.env);
    this.rec.start(this.state);
    if (config.start?.autorotating) this.enterAutorotation(config.start.autorotating);
  }

  /** Start in a settled power-off glide instead of powered cruise. */
  private enterAutorotation(e: NonNullable<StartOverride['autorotating']>) {
    const s = this.state;
    failEngine(s);
    s.engineAvail = 0;
    s.yawKick = 0;
    s.collective = e.collective;
    s.vel.y = -e.sinkMs;
    updateDerived(s, this.env);
    this.rec.onFailure(s);
    this.rec.reactionTime = 0;
    this.phase = 'autorotation';
  }

  get easy(): boolean {
    return this.config.difficulty === 'easy';
  }

  private get leniency(): number {
    return this.config.leniency ?? (this.easy ? EASY_LENIENCY : 1);
  }

  get timeSinceFailure(): number {
    return this.rec.failureTime < 0 ? -1 : this.state.time - this.rec.failureTime;
  }

  step(c: ControlInputs, dt = SIM_DT): void {
    if (this.phase === 'done') return;
    if (this.phase === 'ground') return this.stepGround(dt);

    const s = this.state;
    if (this.phase === 'cruise' && s.time >= this.config.failureDelay) {
      failEngine(s);
      this.rec.onFailure(s);
      this.phase = 'autorotation';
      this.events.push({ type: 'failure', text: 'ENGINE FAILURE' });
    }

    const omegaBefore = s.omega;
    const vyBefore = s.vel.y;
    stepFlight(s, c, this.env, dt);
    // Easy: the rotor loses RPM more slowly while descending (climbing spends it at the real rate).
    if (this.easy && s.omega < omegaBefore && s.vel.y < 0) s.omega = omegaBefore + (s.omega - omegaBefore) * 0.35;
    if (this.phase === 'autorotation') {
      this.flare.apply(s, this.wind, vyBefore, omegaBefore, this.easy, dt);
      updateDerived(s, this.env);
      if (this.easy && this.config.cushion !== false) this.autoCushion(dt);
    }
    this.rec.record(s, dt);

    // In-flight structural limits.
    if (s.rpmPct > 115) this.flightDamage += (s.rpmPct > 125 ? 25 : 8) * dt;
    if (s.loadFactor < 0.2 && s.airspeed > 15 && this.phase === 'autorotation') {
      this.lowGRun += dt;
      this.flightDamage += 6 * dt;
      if (this.lowGRun > 0.3 && this.lowGRun - dt <= 0.3) this.events.push({ type: 'lowG', text: 'LOW-G! Ease the cyclic back' });
    } else if (s.loadFactor > 0.35) this.lowGRun = 0;
    if (this.lowGRun > 1.6 && !this.easy) return this.crash('Mast bumping after a sustained low-G push-over: the rotor separated');
    if (s.rpmPct < 40) return this.crash(`Rotor RPM decayed to ${s.rpmPct.toFixed(0)}%: the blades stalled`);

    const strike = checkObstacleStrike(s, this.world);
    if (strike) return this.onStrike(strike);

    const contact = checkGroundContact(s, this.world);
    if (contact) this.onTouchdown(contact);
  }

  /** Easy-mode landing assist: limits the sink rate, bleeds off ground speed and levels the skids. */
  private autoCushion(dt: number) {
    const s = this.state;
    const agl = s.agl;

    if (agl > 20) return;
    if (!this.assistAnnounced) {
      this.assistAnnounced = true;
      this.events.push({ type: 'assist', text: 'LANDING ASSIST' });
    }
    const t = 1 - agl / 20; // 0 at 20 m, 1 at the ground
    // Only a healthy rotor can hold the sink back: the help fades out between 85 % and 75 % NR.
    const rotorHelp = smoothstep(75, 85, s.rpmPct);
    const maxSink = 1 + agl * 0.35;
    if (-s.vel.y > maxSink) s.vel.y += (-maxSink - s.vel.y) * Math.min(1, dt * 4) * rotorHelp;
    const brake = Math.exp(-dt * 0.9 * t);
    s.vel.x = this.wind.x + (s.vel.x - this.wind.x) * brake;
    s.vel.z = this.wind.z + (s.vel.z - this.wind.z) * brake;
    if (agl < 6) {
      const level = Math.min(1, dt * 3 * (1 - agl / 6));
      s.pitchCmd += (clamp(s.pitchCmd, -3 * DEG, 6 * DEG) - s.pitchCmd) * level;
      s.pitch += (clamp(s.pitch, -3 * DEG, 6 * DEG) - s.pitch) * level;
      s.roll -= s.roll * level;
    }
  }

  private onStrike(strike: StrikeResult) {
    const text = describeStrike(strike);
    this.events.push({ type: 'strike', text });
    this.crash(text);
  }

  private crash(reason: string) {
    this.crashed = true;
    this.crashReason = reason;
    this.events.push({ type: 'crash', text: 'CRASH' });
    if (!this.touchdown) {
      // Still record what the helicopter looked like at impact for the debrief.
      const contact = { tailFirst: false };
      this.touchdown = evaluateTouchdown(this.state, this.world, contact, this.wind, this.leniency);
    }
    this.toGround();
  }

  private onTouchdown(contact: GroundContact) {
    this.rec.onTouchdown(this.state);
    this.touchdown = evaluateTouchdown(this.state, this.world, contact, this.wind, this.leniency);
    if (this.touchdown.rollover || this.touchdown.surface === 'water' || this.touchdown.damage + this.flightDamage >= 60) {
      this.crashed = true;
      this.crashReason = this.touchdown.damageReasons[0]?.text ?? 'Impact';
      this.events.push({ type: 'crash', text: 'CRASH' });
    } else {
      this.events.push({ type: 'touchdown', text: 'TOUCHDOWN' });
    }
    this.toGround();
  }

  private toGround() {
    this.phase = 'ground';
    this.groundTime = 0;
    const s = this.state;
    s.vel.y = 0;
    s.pos.y = this.world.heightAt(s.pos.x, s.pos.z) + A.skidHeight;
  }

  /** Simple post-touchdown slide: skid friction, obstacles, rotor run-down. */
  private stepGround(dt: number) {
    const s = this.state;
    this.groundTime += dt;
    const surface = this.world.surfaceAt(s.pos.x, s.pos.z);
    const mu = surface === 'rough' ? 0.8 : surface === 'strip' ? 0.45 : surface === 'water' ? 1.5 : 0.55;
    const gs = hlen(s.vel);
    if (gs > 0) {
      const dv = Math.min(gs, mu * 9.81 * dt);
      s.vel.x -= (s.vel.x / gs) * dv;
      s.vel.z -= (s.vel.z / gs) * dv;
    }
    s.pos.x += s.vel.x * dt;
    s.pos.z += s.vel.z * dt;
    const ground = this.world.heightAt(s.pos.x, s.pos.z);
    s.pos.y = surface === 'water' ? Math.max(ground + A.skidHeight - 1.5, s.pos.y - dt * 0.6) : ground + A.skidHeight;
    s.pitch += (0 - s.pitch) * Math.min(1, dt * 4);
    s.pitchCmd = s.pitch;
    if (!this.crashed) s.roll += (0 - s.roll) * Math.min(1, dt * 4);
    else this.tipOver = clamp(this.tipOver + dt * 1.8, 0, Math.PI / 2 - 0.15);
    s.omega = Math.max(0, s.omega - dt * (this.crashed ? 20 : 2.5));

    if (!this.crashed && gs > 1) {
      const strike = checkObstacleStrike(s, this.world);
      if (strike && strike.obstacle.kind !== 'rock') {
        this.touchdown?.damageReasons.unshift({ amount: 100, text: `Slid into ${describeStrike(strike).split(' struck ')[1]}` });
        return this.crash(`${describeStrike(strike)} during the ground slide`);
      }
    }
    updateDerived(s, this.env);
    s.agl = 0;

    if (this.groundTime > 2.5 && hlen(s.vel) < 0.2) this.finish();
  }

  private finish() {
    this.phase = 'done';
    const td = this.touchdown;
    const damage = this.crashed ? 100 : Math.min(100, (td?.damage ?? 0) + this.flightDamage);
    if (td && this.flightDamage >= 1) {
      td.damageReasons.push({ amount: this.flightDamage, text: 'In-flight overstress (rotor overspeed / low-G)' });
      td.damageReasons.sort((a, b) => b.amount - a.amount);
    }
    const outcome = classify(damage, this.crashed, td);
    const score = computeScore({
      rec: this.rec,
      touchdown: td,
      damage,
      outcome,
      crashReason: this.crashReason,
      windSpeed: hlen(this.wind),
    });
    this.result = { outcome, damage, touchdown: td, crashReason: this.crashReason, score, flightTime: this.state.time };
    this.events.push({ type: 'stopped', text: 'STOPPED' });
  }
}
