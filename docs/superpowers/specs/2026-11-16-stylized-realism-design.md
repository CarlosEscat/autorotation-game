# Stylized realism: analysis and staged plan

Status: stages 0 and 1 implemented on branch `visual/stylized-realism` (results in the baseline README); stages 2–6 proposed.
Baseline shots and numbers: [docs/visual-baseline/README.md](../../visual-baseline/README.md).

Goal: move from the current N64 / flat-shaded low-poly look to smooth, colourful, atmospheric stylized realism
(in the spirit of *Over The Hill*: soft forms, believable colour, depth and haze), without touching flight physics,
controls, missions or the browser/mobile performance envelope.

---

## 1. How rendering is built today

| Piece | Where | What it does |
| --- | --- | --- |
| Scene owner | `src/render/renderer.ts` | One `WebGLRenderer` (MSAA, no tone mapping), hemisphere + one directional sun, linear fog `600–3400 m`, a 1024² PCF-soft shadow map that follows the helicopter (only the helicopter casts). Day/night switch, adaptive quality (`lowerQuality`: drop shadow, then pixel ratio). Reads sim state, never writes it. |
| Light helicopter | `src/render/helicopterModel.ts` | 28 primitive meshes, 620 triangles (lathe cabin with 10 segments, boxes, 6-sided cylinders), `MeshLambertMaterial` with `flatShading: true` via the shared `mat()` helper. Rotor blades, blur disc, cockpit sweeps, cockpit interior, shadow proxy. |
| Heavy helicopter | `src/render/heavyModel.ts` | Lofted 8-point chamfered sections, extruded fin, box windows; same flat Lambert. |
| Terrain | `src/render/worldMesh.ts` `buildTerrain` | 160×160 cells (20 m), **non-indexed**, one colour per triangle (noise blends + ±2 % per-triangle jitter), flat-shaded. 51 k triangles. |
| Water | `buildWater` | Flat 32-segment disc, vertex-colour depth gradient, 0.9 opacity. |
| Trees / rocks | `buildObstacles` | 3 821 trees as instanced pines (stacked 6-sided cones) and broadleaf (icosahedron detail 0 lobes), vertex-colour gradients, chunked 350 m with a far LOD at 650 m. Rocks = instanced dodecahedra. |
| Buildings | `buildObstacles`, `buildTower` | Farm houses = box + 4-sided pyramid roof (merged). Tower = 5 boxes. |
| Runway / pads | `buildRunways`, `buildHelipad`, `buildPad` | Flat planes with polygon offset, merged markings. |
| Sky / clouds | `buildSky`, `buildClouds` | Vertex-colour gradient sphere with a sun glow; 104 flattened icospheres merged into one mesh. |
| Night | `src/render/night.ts`, `heliLights.ts`, `world/nightLights.ts` | Night dome, stars, moon, point-sprite lights, one spotlight. |
| Dead code | `src/render/worldMesh1.ts` | Older copy of `worldMesh.ts`, imported nowhere. Can be deleted in stage 0. |

Assets: none. Everything is procedural, 3 textures in memory (canvas sprites). This is a strength to keep.

### Hard couplings the redesign must respect

- **Terrain collision equals the rendered triangles.** `World.heightAt` interpolates exactly the 20 m triangle mesh
  (same diagonal). Changing terrain *shape* in the renderer alone would make skids float or sink.
- **Obstacle sizes are collision sizes.** Tree `height`/`radius`, building `w/d/height`, tower size come from `world.ts`
  and are used by the crash checks. Visual trees must keep their exact height; new solid structures need matching obstacles.
- **Helicopter dimensions** (`skidHeight`, `hubHeight`, `rotorRadius`, `tailBoomLength`, gear points, `bodyRadius`)
  live in `src/sim/aircraft.ts` and drive physics. Light positions (`heliLights.ts`), the water outlet, the cockpit eye
  and the chase-camera distance are tuned to them.
- **The `HelicopterModel` interface** (root, exterior, shadowProxy, cockpit, rotor, rotorDisc, rotorSweep, tailRotor,
  cyclic, collective, eye, lights) is what `renderer.ts` animates. New models must return the same shape.
- **Night mode** rewrites colours on shared materials in `setNight`; every stage must be checked at night too.

---

## 2. What makes it look N64 (ranked by impact)

1. **Flat shading everywhere.** `flatShading: true` on the helicopter, terrain, trees, rocks and buildings. Every facet
   catches light differently, which is the signature of the N64 look. On the terrain, the per-triangle colour
   and jitter turn the ground into a visible triangle checkerboard (shots 03, 06, 07).
2. **Very low segment counts on curved shapes.** 10-segment cabin, 6-sided booms and masts, box skids and blades,
   6-sided tree cones, detail-0 icosahedron crowns. Silhouettes are polygons, not curves (shots 01, 02).
3. **Per-triangle surface classification.** Shorelines, field edges and the farm strip are decided per triangle,
   giving 20 m sawtooth edges and stepped sand beaches (shots 05, 06, 07).
4. **Matte Lambert only, no ambient occlusion, no contact shading.** Objects have no gloss, no crevice darkening,
   no grounding: trees, buildings and the tower look pasted on (shots 04, 06). Only the helicopter casts a shadow.
