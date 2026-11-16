import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/world/world';

const world = createWorld();
const runway = world.areas.find((a) => a.id === 'runway')!;
const airport = world.obstacles.filter((o) => o.style || o.kind === 'tank' || o.kind === 'tower');

describe('airport buildings', () => {
  it('has a tower, a hangar, an operations building and two fuel tanks', () => {
    expect(airport.filter((o) => o.kind === 'tower')).toHaveLength(1);
    expect(airport.filter((o) => o.style === 'hangar')).toHaveLength(1);
    expect(airport.filter((o) => o.style === 'office')).toHaveLength(1);
    expect(airport.filter((o) => o.kind === 'tank')).toHaveLength(2);
  });

  it('keeps every building out of the runway clear zone and its approaches', () => {
    for (const o of airport) {
      const lx = Math.abs(o.x - runway.cx), lz = Math.abs(o.z - runway.cz);
      const clear = lx - o.radius >= runway.halfWidth + 60 || lz - o.radius >= runway.halfLength + 250;
      expect(clear).toBe(true);
    }
  });

  it('stands on open ground, clear of every tree and rock', () => {
    for (const o of airport) {
      const others = world.obstacles.filter((t) => (t.kind === 'tree' || t.kind === 'rock') && Math.hypot(t.x - o.x, t.z - o.z) < o.radius + t.radius + 3);
      expect(others).toHaveLength(0);
    }
  });

  it('is found by collision queries right up to its edge', () => {
    const hangar = airport.find((o) => o.style === 'hangar')!;
    expect(hangar.radius).toBeGreaterThan(12);
    const edgeX = hangar.x + hangar.radius + 4;
    expect(world.obstaclesNear(edgeX, hangar.z, 5)).toContain(hangar);
  });
});
