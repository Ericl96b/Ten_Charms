// The bot personalities. A decision is a pure function of an Observation and a dice roll.
import {
  PHASES, cardPoints, checkHit, findArrangement, handPoints, phaseSequence,
  type Action, type Card, type GroupPlan, type LaidGroup, type Observation, type PublicPlayer, type Suit,
} from './rules.ts';
import { evaluate, plus, simpleUnseen, tally, trackedUnseen, usedCards, without, type Evaluation, type Tally, type Unseen } from './analysis.ts';

export type BotId =
  | 'pip' | 'marigold' | 'briar' | 'hoot' | 'nightshade'
  | 'lumi' | 'mallow' | 'velvet' | 'fennel' | 'sable' | 'mossback' | 'lunaria'
  | 'puff' | 'haze';
/** The Rose Garden roster. */
export const BOT_IDS: readonly BotId[] = ['pip', 'marigold', 'briar', 'hoot', 'nightshade'];
/** The Moonlit Glade roster, not counting Lunaria's wisps. */
export const GLADE_BOT_IDS: readonly BotId[] = ['lumi', 'mallow', 'velvet', 'fennel', 'sable', 'mossback', 'lunaria'];
/** Lunaria's minions. They only ever play at her table. */
export const WISP_IDS: readonly BotId[] = ['puff', 'haze'];
export const ALL_BOT_IDS: readonly BotId[] = [...BOT_IDS, ...GLADE_BOT_IDS, ...WISP_IDS];

type Ctx = {
  obs: Observation;
  rand: () => number;
  me: PublicPlayer;
  opponents: PublicPlayer[];
  t: Tally;
  u: Unseen;
  phase: number;
  now: Evaluation;
  odds: boolean;
  /** No one's card count can be seen. */
  fog: boolean;
  /** The groups this bot may hit: all of them, except under the Thorned Crown. */
  hittable: LaidGroup[];
};

/** The groups a seat may hit. Under the Thorned Crown, only its wearer may add to the crowned groups. */
function groupsFor(obs: Observation, seat: number): LaidGroup[] {
  const crown = obs.crownSeat;
  if (crown === undefined || seat === crown) return obs.groups;
  return obs.groups.filter((g) => g.owner !== crown);
}

function makeCtx(obs: Observation, rand: () => number, tracked: boolean, odds = false): Ctx {
  const t = tally(obs.hand);
  const u = tracked ? trackedUnseen(obs) : simpleUnseen(obs.hand);
  const phase = obs.ownPhase ?? 1;
  return {
    obs, rand, t, u, phase,
    me: obs.players[obs.seat],
    opponents: obs.players.filter((p) => p.seat !== obs.seat),
    odds,
    now: evaluate(t, phase, u, odds),
    fog: obs.fog === true,
    hittable: groupsFor(obs, obs.seat),
  };
}

/* ---------- Shared helpers ---------- */

type Hit = { card: Card; group: LaidGroup; end?: 'low' | 'high' };

function allHits(ctx: Ctx, ownOnly = false): Hit[] {
  const out: Hit[] = [];
  for (const g of ctx.hittable) {
    if (ownOnly && g.owner !== ctx.obs.seat) continue;
    for (const c of ctx.obs.hand) {
      const check = checkHit(g, c);
      if (check.ok) out.push({ card: c, group: g, end: g.type === 'run' || g.type === 'colorRun' ? check.ends[0] : undefined });
    }
  }
  return out;
}

const hitAction = (h: Hit): Action => ({ type: 'hit', cardId: h.card.id, groupId: h.group.id, end: h.end });

function canHitTable(card: Card, groups: readonly LaidGroup[]): boolean {
  return groups.some((g) => checkHit(g, card).ok);
}

function eligible(ctx: Ctx): PublicPlayer[] {
  return ctx.opponents.filter((p) => !p.pendingSkip);
}

/** Picks one of several equally good players with the bot's own dice. */
function anyOf(ctx: Ctx, players: readonly PublicPlayer[]): PublicPlayer | undefined {
  return players.length <= 1 ? players[0] : players[Math.floor(ctx.rand() * players.length)];
}

/**
 * The highest phase; ties to the lowest score, then the fewest cards.
 * In the fog card counts can't be seen, so a tie on score is settled at random.
 */
function leader(ctx: Ctx, players: readonly PublicPlayer[]): PublicPlayer {
  if (!ctx.fog) return [...players].sort((a, b) => b.completed.length - a.completed.length || a.score - b.score || a.cardCount! - b.cardCount!)[0];
  const sorted = [...players].sort((a, b) => b.completed.length - a.completed.length || a.score - b.score);
  return anyOf(ctx, sorted.filter((p) => p.completed.length === sorted[0].completed.length && p.score === sorted[0].score))!;
}

/**
 * Phase down, fewest cards. In the fog: whoever laid down earliest this round, then the higher phase, then at random.
 */
