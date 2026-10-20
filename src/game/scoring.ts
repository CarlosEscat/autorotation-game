import { MS_TO_KT, RPM } from '../sim/aircraft';
import { HelicopterState } from '../sim/state';
import { DEG, clamp } from '../sim/vec';
import { Outcome, TouchdownReport } from './landing';

/**
 * Collects the flight metrics scoring needs, step by step. Everything is
 * accumulated from fixed-step simulation data, so identical inputs always give
 * identical scores.
 */
export class FlightRecorder {
  failureTime = -1;
  cruiseCollective = 0;
  reactionTime: number | null = null;
  lowGTime = 0;

  rpmTime = 0;
  rpmGreenTime = 0;
  rpmLowTime = 0; // below 80 %
  rpmOverTime = 0; // above overspeed
  minRpm = 100;
  maxRpm = 100;

  glideTime = 0;
  glideSpeedGoodTime = 0;
  glideDescentGoodTime = 0;
  sumAirspeed = 0;
  sumDescent = 0; // m, integrated descent during the glide

  maxFlarePitch = -90;
  flareStartAgl: number | null = null;
  collectiveLow4m: number | null = null;
  collectiveAtTouchdown = 0;

  start(s: HelicopterState) {
    this.cruiseCollective = s.collective;
  }

  onFailure(s: HelicopterState) {
    this.failureTime = s.time;
  }

  record(s: HelicopterState, dt: number) {
    if (this.failureTime < 0) return;
    const t = s.time - this.failureTime;

    if (this.reactionTime === null && s.collective <= this.cruiseCollective * 0.4 + 0.05) this.reactionTime = t;
    if (s.loadFactor < 0.2 && s.airspeed > 15 && s.agl > 3) this.lowGTime += dt;

    this.minRpm = Math.min(this.minRpm, s.rpmPct);
    this.maxRpm = Math.max(this.maxRpm, s.rpmPct);
    if (t > 1.5 && s.agl > 15) {
      this.rpmTime += dt;
      if (s.rpmPct >= RPM.lowWarn && s.rpmPct <= RPM.highWarn) this.rpmGreenTime += dt;
    }
    if (s.rpmPct < 80) this.rpmLowTime += dt;
    if (s.rpmPct > RPM.overspeed) this.rpmOverTime += dt;

    if (t > 3 && s.agl > 30) {
      const kt = s.airspeed * MS_TO_KT;
      this.glideTime += dt;
      this.sumAirspeed += kt * dt;
      this.sumDescent += -s.verticalSpeed * dt;
      if (kt >= 50 && kt <= 75) this.glideSpeedGoodTime += dt;
      if (-s.verticalSpeed < 10.2) this.glideDescentGoodTime += dt; // under 2000 fpm
    }

    if (s.agl < 45 && s.agl > 1) {
      this.maxFlarePitch = Math.max(this.maxFlarePitch, s.pitch / DEG);
      if (this.flareStartAgl === null && s.pitch > 8 * DEG) this.flareStartAgl = s.agl;
    }
    if (s.agl < 4) {
      this.collectiveLow4m = this.collectiveLow4m === null ? s.collective : Math.min(this.collectiveLow4m, s.collective);
    }
  }

  onTouchdown(s: HelicopterState) {
    this.collectiveAtTouchdown = s.collective;
  }
}

export interface CategoryScore {
  id: string;
  label: string;
  score: number;
  max: number;
  /** What went well (score ≥ 80 %) or the main thing to improve. */
  note: string;
}

export interface ScoreResult {
  total: number;
  outcome: Outcome;
  categories: CategoryScore[];
  strengths: string[];
  improvements: string[];
}

