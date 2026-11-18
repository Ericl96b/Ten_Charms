// The Tower's simulation (TOWER_SPEC.md §8): floor win rates per tier, tuning within §8.5, whole climbs, floor
// lengths, bot strength and a stress test. Writes SIMULATION_TOWER.md and prints the tuned ladder.
// Usage: node scripts/simulate-tower.ts [--smoke] [--no-cache] [--workers=N] [--out=file]
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { BotId } from '../src/bots/profiles.ts';
import { BOTS, TOWER_HEARTS, TOWER_LADDER, type TowerTier } from '../src/content.ts';
import { TOWER_ORDER, TOWER_POOL, phaseText } from '../src/engine/phases.ts';
import { createRng } from '../src/engine/rng.ts';
import { EASY_HALF, guardianOf } from '../src/meta/tower.ts';
import type { ClimbResult, FloorResult, Job, Result, StrengthResult, StressResult } from './sim-tower-worker.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const smoke = args.includes('--smoke');
/** Every sample size is a minimum from §8.3 and §8.4. */
const S = smoke
  ? { floors: 120, strength: 80, stress: 200, climbs: 8, carlo: 5000 }
  : { floors: 2000, strength: 1000, stress: 5000, climbs: 200, carlo: 5000 };
const SEEDS = { floors: 41000, strength: 42000, stress: 43000, climbs: 44000, carlo: 45000 };
const CHUNK = 50;
const LEVER_STEPS = 3;
/**
 * A change is kept only when it brings the rate closer to its target by more than this: about half the sampling error
 * at 2,000 floors, so a change that measures the same is never kept by chance.
 */
const NOISE = 0.005;
const workerCount = Number(flag('workers') ?? Math.max(1, availableParallelism() - 2));
const outFile = flag('out') ?? (smoke ? 'test-results/sim-tower-smoke.md' : 'SIMULATION_TOWER.md');
const useCache = !args.includes('--no-cache') && !smoke;
const cacheDir = 'test-results/sim-cache/tower';
const TIERS = 6;

/** §8.3: ordinary floor range and Guardian minimum, per tier (Tier 6 covers every tier above). */
const TARGETS = [
  { lo: 0.85, hi: 0.92, guardian: 0.70 },
  { lo: 0.80, hi: 0.88, guardian: 0.65 },
  { lo: 0.75, hi: 0.84, guardian: 0.60 },
  { lo: 0.70, hi: 0.80, guardian: 0.55 },
  { lo: 0.66, hi: 0.76, guardian: 0.51 },
  { lo: 0.62, hi: 0.72, guardian: 0.47 },
];
const CLIMB = { medianLo: 22, medianHi: 35, p75: 35, p90: 45 };

/* ---------- Cache ---------- */

async function codeHash(): Promise<string> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { metafile } = await build({
    absWorkingDir: root, entryPoints: ['scripts/sim-tower-worker.ts'], bundle: true, write: false, metafile: true,
    packages: 'external', platform: 'node', format: 'esm', outdir: 'unused', logLevel: 'silent',
  });
  const hash = createHash('sha256').update(JSON.stringify({ node: process.versions.node.split('.')[0] }));
  for (const file of Object.keys(metafile.inputs).sort()) hash.update(file).update(readFileSync(join(root, file)));
  return hash.digest('hex');
}
const CODE = await codeHash();
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

