import * as THREE from 'three';
import { LAKE, LandingArea, Surface, World } from '../world/world';
import { mulberry32, valueNoise } from '../world/rng';

// Two tones per surface, blended by the same low-frequency noise as the grass.
const SURFACE_COLORS: Record<Exclude<Surface, 'grass' | 'water'>, [number, number]> = {
  field: [0x7aac52, 0x88b85c], // mow stripes
  strip: [0xa38a64, 0xb09670],
  paved: [0x707068, 0x7a7870],
  rough: [0x8a8564, 0x9c9472],
};

const tmpColor = new THREE.Color();

// Two grass tones blended by low-frequency noise, then tinted by altitude.
const GRASS_A = new THREE.Color(0x4f9450), GRASS_B = new THREE.Color(0x8cb85a);
const LOWLAND = new THREE.Color(0xc2bd6a), HIGHLAND = new THREE.Color(0x3f6b5e);
const DISTANT = new THREE.Color(0x7d8a68), SAND = new THREE.Color(0xc9b07a);

/** Flat-shaded terrain, coloured with smooth blends and only a faint per-triangle jitter. */
export function buildTerrain(world: World): THREE.Mesh {
  const n = world.cells + 1;
  const cell = world.size / world.cells;
  const half = world.size / 2;
  const tris = world.cells * world.cells * 2;
  const pos = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 9);
  const rnd = mulberry32(42);
  const color = new THREE.Color(), grass = new THREE.Color();
  let p = 0;

  const vx = (i: number) => -half + i * cell;
  const h = (i: number, j: number) => world.heights[j * n + i];

  const pushTri = (ax: number, az: number, ay: number, bx: number, bz: number, by: number, cx: number, cz: number, cy: number) => {
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
    const surface = world.surfaceAt(mx, mz);
    const y = (ay + by + cy) / 3;
    const blend = 0.65 * valueNoise(mx / 260, mz / 260, 5) + 0.35 * valueNoise(mx / 90, mz / 90, 9);
    grass.copy(GRASS_A).lerp(GRASS_B, THREE.MathUtils.smoothstep(blend, 0.25, 0.75));
    // Golden on the low ground, darker and cooler up the hills.
    grass.lerp(LOWLAND, 0.25 * (1 - THREE.MathUtils.smoothstep(y, -10, 30)));
    grass.lerp(HIGHLAND, 0.7 * THREE.MathUtils.smoothstep(y, 40, 260));
    const r = Math.hypot(mx, mz);
    if (r > 1200) grass.lerp(DISTANT, Math.min(1, (r - 1200) / 400));
    if (surface === 'grass' || surface === 'water') color.copy(grass);
    else {
      const [c0, c1] = SURFACE_COLORS[surface];
      const area = surface === 'field' ? world.areaAt(mx, mz) : undefined;
      const t = area ? (mowStripe(area, mx, mz) ? 1 : 0) : THREE.MathUtils.smoothstep(valueNoise(mx / 30, mz / 30, 13), 0.2, 0.8);
      color.setHex(c0).lerp(tmpColor.setHex(c1), t);
      // Triangles straddling the area edge go halfway to grass, softening the sawtooth outline.
      const inside = [[ax, az], [bx, bz], [cx, cz]].filter(([x, z]) => world.surfaceAt(x, z) === surface).length;
      if (inside < 3) color.lerp(grass, 0.5);
    }
    if (ay < world.waterLevel + 1.5 && Math.hypot(mx - LAKE.x, mz - LAKE.z) < LAKE.r * 1.2) color.copy(SAND);
    color.multiplyScalar(0.98 + rnd() * 0.04);
    for (const [x, yy, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
      pos[p] = x; pos[p + 1] = yy; pos[p + 2] = z;
      col[p] = color.r; col[p + 1] = color.g; col[p + 2] = color.b;
      p += 3;
    }
  };

  for (let j = 0; j < world.cells; j++) {
    for (let i = 0; i < world.cells; i++) {
      const x0 = vx(i), x1 = vx(i + 1), z0 = vx(j), z1 = vx(j + 1);
      // Same diagonal as World.heightAt: (i+1,j) — (i,j+1). Counter-clockwise seen from above.
      pushTri(x0, z0, h(i, j), x0, z1, h(i, j + 1), x1, z0, h(i + 1, j));
      pushTri(x1, z0, h(i + 1, j), x0, z1, h(i, j + 1), x1, z1, h(i + 1, j + 1));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

function mowStripe(a: LandingArea, x: number, z: number) {
  const dx = x - a.cx, dz = z - a.cz;
  const lx = dx * Math.cos(a.rotation) - dz * Math.sin(a.rotation);
  return Math.floor((lx + 1000) / 20) % 2 === 0;
}

export function buildWater(world: World): THREE.Mesh {
  const geo = new THREE.CircleGeometry(LAKE.r * 1.15, 32);
  geo.rotateX(-Math.PI / 2);
  // Deep teal in the middle, lighter towards the shallow shore.
  const deep = new THREE.Color(0x2f6788), shallow = new THREE.Color(0x5f9cae), c = new THREE.Color();
  const p = geo.attributes.position, colors: number[] = [];
  for (let i = 0; i < p.count; i++) {
    c.copy(deep).lerp(shallow, Math.hypot(p.getX(i), p.getZ(i)) / (LAKE.r * 1.15));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
  m.position.set(LAKE.x, world.waterLevel, LAKE.z);
  return m;
}

export function buildObstacles(world: World): THREE.Group {
  const group = new THREE.Group();
  const trees = world.obstacles.filter((o) => o.kind === 'tree');
  const rocks = world.obstacles.filter((o) => o.kind === 'rock');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sv = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const tint = new THREE.Color();
  const rnd = mulberry32(7);

  const trunkGeo = new THREE.CylinderGeometry(0.06, 0.09, 1, 5).translate(0, 0.5, 0);
  const pineGeo = new THREE.ConeGeometry(0.25, 0.8, 6).translate(0, 0.6, 0);
  const roundGeo = new THREE.IcosahedronGeometry(0.3, 0).translate(0, 0.62, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2b, flatShading: true }), trees.length);
  const pines = trees.filter((t) => t.variant === 0);
  const rounds = trees.filter((t) => t.variant === 1);
  const pineMesh = new THREE.InstancedMesh(pineGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), pines.length);
  const roundMesh = new THREE.InstancedMesh(roundGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), rounds.length);

  trees.forEach((t, i) => {
    sv.set(t.height, t.height, t.height);
    m4.compose(pv.set(t.x, t.base - 0.3, t.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), sv);
    trunks.setMatrixAt(i, m4);
  });
  const fill = (list: typeof trees, mesh: THREE.InstancedMesh, base: number) =>
    list.forEach((t, i) => {
      sv.set(t.height, t.height, t.height);
      m4.compose(pv.set(t.x, t.base - 0.3, t.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), sv);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, tint.setHex(base).multiplyScalar(0.8 + rnd() * 0.35));
    });
  fill(pines, pineMesh, 0x2f6b34);
  fill(rounds, roundMesh, 0x4d8a2e);
  group.add(trunks, pineMesh, roundMesh);

  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMesh = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), rocks.length);
  rocks.forEach((r, i) => {
    sv.set(r.radius, r.height * 0.8, r.radius * 0.9);
    m4.compose(pv.set(r.x, r.base + r.height * 0.25, r.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), sv);
    rockMesh.setMatrixAt(i, m4);
    rockMesh.setColorAt(i, tint.setHex(0x8a8580).multiplyScalar(0.8 + rnd() * 0.3));
  });
  group.add(rockMesh);

  for (const b of world.obstacles.filter((o) => o.kind === 'building')) {
    const house = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(b.w!, b.height * 0.65, b.d!), new THREE.MeshLambertMaterial({ color: b.w! > 12 ? 0xa33a2c : 0xd9cfb4, flatShading: true }));
    walls.position.y = (b.height * 0.65) / 2;
    const roofGeo = new THREE.CylinderGeometry(0.001, 1, 1, 4, 1).rotateY(Math.PI / 4);
    roofGeo.scale(b.w! * 0.75, b.height * 0.35, b.d! * 0.75);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0x4a4a52, flatShading: true }));
    roof.position.y = b.height * 0.65 + (b.height * 0.35) / 2;
    house.add(walls, roof);
    house.position.set(b.x, b.base, b.z);
    house.rotation.y = b.rot ?? 0;
    group.add(house);
  }
  for (const t of world.obstacles.filter((o) => o.kind === 'tower')) group.add(buildTower(t.x, t.base, t.z, t.height));
  return group;
}

