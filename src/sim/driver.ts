// Runs bot-only matches headlessly. Bots see the game only through observe().
import { decide, type BotId } from '../bots/profiles.ts';
import { createGame, nextRound, step } from '../engine/game.ts';
import { observe } from '../engine/observation.ts';
import { createRng } from '../engine/rng.ts';
import type { GameState, Variant } from '../engine/types.ts';

export type MatchOutcome = {
  winners: number[];
  rounds: number;
  illegal: string[];
  stalled: boolean;
  turns: number;
  reshuffles: number;
  state: GameState;
};

const MAX_ACTIONS_PER_ROUND = 6000;

export function playMatch(lineup: readonly BotId[], seed: string, variant: Variant = 'standard'): MatchOutcome {
  const { state } = createGame({ playerCount: lineup.length, variant, seed });
  const botRng = createRng(seed, 0x626f74);
  const rand = () => botRng.next() / 0x100000000;
  const illegal: string[] = [];
  let actions = 0;
  let turns = 0;
  let reshuffles = 0;
  let stalled = false;
  for (;;) {
    if (state.stage === 'matchOver') break;
    if (state.stage === 'roundOver') { actions = 0; nextRound(state); continue; }
    if (++actions > MAX_ACTIONS_PER_ROUND || state.round > 400) { stalled = true; break; }
    let seat = state.current;
    if (state.stage === 'choose') seat = state.players.findIndex((p) => p.phase === null);
    const action = decide(lineup[seat], observe(state, seat), rand);
    const result = step(state, action);
    if (!result.ok) {
      illegal.push(`${lineup[seat]}: ${JSON.stringify(action)}: ${result.reason}`);
      break;
    }
    for (const e of result.events) {
      if (e.type === 'turnStart') turns++;
      if (e.type === 'reshuffle') reshuffles++;
    }
  }
  return { winners: state.winners, rounds: state.round, illegal, stalled, turns, reshuffles, state };
}

/** Plays many two-player matches, swapping seats each time. Shared wins count half. */
export function headToHead(a: BotId, b: BotId, matches: number, seedBase: number): { rate: number; rounds: number } {
  let wins = 0;
  let rounds = 0;
  for (let i = 0; i < matches; i++) {
    const swap = i % 2 === 1;
    const lineup: BotId[] = swap ? [b, a] : [a, b];
    const seed = (seedBase * 1000003 + i).toString(16).padStart(32, '0');
    const out = playMatch(lineup, seed);
    if (out.illegal.length > 0 || out.stalled) throw new Error(`Bad match ${seed}: ${out.illegal.join('; ')} stalled=${out.stalled}`);
    rounds += out.rounds;
    const aSeat = swap ? 1 : 0;
    if (out.winners.includes(aSeat)) wins += out.winners.length > 1 ? 0.5 : 1;
  }
  return { rate: wins / matches, rounds: rounds / matches };
}
