import { KEY_BINDINGS } from '../input/keyboard';
import { Difficulty, FlightConfig } from '../game/session';
import { LEVELS, LessonState, LevelDef, ObjectiveStatus, TIERS, lessonStates, tierOf } from '../game/levels';
import { KEY_WORDS, Mode } from '../game/hints';
import { BRIEFINGS } from './briefings';

export interface Settings {
  difficulty: Difficulty;
  altitudeFt: number;
  airspeedKt: number;
  wind: 'calm' | 'light' | 'strong';
  hints: boolean;
}

export const ALTITUDES = [
  { ft: 700, caption: 'Low and close to the ground' },
  { ft: 1000, caption: 'Balanced' },
  { ft: 1500, caption: 'Room to explore' },
];
export const AIRSPEEDS = [60, 75, 90];
export const WIND_PRESETS: Record<Settings['wind'], { kt: number; from: number; label: string }> = {
  calm: { kt: 0, from: 330, label: 'Calm' },
  light: { kt: 10, from: 330, label: '10 kt' },
  strong: { kt: 15, from: 330, label: '15 kt' },
};
const DIFFICULTIES: Record<Difficulty, string> = { easy: 'Arcade', normal: 'Realistic' };

export const DEFAULT_SETTINGS: Settings = { difficulty: 'easy', altitudeFt: 1500, airspeedKt: 90, wind: 'strong', hints: true };

const nearest = (opts: number[], v: number) => opts.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/** Settings from a save, snapped onto the choices the Free flight screen offers. */
export function normalizeSettings(s: Partial<Settings> = {}): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    difficulty: s.difficulty === 'normal' ? 'normal' : 'easy',
    altitudeFt: nearest(ALTITUDES.map((a) => a.ft), Number(s.altitudeFt) || d.altitudeFt),
    airspeedKt: nearest(AIRSPEEDS, Number(s.airspeedKt) || d.airspeedKt),
    wind: s.wind && s.wind in WIND_PRESETS ? s.wind : d.wind,
    hints: s.hints ?? d.hints,
  };
}

/** Free flight: the engine never fails. */
export function configFromSettings(s: Settings): FlightConfig {
  const w = WIND_PRESETS[s.wind];
  return { altitudeFt: s.altitudeFt, airspeedKt: s.airspeedKt, windKt: w.kt, windFromDeg: w.from, failureDelay: 1e9, difficulty: s.difficulty };
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const windText = (w: { kt: number; from: number }) => (w.kt === 0 ? 'Calm' : `${w.kt} kt from ${POINTS[Math.round(w.from / 22.5) % 16]}`);

/** "1500 ft · 90 kt · 15 kt from NNW · Arcade" */
export const flightSummary = (s: Settings) => `${s.altitudeFt} ft · ${s.airspeedKt} kt · ${windText(WIND_PRESETS[s.wind])} · ${DIFFICULTIES[s.difficulty]}`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const stars = (n: number) =>
  `<span class="stars" role="img" aria-label="${n} star${n === 1 ? '' : 's'}">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  back: svg('<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  sound: svg(
    '<path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/>' +
      '<path class="i-on" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path class="i-off" d="M15.5 9l6 6M21.5 9l-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  ),
  gear: svg(
    [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="10.4" y="1.6" width="3.2" height="5" rx="1" fill="currentColor" transform="rotate(${a} 12 12)"/>`).join('') +
      '<circle cx="12" cy="12" r="5.6" fill="none" stroke="currentColor" stroke-width="3.4"/>',
  ),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
};

/** Four decorative screws, one per panel corner. */
const SCREWS = ['tl', 'tr', 'bl', 'br'].map((c) => `<span class="screw ${c}" aria-hidden="true"></span>`).join('');

const backKey = (a = 'back', label = 'Back to main menu') => `<button class="key util back" data-a="${a}" aria-label="${label}">${ICON.back}</button>`;

const toggle = (name: string, label: string) =>
  `<button class="switch" role="switch" aria-checked="true" aria-label="${label}" data-a="switch" data-sw="${name}"><span class="sw-legend">ON</span><span class="sw-slot"><span class="sw-lever"></span></span></button>`;

function screen(parent: HTMLElement, cls: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `screen ${cls}`;
  parent.appendChild(el);
  return el;
}

