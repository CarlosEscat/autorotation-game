import * as THREE from 'three';
import { LAKE, LandingArea, World } from '../world/world';
import { fbm, valueNoise } from '../world/rng';
import { PavedPatch, pavedPatches } from './airportLayout';
import { withSurfaceDetail } from './surfaceDetail';

/**
 * The ground: a smooth-shaded mesh on exactly the collision surface, painted with a ground map baked once at
 * start-up (colour, soft field and shore edges, slope rock, ambient occlusion under forests and in hollows),
 * a tiling detail texture for close range, the lake, and scenery mountains beyond the edge of the world.
 */

const C = (hex: number) => new THREE.Color(hex);
// Two grass tones blended by low-frequency noise, then tinted by altitude and distance from the centre.
const GRASS_A = C(0x4f9450), GRASS_B = C(0x8cb85a);
const LOWLAND = C(0xc2bd6a), HIGHLAND = C(0x3f6b5e), DISTANT = C(0x7d8a68);
const ROCK = C(0x9b9679), SAND = C(0xcdb27c), WET_SAND = C(0xb09c74), LAKE_BED = C(0x6c7656);
const MEADOW_DRY = C(0xa7b45e), MEADOW_LUSH = C(0x3f8446);
const PAVING: Record<PavedPatch['surface'], [THREE.Color, THREE.Color]> = {
  asphalt: [C(0x55544f), C(0x63615b)],
  concrete: [C(0x9a978d), C(0xaaa69b)],
  gravel: [C(0x8b8574), C(0x9d9682)],
};
const SURFACE: Record<LandingArea['surface'], [THREE.Color, THREE.Color]> = {
  field: [C(0x76aa4e), C(0x8cbb5e)], // mow stripes
  strip: [C(0xa1875f), C(0xb39a72)],
  paved: [C(0x707068), C(0x7a7870)],
  rough: [C(0x8d8766), C(0xa09678)],
};

/** Ground-map texels per side: about 3 m each on desktop, 6 m on touch devices. */
export function groundMapSize(): number {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 512 : 1024;
}

/** Signed distance from an area's rectangle (negative inside) and the position along its width. */
function areaFrame(a: LandingArea, x: number, z: number) {
  const dx = x - a.cx, dz = z - a.cz, c = Math.cos(a.rotation), s = Math.sin(a.rotation);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const ox = Math.abs(lx) - a.halfWidth, oz = Math.abs(lz) - a.halfLength;
  const outside = Math.hypot(Math.max(0, ox), Math.max(0, oz));
  return { d: outside > 0 ? outside : Math.max(ox, oz), lx };
}

/**
 * Per grid point: height, slope, and hollow occlusion (hollows darker than the land round them, compared with the
 * mean over about 60 m). Sampled bilinearly by the bake, which is far cheaper than querying the world per texel.
 */
function terrainFields(world: World) {
  const n = world.cells + 1, cell = world.size / world.cells, half = world.size / 2, H = world.heights;
  const slope = new Float32Array(n * n), cavity = new Float32Array(n * n);
  const at = (i: number, j: number) => H[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  // Summed-area table for the neighbourhood means.
  const sat = new Float64Array((n + 1) * (n + 1));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) sat[(j + 1) * (n + 1) + i + 1] = H[j * n + i] + sat[j * (n + 1) + i + 1] + sat[(j + 1) * (n + 1) + i] - sat[j * (n + 1) + i];
  const R = 3;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      slope[j * n + i] = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * cell);
      const i0 = Math.max(0, i - R), i1 = Math.min(n - 1, i + R) + 1, j0 = Math.max(0, j - R), j1 = Math.min(n - 1, j + R) + 1;
      const mean = (sat[j1 * (n + 1) + i1] - sat[j0 * (n + 1) + i1] - sat[j1 * (n + 1) + i0] + sat[j0 * (n + 1) + i0]) / ((i1 - i0) * (j1 - j0));
      cavity[j * n + i] = 1 - 0.22 * THREE.MathUtils.smoothstep(mean - H[j * n + i], 0.5, 9);
    }
  }
  const out = { height: 0, slope: 0, cavity: 0 };
  return (x: number, z: number) => {
    const gx = Math.min(n - 1.001, Math.max(0, (x + half) / cell)), gz = Math.min(n - 1.001, Math.max(0, (z + half) / cell));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const k = j * n + i, w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
    const mix = (a: ArrayLike<number>) => a[k] * w00 + a[k + 1] * w10 + a[k + n] * w01 + a[k + n + 1] * w11;
    out.height = mix(H);
    out.slope = mix(slope);
    out.cavity = mix(cavity);
    return out;
  };
}

