// Shared hand evaluation. Everything here works from a hand and public counts only.
import { PHASES, type Card, type GroupReq, type Observation, type Suit } from './rules.ts';

const SUIT_INDEX: Record<Suit, number> = { rose: 0, moss: 1, moonstone: 2, honey: 3 };

export type Tally = { num: Int8Array; suit: Int8Array; wild: number; skip: number };

export function tally(hand: readonly Card[]): Tally {
  const t: Tally = { num: new Int8Array(14), suit: new Int8Array(4), wild: 0, skip: 0 };
  for (const c of hand) {
    if (c.kind === 'wild') t.wild++;
    else if (c.kind === 'skip') t.skip++;
    else { t.num[c.num]++; t.suit[SUIT_INDEX[c.suit]]++; }
  }
  return t;
}

/** How many of each card might still turn up, from the bot's point of view. */
export type Unseen = { num: Int8Array; suit: Int16Array; wild: number; total: number };

/** The baseline only discounts its own hand. */
export function simpleUnseen(hand: readonly Card[]): Unseen {
  const t = tally(hand);
  const u: Unseen = { num: new Int8Array(14), suit: new Int16Array(4), wild: 8 - t.wild, total: 0 };
  for (let n = 1; n <= 12; n++) u.num[n] = 8 - t.num[n];
  for (let s = 0; s < 4; s++) u.suit[s] = 24 - t.suit[s];
  return u;
}

/** The cards known to be in the discard pile right now. */
export function discardsInPile(obs: Observation): Card[] {
  const pile: Card[] = [];
  for (const h of obs.history) {
    if (h.kind === 'discard') pile.push(h.card);
    else if (h.kind === 'pickup') pile.pop();
    else if (h.kind === 'reshuffle') pile.splice(0, Math.max(0, pile.length - 1));
  }
  return pile;
}

/** The trackers also discount every card still visible on the table or in the discard pile. */
export function trackedUnseen(obs: Observation): Unseen {
  const u = simpleUnseen(obs.hand);
  const see = (c: Card) => {
    if (c.kind === 'wild') u.wild--;
    else if (c.kind === 'num') { u.num[c.num]--; u.suit[SUIT_INDEX[c.suit]]--; }
  };
  for (const g of obs.groups) for (const p of g.cards) see(p.card);
  for (const c of discardsInPile(obs)) see(c);
  u.total = obs.drawCount;
  return u;
}

export type Pick = { type: 'set' | 'run' | 'color'; size: number; value: number };
export type Evaluation = { missing: number; outs: number; score: number; picks: Pick[] };

const FLEX_WEIGHT = 0.5;
const ODDS_FLEX = 1;

/** The expected number of draws to finish, scaled to be comparable with the other scores. */
function oddsCost(missing: number, outs: number, u: Unseen): number {
  if (missing === 0) return 0;
  const pool = Math.max(30, u.total);
  let draws = 0;
  for (let i = missing; i >= 1; i--) draws += pool / Math.max(0.5, Math.max(0, u.wild) + (outs * i) / missing);
  return draws * 100;
}

const reqPick = (r: GroupReq, value: number): Pick => ({ type: r.type, size: r.size, value });

