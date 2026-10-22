# Autorotation

A browser-based, low-poly 3D helicopter arcade game in the style of N64-era graphics. You are cruising along when the engine quits. Lower the collective, manage rotor RPM and airspeed, pick a field, flare, and cushion the touchdown. Every attempt is scored out of 100, with a debrief.

> **Disclaimer:** this is an educational arcade prototype. It is **not** a flight-training device. It does not teach operationally validated emergency procedures and is not based on data for any real helicopter type.

## Quick start

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN for phone testing)
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check, then build the production bundle into `dist/` |
| `npm run preview` | Serve `dist/` locally (the service worker only registers in production builds) |
| `npm test` | Run the flight-model and full-attempt tests (Vitest, headless) |
| `npm run typecheck` | TypeScript only |
| `npm run icons` | Regenerate the PWA icons (`scripts/gen-icons.mjs`, no dependencies) |

### Installing as a PWA

Build and serve the app over HTTPS (or `localhost`). Supported browsers then offer "Install". The service worker precaches the app shell and bundles, so the game works offline after the first visit. Static hosting works anywhere because asset paths are relative (`base: './'`).

## Controls

| Keyboard | Action |
| --- | --- |
| **W / S** | Collective up / down |
| **↑ / ↓** (or I / K) | Cyclic forward (nose down) / aft (nose up) |
| **← / →** (or J / L) | Cyclic left / right (bank) |
| **A / D** | Pedals (optional, the tail fin weathervanes the nose at speed) |
| **T** | Cycle the selected landing area (only fields ahead, within 75° of the nose) |
| **C** | Cockpit / chase camera |
| **Mouse drag** | Look around |
| **P / Esc** | Pause |
| **M** | Sound on / off (also a button in the menu, the pause menu and the touch controls; remembered) |
| **Enter / R** | Fly again from the results screen |

**Touch:** the left thumb works the **COLL** lever (absolute position: slide up and down). The right thumb works the **CYCLIC** stick. ◀ ▶ are pedals, and TGT / CAM / II are target, camera and pause. Drag on the view to look around. Each control tracks its own finger, so you can use several at once. Page scrolling and zooming are blocked during play. Landscape is preferred: the game asks for an orientation lock where the browser allows it, and it lays itself out for portrait otherwise.

Cyclic pitch is an *attitude command*: holding a key changes the pitch attitude, and releasing it holds that attitude. Lateral cyclic is a *bank command* that returns to wings-level when released. Both input devices feed the same `ControlInputs` object, which feeds the same simulation.

## How a flight goes

1. Normal cruise at the configured altitude, airspeed and wind (the menu has altitude 700/1000/1500 ft, airspeed 60/70/90 kt, and calm, light or strong wind).
2. After 4 s the engine fails: a warning chime, a banner and **ENGINE OUT**, plus a nose-left yaw kick.
3. Lower the collective at once. Hold about 55–70 kt. Keep NR in the green (90–110 %).
4. Pick a landing area with **T** (only fields you can see ahead can be selected). A yellow beacon marks it. The top bar shows its bearing, its distance, and an advisory **IN REACH / MARGINAL / TOO FAR** for a straight glide at best-glide speed.
5. Flare at about 40–80 ft, level the skids, and raise the collective in the last few feet to cushion.
6. Touchdown is evaluated. The aircraft slides to a stop (or tips over), and the debrief appears.

Coaching hints (on by default, toggle in the menu) suggest the next action in context. They never move the controls.

**Difficulty:** *Easy (arcade)*, the default, slows the rotor RPM decay, adds a landing assist below about 65 ft (limits the sink rate, bleeds off ground speed, levels the skids) and widens the touchdown limits 2.5×. *Realistic* has none of that.

## Training

**Training** in the menu has 11 short levels in three tiers, each teaching one skill:

