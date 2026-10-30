// The five bot personalities. A decision is a pure function of an Observation and a dice roll.
import {
  PHASES, cardPoints, checkHit, findArrangement, handPoints, phaseSequence,
  type Action, type Card, type GroupPlan, type LaidGroup, type Observation, type PublicPlayer,
} from './rules.ts';
import { evaluate, plus, simpleUnseen, tally, trackedUnseen, usedCards, without, type Evaluation, type Tally, type Unseen } from './analysis.ts';

export type BotId = 'pip' | 'marigold' | 'briar' | 'hoot' | 'nightshade';
export const BOT_IDS: readonly BotId[] = ['pip', 'marigold', 'briar', 'hoot', 'nightshade'];

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
};

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
  };
}

/* ---------- Shared helpers ---------- */

type Hit = { card: Card; group: LaidGroup; end?: 'low' | 'high' };

function allHits(obs: Observation, ownOnly = false): Hit[] {
  const out: Hit[] = [];
  for (const g of obs.groups) {
    if (ownOnly && g.owner !== obs.seat) continue;
    for (const c of obs.hand) {
      const check = checkHit(g, c);
      if (check.ok) out.push({ card: c, group: g, end: g.type === 'run' ? check.ends[0] : undefined });
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

/** The highest phase; ties to the lowest score, then the fewest cards. */
function leader(players: readonly PublicPlayer[]): PublicPlayer {
  return [...players].sort((a, b) => b.completed.length - a.completed.length || a.score - b.score || a.cardCount - b.cardCount)[0];
}

/** Phase down, fewest cards. */
function closestToOut(players: readonly PublicPlayer[]): PublicPlayer | undefined {
  return players.filter((p) => p.laidDown).sort((a, b) => a.cardCount - b.cardCount)[0];
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
  if (ctx.me.laidDown) return { missing: canHitTable(top, ctx.obs.groups) ? 1 : 0, outs: 0 };
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
    if (req.type === 'set') return { id: -1 - i, owner: ctx.obs.seat, type: 'set', num: natural?.kind === 'num' ? natural.num : 0, cards: [] };
    return { id: -1 - i, owner: ctx.obs.seat, type: 'color', suit: natural?.kind === 'num' ? natural.suit : 'rose', cards: [] };
  });
  const groups = [...ctx.obs.groups, ...fake];
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

/* ---------- What opponents are likely to want (trackers only) ---------- */

type Reads = { picked: Card[]; passed: Card[] };

function readsOf(obs: Observation, seat: number): Reads {
  const r: Reads = { picked: [], passed: [] };
  for (const h of obs.history) {
    if (h.kind === 'pickup' && h.seat === seat) r.picked.push(h.card);
    if (h.kind === 'pass' && h.seat === seat && h.card) r.passed.push(h.card);
  }
  return r;
}

/** How much one opponent would like to see this card on the discard pile. */
function appeal(obs: Observation, opp: PublicPlayer, card: Card, u: Unseen): number {
  if (card.kind === 'skip') return 0;
  if (card.kind === 'wild') return 12;
  if (opp.laidDown) return canHitTable(card, obs.groups) ? (opp.cardCount <= 3 ? 9 : 5) : 0;
  const reads = readsOf(obs, opp.seat);
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
    } else {
      score += 0.8;
      for (const c of reads.picked) if (c.kind === 'num' && c.suit === card.suit) score += 3;
      for (const c of reads.passed) if (c.kind === 'num' && c.suit === card.suit) score -= 0.6;
    }
  }
  return score;
}

function totalAppeal(ctx: Ctx, card: Card): number {
  return ctx.opponents.reduce((n, o) => n + appeal(ctx.obs, o, card, ctx.u), 0);
}

/* ---------- Pip ---------- */

