import { M_TO_FT, MS_TO_FPM, MS_TO_KT, RPM } from '../sim/aircraft';
import { HelicopterState } from '../sim/state';
import { clamp } from '../sim/vec';
import { Guidance } from '../game/guidance';
import { LandingArea } from '../world/world';

const RPM_MIN = 60, RPM_MAX = 125;
const rpmToPct = (r: number) => ((clamp(r, RPM_MIN, RPM_MAX) - RPM_MIN) / (RPM_MAX - RPM_MIN)) * 100;

export interface Lesson {
  title: string;
  text: string;
  progress: number | null;
}

export interface HudFrame {
  state: HelicopterState;
  engineOut: boolean;
  target: LandingArea | null;
  guidance: Guidance | null;
  windKt: number;
  windFromDeg: number;
  hint: string | null;
  lowG: boolean;
  /** Water tank: share full and what it is doing, or null for a type without a tank. */
  water?: { level: number; state: 'idle' | 'drop' | 'fill' } | null;
}

/** Arcade-style HTML overlay. Purely presentational. */
export class Hud {
  readonly root: HTMLElement;
  private q = <T extends HTMLElement = HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
  private els: Record<string, HTMLElement> = {};
  private banner: HTMLElement;
  private bannerTimer = 0;
  /** Last value written per element and property, so a frame only touches the page where something changed. */
  private shown = new Map<string, string>();

