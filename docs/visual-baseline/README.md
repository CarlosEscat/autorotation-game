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

