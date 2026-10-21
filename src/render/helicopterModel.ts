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
  const red = mat(0xc8432f), white = mat(0xf1ece0), dark = mat(0x3a3a40), glass = mat(0x7da6bd, { transparent: true, opacity: 0.85 });
  // Cabin: a lathed teardrop along Z, rounded nose forward (-Z), tapering into the tail cone.
  const profile = [[0, -1.95], [0.42, -1.82], [0.74, -1.45], [0.92, -0.85], [0.96, -0.15], [0.86, 0.5], [0.6, 0.95], [0.3, 1.3], [0, 1.4]];
  const cabinGeo = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), 10).rotateX(Math.PI / 2);
  const cabin = new THREE.Mesh(cabinGeo, red);
  cabin.scale.set(0.98, 0.92, 1);
  cabin.position.set(0, 0.2, -0.15);
  // Tinted canopy over the upper front of the cabin, following the same profile.
  const canopyGeo = new THREE.LatheGeometry(profile.slice(0, 6).map(([r, z]) => new THREE.Vector2(r * 1.03, z * 1.01)), 10, Math.PI - 1.25, 2.5).rotateX(Math.PI / 2);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  canopy.scale.copy(cabin.scale);
  canopy.position.copy(cabin.position).add(V(0, 0.04, 0));
  const belly = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 2.0), dark);
  belly.position.set(0, -0.62, -0.2);
  // Transmission/engine cowling behind the mast, with a fairing around the mast foot.
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.5, 1.3), white);
  cowl.position.set(0, 1.05, 0.65);
  const fairing = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.35, 6), white);
  fairing.position.set(0, 1.4, 0.05);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 6).rotateX(Math.PI / 2), dark);
  exhaust.position.set(0.25, 1.0, 1.4);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 6), dark);
  mast.position.set(0, A.hubHeight - 0.45, 0);
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), dark);
  hub.position.set(0, A.hubHeight, 0);
  // Tail boom tapering from the cabin to the tail rotor, with fins.
  const boomStart = 1.05, boomLen = A.tailBoomLength - boomStart + 0.15;
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, boomLen, 6).rotateX(Math.PI / 2), white);
  boom.position.set(0, 0.6, boomStart + boomLen / 2);
  boom.rotation.x = -0.03;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.55), red);
  fin.position.set(0, 1.05, A.tailBoomLength - 0.05);
  fin.rotation.x = -0.45;
  const ventral = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.4), red);
  ventral.position.set(0, 0.25, A.tailBoomLength - 0.05);
  ventral.rotation.x = 0.45;
  const stab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.34), red);
  stab.position.set(0, 0.55, A.tailBoomLength - 0.7);
  exterior.add(cabin, canopy, belly, cowl, fairing, exhaust, mast, hub, boom, fin, ventral, stab);
  for (const sx of [-1, 1]) {
    const y = -A.skidHeight;
    exterior.add(bar(V(sx * 1.05, y, -1.75), V(sx * 1.05, y, 1.45), 0.08, dark)); // skid
    exterior.add(bar(V(sx * 1.05, y, -1.75), V(sx * 1.05, y + 0.28, -2.1), 0.08, dark)); // upturned toe
    for (const z of [-0.95, 0.75]) {
      exterior.add(bar(V(sx * 1.05, y, z), V(sx * 0.82, -0.62, z), 0.07, dark)); // cross-tube leg
      exterior.add(bar(V(sx * 0.82, -0.62, z), V(0, -0.66, z), 0.07, dark));
    }
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.4), dark);
    step.position.set(sx * 0.9, -0.85, -0.95);
    exterior.add(step);
  }

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.17, 0.72, A.tailBoomLength);
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
    new THREE.CircleGeometry(A.rotorRadius, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x3a3a42, transparent: true, opacity: 0.03, side: THREE.DoubleSide, depthWrite: false }),
  );
  rotorDisc.position.set(0, A.hubHeight, 0);

  // --- Cockpit interior (pilot in the right seat) -----------------------------
  // A slim, low panel in matte warm charcoal: it reads clearly against the terrain and
  // stays below the HUD instruments, which sit just above the bottom of the screen.
  const panelMat = mat(0x3d3833), gaugeMat = mat(0x141414), rim = mat(0xcfc6b4), needleMat = mat(0xf0e6d0);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 0.06), panelMat);
  panel.position.set(0.12, -0.205, -1.62);
  panel.rotation.x = -0.75; // face tilted up towards the eye so the gauges read
  // Shallow glare shield along the top-back edge, so it doesn't hide the gauges.
  const glare = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.03, 0.08), mat(0x2a2623));
  glare.name = 'glare';
  glare.position.set(0.12, -0.12, -1.71);
  panel.add(...[-0.5, -0.25, 0, 0.25, 0.5].flatMap((x, i) => {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.02, 12).rotateX(Math.PI / 2), gaugeMat);
    g.position.set(x, 0.035, 0.035);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 3, 12), rim);
    r.position.copy(g.position);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.034, 0.004).translate(0, 0.017, 0), needleMat);
    needle.position.copy(g.position).add(V(0, 0, 0.012));
    needle.rotation.z = -0.9 + i * 0.45;
    return [g, r, needle];
  }));
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, 0.45), panelMat);
  pedestal.position.set(0, -0.6, -1.35);
  cockpit.add(panel, glare, pedestal);
  // No canopy frame: with the roof not modelled, pillars under a metre from the eye
  // only dead-end in the view, so the windscreen is left open.

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
