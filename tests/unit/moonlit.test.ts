// The Moonlit Phases: color runs, parity groups, Pairs, and every phase in the list.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decide, BOT_IDS, type BotId } from '../../src/bots/profiles.ts';
import { evaluate, simpleUnseen, tally, usedCards } from '../../src/bots/analysis.ts';
import { createGame, nextRound, step } from '../../src/engine/game.ts';
import { observe } from '../../src/engine/observation.ts';
import { PHASES, checkGroup, checkHit, findArrangement, groupLabel, matchSlots, phaseNumber, phaseSequence, phaseText, placeHit } from '../../src/engine/phases.ts';
import { createRng } from '../../src/engine/rng.ts';
import type { Card, GroupReq, LaidGroup } from '../../src/engine/types.ts';
import { playMatch } from '../../src/sim/driver.ts';
import { n, ok, table, w, s } from './helpers.ts';

const colorRun = (size: number): GroupReq => ({ type: 'colorRun', size });
const evens = (size: number): GroupReq => ({ type: 'evens', size });
const odds = (size: number): GroupReq => ({ type: 'odds', size });
const pair: GroupReq = { type: 'set', size: 2, pair: true };

/** The Moonlit phase id with this requirement, wherever the simulation put it. */
const idOf = (text: string): number => {
  const id = phaseSequence('moonlit').find((p) => phaseText(p) === text);
  assert.ok(id, `no Moonlit phase reads ${text}`);
  return id;
};

const fail = (req: GroupReq, cards: Card[], runStart?: number): string => {
  const c = checkGroup(req, cards, runStart);
  assert.ok(!c.ok, 'should not be valid');
  return c.reason;
};

const laidRun = (from: number, to: number, suit: 'rose' | 'moss' = 'rose'): LaidGroup => ({
  id: 1, owner: 0, type: 'colorRun', num: from, suit,
  cards: Array.from({ length: to - from + 1 }, (_, i) => ({ card: n(from + i, suit), num: from + i, suit })),
});
const laidParity = (type: 'evens' | 'odds'): LaidGroup => ({ id: 2, owner: 0, type, cards: [{ card: n(type === 'evens' ? 2 : 1) }] });

describe('color runs', () => {
  test('consecutive numbers in one suit are valid, in any order', () => {
    const c = checkGroup(colorRun(3), [n(5), n(3), n(4)]);
    assert.ok(c.ok);
    assert.equal(c.num, 3);
    assert.equal(c.suit, 'rose');
    assert.deepEqual(c.cards.map((p) => p.num), [3, 4, 5]);
  });

  test('more than one suit gets the exact reason', () => {
    assert.equal(fail(colorRun(3), [n(3), n(4, 'moss'), n(5)]), 'Color runs must all be one color.');
  });

  test('a gap fills with a Wild, which takes the number and suit of its position', () => {
    const wild = w();
    const c = checkGroup(colorRun(3), [n(3, 'honey'), wild, n(5, 'honey')]);
    assert.ok(c.ok);
    const placed = c.cards.find((p) => p.card.id === wild.id)!;
    assert.equal(placed.num, 4);
    assert.equal(placed.suit, 'honey');
  });

  test('a repeated number or too wide a spread fails', () => {
    assert.ok(fail(colorRun(3), [n(3), n(3), n(4)]).length > 0);
    assert.ok(fail(colorRun(3), [n(3), n(9), w()]).length > 0);
  });

  test('it stays within 1 to 12, with the exact reasons', () => {
    assert.equal(fail(colorRun(3), [n(12), n(1), w()]), "Color runs can't go past 12.");
    assert.equal(fail(colorRun(3), [n(11), n(12), w()], 11), "Color runs can't go past 12.");
    assert.equal(fail(colorRun(3), [n(1), n(2), w()], 0), "Color runs can't go below 1.");
    const top = checkGroup(colorRun(3), [n(11), n(12), w()]);
    assert.ok(top.ok);
    assert.equal(top.num, 10, 'a spare Wild goes below a run that ends at 12');
    const bottom = checkGroup(colorRun(3), [n(1), n(2), w()]);
    assert.ok(bottom.ok);
    assert.equal(bottom.num, 1);
  });

  test('all Wilds is not a group, and Skips never join', () => {
    assert.equal(fail(colorRun(3), [w(), w(), w()]), 'Each group needs at least one non-Wild card.');
    assert.equal(fail(colorRun(3), [n(1), s(), w()]), "Skips can't be part of a group.");
  });

  test('a short group is partial, not wrong', () => {
    const c = checkGroup(colorRun(3), [n(3)]);
    assert.ok(!c.ok);
    assert.ok(c.partial);
  });

  test('hits take the next number at either end, in suit', () => {
    const g = laidRun(4, 6);
    assert.deepEqual(checkHit(g, n(7)), { ok: true, ends: ['high'] });
    assert.deepEqual(checkHit(g, n(3)), { ok: true, ends: ['low'] });
    assert.deepEqual(checkHit(g, w()), { ok: true, ends: ['high', 'low'] });
    assert.deepEqual(checkHit(g, n(7, 'moss')), { ok: false, reason: 'Color runs must all be one color.' });
    assert.equal(checkHit(g, n(9)).ok, false);
    assert.equal(checkHit(g, s()).ok, false);
  });

  test('hits stop at 1 and at 12', () => {
    assert.deepEqual(checkHit(laidRun(10, 12), w()), { ok: true, ends: ['low'] });
    assert.deepEqual(checkHit(laidRun(1, 3), w()), { ok: true, ends: ['high'] });
    assert.deepEqual(checkHit(laidRun(10, 12), n(1)), { ok: false, reason: "Color runs can't go past 12." });
    assert.deepEqual(checkHit(laidRun(1, 3), n(12)), { ok: false, reason: "Color runs can't go below 1." });
    assert.equal(checkHit(laidRun(1, 12), w()).ok, false);
  });

  test('a hit Wild takes its position and the run keeps its suit and order', () => {
    const g = laidRun(4, 6, 'moss');
    placeHit(g, w(), 'low');
    placeHit(g, n(7, 'moss'), 'high');
    assert.deepEqual(g.cards.map((p) => p.num), [3, 4, 5, 6, 7]);
    assert.ok(g.cards.every((p) => p.suit === 'moss'));
    assert.equal(g.num, 3);
  });
});

