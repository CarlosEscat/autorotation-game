# Autorotation: menu redesign spec

Handoff for implementing the new menu screens in the game repo. The visual reference is the "Autorotation Menu Flow" canvas (five boards: Main, Main with settings open, Free flight, Training, Scene backdrop). Where this spec and the mockup disagree, ask before guessing.

## 1. Flow

```
Main ─┬─ Training ── tier list (linear path) ── lesson
      ├─ Free flight ── setup ── fly
      ├─ How to fly (overlay, not designed yet)
      ├─ Sound key (top right, toggles mute)
      └─ Settings key (top right, opens popover: Sound, Coaching hints)
```

- Main menu has exactly two primary actions (Training, Free flight) plus "How to fly".
- Free flight is **fly-around only**: no engine failure, no scenario choice.
- Emergency practice lives in the Training "Emergency" tier.
- Every sub-screen has a back key (top left of its panel) that returns to Main.

## 2. Design tokens

### Colors
| Token | Value | Use |
|---|---|---|
| panel-top / panel-bottom | `#34383b` → `#2b2e31` | floating panel gradient |
| panel-border | `#17191b` | 2px panel border |
| well | `#141618` (tier columns `#1f2224`) | recessed areas |
| key-face top → bottom | `#4b5055` → `#383c40` | normal key |
| key-face-active top → bottom | `#5b6268` → `#454b50` | hero / selected key |
| key-edge | `#0c0d0e` | key border and bottom lip |
| legend | `#eef2f5` | main text |
| legend-secondary | `#c4ccd2` / `#d3dade` | descriptions |
| legend-muted | `#aeb7be` | engraved labels, counts |
| locked text | `#9aa4ab` on `#17191b` | locked lessons |
| green (active) | `#35e27a` | lit lamp, passed lessons, ON, hero key border |
| cyan (selection) | `#3fd0e8` | selected key, "Next up", focus ring |
| red (warning) | `#d6392e` stripe, `#ff6b5e` text | hazard stripe, Emergency tier name only |

Rules: green means active or passed. Cyan means selected or next. Red is only for warnings. Do not add other accent colors. All muted text must stay at or above 4.5:1 against its background.

### Typography
- Font: **B612** (Google Fonts, weights 400 and 700 only). Fallback `'DIN Alternate', ui-sans-serif, system-ui, sans-serif`.
- Title (main): 64px / 700 / uppercase / letter-spacing 0.02em / `text-shadow: 0 2px 0 rgba(0,0,0,.55)`. Two lines: "AUTO", "ROTATION".
- Screen titles (Free flight, Training): 40px / 700 / uppercase / letter-spacing 0.04em.
- Key legends: 22px / 700 / uppercase / letter-spacing 0.14em (main keys); 16px / 700 / 0.06em (segment keys); altitude values 32px / 700.
- Section labels ("Start altitude", "Airspeed", "Wind", "Difficulty", "Settings"): 12-13px / 700 / uppercase / letter-spacing 0.2em / `#aeb7be` / `text-shadow: 0 1px 0 rgba(0,0,0,.6)` (engraved look).
- Body and descriptions: 13-17px / 400.

### Shape and depth
- Panels: radius 10px, 2px border, outer shadow `0 24px 60px rgba(0,0,0,.5)`, top highlight `inset 0 1px 0 rgba(255,255,255,.1)`.
- Keys and wells: radius 5-6px (wells 8px). Square-ish, not pill-shaped.
- Four decorative **corner screws** per panel: 10px circle, `radial-gradient(circle at 35% 35%, #8d949a, #3b4044)` with a 1px dark slot line at 45° or 135°. Inset 12px from each corner. Decorative only (`aria-hidden`).
- **Hazard stripe** under the main title: 132 x 8px, `repeating-linear-gradient(135deg, #d6392e 0 7px, #17191b 7px 14px)`.

## 3. Components

