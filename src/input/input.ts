import { ControlInputs } from '../sim/state';
import { clamp } from '../sim/vec';

export type Action = 'cycleTarget' | 'camera' | 'pause' | 'restart' | 'mute' | 'confirm';

/**
 * Single source of pilot inputs. Keyboard and touch controls both write here,
 * and the game reads one `ControlInputs` per simulation step, so both devices
 * drive exactly the same flight model.
 */
export class InputManager {
  readonly controls: ControlInputs = { collective: 0.4, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 };
  /** Which device was used last; the HUD uses it to word hints. */
  mode: 'keyboard' | 'touch' = 'keyboard';

  // Keyboard targets (-1, 0, 1) and smoothed values
  keyPitch = 0;
  keyRoll = 0;
  keyPedal = 0;
  keyCollective = 0; // -1 lowering, +1 raising
  private smPitch = 0;
  private smRoll = 0;
  private smPedal = 0;

  // Touch values (already analog)
  touchActive = false;
  touchPitch = 0;
  touchRoll = 0;
  touchPedal = 0;
  /** Set when a touch slider moved the collective directly. */
  touchCollective: number | null = null;

  /** Head-look offsets (rad), set by dragging on the view. */
  lookYaw = 0;
  lookPitch = 0;
  looking = false;

  private listeners = new Map<Action, Array<() => void>>();

  on(action: Action, cb: () => void) {
    const list = this.listeners.get(action) ?? [];
    list.push(cb);
    this.listeners.set(action, list);
  }

  emit(action: Action) {
    for (const cb of this.listeners.get(action) ?? []) cb();
  }

  /** Reset to the given collective (start of a flight). */
  reset(collective: number) {
    this.controls.collective = collective;
    this.controls.cyclicPitch = this.controls.cyclicRoll = this.controls.pedal = 0;
    this.smPitch = this.smRoll = this.smPedal = 0;
    this.touchCollective = null;
    this.lookYaw = this.lookPitch = 0;
  }

  /** Called once per simulation step. */
  update(dt: number) {
    const c = this.controls;
    // Keys ramp in over ~0.25 s so taps give small inputs and holds give full ones.
    const ramp = (cur: number, target: number) => {
      const rate = target === 0 ? 10 : 4;
      return cur + clamp(target - cur, -rate * dt, rate * dt);
    };
    this.smPitch = ramp(this.smPitch, this.keyPitch);
    this.smRoll = ramp(this.smRoll, this.keyRoll);
    this.smPedal = ramp(this.smPedal, this.keyPedal);

    if (this.touchCollective !== null) {
      c.collective = this.touchCollective;
      this.touchCollective = null;
    }
    if (this.keyCollective !== 0) c.collective = clamp(c.collective + this.keyCollective * 0.75 * dt, 0, 1);

    const touch = this.touchActive;
    c.cyclicPitch = clamp(touch ? this.touchPitch : this.smPitch, -1, 1);
    c.cyclicRoll = clamp(touch ? this.touchRoll : this.smRoll, -1, 1);
    c.pedal = clamp(this.touchPedal !== 0 ? this.touchPedal : this.smPedal, -1, 1);

    if (!this.looking) {
      this.lookYaw *= Math.exp(-dt * 3);
      this.lookPitch *= Math.exp(-dt * 3);
    }
  }
}