/** Airport control tower: concrete shaft, glazed cab, roof, antenna with a red light. */
function buildTower(x: number, base: number, z: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const mat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const box = (w: number, h: number, d: number, y: number, color: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.y = y + h / 2;
    g.add(m);
    return m;
  };
  const cab = height - 7;
  box(11, 4, 8, 0, 0xcfc8b6).position.x = 5; // ground-floor office
  box(4, cab, 4, 0, 0xd9d4c5); // shaft
  box(7.6, 0.8, 7.6, cab, 0xf0f0f0);
  box(7, 3.6, 7, cab + 0.8, 0x2c4a63); // glass
  box(7.8, 0.8, 7.8, cab + 4.4, 0xf0f0f0); // roof
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 4), mat(0xdddddd));
  mast.position.y = cab + 6.1;
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
  light.position.y = cab + 7.1;
  g.add(mast, light);
  g.position.set(x, base, z);
  return g;
}

/** Asphalt and white markings over each paved area: edges, centreline, thresholds, aiming points. */
export function buildRunways(world: World): THREE.Group {
  const group = new THREE.Group();
  const asphalt = new THREE.MeshLambertMaterial({ color: 0x4b4d50, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const paint = new THREE.MeshLambertMaterial({ color: 0xf2f2ee, flatShading: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  for (const a of world.areas.filter((r) => r.surface === 'paved' && r.deckHeight === undefined)) {
    const g = new THREE.Group();
    const hw = a.halfWidth, hl = a.halfLength;
    const strip = (mat: THREE.Material, w: number, l: number, x: number, z: number, y: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), mat);
      m.position.set(x, y, z);
      g.add(m);
    };
    strip(asphalt, hw * 2, hl * 2, 0, 0, 0.06);
    const line = (w: number, l: number, x: number, z: number) => strip(paint, w, l, x, z, 0.1);
    for (const side of [-1, 1]) {
      line(0.9, hl * 2 - 2, side * (hw - 1.2), 0); // edge lines
      for (let k = 0; k < 4; k++) line(1.6, 30, side * (3 + k * 2.8), side * (hl - 21)); // threshold stripes
      for (const x of [-6, 6]) line(3, 45, x, side * (hl - 150)); // aiming points
    }
    for (let z = -hl + 90; z <= hl - 90; z += 60) line(0.9, 30, 0, z); // centreline dashes
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
  const mat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const hw = a.halfWidth, hl = a.halfLength;
  // Light deck and bold, wide markings so the pad still reads at range; size and collision are unchanged.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 1, hl * 2), mat(0x8e9294));
  slab.position.y = -0.5;
  g.add(slab);
  const legMat = mat(0x9a9c9c);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 16, 6), legMat);
    leg.position.set(sx * (hw - 2), -9, sz * (hl - 2));
    g.add(leg);
  }
  const flat = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo.rotateX(-Math.PI / 2), m);
    mesh.position.set(x, 0.03, z);
    g.add(mesh);
  };
  const yellow = new THREE.MeshLambertMaterial({ color: 0xffd23a, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  for (const side of [-1, 1]) {
    flat(new THREE.PlaneGeometry(hw * 2, 1.4), yellow, 0, side * (hl - 0.7)); // edge band
    flat(new THREE.PlaneGeometry(1.4, hl * 2 - 2.8), yellow, side * (hw - 0.7), 0);
    flat(new THREE.PlaneGeometry(2.0, 11), paint, side * 3.6, 0); // H uprights
  }
  flat(new THREE.PlaneGeometry(5.2, 2.0), paint); // H crossbar
  flat(new THREE.RingGeometry(7.4, 8.6, 32), yellow);
  g.add(buildPadMarker());
  g.position.set(a.cx, a.elevation, a.cz);
  g.rotation.y = a.rotation;
  return g;
}

/**
 * Constant screen-size ring over a small pad so it can be found from far away. Named
 * 'padMarker'; the renderer fades it in with distance and hides it up close.
 */
function buildPadMarker(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#ffd23a';
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 32, 7, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false }));
  sprite.name = 'padMarker';
  sprite.scale.set(0.028, 0.028, 1);
  sprite.position.y = 3;
  return sprite;
}

