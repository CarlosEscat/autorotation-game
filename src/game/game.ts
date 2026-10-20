import { AudioEngine } from '../audio/audio';
import { Hud } from '../hud/hud';
import { InputManager } from '../input/input';
import { attachKeyboard } from '../input/keyboard';
import { TouchControls, attachLook } from '../input/touch';
import { GameRenderer } from '../render/renderer';
import { RPM } from '../sim/aircraft';
import { Screens, Settings, configFromSettings } from '../ui/screens';
import { World, createWorld } from '../world/world';
import { FixedStepper } from './fixedStep';
import { computeGuidance } from './guidance';
import { contextualHint } from './hints';
import { FlightSession } from './session';

type GameState = 'menu' | 'flying' | 'paused' | 'results';

const STORAGE_KEY = 'autorotation.v1';
interface Saved {
  settings: Settings;
  best: number | null;
  attempts: number;
}

function load(): Saved {
  const fallback: Saved = { settings: { difficulty: 'easy', altitudeFt: 1000, airspeedKt: 70, wind: 'light', hints: true }, best: null, attempts: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    // Older saves predate newer settings (e.g. difficulty): fill them from the defaults.
    return { ...fallback, ...parsed, settings: { ...fallback.settings, ...parsed.settings } };
  } catch {
    return fallback;
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: progress just isn't remembered */
  }
}

/** Top-level glue: state machine, main loop, and wiring between modules. */
export class Game {
  private world: World = createWorld();
  private input = new InputManager();
  private renderer: GameRenderer;
  private hud: Hud;
  private touch: TouchControls;
  private screens: Screens;
  private audio = new AudioEngine();
  private stepper = new FixedStepper();
  private saved = load();
  private session: FlightSession | null = null;
  private state: GameState = 'menu';
  private targetIndex = 0;
  private lastFrame = 0;
  private lowGTimer = 0;
  private installPrompt: (Event & { prompt(): Promise<void> }) | null = null;

