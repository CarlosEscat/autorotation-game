/** One burning patch of ground. `heat` runs from 1 (fully alight) down to 0 (out, for good). */
export interface FireCell {
  x: number;
  z: number;
  heat: number;
}

export interface FireSpec {
  /** Where the fire burns: one entry per patch. */
  cells: { x: number; z: number }[];
  /** Water (kg) that puts out one patch when it lands right on it. */
  waterPerCell: number;
}

/** Water landing within this distance of a patch cools it, most at the centre and nothing at the edge. */
export const SPLASH_RADIUS = 12;
/** A patch that was wetted but not put out flares back up at this rate (heat per second). */
export const REKINDLE_RATE = 0.03;
/** Dropped from above this height (m) the water starts to drift apart; by the second height none of it counts. */
export const DROP_FULL_HEIGHT = 40;
export const DROP_MAX_HEIGHT = 90;

/** Share of a drop that still arrives as a solid slug when released `height` m above the ground. */
export const dropEffect = (height: number) => Math.min(1, Math.max(0, (DROP_MAX_HEIGHT - height) / (DROP_MAX_HEIGHT - DROP_FULL_HEIGHT)));

/**
 * How water released from a moving helicopter reaches the ground: seconds of fall from `height` m,
 * and how far it carries forward as a share of the horizontal speed (m per m/s). It leaves at 4 m/s
 * downward, speeds up to 22 m/s, and the air slows its forward travel. The spray is drawn the same way.
 */
export function waterFall(height: number): { time: number; carry: number } {
  const h = Math.max(0, height);
  const tTerminal = (22 - 4) / 9.81;
  const hTerminal = 4 * tTerminal + 0.5 * 9.81 * tTerminal ** 2;
  const time = h < hTerminal ? (-4 + Math.sqrt(16 + 2 * 9.81 * h)) / 9.81 : tTerminal + (h - hTerminal) / 22;
  return { time, carry: (1 - Math.exp(-0.9 * time)) / 0.9 };
}

/** A fire being fought: tracks each patch, the water still in the air, and how much is left burning. */
export class Fire {
  readonly cells: FireCell[];
  private falling: { x: number; z: number; at: number; kg: number }[] = [];

  constructor(readonly spec: FireSpec) {
    this.cells = spec.cells.map((c) => ({ ...c, heat: 1 }));
  }

  /** Water released now that will land at (x, z) at time `at`. */
  release(x: number, z: number, at: number, kg: number) {
    if (kg > 0) this.falling.push({ x, z, at, kg });
  }

  /** Lands the water that is due and lets wetted patches flare back up. */
  step(time: number, dt: number) {
    while (this.falling.length && this.falling[0].at <= time) {
      const w = this.falling.shift()!;
      for (const c of this.cells) {
        if (c.heat <= 0) continue;
        const d = Math.hypot(c.x - w.x, c.z - w.z);
        if (d < SPLASH_RADIUS) c.heat = Math.max(0, c.heat - (w.kg * (1 - d / SPLASH_RADIUS)) / this.spec.waterPerCell);
      }
    }
    for (const c of this.cells) if (c.heat > 0 && c.heat < 1) c.heat = Math.min(1, c.heat + REKINDLE_RATE * dt);
  }

  /** Patches still burning. */
  get burning(): number {
    return this.cells.filter((c) => c.heat > 0).length;
  }

  /** How much of the fire is out, 0..1, counting partly cooled patches. */
  get progress(): number {
    return 1 - this.cells.reduce((t, c) => t + c.heat, 0) / this.cells.length;
  }

  get out(): boolean {
    return this.burning === 0;
  }

  /** The hottest patch still burning nearest to (x, z), or null when the fire is out. */
  nearestBurning(x: number, z: number): FireCell | null {
    let best: FireCell | null = null, bd = Infinity;
    for (const c of this.cells) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (c.heat > 0 && d < bd) (best = c), (bd = d);
    }
    return best;
  }
}

/** Patches on a staggered grid, `spacing` m apart, filling an ellipse centred on (x, z) and turned by `rotation`. */
export function fireCells(x: number, z: number, halfLength: number, halfWidth: number, spacing: number, rotation = 0): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const row = spacing * 0.866;
  const rows = Math.ceil(halfWidth / row);
  for (let j = -rows; j <= rows; j++) {
    const off = j % 2 ? spacing / 2 : 0;
    for (let i = -Math.ceil(halfLength / spacing) - 1; i <= Math.ceil(halfLength / spacing) + 1; i++) {
      const a = i * spacing + off, b = j * row;
      if ((a / halfLength) ** 2 + (b / halfWidth) ** 2 > 1) continue;
      out.push({ x: x + a * Math.cos(rotation) - b * Math.sin(rotation), z: z + a * Math.sin(rotation) + b * Math.cos(rotation) });
    }
  }
  return out;
}
