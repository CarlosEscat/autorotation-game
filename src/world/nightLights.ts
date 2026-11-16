import { mulberry32 } from './rng';
import { HILL, LandingArea, World } from './world';

export type NightLightKind = 'runwayEdge' | 'runwayEnd' | 'padEdge' | 'padLeg' | 'window' | 'hazard';

export interface NightLight {
  x: number;
  y: number;
  z: number;
  color: number;
  kind: NightLightKind;
  /** runwayEnd only: which end, along the runway's own length axis. */
  end?: -1 | 1;
}

/** Aviation colours, not the menu palette. */
export const LIGHT = { white: 0xfff4d6, green: 0x35ff7a, red: 0xff3b30, yellow: 0xffd23a, window: 0xffc77a };

const RUNWAY_SPACING = 50;
const END_ROW = 6;

/** A point in an area's own frame (x across, z along) to world space; matches a mesh with `rotation.y = rot`. */
const place = (cx: number, cz: number, rot: number, x: number, z: number) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: cx + x * c + z * s, z: cz - x * s + z * c };
};
const inArea = (a: LandingArea, x: number, z: number) => place(a.cx, a.cz, a.rotation, x, z);

/** Every light the world shows at night. The same list on every call. */
export function nightLights(world: World): NightLight[] {
  const out: NightLight[] = [];

  const runway = world.areas.find((a) => a.id === 'runway');
  if (runway) {
    const { halfWidth: hw, halfLength: hl } = runway;
    const y = runway.elevation + 0.4;
    for (const side of [-1, 1]) {
      for (let z = -hl; z <= hl + 1e-6; z += RUNWAY_SPACING) out.push({ ...inArea(runway, side * (hw + 1), z), y, color: LIGHT.white, kind: 'runwayEdge' });
    }
    for (const end of [-1, 1] as const) {
      for (let i = 0; i < END_ROW; i++) {
        out.push({ ...inArea(runway, -hw + (2 * hw * i) / (END_ROW - 1), end * (hl + 2)), y, color: LIGHT.green, kind: 'runwayEnd', end });
      }
    }
  }

  const pad = world.areas.find((a) => a.id === 'helipad');
  if (pad) {
    const { halfWidth: hw, halfLength: hl } = pad;
    const y = pad.elevation + 0.3;
    // The four corners, and two more along each side.
    const edge: [number, number][] = [];
    for (const t of [-1, -1 / 3, 1 / 3]) edge.push([t * hw, -hl], [hw, t * hl], [-t * hw, hl], [-hw, -t * hl]);
    for (const [x, z] of edge) out.push({ ...inArea(pad, x, z), y, color: LIGHT.green, kind: 'padEdge' });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      out.push({ ...inArea(pad, sx * (hw - 2), sz * (hl - 2)), y: world.waterLevel + 0.5, color: LIGHT.yellow, kind: 'padLeg' });
    }
  }

  // The world has only a handful of houses, so every one shows light: two or three windows, each on a different wall.
  const rnd = mulberry32(2026);
  for (const b of world.obstacles) {
    if (b.kind !== 'building') continue;
    const w = b.w ?? b.radius, d = b.d ?? b.radius;
    const count = 2 + Math.floor(rnd() * 2), first = Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const face = (first + i) % 4, along = (rnd() * 2 - 1) * 0.6, sign = face % 2 ? 1 : -1;
      const [x, z] = face < 2 ? [along * (w / 2), sign * (d / 2 + 0.05)] : [sign * (w / 2 + 0.05), along * (d / 2)];
      out.push({ ...place(b.x, b.z, b.rot ?? 0, x, z), y: b.base + b.height * 0.325, color: LIGHT.window, kind: 'window' });
    }
  }

  // Tall things beside where people land: the tower's own lamp is far too small to see from the air.
  for (const t of world.obstacles) if (t.kind === 'tower') out.push({ x: t.x, y: t.base + t.height + 0.3, z: t.z, color: LIGHT.red, kind: 'hazard' });
  out.push({ x: HILL.x, y: world.heightAt(HILL.x, HILL.z) + 3, z: HILL.z, color: LIGHT.red, kind: 'hazard' });
  return out;
}
