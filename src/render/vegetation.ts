import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Obstacle, World } from '../world/world';
import { mulberry32 } from '../world/rng';

/**
 * Trees, undergrowth and grass.
 *
 * Every plant is one merged geometry with colours baked into its vertices and its normals bent away from the
 * centre of its crown, so foliage shades like one soft mass instead of showing each facet. Trees keep their exact
 * collision height (instance scale Y = height). Forests are split into square chunks, each a THREE.LOD with three
 * levels, one instanced draw per kind and level. All plants share one material whose vertex shader adds a gentle
 * sway, driven by `windTime`.
 */

const CHUNK = 350; // metres
const MID_DISTANCE = 300; // chunk-centre distance where trees drop to the simpler model
const FAR_DISTANCE = 760; // ... and to the silhouette

/** Seconds of simulated time, set by the renderer every frame; the sway follows it, so a paused game holds still. */
export const windTime = { value: 0 };

const C = (hex: number) => new THREE.Color(hex);

/** Position, normal and colour only, non-indexed: the common format every plant part is merged in. */
function bare(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  return out;
}

/** Bends normals towards the direction from `centre`, by `amount` (0 = as modelled, 1 = a perfect ball). */
function soften(g: THREE.BufferGeometry, centre: THREE.Vector3, amount: number): THREE.BufferGeometry {
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).sub(centre).normalize();
    v.fromBufferAttribute(n, i).lerp(d, amount).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** Bakes a colour per vertex from its position and (softened) normal. */
function paint(g: THREE.BufferGeometry, colour: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void): THREE.BufferGeometry {
  const pos = g.attributes.position, nor = g.attributes.normal, col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    colour(p.fromBufferAttribute(pos, i), n.fromBufferAttribute(nor, i), c);
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Deterministic lumpiness for a crown: each vertex pushed in or out a little along its direction from the lobe centre. */
function lumpy(g: THREE.BufferGeometry, centre: THREE.Vector3, amount: number, seed: number): THREE.BufferGeometry {
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(centre);
    const h = Math.sin(v.x * 37.1 + seed) * Math.sin(v.y * 41.7 + seed * 2) * Math.sin(v.z * 29.3 + seed * 3);
    v.multiplyScalar(1 + h * amount).add(centre);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

const BARK_DARK = C(0x3a2a1e), BARK_LIGHT = C(0x6a4e36);
function trunkGeo(h: number, r0: number, r1: number, sides: number): THREE.BufferGeometry {
  const g = bare(new THREE.CylinderGeometry(r1, r0, h, sides, 1, true).translate(0, h / 2, 0));
  return paint(g, (p, _n, c) => c.copy(BARK_DARK).lerp(BARK_LIGHT, p.y / h));
}

const NEEDLE_DARK = C(0x173a2a), NEEDLE_LIGHT = C(0x467f55);
/** Pine: stacked drooping tiers, each a closed lathe (with an underside), turned so the tiers don't line up. */
function pine(tiers: number, sides: number): THREE.BufferGeometry {
  const parts = [trunkGeo(0.3, 0.05, 0.03, Math.max(4, sides - 3))];
  for (let i = 0; i < tiers; i++) {
    const t = tiers > 1 ? i / (tiers - 1) : 0;
    const y0 = 0.12 + t * 0.62, h = i === tiers - 1 ? 1 - y0 : 0.34 - t * 0.1, r = 0.3 - t * 0.19;
    const profile = [[0.001, h * 0.16], [r, 0], [r * 0.62, h * 0.3], [0.001, h]].map(([x, y]) => new THREE.Vector2(x, y));
    const g = bare(new THREE.LatheGeometry(profile, sides).rotateY(i * 0.7).translate(0, y0, 0));
    soften(g, new THREE.Vector3(0, y0 + h * 0.15, 0), 0.45);
    parts.push(paint(g, (p, n, c) => {
      const outer = Math.min(1, Math.hypot(p.x, p.z) / r);
      c.copy(NEEDLE_DARK).lerp(NEEDLE_LIGHT, 0.25 + 0.35 * outer * Math.max(0, n.y + 0.4) + 0.35 * t);
    }));
  }
  return mergeGeometries(parts)!;
}

const LEAF_DARK = C(0x2a4f22), LEAF_LIGHT = C(0x6a9a3c);
/** Broadleaf: a trunk with two branches into a crown of overlapping lumpy lobes, shaded as one soft mass. */
function broadleaf(lobes: [number, number, number, number][], detail: number, trunkSides: number): THREE.BufferGeometry {
  const parts = [trunkGeo(0.62, 0.065, 0.035, trunkSides)];
  if (detail > 0) {
    for (const [x, z] of [[0.12, 0.05], [-0.1, -0.06]]) {
      const from = new THREE.Vector3(0, 0.4, 0), to = new THREE.Vector3(x, 0.62, z);
      const b = new THREE.CylinderGeometry(0.014, 0.022, from.distanceTo(to), 5, 1, true).translate(0, from.distanceTo(to) / 2, 0);
      b.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())).translate(from.x, from.y, from.z);
      parts.push(paint(bare(b), (_p, _n, c) => c.copy(BARK_LIGHT)));
    }
  }
  const crown = new THREE.Vector3(0, 0.74, 0);
  lobes.forEach(([x, y, z, r], k) => {
    const centre = new THREE.Vector3(x, y, z);
    const g = bare(new THREE.IcosahedronGeometry(r, detail).scale(1, 0.88, 1).translate(x, y, z));
    lumpy(g, centre, 0.1, k + 1);
    g.computeVertexNormals();
    soften(g, crown, 0.7);
    parts.push(paint(g, (p, n, c) => {
      const up = THREE.MathUtils.clamp((p.y - 0.5) / 0.45, 0, 1);
      c.copy(LEAF_DARK).lerp(LEAF_LIGHT, 0.15 + 0.45 * up + 0.3 * Math.max(0, n.y));
    }));
  });
  return mergeGeometries(parts)!;
}

