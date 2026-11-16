import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Smooth, rounded building blocks for vehicle models, and the merge that turns a model into a few draws. */

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);

/** A round rod between two points (struts, masts, straight tubes), with rounded ends. */
export function rod(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material, sides = 10): THREE.Mesh {
  const dir = to.clone().sub(from);
  const geo = new THREE.CapsuleGeometry(radius, dir.length(), 3, sides);
  const m = new THREE.Mesh(geo, material);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

/** A tube bent smoothly through the given points (skids, cross-tubes, hoses), with rounded ends. */
export function tube(points: THREE.Vector3[], radius: number, material: THREE.Material, segments = 24, sides = 8): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, sides, false), material));
  for (const p of [points[0], points[points.length - 1]]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, sides, Math.max(4, sides >> 1)), material);
    cap.position.copy(p);
    g.add(cap);
  }
  return g;
}

export function roundBox(w: number, h: number, d: number, radius: number, material: THREE.Material, segments = 2): THREE.Mesh {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, w / 2, h / 2, d / 2) * 0.999), material);
}

/** Rounded-rectangle outline, centred on the origin. */
function roundRect(w: number, h: number, r: number): THREE.Shape {
  r = Math.min(r, w / 2, h / 2);
  const s = new THREE.Shape(), x = w / 2, y = h / 2;
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r);
  s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r);
  s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}

/** A flat shape with softly bevelled edges: outline in (z, y), thickness along X. Fins, windows, stripes. */
export function panelGeometry(shape: THREE.Shape, thickness: number): THREE.BufferGeometry {
  const bevel = Math.min(thickness * 0.45, 0.03);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, thickness - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geo.translate(0, 0, -(thickness - bevel * 2) / 2);
  return geo.rotateY(-Math.PI / 2); // shape x -> world z, extrusion -> world x
}

/** Rounded rectangle panel in the ZY plane (length along Z, height along Y), thickness along X. */
export function panel(length: number, height: number, radius: number, thickness: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(panelGeometry(roundRect(length, height, radius), thickness), material);
}

/** Rounded rectangle slab in the XZ plane (width along X, depth along Z), thickness along Y. */
export function slab(width: number, depth: number, radius: number, thickness: number, material: THREE.Material): THREE.Mesh {
  // panel: thickness X, height Y; turning it a quarter about Z puts thickness on Y and height on X.
  return new THREE.Mesh(panelGeometry(roundRect(depth, width, radius), thickness).rotateZ(Math.PI / 2), material);
}

/** A polygon outline [z, y][] made into a panel (fins). */
export function outline(points: [number, number][], thickness: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(panelGeometry(new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y))), thickness), material);
}

/**
 * A rotor blade lying along +X from `root` to `root + span`: tapered planform with a rounded tip, chord along Z,
 * thin along Y.
 */
export function bladeGeometry(root: number, span: number, rootChord: number, tipChord: number, thickness: number): THREE.BufferGeometry {
  const s = new THREE.Shape(), end = root + span, tip = tipChord / 2;
  s.moveTo(root, -rootChord / 2);
  s.lineTo(end - tip, -tip);
  s.quadraticCurveTo(end, -tip, end, 0);
  s.quadraticCurveTo(end, tip, end - tip, tip);
  s.lineTo(root, rootChord / 2);
  s.closePath();
  const bevel = thickness * 0.4;
  const geo = new THREE.ExtrudeGeometry(s, { depth: thickness - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: Math.min(bevel, tip * 0.3), bevelSegments: 1, curveSegments: 4 });
  return geo.translate(0, 0, -(thickness - bevel * 2) / 2).rotateX(-Math.PI / 2);
}

/** One cross-section of a lofted body: half-width and bottom/top height at a station along Z. */
export type Station = [z: number, halfWidth: number, yBottom: number, yTop: number];

/**
 * A smooth body lofted through rounded-rectangle sections, capped at both ends. `subdivide` adds in-between
 * sections on a Catmull-Rom curve so the body flows from one station to the next instead of kinking.
 */
export function loft(stations: Station[], cornerRadius: number, material: THREE.Material, subdivide = 1, perCorner = 5): THREE.Mesh {
  const rows = subdivide > 1 && stations.length > 2 ? smoothStations(stations, subdivide) : stations;
  const ringSize = perCorner * 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [z, hw, y0, y1] of rows) {
    const c = Math.min(cornerRadius, hw * 0.6, (y1 - y0) * 0.4);
    // Counter-clockwise seen from +Z, starting at the bottom of the right side.
    const corners: [number, number, number][] = [[hw - c, y0 + c, -Math.PI / 2], [hw - c, y1 - c, 0], [c - hw, y1 - c, Math.PI / 2], [c - hw, y0 + c, Math.PI]];
    for (const [cx, cy, a0] of corners) {
      for (let k = 0; k < perCorner; k++) {
        const a = a0 + (k / (perCorner - 1)) * (Math.PI / 2);
        pos.push(cx + Math.cos(a) * c, cy + Math.sin(a) * c, z);
      }
    }
  }
  for (let s = 0; s + 1 < rows.length; s++) {
    for (let i = 0; i < ringSize; i++) {
      const a = s * ringSize + i, b = s * ringSize + ((i + 1) % ringSize), c = a + ringSize, d = b + ringSize;
      idx.push(a, b, d, a, d, c);
    }
  }
  // Caps get their own vertices, so their flat normals don't bend the shading of the body's edge.
  for (const [ring, front] of [[0, true], [rows.length - 1, false]] as const) {
    const base = pos.length / 3;
    for (let i = 0; i < ringSize; i++) pos.push(pos[(ring * ringSize + i) * 3], pos[(ring * ringSize + i) * 3 + 1], pos[(ring * ringSize + i) * 3 + 2]);
    for (let i = 1; i + 1 < ringSize; i++) front ? idx.push(base, base + i + 1, base + i) : idx.push(base, base + i, base + i + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

function smoothStations(st: Station[], n: number): Station[] {
  const out: Station[] = [];
  const at = (i: number) => st[Math.max(0, Math.min(st.length - 1, i))];
  for (let s = 0; s + 1 < st.length; s++) {
    const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const row = p1.map((_, j) => {
        // Z is interpolated linearly so sections never cross; the shape follows Catmull-Rom.
        if (j === 0) return p1[0] + (p2[0] - p1[0]) * t;
        const t2 = t * t, t3 = t2 * t;
        const v = 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
        // Clamped between the two stations: the curve rounds the kinks but never bulges past them.
        return Math.min(Math.max(v, Math.min(p1[j], p2[j])), Math.max(p1[j], p2[j]));
      }) as Station;
      out.push(row);
    }
  }
  out.push(st[st.length - 1]);
  return out;
}

export interface MergeOptions {
  /** Bake a soft vertical occlusion: vertices at `low` are darkened to `dark`, those at `high` keep full brightness. */
  occlusion?: { low: number; high: number; dark: number };
}

/**
 * Collapses every mesh under `group` into one mesh per material, in the group's own space.
 * Animated parts must not be inside `group`. Geometry attributes are reduced to position, normal and colour.
 */
export function mergeByMaterial(group: THREE.Group, opts: MergeOptions = {}): THREE.Group {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    let g = (o.geometry as THREE.BufferGeometry).clone();
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const occ = opts.occlusion;
      const v = occ ? THREE.MathUtils.lerp(occ.dark, 1, THREE.MathUtils.smoothstep(p.getY(i), occ.low, occ.high)) : 1;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = o.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos)!;
    for (const g of geos) g.dispose();
    out.add(new THREE.Mesh(merged, mat));
  }
  return out;
}