- **Beginner** (engine running): basic flying (fly through gates), hover (pedal turns and a hover box without touching down), running takeoff (slide along the runway, then climb through a ring), running landing (touch down on the runway while still moving forward).
- **Intermediate**: the engine failure, glide speed, picking a field, the flare.
- **Expert**: flare and cushion together, landing into the wind, and a final checkride on Realistic.

Each level shows step-by-step instructions, ends as soon as its goal is met or failed, and awards 1–3 stars. Passing a level unlocks the next, in order across the tiers; stars are saved in the browser. Picking a level first shows a briefing (goal, steps, how to pass, and a diagram); **Start** or Enter begins it.

Levels and tiers are data in `src/game/levels.ts`: `TIERS` lists the menu sections, and each level names its `tier`. A tier's lessons are numbered in list order, so a new lesson is one entry in the list plus a briefing in `src/ui/briefings.ts`.

## Fly around

**Fly around** in the menu is free flight with the menu's altitude, airspeed and wind: the engine never fails and there is no score. Land anywhere gently and you rest on the skids; raise the collective to take off again. A crash ends the flight with **Restart** or **Exit to menu**.

## Architecture

```
src/
  sim/            Pure flight model (no Three.js, no DOM)
    aircraft.ts     Aircraft parameters and RPM bands
    state.ts        HelicopterState, ControlInputs, FlightEnvironment
    flightModel.ts  rotorAero(), stepFlight(), trim, engine failure
    vec.ts          Tiny vector/Euler helpers
  world/          Procedural world data (pure)
    world.ts        Heightfield, lake, landing areas, trees/rocks/buildings, queries
    rng.ts          Seeded PRNG and value noise (the world is identical every load)
  game/           Game rules (pure, testable headless)
    session.ts      FlightSession: one attempt, phases, collisions, touchdown, ground slide
    landing.ts      Ground contact, obstacle strikes, touchdown damage evaluation
    scoring.ts      FlightRecorder (metrics per fixed step) and computeScore()
    guidance.ts     Advisory bearing / reach info for the HUD
    hints.ts        Contextual coaching text
    flareModel.ts   Energy-based flare and cushion below ~100 ft AGL
    levels.ts       Training levels: start overrides, objectives (goal, instructions, stars), unlocking
    fixedStep.ts    Frame-time → fixed-step accumulator
    game.ts         State machine, main loop, wiring (the only module that touches everything)
  input/          InputManager (single source of ControlInputs), keyboard, touch
  render/         Three.js scene, cockpit and helicopter model, terrain/tree meshes
  hud/            HTML/CSS HUD overlay
  ui/             Menu, tutorial, pause and results screens
  audio/          Procedural WebAudio (rotor, horns, impacts)
public/           manifest.webmanifest, sw.js, icons
tests/            Vitest: flight-model cause/effect, full scripted attempts, training levels
```

**Timing:** the simulation runs at a fixed **120 Hz** (`SIM_DT`). `FixedStepper` converts each frame's elapsed time into whole steps, capped to avoid a spiral of death. Rendering just draws the latest state. A test checks that 30 fps and 144 fps produce identical results.

**Separation:** `sim/`, `world/` and the rule modules in `game/` import nothing from Three.js or the DOM. The flight model can be improved, swapped or tuned in isolation (see `tests/flightModel.test.ts`), and complete attempts can be simulated headless (`tests/session.test.ts`).

## Simulation model and assumptions

The model is a simplified, physically motivated autorotation model, tuned for arcade play. The aircraft is a generic ~1100 kg, two-blade, 10 m-diameter light helicopter.

