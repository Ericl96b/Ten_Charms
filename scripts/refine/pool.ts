// The phases measured by the Moonlit refinement simulation (Change Request 03 §2).
// Requirements only. Their text comes from the engine's own labels, so it reads exactly as the game would show it.
import { PHASES, phaseSequence, phaseText } from '../../src/engine/phases.ts';
import type { GroupReq } from '../../src/engine/types.ts';

const set = (size: number): GroupReq => ({ type: 'set', size });
const run = (size: number): GroupReq => ({ type: 'run', size });
const color = (size: number): GroupReq => ({ type: 'color', size });
const colorRun = (size: number): GroupReq => ({ type: 'colorRun', size });
const evens = (size: number): GroupReq => ({ type: 'evens', size });
const odds = (size: number): GroupReq => ({ type: 'odds', size });
const pair = (): GroupReq => ({ type: 'set', size: 2, pair: true });

export type PoolKind = 'kept' | 'new' | 'dropped' | 'classic';
export type PoolPhase = { key: string; kind: PoolKind; reqs: GroupReq[]; text: string };

/** Kept from the live list (6). */
const KEPT: GroupReq[][] = [
  [evens(7)],
  [colorRun(3), set(3)],
  [set(4), color(4)],
  [colorRun(5), pair()],
  [set(3), set(3), set(3)],
  [colorRun(6)],
];

/** New candidates (19). */
const NEW: GroupReq[][] = [
  [color(6)],
  [colorRun(3), set(3), pair()],
  [colorRun(3), colorRun(3)],
  [colorRun(4), pair(), pair()],
  [set(3), color(5)],
  [evens(8)],
  [odds(8)],
  [set(3), set(3), pair()],
  [set(4), pair(), pair()],
  [colorRun(4), set(3)],
  [colorRun(3), set(4)],
  [colorRun(4), colorRun(3)],
  [set(4), color(5)],
  [colorRun(5), set(3)],
  [colorRun(4), set(4)],
  [colorRun(6), pair()],
  [colorRun(4), colorRun(4)],
  [colorRun(5), colorRun(3)],
  [colorRun(7)],
];

/** The live phases dropped from the pool, measured for comparison only. */
const DROPPED: GroupReq[][] = [
  [run(4), pair(), pair()],
  [odds(4), evens(4)],
  [pair(), pair(), pair(), pair()],
  [colorRun(4), run(4)],
];

/** A scratch id on the Moonlit path, used only to read the engine's label for a requirement list. */
const LABEL_ID = 999;
export function textOf(reqs: GroupReq[]): string {
  const before = PHASES[LABEL_ID];
  PHASES[LABEL_ID] = reqs;
  const text = phaseText(LABEL_ID);
  if (before) PHASES[LABEL_ID] = before; else delete PHASES[LABEL_ID];
  return text;
}

const entry = (kind: PoolKind, reqs: GroupReq[], i: number): PoolPhase => ({ key: `${kind}${i + 1}`, kind, reqs, text: textOf(reqs) });

export const KEPT_PHASES: PoolPhase[] = KEPT.map((r, i) => entry('kept', r, i));
export const NEW_PHASES: PoolPhase[] = NEW.map((r, i) => entry('new', r, i));
/** The 25 phases a list may be built from. */
export const ELIGIBLE: PoolPhase[] = [...KEPT_PHASES, ...NEW_PHASES];
export const DROPPED_PHASES: PoolPhase[] = DROPPED.map((r, i) => entry('dropped', r, i));
/** The classic list in its order, with the classic labels. */
export const CLASSIC_PHASES: PoolPhase[] = phaseSequence('standard').map((id, i) => ({ key: `classic${i + 1}`, kind: 'classic', reqs: PHASES[id], text: phaseText(id) }));
/** Every phase measured: 25 eligible, 4 dropped, 10 classic. */
export const MEASURED: PoolPhase[] = [...ELIGIBLE, ...DROPPED_PHASES, ...CLASSIC_PHASES];

/** The live Moonlit list as the game plays it, in order. */
export const LIVE_LIST: GroupReq[][] = phaseSequence('moonlit').map((id) => PHASES[id]);

export const hasColorRun = (reqs: readonly GroupReq[]): boolean => reqs.some((r) => r.type === 'colorRun');
export const hasParity = (reqs: readonly GroupReq[]): boolean => reqs.some((r) => r.type === 'evens' || r.type === 'odds');
export const cardsNeeded = (reqs: readonly GroupReq[]): number => reqs.reduce((n, r) => n + r.size, 0);
