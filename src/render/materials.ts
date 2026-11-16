import * as THREE from 'three';

/**
 * The art direction in one place: every colour a model or the world is painted with, and the factories that turn
 * them into materials. Materials are cached by colour and options, so identical surfaces share one material
 * (fewer shader switches). Never mutate a material returned from here: build your own for anything that changes
 * colour at run time (gates, beacon, clouds).
 */
export const PALETTE = {
  // Helicopter paint
  paintRed: 0xc8432f,
  paintRedHeavy: 0xc23a2b,
  paintWhite: 0xf1ece0,
  paintYellow: 0xe8b530,
  trim: 0x3a3a40,
  trimHeavy: 0x2c2d33,
  metal: 0x8a8d93,
  tyre: 0x1c1c20,
  blade: 0x222226,
  glass: 0x7da6bd,
  glassHeavy: 0x1f3040,
  // Cockpit
  panel: 0x3d3833,
  glareShield: 0x2a2623,
  gauge: 0x141414,
  gaugeRim: 0xcfc6b4,
  needle: 0xf0e6d0,
  grip: 0x111111,
  // Structures
  asphalt: 0x54534f,
  runwayPaint: 0xf0ebdf,
  padYellow: 0xffd23a,
  deck: 0x8e9294,
  deckLegs: 0x9a9c9c,
  barnWall: 0xa94a36,
  houseWall: 0xe2d6bb,
  roof: 0x5b5652,
  towerOffice: 0xd2c9b4,
  towerShaft: 0xddd5c2,
  towerTrim: 0xeeeae0,
  towerGlass: 0x3b5a6e,
  mast: 0xdddddd,
  marker: 0xf4efe4,
  windsock: 0xf2692a,
} as const;

/**
 * World surfaces are still faceted (stage 2 smooths them); the helicopters are not.
 * Flip to compare the two looks side by side.
 */
export const FLAT_WORLD = true;

const cache = new Map<string, THREE.Material>();
const keyOf = (kind: string, color: number, extra: object) => `${kind}:${color}:${JSON.stringify(extra)}`;

/** Matte, cheap: everything in the world. */
export function lambert(color: number, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const key = keyOf('lambert', color, extra);
  let m = cache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) cache.set(key, (m = new THREE.MeshLambertMaterial({ color, flatShading: FLAT_WORLD, ...extra })));
  return m;
}

/**
 * Physically based paint, only for the helicopter on screen (one object, so the extra cost per pixel is small).
 * Reflects the scene's environment map, which the renderer builds from the sky.
 */
export function paint(color: number, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = keyOf('paint', color, { roughness, metalness, ...extra });
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) cache.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })));
  return m;
}
