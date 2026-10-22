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
import { computeGuidance, nextTargetAhead } from './guidance';
import { contextualHint } from './hints';
import { LEVELS, LevelDef, Objective, ObjectiveStatus } from './levels';
import { FlightConfig, FlightSession } from './session';

type GameState = 'menu' | 'flying' | 'paused' | 'results';

const STORAGE_KEY = 'autorotation.v1';
interface Saved {
  settings: Settings;
  best: number | null;
  attempts: number;
  /** Best stars per training level id. */
  training: Record<string, number>;
  muted: boolean;
}

interface ActiveLevel {
  index: number;
  def: LevelDef;
  objective: Objective;
  status: ObjectiveStatus;
  /** Seconds of flying left before the result screen, once the level is decided. */
  endIn: number | null;
}

function load(): Saved {
  const fallback: Saved = { settings: { difficulty: 'easy', altitudeFt: 1000, airspeedKt: 70, wind: 'light', hints: true }, best: null, attempts: 0, training: {}, muted: false };
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
  private targetIndex: number | null = 0;
  private level: ActiveLevel | null = null;
  /** Flying around: no engine failure, no score. */
  private free = false;
  /** Level whose briefing is on screen, so Enter can start it. */
  private briefing: number | null = null;
  private lastFrame = 0;
  private lowGTimer = 0;

  constructor(root: HTMLElement) {
    this.renderer = new GameRenderer(root, this.world);
    attachLook(this.renderer.renderer.domElement, this.input);
    this.hud = new Hud(root);
    this.touch = new TouchControls(root, this.input);
    this.screens = new Screens(root, this.saved.settings, {
      onStart: (s) => this.startFlight(s),
      onFreeFlight: (s) => this.startFreeFlight(s),
      onTutorial: (s) => {
        this.saved.settings = s;
        this.screens.show('tutorial');
      },
      onTutorialStart: () => this.startFlight(this.saved.settings),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onMenu: () => this.toMenu(),
      onTraining: () => this.toTraining(),
      onMute: () => this.toggleMute(),
      onBriefing: (i) => this.toBriefing(i),
      onStartLevel: (i) => this.startLevel(i),
      onNextLevel: () => this.toBriefing((this.level?.index ?? -1) + 1),
    });
    attachKeyboard(this.input);
    this.bindActions();
    this.applyMuted();

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.touch.setVisible(false);
    if (coarse) this.input.mode = 'touch';
    window.addEventListener('touchstart', () => (this.input.mode = 'touch'), { passive: true });

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
      const next = nextTargetAhead(this.session!.state, this.world.areas, this.targetIndex);
      if (next === null) return this.hud.flash('NO OTHER FIELD AHEAD', 'info', 1.2);
      this.targetIndex = next;
      this.renderer.setTarget(this.world.areas[next]);
    });
    i.on('camera', () => {
      if (this.state === 'flying' || this.state === 'results') this.renderer.setMode(this.renderer.mode === 'cockpit' ? 'chase' : 'cockpit');
    });
    i.on('pause', () => (this.state === 'flying' ? this.pause() : this.state === 'paused' ? this.resume() : undefined));
    i.on('restart', () => {
      if (this.state === 'results' || this.state === 'paused') this.restart();
    });
    i.on('confirm', () => {
      if (this.state === 'menu' && this.briefing !== null) return this.startLevel(this.briefing);
      if (this.state !== 'results') return;
      const l = this.level;
      if (l && l.status.state === 'passed' && l.index + 1 < LEVELS.length) this.toBriefing(l.index + 1);
      else this.restart();
    });
    i.on('mute', () => this.toggleMute());
  }

  private toggleMute() {
    this.saved.muted = !this.saved.muted;
    save(this.saved);
    this.applyMuted();
    if (this.state === 'flying') this.hud.flash(this.saved.muted ? 'SOUND OFF' : 'SOUND ON', 'info', 1);
  }

  private applyMuted() {
    this.audio.setMuted(this.saved.muted);
    this.screens.setMuted(this.saved.muted);
    this.touch.setMuted(this.saved.muted);
  }

  private startFlight(settings: Settings) {
    this.saved.settings = settings;
    save(this.saved);
    this.level = null;
    this.free = false;
    this.launch(configFromSettings(settings), 0);
  }

  private startFreeFlight(settings: Settings) {
    this.saved.settings = settings;
    save(this.saved);
    this.level = null;
    this.free = true;
    this.launch({ ...configFromSettings(settings), failureDelay: 1e9, freeFlight: true }, null);
  }

  private startLevel(index: number) {
    const def = LEVELS[index];
    if (!def) return this.toTraining();
    this.briefing = null;
    this.free = false;
    const objective = def.makeObjective(this.world);
    const target = def.target === null ? null : this.world.areas.findIndex((a) => a.id === def.target);
    this.launch(def.config, target);
    const status = objective.update(this.levelContext(), 0);
    this.level = { index, def, objective, status, endIn: null };
  }

  private restart() {
    if (this.level) this.startLevel(this.level.index);
    else if (this.free) this.startFreeFlight(this.saved.settings);
    else this.startFlight(this.saved.settings);
  }

  private levelContext() {
    const area = this.targetIndex === null ? null : this.world.areas[this.targetIndex];
    return { session: this.session!, targetId: area?.id ?? null, mode: this.input.mode };
  }

  private launch(cfg: FlightConfig, targetIndex: number | null) {
    this.audio.start();
    this.session = new FlightSession(this.world, cfg);
    this.input.reset(this.session.state.collective);
    this.stepper.reset();
    this.targetIndex = targetIndex;
    this.renderer.setTarget(targetIndex === null ? null : this.world.areas[targetIndex]);
    this.renderer.setGates([], 0);
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

  private toTraining() {
    this.toMenu();
    this.screens.showTraining(this.saved.training);
  }

  private toBriefing(index: number) {
    if (!LEVELS[index]) return this.toTraining();
    this.toMenu();
    this.briefing = index;
    this.screens.showBriefing(index, this.input.mode);
  }

  private toMenu() {
    this.state = 'menu';
    this.level = null;
    this.briefing = null;
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
        // The lever stops where the engine runs out of power, so lowering it answers at once.
        if (session.state.engineRunning) this.input.controls.collective = Math.min(this.input.controls.collective, session.state.collective);
        const l = this.level;
        if (l && l.endIn === null) {
          l.status = l.objective.update(this.levelContext(), this.stepper.dt);
          // Keep flying briefly so the player sees the moment, then show the result.
          if (l.status.state !== 'running') l.endIn = l.status.state === 'passed' && !session.result ? 1.2 : 1.6;
        }
      }
      this.handleEvents(session);
      if (this.level) this.updateLevel(this.level, dt);
      this.touch.sync(this.input.controls.collective);
    } else if (this.state === 'menu') {
      // Slow orbit of the scenery behind the menu.
      session.state.yaw += dt * 0.05;
    }

    const s = session.state;
    this.renderer.render(s, this.input.controls, { yaw: this.input.lookYaw, pitch: this.input.lookPitch }, this.state === 'paused' ? 0 : dt, session.tipOver);

    if (this.state === 'flying' || this.state === 'results') {
      const target = this.targetIndex === null ? null : this.world.areas[this.targetIndex];
      const guidance = target && computeGuidance(s, target, session.wind);
      const engineOut = !s.engineRunning;
      this.lowGTimer = Math.max(0, this.lowGTimer - dt);
      const l = this.level;
      const hint = !l && !this.free && this.saved.settings.hints && this.state === 'flying' ? contextualHint(session, guidance, this.input.mode) : null;
      const lesson =
        l && this.state === 'flying'
          ? { title: `${l.def.label} · ${l.def.title}`, text: l.status.text, progress: l.status.progress }
          : this.free && this.state === 'flying' && s.time < 8
            ? { title: 'Fly around', text: 'The engine will not fail. Explore, land anywhere and take off again.', progress: null }
            : null;
      this.hud.setLesson(lesson);
      this.hud.update(
        { state: s, engineOut, target, guidance, windKt: session.config.windKt, windFromDeg: session.config.windFromDeg, hint, lowG: this.lowGTimer > 0 },
        dt,
      );
      this.audio.update(s.rpmPct, engineOut && s.rpmPct < RPM.lowWarn && session.phase === 'autorotation', now / 1000);
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
          if (this.free) this.finishFreeFlight(session);
          else if (!this.level) this.finish(session);
          break;
      }
    }
  }

  private updateLevel(l: ActiveLevel, dt: number) {
    this.renderer.setGates(l.def.gates, l.status.nextGate ?? 0);
    if (l.endIn === null) return;
    l.endIn -= dt;
    if (l.endIn > 0) return;
    if (l.status.state === 'passed') {
      this.saved.training[l.def.id] = Math.max(this.saved.training[l.def.id] ?? 0, l.status.stars);
      save(this.saved);
    }
    this.state = 'results';
    this.touch.setVisible(false);
    this.screens.showLevelResult(l.def, l.status, l.index + 1 < LEVELS.length);
  }

  private finishFreeFlight(session: FlightSession) {
    this.state = 'results';
    this.touch.setVisible(false);
    setTimeout(() => {
      if (this.state === 'results') this.screens.showFreeFlightCrash(session.crashReason);
    }, 700);
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
