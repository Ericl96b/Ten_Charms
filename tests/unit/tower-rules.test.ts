// Tower floors: the 25-phase pool, the draw, mixed Classic and Moonlit play, the Guardians' crown, and numbering.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { BotId } from '../../src/bots/profiles.ts';
import { TOWER_LADDER } from '../../src/content.ts';
import { createGame, step } from '../../src/engine/game.ts';
import { observe } from '../../src/engine/observation.ts';
import {
  PHASES, TOWER_ORDER, TOWER_POOL, displayPhase, matchPhases, nextPhaseInList, phaseNumber, phaseSequence, phaseText,
} from '../../src/engine/phases.ts';
import type { GameState, Variant } from '../../src/engine/types.ts';
import { EASY_HALF, drawAttempt, floorRules, guardianOf, isGuardianFloor, skyName, tierOf, tierSetup } from '../../src/meta/tower.ts';
import { playMatch } from '../../src/sim/driver.ts';
import { n, ok, table } from './helpers.ts';

/** TOWER_SPEC.md §4.1, in its order, with its exact labels. */
const SPEC_POOL = [
  '2 Sets of 3', 'Set of 3 + Run of 4', 'Set of 4 + Run of 4', 'Run of 7', 'Run of 8', 'Run of 9', '2 Sets of 4', '7 of one Color',
  'Set of 5 + Set of 2', 'Set of 5 + Set of 3', '2 Sets of 3 + Pair', '8 Odds', '8 Evens', 'Set of 4 + 2 Pairs', 'Color run of 4 + 2 Pairs',
  'Set of 4 + 4 of one Color', '2 Color runs of 3', 'Color run of 4 + Set of 3', 'Color run of 3 + Set of 4', 'Color run of 5 + Pair',
  '7 Evens', 'Color run of 3 + Set of 3', '6 of one Color', 'Set of 3 + 5 of one Color', 'Color run of 3 + Set of 3 + Pair',
];

const seedOf = (i: number, pad = 'a') => i.toString(16).padStart(32, pad);

