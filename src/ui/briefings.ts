import { KEY_WORDS, Mode } from '../game/hints';

type Keys = (typeof KEY_WORDS)[Mode];

export interface Briefing {
  /** One sentence: what this lesson asks of you. */
  goal: string;
  /** What to do, in order. HTML allowed (bold key names). */
  steps(k: Keys): string[];
  /** How the level is passed. */
  pass: string;
  /** Inline SVG sketch of the manoeuvre. */
  diagram: string;
}

// ---------- SVG helpers (viewBox 0 0 320 160, ground at y = 138) ----------

const GROUND = 138;
const ACC = 'var(--accent)';
const GREEN = 'var(--green)';
const RED = 'var(--red)';
const INK = 'var(--ink)';

const svg = (body: string) =>
  `<svg class="brief-svg" viewBox="0 0 320 160" role="img" aria-hidden="true" font-family="var(--font)" font-size="10" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const text = (x: number, y: number, s: string, color = INK, anchor = 'middle', weight = 700) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" style="fill:${color};stroke:none" font-weight="${weight}">${s}</text>`;

const ground = () =>
  `<line x1="0" y1="${GROUND}" x2="320" y2="${GROUND}" style="stroke:var(--green)" stroke-width="2" opacity="0.6"/>` +
  `<rect x="0" y="${GROUND + 1}" width="320" height="${160 - GROUND}" style="fill:var(--green)" opacity="0.12"/>`;

/** Side view, nose to the right. `pitch` in degrees, nose up positive. */
const heli = (x: number, y: number, pitch = 0, color = INK) =>
  `<g transform="translate(${x} ${y}) rotate(${-pitch})" style="stroke:${color}" stroke-width="1.6">
    <ellipse cx="0" cy="0" rx="13" ry="7" style="fill:#1f2433"/>
    <path d="M-11 -2 L-34 -4 M-34 -4 L-37 -10 M-34 -4 L-36 1"/>
    <path d="M0 -7 V-11 M-22 -11 H22"/>
    <path d="M-7 6 L-8 10 M7 6 L8 10 M-12 10 H13"/>
  </g>`;

/** Top-down view; `heading` in degrees, 0 = up the page, clockwise. */
const heliTop = (x: number, y: number, heading = 0, color = INK) =>
  `<g transform="translate(${x} ${y}) rotate(${heading})" style="stroke:${color}" stroke-width="1.6">
    <circle r="15" stroke-dasharray="3 3" opacity="0.6"/>
    <ellipse rx="4.5" ry="8" cy="-2" style="fill:#1f2433"/>
    <path d="M0 6 V20 M-4 20 H4"/>
  </g>`;

const arrow = (x1: number, y1: number, x2: number, y2: number, color = ACC, w = 2) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = (d: number) => `${x2 - 7 * Math.cos(a + d)} ${y2 - 7 * Math.sin(a + d)}`;
  return `<path d="M${x1} ${y1} L${x2} ${y2} M${h(0.45)} L${x2} ${y2} L${h(-0.45)}" style="stroke:${color}" stroke-width="${w}"/>`;
};

const ring = (x: number, y: number, n: number) =>
  `<ellipse cx="${x}" cy="${y}" rx="6" ry="17" style="stroke:${ACC}" stroke-width="3"/>` + text(x, y - 23, String(n), ACC);

/** Height marker on the left: a tick at `y` with a label. */
const height = (y: number, label: string) =>
  `<path d="M12 ${y} H22 M17 ${y} V${GROUND}" style="stroke:${INK}" opacity="0.5" stroke-dasharray="2 3"/>` + text(26, y + 3, label, INK, 'start', 600);

// ---------- Diagrams ----------