### Key (the base button)
Chunky keycap with a lamp on top.
```
background: linear-gradient(180deg, #4b5055, #383c40);
border: 1px solid #0c0d0e; border-radius: 6px;
box-shadow: inset 0 1px 0 rgba(255,255,255,.2),
            inset 0 -3px 0 rgba(0,0,0,.3),
            0 3px 0 #0c0d0e, 0 5px 8px rgba(0,0,0,.45);
legend text-shadow: 0 1px 0 rgba(0,0,0,.6);
```
- **Pressed (`:active`)**: `translateY(2px)`, shadow becomes `inset 0 2px 5px rgba(0,0,0,.55), 0 1px 0 #0c0d0e`.
- **Lamp**: absolutely positioned bar at the top-left of the key (wide keys: 28 x 5px at left 14, top 8; segment keys: 22 x 4px centered, top 6; 48px utility keys: 14 x 5px). Unlit: `#141618` with inset shadow. Lit: the state color plus `box-shadow: 0 0 8px <color>`.
- **Selected state**: face switches to key-face-active, border becomes cyan (1px), lamp lit cyan, glow `0 0 14px rgba(63,208,232,.25)`.
- **Hero state** (main menu only): same as selected but border and lamp are **green**.
- Focus-visible: 3px cyan outline, 3px offset.
- Min height 44px for any tappable key.

### Segmented well
Row of keys inside a recessed container: `background #141618; border 1px solid #0a0b0c; padding 6px; gap 6px; radius 8px; box-shadow inset 0 2px 6px rgba(0,0,0,.7)`. Keys are 54px high, equal width. One selected at a time (`aria-pressed`).

### Switch (Sound, Coaching hints)
Physical slide switch with an ON/OFF legend to its left.
- Hit area 64 x 44px. Slot 64 x 32px, `#101213`, inset shadow.
- Lever 26 x 26px, ridged (`repeating-linear-gradient(90deg, #6a7076 0 3px, #4d5358 3px 6px)`), slides from left 2px (off) to left 34px (on).
- Legend "ON" is green `#35e27a`, "OFF" is `#aeb7be`. Use `role="switch"` and `aria-checked`.

### Stars
Passed lessons show three stars. Filled `#eef2f5`, empty `#2b2f32`. Wrap in `role="img"` with `aria-label="N stars"`.

## 4. Screens

### 4.1 Main menu
- Left-aligned panel, 520px wide, vertically centered, 72px from the left edge. Scene with the helicopter is visible on the right.
- Contents, top to bottom: title, hazard stripe, tagline ("Your engine is about to quit. Get it down in one piece."), **Training** key, **Free flight** key, **How to fly** key (small, no lamp), disclaimer line ("An educational arcade prototype. Not a flight-training device, and not a source of approved emergency procedures.").
- Main keys are 104px high. Legend plus one-line description:
  - Training: "Guided lessons in four tiers, from first hover to checkride."
  - Free flight: "Choose altitude, speed and wind. Land it your way."
- **Hero rule** (my proposal, confirm): the hero key gets the green border and lit green lamp. New player (no lesson passed yet) makes Training the hero; returning player makes Free flight the hero. The other key stays plain with an unlit lamp.
- Top right: two 48px keys, **Sound** (lamp green when sound is on, speaker icon with a cross when muted) and **Settings** (lamp cyan while the popover is open).
- Removed on purpose: the "Best score / attempts" line. Do not show it on this screen.

### 4.2 Settings popover
- Anchored under the Settings key, top right, 360px wide, panel styling.
- Two rows only: **Sound** ("Engine, rotor and wind") and **Coaching hints** ("On-screen cues while you fly"), each a switch. Both default to ON.
- No units setting. No Full / Minimal / Off hint levels.
- The Sound key and the Sound switch control the same value.

