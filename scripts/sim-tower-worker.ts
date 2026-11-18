// A worker for scripts/simulate-tower.ts. Plays Tower floors headlessly; bots see only observe().
import { parentPort } from 'node:worker_threads';
import { ALL_BOT_IDS, type BotId } from '../src/bots/profiles.ts';
import { TOWER_HEARTS, type TowerTier } from '../src/content.ts';
import { TOWER_POOL } from '../src/engine/phases.ts';
import { createRng, shuffle } from '../src/engine/rng.ts';
import type { MatchRules } from '../src/engine/types.ts';
import { drawAttempt, floorRules, isGuardianFloor, tierOf } from '../src/meta/tower.ts';
import { playMatch } from '../src/sim/driver.ts';

export type Job =
  /** Floors chosen from `floors` in turn, each with a fresh draw: her seat plays Hoot's profile. */
  | { kind: 'floors'; ladder: readonly TowerTier[]; floors: number[]; from: number; to: number; base: number }
  /** Hoot against one bot on random three-phase floors, two players, for ranking bot strength. */
  | { kind: 'strength'; bot: BotId; from: number; to: number; base: number }
  /** Bot-only floors at 2 to 4 players, random lists, fog and crown on and off. */
  | { kind: 'stress'; from: number; to: number; base: number }
  /** Whole climbs played floor by floor under the real heart rules. */
  | { kind: 'climbs'; ladder: readonly TowerTier[]; from: number; to: number; base: number };

export type FloorResult = { kind: 'floors'; played: number; wins: number; rounds: number[]; problems: string[] };
export type StrengthResult = { kind: 'strength'; played: number; wins: number };
export type StressResult = { kind: 'stress'; played: number; crashes: string[]; illegal: string[]; stalled: number; byPlayers: Record<number, number>; rounds: number };
export type ClimbResult = { kind: 'climbs'; reached: number[]; floorsPlayed: number; problems: string[] };
export type Result = FloorResult | StrengthResult | StressResult | ClimbResult;

const seedOf = (base: number, i: number) => (base * 1000003 + i).toString(16).padStart(32, '0');
/** Bots that may sit at a Tower table: everyone but Lunaria's wisps. */
const TABLE_BOTS = ALL_BOT_IDS.filter((b) => b !== 'puff' && b !== 'haze');

/** One attempt at a floor, as in the game: a fresh draw, her seat first, the floor's rules. */
function playFloor(floor: number, seed: string, ladder: readonly TowerTier[]) {
  const attempt = drawAttempt(seed, floor, ladder);
  const out = playMatch(['hoot', ...attempt.lineup], seed.split('').reverse().join(''), 'tower', floorRules(floor, attempt, ladder), attempt.phases);
  const problem = out.illegal.length > 0 ? out.illegal[0] : out.stalled ? `stalled at floor ${floor}, seed ${seed}` : null;
  // A shared win she is part of counts as winning the floor.
  return { won: out.winners.includes(0), rounds: out.rounds, problem };
}

function run(job: Job): Result {
  if (job.kind === 'floors') {
    let wins = 0;
    const rounds: number[] = [];
    const problems: string[] = [];
    for (let i = job.from; i < job.to; i++) {
      const r = playFloor(job.floors[i % job.floors.length], seedOf(job.base, i), job.ladder);
      if (r.won) wins++;
      rounds[r.rounds] = (rounds[r.rounds] ?? 0) + 1;
      if (r.problem) problems.push(r.problem);
    }
    return { kind: 'floors', played: job.to - job.from, wins, rounds: Array.from(rounds, (v) => v ?? 0), problems };
  }
  if (job.kind === 'strength') {
    let wins = 0;
    for (let i = job.from; i < job.to; i++) {
      const seed = seedOf(job.base, i);
      const rng = createRng(seed, 7);
      const phases = shuffle(TOWER_POOL.slice(), rng).slice(0, 3);
      const swap = i % 2 === 1;
      const out = playMatch(swap ? [job.bot, 'hoot'] : ['hoot', job.bot], seed, 'tower', undefined, phases);
      if (out.illegal.length || out.stalled) throw new Error(`bad strength floor ${seed}`);
      if (out.winners.includes(swap ? 1 : 0)) wins += out.winners.length > 1 ? 0.5 : 1;
    }
    return { kind: 'strength', played: job.to - job.from, wins };
  }
  if (job.kind === 'stress') {
    const crashes: string[] = [];
    const illegal: string[] = [];
    let stalled = 0;
    let rounds = 0;
    const byPlayers: Record<number, number> = {};
    for (let i = job.from; i < job.to; i++) {
      const seed = seedOf(job.base, i);
      const rng = createRng(seed, 11);
      const players = 2 + rng.below(3);
      const lineup = shuffle(TABLE_BOTS.slice(), rng).slice(0, players);
      const phases = shuffle(TOWER_POOL.slice(), rng).slice(0, 3);
      const rules: MatchRules = {};
      if (rng.below(2) === 1) rules.fog = true;
      if (rng.below(2) === 1) {
        const seat = rng.below(players);
        rules.crownSeat = seat;
        rules.crownName = 'Guardian';
      }
      byPlayers[players] = (byPlayers[players] ?? 0) + 1;
      try {
        const out = playMatch(lineup, seed, 'tower', rules, phases);
        rounds += out.rounds;
        if (out.illegal.length) illegal.push(`${seed}: ${out.illegal[0]}`);
        if (out.stalled) stalled++;
      } catch (e) {
        crashes.push(`${seed}: ${(e as Error).message}`);
      }
    }
    return { kind: 'stress', played: job.to - job.from, crashes, illegal, stalled, byPlayers, rounds };
  }
  const reached: number[] = [];
  const problems: string[] = [];
  let floorsPlayed = 0;
  for (let i = job.from; i < job.to; i++) {
    let floor = 1;
    let hearts = TOWER_HEARTS;
    let attempt = 0;
    while (hearts > 0 && floor < 400) {
      const r = playFloor(floor, seedOf(job.base + i, attempt++), job.ladder);
      floorsPlayed++;
      if (r.problem) problems.push(r.problem);
      if (r.won) {
        if (isGuardianFloor(floor)) hearts = Math.min(TOWER_HEARTS, hearts + 1);
        floor++;
      } else {
        hearts--;
      }
    }
    reached.push(floor);
  }
  void tierOf;
  return { kind: 'climbs', reached, floorsPlayed, problems };
}

parentPort?.on('message', (job: Job) => {
  try {
    parentPort!.postMessage({ ok: true, result: run(job) });
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: (e as Error).stack ?? String(e) });
  }
});
