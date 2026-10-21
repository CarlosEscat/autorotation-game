import * as THREE from 'three';
import { AIRCRAFT as A } from '../sim/aircraft';

const mat = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

/** A box stretched between two points, used for frames, tubes and struts. */
function bar(from: THREE.Vector3, to: THREE.Vector3, thickness: number, material: THREE.Material): THREE.Mesh {
  const len = from.distanceTo(to);
  const m = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, len), material);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.lookAt(to);
  return m;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface HelicopterModel {
  root: THREE.Group;
  exterior: THREE.Group;
  /** Copy of the exterior that only draws into the shadow map, for the cockpit view. */
  shadowProxy: THREE.Group;
  cockpit: THREE.Group;
  rotor: THREE.Group;
  rotorDisc: THREE.Mesh;
  tailRotor: THREE.Group;
  cyclic: THREE.Group;
  collective: THREE.Group;
  eye: THREE.Object3D;
}

export function buildHelicopter(): HelicopterModel {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const exterior = new THREE.Group();
  const cockpit = new THREE.Group();

  // --- Exterior -------------------------------------------------------------
  const red = mat(0xd23a2a), white = mat(0xeeeeee), dark = mat(0x333338), glass = mat(0x88b8d8, { transparent: true, opacity: 0.55 });
  const cabin = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), red);
  cabin.scale.set(1.0, 0.95, 1.5);
  cabin.position.set(0, 0.2, -0.3);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(0.95, 0.9, 1.1);
  canopy.position.set(0, 0.35, -0.9);
  canopy.rotation.x = -0.9;
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, A.tailBoomLength - 0.8, 6).rotateX(Math.PI / 2), white);
  boom.position.set(0, 0.45, (A.tailBoomLength + 0.8) / 2);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.6), red);
  fin.position.set(0, 0.9, A.tailBoomLength - 0.1);
  fin.rotation.x = -0.35;
  const stab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.35), red);
  stab.position.set(0, 0.4, A.tailBoomLength - 0.6);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.0, 5), dark);
  mast.position.set(0, A.hubHeight - 0.5, 0);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.0), white);
  engine.position.set(0, 1.1, 0.9);
  exterior.add(cabin, canopy, boom, fin, stab, mast, engine);
  for (const sx of [-1, 1]) {
    exterior.add(bar(V(sx * 1.05, -A.skidHeight, -1.9), V(sx * 1.05, -A.skidHeight, 1.6), 0.09, dark));
    exterior.add(bar(V(sx * 1.05, -A.skidHeight, -1.9), V(sx * 1.05, -A.skidHeight + 0.25, -2.2), 0.09, dark));
    for (const z of [-0.9, 0.8]) exterior.add(bar(V(sx * 1.05, -A.skidHeight, z), V(sx * 0.5, -0.55, z), 0.08, dark));
  }

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.2, 0.75, A.tailBoomLength);
  for (const a of [0, Math.PI / 2]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.2, 0.12), white);
    b.rotation.x = a;
    tailRotor.add(b);
  }
  exterior.add(tailRotor);

  // --- Main rotor (visible in both views) ------------------------------------
  const rotor = new THREE.Group();
  rotor.position.set(0, A.hubHeight, 0);
  const bladeMat = mat(0x222226);
  for (const s of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(A.rotorRadius, 0.04, 0.28), bladeMat);
    blade.position.x = (s * A.rotorRadius) / 2;
    rotor.add(blade);
  }
  const rotorDisc = new THREE.Mesh(
    new THREE.CircleGeometry(A.rotorRadius, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x202024, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  rotorDisc.position.set(0, A.hubHeight, 0);

  // --- Cockpit interior (pilot in the right seat) -----------------------------
  const frame = mat(0x50505a), panelMat = mat(0x2c2c33), gaugeMat = mat(0x0e0e10), rim = mat(0xbfbfbf);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.34, 0.08), panelMat);
  panel.position.set(0.12, -0.14, -1.6);
  panel.rotation.x = -0.45;
  const glare = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.04, 0.26), mat(0x1d1d22));
  glare.position.set(0.12, 0.03, -1.58);
  panel.add(...[-0.5, -0.25, 0, 0.25, 0.5].flatMap((x, i) => {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10).rotateX(Math.PI / 2), gaugeMat);
    g.position.set(x, i % 2 ? 0.05 : -0.04, 0.05);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.007, 3, 10), rim);
    r.position.copy(g.position);
    return [g, r];
  }));
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, 0.45), panelMat);
  pedestal.position.set(0, -0.55, -1.35);
  cockpit.add(panel, glare, pedestal);
  for (const sx of [-1, 1]) {
    cockpit.add(bar(V(sx * 0.92, 0.02, -1.75), V(sx * 0.7, 1.3, -0.85), 0.045, frame)); // A-pillar
    cockpit.add(bar(V(sx * 0.92, 0.02, -1.75), V(sx * 0.98, -0.8, -1.4), 0.045, frame)); // lower front frame
    cockpit.add(bar(V(sx * 0.98, -0.75, -0.15), V(sx * 0.8, 1.3, -0.15), 0.08, frame)); // door post
  }
  cockpit.add(bar(V(0, 0.05, -1.75), V(0, 1.32, -0.8), 0.035, frame)); // centre windshield bar
  cockpit.add(bar(V(-0.66, 1.3, -0.85), V(0.66, 1.3, -0.85), 0.07, frame)); // roof edge
  cockpit.add(bar(V(-0.8, 1.3, -0.15), V(0.8, 1.3, -0.15), 0.07, frame));

  const cyclic = new THREE.Group();
  cyclic.position.set(0.36, -0.7, -0.95);
  cyclic.rotation.order = 'XZY';
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.62, 5), dark);
  stick.position.y = 0.31;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), mat(0x111111));
  grip.position.y = 0.66;
  cyclic.add(stick, grip);
  const collective = new THREE.Group();
  collective.position.set(-0.08, -0.55, -0.15);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 5).rotateX(Math.PI / 2), dark);
  lever.position.z = -0.35;
  const throttle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 6).rotateX(Math.PI / 2), mat(0x111111));
  throttle.position.z = -0.68;
  collective.add(lever, throttle);
  cockpit.add(cyclic, collective);

  const eye = new THREE.Object3D();
  eye.position.set(0.36, 0.58, -0.72);
  cockpit.add(eye);

  const shadowProxy = exterior.clone();
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  shadowProxy.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = shadowOnly;
  });

  root.add(exterior, shadowProxy, cockpit, rotor, rotorDisc);
  return { root, exterior, shadowProxy, cockpit, rotor, rotorDisc, tailRotor, cyclic, collective, eye };
}
