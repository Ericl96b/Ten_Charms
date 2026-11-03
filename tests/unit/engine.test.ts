import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cardPoints, createDeck, handPoints } from '../../src/engine/cards.ts';
import { createGame, eligibleSkipTargets, nextRound, step } from '../../src/engine/game.ts';
import { PHASES, checkGroup, checkHit, findArrangement } from '../../src/engine/phases.ts';
import { createRng, newSeed, shuffle } from '../../src/engine/rng.ts';
import type { Card, GameState, GroupPlan, GroupReq, LaidGroup } from '../../src/engine/types.ts';
import { n, ok, s, table, w } from './helpers.ts';

const ids = (cards: Card[]) => cards.map((c) => c.id);
const valid = (req: GroupReq, cards: Card[]) => checkGroup(req, cards).ok;

function layDownState(hand: Card[], plan: GroupPlan[], phase = 1, over: Partial<GameState> = {}) {
  const state = table(2, [hand, [n(1), n(2), n(3)]], { stage: 'play', ...over });
  state.players[0].phase = phase;
  return { state, plan };
}

function group(type: LaidGroup['type'], cards: Card[], extra: Partial<LaidGroup> = {}, owner = 0): LaidGroup {
  const start = extra.num ?? 1;
  return {
    id: 50, owner, type,
    cards: cards.map((card, i) => ({ card, num: type === 'run' ? start + i : extra.num, suit: extra.suit })),
    ...extra,
  };
}

describe('deck', () => {
  test('has 108 cards with the right make-up', () => {
    const deck = createDeck();
    assert.equal(deck.length, 108);
    assert.equal(deck.filter((c) => c.kind === 'wild').length, 8);
    assert.equal(deck.filter((c) => c.kind === 'skip').length, 4);
    assert.equal(new Set(deck.map((c) => c.id)).size, 108);
    for (const suit of ['rose', 'moss', 'moonstone', 'honey']) {
      for (let num = 1; num <= 12; num++) {
        assert.equal(deck.filter((c) => c.kind === 'num' && c.num === num && c.suit === suit).length, 2);
      }
    }
  });

  test('shuffles are deterministic per seed and differ across seeds', () => {
    const a = shuffle(createDeck(), createRng('11'.repeat(16))).map((c) => c.id);
    const b = shuffle(createDeck(), createRng('11'.repeat(16))).map((c) => c.id);
    const c = shuffle(createDeck(), createRng('22'.repeat(16))).map((c) => c.id);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.equal(newSeed().length, 32);
    assert.notEqual(newSeed(), newSeed());
  });

  test('the shuffle is unbiased', () => {
    const counts = Array(10).fill(0);
    const rng = createRng('33'.repeat(16));
    const trials = 40000;
    for (let t = 0; t < trials; t++) {
      const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      counts[shuffle(items, rng)[0]]++;
    }
    for (const c of counts) assert.ok(Math.abs(c - trials / 10) < 300, `position count ${c}`);
  });
});

