// Shared hand evaluation. Everything here works from a hand and public counts only.
import { PHASES, forEachCombo, groupOptions, isMoonlitPhase, matchSlots, type Card, type GroupOption, type GroupReq, type NaturalCard, type Observation, type Suit } from './rules.ts';

const SUIT_INDEX: Record<Suit, number> = { rose: 0, moss: 1, moonstone: 2, honey: 3 };
const SUIT_LIST: Suit[] = ['rose', 'moss', 'moonstone', 'honey'];
/** A number and suit together, for color runs. */
const cellOf = (num: number, suit: Suit) => (num - 1) * 4 + SUIT_INDEX[suit];

export type Tally = { num: Int8Array; suit: Int8Array; cell: Int8Array; wild: number; skip: number };

export function tally(hand: readonly Card[]): Tally {
  const t: Tally = { num: new Int8Array(14), suit: new Int8Array(4), cell: new Int8Array(48), wild: 0, skip: 0 };
  for (const c of hand) {
    if (c.kind === 'wild') t.wild++;
    else if (c.kind === 'skip') t.skip++;
    else { t.num[c.num]++; t.suit[SUIT_INDEX[c.suit]]++; t.cell[cellOf(c.num, c.suit)]++; }
  }
  return t;
}

/** How many of each card might still turn up, from the bot's point of view. */
export type Unseen = { num: Int8Array; suit: Int16Array; cell: Int8Array; wild: number; total: number };

/** The baseline only discounts its own hand. */
export function simpleUnseen(hand: readonly Card[]): Unseen {
  const t = tally(hand);
  const u: Unseen = { num: new Int8Array(14), suit: new Int16Array(4), cell: new Int8Array(48), wild: 8 - t.wild, total: 0 };
  for (let n = 1; n <= 12; n++) u.num[n] = 8 - t.num[n];
  for (let s = 0; s < 4; s++) u.suit[s] = 24 - t.suit[s];
  for (let i = 0; i < 48; i++) u.cell[i] = 2 - t.cell[i];
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
    else if (c.kind === 'num') { u.num[c.num]--; u.suit[SUIT_INDEX[c.suit]]--; u.cell[cellOf(c.num, c.suit)]--; }
  };
  for (const g of obs.groups) for (const p of g.cards) see(p.card);
  for (const c of discardsInPile(obs)) see(c);
  u.total = obs.drawCount;
  return u;
}

/** `value` is a set's number, a run's first number or a color group's suit index. A color run also has `suit`. */
export type Pick = { type: GroupReq['type']; size: number; value: number; suit?: Suit };
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
  if (isMoonlitPhase(phase)) return evaluateMoonlit(t, reqs, u, odds);
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

/** How many unseen cards could fill the open positions of one group. */
function openOuts(o: GroupOption, slots: readonly number[], u: Unseen): number {
  const { req, value, suit } = o;
  if (!slots.includes(-1)) return 0;
  if (req.type === 'set') return u.num[value];
  if (req.type === 'color') return u.suit[SUIT_INDEX[suit!]];
  let n = 0;
  if (req.type === 'evens' || req.type === 'odds') {
    for (let v = req.type === 'evens' ? 2 : 1; v <= 12; v += 2) n += u.num[v];
    return n;
  }
  slots.forEach((c, k) => {
    if (c === -1) n += req.type === 'run' ? u.num[value + k] : u.cell[cellOf(value + k, suit!)];
  });
  return n;
}

const numLeft = new Int8Array(14);
const cellLeft = new Int8Array(48);
const setFirst = new Int8Array(8);

/**
 * The quick count for groups that only care about numbers, plus color runs. A color run position takes the one
 * card it accepts first, which can never cost a card elsewhere; after that, each number simply fills as many
 * positions as it has copies. Returns null when a group came out empty but might have borrowed a card,
 * which the full matching settles instead.
 */
function countNumbers(t: Tally, combo: readonly GroupOption[], u: Unseen): { matched: number; deficit: number; outs: number } | null {
  numLeft.set(t.num);
  cellLeft.set(t.cell);
  let matched = 0, deficit = 0, outs = 0;
  // Sets of the same number share fairly: each takes one card before any takes a second.
  setFirst.fill(0);
  combo.forEach((o, i) => {
    if (o.req.type === 'set' && numLeft[o.value] > 0) { numLeft[o.value]--; setFirst[i] = 1; }
  });
  for (const pass of ['colorRun', 'set', 'run'] as const) {
    for (let i = 0; i < combo.length; i++) {
      const o = combo[i];
      if (o.req.type !== pass) continue;
      const { size } = o.req;
      let got = 0, open = 0;
      if (pass === 'set') {
        got = setFirst[i] + Math.min(size - setFirst[i], numLeft[o.value]);
        numLeft[o.value] -= got - setFirst[i];
        if (got < size) open += u.num[o.value];
        if (got === 0 && t.num[o.value] > 0) return null;
      } else {
        let any = false;
        for (let k = 0; k < size; k++) {
          const n = o.value + k;
          if (pass === 'colorRun') {
            const c = cellOf(n, o.suit!);
            if (t.cell[c] > 0) any = true;
            if (cellLeft[c] > 0) { cellLeft[c]--; numLeft[n]--; got++; } else open += u.cell[c];
          } else {
            if (t.num[n] > 0) any = true;
            if (numLeft[n] > 0) { numLeft[n]--; got++; } else open += u.num[n];
          }
        }
        if (got === 0 && any) return null;
      }
      matched += got;
      outs += open;
      if (got === 0) deficit++;
    }
  }
  return { matched, deficit, outs };
}

