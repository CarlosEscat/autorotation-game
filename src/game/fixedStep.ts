import { SIM_DT } from '../sim/flightModel';

/**
 * Converts variable frame times into a whole number of fixed simulation steps,
 * so flight behaviour does not depend on the display's frame rate.
 */
export class FixedStepper {
  private acc = 0;
  constructor(
    readonly dt = SIM_DT,
    readonly maxStepsPerFrame = 30,
  ) {}

  /** Returns how many fixed steps to run for a frame that took `frameSeconds`. */
  advance(frameSeconds: number): number {
    this.acc += Math.min(Math.max(frameSeconds, 0), this.dt * this.maxStepsPerFrame);
    const n = Math.floor(this.acc / this.dt + 1e-9);
    this.acc -= n * this.dt;
    return n;
  }

  reset() {
    this.acc = 0;
  }
}
