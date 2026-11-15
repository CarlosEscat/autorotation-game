import { ALL_LEVELS } from './levels';
import { Logbook, totalSeconds } from './logbook';

/** Best stars per level id, as kept in the save. */
export type Stars = Record<string, number>;

/** A rating is a stamp for what the pilot is qualified to do: earned by passing its levels. */
export type RatingId = 'emergency' | 'heavy' | 'firefighter';

export interface RatingDef {
  id: RatingId;
  title: string;
  earnedBy: string;
  levels: string[];
}

export const RATINGS: RatingDef[] = [
  { id: 'emergency', title: 'Emergency', earnedBy: 'Pass the Checkride', levels: ['checkride'] },
  { id: 'heavy', title: 'Heavy', earnedBy: 'Pass the Conversion flight', levels: ['conversion'] },
  { id: 'firefighter', title: 'Firefighter', earnedBy: 'Pass both fire missions', levels: ['firstfire', 'forestfire'] },
];

/** A rank is how experienced the pilot is: earned in order, by meeting every requirement of the rank. */
export type RankId = 'student' | 'private' | 'commercial' | 'captain';

export const RANK_ORDER: RankId[] = ['student', 'private', 'commercial', 'captain'];

export const RANK_TITLES: Record<RankId, string> = {
  student: 'Student Pilot',
  private: 'Private Pilot',
  commercial: 'Commercial Pilot',
  captain: 'Captain',
};

/** One line of a rank's checklist. `flag` is met or not; `count` and `time` (seconds) fill up. */
export interface Requirement {
  id: string;
  label: string;
  have: number;
  need: number;
  met: boolean;
  kind: 'count' | 'time' | 'flag';
}

export const MAX_STARS = ALL_LEVELS.length * 3;

const passed = (stars: Stars, id: string) => (stars[id] ?? 0) > 0;

export const totalStars = (stars: Stars) => ALL_LEVELS.reduce((t, l) => t + Math.max(0, Math.min(3, stars[l.id] ?? 0)), 0);

export const ratingsHeld = (stars: Stars): RatingId[] => RATINGS.filter((r) => r.levels.every((id) => passed(stars, id))).map((r) => r.id);

/** "12 min" below one hour, otherwise "1.5 h". Rounded down, so a requirement never reads as met early. */
export function formatFlightTime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 360) / 10} h`;
}

/** What each rank asks for. Tune the numbers here. */
const RANK_NEEDS: Record<RankId, { beginner?: true; rating?: RatingId; ratings?: number; stars?: number; seconds?: number; landings?: number }> = {
  student: {},
  private: { beginner: true, stars: 10, seconds: 15 * 60 },
  commercial: { rating: 'emergency', stars: 35, seconds: 1.5 * 3600, landings: 40 },
  captain: { ratings: 3, stars: 60, seconds: 5 * 3600, landings: 150 },
};

export function requirementsFor(rank: RankId, stars: Stars, book: Logbook): Requirement[] {
  const n = RANK_NEEDS[rank];
  const out: Requirement[] = [];
  const add = (id: string, label: string, kind: Requirement['kind'], have: number, need: number) => out.push({ id, label, kind, have, need, met: have >= need });
  const held = ratingsHeld(stars);
  if (n.beginner) add('beginner', 'All Beginner lessons', 'flag', ALL_LEVELS.filter((l) => l.tier === 'beginner').every((l) => passed(stars, l.id)) ? 1 : 0, 1);
  if (n.rating) add(`rating-${n.rating}`, `${RATINGS.find((r) => r.id === n.rating)!.title} rating`, 'flag', held.includes(n.rating) ? 1 : 0, 1);
  if (n.ratings) add('ratings', 'All three ratings', 'count', held.length, n.ratings);
  if (n.stars) add('stars', `${n.stars} stars`, 'count', totalStars(stars), n.stars);
  if (n.seconds) add('time', `${formatFlightTime(n.seconds)} flown`, 'time', totalSeconds(book), n.seconds);
  if (n.landings) add('landings', `${n.landings} landings`, 'count', book.landings, n.landings);
  return out;
}

/** Highest rank whose requirements, and those of every rank below it, are all met. */
export function earnedRank(stars: Stars, book: Logbook): RankId {
  let rank: RankId = 'student';
  for (const r of RANK_ORDER) {
    if (!requirementsFor(r, stars, book).every((q) => q.met)) break;
    rank = r;
  }
  return rank;
}

export const nextRank = (rank: RankId): RankId | null => RANK_ORDER[RANK_ORDER.indexOf(rank) + 1] ?? null;
