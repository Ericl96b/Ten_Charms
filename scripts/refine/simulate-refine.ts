// The Moonlit Phases refinement simulation (Change Request 03, Part A). Writes SIMULATION_MOONLIT_REFINEMENT.md.
// Usage: node scripts/refine/simulate-refine.ts [--smoke] [--no-cache] [--workers=N] [--out=file] [--data=file]
// Stages are written C1 to C10 for the classic list and L1 to L10 for a candidate list, since the report is
// scanned like the rest of the project.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { BotId } from '../../src/bots/profiles.ts';
import { BOTS, GLADE_STOPS } from '../../src/content.ts';
import type { GroupReq, MatchRules } from '../../src/engine/types.ts';
import { CLASSIC_PHASES, DROPPED_PHASES, ELIGIBLE, KEPT_PHASES, LIVE_LIST, MEASURED, cardsNeeded, hasColorRun, hasParity, type PoolPhase } from './pool.ts';
import { histPercentile, histSums, mean, mergeHist, mergePair, merge, rate, ratio, ratioOfRatios, sums, type Interval, type Pair } from './stats.ts';
import type { CrossResult, Job, ListResult, PhaseResult, Result, Sanity, StopResult } from './worker.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const smoke = args.includes('--smoke');
/** Continue past a bot sanity blocker (§3.4). Only with the user's say-so; the report then marks it. */
const acceptSanity = args.includes('--accept-sanity');

/* ---------- Sample sizes and seeds ---------- */

const S = smoke
  ? { hands: 2000, rounds: 300, matches: 40, stopMatches: 24, screenKeep: 40, listsCheap: 6, maxCheap: 24, finalists: 3, runnersUp: 5, confirmRounds: 2 }
  : { hands: 100000, rounds: 10000, matches: 2000, stopMatches: 2000, screenKeep: 2000, listsCheap: 12, maxCheap: 36, finalists: 3, runnersUp: 5, confirmRounds: 30 };
/** Seed bases. Selection and confirmation never share one. */
const SEEDS = {
  cross: 500,
  phases: 1000, matches: 2000, stops: 3000,
  freshPhases: 7000, freshMatches: 8000, freshStops: 9000,
};
const SANITY_LIMIT = 0.005;
const CROSS_LIMIT = 2;
const CHUNK = { cross: 5000, chains: 100, matches: 50, stopMatches: 25 };

const workerCount = Number(flag('workers') ?? Math.max(1, availableParallelism() - 2));
const outFile = flag('out') ?? (smoke ? 'test-results/sim-refine-smoke.md' : 'SIMULATION_MOONLIT_REFINEMENT.md');
const dataFile = flag('data') ?? (smoke ? 'test-results/sim-refine-smoke.json' : 'test-results/sim-refine.json');
const useCache = !args.includes('--no-cache') && !smoke;
const cacheDir = 'test-results/sim-cache/refine';

/* ---------- Cache: one file per measured unit, keyed by every file the run imports ---------- */

async function codeHash(): Promise<string> {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const { metafile } = await build({
    absWorkingDir: root,
    entryPoints: ['scripts/refine/simulate-refine.ts', 'scripts/refine/worker.ts'],
    bundle: true, write: false, metafile: true, packages: 'external', platform: 'node', format: 'esm', outdir: 'unused', logLevel: 'silent',
  });
  const hash = createHash('sha256').update(JSON.stringify({ S, node: process.versions.node.split('.')[0] }));
  for (const file of Object.keys(metafile.inputs).sort()) hash.update(file).update(readFileSync(join(root, file)));
  return hash.digest('hex');
}
/**
 * --code-hash=<hex> reuses the cache of an earlier run whose code differed only in ways that change no measured
 * unit (such as how many lists are measured per batch). Every unit is still keyed by its own parameters.
 */
const CODE = flag('code-hash') ?? await codeHash();
const cachePath = (unit: unknown) => join(cacheDir, createHash('sha256').update(CODE).update(JSON.stringify(unit)).digest('hex') + '.json');
function cached<T>(unit: unknown): T | null {
  if (!useCache) return null;
  const p = cachePath(unit);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
}
function store(unit: unknown, value: unknown): void {
  if (!useCache) return;
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath(unit), JSON.stringify(value));
}

/* ---------- Worker pool ---------- */

