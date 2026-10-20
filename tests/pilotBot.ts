import { ControlInputs, HelicopterState } from '../src/sim/state';
import { DEG, clamp } from '../src/sim/vec';
import { SIM_DT } from '../src/sim/flightModel';

/** Scripted test pilot used only by tests to exercise the model. Not used in the game. */
export interface BotOptions {
  reactionDelay?: number; // s after failure before lowering collective
  lowerCollective?: boolean;
  targetSpeed?: number; // m/s
  flareHeight?: number; // m AGL to start flare (0 = no flare)
  flarePitch?: number; // rad
  cushion?: boolean;
  rpmTarget?: number;
}

export function makeBot(o: BotOptions = {}) {
  const opt = { reactionDelay: 0.6, lowerCollective: true, targetSpeed: 29, flareHeight: 20, flarePitch: 15 * DEG, cushion: true, rpmTarget: 100, ...o };
  let phase: 'cruise' | 'react' | 'auto' | 'flare' | 'level' = 'cruise';
  let failT = -1;
  let integ = Number.NaN;
  return (s: HelicopterState, c: ControlInputs): string => {
    if (!s.engineRunning && failT < 0) { failT = s.time; phase = 'react'; }
    if (Number.isNaN(integ)) integ = s.pitch;
    const pitchTo = (target: number, gain = 6) => { c.cyclicPitch = clamp((target - s.pitchCmd) * gain, -1, 1); };
    if (phase === 'react' && s.time - failT >= opt.reactionDelay) phase = 'auto';
    if (phase === 'auto') {
      if (opt.lowerCollective) {
        const target = clamp(0.1 + (s.rpmPct - opt.rpmTarget) * 0.015, 0, 1);
        c.collective += clamp(target - c.collective, -1.2 * SIM_DT, 1.2 * SIM_DT);
      }
      const e = opt.targetSpeed - s.airspeed;
      integ = clamp(integ - 0.00004 * e, -0.4, 0.3);
      pitchTo(clamp(integ - 0.02 * e, -15 * DEG, 10 * DEG));
      if (opt.flareHeight > 0 && s.agl < opt.flareHeight) phase = 'flare';
    } else if (phase === 'flare') {
      // Hold the flare, but stop pulling once the descent is arrested (avoid ballooning).
      pitchTo(s.verticalSpeed > 0 ? Math.min(s.pitchCmd, 10 * DEG) : opt.flarePitch);
      if (s.agl < 3 || s.groundSpeed < 9) phase = 'level';
    } else if (phase === 'level') {
      pitchTo(3 * DEG);
      if (opt.cushion && s.agl < 1.8) {
        // Cushion: raise collective while sinking, ease off if it starts to climb.
        c.collective = clamp(c.collective + SIM_DT * (s.verticalSpeed < -0.3 ? 1.0 : -1.0), 0, 1);
      }
    }
    return phase;
  };
}
