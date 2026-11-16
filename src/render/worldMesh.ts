import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bothFaces, roundBox } from './modelKit';
import { LandingArea, World } from '../world/world';
import { mulberry32 } from '../world/rng';
import { PALETTE, lambert } from './materials';
import { buildBuildings } from './buildingsMesh';
import { buildForests } from './vegetation';
import { withSurfaceDetail } from './surfaceDetail';

// --- Obstacles ----------------------------------------------------------------------------
// Trees and undergrowth live in vegetation.ts, buildings in buildingsMesh.ts; boulders are drawn here.

/**
 * A weathered boulder: a sphere pushed in and out by layered waves, its base flattened where it sits in the ground,
 * smooth-shaded, darker at the foot and with a little lichen green on the faces that look up.
 */
function boulder(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const bump = 0.16 * Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.y * 2.7 + 0.4) * Math.sin(v.z * 3.3 + 2.1) + 0.07 * Math.sin(v.x * 7.3 + v.z * 5.1);
    v.multiplyScalar(1 + bump);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const smooth = mergeVertices(g);
  smooth.computeVertexNormals();
  const n = smooth.attributes.normal, pos = smooth.attributes.position, col = new Float32Array(pos.count * 3);
  const foot = new THREE.Color(0x67625a), top = new THREE.Color(0xa29b8d), lichen = new THREE.Color(0x8b9566), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(foot).lerp(top, THREE.MathUtils.clamp((pos.getY(i) + 0.4) / 1.3, 0, 1)).lerp(lichen, 0.4 * Math.max(0, n.getY(i) - 0.5) * 2);
    c.toArray(col, i * 3);
  }
  smooth.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return smooth;
}

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

  const rockMesh = new THREE.InstancedMesh(boulder(), lambert(0xffffff, { vertexColors: true, detail: 1.2 }), rocks.length);
  rocks.forEach((r, i) => {
    sv.set(r.radius, r.height * 0.8, r.radius * 0.9);
    m4.compose(pv.set(r.x, r.base + r.height * 0.25, r.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), sv);
    rockMesh.setMatrixAt(i, m4);
    rockMesh.setColorAt(i, tint.setScalar(0.88 + rnd() * 0.22));
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
  const asphalt = withSurfaceDetail(new THREE.MeshLambertMaterial({ map: runwaySurface(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0.5);
  const paint = lambert(PALETTE.runwayPaint, { detail: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
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
  const deck = lambert(PALETTE.deck, { detail: 0.8 });
  const slab = roundBox(hw * 2, 1, hl * 2, 0.2, deck);
  slab.position.y = -0.5;
  g.add(slab);
  // Legs with cross-braces between them, and a safety net sloping out below the deck edge.
  const steel = lambert(PALETTE.deckLegs, { detail: 0.8 });
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
  g.add(new THREE.Mesh(bothFaces(mergeGeometries(net)!), lambert(0x3a3d3f, { detail: 0.5, transparent: true, opacity: 0.75 })));
  // Markings are merged per colour: two draws for the whole deck.
  const yellow = lambert(PALETTE.padYellow, { detail: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
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
  const markerMat = lambert(PALETTE.marker, { detail: 0.4 });
  // Striped sock: orange and white bands along its length, baked into the vertices.
  const sockMat = lambert(0xffffff, { vertexColors: true, detail: 0.4 });
  const poleMat = lambert(PALETTE.mast, { detail: 0.4 });
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
    const sockGeo = bothFaces(mergeGeometries(bands)!);
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

/**
 * The day sky: from the horizon colour of the far haze (so fogged ground meets it without a seam) up to blue, a
 * warm glow round the sun, and the sun itself as a soft disc. The renderer keeps it centred on the camera.
 */
export function buildSky(sunDir: THREE.Vector3, horizon: THREE.Color): THREE.Mesh {
  const R = 4000;
  const geo = new THREE.SphereGeometry(R, 48, 24);
  const colors: number[] = [];
  const top = new THREE.Color(0x4a82cc), glow = new THREE.Color(0xffe0ac), band = new THREE.Color(0xf2dcc0);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, p.getY(i) / R);
    c.copy(horizon).lerp(top, Math.pow(t, 0.55));
    // A thin warm band just above the horizon, strongest towards the sun.
    const toSun = Math.max(0, v.fromBufferAttribute(p, i).normalize().dot(sunDir));
    c.lerp(band, 0.35 * (1 - THREE.MathUtils.smoothstep(t, 0, 0.12)) * (0.4 + 0.6 * toSun));
    c.lerp(glow, 0.7 * Math.pow(toSun, 7));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  const sun = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshBasicMaterial({ map: sunTexture(), transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }),
  );
  sun.position.copy(sunDir).multiplyScalar(R * 0.95);
  sun.lookAt(0, 0, 0);
  sky.add(sun);
  return sky;
}

/** A bright core with a wide, faint halo, drawn additively over the sky. */
function sunTexture(): THREE.CanvasTexture {
  const S = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop(0.08, 'rgba(255,246,220,1)');
  g.addColorStop(0.11, 'rgba(255,230,180,0.45)');
  g.addColorStop(0.35, 'rgba(255,215,160,0.12)');
  g.addColorStop(1, 'rgba(255,210,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** One soft cumulus puff: a cluster of round blobs, sunlit on top and grey-warm underneath, with soft edges. */
function puffTexture(): THREE.CanvasTexture {
  const S = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(21);
  for (let k = 0; k < 9; k++) {
    const x = S * (0.3 + rnd() * 0.4), y = S * (0.42 + rnd() * 0.2), r = S * (0.14 + rnd() * 0.14);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Shade: keep the alpha, darken towards the bottom (the underside facing away from the sun).
  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(0, S * 0.25, 0, S * 0.8);
  shade.addColorStop(0, 'rgba(255,252,244,1)');
  shade.addColorStop(1, 'rgba(176,172,170,1)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Clouds as soft puffs that always face the camera: every puff is one quad, turned towards the eye in the vertex
 * shader, so the whole sky is one draw. The material's colour tints them (the renderer darkens it at night).
 */
export function buildClouds(): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry32(11);
  const centres: number[] = [], corners: number[] = [], sizes: number[] = [], uvs: number[] = [], idx: number[] = [];
  let n = 0;
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = 600 + rnd() * 1800;
    const cx = Math.cos(a) * r, cy = 650 + rnd() * 300, cz = Math.sin(a) * r;
    const puffs = 5 + Math.floor(rnd() * 4);
    for (let k = 0; k < puffs; k++) {
      const t = puffs > 1 ? k / (puffs - 1) - 0.5 : 0;
      const x = cx + t * 170 + (rnd() - 0.5) * 30, y = cy + (rnd() - 0.3) * 18 + (0.5 - Math.abs(t)) * 22, z = cz + (rnd() - 0.5) * 60;
      const size = (38 + rnd() * 34) * (1.1 - Math.abs(t) * 0.6);
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        centres.push(x, y, z);
        corners.push(u * 1.5, v * 0.85);
        sizes.push(size);
        uvs.push((u + 1) / 2, (v + 1) / 2);
      }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(centres, 3));
  geo.setAttribute('puffCorner', new THREE.Float32BufferAttribute(corners, 2));
  geo.setAttribute('puffSize', new THREE.Float32BufferAttribute(sizes, 1));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: puffTexture(), transparent: true, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute vec2 puffCorner;\nattribute float puffSize;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      mvPosition.xy += puffCorner * puffSize;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  mat.customProgramCacheKey = () => 'cloud-puff';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // the bound is of the puff centres only
  mesh.renderOrder = -1; // behind everything transparent nearer the eye
  g.add(mesh);
  return g;
}
