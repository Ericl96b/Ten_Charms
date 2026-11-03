// The Map 2 phase simulation: writes SIMULATION_MAP2.md.
// Usage: node scripts/simulate-map2.ts [--smoke] [--no-cache] [--workers=N] [--out=file]
// Stages are written as M1 to M10 and C1 to C10 throughout, since the report is scanned like the rest of the project.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { PHASES, groupLabel, phaseSequence } from '../src/engine/phases.ts';
import type { GroupReq } from '../src/engine/types.ts';
import type { Job, Result } from './sim-map2-worker.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const smoke = args.includes('--smoke');
const ROUNDS_PER_PHASE = smoke ? 300 : 5000;
const MATCHES_PER_LIST = smoke ? 40 : 2000;
const workerCount = Number(flag('workers') ?? Math.max(1, availableParallelism() - 2));
const outFile = flag('out') ?? (smoke ? 'test-results/sim-map2-smoke.md' : 'SIMULATION_MAP2.md');
const useCache = !args.includes('--no-cache') && !smoke;
const cacheDir = 'test-results/sim-cache';
const SHARE = 50;

const set = (size: number): GroupReq => ({ type: 'set', size });
const run = (size: number): GroupReq => ({ type: 'run', size });
const color = (size: number): GroupReq => ({ type: 'color', size });
const colorRun = (size: number): GroupReq => ({ type: 'colorRun', size });
const evens = (size: number): GroupReq => ({ type: 'evens', size });
const odds = (size: number): GroupReq => ({ type: 'odds', size });
const pair = (): GroupReq => ({ type: 'set', size: 2, pair: true });

/** The draft from the spec, in its order. Draft numbers refer to this list. */
const DRAFT: GroupReq[][] = [
  [pair(), pair(), pair(), pair()],
  [run(4), pair(), pair()],
  [colorRun(3), set(3)],
  [evens(7)],
  [set(3), set(3), set(3)],
  [colorRun(4), run(4)],
  [odds(4), evens(4)],
  [set(4), color(4)],
  [colorRun(5), pair()],
  [colorRun(6)],
];

/** The only changes allowed, one at a time, in this order. */
const SUBSTITUTIONS: { index: number; reqs: GroupReq[] }[] = [
  { index: 9, reqs: [colorRun(5), pair()] },
  { index: 8, reqs: [colorRun(4), set(3)] },
  { index: 9, reqs: [colorRun(5)] },
];

/** Repeated groups are counted, as the game shows them. */
function reqsText(reqs: readonly GroupReq[]): string {
  const parts: string[] = [];
  for (let i = 0; i < reqs.length; i++) {
    let count = 1;
    while (i + 1 < reqs.length && groupLabel(reqs[i + 1]) === groupLabel(reqs[i])) { count++; i++; }
    const label = groupLabel(reqs[i]);
    parts.push(count === 1 ? label : reqs[i].pair ? `${count} Pairs` : `${count} ${label.replace(/^(Set|Run)/, '$1s')}`);
  }
  return parts.join(' + ');
}

async function cacheKey(): Promise<string> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { metafile } = await build({
    absWorkingDir: root,
    entryPoints: ['scripts/simulate-map2.ts', 'scripts/sim-map2-worker.ts'],
    bundle: true, write: false, metafile: true, packages: 'external', platform: 'node', format: 'esm', outdir: 'unused', logLevel: 'silent',
  });
  const hash = createHash('sha256').update(JSON.stringify({ ROUNDS_PER_PHASE, MATCHES_PER_LIST, node: process.versions.node.split('.')[0] }));
  for (const file of Object.keys(metafile.inputs).sort()) hash.update(file).update(readFileSync(join(root, file)));
  return hash.digest('hex');
}

const cacheFile = useCache ? join(cacheDir, `map2-${await cacheKey()}.json`) : null;
if (cacheFile && existsSync(cacheFile)) {
  writeFileSync(outFile, (JSON.parse(readFileSync(cacheFile, 'utf8')) as { report: string }).report);
  console.log('Cache hit: nothing that affects the results has changed.');
  process.exit(0);
}

/** Each worker takes the next job as it finishes one; results come back with the index of their job. */
function runAll(jobs: Job[], record: (r: Result, index: number) => void): Promise<void> {
  let next = 0;
  return Promise.all(Array.from({ length: workerCount }, () => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./sim-map2-worker.ts', import.meta.url));
    let mine = -1;
    const give = (): void => {
      if (next < jobs.length) { mine = next++; worker.postMessage(jobs[mine]); }
      else void worker.terminate().then(() => resolve());
    };
    worker.on('message', (r: Result) => { record(r, mine); give(); });
    worker.on('error', reject);
    give();
  }))).then(() => undefined);
}