function closestToOut(ctx: Ctx, players: readonly PublicPlayer[]): PublicPlayer | undefined {
  const down = players.filter((p) => p.laidDown);
  if (!ctx.fog) return down.sort((a, b) => a.cardCount! - b.cardCount!)[0];
  const sorted = down.sort((a, b) => (a.laidOrder ?? 99) - (b.laidOrder ?? 99) || (b.phase ?? 0) - (a.phase ?? 0));
  if (sorted.length === 0) return undefined;
  return anyOf(ctx, sorted.filter((p) => p.laidOrder === sorted[0].laidOrder && p.phase === sorted[0].phase));
}

/** In the fog, a player who laid down at least two of their own turns ago stands in for one with few cards. */
const downAWhile = (p: PublicPlayer) => p.laidDown && (p.turnsSinceLay ?? 0) >= 2;

/** Someone is close to going out: down with this many cards or fewer, or in the fog, down for a while. */
function nearOut(ctx: Ctx, p: PublicPlayer, cards: number): boolean {
  return ctx.fog ? downAWhile(p) : p.laidDown && p.cardCount! <= cards;
}

function discardAction(ctx: Ctx, card: Card, chooseTarget: () => PublicPlayer | undefined): Action {
  const action: Action = { type: 'discard', cardId: card.id };
  if (card.kind === 'skip' && ctx.obs.hand.length > 1 && eligible(ctx).length > 0) {
    action.target = chooseTarget()?.seat ?? eligible(ctx)[0].seat;
  }
  return action;
}

/** Scores each discard option for a bot still building its phase. */
function buildValue(ctx: Ctx, card: Card): number {
  return evaluate(without(ctx.t, card), ctx.phase, ctx.u, ctx.odds).score;
}

function pickMax<T>(items: readonly T[], f: (x: T) => number): T {
  let best = items[0];
  let bestV = -Infinity;
  for (const x of items) {
    const v = f(x);
    if (v > bestV) { bestV = v; best = x; }
  }
  return best;
}

/** Ordinary cards if there are any; otherwise whatever is left. */
function plainCards(hand: readonly Card[]): Card[] {
  const plain = hand.filter((c) => c.kind === 'num');
  if (plain.length > 0) return plain;
  const skips = hand.filter((c) => c.kind === 'skip');
  return skips.length > 0 ? skips : hand.slice();
}

/** The competent default: keep the best partial groups, and shed points when it costs nothing. */
function baselineDiscard(ctx: Ctx, candidates: readonly Card[], extra: (c: Card) => number = () => 0): Card {
  if (ctx.me.laidDown) return pickMax(candidates, (c) => cardPoints(c) + extra(c));
  return pickMax(candidates, (c) => buildValue(ctx, c) + cardPoints(c) * 0.1 + extra(c));
}

/** Would taking this card from the discard pile bring the bot closer? */
function discardGain(ctx: Ctx, top: Card): { missing: number; outs: number } {
  if (ctx.me.laidDown) return { missing: canHitTable(top, ctx.hittable) ? 1 : 0, outs: 0 };
  const after = evaluate(plus(ctx.t, top), ctx.phase, ctx.u);
  return { missing: ctx.now.missing - after.missing, outs: after.outs - ctx.now.outs };
}

function arrangement(ctx: Ctx): GroupPlan[] | null {
  return ctx.now.missing === 0 ? findArrangement(ctx.obs.hand, ctx.phase) : null;
}

/** How many cards would remain after laying a plan down and making every possible hit. */
function leftoverAfterLay(ctx: Ctx, plan: GroupPlan[]): number {
  const used = new Set(plan.flatMap((p) => p.cardIds));
  const reqs = PHASES[ctx.phase];
  const fake: LaidGroup[] = plan.map((p, i) => {
    const cards = p.cardIds.map((id) => ctx.obs.hand.find((c) => c.id === id)!);
    const natural = cards.find((c) => c.kind === 'num');
    const req = reqs[i];
    if (req.type === 'run') {
      const start = p.runStart ?? 1;
      return { id: -1 - i, owner: ctx.obs.seat, type: 'run', num: start, cards: Array.from({ length: req.size }, (_, k) => ({ card: cards[0], num: start + k })) };
    }
    if (req.type === 'colorRun') {
      const start = p.runStart ?? 1;
      const suit = natural?.kind === 'num' ? natural.suit : 'rose';
      return { id: -1 - i, owner: ctx.obs.seat, type: 'colorRun', num: start, suit, cards: Array.from({ length: req.size }, (_, k) => ({ card: cards[0], num: start + k, suit })) };
    }
    if (req.type === 'evens' || req.type === 'odds') return { id: -1 - i, owner: ctx.obs.seat, type: req.type, cards: [] };
    if (req.type === 'set') return { id: -1 - i, owner: ctx.obs.seat, type: 'set', num: natural?.kind === 'num' ? natural.num : 0, cards: [] };
    return { id: -1 - i, owner: ctx.obs.seat, type: 'color', suit: natural?.kind === 'num' ? natural.suit : 'rose', cards: [] };
  });
  const groups = [...ctx.hittable, ...fake];
  return ctx.obs.hand.filter((c) => !used.has(c.id) && !canHitTable(c, groups)).length;
}

