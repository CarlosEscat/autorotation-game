import { RANK_ORDER, RATINGS, RankId, RatingId, Stars, earnedRank, ratingsHeld } from './licence';
import { Logbook, emptyLogbook } from './logbook';

export const NAME_MAX = 20;
export const CALLSIGN_MAX = 12;
export const DEFAULT_NAME = 'Pilot';

/** The player's licence, as kept in the save. Ratings are not stored: they follow from the stars. */
export interface Pilot {
  /** '' until the player sets one. */
  name: string;
  callsign: string;
  logbook: Logbook;
  /** Highest rank reached. Never lowered, even if the requirements change. */
  rank: RankId;
  /** Rank and ratings the player has already been told about. */
  shownRank: RankId;
  shownRatings: RatingId[];
}

export const newPilot = (): Pilot => ({ name: '', callsign: '', logbook: emptyLogbook(), rank: 'student', shownRank: 'student', shownRatings: [] });

/** Trimmed, inner whitespace collapsed, at most `max` characters. */
export const cleanName = (s: string, max: number) => [...s.replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();

const count = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
const seconds = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
const rank = (x: unknown): RankId => (RANK_ORDER.includes(x as RankId) ? (x as RankId) : 'student');
const text = (x: unknown, max: number) => (typeof x === 'string' ? cleanName(x, max) : '');

/** Anything from storage in, a valid Pilot out. Never throws. */
export function normalizePilot(raw: unknown): Pilot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return newPilot();
  const r = raw as Record<string, unknown>;
  const lb = (r.logbook && typeof r.logbook === 'object' ? r.logbook : {}) as Record<string, unknown>;
  const air = (lb.airSeconds && typeof lb.airSeconds === 'object' ? lb.airSeconds : {}) as Record<string, unknown>;
  return {
    name: text(r.name, NAME_MAX),
    callsign: text(r.callsign, CALLSIGN_MAX),
    logbook: {
      airSeconds: { light: seconds(air.light), heavy: seconds(air.heavy) },
      nightSeconds: seconds(lb.nightSeconds),
      flights: count(lb.flights),
      landings: count(lb.landings),
      crashes: count(lb.crashes),
      firesOut: count(lb.firesOut),
    },
    rank: rank(r.rank),
    shownRank: rank(r.shownRank),
    shownRatings: Array.isArray(r.shownRatings) ? RATINGS.map((d) => d.id).filter((id) => (r.shownRatings as unknown[]).includes(id)) : [],
  };
}

/** Raises `pilot.rank` to what the stars and logbook now earn. Never lowers it. */
export function updateRank(pilot: Pilot, stars: Stars) {
  const earned = earnedRank(stars, pilot.logbook);
  if (RANK_ORDER.indexOf(earned) > RANK_ORDER.indexOf(pilot.rank)) pilot.rank = earned;
}

export interface Promotion {
  rank: RankId | null;
  ratings: RatingId[];
}

/** What the player has earned but not yet been told, or null. */
export function pendingPromotion(pilot: Pilot, stars: Stars): Promotion | null {
  const ratings = ratingsHeld(stars).filter((id) => !pilot.shownRatings.includes(id));
  const newRank = RANK_ORDER.indexOf(pilot.rank) > RANK_ORDER.indexOf(pilot.shownRank) ? pilot.rank : null;
  return newRank || ratings.length ? { rank: newRank, ratings } : null;
}

export function acknowledge(pilot: Pilot, stars: Stars) {
  pilot.shownRank = pilot.rank;
  pilot.shownRatings = [...new Set([...pilot.shownRatings, ...ratingsHeld(stars)])];
}