const BASICS = svg(
  `<path d="M40 40 C 80 40, 100 52, 110 58 S 170 75, 190 80 S 250 98, 290 100" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    heli(40, 40) +
    ring(110, 58, 1) +
    ring(190, 80, 2) +
    ring(270, 98, 3) +
    ground() +
    text(160, 152, 'Fly through the rings in order', INK, 'middle', 600),
);

const HOVER = svg(
  `<rect width="320" height="160" style="fill:${GREEN}" opacity="0.08"/>` +
    heliTop(80, 86, 0) +
    `<path d="M58 68 A 28 28 0 0 1 80 58" style="stroke:${ACC}" stroke-width="2"/>` +
    arrow(62, 64, 56, 72) +
    `<path d="M102 68 A 28 28 0 0 0 80 58" style="stroke:${ACC}" stroke-width="2"/>` +
    arrow(98, 64, 104, 72) +
    text(80, 34, 'PEDALS', ACC) +
    text(80, 134, '1 · 270°, then back to 360°', INK, 'middle', 600) +
    `<circle cx="236" cy="40" r="12" style="stroke:${ACC}" stroke-width="3"/>` +
    heliTop(236, 112, 0) +
    arrow(236, 94, 236, 58) +
    text(236, 152, '2 · ease forward through the ring', INK, 'middle', 600),
);

const TAKEOFF = svg(
  ground() +
    `<rect x="10" y="${GROUND - 3}" width="200" height="4" style="fill:${INK}" opacity="0.35"/>` +
    text(100, 156, 'RUNWAY', INK, 'middle', 600) +
    heli(36, GROUND - 10, -4) +
    arrow(56, GROUND - 6, 120, GROUND - 6) +
    text(88, GROUND - 16, 'slide', ACC) +
    `<path d="M120 ${GROUND - 8} Q 190 ${GROUND - 12} 270 52" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    heli(160, GROUND - 16, -6, ACC) +
    text(160, GROUND - 34, 'lift off', ACC) +
    ring(286, 46, 1) +
    text(286, 90, '40+ kt', GREEN),
);

const LANDING = svg(
  ground() +
    `<rect x="150" y="${GROUND - 3}" width="170" height="4" style="fill:${INK}" opacity="0.35"/>` +
    text(235, 156, 'RUNWAY', INK, 'middle', 600) +
    height(40, '80 ft') +
    heli(50, 40, -3) +
    `<path d="M66 46 L196 ${GROUND - 12}" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    text(110, 62, 'gentle descent', INK, 'start', 600) +
    heli(212, GROUND - 10, 2, GREEN) +
    arrow(232, GROUND - 6, 290, GROUND - 6, GREEN) +
    text(250, GROUND - 22, 'touch down moving', GREEN),
);

const RINGS = svg(
  `<rect width="320" height="160" style="fill:${GREEN}" opacity="0.08"/>` +
    `<path d="M160 140 L160 112 C 160 80, 120 70, 96 60 C 60 46, 60 20, 110 18 C 150 16, 200 24, 230 40 C 262 58, 270 90, 250 112" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    [[160, 112, 1], [96, 60, 2], [110, 18, 3], [230, 40, 4], [250, 112, 5]]
      .map(([x, y, n]) => `<circle cx="${x}" cy="${y}" r="7" style="stroke:${ACC}" stroke-width="3"/>` + text(x + 14, y + 4, String(n), ACC))
      .join('') +
    heliTop(160, 140, 0) +
    `<rect x="262" y="128" width="50" height="22" rx="5" style="stroke:${RED}" stroke-width="2"/>` +
    text(287, 143, '0:95', RED) +
    text(60, 152, 'Turn early, aim for the middle', INK, 'start', 600),
);

const pad = (x: number, y: number, r: number, h = false) =>
  `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.28}" style="stroke:${ACC};fill:${h ? '#3a3f4a' : 'none'}" stroke-width="2.5"/>` +
  (h ? text(x, y + 3, 'H', INK) : '');

const WINDFIELD = svg(
  `<rect width="320" height="160" style="fill:${GREEN}" opacity="0.08"/>` +
    `<circle cx="196" cy="88" r="34" style="stroke:${ACC}" stroke-width="3"/>` +
    arrow(30, 140, 70, 112, '#9ec3ff') +
    arrow(54, 152, 94, 124, '#9ec3ff') +
    text(46, 104, 'WIND', '#9ec3ff') +
    `<path d="M292 18 L292 46" style="stroke:${INK}" stroke-width="2"/>` +
    `<path d="M292 20 L276 30 L292 34 Z" style="fill:#f2692a;stroke:#f2692a"/>` +
    text(284, 60, 'windsock', INK, 'middle', 600) +
    `<path d="M300 150 L224 112" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    heliTop(204, 96, -118, GREEN) +
    text(196, 146, 'nose into the wind', GREEN),
);

const VTAKEOFF = svg(
  ground() +
    heli(46, GROUND - 10, 0) +
    arrow(46, GROUND - 26, 46, 98) +
    text(46, 84, '1 LIFT', ACC) +
    heli(96, 104, 0, ACC) +
    text(96, 82, '2 HOVER', ACC) +
    `<path d="M112 108 Q 200 104 270 52" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    heli(176, 96, -8) +
    text(176, 74, '3 GO', ACC) +
    ring(286, 46, 1),
);