  constructor(root: HTMLElement) {
    this.renderer = new GameRenderer(root, this.world);
    attachLook(this.renderer.renderer.domElement, this.input);
    this.hud = new Hud(root);
    this.touch = new TouchControls(root, this.input);
    this.screens = new Screens(root, this.saved.settings, {
      onStart: (s) => this.startFlight(s),
      onTutorial: (s) => {
        this.saved.settings = s;
        this.screens.show('tutorial');
      },
      onTutorialStart: () => this.startFlight(this.saved.settings),
      onResume: () => this.resume(),
      onRestart: () => this.startFlight(this.saved.settings),
      onMenu: () => this.toMenu(),
      onInstall: () => void this.installPrompt?.prompt(),
    });
    attachKeyboard(this.input);
    this.bindActions();

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.touch.setVisible(false);
    if (coarse) this.input.mode = 'touch';
    window.addEventListener('touchstart', () => (this.input.mode = 'touch'), { passive: true });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e as Event & { prompt(): Promise<void> };
      this.screens.setInstallAvailable(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'flying') this.pause();
    });

    // Idle preview behind the menu.
    this.session = new FlightSession(this.world, { ...configFromSettings(this.saved.settings), failureDelay: 1e9 });
    this.renderer.setWind(0, 0);
    this.renderer.setTarget(null);
    this.renderer.setMode('chase');
    this.toMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  private bindActions() {
    const i = this.input;
    i.on('cycleTarget', () => {
      if (this.state !== 'flying') return;
      this.targetIndex = (this.targetIndex + 1) % this.world.areas.length;
      this.renderer.setTarget(this.world.areas[this.targetIndex]);
    });
    i.on('camera', () => {
      if (this.state === 'flying' || this.state === 'results') this.renderer.setMode(this.renderer.mode === 'cockpit' ? 'chase' : 'cockpit');
    });
    i.on('pause', () => (this.state === 'flying' ? this.pause() : this.state === 'paused' ? this.resume() : undefined));
    i.on('restart', () => {
      if (this.state === 'results' || this.state === 'paused') this.startFlight(this.saved.settings);
    });
    i.on('confirm', () => {
      if (this.state === 'results') this.startFlight(this.saved.settings);
    });
    i.on('mute', () => this.audio.setMuted(!this.audio.muted));
  }

  private startFlight(settings: Settings) {
    this.saved.settings = settings;
    save(this.saved);
    this.audio.start();
    const cfg = configFromSettings(settings);
    this.session = new FlightSession(this.world, cfg);
    this.input.reset(this.session.state.collective);
    this.stepper.reset();
    this.targetIndex = 0;
    this.renderer.setTarget(this.world.areas[0]);
    this.renderer.setWind(cfg.windFromDeg, cfg.windKt);
    this.renderer.setMode('cockpit');
    this.screens.show(null);
    this.hud.setVisible(true);
    this.touch.setVisible(this.input.mode === 'touch');
    document.body.classList.toggle('touch', this.input.mode === 'touch');
    document.body.classList.add('flying');
    this.state = 'flying';
    this.lowGTimer = 0;
  }

  private pause() {
    this.state = 'paused';
    this.screens.show('pause');
    this.audio.suspend();
  }

  private resume() {
    this.state = 'flying';
    this.screens.show(null);
    this.audio.start();
    this.lastFrame = performance.now();
  }

  private toMenu() {
    this.state = 'menu';
    this.hud.setVisible(false);
    this.touch.setVisible(false);
    document.body.classList.remove('flying');
    this.screens.setBest(this.saved.best, this.saved.attempts);
    this.screens.show('menu');
    this.audio.suspend();
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    const session = this.session!;

    if (this.state === 'flying') {
      for (let n = this.stepper.advance(dt); n > 0; n--) {
        this.input.update(this.stepper.dt);
        session.step(this.input.controls, this.stepper.dt);
      }
      this.handleEvents(session);
      this.touch.sync(this.input.controls.collective);
    } else if (this.state === 'menu') {
      // Slow orbit of the scenery behind the menu.
      session.state.yaw += dt * 0.05;
    }

    const s = session.state;
    this.renderer.render(s, this.input.controls, { yaw: this.input.lookYaw, pitch: this.input.lookPitch }, this.state === 'paused' ? 0 : dt, session.tipOver);

    if (this.state === 'flying' || this.state === 'results') {
      const target = this.world.areas[this.targetIndex];
      const guidance = computeGuidance(s, target, session.wind);
      const engineOut = !s.engineRunning;
      this.lowGTimer = Math.max(0, this.lowGTimer - dt);
      const hint = this.saved.settings.hints && this.state === 'flying' ? contextualHint(session, guidance, this.input.mode) : null;
      this.hud.update(
        { state: s, engineOut, target, guidance, windKt: session.config.windKt, windFromDeg: session.config.windFromDeg, hint, lowG: this.lowGTimer > 0 },
        dt,
      );
      this.audio.update(s.rpmPct, s.engineAvail, engineOut && s.rpmPct < RPM.lowWarn && session.phase === 'autorotation', now / 1000);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private handleEvents(session: FlightSession) {
    for (const ev of session.events.splice(0)) {
      switch (ev.type) {
        case 'failure':
          this.hud.flash('ENGINE FAILURE', 'danger', 2.5);
          this.audio.failureChime();
          break;
        case 'assist':
          this.hud.flash('LANDING ASSIST', 'info', 1.6);
          break;
        case 'lowG':
          this.lowGTimer = 1.5;
          break;
        case 'touchdown':
          this.hud.flash('TOUCHDOWN', 'info', 1.6);
          this.audio.impact(Math.min(1, (session.touchdown?.verticalSpeed ?? 0) / 6));
          break;
        case 'crash':
          this.hud.flash('CRASH', 'danger', 2);
          this.audio.impact(1);
          break;
        case 'stopped':
          this.finish(session);
          break;
      }
    }
  }

  private finish(session: FlightSession) {
    const r = session.result!;
    const prev = this.saved.best;
    this.saved.attempts += 1;
    const isNewBest = prev === null || r.score.total > prev;
    if (isNewBest) this.saved.best = r.score.total;
    save(this.saved);
    this.state = 'results';
    this.touch.setVisible(false);
    // Let the scene breathe for a moment before the debrief appears.
    setTimeout(() => {
      if (this.state === 'results') this.screens.showResults(r, this.saved.best ?? r.score.total, isNewBest && prev !== null);
    }, 700);
  }
}