describe('parity groups', () => {
  test('all even or all odd, any suit, numbers may repeat', () => {
    assert.ok(checkGroup(evens(4), [n(2), n(2, 'moss'), n(4, 'honey'), n(12)]).ok);
    assert.ok(checkGroup(odds(4), [n(1), n(1, 'moss'), n(11, 'honey'), n(7)]).ok);
  });

  test('the wrong parity gets the exact reason', () => {
    assert.equal(fail(evens(2), [n(2), n(3)]), 'That card is odd — this group is Evens.');
    assert.equal(fail(odds(2), [n(1), n(2)]), 'That card is even — this group is Odds.');
  });

  test('Wilds count, but not alone', () => {
    assert.ok(checkGroup(evens(3), [n(2), w(), w()]).ok);
    assert.equal(fail(odds(2), [w(), w()]), 'Each group needs at least one non-Wild card.');
  });

  test('hits take that parity or a Wild', () => {
    assert.deepEqual(checkHit(laidParity('evens'), n(8)), { ok: true, ends: [] });
    assert.deepEqual(checkHit(laidParity('evens'), w()), { ok: true, ends: [] });
    assert.deepEqual(checkHit(laidParity('evens'), n(3)), { ok: false, reason: 'That card is odd — this group is Evens.' });
    assert.deepEqual(checkHit(laidParity('odds'), n(3)), { ok: true, ends: [] });
    assert.deepEqual(checkHit(laidParity('odds'), n(8)), { ok: false, reason: 'That card is even — this group is Odds.' });
    assert.equal(checkHit(laidParity('odds'), s()).ok, false);
  });
});

describe('Pairs', () => {
  test('a Pair is a Set of exactly 2, and is labelled as a Pair', () => {
    assert.ok(checkGroup(pair, [n(5), n(5, 'moss')]).ok);
    assert.ok(checkGroup(pair, [n(5), w()]).ok);
    assert.equal(fail(pair, [n(5), n(6)]), 'A Set needs cards of the same number.');
    assert.equal(fail(pair, [n(5), n(5), n(5)]), 'This group only takes 2 cards.');
    assert.equal(groupLabel(pair), 'Pair');
  });

  test('classic Phase 9 keeps saying Set of 2', () => {
    assert.equal(phaseText(9), 'Set of 5 + Set of 2');
  });
});

