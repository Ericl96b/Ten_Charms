// The rules engine. All game state changes go through step(); it has no knowledge of presentation.
import { cardPoints, createDeck } from './cards.ts';
import { PHASES, checkGroup, checkHit, phaseSequence, placeHit } from './phases.ts';
import { createRng, deriveRoundSeed, newSeed, shuffle } from './rng.ts';
import type { Action, Card, GameEvent, GameState, LaidGroup, PlayerState, RoundResult, StepResult, Variant } from './types.ts';

export type NewGameOptions = { playerCount: number; variant?: Variant; seed?: string };

const HAND_SIZE = 10;

export function nextUncompleted(variant: Variant, completed: readonly number[]): number | null {
  for (const p of phaseSequence(variant)) if (!completed.includes(p)) return p;
  return null;
}

export function isFinished(state: Pick<GameState, 'variant'>, player: Pick<PlayerState, 'completed'>): boolean {
  return nextUncompleted(state.variant, player.completed) === null;
}

export function createGame(options: NewGameOptions): { state: GameState; events: GameEvent[] } {
  const n = options.playerCount;
  if (n < 2 || n > 6) throw new Error('A match has 2 to 6 players.');
  const state: GameState = {
    version: 1,
    variant: options.variant ?? 'standard',
    playerCount: n,
    matchSeed: options.seed ?? newSeed(),
    round: 0,
    roundSeed: '',
    reshuffles: 0,
    // Seat 0 is the human; seats run clockwise, so the seat to the human's right is the last one.
    dealer: n - 1,
    current: 0,
    stage: 'draw',
    players: Array.from({ length: n }, () => ({ hand: [], phase: null, completed: [], laidDown: false, pendingSkip: false, score: 0 })),
    drawPile: [],
    discardPile: [],
    groups: [],
    nextGroupId: 1,
    history: [],
    lastRound: null,
    winners: [],
    sharedWin: false,
  };
  const events: GameEvent[] = [];
  startRound(state, events);
  return { state, events };
}

function startRound(state: GameState, events: GameEvent[]): void {
  state.round += 1;
  if (state.round > 1) state.dealer = (state.dealer + 1) % state.playerCount;
  state.roundSeed = deriveRoundSeed(state.matchSeed, state.round);
  state.reshuffles = 0;
  state.groups = [];
  state.history = [];
  const deck = shuffle(createDeck(), createRng(state.roundSeed, 0));
  for (const p of state.players) {
    p.hand = deck.splice(0, HAND_SIZE);
    p.laidDown = false;
    p.pendingSkip = false;
    p.phase = state.variant === 'choose' ? null : nextUncompleted(state.variant, p.completed);
  }
  const top = deck.shift()!;
  state.drawPile = deck;
  state.discardPile = [top];
  state.history.push({ kind: 'discard', seat: -1, card: top });
  state.current = (state.dealer + 1) % state.playerCount;
  const startSkip = top.kind === 'skip';
  if (startSkip) state.players[state.current].pendingSkip = true;
  events.push({ type: 'roundStart', round: state.round, dealer: state.dealer, first: state.current, seed: state.roundSeed, startSkip });
  if (state.variant === 'choose') {
    state.stage = 'choose';
  } else {
    beginTurn(state, events);
  }
}

/** Starts the current player's turn, using up any pending skips along the way. */
function beginTurn(state: GameState, events: GameEvent[]): void {
  while (state.players[state.current].pendingSkip) {
    state.players[state.current].pendingSkip = false;
    events.push({ type: 'turnSkipped', seat: state.current });
    state.current = (state.current + 1) % state.playerCount;
  }
  state.stage = 'draw';
  events.push({ type: 'turnStart', seat: state.current });
  prepareDraw(state, events);
}

/** Refills an empty draw pile, and moves on if there is truly nothing to draw. */
function prepareDraw(state: GameState, events: GameEvent[]): void {
  if (state.drawPile.length === 0) reshuffle(state, events);
  const top = state.discardPile[state.discardPile.length - 1];
  if (state.drawPile.length === 0 && (!top || top.kind === 'skip')) {
    state.stage = 'play';
    events.push({ type: 'noDraw', seat: state.current });
  }
}

function reshuffle(state: GameState, events: GameEvent[]): void {
  if (state.discardPile.length <= 1) return;
  const top = state.discardPile.pop()!;
  state.reshuffles += 1;
  state.drawPile = shuffle(state.discardPile, createRng(state.roundSeed, state.reshuffles));
  state.discardPile = [top];
  state.history.push({ kind: 'reshuffle' });
  events.push({ type: 'reshuffle', count: state.drawPile.length });
}

