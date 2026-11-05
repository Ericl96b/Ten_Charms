// Plays one share of the Moonlit refinement simulation on its own thread (Change Request 03).
// Every job is deterministic from its own fields, so results never depend on the number of workers.
import { parentPort } from 'node:worker_threads';
import { evaluate, tally, trackedUnseen } from '../../src/bots/analysis.ts';
import { decide, type BotId } from '../../src/bots/profiles.ts';
import { createDeck } from '../../src/engine/cards.ts';
import { createGame, nextRound, step } from '../../src/engine/game.ts';
import { observe } from '../../src/engine/observation.ts';
import { PHASES, findArrangement, phaseSequence } from '../../src/engine/phases.ts';
import { createRng, shuffle } from '../../src/engine/rng.ts';
import type { GameEvent, GameState, GroupReq, MatchRules } from '../../src/engine/types.ts';
import { canGoOut, canLayDown } from './judge.ts';
import { randomDiscardHoot } from './random-discard-bot.ts';
import { addPair, add, bump, pairSums, sums, type Histogram, type Pair, type Sums } from './stats.ts';

const MAX_ACTIONS_PER_ROUND = 6000;
const MAX_ROUNDS = 400;
/** A chain that hasn't completed its phase after this many rounds is cut off and counted. */
const CHAIN_CAP = 100;
/** The scratch id a measured non-classic phase uses: it is on the Moonlit path, and no opponent ever plays it. */
const MEASURED_ID = 11;

/** A 32-digit hex seed from three parts, so every seed in the run is distinct. */
export const mkSeed = (base: number, a: number, b: number): string =>
  base.toString(16).padStart(8, '0') + a.toString(16).padStart(12, '0') + b.toString(16).padStart(12, '0');

const dice = (seed: string, nonce: number) => { const r = createRng(seed, nonce); return () => r.next() / 0x100000000; };

export type CrossJob = { kind: 'cross'; key: string; reqs: GroupReq[]; classicId?: number; from: number; to: number; seedBase: number };
export type PhaseJob = { kind: 'phase'; key: string; reqs: GroupReq[]; classicId?: number; from: number; to: number; seedBase: number };
export type ListJob = { kind: 'list'; key: string; list: GroupReq[][] | null; from: number; to: number; seedBase: number };
export type StopJob = { kind: 'stop'; key: string; lineup: BotId[]; human: number; rules: MatchRules; list: GroupReq[][] | null; from: number; to: number; seedBase: number };
export type Job = CrossJob | PhaseJob | ListJob | StopJob;

export type CrossResult = { kind: 'cross'; key: string; hands: number; judge: number; solver: number; disagree: number; examples: string[] };

export type Sanity = {
  /** Turns sampled: each of the measured Hoot's play stages. */
  decisions: number;
  /** Turns before laying down, where a legal lay-down existed (judged independently), and those Hoot missed. */
  layLegal: number; layMiss: number;
  /** Turns Hoot saw a lay-down but held it back on purpose. */
  holds: number;
  /** Turns where the judge found a way out, and those where Hoot didn't go out. */
  outLegal: number; outMiss: number;
  /** Going-out misses on the lay-down turn itself, and among those, the ones where Hoot laid down but kept cards. */
  outMissLayTurn: number;
  examples: string[];
};
export const sanity = (): Sanity => ({ decisions: 0, layLegal: 0, layMiss: 0, holds: 0, outLegal: 0, outMiss: 0, outMissLayTurn: 0, examples: [] });

export type PhaseResult = {
  kind: 'phase'; key: string;
  chains: number; capped: number; stalled: number; illegal: number;
  /** Rounds each chain took, and own turns spent on the phase, as histograms. */
  chainRounds: Histogram; chainTurns: Histogram;
  rounds: number; completions: number;
  /** Rounds completed on own turn 1, 2, 3, and later. */
  byTurn: [number, number, number, number];
  lays: number; sameExit: number; nextExit: number;
  wins: number; winsByPos: number[]; roundsByPos: number[];
  /** Per round: own turns spent (x) and completed or not (y), by Wilds dealt: 0, 1, 2 or more. */
  wild: [Pair, Pair, Pair];
  /** Per round: Hoot's round win minus the random-discard variant's, on the same seed. */
  gap: Sums; variantWins: number;
  sanity: Sanity;
};