function choosePhase(obs: Observation): Action {
  const me = obs.players[obs.seat];
  const t = tally(obs.hand);
  const u = simpleUnseen(obs.hand);
  const open = phaseSequence(obs.variant).filter((p) => !me.completed.includes(p));
  const best = pickMax(open, (p) => evaluate(t, p, u).score + p * 0.01);
  return { type: 'choosePhase', seat: obs.seat, phase: best };
}

/**
 * Two bots can trade the same cards back and forth forever. Once the discard pile has been
 * the only source for a full lap or two, everyone goes back to the draw pile.
 */
function tradingLoop(obs: Observation): boolean {
  let pickups = 0;
  for (let i = obs.history.length - 1; i >= 0; i--) {
    const kind = obs.history[i].kind;
    if (kind === 'pass') break;
    if (kind === 'pickup') pickups++;
  }
  return pickups >= obs.playerCount * 2 + 2 && obs.drawCount > 0;
}

const fromPile = (obs: Observation): Action => ({ type: 'draw', source: obs.drawCount > 0 ? 'pile' : 'discard' });

/** The discard on offer, unless it's a Skip or the trading loop says to draw. */
function offered(obs: Observation): Card | null {
  const top = tradingLoop(obs) ? null : obs.discardTop;
  return top && top.kind !== 'skip' ? top : null;
}

/* ---------- What opponents are likely to want (trackers only) ---------- */

type Reads = { picked: Card[]; passed: Card[] };

/** One player's pickups and passes, from `since` in the history onwards. */
function readsOf(obs: Observation, seat: number, since = 0): Reads {
  const r: Reads = { picked: [], passed: [] };
  for (let i = since; i < obs.history.length; i++) {
    const h = obs.history[i];
    if (h.kind === 'pickup' && h.seat === seat) r.picked.push(h.card);
    if (h.kind === 'pass' && h.seat === seat && h.card) r.passed.push(h.card);
  }
  return r;
}

/** How much one opponent would like to see this card on the discard pile. */
function appeal(ctx: Ctx, opp: PublicPlayer, card: Card, since = 0): number {
  const { obs, u } = ctx;
  if (card.kind === 'skip') return 0;
  if (card.kind === 'wild') return 12;
  if (opp.laidDown) return canHitTable(card, groupsFor(obs, opp.seat)) ? (nearOut(ctx, opp, 3) ? 9 : 5) : 0;
  const reads = readsOf(obs, opp.seat, since);
  const reqs = opp.phase ? PHASES[opp.phase] : [];
  let score = 0;
  for (const req of reqs) {
    if (req.type === 'set') {
      score += 0.6;
      // A number with no copies left unseen can't grow into much.
      if (u.num[card.num] === 0) score -= 0.5;
      for (const c of reads.picked) if (c.kind === 'num' && c.num === card.num) score += 4;
      for (const c of reads.passed) if (c.kind === 'num' && c.num === card.num) score -= 0.8;
    } else if (req.type === 'run') {
      score += 1;
      for (const c of reads.picked) if (c.kind === 'num' && Math.abs(c.num - card.num) <= 2 && c.num !== card.num) score += 2;
      for (const c of reads.picked) if (c.kind === 'num' && c.num === card.num) score -= 1;
      for (const c of reads.passed) if (c.kind === 'num' && c.num === card.num) score -= 0.8;
    } else if (req.type === 'colorRun') {
      score += 0.8;
      for (const c of reads.picked) if (c.kind === 'num' && c.suit === card.suit && Math.abs(c.num - card.num) <= 2 && c.num !== card.num) score += 4;
      for (const c of reads.passed) if (c.kind === 'num' && c.suit === card.suit) score -= 0.4;
    } else if (req.type === 'evens' || req.type === 'odds') {
      score += (card.num % 2 === 0) === (req.type === 'evens') ? 2 : 0;
    } else {
      score += 0.8;
      for (const c of reads.picked) if (c.kind === 'num' && c.suit === card.suit) score += 3;
      for (const c of reads.passed) if (c.kind === 'num' && c.suit === card.suit) score -= 0.6;
    }
  }
  return score;
}

function totalAppeal(ctx: Ctx, card: Card, since = 0): number {
  return ctx.opponents.reduce((n, o) => n + appeal(ctx, o, card, since), 0);
}

/** Where in the history this bot's previous turn ended, so memory can be limited to one turn cycle. */
function lastOwnMove(obs: Observation): number {
  for (let i = obs.history.length - 1; i >= 0; i--) {
    const h = obs.history[i];
    if (h.kind === 'discard' && h.seat === obs.seat) return i + 1;
  }
  return 0;
}

/* ---------- Pip ---------- */

