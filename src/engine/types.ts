export type Suit = 'rose' | 'moss' | 'moonstone' | 'honey';
export const SUITS: readonly Suit[] = ['rose', 'moss', 'moonstone', 'honey'];

export type NumberCard = { id: number; kind: 'num'; num: number; suit: Suit };
export type WildCard = { id: number; kind: 'wild' };
export type SkipCard = { id: number; kind: 'skip' };
export type Card = NumberCard | WildCard | SkipCard;

export type GroupType = 'set' | 'run' | 'color' | 'colorRun' | 'evens' | 'odds';
/** `pair` only changes the label: a Pair follows the Set rules. */
export type GroupReq = { type: GroupType; size: number; pair?: boolean };

export type Variant = 'standard' | 'sprint' | 'choose' | 'moonlit';

/** A placed card: what it was, and the value its position fixes it to. */
export type Placed = { card: Card; num?: number; suit?: Suit };

export type LaidGroup = {
  id: number;
  owner: number;
  type: GroupType;
  /** Run and color run cards are kept low to high. */
  cards: Placed[];
  /** The number of a set, the first number of a run or color run. */
  num?: number;
  /** The suit of a color group or color run. */
  suit?: Suit;
};

export type HistoryEntry =
  | { kind: 'discard'; seat: number; card: Card; pickedUpBy?: number }
  | { kind: 'pickup'; seat: number; card: Card }
  /** The player drew from the pile, leaving this discard on top. */
  | { kind: 'pass'; seat: number; card: Card | null }
  /** The discard pile, except its top card, went back into the draw pile. */
  | { kind: 'reshuffle' };

export type Stage = 'choose' | 'draw' | 'play' | 'roundOver' | 'matchOver';

export type PlayerState = {
  hand: Card[];
  /** The phase being attempted this round, or null while choosing. */
  phase: number | null;
  completed: number[];
  laidDown: boolean;
  pendingSkip: boolean;
  score: number;
};

export type RoundResult = {
  round: number;
  seed: string;
  /** -1 when the round ended because no one could go out. */
  wentOut: number;
  hands: Card[][];
  points: number[];
  phasesBefore: (number | null)[];
  advanced: boolean[];
  totals: number[];
  history: HistoryEntry[];
};

export type GameState = {
  version: 1;
  variant: Variant;
  playerCount: number;
  matchSeed: string;
  round: number;
  roundSeed: string;
  reshuffles: number;
  /** Reshuffles in a row with no lay-down or hit between them. Missing in saves from before it existed. */
  quietReshuffles?: number;
  dealer: number;
  current: number;
  stage: Stage;
  players: PlayerState[];
  drawPile: Card[];
  discardPile: Card[];
  groups: LaidGroup[];
  nextGroupId: number;
  history: HistoryEntry[];
  lastRound: RoundResult | null;
  winners: number[];
  sharedWin: boolean;
};

export type GroupPlan = { cardIds: number[]; runStart?: number };

export type Action =
  | { type: 'choosePhase'; seat: number; phase: number }
  | { type: 'draw'; source: 'pile' | 'discard' }
  | { type: 'layDown'; groups: GroupPlan[] }
  | { type: 'hit'; cardId: number; groupId: number; end?: 'low' | 'high' }
  | { type: 'discard'; cardId: number; target?: number };

export type GameEvent =
  | { type: 'roundStart'; round: number; dealer: number; first: number; seed: string; startSkip: boolean }
  | { type: 'phaseChosen'; seat: number }
  | { type: 'turnStart'; seat: number }
  | { type: 'turnSkipped'; seat: number }
  | { type: 'draw'; seat: number; source: 'pile' | 'discard'; card: Card }
  | { type: 'reshuffle'; count: number }
  | { type: 'noDraw'; seat: number }
  | { type: 'layDown'; seat: number; phase: number; groupIds: number[]; wilds: number }
  | { type: 'hit'; seat: number; card: Card; groupId: number; end?: 'low' | 'high' }
  | { type: 'discard'; seat: number; card: Card }
  | { type: 'skipPlayed'; seat: number; target: number; targetCards: number; targetLaidDown: boolean }
  | { type: 'skipNoTarget'; seat: number }
  | { type: 'goOut'; seat: number; by: 'discard' | 'hit' }
  /** No one could go out, so the round ended with every hand still held. */
  | { type: 'stalemate' }
  | { type: 'roundEnd'; result: RoundResult }
  | { type: 'matchEnd'; winners: number[]; shared: boolean };

export type StepResult = { ok: true; events: GameEvent[] } | { ok: false; reason: string };