function pip(obs: Observation, rand: () => number): Action {
  const ctx = makeCtx(obs, rand, false);
  if (obs.stage === 'draw') {
    const top = tradingLoop(obs) ? null : obs.discardTop;
    if (top && top.kind !== 'skip') {
      if (ctx.me.laidDown) {
        const own = obs.groups.filter((g) => g.owner === obs.seat);
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
    const hits = allHits(obs, true);
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
  const panic = ctx.opponents.some((o) => o.laidDown && o.cardCount <= 4);
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
    const hits = allHits(obs);
    if (hits.length > 0) return hitAction(hits[0]);
  }
  const target = () => [...eligible(ctx)].sort((a, b) => a.cardCount - b.cardCount)[0];
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
    const hits = allHits(obs);
    if (hits.length > 0) return hitAction(hits[0]);
  }
  const target = () => leader(eligible(ctx));
  const skip = obs.hand.find((c) => c.kind === 'skip');
  if (skip) return discardAction(ctx, skip, target);
  if (ctx.me.laidDown) return discardAction(ctx, baselineDiscard(ctx, plainCards(obs.hand)), target);
  // High cards go early unless the best partial grouping uses them.
  const used = usedCards(obs.hand, ctx.now.picks);
  const highSpare = obs.hand.filter((c) => c.kind === 'num' && c.num >= 10 && !used.has(c.id));
  if (highSpare.length > 0) return discardAction(ctx, baselineDiscard(ctx, highSpare), target);
  return discardAction(ctx, baselineDiscard(ctx, plainCards(obs.hand), (c) => cardPoints(c) * 0.5), target);
}

/* ---------- Professor Hoot and Nightshade ---------- */

const HOOT_APPEAL = 2.4;
const DENY_POINT_LIMIT = 20;

function hootLike(ctx: Ctx, boss: boolean): Action {
  const { obs } = ctx;
  const closest = closestToOut(ctx.opponents);

  if (obs.stage === 'draw') {
    const top = tradingLoop(obs) ? null : obs.discardTop;
    if (top && top.kind !== 'skip') {
      const gain = discardGain(ctx, top);
      if (gain.missing > 0 || top.kind === 'wild') return { type: 'draw', source: 'discard' };
      // Take a card that only widens the odds when those odds beat a blind draw.
      if (!ctx.me.laidDown && gain.outs >= (boss ? 6 : 8)) return { type: 'draw', source: 'discard' };
    }
    return fromPile(obs);
  }

  if (!ctx.me.laidDown) {
    const plan = arrangement(ctx);
    if (plan) {
      const threatened = ctx.opponents.some((o) => o.laidDown && o.cardCount <= 4);
      const left = leftoverAfterLay(ctx, plan);
      // Holding back one turn can set up laying down and going out together.
      const holdForSweep = left === 2 && !threatened && handPoints(obs.hand) < 50 && !heldLastTurn(ctx);
      // Waiting to deny hit targets is only worth it with very little to lose.
      const denyTargets = boss && !threatened && ctx.opponents.every((o) => !o.laidDown) && handPoints(obs.hand) < DENY_POINT_LIMIT && !heldLastTurn(ctx);
      if (!holdForSweep && !denyTargets) return { type: 'layDown', groups: plan };
    }
  } else {
    const hits = allHits(obs);
    if (hits.length > 0) {
      // Prefer using up the cards an opponent could also use.
      return hitAction(pickMax(hits, (h) => totalAppeal(ctx, h.card) + cardPoints(h.card) * 0.01));
    }
  }

  const skip = obs.hand.find((c) => c.kind === 'skip');
  const targets = eligible(ctx);
  const pickTarget = () => closestToOut(targets) ?? leader(targets);
  if (skip && targets.length > 0) {
    const nearest = closestToOut(targets);
    if (nearest && nearest.cardCount <= (boss ? 3 : 5)) return discardAction(ctx, skip, pickTarget);
  }

  const candidates = plainCards(obs.hand);
  const weight = boss ? HOOT_APPEAL * 1.5 : HOOT_APPEAL;
  const value = (c: Card) => {
    let own = ctx.me.laidDown ? cardPoints(c) : buildValue(ctx, c) + cardPoints(c) * 0.15;
    if (boss && ctx.me.laidDown) own -= 6 * futureHits(c, obs.groups);
    let danger = totalAppeal(ctx, c) * weight;
    // One-turn lookahead: would this card let someone finish right away?
    if (boss && closest && closest.cardCount === 1 && canHitTable(c, obs.groups)) danger += 400;
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
    if (g.type !== 'run') continue;
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
  return hootLike(makeCtx(obs, rand, true), false);
}

function nightshade(obs: Observation, rand: () => number): Action {
  return hootLike(makeCtx(obs, rand, true, true), true);
}

/* ---------- Entry point ---------- */

const PROFILES: Record<BotId, (obs: Observation, rand: () => number) => Action> = { pip, marigold, briar, hoot, nightshade };

/** A bot's next move. `rand` is the bot's own dice, unconnected to the game's shuffles. */
export function decide(id: BotId, obs: Observation, rand: () => number): Action {
  if (obs.stage === 'choose') return choosePhase(obs);
  return PROFILES[id](obs, rand);
}
