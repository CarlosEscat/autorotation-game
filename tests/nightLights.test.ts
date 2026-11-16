import { describe, expect, it } from 'vitest';
import { LIGHT, NightLightKind, nightLights } from '../src/world/nightLights';
import { HILL, createWorld } from '../src/world/world';

const world = createWorld();
const lights = nightLights(world);
const of = (k: NightLightKind) => lights.filter((l) => l.kind === k);

describe('night lights', () => {
  it('lights both runway edges evenly', () => {
    const edge = of('runwayEdge');
    expect(edge).toHaveLength(32);
    const rw = world.areas.find((a) => a.id === 'runway')!;
    expect(edge.filter((l) => l.x < rw.cx)).toHaveLength(16); // runway rotation is 0
    expect(edge.every((l) => l.color === LIGHT.white)).toBe(true);
    const zs = edge.filter((l) => l.x < rw.cx).map((l) => l.z).sort((a, b) => a - b);
    for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeCloseTo(50, 3);
  });

  it('puts a row of six at each runway end', () => {
    const ends = of('runwayEnd');
    expect(ends.filter((l) => l.end === -1)).toHaveLength(6);
    expect(ends.filter((l) => l.end === 1)).toHaveLength(6);
  });

  it('rings the lake helipad at deck height and marks its legs at the water', () => {
    const pad = world.areas.find((a) => a.id === 'helipad')!;
    const edge = of('padEdge');
    expect(edge).toHaveLength(12);
    for (const l of edge) {
      expect(Math.max(Math.abs(l.x - pad.cx), Math.abs(l.z - pad.cz))).toBeCloseTo(pad.halfWidth, 3);
      expect(l.y).toBeCloseTo(pad.elevation + 0.3, 3);
    }
    expect(of('padLeg')).toHaveLength(4);
    expect(of('padLeg').every((l) => Math.abs(l.y - (world.waterLevel + 0.5)) < 1e-6)).toBe(true);
  });

  it('shows two or three lit windows on every house, each on its own house', () => {
    const houses = world.obstacles.filter((o) => o.kind === 'building');
    expect(houses.length).toBeGreaterThan(0);
    const on = (l: { x: number; z: number }, h: (typeof houses)[number]) => Math.hypot(l.x - h.x, l.z - h.z) <= h.radius + 0.1;
    for (const h of houses) {
      const n = of('window').filter((l) => on(l, h) && l.y > h.base && l.y < h.base + h.height).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
    }
    expect(of('window').every((l) => houses.some((h) => on(l, h)))).toBe(true);
  });

  it('marks Lookout Hill and gives the same lights every time', () => {
    const hz = of('hazard');
    expect(hz).toHaveLength(1);
    expect(Math.hypot(hz[0].x - HILL.x, hz[0].z - HILL.z)).toBeLessThan(1e-6);
    expect(hz[0].color).toBe(LIGHT.red);
    expect(nightLights(world)).toEqual(lights);
  });
});
