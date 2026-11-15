# Pilot Licence, Logbook and Ranks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the player a licence card (name, callsign, rank, ratings) backed by a logbook that every flight feeds, with ranks earned by meeting requirements.

**Architecture:** Three pure modules hold the rules: `logbook.ts` (totals and a per-flight recorder), `licence.ts` (ratings, rank table, requirement progress), `pilot.ts` (the saved block and pending promotions). `game.ts` feeds the recorder each simulation step and saves; `screens.ts` renders the menu strip, the licence screen and the promotion panel.

**Tech Stack:** TypeScript, Vite, three.js, vitest (node environment). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-pilot-licence-design.md`

## Global Constraints

- Follow `MENU_SPEC.md`: panel, key and colour tokens. Green = passed/met, cyan = next, red only for warnings, no new accent colours, B612 only, muted text at or above 4.5:1.
- Save stays in localStorage under `autorotation.v1`; a save without a `pilot` block must load with defaults and keep its stars.
- Nothing flyable today becomes locked. Ratings and ranks are display only.
- A rank once reached is never lowered.
- No prompt before the first flight; name and callsign are optional. Name max 20 characters, callsign max 12.
- Flight time is counted in simulation time (the fixed step `dt`), never wall-clock time.
- All player-entered text is rendered through `esc()` in `screens.ts`.
- Rank numbers live in one table in `licence.ts`.
- Work on a feature branch, not `main`.

## Review Focus

1. **Damaged save**: a `pilot` block with missing fields, `NaN`/negative totals, or an unknown rank loads as sane defaults and never throws. (Task 3)
2. **Hostile or empty name**: `<img onerror>`, whitespace only, or 200 characters is trimmed, clamped and escaped; empty shows "Pilot". (Task 3 for clamping, Task 5 for escaping)
3. **Flight abandoned from pause**: pause → Exit to menu, or Restart, keeps the time already flown and does not count the flight twice. (Task 4)
4. **Enter pressed while the promotion panel is open** dismisses the panel; it does not start the next lesson underneath. (Task 6)
5. **Storage unavailable** (private window): a promotion is shown once per session, not on every return to the menu. (Task 6)

---

### Task 1: Logbook and flight recorder

**Files:**
- Create: `src/game/logbook.ts`
- Test: `tests/logbook.test.ts`

**Interfaces:**
- Consumes: `AircraftId` from `src/sim/aircraft.ts`; `FlightSession` from `src/game/session.ts` (`phase`, `crashed`, `state.agl`, `fire?.out`, `config.aircraft`).
- Produces:

```ts
export interface Logbook {
  airSeconds: Record<AircraftId, number>; // { light, heavy }
  flights: number;
  landings: number;
  crashes: number;
  firesOut: number;
}
export const MIN_AIRBORNE_S = 10;
export function emptyLogbook(): Logbook;
export function totalSeconds(b: Logbook): number;
export interface FlightSample { aircraft: AircraftId; airborne: boolean; crashed: boolean; fireOut: boolean }
export function sampleOf(session: FlightSession): FlightSample;
/** One per flight. Mutates `book` as the flight goes on. */
export class LogRecorder {
  constructor(book: Logbook);
  step(sample: FlightSample, dt: number): void;
}
```

- [ ] **Step 1: Write the failing tests** in `tests/logbook.test.ts`

```ts
const air = { aircraft: 'light' as const, airborne: true, crashed: false, fireOut: false };
const ground = { ...air, airborne: false };
const run = (r: LogRecorder, s: FlightSample, seconds: number) => { for (let i = 0; i < seconds * 10; i++) r.step(s, 0.1); };