function pip(obs: Observation, rand: () => number): Action {
  const ctx = makeCtx(obs, rand, false);
  if (obs.stage === 'draw') {
    const top = tradingLoop(obs) ? null : obs.discardTop;
    if (top && top.kind !== 'skip') {
      if (ctx.me.laidDown) {
        const own = ctx.hittable.filter((g) => g.owner === obs.seat);
        if (canHitTable(top, own)) return { type: 'draw', source: 'discard' };
      } else if (discardGain(ctx, top).missing > 0) {
        return { type: 'draw', source: 'discard' };
      }
    }
    return fromPile(obs);
  }
  if (!ctx.me.laidDown) {
    const plan = arrangement(ctx);
    if (plan) return { type: 'layDown', groups: plan };
  } else {
    const hits = allHits(ctx, true);
    if (hits.length > 0) return hitAction(hits[0]);
  }
  const used = ctx.me.laidDown ? new Set<number>() : usedCards(obs.hand, ctx.now.picks);
  const spare = obs.hand.filter((c) => c.kind === 'num' && !used.has(c.id));
  const target = () => {
    const opts = eligible(ctx);
    return opts[Math.floor(rand() * opts.length)];
  };
  if (spare.length > 0) {
    if (rand() < 0.3) return discardAction(ctx, spare[Math.floor(rand() * spare.length)], target);
    return discardAction(ctx, baselineDiscard(ctx, spare), target);
  }
  const skip = obs.hand.find((c) => c.kind === 'skip');
  if (skip) return discardAction(ctx, skip, target);
  return discardAction(ctx, baselineDiscard(ctx, plainCards(obs.hand)), target);
}

/* ---------- Marigold ---------- */

function marigold(obs: Observation, rand: () => number): Action {
  const ctx = makeCtx(obs, rand, false);
  const panic = ctx.opponents.some((o) => nearOut(ctx, o, 4));
  if (obs.stage === 'draw') {
    const top = tradingLoop(obs) ? null : obs.discardTop;
    if (top && top.kind !== 'skip') {
      const gain = discardGain(ctx, top);
      if (top.kind === 'wild' || gain.missing > 0 || gain.outs > 0) return { type: 'draw', source: 'discard' };
    }
    return fromPile(obs);
  }
  if (!ctx.me.laidDown) {
    const plan = arrangement(ctx);
    if (plan && (panic || leftoverAfterLay(ctx, plan) <= 3)) return { type: 'layDown', groups: plan };
  } else {
    const hits = allHits(ctx);
    if (hits.length > 0) return hitAction(hits[0]);
  }
  const target = () => (ctx.fog
    ? closestToOut(ctx, eligible(ctx)) ?? leader(ctx, eligible(ctx))
    : [...eligible(ctx)].sort((a, b) => a.cardCount! - b.cardCount!)[0]);
  const skip = obs.hand.find((c) => c.kind === 'skip');
  if (skip && panic && eligible(ctx).length > 0) return discardAction(ctx, skip, target);
  // Mild memory: what was picked up since this bot last moved.
  const recent = new Set<number>();
  for (let i = obs.history.length - 1; i >= 0; i--) {
    const h = obs.history[i];
    if ('seat' in h && h.seat === obs.seat) break;
    if (h.kind === 'pickup' && h.card.kind === 'num') recent.add(h.card.num);
  }
  const avoid = (c: Card) => (c.kind === 'num' && recent.has(c.num) ? -6 : 0);
  return discardAction(ctx, baselineDiscard(ctx, plainCards(obs.hand), avoid), target);
}

/* ---------- Briar ---------- */

function briar(obs: Observation, rand: () => number): Action {
  const ctx = makeCtx(obs, rand, false);
  if (obs.stage === 'draw') {
    const top = tradingLoop(obs) ? null : obs.discardTop;
    if (top && top.kind !== 'skip') {
      const gain = discardGain(ctx, top);
      if (gain.missing > 0 || gain.outs >= 3) return { type: 'draw', source: 'discard' };
    }
    return fromPile(obs);
  }
  if (!ctx.me.laidDown) {
    const plan = arrangement(ctx);
    if (plan) return { type: 'layDown', groups: plan };
  } else {
    const hits = allHits(ctx);
    if (hits.length > 0) return hitAction(hits[0]);
  }
  const target = () => leader(ctx, eligible(ctx));
  const skip = obs.hand.find((c) => c.kind === 'skip');
  if (skip) return discardAction(ctx, skip, target);
  if (ctx.me.laidDown) return discardAction(ctx, baselineDiscard(ctx, plainCards(obs.hand)), target);
  // High cards go early unless the best partial grouping uses them.
  const used = usedCards(obs.hand, ctx.now.picks);
  const highSpare = obs.hand.filter((c) => c.kind === 'num' && c.num >= 10 && !used.has(c.id));
  if (highSpare.length > 0) return discardAction(ctx, baselineDiscard(ctx, highSpare), target);
  return discardAction(ctx, baselineDiscard(ctx, plainCards(obs.hand), (c) => cardPoints(c) * 0.5), target);
}