export function eligibleSkipTargets(state: GameState, seat: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < state.playerCount; i++) {
    const s = (seat + i) % state.playerCount;
    if (!state.players[s].pendingSkip) out.push(s);
  }
  return out;
}

export function step(state: GameState, action: Action): StepResult {
  const fail = (reason: string): StepResult => ({ ok: false, reason });
  const events: GameEvent[] = [];
  const seat = state.current;
  const player = state.players[seat];

  switch (action.type) {
    case 'choosePhase': {
      if (state.stage !== 'choose') return fail('Phases are chosen at the start of a round.');
      const chooser = state.players[action.seat];
      if (!chooser) return fail('No such player.');
      if (chooser.phase !== null) return fail('That player has already chosen.');
      if (!phaseSequence(state.variant).includes(action.phase) || chooser.completed.includes(action.phase)) {
        return fail('That phase is already complete.');
      }
      chooser.phase = action.phase;
      events.push({ type: 'phaseChosen', seat: action.seat });
      if (state.players.every((p) => p.phase !== null)) beginTurn(state, events);
      return { ok: true, events };
    }

    case 'draw': {
      if (state.stage !== 'draw') return fail(state.stage === 'play' ? 'You already drew this turn.' : 'It isn\'t time to draw.');
      if (action.source === 'discard') {
        const top = state.discardPile[state.discardPile.length - 1];
        if (!top) return fail('The discard pile is empty.');
        if (top.kind === 'skip') return fail("Skips can't be picked up.");
        state.discardPile.pop();
        player.hand.push(top);
        state.history.push({ kind: 'pickup', seat, card: top });
        for (let i = state.history.length - 1; i >= 0; i--) {
          const h = state.history[i];
          if (h.kind === 'discard' && h.card.id === top.id && h.pickedUpBy === undefined) { h.pickedUpBy = seat; break; }
        }
        events.push({ type: 'draw', seat, source: 'discard', card: top });
      } else {
        if (state.drawPile.length === 0) return fail('The draw pile is empty.');
        const passed = state.discardPile[state.discardPile.length - 1] ?? null;
        const card = state.drawPile.shift()!;
        player.hand.push(card);
        state.history.push({ kind: 'pass', seat, card: passed });
        events.push({ type: 'draw', seat, source: 'pile', card });
      }
      state.stage = 'play';
      return { ok: true, events };
    }

    case 'layDown': {
      if (state.stage === 'draw') return fail('You need to draw first.');
      if (state.stage !== 'play') return fail("It isn't time to lay down.");
      if (player.laidDown) return fail('Your phase is already down.');
      const phase = player.phase!;
      const reqs = PHASES[phase];
      if (action.groups.length !== reqs.length) return fail('Lay down every group at once.');
      const seen = new Set<number>();
      const checked = [];
      for (let i = 0; i < reqs.length; i++) {
        const plan = action.groups[i];
        const cards: Card[] = [];
        for (const id of plan.cardIds) {
          const c = player.hand.find((x) => x.id === id);
          if (!c) return fail("That card isn't in your hand.");
          if (seen.has(id)) return fail('A card can only be in one group.');
          seen.add(id);
          cards.push(c);
        }
        const check = checkGroup(reqs[i], cards, plan.runStart);
        if (!check.ok) return fail(check.reason || 'That group is not complete yet.');
        checked.push(check);
      }
      const groupIds: number[] = [];
      let wilds = 0;
      for (let i = 0; i < reqs.length; i++) {
        const c = checked[i];
        const group: LaidGroup = { id: state.nextGroupId++, owner: seat, type: reqs[i].type, cards: c.cards };
        if (c.num !== undefined) group.num = c.num;
        if (c.suit !== undefined) group.suit = c.suit;
        wilds += c.cards.filter((p) => p.card.kind === 'wild').length;
        state.groups.push(group);
        groupIds.push(group.id);
      }
      player.hand = player.hand.filter((c) => !seen.has(c.id));
      player.laidDown = true;
      events.push({ type: 'layDown', seat, phase, groupIds, wilds });
      if (player.hand.length === 0) goOut(state, seat, 'hit', events);
      return { ok: true, events };
    }

    case 'hit': {
      if (state.stage === 'draw') return fail('You need to draw first.');
      if (state.stage !== 'play') return fail("It isn't time to hit.");
      if (!player.laidDown) return fail('Lay down your phase before hitting.');
      const card = player.hand.find((c) => c.id === action.cardId);
      if (!card) return fail("That card isn't in your hand.");
      const group = state.groups.find((g) => g.id === action.groupId);
      if (!group) return fail("That group isn't on the table.");
      const check = checkHit(group, card);
      if (!check.ok) return fail(check.reason);
      let end = action.end;
      if (group.type === 'run' || group.type === 'colorRun') {
        const name = group.type === 'run' ? 'Runs' : 'Color runs';
        if (end === undefined) end = check.ends[0];
        if (!check.ends.includes(end)) return fail(end === 'high' ? `${name} can't go past 12.` : `${name} can't go below 1.`);
      }
      placeHit(group, card, end);
      player.hand = player.hand.filter((c) => c.id !== card.id);
      events.push({ type: 'hit', seat, card, groupId: group.id, end });
      if (player.hand.length === 0) goOut(state, seat, 'hit', events);
      return { ok: true, events };
    }

    case 'discard': {
      if (state.stage === 'draw') return fail('You need to draw first.');
      if (state.stage !== 'play') return fail("It isn't time to discard.");
      const card = player.hand.find((c) => c.id === action.cardId);
      if (!card) return fail("That card isn't in your hand.");
      const last = player.hand.length === 1;
      let target: number | undefined;
      let noTarget = false;
      if (card.kind === 'skip' && !last) {
        const eligible = eligibleSkipTargets(state, seat);
        if (eligible.length === 0) {
          noTarget = true;
        } else {
          if (action.target === undefined) return fail('Choose who to skip.');
          if (action.target === seat) return fail("You can't skip yourself.");
          if (!eligible.includes(action.target)) return fail('That player is already being skipped.');
          target = action.target;
        }
      }
      player.hand = player.hand.filter((c) => c.id !== card.id);
      state.discardPile.push(card);
      state.history.push({ kind: 'discard', seat, card });
      events.push({ type: 'discard', seat, card });
      if (last) {
        goOut(state, seat, 'discard', events);
        return { ok: true, events };
      }
      if (noTarget) events.push({ type: 'skipNoTarget', seat });
      if (target !== undefined) {
        const t = state.players[target];
        t.pendingSkip = true;
        events.push({ type: 'skipPlayed', seat, target, targetCards: t.hand.length, targetLaidDown: t.laidDown });
      }
      state.current = (seat + 1) % state.playerCount;
      beginTurn(state, events);
      return { ok: true, events };
    }
  }
}