/** The same idea as the classic evaluation, for any number of groups of any type. */
function evaluateMoonlit(t: Tally, reqs: readonly GroupReq[], u: Unseen, odds: boolean): Evaluation {
  const cards: NaturalCard[] = [];
  for (let i = 0; i < 48; i++) {
    for (let k = 0; k < t.cell[i]; k++) cards.push({ num: Math.floor(i / 4) + 1, suit: SUIT_LIST[i % 4] });
  }
  const needed = reqs.reduce((n, r) => n + r.size, 0);
  const numbersOnly = reqs.every((r) => r.type === 'set' || r.type === 'run' || r.type === 'colorRun');
  let bestScore = -Infinity, bestMissing = 99, bestOuts = 0;
  let bestCombo: GroupOption[] = [];
  const plans = new Int32Array(40);
  // A Set can only start from a number in hand, or from scratch. Every empty number starts the same way,
  // so only the one with the most copies still out there is worth trying.
  let emptyBest = 0;
  for (let v = 1; v <= 12; v++) if (t.num[v] === 0 && (emptyBest === 0 || u.num[v] > u.num[emptyBest])) emptyBest = v;
  const optionsFor = (req: GroupReq): GroupOption[] => {
    const all = groupOptions(req);
    return req.type === 'set' ? all.filter((o) => t.num[o.value] > 0 || o.value === emptyBest) : all;
  };
  forEachCombo(reqs, (combo) => {
    let gap: number, deficit: number, outs: number;
    const quick = numbersOnly ? countNumbers(t, combo, u) : null;
    if (quick) {
      gap = needed - quick.matched;
      deficit = quick.deficit;
      outs = quick.outs;
    } else {
      const { byGroup, matched, groupsFilled } = matchSlots(cards, combo);
      gap = needed - matched;
      deficit = reqs.length - groupsFilled;
      outs = combo.reduce((n, o, i) => n + openOuts(o, byGroup[i], u), 0);
    }
    const missing = Math.max(gap - t.wild, deficit);
    plans[missing]++;
    const score = odds ? -oddsCost(missing, outs, u) : -1000 * missing + outs;
    if (score > bestScore) { bestScore = score; bestMissing = missing; bestOuts = outs; bestCombo = combo.slice(); }
  }, optionsFor);
  const picks: Pick[] = bestCombo.map((o) => ({
    type: o.req.type, size: o.req.size, value: o.req.type === 'color' ? SUIT_INDEX[o.suit!] : o.value, suit: o.suit,
  }));
  const options = plans[bestMissing] + 0.25 * plans[bestMissing + 1];
  return { missing: bestMissing, outs: bestOuts, score: bestScore + options * (odds ? ODDS_FLEX : FLEX_WEIGHT), picks };
}

/** The most particular groups choose first, so a looser group can't take the one card they need. */
const PICK_ORDER: Record<Pick['type'], number> = { colorRun: 0, run: 1, set: 2, color: 3, evens: 4, odds: 4 };

/** The cards a plan actually uses. Wilds are always worth keeping and are counted as used. */
export function usedCards(hand: readonly Card[], picks: readonly Pick[]): Set<number> {
  const used = new Set<number>();
  for (const c of hand) if (c.kind === 'wild') used.add(c.id);
  const SUITS: Suit[] = SUIT_LIST;
  const moonlit = picks.length > 2 || picks.some((p) => p.type === 'colorRun' || p.type === 'evens' || p.type === 'odds');
  for (const p of moonlit ? [...picks].sort((a, b) => PICK_ORDER[a.type] - PICK_ORDER[b.type]) : picks) {
    if (p.type === 'colorRun') {
      for (let n = p.value; n < p.value + p.size; n++) {
        const c = hand.find((x) => x.kind === 'num' && x.num === n && x.suit === p.suit && !used.has(x.id));
        if (c) used.add(c.id);
      }
      continue;
    }
    if (p.type === 'evens' || p.type === 'odds') {
      let left = p.size;
      for (const c of hand) if (left > 0 && c.kind === 'num' && (c.num % 2 === 0) === (p.type === 'evens') && !used.has(c.id)) { used.add(c.id); left--; }
      continue;
    }
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
  const next: Tally = { num: t.num.slice(), suit: t.suit.slice(), cell: t.cell.slice(), wild: t.wild, skip: t.skip };
  if (c.kind === 'wild') next.wild += by;
  else if (c.kind === 'skip') next.skip += by;
  else { next.num[c.num] += by; next.suit[SUIT_INDEX[c.suit]] += by; next.cell[cellOf(c.num, c.suit)] += by; }
  return next;
}

export const without = (t: Tally, c: Card): Tally => adjust(t, c, -1);
export const plus = (t: Tally, c: Card): Tally => adjust(t, c, 1);
