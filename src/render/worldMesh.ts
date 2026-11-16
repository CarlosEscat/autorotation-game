import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roundBox } from './modelKit';
import { LandingArea, World } from '../world/world';
import { mulberry32 } from '../world/rng';
import { PALETTE, lambert } from './materials';
import { buildBuildings } from './buildingsMesh';
import { buildForests } from './vegetation';

// --- Obstacles ----------------------------------------------------------------------------
// Trees and undergrowth live in vegetation.ts, buildings in buildingsMesh.ts; boulders are drawn here.

export function buildObstacles(world: World): THREE.Group {
  const group = new THREE.Group();
  const rocks = world.obstacles.filter((o) => o.kind === 'rock');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sv = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const tint = new THREE.Color();
  const rnd = mulberry32(8);
  group.add(buildForests(world));

  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMesh = new THREE.InstancedMesh(rockGeo, lambert(0xffffff), rocks.length);
  rocks.forEach((r, i) => {
    sv.set(r.radius, r.height * 0.8, r.radius * 0.9);
    m4.compose(pv.set(r.x, r.base + r.height * 0.25, r.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), sv);
    rockMesh.setMatrixAt(i, m4);
    rockMesh.setColorAt(i, tint.setHex(0x978f84).multiplyScalar(0.86 + rnd() * 0.2));
  });
  group.add(rockMesh);

  group.add(buildBuildings(world));
  return group;
}

/**
 * The runway's asphalt as a small painted texture (across × along): fine grain, a darker oily strip down the middle,
 * lighter weathered edges, and rubber deposits where wheels touch down past each aiming point.
 */