5. **Sparse, primitive props.** The airport is a runway plane and a five-box tower; houses are box + pyramid;
   rocks are dodecahedra.
6. **Flat atmosphere.** Linear fog of one colour, no height fog or aerial perspective; clouds are flattened
   icospheres; no tone mapping, so highlights clip and colours stay "raw".

What is **already good** and should be kept: the colour palette direction (warm late-afternoon light, believable
greens), the sky gradient with sun glow, hemisphere fill, the instanced/chunked/LOD forests, merged geometry,
adaptive quality, the deterministic procedural world, and the night lighting work.

Most of the gain is therefore in **shading, geometry smoothness and grounding**, not in new assets.

---

## 3. Staged plan

Each stage is one reviewable branch/PR, revertible on its own, re-shot with the harness and re-measured.
Stage 0 is a small addition to your list (see why below); the rest follow your order.

### Stage 0 — Foundation (small, no visible restyle)

- `src/render/materials.ts`: one shared palette + material factory (`surface('paint.red')`, etc.) replacing the
  `mat()` helper and ad-hoc `new MeshLambertMaterial` calls, so later stages tune colours in one place and share
  materials (fewer programs, fewer state changes). `flatShading` becomes a single switch.
- Turn on tone mapping (AgX or ACES, exposure tuned to match today's brightness) **now**, not in stage 6, so every
  later stage is colour-tuned once, under the final pipeline. This is the only reason stage 0 exists ahead of your order.
- Delete dead `worldMesh1.ts`. Add a dev-only `?stats` overlay (FPS, calls, triangles) for on-device checks.
- **Files:** `renderer.ts`, `helicopterModel.ts`, `heavyModel.ts`, `worldMesh.ts`, `night.ts` (material calls only), new `materials.ts`.
- **Accept:** shots look the same within tone-mapping shift; numbers unchanged; tests green.

### Stage 1 — Helicopters

- Smooth normals; cabin lathe 10 → ~28 segments with a refined profile; canopy as a separate smooth shell with a
  glossy glass material.
- Tail boom, mast, exhaust, fairings with 12–16 sides; fin and stabiliser as bevelled extrusions; skids and
  cross-tubes as round tubes with bent toes; blades tapered with tip caps.
- Heavy: loft sections go from 8 chamfer points to 16-point rounded (superellipse) sections; smooth normals;
  windows inset rather than boxes stuck on.
- Paint: `MeshStandardMaterial` for the helicopter only (it is one object on screen), with a tiny runtime environment
  map (generated with `PMREMGenerator` from a procedural room — no download) for soft highlights. Subtle panel lines
  and a darker underside via vertex colour / a 128 px procedural texture.
- **Merge by material**: ~30 exterior draws → ~5. This *saves* draw calls even as detail goes up.
- Fix seen in the baseline: the light helicopter's skids sink into the runway (shot 01).
- **Unchanged:** every dimension in `aircraft.ts`, the `HelicopterModel` interface, light positions, cockpit eye.
- **Files:** `helicopterModel.ts`, `heavyModel.ts`, possibly `heliLights.ts` (only if a lens moves with the new skin).
- **Budget:** ≤ 6 k triangles per exterior (light model today: 28 meshes, 620 triangles), draw calls down, one extra program.

### Stage 2 — Terrain and mountains

- Indexed terrain with **smooth vertex normals** and **per-vertex** colour: the facet checkerboard disappears at zero
  collision risk (same vertices).
- **Baked ground map**: one 512–1024² texture built at start-up over the 3.2 km world, holding the surface colour
  (grass blends, fields with mow stripes, strip, rough, sand), **smooth** field/shore edges, slope rock tint, and baked
  ambient occlusion (darkening under forests, at the foot of slopes, around buildings). One texture replaces the
  per-triangle classification and grounds everything. ~1–5 MB of GPU memory, measured load-time cost.
- A small tiling detail-noise texture (128 px, generated) multiplied in at close range to avoid flat-looking grass.
- **Visual-only distant mountains**: a ring of smooth, fog-blended ranges beyond the world edge to make the valley
  feel larger, with no effect on collision.
- **Decision needed (D1):** whether the *playable* terrain may change shape (see section 6).
- **Files:** `worldMesh.ts` (terrain, water edge), new `groundMap.ts`; `world.ts` only if D1 allows.

### Stage 3 — Airport and structures

- Runway with shoulders, threshold aprons, a subtle asphalt texture and tyre marks from the ground map; taxiway and apron.
- New structures: hangar with a curved roof, small ops building, fuel tanks, fence line, apron lights; rounded tower
  with an overhanging glazed cab; windsock with stripes.
- Helipad deck with a railing/skirt and proper legs; farm buildings as gabled barns with eaves.
- Fix seen in the baseline: runway edge lights are half-buried in the asphalt (shot 09).
- All instanced or merged per material. **Decision needed (D2):** solid structures as new obstacles.
- **Files:** `worldMesh.ts` (`buildRunways`, `buildHelipad`, `buildTower`, buildings, markers) or a new `airportMesh.ts`; `world.ts` only for D2.

### Stage 4 — Vegetation

- New tree shapes: broadleaf crowns from several lumpy, smooth-shaded lobes with **outward-bent normals** (the classic
  trick for soft, cloud-like foliage shading); pines with more, drooping tiers; 3–4 variants per kind; colour
  variation per instance (already supported).
- Three LOD levels instead of two (detailed < ~250 m, simple, far) so the triangle count stays bounded.
- Bushes along field edges and tree lines; instanced grass tufts only in a small radius around the helicopter when low.
- Optional gentle wind sway in the vertex shader.
- Tree heights stay exact (collisions); forest AO goes into the stage-2 ground map.
- **Files:** `worldMesh.ts` (`treeGeometries`, `buildObstacles`) or a new `vegetation.ts`.

### Stage 5 — Materials and textures

- One shared shader extension (`onBeforeCompile`) for world-space macro/micro variation, so large surfaces never read
  as flat fills; applied to terrain, asphalt, roofs, walls, rocks.
- Small procedural textures (≤ 256 px, generated on a canvas at start-up): asphalt grain, roof sheet, plank, concrete.
- Rocks get smooth, noise-displaced shapes instead of dodecahedra.
- Program count stays low by sharing one extended material per kind; shaders precompiled with `renderer.compile`
  to avoid first-use hitches.

### Stage 6 — Lighting and atmosphere

- Height fog with aerial perspective (thicker in valleys, tinted toward the sky near the horizon) via a custom fog chunk.
- Sky retune (sun disc, warmer horizon band); soft billboard clouds with a gradient texture instead of flattened icospheres.
- Shadow softness and colour retune; hemisphere colours matched to the sky and ground map; a little rim light on the helicopter.
- Night retune under the new pipeline.
- No screen-space post effects (SSAO, bloom) on mobile; if any, desktop-only behind adaptive quality.

---

## 4. Performance risks and how to avoid them

| Risk | Mitigation |
| --- | --- |
| `MeshStandardMaterial` everywhere is costly on phone GPUs | PBR only on the helicopter; world stays on smooth Lambert + baked AO + shared shader chunk. |
| More terrain triangles | Keep the 20 m grid for the playable area; smoothness comes from normals and the ground map, not tessellation. |
| More detailed trees ×3 800 | Three LOD levels with a tight near radius; triangle budget per level; counts checked per shot. |
| Grass overdraw | Small radius, capped instance count, opaque geometry (no alpha-blended cards), first thing dropped by `lowerQuality`. |
| Extending real-time shadows to the world | Don't: tree/building shadows and AO are baked into the ground map. |
| Shader variants and compile hitches | Shared materials, one extension per kind, precompile at load; program count tracked per stage. |
| Texture memory | Ground map 1024² on desktop, 512² on low quality; small textures ≤ 256 px; total tracked via `renderer.info`. |
| Start-up time (baking) | Measure; target < 150 ms extra; bake at lower resolution on slow devices. |
| Draw calls creeping up | Merge per material; the helicopter merge buys headroom; budget below. |

**Budgets against the baseline** (per shot, harness numbers): draw calls ≤ baseline + 15 %; triangles ≤ 2× baseline
(~190 k); textures ≤ 8 MB GPU total; programs ≤ 35 (day + night); JS bundle ≤ +40 kB gzip; no downloaded assets;
start-up ≤ +150 ms. `lowerQuality` gains steps (grass off, ground map 512², shorter tree LOD) so phones can fall back.

---

## 5. How each stage is evaluated

1. **Before/after shots**: retake the 9 harness shots into `docs/visual-baseline/stageN/` and compare side by side
   with `before/` against the success criteria (silhouettes, continuous landscape, subtle variation, depth without noise,
   cohesion with the other stages).
2. **Numbers**: `__stats()` per shot + in-flight FPS, worst frame and render CPU time, heap, bundle size, start-up time,
   recorded in the stage's README table next to the baseline.
3. **Device check**: the `?stats` overlay on a real phone (yours) for the ≈30 FPS target; desktop must hold 60.
4. **Gameplay unchanged**: `npm test` (flight model, landing pilot bots, levels) and `npm run typecheck` green; for stages
   that must not touch collision, a check that the world's height field and obstacle list are byte-identical to before.
5. **Night**: shot 09 retaken every stage.
6. **Reversibility**: one commit series per stage, no gameplay files touched unless a decision below says so.

---

## 6. Decisions needed before the stage they affect

- **D1 (stage 2): may the playable terrain change shape?**
  (a) Keep collision exactly as is: smooth shading, ground map and distant mountains only. Zero gameplay risk, and
  most of the visual gain. (b) Also reshape the rim mountains and soften hills in `world.ts`, with `heightAt` following
  the new surface; landing areas and the start point unchanged; tests re-run. Recommendation: **(a)** first, revisit (b) after seeing it.
- **D2 (stage 3): may new airport structures be solid?** Recommendation: yes, placed outside the runway clear zone
  and approaches and added as obstacles so you cannot fly through a hangar.
- **D3: Stage 0 tone mapping first** (recommended) rather than with lighting in stage 6.
