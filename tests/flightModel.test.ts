import { describe, expect, it } from 'vitest';
import { SIM_DT, failEngine, stepFlight, trimmedState } from '../src/sim/flightModel';
import { HelicopterState } from '../src/sim/state';
import { DEG, clamp, v3 } from '../src/sim/vec';
import { FixedStepper } from '../src/game/fixedStep';

const env = { wind: v3(0, 0, 0), groundHeight: () => -1e5 };
const cruise = (kt = 70) => trimmedState({ x: 0, y: 3000, z: 0, yaw: 0, airspeed: kt / 1.944, wind: env.wind });

/** Fly with a fixed collective, holding airspeed through the attitude command. */
function glide(s: HelicopterState, collective: number, speed: number, seconds: number) {
  let integ = s.pitch;
  const c = { collective, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 };
  for (let t = 0; t < seconds; t += SIM_DT) {
    const e = speed - s.airspeed;
    integ = clamp(integ - 0.00004 * e, -0.4, 0.3);
    s.pitchCmd = clamp(integ - 0.02 * e, -0.5, 0.4);
    stepFlight(s, c, env);
  }
}

describe('flight model cause and effect', () => {
  it('trimmed cruise is steady with the engine running', () => {
    const s = cruise();
    const c = { collective: s.collective, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 };
    for (let i = 0; i < 120 * 10; i++) stepFlight(s, c, env);
    expect(Math.abs(s.verticalSpeed)).toBeLessThan(0.5);
    expect(s.rpmPct).toBeGreaterThan(99);
  });

  it('rotor RPM decays after failure when the collective is not lowered', () => {
    const s = cruise();
    failEngine(s);
    const c = { collective: s.collective, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 };
    for (let i = 0; i < 120 * 2; i++) stepFlight(s, c, env);
    expect(s.rpmPct).toBeLessThan(93);
  });

  it('lowering the collective preserves RPM; lower collective means higher RPM', () => {
    const rpmAt = (col: number) => {
      const s = cruise();
      failEngine(s);
      glide(s, col, 30, 60);
      return s.rpmPct;
    };
    const [r0, r1, r2] = [rpmAt(0), rpmAt(0.1), rpmAt(0.2)];
    expect(r0).toBeGreaterThan(r1);
    expect(r1).toBeGreaterThan(r2);
    expect(r1).toBeGreaterThan(92);
    expect(r1).toBeLessThan(108);
  });

  it('descent rate depends on airspeed with a minimum near 50 kt', () => {
    const vsAt = (kt: number) => {
      const s = cruise();
      failEngine(s);
      glide(s, 0.1, kt / 1.944, 60);
      return -s.verticalSpeed;
    };
    const slow = vsAt(10), best = vsAt(50), fast = vsAt(95);
    expect(best).toBeLessThan(slow * 0.8);
    expect(best).toBeLessThan(fast * 0.8);
  });

  it('a flare raises rotor RPM and arrests the descent', () => {
    const s = cruise(60);
    failEngine(s);
    glide(s, 0.1, 30, 30);
    const vs0 = s.verticalSpeed, rpm0 = s.rpmPct;
    const c = { collective: 0.1, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 };
    let maxRpm = 0;
    for (let i = 0; i < 120 * 2.5; i++) {
      c.cyclicPitch = clamp((18 * DEG - s.pitchCmd) * 6, -1, 1);
      stepFlight(s, c, env);
      maxRpm = Math.max(maxRpm, s.rpmPct);
    }
    expect(s.verticalSpeed).toBeGreaterThan(vs0 + 5);
    expect(maxRpm).toBeGreaterThan(rpm0 + 4);
  });

  it('simulation result does not depend on frame rate', () => {
    const run = (fps: number) => {
      const s = cruise();
      const stepper = new FixedStepper();
      const c = { collective: 0.2, cyclicPitch: 0.3, cyclicRoll: -0.2, pedal: 0 };
      failEngine(s);
      for (let f = 0; f < fps * 6; f++) for (let n = stepper.advance(1 / fps); n > 0; n--) stepFlight(s, c, env);
      return s;
    };
    const a = run(30), b = run(144);
    expect(b.pos.x).toBeCloseTo(a.pos.x, 6);
    expect(b.pos.y).toBeCloseTo(a.pos.y, 6);
    expect(b.omega).toBeCloseTo(a.omega, 6);
  });
});

describe('engine running: power limit and governor', () => {
  it('full collective climbs at the power limit without drooping the rotor', () => {
    const s = cruise();
    glide(s, 1, 33, 60);
    expect(s.rpmPct).toBeGreaterThan(97);
    expect(s.verticalSpeed).toBeGreaterThan(5);
    expect(s.enginePower).toBeLessThanOrEqual(190_000);
  });

  it('more collective never means less climb', () => {
    const climb = (coll: number) => {
      const s = cruise();
      glide(s, coll, 33, 20);
      return s.verticalSpeed;
    };
    expect(climb(1)).toBeGreaterThanOrEqual(climb(0.75) - 0.2);
  });

  it('the governor holds the rotor in the green in a powered descent with the collective down', () => {
    const s = cruise();
    let maxRpm = 0;
    const c = { collective: 0, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 };
    for (let t = 0; t < 60; t += SIM_DT) {
      s.pitchCmd = -0.05;
      stepFlight(s, c, env);
      maxRpm = Math.max(maxRpm, s.rpmPct);
    }
    expect(s.verticalSpeed).toBeLessThan(-5);
    expect(maxRpm).toBeLessThanOrEqual(108);
  });

  it('after a failure the rotor still overspeeds with the collective down (no governor)', () => {
    const s = cruise();
    failEngine(s);
    const c = { collective: 0, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 };
    for (let t = 0; t < 30; t += SIM_DT) {
      s.pitchCmd = -0.05;
      stepFlight(s, c, env);
    }
    expect(s.rpmPct).toBeGreaterThan(112);
  });
});
