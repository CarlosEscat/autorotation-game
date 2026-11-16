# Night Flight in Free Flight: Design

Date: 2026-11-16. Status: approved by Carlos.

This is the first of three pieces agreed with Carlos on 2026-11-16. The next two get their own designs: a night lesson in the Expert tier, and a new feature that replaces the dropped "random fire callouts".

## Intent

Free flight offers one look today: a warm late afternoon. Carlos wants the option of flying at night, with the world and the helicopters lit the way they would be: the runway, the lake helipad, the houses and the aircraft all carry lights. It gives players who have flown everything a new way to see the same map, and it is the groundwork for the Expert night lesson.

## Goals

- A **day or night choice** on the Free flight screen, remembered like the other choices.
- A **moonlit night**: dark sky with stars and a moon, and the ground, lake and hill still readable as dark shapes.
- **Lights on both helicopters**, including a landing light that really lights the ground.
- **A lit runway, a lit lake helipad, and lit houses.**
- Night flying time is **recorded in the logbook**, so it can count toward a Night rating later.

## Non-goals (this piece)

- The Expert night lesson and a Night rating stamp. Next design.
- "Properly dark" night with a black ground. Kept for the Expert lesson.
- Night in Training lessons, or in the scene behind the menus. Both stay day.
- Dawn, dusk, a moving sun or moon, weather.
- Lights on cars, boats or streets. There are none in the world.

## Anti-goals

- Night must not be harder to fly than day in any way except what you can see. No change to the flight model, the landing rules or scoring.
- Day must look exactly as it does now. Any pixel difference in a day flight is a defect.
- Night must not undo the performance work in `7e42058`: no more than 4 extra draw calls for all world lights, and exactly one extra real light in the scene.
- The lights must never be the only way to find the helipad or runway: at the moonlit level both remain visible as shapes.

## Constraints

- The Free flight screen follows `MENU_SPEC.md`: the new field is a `.well.seg` of `.seg-key` keys like the others, existing tokens only.
- Existing saves (`autorotation.v1`) keep working: a save with no time of day loads as day; a logbook with no night total loads with 0.
- The colours of the lights in the world follow aviation practice, not the menu palette.
- Rules stay in pure, tested modules. Where lights are placed is decided by a pure function of the world, not inside mesh code.
- Work on a feature branch (`night-flight`), not `main`.

## Approaches considered

- **A. Glow only.** Dim the sun to moonlight; every light is an unlit bright dot. Cheapest, but the landing light would light nothing, so the last 100 ft feel no different.
- **B. Glow, plus one real landing light (chosen).** All world lights and the helicopter's position lights are unlit glowing dots, drawn in a few calls. Only the landing light is a real spotlight. The helicopter's sun shadow map is switched off at night to pay for it. Chosen by Claude, with Carlos steering by outcome: it gives the one effect that changes how landing feels, at close to the cost of A.
- **C. Real lights everywhere.** Each runway light and window lights its surroundings. Dozens of real lights would undo the recent performance work, and from the air it cannot be told apart from B.

## Design

### The choice

- `Settings` gains `time: 'day' | 'night'`, default `'day'`. `normalizeSettings` maps anything else to `'day'`.
- `FlightConfig` gains `night?: boolean`. `configFromSettings` sets it. Lessons do not set it, so they stay day.
- The Free flight screen gets a field labelled **Time of day** with two keys, **Day** and **Night**, in the same grid as Airspeed, Wind and Difficulty. The summary line at the foot mentions night when chosen (for example "... at night").
- On starting a flight, `game.ts` calls `renderer.setNight(cfg.night ?? false)` next to the existing `setWind`. Returning to the menu sets day again.

### The night look (decided by Carlos: moonlit)

`setNight(true)` swaps, and `setNight(false)` restores exactly:

- **Sky**: a night sky mesh, deep blue to near-black, with stars and a moon. Built once on first use and kept.
- **Light**: the sun becomes a dim, cool moon from a fixed direction; the sky fill drops to match. Fog and background take the night horizon colour.
- **Clouds**: dark, with a faint moonlit edge. Their material glows by itself today, so it must be changed for night, not only left to the dimmer light.
- **Shadows**: the shadow map is off at night. The soft blob shadow under the helicopter stays, fainter.
- **Unlit surfaces**: materials that ignore lighting (pad paint, target beacon, gate rings) are dimmed at night so paint does not glow like a lamp. Fire keeps full brightness and so glows strongly.