  /** True when `value` differs from what was last written under `key` (and remembers it). */
  private changed(key: string, value: string): boolean {
    if (this.shown.get(key) === value) return false;
    this.shown.set(key, value);
    return true;
  }
  private text(k: string, value: string) {
    if (this.changed('t:' + k, value)) this.els[k].textContent = value;
  }
  private data(k: string, value: string) {
    if (this.changed('d:' + k, value)) this.els[k].dataset.s = value;
  }
  private css(k: string, prop: 'bottom' | 'height' | 'width' | 'transform' | 'visibility', value: string) {
    if (this.changed(`${prop}:${k}`, value)) this.els[k].style[prop] = value;
  }
  private on(k: string, on: boolean) {
    if (this.changed('on:' + k, on ? '1' : '')) this.els[k].classList.toggle('on', on);
  }

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    const bands = [
      [RPM_MIN, 80, 'var(--red)'],
      [80, RPM.lowWarn, 'var(--amber)'],
      [RPM.lowWarn, RPM.highWarn, 'var(--green)'],
      [RPM.highWarn, RPM.overspeed, 'var(--amber)'],
      [RPM.overspeed, RPM_MAX, 'var(--red)'],
    ]
      .map(([a, b, c]) => `${c} ${rpmToPct(a as number)}% ${rpmToPct(b as number)}%`)
      .join(', ');
    this.root.innerHTML = `
      <div class="hud-left">
        <div class="gauge rpm">
          <div class="g-label">ROTOR</div>
          <div class="rpm-track" style="background: linear-gradient(to top, ${bands})"><div class="rpm-needle"></div></div>
          <div class="g-value" data-k="rpm">100</div><div class="g-unit">% NR</div>
        </div>
        <div class="gauge coll">
          <div class="g-label">COLL</div>
          <div class="coll-track"><div class="coll-fill"></div></div>
        </div>
        <div class="gauge water">
          <div class="g-label" data-k="wlabel">WATER</div>
          <div class="coll-track"><div class="water-fill"></div></div>
        </div>
      </div>
      <div class="hud-right">
        <div class="readout" data-box="ias"><div class="g-label">IAS</div><div class="g-value" data-k="ias">0</div><div class="g-unit">KT</div></div>
        <div class="readout" data-box="alt"><div class="g-label">ALT AGL</div><div class="g-value" data-k="alt">0</div><div class="g-unit">FT</div></div>
        <div class="readout" data-box="vsi"><div class="g-label">VSI</div><div class="g-value" data-k="vsi">0</div><div class="g-unit">FPM</div></div>
      </div>
      <div class="hud-top">
        <div class="target">
          <div class="tgt-arrow" data-k="arrow">▲</div>
          <div class="tgt-text"><span data-k="tname">—</span> <span class="tgt-dist" data-k="tdist"></span> <span class="reach" data-k="reach"></span></div>
        </div>
        <div class="hdg"><span data-k="hdg">000</span>° · WIND <span data-k="wind"></span></div>
      </div>
      <div class="hud-center">
        <svg class="attitude" viewBox="-50 -50 100 100" aria-hidden="true">
          <defs><clipPath id="adi-clip"><circle r="46"/></clipPath></defs>
          <g clip-path="url(#adi-clip)">
            <g data-k="horizon">
              <rect x="-150" y="-300" width="300" height="300" fill="#3d7fd0"/>
              <rect x="-150" y="0" width="300" height="300" fill="#8a5a2b"/>
              <line x1="-150" y1="0" x2="150" y2="0" stroke="#fff" stroke-width="1.5"/>
              ${[-20, -10, 10, 20].map((d) => `<line x1="-${Math.abs(d) === 10 ? 10 : 16}" y1="${-d * 2}" x2="${Math.abs(d) === 10 ? 10 : 16}" y2="${-d * 2}" stroke="#fff" stroke-width="1"/>`).join('')}
            </g>
          </g>
          <circle r="46" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2"/>
          <path d="M-26 0 H-9 L-4 6 M26 0 H9 L4 6" stroke="#ffd23a" stroke-width="3" fill="none"/>
          <circle r="2" fill="#ffd23a"/>
        </svg>
        <div class="pitch-read"><span data-k="pitch">0</span>°</div>
      </div>
      <div class="warnings"><div class="warn" data-w="engine">ENGINE OUT</div><div class="warn" data-w="lowrpm">LOW ROTOR RPM</div><div class="warn" data-w="highrpm">RPM HIGH</div><div class="warn" data-w="lowg">LOW-G</div></div>
      <div class="hint" data-k="hint"></div>
      <div class="hint lesson"><div class="lesson-title" data-k="ltitle"></div><div data-k="ltext"></div><div class="lesson-bar"><div data-k="lbar"></div></div></div>
      <div class="banner"></div>`;
    parent.appendChild(this.root);
    for (const e of this.root.querySelectorAll<HTMLElement>('[data-k]')) this.els[e.dataset.k!] = e;
    for (const e of this.root.querySelectorAll<HTMLElement>('[data-w]')) this.els['w-' + e.dataset.w] = e;
    this.banner = this.q('.banner');
    // Elements the frame update writes to, looked up once.
    const named = { needle: '.rpm-needle', coll: '.coll-fill', tank: '.gauge.water', wfill: '.water-fill', target: '.target', lesson: '.lesson' };
    for (const [k, sel] of Object.entries(named)) this.els[k] = this.q(sel);
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('visible', v);
  }

  /** Training instructions, shown where the coaching hints normally go. */
  setLesson(l: Lesson | null) {
    this.on('lesson', !!l);
    if (!l) return;
    this.text('ltitle', l.title);
    this.text('ltext', l.text);
    if (this.changed('lbar-hidden', l.progress === null ? '1' : '')) this.els.lbar.parentElement!.hidden = l.progress === null;
    this.css('lbar', 'width', `${((l.progress ?? 0) * 100).toFixed(1)}%`);
  }

  flash(text: string, kind: 'danger' | 'info' = 'danger', seconds = 2.2) {
    this.banner.textContent = text;
    this.banner.className = `banner show ${kind}`;
    this.bannerTimer = seconds;
  }

  update(f: HudFrame, dt: number) {
    const s = f.state;
    const rpm = s.rpmPct;
    this.text('rpm', rpm.toFixed(0));
    this.css('needle', 'bottom', `${rpmToPct(rpm).toFixed(1)}%`);
    this.data('rpm', rpm < 80 || rpm > RPM.overspeed ? 'bad' : rpm < RPM.lowWarn || rpm > RPM.highWarn ? 'warn' : 'good');
    this.css('coll', 'height', `${(s.collective * 100).toFixed(1)}%`);

    const w = f.water ?? null;
    this.on('tank', !!w);
    if (w) {
      this.css('wfill', 'height', `${(w.level * 100).toFixed(1)}%`);
      this.data('tank', w.state !== 'idle' ? w.state : w.level === 0 ? 'empty' : 'idle');
      this.text('wlabel', w.state === 'fill' ? 'FILL' : w.level === 0 ? 'EMPTY' : 'WATER');
    }

    const kt = s.airspeed * MS_TO_KT;
    this.text('ias', kt.toFixed(0));
    this.data('ias', !f.engineOut ? 'neutral' : kt >= 50 && kt <= 75 ? 'good' : kt >= 40 && kt <= 85 ? 'warn' : 'bad');
    // Feet matter close to the ground (flare and cushion timing); above 100 ft round to 10.
    const altFt = Math.max(0, s.agl * M_TO_FT);
    this.text('alt', (altFt < 100 ? Math.round(altFt) : Math.round(altFt / 10) * 10).toFixed(0));
    const fpm = s.verticalSpeed * MS_TO_FPM;
    this.text('vsi', `${fpm > 50 ? '▲' : fpm < -50 ? '▼' : ''}${Math.abs(Math.round(fpm / 50) * 50)}`);
    this.data('vsi', fpm < -2200 ? 'bad' : fpm < -1700 ? 'warn' : 'neutral');

    const pitchDeg = (s.pitch * 180) / Math.PI;
    const rollDeg = (s.roll * 180) / Math.PI;
    const horizon = `rotate(${(-rollDeg).toFixed(1)}) translate(0 ${(clamp(pitchDeg, -30, 30) * 2).toFixed(1)})`;
    if (this.changed('horizon', horizon)) this.els.horizon.setAttribute('transform', horizon);
    this.text('pitch', `${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(0)}`);

    this.text('hdg', String(Math.round(s.heading) % 360).padStart(3, '0'));
    this.text('wind', f.windKt < 1 ? 'CALM' : `${String(Math.round(f.windFromDeg)).padStart(3, '0')}°/${Math.round(f.windKt)}KT`);

    this.css('target', 'visibility', f.target ? '' : 'hidden');
    if (f.target && f.guidance) {
      const g = f.guidance;
      this.text('tname', f.target.name.toUpperCase());
      this.text('tdist', g.distance > 950 ? `${(g.distance / 1000).toFixed(1)} km` : `${Math.round(g.distance / 10) * 10} m`);
      this.css('arrow', 'transform', `rotate(${((g.relBearing * 180) / Math.PI).toFixed(1)}deg)`);
      this.text('reach', !f.engineOut ? '' : g.reach === 'ok' ? 'IN REACH' : g.reach === 'marginal' ? 'MARGINAL' : 'TOO FAR');
      this.data('reach', g.reach === 'ok' ? 'good' : g.reach === 'marginal' ? 'warn' : 'bad');
    }

    this.on('w-engine', f.engineOut);
    this.on('w-lowrpm', f.engineOut && rpm < RPM.lowWarn && s.agl > 0.5);
    this.on('w-highrpm', rpm > RPM.highWarn + 2);
    this.on('w-lowg', f.lowG);

    this.text('hint', f.hint ?? '');
    this.on('hint', !!f.hint);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
  }
}
