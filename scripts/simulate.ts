// Headless simulation: writes SIMULATION.md.
// Usage: node scripts/simulate.ts [matchesPerCount] [matchesPerPairing] [--workers=N] [--out=file] [--no-cache] [--cache-dir=dir] [--smoke]
// Every lineup and seed is drawn here, in a fixed order, so the number of workers can't change the results.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { BOT_IDS, type BotId } from '../src/bots/profiles.ts';
import { createRng } from '../src/engine/rng.ts';
import type { Variant } from '../src/engine/types.ts';
import type { Job, Result, StressMatch, Tally } from './sim-worker.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const [countArg, pairArg] = args.filter((a) => !a.startsWith('--'));
/** A quick check while iterating. It never touches SIMULATION.md, and its numbers aren't final. */
const smoke = args.includes('--smoke');
const perCount = Number(countArg ?? (smoke ? 40 : 2000));
const perPair = Number(pairArg ?? (smoke ? 40 : 2000));
const workerCount = Number(flag('workers') ?? Math.max(1, availableParallelism() - 2));
const outFile = flag('out') ?? (smoke ? 'test-results/sim-smoke.md' : 'SIMULATION.md');
const useCache = !args.includes('--no-cache') && !smoke;
const cacheDir = flag('cache-dir') ?? 'test-results/sim-cache';
const SHARE = 50;

/** Hashes every file this simulation really imports, found by esbuild, so a new dependency can't be missed. */
async function cacheKey(): Promise<string> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { metafile } = await build({
    absWorkingDir: root,
    entryPoints: ['scripts/simulate.ts', 'scripts/sim-worker.ts'],
    bundle: true, write: false, metafile: true, packages: 'external', platform: 'node', format: 'esm', outdir: 'unused', logLevel: 'silent',
  });
  const hash = createHash('sha256').update(JSON.stringify({ perCount, perPair, node: process.versions.node.split('.')[0] }));
  for (const file of Object.keys(metafile.inputs).sort()) hash.update(file).update(readFileSync(join(root, file)));
  return hash.digest('hex');
}

const cacheFile = useCache ? join(cacheDir, `${await cacheKey()}.json`) : null;
if (cacheFile && existsSync(cacheFile)) {
  const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { report: string; problems: number };
  writeFileSync(outFile, cached.report);
  console.log(`Cache hit: nothing that affects the results has changed. ${cached.problems} problems`);
  process.exit(cached.problems > 0 ? 1 : 0);
}

const rng = createRng('600d'.repeat(8));
const t0 = Date.now();

type StressGroup = { variant: Variant; players: number; n: number };
const stressGroups: StressGroup[] = [];
const jobs: Job[] = [];
for (const variant of ['standard', 'sprint', 'choose'] as Variant[]) {
  for (let players = 2; players <= 6; players++) {
    const n = variant === 'standard' ? perCount : Math.ceil(perCount / 4);
    const group = stressGroups.push({ variant, players, n }) - 1;
    const matches: StressMatch[] = [];
    for (let i = 0; i < n; i++) {
      const lineup: BotId[] = Array.from({ length: players }, () => BOT_IDS[rng.below(5)]);
      const seed = [rng.next(), rng.next(), rng.next(), rng.next()].map((v) => v.toString(16).padStart(8, '0')).join('');
      matches.push({ lineup, seed });
    }
    for (let i = 0; i < n; i += SHARE) jobs.push({ kind: 'stress', group, variant, matches: matches.slice(i, i + SHARE) });
  }
}

const ladder: [BotId, BotId, number][] = [['marigold', 'pip', 60], ['briar', 'marigold', 55], ['hoot', 'briar', 55], ['nightshade', 'hoot', 60]];
ladder.forEach(([a, b], group) => {
  for (let from = 0; from < perPair; from += SHARE) jobs.push({ kind: 'ladder', group, a, b, from, to: Math.min(from + SHARE, perPair), seedBase: 21 });
});

const stress: Tally[] = stressGroups.map(() => ({ crashes: 0, illegal: 0, stalled: 0, rounds: 0, turns: 0, reshuffles: 0 }));
const pairs = ladder.map(() => ({ wins: 0, rounds: 0 }));

function record(r: Result): void {
  if (r.kind === 'stress') {
    const into = stress[r.group];
    for (const key of Object.keys(into) as (keyof Tally)[]) into[key] += r.tally[key];
  } else {
    pairs[r.group].wins += r.wins;
    pairs[r.group].rounds += r.rounds;
  }
}

/** Each worker takes the next job as it finishes one. Only sums come back, so the order they finish in doesn't matter. */
function runAll(): Promise<void> {
  let next = 0;
  return Promise.all(Array.from({ length: workerCount }, () => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./sim-worker.ts', import.meta.url));
    const give = (): void => {
      if (next < jobs.length) worker.postMessage(jobs[next++]);
      else void worker.terminate().then(() => resolve());
    };
    worker.on('message', (r: Result) => { record(r); give(); });
    worker.on('error', reject);
    give();
  }))).then(() => undefined);
}

await runAll();

const lines: string[] = [];
if (smoke) lines.push('**Smoke run with a small sample. These are not final numbers.**', '');
lines.push('# Simulation report', '', 'Generated by `npm run sim`. Bots see the game only through `observe()`.', '');
lines.push('## Stress test', '', `Random lineups (a lineup of 6 must repeat a bot). Standard runs ${perCount} matches per player count; the variants run a quarter of that.`, '');
lines.push('| Variant | Players | Matches | Crashes | Illegal moves | Stalled | Avg rounds | Avg turns | Reshuffles per match |', '|---|---|---|---|---|---|---|---|---|');
let problems = 0;
let total = 0;
stressGroups.forEach(({ variant, players, n }, i) => {
  const { crashes, illegal, stalled, rounds, turns, reshuffles } = stress[i];
  total += n;
  problems += crashes + illegal + stalled;
  lines.push(`| ${variant} | ${players} | ${n} | ${crashes} | ${illegal} | ${stalled} | ${(rounds / n).toFixed(1)} | ${(turns / n).toFixed(0)} | ${(reshuffles / n).toFixed(2)} |`);
});
lines.push('', `Total: ${total} matches, ${problems} problems.`, '');

lines.push('## Difficulty ladder', '', `${perPair} two-player full matches per pairing, swapping seats each match. Shared wins count half.`, '');
lines.push('| Pairing | Target | Actual | Met | Avg rounds |', '|---|---|---|---|---|');
ladder.forEach(([a, b, goal], i) => {
  const pct = (pairs[i].wins / perPair) * 100;
  lines.push(`| ${a} beats ${b} | ${goal}% | ${pct.toFixed(1)}% | ${pct >= goal ? 'Yes' : 'No'} | ${(pairs[i].rounds / perPair).toFixed(1)} |`);
  console.log(`${a} vs ${b}: ${pct.toFixed(1)}%`);
});
lines.push('', '## Fairness', '', 'The fairness tests are in `tests/unit/fairness.test.ts` and run with `npm run test:unit`. They check that:', '');
lines.push('- bot modules cannot reach the game state, shuffler, or seed through any import;', '- bot source never names hidden state;', '- an observation contains no hidden card or seed, and is a copy;', '- rearranging every hidden card and changing the seeds changes neither the observation nor any decision.', '');
const report = lines.join('\n');
writeFileSync(outFile, report);
if (cacheFile) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ report, problems }));
}
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)} s with ${workerCount} workers, ${problems} problems`);
process.exit(problems > 0 ? 1 : 0);