/** One shared queue: any number of batches can be in flight, and idle workers take the next job from any of them. */
type Task = { job: Job; done: (r: Result) => void; fail: (e: Error) => void };
const queue: Task[] = [];
const idle: Worker[] = [];
const pool: Worker[] = Array.from({ length: workerCount }, () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url));
  let current: Task | null = null;
  const give = () => {
    current = queue.shift() ?? null;
    if (current) worker.postMessage(current.job); else idle.push(worker);
  };
  worker.on('message', (msg: { ok: boolean; result?: Result; error?: string }) => {
    const task = current!;
    if (msg.ok) task.done(msg.result!); else task.fail(new Error(`job ${JSON.stringify(task.job).slice(0, 200)} failed: ${msg.error}`));
    give();
  });
  worker.on('error', (err) => { current?.fail(err); console.error(err); process.exit(1); });
  (worker as Worker & { give: () => void }).give = give;
  idle.push(worker);
  return worker;
});
const wake = () => { while (idle.length > 0 && queue.length > 0) (idle.shift() as Worker & { give: () => void }).give(); };
/** Runs jobs on the pool; results come back in the jobs' order. */
function runAll(jobs: Job[]): Promise<Result[]> {
  const out = Promise.all(jobs.map((job) => new Promise<Result>((done, fail) => { queue.push({ job, done, fail }); })));
  wake();
  return out;
}

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1)} min] ${msg}`);

/* ---------- Cross-check (§3.3) ---------- */

const g = (type: GroupReq['type'], size: number): GroupReq => ({ type, size });
const pr: GroupReq = { type: 'set', size: 2, pair: true };
const REFERENCE: { label: string; reqs: GroupReq[]; classicId?: number; ref: number }[] = [
  { label: 'Classic: 2 Sets of 3', reqs: [g('set', 3), g('set', 3)], classicId: 1, ref: 28.0 },
  { label: 'Classic: Set of 3 + Run of 4', reqs: [g('set', 3), g('run', 4)], classicId: 2, ref: 44.4 },
  { label: 'Classic: Set of 4 + Run of 4', reqs: [g('set', 4), g('run', 4)], classicId: 3, ref: 11.5 },
  { label: '4 Pairs', reqs: [pr, pr, pr, pr], ref: 33.9 },
  { label: 'Run of 4 + 2 Pairs', reqs: [g('run', 4), pr, pr], ref: 60.5 },
  { label: 'Color run of 3 + Set of 3', reqs: [g('colorRun', 3), g('set', 3)], ref: 34.1 },
  { label: '7 Evens', reqs: [g('evens', 7)], ref: 30.6 },
  { label: '3 Sets of 3', reqs: [g('set', 3), g('set', 3), g('set', 3)], ref: 1.9 },
  { label: 'Color run of 4 + Run of 4', reqs: [g('colorRun', 4), g('run', 4)], ref: 11.2 },
  { label: '4 Odds + 4 Evens', reqs: [g('odds', 4), g('evens', 4)], ref: 84.0 },
  { label: 'Set of 4 + 4 of one Color', reqs: [g('set', 4), g('color', 4)], ref: 12.5 },
  { label: 'Color run of 5 + Pair', reqs: [g('colorRun', 5), pr], ref: 10.8 },
  { label: 'Color run of 6', reqs: [g('colorRun', 6)], ref: 3.6 },
];

type Cross = { label: string; ref: number; hands: number; judge: number; solver: number; disagree: number; examples: string[] };
async function crossCheck(): Promise<Cross[]> {
  const unit = { stage: 'cross', hands: S.hands, seed: SEEDS.cross };
  const hit = cached<Cross[]>(unit);
  if (hit) return hit;
  const jobs: Job[] = [];
  REFERENCE.forEach((r, i) => {
    for (let from = 0; from < S.hands; from += CHUNK.cross) {
      jobs.push({ kind: 'cross', key: String(i), reqs: r.reqs, classicId: r.classicId, from, to: Math.min(S.hands, from + CHUNK.cross), seedBase: SEEDS.cross });
    }
  });
  const out: Cross[] = REFERENCE.map((r) => ({ label: r.label, ref: r.ref, hands: 0, judge: 0, solver: 0, disagree: 0, examples: [] }));
  for (const res of (await runAll(jobs)) as CrossResult[]) {
    const t = out[Number(res.key)];
    t.hands += res.hands; t.judge += res.judge; t.solver += res.solver; t.disagree += res.disagree;
    t.examples.push(...res.examples.slice(0, 3 - t.examples.length));
  }
  store(unit, out);
  return out;
}

/* ---------- Per-phase measurement (§3) ---------- */

type PhaseData = Omit<PhaseResult, 'kind' | 'key'>;
const emptyPhase = (): PhaseData => ({
  chains: 0, capped: 0, stalled: 0, illegal: 0, chainRounds: {}, chainTurns: {}, rounds: 0, completions: 0,
  byTurn: [0, 0, 0, 0], lays: 0, sameExit: 0, nextExit: 0, wins: 0, winsByPos: [0, 0, 0, 0], roundsByPos: [0, 0, 0, 0],
  wild: [{ n: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0 }, { n: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0 }, { n: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0 }],
  gap: sums(), variantWins: 0,
  sanity: { decisions: 0, layLegal: 0, layMiss: 0, holds: 0, outLegal: 0, outMiss: 0, outMissLayTurn: 0, examples: [] },
});
function mergePhase(a: PhaseData, b: PhaseResult): void {
  a.chains += b.chains; a.capped += b.capped; a.stalled += b.stalled; a.illegal += b.illegal;
  mergeHist(a.chainRounds, b.chainRounds); mergeHist(a.chainTurns, b.chainTurns);
  a.rounds += b.rounds; a.completions += b.completions;
  b.byTurn.forEach((v, i) => { a.byTurn[i] += v; });
  a.lays += b.lays; a.sameExit += b.sameExit; a.nextExit += b.nextExit; a.wins += b.wins;
  b.winsByPos.forEach((v, i) => { a.winsByPos[i] += v; });
  b.roundsByPos.forEach((v, i) => { a.roundsByPos[i] += v; });
  b.wild.forEach((p, i) => mergePair(a.wild[i], p));
  merge(a.gap, b.gap); a.variantWins += b.variantWins;
  const s: Sanity = a.sanity, t = b.sanity;
  s.decisions += t.decisions; s.layLegal += t.layLegal; s.layMiss += t.layMiss; s.holds += t.holds; s.outLegal += t.outLegal; s.outMiss += t.outMiss; s.outMissLayTurn += t.outMissLayTurn;
  s.examples.push(...t.examples.slice(0, Math.max(0, 5 - s.examples.length)));
}

const classicIdOf = (p: PoolPhase) => (p.kind === 'classic' ? CLASSIC_PHASES.indexOf(p) + 1 : undefined);

/** Plays chains in waves until every phase has at least the minimum rounds. Waves depend only on results so far. */
async function measurePhases(phases: PoolPhase[], seedBase: number): Promise<Map<string, PhaseData>> {
  const out = new Map<string, PhaseData>();
  const pending: { p: PoolPhase; unit: unknown; data: PhaseData; seed: number }[] = [];
  for (const p of phases) {
    const seed = seedBase + MEASURED.indexOf(p);
    const unit = { stage: 'phase', reqs: p.reqs, classic: classicIdOf(p), seed, rounds: S.rounds };
    const hit = cached<PhaseData>(unit);
    if (hit) out.set(p.key, hit); else pending.push({ p, unit, data: emptyPhase(), seed });
  }
  let wave = 0;
  while (pending.length > 0) {
    wave++;
    const jobs: Job[] = [];
    const owner: number[] = [];
    pending.forEach((e, idx) => {
      const need = S.rounds - e.data.rounds;
      const perChain = e.data.chains > 0 ? e.data.rounds / e.data.chains : 1.5;
      const chains = Math.max(CHUNK.chains, Math.ceil((need / perChain) * 1.05 / CHUNK.chains) * CHUNK.chains);
      for (let from = e.data.chains; from < e.data.chains + chains; from += CHUNK.chains) {
        jobs.push({ kind: 'phase', key: e.p.key, reqs: e.p.reqs, classicId: classicIdOf(e.p), from, to: from + CHUNK.chains, seedBase: e.seed });
        owner.push(idx);
      }
    });
    log(`per-phase wave ${wave}: ${pending.length} phases, ${jobs.length} jobs`);
    const results = (await runAll(jobs)) as PhaseResult[];
    results.forEach((r, i) => mergePhase(pending[owner[i]].data, r));
    for (let i = pending.length - 1; i >= 0; i--) {
      const e = pending[i];
      if (e.data.rounds >= S.rounds) { store(e.unit, e.data); out.set(e.p.key, e.data); pending.splice(i, 1); }
    }
  }
  return out;
}

/** The figures a list or a target needs from one phase's measurement. */
type PhaseStats = {
  key: string; text: string;
  meanRounds: Interval; turns: Interval; turnsMedian: number; turnsP90: number;
  by: Interval[]; later: Interval;
  same: Interval; next: Interval;
  wildDep: Interval; wild0: Interval; wild2: Interval;
  gap: Interval; hootWin: Interval; variantWin: Interval;
  seatWin: Interval[]; seatSpread: number;
  layMiss: Interval; outMiss: Interval; holds: number;
  data: PhaseData;
};
function phaseStats(p: PoolPhase, d: PhaseData): PhaseStats {
  const chainR = histSums(d.chainRounds);
  const turns = mean(histSums(d.chainTurns));
  const cum = [d.byTurn[0], d.byTurn[0] + d.byTurn[1], d.byTurn[0] + d.byTurn[1] + d.byTurn[2]];
  const seatWin = d.winsByPos.map((w, i) => rate(w, d.roundsByPos[i]));
  const avg = seatWin.reduce((n, s) => n + s.value, 0) / 4;
  const gap = mean(d.gap);
  return {
    key: p.key, text: p.text,
    meanRounds: mean(chainR), turns, turnsMedian: histPercentile(d.chainTurns, 0.5), turnsP90: histPercentile(d.chainTurns, 0.9),
    by: cum.map((k) => rate(k, d.rounds)), later: rate(d.byTurn[3], d.rounds),
    same: rate(d.sameExit, d.lays), next: rate(d.nextExit, d.lays),
    wildDep: ratioOfRatios(d.wild[0], d.wild[2]), wild0: ratio(d.wild[0]), wild2: ratio(d.wild[2]),
    gap, hootWin: rate(d.wins, d.rounds), variantWin: rate(d.variantWins, d.gap.n),
    seatWin, seatSpread: Math.max(...seatWin.map((s) => Math.abs(s.value - avg))) * 100,
    layMiss: rate(d.sanity.layMiss, d.sanity.layLegal), outMiss: rate(d.sanity.outMiss, d.sanity.outLegal), holds: d.sanity.holds,
    data: d,
  };
}

/* ---------- Full matches (§4.3) ---------- */

type ListData = Omit<ListResult, 'kind' | 'key'>;
async function listMatches(list: GroupReq[][] | null, seedBase: number): Promise<ListData> {
  const unit = { stage: 'list', list, seed: seedBase, matches: S.matches };
  const hit = cached<ListData>(unit);
  if (hit) return hit;
  const jobs: Job[] = [];
  for (let from = 0; from < S.matches; from += CHUNK.matches) jobs.push({ kind: 'list', key: '', list, from, to: Math.min(S.matches, from + CHUNK.matches), seedBase });
  const results = (await runAll(jobs)) as ListResult[];
  const d: ListData = {
    matches: 0, stalled: 0, illegal: 0, roundsHist: {}, turnsHist: {}, seatRoundWins: [0, 0, 0, 0], seatAdv: [0, 0, 0, 0], roundsPlayed: 0,
    lays: new Array(10).fill(0), sameExit: new Array(10).fill(0), nextExit: new Array(10).fill(0), leaderCounted: 0, comebacks: 0, seatMatchWins: [0, 0, 0, 0],
  };
  for (const r of results) {
    d.matches += r.matches; d.stalled += r.stalled; d.illegal += r.illegal; d.roundsPlayed += r.roundsPlayed;
    mergeHist(d.roundsHist, r.roundsHist); mergeHist(d.turnsHist, r.turnsHist);
    for (let i = 0; i < 4; i++) { d.seatRoundWins[i] += r.seatRoundWins[i]; d.seatAdv[i] += r.seatAdv[i]; d.seatMatchWins[i] += r.seatMatchWins[i]; }
    for (let i = 0; i < 10; i++) { d.lays[i] += r.lays[i]; d.sameExit[i] += r.sameExit[i]; d.nextExit[i] += r.nextExit[i]; }
    d.leaderCounted += r.leaderCounted; d.comebacks += r.comebacks;
  }
  store(unit, d);
  return d;
}

type StopData = { id: string; players: number; rotations: number; matches: number; stalled: number; illegal: number; humanWins: number; seatRoundWins: number[]; seatAdv: number[]; roundsPlayed: number };
async function stopMatches(list: GroupReq[][] | null, seedBase: number): Promise<StopData[]> {
  const unit = { stage: 'stops', list, seed: seedBase, matches: S.stopMatches };
  const hit = cached<StopData[]>(unit);
  if (hit) return hit;
  const jobs: Job[] = [];
  const owner: number[] = [];
  GLADE_STOPS.forEach((stop, si) => {
    const base: BotId[] = ['hoot', ...stop.lineup];
    const n = base.length;
    const boss = base.includes('lunaria');
    const rotations = boss ? 1 : n;
    const per = Math.ceil(S.stopMatches / rotations);
    for (let rot = 0; rot < rotations; rot++) {
      const lineup = base.map((_, k) => base[(k - rot + n) % n]);
      const crown = lineup.indexOf('lunaria');
      const rules: MatchRules = { fog: true, ...(crown >= 0 ? { crownSeat: crown, crownName: 'Lunaria' } : {}) };
      for (let from = 0; from < per; from += CHUNK.stopMatches) {
        jobs.push({ kind: 'stop', key: stop.id, lineup, human: rot, rules, list, from, to: Math.min(per, from + CHUNK.stopMatches), seedBase: seedBase + si * 10 + rot });
        owner.push(si);
      }
    }
  });
  const out: StopData[] = GLADE_STOPS.map((s) => {
    const n = s.lineup.length + 1;
    return { id: s.id, players: n, rotations: s.lineup.includes('lunaria') ? 1 : n, matches: 0, stalled: 0, illegal: 0, humanWins: 0, seatRoundWins: new Array(n).fill(0), seatAdv: new Array(n).fill(0), roundsPlayed: 0 };
  });
  ((await runAll(jobs)) as StopResult[]).forEach((r, i) => {
    const t = out[owner[i]];
    t.matches += r.matches; t.stalled += r.stalled; t.illegal += r.illegal; t.humanWins += r.humanWins; t.roundsPlayed += r.roundsPlayed;
    r.seatRoundWins.forEach((v, k) => { t.seatRoundWins[k] += v; });
    r.seatAdv.forEach((v, k) => { t.seatAdv[k] += v; });
  });
  store(unit, out);
  return out;
}

/* ---------- Targets (§4.2) ---------- */

type Baseline = {
  worstSame: number; worstNext: number; hardest: number; c1Turns: number; c1By2: number; medianGap: number;
  /** From the classic list's full matches. */
  full?: { rounds: number; turns: number; worstSame: number; worstNext: number; comeback: number };
};
function baselineFrom(classic: PhaseStats[], full?: ListData): Baseline {
  const gaps = classic.map((c) => c.gap.value * 100).sort((a, b) => a - b);
  const b: Baseline = {
    worstSame: Math.max(...classic.map((c) => c.same.value)),
    worstNext: Math.max(...classic.map((c) => c.next.value)),
    hardest: Math.max(...classic.map((c) => c.turns.value)),
    c1Turns: classic[0].turns.value, c1By2: classic[0].by[1].value,
    medianGap: (gaps[4] + gaps[5]) / 2,
  };
  if (full) {
    const ff = fullFigures(full);
    b.full = { rounds: ff.rounds.value, turns: ff.turns.value, worstSame: Math.max(...ff.same.map((x) => x.value)), worstNext: Math.max(...ff.next.map((x) => x.value)), comeback: ff.comeback.value };
  }
  return b;
}

function fullFigures(d: ListData) {
  return {
    rounds: mean(histSums(d.roundsHist)), roundsMedian: histPercentile(d.roundsHist, 0.5), roundsP90: histPercentile(d.roundsHist, 0.9),
    turns: mean(histSums(d.turnsHist)), turnsMedian: histPercentile(d.turnsHist, 0.5), turnsP90: histPercentile(d.turnsHist, 0.9),
    same: d.lays.map((l, i) => rate(d.sameExit[i], l)), next: d.lays.map((l, i) => rate(d.nextExit[i], l)),
    seatWin: d.seatRoundWins.map((w) => rate(w, d.roundsPlayed)), seatAdv: d.seatAdv.map((a) => rate(a, d.roundsPlayed)),
    comeback: rate(d.comebacks, d.leaderCounted),
  };
}

type Check = { met: boolean; marginal: boolean; detail: string };
type Verdict = { hard: Check; r1: Check; r2: Check; r3: Check; r4: Check; r5: Check; r6: Check };
const RANKS = ['hard', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ci = (i: Interval, f = pct) => `${f(i.value)} (${f(i.lo)}–${f(i.hi)})`;
const num2 = (v: number) => v.toFixed(2);

type Candidate = { idx: number[]; phases: PhaseStats[]; full?: ListData; stops?: StopData[]; verdict?: Verdict; liveKept: number; maxStep: number };

/** Fair-share checks on a table's seats: round wins against fair share, advancement against the table's mean. */
function seatChecks(wins: number[], adv: number[], rounds: number, players: number): { ok: boolean; marginal: boolean; text: string } {
  const fair = 1 / players;
  const w = wins.map((k) => rate(k, rounds));
  const a = adv.map((k) => rate(k, rounds));
  const meanAdv = a.reduce((n, x) => n + x.value, 0) / players;
  const ok = w.every((x) => Math.abs(x.value - fair) <= 0.05) && a.every((x) => Math.abs(x.value - meanAdv) <= 0.05);
  const marginal = ok && (w.some((x) => Math.abs(x.lo - fair) > 0.05 || Math.abs(x.hi - fair) > 0.05) || a.some((x) => Math.abs(x.lo - meanAdv) > 0.05 || Math.abs(x.hi - meanAdv) > 0.05));
  return { ok, marginal, text: `round wins ${w.map((x) => pct(x.value)).join(' / ')} (fair ${pct(fair)}), advancement ${a.map((x) => pct(x.value)).join(' / ')} (mean ${pct(meanAdv)})` };
}

function judgeList(c: Candidate, base: Baseline): Verdict {
  const ph = c.phases;
  const t = ph.map((p) => p.turns.value);
  const steps = t.slice(1).map((v, i) => v / t[i]);
  const hard: Check = { met: true, marginal: false, detail: 'not measured yet' };
  let r1: Check, r2: Check, r6: Check = { met: true, marginal: false, detail: 'not measured yet' };
  const ppR2 = ph.every((p) => p.seatSpread <= 8);
  if (c.full && base.full) {
    const ff = fullFigures(c.full);
    const dr = ff.rounds.value / base.full.rounds - 1, dt = ff.turns.value / base.full.turns - 1;
    hard.met = dr <= 0.3 && dt <= 0.3;
    hard.marginal = hard.met && (ff.rounds.hi / base.full.rounds - 1 > 0.3 || ff.turns.hi / base.full.turns - 1 > 0.3);
    hard.detail = `rounds ${num2(ff.rounds.value)} (${num2(ff.rounds.lo)}–${num2(ff.rounds.hi)}), ${dr >= 0 ? '+' : ''}${(dr * 100).toFixed(1)}% vs classic; total turns ${ff.turns.value.toFixed(1)} (${ff.turns.lo.toFixed(1)}–${ff.turns.hi.toFixed(1)}), ${dt >= 0 ? '+' : ''}${(dt * 100).toFixed(1)}%. Limit +30% each`;
    const sOk = ff.same.every((x) => x.value <= base.full!.worstSame), nOk = ff.next.every((x) => x.value <= base.full!.worstNext);
    const worstS = Math.max(...ff.same.map((x) => x.value)), worstN = Math.max(...ff.next.map((x) => x.value));
    r1 = {
      met: sOk && nOk,
      marginal: sOk && nOk && (ff.same.some((x) => x.hi > base.full!.worstSame) || ff.next.some((x) => x.hi > base.full!.worstNext)),
      detail: `in whole matches, highest same-turn exit ${pct(worstS)} (classic worst ${pct(base.full.worstSame)}), highest next-turn exit ${pct(worstN)} (classic worst ${pct(base.full.worstNext)})`,
    };
    const four = seatChecks(c.full.seatRoundWins, c.full.seatAdv, c.full.roundsPlayed, 4);
    let ok = ppR2 && four.ok, marginal = four.marginal;
    let detail = `4 Hoots: ${four.text}; per phase, largest seat spread ${Math.max(...ph.map((p) => p.seatSpread)).toFixed(1)} points (limit 8)`;
    if (c.stops) {
      for (const [label, ids, players] of [['3 players (G1)', ['g1'], 3], ['4 players (A1–G2)', ['a1', 'a2', 'b1', 'b2', 'g2'], 4]] as const) {
        const st = c.stops.filter((s) => (ids as readonly string[]).includes(s.id));
        const w = new Array(players).fill(0), a = new Array(players).fill(0);
        let rounds = 0;
        for (const s of st) { s.seatRoundWins.forEach((v, k) => { w[k] += v; }); s.seatAdv.forEach((v, k) => { a[k] += v; }); rounds += s.roundsPlayed; }
        const chk = seatChecks(w, a, rounds, players);
        ok &&= chk.ok; marginal ||= chk.marginal;
        detail += `; stops at ${label}: ${chk.text}`;
      }
    } else detail += '; stop lineups not measured yet';
    r2 = { met: ok, marginal: ok && marginal, detail };
    const cb = ff.comeback;
    r6 = { met: cb.value >= base.full.comeback - 0.05, marginal: cb.value >= base.full.comeback - 0.05 && cb.lo < base.full.comeback - 0.05, detail: `leader after round 5 doesn't win: ${ci(cb)} (classic ${pct(base.full.comeback)}, floor ${pct(base.full.comeback - 0.05)})` };
  } else {
    const sOk = ph.every((p) => p.same.value <= base.worstSame && p.next.value <= base.worstNext);
    r1 = { met: sOk, marginal: false, detail: 'per phase only, until whole matches are measured' };
    r2 = { met: ppR2, marginal: false, detail: 'per phase only, until whole matches are measured' };
  }
  const maxStep = Math.max(...steps);
  const finaleRatio = t[9] / base.hardest;
  const r3: Check = {
    met: maxStep <= 1.4 && finaleRatio <= 1.25,
    marginal: false,
    detail: `largest step ${num2(maxStep)}× (limit 1.40×), finale ${num2(finaleRatio)}× the hardest classic phase (limit 1.25×)`,
  };
  const firstRatio = t[0] / base.c1Turns;
  const by2Max = Math.max(...ph.map((p) => p.by[1].value));
  const r4: Check = {
    met: firstRatio >= 1.1 && by2Max <= base.c1By2,
    marginal: firstRatio >= 1.1 && by2Max <= base.c1By2 && (ph[0].turns.lo / base.c1Turns < 1.1 || ph.some((p) => p.by[1].hi > base.c1By2)),
    detail: `L1 ${num2(firstRatio)}× C1's turns to complete (floor 1.10×); highest completion by own turn 2 ${pct(by2Max)} (C1 ${pct(base.c1By2)})`,
  };
  const minGap = Math.min(...ph.map((p) => p.gap.value * 100));
  const r5: Check = {
    met: minGap >= base.medianGap - 5,
    marginal: minGap >= base.medianGap - 5 && ph.some((p) => p.gap.lo * 100 < base.medianGap - 5),
    detail: `smallest decision gap ${minGap.toFixed(1)} points (classic median ${base.medianGap.toFixed(1)}, floor ${(base.medianGap - 5).toFixed(1)})`,
  };
  return { hard, r1, r2, r3, r4, r5, r6 };
}