const BUSH_DARK = C(0x2e5426), BUSH_LIGHT = C(0x6f9c40);
function bush(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const centre = new THREE.Vector3(0, 0.35, 0);
  for (const [x, y, z, r, d] of [[0, 0.42, 0, 0.5, 1], [0.32, 0.3, 0.12, 0.32, 0], [-0.28, 0.28, -0.1, 0.3, 0]] as const) {
    const g = bare(new THREE.IcosahedronGeometry(r, d).scale(1, 0.75, 1).translate(x, y, z));
    lumpy(g, new THREE.Vector3(x, y, z), 0.12, x * 10 + 3);
    g.computeVertexNormals();
    soften(g, centre, 0.7);
    parts.push(paint(g, (p, n, c) => c.copy(BUSH_DARK).lerp(BUSH_LIGHT, 0.2 + 0.5 * THREE.MathUtils.clamp(p.y / 0.8, 0, 1) + 0.25 * Math.max(0, n.y))));
  }
  return mergeGeometries(parts)!;
}

function plantGeometries() {
  const crownNear: [number, number, number, number][] = [[0, 0.68, 0, 0.28], [-0.14, 0.8, 0.07, 0.2], [0.13, 0.77, -0.08, 0.21]];
  const crownMid: [number, number, number, number][] = [[0, 0.68, 0, 0.3], [-0.08, 0.84, 0.04, 0.2]];
  const pineFar = bare(new THREE.ConeGeometry(0.27, 0.92, 6, 1, true).translate(0, 0.54, 0));
  soften(pineFar, new THREE.Vector3(0, 0.4, 0), 0.4);
  const roundFar = bare(new THREE.OctahedronGeometry(1, 0).scale(0.32, 0.42, 0.32).translate(0, 0.6, 0));
  soften(roundFar, new THREE.Vector3(0, 0.6, 0), 0.8);
  return {
    pine: [pine(4, 7), pine(3, 5), paint(pineFar, (p, _n, c) => c.copy(NEEDLE_DARK).lerp(NEEDLE_LIGHT, 0.3 + 0.4 * p.y))],
    round: [broadleaf(crownNear, 1, 6), broadleaf(crownMid, 0, 4), paint(roundFar, (p, _n, c) => c.copy(LEAF_DARK).lerp(LEAF_LIGHT, 0.25 + 0.5 * (p.y - 0.2)))],
    bush: bush(),
  };
}

/**
 * The material all plants share: smooth Lambert, vertex and instance colours, and a sway that grows with the
 * square of the height in the plant's own space (the trunk foot stays put), phased by where the plant stands.
 */