function runwaySurface(): THREE.CanvasTexture {
  const W = 64, L = 1024, rnd = mulberry32(31);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = L;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#5a5954';
  ctx.fillRect(0, 0, W, L);
  const across = ctx.createLinearGradient(0, 0, W, 0);
  across.addColorStop(0, 'rgba(150,146,136,0.35)');
  across.addColorStop(0.12, 'rgba(150,146,136,0)');
  across.addColorStop(0.38, 'rgba(30,30,28,0)');
  across.addColorStop(0.5, 'rgba(30,30,28,0.35)');
  across.addColorStop(0.62, 'rgba(30,30,28,0)');
  across.addColorStop(0.88, 'rgba(150,146,136,0)');
  across.addColorStop(1, 'rgba(150,146,136,0.35)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, W, L);
  // Tyre rubber: dark streaks along the runway in both touchdown zones, thickest just past the aiming points.
  for (const end of [0, 1]) {
    for (let k = 0; k < 90; k++) {
      const t = Math.pow(rnd(), 1.6);
      const along = 0.27 + t * 0.2, y = (end ? 1 - along : along) * L;
      const x = W / 2 + (rnd() - 0.5) * W * 0.45 + (rnd() < 0.5 ? -1 : 1) * W * 0.06;
      ctx.fillStyle = `rgba(25,25,24,${0.04 + 0.08 * (1 - t)})`;
      ctx.fillRect(x, y, 1 + rnd(), (8 + rnd() * 24) * (end ? -1 : 1));
    }
  }
  const img = ctx.getImageData(0, 0, W, L);
  for (let k = 0; k < img.data.length; k += 4) {
    const n = (rnd() - 0.5) * 14;
    img.data[k] += n;
    img.data[k + 1] += n;
    img.data[k + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Asphalt and white markings over each paved area: edges, centreline, thresholds, aiming points. */
export function buildRunways(world: World): THREE.Group {
  const group = new THREE.Group();
  const asphalt = new THREE.MeshLambertMaterial({ map: runwaySurface(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const paint = lambert(PALETTE.runwayPaint, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  for (const a of world.areas.filter((r) => r.surface === 'paved' && r.deckHeight === undefined)) {
    const g = new THREE.Group();
    const hw = a.halfWidth, hl = a.halfLength;
    // Every marking of a runway goes into one geometry: one draw instead of one per line.
    const lines: THREE.BufferGeometry[] = [];
    const plane = (w: number, l: number, x: number, z: number, y: number) => new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).translate(x, y, z);
    g.add(new THREE.Mesh(plane(hw * 2, hl * 2, 0, 0, 0.06), asphalt));
    const line = (w: number, l: number, x: number, z: number) => lines.push(plane(w, l, x, z, 0.1));
    for (const side of [-1, 1]) {
      line(0.9, hl * 2 - 2, side * (hw - 1.2), 0); // edge lines
      for (let k = 0; k < 4; k++) line(1.6, 30, side * (3 + k * 2.8), side * (hl - 21)); // threshold stripes
      for (const x of [-6, 6]) line(3, 45, x, side * (hl - 150)); // aiming points
    }
    for (let z = -hl + 90; z <= hl - 90; z += 60) line(0.9, 30, 0, z); // centreline dashes
    g.add(new THREE.Mesh(mergeGeometries(lines)!, paint));
    g.position.set(a.cx, a.elevation, a.cz);
    g.rotation.y = a.rotation;
    group.add(g);
  }
  for (const a of world.areas.filter((d) => d.deckHeight !== undefined)) group.add(buildHelipad(a, paint));
  return group;
}

/** Concrete deck on four legs standing in the lake, with a yellow edge band, touchdown circle and H. */
function buildHelipad(a: LandingArea, paint: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const hw = a.halfWidth, hl = a.halfLength;
  // Light deck and bold, wide markings so the pad still reads at range; size and collision are unchanged.
  const deck = lambert(PALETTE.deck, { flatShading: false });
  const slab = roundBox(hw * 2, 1, hl * 2, 0.2, deck);
  slab.position.y = -0.5;
  g.add(slab);
  // Legs with cross-braces between them, and a safety net sloping out below the deck edge.
  const steel = lambert(PALETTE.deckLegs, { flatShading: false });
  const legs: THREE.BufferGeometry[] = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) legs.push(new THREE.CylinderGeometry(0.7, 0.75, 16, 14).translate(sx * (hw - 2), -9, sz * (hl - 2)));
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
    const a = new THREE.Vector3(ax * (hw - 2), -2.5, az * (hl - 2)), b = new THREE.Vector3(bx * (hw - 2), -6.5, bz * (hl - 2));
    const brace = new THREE.CylinderGeometry(0.18, 0.18, a.distanceTo(b), 8);
    brace.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    legs.push(brace.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2));
  }
  g.add(new THREE.Mesh(mergeGeometries(legs.map((l) => l.toNonIndexed()))!, steel));
  const net: THREE.BufferGeometry[] = [];
  for (const side of [0, 1, 2, 3]) {
    const len = side % 2 ? hl * 2 : hw * 2;
    const strip = new THREE.PlaneGeometry(len, 1.6).rotateX(-0.3).translate(0, -0.55, 0.75);
    strip.rotateY((side * Math.PI) / 2).translate(side === 1 ? hw : side === 3 ? -hw : 0, 0, side === 0 ? hl : side === 2 ? -hl : 0);
    net.push(strip);
  }
  g.add(new THREE.Mesh(mergeGeometries(net)!, lambert(0x3a3d3f, { flatShading: false, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })));
  // Markings are merged per colour: two draws for the whole deck.
  const yellow = lambert(PALETTE.padYellow, { flatShading: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const marks = new Map<THREE.Material, THREE.BufferGeometry[]>([[yellow, []], [paint, []]]);
  const flat = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, z = 0) => marks.get(m)!.push(geo.rotateX(-Math.PI / 2).translate(x, 0.03, z));
  for (const side of [-1, 1]) {
    flat(new THREE.PlaneGeometry(hw * 2, 1.4), yellow, 0, side * (hl - 0.7)); // edge band
    flat(new THREE.PlaneGeometry(1.4, hl * 2 - 2.8), yellow, side * (hw - 0.7), 0);
    flat(new THREE.PlaneGeometry(2.0, 11), paint, side * 3.6, 0); // H uprights
  }
  flat(new THREE.PlaneGeometry(5.2, 2.0), paint); // H crossbar
  flat(new THREE.RingGeometry(7.4, 8.6, 32), yellow);
  for (const [m, geos] of marks) g.add(new THREE.Mesh(mergeGeometries(geos)!, m));
  g.position.set(a.cx, a.elevation, a.cz);
  g.rotation.y = a.rotation;
  return g;
}

/** Corner markers and a windsock for each landing area. */
export function buildAreaMarkers(world: World, windFromDeg: number, windKt: number): THREE.Group {
  const group = new THREE.Group();
  const markerMat = lambert(PALETTE.marker, { flatShading: false });
  // Striped sock: orange and white bands along its length, baked into the vertices.
  const sockMat = lambert(0xffffff, { side: THREE.DoubleSide, vertexColors: true, flatShading: false });
  const poleMat = lambert(PALETTE.mast, { flatShading: false });
  // One geometry each for all the cones, poles and socks of the map.
  const cones: THREE.BufferGeometry[] = [], poles: THREE.BufferGeometry[] = [], socks: THREE.BufferGeometry[] = [];
  const m4 = new THREE.Matrix4(), euler = new THREE.Euler();
  for (const a of world.areas) {
    const c = Math.cos(a.rotation), s = Math.sin(a.rotation);
    const toWorld = (lx: number, lz: number) => ({ x: a.cx + lx * c + lz * s, z: a.cz - lx * s + lz * c });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = toWorld(sx * a.halfWidth, sz * a.halfLength);
      cones.push(new THREE.ConeGeometry(0.7, 1.2, 14).translate(p.x, world.heightAt(p.x, p.z) + 0.6, p.z));
    }
    const p = a.deckHeight === undefined ? toWorld(a.halfWidth + 6, -a.halfLength * 0.6) : toWorld(a.halfWidth - 1, -a.halfLength + 1);
    const ground = world.heightAt(p.x, p.z);
    poles.push(new THREE.CylinderGeometry(0.07, 0.09, 6.4, 8).translate(p.x, ground + 3, p.z));
    // Five bands, each its own short tube so the colours stay crisp, wide end at the pole (z = 0).
    const bands: THREE.BufferGeometry[] = [], orange = new THREE.Color(PALETTE.windsock), white = new THREE.Color(0xf4f1ea);
    for (let k = 0; k < 5; k++) {
      const r = (t: number) => 0.45 - 0.25 * t;
      const band = new THREE.CylinderGeometry(r((k + 1) / 5), r(k / 5), 2.6 / 5, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, (2.6 * (k + 0.5)) / 5);
      const col = new Float32Array(band.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) (k % 2 ? white : orange).toArray(col, i);
      band.setAttribute('color', new THREE.BufferAttribute(col, 3));
      bands.push(band);
    }
    const sockGeo = mergeGeometries(bands)!;
    // The sock (wide end at the pole, along +Z) streams downwind: heading = from + 180°.
    const to = ((windFromDeg + 180) * Math.PI) / 180;
    euler.set(windKt < 2 ? 1.2 : Math.max(0, 0.9 - windKt / 15), Math.atan2(Math.sin(to), -Math.cos(to)), 0, 'YXZ');
    socks.push(sockGeo.applyMatrix4(m4.makeRotationFromEuler(euler).setPosition(p.x, ground + 5.8, p.z)));
  }
  if (cones.length) group.add(new THREE.Mesh(mergeGeometries(cones)!, markerMat), new THREE.Mesh(mergeGeometries(poles)!, poleMat), new THREE.Mesh(mergeGeometries(socks)!, sockMat));
  return group;
}

/** Translucent column and ring marking the currently selected landing area. The renderer fades the column with distance. */
export function buildTargetBeacon(): THREE.Group {
  const g = new THREE.Group();
  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 140, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
  col.name = 'column';
  col.position.y = 70;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(14, 0.9, 4, 20), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.6;
  g.add(col, ring);
  return g;
}

/** A landing spot painted flat on the ground, centred on the origin: a yellow circle, or a heliport pad with an H. */
export function buildPad(radius: number, kind: 'circle' | 'heliport'): THREE.Group {
  const g = new THREE.Group();
  const paint = (color: number) =>
    new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const flat = (geo: THREE.BufferGeometry, color: number, y: number) => {
    const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), paint(color));
    m.position.y = y;
    g.add(m);
  };
  if (kind === 'heliport') {
    flat(new THREE.CircleGeometry(radius, 40), 0x3a3f4a, 0.04);
    flat(new THREE.RingGeometry(radius - 0.45, radius, 40), 0xffd23a, 0.06);
    const h = radius * 0.5, w = radius * 0.12;
    flat(new THREE.PlaneGeometry(w, h * 2).translate(-h * 0.55, 0, 0), 0xf4efe4, 0.06);
    flat(new THREE.PlaneGeometry(w, h * 2).translate(h * 0.55, 0, 0), 0xf4efe4, 0.06);
    flat(new THREE.PlaneGeometry(h * 1.1, w), 0xf4efe4, 0.06);
  } else {
    flat(new THREE.RingGeometry(radius - 0.8, radius, 64), 0xffd23a, 0.06);
    flat(new THREE.CircleGeometry(0.9, 16), 0xffd23a, 0.06);
  }
  return g;
}

/** A ring to fly through, facing +Z. Two materials so the next gate can be highlighted. */
export function buildGate(radius: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, 1.3, 5, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }));
}