/** Corner markers and a windsock for each landing area. */
export function buildAreaMarkers(world: World, windFromDeg: number, windKt: number): THREE.Group {
  const group = new THREE.Group();
  const markerMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const sockMat = new THREE.MeshLambertMaterial({ color: 0xff6a1a, flatShading: true });
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
  for (const a of world.areas) {
    const c = Math.cos(a.rotation), s = Math.sin(a.rotation);
    const toWorld = (lx: number, lz: number) => ({ x: a.cx + lx * c + lz * s, z: a.cz - lx * s + lz * c });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = toWorld(sx * a.halfWidth, sz * a.halfLength);
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.2, 4), markerMat);
      m.position.set(p.x, world.heightAt(p.x, p.z) + 0.6, p.z);
      group.add(m);
    }
    const p = a.deckHeight === undefined ? toWorld(a.halfWidth + 6, -a.halfLength * 0.6) : toWorld(a.halfWidth - 1, -a.halfLength + 1);
    const ground = world.heightAt(p.x, p.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 4), poleMat);
    pole.position.set(p.x, ground + 3, p.z);
    const sockGeo = new THREE.ConeGeometry(0.45, 2.6, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 1.3);
    const sock = new THREE.Mesh(sockGeo, sockMat);
    sock.material.side = THREE.DoubleSide;
    // The sock (wide end at the pole, along +Z) streams downwind: heading = from + 180°.
    const to = ((windFromDeg + 180) * Math.PI) / 180;
    sock.position.set(p.x, ground + 5.8, p.z);
    sock.rotation.order = 'YXZ';
    sock.rotation.y = Math.atan2(Math.sin(to), -Math.cos(to));
    sock.rotation.x = windKt < 2 ? 1.2 : Math.max(0, 0.9 - windKt / 15);
    group.add(pole, sock);
  }
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
  for (let i = 0; i < 26; i++) {
    const cloud = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(30 + rnd() * 30, 1), mat);
      puff.position.set(k * 40 - 60, rnd() * 6, rnd() * 30);
      puff.scale.set(1.3, 0.28, 1);
      cloud.add(puff);
    }
    const a = rnd() * Math.PI * 2, r = 600 + rnd() * 1800;
    cloud.position.set(Math.cos(a) * r, 650 + rnd() * 300, Math.sin(a) * r);
    g.add(cloud);
  }
  return g;
}
