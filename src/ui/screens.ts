import { KEY_BINDINGS } from '../input/keyboard';
import { Difficulty, FlightConfig, FlightResult } from '../game/session';
import { Outcome } from '../game/landing';
import { LEVELS, LevelDef, ObjectiveStatus, isUnlocked } from '../game/levels';
import { KEY_WORDS, Mode } from '../game/hints';
import { BRIEFINGS } from './briefings';

export interface Settings {
  difficulty: Difficulty;
  altitudeFt: number;
  airspeedKt: number;
  wind: 'calm' | 'light' | 'strong';
  hints: boolean;
}

export const WIND_PRESETS: Record<Settings['wind'], { kt: number; from: number; label: string }> = {
  calm: { kt: 0, from: 0, label: 'Calm' },
  light: { kt: 8, from: 0, label: '8 kt from N' },
  strong: { kt: 15, from: 330, label: '15 kt from NNW' },
};

export function configFromSettings(s: Settings): FlightConfig {
  const w = WIND_PRESETS[s.wind];
  return { altitudeFt: s.altitudeFt, airspeedKt: s.airspeedKt, windKt: w.kt, windFromDeg: w.from, failureDelay: 4, difficulty: s.difficulty };
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  excellent: 'EXCELLENT LANDING',
  safe: 'SAFE LANDING',
  damaged: 'DAMAGED LANDING',
  crash: 'CRASH',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const stars = (n: number) => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;

function screen(parent: HTMLElement, cls: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `screen ${cls}`;
  parent.appendChild(el);
  return el;
}

export interface MenuHandlers {
  onStart(settings: Settings): void;
  onTutorial(settings: Settings): void;
  onInstall(): void;
  onTraining(): void;
  onBriefing(index: number): void;
  onStartLevel(index: number): void;
  onNextLevel(): void;
}

export class Screens {
  private menu: HTMLElement;
  private tutorial: HTMLElement;
  private pause: HTMLElement;
  private results: HTMLElement;
  private training: HTMLElement;
  private briefing: HTMLElement;
  private all: HTMLElement[];
  installAvailable = false;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private handlers: MenuHandlers & { onResume(): void; onRestart(): void; onMenu(): void; onTutorialStart(): void },
  ) {
    this.menu = screen(parent, 'menu');
    this.tutorial = screen(parent, 'tutorial');
    this.pause = screen(parent, 'pause');
    this.results = screen(parent, 'results');
    this.training = screen(parent, 'training');
    this.briefing = screen(parent, 'briefing');
    this.all = [this.menu, this.tutorial, this.pause, this.results, this.training, this.briefing];
    this.buildMenu();
    this.buildTutorial();
    this.pause.innerHTML = `<div class="panel small"><h2>PAUSED</h2>
      <button class="btn primary" data-a="resume">Resume</button>
      <button class="btn" data-a="restart">Restart flight</button>
      <button class="btn" data-a="menu">Main menu</button></div>`;
    this.bindButtons(this.pause);
    this.bindButtons(this.results);
    this.bindButtons(this.training);
    this.bindButtons(this.briefing);
  }

  private bindButtons(root: HTMLElement) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      const a = el?.dataset.a;
      if (!a) return;
      if (a === 'start') this.handlers.onStart(this.readSettings());
      else if (a === 'howto') this.handlers.onTutorial(this.readSettings());
      else if (a === 'fly') this.handlers.onTutorialStart();
      else if (a === 'back') this.show('menu');
      else if (a === 'resume') this.handlers.onResume();
      else if (a === 'restart') this.handlers.onRestart();
      else if (a === 'menu') this.handlers.onMenu();
      else if (a === 'install') this.handlers.onInstall();
      else if (a === 'training') this.handlers.onTraining();
      else if (a === 'brief') this.handlers.onBriefing(Number(el!.dataset.i));
      else if (a === 'level') this.handlers.onStartLevel(Number(el!.dataset.i));
      else if (a === 'next') this.handlers.onNextLevel();
    });
  }

  private buildMenu() {
    const opt = (v: string | number, label: string, cur: string | number) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    const s = this.settings;
    this.menu.innerHTML = `<div class="panel">
      <div class="logo">AUTO<span>ROTATION</span></div>
      <p class="tagline">Your engine is about to quit. Get it down in one piece.</p>
      <div class="settings">
        <label>Difficulty<select name="diff">${opt('easy', 'Easy (arcade)', s.difficulty)}${opt('normal', 'Realistic', s.difficulty)}</select></label>
        <label>Start altitude<select name="alt">${[700, 1000, 1500].map((v) => opt(v, `${v} ft`, s.altitudeFt)).join('')}</select></label>
        <label>Airspeed<select name="ias">${[60, 70, 90].map((v) => opt(v, `${v} kt`, s.airspeedKt)).join('')}</select></label>
        <label>Wind<select name="wind">${Object.entries(WIND_PRESETS).map(([k, w]) => opt(k, w.label, s.wind)).join('')}</select></label>
        <label class="check"><input type="checkbox" name="hints"${s.hints ? ' checked' : ''}/> Coaching hints</label>
      </div>
      <div class="buttons">
        <button class="btn primary" data-a="start">Start flight</button>
        <button class="btn" data-a="training">Training</button>
        <button class="btn" data-a="howto">How to fly</button>
        <button class="btn install" data-a="install" hidden>Install app</button>
      </div>
      <div class="best" data-k="best"></div>
      <p class="disclaimer">An educational arcade prototype. Not a flight-training device, and not a source of approved emergency procedures.</p>
    </div>`;
    this.bindButtons(this.menu);
  }

  private buildTutorial() {
    const keys = KEY_BINDINGS.map((k) => `<tr><td class="key">${esc(k.keys)}</td><td>${esc(k.action)}</td></tr>`).join('');
    this.tutorial.innerHTML = `<div class="panel wide">
      <h2>How to fly an autorotation</h2>
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
      <div class="buttons"><button class="btn primary" data-a="fly">Start flight</button><button class="btn" data-a="back">Back</button></div>
    </div>`;
    this.bindButtons(this.tutorial);
  }

  readSettings(): Settings {
    const q = <T extends HTMLElement>(n: string) => this.menu.querySelector<T>(`[name="${n}"]`)!;
    this.settings = {
      difficulty: q<HTMLSelectElement>('diff').value as Difficulty,
      altitudeFt: Number(q<HTMLSelectElement>('alt').value),
      airspeedKt: Number(q<HTMLSelectElement>('ias').value),
      wind: q<HTMLSelectElement>('wind').value as Settings['wind'],
      hints: q<HTMLInputElement>('hints').checked,
    };
    return this.settings;
  }

  setBest(best: number | null, attempts: number) {
    const el = this.menu.querySelector<HTMLElement>('[data-k="best"]')!;
    el.textContent = best === null ? '' : `Best score ${best} / 100 · ${attempts} attempt${attempts === 1 ? '' : 's'}`;
  }

  setInstallAvailable(v: boolean) {
    this.installAvailable = v;
    this.menu.querySelector<HTMLElement>('[data-a="install"]')!.hidden = !v;
  }

  /** Level picker; a level opens once the previous one is passed. */
  showTraining(progress: Record<string, number>) {
    const cards = LEVELS.map((l, i) => {
      const open = isUnlocked(i, progress);
      const got = progress[l.id] ?? 0;
      return `<button class="level-card" data-a="brief" data-i="${i}"${open ? '' : ' disabled'}>
        <span class="lc-num">${l.num}</span><span class="lc-title">${esc(l.title)}</span>
        <span class="lc-teach">${open ? esc(l.teaches) : `🔒 Pass level ${l.num - 1} to unlock`}</span>
        ${stars(got)}</button>`;
    }).join('');
    this.training.innerHTML = `<div class="panel wide">
      <h2>Training</h2>
      <p class="tagline">Short lessons, one skill each. Pass a level to unlock the next.</p>
      <div class="level-grid">${cards}</div>
      <div class="buttons"><button class="btn" data-a="back">Back</button></div>
    </div>`;
    this.show('training');
  }

  /** What the lesson is about, before it starts. */
  showBriefing(index: number, mode: Mode) {
    const def = LEVELS[index];
    const b = BRIEFINGS[def.id];
    const steps = b.steps(KEY_WORDS[mode]).map((t) => `<li>${t}</li>`).join('');
    this.briefing.innerHTML = `<div class="panel wide brief-panel">
      <div class="lvl-num">Level ${def.num} of ${LEVELS.length}</div>
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
    this.results.innerHTML = `<div class="panel results-panel">
      <div class="lvl-num">Level ${def.num} · ${esc(def.title)}</div>
      <div class="outcome ${passed ? 'excellent' : 'crash'}">${title}</div>
      ${passed ? stars(status.stars) : ''}
      <div class="reason">${esc(passed ? status.text : (status.reason ?? status.text))}</div>
      <p class="lesson-recap">${passed && !hasNext ? 'You have flown every lesson. Try a free flight from the menu next.' : `Lesson: ${esc(def.teaches)}`}</p>
      <div class="buttons">${first}<button class="btn" data-a="training">Training</button></div>
    </div>`;
    this.show('results');
  }

  show(which: 'menu' | 'tutorial' | 'pause' | 'results' | 'training' | 'briefing' | null) {
    for (const el of this.all) el.classList.remove('visible');
    if (which) this[which].classList.add('visible');
  }

  showResults(r: FlightResult, best: number, isNewBest: boolean) {
    const td = r.touchdown;
    const deg = (rad: number) => `${rad >= 0 ? '+' : ''}${((rad * 180) / Math.PI).toFixed(0)}°`;
    const stats = td
      ? [
          td.verticalSpeed >= 0 ? `${Math.round(td.verticalSpeed * 196.85)} fpm sink` : 'climbing at contact',
          `${Math.round(td.groundSpeed * 1.944)} kt ground speed`,
          `NR ${td.rpmPct.toFixed(0)}%`,
          `pitch ${deg(td.pitch)}`,
          td.area ? td.area.name : td.surface === 'water' ? 'lake' : 'open terrain',
        ]
      : [];
    const cats = r.score.categories
      .map((c) => {
        const pct = (c.score / c.max) * 100;
        const cls = pct >= 80 ? 'good' : pct >= 45 ? 'warn' : 'bad';
        return `<div class="cat"><div class="cat-name">${esc(c.label)}</div><div class="cat-bar"><div class="${cls}" style="width:${pct}%"></div></div><div class="cat-score">${Math.round(c.score)}/${c.max}</div></div>`;
      })
      .join('');
    const list = (items: string[]) => items.slice(0, 3).map((t) => `<li>${esc(t)}</li>`).join('');
    this.results.innerHTML = `<div class="panel wide results-panel">
      <div class="outcome ${r.outcome}">${OUTCOME_TEXT[r.outcome]}</div>
      ${r.crashReason ? `<div class="reason">${esc(r.crashReason)}</div>` : ''}
      <div class="score-row"><div class="score">${r.score.total}<span>/100</span></div>
        <div class="score-meta">${isNewBest ? '<b class="newbest">NEW BEST</b>' : `Best ${best}`}<br/>Damage ${Math.round(r.damage)}%</div></div>
      <div class="stats">${stats.map(esc).join(' · ')}</div>
      <div class="cats">${cats}</div>
      <div class="feedback">
        ${r.score.strengths.length ? `<div><h3>Went well</h3><ul class="good-list">${list(r.score.strengths)}</ul></div>` : ''}
        ${r.score.improvements.length ? `<div><h3>Next time</h3><ul class="bad-list">${list(r.score.improvements)}</ul></div>` : ''}
      </div>
      <div class="buttons"><button class="btn primary" data-a="restart">Fly again <small>(Enter)</small></button><button class="btn" data-a="menu">Menu</button></div>
    </div>`;
    this.show('results');
  }
}
