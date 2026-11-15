// Change Request 04: Moonlit Trial A's list becomes the Moonlit Phases, and matches begun before then finish safely.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { decide, type BotId } from '../../src/bots/profiles.ts';
import { GLADE_STOPS } from '../../src/content.ts';
import { createGame, nextRound, step } from '../../src/engine/game.ts';
import { observe } from '../../src/engine/observation.ts';
import { RETIRED_MOONLIT_PHASES, matchPhases, phaseNumber, phaseSequence, phaseText } from '../../src/engine/phases.ts';
import { createRng } from '../../src/engine/rng.ts';
import type { GameState, Variant } from '../../src/engine/types.ts';
import { exportCode, importCode, migrate, type SaveData } from '../../src/meta/save.ts';

const FIXTURES = 'tests/fixtures/pre-cr04';
const fixture = (name: string): Record<string, any> => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Change Request 04 §1, exactly and in order. */
const NEW_LIST = [
  '2 Sets of 3 + Pair', '8 Odds', '8 Evens', 'Set of 4 + 2 Pairs', 'Color run of 4 + 2 Pairs',
  'Set of 4 + 4 of one Color', '2 Color runs of 3', 'Color run of 4 + Set of 3', 'Color run of 3 + Set of 4', 'Color run of 5 + Pair',
];
const VARIANTS: Variant[] = ['standard', 'sprint', 'choose', 'moonlit', 'trialB', 'trialC'];