/* ---------- Professor Hoot, Nightshade, Old Mossback and Lady Lunaria ---------- */

const HOOT_APPEAL = 2.4;
const DENY_POINT_LIMIT = 20;

/** What separates the trackers. */
type TrackerStyle = {
  /** Takes a discard that only widens the odds when it adds at least this many outs. */
  outs: number;
  /** May wait a turn to deny hit targets (Nightshade's lay-down timing). */
  deny: boolean;
  /** Plays a held Skip on a player down to this many cards. */
  skipCards: number;
  /** How much opponents' wants weigh against its own. */
  weight: number;
  /** Keeps cards that runs on the table will soon want, and looks a turn ahead. */
  lookahead: boolean;
};

const HOOT: TrackerStyle = { outs: 8, deny: false, skipCards: 5, weight: HOOT_APPEAL, lookahead: false };
const NIGHTSHADE: TrackerStyle = { outs: 6, deny: true, skipCards: 3, weight: HOOT_APPEAL * 1.5, lookahead: true };
/** The full Hoot profile, plus Nightshade's lay-down delay and Skip timing. */
const MOSSBACK: TrackerStyle = { ...HOOT, deny: true, skipCards: 3 };

/** Whether the Skip timing says now. In the fog, Nightshade's timing waits until the target has been down a while. */
function skipTimingMet(ctx: Ctx, style: TrackerStyle, target: PublicPlayer): boolean {
  if (!ctx.fog) return target.cardCount! <= style.skipCards;
  return style.skipCards <= 3 ? downAWhile(target) : target.laidDown;
}

function tracker(ctx: Ctx, style: TrackerStyle): Action {
  const { obs } = ctx;
  const closest = closestToOut(ctx, ctx.opponents);

  if (obs.stage === 'draw') {
    const top = tradingLoop(obs) ? null : obs.discardTop;
    if (top && top.kind !== 'skip') {
      const gain = discardGain(ctx, top);
      if (gain.missing > 0 || top.kind === 'wild') return { type: 'draw', source: 'discard' };
      // Take a card that only widens the odds when those odds beat a blind draw.
      if (!ctx.me.laidDown && gain.outs >= style.outs) return { type: 'draw', source: 'discard' };
    }
    return fromPile(obs);
  }

  if (!ctx.me.laidDown) {
    const plan = arrangement(ctx);
    if (plan) {
      const threatened = ctx.opponents.some((o) => nearOut(ctx, o, 4));
      const left = leftoverAfterLay(ctx, plan);
      // Holding back one turn can set up laying down and going out together.
      const holdForSweep = left === 2 && !threatened && handPoints(obs.hand) < 50 && !heldLastTurn(ctx);
      // Waiting to deny hit targets is only worth it with very little to lose.
      const denyTargets = style.deny && !threatened && ctx.opponents.every((o) => !o.laidDown) && handPoints(obs.hand) < DENY_POINT_LIMIT && !heldLastTurn(ctx);
      if (!holdForSweep && !denyTargets) return { type: 'layDown', groups: plan };
    }
  } else {
    const hits = allHits(ctx);
    if (hits.length > 0) {
      // Prefer using up the cards an opponent could also use.
      return hitAction(pickMax(hits, (h) => totalAppeal(ctx, h.card) + cardPoints(h.card) * 0.01));
    }
  }

  const skip = obs.hand.find((c) => c.kind === 'skip');
  const targets = eligible(ctx);
  const pickTarget = () => closestToOut(ctx, targets) ?? leader(ctx, targets);
  if (skip && targets.length > 0) {
    const nearest = closestToOut(ctx, targets);
    if (nearest && skipTimingMet(ctx, style, nearest)) return discardAction(ctx, skip, pickTarget);
  }

  const candidates = plainCards(obs.hand);
  const value = (c: Card) => {
    let own = ctx.me.laidDown ? cardPoints(c) : buildValue(ctx, c) + cardPoints(c) * 0.15;
    if (style.lookahead && ctx.me.laidDown) own -= 6 * futureHits(c, ctx.hittable);
    let danger = totalAppeal(ctx, c) * style.weight;
    // One-turn lookahead: would this card let someone finish right away? The fog hides who is on one card.
    if (style.lookahead && !ctx.fog && closest && closest.cardCount === 1 && canHitTable(c, groupsFor(obs, closest.seat))) danger += 400;
    return own - danger;
  };
  const best = pickMax(candidates, value);
  // Nothing else is safe to throw, so the Skip goes now.
  if (skip && targets.length > 0 && !ctx.me.laidDown) {
    const used = usedCards(obs.hand, ctx.now.picks);
    if (used.has(best.id) && buildValue(ctx, best) < ctx.now.score - 500) return discardAction(ctx, skip, pickTarget);
  }
  if (skip && ctx.me.laidDown && targets.length > 0 && cardPoints(best) < 15 && obs.hand.length <= 3) return discardAction(ctx, skip, pickTarget);
  return discardAction(ctx, best, pickTarget);
}

