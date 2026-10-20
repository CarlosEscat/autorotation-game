# Training Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Training" mode: 8 short levels, each teaching one autorotation skill with live instructions, a pass/fail goal and a 1–3 star rating.

**Architecture:** Levels are data (`src/game/levels.ts`): a flight config override plus an `Objective` that watches the `FlightSession` every fixed step and reports instruction text, progress and pass/fail. `FlightSession` gains a start override (position, heading, already-autorotating entry) and a cushion-assist override. `Game` runs a level the same way as a free flight and stops the sim when the objective decides. UI adds a training screen, an in-flight lesson panel and a level result screen; the renderer adds gates for level 1.

**Tech Stack:** TypeScript, Three.js, Vite, Vitest.

**Spec:** The 8-level table agreed in chat on 2026-10-20 (Basic flying, Engine failure, Glide speed, Pick a field, The flare, Level and cushion, Wind, Checkride). Open questions resolved with defaults: levels unlock in order; level 1 (gates) is kept; "Training" sits beside "How to fly".

## Global Constraints

- No new dependencies.
- Levels must be deterministic for identical inputs (same rule as scoring).
- Instruction text names keys for the current input device (keyboard vs touch), reusing the wording map in `src/game/hints.ts`.
- Progress is stored in the existing `autorotation.v1` localStorage blob; old saves must still load.
- Free flight (menu "Start flight") behaves exactly as before.

## Review Focus

- Pausing (or the tab going hidden) mid-level must not advance objective timers. → Objectives only advance inside `session.step` loop, which doesn't run while paused (Task 3 keeps it there).
- Restart (R / Enter / pause menu) during a level restarts that level, not a free flight. → Task 3 test via `Game` is manual; covered in browser check (Task 5).
- A crash in any level is a fail with the crash reason shown, never a hang. → Task 1 test `crash fails a non-landing level`.
- Locked levels cannot be started from the training screen; old saves without `training` load with level 1 unlocked. → Task 1 test `unlocking`.
- Touch players see touch wording in instructions. → Task 1 test `instructions use touch wording`.

---

### Task 1: Level definitions, objectives and session start overrides

**Files:**
- Create: `src/game/levels.ts`
- Modify: `src/game/session.ts` (FlightConfig `start`, `cushion`; apply in constructor / `applyAssists`)
- Modify: `src/game/hints.ts` (export the key-wording map as `KEY_WORDS`)
- Test: `tests/levels.test.ts`

**Interfaces:**
- Produces:
  - `FlightConfig.start?: { x: number; z: number; yaw: number; autorotating?: { sinkMs: number; collective: number; pitchDeg?: number; rpmPct?: number } }`
  - `FlightConfig.cushion?: boolean` (default: `difficulty === 'easy'`)
  - `type ObjectiveState = 'running' | 'passed' | 'failed'`
  - `interface ObjectiveStatus { state: ObjectiveState; text: string; progress: number | null; stars: number; reason: string | null }`
  - `interface LevelContext { session: FlightSession; targetId: string | null; mode: 'keyboard' | 'touch' }`
  - `interface Objective { update(ctx: LevelContext, dt: number): ObjectiveStatus }` — called after every `session.step`; once it returns passed/failed it keeps returning that.
  - `interface Gate { x: number; y: number; z: number; radius: number }`
  - `interface LevelDef { id: string; num: number; title: string; teaches: string; config: FlightConfig; target: string | null; gates: Gate[]; makeObjective(world: World): Objective }`
  - `LEVELS: LevelDef[]`, `levelConfig(def): FlightConfig`, `isUnlocked(index: number, progress: Record<string, number>): boolean`

Level table (values to use):

| id | start | config | goal / fail | stars |
|---|---|---|---|---|
| `basics` | 600 ft, 70 kt, calm, engine never fails | easy | fly through 3 gates in order (horizontal dist < radius, height within ±radius) | time < 70 s → 3, < 110 s → 2 |
| `failure` | 3000 ft, 70 kt, calm, fails at 3 s | easy | collective lowered within 3 s (else fail); NR 90–110 % for 15 s total | reaction < 1.0 s & green ratio > 0.85 → 3; reaction < 1.6 s → 2 |
| `glide` | 2500 ft, autorotating at 70 kt | easy | 20 s total at 55–70 kt with NR > 80 %; fail below 300 ft AGL | 20 s / elapsed > 0.8 → 3, > 0.55 → 2 |
| `field` | 1000 ft autorotating, target preselected = clearing | easy | be over the *selected* area above 150 ft AGL; fail below 150 ft elsewhere | height left > 120 m → 3, > 80 m → 2 |
| `flare` | 300 ft autorotating at 60 kt, 380 m short of the meadow | easy | flare (pitch > 8°) started between 25 and 100 ft, then a non-crash landing; fail if below 20 ft with no flare | flare start 35–70 ft and touchdown < 8 kt → 3; non-damaged → 2 |
| `cushion` | 40 ft, ~15 kt, sinking 4 m/s, pitch +6°, NR 105 % over the meadow | normal, cushion off | non-crash landing at < 500 fpm | < 200 fpm → 3, < 300 fpm → 2 |
| `wind` | 1000 ft autorotating, heading east, 15 kt from 330° | easy | safe landing in an area, nose within 30° of the wind | excellent → 3, safe → 2, damaged → 1 |
| `checkride` | 1000 ft, 70 kt, 8 kt from N, normal | normal | outcome excellent/safe | score ≥ 85 → 3, ≥ 70 → 2 |