describe('the Moonlit list', () => {
  test('there are ten, shown as 1 to 10', () => {
    const list = phaseSequence('moonlit');
    assert.equal(list.length, 10);
    assert.deepEqual(list.map(phaseNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('labels follow the requirement wording', () => {
    const texts = phaseSequence('moonlit').map(phaseText);
    for (const expected of ['4 Pairs', 'Run of 4 + 2 Pairs', 'Color run of 3 + Set of 3', '7 Evens', '3 Sets of 3', 'Color run of 4 + Run of 4', '4 Odds + 4 Evens', 'Set of 4 + 4 of one Color', 'Color run of 5 + Pair']) {
      assert.ok(texts.some((t) => t === expected || t.includes(expected)), expected);
    }
  });

  // A hand that completes each phase, and one that nearly does.
  const EXAMPLES: Record<string, { good: () => Card[]; bad: () => Card[] }> = {
    '4 Pairs': { good: () => [n(1), n(1, 'moss'), n(2), n(2, 'moss'), n(3), n(3, 'moss'), n(4), n(4, 'moss')], bad: () => [n(1), n(1, 'moss'), n(2), n(2, 'moss'), n(3), n(3, 'moss'), n(4), n(5)] },
    'Run of 4 + 2 Pairs': { good: () => [n(1), n(2), n(3), n(4), n(7), n(7, 'moss'), n(9), n(9, 'moss')], bad: () => [n(1), n(2), n(3), n(5), n(7), n(7, 'moss'), n(9), n(9, 'moss')] },
    'Color run of 3 + Set of 3': { good: () => [n(1), n(2), n(3), n(8), n(8, 'moss'), n(8, 'honey')], bad: () => [n(1), n(2), n(3, 'moss'), n(8), n(8, 'moss'), n(8, 'honey')] },
    '7 Evens': { good: () => [n(2), n(2, 'moss'), n(4), n(6), n(8), n(10), n(12)], bad: () => [n(2), n(2, 'moss'), n(4), n(6), n(8), n(10), n(11)] },
    '3 Sets of 3': { good: () => [n(1), n(1, 'moss'), n(1, 'honey'), n(2), n(2, 'moss'), n(2, 'honey'), n(3), n(3, 'moss'), n(3, 'honey')], bad: () => [n(1), n(1, 'moss'), n(1, 'honey'), n(2), n(2, 'moss'), n(2, 'honey'), n(3), n(3, 'moss'), n(4)] },
    'Color run of 4 + Run of 4': { good: () => [n(1), n(2), n(3), n(4), n(5, 'moss'), n(6), n(7, 'honey'), n(8)], bad: () => [n(1), n(2), n(3), n(4, 'moss'), n(5, 'moss'), n(6), n(7, 'honey'), n(9)] },
    '4 Odds + 4 Evens': { good: () => [n(1), n(3), n(5), n(7), n(2), n(4), n(6), n(8)], bad: () => [n(1), n(3), n(5), n(2), n(4), n(6), n(8), n(10)] },
    'Set of 4 + 4 of one Color': { good: () => [n(9, 'moss'), n(9, 'honey'), n(9, 'moonstone'), n(9, 'moss'), n(1), n(2), n(3), n(4)], bad: () => [n(9, 'moss'), n(9, 'honey'), n(9, 'moonstone'), n(8, 'moss'), n(1), n(2), n(3), n(4)] },
    'Color run of 5 + Pair': { good: () => [n(1), n(2), n(3), n(4), n(5), n(9), n(9, 'moss')], bad: () => [n(1), n(2), n(3), n(4), n(5, 'moss'), n(9), n(9, 'moss')] },
    'Color run of 6': { good: () => [n(1), n(2), n(3), n(4), n(5), n(6)], bad: () => [n(1), n(2), n(3), n(4), n(5), n(7)] },
  };

  for (const phase of phaseSequence('moonlit')) {
    const text = phaseText(phase);
    test(`${text}: a valid hand lays down, and a near miss doesn't`, () => {
      const example = EXAMPLES[text];
      assert.ok(example, `no example for ${text}`);
      const plan = findArrangement(example.good(), phase);
      assert.ok(plan, 'the good hand has an arrangement');
      assert.equal(findArrangement(example.bad(), phase), null);

      const good = example.good();
      const state = table(2, [[...good, n(12, 'honey')], [n(1), n(2)]]);
      state.players[0].phase = phase;
      state.stage = 'play';
      const groups = findArrangement(state.players[0].hand, phase)!;
      ok(step(state, { type: 'layDown', groups }));
      assert.equal(state.players[0].laidDown, true);
      assert.equal(state.groups.length, PHASES[phase].length);
      assert.deepEqual(state.groups.map((g) => g.type), PHASES[phase].map((r) => r.type));
    });

    test(`${text}: the evaluation agrees with the arrangement`, () => {
      const example = EXAMPLES[text];
      const good = example.good();
      assert.equal(evaluate(tally(good), phase, simpleUnseen(good)).missing, 0);
      const bad = example.bad();
      assert.ok(evaluate(tally(bad), phase, simpleUnseen(bad)).missing > 0);
    });
  }
});

describe('finding an arrangement', () => {
  test('a Set does not take the one card a color run needs', () => {
    const hand = [n(4), n(4, 'moss'), n(4, 'honey'), n(4, 'moonstone'), n(5), n(6)];
    const plan = findArrangement(hand, idOf('Color run of 3 + Set of 3'))!;
    assert.ok(plan, 'the rose 4 goes to the color run');
    const state = table(2, [[...hand, n(12, 'honey')], [n(1), n(2)]]);
    state.players[0].phase = idOf('Color run of 3 + Set of 3');
    state.stage = 'play';
    ok(step(state, { type: 'layDown', groups: plan }));
  });

  test('a Set does not take the cards a color group needs', () => {
    const hand = [n(9), n(9, 'moss'), n(9, 'honey'), n(9, 'moonstone'), n(1), n(2), n(3), n(9)];
    assert.ok(findArrangement(hand, idOf('Set of 4 + 4 of one Color')), 'one rose 9 is left for the color group');
  });

  test('a group left with no real card borrows one from a group with spare cards', () => {
    // The run could hold both cards, but it only needs the 6, which leaves the 5 for the Pair.
    const run = { req: { type: 'run', size: 4 }, value: 5 } as const;
    const pairOf5 = { req: pair, value: 5 };
    const cards = [{ num: 5, suit: 'rose' }, { num: 6, suit: 'moss' }] as const;
    assert.equal(matchSlots(cards, [run, pairOf5]).groupsFilled, 2);
    assert.deepEqual(matchSlots(cards, [run, pairOf5]).byGroup, [[-1, 1, -1, -1], [0, -1]]);
  });

  test('three groups need three real cards', () => {
    assert.equal(findArrangement([n(5), n(6, 'moss'), w(), w(), w(), w(), w(), w(), w()], idOf('Run of 4 + 2 Pairs')), null);
    assert.ok(findArrangement([n(5), n(6, 'moss'), n(9), w(), w(), w(), w(), w(), w()], idOf('Run of 4 + 2 Pairs')));
  });

  test('uses as few Wilds as it can', () => {
    const wild = w();
    const hand = [n(1), n(2), n(3), wild, n(2, 'moss')];
    const plan = findArrangement(hand, idOf('Color run of 6'));
    assert.equal(plan, null, 'six positions, four cards');
    const ok6 = findArrangement([n(1), n(2), n(3), n(4), n(5), n(6), wild], idOf('Color run of 6'))!;
    assert.ok(!ok6[0].cardIds.includes(wild.id));
  });

  test('a color run can hold a Wild at any position', () => {
    const plan = findArrangement([n(1), w(), n(3), n(4), w(), n(6)], idOf('Color run of 6'))!;
    assert.equal(plan[0].runStart, 1);
    assert.equal(plan[0].cardIds.length, 6);
  });
});

describe('hints', () => {
  test('the shimmer covers each new group type', () => {
    const hand = [n(1), n(2), n(3), n(9, 'moss'), n(9, 'honey'), n(9, 'moonstone'), n(11, 'honey')];
    const used = usedCards(hand, evaluate(tally(hand), idOf('Color run of 3 + Set of 3'), simpleUnseen(hand)).picks);
    assert.equal(used.size, 6);
    assert.ok(!used.has(hand[6].id));
    const parity = [n(2), n(4), n(6), n(3), n(5)];
    const usedEvens = usedCards(parity, evaluate(tally(parity), idOf('7 Evens'), simpleUnseen(parity)).picks);
    assert.deepEqual([...usedEvens].sort(), [parity[0].id, parity[1].id, parity[2].id].sort());
  });
});

describe('bots and the Moonlit Phases', () => {
  for (const id of BOT_IDS) {
    test(`${id} plays whole matches with no illegal move or stall`, () => {
      for (let i = 0; i < 2; i++) {
        const lineup: BotId[] = [id, id, 'hoot', 'briar'].slice(0, 2 + (i * 2)) as BotId[];
        const out = playMatch(lineup, `${i}${id}`.padEnd(32, '7').replace(/[^0-9a-f]/g, 'a'), 'moonlit');
        assert.deepEqual(out.illegal, []);
        assert.equal(out.stalled, false);
        assert.ok(out.winners.length > 0);
      }
    });
  }

  test('a match can be played move by move through to the end', () => {
    const { state } = createGame({ playerCount: 3, variant: 'moonlit', seed: 'cd'.repeat(16) });
    assert.equal(state.players[0].phase, 11);
    const rng = createRng('ef'.repeat(16), 1);
    const rand = () => rng.next() / 0x100000000;
    for (let moves = 0; moves < 50000 && state.stage !== 'matchOver'; moves++) {
      if (state.stage === 'roundOver') { nextRound(state); continue; }
      ok(step(state, decide('hoot', observe(state, state.current), rand)));
    }
    assert.equal(state.stage, 'matchOver');
    assert.ok(state.players[state.winners[0]].completed.includes(20));
  });
});
