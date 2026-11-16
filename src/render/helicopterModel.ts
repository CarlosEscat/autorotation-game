import * as THREE from 'three';
import { HeliLights, buildHeliLights } from './heliLights';
import { AIRCRAFT, AIRCRAFT_TYPES, AircraftId, AircraftSpec } from '../sim/aircraft';
import { buildHeavyExterior } from './heavyModel';
import { PALETTE, lambert, paint } from './materials';
import { V, bladeGeometry, mergeByMaterial, outline, roundBox, slab, tube } from './modelKit';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Matte, smooth-shaded material for the cockpit interior. */
export const mat = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => lambert(color, { flatShading: false, ...extra });

export interface HelicopterModel {
  root: THREE.Group;
  exterior: THREE.Group;
  /** Copy of the exterior that only draws into the shadow map, for the cockpit view. */
  shadowProxy: THREE.Group;
  cockpit: THREE.Group;
  rotor: THREE.Group;
  rotorDisc: THREE.Mesh;
  /** Translucent blurred blade sweeps, used instead of the disc in the cockpit view. */
  rotorSweep: THREE.Group;
  tailRotor: THREE.Group;
  cyclic: THREE.Group;
  collective: THREE.Group;
  eye: THREE.Object3D;
  /** Night only: position lights, beacon, landing light and dashboard glow. */
  lights: HeliLights;
}

/** Paint for both helicopters: glossy, lit by the sky's environment map, with baked occlusion in the vertices. */
export const HELI = {
  red: paint(PALETTE.paintRed, 0.36, 0.05, { vertexColors: true }),
  redHeavy: paint(PALETTE.paintRedHeavy, 0.4, 0.05, { vertexColors: true }),
  white: paint(PALETTE.paintWhite, 0.4, 0.05, { vertexColors: true }),
  yellow: paint(PALETTE.paintYellow, 0.45, 0.05, { vertexColors: true }),
  trim: paint(PALETTE.trim, 0.55, 0.3, { vertexColors: true }),
  trimHeavy: paint(PALETTE.trimHeavy, 0.55, 0.3, { vertexColors: true }),
  metal: paint(PALETTE.metal, 0.35, 0.8, { vertexColors: true }),
  tyre: paint(PALETTE.tyre, 0.85, 0, { vertexColors: true }),
  glass: paint(0x50758c, 0.04, 0.55, { vertexColors: true }),
  // Parts that turn are not merged and carry no baked occlusion.
  blade: paint(PALETTE.blade, 0.5, 0.25),
  bladeTip: paint(PALETTE.paintWhite, 0.4, 0.05),
};

/** The light trainer's cabin: a teardrop along Z, nose forward (-Z), radius per station. */
const CABIN_PROFILE: [r: number, z: number][] = [[0, -1.95], [0.42, -1.82], [0.74, -1.45], [0.92, -0.85], [0.96, -0.15], [0.86, 0.5], [0.6, 0.95], [0.3, 1.3], [0, 1.4]];

/** The profile resampled along a smooth curve, so the lathe has no corners. */
function smoothProfile(scaleR = 1, scaleZ = 1, maxZ = Infinity): THREE.Vector2[] {
  const curve = new THREE.CatmullRomCurve3(CABIN_PROFILE.map(([r, z]) => new THREE.Vector3(r, z, 0)), false, 'centripetal');
  return curve.getSpacedPoints(22).filter((p) => p.y <= maxZ).map((p) => new THREE.Vector2(Math.max(0, p.x) * scaleR, p.y * scaleZ));
}

/** Geometry reduced to non-indexed position and normal, so differently built parts can be merged. */
export function bare(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  return out;
}

/** Two-blade tail rotor: one tapered blade through the hub, turned about X by the renderer. */
export function tailRotorBlades(span: number, chord: number, thickness: number, material: THREE.Material, crossed: boolean): THREE.Mesh {
  const one = () => {
    const g = bladeGeometry(0.06, span / 2 - 0.06, chord, chord * 0.75, thickness);
    return mergeGeometries([g.clone(), g.clone().rotateY(Math.PI)])!;
  };
  // Blades lie along X: a quarter turn about Z makes them span along Y, thin along X.
  const geos = [one().rotateZ(Math.PI / 2)];
  if (crossed) geos.push(geos[0].clone().rotateX(Math.PI / 2));
  const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12).rotateZ(Math.PI / 2);
  return new THREE.Mesh(mergeGeometries([...geos, hub].map(bare))!, material);
}