- [ ] **Step 1: Write failing tests** in `tests/levels.test.ts`, flying with `makeBot` + the target-steering loop from `tests/session.test.ts` and calling `objective.update` after every step:
  - `each level can be passed by good technique` — for `failure`, `glide`, `flare`, `cushion`, `checkride`: status ends `passed`, `stars >= 1`.
  - `failure: never lowering the collective fails` — `state === 'failed'`, reason mentions "collective".
  - `flare: no flare fails` — bot with `flareHeight: 0` → failed, reason mentions "flare".
  - `crash fails a non-landing level` — `glide` with `lowerCollective: false` → failed.
  - `basics: flying through the gates passes` — a gate-seeking bot passes all three.
  - `unlocking` — `isUnlocked(0, {}) === true`, `isUnlocked(1, {}) === false`, `isUnlocked(1, { basics: 1 }) === true`.
  - `instructions use touch wording` — `failure` objective text with `mode: 'touch'` contains "COLL".
- [ ] **Step 2: Run** `npx vitest run tests/levels.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** session overrides (autorotating entry: `failEngine`, clear `yawKick`, set collective/sink/pitch/omega, phase `autorotation`, `rec.onFailure`) and `levels.ts` per the table.
- [ ] **Step 4: Run** `npm test` — all pass. Tune start positions if a level is not passable by the bot.
- [ ] **Step 5: Commit** `feat: training level definitions and objectives`.

### Task 2: Gates in the renderer

**Files:** Modify `src/render/worldMesh.ts` (`buildGate(radius): THREE.Group`), `src/render/renderer.ts` (`setGates(gates: Gate[], next: number)`).

- [ ] Gates are low-poly torus rings facing the direction to the next gate; next gate yellow, later gates white, passed gates hidden. `setGates([], 0)` clears them.
- [ ] Verified visually in Task 5.

### Task 3: Game flow for levels

**Files:** Modify `src/game/game.ts`.

**Interfaces:** Consumes `LEVELS`, `levelConfig`, `isUnlocked`, `Objective`; produces `startLevel(index: number)`.

- [ ] `Saved.training: Record<string, number>` (best stars per level id), merged from defaults on load.
- [ ] `startLevel(i)`: builds `FlightSession(world, levelConfig(def))`, sets target from `def.target` (beacon hidden when null), gates, camera, `this.level = { index, objective }`.
- [ ] Per sim step: `objective.update(...)`; HUD lesson panel gets `{ title, text, progress }`; free-flight hints are off during levels.
- [ ] On passed/failed (or session `stopped`): stop stepping, save stars if better, show level result. Restart/confirm/pause-menu restart act on the level.
- [ ] Gates: renderer `setGates(def.gates, nextGate)`; objective exposes `nextGate` for `basics`.

### Task 4: UI — training screen, lesson panel, level result

**Files:** Modify `src/ui/screens.ts`, `src/hud/hud.ts`, `src/style.css`.

- [ ] Menu gains a "Training" button → training screen: 8 cards (number, title, "teaches" line, ★★☆, lock), Back button. Clicking an unlocked card calls `onStartLevel(index)`.
- [ ] HUD `setLesson(l: { title: string; text: string; progress: number | null } | null)`: panel above the hint area with level title, instruction and a progress bar.
- [ ] `showLevelResult({ def, status, isLast })`: "LEVEL PASSED" + stars or "TRY AGAIN" + reason; buttons Next level (passed and not last) / Retry / Training. Enter = Next if available else Retry.

### Task 5: Verify and commit

- [ ] `npm test`, `npm run build` pass.
- [ ] Browser: training screen shows locks/stars; level 1 shows gates and lesson panel; failing level 2 (do nothing) shows the reason; Retry restarts the same level. No console errors.
- [ ] Commit `feat: training mode with 8 levels`; README controls/features section mentions Training.
