import { clamp } from '../sim/vec';
import { InputManager } from './input';

/**
 * On-screen thumb controls: a collective lever on the left, a cyclic stick on
 * the right, pedal buttons, and a few action buttons. Each control tracks its
 * own pointer id, so several fingers can operate at once.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private collectiveTrack: HTMLElement;
  private collectiveHandle: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;

  constructor(
    parent: HTMLElement,
    private input: InputManager,
  ) {
    this.root = el('div', 'touch-controls');
    this.root.innerHTML = `
      <div class="tc-collective"><div class="tc-label">COLL</div><div class="tc-track"><div class="tc-fill"></div><div class="tc-handle"></div></div></div>
      <div class="tc-pedals"><button class="tc-btn tc-pedal" data-pedal="-1" aria-label="Left pedal">◀</button><button class="tc-btn tc-pedal" data-pedal="1" aria-label="Right pedal">▶</button></div>
      <div class="tc-stick"><div class="tc-label">CYCLIC</div><div class="tc-base"><div class="tc-knob"></div></div></div>
      <div class="tc-actions">
        <button class="tc-btn" data-action="cycleTarget">TGT</button>
        <button class="tc-btn" data-action="camera">CAM</button>
        <button class="tc-btn" data-action="mute" aria-label="Sound off">SND</button>
        <button class="tc-btn" data-action="pause">II</button>
      </div>`;
    parent.appendChild(this.root);
    this.collectiveTrack = this.root.querySelector('.tc-track')!;
    this.collectiveHandle = this.root.querySelector('.tc-handle')!;
    this.stickBase = this.root.querySelector('.tc-base')!;
    this.stickKnob = this.root.querySelector('.tc-knob')!;

    this.bindCollective();
    this.bindStick();
    for (const b of this.root.querySelectorAll<HTMLElement>('.tc-pedal')) {
      const v = Number(b.dataset.pedal);
      track(b, {
        down: () => (this.input.touchPedal = v),
        up: () => (this.input.touchPedal = 0),
      });
    }
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-action]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.input.emit(b.dataset.action as 'cycleTarget');
      });
    }
  }

  private bindCollective() {
    const set = (e: PointerEvent) => {
      const r = this.collectiveTrack.getBoundingClientRect();
      this.input.touchCollective = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      this.input.mode = 'touch';
    };
    track(this.collectiveTrack, { down: set, move: set });
  }

  private bindStick() {
    let cx = 0, cy = 0, radius = 1;
    const move = (e: PointerEvent) => {
      const dx = clamp((e.clientX - cx) / radius, -1, 1);
      const dy = clamp((e.clientY - cy) / radius, -1, 1);
      // Small dead zone, then a gentle curve for fine control near centre.
      const shape = (v: number) => (Math.abs(v) < 0.08 ? 0 : Math.sign(v) * ((Math.abs(v) - 0.08) / 0.92) ** 1.4);
      this.input.touchRoll = shape(dx);
      this.input.touchPitch = shape(dy); // drag down = aft cyclic = nose up
      this.stickKnob.style.transform = `translate(${dx * radius * 0.7}px, ${dy * radius * 0.7}px)`;
    };
    track(this.stickBase, {
      down: (e) => {
        const r = this.stickBase.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        radius = r.width / 2;
        this.input.touchActive = true;
        this.input.mode = 'touch';
        move(e);
      },
      move,
      up: () => {
        this.input.touchActive = false;
        this.input.touchPitch = this.input.touchRoll = 0;
        this.stickKnob.style.transform = '';
      },
    });
  }

  /** Mirror the current collective on the lever (keyboard may also move it). */
  sync(collective: number) {
    this.collectiveHandle.style.bottom = `calc(${collective * 100}% - 14px)`;
    (this.collectiveTrack.firstElementChild as HTMLElement).style.height = `${collective * 100}%`;
  }

  setMuted(m: boolean) {
    const b = this.root.querySelector<HTMLElement>('[data-action="mute"]')!;
    b.textContent = m ? 'MUTE' : 'SND';
    b.classList.toggle('off', m);
    b.setAttribute('aria-label', m ? 'Sound on' : 'Sound off');
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('visible', v);
  }
}

/** Drag on the 3D view to look around the cockpit (mouse or a spare finger). */
export function attachLook(view: HTMLElement, input: InputManager) {
  let lastX = 0, lastY = 0;
  track(view, {
    down: (e) => {
      input.looking = true;
      lastX = e.clientX;
      lastY = e.clientY;
    },
    move: (e) => {
      const k = 2.4 / Math.max(view.clientWidth, 1);
      input.lookYaw = clamp(input.lookYaw - (e.clientX - lastX) * k, -2.2, 2.2);
      input.lookPitch = clamp(input.lookPitch - (e.clientY - lastY) * k, -1.0, 0.6);
      lastX = e.clientX;
      lastY = e.clientY;
    },
    up: () => (input.looking = false),
  });
}

function el(tag: string, cls: string) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

/** Pointer tracking bound to the first pointer that pressed the element. */
function track(target: HTMLElement, h: { down?: (e: PointerEvent) => void; move?: (e: PointerEvent) => void; up?: (e: PointerEvent) => void }) {
  let id: number | null = null;
  target.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    e.preventDefault();
    e.stopPropagation();
    id = e.pointerId;
    target.setPointerCapture(e.pointerId);
    h.down?.(e);
  });
  target.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    e.preventDefault();
    h.move?.(e);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    h.up?.(e);
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
