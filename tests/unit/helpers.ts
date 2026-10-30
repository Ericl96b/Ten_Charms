import { createGame } from '../../src/engine/game.ts';
import type { Card, GameState, StepResult, Suit } from '../../src/engine/types.ts';

let nextId = 1000;
export const n = (num: number, suit: Suit = 'rose'): Card => ({ id: nextId++, kind: 'num', num, suit });
export const w = (): Card => ({ id: nextId++, kind: 'wild' });
export const s = (): Card => ({ id: nextId++, kind: 'skip' });

/** A game positioned at the given player's draw step, with hands replaced by the given cards. */
export function table(playerCount: number, hands: Card[][], over: Partial<GameState> = {}): GameState {
  const { state } = createGame({ playerCount, seed: 'ab'.repeat(16) });
  state.players.forEach((p, i) => { p.hand = hands[i] ?? [n(1), n(2)]; p.pendingSkip = false; });
  state.discardPile = [n(9, 'moss')];
  state.drawPile = [n(3, 'honey'), n(4, 'honey'), n(5, 'honey'), n(6, 'honey'), n(7, 'honey')];
  state.current = 0;
  state.stage = 'draw';
  Object.assign(state, over);
  return state;
}

export function ok(r: StepResult): Extract<StepResult, { ok: true }> {
  if (!r.ok) throw new Error(`Expected success: ${r.reason}`);
  return r;
}