describe('phase definitions', () => {
  test('match the table', () => {
    const text = (p: number) => PHASES[p].map((r) => `${r.type}${r.size}`).join('+');
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(text),
      ['set3+set3', 'set3+run4', 'set4+run4', 'run7', 'run8', 'run9', 'set4+set4', 'color7', 'set5+set2', 'set5+set3'],
    );
  });

  const examples: [number, Card[][], Card[][]][] = [
    [1, [[n(5), n(5, 'moss'), n(5, 'honey')], [n(5), n(5, 'moss'), w()]], [[n(5), n(6), n(5)], [n(7), n(7)]]],
    [2, [[n(2), n(2), w()], [n(9), w(), n(11), n(12)]], [[n(2), n(3), n(2)], [n(9), n(10), n(12), n(12)]]],
    [3, [[n(1), n(1), n(1), w()], [n(1), n(2), n(3), n(4)]], [[n(1), n(1), n(1)], [n(10), n(11), n(12), n(1)]]],
    [4, [[n(1), n(2), n(3), n(4), n(5), w(), n(7)]], [[n(1), n(2), n(3), n(4), n(5), n(6), n(6)]]],
    [5, [[n(5), n(6), n(7), n(8), n(9), n(10), n(11), n(12)]], [[n(6), n(7), n(8), n(9), n(10), n(11), n(12), n(1)]]],
    [6, [[n(4), n(5), n(6), n(7), n(8), n(9), n(10), n(11), w()]], [[n(1), n(2), n(3), n(4), n(5), n(6), n(7), n(8), n(10)]]],
    [7, [[n(7), n(7), n(7), n(7)], [n(7), n(7, 'moss'), w(), w()]], [[n(7), n(7), n(7), n(8)], [n(1), n(1), n(1)]]],
    [8, [[n(1, 'moss'), n(4, 'moss'), n(7, 'moss'), n(9, 'moss'), n(9, 'moss'), w(), n(12, 'moss')]], [[n(1, 'moss'), n(4, 'moss'), n(7, 'moss'), n(9, 'moss'), n(9, 'moss'), n(11, 'rose'), n(12, 'moss')]]],
    [9, [[n(3), n(3), n(3), n(3), w()], [n(3), n(3)]], [[n(3), n(3), n(3), n(3), n(4)], [n(3), n(4)]]],
    [10, [[n(8), n(8), n(8), w(), w()], [n(1), n(1), n(1)]], [[n(8), n(8), n(8), n(8)], [n(1), n(2), n(1)]]],
  ];
  for (const [phase, good, bad] of examples) {
    test(`phase ${phase}: valid and invalid examples`, () => {
      PHASES[phase].forEach((req, i) => {
        assert.equal(valid(req, good[i]), true, `good group ${i}`);
        assert.equal(valid(req, bad[i]), false, `bad group ${i}`);
      });
    });
  }

  test('all-Wild groups are invalid in every group type', () => {
    for (const req of [{ type: 'set', size: 3 }, { type: 'run', size: 4 }, { type: 'color', size: 7 }] as GroupReq[]) {
      const check = checkGroup(req, Array.from({ length: req.size }, () => w()));
      assert.equal(check.ok, false);
      if (!check.ok) assert.equal(check.reason, 'Each group needs at least one non-Wild card.');
    }
  });

  test('Wilds can sit at either end of a run', () => {
    const low = checkGroup({ type: 'run', size: 4 }, [w(), n(10), n(11), n(12)]);
    assert.ok(low.ok);
    assert.equal(low.ok && low.num, 9);
    assert.deepEqual(low.ok && low.cards.map((c) => c.num), [9, 10, 11, 12]);
    const high = checkGroup({ type: 'run', size: 4 }, [n(1), n(2), n(3), w()]);
    assert.ok(high.ok);
    assert.deepEqual(high.ok && high.cards.map((c) => c.num), [1, 2, 3, 4]);
  });

  test('runs respect the 1 and 12 boundaries', () => {
    const r: GroupReq = { type: 'run', size: 4 };
    const fromOne = checkGroup(r, [n(1), n(2), w(), w()], 1);
    assert.ok(fromOne.ok);
    const belowOne = checkGroup(r, [n(1), n(2), w(), w()], 0);
    assert.equal(belowOne.ok, false);
    const pastTwelve = checkGroup(r, [n(11), n(12), w(), w()], 10);
    assert.equal(pastTwelve.ok, false);
    if (!pastTwelve.ok) assert.equal(pastTwelve.reason, "Runs can't go past 12.");
    const wrap = checkGroup(r, [n(11), n(12), n(1), n(2)]);
    assert.equal(wrap.ok, false);
    const fits = checkGroup(r, [n(11), n(12), w(), w()]);
    assert.ok(fits.ok);
    assert.deepEqual(fits.ok && fits.cards.map((c) => c.num), [9, 10, 11, 12]);
  });

  test('both Sets may use the same number in Phases 1 and 7', () => {
    for (const [phase, size] of [[1, 3], [7, 4]]) {
      const a = Array.from({ length: size }, () => n(7));
      const b = [...Array.from({ length: size - 1 }, () => n(7, 'moss')), w()];
      const { state } = layDownState([...a, ...b, n(1), n(2)], [], phase);
      ok(step(state, { type: 'layDown', groups: [{ cardIds: ids(a) }, { cardIds: ids(b) }] }));
      assert.equal(state.groups.length, 2);
      assert.equal(state.groups[0].num, state.groups[1].num);
    }
  });

  test('Skips never join a group', () => {
    assert.equal(valid({ type: 'set', size: 3 }, [n(1), n(1), s()]), false);
  });

  test('a slot in progress is reported as partial, not wrong', () => {
    const partial = checkGroup({ type: 'set', size: 4 }, [n(1), n(1)]);
    assert.ok(!partial.ok && partial.partial);
    const wrong = checkGroup({ type: 'set', size: 4 }, [n(1), n(2)]);
    assert.ok(!wrong.ok && !wrong.partial);
  });

  test('findArrangement finds a plan using the fewest Wilds', () => {
    const hand = [n(3), n(3), n(3), n(9), n(9), n(9), w(), n(1), n(2), n(4), n(5)];
    const plan = findArrangement(hand, 1)!;
    assert.ok(plan);
    const used = plan.flatMap((p) => p.cardIds);
    assert.equal(hand.filter((c) => c.kind === 'wild' && used.includes(c.id)).length, 0);
    assert.equal(findArrangement([n(3), n(3), n(1), n(2)], 1), null);
    const runPlan = findArrangement([n(4), n(5), n(6), n(7), n(8), n(9), w(), w(), w(), w(), n(1)], 6);
    assert.ok(runPlan);
    assert.equal(findArrangement([w(), w(), w(), w(), w(), w()], 1), null);
  });
});

