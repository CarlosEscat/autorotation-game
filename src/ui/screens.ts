import { KEY_BINDINGS } from '../input/keyboard';
import { FlightConfig, FlightResult } from '../game/session';
import { Outcome } from '../game/landing';

export interface Settings {
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
  return { altitudeFt: s.altitudeFt, airspeedKt: s.airspeedKt, windKt: w.kt, windFromDeg: w.from, failureDelay: 4 };
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  excellent: 'EXCELLENT LANDING',
  safe: 'SAFE LANDING',
  damaged: 'DAMAGED LANDING',
  crash: 'CRASH',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
}

export class Screens {
  private menu: HTMLElement;
  private tutorial: HTMLElement;
  private pause: HTMLElement;
  private results: HTMLElement;
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
    this.all = [this.menu, this.tutorial, this.pause, this.results];
    this.buildMenu();
    this.buildTutorial();
    this.pause.innerHTML = `<div class="panel small"><h2>PAUSED</h2>
      <button class="btn primary" data-a="resume">Resume</button>
      <button class="btn" data-a="restart">Restart flight</button>
      <button class="btn" data-a="menu">Main menu</button></div>`;
    this.bindButtons(this.pause);
    this.bindButtons(this.results);
  }

  private bindButtons(root: HTMLElement) {
    root.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'start') this.handlers.onStart(this.readSettings());
      else if (a === 'howto') this.handlers.onTutorial(this.readSettings());
      else if (a === 'fly') this.handlers.onTutorialStart();
      else if (a === 'back') this.show('menu');
      else if (a === 'resume') this.handlers.onResume();
      else if (a === 'restart') this.handlers.onRestart();
      else if (a === 'menu') this.handlers.onMenu();
      else if (a === 'install') this.handlers.onInstall();
    });
  }

  private buildMenu() {
    const opt = (v: string | number, label: string, cur: string | number) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    const s = this.settings;
    this.menu.innerHTML = `<div class="panel">
      <div class="logo">AUTO<span>ROTATION</span></div>
      <p class="tagline">Your engine is about to quit. Get it down in one piece.</p>
      <div class="settings">
        <label>Start altitude<select name="alt">${[700, 1000, 1500].map((v) => opt(v, `${v} ft`, s.altitudeFt)).join('')}</select></label>
        <label>Airspeed<select name="ias">${[60, 70, 90].map((v) => opt(v, `${v} kt`, s.airspeedKt)).join('')}</select></label>
        <label>Wind<select name="wind">${Object.entries(WIND_PRESETS).map(([k, w]) => opt(k, w.label, s.wind)).join('')}</select></label>
        <label class="check"><input type="checkbox" name="hints"${s.hints ? ' checked' : ''}/> Coaching hints</label>
      </div>
      <div class="buttons">
        <button class="btn primary" data-a="start">Start flight</button>
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

  show(which: 'menu' | 'tutorial' | 'pause' | 'results' | null) {
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