**Acceptance for brightness** (Claude's call, to be tuned by eye): from 1000 ft the lake shore, the runway outline and Lookout Hill can each be told apart from their surroundings; trees are visible as dark shapes within about 300 m; the instruments and HUD read as easily as by day.

### World lights

One pure function, `nightLights(world)`, returns a list of lights: position, colour, and kind. It is tested. The renderer draws the whole list as glowing dots that stay visible at a distance, in at most 4 draw calls, shown only at night.

- **Runway** (`runway` area): white edge lights down both sides at even spacing (about 50 m); a row across each end.
- **Runway ends**: each end row shows **green when the camera is beyond that end looking in, red otherwise**, as real runway lights do. This is a per-frame colour choice for two rows, not a new mechanism.
- **Lake helipad** (`helipad` area): a ring of green lights round the deck edge, and yellow lights at the corners of the deck legs at water level so the height of the deck can be judged.
- **Houses** (`building` obstacles): warm lit windows on the walls. Which houses and windows are lit is picked with the seeded generator, so it is the same every night; about two thirds of houses show light.
- **Hazards**: the control tower keeps its red light, now flashing slowly; a red light is added on top of Lookout Hill.
- **Fields** (meadow, strip, clearing) stay unlit. They are found by moonlight. Claude's call: it matches reality and keeps the paved places special.

### Helicopter lights

On both the light and the heavy model, shown only at night:

- Red on the left side, green on the right, white on the tail: steady.
- A red beacon on top that flashes about once a second.
- A **landing light** under the nose: the one real spotlight, pointing forward and down, no shadows. It lights ground, trees, water and pad within roughly 120 m, and has a small bright lens on the model.
- The cockpit dashboard glows faintly so it reads in cockpit view.

Flashing follows simulation time, so a paused game shows a frozen beacon.

### Logbook

- `Logbook` gains `nightSeconds: number`: seconds airborne with `night` set, counted the same way as `airSeconds` (simulation time, airborne only). It is a total across both helicopters and sits beside, not inside, `airSeconds`.
- `FlightSample` gains `night: boolean`, read from the session's config.
- `normalizePilot` loads a missing or bad `nightSeconds` as 0.
- The licence screen's logbook shows a **Night** line with the time, using `formatFlightTime`.
- Claude's call to include this now: it costs little, and without it hours flown at night before the rating exists would be lost.

## Left to the builder

- Exact colours and strengths of the moon, sky fill, fog and stars, within the brightness acceptance above.
- How the glowing dots are drawn (points, sprites or small quads) and how they keep a minimum size at a distance.
- Exact spacing and counts of lights, and window sizes.
- Whether the night sky is a second mesh or the same mesh recoloured.

## Testing

- Unit tests: `normalizeSettings` and `configFromSettings` for `time`; `nightLights(world)` (runway edges symmetric and evenly spaced, both end rows present, helipad ring on the deck at deck height, same result on every call); logbook night seconds (counted only when airborne and at night, not double counted on restart); `normalizePilot` with a missing or bad `nightSeconds`.
- In the browser, with screenshots: a night Free flight in each helicopter, in chase and cockpit view; approach to the runway from both ends (green then red); landing on the lake helipad by its lights; then a day flight compared with a screenshot from before the change.
- Draw calls and frame time at night compared with day, read from the renderer's own counters.

## Review focus

1. **Day unchanged**: after a night flight, back to the menu, then a day flight: sky, clouds, shadows and paint are exactly as before. (`setNight(false)` must restore everything it touched.)
2. **Old save**: a save with no `time` and no `nightSeconds` loads, starts by day, and keeps its stars, rank and logbook.
3. **Both helicopters**: lights sit on the right points of each model and the landing light points where the nose points, in both camera views.
4. **Cost**: one real light added, shadow map off at night, at most 4 extra draw calls.
5. **Lessons and menu stay day** even when the saved choice is night.