describe('laying down', () => {
  test('requires drawing first, exact groups, and cards from the hand', () => {
    const a = [n(1), n(1), n(1)];
    const b = [n(2), n(2), n(2)];
    const hand = [...a, ...b, n(5)];
    const st = table(2, [hand, [n(1)]]);
    st.players[0].phase = 1;
    const early = step(st, { type: 'layDown', groups: [{ cardIds: ids(a) }, { cardIds: ids(b) }] });
    assert.deepEqual(early, { ok: false, reason: 'You need to draw first.' });
    st.stage = 'play';
    assert.equal(step(st, { type: 'layDown', groups: [{ cardIds: ids(a) }] }).ok, false);
    assert.equal(step(st, { type: 'layDown', groups: [{ cardIds: ids(a) }, { cardIds: [...ids(b), 999] }] }).ok, false);
    assert.equal(step(st, { type: 'layDown', groups: [{ cardIds: ids(a) }, { cardIds: ids(a) }] }).ok, false);
    ok(step(st, { type: 'layDown', groups: [{ cardIds: ids(a) }, { cardIds: ids(b) }] }));
    assert.equal(st.players[0].laidDown, true);
    assert.equal(st.players[0].hand.length, 1);
    assert.equal(step(st, { type: 'layDown', groups: [] }).ok, false);
  });

  test('a Wild\'s value is fixed by its position', () => {
    const a = [n(9), w(), n(11), n(12)];
    const b = [n(2), n(2), w()];
    const { state } = layDownState([...a, ...b, n(5)], [], 2);
    ok(step(state, { type: 'layDown', groups: [{ cardIds: ids(b) }, { cardIds: ids(a) }] }));
    const run = state.groups.find((g) => g.type === 'run')!;
    assert.deepEqual(run.cards.map((c) => [c.card.kind, c.num]), [['num', 9], ['wild', 10], ['num', 11], ['num', 12]]);
    assert.equal(state.groups.find((g) => g.type === 'set')!.cards[2].num, 2);
  });
});

