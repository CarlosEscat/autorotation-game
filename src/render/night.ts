import * as THREE from 'three';
import { mulberry32 } from '../world/rng';

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
