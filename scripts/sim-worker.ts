// Plays one share of the simulation on its own thread.
import { parentPort } from 'node:worker_threads';
import type { BotId } from '../src/bots/profiles.ts';
import type { Variant } from '../src/engine/types.ts';
import { headToHeadRange, playMatch } from '../src/sim/driver.ts';

export type StressMatch = { lineup: BotId[]; seed: string };
export type Job =
  | { kind: 'stress'; group: number; variant: Variant; matches: StressMatch[] }
  | { kind: 'ladder'; group: number; a: BotId; b: BotId; from: number; to: number; seedBase: number };
export type Tally = { crashes: number; illegal: number; stalled: number; rounds: number; turns: number; reshuffles: number };
export type Result =
  | { kind: 'stress'; group: number; tally: Tally }
  | { kind: 'ladder'; group: number; wins: number; rounds: number };

function runStress(job: Extract<Job, { kind: 'stress' }>): Tally {
  const tally: Tally = { crashes: 0, illegal: 0, stalled: 0, rounds: 0, turns: 0, reshuffles: 0 };
  for (const { lineup, seed } of job.matches) {
    try {
      const out = playMatch(lineup, seed, job.variant);
      if (out.illegal.length > 0) { tally.illegal++; console.error(out.illegal); }
      if (out.stalled) { tally.stalled++; console.error('stalled', lineup, seed, job.variant); }
      tally.rounds += out.rounds; tally.turns += out.turns; tally.reshuffles += out.reshuffles;
    } catch (err) {
      tally.crashes++;
      console.error(err);
    }
  }
  return tally;
}

parentPort!.on('message', (job: Job) => {
  const result: Result = job.kind === 'stress'
    ? { kind: 'stress', group: job.group, tally: runStress(job) }
    : { kind: 'ladder', group: job.group, ...headToHeadRange(job.a, job.b, job.from, job.to, job.seedBase) };
  parentPort!.postMessage(result);
});