describe('hitting', () => {
  const prepared = (hand: Card[], g: LaidGroup, laidDown = true) => {
    const state = table(2, [hand, [n(1), n(2)]], { stage: 'play', groups: [g] });
    state.players[0].laidDown = laidDown;
    state.players[0].phase = 1;
    return state;
  };

  test('onto a set', () => {
    const seven = n(7), wild = w(), eight = n(8), keep = n(1);
    const state = prepared([seven, wild, eight, keep], group('set', [n(7), n(7), n(7)], { num: 7 }));
    ok(step(state, { type: 'hit', cardId: seven.id, groupId: 50 }));
    ok(step(state, { type: 'hit', cardId: wild.id, groupId: 50 }));
    assert.equal(state.groups[0].cards.length, 5);
    assert.equal(step(state, { type: 'hit', cardId: eight.id, groupId: 50 }).ok, false);
  });

  test('onto both ends of a run', () => {
    const three = n(3), eight = n(8), keep = n(1);
    const state = prepared([three, eight, keep], group('run', [n(4), n(5), n(6), n(7)], { num: 4 }));
    ok(step(state, { type: 'hit', cardId: three.id, groupId: 50 }));
    ok(step(state, { type: 'hit', cardId: eight.id, groupId: 50 }));
    assert.deepEqual(state.groups[0].cards.map((c) => c.num), [3, 4, 5, 6, 7, 8]);
    assert.equal(state.groups[0].num, 3);
  });

  test('a Wild can go on either end of a run', () => {
    const a = w(), b = w(), keep = n(1);
    const state = prepared([a, b, keep], group('run', [n(4), n(5), n(6), n(7)], { num: 4 }));
    ok(step(state, { type: 'hit', cardId: a.id, groupId: 50, end: 'low' }));
    ok(step(state, { type: 'hit', cardId: b.id, groupId: 50, end: 'high' }));
    assert.deepEqual(state.groups[0].cards.map((c) => c.num), [3, 4, 5, 6, 7, 8]);
  });

  test('refused beyond 1 to 12', () => {
    const wild = w(), keep = n(1);
    const high = prepared([wild, keep], group('run', [n(9), n(10), n(11), n(12)], { num: 9 }));
    assert.deepEqual(step(high, { type: 'hit', cardId: wild.id, groupId: 50, end: 'high' }), { ok: false, reason: "Runs can't go past 12." });
    const low = prepared([wild, keep], group('run', [n(1), n(2), n(3), n(4)], { num: 1 }));
    assert.deepEqual(step(low, { type: 'hit', cardId: wild.id, groupId: 50, end: 'low' }), { ok: false, reason: "Runs can't go below 1." });
    const full = group('run', Array.from({ length: 12 }, (_, i) => n(i + 1)), { num: 1 });
    assert.equal(checkHit(full, wild).ok, false);
    const one = n(1);
    assert.equal(checkHit(group('run', [n(9), n(10), n(11), n(12)], { num: 9 }), one).ok, false);
  });

  test('onto a color group', () => {
    const moss = n(2, 'moss'), rose = n(2, 'rose'), wild = w(), keep = n(1);
    const state = prepared([moss, rose, wild, keep], group('color', Array.from({ length: 7 }, (_, i) => n(i + 1, 'moss')), { suit: 'moss' }));
    ok(step(state, { type: 'hit', cardId: moss.id, groupId: 50 }));
    assert.equal(step(state, { type: 'hit', cardId: rose.id, groupId: 50 }).ok, false);
    ok(step(state, { type: 'hit', cardId: wild.id, groupId: 50 }));
    assert.equal(state.groups[0].cards[8].suit, 'moss');
  });

  test('refused before laying down and for Skips', () => {
    const seven = n(7), skip = s(), keep = n(1);
    const state = prepared([seven, skip, keep], group('set', [n(7), n(7), n(7)], { num: 7 }), false);
    assert.deepEqual(step(state, { type: 'hit', cardId: seven.id, groupId: 50 }), { ok: false, reason: 'Lay down your phase before hitting.' });
    state.players[0].laidDown = true;
    assert.equal(step(state, { type: 'hit', cardId: skip.id, groupId: 50 }).ok, false);
  });

  test('allowed on the same turn as laying down, on anyone\'s group', () => {
    const a = [n(1), n(1), n(1)], b = [n(2), n(2), n(2)], extra = n(1), other = n(9), keep = n(4);
    const theirs = group('set', [n(9), n(9), n(9)], { num: 9 }, 1);
    const { state } = layDownState([...a, ...b, extra, other, keep], [], 1, { groups: [theirs] });
    ok(step(state, { type: 'layDown', groups: [{ cardIds: ids(a) }, { cardIds: ids(b) }] }));
    const mine = state.groups.find((g) => g.owner === 0)!;
    ok(step(state, { type: 'hit', cardId: extra.id, groupId: mine.id }));
    ok(step(state, { type: 'hit', cardId: other.id, groupId: 50 }));
    assert.equal(state.players[0].hand.length, 1);
  });
});

