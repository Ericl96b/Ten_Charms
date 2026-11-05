import { SUITS, type Card, type GroupPlan, type GroupReq, type GroupType, type LaidGroup, type NumberCard, type Placed, type Suit, type Variant } from './types.ts';

const set = (size: number): GroupReq => ({ type: 'set', size });
const run = (size: number): GroupReq => ({ type: 'run', size });
const color = (size: number): GroupReq => ({ type: 'color', size });
const colorRun = (size: number): GroupReq => ({ type: 'colorRun', size });
const evens = (size: number): GroupReq => ({ type: 'evens', size });
const odds = (size: number): GroupReq => ({ type: 'odds', size });
const pair = (): GroupReq => ({ type: 'set', size: 2, pair: true });

/** Requirements by phase id. 1 through 10 are the classic list; 11 through 20 are the Moonlit list. */
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
  // The Moonlit order comes from the simulation in SIMULATION_MAP2.md: easiest first, and fixed from here on.
  11: [run(4), pair(), pair()],
  12: [odds(4), evens(4)],
  13: [pair(), pair(), pair(), pair()],
  14: [evens(7)],
  15: [colorRun(3), set(3)],
  16: [set(4), color(4)],
  17: [colorRun(4), run(4)],
  18: [colorRun(5), pair()],
  19: [set(3), set(3), set(3)],
  20: [colorRun(6)],
  // Free Play trials of a refined Moonlit list, from SIMULATION_MOONLIT_REFINEMENT.md: Trial A is 21 to 30,
  // Trial B 31 to 40, Trial C 41 to 50, each easiest first. They play exactly like the Moonlit Phases.
  21: [set(3), set(3), pair()],
  22: [odds(8)],
  23: [evens(8)],
  24: [set(4), pair(), pair()],
  25: [colorRun(4), pair(), pair()],
  26: [set(4), color(4)],
  27: [colorRun(3), colorRun(3)],
  28: [colorRun(4), set(3)],
  29: [colorRun(3), set(4)],
  30: [colorRun(5), pair()],
  31: [evens(7)],
  32: [colorRun(3), set(3)],
  33: [color(6)],
  34: [set(3), color(5)],
  35: [colorRun(3), set(3), pair()],
  36: [odds(8)],
  37: [set(4), color(4)],
  38: [colorRun(4), set(3)],
  39: [colorRun(3), set(4)],
  40: [colorRun(5), pair()],
  41: [evens(7)],
  42: [colorRun(3), set(3)],
  43: [color(6)],
  44: [set(3), color(5)],
  45: [colorRun(3), set(3), pair()],
  46: [set(3), set(3), pair()],
  47: [evens(8)],
  48: [set(4), color(4)],
  49: [colorRun(4), set(3)],
  50: [colorRun(5), pair()],
};