/** Vertical gradient from warm haze to blue, with a soft glow around the sun. */
export function buildSky(sunDir: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.SphereGeometry(4000, 32, 16);
  const colors: number[] = [];
  const top = new THREE.Color(0x4f86cc), horizon = new THREE.Color(0xe6dcc6), glow = new THREE.Color(0xffe2b0);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, p.getY(i) / 4000);
    c.copy(horizon).lerp(top, Math.pow(t, 0.6));
    const toSun = Math.max(0, v.fromBufferAttribute(p, i).normalize().dot(sunDir));
    c.lerp(glow, 0.75 * Math.pow(toSun, 6));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

export function buildClouds(): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry32(11);
  // Flat, soft-edged puffs: sunlit tops, warm grey undersides rather than a uniform glow.
  const mat = new THREE.MeshLambertMaterial({ color: 0xf4eee2, emissive: 0x9a9288 });
  // The whole sky's worth of puffs is one geometry: one draw instead of a hundred.
  const puffs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) {
    const cloud: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const puff = new THREE.IcosahedronGeometry(30 + rnd() * 30, 1).scale(1.3, 0.28, 1);
      cloud.push(puff.translate(k * 40 - 60, rnd() * 6, rnd() * 30));
    }
    const a = rnd() * Math.PI * 2, r = 600 + rnd() * 1800;
    const x = Math.cos(a) * r, y = 650 + rnd() * 300, z = Math.sin(a) * r;
    for (const puff of cloud) puffs.push(puff.translate(x, y, z));
  }
  g.add(new THREE.Mesh(mergeGeometries(puffs)!, mat));
  return g;
}