/** Higher is better: targets met in rank order, then live phases kept, then the smallest largest step. */
function compare(a: Candidate, b: Candidate): number {
  for (const r of RANKS) {
    const x = a.verdict![r].met, y = b.verdict![r].met;
    if (x !== y) return x ? -1 : 1;
  }
  if (a.liveKept !== b.liveKept) return b.liveKept - a.liveKept;
  return a.maxStep - b.maxStep;
}

const differ = (a: number[], b: number[]) => a.filter((i) => !b.includes(i)).length;

/* ---------- The run ---------- */

let STATS = new Map<string, PhaseStats>();
/** Set when the whole-match budget ran out while an unmeasured list could still have outranked a finalist. */
let budgetHit = false;
const report: string[] = [];
const data: Record<string, unknown> = { samples: S, seeds: SEEDS, workers: workerCount };
const finish = (code: number) => {
  writeFileSync(outFile, report.join('\n'));
  writeFileSync(dataFile, JSON.stringify(data));
  log(`wrote ${outFile} and ${dataFile}`);
  void Promise.all(pool.map((w) => w.terminate())).then(() => process.exit(code));
};

if (smoke) report.push('**Smoke run with a small sample. These are not final numbers.**', '');
report.push('# Moonlit Phases refinement simulation', '');
report.push('Generated by `node scripts/refine/simulate-refine.ts` for Change Request 03, Part A. Bots see the game only through `observe()`. Stages are written C1 to C10 for the classic list and L1 to L10 for a candidate list. The live list in the game is not changed by any of this.', '');

