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
