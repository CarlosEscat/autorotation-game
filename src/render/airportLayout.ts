import { Obstacle, World } from '../world/world';

/** A paved rectangle painted into the ground map: centre, half extents along its own X and Z, turned by `rot`. */
export interface PavedPatch {
  cx: number;
  cz: number;
  hw: number;
  hl: number;
  rot: number;
  surface: 'asphalt' | 'concrete' | 'gravel';
}

/**
 * Hard standing round the airport, derived from the runway and the airport buildings so it follows them if they move:
 * gravel shoulders and asphalt overruns on the runway, a concrete apron from the hangar to the runway, a path
 * past the tower to the operations building, and a slab under every building and tank.
 */
export function pavedPatches(world: World): PavedPatch[] {
  const rwy = world.areas.find((a) => a.id === 'runway');
  if (!rwy) return [];
  const out: PavedPatch[] = [];
  const along = (lz: number) => ({ x: rwy.cx + lz * Math.sin(rwy.rotation), z: rwy.cz + lz * Math.cos(rwy.rotation) });
  out.push({ cx: rwy.cx, cz: rwy.cz, hw: rwy.halfWidth + 4, hl: rwy.halfLength + 2, rot: rwy.rotation, surface: 'gravel' });
  for (const end of [-1, 1]) {
    const p = along(end * (rwy.halfLength + 20));
    out.push({ cx: p.x, cz: p.z, hw: rwy.halfWidth, hl: 20, rot: rwy.rotation, surface: 'asphalt' });
  }
  const slab = (o: Obstacle, margin: number) =>
    out.push({ cx: o.x, cz: o.z, hw: (o.w ?? o.radius * 2) / 2 + margin, hl: (o.d ?? o.radius * 2) / 2 + margin, rot: o.rot ?? 0, surface: 'concrete' });
  const hangar = world.obstacles.find((o) => o.style === 'hangar');
  const office = world.obstacles.find((o) => o.style === 'office');
  const tower = world.obstacles.find((o) => o.kind === 'tower');
  const tanks = world.obstacles.filter((o) => o.kind === 'tank');
  if (hangar) {
    // Apron: from the hangar doors to the runway shoulder, a little wider than the hangar.
    const x0 = hangar.x + hangar.w! / 2, x1 = rwy.cx - rwy.halfWidth - 3;
    out.push({ cx: (x0 + x1) / 2, cz: hangar.z, hw: (x1 - x0) / 2 + 2, hl: hangar.d! / 2 + 8, rot: 0, surface: 'concrete' });
    slab(hangar, 2);
    if (office) {
      // Path north from the apron, past the tower, to the operations building.
      const z0 = hangar.z + hangar.d! / 2 + 8, z1 = office.z - office.d! / 2;
      out.push({ cx: office.x + office.w! / 2 + 6, cz: (z0 + z1) / 2, hw: 4, hl: (z1 - z0) / 2 + 4, rot: 0, surface: 'asphalt' });
    }
  }
  if (office) slab(office, 3);
  if (tower) out.push({ cx: tower.x + 2, cz: tower.z, hw: 10, hl: 8, rot: 0, surface: 'concrete' });
  if (tanks.length) {
    const xs = tanks.map((t) => t.x), zs = tanks.map((t) => t.z);
    out.push({ cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, hw: 5, hl: (Math.max(...zs) - Math.min(...zs)) / 2 + 5, rot: 0, surface: 'concrete' });
  }
  return out;
}
