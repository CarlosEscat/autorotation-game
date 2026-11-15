# Pilot licence, logbook and ranks: design

Date: 2026-11-15. Status: awaiting approval.

This is piece 1 of four. The others (random fire callouts, daily mission, unlocks) get their own designs later and build on this one.

## Intent

Give the player a reason to keep flying after the lessons are done. Today the game has 23 lessons worth up to 3 stars each (69 in total) and nothing that ties them together: no player identity, no record of what you have flown, nothing that grows. The player should feel they are a pilot with a career, see exactly what to do next to move up, and have every flight count for something.

## Goals

- A **licence card** that is the player's profile: name, callsign, rank, ratings, logbook totals.
- A **logbook** that records every flight, in Training and in Free flight.
- **Ratings**: stamps for what the pilot is qualified to do.
- **Ranks**: a ladder climbed by meeting a short checklist of requirements read from the logbook.
- A clear **promotion moment** when a rating or rank is earned.

## Non-goals (this piece)

- Daily missions, random fire callouts, and unlockable items (paint, weather, night). The card leaves room for them.
- Accounts, cloud save, leaderboards. Progress stays in the browser.
- A drawn avatar or character editor.
- An experience-points currency.

## Anti-goals

- Nothing that a player can fly today becomes locked. Ratings and ranks are stamps only in this piece.
- A rank, once reached, is never taken away, even if requirements are retuned later.
- No prompt stands between a new player and their first flight. Name and callsign are optional.
- Rank must not be reachable by repeating one trivial action (see the logbook rules).

## Constraints

- Follow `MENU_SPEC.md`: its panel, key and colour rules. Green means passed or met, cyan means next, no new accent colours, B612 only.
- Existing saves (`autorotation.v1` in localStorage) must keep working. Stars already earned count at once.
- Game rules stay in pure, tested modules, as `levels.ts` and `scoring.ts` are today. Flight time is counted in simulation time so the same flight always logs the same numbers.

## Approaches considered

- **A. Stars only.** Rank is total stars. Simplest, but stars are finite, so later daily missions and callouts could never move the rank, and the logbook would be decoration.
- **B. Experience points.** Every flight pays points and ranks are thresholds. Everything counts, but it is an invented number on top of stars and can be climbed by repeating the easiest flight.
- **C. Licence requirements (chosen).** Each rank has a checklist drawn from the logbook: stars, ratings, hours, landings. No invented currency, the card always shows what to do next, and skill and time in the air are both needed. Chosen by Carlos because it makes the logbook matter and fits the licence theme. Its cost: the ladder ends at Captain; the logbook, and later the streak and unlocks, carry on past it.

Decided with Carlos: licence card rather than an avatar; rank and ratings are separate; requirements drive rank.

## Design

### Ratings

Derived from stars every time, never stored, so existing players get them at once.

| Rating | Earned by |
|---|---|
| Emergency | passing `checkride` |
| Heavy | passing `conversion` |
| Firefighter | passing `firstfire` and `forestfire` |

### Ranks

| Rank | Requirements |
|---|---|
| Student Pilot | none (starting rank) |
| Private Pilot | all Beginner lessons passed · 10 stars · 15 minutes flown |
| Commercial Pilot | Emergency rating · 35 stars · 1.5 hours · 40 landings |
| Captain | all three ratings · 60 stars · 5 hours · 150 landings |

The numbers are a first guess (builder's call below) and live in one table so they can be tuned. Ranks are earned in order. The highest rank reached is stored, so retuning never demotes anyone.

### Logbook

Totals kept for the pilot:

- flight time, in total and per helicopter (light, heavy)
- flights, landings, crashes
- fires put out

Rules that keep it honest:

- Only time in the air counts. Sitting on the ground in Free flight adds nothing.
- Passed, failed and restarted lessons all log their time, landings and crashes like any other flight.
- A landing counts when a touchdown is not a crash (a damaged but survived touchdown counts) and the helicopter was airborne for at least 10 seconds before it. This stops bouncing on the pad to farm landings.
- A flight counts once it has been airborne for 10 seconds. Flights that are abandoned from the pause menu still log their time.
- A fire counts when it is fully out.
- The menu's background scene never logs anything.

### Licence card

A compact strip on the main menu, in the panel style of the spec:

```
┌──────────────────────────────────────────┐
│ C. ESCAT · "CONDOR"        PRIVATE PILOT │
│ ▓▓▓▓▓▓░░░░ 2 of 4 for Commercial      ›  │
└──────────────────────────────────────────┘
```

Selecting it opens the full licence screen:

```
┌──────────────────────────────────────────┐
│ ‹  PILOT LICENCE                ★ 41 / 69│
│ C. ESCAT  ·  callsign "CONDOR"    [Edit] │
│ Rank: PRIVATE PILOT                      │
│ Ratings: [EMERGENCY ✓] [HEAVY ✓] [FIRE –]│
│                                          │
│ NEXT: COMMERCIAL PILOT                   │
│  ✓ Emergency rating                      │
│  ✓ 35 stars                    (41)      │
│  ▓▓▓▓▓░░░  1.5 flight hours    (0.9)     │
│  ▓▓░░░░░░  40 landings         (12)      │
│                                          │
│ LOGBOOK                                  │
│  Hours 0.9 (light 0.7 · heavy 0.2)       │
│  Flights 31 · Landings 12 · Crashes 9    │
│  Fires out 2                             │
└──────────────────────────────────────────┘
```

- Name (up to 20 characters) and callsign (up to 12) are edited on this screen. Until set, the card shows "Pilot" and no callsign.
- An unearned rating shows what earns it.
- At Captain, the "Next" block is replaced by a line saying the top rank is held.
- The main menu still has its two primary actions; the card is a third, quieter element.

### Promotion moment

After a flight, if a rating or a rank was newly earned, a short panel appears over the result screen naming it ("Rating earned: Emergency", "Promoted to Commercial Pilot") with one key to continue, which returns to the result screen and its usual keys. If both a rating and a rank are earned at once, one panel lists both. A rank earned in Free flight (through hours or landings) is shown the next time the player is on the menu, not mid-flight.

### Saving

A `pilot` block is added to the existing save: name, callsign, logbook totals, highest rank reached, and the rank and ratings last shown to the player (so a promotion is announced once). A save without it gets defaults; stars already earned immediately count toward ratings and requirements, hours start at zero.

### Structure

- `src/game/licence.ts`: ratings, the rank table, and functions from (stars, logbook) to ratings, requirement progress and rank. Pure.
- `src/game/logbook.ts`: the totals and a recorder fed from the flight session each step. Pure.
- `src/ui/screens.ts` and `src/style.css`: menu strip, licence screen, promotion panel.
- `src/game/game.ts`: load and save the pilot block, feed the recorder, trigger promotions.
- Tests for both pure modules, including: ratings from stars, each rank boundary, no demotion, the 10-second rules, and loading an old save.

## Builder's calls (not yet confirmed by Carlos)

- The rank names and every number in the rank table.
- Firefighter needs both fire missions, not just the first.
- Crashes are shown in the logbook.
- Per-helicopter hours are tracked.
- The 10-second thresholds.
- No first-launch name prompt; the card is edited from the licence screen.
- Hours are shown as decimal hours, minutes below one hour.

## Left to the builder

Exact layout and wording within the spec's rules, how the promotion panel animates (if at all), and how the save block is shaped.
