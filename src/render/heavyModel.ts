import * as THREE from 'three';
import { AircraftSpec } from '../sim/aircraft';
import { V, bar, mat } from './helicopterModel';

/** One cross-section of a lofted body: half-width and bottom/top height at a station along Z. */
type Station = [z: number, halfWidth: number, yBottom: number, yTop: number];

/**
 * A body lofted through box sections with chamfered corners (eight points per section),
 * capped at both ends. Good for fuselages, cowlings and tanks in the flat-shaded style.
 */
function loft(stations: Station[], chamfer: number, material: THREE.Material): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [z, hw, y0, y1] of stations) {
    const c = Math.min(chamfer, hw * 0.6, (y1 - y0) * 0.4);
    const ring = [[hw - c, y0], [hw, y0 + c], [hw, y1 - c], [hw - c, y1], [c - hw, y1], [-hw, y1 - c], [-hw, y0 + c], [c - hw, y0]];
    for (const [x, y] of ring) pos.push(x, y, z);
  }
  for (let s = 0; s + 1 < stations.length; s++) {
    for (let i = 0; i < 8; i++) {
      const a = s * 8 + i, b = s * 8 + ((i + 1) % 8), c = a + 8, d = b + 8;
      idx.push(a, b, d, a, d, c);
    }
  }
  const last = (stations.length - 1) * 8;
  for (let i = 1; i < 7; i++) idx.push(0, i, i + 1, last, last + i + 1, last + i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

/** A wheel standing on the ground plane, axle along X. */
function wheel(x: number, y: number, z: number, radius: number, width: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 10).rotateZ(Math.PI / 2), material);
  m.position.set(x, y, z);
  return m;
}

/**
 * Airframe of the heavy firefighting helicopter: long boxy cabin with the flight deck in the nose,
 * twin engines beside the rotor mast, a slim tail boom with a swept fin, wheels, and a belly water
 * tank with its snorkel hose stowed along the right side. Origin at the reference point under the mast.
 */
export function buildHeavyExterior(A: AircraftSpec): { exterior: THREE.Group; tailRotor: THREE.Group } {
  const exterior = new THREE.Group();
  const double = { side: THREE.DoubleSide };
  const red = mat(0xc23a2b, double), white = mat(0xf1ece0, double), dark = mat(0x2c2d33, double), tyre = mat(0x1c1c20);
  const yellow = mat(0xe8b530, double), glass = mat(0x1f3040), metal = mat(0x8a8d93);

  // --- Fuselage: nose, cabin, and the belly sweeping up into the tail boom ---
  const nose = loft([[-6.1, 0.3, -0.6, -0.2], [-5.6, 0.78, -0.85, 0.1]], 0.28, dark);
  const body = loft(
    [[-5.6, 0.78, -0.85, 0.1], [-3.7, 1.18, -0.9, 1.15], [2.6, 1.18, -0.9, 1.2], [3.8, 0.75, -0.55, 1.1], [5.0, 0.42, 0, 1.0], [9.2, 0.2, 0.5, 0.98]],
    0.28,
    red,
  );
  exterior.add(nose, body);

  // Windscreen on the sloping nose, cockpit side windows, cabin windows and a white cheat line.
  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 1.95), glass);
  windscreen.position.set(0, 0.69, -4.62);
  windscreen.rotation.x = -Math.atan2(1.05, 1.9);
  exterior.add(windscreen);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 1.0), glass);
    side.position.set(sx * 1.14, 0.5, -3.95);
    side.rotation.y = sx * 0.21;
    exterior.add(side);
    for (const z of [-2.3, -0.9]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.95), glass);
      w.position.set(sx * 1.17, 0.5, z);
      exterior.add(w);
    }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 5.9), white);
    stripe.position.set(sx * 1.175, -0.05, -0.4);
    exterior.add(stripe);
  }

  // --- Engines and transmission on the cabin roof ---
  const doghouse = loft([[-1.9, 0.3, 1.18, 1.3], [-0.9, 0.56, 1.18, 1.82], [2.5, 0.56, 1.18, 1.82], [3.9, 0.28, 1.05, 1.4]], 0.14, white);
  exterior.add(doghouse);
  for (const sx of [-1, 1]) {
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.5, 8).rotateX(Math.PI / 2), white);
    nacelle.position.set(sx * 0.84, 1.45, 1.25);
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8).rotateX(Math.PI / 2), dark);
    intake.position.set(sx * 0.84, 1.45, -0.02);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.6, 8).rotateX(Math.PI / 2), dark);
    exhaust.position.set(sx * 0.9, 1.45, 2.7);
    exterior.add(nacelle, intake, exhaust);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, A.hubHeight - 1.75, 6), dark);
  mast.position.set(0, (A.hubHeight + 1.75) / 2, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 8), dark);
  hub.position.set(0, A.hubHeight, 0);
  exterior.add(mast, hub);

  // --- Tail: swept fin, wide stabilator, tail rotor high on the right side ---
  const T = A.tailBoomLength;
  const finShape = new THREE.Shape([[T - 1.7, 0.9], [T - 0.6, 0.45], [T - 0.1, 0.6], [T + 0.55, 3.0], [T - 0.15, 3.0], [T - 0.9, 1.05]].map(([z, y]) => new THREE.Vector2(z, y)));
  const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.26, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.13, 0, 0), red);
  const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.74), white);
  finTip.position.set(0, 3.0, T + 0.2);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.07, 0.95), red);
  stab.position.set(0, 0.72, T - 0.35);
  exterior.add(fin, finTip, stab);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.36, 2.55, T + 0.1);
  for (const a of [0, Math.PI / 2]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.2, 0.22), dark);
    b.rotation.x = a;
    tailRotor.add(b);
  }
  exterior.add(tailRotor);

  // --- Landing gear: two main wheels under the cabin front, one tail wheel ---
  const gy = -A.skidHeight;
  for (const sx of [-1, 1]) {
    const x = sx * A.gearHalfTrack;
    exterior.add(wheel(x, gy + 0.38, -A.gearFront, 0.38, 0.3, tyre));
    exterior.add(bar(V(x, gy + 0.42, -A.gearFront), V(sx * 1.05, -0.55, -A.gearFront), 0.13, metal));
    exterior.add(bar(V(x, gy + 0.42, -A.gearFront), V(sx * 1.1, -0.75, -0.2), 0.09, metal));
  }
  exterior.add(wheel(0, gy + 0.25, A.gearRear, 0.25, 0.2, tyre));
  exterior.add(bar(V(0, gy + 0.3, A.gearRear - 0.05), V(0, -0.1, A.gearRear - 0.8), 0.12, metal));

  // --- Belly water tank with a yellow band, and the snorkel hose stowed along the right side ---
  const tank = loft([[-2.8, 0.6, -1.25, -0.9], [-2.3, 1.05, -1.42, -0.88], [1.5, 1.05, -1.42, -0.88], [2.0, 0.6, -1.25, -0.9]], 0.16, dark);
  const band = loft([[-0.65, 1.07, -1.44, -0.88], [-0.15, 1.07, -1.44, -0.88]], 0.16, yellow);
  exterior.add(tank, band);
  exterior.add(bar(V(1.12, -1.15, -0.9), V(1.27, -1.08, 0.7), 0.17, dark));
  exterior.add(bar(V(1.27, -1.08, 0.7), V(1.27, -1.02, 2.5), 0.17, dark));
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 8).rotateX(Math.PI / 2), metal);
  pump.position.set(1.27, -1.01, 2.7);
  exterior.add(pump);

  return { exterior, tailRotor };
}
