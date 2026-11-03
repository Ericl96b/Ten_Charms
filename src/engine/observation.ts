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
  /** Left out entirely in the fog, for every player. */
  cardCount?: number;
  /** For players who have laid down this round: 1 for the first to do so, and so on. */
  laidOrder?: number;
  /** For players who have laid down this round: how many of their own turns they have started since. */
  turnsSinceLay?: number;
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
  /** This player's own hand as it was dealt this round. */
  dealt: Card[];
  /** Present, and true, only under Moonlit Fog. */
  fog?: true;
  /** Present only under the Thorned Crown: the seat whose groups only it may add to. */
  crownSeat?: number;
};

/** Builds a fresh copy, so nothing in it aliases the game. */
export function observe(state: GameState, seat: number): Observation {
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const hiding = state.stage === 'choose';
  const fog = state.rules?.fog === true;
  const crown = state.rules?.crownSeat;
  return {
    seat,
    hand: copy(state.players[seat].hand),
    ownPhase: state.players[seat].phase,
    variant: state.variant,
    stage: state.stage,
    playerCount: state.playerCount,
    current: state.current,
    round: state.round,
    players: state.players.map((p, i) => {
      const pub: PublicPlayer = {
        seat: i,
        phase: hiding && i !== seat ? null : p.phase,
        completed: p.completed.slice(),
        laidDown: p.laidDown,
        pendingSkip: p.pendingSkip,
        score: p.score,
      };
      if (!fog) pub.cardCount = p.hand.length;
      if (p.laidDown && p.laidOrder !== undefined) {
        pub.laidOrder = p.laidOrder;
        pub.turnsSinceLay = (p.turns ?? 0) - (p.laidTurn ?? 0);
      }
      return pub;
    }),
    discardTop: copy(state.discardPile[state.discardPile.length - 1] ?? null),
    groups: copy(state.groups),
    history: copy(state.history),
    drawCount: state.drawPile.length,
    dealt: copy(state.players[seat].dealt ?? state.players[seat].hand),
    ...(fog ? { fog: true as const } : {}),
    ...(crown !== undefined ? { crownSeat: crown } : {}),
  };
}