/** How many laid runs this card is one or two steps from joining. */
function futureHits(card: Card, groups: readonly LaidGroup[]): number {
  if (card.kind !== 'num') return 0;
  let n = 0;
  for (const g of groups) {
    if (g.type !== 'run' && !(g.type === 'colorRun' && g.suit === card.suit)) continue;
    const lo = g.cards[0].num!;
    const hi = g.cards[g.cards.length - 1].num!;
    if (card.num === hi + 2 || card.num === lo - 2) n += 1;
    if (card.num === hi + 3 || card.num === lo - 3) n += 0.5;
  }
  return n;
}

/** True if the bot's previous hand already held a complete phase, so it has had its one turn of waiting. */
function heldLastTurn(ctx: Ctx): boolean {
  const { obs } = ctx;
  let lastDiscard: Card | null = null;
  for (let i = obs.history.length - 1; i >= 0; i--) {
    const h = obs.history[i];
    if (h.kind === 'discard' && h.seat === obs.seat) { lastDiscard = h.card; break; }
  }
  if (!lastDiscard) return false;
  const back = plus(ctx.t, lastDiscard);
  return obs.hand.some((c) => evaluate(without(back, c), ctx.phase, ctx.u).missing === 0);
}

function hoot(obs: Observation, rand: () => number): Action {
  return tracker(makeCtx(obs, rand, true), HOOT);
}

function nightshade(obs: Observation, rand: () => number): Action {
  return tracker(makeCtx(obs, rand, true, true), NIGHTSHADE);
}

function mossback(obs: Observation, rand: () => number): Action {
  return tracker(makeCtx(obs, rand, true), MOSSBACK);
}

/** The full Nightshade profile. The Thorned Crown is a rule of her table, not of her play. */
function lunaria(obs: Observation, rand: () => number): Action {
  return tracker(makeCtx(obs, rand, true, true), NIGHTSHADE);
}

/* ---------- The Moonlit Glade's simpler bots ---------- */

/** Lays down as soon as it can, then hits whenever it can, on anyone. */
function layOrHit(ctx: Ctx): Action | null {
  if (!ctx.me.laidDown) {
    const plan = arrangement(ctx);
    return plan ? { type: 'layDown', groups: plan } : null;
  }
  const hits = allHits(ctx);
  return hits.length > 0 ? hitAction(hits[0]) : null;
}

/** Takes the discard when it completes or extends the best grouping, or, once down, when it can be hit. */
function drawBaseline(ctx: Ctx, also: (top: Card) => boolean = () => false): Action {
  const top = offered(ctx.obs);
  if (top && (discardGain(ctx, top).missing > 0 || also(top))) return { type: 'draw', source: 'discard' };
  return fromPile(ctx.obs);
}

/** The highest phase, then the lowest total score, then at random. Card counts don't come into it. */
function phaseLeader(ctx: Ctx, players: readonly PublicPlayer[]): PublicPlayer | undefined {
  const sorted = [...players].sort((a, b) => b.completed.length - a.completed.length || a.score - b.score);
  if (sorted.length === 0) return undefined;
  return anyOf(ctx, sorted.filter((p) => p.completed.length === sorted[0].completed.length && p.score === sorted[0].score));
}

/** Lumi: steady all-rounder. */
function lumi(obs: Observation, rand: () => number): Action {
  const ctx = makeCtx(obs, rand, false);
  if (obs.stage === 'draw') return drawBaseline(ctx);
  const move = layOrHit(ctx);
  if (move) return move;
  const target = () => phaseLeader(ctx, eligible(ctx));
  // A Skip goes on the turn after it was drawn. This turn's draw is always the last card in hand.
  const drawnNow = obs.hand[obs.hand.length - 1];
  const oldSkip = obs.hand.find((c) => c.kind === 'skip' && c.id !== drawnNow.id);
  if (oldSkip) return discardAction(ctx, oldSkip, target);
  const used = ctx.me.laidDown ? new Set<number>() : usedCards(obs.hand, ctx.now.picks);
  const spare = obs.hand.filter((c) => c.kind === 'num' && !used.has(c.id));
  if (spare.length > 0) return discardAction(ctx, pickMax(spare, cardPoints), target);
  const plain = obs.hand.filter((c) => c.kind === 'num');
  if (plain.length > 0) return discardAction(ctx, baselineDiscard(ctx, plain), target);
  return discardAction(ctx, baselineDiscard(ctx, plainCards(obs.hand)), target);
}

/** The player who laid down most recently this round. */
function lastToLay(players: readonly PublicPlayer[]): PublicPlayer | undefined {
  return players.filter((p) => p.laidDown).sort((a, b) => (b.laidOrder ?? 0) - (a.laidOrder ?? 0))[0];
}

/** How strongly Mallow keeps cards that match another in hand. See SIMULATION_MAP2.md. */
const MALLOW_KEEP = 8;