export interface MenuHandlers {
  onFreeFlight(settings: Settings): void;
  onTraining(): void;
  onMute(): void;
  onHints(on: boolean): void;
  onBriefing(index: number): void;
  onStartLevel(index: number): void;
  onNextLevel(): void;
}

type ScreenName = 'menu' | 'free' | 'tutorial' | 'pause' | 'results' | 'training' | 'briefing';

export class Screens {
  private menu: HTMLElement;
  private free: HTMLElement;
  private tutorial: HTMLElement;
  private pause: HTMLElement;
  private results: HTMLElement;
  private training: HTMLElement;
  private briefing: HTMLElement;
  private all: HTMLElement[];

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private handlers: MenuHandlers & { onResume(): void; onRestart(): void; onMenu(): void },
  ) {
    this.menu = screen(parent, 'menu');
    this.free = screen(parent, 'free');
    this.tutorial = screen(parent, 'tutorial');
    this.pause = screen(parent, 'pause');
    this.results = screen(parent, 'results');
    this.training = screen(parent, 'training');
    this.briefing = screen(parent, 'briefing');
    this.all = [this.menu, this.free, this.tutorial, this.pause, this.results, this.training, this.briefing];
    this.buildMenu();
    this.buildFreeFlight();
    this.buildTutorial();
    this.pause.innerHTML = `<div class="panel small">${SCREWS}<h2>PAUSED</h2>
      <button class="btn primary" data-a="resume">Resume</button>
      <button class="btn" data-a="restart">Restart flight</button>
      <button class="btn" data-a="mute">Sound: on</button>
      <button class="btn" data-a="menu">Main menu</button></div>`;
    for (const el of this.all) this.bindButtons(el);
    this.setHints(settings.hints);
    // Escape or a click elsewhere closes the settings popover.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.popoverOpen()) {
        this.setPopover(false);
        this.menu.querySelector<HTMLElement>('[data-a="settings"]')!.focus();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (this.popoverOpen() && !t.closest('.settings-pop, [data-a="settings"]')) this.setPopover(false);
    });
  }

  private bindButtons(root: HTMLElement) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      const a = el?.dataset.a;
      if (!a || (el as HTMLButtonElement).disabled) return;
      if (a === 'free') this.show('free');
      else if (a === 'go') this.handlers.onFreeFlight({ ...this.settings });
      else if (a === 'pick') this.pick(el!.dataset.f!, el!.dataset.v!);
      else if (a === 'howto') this.show('tutorial');
      else if (a === 'back') this.show('menu');
      else if (a === 'settings') this.setPopover(!this.popoverOpen());
      else if (a === 'switch') {
        if (el!.dataset.sw === 'sound') this.handlers.onMute();
        else this.handlers.onHints(!this.settings.hints);
      } else if (a === 'resume') this.handlers.onResume();
      else if (a === 'restart') this.handlers.onRestart();
      else if (a === 'menu') this.handlers.onMenu();
      else if (a === 'training') this.handlers.onTraining();
      else if (a === 'mute') this.handlers.onMute();
      else if (a === 'brief') this.handlers.onBriefing(Number(el!.dataset.i));
      else if (a === 'level') this.handlers.onStartLevel(Number(el!.dataset.i));
      else if (a === 'next') this.handlers.onNextLevel();
    });
  }

  private buildMenu() {
    this.menu.innerHTML = `<div class="corner-keys">
        <button class="key util" data-a="mute" aria-label="Turn sound off"><span class="lamp"></span>${ICON.sound}</button>
        <button class="key util" data-a="settings" aria-label="Settings" aria-expanded="false" aria-controls="settings-pop"><span class="lamp"></span>${ICON.gear}</button>
      </div>
      <div class="panel settings-pop" id="settings-pop" role="dialog" aria-label="Settings" hidden>${SCREWS}
        <div class="engraved">Settings</div>
        <div class="set-row"><div><div class="set-name">Sound</div><div class="set-desc">Engine, rotor and wind</div></div>${toggle('sound', 'Sound')}</div>
        <div class="set-row"><div><div class="set-name">Coaching hints</div><div class="set-desc">On-screen cues while you fly</div></div>${toggle('hints', 'Coaching hints')}</div>
      </div>
      <div class="panel main-panel">${SCREWS}
        <h1 class="title">Auto<br/>rotation</h1>
        <div class="hazard" aria-hidden="true"></div>
        <p class="tagline">Your engine is about to quit. Get it down in one piece.</p>
        <button class="key main" data-a="training"><span class="lamp"></span><span class="legend">Training</span><span class="desc">Guided lessons in four tiers, from first hover to checkride.</span></button>
        <button class="key main" data-a="free"><span class="lamp"></span><span class="legend">Free flight</span><span class="desc">Choose altitude, speed and wind. Land it your way.</span></button>
        <button class="key small" data-a="howto"><span class="legend">How to fly</span></button>
        <p class="disclaimer">An educational arcade prototype. Not a flight-training device, and not a source of approved emergency procedures.</p>
      </div>`;
  }

  private buildFreeFlight() {
    const seg = (f: string, v: string | number, body: string, cls = '') =>
      `<button class="key seg-key ${cls}" data-a="pick" data-f="${f}" data-v="${v}" aria-pressed="false"><span class="lamp"></span>${body}</button>`;
    const field = (id: string, label: string, keys: string, extra = '') =>
      `<div class="field field-${id}"><div class="engraved" id="ff-${id}">${label}</div>
        <div class="field-row"><div class="well seg" role="group" aria-labelledby="ff-${id}">${keys}</div>${extra}</div></div>`;
    const compass = `<svg class="compass" viewBox="0 0 56 56" role="img" aria-label="Wind direction">
        <circle cx="28" cy="28" r="25" class="c-ring"/>
        ${[0, 90, 180, 270].map((a) => `<line x1="28" y1="4" x2="28" y2="9" class="c-tick" transform="rotate(${a} 28 28)"/>`).join('')}
        <text x="28" y="18" class="c-n">N</text>
        <g class="c-arrow"><path d="M28 12 L28 42 M22 36 L28 43 L34 36"/></g>
      </svg>`;
    this.free.innerHTML = `<div class="panel ff-panel">${SCREWS}
      <header class="sub-head">${backKey()}<h2 class="screen-title">Free flight</h2></header>
      ${field('alt', 'Start altitude', ALTITUDES.map((a) => seg('alt', a.ft, `<span class="alt-val">${a.ft}<small> ft</small></span><span class="desc">${esc(a.caption)}</span>`, 'tall')).join(''))}
      <div class="ff-grid">
        ${field('ias', 'Airspeed', AIRSPEEDS.map((v) => seg('ias', v, `<span class="legend">${v} kt</span>`)).join(''))}
        ${field('wind', 'Wind', Object.entries(WIND_PRESETS).map(([k, w]) => seg('wind', k, `<span class="legend">${w.label}</span>`)).join(''), compass)}
        ${field('diff', 'Difficulty', Object.entries(DIFFICULTIES).map(([k, l]) => seg('diff', k, `<span class="legend">${l}</span>`)).join(''))}
      </div>
      <footer class="ff-foot"><div class="ff-summary" aria-live="polite"></div>
        <button class="key go" data-a="go"><span class="lamp"></span>${ICON.play}<span class="legend">Start flight</span></button></footer>
    </div>`;
    this.syncFreeFlight();
  }

  private pick(f: string, v: string) {
    const s = this.settings;
    if (f === 'alt') s.altitudeFt = Number(v);
    else if (f === 'ias') s.airspeedKt = Number(v);
    else if (f === 'wind') s.wind = v as Settings['wind'];
    else if (f === 'diff') s.difficulty = v as Difficulty;
    this.syncFreeFlight();
  }

  /** Light the keys that match the current settings, and update the summary and compass. */
  private syncFreeFlight() {
    const s = this.settings;
    const cur: Record<string, string> = { alt: String(s.altitudeFt), ias: String(s.airspeedKt), wind: s.wind, diff: s.difficulty };
    for (const k of this.free.querySelectorAll<HTMLElement>('[data-a="pick"]')) k.setAttribute('aria-pressed', String(cur[k.dataset.f!] === k.dataset.v));
    const w = WIND_PRESETS[s.wind];
    const compass = this.free.querySelector<SVGElement>('.compass')!;
    compass.classList.toggle('calm', w.kt === 0);
    compass.setAttribute('aria-label', `Wind ${windText(w)}`);
    // The arrow points the way the wind blows, away from where it comes from.
    compass.querySelector('.c-arrow')!.setAttribute('transform', `rotate(${w.from + 180} 28 28)`);
    this.free.querySelector('.ff-summary')!.textContent = flightSummary(s);
  }

  private buildTutorial() {
    const keys = KEY_BINDINGS.map((k) => `<tr><td class="key-name">${esc(k.keys)}</td><td>${esc(k.action)}</td></tr>`).join('');
    this.tutorial.innerHTML = `<div class="panel wide">${SCREWS}
      <header class="sub-head">${backKey()}<h2 class="screen-title">How to fly</h2></header>
      <ol class="steps">
        <li><b>Engine fails:</b> lower the collective <em>immediately</em>. Rotor RPM (NR) decays within seconds.</li>
        <li><b>Glide:</b> hold about <b>55–70 kt</b> with the cyclic. Keep NR in the <span class="g">green</span>: collective down raises NR, up lowers it.</li>
        <li><b>Choose a field:</b> press T / TGT to cycle areas. The beacon and the arrow show the way; "IN REACH" tells you whether a glide can make it.</li>
        <li><b>Flare</b> at about <b>50 ft</b>: pull the cyclic back to slow down and stop the sink. NR rises.</li>
        <li><b>Level and cushion:</b> level the skids just above the ground, then raise the collective to cushion the touchdown. Land into the wind.</li>
      </ol>
      <div class="cols">
        <table class="keys"><caption>Keyboard</caption>${keys}</table>
        <div class="touch-help"><b>Touch</b><p>Left thumb: COLL lever (slide up/down).<br/>Right thumb: CYCLIC stick.<br/>◀ ▶ pedals, TGT target, CAM camera, II pause.<br/>Drag the view to look around.</p></div>
      </div>
    </div>`;
  }

  private popoverOpen() {
    return !this.menu.querySelector<HTMLElement>('.settings-pop')!.hidden;
  }

  private setPopover(open: boolean) {
    this.menu.querySelector<HTMLElement>('.settings-pop')!.hidden = !open;
    const k = this.menu.querySelector<HTMLElement>('[data-a="settings"]')!;
    k.setAttribute('aria-expanded', String(open));
    k.classList.toggle('lit-cyan', open);
  }

  /** The Sound key, the Sound switch and the pause menu all show the same value. */
  setMuted(m: boolean) {
    const key = this.menu.querySelector<HTMLElement>('.corner-keys [data-a="mute"]')!;
    key.classList.toggle('lit-green', !m);
    key.classList.toggle('muted', m);
    key.setAttribute('aria-label', m ? 'Turn sound on' : 'Turn sound off');
    this.setSwitch('sound', !m);
    for (const b of this.pause.querySelectorAll<HTMLElement>('[data-a="mute"]')) b.textContent = m ? 'Sound: off' : 'Sound: on';
  }

  setHints(on: boolean) {
    this.settings.hints = on;
    this.setSwitch('hints', on);
  }

  private setSwitch(name: string, on: boolean) {
    const sw = this.menu.querySelector<HTMLElement>(`[data-sw="${name}"]`)!;
    sw.setAttribute('aria-checked', String(on));
    sw.querySelector('.sw-legend')!.textContent = on ? 'ON' : 'OFF';
  }

  /** Green border and lit lamp on the key a player most likely wants. */
  setHero(which: 'training' | 'free') {
    for (const k of this.menu.querySelectorAll<HTMLElement>('.key.main')) k.classList.toggle('hero', k.dataset.a === which);
  }

  /** The training path as four tier columns; see `lessonStates` for passed / next / locked. */
  showTraining(progress: Record<string, number>, granted: readonly string[] = []) {
    const states = lessonStates(progress, granted);
    const lesson = (l: LevelDef) => {
      const i = LEVELS.indexOf(l);
      const st = states[i];
      const extra: Record<LessonState, string> = {
        passed: stars(progress[l.id] ?? 0),
        next: '<span class="tag">Next up</span>',
        open: '',
        locked: `<span class="ls-lock">Pass ${esc(LEVELS[i - 1]?.title ?? '')} to unlock</span>`,
      };
      return `<button class="key lesson-key ${st}" data-a="brief" data-i="${i}"${st === 'locked' ? ' disabled' : ''}>
        <span class="led" aria-hidden="true"></span>
        <span class="ls-body"><span class="ls-title">${esc(l.title)}</span>${extra[st]}</span>
        ${st === 'locked' ? `<span class="ls-icon">${ICON.lock}</span>` : ''}</button>`;
    };
    const cols = TIERS.map((t) => {
      const levels = LEVELS.filter((l) => l.tier === t.id);
      const passed = levels.filter((l) => states[LEVELS.indexOf(l)] === 'passed').length;
      const segs = levels.map((l) => `<span class="seg-led ${states[LEVELS.indexOf(l)]}"></span>`).join('');
      return `<section class="tier-col" aria-labelledby="tier-${t.id}">
        <div class="tier-top"><h3 class="tier-name${t.id === 'emergency' ? ' emergency' : ''}" id="tier-${t.id}">${esc(t.title)}</h3>
          <span class="tier-count" aria-label="${passed} of ${levels.length} passed">${passed} / ${levels.length}</span></div>
        <p class="tier-desc">${esc(t.blurb)}</p>
        <div class="tier-segs" aria-hidden="true">${segs}</div>
        <div class="lessons">${levels.map(lesson).join('')}</div>
      </section>`;
    }).join('');
    this.training.innerHTML = `<div class="panel tr-panel">${SCREWS}
      <header class="sub-head">${backKey()}<div><h2 class="screen-title">Training</h2>
        <p class="subtitle">Four tiers, from first hover to checkride. Earn up to three stars per lesson.</p></div></header>
      <div class="tiers">${cols}</div>
    </div>`;
    this.show('training');
  }

  /** What the lesson is about, before it starts. */
  showBriefing(index: number, mode: Mode) {
    const def = LEVELS[index];
    const b = BRIEFINGS[def.id];
    const steps = b.steps(KEY_WORDS[mode]).map((t) => `<li>${t}</li>`).join('');
    this.briefing.innerHTML = `<div class="panel wide brief-panel">${SCREWS}
      <div class="lvl-num">${esc(tierOf(def).title)} · Lesson ${def.num} of ${LEVELS.filter((l) => l.tier === def.tier).length}</div>
      <h2>${esc(def.title)}</h2>
      <p class="brief-goal">${esc(b.goal)}</p>
      <div class="brief-body">
        <div class="brief-diagram">${b.diagram}</div>
        <div><h3>What to do</h3><ol class="steps">${steps}</ol></div>
      </div>
      <p class="brief-pass"><b>To pass:</b> ${esc(b.pass)}</p>
      <div class="buttons"><button class="btn primary" data-a="level" data-i="${index}">Start <small>(Enter)</small></button><button class="btn" data-a="training">Back</button></div>
    </div>`;
    this.show('briefing');
  }

  showLevelResult(def: LevelDef, status: ObjectiveStatus, hasNext: boolean) {
    const passed = status.state === 'passed';
    const title = !passed ? 'TRY AGAIN' : hasNext ? 'LEVEL PASSED' : 'TRAINING COMPLETE';
    const first = passed && hasNext
      ? '<button class="btn primary" data-a="next">Next level <small>(Enter)</small></button><button class="btn" data-a="restart">Retry</button>'
      : `<button class="btn primary" data-a="restart">Retry <small>(Enter)</small></button>`;
    this.results.innerHTML = `<div class="panel results-panel">${SCREWS}
      <div class="lvl-num">${esc(def.label)} · ${esc(def.title)}</div>
      <div class="outcome ${passed ? 'excellent' : 'crash'}">${title}</div>
      ${passed ? stars(status.stars) : ''}
      <div class="reason">${esc(passed ? status.text : (status.reason ?? status.text))}</div>
      <p class="lesson-recap">${passed && !hasNext ? 'You have flown every lesson. Try a free flight from the menu next.' : `Lesson: ${esc(def.teaches)}`}</p>
      <div class="buttons">${first}<button class="btn" data-a="training">Training</button></div>
    </div>`;
    this.show('results');
  }

  show(which: ScreenName | null) {
    this.setPopover(false);
    for (const el of this.all) el.classList.remove('visible');
    if (which) this[which].classList.add('visible');
  }

  /** Fly around ended in a crash: no score, just try again or leave. */
  showFreeFlightCrash(reason: string | null) {
    this.results.innerHTML = `<div class="panel small results-panel">${SCREWS}
      <div class="outcome crash">CRASH</div>
      ${reason ? `<div class="reason">${esc(reason)}</div>` : ''}
      <div class="buttons"><button class="btn primary" data-a="restart">Restart <small>(Enter)</small></button><button class="btn" data-a="menu">Exit to menu</button></div>
    </div>`;
    this.show('results');
  }
}