- **Rotor thrust (blade element):** `T = k·Ω²·α`, with effective blade angle `α = θ(collective) − 1.5·λ`. The inflow ratio is `λ = (vᵢ + Vₙ)/ΩR`, where `Vₙ` is the air velocity along the rotor shaft. Air coming *up* through the disk (descent, flare) increases α and thrust. Blade stall caps α at about 0.2 rad.
- **Induced velocity (momentum theory):** `vᵢ = v_h²/√(V_inplane² + v_h²)`, lagged about 0.12 s (simple dynamic inflow). Edgewise flow reduces induced power, which gives the airspeed effect.
- **Rotor power balance:** `I·Ω·dΩ/dt = P_engine − [T·(vᵢ + Vₙ) + P_profile]`. In a descent `Vₙ < 0`, so the air does work on the rotor. That term is autorotation. Profile power grows with Ω³, with advance ratio (`1 + 4.65μ²`) and with blade angle of attack. The consequences follow from the equations, not from scripting:
  - Leaving the collective up after the failure decays NR within a couple of seconds, and the rotor eventually stalls.
  - Lowering the collective reduces rotor loading and lets the upflow keep NR up. Full-down overspeeds (~118 %) and small collective changes control NR.
  - The descent rate is U-shaped in airspeed: about 1300–1400 fpm near 50–60 kt, about 2100 fpm at very low speed, and steeper again at high speed.
  - A flare tilts the disk against the airflow, so thrust and NR rise and the sink is arrested. Holding it too long or too high balloons the aircraft, and you run out of energy.
  - Raising the collective near the ground converts rotor kinetic energy into a brief cushion. Do it too early or for too long and NR drains.
- **Low NR:** below about 78 % a progressive "low-RPM stall" factor reduces thrust and increases drag (this stands in for loss of centrifugal stiffening and retreating-blade stall). Below 40 % the flight ends.
- **Engine and governor:** the engine holds 100 % NR up to 190 kW. While it runs, two game simplifications keep powered flight sane: the collective stops where the rotor would need more than 97 % of that power (like flying to the torque limit, so pulling harder never droops the rotor), and the governor may absorb up to 60 kW to hold NR in a powered descent with the collective down. Neither applies after a failure. On failure, power spools down over 0.6 s and a decaying nose-left yaw rate is applied.
- **Fuselage:** body-axis flat-plate drag. Ground effect follows Cheeseman–Bennett (capped).
- **Attitude:** an arcade attitude-command layer with a first-order lag. Control authority scales with NR². Yaw comes from pedals plus tail-fin weathervaning into the relative wind.
- **Structural limits:** overspeed above 115 % and a sustained low-G push-over (mast-bumping risk) accumulate damage. A sustained low-G push of more than ~1.6 s is fatal.
- **Wind:** a steady air mass, so airspeed and ground speed differ and landing into wind matters.

Nothing is random at run time: the world is seeded, and identical inputs produce identical outcomes and scores. A test asserts this.

### Flare and cushion (last 100 ft)

Below about 100 ft AGL an energy-based model (`src/game/flareModel.ts`) takes over the vertical speed and rotor-RPM losses; horizontal motion, attitude and the flare's RPM gain still come from the flight model. It follows the textbook sequence:

- **Sink** settles toward the natural autorotation sink for the current airspeed (about 1300 fpm in a glide, more when slow), less in ground effect.
- **Flare:** decelerating trades forward kinetic energy for lift, so the sink comes down progressively and fades as the speed bleeds off. A firm flare at glide speed lifts the helicopter a few feet; held too firm or too early it balloons and then drops.
- **Cushion:** raising the collective spends rotor RPM to cancel sink, paying for the sink actually cancelled. It slows the descent to a ~100 fpm settle but never holds you up or climbs, and fades between 100 % and 80 % NR. Below 90 % NR a slowing rotor adds sink again, so pulling too early (or holding the collective up) settles you briefly, then drops you. Easy's auto-cushion also fades out as rotor RPM falls.
- Easy and Realistic differ only in the RPM cost of the cushion.

Recommended technique: flare at 50–60 ft (about 10° nose up, easing the nose down if you start to climb), level the skids at about 10 ft, raise the collective at about 5 ft and ease off once the sink stops.

### Touchdown, damage and outcomes

Touchdown is detected at four skid points and the tail stinger. Damage (0–100) is the sum of these causes:

