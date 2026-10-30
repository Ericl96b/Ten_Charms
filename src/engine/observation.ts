// The only view of a game a bot ever receives: its own hand plus public information.
import type { Card, GameState, HistoryEntry, LaidGroup, Stage, Variant } from './types.ts';

export type PublicPlayer = {
  seat: number;
  /** Null while phases are being picked in Choose Your Phase. */
  phase: number | null;
  completed: number[];
  laidDown: boolean;
  pendingSkip: boolean;
  score: number;
  cardCount: number;
};

export type Observation = {
  seat: number;
  hand: Card[];
  ownPhase: number | null;
  variant: Variant;
  stage: Stage;
  playerCount: number;
  current: number;
  round: number;
  players: PublicPlayer[];
  discardTop: Card | null;
  groups: LaidGroup[];
  history: HistoryEntry[];
  drawCount: number;
};

/** Builds a fresh copy, so nothing in it aliases the game. */
export function observe(state: GameState, seat: number): Observation {
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const hiding = state.stage === 'choose';
  return {
    seat,
    hand: copy(state.players[seat].hand),
    ownPhase: state.players[seat].phase,
    variant: state.variant,
    stage: state.stage,
    playerCount: state.playerCount,
    current: state.current,
    round: state.round,
    players: state.players.map((p, i) => ({
      seat: i,
      phase: hiding && i !== seat ? null : p.phase,
      completed: p.completed.slice(),
      laidDown: p.laidDown,
      pendingSkip: p.pendingSkip,
      score: p.score,
      cardCount: p.hand.length,
    })),
    discardTop: copy(state.discardPile[state.discardPile.length - 1] ?? null),
    groups: copy(state.groups),
    history: copy(state.history),
    drawCount: state.drawPile.length,
  };
}
