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

## Stage 3 — airport and structures (`stage3/`)

Decision D2: new airport buildings are solid. `world.ts` gains a hangar (20 × 26 × 11 m), an operations building and
two fuel tanks west of the runway, on open ground no tree or rock was on, outside the runway clear zone and approaches
(new `tests/airport.test.ts`). The collision lookup now uses the largest obstacle radius instead of a fixed 12 m
(identical results for every existing obstacle). Crashes into a tank read "struck a fuel tank".

- **Buildings** (`src/render/buildingsMesh.ts`): curved-roof hangar with ribbed doors, flat-roofed operations building,
  domed fuel tanks, a rebuilt tower (round shaft, faceted outward-leaning glass cab, overhanging roof), and gabled
  farm barn and house with eaves, doors, trim and chimney. All buildings are merged per material (~12 draws in all),
  with walls sunk 1.5 m into the ground and soft occlusion towards their foot.
- **Hard standing** (`src/render/airportLayout.ts`), painted into the ground map: gravel runway shoulders, asphalt
  overruns, a concrete apron from the hangar doors to the runway, a path past the tower to the operations building,
  and slabs under every building.
- **Runway**: a small painted asphalt texture (64 × 1024): grain, darker centre strip, weathered edges, light tyre marks
  in both touchdown zones.
- **Helipad**: rounded deck, smoother legs with cross-braces, and a safety net sloping out below the deck edge.
- **Markers**: rounded corner cones, a striped windsock with crisp bands.
- **Night fix**: ground-level glows (runway edges, pad edges) are drawn 2 m nearer the eye, so the ground no longer cuts
  them into half-domes.
- Close-ups added: `11-hangar.png`, `12-tower.png`, `13-helipad.png`, `14-barn.png`.

In flight (same method; both helicopters, day and night compiled first so the program count is complete):

| | Stage 2 | Stage 3 |
| --- | ---: | ---: |
| FPS / worst frame | 60 / 17.7 ms | 60 / 18.7 ms |
| `renderer.render` CPU, median / p95 | 2.3 / 2.9 ms | 2.5 / 3.1 ms |
| Draw calls | 118 | 127 |
| Triangles | 123 k | 128 k |
| Textures | 7 | 8 (runway surface, 256 kB) |
| Programs, everything compiled | 37 | 41 |

The program count is over the 35 set in the plan, and was already at 37 after stage 2 once both helicopters and night
were compiled. Stage 5 (shared materials) is where to bring it back down. Production bundle: 793 kB JS, 220.8 kB gzip
(+2.9 kB gzip).

## Stage 4 — vegetation (`stage4/`)

New `src/render/vegetation.ts`; collision unchanged (every tree keeps its exact height and place).

- **Trees**: pines of stacked drooping tiers and broadleaf trees with a branching trunk and a crown of lumpy lobes.
  Normals are bent away from the crown centre, so foliage shades as one soft mass instead of facets. Three levels of
  detail per 350 m chunk: detailed up to 300 m (pine ~180 triangles, broadleaf ~270), simpler up to 760 m, silhouettes
  beyond. Per-tree brightness and warm/cool tint.
- **Undergrowth**: a bush beside about a third of the trees, kept off landing areas, water, steep slopes and the
  airport; drawn only up close.
- **Grass**: up to ~2 500 tufts in a 34 m circle round the helicopter below 45 m above the ground, on a world-fixed
  grid (no swimming), each tinted from the ground map under it; not on paving, strips, water or round buildings.
  Rebuilt every 5 m of travel. It is the first thing `lowerQuality` drops.
- **Wind**: one shared plant material sways trees, bushes and grass in the vertex shader, phased by position and driven
  by simulation time (a paused game holds still).
- New harness views: `15-forest.png` (forest edge from 14 m) and `16-low.png` (hover 4 m over the meadow).

| Shot | Stage 3 | Stage 4 |
| --- | ---: | ---: |
| heli (draws / triangles) | 100 / 132 k | 102 / 171 k (grass shown) |
| chase | 94 / 128 k | 95 / 150 k |
| airport | 68 / 112 k | 71 / 187 k (grass shown) |
| vista | — | 142 / 188 k |
| forest | — | 42 / 145 k |

In flight (same method; everything compiled first):

| | Stage 3 | Stage 4, cruise 1000 ft | Stage 4, low pass 8 m over the meadow |
| --- | ---: | ---: | ---: |
| FPS / worst frame | 60 / 18.7 ms | 60 / 17.7 ms | 60 / 17.7 ms |
| `renderer.render` CPU, median / p95 | 2.5 / 3.1 ms | 2.9 / 3.5 ms | 2.6 / 6.0 ms (grass rebuilds) |
| Draw calls | 127 | 127 | 26 |
| Triangles | 128 k | 145 k | 132 k |
| Programs, everything compiled | 41 | 47 | 47 |

Every shot stays within the ~190 k triangle budget after trimming (the first version reached 213 k in the forest and
211 k in the vista). Programs are further over the plan's 35: the three plant materials (tree, bush, grass sway) each
compile their own variants. Stage 5 should fold them, the ground and the buildings into fewer shared materials.
Production bundle: 800 kB JS, 223.1 kB gzip (+2.3 kB gzip).

## Stage 5 — materials and textures (`stage5/`)

- **Shared surface detail** (`src/render/surfaceDetail.ts`): one 128² generated texture (soft blotches, vertical
  streaks, fine grain) sampled in world space by one shader chunk — from above on floors and roofs, from the side on
  walls, where the streaks read as rain stains. Ground, runway, buildings, scenery mountains, helipad, markers and
  boulders all use it, each at its own strength (a uniform, so they share programs). It replaces the ground's own
  detail texture. `lambert(colour, { detail })` in `materials.ts` applies it; the flat-shading switch is gone.
- **Boulders**: lumpy, smooth-shaded shapes with a flattened, seated base, darker at the foot and lichen-tinted on top,
  instead of dodecahedra.
- **Fewer shader programs** (47 → 37 with everything compiled):
  - the shadow map asked for `PCFSoftShadowMap`, which three.js has dropped: it swapped in PCF at the first frame, so
    every lit shader existed twice (and the console showed a warning on every load since before this work). It now
    asks for PCF directly; shadows look the same;
  - trees, bushes and grass share one plant program (sway amount is a uniform);
  - the windsock and helipad net are drawn with both windings instead of double-sided materials;
  - rotor blades carry white vertex colours and share the paint program; the runway shares the ground's program.
- **Precompile**: the day scene's shaders are compiled in the background at start-up (grass included), so the first
  low pass and the first distant forest no longer stall on a compile. Load event with it: 210–280 ms (one cold
  reload 410 ms); without it: 185–190 ms. Without it the same shaders compile on the first frame instead.

| | Stage 4 | Stage 5, cruise 1000 ft | Stage 5, low pass |
| --- | ---: | ---: | ---: |
| FPS / worst frame | 60 / 17.7 ms | 60 / 17.7 ms | 60 / 17.8 ms |
| `renderer.render` CPU, median / p95 | 2.9 / 3.5 ms | 3.2 / 3.9 ms | 2.9 / 6.0 ms |
| Draw calls | 127 | 126 | 26 |
| Triangles | 145 k | 146 k | 132 k |
| Programs, everything compiled | 47 | 37 | 37 |
| Console warnings | 1 | 0 | 0 |

Per shot: vista 141 draws / 192.5 k triangles (the boulders add 8 k), airport 71 / 188 k, heli 101 / 175 k.
Production bundle: 803 kB JS, 224.2 kB gzip (+1.1 kB gzip). New close-up: `17-rocks.png`.