### 4.3 Free flight
- Centered panel, 800px wide. Title "Free flight", back key to Main.
- Fields, in order: **Start altitude** (three tall keys: 700 ft "Low and close to the ground", 1000 ft "Balanced", 1500 ft "Room to explore"); **Airspeed** (60 / 75 / 90 kt); **Wind** (Calm / 10 kt / 15 kt, plus a small compass showing the direction, arrow dimmed when Calm); **Difficulty** (Arcade / Realistic).
- Footer: a one-line summary (e.g. "1500 ft · 90 kt · 15 kt from NNW · Arcade") and the **Start flight** key (green border, lit green lamp, play icon).
- Defaults: 1500 ft, 90 kt, 15 kt from NNW, Arcade (matches the current game). Remember the last-used values between sessions.
- Altitude here is the **start height only**. There is no engine failure in this mode.
- Coaching hints are not shown here; they come from the global setting.

### 4.4 Training
- Wide centered panel (1184px). Title "Training" with the subtitle "Four tiers, from first hover to checkride. Earn up to three stars per lesson." Back key to Main. There is no "Continue" button.
- Four columns, in this order, each a recessed well with: tier name, passed/total count, one-line description, a row of progress segments (one per lesson), then the lesson keys.

| Tier | Description | Lessons |
|---|---|---|
| Beginner | Airfield basics: fly, hover, take off and land. | Basic flying, Hover, Running takeoff, Running landing |
| Intermediate | Open fields and shrinking landing zones, engine running. | Precision flying, Landing into the wind, Vertical takeoff, Vertical landing, Heliport |
| Expert | Valley runs and tight spots. Fun first, still scored. | Lake run, Confined area |
| Emergency | The full autorotation sequence, ending in the checkride. | Engine failure!, Glide speed, Pick a field, The flare, Flare and cushion, Wind, Checkride |

- Emergency's name is the only one in warning red. Pinnacle landing is **not** in the list (future idea only).

**Linear lock (important).** The whole path is one sequence across all tiers, in the order above.
- Every lesson before the first unpassed one is **passed**: green LED strip, stars shown, still replayable.
- The first unpassed lesson is **Next up**: cyan border, cyan LED strip, "Next up" tag. There is exactly one in the whole screen.
- Everything after it is **locked**, including whole later tiers: flat recessed key, dark LED, padlock icon, and a line under the title "Pass <previous lesson> to unlock". Locked keys are not clickable.
- A lesson counts as passed with at least 1 star. A tier's segment row mirrors the same three states (green, cyan, dark).
- If a player passes everything, there is no Next up and nothing is locked.

## 5. State and data

```ts
type Lesson = { id: string; title: string; stars: 0 | 1 | 2 | 3 }; // 0 = not passed
type Tier   = { id: string; name: string; description: string; lessons: Lesson[] };
// path = tiers.flatMap(t => t.lessons)
// nextIndex = path.findIndex(l => l.stars === 0)   // -1 means all passed
// state(i) = nextIndex === -1 || i < nextIndex ? 'passed' : i === nextIndex ? 'next' : 'locked'
```

Persist: sound on/off, coaching hints on/off, last Free flight settings, lesson stars (best result per lesson).

## 6. Accessibility
- Real `<button>` and `<a>` elements. Selected keys use `aria-pressed`; switches use `role="switch"` with `aria-checked`; the settings key uses `aria-expanded`.
- Icon-only keys need `aria-label` ("Turn sound off", "Settings", "Back to main menu").
- Color is never the only signal: locked has a padlock and a text line, selected has a lit lamp and a lighter face, Next up has a text tag.
- Visible focus ring on every key.

## 7. Not designed yet / needs a decision
- The **How to fly** overlay.
- A **pause menu** with a coaching-hints switch (so players can toggle it mid-flight).
- The pilot **rank and medals** display (no place for it on Main now; it could live in the Training header).
- Whether Free flight needs its own unlock rule (the mockup has none).
- The 60 / 75 kt speeds and the altitude captions are placeholder copy.
- The sample stars and progress in the Training mockup are sample data, not real.
