import * as THREE from 'three';
import { mulberry32 } from '../world/rng';
import { LIGHT, NightLight } from '../world/nightLights';

export const MOON_DIR = new THREE.Vector3(0.45, 0.42, -0.79).normalize();

/** The moonlit look. Tuned by eye: the lake shore, the runway and Lookout Hill must stay readable from 1000 ft. */
export const NIGHT = {
  horizon: 0x101a2c, // fog and background
  zenith: 0x03050b,
  hemiSky: 0x33456b,
  hemiGround: 0x0a0d12,
  hemi: 0.5,
  moon: 0x9fb4e0,
  moonPower: 0.45,
  cloud: 0x1a2233,
  cloudGlow: 0x0b0f18,
  /** Multiplier for colours that ignore lighting (the target beacon), so paint does not shine like a lamp. */
  unlit: 0.35,
  blobShadow: 0.12,
};

const SKY_R = 4000;

/** Night dome: dark gradient with a soft glow round the moon, a moon disc and stars. Three draws. */
export function buildNightSky(moonDir: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.SphereGeometry(SKY_R, 32, 16);
  const colors: number[] = [];
  const top = new THREE.Color(NIGHT.zenith), horizon = new THREE.Color(NIGHT.horizon), glow = new THREE.Color(0x3a4c78);
  const c = new THREE.Color(), v = new THREE.Vector3();
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    c.copy(horizon).lerp(top, Math.pow(Math.max(0, p.getY(i) / SKY_R), 0.5));
    c.lerp(glow, 0.7 * Math.pow(Math.max(0, v.fromBufferAttribute(p, i).normalize().dot(moonDir)), 10));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));

  const moon = new THREE.Mesh(new THREE.CircleGeometry(95, 24), new THREE.MeshBasicMaterial({ color: 0xf3f0e2, fog: false, depthWrite: false }));
  moon.position.copy(moonDir).multiplyScalar(SKY_R * 0.95);
  moon.lookAt(0, 0, 0);

  const rnd = mulberry32(11);
  const stars: number[] = [], tint: number[] = [];
  for (let i = 0; i < 600; i++) {
    // Even over the upper hemisphere, a little above the horizon haze.
    const y = 0.06 + rnd() * 0.94, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y), b = 0.35 + rnd() * 0.65;
    stars.push(Math.cos(a) * r * SKY_R * 0.97, y * SKY_R * 0.97, Math.sin(a) * r * SKY_R * 0.97);
    tint.push(b, b, Math.min(1, b * 1.08));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
  starGeo.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3));
  const points = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true }));
  points.frustumCulled = false;

  sky.add(moon, points);
  return sky;
}

/** Soft round glow, drawn once and shared by every light. */
function glowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.38, 'rgba(255,255,255,1)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // No mipmaps: a far light is a few pixels wide and must keep its bright core, not the average of the whole glow.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Glowing points that never light anything. Far lights keep a few pixels so a runway still reads from across the map. */
function glowMaterial(map: THREE.Texture, vertexColors: boolean): THREE.PointsMaterial {
  const m = new THREE.PointsMaterial({ map, size: 14, sizeAttenuation: true, vertexColors, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <logdepthbuf_vertex>', 'gl_PointSize = max(gl_PointSize, 8.0);\n#include <logdepthbuf_vertex>');
  };
  return m;
}

const pointsOf = (lights: NightLight[], material: THREE.PointsMaterial, dim: (l: NightLight) => number = () => 1) => {
  const geo = new THREE.BufferGeometry();
  const c = new THREE.Color();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(lights.flatMap((l) => [l.x, l.y, l.z]), 3));
  if (material.vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute(lights.flatMap((l) => c.setHex(l.color).multiplyScalar(dim(l)).toArray()), 3));
  return new THREE.Points(geo, material);
};

/**
 * Every world light as three draws: one for all steady lights, and one per runway end row,
 * so each end can be turned green or red by setting its material colour.
 */
export function buildWorldLights(lights: NightLight[]): { group: THREE.Group; ends: Record<-1 | 1, THREE.Points> } {
  const map = glowTexture();
  const group = new THREE.Group();
  const steady = pointsOf(lights.filter((l) => l.kind !== 'runwayEnd'), glowMaterial(map, true), (l) => (l.kind === 'window' ? 0.6 : 1));
  const end = (e: -1 | 1) => pointsOf(lights.filter((l) => l.kind === 'runwayEnd' && l.end === e), glowMaterial(map, false));
  const ends = { [-1]: end(-1), 1: end(1) } as Record<-1 | 1, THREE.Points>;
  for (const e of [-1, 1] as const) (ends[e].material as THREE.PointsMaterial).color.setHex(LIGHT.green);
  group.add(steady, ends[-1], ends[1]);
  return { group, ends };
}