export type ListResult = {
  kind: 'list'; key: string;
  matches: number; stalled: number; illegal: number;
  roundsHist: Histogram; turnsHist: Histogram;
  seatRoundWins: number[]; seatAdv: number[]; roundsPlayed: number;
  /** Per list position: lay-downs, same-turn exits and next-turn exits, inside whole matches. */
  lays: number[]; sameExit: number[]; nextExit: number[];
  /** Matches with a single leader after round 5, and how many of those the leader didn't win. */
  leaderCounted: number; comebacks: number;
  seatMatchWins: number[];
};

export type StopResult = {
  kind: 'stop'; key: string;
  matches: number; stalled: number; illegal: number; humanWins: number;
  seatRoundWins: number[]; seatAdv: number[]; roundsPlayed: number;
  roundsHist: Histogram;
};

export type Result = CrossResult | PhaseResult | ListResult | StopResult;

function runCross(job: CrossJob): CrossResult {
  const id = job.classicId ?? MEASURED_ID;
  if (job.classicId === undefined) PHASES[MEASURED_ID] = job.reqs;
  let judge = 0, solver = 0, disagree = 0;
  const examples: string[] = [];
  for (let i = job.from; i < job.to; i++) {
    const hand = shuffle(createDeck(), createRng(mkSeed(job.seedBase, i, 0), 0)).slice(0, 11);
    const a = canLayDown(hand, job.reqs);
    const b = findArrangement(hand, id) !== null;
    if (a) judge++;
    if (b) solver++;
    if (a !== b) { disagree++; if (examples.length < 3) examples.push(JSON.stringify(hand)); }
  }
  return { kind: 'cross', key: job.key, hands: job.to - job.from, judge, solver, disagree, examples };
}

const describe = (state: GameState, seat: number) =>
  JSON.stringify({ seed: state.matchSeed, round: state.round, hand: state.players[seat].hand, laid: state.players[seat].laidDown, groups: state.groups.map((g) => ({ t: g.type, c: g.cards.map((p) => p.card) })) });

/**
 * Plays one round to its end. Seat `m` is played by Hoot or by the random-discard variant; every other seat by Hoot.
 * With `san`, Hoot's decisions at seat `m` are checked against the independent judge.
 */
function playRound(state: GameState, m: number, id: number, variant: boolean, rand: () => number, pick: () => number, san: Sanity | null): 'ok' | 'stalled' | 'illegal' {
  const me = state.players[m];
  let actions = 0;
  let sampled = -1;
  let wantOut = false, sawLay = false, laidThisTurn = false, downAtStart = false;
  while (state.stage === 'draw' || state.stage === 'play') {
    if (++actions > MAX_ACTIONS_PER_ROUND) return 'stalled';
    const seat = state.current;
    if (san && seat === m && state.stage === 'play' && me.turns !== sampled) {
      sampled = me.turns ?? 0;
      san.decisions++;
      wantOut = false; sawLay = false; laidThisTurn = false; downAtStart = me.laidDown;
      const reqs = PHASES[id];
      if (!me.laidDown && canLayDown(me.hand, reqs)) {
        san.layLegal++;
        const obs = observe(state, m);
        const sees = evaluate(tally(obs.hand), id, trackedUnseen(obs)).missing === 0 && findArrangement(obs.hand, id) !== null;
        if (!sees) { san.layMiss++; if (san.examples.length < 5) san.examples.push(`lay ${describe(state, m)}`); } else sawLay = true;
      }
      if (canGoOut(me.hand, reqs, me.laidDown, state.groups, m)) { san.outLegal++; wantOut = true; }
    }
    const obs = observe(state, seat);
    const action = seat === m && variant ? randomDiscardHoot(obs, rand, pick) : decide('hoot', obs, rand);
    const result = step(state, action);
    if (!result.ok) return 'illegal';
    if (san && seat === m && sampled >= 0) {
      let ended = false, out = false;
      for (const e of result.events as GameEvent[]) {
        if (e.type === 'layDown' && e.seat === m) laidThisTurn = true;
        if (e.type === 'goOut' && e.seat === m) { out = true; ended = true; }
        if (e.type === 'discard' && e.seat === m) ended = true;
      }
      if (ended) {
        if (wantOut && !out) { san.outMiss++; if (!downAtStart) san.outMissLayTurn++; if (san.examples.length < 5) san.examples.push(`out ${describe(state, m)}`); }
        if (sawLay && !laidThisTurn) san.holds++;
        wantOut = false; sawLay = false; sampled = me.turns ?? 0;
      }
    }
  }
  return 'ok';
}