it('counts only airborne time, per helicopter', () => {
  const b = emptyLogbook(); const r = new LogRecorder(b);
  run(r, air, 30); run(r, ground, 60); run(r, { ...air, aircraft: 'heavy' }, 5);
  expect(b.airSeconds.light).toBeCloseTo(30); expect(b.airSeconds.heavy).toBeCloseTo(5);
  expect(totalSeconds(b)).toBeCloseTo(35);
});
it('counts a flight once, after 10 s airborne', () => {
  const b = emptyLogbook(); const r = new LogRecorder(b);
  run(r, air, 9); expect(b.flights).toBe(0);
  run(r, air, 2); run(r, ground, 1); run(r, air, 20); expect(b.flights).toBe(1);
});
it('counts a landing only after 10 s in the air', () => {
  const b = emptyLogbook(); const r = new LogRecorder(b);
  run(r, air, 12); run(r, ground, 1); expect(b.landings).toBe(1);
  run(r, air, 3); run(r, ground, 1); expect(b.landings).toBe(1); // a hop
  run(r, air, 11); run(r, ground, 1); expect(b.landings).toBe(2);
});
it('a crash is a crash, not a landing, and counts once', () => {
  const b = emptyLogbook(); const r = new LogRecorder(b);
  run(r, air, 15); run(r, { ...ground, crashed: true }, 3);
  expect(b.crashes).toBe(1); expect(b.landings).toBe(0);
});
it('counts a fire once when it goes out', () => {
  const b = emptyLogbook(); const r = new LogRecorder(b);
  run(r, air, 5); run(r, { ...air, fireOut: true }, 5); expect(b.firesOut).toBe(1);
});
it('a flight that starts on the ground logs nothing until it lifts off', () => {
  const b = emptyLogbook(); const r = new LogRecorder(b);
  run(r, ground, 30); expect(b).toEqual(emptyLogbook());
});
it('sampleOf reads a real session: airborne at the start of a free flight', () => {
  const s = new FlightSession(createWorld(), { ...DEFAULT_CONFIG, freeFlight: true });
  expect(sampleOf(s)).toEqual({ aircraft: 'light', airborne: true, crashed: false, fireOut: false });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/logbook.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/game/logbook.ts`** to the interface above. `sampleOf`: `airborne` is `phase` not `'ground'`/`'done'` and `state.agl > 0.5`; `aircraft` is `config.aircraft ?? 'light'`; `fireOut` is `fire?.out ?? false`. The recorder keeps the length of the current airborne run; a landing is an airborne → not-airborne change with `crashed` false and a run of at least `MIN_AIRBORNE_S`.
- [ ] **Step 4: Run** `npx vitest run tests/logbook.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: logbook totals and flight recorder`

---

### Task 2: Ratings and ranks

**Files:**
- Create: `src/game/licence.ts`
- Test: `tests/licence.test.ts`

**Interfaces:**
- Consumes: `Logbook`, `totalSeconds` (Task 1); `LEVELS`, `ALL_LEVELS` from `src/game/levels.ts`.
- Produces:

```ts
export type RatingId = 'emergency' | 'heavy' | 'firefighter';
export interface RatingDef { id: RatingId; title: string; earnedBy: string; levels: string[] }
export const RATINGS: RatingDef[];
export type RankId = 'student' | 'private' | 'commercial' | 'captain';
export const RANK_ORDER: RankId[];
export const RANK_TITLES: Record<RankId, string>;
export type Stars = Record<string, number>;
export interface Requirement { id: string; label: string; have: number; need: number; met: boolean; kind: 'count' | 'time' | 'flag' }
export const MAX_STARS: number; // ALL_LEVELS.length * 3
export function totalStars(stars: Stars): number;
export function ratingsHeld(stars: Stars): RatingId[];
export function requirementsFor(rank: RankId, stars: Stars, book: Logbook): Requirement[];
/** Highest rank whose requirements, and those of every rank below it, are all met. */
export function earnedRank(stars: Stars, book: Logbook): RankId;
export function nextRank(rank: RankId): RankId | null;
/** "12 min" below one hour, otherwise "1.5 h". */
export function formatFlightTime(seconds: number): string;
```

Exact values:

| Rating | title | levels | earnedBy |
|---|---|---|---|
| emergency | Emergency | `checkride` | Pass the Checkride |
| heavy | Heavy | `conversion` | Pass the Conversion flight |
| firefighter | Firefighter | `firstfire`, `forestfire` | Pass both fire missions |

| Rank | title | requirements (`id`: need) |
|---|---|---|
| student | Student Pilot | none |
| private | Private Pilot | `beginner` (flag: every level with tier `beginner` has stars) · `stars`: 10 · `time`: 900 s |
| commercial | Commercial Pilot | `rating-emergency` (flag) · `stars`: 35 · `time`: 5400 s · `landings`: 40 |
| captain | Captain | `ratings` (count: 3 ratings) · `stars`: 60 · `time`: 18000 s · `landings`: 150 |

Labels: "All Beginner lessons", "Emergency rating", "All three ratings", "N stars", "N landings", and for time `formatFlightTime(need)` + " flown".

- [ ] **Step 1: Write the failing tests** in `tests/licence.test.ts`

```ts
const all = (n: number): Stars => Object.fromEntries(ALL_LEVELS.map((l) => [l.id, n]));
const book = (seconds: number, landings: number): Logbook => ({ ...emptyLogbook(), airSeconds: { light: seconds, heavy: 0 }, landings });

it('ratings come from stars', () => {
  expect(ratingsHeld({})).toEqual([]);
  expect(ratingsHeld({ checkride: 1 })).toEqual(['emergency']);
  expect(ratingsHeld({ firstfire: 3 })).toEqual([]); // needs both fire missions
  expect(ratingsHeld({ checkride: 1, conversion: 2, firstfire: 1, forestfire: 1 })).toEqual(['emergency', 'heavy', 'firefighter']);
});
it('every rating points at levels that exist', () => {
  for (const r of RATINGS) for (const id of r.levels) expect(ALL_LEVELS.some((l) => l.id === id)).toBe(true);
});
it('a new pilot is a student', () => expect(earnedRank({}, emptyLogbook())).toBe('student'));
it('private needs beginner lessons, 10 stars and 15 minutes', () => {
  const beginner: Stars = { basics: 2, collective: 2, hover: 2, takeoff: 2, landing: 2 };
  expect(earnedRank(beginner, book(899, 0))).toBe('student');
  expect(earnedRank(beginner, book(900, 0))).toBe('private');
  expect(earnedRank({ ...beginner, landing: 0, rings: 3 }, book(900, 0))).toBe('student');
});
it('commercial and captain boundaries', () => {
  expect(earnedRank(all(3), book(5400, 39))).toBe('private');
  expect(earnedRank(all(3), book(5400, 40))).toBe('commercial');
  expect(earnedRank(all(3), book(18000, 149))).toBe('commercial');
  expect(earnedRank(all(3), book(18000, 150))).toBe('captain');
});
it('ranks are earned in order: captain numbers without the checkride stay private', () => {
  expect(earnedRank({ ...all(3), checkride: 0 }, book(18000, 150))).toBe('private');
});
it('requirements report progress', () => {
  const r = requirementsFor('commercial', all(1), book(2700, 12));
  expect(r.map((x) => [x.id, x.have, x.need, x.met])).toEqual([
    ['rating-emergency', 1, 1, true], ['stars', 23, 35, false], ['time', 2700, 5400, false], ['landings', 12, 40, false],
  ]);
  expect(requirementsFor('student', {}, emptyLogbook())).toEqual([]);
});
it('formats flight time', () => {
  expect(formatFlightTime(0)).toBe('0 min'); expect(formatFlightTime(900)).toBe('15 min');
  expect(formatFlightTime(3599)).toBe('59 min'); expect(formatFlightTime(5400)).toBe('1.5 h');
});
it('max stars is three per level', () => expect(MAX_STARS).toBe(69));
```

- [ ] **Step 2: Run** `npx vitest run tests/licence.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/game/licence.ts`** to the interface and tables above. Stars for ids that are not current levels are ignored by `totalStars`.
- [ ] **Step 4: Run** `npx vitest run tests/licence.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: ratings, rank table and requirement progress`

---

### Task 3: Pilot save block and pending promotions

**Files:**
- Create: `src/game/pilot.ts`
- Modify: `src/game/game.ts` (`Saved`, `load`)
- Test: `tests/pilot.test.ts`

**Interfaces:**
- Consumes: `Logbook`, `emptyLogbook` (Task 1); `RankId`, `RatingId`, `RANK_ORDER`, `Stars`, `earnedRank`, `ratingsHeld` (Task 2).
- Produces:

```ts
export const NAME_MAX = 20;
export const CALLSIGN_MAX = 12;
export const DEFAULT_NAME = 'Pilot';
export interface Pilot {
  name: string;       // '' when not set
  callsign: string;   // '' when not set
  logbook: Logbook;
  rank: RankId;                // highest rank reached
  shownRank: RankId;           // last rank announced to the player
  shownRatings: RatingId[];    // ratings already announced
}
export function newPilot(): Pilot;
/** Anything from storage in, a valid Pilot out. Never throws. */
export function normalizePilot(raw: unknown): Pilot;
export function cleanName(s: string, max: number): string; // trim, collapse whitespace, clamp
/** Raises `pilot.rank` to what the logbook now earns. Never lowers it. */
export function updateRank(pilot: Pilot, stars: Stars): void;
export interface Promotion { rank: RankId | null; ratings: RatingId[] }
/** What the player has earned but not yet been told, or null. */
export function pendingPromotion(pilot: Pilot, stars: Stars): Promotion | null;
export function acknowledge(pilot: Pilot, stars: Stars): void;
```

- [ ] **Step 1: Write the failing tests** in `tests/pilot.test.ts`

```ts
it('a missing or damaged block becomes a new pilot', () => {
  for (const raw of [undefined, null, 'x', 42, [], { logbook: 'no' }]) expect(normalizePilot(raw)).toEqual(newPilot());
});
it('bad numbers and unknown values are dropped, good ones kept', () => {
  const p = normalizePilot({ name: '  Ana   Ruiz ', callsign: 'x'.repeat(40), rank: 'admiral', shownRatings: ['heavy', 'bogus'],
    logbook: { airSeconds: { light: 120, heavy: NaN }, flights: -3, landings: 7.9, crashes: '2', firesOut: Infinity } });
  expect(p.name).toBe('Ana Ruiz'); expect(p.callsign).toHaveLength(12); expect(p.rank).toBe('student');
  expect(p.shownRatings).toEqual(['heavy']);
  expect(p.logbook).toEqual({ airSeconds: { light: 120, heavy: 0 }, flights: 0, landings: 7, crashes: 0, firesOut: 0 });
});
it('cleanName clamps and never returns only spaces', () => {
  expect(cleanName('   ', NAME_MAX)).toBe(''); expect(cleanName('a'.repeat(200), NAME_MAX)).toHaveLength(20);
});
it('rank rises with the logbook and never falls', () => {
  const p = newPilot(); const stars = { basics: 2, collective: 2, hover: 2, takeoff: 2, landing: 2 };
  p.logbook.airSeconds.light = 900; updateRank(p, stars); expect(p.rank).toBe('private');
  updateRank(p, {}); expect(p.rank).toBe('private');
});
it('a promotion is pending until acknowledged, then gone', () => {
  const p = newPilot(); const stars = { checkride: 1 };
  expect(pendingPromotion(p, stars)).toEqual({ rank: null, ratings: ['emergency'] });
  acknowledge(p, stars); expect(pendingPromotion(p, stars)).toBeNull();
  p.rank = 'private'; expect(pendingPromotion(p, stars)).toEqual({ rank: 'private', ratings: [] });
});
it('an old save with stars gets its ratings announced once', () => {
  const p = normalizePilot(undefined);
  expect(pendingPromotion(p, { checkride: 3, conversion: 1 })?.ratings).toEqual(['emergency', 'heavy']);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/pilot.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/game/pilot.ts`** to the interface. Counts are floored non-negative finite numbers, anything else becomes 0.
- [ ] **Step 4: Add `pilot: Pilot` to `Saved` in `src/game/game.ts`**; `load()` sets `pilot: normalizePilot(parsed.pilot)` (and `newPilot()` in the fallback), then calls `updateRank(saved.pilot, saved.training)`.
- [ ] **Step 5: Run** `npx vitest run && npm run typecheck`. Expected: all PASS, no type errors.
- [ ] **Step 6: Commit** `feat: pilot block in the save, with pending promotions`

---

### Task 4: Record every flight

**Files:**
- Modify: `src/game/game.ts`
- Test: `tests/logbook.test.ts` (one added test)

**Interfaces:**
- Consumes: `LogRecorder`, `sampleOf` (Task 1); `updateRank` (Task 3).
- Produces: `this.saved.pilot.logbook` is current and saved whenever the player is not flying.

- [ ] **Step 1: Add the failing test** to `tests/logbook.test.ts`: a restart must not double count.

```ts
it('two recorders on one book add up: a restarted flight keeps its time and counts each flight once', () => {
  const b = emptyLogbook();
  run(new LogRecorder(b), air, 20); run(new LogRecorder(b), air, 20);
  expect(totalSeconds(b)).toBeCloseTo(40); expect(b.flights).toBe(2);
  run(new LogRecorder(b), air, 4); expect(b.flights).toBe(2); // abandoned after 4 s
});
```

- [ ] **Step 2: Run** `npx vitest run tests/logbook.test.ts`. Expected: PASS already if Task 1 is right; if it fails, fix the recorder, not the test.
- [ ] **Step 3: Wire the recorder in `game.ts`.**
  - New field `private recorder: LogRecorder | null = null`.
  - `launch()` creates `new LogRecorder(this.saved.pilot.logbook)`. The idle menu session in the constructor gets none.
  - In `frame()`, inside the fixed-step loop right after `session.step(...)`: `this.recorder?.step(sampleOf(session), this.stepper.dt)`.
  - New `private commitLog()`: `updateRank(this.saved.pilot, this.saved.training); save(this.saved)`. Call it from `pause()`, `toMenu()`, `finishFreeFlight()`, and `updateLevel()` where the result is shown (after stars are stored).
  - `toMenu()` sets `this.recorder = null` after committing.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Check in the browser.** Start the dev server with the preview tool, fly a Free flight for about 20 s, pause, exit to menu, then read the save: `JSON.parse(localStorage.getItem('autorotation.v1')).pilot.logbook`. Expected: `airSeconds.light` near the time flown, `flights` 1. Reload the page and read it again: unchanged (the menu scene logs nothing).
- [ ] **Step 6: Commit** `feat: every flight feeds the logbook`

---

### Task 5: Licence card on the menu and the licence screen

**Files:**
- Modify: `src/ui/screens.ts`, `src/style.css`, `src/game/game.ts`

**Interfaces:**
- Consumes: `Pilot`, `DEFAULT_NAME`, `NAME_MAX`, `CALLSIGN_MAX`, `cleanName` (Task 3); `RATINGS`, `RANK_TITLES`, `ratingsHeld`, `requirementsFor`, `nextRank`, `totalStars`, `MAX_STARS`, `formatFlightTime`, `Requirement` (Task 2); `totalSeconds` (Task 1).
- Produces, on `Screens`:

```ts
setPilot(pilot: Pilot, stars: Stars): void;      // redraws the menu strip
showLicence(pilot: Pilot, stars: Stars): void;   // full screen, ScreenName 'licence'
// added to MenuHandlers:
onLicence(): void;
onPilotName(name: string, callsign: string): void;
```

- [ ] **Step 1: Menu strip.** In the main menu panel, below the two main keys, add `<button class="key licence-strip" data-a="licence">`. Line one: name (or "Pilot"), callsign in quotes when set, rank title at the right. Line two: a meter and "`met` of `total` for `next rank title`", or "Top rank held" at Captain. `setPilot` fills it. Its `aria-label` reads the same facts as a sentence.
- [ ] **Step 2: Licence screen.** Add `'licence'` to `ScreenName` and to `this.all`. `showLicence` renders one `.panel.wide` with `SCREWS` and `backKey()`, in this order: title "Pilot licence" with `★ totalStars / MAX_STARS`; name and callsign with an Edit key; rank; one stamp per rating (held: green with ✓; not held: muted, with its `earnedBy` text); "Next: `rank title`" with one row per requirement; the logbook. Requirement rows: `flag` kind shows ✓ or an empty box; `count` and `time` show a meter (`have / need`, capped at 1) and the current value in brackets, using `formatFlightTime` for time. Met rows are green. Logbook lines: `Hours` total with light and heavy split, `Flights · Landings · Crashes`, `Fires out`.
- [ ] **Step 3: Editing.** The Edit key swaps name and callsign for two `<input>`s (`maxlength` `NAME_MAX` and `CALLSIGN_MAX`, labelled "Name" and "Callsign") with Save and Cancel keys. Save calls `onPilotName(cleanName(...), cleanName(...))`. While an input has focus, game keys (Enter, M, P, R) must not act: the click/keydown handling in `Screens` stops propagation from inputs, and Enter in an input saves.
- [ ] **Step 4: Styles** in `src/style.css` using existing tokens only (`--lit-green`, `--lit-cyan`, `--legend-muted`, `--locked`, well colour for meters). The strip is quieter than `.key.main`: no lamp, 14 to 16 px text. The licence panel scrolls inside itself on short screens (the `.panel` rule already allows it); at widths under 480 px the ratings wrap and nothing overflows sideways.
- [ ] **Step 5: Wire in `game.ts`.** `onLicence` → `this.screens.showLicence(this.saved.pilot, this.saved.training)`. `onPilotName` → store on `this.saved.pilot`, `save`, then `showLicence` again. `toMenu()` calls `this.screens.setPilot(...)` after `commitLog()`.
- [ ] **Step 6: Run** `npm run typecheck && npx vitest run`. Expected: PASS.
- [ ] **Step 7: Check in the browser** with the preview tool:
  - Fresh save (clear `autorotation.v1`, reload): strip shows "Pilot", "Student Pilot", "0 of 3 for Private Pilot". The licence screen shows three unearned ratings with how to earn each.
  - Set the name to `<img src=x onerror=alert(1)>` and save: it shows as text, no alert, clamped to 20 characters. Set the name to spaces only: shows "Pilot".
  - Seed a rich save from the console (`pilot.logbook.airSeconds.light = 6000`, `landings = 45`, all levels 3 stars), reload: strip shows the rank the tests predict, requirement rows show green ticks.
  - Mobile preset (375 wide): no sideways scroll on the menu or the licence screen; back key works.
  - Keyboard: Tab reaches the strip, Enter opens it, focus ring is cyan.
- [ ] **Step 8: Commit** `feat: licence card on the menu and licence screen`

---

### Task 6: Promotion panel

**Files:**
- Modify: `src/ui/screens.ts`, `src/style.css`, `src/game/game.ts`

**Interfaces:**
- Consumes: `pendingPromotion`, `acknowledge`, `Promotion` (Task 3); `RANK_TITLES`, `RATINGS` (Task 2).
- Produces, on `Screens`: `showPromotion(p: Promotion): void`, `hidePromotion(): void`; on `MenuHandlers`: `onPromotionSeen(): void`.

- [ ] **Step 1: Panel.** A `.screen.promotion` element that is **not** in `this.all`, layered above the others, so `show()` does not hide it. Content in a `.panel.small`: one line per rating, "Rating earned: `title`", then if a rank was earned "Promoted to `rank title`", and one primary key "Continue (Enter)". It takes focus when shown.
- [ ] **Step 2: Wire in `game.ts`.**
  - New field `private promotionOpen = false` and `private announce()`: if `pendingPromotion(pilot, training)` is not null, `showPromotion` and set the flag.
  - Call `announce()` at the end of `updateLevel()` when the result screen is shown, and in `toMenu()`. Do not call it while `state === 'flying'`.
  - `onPromotionSeen`: `acknowledge(pilot, training)`, `save`, `hidePromotion()`, clear the flag, refresh the strip with `setPilot`.
  - In the `confirm` action handler, first line: if `promotionOpen`, run `onPromotionSeen` and return. Same guard for `restart`.
  - `acknowledge` changes the in-memory pilot even when `save` fails, so a blocked localStorage cannot make the panel reappear in the same session.
- [ ] **Step 3: Run** `npm run typecheck && npx vitest run`. Expected: PASS.
- [ ] **Step 4: Check in the browser** with the preview tool:
  - Seed a save one requirement short of Private (beginner lessons passed, 10 stars, `airSeconds.light = 880`). Fly a Free flight for 30 s, exit to menu: panel says "Promoted to Private Pilot". Continue: the strip shows Private Pilot. Go to Training and back: no panel.
  - Seed a save with every Emergency lesson passed except `checkride`, pass or seed the checkride result so `showLevelResult` runs: the panel sits over the result screen; press Enter once: the panel closes and the result screen is still there; press Enter again: the normal result action runs.
  - Old save with `checkride` already passed and no `pilot` block: on first load the menu shows "Rating earned: Emergency" once.
  - In the console, make `localStorage.setItem` throw, earn a promotion, dismiss it, return to the menu twice: the panel does not come back.
- [ ] **Step 5: Run the whole suite and build:** `npm test && npm run build`. Expected: PASS, build succeeds.
- [ ] **Step 6: Commit** `feat: promotion panel for new ratings and ranks`
