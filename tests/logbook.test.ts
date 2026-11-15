import { describe, expect, it } from 'vitest';
import { FlightSample, LogRecorder, emptyLogbook, sampleOf, totalSeconds } from '../src/game/logbook';
import { DEFAULT_CONFIG, FlightSession } from '../src/game/session';
import { createWorld } from '../src/world/world';

const air: FlightSample = { aircraft: 'light', airborne: true, crashed: false, fireOut: false };
const ground: FlightSample = { ...air, airborne: false };
const run = (r: LogRecorder, s: FlightSample, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) r.step(s, 0.1);
};

describe('logbook', () => {
  it('counts only airborne time, per helicopter', () => {
    const b = emptyLogbook();
    const r = new LogRecorder(b);
    run(r, air, 30);
    run(r, ground, 60);
    run(r, { ...air, aircraft: 'heavy' }, 5);
    expect(b.airSeconds.light).toBeCloseTo(30);
    expect(b.airSeconds.heavy).toBeCloseTo(5);
    expect(totalSeconds(b)).toBeCloseTo(35);
  });

  it('counts a flight once, after 10 s airborne', () => {
    const b = emptyLogbook();
    const r = new LogRecorder(b);
    run(r, air, 9);
    expect(b.flights).toBe(0);
    run(r, air, 2);
    run(r, ground, 1);
    run(r, air, 20);
    expect(b.flights).toBe(1);
  });

  it('counts a landing only after 10 s in the air', () => {
    const b = emptyLogbook();
    const r = new LogRecorder(b);
    run(r, air, 12);
    run(r, ground, 1);
    expect(b.landings).toBe(1);
    run(r, air, 3);
    run(r, ground, 1);
    expect(b.landings).toBe(1); // a hop
    run(r, air, 11);
    run(r, ground, 1);
    expect(b.landings).toBe(2);
  });

  it('a crash is a crash, not a landing, and counts once', () => {
    const b = emptyLogbook();
    const r = new LogRecorder(b);
    run(r, air, 15);
    run(r, { ...ground, crashed: true }, 3);
    expect(b.crashes).toBe(1);
    expect(b.landings).toBe(0);
  });

  it('counts a fire once when it goes out', () => {
    const b = emptyLogbook();
    const r = new LogRecorder(b);
    run(r, air, 5);
    run(r, { ...air, fireOut: true }, 5);
    expect(b.firesOut).toBe(1);
  });

  it('a flight that starts on the ground logs nothing until it lifts off', () => {
    const b = emptyLogbook();
    const r = new LogRecorder(b);
    run(r, ground, 30);
    expect(b).toEqual(emptyLogbook());
  });

  it('sampleOf reads a real session: airborne at the start of a free flight', () => {
    const s = new FlightSession(createWorld(), { ...DEFAULT_CONFIG, freeFlight: true });
    expect(sampleOf(s)).toEqual({ aircraft: 'light', airborne: true, crashed: false, fireOut: false });
  });

  it('two recorders on one book add up: a restarted flight keeps its time and counts each flight once', () => {
    const b = emptyLogbook();
    run(new LogRecorder(b), air, 20);
    run(new LogRecorder(b), air, 20);
    expect(totalSeconds(b)).toBeCloseTo(40);
    expect(b.flights).toBe(2);
    run(new LogRecorder(b), air, 4);
    expect(b.flights).toBe(2); // abandoned after 4 s
  });
});
