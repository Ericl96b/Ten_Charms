// The Tower: tiers, Guardians, each floor's draw, and the climb. Pure logic over the save data; no presentation.
// Bots never read any of this: a floor's phases and lineup reach them only as public match state.
import type { BotId } from '../bots/profiles.ts';
import { BOTS, TOWER_HEARTS, TOWER_LADDER, TOWER_SKIES, type TowerTier } from '../content.ts';
import { TOWER_ORDER, TOWER_POOL } from '../engine/phases.ts';
import { createRng, newSeed, shuffle } from '../engine/rng.ts';
import type { MatchRules } from '../engine/types.ts';
import type { SaveData, TowerAttempt, TowerClimb, TowerRun } from './save.ts';

/** The stream of the floor draw, apart from every other use of a seed. */
const DRAW_NONCE = 0x746f7772;
export const FLOOR_PHASES = 3;
/** The easier half of the pool, for a Guardian floor tuned to it (§8.5 4.4). */
export const EASY_HALF = Math.ceil(TOWER_POOL.length / 2);

export function tierOf(floor: number): number {
  return Math.ceil(floor / 10);
}

export function isGuardianFloor(floor: number): boolean {
  return floor % 10 === 0;
}

/** Odd tiers' Guardian is Nightshade, even tiers' Lunaria. */
export function guardianOf(floor: number): BotId {
  return tierOf(floor) % 2 === 1 ? 'nightshade' : 'lunaria';
}

export function tierSetup(tier: number, ladder: readonly TowerTier[] = TOWER_LADDER): TowerTier {
  return ladder[Math.min(tier, ladder.length) - 1];
}

/** The sky band's name: Tier 1 and 6 Rose Dawn, Tier 2 and 7 Peach Noon, and so on. */
export function skyName(tier: number): (typeof TOWER_SKIES)[number] {
  return TOWER_SKIES[(tier - 1) % TOWER_SKIES.length];
}

/** Sorts phases easiest first, by the measured order. */
export function easiestFirst(phases: readonly number[]): number[] {
  return phases.slice().sort((a, b) => TOWER_ORDER.indexOf(a) - TOWER_ORDER.indexOf(b));
}

/**
 * One attempt at a floor: three different phases drawn uniformly from the pool, easiest first, and the opponents,
 * all fixed by the seed. Everyone at the table plays the same list, and all of it is shown before the match.
 */
export function drawAttempt(seed: string, floor: number, ladder: readonly TowerTier[] = TOWER_LADDER): TowerAttempt {
  const rng = createRng(seed, DRAW_NONCE);
  const tier = tierOf(floor);
  const setup = tierSetup(tier, ladder);
  const guardian = isGuardianFloor(floor) ? guardianOf(floor) : null;
  const pool = guardian && setup.guardian.easyPhases ? TOWER_ORDER.slice(0, EASY_HALF) : TOWER_POOL;
  const phases = easiestFirst(shuffle(pool.slice(), rng).slice(0, FLOOR_PHASES));
  let lineup: BotId[];
  if (guardian) {
    const from = setup.guardian.from === 'previous' && tier > 1 ? tierSetup(tier - 1, ladder) : setup;
    const companions = shuffle(from.pool.slice(), rng).slice(0, setup.guardian.companions);
    lineup = shuffle([guardian, ...companions], rng);
  } else {
    lineup = shuffle(setup.pool.slice(), rng).slice(0, setup.opponents);
  }
  return { seed, phases, lineup, guardian };
}

/** The table rules of a floor: fog where its tier has it (the Tower never lifts it), and the Guardian's crown. */
export function floorRules(floor: number, attempt: TowerAttempt, ladder: readonly TowerTier[] = TOWER_LADDER): MatchRules {
  const rules: MatchRules = {};
  if (tierSetup(tierOf(floor), ladder).fog) rules.fog = true;
  if (attempt.guardian) {
    rules.crownSeat = attempt.lineup.indexOf(attempt.guardian) + 1;
    rules.crownName = BOTS[attempt.guardian].name;
  }
  return rules;
}

/* ---------- The climb (§3) ---------- */

export const HISTORY_KEPT = 50;

export function freshRun(): TowerRun {
  return { floorsCleared: 0, phasesCompleted: 0, guardiansBeaten: 0 };
}

/** Starts a climb on floor 1 with three hearts. Only one climb at a time. */
export function startClimb(save: SaveData): TowerClimb {
  if (save.tower.climb) throw new Error('A climb is already under way.');
  save.tower.climb = { floor: 1, hearts: TOWER_HEARTS, run: freshRun(), attempt: null };
  return save.tower.climb;
}

/**
 * The current attempt's draw, drawing it now if there isn't one. Saved before the floor intro shows it, so a reload
 * never draws again.
 */
export function currentAttempt(save: SaveData, seed: string = newSeed()): TowerAttempt {
  const climb = save.tower.climb;
  if (!climb) throw new Error('No climb is under way.');
  if (!climb.attempt) climb.attempt = drawAttempt(seed, climb.floor);
  return climb.attempt;
}

export type ClimbEnd = { floor: number; oldBest: number; newBest: boolean; run: TowerRun };

/** Ends the climb where it stands: on running out of hearts, or by her choice. Her best floor is kept. */
export function endClimb(save: SaveData, now: number = Date.now()): ClimbEnd {
  const t = save.tower;
  const climb = t.climb;
  if (!climb) throw new Error('No climb is under way.');
  const oldBest = t.best;
  const newBest = climb.floor > oldBest;
  if (newBest) t.best = climb.floor;
  t.history.unshift({ floor: climb.floor, endedAt: now, newBest });
  t.history.length = Math.min(t.history.length, HISTORY_KEPT);
  t.totals.climbs++;
  t.climb = null;
  // A floor in progress is abandoned with the climb.
  if (save.match?.mode.kind === 'tower') save.match = null;
  return { floor: climb.floor, oldBest, newBest, run: { ...climb.run } };
}

export type FloorOutcome = {
  won: boolean;
  floor: number;
  guardian: boolean;
  heartsBefore: number;
  heartsAfter: number;
  /** A Guardian win below three hearts gave one back. */
  heartBack: boolean;
  /** Set when the last heart went: the climb is over. */
  end: ClimbEnd | null;
};

/**
 * Records one attempt's result. A win climbs one floor (a Guardian win also gives a heart back, up to three); any
 * other result, a forfeit included, costs a heart and keeps the floor, to be retried with a fresh draw.
 */
export function floorResult(save: SaveData, won: boolean, now: number = Date.now()): FloorOutcome {
  const climb = save.tower.climb;
  if (!climb) throw new Error('No climb is under way.');
  const floor = climb.floor;
  const guardian = isGuardianFloor(floor);
  const heartsBefore = climb.hearts;
  let heartBack = false;
  climb.attempt = null;
  if (won) {
    climb.run.floorsCleared++;
    save.tower.totals.floorsCleared++;
    if (guardian) {
      climb.run.guardiansBeaten++;
      save.tower.totals.guardiansBeaten++;
      heartBack = climb.hearts < TOWER_HEARTS;
      climb.hearts = Math.min(TOWER_HEARTS, climb.hearts + 1);
    }
    climb.floor++;
    return { won, floor, guardian, heartsBefore, heartsAfter: climb.hearts, heartBack, end: null };
  }
  climb.hearts--;
  const heartsAfter = climb.hearts;
  const end = heartsAfter <= 0 ? endClimb(save, now) : null;
  return { won, floor, guardian, heartsBefore, heartsAfter, heartBack, end };
}
