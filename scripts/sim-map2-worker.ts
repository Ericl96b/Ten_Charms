// Plays one share of the Map 2 simulation on its own thread.
import { parentPort } from 'node:worker_threads';
import { decide } from '../src/bots/profiles.ts';
import { createGame, nextRound, step } from '../src/engine/game.ts';
import { observe } from '../src/engine/observation.ts';
import { PHASES } from '../src/engine/phases.ts';
import { createRng } from '../src/engine/rng.ts';
import type { GroupReq } from '../src/engine/types.ts';

const seedOf = (base: number, i: number) => (base * 1000003 + i).toString(16).padStart(32, '0');
const MAX_ACTIONS_PER_ROUND = 6000;

export type Job =
  /**
   * Single rounds at a table of four Professor Hoots. Seat 0 attempts the phase being measured; the others play
   * a fixed mix of classic phases, so how long rounds last doesn't depend on the phase being measured.
   */
  | { kind: 'phase'; id: number; reqs: GroupReq[]; from: number; to: number; seedBase: number }
  /** Whole matches with four Professor Hoots, over a given Moonlit list, or the classic list if there is none. */
  | { kind: 'matches'; list: GroupReq[][] | null; from: number; to: number; seedBase: number };

export type Result =
  | { kind: 'phase'; attempts: number; completions: number; stalled: number }
  | { kind: 'matches'; rounds: number; matches: number; stalled: number };

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
  parentPort!.postMessage(job.kind === 'phase' ? runPhase(job) : runMatches(job));
});