export interface ScoreInput {
  rec: FlightRecorder;
  touchdown: TouchdownReport | null;
  damage: number;
  outcome: Outcome;
  crashReason: string | null;
  windSpeed: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function computeScore({ rec, touchdown: td, damage, outcome, crashReason, windSpeed }: ScoreInput): ScoreResult {
  const cats: CategoryScore[] = [];
  const add = (id: string, label: string, max: number, raw: number, good: string, bad: string) => {
    const score = round1(clamp(raw, 0, max));
    cats.push({ id, label, max, score, note: score >= max * 0.8 ? good : bad });
  };

  // 1. Initial reaction -------------------------------------------------------
  {
    const rt = rec.reactionTime;
    let pts = rt === null ? 0 : rt <= 1 ? 15 : 15 - ((rt - 1) / 3) * 12;
    if (rt !== null && rt > 4) pts = 3;
    if (rec.lowGTime > 0.3) pts -= 5;
    add(
      'reaction',
      'Initial reaction',
      15,
      pts,
      `Collective down in ${rt?.toFixed(1)} s. Quick, decisive entry.`,
      rt === null
        ? 'Collective was never lowered. Lower it immediately after an engine failure to keep rotor RPM.'
        : rec.lowGTime > 0.3
          ? 'Avoid pushing the cyclic forward abruptly at entry. Low-G risks mast bumping.'
          : `Collective took ${rt.toFixed(1)} s to come down. Aim for under 1 s; rotor RPM decays fast.`,
    );
  }

  // 2. Rotor RPM ------------------------------------------------------------
  {
    const frac = rec.rpmTime > 0 ? rec.rpmGreenTime / rec.rpmTime : 0;
    const pts = 20 * frac - 4 * rec.rpmLowTime - 3 * rec.rpmOverTime;
    add(
      'rpm',
      'Rotor RPM management',
      20,
      pts,
      `NR stayed in the green ${Math.round(frac * 100)}% of the descent.`,
      rec.rpmLowTime > 0
        ? `NR fell to ${rec.minRpm.toFixed(0)}%. Lower the collective further to let the airflow drive the rotor.`
        : rec.rpmOverTime > 0
          ? `NR overspeed to ${rec.maxRpm.toFixed(0)}%. Raise the collective slightly to control RPM.`
          : `NR was in the green only ${Math.round(frac * 100)}% of the descent. Use small collective changes to hold 90–110%.`,
    );
  }

  // 3. Airspeed and descent -------------------------------------------------
  {
    const t = Math.max(rec.glideTime, 1e-6);
    const speedFrac = rec.glideTime > 0 ? rec.glideSpeedGoodTime / t : 0;
    const descFrac = rec.glideTime > 0 ? rec.glideDescentGoodTime / t : 0;
    const avg = rec.glideTime > 0 ? rec.sumAirspeed / t : 0;
    add(
      'airspeed',
      'Airspeed & descent',
      15,
      10 * speedFrac + 5 * descFrac,
      `Held a steady ${avg.toFixed(0)} kt glide. Close to the minimum-descent speed.`,
      avg < 50
        ? `Average glide speed ${avg.toFixed(0)} kt is too slow: descent rate climbs and the flare has little energy. Aim for 55–70 kt.`
        : avg > 75
          ? `Average glide speed ${avg.toFixed(0)} kt is too fast: descent rate climbs. Aim for 55–70 kt.`
          : `Airspeed wandered: in the 50–75 kt band only ${Math.round(speedFrac * 100)}% of the glide.`,
    );
  }

  // 4. Landing area ---------------------------------------------------------
  {
    let pts = 0;
    let bad = 'Pick a large, clear field early and fly the glide toward it.';
    if (td?.area) {
      pts = 15 * td.area.quality;
      bad = `${td.area.name} was workable, but ${td.area.id === 'clearing' ? 'rough and full of boulders' : 'narrow, with trees on both sides'}. Big Meadow is the safer choice when it is in reach.`;
    } else if (td && td.surface === 'grass') {
      pts = td.slope < 0.1 ? 4 : 1;
      bad = 'Landed on unprepared terrain. A prepared field would have given more margin.';
    } else if (td?.surface === 'water') {
      bad = 'Landed in the lake. Pick a field in gliding range instead.';
    } else if (!td) {
      bad = 'The flight ended before reaching a landing area.';
    }
    add('area', 'Landing-area selection', 15, pts, td?.area ? `Chose ${td.area.name}: ${td.area.description.toLowerCase()}` : '', bad);
  }

  // 5. Approach & flare -----------------------------------------------------
  {
    const flarePitch = rec.maxFlarePitch;
    const flareStrength = clamp((flarePitch - 3) / 7, 0, 1) * 5;
    const fh = rec.flareStartAgl;
    const heightPts = fh === null ? 0 : fh >= 8 && fh <= 30 ? 3 : fh > 30 ? clamp(3 - (fh - 30) / 6, 0, 3) : clamp(fh / 8, 0, 1) * 3;
    const levelPts = td && td.pitch / DEG >= -3 && td.pitch / DEG <= 10 ? 2 : 0;
    const cushion = rec.collectiveLow4m !== null && rec.collectiveAtTouchdown - rec.collectiveLow4m >= 0.12 ? 2 : 0;
    const windPts = windSpeed < 1.5 ? 3 : td ? clamp((td.headwind / windSpeed + 0.2) / 1.0, 0, 1) * 3 : 0;
    let bad: string;
    if (fh === null) bad = 'No flare. Pull the cyclic back at about 40–80 ft to trade airspeed for a slower descent.';
    else if (fh > 30) bad = `Flare started high (${Math.round(fh * 3.28)} ft). The helicopter ran out of energy before the ground.`;
    else if (fh < 8) bad = `Flare started late (${Math.round(fh * 3.28)} ft). Begin around 40–80 ft.`;
    else if (!levelPts) bad = 'Level the skids just before touchdown to avoid a tail strike or digging in the toes.';
    else if (!cushion) bad = 'Raise the collective in the last few feet to cushion the touchdown with rotor energy.';
    else bad = 'Land into the wind to cut your ground speed at touchdown.';
    add('flare', 'Approach & flare', 15, flareStrength + heightPts + levelPts + cushion + windPts, 'Well-timed flare, levelled and cushioned with collective.', bad);
  }

  // 6. Touchdown & damage ---------------------------------------------------
  {
    const pts = outcome === 'crash' ? 0 : 20 * (1 - damage / 60);
    const worst = td?.damageReasons[0]?.text ?? crashReason ?? 'No touchdown recorded.';
    add('touchdown', 'Touchdown & damage', 20, pts, td && damage < 1 ? 'Smooth touchdown with no damage.' : `Light damage only: ${worst.toLowerCase()}.`, crashReason ?? worst + '.');
  }

  let total = round1(cats.reduce((t, c) => t + c.score, 0));
  if (outcome === 'crash') total = Math.min(total, 45);
  else if (outcome === 'damaged') total = Math.min(total, 75);

  const strengths = cats.filter((c) => c.score >= c.max * 0.8 && c.note).map((c) => c.note);
  const improvements = cats
    .filter((c) => c.score < c.max * 0.8)
    .sort((a, b) => b.max - b.score - (a.max - a.score))
    .map((c) => c.note);
  return { total: Math.round(total), outcome, categories: cats, strengths, improvements };
}