describe('skips', () => {
  test('cannot be drawn from the discard pile', () => {
    const state = table(2, [[n(1), n(2)], [n(1), n(2)]], { discardPile: [s()] });
    assert.deepEqual(step(state, { type: 'draw', source: 'discard' }), { ok: false, reason: "Skips can't be picked up." });
    assert.equal(state.stage, 'draw');
  });

  test('a Wild can be drawn from the discard pile', () => {
    const wild = w();
    const state = table(2, [[n(1), n(2)], [n(1), n(2)]], { discardPile: [wild] });
    ok(step(state, { type: 'draw', source: 'discard' }));
    assert.ok(state.players[0].hand.includes(wild));
  });

  test('target rules with no double skip', () => {
    const skip1 = s(), keep = n(1), keep2 = n(2);
    const state = table(4, [[skip1, keep, keep2], [n(1), n(2)], [n(1), n(2)], [n(1), n(2)]], { stage: 'play' });
    state.players[0].laidDown = false;
    assert.deepEqual(step(state, { type: 'discard', cardId: skip1.id }), { ok: false, reason: 'Choose who to skip.' });
    assert.equal(step(state, { type: 'discard', cardId: skip1.id, target: 0 }).ok, false);
    state.players[2].pendingSkip = true;
    assert.deepEqual(eligibleSkipTargets(state, 0), [1, 3]);
    assert.equal(step(state, { type: 'discard', cardId: skip1.id, target: 2 }).ok, false);
    ok(step(state, { type: 'discard', cardId: skip1.id, target: 3 }));
    assert.equal(state.players[3].pendingSkip, true);
    assert.equal(state.current, 1);
  });

  test('skipped players lose exactly one turn, then the skip is gone', () => {
    const skip1 = s(), keep = n(1);
    const state = table(3, [[skip1, keep, n(2)], [n(1), n(2), n(3)], [n(1), n(2), n(3)]], { stage: 'play' });
    const res = ok(step(state, { type: 'discard', cardId: skip1.id, target: 1 }));
    assert.ok(res.events.some((e) => e.type === 'turnSkipped' && e.seat === 1));
    assert.equal(state.current, 2);
    assert.equal(state.players[1].pendingSkip, false);
  });

  test('two-player: the skipper takes the next turn', () => {
    const skip1 = s();
    const state = table(2, [[skip1, n(1), n(2)], [n(1), n(2), n(3)]], { stage: 'play' });
    ok(step(state, { type: 'discard', cardId: skip1.id, target: 1 }));
    assert.equal(state.current, 0);
    assert.equal(state.stage, 'draw');
    assert.equal(state.players[1].pendingSkip, false);
  });

  test('a starting discard Skip skips the first player', () => {
    let found = false;
    for (let i = 0; i < 400 && !found; i++) {
      const { state, events } = createGame({ playerCount: 3, seed: i.toString(16).padStart(32, '0') });
      if (state.discardPile[0].kind === 'skip') {
        found = true;
        const start = events.find((e) => e.type === 'roundStart');
        assert.ok(start && start.type === 'roundStart' && start.startSkip);
        assert.ok(events.some((e) => e.type === 'turnSkipped' && e.seat === 0));
        assert.equal(state.current, 1);
      }
    }
    assert.ok(found, 'expected a seed with a starting Skip');
  });

  test('all opponents already skipped: no effect, with a note', () => {
    const skip1 = s();
    const state = table(3, [[skip1, n(1), n(2)], [n(1), n(2)], [n(1), n(2)]], { stage: 'play' });
    state.players[1].pendingSkip = true;
    state.players[2].pendingSkip = true;
    const res = ok(step(state, { type: 'discard', cardId: skip1.id }));
    assert.ok(res.events.some((e) => e.type === 'skipNoTarget'));
    assert.ok(state.discardPile.includes(skip1));
    assert.equal(state.current, 0, 'both opponents use up their skips');
  });
});