function newRound(seed: string, m: number, id: number, chain: number, r: number): GameState {
  const { state } = createGame({ playerCount: 4, seed });
  state.players.forEach((p, seat) => { p.phase = seat === m ? id : 1 + ((chain * 3 + r * 7 + seat) % 10); });
  return state;
}

function runPhase(job: PhaseJob): PhaseResult {
  const id = job.classicId ?? MEASURED_ID;
  if (job.classicId === undefined) PHASES[MEASURED_ID] = job.reqs;
  const out: PhaseResult = {
    kind: 'phase', key: job.key, chains: 0, capped: 0, stalled: 0, illegal: 0, chainRounds: {}, chainTurns: {},
    rounds: 0, completions: 0, byTurn: [0, 0, 0, 0], lays: 0, sameExit: 0, nextExit: 0,
    wins: 0, winsByPos: [0, 0, 0, 0], roundsByPos: [0, 0, 0, 0],
    wild: [pairSums(), pairSums(), pairSums()], gap: sums(), variantWins: 0, sanity: sanity(),
  };
  for (let c = job.from; c < job.to; c++) {
    const m = c % 4;
    let turnsSpent = 0;
    let r = 0;
    for (;;) {
      if (r >= CHAIN_CAP) { out.capped++; break; }
      const seed = mkSeed(job.seedBase, c, r);
      const state = newRound(seed, m, id, c, r);
      const res = playRound(state, m, id, false, dice(seed, 0x626f74), dice(seed, 0x766172), out.sanity);
      if (res === 'stalled') { out.stalled++; r++; continue; }
      if (res === 'illegal') { out.illegal++; r++; continue; }
      const me = state.players[m];
      const result = state.lastRound!;
      const done = result.advanced[m];
      const won = result.wentOut === m;
      const spent = done ? me.laidTurn! : me.turns ?? 0;
      turnsSpent += spent;
      out.rounds++;
      out.roundsByPos[m]++;
      if (won) { out.wins++; out.winsByPos[m]++; }
      const wilds = (me.dealt ?? []).filter((k) => k.kind === 'wild').length;
      addPair(out.wild[Math.min(2, wilds)], spent, done ? 1 : 0);
      if (done) {
        out.completions++;
        out.byTurn[Math.min(3, me.laidTurn! - 1)]++;
        out.lays++;
        if (won && me.turns === me.laidTurn) out.sameExit++;
        if (won && (me.turns ?? 0) - me.laidTurn! <= 1) out.nextExit++;
      }
      // The same round again, with the measured seat discarding at random.
      const twin = newRound(seed, m, id, c, r);
      const tres = playRound(twin, m, id, true, dice(seed, 0x626f74), dice(seed, 0x766172), null);
      if (tres === 'ok') {
        const vWon = twin.lastRound!.wentOut === m;
        if (vWon) out.variantWins++;
        add(out.gap, (won ? 1 : 0) - (vWon ? 1 : 0));
      } else if (tres === 'stalled') out.stalled++; else out.illegal++;
      r++;
      if (done) break;
    }
    out.chains++;
    bump(out.chainRounds, r);
    bump(out.chainTurns, turnsSpent);
  }
  return out;
}

/** Writes a Moonlit-family list into the live ids inside this worker only. */
function useList(list: GroupReq[][] | null): void {
  list?.forEach((reqs, i) => { PHASES[11 + i] = reqs; });
}

