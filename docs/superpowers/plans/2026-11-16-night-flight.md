# Night Flight in Free Flight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Day/Night choice in Free flight, with a moonlit world, lit runway, lake helipad and houses, and lights on both helicopters.

**Architecture:** `night` is one more flag on `FlightConfig`, set from a new `time` setting. Where world lights go is a pure, tested function (`nightLights`); the renderer draws that list as unlit glowing points and switches its sky and lighting in one method, `setNight`. The only real light added is the landing spotlight on the helicopter.

**Tech Stack:** TypeScript, three.js 0.186, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-night-flight-design.md`

## Global Constraints

- Day must look exactly as it does now. `setNight(false)` restores everything `setNight(true)` touched.
- Night changes only what is seen: no change to the flight model, landing rules or scoring.
- At most 4 extra draw calls for all world lights; exactly one extra real light (the landing spotlight); shadow map off at night.
- Lessons and the scene behind the menus stay day.
- Saves under `autorotation.v1` keep working: no `time` loads as `'day'`, no `nightSeconds` loads as 0.
- The Free flight field follows `MENU_SPEC.md`: `.well.seg` with `.seg-key` keys, existing tokens only. World light colours follow aviation practice.
- Light placement lives in a pure function of the world, not in mesh code.
- Work on branch `night-flight` (already created; the spec is committed there).

## Review Focus

1. **Day after night**: night flight → menu → day flight shows the day sky, clouds, shadows and beacon exactly as before. (Task 4, browser check)
2. **Old save**: a save with no `time` and no `nightSeconds` loads, starts by day, keeps stars, rank and logbook. (Tasks 1 and 2, unit tests)
3. **Lesson started while the saved choice is night** flies by day. (Task 4, browser check)
4. **Switching helicopter between night flights**: the lights and landing light are on the model now flown, and the other model's are not left lit in the scene. (Task 6, browser check)
5. **Paused at night**: the beacon stops flashing and the scene stays night; Restart from pause stays night. (Task 6, browser check)

---

### Task 1: Time-of-day setting

**Files:**
- Modify: `src/game/session.ts` (`FlightConfig`)
- Modify: `src/ui/screens.ts` (`Settings`, `DEFAULT_SETTINGS`, `normalizeSettings`, `configFromSettings`, `flightSummary`, `buildFreeFlight`, `syncFreeFlight`)
- Test: `tests/settings.test.ts` (new)

**Interfaces:**
- Produces: `FlightConfig.night?: boolean`; `Settings.time: 'day' | 'night'`; `TIMES: Record<Settings['time'], string> = { day: 'Day', night: 'Night' }`.

- [ ] **Step 1: Write the failing tests** in `tests/settings.test.ts` (imports from `../src/ui/screens`, as `tests/heavy.test.ts` does)

```ts
it('defaults to day and rejects anything else', () => {
  expect(normalizeSettings({}).time).toBe('day');
  expect(normalizeSettings({ time: 'dusk' as never }).time).toBe('day');
  expect(normalizeSettings({ time: 'night' }).time).toBe('night');
});
it('passes night into the flight config', () => {
  expect(configFromSettings({ ...DEFAULT_SETTINGS, time: 'night' }).night).toBe(true);
  expect(configFromSettings(DEFAULT_SETTINGS).night).toBe(false);
});
it('says night in the summary only at night', () => {
  expect(flightSummary({ ...DEFAULT_SETTINGS, time: 'night' })).toMatch(/ · Night$/);
  expect(flightSummary(DEFAULT_SETTINGS)).not.toMatch(/Night|Day/);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/settings.test.ts`. Expected: FAIL (`time` unknown).
- [ ] **Step 3: Implement.** Add `night?: boolean` to `FlightConfig` with a doc comment ("Moonlit night: changes what is seen, never how it flies."). Add `time` to `Settings` and `DEFAULT_SETTINGS` (`'day'`), to `normalizeSettings`, to `configFromSettings` (`night: s.time === 'night'`), and append `' · Night'` in `flightSummary` at night.
- [ ] **Step 4: Free flight field.** In `buildFreeFlight`, add `field('time', 'Time of day', ...)` with one `seg('time', k, '<span class="legend">Day|Night</span>')` per entry of `TIMES`, as the last field inside `.ff-grid`. Make `syncFreeFlight` and the `pick` handler treat `time` like the other fields (follow how `wind` is mapped from `data-f`).
- [ ] **Step 5: Run** `npx vitest run && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Check in the browser** with the preview tool: the Free flight screen shows Time of day with Day pressed; pressing Night updates the summary; reload keeps Night; at 375 px width nothing overflows sideways.
- [ ] **Step 7: Commit** `feat: day or night choice in Free flight`

---

### Task 2: Night hours in the logbook

**Files:**
- Modify: `src/game/logbook.ts`, `src/game/pilot.ts`, `src/ui/screens.ts` (licence logbook lines)
- Test: `tests/logbook.test.ts`, `tests/pilot.test.ts`

**Interfaces:**
- Consumes: `FlightConfig.night` (Task 1).
- Produces: `Logbook.nightSeconds: number`; `FlightSample.night: boolean`.

- [ ] **Step 1: Write the failing tests.**

In `tests/logbook.test.ts` (use the file's existing sample helper; add `night` to it, default `false`):

```ts
it('counts night seconds only when airborne at night', () => {
  const book = emptyLogbook();
  const rec = new LogRecorder(book);
  for (let i = 0; i < 600; i++) rec.step({ ...air, night: true }, 1 / 60);   // 10 s airborne, night
  for (let i = 0; i < 600; i++) rec.step({ ...ground, night: true }, 1 / 60); // on the ground
  expect(book.nightSeconds).toBeCloseTo(10, 3);
  expect(book.airSeconds.light).toBeCloseTo(10, 3);
});
it('logs no night time by day', () => {
  const book = emptyLogbook();
  const rec = new LogRecorder(book);
  for (let i = 0; i < 600; i++) rec.step({ ...air, night: false }, 1 / 60);
  expect(book.nightSeconds).toBe(0);
});
```

In `tests/pilot.test.ts`:

```ts
it('loads a logbook with no night total, or a bad one, as 0', () => {
  expect(normalizePilot({ logbook: { flights: 3 } }).logbook.nightSeconds).toBe(0);
  expect(normalizePilot({ logbook: { nightSeconds: -5 } }).logbook.nightSeconds).toBe(0);
  expect(normalizePilot({ logbook: { nightSeconds: NaN } }).logbook.nightSeconds).toBe(0);
  expect(normalizePilot({ logbook: { nightSeconds: 90.5 } }).logbook.nightSeconds).toBe(90.5);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/logbook.test.ts tests/pilot.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `Logbook.nightSeconds` (0 in `emptyLogbook`); `FlightSample.night`, set in `sampleOf` from `session.config.night ?? false`; in `LogRecorder.step`, add `dt` to `nightSeconds` in the airborne branch when `s.night`. In `normalizePilot`, load `nightSeconds` the way `airSeconds` values are loaded (non-negative finite number, else 0; seconds are not floored).
- [ ] **Step 4: Licence line.** In the licence screen's logbook block, add a line `Night` with `formatFlightTime(pilot.logbook.nightSeconds)`, directly under the Hours line and in the same markup.
- [ ] **Step 5: Run** `npx vitest run && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: night hours in the logbook`

---

### Task 3: Where the world lights go

**Files:**
- Create: `src/world/nightLights.ts`
- Test: `tests/nightLights.test.ts`

**Interfaces:**
- Produces:

```ts
export type NightLightKind = 'runwayEdge' | 'runwayEnd' | 'padEdge' | 'padLeg' | 'window' | 'hazard';
export interface NightLight { x: number; y: number; z: number; color: number; kind: NightLightKind; /** runwayEnd only: which end, along the runway's own length axis. */ end?: -1 | 1 }
export const LIGHT = { white: 0xfff4d6, green: 0x35ff7a, red: 0xff3b30, yellow: 0xffd23a, window: 0xffc77a };
export function nightLights(world: World): NightLight[];
```

Placement (all positions in world space, after the area's `rotation`):

| Kind | Where | Count | Colour |
|---|---|---|---|
| `runwayEdge` | area `runway`: both sides at local x = ±(halfWidth + 1), local z from −halfLength to +halfLength every 50 m, y = elevation + 0.4 | 16 per side | white |
| `runwayEnd` | a row across each end at local z = ±(halfLength + 2), 6 lights evenly from −halfWidth to +halfWidth, `end` = −1 or 1 | 6 per end | green (the renderer recolours) |
| `padEdge` | area `helipad`: round the square deck edge, the 4 corners plus 2 evenly spaced on each side, y = elevation + 0.3 | 12 | green |
| `padLeg` | the 4 legs at local (±(halfWidth − 2), ±(halfLength − 2)), y = `world.waterLevel` + 0.5 | 4 | yellow |
| `window` | `building` obstacles: `mulberry32(2026)`, drawn in obstacle order; a house is lit when `rnd() < 0.66`; a lit house gets 1 to 3 windows, each at the middle height of the wall (`base + height * 0.325`), on one of the 4 wall faces, 0.05 m outside the wall, turned by the building's `rot` | varies | window |
| `hazard` | top of Lookout Hill: `HILL.x`, `HILL.z`, `world.heightAt(...) + 3` | 1 | red |

- [ ] **Step 1: Write the failing tests** in `tests/nightLights.test.ts` (`const world = createWorld(); const lights = nightLights(world); const of = (k) => lights.filter((l) => l.kind === k)`)

```ts
it('lights both runway edges evenly', () => {
  const edge = of('runwayEdge');
  expect(edge).toHaveLength(32);
  const rw = world.areas.find((a) => a.id === 'runway')!;
  expect(edge.filter((l) => l.x < rw.cx)).toHaveLength(16); // runway rotation is 0
  expect(edge.every((l) => l.color === LIGHT.white)).toBe(true);
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
it('lights about two thirds of the houses, each window on its own house', () => {
  const houses = world.obstacles.filter((o) => o.kind === 'building');
  const lit = houses.filter((h) => of('window').some((l) => Math.hypot(l.x - h.x, l.z - h.z) <= h.radius + 0.1));
  expect(lit.length / houses.length).toBeGreaterThan(0.45);
  expect(lit.length / houses.length).toBeLessThan(0.85);
  for (const l of of('window')) expect(houses.some((h) => Math.hypot(l.x - h.x, l.z - h.z) <= h.radius + 0.1 && l.y > h.base && l.y < h.base + h.height)).toBe(true);
});
it('marks Lookout Hill and gives the same lights every time', () => {
  expect(of('hazard')).toHaveLength(1);
  expect(nightLights(world)).toEqual(lights);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/nightLights.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/world/nightLights.ts`** to the interface and table. One helper turns an area's local (x, z) into world space with the same sign convention `buildRunways` gets from `g.rotation.y = a.rotation`.
- [ ] **Step 4: Run** `npx vitest run tests/nightLights.test.ts`. Expected: PASS. If the house fraction test fails because the world has very few houses, widen nothing: report the count.
- [ ] **Step 5: Commit** `feat: night light positions for runway, helipad, houses and hill`

---

### Task 4: The night look

**Files:**
- Create: `src/render/night.ts`
- Modify: `src/render/renderer.ts`, `src/render/worldMesh.ts` (`buildClouds` returns a group whose material the renderer can reach), `src/game/game.ts`

**Interfaces:**
- Consumes: `FlightConfig.night` (Task 1).
- Produces: `Renderer.setNight(on: boolean): void`; in `night.ts`: `buildNightSky(moonDir: THREE.Vector3): THREE.Mesh` and

```ts
export const MOON_DIR = new THREE.Vector3(0.5, 0.6, -0.4).normalize();
export const NIGHT = {
  horizon: 0x101a2c,           // fog and background
  hemiSky: 0x33456b, hemiGround: 0x0a0d12, hemi: 0.5,
  moon: 0x9fb4e0, moonPower: 0.45,
  cloud: 0x1a2233, cloudGlow: 0x0b0f18,
  unlit: 0.35,                 // multiplier for unlit colours (target beacon)
  blobShadow: 0.12,
};
```

These numbers are starting points to tune by eye against the spec's brightness acceptance; keep them in this one table.

- [ ] **Step 1: `buildNightSky`.** Same dome as `buildSky`, vertex colours from `NIGHT.horizon` at the horizon to near-black overhead, a soft glow round `moonDir`; children: a moon disc (unlit, `fog: false`) and stars as one `THREE.Points` (about 600, placed with `mulberry32(11)` on the upper hemisphere, `sizeAttenuation: false`, `fog: false`, `depthWrite: false`). Three draws, visible only at night.
- [ ] **Step 2: `Renderer.setNight(on)`.** Keep the hemisphere light as a field. On first night use, build the night sky and add it hidden. Then switch, storing nothing but `on`: day values are the constants the constructor already uses, so both branches set every value outright:
  - sky / night sky visibility; `scene.fog.color` and `scene.background`;
  - hemisphere colours and intensity; sun colour, intensity and direction (`SUN_DIR` or `MOON_DIR`; `render()` must use the current one where it positions the sun);
  - cloud material `color` and `emissive`;
  - `renderer.shadowMap.enabled = !on && this.shadows`, `sun.castShadow` to match, and `shadowMap.needsUpdate = true`;
  - blob shadow opacity (0.3 by day, `NIGHT.blobShadow` at night);
  - target beacon materials' colours multiplied by `NIGHT.unlit` at night, original colours by day (keep the originals when the beacon is built).
  The night sky follows the helicopter in `render()` as the day sky does. `lowerQuality()` must not turn shadows back on at night.
- [ ] **Step 3: Wire in `game.ts`.** Where a flight starts, next to `setWind`: `this.renderer.setNight(cfg.night ?? false)`. In `toMenu()`: `this.renderer.setNight(false)`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expected: PASS.
- [ ] **Step 5: Check in the browser** with the preview tool. Before changing anything in this task, take a day Free flight screenshot at the start position for comparison (same settings each time: Trainer, 1500 ft, calm).
  - Night Free flight: stars and moon; from the start the lake shore, the runway outline and Lookout Hill can each be told apart; trees show as dark shapes nearby; the HUD reads clearly. Tune `NIGHT` until true.
  - Night flight → menu: the menu scene is day.
  - Then a day Free flight: screenshot matches the one taken before the task.
  - With Night still the saved choice, start a Training lesson: it flies by day.
- [ ] **Step 6: Commit** `feat: moonlit night sky and lighting`

---

### Task 5: World lights on screen

**Files:**
- Modify: `src/render/night.ts`, `src/render/renderer.ts`, `src/render/worldMesh.ts` (`buildTower`: name the red light mesh `'towerLight'`)

**Interfaces:**
- Consumes: `nightLights(world)`, `NightLight`, `LIGHT` (Task 3); `setNight` (Task 4).
- Produces: in `night.ts`: `buildWorldLights(lights: NightLight[]): { group: THREE.Group; ends: Record<-1 | 1, THREE.Points> }`.

- [ ] **Step 1: `buildWorldLights`.** At most 4 draws: one `THREE.Points` with per-vertex colour for every light except the two end rows; one `THREE.Points` per end row (so each can be recoloured by changing its material colour); nothing else. Material for all: a soft round glow texture drawn once on a canvas, additive blending, `depthWrite: false`, `fog: false`, `sizeAttenuation: true` with a size that keeps a runway light at least 2 px across from 1500 m at a 1080 px tall view (raise the size, or switch off attenuation with a pixel size, whichever holds that floor without lights ballooning at 20 m). Windows share the main point set and are made quieter by writing their vertex colour at 60% brightness, not by a different size.
- [ ] **Step 2: Show them.** The renderer builds the group on first night use, adds it to the scene, and `setNight` shows or hides it.
- [ ] **Step 3: Runway end colours.** In `render()` at night: for each end, with the runway area's centre and length axis, the end row is green when the camera's distance along that axis is beyond the end (`along * end > halfLength`), red otherwise. Set the row material's colour only when it changes.
- [ ] **Step 4: Tower light.** At night the mesh named `'towerLight'` is visible for 1.2 s in every 2 s, on the simulation clock passed to `render()` (see Task 6 Step 3); by day it is always visible, as now.
- [ ] **Step 5: Run** `npm run typecheck && npx vitest run`. Expected: PASS.
- [ ] **Step 6: Check in the browser.** At night: runway edges white along the full length; approaching from the south the near row is green and the far row red, and from the north the same, mirrored; the lake helipad shows a green square with yellow lights at the water; houses show warm windows; a red light on Lookout Hill; the tower light flashes. By day none of it is visible. Log `renderer.info.render.calls` for the same view at night with the lights group hidden and shown: the difference is at most 4. Remove the log.
- [ ] **Step 7: Commit** `feat: runway, helipad, house and hazard lights at night`

---

### Task 6: Helicopter lights

**Files:**
- Create: `src/render/heliLights.ts`
- Modify: `src/render/helicopterModel.ts` (`HelicopterModel`, `buildHelicopter`), `src/render/renderer.ts`, `src/game/game.ts` (pass the session clock)

**Interfaces:**
- Consumes: `setNight` (Task 4).
- Produces:

```ts
export interface HeliLights { group: THREE.Group; beacon: THREE.Mesh; spot: THREE.SpotLight; panelGlow: THREE.Mesh }
export function buildHeliLights(id: AircraftId): HeliLights;
// HelicopterModel gains:  lights: HeliLights;
// Renderer.render gains a last parameter:  simTime = 0   (seconds of simulation time)
```

- [ ] **Step 1: `buildHeliLights`.** A table `LIGHT_POINTS: Record<AircraftId, { left; right; tail; top; nose }>` of positions in the model's own space, read off each model's geometry (widest point of the cabin or skid ends for left/right, tail tip, top of the mast fairing, under the nose). Small unlit meshes: red on the left, green on the right, white on the tail, red beacon on top, and a white lens under the nose. `spot`: `THREE.SpotLight(0xfff1d0)`, `distance` 120, `angle` 0.5, `penumbra` 0.6, no shadows, at the nose point, its target a child placed forward and down at about 25° below the nose line. `panelGlow`: a faint unlit warm plane just in front of the dashboard face in the cockpit group, low opacity. The group and the panel glow start hidden.
- [ ] **Step 2: Attach.** `buildHelicopter` builds the lights, adds `group` to the model root (so they show in chase and cockpit view) and `panelGlow` to `cockpit`, and returns them on the model.
- [ ] **Step 3: Drive from the renderer.** `setNight` and `useModel` both call one private `syncHeliLights()`: for every model in `this.models`, `lights.group.visible` and `panelGlow.visible` are `night && model === this.heli`. In `render()` at night: `beacon.visible = simTime % 1 < 0.15`. `game.ts` passes the session's elapsed simulation time (the session's own clock; 0 behind the menu), so a paused game shows a frozen beacon.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expected: PASS.
- [ ] **Step 5: Check in the browser.** For the Trainer and then the heavy helicopter, at night, in chase view and cockpit view:
  - red on the left, green on the right, white on the tail, a flashing red beacon;
  - below about 100 ft the landing light makes a pool on the ground ahead that moves with the nose; trees and the lake helipad deck light up inside it; tune the spot's intensity until the pool is clear at 100 ft and not blown out at 10 ft;
  - the dashboard reads in cockpit view;
  - pause: the beacon is frozen and the scene is still night; Restart stays night;
  - fly a night flight in the Trainer, exit, fly a night flight in the heavy: no stray lights hang where the Trainer was;
  - by day: no lights, no pool, and the day screenshot from Task 4 still matches.
- [ ] **Step 6: Commit** `feat: navigation lights, beacon and landing light on both helicopters`

---

### Task 7: Whole-feature check

- [ ] **Step 1: Run** `npm test && npm run build`. Expected: PASS, build succeeds.
- [ ] **Step 2: Old save.** In the browser, set `localStorage['autorotation.v1']` to a save with no `settings.time` and no `pilot.logbook.nightSeconds` (take the current save, delete those two keys), reload: the menu loads, stars, rank and logbook are unchanged, Free flight shows Day.
- [ ] **Step 3: Night hours.** Fly a night Free flight for about 20 s, exit to menu, open the licence screen: the Night line shows about 0:20 of flight time (in the format `formatFlightTime` gives) and Hours rose by the same amount.
- [ ] **Step 4: Cost.** Compare `renderer.info.render.calls` and frame time for the same view by day and at night; record both in the commit message. Night must add no more than 4 calls for world lights plus the helicopter light meshes and night sky, and frame time must not be worse than day by more than 10%.
- [ ] **Step 5: Land at night** on the runway and on the lake helipad in each helicopter, using the lights. Send the screenshots to Carlos.
- [ ] **Step 6: Update `README.md`**: add night to the Free flight options and `nightLights.ts`, `night.ts`, `heliLights.ts` to the file list. Commit `docs: night flight in the README`.
