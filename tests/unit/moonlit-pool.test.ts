// The Moonlit refinement pool (Change Request 03 §2): the new phase requirements, two color runs in one phase,
// the independent judge the bot sanity checks rely on, and a pin on the live list, which this work must not change.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { evaluate, simpleUnseen, tally } from '../../src/bots/analysis.ts';
import { createDeck } from '../../src/engine/cards.ts';
import { step } from '../../src/engine/game.ts';
import { PHASES, checkGroup, checkHit, findArrangement, phaseSequence, phaseText } from '../../src/engine/phases.ts';
import { createRng, shuffle } from '../../src/engine/rng.ts';
import type { Card, GroupReq, LaidGroup, Suit } from '../../src/engine/types.ts';
import { ELIGIBLE, MEASURED, NEW_PHASES } from '../../scripts/refine/pool.ts';
import { canGoOut, canLayDown, canShed } from '../../scripts/refine/judge.ts';
import { n, ok, table, w } from './helpers.ts';

/** Each new phase gets a scratch id on the Moonlit path, so the engine treats it exactly as a Moonlit phase. */
const ID = new Map<string, number>();
NEW_PHASES.forEach((p, i) => { PHASES[101 + i] = p.reqs; ID.set(p.text, 101 + i); });
const idOf = (text: string): number => { const id = ID.get(text); assert.ok(id, `no pool phase reads ${text}`); return id; };

const colorRun = (size: number): GroupReq => ({ type: 'colorRun', size });
const m = (num: number) => n(num, 'moss');
const h = (num: number) => n(num, 'honey');
const st = (num: number) => n(num, 'moonstone');
const runOf = (from: number, to: number, suit: Suit = 'rose') => Array.from({ length: to - from + 1 }, (_, i) => n(from + i, suit));

const laidRun = (id: number, from: number, to: number, suit: Suit = 'rose'): LaidGroup => ({
  id, owner: 0, type: 'colorRun', num: from, suit,
  cards: Array.from({ length: to - from + 1 }, (_, i) => ({ card: n(from + i, suit), num: from + i, suit })),
});

/** A hand that completes each new phase, and one that nearly does. */
const EXAMPLES: Record<string, { good: () => Card[]; bad: () => Card[] }> = {
  '6 of one Color': { good: () => [n(1), n(3), n(5), n(8), n(10), n(12)], bad: () => [n(1), n(3), n(5), n(8), n(10), m(12)] },
  'Color run of 3 + Set of 3 + Pair': { good: () => [...runOf(1, 3), n(8), m(8), h(8), n(10), m(10)], bad: () => [n(1), n(2), m(3), n(8), m(8), h(8), n(10), m(10)] },
  '2 Color runs of 3': { good: () => [...runOf(1, 3), ...runOf(5, 7, 'moss')], bad: () => [...runOf(1, 3), m(5), m(6), h(7)] },
  'Color run of 4 + 2 Pairs': { good: () => [...runOf(1, 4), n(7), m(7), n(9), m(9)], bad: () => [n(1), n(2), n(3), m(4), n(7), m(7), n(9), m(9)] },
  'Set of 3 + 5 of one Color': { good: () => [m(8), h(8), st(8), n(1), n(3), n(5), n(7), n(9)], bad: () => [m(8), h(8), st(8), n(1), n(3), n(5), n(7), m(9)] },
  '8 Evens': { good: () => [n(2), n(4), n(6), n(8), n(10), n(12), m(2), m(4)], bad: () => [n(2), n(4), n(6), n(8), n(10), n(12), m(2), m(5)] },
  '8 Odds': { good: () => [n(1), n(3), n(5), n(7), n(9), n(11), m(1), m(3)], bad: () => [n(1), n(3), n(5), n(7), n(9), n(11), m(1), m(4)] },
  '2 Sets of 3 + Pair': { good: () => [n(1), m(1), h(1), n(2), m(2), h(2), n(5), m(5)], bad: () => [n(1), m(1), h(1), n(2), m(2), h(2), n(5), m(6)] },
  'Set of 4 + 2 Pairs': { good: () => [n(3), m(3), h(3), st(3), n(6), m(6), n(9), m(9)], bad: () => [n(3), m(3), h(3), n(4), n(6), m(6), n(9), m(9)] },
  'Color run of 4 + Set of 3': { good: () => [...runOf(1, 4), n(8), m(8), h(8)], bad: () => [n(1), n(2), n(3), n(5), n(8), m(8), h(8)] },
  'Color run of 3 + Set of 4': { good: () => [...runOf(1, 3), n(8), m(8), h(8), st(8)], bad: () => [...runOf(1, 3), n(8), m(8), h(8), n(9)] },
  'Color run of 4 + Color run of 3': { good: () => [...runOf(1, 4), m(6), m(7), m(8)], bad: () => [...runOf(1, 4), m(6), m(7), h(8)] },
  'Set of 4 + 5 of one Color': { good: () => [m(9), h(9), st(9), m(9), n(1), n(2), n(3), n(5), n(7)], bad: () => [m(9), h(9), st(9), m(9), n(1), n(2), n(3), n(5), m(7)] },
  'Color run of 5 + Set of 3': { good: () => [...runOf(1, 5), m(8), h(8), st(8)], bad: () => [...runOf(1, 4), n(6), m(8), h(8), st(8)] },
  'Color run of 4 + Set of 4': { good: () => [...runOf(1, 4), m(8), h(8), st(8), m(8)], bad: () => [...runOf(1, 4), m(8), h(8), st(8), m(7)] },
  'Color run of 6 + Pair': { good: () => [...runOf(1, 6), m(9), h(9)], bad: () => [...runOf(1, 5), n(7), m(9), h(9)] },
  '2 Color runs of 4': { good: () => [...runOf(1, 4), ...runOf(1, 4)], bad: () => [...runOf(1, 4), n(1), n(2), n(3), m(4)] },
  'Color run of 5 + Color run of 3': { good: () => [...runOf(1, 5), ...runOf(6, 8)], bad: () => [...runOf(1, 5), n(6), n(7), m(8)] },
  'Color run of 7': { good: () => runOf(1, 7), bad: () => [...runOf(1, 6), n(8)] },
};