/** The light trainer's airframe; returns the group and its tail rotor. */
function buildLightExterior(): { exterior: THREE.Group; tailRotor: THREE.Group } {
  const A = AIRCRAFT;
  const { red, white, trim, glass } = HELI;
  const parts = new THREE.Group();

  // Cabin: a smooth lathed teardrop, slightly narrower than tall.
  const cabin = new THREE.Mesh(new THREE.LatheGeometry(smoothProfile(), 28).rotateX(Math.PI / 2), red);
  cabin.scale.set(0.98, 0.92, 1);
  cabin.position.set(0, 0.2, -0.15);
  // Bubble canopy over the upper front, a hair proud of the cabin, following the same curve.
  const canopy = new THREE.Mesh(new THREE.LatheGeometry(smoothProfile(1.035, 1.01, 0.55), 18, Math.PI - 1.3, 2.6).rotateX(Math.PI / 2), glass);
  canopy.scale.copy(cabin.scale);
  canopy.position.copy(cabin.position).add(V(0, 0.03, 0));
  // Slim frame along the canopy's edge: down each side, then over the top at the back.
  const edge = (phi: number, r: number, z: number) => V(1.045 * r * Math.sin(phi) * 0.98, 0.23 - 1.045 * r * Math.cos(phi) * 0.92, 1.01 * z - 0.15);
  const rim = smoothProfile().filter((p) => p.y <= 0.55 && p.y > -1.9);
  const back = rim[rim.length - 1];
  const arch = Array.from({ length: 9 }, (_, k) => edge(Math.PI - 1.3 + (2.6 * k) / 8, back.x, back.y));
  const frame = tube([...rim.map((p) => edge(Math.PI - 1.3, p.x, p.y)), ...arch.slice(1, -1), ...rim.slice().reverse().map((p) => edge(Math.PI + 1.3, p.x, p.y))], 0.022, trim, 64, 6);
  parts.add(frame);
  // Rounded belly pan.
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), trim);
  belly.scale.set(0.6, 0.11, 1.05);
  belly.position.set(0, -0.6, -0.2);
  // Engine and transmission cowling behind the mast, with a fairing round the mast foot.
  const cowl = roundBox(0.82, 0.5, 1.3, 0.17, white);
  cowl.position.set(0, 1.05, 0.65);
  const fairing = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.35, 20), white);
  fairing.position.set(0, 1.4, 0.05);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.4, 14, 1, true).rotateX(Math.PI / 2), trim);
  exhaust.position.set(0.25, 1.0, 1.4);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 12), trim);
  mast.position.set(0, A.hubHeight - 0.45, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 16), trim);
  hub.position.set(0, A.hubHeight, 0);
  // Tail boom tapering from the cabin to the tail rotor, with a rounded tip.
  const boomStart = 1.05, boomLen = A.tailBoomLength - boomStart + 0.15;
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, boomLen, 16).rotateX(Math.PI / 2), white);
  boom.position.set(0, 0.6, boomStart + boomLen / 2);
  boom.rotation.x = -0.03;
  const gearbox = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 8), white);
  gearbox.scale.set(1.1, 1, 1.4);
  gearbox.position.set(0.04, 0.72, A.tailBoomLength);
  // Swept fins and the horizontal stabiliser, with softened edges.
  const fin = outline([[-0.32, -0.55], [0.26, -0.55], [0.2, 0.55], [-0.1, 0.55]], 0.06, red);
  fin.position.set(0, 1.05, A.tailBoomLength - 0.05);
  fin.rotation.x = -0.45;
  const ventral = outline([[-0.2, -0.27], [0.18, -0.27], [0.12, 0.27], [-0.2, 0.27]], 0.06, red);
  ventral.position.set(0, 0.25, A.tailBoomLength - 0.05);
  ventral.rotation.x = 0.45;
  const stab = slab(1.2, 0.34, 0.14, 0.05, red);
  stab.position.set(0, 0.55, A.tailBoomLength - 0.7);
  parts.add(cabin, canopy, belly, cowl, fairing, exhaust, mast, hub, boom, gearbox, fin, ventral, stab);

  // Skids: one bent tube each, toe swept up at the front. The tube's underside sits on the ground plane.
  const r = 0.045, y = -A.skidHeight + r + 0.03;
  for (const sx of [-1, 1]) {
    const x = sx * 1.05;
    parts.add(tube([V(x, y, 1.45), V(x, y, 0), V(x, y, -1.6), V(x, y + 0.08, -1.92), V(x, y + 0.28, -2.1)], r, trim, 24));
    const step = roundBox(0.22, 0.04, 0.4, 0.015, trim, 1);
    step.position.set(sx * 0.9, -0.85, -0.95);
    parts.add(step);
  }
  // Cross-tubes: one bowed tube from skid to skid under the cabin.
  for (const z of [-0.95, 0.75]) {
    parts.add(tube([V(-1.05, y, z), V(-0.93, -0.78, z), V(-0.72, -0.63, z), V(0, -0.67, z), V(0.72, -0.63, z), V(0.93, -0.78, z), V(1.05, y, z)], 0.038, trim, 18));
  }

  const exterior = mergeByMaterial(parts, { occlusion: { low: -1.2, high: 1.1, dark: 0.62 } });
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.17, 0.72, A.tailBoomLength);
  tailRotor.add(tailRotorBlades(1.2, 0.12, 0.03, HELI.bladeTip, true));
  exterior.add(tailRotor);
  return { exterior, tailRotor };
}