/** Mallow: quick hop. Builds on Sets and Pairs. */
function mallow(obs: Observation, rand: () => number): Action {
  const ctx = makeCtx(obs, rand, false);
  if (obs.stage === 'draw') {
    return drawBaseline(ctx, (top) => !ctx.me.laidDown && top.kind === 'num' && ctx.t.num[top.num] >= 1);
  }
  const move = layOrHit(ctx);
  if (move) return move;
  const target = () => lastToLay(eligible(ctx)) ?? phaseLeader(ctx, eligible(ctx));
  const skips = obs.hand.filter((c) => c.kind === 'skip');
  if (skips.length >= 2) return discardAction(ctx, skips[0], target);
  const keepMatches = (c: Card) => (c.kind === 'num' && ctx.t.num[c.num] >= 2 ? -MALLOW_KEEP : 0);
  return discardAction(ctx, baselineDiscard(ctx, plainCards(obs.hand), keepMatches), target);
}

/** The last few cards each opponent picked up from the discard pile, newest first. */
function recentPickups(obs: Observation, seat: number, count: number): Card[] {
  const out: Card[] = [];
  for (let i = obs.history.length - 1; i >= 0 && out.length < count; i--) {
    const h = obs.history[i];
    if (h.kind === 'pickup' && h.seat === seat) out.push(h.card);
  }
  return out;
}

/** How strongly Velvet avoids throwing what she saw someone take. See SIMULATION_MAP2.md. */
const VELVET_MEMORY = 6;

/** Velvet: night dancer. Skips at once, keeps her Wilds, and remembers what each player picked up last. */
function velvet(obs: Observation, rand: () => number): Action {
  const ctx = makeCtx(obs, rand, false);
  if (obs.stage === 'draw') return drawBaseline(ctx, (top) => top.kind === 'wild');
  const move = layOrHit(ctx);
  if (move) return move;
  const target = () => phaseLeader(ctx, eligible(ctx));
  const skip = obs.hand.find((c) => c.kind === 'skip');
  if (skip) return discardAction(ctx, skip, target);
  const remembered = ctx.opponents.flatMap((o) => recentPickups(obs, o.seat, 2)).filter((c) => c.kind === 'num');
  const avoid = (c: Card) => {
    if (c.kind !== 'num') return 0;
    let n = 0;
    for (const r of remembered) {
      if (r.kind !== 'num') continue;
      if (r.num === c.num) n -= VELVET_MEMORY;
      if (r.suit === c.suit) n -= VELVET_MEMORY / 2;
    }
    return n;
  };
  return discardAction(ctx, baselineDiscard(ctx, plainCards(obs.hand), avoid), target);
}

/** The suit Fennel held most of when the round was dealt. Ties go to the earlier suit in this order. */
function favoriteSuit(obs: Observation): Suit {
  const order: Suit[] = ['rose', 'moss', 'moonstone', 'honey'];
  const counts = order.map((s) => obs.dealt.filter((c) => c.kind === 'num' && c.suit === s).length);
  return order[counts.indexOf(Math.max(...counts))];
}

/** Fennel's one-cycle memory, weighed against her own hand. See SIMULATION_MAP2.md. */
const FENNEL_MEMORY = HOOT_APPEAL;

/** Fennel: pond keeper. Keeps a favorite suit and remembers one turn cycle. */
function fennel(obs: Observation, rand: () => number): Action {
  const ctx = makeCtx(obs, rand, false);
  const fav = favoriteSuit(obs);
  const isFav = (c: Card) => c.kind === 'num' && c.suit === fav;
  if (obs.stage === 'draw') {
    return drawBaseline(ctx, (top) => {
      if (!isFav(top)) return false;
      const gain = discardGain(ctx, top);
      return gain.missing > 0 || gain.outs > 0;
    });
  }
  const move = layOrHit(ctx);
  if (move) return move;
  const target = () => phaseLeader(ctx, eligible(ctx));
  const skip = obs.hand.find((c) => c.kind === 'skip');
  if (skip) return discardAction(ctx, skip, target);
  const plain = plainCards(obs.hand);
  const others = plain.filter((c) => !isFav(c));
  const since = lastOwnMove(obs);
  const memory = (c: Card) => -totalAppeal(ctx, c, since) * FENNEL_MEMORY;
  return discardAction(ctx, baselineDiscard(ctx, others.length > 0 ? others : plain, memory), target);
}

/** How much Sable minds what others want. See SIMULATION_MAP2.md. */
const SABLE_MEMORY = HOOT_APPEAL;