type Measure = { mean: number; attempts: number; completions: number; stalled: number };

/** Mean rounds to complete each phase: rounds attempted per completion, in the fixed setup the worker plays. */
async function measure(items: { id: number; reqs: GroupReq[] }[], seedBase: number): Promise<Measure[]> {
  const totals = items.map(() => ({ attempts: 0, completions: 0, stalled: 0 }));
  const jobs: { job: Job; group: number }[] = [];
  items.forEach(({ id, reqs }, group) => {
    for (let from = 0; from < ROUNDS_PER_PHASE; from += SHARE) {
      jobs.push({ group, job: { kind: 'phase', id, reqs, from, to: Math.min(from + SHARE, ROUNDS_PER_PHASE), seedBase } });
    }
  });
  await runAll(jobs.map((j) => j.job), (r, index) => {
    if (r.kind !== 'phase') return;
    const t = totals[jobs[index].group];
    t.attempts += r.attempts; t.completions += r.completions; t.stalled += r.stalled;
  });
  return totals.map((t) => ({ ...t, mean: t.attempts / Math.max(1, t.completions) }));
}

async function matchLength(list: GroupReq[][] | null, seedBase: number): Promise<{ mean: number; stalled: number }> {
  const jobs: Job[] = [];
  for (let from = 0; from < MATCHES_PER_LIST; from += SHARE) jobs.push({ kind: 'matches', list, from, to: Math.min(from + SHARE, MATCHES_PER_LIST), seedBase });
  let rounds = 0, matches = 0, stalled = 0;
  await runAll(jobs, (r) => {
    if (r.kind !== 'matches') return;
    rounds += r.rounds; matches += r.matches; stalled += r.stalled;
  });
  return { mean: rounds / Math.max(1, matches), stalled };
}

const t0 = Date.now();
const lines: string[] = [];
if (smoke) lines.push('**Smoke run with a small sample. These are not final numbers.**', '');
lines.push('# Map 2 phase simulation', '', 'Generated by `node scripts/simulate-map2.ts`. Bots see the game only through `observe()`. Stages are written M1 to M10 for the Moonlit list and C1 to C10 for the classic list.', '');

/* ---------- Phase difficulty ---------- */

const classicIds = phaseSequence('standard');
const classic = await measure(classicIds.map((id) => ({ id, reqs: PHASES[id] })), 31);
const hardestClassic = Math.max(...classic.map((m) => m.mean));
const limit = hardestClassic * 1.25;

const list = DRAFT.map((reqs) => reqs.slice());
const results = await measure(list.map((reqs, i) => ({ id: 11 + i, reqs })), 61);
const firstMeasure = results.slice();
const applied: string[] = [];
const history: string[] = [];
const hardest = () => Math.max(...results.map((m) => m.mean));
for (const sub of SUBSTITUTIONS) {
  if (hardest() <= limit) break;
  const before = hardest();
  const old = reqsText(list[sub.index]);
  list[sub.index] = sub.reqs;
  [results[sub.index]] = await measure([{ id: 11 + sub.index, reqs: sub.reqs }], 61);
  applied.push(`M${sub.index + 1}: ${old} → ${reqsText(sub.reqs)}`);
  history.push(`| ${applied.length} | ${applied[applied.length - 1]} | ${before.toFixed(2)} | ${results[sub.index].mean.toFixed(2)} | ${hardest().toFixed(2)} |`);
}

/** Easiest first; two neighbours within 5% stay in draft order; the hardest always goes last. */
function finalOrder(): number[] {
  const order = list.map((_, i) => i).sort((a, b) => results[a].mean - results[b].mean);
  for (let pass = 0; pass < order.length; pass++) {
    for (let i = 0; i + 1 < order.length; i++) {
      const [a, b] = [order[i], order[i + 1]];
      const close = Math.abs(results[a].mean - results[b].mean) / Math.min(results[a].mean, results[b].mean) <= 0.05;
      if (close && b < a) { order[i] = b; order[i + 1] = a; }
    }
  }
  const top = list.map((_, i) => i).reduce((x, y) => (results[y].mean > results[x].mean ? y : x));
  return [...order.filter((i) => i !== top), top];
}
const order = finalOrder();
const finalList = order.map((i) => list[i]);

