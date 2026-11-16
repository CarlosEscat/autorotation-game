import * as THREE from 'three';
import { AircraftId } from '../sim/aircraft';
import { LIGHT } from '../world/nightLights';
import { buildGlows } from './night';

export interface HeliLights {
  /** Position lights, beacon and landing-light lens: glows seen from outside. */
  group: THREE.Group;
  beacon: THREE.Object3D;
  /** The landing light: the one real light of the night scene. */
  spot: THREE.SpotLight;
  /** Faint glow over the dashboard so it reads in the cockpit view. */
  panelGlow: THREE.Mesh;
}

type P = [number, number, number];
/** Where each light sits, in the model's own space (nose is -Z, left is -X). */
const LIGHT_POINTS: Record<AircraftId, { left: P; right: P; tail: P; top: P; nose: P; size: number }> = {
  light: { left: [-1.0, 0.2, -0.3], right: [1.0, 0.2, -0.3], tail: [0, 0.6, 6.8], top: [0, 1.38, 0.9], nose: [0, -0.5, -1.7], size: 0.9 },
  heavy: { left: [-1.25, 0.2, -1.5], right: [1.25, 0.2, -1.5], tail: [0, 1.0, 9.85], top: [0, 1.35, 3.2], nose: [0, -0.75, -5.5], size: 1.4 },
};

/** How far below the nose line the landing light points. */
const LANDING_LIGHT_DIP = 0.44; // rad, about 25°

export function buildHeliLights(id: AircraftId): HeliLights {
  const L = LIGHT_POINTS[id];
  const at = ([x, y, z]: P, color: number) => ({ x, y, z, color });
  const group = new THREE.Group();
  const steady = buildGlows([at(L.left, LIGHT.red), at(L.right, LIGHT.green), at(L.tail, 0xffffff), at(L.nose, 0xfff1d0)], L.size);
  const beacon = buildGlows([at(L.top, LIGHT.red)], L.size * 1.5);
  group.add(steady, beacon);
  group.visible = false;

  const spot = new THREE.SpotLight(0xfff1d0, 70, 120, 0.5, 0.6, 1);
  spot.position.set(...L.nose);
  spot.target.position.set(L.nose[0], L.nose[1] - Math.sin(LANDING_LIGHT_DIP) * 10, L.nose[2] - Math.cos(LANDING_LIGHT_DIP) * 10);
  spot.visible = false;

  const panelGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.2).translate(0, 0, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  // Laid over the dashboard face: same place and tilt as the panel in the shared cockpit.
  panelGlow.position.set(0.12, -0.205, -1.62);
  panelGlow.rotation.x = -0.75;
  panelGlow.visible = false;
  return { group, beacon, spot, panelGlow };
}