describe('the phase pool', () => {
  test('is exactly the 25 phases of §4.1, in order, with their exact labels', () => {
    assert.equal(TOWER_POOL.length, 25);
    assert.deepEqual(TOWER_POOL.map(phaseText), SPEC_POOL);
    assert.equal(new Set(TOWER_POOL.map((p) => JSON.stringify(PHASES[p]))).size, 25, 'no two pool phases are the same requirement');
  });

  test('leaves out the retired Moonlit list', () => {
    for (const p of TOWER_POOL) assert.ok(p < 11 || p > 20, `${p}`);
  });

  test('the difficulty order is the refinement report\'s measurements, ties within 5% kept in pool order', () => {
    const report = readFileSync('SIMULATION_MOONLIT_REFINEMENT.md', 'utf8');
    const mean = new Map<string, number>();
    for (const line of report.split('\n')) {
      const m = /^\| (?:C\d+ )?([^|]+?) \| [^|]+ \| \d+ \| [^|]+ \| ([\d.]+) \(/.exec(line);
      if (m && !mean.has(m[1])) mean.set(m[1], Number(m[2]));
    }
    const measured = TOWER_POOL.map((p, i) => ({ p, i, turns: mean.get(phaseText(p))! }));
    for (const m of measured) assert.ok(Number.isFinite(m.turns), `no measurement for ${phaseText(m.p)}`);
    const order = measured.slice().sort((a, b) => a.turns - b.turns);
    for (let changed = true; changed;) {
      changed = false;
      for (let k = 0; k + 1 < order.length; k++) {
        const [a, b] = [order[k], order[k + 1]];
        if (b.turns <= a.turns * 1.05 && b.i < a.i) { order[k] = b; order[k + 1] = a; changed = true; }
      }
    }
    assert.deepEqual(TOWER_ORDER, order.map((m) => m.p));
  });
});

describe('the draw', () => {
  test('three different pool phases, easiest first, the same every time from the same seed', () => {
    for (let i = 0; i < 3000; i++) {
      const floor = 1 + (i % 73);
      const a = drawAttempt(seedOf(i), floor);
      assert.equal(a.phases.length, 3);
      assert.equal(new Set(a.phases).size, 3);
      for (const p of a.phases) assert.ok(TOWER_POOL.includes(p));
      const at = a.phases.map((p) => TOWER_ORDER.indexOf(p));
      assert.ok(at[0] < at[1] && at[1] < at[2], 'easiest first');
      assert.deepEqual(drawAttempt(seedOf(i), floor), a, 'a fixed seed repeats exactly');
    }
  });

  test('every pool phase is drawn about equally often', () => {
    const count = new Map<number, number>();
    const draws = 6000;
    for (let i = 0; i < draws; i++) for (const p of drawAttempt(seedOf(i, 'b'), 7).phases) count.set(p, (count.get(p) ?? 0) + 1);
    const expected = (draws * 3) / 25;
    for (const p of TOWER_POOL) {
      const c = count.get(p) ?? 0;
      assert.ok(Math.abs(c - expected) < expected * 0.15, `${phaseText(p)}: ${c} of about ${expected}`);
    }
  });

  test('lineups come from the tier\'s pool with no duplicates, and never include the wisps', () => {
    for (let i = 0; i < 2000; i++) {
      const floor = 1 + (i % 89);
      const a = drawAttempt(seedOf(i, 'c'), floor);
      const setup = tierSetup(tierOf(floor));
      assert.equal(new Set(a.lineup).size, a.lineup.length);
      assert.ok(!a.lineup.includes('puff') && !a.lineup.includes('haze'));
      assert.ok(a.lineup.length >= 1 && a.lineup.length <= 3, 'never more than 3 opponents');
      if (isGuardianFloor(floor)) {
        assert.equal(a.guardian, guardianOf(floor));
        assert.ok(a.lineup.includes(a.guardian!));
        assert.equal(a.lineup.length, 1 + setup.guardian.companions);
      } else {
        assert.equal(a.guardian, null);
        assert.equal(a.lineup.length, setup.opponents);
        for (const b of a.lineup) assert.ok(setup.pool.includes(b), `${b} on floor ${floor}`);
      }
    }
  });

  test('a Guardian floor tuned to the easier half draws only from it', () => {
    const ladder = TOWER_LADDER.map((t) => ({ ...t, guardian: { ...t.guardian, easyPhases: true } }));
    for (let i = 0; i < 500; i++) {
      for (const p of drawAttempt(seedOf(i, 'd'), 30, ladder).phases) assert.ok(TOWER_ORDER.indexOf(p) < EASY_HALF);
    }
  });
});

describe('tiers, Guardians and skies', () => {
  test('tiers are ten floors each, and every tenth floor is a Guardian floor', () => {
    assert.deepEqual([1, 10, 11, 20, 21, 40, 41, 51, 143].map(tierOf), [1, 1, 2, 2, 3, 4, 5, 6, 15]);
    assert.deepEqual([9, 10, 11, 20, 30, 140].map(isGuardianFloor), [false, true, false, true, true, true]);
  });

  test('odd tiers have Nightshade, even tiers Lunaria', () => {
    assert.deepEqual([10, 20, 30, 40, 50, 60].map(guardianOf), ['nightshade', 'lunaria', 'nightshade', 'lunaria', 'nightshade', 'lunaria']);
  });

  test('the sky cycles every five tiers', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 10, 11].map(skyName),
      ['Rose Dawn', 'Peach Noon', 'Lavender Dusk', 'Starlit Pink Night', 'Aurora', 'Rose Dawn', 'Peach Noon', 'Aurora', 'Rose Dawn']);
  });

  test('a floor\'s rules: fog where its tier has it, and the crown on the Guardian\'s seat', () => {
    for (let i = 0; i < 200; i++) {
      for (const floor of [5, 30, 37, 40, 60]) {
        const a = drawAttempt(seedOf(i, 'e'), floor);
        const rules = floorRules(floor, a);
        assert.equal(rules.fog === true, tierSetup(tierOf(floor)).fog);
        if (a.guardian) {
          assert.equal(a.lineup[rules.crownSeat! - 1], a.guardian);
          assert.equal(rules.crownName, a.guardian === 'nightshade' ? 'Nightshade' : 'Lunaria');
        } else {
          assert.equal(rules.crownSeat, undefined);
        }
      }
    }
  });
});