describe('going out and scoring', () => {
  const nearOut = () => {
    const last = n(5);
    const state = table(3, [[last], [n(1), n(11), w(), s()], [n(1), n(2)]], { stage: 'play' });
    state.players[0].laidDown = true;
    state.players[0].phase = 1;
    state.players[1].phase = 1;
    state.players[2].phase = 1;
    return { state, last };
  };

  test('by discard: round ends at once with no extra turns', () => {
    const { state, last } = nearOut();
    const res = ok(step(state, { type: 'discard', cardId: last.id }));
    assert.equal(state.stage, 'roundOver');
    assert.equal(state.current, 0);
    assert.ok(res.events.some((e) => e.type === 'goOut' && e.by === 'discard'));
    assert.ok(!res.events.some((e) => e.type === 'turnStart'));
    assert.equal(step(state, { type: 'draw', source: 'pile' }).ok, false);
  });

  test('by hitting: no discard is needed', () => {
    const { state, last } = nearOut();
    state.groups = [group('set', [n(5), n(5), n(5)], { num: 5 })];
    const res = ok(step(state, { type: 'hit', cardId: last.id, groupId: 50 }));
    assert.equal(state.stage, 'roundOver');
    assert.ok(res.events.some((e) => e.type === 'goOut' && e.by === 'hit'));
  });

  test('scoring values', () => {
    assert.deepEqual([1, 9].map((v) => cardPoints(n(v))), [5, 5]);
    assert.deepEqual([10, 11, 12].map((v) => cardPoints(n(v))), [10, 10, 10]);
    assert.equal(cardPoints(s()), 15);
    assert.equal(cardPoints(w()), 25);
    assert.equal(handPoints([n(1), n(11), w(), s()]), 55);
    const { state, last } = nearOut();
    ok(step(state, { type: 'discard', cardId: last.id }));
    assert.deepEqual(state.players.map((p) => p.score), [0, 55, 10]);
    assert.deepEqual(state.lastRound!.points, [0, 55, 10]);
  });

  test('only players who laid down advance', () => {
    const { state, last } = nearOut();
    state.players[2].laidDown = true;
    ok(step(state, { type: 'discard', cardId: last.id }));
    assert.deepEqual(state.players.map((p) => p.completed), [[1], [], [1]]);
    nextRound(state);
    assert.deepEqual(state.players.map((p) => p.phase), [2, 1, 2]);
  });

  test('the dealer rotates, and the human starts round 1', () => {
    const { state } = createGame({ playerCount: 3, seed: 'cd'.repeat(16) });
    assert.equal(state.dealer, 2);
    const first = state.discardPile[0].kind === 'skip' ? 1 : 0;
    assert.equal(state.current, first);
    assert.ok(state.players.every((p) => p.hand.length === 10));
    state.stage = 'roundOver';
    nextRound(state);
    assert.equal(state.dealer, 0);
    assert.equal(state.round, 2);
    assert.equal(state.drawPile.length, 108 - 30 - 1);
  });
});

describe('match end', () => {
  const finale = (scores: number[], laid: boolean[], outSeat = 0) => {
    const last = n(5);
    const hands: Card[][] = [[n(1)], [n(1)], [n(1)]];
    hands[outSeat] = [last];
    const state = table(3, hands, { stage: 'play', current: outSeat });
    state.players.forEach((p, i) => {
      p.completed = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      p.phase = 10;
      p.laidDown = laid[i];
      p.score = scores[i];
    });
    return { state, last };
  };

  test('the lowest score among finishers wins, even if another went out', () => {
    const { state, last } = finale([100, 40, 300], [true, true, false]);
    ok(step(state, { type: 'discard', cardId: last.id }));
    assert.equal(state.stage, 'matchOver');
    assert.deepEqual(state.winners, [1]);
  });

  test('a tie goes to the player who went out', () => {
    const { state, last } = finale([40, 35, 300], [true, true, false]);
    ok(step(state, { type: 'discard', cardId: last.id }));
    assert.deepEqual(state.winners, [0]);
    assert.equal(state.sharedWin, false);
  });

  test('a tie without the player who went out is a shared win', () => {
    const { state, last } = finale([200, 35, 35], [true, true, true]);
    ok(step(state, { type: 'discard', cardId: last.id }));
    assert.deepEqual(state.winners, [1, 2]);
    assert.equal(state.sharedWin, true);
  });

  test('without a finisher the match continues', () => {
    const { state, last } = finale([0, 0, 0], [true, false, false]);
    state.players[0].completed = [1];
    state.players[0].phase = 2;
    ok(step(state, { type: 'discard', cardId: last.id }));
    assert.equal(state.stage, 'roundOver');
  });
});