/** Shade cast by trees and buildings onto the ground below them, as a texel grid (1 = open sky). */
function canopyGrid(world: World, size: number): Float32Array {
  const texel = world.size / size, half = world.size / 2;
  const dens = new Float32Array(size * size);
  const splat = (x: number, z: number, r: number, strength: number) => {
    const ci = (x + half) / texel - 0.5, cj = (z + half) / texel - 0.5, rp = r / texel + 0.75;
    for (let j = Math.max(0, Math.floor(cj - rp)); j <= Math.min(size - 1, Math.ceil(cj + rp)); j++) {
      for (let i = Math.max(0, Math.floor(ci - rp)); i <= Math.min(size - 1, Math.ceil(ci + rp)); i++) {
        const t = 1 - Math.hypot(i - ci, j - cj) / rp;
        if (t > 0) dens[j * size + i] += strength * t;
      }
    }
  };
  for (const o of world.obstacles) {
    if (o.kind === 'tree') splat(o.x, o.z, o.radius * 2.4, 0.7);
    else if (o.kind === 'building' || o.kind === 'tower') splat(o.x, o.z, o.radius * 1.3, 0.9);
    else splat(o.x, o.z, o.radius * 1.4, 0.5);
  }
  // Two box-blur passes soften single trees into pools of shade.
  const tmp = new Float32Array(size * size);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      let s = 0;
      for (let k = -1; k <= 1; k++) s += dens[j * size + Math.min(size - 1, Math.max(0, i + k))];
      tmp[j * size + i] = s / 3;
    }
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      let s = 0;
      for (let k = -1; k <= 1; k++) s += tmp[Math.min(size - 1, Math.max(0, j + k)) * size + i];
      dens[j * size + i] = s / 3;
    }
  }
  for (let k = 0; k < dens.length; k++) dens[k] = 1 - 0.42 * Math.min(1, dens[k]);
  return dens;
}

/** Bakes the ground map into `data` (RGBA, sRGB), yielding between steps so it can run in slices. */
function* bakeSteps(world: World, size: number, data: Uint8Array): Generator<void> {
  const texel = world.size / size, half = world.size / 2;
  const fields = terrainFields(world);
  yield;
  const canopy = canopyGrid(world, size);
  yield;
  const areas = world.areas.filter((a) => a.deckHeight === undefined).map((a) => ({ a, reach: Math.hypot(a.halfWidth, a.halfLength) + 8 }));
  const lakeR = LAKE.r * 1.3, water = world.waterLevel;
  const paved = pavedPatches(world).map((p) => ({ p, reach: Math.hypot(p.hw, p.hl) + 3, cos: Math.cos(p.rot), sin: Math.sin(p.rot) }));
  const grass = new THREE.Color(), c = new THREE.Color(), tmp = new THREE.Color();

  for (let j = 0; j < size; j++) {
    if (j % 16 === 15) yield;
    const z = -half + (j + 0.5) * texel;
    for (let i = 0; i < size; i++) {
      const x = -half + (i + 0.5) * texel;
      const f = fields(x, z), y = f.height;
      const blend = 0.65 * valueNoise(x / 260, z / 260, 5) + 0.35 * valueNoise(x / 90, z / 90, 9);
      grass.copy(GRASS_A).lerp(GRASS_B, THREE.MathUtils.smoothstep(blend, 0.25, 0.75));
      grass.lerp(LOWLAND, 0.25 * (1 - THREE.MathUtils.smoothstep(y, -10, 30)));
      grass.lerp(HIGHLAND, 0.7 * THREE.MathUtils.smoothstep(y, 40, 260));
      // Mid-scale patches of drier and lusher grass, so wide meadows are never one flat green.
      const patch = valueNoise(x / 45, z / 45, 17) * 0.6 + valueNoise(x / 16, z / 16, 19) * 0.4;
      grass.lerp(patch > 0.5 ? MEADOW_DRY : MEADOW_LUSH, 0.32 * Math.abs(patch - 0.5) * 2);
      const r = Math.hypot(x, z);
      if (r > 1200) grass.lerp(DISTANT, Math.min(1, (r - 1200) / 400));
      // Bare rock shows through on steep slopes.
      grass.lerp(ROCK, 0.35 * THREE.MathUtils.smoothstep(f.slope + (valueNoise(x / 25, z / 25, 23) - 0.5) * 0.15, 0.3, 1.0));
      c.copy(grass);

      // Landing areas, with edges softened over a few metres and roughened by noise.
      for (const { a, reach } of areas) {
        if (Math.abs(x - a.cx) > reach || Math.abs(z - a.cz) > reach) continue;
        const { d, lx } = areaFrame(a, x, z);
        if (d > 6) continue;
        const ragged = a.surface === 'field' || a.surface === 'rough' ? (valueNoise(x / 9, z / 9, 21) - 0.5) * 5 : 0;
        const w = 1 - THREE.MathUtils.smoothstep(d + ragged, -1.5, 1.5);
        if (w <= 0) continue;
        const [c0, c1] = SURFACE[a.surface];
        const t = a.surface === 'field'
          ? THREE.MathUtils.smoothstep(Math.sin((lx * Math.PI) / 20), -0.25, 0.25) // mow stripes, 20 m wide
          : THREE.MathUtils.smoothstep(valueNoise(x / 30, z / 30, 13), 0.2, 0.8);
        tmp.copy(c0).lerp(c1, t);
        c.lerp(tmp, w);
      }

      // Airport hard standing, edges softened over about a metre and a half.
      for (const { p, reach, cos, sin } of paved) {
        if (Math.abs(x - p.cx) > reach || Math.abs(z - p.cz) > reach) continue;
        const dx = x - p.cx, dz = z - p.cz, lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
        const ox = Math.abs(lx) - p.hw, oz = Math.abs(lz) - p.hl;
        const d = ox > 0 || oz > 0 ? Math.hypot(Math.max(0, ox), Math.max(0, oz)) : Math.max(ox, oz);
        const w = 1 - THREE.MathUtils.smoothstep(d, -0.6, 0.9);
        if (w <= 0) continue;
        const [p0, p1] = PAVING[p.surface];
        tmp.copy(p0).lerp(p1, valueNoise(x / 6, z / 6, 29));
        c.lerp(tmp, w);
      }

      // Sandy beach round the lake, wet below the waterline, lake bed further down.
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < lakeR) {
        const beach = 1 - THREE.MathUtils.smoothstep(y, water + 0.6, water + 2.4);
        const beachNoise = 0.85 + 0.3 * valueNoise(x / 14, z / 14, 33);
        c.lerp(SAND, Math.min(1, beach * beachNoise));
        if (y < water) c.lerp(WET_SAND, THREE.MathUtils.smoothstep(water - y, 0, 1)).lerp(LAKE_BED, THREE.MathUtils.smoothstep(water - y, 1, 6));
      }

      c.multiplyScalar(f.cavity * canopy[j * size + i]);
      c.convertLinearToSRGB();
      const k = (j * size + i) * 4;
      data[k] = Math.round(Math.min(1, c.r) * 255);
      data[k + 1] = Math.round(Math.min(1, c.g) * 255);
      data[k + 2] = Math.round(Math.min(1, c.b) * 255);
      data[k + 3] = 255;
    }
  }
}

function groundTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Bakes the ground map in one go: one texel per few metres over the whole world. */
export function bakeGroundMap(world: World, size = groundMapSize()): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (const _ of bakeSteps(world, size, data));
  return groundTexture(data, size);
}

/**
 * Bakes the ground map in slices of a few milliseconds between frames, so start-up is not held up by it,
 * and hands over the texture when done.
 */
export function bakeGroundMapInBackground(world: World, size: number, done: (tex: THREE.DataTexture) => void) {
  const data = new Uint8Array(size * size * 4);
  const steps = bakeSteps(world, size, data);
  const slice = () => {
    const until = performance.now() + 6;
    while (performance.now() < until) {
      if (steps.next().done) return done(groundTexture(data, size));
    }
    setTimeout(slice, 0);
  };
  setTimeout(slice, 0);
}

/** Lambert material reading the ground map, with the shared surface detail on top. */
function groundMaterial(map: THREE.Texture): THREE.MeshLambertMaterial {
  return withSurfaceDetail(new THREE.MeshLambertMaterial({ map }), 1);
}

const ground: { current: THREE.DataTexture | null; worldSize: number } = { current: null, worldSize: 0 };

/**
 * The ground map's colour at a point (linear), as drawn right now; false before the terrain is built.
 * Used to tint plants so they match the ground they grow from.
 */
export function groundColourAt(x: number, z: number, out: THREE.Color): boolean {
  const tex = ground.current;
  if (!tex) return false;
  const { data, width: size } = tex.image as { data: Uint8Array; width: number };
  const i = Math.min(size - 1, Math.max(0, Math.floor(((x / ground.worldSize) + 0.5) * size)));
  const j = Math.min(size - 1, Math.max(0, Math.floor(((z / ground.worldSize) + 0.5) * size)));
  const k = (j * size + i) * 4;
  out.setRGB(data[k] / 255, data[k + 1] / 255, data[k + 2] / 255, THREE.SRGBColorSpace);
  return true;
}

/**
 * The playable terrain: the same vertices and diagonals as `World.heightAt`, so the drawn ground is exactly the
 * collision surface, but indexed and smooth-shaded, and coloured by the ground map instead of per triangle.
 */