// 1. Cross-check.
log('cross-check');
const cross = await crossCheck();
data.cross = cross;
report.push('## 1. Cross-check with design-side screening', '', `Opening hands: 10 cards dealt plus one draw, from a shuffled 108-card deck, ${S.hands.toLocaleString('en-US')} hands per phase, seed base ${SEEDS.cross}. "Game" is the game's own arrangement search; "judge" is the independent judge used by the bot sanity checks. The target is within ${CROSS_LIMIT} points of the reference.`, '');
report.push('| Phase | Reference | Game | Judge | Difference | Met | Game and judge disagree |', '|---|---|---|---|---|---|---|');
let crossOk = true;
for (const c of cross) {
  const game = rate(c.solver, c.hands), judge = rate(c.judge, c.hands);
  const diff = game.value * 100 - c.ref;
  const met = Math.abs(diff) <= CROSS_LIMIT && Math.abs(judge.value * 100 - c.ref) <= CROSS_LIMIT;
  crossOk &&= met && c.disagree === 0;
  report.push(`| ${c.label} | ${c.ref.toFixed(1)}% | ${ci(game)} | ${ci(judge)} | ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} | ${met ? 'Yes' : 'No'} | ${c.disagree} |`);
}
report.push('');
if (!crossOk) {
  report.push('**The cross-check failed, so no further results were produced.** The cause must be found before any result is used (§3.3).', '');
  finish(1);
} else {

// 2. Per-phase measurements.
log('per-phase measurements');
const measured = await measurePhases(MEASURED, SEEDS.phases);
const stats = new Map(MEASURED.map((p) => [p.key, phaseStats(p, measured.get(p.key)!)]));
STATS = stats;
data.phases = Object.fromEntries([...stats].map(([k, s]) => [k, { ...s, data: undefined, raw: s.data }]));
const classic = CLASSIC_PHASES.map((p) => stats.get(p.key)!);
let problems = 0;
for (const s of stats.values()) problems += s.data.stalled + s.data.illegal + s.data.capped;

// Bot sanity.
const blockers = ELIGIBLE.map((p) => stats.get(p.key)!).filter((s) => s.layMiss.value > SANITY_LIMIT || s.outMiss.value > SANITY_LIMIT);
report.push('## 2. Bot sanity checks', '');
report.push(`At every play stage of the measured Professor Hoot, an independent judge decides whether a legal lay-down exists (before Hoot is down) and whether the hand could be emptied that turn. It uses only the engine's rule checks, never the bots' search or the game's arrangement search. A lay-down miss is a turn where the judge finds a legal lay-down and Hoot's own evaluation doesn't see one. A going-out miss is a turn where the judge finds a way out and Hoot ends the turn holding cards. Hoot sometimes holds a lay-down back for one turn on purpose; those turns count as recognized and are listed separately. Limit: ${SANITY_LIMIT * 100}% for every pool phase.`, '');
report.push('| Phase | Decision points | Legal lay-downs | Lay-down misses | Held on purpose | Ways out | Going-out misses | Of those, on the lay-down turn | Met |', '|---|---|---|---|---|---|---|---|---|');
for (const p of MEASURED) {
  const s = stats.get(p.key)!;
  const d = s.data.sanity;
  const ok = s.layMiss.value <= SANITY_LIMIT && (d.outLegal === 0 || s.outMiss.value <= SANITY_LIMIT);
  report.push(`| ${p.text}${p.kind === 'classic' ? ' (classic)' : p.kind === 'dropped' ? ' (dropped)' : ''} | ${d.decisions} | ${d.layLegal} | ${d.layMiss} (${d.layLegal ? ci(s.layMiss, (v) => `${(v * 100).toFixed(2)}%`) : '–'}) | ${d.holds} | ${d.outLegal} | ${d.outMiss} (${d.outLegal ? ci(s.outMiss, (v) => `${(v * 100).toFixed(2)}%`) : '–'}) | ${d.outMissLayTurn} | ${ok ? 'Yes' : 'No'} |`);
}
report.push('');
if (blockers.length > 0 && acceptSanity) {
  report.push(`**Blocker, accepted for this run:** the miss rate is above ${SANITY_LIMIT * 100}% for ${blockers.length} pool phases (${blockers.map((b) => b.text).join(', ')}). The run continued only because \`--accept-sanity\` was given.`, '');
}
if ((blockers.length > 0 && !acceptSanity) || problems > 0) {
  if (blockers.length > 0) report.push(`**Blocker:** the miss rate is above ${SANITY_LIMIT * 100}% for ${blockers.map((b) => b.text).join(', ')}. Bots may not be changed in this change request, so the run stopped here (§3.4).`, '');
  if (problems > 0) report.push(`**Blocker:** ${problems} stalled, illegal or cut-off rounds in the per-phase measurement.`, '');
  for (const b of blockers) report.push(`Examples for ${b.text}:`, '', ...b.data.sanity.examples.map((e) => `- \`${e.slice(0, 600)}\``), '');
  writePerPhase();
  finish(1);
} else {

writePerPhase();

// 3. Screen every list.
log('screening every list');
const base0 = baselineFrom(classic);
const eligible = ELIGIBLE.map((p) => stats.get(p.key)!).sort((a, b) => a.turns.value - b.turns.value);
const order = eligible.map((s) => ELIGIBLE.findIndex((p) => p.key === s.key));
const isKept = order.map((i) => ELIGIBLE[i].kind === 'kept');
const cr = order.map((i) => hasColorRun(ELIGIBLE[i].reqs));
const par = order.map((i) => hasParity(ELIGIBLE[i].reqs));
const sizeOk = order.map((i) => cardsNeeded(ELIGIBLE[i].reqs) < 10);
const ppOk = eligible.map((s) => ({
  r1: s.same.value <= base0.worstSame && s.next.value <= base0.worstNext,
  r2: s.seatSpread <= 8,
  r4: s.by[1].value <= base0.c1By2,
  r5: s.gap.value * 100 >= base0.medianGap - 5,
}));
const T = eligible.map((s) => s.turns.value);
type Screened = { pos: number[]; score: number[]; liveKept: number; maxStep: number };
const top: Screened[] = [];
let validLists = 0;
const better = (a: Screened, b: Screened) => {
  for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return b.score[i] - a.score[i];
  if (a.liveKept !== b.liveKept) return b.liveKept - a.liveKept;
  return a.maxStep - b.maxStep;
};
const chosen: number[] = [];
const walk = (from: number) => {
  if (chosen.length === 10) {
    const last = chosen[9];
    if (!cr[last] || !sizeOk.every(Boolean)) return;
    let crCount = 0, parity = false, kept = 0, maxStep = 0, r1 = true, r2 = true, r4b = true, r5 = true;
    for (let k = 0; k < 10; k++) {
      const i = chosen[k];
      if (cr[i]) crCount++;
      if (par[i]) parity = true;
      if (isKept[i]) kept++;
      if (k > 0) maxStep = Math.max(maxStep, T[i] / T[chosen[k - 1]]);
      const f = ppOk[i];
      r1 &&= f.r1; r2 &&= f.r2; r4b &&= f.r4; r5 &&= f.r5;
    }
    if (crCount < 4 || !parity) return;
    validLists++;
    const r3 = maxStep <= 1.4 && T[last] / base0.hardest <= 1.25;
    const r4 = r4b && T[chosen[0]] / base0.c1Turns >= 1.1;
    // Hard, rank 6, and the full-match parts of ranks 1 and 2 are unknown here, so they count as met for now.
    const s: Screened = { pos: chosen.slice(), score: [1, +r1, +r2, +r3, +r4, +r5, 1], liveKept: kept, maxStep };
    if (top.length < S.screenKeep || better(s, top[top.length - 1]) < 0) {
      top.push(s);
      if (top.length > S.screenKeep * 2) { top.sort(better); top.length = S.screenKeep; }
    }
    return;
  }
  for (let i = from; i <= 25 - (10 - chosen.length); i++) { chosen.push(i); walk(i + 1); chosen.pop(); }
};
walk(0);
top.sort(better);
top.length = Math.min(top.length, S.screenKeep);
log(`screened: ${validLists} valid lists`);
data.validLists = validLists;

const candidateOf = (s: Screened): Candidate => ({ idx: s.pos.map((p) => order[p]), phases: s.pos.map((p) => eligible[p]), liveKept: s.liveKept, maxStep: s.maxStep });

// 4. Baselines in whole matches.
log('baselines: whole matches');
const [classicFull, liveFull, classicStops, liveStops] = await Promise.all([
  listMatches(null, SEEDS.matches), listMatches(LIVE_LIST, SEEDS.matches), stopMatches(null, SEEDS.stops), stopMatches(LIVE_LIST, SEEDS.stops),
]);
const base = baselineFrom(classic, classicFull);

// 5. Whole matches for the leading lists, four Hoots first.
const evaluated: Candidate[] = [];
let screenAt = 0;
const nextCheap = async (count: number) => {
  const batch = top.slice(screenAt, screenAt + count).map(candidateOf);
  screenAt += batch.length;
  log(`4-Hoot matches for lists ${screenAt - batch.length + 1}–${screenAt}`);
  await Promise.all(batch.map(async (c) => {
    c.full = await listMatches(c.phases.map((p) => MEASURED.find((m) => m.key === p.key)!.reqs), SEEDS.matches);
    c.verdict = judgeList(c, base);
  }));
  evaluated.push(...batch);
  evaluated.sort(compare);
};
await nextCheap(S.listsCheap);

// 6. Stop lineups for lists in ranked order, until the finalists and runners-up are settled.
const reqsOf = (c: Candidate) => c.phases.map((p) => MEASURED.find((m) => m.key === p.key)!.reqs);
const withStops = async (c: Candidate) => {
  if (!c.stops) { c.stops = await stopMatches(reqsOf(c), SEEDS.stops); c.verdict = judgeList(c, base); }
};
/** The best unmeasured list from the screen, scored on what its phases alone can decide. */
const frontier = (): Candidate | null => {
  if (screenAt >= top.length) return null;
  const c = candidateOf(top[screenAt]);
  c.verdict = judgeList(c, base);
  return c;
};
/**
 * The best lists by the ranking, with the 2-phase rule, then the next-best lists, every one measured in full.
 * Measuring more can only lower a list (each measurement adds checks), so the loop settles.
 */
async function settle(exclude: Set<string>, want: number): Promise<{ finalists: Candidate[]; others: Candidate[] }> {
  // A fixed budget: the top S.maxCheap lists from the screen are all played in whole matches.
  while (evaluated.length < S.maxCheap && screenAt < top.length) await nextCheap(Math.min(S.listsCheap, S.maxCheap - evaluated.length));
  for (;;) {
    evaluated.sort(compare);
    const finalists: Candidate[] = [];
    const others: Candidate[] = [];
    let need: Candidate | null = null;
    for (const c of evaluated) {
      if (exclude.has(c.idx.join(','))) continue;
      if (finalists.length === want && others.length === S.runnersUp) break;
      const takes = finalists.length < want && finalists.every((f) => differ(f.idx, c.idx) >= 2);
      if (!takes && others.length === S.runnersUp) continue;
      if (!c.stops) { need = c; break; }
      (takes ? finalists : others).push(c);
    }
    if (need) {
      // Measure the next few unmeasured lists together, to keep every worker busy.
      const from = evaluated.indexOf(need);
      const batch = evaluated.slice(from).filter((c) => !c.stops && !exclude.has(c.idx.join(','))).slice(0, 3);
      log(`stop lineups for the lists ranked ${batch.map((c) => evaluated.indexOf(c) + 1).join(', ')}`);
      await Promise.all(batch.map(withStops));
      continue;
    }
    // Too few lists to choose from: measure the next batch, past the budget if need be.
    if ((finalists.length < want || others.length < S.runnersUp) && screenAt < top.length) { await nextCheap(S.listsCheap); continue; }
    const lastFinalist = finalists[finalists.length - 1];
    const fr = frontier();
    budgetHit = !!fr && !!lastFinalist && compare(fr, lastFinalist) < 0;
    return { finalists, others };
  }
}

const rejected = new Set<string>();
let picked = await settle(rejected, S.finalists);

// 7. Fresh seeds.
log('fresh seeds: classic baseline');
const freshClassicPhases = await measurePhases(CLASSIC_PHASES, SEEDS.freshPhases);
const freshClassic = CLASSIC_PHASES.map((p) => phaseStats(p, freshClassicPhases.get(p.key)!));
const freshClassicFull = await listMatches(null, SEEDS.freshMatches);
const freshBase = baselineFrom(freshClassic, freshClassicFull);
type Confirmation = { c: Candidate; fresh: Candidate; held: boolean; lost: string[] };
const confirmations: Confirmation[] = [];
const replaced: { list: Candidate; lost: string[] }[] = [];
for (let guard = 0; guard < S.confirmRounds; guard++) {
  const todo = picked.finalists.filter((f) => !confirmations.some((x) => x.c === f));
  if (todo.length === 0) break;
  log(`fresh seeds for ${todo.length} finalist${todo.length === 1 ? '' : 's'}`);
  const union = [...new Set(todo.flatMap((f) => f.idx))].map((i) => ELIGIBLE[i]);
  const fm = await measurePhases(union, SEEDS.freshPhases);
  await Promise.all(todo.map(async (f) => {
    const ps = f.idx.map((i) => ELIGIBLE[i]);
    // The order stays the selected one: the list is fixed once chosen.
    const fresh: Candidate = { idx: f.idx, phases: ps.map((p) => phaseStats(p, fm.get(p.key)!)), liveKept: f.liveKept, maxStep: f.maxStep };
    [fresh.full, fresh.stops] = await Promise.all([listMatches(reqsOf(f), SEEDS.freshMatches), stopMatches(reqsOf(f), SEEDS.freshStops)]);
    fresh.verdict = judgeList(fresh, freshBase);
    const lost = RANKS.filter((r) => f.verdict![r].met && !fresh.verdict![r].met);
    confirmations.push({ c: f, fresh, held: lost.length === 0, lost: [...lost] });
  }));
  const failed = confirmations.filter((x) => !x.held && picked.finalists.includes(x.c));
  // Out of rounds: keep these finalists, and the report shows what each lost.
  if (failed.length === 0 || guard === S.confirmRounds - 1) break;
  for (const x of failed) { rejected.add(x.c.idx.join(',')); replaced.push({ list: x.c, lost: x.lost }); }
  picked = await settle(rejected, S.finalists);
}
const confirmOf = (c: Candidate) => confirmations.find((x) => x.c === c)!;

// 8. The report.
writeFinalists();
finish(0);

/* ---------- Report sections ---------- */

function writeFinalists(): void {
  const rankName: Record<(typeof RANKS)[number], string> = { hard: 'Hard: match length', r1: '1. Laying down isn\'t winning', r2: '2. Seat fairness', r3: '3. Smooth curve', r4: '4. Slower opening', r5: '5. Decisions matter', r6: '6. Comebacks' };
  const keptOf = (c: Candidate) => c.idx.map((i) => ELIGIBLE[i]).filter((p) => p.kind === 'kept').map((p) => p.text);
  const listTable = (c: Candidate) => {
    const lines = ['| Stage | Requirement | Turns to complete | Same-turn exit | Next-turn exit | Decision gap | Wild dependence |', '|---|---|---|---|---|---|---|'];
    c.phases.forEach((p, i) => lines.push(`| L${i + 1} | ${p.text} | ${ci(p.turns, num2)} | ${ci(p.same)} | ${ci(p.next)} | ${ci(p.gap, (v) => (v * 100).toFixed(1))} | ${ci(p.wildDep, num2)} |`));
    return lines;
  };
  const verdictTable = (v: Verdict) => ['| Target | Met | Measured |', '|---|---|---|', ...RANKS.map((r) => `| ${rankName[r]} | ${v[r].met ? (v[r].marginal ? 'Yes (marginal)' : 'Yes') : '**No**'} | ${v[r].detail} |`)];
  const fullTable = (d: ListData, stops?: StopData[]) => {
    const ff = fullFigures(d);
    const lines = [
      `Four Professor Hoots, ${d.matches} matches: rounds per match mean ${ci(ff.rounds, num2)}, median ${ff.roundsMedian}, 90th percentile ${ff.roundsP90}; total own turns per match (all players) mean ${ci(ff.turns, (v) => v.toFixed(1))}, median ${ff.turnsMedian}, 90th percentile ${ff.turnsP90}. Stalled ${d.stalled}, illegal moves ${d.illegal}.`, '',
      `Seat round-win rate (seat 1 opens round 1): ${ff.seatWin.map((x, i) => `seat ${i + 1} ${ci(x)}`).join('; ')}. Advancement rate: ${ff.seatAdv.map((x, i) => `seat ${i + 1} ${ci(x)}`).join('; ')}. Leader after round 5 doesn't win: ${ci(ff.comeback)} of ${d.leaderCounted} matches with a single leader.`, '',
      '| Stage | Lay-downs | Same-turn exit | Next-turn exit |', '|---|---|---|---|',
      ...d.lays.map((l, i) => `| ${d === classicFull || d === freshClassicFull ? "C" : "L"}${i + 1} | ${l} | ${ci(ff.same[i])} | ${ci(ff.next[i])} |`), '',
    ];
    if (stops) {
      lines.push('| Stop | Lineup | Matches | Rotations | Human-seat win rate | Target (MAP2_SPEC §6.4, for information) | Seat round-win rates | Seat advancement rates | Stalled | Illegal |', '|---|---|---|---|---|---|---|---|---|---|');
      const TARGETS: Record<string, string> = { g1: '40–55%', a1: '35–50%', b1: '35–50%', a2: '30–45%', b2: '30–45%', g2: '25–40%', g3: '15–30%' };
      for (const s of stops) {
        const stop = GLADE_STOPS.find((x) => x.id === s.id)!;
        lines.push(`| ${s.id.toUpperCase()} ${stop.place} | ${stop.lineup.map((b) => BOTS[b].name).join(', ')} | ${s.matches} | ${s.rotations} | ${ci(rate(s.humanWins, s.matches))} | ${TARGETS[s.id]} | ${s.seatRoundWins.map((w) => pct(w / s.roundsPlayed)).join(' / ')} | ${s.seatAdv.map((a) => pct(a / s.roundsPlayed)).join(' / ')} | ${s.stalled} | ${s.illegal} |`);
      }
      lines.push('');
    }
    return lines;
  };

  report.push('## 4. The finalists', '');
  report.push(`${validLists.toLocaleString('en-US')} of the ${(3268760).toLocaleString('en-US')} ways to pick 10 of the 25 eligible phases make a valid list (§4.1). Each was scored on the targets its phases' own measurements can decide; the leading ${evaluated.length} were then played in whole matches with four Hoots, and the leading ${evaluated.filter((c) => c.stops).length} also at every Map 2 stop lineup. Lists are ranked by the targets met in rank order (the hard limit first), then by live phases kept, then by the smallest largest step. Ranks 1 and 2 and the hard limit are judged on whole matches. A target counts as met on its measured value; "marginal" means its 95% interval crosses the limit. Each pair of finalists differs by at least 2 phases.`, '');
  report.push(`The top ${S.maxCheap} lists from the screen are all played in whole matches, and the finalists and next-best lists are chosen from those. A list's screen score counts the hard limit, rank 6 and the whole-match parts of ranks 1 and 2 as met, so it is only a guide: whole matches can move a list either way. ${budgetHit ? '**The best list outside the budget scores at least as well as a finalist on what its phases alone show**, so a list further down the screen could meet more targets than these.' : 'The best list outside the budget scores below every finalist on what its phases alone show.'}`, '');
  if (replaced.length > 0) {
    report.push('Lists replaced after failing on fresh seeds:', '');
    for (const r of replaced) report.push(`- ${r.list.phases.map((p) => p.text).join(' → ')}: lost ${r.lost.map((x) => rankName[x as (typeof RANKS)[number]]).join(', ')}.`);
    report.push('');
  }
  const unmetAll = picked.finalists.some((f) => RANKS.some((r) => !f.verdict![r].met));
  if (unmetAll) report.push('**Fewer than 3 lists meet every target.** The places are filled by the ranking, and each unmet target is marked **No**.', '');
  picked.finalists.forEach((f, n) => {
    const letter = String.fromCharCode(65 + n);
    const conf = confirmOf(f);
    report.push(`### Finalist ${letter}`, '');
    report.push(...listTable(f), '');
    report.push(`Keeps ${keptOf(f).length} of the 6 kept live phases: ${keptOf(f).join(', ') || 'none'}.`, '');
    report.push('**Targets (selection seeds)**', '', ...verdictTable(f.verdict!), '');
    report.push('**Whole matches (selection seeds)**', '', ...fullTable(f.full!, f.stops), '');
    report.push(`**Fresh seeds:** ${conf.held ? 'every target met during selection is still met.' : `lost ${conf.lost.join(', ')}.`}`, '', ...verdictTable(conf.fresh.verdict!), '', ...listTable(conf.fresh), '', ...fullTable(conf.fresh.full!, conf.fresh.stops), '');
  });

  report.push('## 5. Baselines', '', '### The classic list', '', ...fullTable(classicFull, classicStops), '### The live Moonlit list', '');
  const liveKey = (reqs: GroupReq[]) => MEASURED.find((m) => JSON.stringify(m.reqs) === JSON.stringify(reqs))!.key;
  const live: Candidate = { idx: [], phases: LIVE_LIST.map((reqs) => stats.get(liveKey(reqs))!), liveKept: 10, maxStep: 0, full: liveFull, stops: liveStops };
  live.verdict = judgeList(live, base);
  report.push('In its game order:', '', ...listTable(live), '', ...verdictTable(live.verdict), '', ...fullTable(liveFull, liveStops));
  report.push('### Classic on fresh seeds', '', ...fullTable(freshClassicFull), '');

  report.push('## 6. The next-best lists', '');
  report.push('| # | List | Why not a finalist |', '|---|---|---|');
  picked.others.forEach((c, i) => {
    const close = picked.finalists.find((f) => differ(f.idx, c.idx) < 2);
    const lost = RANKS.filter((r) => !c.verdict![r].met).map((r) => rankName[r]);
    const why = close
      ? `Differs from Finalist ${String.fromCharCode(65 + picked.finalists.indexOf(close))} by only ${differ(close.idx, c.idx)} phase.`
      : lost.length > 0 ? `Misses ${lost.join(', ')}.` : `Meets as many targets, but ranks lower on live phases kept (${c.liveKept}) or the largest step (${num2(c.maxStep)}×).`;
    report.push(`| ${i + 1} | ${c.phases.map((p) => p.text).join(' → ')} | ${why} |`);
  });
  report.push('');

  report.push('## 7. Sample sizes and seeds', '');
  report.push(`- Cross-check: ${S.hands.toLocaleString('en-US')} hands per reference phase; seed base ${SEEDS.cross}.`);
  report.push(`- Per phase: chains until at least ${S.rounds.toLocaleString('en-US')} rounds per phase, each round also replayed with the random-discard variant on the same seed; seed bases ${SEEDS.phases}–${SEEDS.phases + MEASURED.length - 1} (one per phase). Fresh seeds: ${SEEDS.freshPhases}–${SEEDS.freshPhases + MEASURED.length - 1}.`);
  report.push(`- Whole matches with four Hoots: ${S.matches.toLocaleString('en-US')} per list; seed base ${SEEDS.matches}, fresh ${SEEDS.freshMatches}. Every list uses the same seeds, so lists are compared on the same deals.`);
  report.push(`- Stop lineups: ${S.stopMatches.toLocaleString('en-US')} matches per stop, split evenly over its rotations (3 at G1, 4 at A1–G2, the boss's fixed seating at G3); seed bases ${SEEDS.stops} + 10 × stop + rotation, fresh ${SEEDS.freshStops} + 10 × stop + rotation.`);
  report.push(`- Seeds are 32 hex digits: the seed base, then the chain or match number, then the round number. Workers: ${workerCount}. Results don't depend on the worker count.`, '');
  data.finalists = picked.finalists.map((f) => f.idx.map((i) => ELIGIBLE[i].text));
  data.runnersUp = picked.others.map((f) => f.idx.map((i) => ELIGIBLE[i].text));
}

}
}