lines.push('## Phase difficulty', '', `Mean rounds a player needs to complete a phase: rounds attempted divided by completions, ${ROUNDS_PER_PHASE} rounds per phase. Lower is easier.`, '');
lines.push('Each round has four Professor Hoots. One attempts the phase being measured; the other three play a fixed mix of the classic phases, the same for every phase measured. So every phase faces the same opponents, who end rounds at the same pace.', '');
lines.push('Two other setups were tried and set aside. With all four players on the phase being measured, how long a round lasts dominates: a phase that is hard to hit onto keeps the round going until nearly everyone lays down, so the hardest phase measured as the easiest. Measured inside whole matches, a phase comes out harder near the start of the list, where opponents lay down quickly, so its result depends on where it sits.', '');
lines.push('### Classic baseline', '', '| Stage | Requirement | Mean rounds | Stalled rounds |', '|---|---|---|---|');
classicIds.forEach((id, i) => lines.push(`| C${id} | ${reqsText(PHASES[id])} | ${classic[i].mean.toFixed(2)} | ${classic[i].stalled} |`));
lines.push('', `Hardest classic: ${hardestClassic.toFixed(2)}. Limit for the finale (25% harder): ${limit.toFixed(2)}.`, '');
lines.push('### Draft Moonlit list as first measured', '', '| Draft | Requirement | Mean rounds | Stalled rounds |', '|---|---|---|---|');
DRAFT.forEach((reqs, i) => lines.push(`| M${i + 1} | ${reqsText(reqs)} | ${firstMeasure[i].mean.toFixed(2)} | ${firstMeasure[i].stalled} |`));
lines.push('');
if (applied.length > 0) {
  lines.push('### Substitutions', '', '| # | Change | Hardest before | That phase after | Hardest after |', '|---|---|---|---|---|', ...history, '');
} else {
  lines.push('### Substitutions', '', 'None were needed.', '');
}
lines.push('### Final order', '', 'Sorted easiest first. Then any two neighbours within 5% of each other go back into draft order, and the hardest phase always goes last. "Within 5%" is not transitive, so a chain like A within 5% of B, B within 5% of C, but A and C further apart can make the rules disagree. Where they do, the measured difficulty wins.', '', '| Stage | Requirement | Mean rounds | Draft position | Against hardest classic |', '|---|---|---|---|---|');
order.forEach((d, i) => lines.push(`| M${i + 1} | ${reqsText(list[d])} | ${results[d].mean.toFixed(2)} | ${d + 1} | ${((results[d].mean / hardestClassic - 1) * 100).toFixed(0)}% |`));
const finaleOk = results[order[9]].mean <= limit;
lines.push('', `The finale is the hardest phase, and within the 25% limit: ${finaleOk ? 'Yes' : 'No'}.`);
const easiest = classic[0].mean;
const tooEasy = order.filter((d) => results[d].mean < easiest);
lines.push(`Stages easier than C1 (${easiest.toFixed(2)}): ${tooEasy.length === 0 ? 'none' : tooEasy.map((d) => `${reqsText(list[d])} (${results[d].mean.toFixed(2)})`).join(', ')}.`, '');

/* ---------- Match length ---------- */

const lengthClassic = await matchLength(null, 121);
const lengthMoonlit = await matchLength(finalList, 151);
const change = (lengthMoonlit.mean / lengthClassic.mean - 1) * 100;
lines.push('## Match length', '', `Mean rounds in a full match: four Professor Hoots, ${MATCHES_PER_LIST} matches per list.`, '');
lines.push('| List | Mean rounds | Stalled |', '|---|---|---|', `| Classic | ${lengthClassic.mean.toFixed(2)} | ${lengthClassic.stalled} |`, `| Moonlit (final order) | ${lengthMoonlit.mean.toFixed(2)} | ${lengthMoonlit.stalled} |`, '');
lines.push(`Difference: ${change >= 0 ? '+' : ''}${change.toFixed(1)}%. Target: within ±20%. ${Math.abs(change) <= 20 ? 'Met.' : 'Not met, reported only.'}`, '');

/* ---------- Is the game's list the final list? ---------- */

const inGame = phaseSequence('moonlit').map((id) => reqsText(PHASES[id]));
const wanted = finalList.map(reqsText);
const same = inGame.every((t, i) => t === wanted[i]);
if (!same) console.log(`The game's list differs from this result.\n  In the game: ${inGame.join(' | ')}\n  Result:      ${wanted.join(' | ')}`);
lines.push(`The list in \`src/engine/phases.ts\` ${same ? 'matches' : 'DOES NOT match'} this order.`, '');

const report = lines.join('\n');
writeFileSync(outFile, report);
if (cacheFile) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ report }));
}
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)} s with ${workerCount} workers. Final: ${wanted.join(' | ')}`);
process.exit(0);