describe('the new Moonlit Phases list', () => {
  test('matches Change Request 04 exactly, in order, shown as Phase 1 to 10', () => {
    assert.deepEqual(phaseSequence('moonlit').map(phaseText), NEW_LIST);
    assert.deepEqual(phaseSequence('moonlit').map(phaseNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('every Map 2 stop and Free Play start a new match on its Phase 1', () => {
    for (const stop of GLADE_STOPS) {
      const { state } = createGame({ playerCount: stop.lineup.length + 1, variant: 'moonlit', seed: `${stop.id}`.padEnd(32, 'a').replace(/[^0-9a-f]/g, 'b'), rules: { fog: true } });
      for (const p of state.players) assert.equal(phaseText(p.phase!), '2 Sets of 3 + Pair', stop.id);
    }
    const { state } = createGame({ playerCount: 3, variant: 'moonlit', seed: 'f1'.repeat(16) });
    assert.ok(state.players.every((p) => p.phase === phaseSequence('moonlit')[0]));
  });

  test('no new match of any variant can use the retired list', () => {
    for (const variant of VARIANTS) {
      for (let i = 0; i < 4; i++) {
        const { state } = createGame({ playerCount: 2 + i, variant, seed: `${i}${variant}`.padEnd(32, '9').replace(/[^0-9a-f]/g, 'c') });
        assert.ok(!matchPhases(state).some((p) => RETIRED_MOONLIT_PHASES.includes(p)), variant);
        assert.ok(!phaseSequence(variant).some((p) => RETIRED_MOONLIT_PHASES.includes(p)), variant);
        for (const p of state.players) assert.ok(p.phase === null || !RETIRED_MOONLIT_PHASES.includes(p.phase), variant);
      }
    }
  });

  test('the star thresholds are the ones from before the change', () => {
    assert.deepEqual(Object.fromEntries(GLADE_STOPS.map((s) => [s.id, s.stars])), {
      g1: { two: 14, three: 13 }, a1: { two: 16, three: 15 }, a2: { two: 17, three: 16 }, b1: { two: 17, three: 16 },
      b2: { two: 17, three: 16 }, g2: { two: 17, three: 16 }, g3: { two: 14, three: 13 },
    });
  });
});

describe('which list a match plays', () => {
  const at = (variant: Variant, phases: (number | null)[], completed: number[][] = phases.map(() => [])) =>
    ({ variant, players: phases.map((phase, i) => ({ phase, completed: completed[i] })) });

  test('a new Moonlit match plays the new list', () => {
    assert.deepEqual(matchPhases(at('moonlit', [21, 22, 21])), phaseSequence('moonlit'));
    assert.deepEqual(matchPhases(at('moonlit', [null, null])), phaseSequence('moonlit'));
  });

  test('a Moonlit match with any retired phase, current or completed, plays the retired list', () => {
    assert.deepEqual(matchPhases(at('moonlit', [13, 11])), RETIRED_MOONLIT_PHASES);
    assert.deepEqual(matchPhases(at('moonlit', [null, null], [[], [11, 12]])), RETIRED_MOONLIT_PHASES);
    assert.deepEqual(matchPhases(at('moonlit', [20, 11], [[11, 12, 13, 14, 15, 16, 17, 18, 19], []])), RETIRED_MOONLIT_PHASES);
  });

  test('every other variant plays its own list', () => {
    for (const v of ['standard', 'sprint', 'choose', 'trialB', 'trialC'] as Variant[]) {
      assert.deepEqual(matchPhases(at(v, [phaseSequence(v)[0], phaseSequence(v)[0]])), phaseSequence(v), v);
    }
  });

  test('a bot reads the same list from its observation as the game holds', () => {
    const { state } = createGame({ playerCount: 3, variant: 'moonlit', seed: 'f2'.repeat(16) });
    for (const p of state.players) p.phase = 11;
    for (let seat = 0; seat < 3; seat++) assert.deepEqual(matchPhases(observe(state, seat)), RETIRED_MOONLIT_PHASES);
    // The observation that list comes from holds only public progress, as before.
    const obs = observe(state, 0);
    assert.ok(obs.players.every((p) => !('hand' in p)));
  });
});

/** A Moonlit match on the retired list, from its first round, as a match saved before the change would be. */
function retiredMatch(seed: string, players: number): GameState {
  const { state } = createGame({ playerCount: players, variant: 'moonlit', seed });
  for (const p of state.players) p.phase = RETIRED_MOONLIT_PHASES[0];
  return state;
}

describe('a match begun on the retired list', () => {
  test('bots play it to the end on the retired list, with no illegal move or stall', () => {
    for (const [i, lineup] of ([['hoot', 'briar'], ['hoot', 'lumi', 'sable'], ['nightshade', 'velvet', 'mallow', 'fennel']] as BotId[][]).entries()) {
      const state = retiredMatch(`${i}e`.repeat(16), lineup.length);
      const rng = createRng(`${i}d`.repeat(16), 1);
      const rand = () => rng.next() / 0x100000000;
      for (let moves = 0; moves < 80000 && state.stage !== 'matchOver'; moves++) {
        if (state.stage === 'roundOver') { nextRound(state); continue; }
        for (const p of state.players) assert.ok(p.phase === null || RETIRED_MOONLIT_PHASES.includes(p.phase), `phase ${p.phase}`);
        const r = step(state, decide(lineup[state.current], observe(state, state.current), rand));
        assert.ok(r.ok, r.ok ? '' : r.reason);
      }
      assert.equal(state.stage, 'matchOver');
      const winner = state.players[state.winners[0]];
      assert.deepEqual([...winner.completed].sort((a, b) => a - b), RETIRED_MOONLIT_PHASES);
    }
  });

  test('its Rematch starts on the new list', () => {
    const state = retiredMatch('e9'.repeat(16), 3);
    assert.deepEqual(matchPhases(state), RETIRED_MOONLIT_PHASES);
    // Rematch and Try Again start a fresh game on the same variant (end.ts, rematch).
    const { state: again } = createGame({ playerCount: 3, variant: state.variant, seed: 'ea'.repeat(16) });
    assert.deepEqual(matchPhases(again), phaseSequence('moonlit'));
    assert.equal(again.players[0].phase, 21);
  });
});

describe('saves made before the change', () => {
  const names = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

  test('every prepared save is here', () => {
    assert.deepEqual(names.sort(), ['free-moonlit', 'free-trialA', 'free-trialB', 'free-trialC', 'glade-a2-fogged', 'glade-g3-boss', 'realistic']);
  });

  test('the realistic save migrates with every field preserved', () => {
    const before = fixture('realistic');
    assert.equal(before.schema, 2);
    assert.deepEqual(migrate(copy(before)), before);
  });

  for (const name of ['glade-a2-fogged', 'glade-g3-boss', 'free-moonlit', 'free-trialB', 'free-trialC']) {
    test(`${name}: migrates byte for byte, and keeps its list`, () => {
      const before = fixture(name);
      const after = migrate(copy(before));
      assert.equal(JSON.stringify(after), JSON.stringify(before));
      const want = name.startsWith('free-trial') ? phaseSequence(before.match.game.variant) : RETIRED_MOONLIT_PHASES;
      assert.deepEqual(matchPhases(after.match!.game), want);
    });
  }

  test('a Trial A match becomes a Moonlit Phases match on the same list, and nothing else changes', () => {
    const before = fixture('free-trialA');
    assert.equal(before.match.game.variant, 'trialA');
    const after = migrate(copy(before));
    assert.equal(after.match!.game.variant, 'moonlit');
    assert.deepEqual(matchPhases(after.match!.game), phaseSequence('moonlit'));
    const expected = copy(before);
    expected.match.game.variant = 'moonlit';
    assert.deepEqual(after, expected);
    // Migrating again changes nothing.
    assert.deepEqual(migrate(copy(after)), after);
  });

  test('an old backup code imports correctly', () => {
    const code = readFileSync(join(FIXTURES, 'realistic-code.txt'), 'utf8').trim();
    const imported = importCode(code);
    assert.ok(imported);
    assert.deepEqual(imported, { ...fixture('realistic'), match: null });
  });

  test('Backup and Restore round-trip a save made after the update', () => {
    const save = migrate(copy(fixture('free-trialA'))) as SaveData;
    save.stats.played += 1;
    save.charms.push('moonlit-mastery');
    const restored = importCode(exportCode(save));
    assert.deepEqual(restored, { ...save, match: null });
  });
});

describe('no match reads the list for a new match', () => {
  test('outside phases.ts, only How to Play asks for a variant\'s new-match list', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p.replace(/\\/g, '/'));
      }
    };
    walk('src');
    const calling = files.filter((f) => /\bphaseSequence\(/.test(readFileSync(f, 'utf8'))).sort();
    assert.deepEqual(calling, ['src/engine/phases.ts', 'src/ui/screens/howto.ts']);
  });
});
