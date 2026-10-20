import { clamp, lerp, smoothstep } from '../sim/vec';
import { fbm, mulberry32 } from './rng';

export type Surface = 'grass' | 'field' | 'strip' | 'rough' | 'water';

export interface LandingArea {
  id: string;
  name: string;
  description: string;
  cx: number;
  cz: number;
  halfWidth: number; // along local X
  halfLength: number; // along local Z
  rotation: number; // rad about Y
  surface: Exclude<Surface, 'grass' | 'water'>;
  /** 0..1, how suitable the area is for a forced landing (used for scoring). */
  quality: number;
  elevation: number;
}

export type ObstacleKind = 'tree' | 'rock' | 'building';

export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  z: number;
  radius: number;
  base: number; // ground elevation
  height: number; // above base
  /** Visual-only extras. */
  w?: number;
  d?: number;
  rot?: number;
  variant?: number;
}

export interface World {
  size: number;
  cells: number;
  heights: Float32Array;
  waterLevel: number;
  areas: LandingArea[];
  obstacles: Obstacle[];
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): Surface;
  areaAt(x: number, z: number, margin?: number): LandingArea | undefined;
  /** Terrain slope (rise/run) at a point. */
  slopeAt(x: number, z: number): number;
  obstaclesNear(x: number, z: number, radius: number): Obstacle[];
}

const SEED = 1964;
const SIZE = 3200;
const CELLS = 160; // 20 m grid
export const LAKE = { x: 60, z: 260, r: 210 };

export const AREA_DEFS: Omit<LandingArea, 'elevation'>[] = [
  {
    id: 'meadow',
    name: 'Big Meadow',
    description: 'Large, flat, mown field. Best choice.',
    cx: -380,
    cz: 360,
    halfWidth: 95,
    halfLength: 70,
    rotation: 0.25,
    surface: 'field',
    quality: 1,
  },
  {
    id: 'strip',
    name: 'Farm Strip',
    description: 'Narrow dirt strip lined with tall trees.',
    cx: 400,
    cz: 470,
    halfWidth: 13,
    halfLength: 120,
    rotation: -0.05,
    surface: 'strip',
    quality: 0.75,
  },
  {
    id: 'clearing',
    name: 'Rocky Clearing',
    description: 'Close, but rough ground and boulders.',
    cx: 110,
    cz: 840,
    halfWidth: 38,
    halfLength: 32,
    rotation: 0.6,
    surface: 'rough',
    quality: 0.4,
  },
];

function baseHeight(x: number, z: number): number {
  const hills = (fbm(x / 650, z / 650, SEED, 4) - 0.5) * 80;
  const detail = (fbm(x / 140, z / 140, SEED + 7, 3) - 0.5) * 10;
  const r = Math.hypot(x, z);
  const rim = Math.max(0, r - 1150) * 0.35 * (0.6 + fbm(x / 300, z / 300, SEED + 3, 2));
  return hills + detail + rim;
}

function localCoords(a: Pick<LandingArea, 'cx' | 'cz' | 'rotation'>, x: number, z: number) {
  const dx = x - a.cx, dz = z - a.cz;
  const c = Math.cos(a.rotation), s = Math.sin(a.rotation);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

/** Distance outside the area rectangle (0 when inside). */
function rectDistance(a: LandingArea, x: number, z: number): number {
  const { lx, lz } = localCoords(a, x, z);
  const ox = Math.max(0, Math.abs(lx) - a.halfWidth);
  const oz = Math.max(0, Math.abs(lz) - a.halfLength);
  return Math.hypot(ox, oz);
}

export function createWorld(): World {
  const areas: LandingArea[] = AREA_DEFS.map((d) => ({ ...d, elevation: baseHeight(d.cx, d.cz) }));
  const lakeElev = baseHeight(LAKE.x, LAKE.z);
  const waterLevel = lakeElev - 3;

  const n = CELLS + 1;
  const cell = SIZE / CELLS;
  const half = SIZE / 2;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * cell, z = -half + j * cell;
      let h = baseHeight(x, z);
      const lr = Math.hypot(x - LAKE.x, z - LAKE.z);
      h = lerp(h, lakeElev - 10, 1 - smoothstep(LAKE.r * 0.55, LAKE.r * 1.15, lr));
      for (const a of areas) h = lerp(h, a.elevation, 1 - smoothstep(12, 70, rectDistance(a, x, z)));
      heights[j * n + i] = h;
    }
  }

  // Interpolates exactly like the rendered triangle mesh (diagonal from (i+1,j) to (i,j+1)).
  const heightAt = (x: number, z: number): number => {
    const gx = clamp((x + half) / cell, 0, CELLS - 1e-6);
    const gz = clamp((z + half) / cell, 0, CELLS - 1e-6);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h00 = heights[j * n + i], h10 = heights[j * n + i + 1];
    const h01 = heights[(j + 1) * n + i], h11 = heights[(j + 1) * n + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  };

  const areaAt = (x: number, z: number, margin = 0) => areas.find((a) => rectDistance(a, x, z) <= margin);

  const surfaceAt = (x: number, z: number): Surface => {
    const a = areaAt(x, z);
    if (a) return a.surface;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.15 && heightAt(x, z) < waterLevel) return 'water';
    return 'grass';
  };

  const slopeAt = (x: number, z: number): number => {
    const e = 2;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  };

  const obstacles = placeObstacles(areas, heightAt, surfaceAt, slopeAt);

  // Spatial hash for collision queries.
  const BUCKET = 40;
  const buckets = new Map<number, Obstacle[]>();
  const key = (bx: number, bz: number) => (bx + 1000) * 4096 + (bz + 1000);
  for (const o of obstacles) {
    const k = key(Math.floor(o.x / BUCKET), Math.floor(o.z / BUCKET));
    let list = buckets.get(k);
    if (!list) buckets.set(k, (list = []));
    list.push(o);
  }
  const obstaclesNear = (x: number, z: number, radius: number): Obstacle[] => {
    const out: Obstacle[] = [];
    const r = radius + 12; // max obstacle radius
    for (let bx = Math.floor((x - r) / BUCKET); bx <= Math.floor((x + r) / BUCKET); bx++) {
      for (let bz = Math.floor((z - r) / BUCKET); bz <= Math.floor((z + r) / BUCKET); bz++) {
        const list = buckets.get(key(bx, bz));
        if (!list) continue;
        for (const o of list) if (Math.hypot(o.x - x, o.z - z) <= radius + o.radius) out.push(o);
      }
    }
    return out;
  };

  return { size: SIZE, cells: CELLS, heights, waterLevel, areas, obstacles, heightAt, surfaceAt, areaAt, slopeAt, obstaclesNear };
}

