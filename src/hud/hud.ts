import { M_TO_FT, MS_TO_FPM, MS_TO_KT, RPM } from '../sim/aircraft';
import { HelicopterState } from '../sim/state';
import { clamp } from '../sim/vec';
import { Guidance } from '../game/guidance';
import { LandingArea } from '../world/world';

const RPM_MIN = 60, RPM_MAX = 125;
const rpmToPct = (r: number) => ((clamp(r, RPM_MIN, RPM_MAX) - RPM_MIN) / (RPM_MAX - RPM_MIN)) * 100;

export interface HudFrame {
  state: HelicopterState;
  engineOut: boolean;
  target: LandingArea | null;
  guidance: Guidance | null;
  windKt: number;
  windFromDeg: number;
  hint: string | null;
  lowG: boolean;
}

/** Arcade-style HTML overlay. Purely presentational. */
export class Hud {
  readonly root: HTMLElement;
  private q = <T extends HTMLElement = HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
  private els: Record<string, HTMLElement> = {};
  private banner: HTMLElement;
  private bannerTimer = 0;

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
      <div class="banner"></div>`;
    parent.appendChild(this.root);
    for (const e of this.root.querySelectorAll<HTMLElement>('[data-k]')) this.els[e.dataset.k!] = e;
    for (const e of this.root.querySelectorAll<HTMLElement>('[data-w]')) this.els['w-' + e.dataset.w] = e;
    this.banner = this.q('.banner');
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('visible', v);
  }

  flash(text: string, kind: 'danger' | 'info' = 'danger', seconds = 2.2) {
    this.banner.textContent = text;
    this.banner.className = `banner show ${kind}`;
    this.bannerTimer = seconds;
  }

  update(f: HudFrame, dt: number) {
    const s = f.state;
    const e = this.els;
    const rpm = s.rpmPct;
    e.rpm.textContent = rpm.toFixed(0);
    this.q('.rpm-needle').style.bottom = `${rpmToPct(rpm)}%`;
    const rpmState = rpm < 80 || rpm > RPM.overspeed ? 'bad' : rpm < RPM.lowWarn || rpm > RPM.highWarn ? 'warn' : 'good';
    e.rpm.dataset.s = rpmState;
    this.q('.coll-fill').style.height = `${s.collective * 100}%`;

    const kt = s.airspeed * MS_TO_KT;
    e.ias.textContent = kt.toFixed(0);
    e.ias.dataset.s = !f.engineOut ? 'neutral' : kt >= 50 && kt <= 75 ? 'good' : kt >= 40 && kt <= 85 ? 'warn' : 'bad';
    e.alt.textContent = Math.max(0, Math.round((s.agl * M_TO_FT) / 10) * 10).toFixed(0);
    const fpm = s.verticalSpeed * MS_TO_FPM;
    e.vsi.textContent = `${fpm > 50 ? '▲' : fpm < -50 ? '▼' : ''}${Math.abs(Math.round(fpm / 50) * 50)}`;
    e.vsi.dataset.s = fpm < -2200 ? 'bad' : fpm < -1700 ? 'warn' : 'neutral';

    const pitchDeg = (s.pitch * 180) / Math.PI;
    const rollDeg = (s.roll * 180) / Math.PI;
    e.horizon.setAttribute('transform', `rotate(${-rollDeg}) translate(0 ${clamp(pitchDeg, -30, 30) * 2})`);
    e.pitch.textContent = `${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(0)}`;

    e.hdg.textContent = String(Math.round(s.heading) % 360).padStart(3, '0');
    e.wind.textContent = f.windKt < 1 ? 'CALM' : `${String(Math.round(f.windFromDeg)).padStart(3, '0')}°/${Math.round(f.windKt)}KT`;

    if (f.target && f.guidance) {
      const g = f.guidance;
      e.tname.textContent = f.target.name.toUpperCase();
      e.tdist.textContent = g.distance > 950 ? `${(g.distance / 1000).toFixed(1)} km` : `${Math.round(g.distance / 10) * 10} m`;
      e.arrow.style.transform = `rotate(${(g.relBearing * 180) / Math.PI}deg)`;
      e.reach.textContent = !f.engineOut ? '' : g.reach === 'ok' ? 'IN REACH' : g.reach === 'marginal' ? 'MARGINAL' : 'TOO FAR';
      e.reach.dataset.s = g.reach === 'ok' ? 'good' : g.reach === 'marginal' ? 'warn' : 'bad';
    }

    e['w-engine'].classList.toggle('on', f.engineOut);
    e['w-lowrpm'].classList.toggle('on', f.engineOut && rpm < RPM.lowWarn && s.agl > 0.5);
    e['w-highrpm'].classList.toggle('on', rpm > RPM.highWarn + 2);
    e['w-lowg'].classList.toggle('on', f.lowG);

    e.hint.textContent = f.hint ?? '';
    e.hint.classList.toggle('on', !!f.hint);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
  }
}
