import { AircraftId } from '../sim/aircraft';
import { FlightSession } from './session';

/** A pilot's career totals. Every flight, in Training and in Free flight, adds to them. */
export interface Logbook {
  /** Seconds in the air, per helicopter type. Time on the ground does not count. */
  airSeconds: Record<AircraftId, number>;
  flights: number;
  landings: number;
  crashes: number;
  firesOut: number;
}

/** A flight counts once it has this much air time; a landing counts after this long in the air. */
export const MIN_AIRBORNE_S = 10;
const EPS = 1e-6;

export const emptyLogbook = (): Logbook => ({ airSeconds: { light: 0, heavy: 0 }, flights: 0, landings: 0, crashes: 0, firesOut: 0 });

export const totalSeconds = (b: Logbook) => b.airSeconds.light + b.airSeconds.heavy;

/** What the logbook needs to know about one simulation step. */
export interface FlightSample {
  aircraft: AircraftId;
  airborne: boolean;
  crashed: boolean;
  fireOut: boolean;
}

export function sampleOf(session: FlightSession): FlightSample {
  return {
    aircraft: session.config.aircraft ?? 'light',
    // On the ground is what the session says it is (touched down, or resting on the skids), never a height:
    // a helicopter about to hit the ground is still flying, and what follows is a crash, not a landing.
    airborne: session.phase !== 'ground' && session.phase !== 'done' && !session.onSkids,
    crashed: session.crashed,
    fireOut: session.fire?.out ?? false,
  };
}

/** Watches one flight and adds it to the logbook as it happens. Make a new one for every flight. */
export class LogRecorder {
  /** Air time of this flight, and of the stretch since the helicopter last left the ground. */
  private airTime = 0;
  private airRun = 0;
  private flightCounted = false;
  private crashCounted = false;
  private fireCounted = false;

  constructor(private book: Logbook) {}

  step(s: FlightSample, dt: number) {
    const b = this.book;
    if (s.crashed && !this.crashCounted) {
      this.crashCounted = true;
      b.crashes++;
    }
    if (s.fireOut && !this.fireCounted) {
      this.fireCounted = true;
      b.firesOut++;
    }
    if (s.airborne) {
      b.airSeconds[s.aircraft] += dt;
      this.airTime += dt;
      this.airRun += dt;
      if (!this.flightCounted && this.airTime >= MIN_AIRBORNE_S - EPS) {
        this.flightCounted = true;
        b.flights++;
      }
    } else {
      // Back on the ground: a landing, unless it was a crash or only a hop.
      if (!s.crashed && this.airRun >= MIN_AIRBORNE_S - EPS) b.landings++;
      this.airRun = 0;
    }
  }
}