function placeObstacles(
  areas: LandingArea[],
  heightAt: (x: number, z: number) => number,
  surfaceAt: (x: number, z: number) => Surface,
  slopeAt: (x: number, z: number) => number,
): Obstacle[] {
  const rnd = mulberry32(SEED * 7 + 1);
  const out: Obstacle[] = [];
  const nearArea = (x: number, z: number, m: number) => areas.some((a) => rectDistance(a, x, z) < m);
  const tree = (x: number, z: number, h: number) =>
    out.push({ kind: 'tree', x, z, radius: h * 0.2, base: heightAt(x, z), height: h, variant: rnd() < 0.3 ? 1 : 0 });

  // Forest patches from noise.
  const step = 15;
  for (let z = -1400; z <= 1400; z += step) {
    for (let x = -1400; x <= 1400; x += step) {
      const jx = x + (rnd() - 0.5) * step, jz = z + (rnd() - 0.5) * step;
      const density = fbm(jx / 260, jz / 260, SEED + 99, 3);
      const r = rnd();
      if (density < 0.5 || r > (density - 0.5) * 3.2) continue;
      if (Math.hypot(jx, jz - 1100) < 60) continue; // keep start point open
      if (nearArea(jx, jz, 10) || surfaceAt(jx, jz) === 'water' || slopeAt(jx, jz) > 0.6) continue;
      tree(jx, jz, 9 + rnd() * 9);
    }
  }

  // Tree lines along the farm strip make it a precision landing.
  const strip = areas.find((a) => a.id === 'strip')!;
  for (const side of [-1, 1]) {
    for (let l = -strip.halfLength - 20; l <= strip.halfLength + 20; l += 9) {
      const lx = side * (strip.halfWidth + 6 + rnd() * 3);
      const c = Math.cos(strip.rotation), s = Math.sin(strip.rotation);
      const x = strip.cx + lx * c + l * s, z = strip.cz - lx * s + l * c;
      tree(x, z, 14 + rnd() * 5);
    }
  }

  // Boulders inside the rocky clearing.
  const clearing = areas.find((a) => a.id === 'clearing')!;
  for (let k = 0; k < 26; k++) {
    const lx = (rnd() * 2 - 1) * clearing.halfWidth, lz = (rnd() * 2 - 1) * clearing.halfLength;
    const c = Math.cos(clearing.rotation), s = Math.sin(clearing.rotation);
    const x = clearing.cx + lx * c + lz * s, z = clearing.cz - lx * s + lz * c;
    const r = 0.7 + rnd() * 1.4;
    out.push({ kind: 'rock', x, z, radius: r, base: heightAt(x, z), height: r * 1.1, variant: Math.floor(rnd() * 3) });
  }

  // Farm buildings north of the strip.
  const building = (x: number, z: number, w: number, d: number, h: number, rot: number) =>
    out.push({ kind: 'building', x, z, radius: Math.hypot(w, d) / 2, base: heightAt(x, z), height: h, w, d, rot });
  building(430, 315, 16, 10, 9, 0.1);
  building(372, 300, 10, 8, 6, -0.2);
  building(-250, 470, 8, 6, 5, 0.25); // shed at the meadow edge

  return out;
}
