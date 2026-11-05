// An independent judge of what a hand can legally do, for the bot sanity checks (Change Request 03 §3.4).
// It never calls bot code or the game's arrangement search. It tries every way to split a hand into the required
// groups, card by card, and asks only the engine's rule checks (checkGroup, checkHit, placeHit) whether each is legal.
import { checkGroup, checkHit, placeHit } from '../../src/engine/phases.ts';
import type { Card, GroupReq, LaidGroup } from '../../src/engine/types.ts';

const SUIT_ORDER = { rose: 0, moss: 1, moonstone: 2, honey: 3 } as const;

/** Identical cards (same number and suit, or two Wilds) are interchangeable, so the search tries only one of them. */
const rank = (c: Card): number => (c.kind === 'num' ? c.num * 4 + SUIT_ORDER[c.suit] : c.kind === 'wild' ? 100 : 200);
const byRank = (a: Card, b: Card) => rank(a) - rank(b);

type Built = { req: GroupReq; cards: Card[]; start?: number };

/** Every valid first number for a run or color run made of these cards. */
function runStarts(req: GroupReq, cards: readonly Card[]): number[] {
  const nums = cards.flatMap((c) => (c.kind === 'num' ? [c.num] : []));
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const out: number[] = [];
  for (let s = Math.max(1, hi - req.size + 1); s <= lo && s + req.size - 1 <= 12; s++) if (checkGroup(req, cards, s).ok) out.push(s);
  return out;
}

/**
 * Calls `visit` with every legal lay-down of `hand` for `reqs`, and the cards left over.
 * Naturals come before Wilds in the search, so a group whose cards so far are only Wilds can be cut off at once.
 * Stops early if `visit` returns true.
 */
export function eachLayDown(hand: readonly Card[], reqs: readonly GroupReq[], visit: (groups: Built[], leftover: Card[]) => boolean): boolean {
  const pool = hand.filter((c) => c.kind !== 'skip').sort(byRank);
  const skips = hand.filter((c) => c.kind === 'skip');
  const built: Built[] = [];
  const group = (i: number, left: Card[], minFirst: number): boolean => {
    if (i === reqs.length) return visit(built, [...left, ...skips]);
    const req = reqs[i];
    const sameNext = i + 1 < reqs.length && reqs[i + 1].type === req.type && reqs[i + 1].size === req.size;
    const chosen: Card[] = [];
    const pick = (from: number): boolean => {
      if (chosen.length === req.size) {
        const check = checkGroup(req, chosen);
        if (!check.ok) return false;
        const rest = left.filter((c) => !chosen.includes(c));
        const first = rank(chosen[0]);
        const starts = req.type === 'run' || req.type === 'colorRun' ? runStarts(req, chosen) : [undefined];
        for (const start of starts) {
          built.push({ req, cards: chosen.slice(), start });
          const stop = group(i + 1, rest, sameNext ? first : -1);
          built.pop();
          if (stop) return true;
        }
        return false;
      }
      for (let j = from; j < left.length; j++) {
        if (j > from && rank(left[j]) === rank(left[j - 1])) continue;
        if (chosen.length === 0 && rank(left[j]) < minFirst) continue;
        if (left.length - j < req.size - chosen.length) break;
        chosen.push(left[j]);
        const partial = checkGroup(req, chosen);
        if ((partial.ok || partial.partial) && pick(j + 1)) return true;
        chosen.pop();
      }
      return false;
    };
    return pick(0);
  };
  return group(0, pool, -1);
}

export function canLayDown(hand: readonly Card[], reqs: readonly GroupReq[]): boolean {
  return eachLayDown(hand, reqs, () => true);
}

/** A laid group made from a built one, exactly as the engine would lay it. */
function toLaid(b: Built, id: number, owner: number): LaidGroup {
  const check = checkGroup(b.req, b.cards, b.start);
  if (!check.ok) throw new Error('judge built an invalid group');
  const g: LaidGroup = { id, owner, type: b.req.type, cards: check.cards };
  if (check.num !== undefined) g.num = check.num;
  if (check.suit !== undefined) g.suit = check.suit;
  return g;
}

const cloneGroup = (g: LaidGroup): LaidGroup => ({ ...g, cards: g.cards.slice() });
const groupSig = (g: LaidGroup): string => (g.type === 'run' || g.type === 'colorRun' ? `${g.cards[0].num}-${g.cards[g.cards.length - 1].num}` : '');

/** Whether hits can bring `hand` down to at most one card (which is then discarded), in any order. */
export function canShed(hand: readonly Card[], groups: readonly LaidGroup[], canHitOnto: (g: LaidGroup) => boolean = () => true): boolean {
  const open = groups.filter(canHitOnto).map(cloneGroup);
  const memo = new Set<string>();
  const walk = (cards: Card[]): boolean => {
    if (cards.length <= 1) return true;
    const key = cards.map(rank).join(',') + '|' + open.map(groupSig).join(',');
    if (memo.has(key)) return false;
    memo.add(key);
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (i > 0 && rank(c) === rank(cards[i - 1])) continue;
      const rest = cards.filter((_, k) => k !== i);
      for (let gi = 0; gi < open.length; gi++) {
        const check = checkHit(open[gi], c);
        if (!check.ok) continue;
        const ends: ('low' | 'high' | undefined)[] = check.ends.length > 0 ? check.ends : [undefined];
        for (const end of ends) {
          const saved = open[gi];
          open[gi] = cloneGroup(saved);
          placeHit(open[gi], c, end);
          const done = walk(rest);
          open[gi] = saved;
          if (done) return true;
        }
      }
    }
    return false;
  };
  return walk(hand.slice().sort(byRank));
}

/**
 * Whether a player could empty their hand this turn: lay down (if not down yet), hit any number of times,
 * then discard the last card, or go out on a hit.
 */
export function canGoOut(hand: readonly Card[], reqs: readonly GroupReq[], laidDown: boolean, table: readonly LaidGroup[], seat = 0, canHitOnto: (g: LaidGroup) => boolean = () => true): boolean {
  if (laidDown) return canShed(hand, table, canHitOnto);
  let nextId = 1 + Math.max(0, ...table.map((g) => g.id));
  return eachLayDown(hand, reqs, (built, leftover) => {
    if (leftover.length <= 1) return true;
    const mine = built.map((b) => toLaid(b, nextId++, seat));
    return canShed(leftover, [...table, ...mine], canHitOnto);
  });
}