/** A bot-only floor, everyone playing the same list. */
function floor(lineup: BotId[], phases: number[], seed: string, rules = {}) {
  return playMatch(lineup, seed, 'tower', rules, phases);
}

describe('Tower matches', () => {
  test('a floor needs its own list of distinct, known phases', () => {
    assert.throws(() => createGame({ playerCount: 2, variant: 'tower' }));
    assert.throws(() => createGame({ playerCount: 2, variant: 'tower', phases: [2, 2, 4] }));
    assert.throws(() => createGame({ playerCount: 2, variant: 'tower', phases: [2, 99, 4] }));
    const { state } = createGame({ playerCount: 3, variant: 'tower', phases: [2, 31, 6], seed: seedOf(1) });
    assert.deepEqual(matchPhases(state), [2, 31, 6]);
    for (const p of state.players) assert.equal(p.phase, 2, 'everyone starts on the list\'s first phase');
    assert.deepEqual(observe(state, 1).phases, [2, 31, 6], 'the list is public');
  });

  test('a mixed Classic and Moonlit floor plays to the end, won by someone who completed all three', () => {
    for (let i = 0; i < 20; i++) {
      const out = floor(['hoot', 'briar', 'lumi', 'mallow'], [2, 22, 9], seedOf(i, 'f'));
      assert.deepEqual(out.illegal, []);
      assert.equal(out.stalled, false);
      assert.ok(out.winners.length > 0);
      for (const w of out.winners) assert.deepEqual(out.state.players[w].completed.slice().sort(), [2, 22, 9].sort());
    }
  });

  test('every pool phase can be laid down, hit and completed in a Tower match', () => {
    const laid = new Set<number>();
    const hit = new Set<number>();
    const done = new Set<number>();
    const pending = () => TOWER_POOL.filter((p) => !(laid.has(p) && hit.has(p) && done.has(p)));
    for (let i = 0; i < 2000 && pending().length > 0; i++) {
      const target = pending()[i % pending().length];
      const others = TOWER_POOL.filter((p) => p !== target);
      const list = [target, others[(i * 7) % others.length], others[(i * 11 + 3) % others.length]];
      if (new Set(list).size < 3) continue;
      const order = [list[i % 3], list[(i + 1) % 3], list[(i + 2) % 3]];
      // The phase being attempted by each group's owner when the group was laid, to know which phase a hit adds to.
      const groupPhase = new Map<number, number>();
      const out = playMatch(['hoot', 'hoot', 'mallow', 'briar'], seedOf(i, '1'), 'tower', undefined, order, (events, state: GameState) => {
        for (const e of events) {
          if (e.type === 'layDown') { laid.add(e.phase); for (const id of e.groupIds) groupPhase.set(id, e.phase); }
          if (e.type === 'roundStart') groupPhase.clear();
          if (e.type === 'hit' && groupPhase.has(e.groupId)) hit.add(groupPhase.get(e.groupId)!);
          if (e.type === 'roundEnd') e.result.advanced.forEach((a, s) => { if (a) done.add(e.result.phasesBefore[s]!); });
        }
        void state;
      });
      assert.deepEqual(out.illegal, []);
      assert.equal(out.stalled, false);
    }
    assert.deepEqual(pending().map(phaseText), []);
  });

  test('bots play floors at every table size with fog and the crown, with no illegal moves or stalls', () => {
    for (let i = 0; i < 40; i++) {
      const at = 10 * (1 + (i % 6));
      const a = drawAttempt(seedOf(i, '2'), at);
      const out = floor(['hoot', ...a.lineup], a.phases, seedOf(i, '3'), { ...floorRules(at, a), crownSeat: a.lineup.indexOf(a.guardian!) + 1, fog: i % 2 === 0 });
      assert.deepEqual(out.illegal, []);
      assert.equal(out.stalled, false);
    }
  });
});