describe('the pool', () => {
  test('has 25 eligible phases, with labels that follow the existing wording', () => {
    assert.equal(ELIGIBLE.length, 25);
    assert.equal(new Set(ELIGIBLE.map((p) => p.text)).size, 25);
    for (const t of ['2 Color runs of 3', 'Color run of 4 + Color run of 3', 'Set of 3 + 5 of one Color', '2 Sets of 3 + Pair', '2 Color runs of 4']) {
      assert.ok(ELIGIBLE.some((p) => p.text === t), t);
    }
  });

  test('no phase needs 10 or more cards', () => {
    for (const p of ELIGIBLE) assert.ok(p.reqs.reduce((k, r) => k + r.size, 0) < 10, p.text);
  });

  test('the live Moonlit list is unchanged', () => {
    assert.deepEqual(phaseSequence('moonlit'), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    assert.deepEqual(phaseSequence('moonlit').map(phaseText), [
      'Run of 4 + 2 Pairs', '4 Odds + 4 Evens', '4 Pairs', '7 Evens', 'Color run of 3 + Set of 3',
      'Set of 4 + 4 of one Color', 'Color run of 4 + Run of 4', 'Color run of 5 + Pair', '3 Sets of 3', 'Color run of 6',
    ]);
  });
});

describe('every new phase', () => {
  for (const p of NEW_PHASES) {
    const phase = idOf(p.text);
    test(`${p.text}: a valid hand lays down, and a near miss doesn't`, () => {
      const ex = EXAMPLES[p.text];
      assert.ok(ex, `no example for ${p.text}`);
      assert.ok(findArrangement(ex.good(), phase), 'the good hand has an arrangement');
      assert.ok(canLayDown(ex.good(), p.reqs), 'the judge agrees');
      assert.equal(findArrangement(ex.bad(), phase), null);
      assert.equal(canLayDown(ex.bad(), p.reqs), false);

      const state = table(2, [[...ex.good(), n(12, 'honey')], [n(1), n(2)]]);
      state.players[0].phase = phase;
      state.stage = 'play';
      ok(step(state, { type: 'layDown', groups: findArrangement(state.players[0].hand, phase)! }));
      assert.equal(state.groups.length, p.reqs.length);
      assert.deepEqual(state.groups.map((g) => g.type), p.reqs.map((r) => r.type));
    });

    test(`${p.text}: the bots' evaluation agrees with the arrangement`, () => {
      const ex = EXAMPLES[p.text];
      assert.equal(evaluate(tally(ex.good()), phase, simpleUnseen(ex.good())).missing, 0);
      assert.ok(evaluate(tally(ex.bad()), phase, simpleUnseen(ex.bad())).missing > 0);
    });

    test(`${p.text}: every group needs a real card`, () => {
      const wilds = Array.from({ length: p.reqs.length - 1 }, () => n(1));
      // One natural card per group but the last, and Wilds for everything else: never enough.
      const hand = [...wilds, ...Array.from({ length: 12 }, () => w())];
      assert.equal(findArrangement(hand, phase), null);
      assert.equal(canLayDown(hand, p.reqs), false);
      for (const req of p.reqs) assert.equal((checkGroup(req, Array.from({ length: req.size }, () => w())) as { reason: string }).reason, 'Each group needs at least one non-Wild card.');
    });
  }

  test('on random hands, the evaluation, the arrangement and the judge all agree', () => {
    const rng = createRng('5a'.repeat(16), 3);
    const hands = Array.from({ length: 800 }, () => shuffle(createDeck(), rng).slice(0, 11));
    for (const p of NEW_PHASES) {
      const phase = idOf(p.text);
      for (const hand of hands) {
        const found = findArrangement(hand, phase) !== null;
        assert.equal(canLayDown(hand, p.reqs), found, `${p.text}: judge`);
        assert.equal(evaluate(tally(hand), phase, simpleUnseen(hand)).missing === 0, found, `${p.text}: evaluation`);
      }
    }
  });
});

describe('Wilds in the new phases', () => {
  test('two color runs: one real card and five Wilds is not enough, two real cards are', () => {
    const phase = idOf('2 Color runs of 3');
    assert.equal(findArrangement([n(1), w(), w(), w(), w(), w()], phase), null);
    assert.ok(findArrangement([n(1), m(5), w(), w(), w(), w()], phase));
  });

  test('a real card can be lent across groups, but the Pair still needs one of its own', () => {
    const phase = idOf('2 Sets of 3 + Pair');
    // The second Set and the Pair share out the 2s and the Wilds.
    assert.ok(findArrangement([n(1), m(1), h(1), n(2), m(2), h(2), w(), w()], phase));
    assert.equal(findArrangement([n(1), m(1), w(), w(), w(), w(), w(), w()], phase), null);
    assert.ok(findArrangement([n(1), m(2), n(5), w(), w(), w(), w(), w()], phase));
  });

  test('a Wild fills a color run of 7 at either end, within 1 to 12', () => {
    const up = checkGroup(colorRun(7), [...runOf(7, 12), w()]);
    assert.ok(up.ok);
    assert.equal(up.num, 6, 'the Wild goes below 7, since the run cannot pass 12');
    const down = checkGroup(colorRun(7), [...runOf(1, 6), w()]);
    assert.ok(down.ok);
    assert.equal(down.num, 1);
    assert.equal((checkGroup(colorRun(7), [...runOf(7, 12), w()], 7) as { reason: string }).reason, "Color runs can't go past 12.");
    assert.equal((checkGroup(colorRun(7), [...runOf(1, 6), w()], 0) as { reason: string }).reason, "Color runs can't go below 1.");
  });

  test('a Wild can stand in a gap in either of two color runs', () => {
    const phase = idOf('Color run of 4 + Color run of 3');
    const plan = findArrangement([n(1), w(), n(3), n(4), m(6), m(7), w()], phase)!;
    assert.ok(plan);
    assert.deepEqual(plan.map((g) => g.cardIds.length), [4, 3]);
  });
});

describe('two color runs in one phase', () => {
  const layTwo = (phase: number, cards: Card[]) => {
    const state = table(2, [[...cards, n(12, 'honey')], [n(1), n(2)]]);
    state.players[0].phase = phase;
    state.stage = 'play';
    ok(step(state, { type: 'layDown', groups: findArrangement(state.players[0].hand, phase)! }));
    return state;
  };

  test('the same suit, using both copies of each card', () => {
    const state = layTwo(idOf('2 Color runs of 3'), [...runOf(1, 3), ...runOf(1, 3)]);
    assert.equal(state.groups.length, 2);
    assert.ok(state.groups.every((g) => g.suit === 'rose' && g.cards.length === 3));
  });

  test('different suits', () => {
    const state = layTwo(idOf('2 Color runs of 3'), [...runOf(1, 3), ...runOf(1, 3, 'moss')]);
    assert.deepEqual(state.groups.map((g) => g.suit).sort(), ['moss', 'rose']);
    assert.ok(checkHit(state.groups.find((g) => g.suit === 'moss')!, m(4)).ok);
    assert.equal(checkHit(state.groups.find((g) => g.suit === 'rose')!, m(4)).ok, false);
  });

  test('two runs side by side stay two groups, and are never one longer run', () => {
    const state = layTwo(idOf('Color run of 4 + Color run of 3'), [...runOf(1, 4), ...runOf(5, 7)]);
    assert.equal(state.groups.length, 2);
    const [low, high] = [...state.groups].sort((a, b) => a.num! - b.num!);
    assert.deepEqual(low.cards.map((c) => c.num), [1, 2, 3, 4]);
    assert.deepEqual(high.cards.map((c) => c.num), [5, 6, 7]);
    // A second Rose 5 extends the first run; the second run still needs a 4 or an 8.
    assert.ok(checkHit(low, n(5)).ok);
    assert.equal(checkHit(high, n(5)).ok, false);
    assert.equal(checkHit(low, n(8)).ok, false);
    assert.ok(checkHit(high, n(8)).ok);
  });

  test('a card that fits either run can go on either one', () => {
    const state = layTwo(idOf('2 Color runs of 3'), [...runOf(1, 3), ...runOf(1, 3), n(4)]);
    const four = state.players[0].hand.find((c) => c.kind === 'num' && c.num === 4)!;
    for (const g of state.groups) assert.deepEqual(checkHit(g, four), { ok: true, ends: ['high'] });
    const target = state.groups[1];
    ok(step(state, { type: 'hit', cardId: four.id, groupId: target.id }));
    assert.equal(target.cards.length, 4);
    assert.equal(state.groups[0].cards.length, 3);
  });

  test('a Wild fits either run, and either end that is open', () => {
    const state = layTwo(idOf('2 Color runs of 3'), [...runOf(1, 3), ...runOf(10, 12, 'moss')]);
    const low = state.groups.find((g) => g.suit === 'rose')!;
    const high = state.groups.find((g) => g.suit === 'moss')!;
    assert.deepEqual(checkHit(low, w()), { ok: true, ends: ['high'] });
    assert.deepEqual(checkHit(high, w()), { ok: true, ends: ['low'] });
  });
});

describe('hitting at the edges of 1 and 12', () => {
  test('a color run of 7 from 6 to 12 only grows downward', () => {
    const g = laidRun(1, 6, 12);
    assert.deepEqual(checkHit(g, n(5)), { ok: true, ends: ['low'] });
    assert.deepEqual(checkHit(g, w()), { ok: true, ends: ['low'] });
    assert.equal(checkHit(g, n(4)).ok, false);
  });

  test('a color run of 7 from 1 to 7 only grows upward', () => {
    const g = laidRun(1, 1, 7);
    assert.deepEqual(checkHit(g, n(8)), { ok: true, ends: ['high'] });
    assert.deepEqual(checkHit(g, w()), { ok: true, ends: ['high'] });
    assert.equal(checkHit(g, n(9)).ok, false);
  });

  test('a color run from 1 to 12 takes nothing more', () => {
    assert.equal(checkHit(laidRun(1, 1, 12), w()).ok, false);
  });
});

describe('the independent judge', () => {
  test('it agrees with the game on random hands for every measured phase', () => {
    const rng = createRng('6b'.repeat(16), 4);
    const hands = Array.from({ length: 300 }, () => shuffle(createDeck(), rng).slice(0, 11));
    MEASURED.forEach((p, i) => {
      PHASES[201 + i] = p.reqs;
      for (const hand of hands) assert.equal(canLayDown(hand, p.reqs), findArrangement(hand, 201 + i) !== null, p.text);
    });
  });

  test('going out after laying down: hits in the right order, then a discard', () => {
    const table1 = [laidRun(1, 1, 4)];
    assert.equal(canShed([n(5), n(6)], table1), true, 'the 5 first, then the 6');
    assert.equal(canShed([n(5), n(6), m(9)], table1), true, 'then discard the 9');
    assert.equal(canShed([n(6), n(7), m(9)], table1), false, 'nothing can start the climb');
  });

  test('a Wild placed at the wrong end can block the last card', () => {
    const full = [laidRun(1, 1, 11)];
    assert.equal(canShed([w(), n(12)], full), true, 'hit the 12, discard the Wild');
    assert.equal(canShed([w(), n(12), m(9)], full), false, 'the Wild has nowhere to go once the 12 is on');
  });

  test('going out on the lay-down turn', () => {
    const reqs = PHASES[idOf('2 Color runs of 3')];
    assert.equal(canGoOut([...runOf(1, 3), ...runOf(5, 7, 'moss'), m(8)], reqs, false, []), true);
    assert.equal(canGoOut([...runOf(1, 3), ...runOf(5, 7, 'moss'), m(8), h(9)], reqs, false, []), true);
    assert.equal(canGoOut([...runOf(1, 3), ...runOf(5, 7, 'moss'), h(9), h(10)], reqs, false, []), false);
  });

  test('a group someone may not hit onto is left out', () => {
    const g = laidRun(1, 1, 4);
    assert.equal(canShed([n(5), m(9)], [g], () => false), false);
  });
});