/** Main rotor (visible in both views): blades, the blurred disc and the cockpit-view sweeps. */
function buildRotor(A: AircraftSpec) {
  const rotor = new THREE.Group();
  rotor.position.set(0, A.hubHeight, 0);
  const bladeAngles = Array.from({ length: A.bladeCount }, (_, i) => (i * Math.PI * 2) / A.bladeCount);
  // Tapered blades with white tips (the tips are what the eye follows on a turning rotor), merged into two draws.
  const tipLen = A.rotorRadius * 0.07;
  const blades: THREE.BufferGeometry[] = [], tips: THREE.BufferGeometry[] = [];
  for (const a of bladeAngles) {
    blades.push(bare(bladeGeometry(0.12, A.rotorRadius - 0.12 - tipLen, A.bladeChord, A.bladeChord * 0.82, 0.045).rotateY(a)));
    // Blade grip: a short round root fitting from the hub out to the blade.
    blades.push(bare(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 10).rotateZ(Math.PI / 2).translate(0.15, 0, 0).rotateY(a)));
    tips.push(bare(bladeGeometry(A.rotorRadius - tipLen, tipLen, A.bladeChord * 0.82, A.bladeChord * 0.78, 0.045).rotateY(a)));
  }
  rotor.add(new THREE.Mesh(mergeGeometries(blades)!, HELI.blade));
  rotor.add(new THREE.Mesh(mergeGeometries(tips)!, HELI.bladeTip));
  const rotorDisc = new THREE.Mesh(
    new THREE.CircleGeometry(A.rotorRadius, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x3a3a42, transparent: true, opacity: 0.03, side: THREE.DoubleSide, depthWrite: false }),
  );
  rotorDisc.position.set(0, A.hubHeight, 0);
  // Each blade leaves a wedge-shaped blur, densest at the blade and fading out behind it
  // and towards the tip (per-vertex alpha). The renderer turns it at a capped speed so it never strobes.
  const rotorSweep = new THREE.Group();
  rotorSweep.position.set(0, A.hubHeight, 0);
  const sweepMat = new THREE.MeshBasicMaterial({ color: 0x2a2a30, vertexColors: true, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const SWEEP_WIDTH = 0.8; // rad of trailing blur behind each blade
  for (const start of bladeAngles) {
    const geo = new THREE.RingGeometry(0.5, A.rotorRadius, 20, 4, start, SWEEP_WIDTH);
    const p = geo.attributes.position, rgba: number[] = [];
    for (let i = 0; i < p.count; i++) {
      let behind = (Math.atan2(p.getY(i), p.getX(i)) - start) % (Math.PI * 2);
      if (behind < 0) behind += Math.PI * 2;
      const t = Math.min(1, behind / SWEEP_WIDTH);
      const tip = 1 - THREE.MathUtils.smoothstep(Math.hypot(p.getX(i), p.getY(i)), A.rotorRadius * 0.8, A.rotorRadius);
      rgba.push(1, 1, 1, (1 - t) * (1 - t) * (0.25 + 0.75 * tip));
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4));
    rotorSweep.add(new THREE.Mesh(geo.rotateX(Math.PI / 2), sweepMat));
  }
  return { rotor, rotorDisc, rotorSweep };
}

/** Cockpit interior (pilot in the right seat), shared by both types. */
function buildCockpit() {
  const cockpit = new THREE.Group();
  const dark = mat(0x3a3a40);
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
  return { cockpit, cyclic, collective, eye };
}

export function buildHelicopter(id: AircraftId = 'light'): HelicopterModel {
  const A = AIRCRAFT_TYPES[id].spec;
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const { exterior, tailRotor } = id === 'heavy' ? buildHeavyExterior(A) : buildLightExterior();
  const { rotor, rotorDisc, rotorSweep } = buildRotor(A);
  const { cockpit, cyclic, collective, eye } = buildCockpit();
  // The heavy type's flight deck is in the nose, well ahead of the rotor mast.
  if (id === 'heavy') cockpit.position.set(0.2, 0.05, -3.4);

  const shadowProxy = exterior.clone();
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  shadowProxy.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = shadowOnly;
  });

  const lights = buildHeliLights(id);
  cockpit.add(lights.panelGlow);
  root.add(exterior, shadowProxy, cockpit, rotor, rotorDisc, rotorSweep, lights.group, lights.spot, lights.spot.target);
  return { lights, root, exterior, shadowProxy, cockpit, rotor, rotorDisc, rotorSweep, tailRotor, cyclic, collective, eye };
}
