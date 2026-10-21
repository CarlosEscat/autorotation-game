import { describe, expect, it } from 'vitest';
import { nextTargetAhead } from '../src/game/guidance';
import { createState } from '../src/sim/state';
import { v3 } from '../src/sim/vec';
import { createWorld } from '../src/world/world';

const world = createWorld();
const ids = world.areas.map((a) => a.id); // meadow (-380,360), runway (-180,-550), strip (400,470), clearing (110,840)
const at = (x: number, z: number, yawDeg: number) => createState({ pos: v3(x, 300, z), yaw: (yawDeg * Math.PI) / 180, speed: 0, collective: 0.3, pitch: 0, omega: 40, inducedVel: 0, thrust: 0 });
const pick = (s: ReturnType<typeof at>, cur: string | null) => {
  const i = nextTargetAhead(s, world.areas, cur === null ? null : ids.indexOf(cur));
  return i === null ? null : ids[i];
};

describe('selecting a landing area', () => {
  it('only cycles through fields ahead of the nose', () => {
    // At the free-flight start facing north, all four fields are ahead.
    const north = at(0, 1100, 0);
    expect(pick(north, 'meadow')).toBe('runway');
    expect(pick(north, 'runway')).toBe('strip');
    expect(pick(north, 'strip')).toBe('clearing');
    expect(pick(north, 'clearing')).toBe('meadow');
  });

  it('skips fields behind the helicopter', () => {
    // East of the meadow, facing east: the meadow is behind, strip 15° right, clearing 49° left.
    const s = at(-100, 600, -90);
    expect(pick(s, 'strip')).toBe('clearing');
    expect(pick(s, 'clearing')).toBe('strip');
  });

  it('returns null when no other field is ahead', () => {
    // Far west, facing west: every field is behind.
    expect(pick(at(-1000, 360, 90), 'meadow')).toBeNull();
  });
});
