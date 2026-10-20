// Minimal 3D vector helpers for the simulation. Kept free of Three.js so the
// flight model can run headless (tests, tuning scripts).

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const hlen = (a: Vec3): number => Math.hypot(a.x, a.z);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
export const DEG = Math.PI / 180;

/**
 * Body axes for Euler angles applied in Y (yaw), X (pitch), Z (roll) order,
 * matching Three.js `rotation.order = 'YXZ'` with rotation.z = -roll.
 * Body frame: forward = -Z, up = +Y, right = +X.
 * pitch > 0 is nose up, roll > 0 is right wing down, yaw > 0 turns left.
 */
export function rotateBody(v: Vec3, yaw: number, pitch: number, roll: number): Vec3 {
  const g = -roll;
  const cg = Math.cos(g), sg = Math.sin(g);
  const x1 = v.x * cg - v.y * sg;
  const y1 = v.x * sg + v.y * cg;
  const z1 = v.z;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y2 = y1 * cp - z1 * sp;
  const z2 = y1 * sp + z1 * cp;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return v3(x1 * cy + z2 * sy, y2, -x1 * sy + z2 * cy);
}

export interface BodyAxes {
  forward: Vec3;
  up: Vec3;
  right: Vec3;
}

export function bodyAxes(yaw: number, pitch: number, roll: number): BodyAxes {
  return {
    forward: rotateBody(v3(0, 0, -1), yaw, pitch, roll),
    up: rotateBody(v3(0, 1, 0), yaw, pitch, roll),
    right: rotateBody(v3(1, 0, 0), yaw, pitch, roll),
  };
}