/** Finds the best way to work toward a phase. Fewer missing cards always beats more ways to draw them. */
export function evaluate(t: Tally, phase: number, u: Unseen, odds = false): Evaluation {
  const reqs = PHASES[phase];
  let bestScore = -Infinity, bestMissing = 99, bestOuts = 0;
  let a = 0, b = -1;
  // How many different plans sit at each distance: spare pairs and near-runs keep options open.
  const plans = new Int32Array(40);
  const consider = (gap: number, deficit: number, outs: number, va: number, vb: number) => {
    const missing = Math.max(gap - t.wild, deficit);
    plans[missing]++;
    const score = odds ? -oddsCost(missing, outs, u) : -1000 * missing + outs;
    if (score > bestScore) { bestScore = score; bestMissing = missing; bestOuts = outs; a = va; b = vb; }
  };
  const num = t.num;

  if (reqs.length === 1) {
    const r = reqs[0];
    if (r.type === 'color') {
      for (let s = 0; s < 4; s++) {
        const got = Math.min(r.size, t.suit[s]);
        consider(r.size - got, got === 0 ? 1 : 0, got < r.size ? u.suit[s] : 0, s, -1);
      }
    } else {
      for (let st = 1; st + r.size - 1 <= 12; st++) {
        let got = 0, outs = 0;
        for (let n = st; n < st + r.size; n++) { if (num[n] > 0) got++; else outs += u.num[n]; }
        consider(r.size - got, got === 0 ? 1 : 0, outs, st, -1);
      }
    }
  } else if (reqs[1].type === 'run') {
    const [rs, rr] = reqs;
    for (let v = 1; v <= 12; v++) {
      const gotSet = Math.min(rs.size, num[v]);
      const setOuts = gotSet < rs.size ? u.num[v] : 0;
      for (let st = 1; st + rr.size - 1 <= 12; st++) {
        let got = 0, outs = 0;
        for (let n = st; n < st + rr.size; n++) {
          const left = n === v ? num[n] - gotSet : num[n];
          if (left > 0) got++; else outs += u.num[n];
        }
        const deficit = (gotSet === 0 ? 1 : 0) + (got === 0 ? 1 : 0);
        consider(rs.size - gotSet + rr.size - got, deficit, setOuts + outs, v, st);
      }
    }
  } else {
    const [s1, s2] = reqs;
    const sameSize = s1.size === s2.size;
    for (let v1 = 1; v1 <= 12; v1++) {
      const g1 = Math.min(s1.size, num[v1]);
      const o1 = g1 < s1.size ? u.num[v1] : 0;
      for (let v2 = sameSize ? v1 : 1; v2 <= 12; v2++) {
        const g2 = Math.min(s2.size, v1 === v2 ? num[v2] - g1 : num[v2]);
        const o2 = v1 !== v2 && g2 < s2.size ? u.num[v2] : 0;
        const deficit = (g1 === 0 ? 1 : 0) + (g2 === 0 ? 1 : 0);
        consider(s1.size - g1 + s2.size - g2, deficit, o1 + o2, v1, v2);
      }
    }
  }
  const picks = [reqPick(reqs[0], a)];
  if (reqs.length === 2) picks.push(reqPick(reqs[1], b));
  const options = plans[bestMissing] + 0.25 * plans[bestMissing + 1];
  return { missing: bestMissing, outs: bestOuts, score: bestScore + options * (odds ? ODDS_FLEX : FLEX_WEIGHT), picks };
}

/** The cards a plan actually uses. Wilds are always worth keeping and are counted as used. */
export function usedCards(hand: readonly Card[], picks: readonly Pick[]): Set<number> {
  const used = new Set<number>();
  for (const c of hand) if (c.kind === 'wild') used.add(c.id);
  const SUITS: Suit[] = ['rose', 'moss', 'moonstone', 'honey'];
  for (const p of picks) {
    if (p.type === 'set') {
      let left = p.size;
      for (const c of hand) if (left > 0 && c.kind === 'num' && c.num === p.value && !used.has(c.id)) { used.add(c.id); left--; }
    } else if (p.type === 'color') {
      let left = p.size;
      for (const c of hand) if (left > 0 && c.kind === 'num' && c.suit === SUITS[p.value] && !used.has(c.id)) { used.add(c.id); left--; }
    } else {
      for (let n = p.value; n < p.value + p.size; n++) {
        const c = hand.find((x) => x.kind === 'num' && x.num === n && !used.has(x.id));
        if (c) used.add(c.id);
      }
    }
  }
  return used;
}

function adjust(t: Tally, c: Card, by: number): Tally {
  const next: Tally = { num: t.num.slice(), suit: t.suit.slice(), wild: t.wild, skip: t.skip };
  if (c.kind === 'wild') next.wild += by;
  else if (c.kind === 'skip') next.skip += by;
  else { next.num[c.num] += by; next.suit[SUIT_INDEX[c.suit]] += by; }
  return next;
}

export const without = (t: Tally, c: Card): Tally => adjust(t, c, -1);
export const plus = (t: Tally, c: Card): Tally => adjust(t, c, 1);