describe('draw pile', () => {
  test('reshuffles all but the top discard when empty', () => {
    const top = n(9);
    const under = [n(1), n(2), n(3)];
    const keep = n(4);
    const state = table(2, [[keep, n(7)], [n(5), n(6)]], { stage: 'play', drawPile: [], discardPile: [...under, top] });
    const res = ok(step(state, { type: 'discard', cardId: keep.id }));
    assert.ok(res.events.some((e) => e.type === 'reshuffle' && e.count === 4));
    assert.equal(state.drawPile.length, 4);
    assert.equal(state.discardPile.length, 1);
    assert.equal(state.discardPile[0].id, keep.id);
  });

  test('never stalls when nothing can be drawn', () => {
    const skip1 = s();
    const state = table(2, [[skip1, n(1)], [n(2), n(3)]], { stage: 'play', drawPile: [], discardPile: [] });
    const res = ok(step(state, { type: 'discard', cardId: skip1.id, target: 1 }));
    assert.ok(res.events.some((e) => e.type === 'noDraw'));
    assert.equal(state.stage, 'play');
  });

  /** Two players, both down, each holding one card nothing can take, passing three cards around forever. */
  function deadlocked() {
    const state = table(2, [[n(11, 'honey')], [n(11, 'moss')]], { stage: 'draw', drawPile: [n(9), n(9, 'moss')], discardPile: [n(9, 'honey')] });
    state.players.forEach((p) => { p.laidDown = true; p.phase = 2; });
    return state;
  }
  const lap = (state: ReturnType<typeof deadlocked>) => {
    ok(step(state, { type: 'draw', source: 'pile' }));
    const drawn = state.players[state.current].hand[1];
    return ok(step(state, { type: 'discard', cardId: drawn.id }));
  };

  test('when no one can go out, the round ends after three quiet reshuffles', () => {
    const state = deadlocked();
    let reshuffles = 0;
    for (let t = 0; t < 40 && state.stage !== 'roundOver'; t++) {
      const res = lap(state);
      reshuffles += res.events.filter((e) => e.type === 'reshuffle').length;
      if (res.events.some((e) => e.type === 'roundEnd')) {
        assert.ok(res.events.some((e) => e.type === 'stalemate'));
        assert.ok(!res.events.some((e) => e.type === 'goOut'));
      }
    }
    assert.equal(state.stage, 'roundOver');
    assert.equal(reshuffles, 3);
    const r = state.lastRound!;
    assert.equal(r.wentOut, -1);
    assert.deepEqual(r.points, [10, 10], 'everyone scores the hand they hold');
    assert.deepEqual(r.advanced, [true, true], 'players who laid down still complete their phase');
  });

  test('a hit or a lay-down resets the count', () => {
    const state = deadlocked();
    state.quietReshuffles = 2;
    state.groups = [{ id: 1, owner: 1, type: 'set', num: 9, cards: [{ card: n(9), num: 9 }] }];
    state.drawPile = [n(9, 'honey')];
    ok(step(state, { type: 'draw', source: 'pile' }));
    ok(step(state, { type: 'hit', cardId: state.players[0].hand[1].id, groupId: 1 }));
    assert.equal(state.quietReshuffles, 0);
  });
});