const ALL_PHASES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SPRINT_PHASES = [1, 3, 5, 7, 9];
const MOONLIT_PHASES = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
export const CLASSIC_PHASE_COUNT = ALL_PHASES.length;
/** Each Moonlit Trial's list, in order. */
const TRIAL_PHASES: Partial<Record<Variant, number[]>> = {
  trialA: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  trialB: [31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
  trialC: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
};
export const TRIAL_VARIANTS = ['trialA', 'trialB', 'trialC'] as const;

export function phaseSequence(variant: Variant): number[] {
  if (variant === 'moonlit') return MOONLIT_PHASES;
  const trial = TRIAL_PHASES[variant];
  if (trial) return trial;
  return variant === 'sprint' ? SPRINT_PHASES : ALL_PHASES;
}

/** The Moonlit Phases and its Free Play trials: the same group types, rules and Charms, on different lists. */
export function isMoonlitFamily(variant: Variant): boolean {
  return variant === 'moonlit' || TRIAL_PHASES[variant] !== undefined;
}

export function isMoonlitPhase(phase: number): boolean {
  return phase > CLASSIC_PHASE_COUNT;
}

/** The number a player sees: a Moonlit phase, or a trial's, shows its place in its own list of ten. */
export function phaseNumber(phase: number): number {
  return isMoonlitPhase(phase) ? ((phase - CLASSIC_PHASE_COUNT - 1) % 10) + 1 : phase;
}

export function groupLabel(req: GroupReq): string {
  if (req.pair) return 'Pair';
  if (req.type === 'colorRun') return `Color run of ${req.size}`;
  if (req.type === 'evens') return `${req.size} Evens`;
  if (req.type === 'odds') return `${req.size} Odds`;
  const name = req.type === 'set' ? 'Set' : 'Run';
  return req.type === 'color' ? `${req.size} of one Color` : `${name} of ${req.size}`;
}

/** Repeated groups are counted: "4 Pairs", "Run of 4 + 2 Pairs", "3 Sets of 3", "2 Color runs of 3". */
function moonlitText(reqs: readonly GroupReq[]): string {
  const parts: string[] = [];
  for (let i = 0; i < reqs.length; i++) {
    let count = 1;
    while (i + 1 < reqs.length && groupLabel(reqs[i + 1]) === groupLabel(reqs[i])) { count++; i++; }
    const label = groupLabel(reqs[i]);
    if (count === 1) parts.push(label);
    else parts.push(reqs[i].pair ? `${count} Pairs` : `${count} ${label.replace(/^(Set|Run|Color run)/, '$1s')}`);
  }
  return parts.join(' + ');
}

export function phaseText(phase: number): string {
  const reqs = PHASES[phase];
  if (isMoonlitPhase(phase)) return moonlitText(reqs);
  if (reqs.length === 2 && reqs[0].type === reqs[1].type && reqs[0].size === reqs[1].size) {
    return `2 ${reqs[0].type === 'set' ? 'Sets' : 'Runs'} of ${reqs[0].size}`;
  }
  return reqs.map(groupLabel).join(' + ');
}

function parityReason(type: 'evens' | 'odds'): string {
  return type === 'evens' ? 'That card is odd — this group is Evens.' : 'That card is even — this group is Odds.';
}

export type GroupCheck =
  | { ok: true; cards: Placed[]; num?: number; suit?: Suit }
  | { ok: false; reason: string; partial: boolean };

/** Works out a run's first number: fill the gaps, then spend leftover Wilds upward, then downward. */
function runPlacement(naturals: number[], size: number, runStart?: number, plural = 'Runs', one = 'Run'): { start: number } | { reason: string } {
  const lo = Math.min(...naturals);
  const hi = Math.max(...naturals);
  if (hi - lo + 1 > size) return { reason: hi === 12 ? `${plural} can't go past 12.` : `Those numbers don't fit in a ${one} of ${size}.` };
  if (size > 12) return { reason: `${plural} can't go past 12.` };
  if (runStart !== undefined) {
    if (runStart < 1) return { reason: `${plural} can't go below 1.` };
    if (runStart + size - 1 > 12) return { reason: `${plural} can't go past 12.` };
    if (lo < runStart || hi > runStart + size - 1) return { reason: `Those cards don't fit that ${one}.` };
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

  if (req.type === 'evens' || req.type === 'odds') {
    const wrong = naturals.find((c) => (c.num % 2 === 0) !== (req.type === 'evens'));
    if (wrong) return fail(parityReason(req.type));
    if (cards.length < req.size) return fail('', true);
    return { ok: true, cards: cards.map((card) => ({ card })) };
  }

  if (req.type === 'colorRun') {
    if (new Set(naturals.map((c) => c.suit)).size > 1) return fail('Color runs must all be one color.');
    const nums = naturals.map((c) => c.num);
    if (new Set(nums).size !== nums.length) return fail("A Color run can't repeat a number.");
    if (nums.length === 0) return fail('', true);
    const placement = runPlacement(nums, req.size, runStart, 'Color runs', 'Color run');
    if ('reason' in placement) return fail(placement.reason);
    if (cards.length < req.size) return fail('', true);
    const suit = naturals[0].suit;
    const start = placement.start;
    const wilds = cards.filter((c) => c.kind === 'wild');
    const placed: Placed[] = [];
    for (let n = start; n < start + req.size; n++) {
      const natural = naturals.find((c) => c.num === n);
      placed.push({ card: natural ?? wilds.pop()!, num: n, suit });
    }
    return { ok: true, num: start, suit, cards: placed };
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
  if (group.type === 'evens' || group.type === 'odds') {
    if (card.kind === 'wild' || (card.num % 2 === 0) === (group.type === 'evens')) return { ok: true, ends: [] };
    return { ok: false, reason: parityReason(group.type) };
  }
  const lo = group.cards[0].num!;
  const hi = group.cards[group.cards.length - 1].num!;
  const ends: ('low' | 'high')[] = [];
  const colored = group.type === 'colorRun';
  if (card.kind === 'wild') {
    if (hi < 12) ends.push('high');
    if (lo > 1) ends.push('low');
    if (ends.length === 0) return { ok: false, reason: `That ${colored ? 'Color run' : 'Run'} already spans 1 to 12.` };
    return { ok: true, ends };
  }
  if (colored) {
    if (card.suit !== group.suit) return { ok: false, reason: 'Color runs must all be one color.' };
    if (card.num === hi + 1) ends.push('high');
    if (card.num === lo - 1) ends.push('low');
    if (ends.length > 0) return { ok: true, ends };
    if (hi === 12 && card.num < lo) return { ok: false, reason: "Color runs can't go past 12." };
    if (lo === 1 && card.num > hi) return { ok: false, reason: "Color runs can't go below 1." };
    return { ok: false, reason: `That Color run needs a ${lo > 1 ? lo - 1 : hi + 1}${lo > 1 && hi < 12 ? ` or a ${hi + 1}` : ''}.` };
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
  if (group.type === 'evens' || group.type === 'odds') { group.cards.push({ card }); return; }
  const suit = group.type === 'colorRun' ? { suit: group.suit } : {};
  if (end === 'low') {
    const num = group.cards[0].num! - 1;
    group.cards.unshift({ card, num, ...suit });
    group.num = num;
  } else {
    group.cards.push({ card, num: group.cards[group.cards.length - 1].num! + 1, ...suit });
  }
}

/* ---------- Matching cards to Moonlit phases ---------- */

/** One way to fill a group: the value it builds on, and, for a color run or color group, its suit. */
export type GroupOption = { req: GroupReq; value: number; suit?: Suit };

const optionCache = new Map<string, GroupOption[]>();

/** Every way a requirement could be met. */
export function groupOptions(req: GroupReq): GroupOption[] {
  const key = `${req.type}:${req.size}`;
  const cached = optionCache.get(key);
  if (cached) return cached;
  const out: GroupOption[] = [];
  if (req.type === 'set') for (let n = 1; n <= 12; n++) out.push({ req, value: n });
  if (req.type === 'run') for (let s = 1; s + req.size - 1 <= 12; s++) out.push({ req, value: s });
  if (req.type === 'color') for (const suit of SUITS) out.push({ req, value: 0, suit });
  if (req.type === 'colorRun') for (let s = 1; s + req.size - 1 <= 12; s++) for (const suit of SUITS) out.push({ req, value: s, suit });
  if (req.type === 'evens' || req.type === 'odds') out.push({ req, value: 0 });
  optionCache.set(key, out);
  return out;
}

function slotAccepts(o: GroupOption, i: number, num: number, suit: Suit): boolean {
  switch (o.req.type) {
    case 'set': return num === o.value;
    case 'run': return num === o.value + i;
    case 'colorRun': return num === o.value + i && suit === o.suit;
    case 'color': return suit === o.suit;
    case 'evens': return num % 2 === 0;
    case 'odds': return num % 2 === 1;
  }
}

export type NaturalCard = { num: number; suit: Suit };

/**
 * Gives as many positions as possible a real card: the fewest Wilds a choice of groups can need. Then any group
 * left with no real card takes one from a group with more than one, since a group of nothing but Wilds isn't allowed.
 * Each position gets a card's index, or -1.
 */
export function matchSlots(cards: readonly NaturalCard[], combo: readonly GroupOption[]): { byGroup: number[][]; matched: number; groupsFilled: number } {
  const slotGroup: number[] = [];
  const slotIndex: number[] = [];
  combo.forEach((o, g) => { for (let i = 0; i < o.req.size; i++) { slotGroup.push(g); slotIndex.push(i); } });
  const cardOwner = new Array<number>(cards.length).fill(-1);
  const filled = new Array<number>(combo.length).fill(0);
  const seen = new Array<boolean>(cards.length);
  const take = (slot: number, canDrop: boolean): boolean => {
    const o = combo[slotGroup[slot]];
    for (let c = 0; c < cards.length; c++) {
      if (seen[c] || !slotAccepts(o, slotIndex[slot], cards[c].num, cards[c].suit)) continue;
      seen[c] = true;
      const held = cardOwner[c];
      if (held === -1 || (canDrop && filled[slotGroup[held]] > 1)) {
        if (held !== -1) filled[slotGroup[held]]--;
        cardOwner[c] = slot;
        filled[slotGroup[slot]]++;
        return true;
      }
      if (take(held, canDrop)) {
        filled[slotGroup[held]]--;
        cardOwner[c] = slot;
        filled[slotGroup[slot]]++;
        return true;
      }
    }
    return false;
  };
  let matched = 0;
  for (let slot = 0; slot < slotGroup.length; slot++) {
    seen.fill(false);
    if (take(slot, false)) matched++;
  }
  let at = 0;
  combo.forEach((o, g) => {
    for (let i = 0; i < o.req.size && filled[g] === 0; i++) {
      seen.fill(false);
      take(at + i, true);
    }
    at += o.req.size;
  });
  const byGroup = combo.map((o) => new Array<number>(o.req.size).fill(-1));
  cardOwner.forEach((slot, c) => { if (slot !== -1) byGroup[slotGroup[slot]][slotIndex[slot]] = c; });
  return { byGroup, matched: byGroup.reduce((n, g) => n + g.filter((c) => c !== -1).length, 0), groupsFilled: filled.filter((n) => n > 0).length };
}

/** Calls back with every combination of group options, skipping repeats of identical requirements in another order. */
export function forEachCombo(reqs: readonly GroupReq[], visit: (combo: GroupOption[]) => void, optionsFor: (req: GroupReq) => GroupOption[] = groupOptions): void {
  const combo: GroupOption[] = [];
  const walk = (i: number, floor: number) => {
    if (i === reqs.length) { visit(combo); return; }
    const opts = optionsFor(reqs[i]);
    const same = i + 1 < reqs.length && reqs[i + 1].type === reqs[i].type && reqs[i + 1].size === reqs[i].size;
    for (let k = floor; k < opts.length; k++) {
      combo.push(opts[k]);
      walk(i + 1, same ? k : 0);
      combo.pop();
    }
  };
  walk(0, 0);
}

/** The exact search behind Suggest and the bots for Moonlit phases: fewest Wilds, and a real card in every group. */
function findMoonlitArrangement(hand: readonly Card[], reqs: readonly GroupReq[]): GroupPlan[] | null {
  const wilds = hand.filter((c) => c.kind === 'wild');
  const naturals = hand.filter((c): c is NumberCard => c.kind === 'num');
  const needed = reqs.reduce((n, r) => n + r.size, 0);
  const num = new Array<number>(13).fill(0);
  const cell = new Map<string, number>();
  const suitCount = new Map<Suit, number>();
  let evensCount = 0;
  for (const c of naturals) {
    num[c.num]++;
    cell.set(`${c.num}${c.suit}`, (cell.get(`${c.num}${c.suit}`) ?? 0) + 1);
    suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);
    if (c.num % 2 === 0) evensCount++;
  }
  /** The most real cards a group could possibly hold, counting each card for every group it fits. */
  const most = (o: GroupOption): number => {
    const { type, size } = o.req;
    if (type === 'set') return Math.min(size, num[o.value]);
    if (type === 'color') return Math.min(size, suitCount.get(o.suit!) ?? 0);
    if (type === 'evens') return Math.min(size, evensCount);
    if (type === 'odds') return Math.min(size, naturals.length - evensCount);
    let n = 0;
    for (let k = 0; k < size; k++) n += type === 'run' ? Math.min(1, num[o.value + k]) : Math.min(1, cell.get(`${o.value + k}${o.suit}`) ?? 0);
    return n;
  };
  let best: { plan: GroupPlan[]; wildsUsed: number } | null = null;
  forEachCombo(reqs, (combo) => {
    if (best?.wildsUsed === 0) return;
    let bound = 0;
    for (const o of combo) {
      const m = most(o);
      if (m === 0) return;
      bound += m;
    }
    const fewest = needed - bound;
    if (fewest > wilds.length || (best && fewest >= best.wildsUsed)) return;
    const { byGroup, matched, groupsFilled } = matchSlots(naturals, combo);
    if (groupsFilled < reqs.length) return;
    const wildsUsed = needed - matched;
    if (wildsUsed > wilds.length || (best && wildsUsed >= best.wildsUsed)) return;
    let w = 0;
    const plan = byGroup.map((slots, gi): GroupPlan => {
      const cardIds = slots.map((c) => (c === -1 ? wilds[w++].id : naturals[c].id));
      const t = reqs[gi].type;
      return t === 'run' || t === 'colorRun' ? { cardIds, runStart: combo[gi].value } : { cardIds };
    });
    best = { plan, wildsUsed };
  });
  return best ? (best as { plan: GroupPlan[] }).plan : null;
}

type Spec = { type: GroupType; size: number; value: number };

/**
 * Finds a valid assignment of a hand to a phase's groups, using as few Wilds as possible.
 * Used by the Suggest button and by the bots, so it reads nothing but the hand it is given.
 */
export function findArrangement(hand: readonly Card[], phase: number): GroupPlan[] | null {
  const reqs = PHASES[phase];
  if (isMoonlitPhase(phase)) return findMoonlitArrangement(hand, reqs);
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
