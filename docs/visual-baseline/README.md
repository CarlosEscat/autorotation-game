# Visual baseline

Fixed shots used to compare every stage of the stylized-realism redesign against the original look.
`before/` is the game at commit `eaf58a0` (2026-11-16). Each later stage adds a folder (`stage1/`, `stage2/`, …)
with the same shots, taken the same way.

| File | Shot |
| --- | --- |
| `01-heli.png` | Light helicopter on the runway, 3/4 front, ~8 m |
| `02-heavy.png` | Heavy firefighter on the runway, 3/4 front |
| `03-chase.png` | Chase camera in flight, 160 m, looking at the airport |
| `04-airport.png` | Airport from 70 m: runway, tower, forest |
| `05-lake.png` | Lake and helipad from the south-east shore |
| `06-farm.png` | Farm strip, tree lines, farm buildings, lake shore |
| `07-vista.png` | Whole valley from 220 m: hills, rim mountains, clouds, fog |
| `08-cockpit.png` | Cockpit view in flight |
| `09-airport-night.png` | Shot 04 at night |

## How to retake them

1. `npm run dev` (port 5173), open it in Chrome at a 1280×720 viewport, device pixel ratio 1.
2. Evaluate `scripts/visual-harness.js` in the page (it uses the dev-only `window.__game` hook,
   starts a free flight, pauses it and hides the HUD).
3. For each shot: `await __view('heli')` (or `__view('airport', true)` for night), then take a viewport screenshot.
   `__stats()` returns draw calls, triangles, geometries, textures and shader programs of the last frame.

Everything is deterministic: the world is seeded, the light is fixed (no time of day), and the camera poses are in the harness.

## Baseline numbers (before)

Measured on an Apple M4 (ANGLE Metal), Chrome, 1280×720.

| Shot | Draw calls | Triangles |
| --- | ---: | ---: |
| heli | 134 | 85.6 k |
| heavy | 155 | 86.7 k |
| chase | 133 | 82.0 k |
| airport | 108 | 84.3 k |
| lake | 121 | 78.0 k |
| farm | 77 | 72.9 k |
| vista | 154 | 93.6 k |
| cockpit | 155 | 84.2 k |
| airport, night | 85 | 83.7 k (+1.3 k points) |

In flight (chase camera, 1000 ft, day, real-time shadow on):

| | Desktop 1280×720 @1× | Phone-sized 844×390 @3× (capped 1.5×), CPU ÷4 |
| --- | --- | --- |
| FPS | 60 (vsync) | 60 (vsync) |
| Worst frame | 17.8 ms | 17.7 ms |
| `renderer.render` CPU, median / p95 | 2.2 / 2.9 ms | 1.1 / 1.8 ms |
| Draw calls / triangles | 163 / 81 k | — |
| Geometries / textures / programs | 124 / 3 / 29 (day + night compiled) | — |
| JS heap | 29 MB | — |

Load: first paint 52 ms, load event 122 ms (dev server, world and meshes built at start-up).
Production bundle: 766 kB JS (211 kB gzip), no textures or models downloaded: everything is procedural.

The M4 has a lot of headroom, so these numbers only bound the CPU side. GPU cost on phones has to be checked on a real device
(the CPU-throttled run cannot slow the GPU down).

## Stage 0 — foundation (`stage0/`)

Shared palette and materials (`src/render/materials.ts`), neutral tone mapping, `?stats` overlay, dead `worldMesh1.ts` removed.
Shots 03 and 09 retaken: the look is unchanged apart from slightly richer greens and whiter runway paint (tone mapping
compresses bright highlights). Shared materials reduced shader programs in the airport night shot from 29 to 27.

## Stage 1 — helicopters (`stage1/`)

Smooth, rounded light and heavy airframes (`src/render/modelKit.ts`), glossy paint with a sky environment map, baked
vertical occlusion, merged per material. Shots 01, 02, 03, 08 and a new `10-heli-night.png`. The parked shots now stop
the rotor (`parked` in the harness) so the blades show; the `before/` shots had a turning rotor, drawn as a faint disc.

| Model | Exterior meshes (draws, incl. tail rotor) | Exterior triangles |
| --- | ---: | ---: |
| Light, before | 28 | 620 |
| Light, stage 1 | 5 | 6.3 k |
| Heavy, stage 1 | 8 | 8.1 k |

In flight (chase camera, 1000 ft, day, real-time shadow on), same machine and method as the baseline:

| | Before | Stage 1, light | Stage 1, heavy |
| --- | ---: | ---: | ---: |
| FPS / worst frame | 60 / 17.8 ms | 60 / 17.7 ms | 60 / 17.7 ms |
| `renderer.render` CPU, median / p95 | 2.2 / 2.9 ms | 2.1 / 2.5 ms | 2.1 / 2.5 ms |
| Draw calls | 163 | 117 | 112 |
| Triangles | 81 k | 92 k | 95 k |
| Programs (day + night, both types compiled) | 29 | 34 | 34 |
| Textures | 3 | 5 (adds the environment map) | 5 |
| JS heap | 29 MB | 32 MB | 32 MB |

Production bundle: 779 kB JS, 215.5 kB gzip (+4.5 kB gzip).

## Stage 2 — terrain and mountains (`stage2/`)

New `src/render/terrainMesh.ts`. Collision is untouched (decision D1 (a)): the terrain mesh has exactly the
simulation's vertices and diagonals, now indexed and smooth-shaded. Checked in the page: every vertex equals
`world.heights`, and 300 random downward rays onto the drawn ground match `heightAt` within 5e-13 m.

- **Ground map** baked at start-up (1024² on desktop, about 3 m per texel; 512² on touch devices): grass blends with
  mid-scale dry/lush patches, soft ragged field edges and mow stripes, the farm strip, slope rock, a sandy beach that
  turns to wet sand and lake bed under water, and baked occlusion in hollows and under trees and buildings.
  A 128² map is baked synchronously; the full one is baked in 6 ms slices and swapped in, about 0.4 s after load.
- **Detail noise**: one 128² tiling texture at two scales multiplied into the ground; it fades out by itself in the mipmaps.
- **Lake**: a sheet whose colour and opacity follow the depth, so the shore fades in; glossy, reflecting the sky.
- **Scenery mountains** beyond the edge of the world, fading into the haze. There is no world boundary in the game,
  so within 250 m of the edge they follow, a few metres lower, the edge height the simulation carries outwards;
  further out a pilot could fly through them.

| | Stage 1 | Stage 2 |
| --- | ---: | ---: |
| FPS / worst frame, in flight | 60 / 17.7 ms | 60 / 17.7 ms |
| `renderer.render` CPU, median / p95 | 2.1 / 2.5 ms | 2.1 / 2.7 ms |
| Draw calls, in flight | 117 | 118 |
| Triangles, in flight | 92 k | 123 k (scenery mountains 12.5 k, lake 18 k) |
| Programs (day + night) | 34 | 35 |
| Textures | 5 | 7 (ground map ~5.6 MB on the GPU with mipmaps, detail 85 kB) |
| Load event (dev server, 3 reloads) | 145–165 ms | 168–213 ms |

Ground-map bake times, warm: 128² ≈ 6–24 ms (24 ms cold), 512² ≈ 66 ms, 1024² ≈ 119 ms; with the CPU slowed 4×: 512² 181 ms,
1024² 607 ms (in slices, so it never blocks a frame for more than about 6 ms). Production bundle: 785 kB JS,
217.9 kB gzip (+2.4 kB gzip).
