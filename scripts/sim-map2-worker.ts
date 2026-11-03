// Plays one share of the Map 2 simulation on its own thread.
import { parentPort } from 'node:worker_threads';
import { decide } from '../src/bots/profiles.ts';
import { createGame, nextRound, step } from '../src/engine/game.ts';
import { observe } from '../src/engine/observation.ts';
import { PHASES } from '../src/engine/phases.ts';
import { createRng } from '../src/engine/rng.ts';
import type { BotId } from '../src/bots/profiles.ts';
import type { GroupReq, MatchRules } from '../src/engine/types.ts';
import { playMatch } from '../src/sim/driver.ts';

const seedOf = (base: number, i: number) => (base * 1000003 + i).toString(16).padStart(32, '0');
const MAX_ACTIONS_PER_ROUND = 6000;

export type Job =
  /**
   * Single rounds at a table of four Professor Hoots. Seat 0 attempts the phase being measured; the others play
   * a fixed mix of classic phases, so how long rounds last doesn't depend on the phase being measured.
   */
  | { kind: 'phase'; id: number; reqs: GroupReq[]; from: number; to: number; seedBase: number }
  /** Whole matches with four Professor Hoots, over a given Moonlit list, or the classic list if there is none. */
  | { kind: 'matches'; list: GroupReq[][] | null; from: number; to: number; seedBase: number }
  /** A Glade stop's exact lineup, with Professor Hoot in the human's seat. */
  | { kind: 'stop'; lineup: BotId[]; rules: MatchRules; from: number; to: number; seedBase: number }
  /** Bot-only Moonlit matches with the given lineups, checking only that every one finishes legally. */
  | { kind: 'stress'; group: number; matches: { lineup: BotId[]; seed: string }[] };

export type Result =
  | { kind: 'phase'; attempts: number; completions: number; stalled: number }
  | { kind: 'matches'; rounds: number; matches: number; stalled: number }
  /** `winRounds` lists the length of each match the human's seat won. */
  | { kind: 'stop'; matches: number; wins: number; winRounds: number[]; stalled: number; illegal: number }
  | { kind: 'stress'; group: number; matches: number; crashes: number; illegal: number; stalled: number; rounds: number };

function runStress(job: Extract<Job, { kind: 'stress' }>): Result {
  let crashes = 0, illegal = 0, stalled = 0, rounds = 0;
  for (const { lineup, seed } of job.matches) {
    try {
      const out = playMatch(lineup, seed, 'moonlit');
      if (out.illegal.length > 0) { illegal++; console.error(out.illegal); }
      if (out.stalled) { stalled++; console.error('stalled', lineup, seed); }
      rounds += out.rounds;
    } catch (err) {
      crashes++;
      console.error(err);
    }
  }
  return { kind: 'stress', group: job.group, matches: job.matches.length, crashes, illegal, stalled, rounds };
}

function runStop(job: Extract<Job, { kind: 'stop' }>): Result {
  let wins = 0, stalled = 0, illegal = 0;
  const winRounds: number[] = [];
  for (let i = job.from; i < job.to; i++) {
    const out = playMatch(job.lineup, seedOf(job.seedBase, i), 'moonlit', job.rules);
    if (out.illegal.length > 0) { illegal++; console.error(out.illegal); continue; }
    if (out.stalled) { stalled++; continue; }
    if (out.winners.includes(0)) { wins++; winRounds.push(out.rounds); }
  }
  return { kind: 'stop', matches: job.to - job.from, wins, winRounds, stalled, illegal };
}

function dice(seed: string): () => number {
  const rng = createRng(seed, 0x626f74);
  return () => rng.next() / 0x100000000;
}

function runPhase(job: Extract<Job, { kind: 'phase' }>): Result {
  PHASES[job.id] = job.reqs;
  let attempts = 0, completions = 0, stalled = 0;
  for (let i = job.from; i < job.to; i++) {
    const seed = seedOf(job.seedBase, i);
    const { state } = createGame({ playerCount: 4, seed });
    state.players.forEach((p, seat) => { p.phase = seat === 0 ? job.id : 1 + ((i * 3 + seat) % 10); });
    const rand = dice(seed);
    let actions = 0;
    while (state.stage === 'draw' || state.stage === 'play') {
      if (++actions > MAX_ACTIONS_PER_ROUND) break;
      const result = step(state, decide('hoot', observe(state, state.current), rand));
      if (!result.ok) throw new Error(`Illegal move: ${result.reason}`);
    }
    if (actions > MAX_ACTIONS_PER_ROUND) { stalled++; continue; }
    attempts++;
    if (state.lastRound!.advanced[0]) completions++;
  }
  return { kind: 'phase', attempts, completions, stalled };
}

function runMatches(job: Extract<Job, { kind: 'matches' }>): Result {
  job.list?.forEach((reqs, i) => { PHASES[11 + i] = reqs; });
  let rounds = 0, matches = 0, stalled = 0;
  for (let i = job.from; i < job.to; i++) {
    const seed = seedOf(job.seedBase, i);
    const { state } = createGame({ playerCount: 4, variant: job.list ? 'moonlit' : 'standard', seed });
    const rand = dice(seed);
    let actions = 0;
    let bad = false;
    while (state.stage !== 'matchOver') {
      if (state.stage === 'roundOver') { actions = 0; nextRound(state); continue; }
      if (++actions > MAX_ACTIONS_PER_ROUND || state.round > 400) { bad = true; break; }
      const result = step(state, decide('hoot', observe(state, state.current), rand));
      if (!result.ok) throw new Error(`Illegal move: ${result.reason}`);
    }
    if (bad) { stalled++; continue; }
    rounds += state.round;
    matches++;
  }
  return { kind: 'matches', rounds, matches, stalled };
}

parentPort!.on('message', (job: Job) => {
  const result = job.kind === 'phase' ? runPhase(job) : job.kind === 'stop' ? runStop(job) : job.kind === 'stress' ? runStress(job) : runMatches(job);
  parentPort!.postMessage(result);
});
