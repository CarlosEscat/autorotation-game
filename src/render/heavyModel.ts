import * as THREE from 'three';
import { AircraftSpec } from '../sim/aircraft';
import { HELI, tailRotorBlades } from './helicopterModel';
import { V, loft, mergeByMaterial, outline, panel, rod, roundBox, slab, tube } from './modelKit';

/** A wheel standing on the ground plane, axle along X: a rounded tyre round a metal hub. */
function wheel(x: number, y: number, z: number, radius: number, width: number): THREE.Mesh[] {
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius - width / 2, width / 2, 10, 24).rotateY(Math.PI / 2), HELI.tyre);
  tyre.position.set(x, y, z);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 0.9, 16).rotateZ(Math.PI / 2), HELI.metal);
  hub.position.set(x, y, z);
  return [tyre, hub];
}

/**
 * Airframe of the heavy firefighting helicopter: long cabin with the flight deck in the nose,
 * twin engines beside the rotor mast, a slim tail boom with a swept fin, wheels, and a belly water
 * tank with its snorkel hose stowed along the right side. Origin at the reference point under the mast.
 */
export function buildHeavyExterior(A: AircraftSpec): { exterior: THREE.Group; tailRotor: THREE.Group } {
  const parts = new THREE.Group();
  const { redHeavy: red, white, trimHeavy: dark, yellow, glass, metal } = HELI;

  // --- Fuselage: nose, cabin, and the belly sweeping up into the tail boom, as rounded sections ---
  const nose = loft([[-6.1, 0.3, -0.6, -0.2], [-5.6, 0.78, -0.85, 0.1]], 0.28, dark);
  const body = loft(
    [[-5.6, 0.78, -0.85, 0.1], [-3.7, 1.18, -0.9, 1.15], [2.6, 1.18, -0.9, 1.2], [3.8, 0.75, -0.55, 1.1], [5.0, 0.42, 0, 1.0], [9.2, 0.2, 0.5, 0.98]],
    0.42,
    red,
    3,
  );
  parts.add(nose, body);

  // Windscreen on the sloping nose, cockpit side windows, cabin windows and a white cheat line, all with rounded corners.
  const windscreen = slab(1.36, 1.95, 0.25, 0.05, glass);
  windscreen.position.set(0, 0.69, -4.62);
  windscreen.rotation.x = -Math.atan2(1.05, 1.9);
  parts.add(windscreen);
  for (const sx of [-1, 1]) {
    const side = panel(1.0, 0.55, 0.16, 0.05, glass);
    side.position.set(sx * 1.14, 0.5, -3.95);
    side.rotation.y = sx * 0.21;
    parts.add(side);
    for (const z of [-2.3, -0.9]) {
      const w = panel(0.95, 0.5, 0.15, 0.05, glass);
      w.position.set(sx * 1.17, 0.5, z);
      parts.add(w);
    }
    const stripe = panel(5.9, 0.2, 0.1, 0.04, white);
    stripe.position.set(sx * 1.175, -0.05, -0.4);
    parts.add(stripe);
  }

  // --- Engines and transmission on the cabin roof ---
  parts.add(loft([[-1.9, 0.3, 1.18, 1.3], [-0.9, 0.56, 1.18, 1.82], [2.5, 0.56, 1.18, 1.82], [3.9, 0.28, 1.05, 1.4]], 0.22, white, 3));
  for (const sx of [-1, 1]) {
    const nacelle = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.7, 6, 18).rotateX(Math.PI / 2), white);
    nacelle.position.set(sx * 0.84, 1.45, 1.25);
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 18).rotateX(Math.PI / 2), dark);
    intake.position.set(sx * 0.84, 1.45, 0.02);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.6, 16, 1, true).rotateX(Math.PI / 2), dark);
    exhaust.position.set(sx * 0.9, 1.45, 2.7);
    parts.add(nacelle, intake, exhaust);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, A.hubHeight - 1.75, 14), dark);
  mast.position.set(0, (A.hubHeight + 1.75) / 2, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 20), dark);
  hub.position.set(0, A.hubHeight, 0);
  parts.add(mast, hub);

  // --- Tail: swept fin, wide stabilator, tail rotor high on the right side ---
  const T = A.tailBoomLength;
  const fin = outline([[T - 1.7, 0.9], [T - 0.6, 0.45], [T - 0.1, 0.6], [T + 0.55, 3.0], [T - 0.15, 3.0], [T - 0.9, 1.05]], 0.26, red);
  const finTip = roundBox(0.3, 0.3, 0.74, 0.12, white);
  finTip.position.set(0, 3.0, T + 0.2);
  const stab = slab(4.0, 0.95, 0.4, 0.07, red);
  stab.position.set(0, 0.72, T - 0.35);
  parts.add(fin, finTip, stab);

  // --- Landing gear: two main wheels under the cabin front, one tail wheel ---
  const gy = -A.skidHeight;
  for (const sx of [-1, 1]) {
    const x = sx * A.gearHalfTrack;
    parts.add(...wheel(x, gy + 0.38, -A.gearFront, 0.38, 0.3));
    parts.add(rod(V(x, gy + 0.42, -A.gearFront), V(sx * 1.05, -0.55, -A.gearFront), 0.07, metal));
    parts.add(rod(V(x, gy + 0.42, -A.gearFront), V(sx * 1.1, -0.75, -0.2), 0.05, metal));
  }
  parts.add(...wheel(0, gy + 0.25, A.gearRear, 0.25, 0.2));
  parts.add(rod(V(0, gy + 0.3, A.gearRear - 0.05), V(0, -0.1, A.gearRear - 0.8), 0.065, metal));

  // --- Belly water tank with a yellow band, and the snorkel hose stowed along the right side ---
  parts.add(loft([[-2.8, 0.6, -1.25, -0.9], [-2.3, 1.05, -1.42, -0.88], [1.5, 1.05, -1.42, -0.88], [2.0, 0.6, -1.25, -0.9]], 0.2, dark, 3));
  parts.add(loft([[-0.65, 1.07, -1.44, -0.88], [-0.15, 1.07, -1.44, -0.88]], 0.2, yellow));
  parts.add(tube([V(1.12, -1.15, -0.9), V(1.22, -1.1, 0.2), V(1.27, -1.07, 1.2), V(1.27, -1.02, 2.5)], 0.085, dark, 24, 10));
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 14).rotateX(Math.PI / 2), metal);
  pump.position.set(1.27, -1.01, 2.7);
  parts.add(pump);

  const exterior = mergeByMaterial(parts, { occlusion: { low: -1.6, high: 1.6, dark: 0.62 } });
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.36, 2.55, T + 0.1);
  tailRotor.add(tailRotorBlades(3.2, 0.22, 0.04, HELI.blade, true));
  exterior.add(tailRotor);
  return { exterior, tailRotor };
}