function plantMaterial(sway: number): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = windTime;
    // A uniform, not text in the shader: trees, bushes and grass share one compiled program.
    shader.uniforms.swayAmount = { value: sway };
    shader.vertexShader = 'uniform float windTime;\nuniform float swayAmount;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 plantAt = (modelMatrix * instanceMatrix[3]).xz;
      #else
        vec2 plantAt = vec2(0.0);
      #endif
      float bendH = position.y * position.y;
      float phase = plantAt.x * 0.071 + plantAt.y * 0.053;
      transformed.x += sin(windTime * 1.3 + phase) * swayAmount * bendH;
      transformed.z += cos(windTime * 1.05 + phase * 1.3) * swayAmount * 0.7 * bendH;`,
    );
  };
  m.customProgramCacheKey = () => 'plant';
  return m;
}

interface Chunk { cx: number; cz: number; pines: Obstacle[]; rounds: Obstacle[]; bushes: Bush[] }
interface Bush { x: number; z: number; base: number; h: number; w: number }

/** Undergrowth: a bush beside about a third of the trees, kept off landing areas, water and the airport. */
function placeBushes(world: World, trees: Obstacle[]): Bush[] {
  const rnd = mulberry32(4242);
  const out: Bush[] = [];
  for (const t of trees) {
    if (rnd() > 0.35) continue;
    const a = rnd() * Math.PI * 2, d = t.radius * 1.3 + 1 + rnd() * 4;
    const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
    const h = 0.7 + rnd() * 1.1, w = h * (1.1 + rnd() * 0.6);
    if (world.areaAt(x, z, 6) || world.surfaceAt(x, z) === 'water' || world.slopeAt(x, z) > 0.7) continue;
    if (world.obstaclesNear(x, z, 4).some((o) => o.kind !== 'tree')) continue;
    out.push({ x, z, base: world.heightAt(x, z), h, w });
  }
  return out;
}

/** Forests and undergrowth, chunked with three levels of detail per chunk. */
export function buildForests(world: World): THREE.Group {
  const group = new THREE.Group();
  const trees = world.obstacles.filter((o) => o.kind === 'tree');
  const geos = plantGeometries();
  const treeMat = plantMaterial(0.012);
  const bushMat = plantMaterial(0.03);
  const rnd = mulberry32(7);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();

  const chunks = new Map<string, Chunk>();
  const chunkAt = (x: number, z: number) => {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK), key = `${ix},${iz}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { cx: (ix + 0.5) * CHUNK, cz: (iz + 0.5) * CHUNK, pines: [], rounds: [], bushes: [] }));
    return c;
  };
  for (const t of trees) (t.variant === 1 ? chunkAt(t.x, t.z).rounds : chunkAt(t.x, t.z).pines).push(t);
  for (const b of placeBushes(world, trees)) chunkAt(b.x, b.z).bushes.push(b);

  for (const c of chunks.values()) {
    const lod = new THREE.LOD();
    lod.position.set(c.cx, 0, c.cz);
    lod.matrixAutoUpdate = false;
    lod.updateMatrix();
    const levels = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
    const make = (list: Obstacle[], kindGeos: THREE.BufferGeometry[], hue: number) => {
      if (!list.length) return;
      const meshes = kindGeos.map((g) => new THREE.InstancedMesh(g, treeMat, list.length));
      list.forEach((t, i) => {
        // Width varies a little around the height-driven size; height stays exact for collisions.
        const w = t.height * (0.88 + rnd() * 0.26);
        sv.set(w, t.height, w);
        m4.compose(pv.set(t.x - c.cx, t.base - 0.3, t.z - c.cz), q.setFromAxisAngle(up, rnd() * 6), sv);
        // Brightness and a touch of yellow or blue per tree, so a forest is never one flat colour.
        const v = 0.84 + rnd() * 0.26, warm = (rnd() - 0.5) * hue;
        tint.setRGB(v * (1 + warm), v * (1 + warm * 0.4), v * (1 - warm));
        for (const m of meshes) (m.setMatrixAt(i, m4), m.setColorAt(i, tint));
      });
      meshes.forEach((m, k) => {
        m.matrixAutoUpdate = false;
        m.computeBoundingSphere();
        levels[k].add(m);
      });
    };
    make(c.pines, geos.pine, 0.12);
    make(c.rounds, geos.round, 0.25);
    if (c.bushes.length) {
      const m = new THREE.InstancedMesh(geos.bush, bushMat, c.bushes.length);
      c.bushes.forEach((b, i) => {
        m4.compose(pv.set(b.x - c.cx, b.base - 0.15, b.z - c.cz), q.setFromAxisAngle(up, rnd() * 6), sv.set(b.w, b.h, b.w));
        m.setMatrixAt(i, m4);
        const v = 0.85 + rnd() * 0.25;
        m.setColorAt(i, tint.setRGB(v, v, v * 0.95));
      });
      m.matrixAutoUpdate = false;
      m.computeBoundingSphere();
      levels[0].add(m); // undergrowth is only drawn up close
    }
    lod.addLevel(levels[0], 0);
    lod.addLevel(levels[1], MID_DISTANCE);
    lod.addLevel(levels[2], FAR_DISTANCE);
    group.add(lod);
  }
  return group;
}