export function buildTerrain(world: World): THREE.Mesh {
  ground.worldSize = world.size;
  const n = world.cells + 1, cell = world.size / world.cells, half = world.size / 2;
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos.set([-half + i * cell, world.heights[k], -half + j * cell], k * 3);
      uv.set([i / world.cells, j / world.cells], k * 2);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < world.cells; j++) {
    for (let i = 0; i < world.cells; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // Same diagonal as World.heightAt: (i+1,j) — (i,j+1). Counter-clockwise seen from above.
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // A quick coarse map first; the full one is baked in the background and swapped in, usually while the menu is up.
  const material = groundMaterial(bakeGroundMap(world, 128));
  ground.current = material.map as THREE.DataTexture;
  bakeGroundMapInBackground(world, groundMapSize(), (tex) => {
    material.map?.dispose();
    material.map = ground.current = tex;
  });
  return new THREE.Mesh(geo, material);
}

/** The lake: a sheet whose colour and opacity follow the depth below it, so the shore fades in softly. */
export function buildWater(world: World): THREE.Mesh {
  const R = LAKE.r * 1.15, seg = 96;
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg).rotateX(-Math.PI / 2);
  const deep = C(0x1f5874), shallow = C(0x5aa3ad), c = new THREE.Color();
  const p = geo.attributes.position, rgba = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + LAKE.x, z = p.getZ(i) + LAKE.z;
    const depth = world.waterLevel - world.heightAt(x, z);
    c.copy(shallow).lerp(deep, THREE.MathUtils.smoothstep(depth, 0.5, 9));
    // Only the lake itself: low ground elsewhere in the square stays dry.
    const inLake = 1 - THREE.MathUtils.smoothstep(Math.hypot(p.getX(i), p.getZ(i)), LAKE.r * 1.02, R);
    rgba.set([c.r, c.g, c.b, (0.35 + 0.6 * THREE.MathUtils.smoothstep(depth, 0, 2.5)) * inLake], i * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  geo.deleteAttribute('uv');
  // Glossy, so the water picks up the sky at a glancing angle.
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.2, metalness: 0, envMapIntensity: 0.55, depthWrite: false }));
  m.position.set(LAKE.x, world.waterLevel, LAKE.z);
  return m;
}

/**
 * Scenery beyond the edge of the world: the land carries on, then rises into mountain ranges that fade into the haze.
 * Within 250 m of the edge it follows, a few metres lower, the height the simulation uses out there (the edge height
 * carried outwards), so a pilot who strays past the edge meets the ground about where it is drawn. Starts a little
 * inside the edge, just below the playable terrain, so the seam is hidden.
 */
export function buildDistantMountains(world: World): THREE.Mesh {
  const half = world.size / 2, extent = 4200, step = 100;
  const n = Math.round((extent * 2) / step) + 1;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const low = C(0x56785a), high = C(0x8a8f86), ridge = C(0x6f7f74), c = new THREE.Color();
  const index = new Int32Array(n * n).fill(-1);
  const inside = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) < half - 100;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -extent + i * step, z = -extent + j * step;
      const cx = Math.min(half, Math.max(-half, x)), cz = Math.min(half, Math.max(-half, z));
      const out = Math.hypot(Math.max(0, Math.abs(x) - half), Math.max(0, Math.abs(z) - half));
      const massif = THREE.MathUtils.smoothstep(fbm(x / 1300, z / 1300, 404, 4), 0.3, 0.75);
      const rise = THREE.MathUtils.smoothstep(out, 250, 2000) * (90 + 480 * massif);
      // Where it overlaps or adjoins the playable terrain, each vertex sits at the lowest ground within one cell
      // around it: the scenery's long triangles then stay under the finer terrain everywhere, never poking through.
      let base = world.heightAt(cx, cz);
      if (out < 150) {
        for (let dz = -step; dz <= step; dz += 20) for (let dx = -step; dx <= step; dx += 20) {
          base = Math.min(base, world.heightAt(Math.min(half, Math.max(-half, x + dx)), Math.min(half, Math.max(-half, z + dz))));
        }
      }
      const y = base - 2 + rise;
      index[j * n + i] = pos.length / 3;
      pos.push(x, y, z);
      c.copy(low).lerp(ridge, THREE.MathUtils.smoothstep(rise, 60, 300)).lerp(high, THREE.MathUtils.smoothstep(rise, 350, 560));
      c.multiplyScalar(0.92 + 0.16 * valueNoise(x / 300, z / 300, 405));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j + 1 < n; j++) {
    for (let i = 0; i + 1 < n; i++) {
      const x0 = -extent + i * step, z0 = -extent + j * step;
      if (inside(x0, z0) && inside(x0 + step, z0 + step) && inside(x0 + step, z0) && inside(x0, z0 + step)) continue;
      const a = index[j * n + i], b = index[j * n + i + 1], c2 = index[(j + 1) * n + i], d = index[(j + 1) * n + i + 1];
      idx.push(a, c2, b, b, c2, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, withSurfaceDetail(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.6));
  m.matrixAutoUpdate = false;
  return m;
}