describe('the Thorned Crown on Guardian floors', () => {
  for (const [guardian, name] of [['nightshade', 'Nightshade'], ['lunaria', 'Lunaria']] as const) {
    function crowned() {
      const state = table(3, [[n(5), n(9)], [n(5, 'moss'), n(9, 'moss')], [n(5, 'honey'), n(2)]], {
        stage: 'play', variant: 'tower', phases: [1, 21, 9], rules: { crownSeat: 2, crownName: name },
      });
      state.players.forEach((p) => { p.laidDown = true; });
      state.groups = [
        { id: 1, owner: 2, type: 'set', num: 5, cards: [{ card: n(5), num: 5 }] },
        { id: 2, owner: 1, type: 'set', num: 5, cards: [{ card: n(5), num: 5 }] },
      ];
      return state;
    }

    test(`${guardian}: no one but the Guardian may add to her groups, with the exact reason`, () => {
      const human = crowned();
      assert.deepEqual(step(human, { type: 'hit', cardId: human.players[0].hand[0].id, groupId: 1 }), { ok: false, reason: `No one can add to ${name}'s groups.` });
      const bot = crowned();
      bot.current = 1;
      assert.deepEqual(step(bot, { type: 'hit', cardId: bot.players[1].hand[0].id, groupId: 1 }), { ok: false, reason: `No one can add to ${name}'s groups.` });
      const self = crowned();
      self.current = 2;
      ok(step(self, { type: 'hit', cardId: self.players[2].hand[0].id, groupId: 1 }));
      const other = crowned();
      ok(step(other, { type: 'hit', cardId: other.players[0].hand[0].id, groupId: 2 }));
    });
  }

  test('the floor rules put the crown on whichever seat the Guardian has', () => {
    for (let i = 0; i < 100; i++) {
      const a = drawAttempt(seedOf(i, '4'), 20 * (1 + (i % 3)) - 10);
      const { state } = createGame({ playerCount: a.lineup.length + 1, variant: 'tower', phases: a.phases, rules: floorRules(20 * (1 + (i % 3)) - 10, a), seed: seedOf(i) });
      assert.equal(state.rules!.crownSeat, a.lineup.indexOf(a.guardian!) + 1);
    }
  });
});

describe('phase numbering', () => {
  test('a floor numbers its phases 1 to 3 by place in its own list', () => {
    const { state } = createGame({ playerCount: 2, variant: 'tower', phases: [32, 4, 30], seed: seedOf(2) });
    assert.deepEqual([32, 4, 30].map((p) => displayPhase(state, p)), [1, 2, 3]);
    assert.equal(nextPhaseInList(state, 32), 4);
    assert.equal(nextPhaseInList(state, 30), null);
  });

  test('every other match shows exactly what it showed before', () => {
    const variants: Variant[] = ['standard', 'sprint', 'choose', 'moonlit', 'trialB', 'trialC'];
    for (const variant of variants) {
      const { state } = createGame({ playerCount: 3, variant, seed: seedOf(3) });
      for (const id of Object.keys(PHASES).map(Number)) assert.equal(displayPhase(state, id), phaseNumber(id), `${variant} ${id}`);
      const list = phaseSequence(variant);
      for (let k = 0; k < list.length; k++) assert.equal(nextPhaseInList(state, list[k]), list[k + 1] ?? null);
    }
  });
});