- Vertical impact speed (free below ~200 fpm, airframe destroyed above ~1400 fpm).
- Ground speed above the surface's run-on tolerance: field 15 kt, strip 13 kt, open grass 8 kt, rocky 3 kt.
- Sideways or backwards motion.
- Tail strike (more than ~12° nose up), nose-low toe dig-in, bank, slope, boulders under a skid, and NR below 60 % (blade droop).
- In-flight overstress.

Obstacle contact by the main rotor, the tail rotor or the fuselage (trees, buildings) is a crash, as are dynamic rollover (high speed, bank, side-slip or slope), water, and damage of 60 or more.

Outcomes:

- **Excellent:** under 5 damage, on a landing area, soft and slow.
- **Safe:** under 20 damage.
- **Damaged:** 20–59 damage.
- **Crash.**

### Scoring (100 points)

| Category | Points | Measured from |
| --- | --- | --- |
| Initial reaction | 15 | Time from failure to collective down (full marks ≤ 1 s); −5 for a low-G push-over |
| Rotor RPM management | 20 | Share of the descent with NR in 90–110 %, penalties for time below 80 % and above 115 % |
| Airspeed & descent | 15 | Share of the glide at 50–75 kt and below 2000 fpm |
| Landing-area selection | 15 | Quality of the surface touched down on (meadow 15, strip ~11, rocky clearing 6, open terrain ≤ 4) |
| Approach & flare | 15 | Flare strength and height, level skids at contact, collective cushion, headwind at touchdown |
| Touchdown & damage | 20 | 20 × (1 − damage/60); 0 on a crash |

A crash caps the total at 45 and a damaged landing at 75, so surviving alone is not enough and good decisions still earn credit. The debrief lists what went well and the biggest point losses, with concrete advice.

## The world

The world is about 3 × 3 km of seeded rolling terrain with forest patches, a lake, and five landing options:

- **Big Meadow:** large, flat and mown. The best choice, about 0.8 km off the left side of the nose at the start.
- **Airport Runway:** a 750 m paved runway north of the lake, aligned north–south, with centreline, threshold and edge markings and a control tower on its west side. Long and smooth, but about 1.6 km from the start.
- **Lake Helipad:** a 24 m concrete deck on legs in the middle of the lake, 3 m above the water, with an H and touchdown circle. Small and surrounded by water, so it takes precision.
- **Farm Strip:** a narrow dirt strip lined with tall trees, aligned north–south (into the default north wind). Precision required.
- **Rocky Clearing:** the closest option, but rough and strewn with boulders.

Each area has corner markers and a windsock.

## Known limitations

- The flight model is deliberately simplified. It does not model blade flapping dynamics, vortex ring state, retreating-blade stall as a function of airspeed, translational lift, gusts or turbulence, or engine-out yaw beyond a transient kick. Lateral dynamics are an arcade bank command.
- The ground phase after touchdown is a kinematic slide with friction, not a rigid-body contact simulation. There are no bounces.
- Obstacles use cylinder approximations. Trees are cones for main-rotor checks.
- There is a single fixed scenario layout. Start altitude, airspeed and wind are configurable, but the start position and the failure time (4 s) are fixed.
- Audio is procedural and simple. On iOS it starts only after the first tap on **Start flight**.
- Orientation lock works only where the browser permits it (typically installed PWAs or fullscreen). Otherwise the portrait layout is used.
- The bundle is about 600 kB (157 kB gzipped), mostly Three.js. It is not code-split.
- Tests use a scripted test pilot (`tests/pilotBot.ts`) that exists only in the test suite. Nothing in the game flies the helicopter for you.

## Tuning

Aircraft constants live in `src/sim/aircraft.ts`. Scoring thresholds are in `src/game/scoring.ts`, and damage thresholds are in `src/game/landing.ts`. After changing them, run `npm test`. The flight-model tests assert the key cause-and-effect relationships (collective vs NR, airspeed vs descent rate, flare effect, frame-rate independence). The session tests fly complete scripted attempts and check that good technique beats bad.