function goOut(state: GameState, seat: number, by: 'discard' | 'hit', events: GameEvent[]): void {
  events.push({ type: 'goOut', seat, by });
  const phasesBefore = state.players.map((p) => p.phase);
  const advanced = state.players.map((p) => p.laidDown);
  const hands = state.players.map((p) => p.hand.slice());
  const points = hands.map((h) => h.reduce((n, c) => n + cardPoints(c), 0));
  state.players.forEach((p, i) => {
    p.score += points[i];
    if (p.laidDown && p.phase !== null) p.completed.push(p.phase);
  });
  const result: RoundResult = {
    round: state.round,
    seed: state.roundSeed,
    wentOut: seat,
    hands,
    points,
    phasesBefore,
    advanced,
    totals: state.players.map((p) => p.score),
    history: state.history.slice(),
  };
  state.lastRound = result;
  state.stage = 'roundOver';
  events.push({ type: 'roundEnd', result });

  const finishers: number[] = [];
  state.players.forEach((p, i) => { if (advanced[i] && isFinished(state, p)) finishers.push(i); });
  if (finishers.length > 0) {
    const low = Math.min(...finishers.map((i) => state.players[i].score));
    let winners = finishers.filter((i) => state.players[i].score === low);
    if (winners.length > 1 && winners.includes(seat)) winners = [seat];
    state.winners = winners;
    state.sharedWin = winners.length > 1;
    state.stage = 'matchOver';
    events.push({ type: 'matchEnd', winners, shared: state.sharedWin });
  }
}

/** Moves from the end of one round to the deal of the next. */
export function nextRound(state: GameState): GameEvent[] {
  if (state.stage !== 'roundOver') throw new Error('The round is not over.');
  const events: GameEvent[] = [];
  startRound(state, events);
  return events;
}
