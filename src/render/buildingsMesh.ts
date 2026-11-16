import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Obstacle, World } from '../world/world';
import { PALETTE, lambert } from './materials';
import { mergeByMaterial, roundBox } from './modelKit';

/**
 * Every building of the world as a handful of draws: each building is modelled at its own origin with soft
 * occlusion baked towards its foot, then all are merged per material. Walls start below the ground, so a building
 * on a slight slope never floats. The control tower's beacon stays a separate object ('towerLight').
 */

const M = {
  wall: lambert(0xd9d6cc, { vertexColors: true, detail: 1 }),
  hangarWall: lambert(0xb7bec2, { vertexColors: true, detail: 1 }),
  roofMetal: lambert(0x8d959b, { vertexColors: true, detail: 1 }),
  door: lambert(0x6b7780, { vertexColors: true, detail: 1 }),
  rib: lambert(0x58626a, { vertexColors: true, detail: 1 }),
  glass: lambert(0x34505f, { vertexColors: true, detail: 0.25 }),
  trim: lambert(0x9a978f, { vertexColors: true, detail: 1 }),
  concrete: lambert(PALETTE.towerShaft, { vertexColors: true, detail: 1 }),
  white: lambert(PALETTE.towerTrim, { vertexColors: true, detail: 1 }),
  red: lambert(0xb5432f, { vertexColors: true, detail: 1 }),
  barn: lambert(PALETTE.barnWall, { vertexColors: true, detail: 1 }),
  house: lambert(PALETTE.houseWall, { vertexColors: true, detail: 1 }),
  roof: lambert(PALETTE.roof, { vertexColors: true, detail: 1 }),
  dark: lambert(0x3b3936, { vertexColors: true, detail: 1 }),
};

/** Below-ground depth of every wall, so a building on a gentle slope stays seated. */
const SINK = 1.5;

function box(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, radius = 0) {
  const mesh = radius > 0 ? roundBox(w, h, d, radius, m) : new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

/** Hangar with a curved roof, doors facing +X (towards the runway). */
function hangar(o: Obstacle): THREE.Group {
  const g = new THREE.Group(), w = o.w!, d = o.d!, eave = o.height - 5;
  box(g, w, eave + SINK, d, 0, (eave - SINK) / 2, 0, M.hangarWall);
  // Arched roof: a slice of cylinder spanning the width, rising 5 m.
  const rise = o.height - eave, R = ((d * d) / 4 + rise * rise) / (2 * rise), half = Math.asin(d / 2 / R);
  const roof = new THREE.CylinderGeometry(R, R, w + 0.6, 32, 1, true, Math.PI / 2 - half, half * 2).rotateZ(Math.PI / 2);
  const roofMesh = new THREE.Mesh(roof, M.roofMetal);
  roofMesh.position.y = eave - R * Math.cos(half);
  g.add(roofMesh);
  // Gable ends under the arch.
  const gable = new THREE.Shape();
  gable.moveTo(-d / 2, 0);
  gable.absarc(0, -R * Math.cos(half), R, Math.PI / 2 + half, Math.PI / 2 - half, true);
  gable.lineTo(-d / 2, 0);
  for (const side of [1, -1]) {
    const geo = new THREE.ShapeGeometry(gable, 16).rotateY((side * Math.PI) / 2).translate((side * w) / 2, eave, 0);
    g.add(new THREE.Mesh(geo, M.hangarWall));
  }
  // Big sliding doors with vertical ribs, a rail above them, and a strip of windows down each side.
  const doorH = eave + 2.2;
  box(g, 0.3, doorH, d - 2, w / 2 + 0.12, doorH / 2, 0, M.door);
  for (let k = -3; k <= 3; k++) box(g, 0.12, doorH, 0.18, w / 2 + 0.3, doorH / 2, (k * (d - 2)) / 7, M.rib);
  box(g, 0.5, 0.4, d - 1, w / 2 + 0.25, doorH + 0.2, 0, M.rib);
  for (const side of [1, -1]) box(g, w - 4, 1.1, 0.12, 0, eave - 1.4, (side * d) / 2, M.glass);
  return g;
}

/** Flat-roofed operations building with a band of windows and a roof unit. */
function office(o: Obstacle): THREE.Group {
  const g = new THREE.Group(), w = o.w!, d = o.d!, h = o.height;
  box(g, w, h + SINK, d, 0, (h - SINK) / 2, 0, M.wall);
  box(g, w + 0.12, 1.4, d - 2.5, 0, h * 0.55, 0, M.glass);
  box(g, w - 2.5, 1.4, d + 0.12, 0, h * 0.55, 0, M.glass);
  box(g, w + 0.5, 0.5, d + 0.5, 0, h + 0.15, 0, M.trim, 0.12); // parapet
  box(g, 2.4, 1.1, 3, -1, h + 0.9, 2, M.trim, 0.2); // air handling unit
  box(g, 0.15, 2.2, 1.6, w / 2 + 0.06, 1.1, -d / 4, M.dark); // door
  return g;
}

/** Fuel tank: white drum with a domed top and a red band, on a plinth. */
function tank(o: Obstacle): THREE.Group {
  const g = new THREE.Group(), r = o.radius, body = o.height - 0.8;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, body + SINK, 24), M.white);
  drum.position.y = (body - SINK) / 2;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
  dome.scale.y = 0.8 / r;
  dome.position.y = body;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.45, 24, 1, true), M.red);
  band.position.y = body * 0.72;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.35, r + 0.45, 0.4 + SINK, 24), M.concrete);
  plinth.position.y = (0.4 - SINK) / 2;
  g.add(drum, dome, band, plinth);
  return g;
}