/** Sable: collector. Takes whatever helps, remembers everything, and skips whoever takes the most. */
function sable(obs: Observation, rand: () => number): Action {
  const ctx = makeCtx(obs, rand, true);
  if (obs.stage === 'draw') {
    return drawBaseline(ctx, (top) => top.kind === 'wild' || (!ctx.me.laidDown && discardGain(ctx, top).outs > 0));
  }
  if (!ctx.me.laidDown) {
    const plan = arrangement(ctx);
    if (plan) return { type: 'layDown', groups: plan };
  } else {
    const hits = allHits(ctx);
    if (hits.length > 0) return hitAction(pickMax(hits, (h) => totalAppeal(ctx, h.card) + cardPoints(h.card) * 0.01));
  }
  const target = () => {
    const opts = eligible(ctx);
    const taken = (p: PublicPlayer) => obs.history.filter((h) => h.kind === 'pickup' && h.seat === p.seat).length;
    const most = Math.max(...opts.map(taken));
    return phaseLeader(ctx, opts.filter((p) => taken(p) === most));
  };
  const skip = obs.hand.find((c) => c.kind === 'skip');
  if (skip) return discardAction(ctx, skip, target);
  const value = (c: Card) => (ctx.me.laidDown ? cardPoints(c) : buildValue(ctx, c) + cardPoints(c) * 0.15) - totalAppeal(ctx, c) * SABLE_MEMORY;
  return discardAction(ctx, pickMax(plainCards(obs.hand), value), target);
}

/* ---------- Puff and Haze, Lunaria's wisps ---------- */

/** Discards about this close in value count as equal, so Puff can choose the one Lunaria wants. */
const PUFF_TIE = 6;

/**
 * Marigold-level play without the hoarding, in Lunaria's service. Who is who comes from public facts only:
 * the crown says which seat is Lunaria, and seat 0 is always the human.
 */
function wisp(obs: Observation, rand: () => number, feeds: boolean): Action {
  const ctx = makeCtx(obs, rand, false);
  const crown = obs.crownSeat;
  const queen = crown === undefined ? undefined : obs.players[crown];
  const human = obs.players[0];
  // Until Lunaria is down, a wisp never empties its hand.
  const mayFinish = !queen || queen.laidDown;
  if (obs.stage === 'draw') {
    const top = offered(obs);
    if (top) {
      const gain = discardGain(ctx, top);
      if (top.kind === 'wild' || gain.missing > 0 || gain.outs > 0) return { type: 'draw', source: 'discard' };
    }
    return fromPile(obs);
  }
  if (!ctx.me.laidDown) {
    const plan = arrangement(ctx);
    const left = obs.hand.length - (plan?.reduce((n, g) => n + g.cardIds.length, 0) ?? 0);
    if (plan && (mayFinish || left >= 2)) return { type: 'layDown', groups: plan };
  } else if (mayFinish || obs.hand.length > 2) {
    const hits = allHits(ctx);
    if (hits.length > 0) return hitAction(hits[0]);
  }
  const otherWisp = ctx.opponents.find((o) => o.seat !== 0 && o.seat !== crown);
  const skip = obs.hand.find((c) => c.kind === 'skip');
  const plain = obs.hand.filter((c) => c.kind === 'num' || c.kind === 'wild');
  if (skip && !human.pendingSkip && human.seat !== obs.seat) return discardAction(ctx, skip, () => human);
  if (plain.length === 0 && skip) {
    // Forced to throw a Skip while the human is already skipped: the other wisp, never Lunaria if it can help it.
    return discardAction(ctx, skip, () => (otherWisp && !otherWisp.pendingSkip ? otherWisp : eligible(ctx).find((o) => o.seat !== crown)));
  }
  // Numbers first, then Wilds. A Skip only goes at a target chosen above.
  const nums = obs.hand.filter((c) => c.kind === 'num');
  const cards = nums.length > 0 ? nums : plain;
  const own = (c: Card) => (ctx.me.laidDown ? cardPoints(c) : buildValue(ctx, c) + cardPoints(c) * 0.1);
  if (queen && feeds) {
    const best = Math.max(...cards.map(own));
    const close = cards.filter((c) => own(c) >= best - PUFF_TIE);
    return discardAction(ctx, pickMax(close, (c) => appeal(ctx, queen, c) + own(c) * 0.001), () => human);
  }
  if (!feeds && human.seat !== obs.seat) return discardAction(ctx, pickMax(cards, (c) => own(c) - appeal(ctx, human, c) * HOOT_APPEAL), () => human);
  return discardAction(ctx, pickMax(cards, own), () => human);
}

const puff = (obs: Observation, rand: () => number) => wisp(obs, rand, true);
const haze = (obs: Observation, rand: () => number) => wisp(obs, rand, false);

/* ---------- Entry point ---------- */

const PROFILES: Record<BotId, (obs: Observation, rand: () => number) => Action> = {
  pip, marigold, briar, hoot, nightshade, lumi, mallow, velvet, fennel, sable, mossback, lunaria, puff, haze,
};

/** A bot's next move. `rand` is the bot's own dice, unconnected to the game's shuffles. */
export function decide(id: BotId, obs: Observation, rand: () => number): Action {
  if (obs.stage === 'choose') return choosePhase(obs);
  return PROFILES[id](obs, rand);
}