/**
 * Grass tufts in a circle round the helicopter, shown only when it is low. The tufts sit on a world-fixed jittered
 * grid, so moving the circle never makes them swim; it is rebuilt every few metres of travel. Each tuft takes its
 * colour from the ground map under it, so it blends into the ground it grows from.
 */
export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  enabled = true;
  private centre = new THREE.Vector2(Number.NaN, Number.NaN);
  private static readonly RADIUS = 34;
  private static readonly CELL = 1.15;
  private static readonly SHOW_BELOW = 45; // m above ground

  constructor(
    private world: World,
    private groundColourAt: (x: number, z: number, out: THREE.Color) => boolean,
    private blocked: (x: number, z: number) => boolean,
  ) {
    const n = Math.ceil((GrassField.RADIUS * 2) / GrassField.CELL) ** 2;
    this.mesh = new THREE.InstancedMesh(GrassField.tuft(), plantMaterial(0.35), n);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Seven blades fanned out and leaning, dark at the root and light at the tip. */
  private static tuft(): THREE.BufferGeometry {
    // Neutral greys: the tuft takes its hue from the ground map, these only darken the root and lighten the tip.
    const pos: number[] = [], col: number[] = [], root = new THREE.Color(0.72, 0.74, 0.7), tip = new THREE.Color(1.18, 1.22, 1.02);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3, lean = 0.14 + (k % 3) * 0.08, h = 0.3 + ((k * 5) % 7) * 0.035;
      const dx = Math.cos(a), dz = Math.sin(a), w = 0.07;
      // Each blade twice, once per winding, so both faces are front faces lit from above.
      pos.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * lean, h, dz * lean);
      pos.push(dz * w, 0, -dx * w, -dz * w, 0, dx * w, dx * lean, h, dz * lean);
      for (let t = 0; t < 2; t++) col.push(...root.toArray(), ...root.toArray(), ...tip.toArray());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // Normals pointing up: blades light like the ground they stand on, whichever way they face.
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    return g;
  }

  update(x: number, z: number, agl: number) {
    const show = this.enabled && agl < GrassField.SHOW_BELOW;
    this.mesh.visible = show;
    if (!show || Math.hypot(x - this.centre.x, z - this.centre.y) < 5) return;
    this.centre.set(x, z);
    const { RADIUS: R, CELL } = GrassField;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    let n = 0;
    const i0 = Math.floor((x - R) / CELL), i1 = Math.floor((x + R) / CELL), j0 = Math.floor((z - R) / CELL), j1 = Math.floor((z + R) / CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const h = hash(i, j), tx = (i + h) * CELL, tz = (j + hash(j, i)) * CELL;
        const d = Math.hypot(tx - x, tz - z);
        if (d > R || n >= this.mesh.instanceMatrix.count) continue;
        if (!this.groundColourAt(tx, tz, c) || this.blocked(tx, tz)) continue;
        const surface = this.world.surfaceAt(tx, tz);
        if (surface === 'water' || surface === 'paved' || surface === 'strip') continue;
        // Smaller towards the rim, so the edge of the circle never shows as a line.
        const size = (0.7 + h * 0.8) * (1 - THREE.MathUtils.smoothstep(d, R * 0.65, R));
        if (size < 0.05) continue;
        m4.compose(p.set(tx, this.world.heightAt(tx, tz) - 0.02, tz), q.setFromAxisAngle(up, h * 40), s.set(size, size * (0.8 + hash(i + 7, j) * 0.6), size));
        this.mesh.setMatrixAt(n, m4);
        this.mesh.setColorAt(n, c);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function hash(i: number, j: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