function runList(job: ListJob): ListResult {
  useList(job.list);
  const variant = job.list ? 'moonlit' : 'standard';
  const seq = phaseSequence(variant);
  const out: ListResult = {
    kind: 'list', key: job.key, matches: 0, stalled: 0, illegal: 0, roundsHist: {}, turnsHist: {},
    seatRoundWins: [0, 0, 0, 0], seatAdv: [0, 0, 0, 0], roundsPlayed: 0,
    lays: new Array(10).fill(0), sameExit: new Array(10).fill(0), nextExit: new Array(10).fill(0),
    leaderCounted: 0, comebacks: 0, seatMatchWins: [0, 0, 0, 0],
  };
  for (let i = job.from; i < job.to; i++) {
    const seed = mkSeed(job.seedBase, i, 0);
    const { state } = createGame({ playerCount: 4, variant, seed });
    const rand = dice(seed, 0x626f74);
    let actions = 0, totalTurns = 0, bad: 'stalled' | 'illegal' | null = null, done = 0;
    let leader: number | null | undefined;
    const tallyRound = () => {
      const r = state.lastRound!;
      state.players.forEach((p, s) => {
        totalTurns += p.turns ?? 0;
        if (r.advanced[s]) {
          out.seatAdv[s]++;
          const pos = seq.indexOf(r.phasesBefore[s]!);
          out.lays[pos]++;
          if (r.wentOut === s && p.turns === p.laidTurn) out.sameExit[pos]++;
          if (r.wentOut === s && (p.turns ?? 0) - p.laidTurn! <= 1) out.nextExit[pos]++;
        }
      });
      if (r.wentOut >= 0) out.seatRoundWins[r.wentOut]++;
      done = state.round;
      if (state.round === 5) {
        const rank = state.players.map((p, s) => ({ s, c: p.completed.length, sc: p.score }));
        rank.sort((a, b) => b.c - a.c || a.sc - b.sc);
        leader = rank[0].c === rank[1].c && rank[0].sc === rank[1].sc ? null : rank[0].s;
      }
    };
    while (state.stage !== 'matchOver') {
      if (state.stage === 'roundOver') { if (done < state.round) tallyRound(); actions = 0; nextRound(state); continue; }
      if (++actions > MAX_ACTIONS_PER_ROUND || state.round > MAX_ROUNDS) { bad = 'stalled'; break; }
      const result = step(state, decide('hoot', observe(state, state.current), rand));
      if (!result.ok) { bad = 'illegal'; break; }
    }
    if (bad) { out[bad]++; continue; }
    if (done < state.round) tallyRound();
    out.matches++;
    out.roundsPlayed += state.round;
    bump(out.roundsHist, state.round);
    bump(out.turnsHist, totalTurns);
    for (const w of state.winners) out.seatMatchWins[w] += 1 / state.winners.length;
    if (typeof leader === 'number') {
      out.leaderCounted++;
      if (!state.winners.includes(leader)) out.comebacks++;
    }
  }
  return out;
}

function runStop(job: StopJob): StopResult {
  useList(job.list);
  const variant = job.list ? 'moonlit' : 'standard';
  const n = job.lineup.length;
  const out: StopResult = {
    kind: 'stop', key: job.key, matches: 0, stalled: 0, illegal: 0, humanWins: 0,
    seatRoundWins: new Array(n).fill(0), seatAdv: new Array(n).fill(0), roundsPlayed: 0, roundsHist: {},
  };
  for (let i = job.from; i < job.to; i++) {
    const seed = mkSeed(job.seedBase, i, 0);
    const { state } = createGame({ playerCount: n, variant, seed, rules: job.rules });
    const rand = dice(seed, 0x626f74);
    let actions = 0, bad: 'stalled' | 'illegal' | null = null, done = 0;
    const tallyRound = () => {
      const r = state.lastRound!;
      r.advanced.forEach((a, s) => { if (a) out.seatAdv[s]++; });
      if (r.wentOut >= 0) out.seatRoundWins[r.wentOut]++;
      done = state.round;
    };
    while (state.stage !== 'matchOver') {
      if (state.stage === 'roundOver') { if (done < state.round) tallyRound(); actions = 0; nextRound(state); continue; }
      if (++actions > MAX_ACTIONS_PER_ROUND || state.round > MAX_ROUNDS) { bad = 'stalled'; break; }
      const seat = state.current;
      const result = step(state, decide(job.lineup[seat], observe(state, seat), rand));
      if (!result.ok) { bad = 'illegal'; break; }
    }
    if (bad) { out[bad]++; continue; }
    if (done < state.round) tallyRound();
    out.matches++;
    out.roundsPlayed += state.round;
    bump(out.roundsHist, state.round);
    if (state.winners.includes(job.human)) out.humanWins++;
  }
  return out;
}

export function runJob(job: Job): Result {
  switch (job.kind) {
    case 'cross': return runCross(job);
    case 'phase': return runPhase(job);
    case 'list': return runList(job);
    case 'stop': return runStop(job);
  }
}

parentPort?.on('message', (job: Job) => {
  try {
    parentPort!.postMessage({ ok: true, result: runJob(job) });
  } catch (err) {
    parentPort!.postMessage({ ok: false, error: String((err as Error)?.stack ?? err) });
  }
});