/** Control tower: office block, round shaft, faceted glass cab with an overhanging roof and an antenna mast. */
function tower(o: Obstacle): THREE.Group {
  const g = new THREE.Group(), cab = o.height - 7;
  box(g, 11, 4 + SINK, 8, 5, (4 - SINK) / 2, 0, M.wall, 0.15);
  box(g, 11.1, 1.0, 6, 5, 2.4, 0, M.glass);
  box(g, 9, 1.0, 8.1, 5.5, 2.4, 0, M.glass);
  const cyl = (rt: number, rb: number, h: number, y: number, m: THREE.Material, seg = 20) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    c.position.y = y + h / 2;
    g.add(c);
  };
  cyl(2.1, 2.4, cab + SINK, -SINK, M.concrete);
  cyl(4.0, 3.3, 0.8, cab, M.white, 8); // cab floor, flaring out
  cyl(3.95, 3.4, 3.6, cab + 0.8, M.glass, 8); // glass leaning outwards, as tower cabs do
  cyl(4.5, 4.3, 0.6, cab + 4.4, M.white, 8); // overhanging roof
  cyl(1.2, 1.4, 0.5, cab + 5.0, M.trim, 12);
  cyl(0.1, 0.12, 1.8, cab + 5.2, M.trim, 6); // antenna mast
  return g;
}

/** Farm barn or house: walls, a pitched roof with eaves overhang, gable ends, doors and a chimney on the house. */
function farmBuilding(o: Obstacle): THREE.Group {
  const g = new THREE.Group(), w = o.w!, d = o.d!, barn = w > 12;
  const wallH = o.height * 0.65, roofH = o.height * 0.35, wall = barn ? M.barn : M.house;
  box(g, w, wallH + SINK, d, 0, (wallH - SINK) / 2, 0, wall);
  // Gable triangles in the wall colour, ridge along X.
  const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, roofH)]);
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2).rotateY(Math.PI / 2), wall);
  gable.position.y = wallH;
  g.add(gable);
  // Two roof planes overhanging the walls.
  const slope = Math.atan2(roofH, d / 2), len = Math.hypot(roofH, d / 2) + 0.6;
  for (const side of [-1, 1]) {
    const plane = box(g, w + 0.8, 0.22, len, 0, wallH + roofH / 2 + 0.12, (side * d) / 4 + side * 0.15, M.roof);
    plane.rotation.x = side * slope;
  }
  if (barn) {
    box(g, 0.12, wallH * 0.75, 4, w / 2 + 0.05, (wallH * 0.75) / 2, 0, M.dark); // barn door on the gable end
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.3, wallH + 0.1, 0.3, (x * w) / 2, wallH / 2, (z * d) / 2, M.white); // corner trim
  } else {
    box(g, 0.12, 2, 1, w / 2 + 0.05, 1, d / 5, M.dark);
    for (const z of [-d / 4, d / 4]) box(g, w * 0.18, 0.9, 0.1, 0, wallH * 0.6, (z > 0 ? 1 : -1) * (d / 2 + 0.03), M.glass);
    box(g, 0.7, roofH + 1, 0.7, w * 0.25, wallH + roofH * 0.7, -d * 0.15, M.dark); // chimney
  }
  return g;
}

function modelOf(o: Obstacle): THREE.Group | null {
  if (o.kind === 'tower') return tower(o);
  if (o.kind === 'tank') return tank(o);
  if (o.kind !== 'building') return null;
  if (o.style === 'hangar') return hangar(o);
  if (o.style === 'office') return office(o);
  return farmBuilding(o);
}

export function buildBuildings(world: World): THREE.Group {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const group = new THREE.Group();
  for (const o of world.obstacles) {
    const model = modelOf(o);
    if (!model) continue;
    const merged = mergeByMaterial(model, { occlusion: { low: -0.3, high: Math.min(6, o.height * 0.6), dark: 0.68 } });
    m4.compose(new THREE.Vector3(o.x, o.base, o.z), q.setFromAxisAngle(up, o.rot ?? 0), one);
    for (const child of merged.children) {
      const mesh = child as THREE.Mesh;
      if (!byMat.has(mesh.material as THREE.Material)) byMat.set(mesh.material as THREE.Material, []);
      byMat.get(mesh.material as THREE.Material)!.push(mesh.geometry.applyMatrix4(m4));
    }
    if (o.kind === 'tower') {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
      light.position.set(o.x, o.base + o.height + 0.1, o.z);
      light.name = 'towerLight';
      group.add(light);
    }
  }
  for (const [mat, geos] of byMat) group.add(new THREE.Mesh(mergeGeometries(geos)!, mat));
  return group;
}