const VLANDING = svg(
  ground() +
    pad(200, GROUND, 52) +
    heli(110, 40, 0) +
    arrow(132, 40, 186, 40) +
    text(156, 30, '1 OVER IT', ACC) +
    heli(200, 52, 0, ACC) +
    arrow(200, 66, 200, 118, GREEN) +
    text(244, 90, '2 STRAIGHT DOWN', GREEN, 'start') +
    text(200, 156, 'big circle · slow sink · no drift', INK, 'middle', 600),
);

const HELIPORT = svg(
  ground() +
    pad(230, GROUND, 18, true) +
    pad(110, GROUND, 52) +
    text(110, 156, 'last lesson', INK, 'middle', 500) +
    text(230, 156, 'heliport', ACC) +
    heli(230, 70, 0, ACC) +
    arrow(230, 84, 230, 122, GREEN) +
    text(250, 100, 'dead centre', GREEN, 'start'),
);

/** Top-down course: rings 1–9, a treetop stretch and a lake with the pad in the middle. */
const LAKE_RUN = svg(
  `<rect width="320" height="160" style="fill:${GREEN}" opacity="0.08"/>` +
    `<ellipse cx="236" cy="96" rx="62" ry="44" style="fill:#3d7fd0;stroke:none" opacity="0.35"/>` +
    [[150, 18], [168, 16], [186, 20], [204, 17], [222, 19], [240, 16]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" style="fill:${GREEN};stroke:none" opacity="0.5"/>`)
      .join('') +
    `<path d="M30 150 C 30 120, 70 120, 64 96 S 100 60, 120 50 S 150 18, 200 18 S 290 30, 284 74 S 280 120, 236 96" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    [[64, 96, 2], [120, 50, 4], [160, 18, 6], [284, 74, 8]]
      .map(([x, y, n]) => `<circle cx="${x}" cy="${y}" r="6" style="stroke:${ACC}" stroke-width="3"/>` + text(x - 14, y + 4, String(n), ACC))
      .join('') +
    `<rect x="228" y="88" width="16" height="16" style="fill:#3a3f4a;stroke:${ACC}" stroke-width="2"/>` +
    text(236, 100, 'H', INK) +
    heliTop(30, 140, 0) +
    `<rect x="250" y="126" width="62" height="24" rx="5" style="stroke:${RED}" stroke-width="2"/>` +
    text(281, 142, '⏱ 2:30', RED) +
    text(200, 36, 'treetops', GREEN, 'middle', 600) +
    text(236, 126, 'land here', ACC),
);

/** Side view: tree walls either side of the spot, a high hover, then straight down between them. */
const CONFINED = svg(
  ground() +
    [86, 104, 216, 234]
      .map((x) => `<path d="M${x} ${GROUND} V${GROUND - 14}" style="stroke:${INK}" stroke-width="2" opacity="0.6"/><ellipse cx="${x}" cy="${GROUND - 34}" rx="10" ry="24" style="fill:${GREEN};stroke:none" opacity="0.55"/>`)
      .join('') +
    pad(160, GROUND, 26) +
    `<path d="M20 30 Q 120 24 150 40" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    heli(24, 30, -3) +
    text(54, 16, '1 STEEP IN', ACC) +
    heli(160, 46, 0, ACC) +
    text(160, 24, '2 HOVER ABOVE', ACC) +
    arrow(160, 62, 160, 120, GREEN) +
    text(250, 60, '3 STRAIGHT', GREEN, 'start') +
    text(250, 72, 'DOWN', GREEN, 'start') +
    text(160, 156, 'trees both sides · no drift', INK, 'middle', 600),
);

/** Side view: off the runway, low over the forest, up the wooded hillside to the pad on the summit. */
const HILL_CLIMB = svg(
  ground() +
    `<path d="M150 ${GROUND} C 200 ${GROUND}, 220 52, 262 46 L 290 46 C 304 46, 312 90, 320 112 V${GROUND} Z" style="fill:${GREEN};stroke:none" opacity="0.22"/>` +
    `<rect x="6" y="${GROUND - 3}" width="70" height="4" style="fill:${INK}" opacity="0.35"/>` +
    [[96, GROUND], [114, GROUND], [132, GROUND], [180, 128], [198, 112], [216, 92], [234, 72], [298, 56]]
      .map(([x, y]) => `<ellipse cx="${x}" cy="${y - 12}" rx="7" ry="14" style="fill:${GREEN};stroke:none" opacity="0.55"/>`)
      .join('') +
    `<path d="M30 ${GROUND - 8} Q 60 112 84 104 S 130 98, 150 96 S 190 88, 206 72 S 240 40, 276 42" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    ring(84, 104, 1) +
    ring(150, 96, 3) +
    ring(207, 70, 5) +
    `<rect x="264" y="${42}" width="24" height="4" style="fill:#3a3f4a;stroke:${ACC}" stroke-width="2"/>` +
    text(276, 34, 'H', ACC) +
    heli(30, GROUND - 10, 0) +
    text(40, 156, 'runway', INK, 'middle', 600) +
    text(114, 156, 'forest', GREEN, 'middle', 600) +
    text(250, 156, 'Lookout Hill', INK, 'middle', 600),
);

const rpmBar = (() => {
  // 70–120 % mapped onto y 130..20
  const y = (p: number) => 130 - ((p - 70) / 50) * 110;
  return (
    `<rect x="34" y="20" width="22" height="110" rx="3" style="fill:${RED}" opacity="0.55"/>` +
    `<rect x="34" y="${y(110)}" width="22" height="${y(90) - y(110)}" style="fill:${GREEN}"/>` +
    `<path d="M28 ${y(100)} H62" style="stroke:#fff" stroke-width="3"/>` +
    text(45, 148, 'ROTOR RPM') +
    text(66, y(110) + 3, '110%', INK, 'start', 600) +
    text(66, y(90) + 3, '90%', INK, 'start', 600)
  );
})();

const FAILURE = svg(
  rpmBar +
    heli(170, 55) +
    `<path d="M150 40 l6 6 m0 -6 l-6 6 M188 38 l5 5 m0 -5 l-5 5" style="stroke:${RED}" stroke-width="2"/>` +
    text(170, 28, 'ENGINE OUT', RED) +
    // Collective lever, lowered
    `<path d="M240 128 L292 116" style="stroke:${INK}" stroke-width="5" opacity="0.35"/>` +
    `<path d="M240 128 L292 136" style="stroke:${INK}" stroke-width="5"/>` +
    `<circle cx="240" cy="128" r="4" style="fill:${INK}"/>` +
    arrow(300, 104, 300, 132) +
    text(265, 100, 'COLLECTIVE DOWN', ACC) +
    text(170, 90, 'within 3 seconds', INK, 'middle', 600),
);

const GLIDE = (() => {
  const x = (kt: number) => 40 + ((kt - 20) / 80) * 260;
  const y = (kt: number) => 35 + ((kt - 62) / 38) ** 2 * 90;
  let d = '';
  for (let kt = 22; kt <= 100; kt += 2) d += `${d ? 'L' : 'M'}${x(kt).toFixed(1)} ${y(kt).toFixed(1)} `;
  return svg(
    `<rect x="${x(55)}" y="18" width="${x(70) - x(55)}" height="112" style="fill:${GREEN}" opacity="0.18"/>` +
      `<path d="M40 18 V130 H300" style="stroke:${INK}" opacity="0.5"/>` +
      `<path d="${d}" style="stroke:${ACC}" stroke-width="2.5"/>` +
      `<circle cx="${x(62)}" cy="${y(62)}" r="4" style="fill:${GREEN}"/>` +
      text((x(55) + x(70)) / 2, 14, '55–70 kt', GREEN) +
      text(x(62), y(62) + 16, 'slowest sink', GREEN, 'middle', 600) +
      text(x(30), 60, 'too slow', RED, 'middle', 600) +
      text(x(92), 60, 'too fast', RED, 'middle', 600) +
      text(170, 148, 'AIRSPEED →', INK, 'middle', 600) +
      `<text x="26" y="80" text-anchor="middle" transform="rotate(-90 26 80)" style="fill:${INK};stroke:none" font-weight="600">SINK RATE ↓</text>`,
  );
})();

const FIELD = svg(
  `<rect width="320" height="160" style="fill:${GREEN}" opacity="0.08"/>` +
    `<path d="M60 120 m-110 0 a110 110 0 0 1 220 0" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.5"/>` +
    text(150, 22, 'glide range', INK, 'middle', 600) +
    `<rect x="236" y="20" width="70" height="40" rx="6" style="stroke:${RED};fill:${RED}" fill-opacity="0.15" stroke-width="2"/>` +
    text(271, 44, 'TOO FAR', RED) +
    `<rect x="120" y="58" width="74" height="42" rx="6" style="stroke:${GREEN};fill:${GREEN}" fill-opacity="0.2" stroke-width="2"/>` +
    text(157, 83, 'IN REACH', GREEN) +
    heliTop(60, 120, 60) +
    arrow(78, 110, 118, 86) +
    text(60, 152, 'Cycle fields until one says IN REACH', INK, 'start', 600),
);

const FLARE = svg(
  ground() +
    height(98, '50 ft') +
    `<path d="M70 26 L190 92" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    heli(70, 26, -8) +
    heli(200, 98, 18, ACC) +
    `<path d="M215 104 Q 245 128 262 128" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    heli(280, 128, 2) +
    text(200, 70, 'PULL BACK', ACC) +
    text(120, 36, '55–65 kt', INK, 'start', 600),
);

const CUSHION = svg(
  ground() +
    height(84, '55 ft') +
    height(118, '10 ft') +
    `<path d="M40 30 L110 76" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    heli(40, 30, -8) +
    heli(120, 84, 14, ACC) +
    text(120, 62, '1 FLARE', ACC) +
    heli(200, 118, 2, ACC) +
    text(200, 98, '2 LEVEL', ACC) +
    heli(280, 128, 0, GREEN) +
    arrow(304, 128, 304, 104, GREEN) +
    text(272, 104, '3 CUSHION', GREEN),
);

const WIND = svg(
  `<rect width="320" height="160" style="fill:${GREEN}" opacity="0.08"/>` +
    `<rect x="70" y="40" width="190" height="104" rx="8" style="stroke:${GREEN}" stroke-width="2" opacity="0.7"/>` +
    arrow(18, 8, 52, 46, '#9ec3ff') +
    arrow(40, 4, 74, 42, '#9ec3ff') +
    text(30, 60, 'WIND', '#9ec3ff') +
    heliTop(130, 96, -40, GREEN) +
    text(130, 136, '✓ into the wind', GREEN) +
    heliTop(220, 92, 90, RED) +
    text(220, 136, '✗ crosswind', RED),
);

const CHECKRIDE = svg(
  ground() +
    heli(34, 28) +
    `<path d="M62 24 l6 6 m0 -6 l-6 6" style="stroke:${RED}" stroke-width="2"/>` +
    text(66, 16, 'ENGINE OUT', RED) +
    `<path d="M50 32 L206 104" style="stroke:${INK}" stroke-dasharray="4 4" opacity="0.6"/>` +
    text(120, 52, 'collective down · 55–70 kt', INK, 'start', 600) +
    heli(216, 104, 16, ACC) +
    text(216, 84, 'flare', ACC) +
    heli(282, 128, 0, GREEN) +
    text(282, 108, 'cushion', GREEN) +
    text(160, 154, 'Realistic mode · no assist · 8 kt wind', INK, 'middle', 600),
);

// ---------- Briefings by level id ----------

export const BRIEFINGS: Record<string, Briefing> = {
  basics: {
    goal: 'Get a feel for the controls: fly through three yellow rings, with the engine running the whole time.',
    steps: (k) => [
      `The <b>cyclic</b> tilts the helicopter: <b>${k.turn}</b> banks to turn, <b>${k.fwd}</b> / <b>${k.aft}</b> lowers or raises the nose to speed up or slow down.`,
      `The <b>collective</b> sets the climb: lower it (<b>${k.down}</b>) to descend, raise it (<b>${k.up}</b>) to climb.`,
      'Each ring is lower than the last. Line up early and fly straight through.',
    ],
    pass: 'Fly through all three rings without getting too low. Faster runs earn more stars.',
    diagram: BASICS,
  },
  hover: {
    goal: 'A first hover a few feet off the runway. The helicopter holds the height for you: just turn with the pedals, then ease forward through a ring.',
    steps: (k) => [
      `The <b>pedals</b> turn the nose: <b>${k.yawLeft}</b> for left, <b>${k.yawRight}</b> for right. Let go just before the heading you want.`,
      `Turn left to <b>270°</b>, then right back to <b>360°</b>. The lesson text shows your heading as you turn.`,
      `Then ease the <b>cyclic</b> forward (<b>${k.fwd}</b>) a little and fly slowly through the yellow ring ahead.`,
    ],
    pass: 'Both turns, then through the ring without touching down. A quick, gentle run earns three stars.',
    diagram: HOVER,
  },
  takeoff: {
    goal: 'Sitting on the runway, engine running. Take off like an aeroplane: slide forward to build speed, then climb.',
    steps: (k) => [
      `Raise the collective slowly (<b>${k.up}</b>) until the helicopter feels light on its skids.`,
      `Ease the nose forward (<b>${k.fwd}</b>) to slide along the runway. Stay low and straight while the speed builds: it lifts off by itself.`,
      `Past 30 kt, raise the collective more (<b>${k.up}</b>) and climb through the ring beyond the runway end.`,
    ],
    pass: 'Fly through the ring at 35 kt or more. Staying low until you have speed, keeping to the centreline and 45+ kt at the ring earn three stars.',
    diagram: TAKEOFF,
  },
  landing: {
    goal: 'On approach to the runway at 80 ft and 45 kt. Fly it down and touch down while still moving forward.',
    steps: (k) => [
      `Lower the collective a little (<b>${k.down}</b>) for a gentle descent toward the runway ahead.`,
      `On the way down, raise the nose a touch (<b>${k.aft}</b>) to slow to about <b>20–30 kt</b>.`,
      `Just above the runway, add a little collective (<b>${k.up}</b>) to soften the touchdown. Then lower it (<b>${k.down}</b>) and slide to a stop.`,
    ],
    pass: 'Touch down on the runway slower than 400 fpm and 40 kt. Under 150 fpm, at 10–30 kt and on the centreline earns three stars.',
    diagram: LANDING,
  },
  rings: {
    goal: 'A harder Basic flying: seven smaller rings around a circuit, at different heights, against the clock.',
    steps: (k) => [
      `Each ring needs a turn of about 40°. Start the turn early (<b>${k.turn}</b>) and roll out lined up with the ring.`,
      `The rings go up and down: raise or lower the collective (<b>${k.up}</b> / <b>${k.down}</b>) before you get there, not at the ring.`,
      `If you are turning too wide, slow down a little (<b>${k.aft}</b>): a slower helicopter turns tighter. Missed one? Circle back to it.`,
    ],
    pass: 'Fly through all seven rings within 95 seconds. Time to spare and passing close to the centres earn the stars.',
    diagram: RINGS,
  },
  windfield: {
    goal: 'A 12 kt wind is blowing over the meadow. Work out where it comes from and land in the yellow circle facing into it.',
    steps: (k) => [
      'Check the <b>windsock</b> beside the meadow and the <b>WIND</b> readout. The sock streams away from the wind.',
      `Fly a wide circuit and line up so the nose points into the wind (<b>${k.turn}</b>), with the circle ahead of you.`,
      `Come down gently and slow right down: into the wind you barely move over the ground. Touch down in the circle and lower the collective (<b>${k.down}</b>).`,
    ],
    pass: 'Touch down inside the circle, gently (under 400 fpm), with the nose within 30° of the wind. Within 10° and very soft earns three stars.',
    diagram: WINDFIELD,
  },
  vtakeoff: {
    goal: 'On the ground in the open field. Take off straight up, hover, then fly away through the ring.',
    steps: (k) => [
      `Raise the collective slowly (<b>${k.up}</b>) and lift straight up to about 10 ft. No forward input yet.`,
      'Hold a steady hover over the spot for 3 seconds: stop any drift with tiny cyclic inputs.',
      `Then ease the nose forward (<b>${k.fwd}</b>) to pick up speed, add collective (<b>${k.up}</b>) and climb through the ring.`,
    ],
    pass: 'A steady hover within 8 m of the spot, then through the ring. Hovering with almost no drift, quickly, earns three stars.',
    diagram: VTAKEOFF,
  },
  vlanding: {
    goal: 'Hovering at 40 ft beside a landing circle. Get over it and come straight down.',
    steps: (k) => [
      'Move over the middle of the circle with small cyclic inputs, then stop. The instructions tell you how far it is.',
      `Lower the collective a little (<b>${k.down}</b>) for a slow, steady descent. Keep the helicopter still over the spot.`,
      `In the last few feet, a touch of collective (<b>${k.up}</b>) slows the sink for a soft touchdown.`,
    ],
    pass: 'Touch down inside the circle, slower than 300 fpm and drifting less than 5 kt. Near the centre and very soft earns three stars.',
    diagram: VLANDING,
  },
  heliport: {
    goal: 'The final Intermediate lesson: the same vertical landing, onto a heliport pad barely wider than the helicopter.',
    steps: (k) => [
      'The pad is 50 m ahead. Hover-taxi to it slowly and stop exactly over the H.',
      `Come straight down (<b>${k.down}</b>), correcting any drift early with small cyclic inputs. Drift is magnified this close to the ground.`,
      `Cushion the last few feet (<b>${k.up}</b>) and keep still until the skids are down.`,
    ],
    pass: 'Touch down on the pad, slower than 300 fpm, drifting less than 4 kt. Within 1.5 m of the centre and very soft earns three stars.',
    diagram: HELIPORT,
  },
  lakerun: {
    goal: 'A timed run down the valley: nine rings with tight bends, a low pass over the treetops and the water, then a landing on the helipad in the middle of the lake.',
    steps: (k) => [
      `Keep a flowing line at about 55–65 kt. Start each bend early (<b>${k.turn}</b>) and roll out lined up with the next ring.`,
      `Rings 6 and 7 skim the treetops, 8 and 9 the lake. Ease down (<b>${k.down}</b>) and hold the height: no climbing, no dipping.`,
      `After the last ring, slow down (<b>${k.aft}</b>) in good time, stop over the H and lower the collective gently (<b>${k.down}</b>). Out on the water, drift is easy to miss.`,
    ],
    pass: 'Land on the helipad before the 2:30 countdown runs out. One star for landing in time, one for flying through all nine rings, one for touching down within 1:35 of the start. A missed ring costs only its star, so keep going.',
    diagram: LAKE_RUN,
  },
  confined: {
    goal: 'Land on the farm strip between two walls of tall trees: a confined area with no room for drift.',
    steps: (k) => [
      'Fly over the strip high enough to clear the trees and look at it: where the trees are, where the yellow circle is.',
      `Come in steeply and slowly (<b>${k.aft}</b>), and stop in a hover above the treetops, right over the circle.`,
      `Come straight down (<b>${k.down}</b>) between the trees, correcting any drift early. Cushion the last few feet (<b>${k.up}</b>).`,
    ],
    pass: 'Touch down inside the circle, slower than 300 fpm, drifting less than 5 kt, without touching a tree. Within 2 m of the centre and very soft earns three stars.',
    diagram: CONFINED,
  },
  hillclimb: {
    goal: 'Take off from the airport and follow seven rings low over the forest and up the wooded side of Lookout Hill, then land on the small pad on its summit.',
    steps: (k) => [
      `Lift off (<b>${k.up}</b>) and build speed along the runway (<b>${k.fwd}</b>) through ring 1, then bank right (<b>${k.turn}</b>) toward the hill.`,
      `Rings 2 to 6 sit just above the treetops and the slope. Fly at about 40–50 kt and climb with the ground (<b>${k.up}</b>): the trees are close, so don't dip.`,
      `Rings 6 and 7 bend left round the hill. After 7, slow down (<b>${k.aft}</b>), turn left to the summit, stop over the H and come down gently (<b>${k.down}</b>).`,
    ],
    pass: 'Land on the summit pad before the 3:00 countdown runs out. One star for landing in time, one for flying through all seven rings, one for touching down within 1:25 of the start. A missed ring costs only its star.',
    diagram: HILL_CLIMB,
  },
  failure: {
    goal: 'The engine will quit a few seconds in. Save the rotor before it slows down.',
    steps: (k) => [
      'Cruise straight and level. Watch for the <b>ENGINE FAILURE</b> warning.',
      `The moment it fails, <b>lower the collective</b> (<b>${k.down}</b>) all the way. You have about 3 seconds.`,
      `Keep the rotor RPM needle in the <span class="g">green</span>: collective down makes it rise, up (<b>${k.up}</b>) makes it drop.`,
    ],
    pass: 'React within 3 seconds, then keep the rotor in the green for 15 seconds.',
    diagram: FAILURE,
  },
  glide: {
    goal: 'You are already gliding with no engine. Find the speed that keeps you in the air the longest.',
    steps: (k) => [
      'Watch the airspeed. Too slow or too fast and the sink rate goes up.',
      `Hold <b>55–70 kt</b>: nose down (<b>${k.fwd}</b>) to speed up, nose up (<b>${k.aft}</b>) to slow down.`,
      `Keep the rotor RPM in the green with the collective (<b>${k.down}</b> / <b>${k.up}</b>).`,
    ],
    pass: 'Spend 20 seconds in the 55–70 kt band before you run out of height.',
    diagram: GLIDE,
  },
  field: {
    goal: 'Low and gliding. The field ahead is too far: choose one you can reach and land in it.',
    steps: (k) => [
      `Look at the target at the top of the screen. If it says <b>TOO FAR</b>, press <b>${k.target}</b> to pick another field.`,
      `When one says <b>IN REACH</b>, turn toward the beacon (<b>${k.turn}</b>) and hold 55–70 kt.`,
      `At about 50 ft, pull back (<b>${k.aft}</b>) to flare, then level the skids. The assist cushions the touchdown.`,
    ],
    pass: 'Come to a stop inside the field you selected.',
    diagram: FIELD,
  },
  flare: {
    goal: 'Lined up on the meadow. Learn the flare: the pull-back that turns speed into a soft landing.',
    steps: (k) => [
      'Hold <b>55–65 kt</b> straight toward the meadow.',
      `At about <b>50 ft</b>, pull the cyclic back (<b>${k.aft}</b>). The nose rises, you slow down and the sink stops.`,
      `Then level the skids (<b>${k.fwd}</b>). The assist cushions the last few feet.`,
    ],
    pass: 'Flare before touchdown. Flaring at 35–70 ft and touching down slowly earns three stars.',
    diagram: FLARE,
  },
  cushion: {
    goal: 'The whole landing by hand, with no automatic cushion: flare, level, then cushion with the collective.',
    steps: (k) => [
      `<b>Flare</b> at 50–60 ft: pull back (<b>${k.aft}</b>) to take off the speed and the sink.`,
      `<b>Level</b> the skids at about 10 ft (<b>${k.fwd}</b>), nose just above the horizon.`,
      `<b>Cushion</b> at about 5 ft: raise the collective (<b>${k.up}</b>) to stop the last of the sink. Not earlier, or you run out of rotor.`,
    ],
    pass: 'Touch down level (less than 10° nose up) and slower than 500 fpm.',
    diagram: CUSHION,
  },
  wind: {
    goal: 'A 15 kt wind is blowing. Land in the meadow facing into it.',
    steps: (k) => [
      'Check the <b>WIND</b> readout and the windsocks: the wind comes from 330°.',
      'Lose height beside the field rather than overshooting it.',
      `Before you flare, turn (<b>${k.turn}</b>) to point the nose toward the wind. It cuts your ground speed at touchdown.`,
    ],
    pass: 'Land in a field with the nose within 30° of the wind.',
    diagram: WIND,
  },
  checkride: {
    goal: 'Your final exam: a full autorotation from engine failure to touchdown, in realistic mode.',
    steps: () => [
      'No landing assist and no coaching. Everything is up to you.',
      'Lower the collective at the failure, hold 55–70 kt and glide to the meadow.',
      'Flare at about 50 ft, level the skids and cushion. An 8 kt wind is blowing.',
    ],
    pass: 'Land without damage. Your score sets the stars: 70+ for two, 85+ for three.',
    diagram: CHECKRIDE,
  },
};
