import type { Card, GroupPlan, GroupReq, GroupType, LaidGroup, Placed, Suit, Variant } from './types.ts';

const set = (size: number): GroupReq => ({ type: 'set', size });
const run = (size: number): GroupReq => ({ type: 'run', size });
const color = (size: number): GroupReq => ({ type: 'color', size });

/** Requirements by phase number, 1 through 10. */
export const PHASES: Record<number, GroupReq[]> = {
  1: [set(3), set(3)],
  2: [set(3), run(4)],
  3: [set(4), run(4)],
  4: [run(7)],
  5: [run(8)],
  6: [run(9)],
  7: [set(4), set(4)],
  8: [color(7)],
  9: [set(5), set(2)],
  10: [set(5), set(3)],
};

const ALL_PHASES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SPRINT_PHASES = [1, 3, 5, 7, 9];

export function phaseSequence(variant: Variant): number[] {
  return variant === 'sprint' ? SPRINT_PHASES : ALL_PHASES;
}

export function groupLabel(req: GroupReq): string {
  const name = req.type === 'set' ? 'Set' : req.type === 'run' ? 'Run' : 'Color';
  return req.type === 'color' ? `${req.size} of one Color` : `${name} of ${req.size}`;
}

export function phaseText(phase: number): string {
  const reqs = PHASES[phase];
  if (reqs.length === 2 && reqs[0].type === reqs[1].type && reqs[0].size === reqs[1].size) {
    return `2 ${reqs[0].type === 'set' ? 'Sets' : 'Runs'} of ${reqs[0].size}`;
  }
  return reqs.map(groupLabel).join(' + ');
}

export type GroupCheck =
  | { ok: true; cards: Placed[]; num?: number; suit?: Suit }
  | { ok: false; reason: string; partial: boolean };

/** Works out a run's first number: fill the gaps, then spend leftover Wilds upward, then downward. */
function runPlacement(naturals: number[], size: number, runStart?: number): { start: number } | { reason: string } {
  const lo = Math.min(...naturals);
  const hi = Math.max(...naturals);
  if (hi - lo + 1 > size) return { reason: hi === 12 ? "Runs can't go past 12." : `Those numbers don't fit in a Run of ${size}.` };
  if (size > 12) return { reason: "Runs can't go past 12." };
  if (runStart !== undefined) {
    if (runStart < 1) return { reason: "Runs can't go below 1." };
    if (runStart + size - 1 > 12) return { reason: "Runs can't go past 12." };
    if (lo < runStart || hi > runStart + size - 1) return { reason: 'Those cards don\'t fit that Run.' };
    return { start: runStart };
  }
  let start = lo;
  if (start + size - 1 > 12) start = 12 - size + 1;
  return { start };
}

/**
 * Checks cards against one group requirement. `exact` demands the required count;
 * without it a too-short group is reported as partial, which drives the slot status.
 */
export function checkGroup(req: GroupReq, cards: readonly Card[], runStart?: number): GroupCheck {
  const fail = (reason: string, partial = false): GroupCheck => ({ ok: false, reason, partial });
  if (cards.some((c) => c.kind === 'skip')) return fail("Skips can't be part of a group.");
  const naturals = cards.filter((c) => c.kind === 'num');
  if (cards.length > 0 && naturals.length === 0) return fail('Each group needs at least one non-Wild card.');
  if (cards.length > req.size) return fail(`This group only takes ${req.size} cards.`);

  if (req.type === 'set') {
    const nums = new Set(naturals.map((c) => c.num));
    if (nums.size > 1) return fail('A Set needs cards of the same number.');
    if (cards.length < req.size) return fail('', true);
    const num = naturals[0].num;
    return { ok: true, num, cards: cards.map((card) => ({ card, num })) };
  }

  if (req.type === 'color') {
    const suits = new Set(naturals.map((c) => c.suit));
    if (suits.size > 1) return fail('A Color group needs cards of one suit.');
    if (cards.length < req.size) return fail('', true);
    const suit = naturals[0].suit;
    return { ok: true, suit, cards: cards.map((card) => ({ card, suit })) };
  }

  const nums = naturals.map((c) => c.num);
  if (new Set(nums).size !== nums.length) return fail("A Run can't repeat a number.");
  if (nums.length > 0) {
    const placement = runPlacement(nums, req.size, runStart);
    if ('reason' in placement) return fail(placement.reason);
    if (cards.length < req.size) return fail('', true);
    const start = placement.start;
    const wilds = cards.filter((c) => c.kind === 'wild');
    const placed: Placed[] = [];
    for (let n = start; n < start + req.size; n++) {
      const natural = naturals.find((c) => c.num === n);
      placed.push({ card: natural ?? wilds.pop()!, num: n });
    }
    return { ok: true, num: start, cards: placed };
  }
  return fail('', true);
}

export type HitCheck = { ok: true; ends: ('low' | 'high')[] } | { ok: false; reason: string };