function writePerPhase(): void {
  report.push('## 3. Per-phase measurements', '');
  report.push(`Each round has four Professor Hoots. One seat attempts the phase being measured; the other three play a fixed mix of classic phases, the same for every phase measured. The measured seat moves through all four seating positions, equally often by chain. A chain is one player working at one phase over fresh rounds until they complete it; chains continue until each phase has at least ${S.rounds.toLocaleString('en-US')} rounds. Turns to complete counts every own turn spent on the phase, across rounds, up to the lay-down. All intervals are 95%.`, '');
  report.push('Decision gap: the measured seat\'s round-win rate as Hoot minus as "Hoot (random discards)", on the same seeds, in points. Wild dependence: turns per completion in rounds dealt no Wilds, divided by the same in rounds dealt two or more. Seat effect: round-win rate in each of the four positions (position 1 opens the round).', '');
  report.push('| Phase | Group | Rounds | Mean rounds to complete | Turns to complete: mean | Median | 90th pct | By own turn 1 | By 2 | By 3 | Later | Same-turn exit | Next-turn exit | Wild dependence | Decision gap (points) | Seat effect (positions 1–4) | Stalled |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const kindName = { kept: 'Kept', new: 'New', dropped: 'Dropped (comparison)', classic: 'Classic (comparison)' };
  for (const p of MEASURED) {
    const s = phaseStatsOf(p);
    if (!s) continue;
    const label = p.kind === 'classic' ? `C${CLASSIC_PHASES.indexOf(p) + 1} ${p.text}` : p.text;
    report.push(`| ${label} | ${kindName[p.kind]} | ${s.data.rounds} | ${ci(s.meanRounds, num2)} | ${ci(s.turns, num2)} | ${s.turnsMedian} | ${s.turnsP90} | ${ci(s.by[0])} | ${ci(s.by[1])} | ${ci(s.by[2])} | ${ci(s.later)} | ${ci(s.same)} | ${ci(s.next)} | ${ci(s.wildDep, num2)} | ${ci(s.gap, (v) => (v * 100).toFixed(1))} | ${s.seatWin.map((x) => ci(x)).join('; ')} | ${s.data.stalled + s.data.illegal + s.data.capped} |`);
  }
  report.push('');
  const finale = LIVE_LIST.slice(5, 9);
  report.push(`For rank 7 (report only), the live list's L6 to L9 for comparison with a finale's Wild dependence: ${finale.map((reqs) => { const p = MEASURED.find((m) => JSON.stringify(m.reqs) === JSON.stringify(reqs))!; const s = phaseStatsOf(p)!; return `${p.text} ${ci(s.wildDep, num2)}`; }).join('; ')}.`, '');
}

function phaseStatsOf(p: PoolPhase): PhaseStats | undefined {
  return STATS.get(p.key);
}