type Task = { job: Job; done: (r: Result) => void; fail: (e: Error) => void };
const queue: Task[] = [];
const idle: (Worker & { give?: () => void })[] = [];
const pool = Array.from({ length: workerCount }, () => {
  const worker: Worker & { give?: () => void } = new Worker(new URL('./sim-tower-worker.ts', import.meta.url));
  let current: Task | null = null;
  worker.give = () => {
    current = queue.shift() ?? null;
    if (current) worker.postMessage(current.job); else idle.push(worker);
  };
  worker.on('message', (msg: { ok: boolean; result?: Result; error?: string }) => {
    const task = current!;
    if (msg.ok) task.done(msg.result!); else task.fail(new Error(msg.error));
    worker.give!();
  });
  worker.on('error', (err) => { console.error(err); process.exit(1); });
  idle.push(worker);
  return worker;
});
function runAll(jobs: Job[]): Promise<Result[]> {
  const out = Promise.all(jobs.map((job) => new Promise<Result>((done, fail) => { queue.push({ job, done, fail }); })));
  while (idle.length > 0 && queue.length > 0) idle.shift()!.give!();
  return out;
}
const chunks = (n: number) => Array.from({ length: Math.ceil(n / CHUNK) }, (_, k) => [k * CHUNK, Math.min(n, (k + 1) * CHUNK)] as const);

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1)} min] ${msg}`);
let measured = 0;

/* ---------- Measuring ---------- */

type Rate = { wins: number; played: number; rounds: number[]; problems: string[] };
const value = (r: Rate) => r.wins / r.played;

/** Win rate on a set of floors with one ladder. Only the tiers those floors read go into the cache key. */
async function floors(ladder: readonly TowerTier[], list: number[], base: number): Promise<Rate> {
  const tiers = [...new Set(list.map((f) => Math.min(Math.ceil(f / 10), ladder.length)))];
  const unit = { list, base, n: S.floors, setups: tiers.flatMap((t) => [t - 1 >= 1 ? ladder[t - 2] : null, ladder[t - 1]]) };
  const hit = cached<Rate>(unit);
  if (hit) return hit;
  const results = (await runAll(chunks(S.floors).map(([from, to]) => ({ kind: 'floors', ladder, floors: list, from, to, base })))) as FloorResult[];
  const total: Rate = { wins: 0, played: 0, rounds: [], problems: [] };
  for (const r of results) {
    total.wins += r.wins;
    total.played += r.played;
    r.rounds.forEach((c, k) => { total.rounds[k] = (total.rounds[k] ?? 0) + c; });
    total.problems.push(...r.problems);
  }
  total.rounds = Array.from(total.rounds, (v) => v ?? 0);
  measured += total.played;
  store(unit, total);
  return total;
}

const ordinaryFloors = (t: number) => Array.from({ length: 9 }, (_, k) => (t - 1) * 10 + 1 + k);
/** Tier 6's setup covers every tier above, so its Guardian floor is measured with both Guardians. */
const guardianFloors = (t: number) => (t < TIERS ? [[t * 10]] : [[60], [70]]);
const ordinary = (ladder: readonly TowerTier[], t: number) => floors(ladder, ordinaryFloors(t), SEEDS.floors + t);
const guardians = (ladder: readonly TowerTier[], t: number) => Promise.all(guardianFloors(t).map((f) => floors(ladder, f, SEEDS.floors + 100 + f[0])));

/* ---------- Bot strength, for the pool lever ---------- */

async function strengths(): Promise<Map<BotId, number>> {
  const bots = [...new Set(TOWER_LADDER.flatMap((t) => t.pool))].filter((b) => b !== 'hoot');
  const out = new Map<BotId, number>();
  for (const bot of bots) {
    const unit = { strength: bot, n: S.strength };
    let rate = cached<number>(unit);
    if (rate === null) {
      const rs = (await runAll(chunks(S.strength).map(([from, to]) => ({ kind: 'strength', bot, from, to, base: SEEDS.strength })))) as StrengthResult[];
      rate = rs.reduce((n, r) => n + r.wins, 0) / S.strength;
      store(unit, rate);
    }
    out.set(bot, rate);
  }
  // Hoot against himself wins half; he's the measuring stick.
  out.set('hoot', 0.5);
  return out;
}

/* ---------- Tuning (§8.5) ---------- */

type Step = { tier: number; lever: string; change: string; before: number; after: number; kept: boolean };
const steps: Step[] = [];
const copyLadder = (l: readonly TowerTier[]): TowerTier[] => l.map((t) => ({ ...t, pool: t.pool.slice(), guardian: { ...t.guardian } }));
const fogStart = (l: readonly TowerTier[]) => { const i = l.findIndex((t) => t.fog); return i < 0 ? TIERS + 1 : i + 1; };
function setFogStart(l: TowerTier[], start: number): void { l.forEach((t, i) => { t.fog = i + 1 >= start; }); }

function distance(rate: number, lo: number, hi: number): number {
  return rate < lo ? lo - rate : rate > hi ? rate - hi : 0;
}

/** Candidate changes for one tier, by lever, in §8.5's order. `harder` when her rate is too high. */
function candidates(l: readonly TowerTier[], t: number, harder: boolean, hoot: Map<BotId, number>): { lever: string; change: string; apply: (x: TowerTier[]) => void }[] {
  const me = l[t - 1];
  const strong = (b: BotId) => hoot.get(b)!; // lower = stronger
  const out: { lever: string; change: string; apply: (x: TowerTier[]) => void }[] = [];
  const byStrength = me.pool.slice().sort((a, b) => strong(a) - strong(b));
  const neighbour = harder ? l[t] : l[t - 2];
  if (harder) {
    if (me.pool.length > me.opponents) { const b = byStrength[byStrength.length - 1]; out.push({ lever: '1 pools', change: `remove ${BOTS[b].name}`, apply: (x) => { x[t - 1].pool = x[t - 1].pool.filter((y) => y !== b); } }); }
    const add = neighbour?.pool.filter((b) => !me.pool.includes(b) && strong(b) < strong(byStrength[byStrength.length - 1])).sort((a, b) => strong(a) - strong(b))[0];
    if (add) out.push({ lever: '1 pools', change: `add ${BOTS[add].name} from Tier ${t + 1}`, apply: (x) => { x[t - 1].pool.push(add); } });
    if (me.opponents < 3 && (t === TIERS || l[t].opponents >= me.opponents + 1)) out.push({ lever: '2 opponents', change: `opponents ${me.opponents} → ${me.opponents + 1}`, apply: (x) => { x[t - 1].opponents++; } });
    if (!me.fog && t >= 3) out.push({ lever: '3 fog', change: `fog from Tier ${t}`, apply: (x) => setFogStart(x, t) });
  } else {
    if (me.pool.length > me.opponents) { const b = byStrength[0]; out.push({ lever: '1 pools', change: `remove ${BOTS[b].name}`, apply: (x) => { x[t - 1].pool = x[t - 1].pool.filter((y) => y !== b); } }); }
    const add = neighbour?.pool.filter((b) => !me.pool.includes(b) && strong(b) > strong(byStrength[0])).sort((a, b) => strong(b) - strong(a))[0];
    if (add) out.push({ lever: '1 pools', change: `add ${BOTS[add].name} from Tier ${t - 1}`, apply: (x) => { x[t - 1].pool.push(add); } });
    if (me.opponents > 1 && (t === 1 || l[t - 2].opponents <= me.opponents - 1)) out.push({ lever: '2 opponents', change: `opponents ${me.opponents} → ${me.opponents - 1}`, apply: (x) => { x[t - 1].opponents--; } });
    if (me.fog && fogStart(l) === t && t < 5) out.push({ lever: '3 fog', change: `fog from Tier ${t + 1}`, apply: (x) => setFogStart(x, t + 1) });
  }
  return out;
}

async function tune(start: readonly TowerTier[], hoot: Map<BotId, number>): Promise<TowerTier[]> {
  let ladder = copyLadder(start);
  let prev = 1;
  for (let t = 1; t <= TIERS; t++) {
    const target = TARGETS[t - 1];
    // No tier's rate may be higher than the tier before it.
    const hi = () => Math.max(target.lo, Math.min(target.hi, prev));
    let rate = value(await ordinary(ladder, t));
    const used = new Map<string, number>();
    for (let guard = 0; guard < 4 * LEVER_STEPS && distance(rate, target.lo, hi()) > 0; guard++) {
      const harder = rate > hi();
      const options = candidates(ladder, t, harder, hoot).filter((c) => (used.get(c.lever) ?? 0) < LEVER_STEPS && !steps.some((s) => s.tier === t && s.change === c.change && !s.kept));
      if (options.length === 0) break;
      const c = options[0];
      used.set(c.lever, (used.get(c.lever) ?? 0) + 1);
      const trial = copyLadder(ladder);
      c.apply(trial);
      const after = value(await ordinary(trial, t));
      const kept = distance(after, target.lo, hi()) < distance(rate, target.lo, hi()) - NOISE;
      steps.push({ tier: t, lever: c.lever, change: c.change, before: rate, after, kept });
      log(`Tier ${t}: ${c.change}: ${(rate * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}% ${kept ? 'kept' : 'undone'}`);
      if (kept) { ladder = trial; rate = after; }
    }
    prev = rate;

    // Guardian floors: at least the minimum, and no easier than the tier's ordinary upper bound.
    const guardianLevers: { change: string; apply: (x: TowerTier[]) => void }[] = [
      ...(t > 1 ? [{ change: 'companions from the previous tier', apply: (x: TowerTier[]) => { x[t - 1].guardian.from = 'previous'; } }] : []),
      { change: 'one fewer companion', apply: (x: TowerTier[]) => { x[t - 1].guardian.companions = Math.max(0, x[t - 1].guardian.companions - 1); } },
      { change: 'the Guardian alone', apply: (x: TowerTier[]) => { x[t - 1].guardian.companions = 0; } },
      { change: 'phases from the easier half', apply: (x: TowerTier[]) => { x[t - 1].guardian.easyPhases = true; } },
    ];
    let g = Math.min(...(await guardians(ladder, t)).map(value));
    for (const lever of guardianLevers) {
      if (g >= target.guardian) break;
      const trial = copyLadder(ladder);
      lever.apply(trial);
      if (JSON.stringify(trial[t - 1]) === JSON.stringify(ladder[t - 1])) continue;
      const after = Math.min(...(await guardians(trial, t)).map(value));
      const gHi = target.hi;
      const kept = after > g + NOISE && after <= gHi;
      steps.push({ tier: t, lever: `4 Guardian`, change: lever.change, before: g, after, kept });
      log(`Tier ${t} Guardian: ${lever.change}: ${(g * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}% ${kept ? 'kept' : 'undone'}`);
      if (kept) { ladder = trial; g = after; }
    }
  }
  return ladder;
}

/* ---------- Climbs ---------- */

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Whole climbs from the measured rates, under the real heart rules. */
function carlo(ord: number[], guard: number[], guard6: { lunaria: number; nightshade: number }): number[] {
  const rng = createRng(SEEDS.carlo.toString(16).padStart(32, '0'), 1);
  const u = () => rng.next() / 0x100000000;
  const out: number[] = [];
  for (let i = 0; i < S.carlo; i++) {
    let floor = 1;
    let hearts = TOWER_HEARTS;
    while (hearts > 0 && floor < 1000) {
      const tier = Math.ceil(floor / 10);
      const guardian = floor % 10 === 0;
      const p = guardian ? (tier < TIERS ? guard[tier - 1] : guard6[guardianOf(floor) as 'lunaria' | 'nightshade']) : ord[Math.min(tier, TIERS) - 1];
      if (u() < p) {
        if (guardian) hearts = Math.min(TOWER_HEARTS, hearts + 1);
        floor++;
      } else {
        hearts--;
      }
    }
    out.push(floor);
  }
  return out.sort((a, b) => a - b);
}

/* ---------- Run ---------- */

log(`Workers: ${workerCount}${smoke ? ' (smoke run: numbers are not final)' : ''}`);
const stressUnit = { stress: S.stress };
let stress = cached<StressResult>(stressUnit);
if (!stress) {
  const rs = (await runAll(chunks(S.stress).map(([from, to]) => ({ kind: 'stress', from, to, base: SEEDS.stress })))) as StressResult[];
  stress = { kind: 'stress', played: 0, crashes: [], illegal: [], stalled: 0, byPlayers: {}, rounds: 0 };
  for (const r of rs) {
    stress.played += r.played; stress.crashes.push(...r.crashes); stress.illegal.push(...r.illegal); stress.stalled += r.stalled; stress.rounds += r.rounds;
    for (const [k, v] of Object.entries(r.byPlayers)) stress.byPlayers[Number(k)] = (stress.byPlayers[Number(k)] ?? 0) + v;
  }
  store(stressUnit, stress);
}
log(`Stress: ${stress.played} floors, ${stress.crashes.length} crashes, ${stress.illegal.length} illegal, ${stress.stalled} stalled`);

const hoot = await strengths();
log(`Strength: ${[...hoot].map(([b, r]) => `${b} ${(r * 100).toFixed(0)}%`).join(', ')}`);

const startRates = [];
for (let t = 1; t <= TIERS; t++) startRates.push({ ord: value(await ordinary(TOWER_LADDER, t)), guard: (await guardians(TOWER_LADDER, t)).map(value) });
log('Starting ladder measured');

const final = await tune(TOWER_LADDER, hoot);
const rows = [];
for (let t = 1; t <= TIERS; t++) rows.push({ t, ord: await ordinary(final, t), guard: await guardians(final, t) });
const ordRates = rows.map((r) => value(r.ord));
const guardRates = rows.slice(0, TIERS - 1).map((r) => value(r.guard[0]));
const g6 = { lunaria: value(rows[TIERS - 1].guard[0]), nightshade: value(rows[TIERS - 1].guard[1]) };
const sim = carlo(ordRates, guardRates, g6);

const climbUnit = { climbs: S.climbs, final };
let climbs = cached<ClimbResult>(climbUnit);
if (!climbs) {
  const rs = (await runAll(Array.from({ length: S.climbs }, (_, i) => ({ kind: 'climbs', ladder: final, from: i, to: i + 1, base: SEEDS.climbs * 1000 })))) as ClimbResult[];
  climbs = { kind: 'climbs', reached: rs.flatMap((r) => r.reached), floorsPlayed: rs.reduce((n, r) => n + r.floorsPlayed, 0), problems: rs.flatMap((r) => r.problems) };
  store(climbUnit, climbs);
}
const played = climbs.reached.slice().sort((a, b) => a - b);
log(`Climbs: ${played.length} played, ${climbs.floorsPlayed} floors`);
for (const w of pool) void w.terminate();

/* ---------- Report ---------- */

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const yes = (ok: boolean) => (ok ? 'Yes' : '**No**');
const ladderText = (l: readonly TowerTier[]) => l.map((t, i) => {
  const g = t.guardian;
  return `| ${i + 1 === TIERS ? `${TIERS} and up` : i + 1} | ${t.opponents} | ${t.pool.map((b) => BOTS[b].name).join(', ')} | ${t.fog ? 'On' : 'Off'} | ${g.companions} from ${g.from === 'tier' ? 'this tier' : 'the previous tier'}${g.easyPhases ? ', easier half of the pool' : ''} |`;
}).join('\n');
const lengths = (r: Rate) => {
  const total = r.rounds.reduce((a, b) => a + b, 0);
  const m = r.rounds.reduce((a, c, k) => a + c * k, 0) / total;
  let acc = 0;
  let p90 = 0;
  for (let k = 0; k < r.rounds.length; k++) { acc += r.rounds[k]; if (acc >= 0.9 * total) { p90 = k; break; } }
  return { m, p90 };
};
const median = percentile(sim, 0.5);
const p75 = percentile(sim, 0.75);
const p90 = percentile(sim, 0.9);
const playedMedian = percentile(played, 0.5);
const buckets = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 80], [81, 120], [121, 1000]];
const problems = rows.flatMap((r) => [...r.ord.problems, ...r.guard.flatMap((g) => g.problems)]);

const report = `# Tower simulation

Generated by \`node scripts/simulate-tower.ts\`${smoke ? ' with --smoke. **The numbers in a smoke run are never final.**' : ''}. Bots see the game only through \`observe()\`. Her seat plays Professor Hoot's profile. Each floor is a fresh draw: three phases from the 25-phase pool, easiest first, and opponents from the tier's pool. A shared win she's part of counts as winning the floor. Seeds are fixed, so a rerun gives the same numbers, and every measured piece is cached in \`${cacheDir}/\`.

Workers: ${workerCount}. Floors played: ${measured + stress.played + climbs.floorsPlayed}${useCache ? ' (cached pieces included as measured when first run)' : ''}.

## Phase order (§4.3)

Mean own turns to complete, from SIMULATION_MOONLIT_REFINEMENT.md §3 (four Professor Hoots, one measured seat rotating through all positions, at least 10,000 rounds per phase, one setup for all 25). Sorted easiest first; neighbours within 5% stay in pool order. Phases 1 to ${EASY_HALF} are the easier half.

| Order | Phase |
|---|---|
${TOWER_ORDER.map((p, i) => `| ${i + 1} | ${phaseText(p)} |`).join('\n')}

## Final tier ladder

| Tier | Opponents | Pool | Moonlit Fog | Guardian floor companions |
|---|---|---|---|---|
${ladderText(final)}

Guardians: Nightshade on odd tiers, Lunaria on even tiers, each with the Thorned Crown.

## Floor win rate (§8.3)

${S.floors} floors per row, random draws and lineups.

| Tier | Ordinary floors | Target | Met | Guardian floor | Target | Met |
|---|---|---|---|---|---|---|
${rows.map((r, i) => {
  const tg = TARGETS[i];
  const o = value(r.ord);
  const names = i + 1 < TIERS ? [BOTS[guardianOf((i + 1) * 10)].name] : ['Lunaria (even tiers)', 'Nightshade (odd tiers)'];
  return r.guard.map((g, k) => {
    const gv = value(g);
    const first = k === 0;
    return `| ${first ? (i + 1 === TIERS ? `${TIERS} and up` : i + 1) : ''} | ${first ? pct(o) : ''} | ${first ? `${pct(tg.lo)}–${pct(tg.hi)}` : ''} | ${first ? yes(o >= tg.lo && o <= tg.hi) : ''} | ${names[k]}: ${pct(gv)} | at least ${pct(tg.guardian)}, at most ${pct(tg.hi)} | ${yes(gv >= tg.guardian && gv <= tg.hi)} |`;
  }).join('\n');
}).join('\n')}

No tier's ordinary rate higher than the tier before: ${yes(ordRates.every((r, i) => i === 0 || r <= ordRates[i - 1]))}.

### Starting ladder (§8.2), before tuning

| Tier | Ordinary floors | Guardian floor |
|---|---|---|
${startRates.map((r, i) => `| ${i + 1} | ${pct(r.ord)} | ${r.guard.map(pct).join(' / ')} |`).join('\n')}

### Tuning steps (§8.5)

${steps.length === 0 ? 'None were needed.' : `| Tier | Lever | Change | Before | After | Kept |\n|---|---|---|---|---|---|\n${steps.map((s) => `| ${s.tier} | ${s.lever} | ${s.change} | ${pct(s.before)} | ${pct(s.after)} | ${s.kept ? 'Yes' : 'No'} |`).join('\n')}`}

Each change was measured on its own; a change that didn't bring the rate closer to its target by more than ${(NOISE * 100).toFixed(1)} points (about half the sampling error) was undone. No bot profile, weight or rule changed, and neither did the hearts or the three-phase floor.

## Whole climbs (§8.3)

${S.carlo} climbs from the measured rates under the real heart rules, cross-checked by ${played.length} climbs played floor by floor.

| Measure | Simulated | Played | Target | Met |
|---|---|---|---|---|
| Median floor reached | ${median} | ${playedMedian} | ${CLIMB.medianLo}–${CLIMB.medianHi} | ${yes(median >= CLIMB.medianLo && median <= CLIMB.medianHi)} |
| 75th percentile | ${p75} | ${percentile(played, 0.75)} | at least ${CLIMB.p75} | ${yes(p75 >= CLIMB.p75)} |
| 90th percentile | ${p90} | ${percentile(played, 0.9)} | at least ${CLIMB.p90} | ${yes(p90 >= CLIMB.p90)} |

| Floor reached | Simulated climbs | Played climbs |
|---|---|---|
${buckets.map(([a, b]) => `| ${b >= 1000 ? `${a}+` : `${a}–${b}`} | ${pct(sim.filter((f) => f >= a && f <= b).length / sim.length)} | ${pct(played.filter((f) => f >= a && f <= b).length / Math.max(1, played.length))} |`).join('\n')}

## Floor length

Rounds per floor, ordinary floors.

| Tier | Mean rounds | 90th percentile |
|---|---|---|
${rows.map((r, i) => { const l = lengths(r.ord); return `| ${i + 1 === TIERS ? `${TIERS} and up` : i + 1} | ${l.m.toFixed(2)} | ${l.p90} |`; }).join('\n')}

## Bot strength

Professor Hoot's floor win rate against each bot, two players, ${S.strength} random three-phase floors each, seats swapped every floor. Lower means a stronger bot. The pool lever uses this order.

| Bot | Hoot wins |
|---|---|
${[...hoot].filter(([b]) => b !== 'hoot').sort((a, b) => a[1] - b[1]).map(([b, r]) => `| ${BOTS[b].name} | ${pct(r)} |`).join('\n')}

## Stress test (§8.4)

${stress.played} bot-only floors with random lists from the pool, 2 to 4 players (${Object.entries(stress.byPlayers).map(([k, v]) => `${v} at ${k}`).join(', ')}), fog on and off and the crown on and off, every bot but the wisps.

| Crashes | Illegal moves | Stalls | Mean rounds |
|---|---|---|---|
| ${stress.crashes.length} | ${stress.illegal.length} | ${stress.stalled} | ${(stress.rounds / stress.played).toFixed(2)} |

${[...stress.crashes, ...stress.illegal].slice(0, 10).map((p) => `- ${p}`).join('\n')}
Problems in the measured floors and climbs: ${problems.length + climbs.problems.length}.

## Pool

${TOWER_POOL.length} phases: ${TOWER_POOL.map(phaseText).join('; ')}.
`;
mkdirSync('test-results', { recursive: true });
writeFileSync(outFile, report);
writeFileSync(smoke ? 'test-results/tower-ladder-smoke.json' : 'test-results/tower-ladder.json', JSON.stringify(final, null, 2));
log(`Wrote ${outFile}`);
