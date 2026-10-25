import { clamp, lerp, smoothstep } from '../sim/vec';
import { fbm, mulberry32 } from './rng';

export type Surface = 'grass' | 'field' | 'strip' | 'paved' | 'rough' | 'water';

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
  /** A deck on legs this high above the lake, instead of levelled ground. */
  deckHeight?: number;
}

export type ObstacleKind = 'tree' | 'rock' | 'building' | 'tower';

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
/**
 * Lookout Hill, in the forest east of the airport: a round hill `height` m above the land around it,
 * flat within `top` m of the summit and blending into the ground by `foot` m out.
 */
export const HILL = { x: 240, z: -650, height: 60, top: 22, foot: 230 };

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
    id: 'runway',
    name: 'Airport Runway',
    description: 'Long paved runway north of the lake, aligned north–south.',
    cx: -180,
    cz: -550,
    halfWidth: 15,
    halfLength: 375,
    rotation: 0,
    surface: 'paved',
    quality: 1,
  },
  {
    id: 'helipad',
    name: 'Lake Helipad',
    description: 'Small deck on legs in the middle of the lake. Precision required.',
    cx: LAKE.x,
    cz: LAKE.z,
    halfWidth: 12,
    halfLength: 12,
    rotation: 0,
    surface: 'paved',
    quality: 0.8,
    deckHeight: 3,
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

/** How far Lookout Hill raises the ground at a point. */
function hillRise(x: number, z: number): number {
  return HILL.height * (1 - smoothstep(HILL.top, HILL.foot, Math.hypot(x - HILL.x, z - HILL.z)));
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

/** Areas added after the forests were laid out; trees are placed as if they were not there. */
const LATER_AREAS = new Set(['runway', 'helipad']);

const waterLevelAt = () => baseHeight(LAKE.x, LAKE.z) - 3;

export function createWorld(): World {
  // Each field sits at the average height of the land around it, so it is flush with its
  // surroundings rather than in a bowl or on a mound.
  const surroundings = (cx: number, cz: number) => {
    let sum = 0, count = 0;
    for (let dz = -200; dz <= 200; dz += 50) for (let dx = -200; dx <= 200; dx += 50) (sum += baseHeight(cx + dx, cz + dz)), count++;
    return sum / count;
  };
  const areas: LandingArea[] = AREA_DEFS.map((d) => ({ ...d, elevation: d.deckHeight === undefined ? surroundings(d.cx, d.cz) : waterLevelAt() + d.deckHeight }));
  const { heights, waterLevel, heightAt, areaAt, surfaceAt, slopeAt } = buildTerrain(areas);

  // Lay the forests out on the terrain as it was before the airport, so every tree, boulder
  // and random choice elsewhere stays exactly where it was. Then sit them on today's ground
  // and clear the airport.
  const early = areas.filter((a) => !LATER_AREAS.has(a.id));
  // Lookout Hill came later too: its forest keeps its place and rides up the slopes, with the summit cleared.
  const before = buildTerrain(early, false);
  const obstacles = placeObstacles(early, before.heightAt, before.surfaceAt, before.slopeAt)
    .map((o) => ({ ...o, base: heightAt(o.x, o.z) }))
    .filter((o) => !areas.some((a) => LATER_AREAS.has(a.id) && a.deckHeight === undefined && inClearZone(a, o.x, o.z)))
    .filter((o) => Math.hypot(o.x - HILL.x, o.z - HILL.z) > HILL.top + 20);
  obstacles.push(...airportBuildings(areas.find((a) => a.id === 'runway')!, heightAt));

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

/** No trees beside a runway or under its approaches. */
function inClearZone(a: LandingArea, x: number, z: number): boolean {
  const { lx, lz } = localCoords(a, x, z);
  return Math.abs(lx) < a.halfWidth + 60 && Math.abs(lz) < a.halfLength + 250;
}

/** Control tower west of the runway, beside its midpoint. */
function airportBuildings(rwy: LandingArea, heightAt: (x: number, z: number) => number): Obstacle[] {
  const x = rwy.cx - rwy.halfWidth - 70, z = rwy.cz + 60;
  return [{ kind: 'tower', x, z, radius: 5, base: heightAt(x, z), height: 24, w: 6, d: 6, rot: 0 }];
}

/** Height field for the given landing areas, plus the queries that depend on it. */
function buildTerrain(areas: LandingArea[], withHill = true) {
  const lakeElev = baseHeight(LAKE.x, LAKE.z);
  const waterLevel = waterLevelAt();
  const ground = areas.filter((a) => a.deckHeight === undefined);
  const decks = areas.filter((a) => a.deckHeight !== undefined);

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
      // Blend the ground to each field's level over ~180 m so approaches are gentle slopes, not drop-offs.
      for (const a of ground) h = lerp(h, a.elevation, 1 - smoothstep(12, 180, rectDistance(a, x, z)));
      if (withHill) h += hillRise(x, z);
      heights[j * n + i] = h;
    }
  }

  // Interpolates exactly like the rendered triangle mesh (diagonal from (i+1,j) to (i,j+1)).
  const terrainAt = (x: number, z: number): number => {
    const gx = clamp((x + half) / cell, 0, CELLS - 1e-6);
    const gz = clamp((z + half) / cell, 0, CELLS - 1e-6);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h00 = heights[j * n + i], h10 = heights[j * n + i + 1];
    const h01 = heights[(j + 1) * n + i], h11 = heights[(j + 1) * n + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  };
  // Over a deck, the "ground" is the deck surface.
  const heightAt = (x: number, z: number): number => {
    for (const d of decks) if (rectDistance(d, x, z) === 0) return d.elevation;
    return terrainAt(x, z);
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

  return { heights, waterLevel, heightAt, areaAt, surfaceAt, slopeAt };
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