describe('variants', () => {
  test('Sprint uses Phases 1, 3, 5, 7, 9 and ends after 9', () => {
    const { state } = createGame({ playerCount: 2, variant: 'sprint', seed: 'ef'.repeat(16) });
    assert.equal(state.players[0].phase, 1);
    const last = n(5);
    state.players[0].hand = [last];
    state.players[0].laidDown = true;
    state.stage = 'play';
    state.current = 0;
    ok(step(state, { type: 'discard', cardId: last.id }));
    nextRound(state);
    assert.equal(state.players[0].phase, 3);
    assert.equal(state.players[1].phase, 1);

    state.players[0].completed = [1, 3, 5, 7];
    state.players[0].phase = 9;
    const end = n(5);
    state.players[0].hand = [end];
    state.players[0].laidDown = true;
    state.stage = 'play';
    state.current = 0;
    ok(step(state, { type: 'discard', cardId: end.id }));
    assert.equal(state.stage, 'matchOver');
    assert.deepEqual(state.winners, [0]);
  });

  test('Choose Your Phase: each player picks an uncompleted phase', () => {
    const { state, events } = createGame({ playerCount: 2, variant: 'choose', seed: '12'.repeat(16) });
    assert.equal(state.stage, 'choose');
    assert.ok(!events.some((e) => e.type === 'turnStart'));
    assert.equal(step(state, { type: 'draw', source: 'pile' }).ok, false);
    ok(step(state, { type: 'choosePhase', seat: 0, phase: 8 }));
    assert.equal(state.stage, 'choose');
    assert.equal(step(state, { type: 'choosePhase', seat: 0, phase: 3 }).ok, false);
    ok(step(state, { type: 'choosePhase', seat: 1, phase: 2 }));
    assert.notEqual(state.stage, 'choose');
    assert.equal(state.players[0].phase, 8);

    state.players[0].completed = [8];
    state.players[0].phase = null;
    state.players[1].phase = null;
    state.stage = 'choose';
    assert.equal(step(state, { type: 'choosePhase', seat: 0, phase: 8 }).ok, false);
  });

  test('Choose Your Phase: the match ends when someone completes their last phase', () => {
    const { state } = createGame({ playerCount: 2, variant: 'choose', seed: '34'.repeat(16) });
    state.players[0].completed = [1, 2, 3, 4, 5, 6, 7, 9, 10];
    state.players[0].phase = 8;
    state.players[1].phase = 1;
    const last = n(5);
    state.players[0].hand = [last];
    state.players[0].laidDown = true;
    state.stage = 'play';
    state.current = 0;
    ok(step(state, { type: 'discard', cardId: last.id }));
    assert.equal(state.stage, 'matchOver');
    assert.deepEqual(state.winners, [0]);
  });
});

describe('determinism and saving', () => {
  function playSome(state: GameState, turns: number) {
    for (let t = 0; t < turns && (state.stage === 'draw' || state.stage === 'play'); t++) {
      if (state.stage === 'draw') ok(step(state, { type: 'draw', source: 'pile' }));
      const hand = state.players[state.current].hand;
      const card = hand.find((c) => c.kind !== 'skip') ?? hand[0];
      const targets = card.kind === 'skip' ? eligibleSkipTargets(state, state.current) : [];
      ok(step(state, { type: 'discard', cardId: card.id, target: targets[0] }));
    }
  }

  test('same seed and same actions give an identical game', () => {
    const a = createGame({ playerCount: 3, seed: '56'.repeat(16) }).state;
    const b = createGame({ playerCount: 3, seed: '56'.repeat(16) }).state;
    playSome(a, 40);
    playSome(b, 40);
    assert.deepEqual(a, b);
  });

  test('a mid-round save and load gives an identical game from then on', () => {
    const live = createGame({ playerCount: 4, seed: '78'.repeat(16) }).state;
    playSome(live, 13);
    ok(step(live, { type: 'draw', source: 'pile' }));
    const restored: GameState = JSON.parse(JSON.stringify(live));
    assert.deepEqual(restored, live);
    const hand = live.players[live.current].hand;
    const card = hand.find((c) => c.kind !== 'skip')!;
    ok(step(live, { type: 'discard', cardId: card.id }));
    ok(step(restored, { type: 'discard', cardId: card.id }));
    playSome(live, 60);
    playSome(restored, 60);
    assert.deepEqual(restored, live);
  });

  test('cards are conserved through play', () => {
    const state = createGame({ playerCount: 5, seed: '9a'.repeat(16) }).state;
    playSome(state, 200);
    const all = [...state.drawPile, ...state.discardPile, ...state.players.flatMap((p) => p.hand), ...state.groups.flatMap((g) => g.cards.map((c) => c.card))];
    assert.equal(all.length, 108);
    assert.equal(new Set(all.map((c) => c.id)).size, 108);
  });
});