/** Whether a card can join a laid group, and for runs which ends it can go on. */
export function checkHit(group: LaidGroup, card: Card): HitCheck {
  if (card.kind === 'skip') return { ok: false, reason: "Skips can't be used to hit." };
  if (group.type === 'set') {
    if (card.kind === 'wild' || card.num === group.num) return { ok: true, ends: [] };
    return { ok: false, reason: `That Set is all ${group.num}s.` };
  }
  if (group.type === 'color') {
    if (card.kind === 'wild' || card.suit === group.suit) return { ok: true, ends: [] };
    return { ok: false, reason: 'That card is the wrong Color.' };
  }
  const lo = group.cards[0].num!;
  const hi = group.cards[group.cards.length - 1].num!;
  const ends: ('low' | 'high')[] = [];
  if (card.kind === 'wild') {
    if (hi < 12) ends.push('high');
    if (lo > 1) ends.push('low');
    if (ends.length === 0) return { ok: false, reason: "That Run already spans 1 to 12." };
    return { ok: true, ends };
  }
  if (card.num === hi + 1) ends.push('high');
  if (card.num === lo - 1) ends.push('low');
  if (ends.length > 0) return { ok: true, ends };
  if (hi === 12 && card.num < lo) return { ok: false, reason: "Runs can't go past 12." };
  return { ok: false, reason: `That Run needs a ${lo > 1 ? lo - 1 : hi + 1}${lo > 1 && hi < 12 ? ` or a ${hi + 1}` : ''}.` };
}

export function placeHit(group: LaidGroup, card: Card, end?: 'low' | 'high'): void {
  if (group.type === 'set') { group.cards.push({ card, num: group.num }); return; }
  if (group.type === 'color') { group.cards.push({ card, suit: group.suit }); return; }
  if (end === 'low') {
    const num = group.cards[0].num! - 1;
    group.cards.unshift({ card, num });
    group.num = num;
  } else {
    group.cards.push({ card, num: group.cards[group.cards.length - 1].num! + 1 });
  }
}

type Spec = { type: GroupType; size: number; value: number };

/**
 * Finds a valid assignment of a hand to a phase's groups, using as few Wilds as possible.
 * Used by the Suggest button and by the bots, so it reads nothing but the hand it is given.
 */
export function findArrangement(hand: readonly Card[], phase: number): GroupPlan[] | null {
  const reqs = PHASES[phase];
  const wilds = hand.filter((c) => c.kind === 'wild');
  const naturals = hand.filter((c) => c.kind === 'num');

  const options = (req: GroupReq): Spec[] => {
    const out: Spec[] = [];
    if (req.type === 'set') for (let n = 1; n <= 12; n++) out.push({ type: 'set', size: req.size, value: n });
    if (req.type === 'run') for (let s = 1; s + req.size - 1 <= 12; s++) out.push({ type: 'run', size: req.size, value: s });
    if (req.type === 'color') for (let s = 0; s < 4; s++) out.push({ type: 'color', size: req.size, value: s });
    return out;
  };
  const SUIT_LIST: Suit[] = ['rose', 'moss', 'moonstone', 'honey'];

  const take = (spec: Spec, pool: Card[]): Card[] => {
    const got: Card[] = [];
    if (spec.type === 'set') {
      for (const c of pool) if (c.kind === 'num' && c.num === spec.value && got.length < spec.size) got.push(c);
    } else if (spec.type === 'color') {
      for (const c of pool) if (c.kind === 'num' && c.suit === SUIT_LIST[spec.value] && got.length < spec.size) got.push(c);
    } else {
      for (let n = spec.value; n < spec.value + spec.size; n++) {
        const c = pool.find((x) => x.kind === 'num' && x.num === n);
        if (c) got.push(c);
      }
    }
    return got;
  };

  let best: { plan: GroupPlan[]; wildsUsed: number } | null = null;
  const search = (i: number, pool: Card[], wildsLeft: number, plan: GroupPlan[]) => {
    if (i === reqs.length) {
      const wildsUsed = wilds.length - wildsLeft;
      if (!best || wildsUsed < best.wildsUsed) best = { plan: plan.map((p) => ({ ...p })), wildsUsed };
      return;
    }
    for (const spec of options(reqs[i])) {
      const got = take(spec, pool);
      if (got.length === 0) continue;
      const need = spec.size - got.length;
      if (need > wildsLeft) continue;
      const used = new Set(got.map((c) => c.id));
      const wildIds = wilds.slice(wilds.length - wildsLeft, wilds.length - wildsLeft + need).map((c) => c.id);
      const entry: GroupPlan = { cardIds: [...got.map((c) => c.id), ...wildIds] };
      if (spec.type === 'run') entry.runStart = spec.value;
      plan.push(entry);
      search(i + 1, pool.filter((c) => !used.has(c.id)), wildsLeft - need, plan);
      plan.pop();
    }
  };
  search(0, naturals, wilds.length, []);
  return best ? (best as { plan: GroupPlan[] }).plan : null;
}
