// The Moonlit Glade's progression: the fork, the Play button, stars, the fog, rewards and Charms.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GLADE_STOPS, UNLOCKABLES, requirementText, type GladeStopId } from '../../src/content.ts';
import { createGame } from '../../src/engine/game.ts';
import type { GameEvent, RoundResult } from '../../src/engine/types.ts';
import type { BotId } from '../../src/bots/profiles.ts';
import {
  applyEvents, botsUnlocked, finishMatch, gladeOpen, gladeOpenStops, gladePlayStop, gladeStars, gladeStarsFor, gladeUnlocked,
  isUnlocked, newTracker,
} from '../../src/meta/progress.ts';
import { defaultSave, type SaveData, type SavedMatch } from '../../src/meta/save.ts';

function saveWith(...won: GladeStopId[]): SaveData {
  const s = defaultSave();
  s.campaign.won = [true, true, true, true, true];
  s.glade.winOrder = won;
  return s;
}

function gladeMatch(stop: GladeStopId, rounds: number, humanWins: boolean, fog = true): SavedMatch {
  const def = GLADE_STOPS.find((x) => x.id === stop)!;
  const lineup: BotId[] = def.lineup.slice();
  const { state } = createGame({ playerCount: lineup.length + 1, variant: 'moonlit', seed: 'aa'.repeat(16), rules: fog ? { fog: true } : undefined });
  state.round = rounds;
  state.winners = humanWins ? [0] : [1];
  state.stage = 'matchOver';
  return { game: state, lineup, mode: { kind: 'glade', stop }, back: 'rose-lattice', cloth: 'blush-gingham', boss: false, ui: { order: [], sort: 'number', slots: [], roundShown: 0 }, tracker: newTracker(), botTurns: [] };
}

describe('the Glade opens', () => {
  test('only after Nightshade is beaten, and then G1 is open', () => {
    const s = defaultSave();
    assert.equal(gladeOpen(s), false);
    assert.deepEqual(gladeOpenStops(s), []);
    s.campaign.won = [true, true, true, true, true];
    assert.equal(gladeOpen(s), true);
    assert.deepEqual(gladeOpenStops(s), ['g1']);
  });

  test('the fork: G1 opens both lanes, either lane end opens the Old Stones, and they open the boss', () => {
    assert.ok(gladeUnlocked(saveWith('g1'), 'a1') && gladeUnlocked(saveWith('g1'), 'b1'));
    assert.ok(!gladeUnlocked(saveWith('g1'), 'a2'));
    assert.ok(gladeUnlocked(saveWith('g1', 'a1'), 'a2'));
    assert.ok(!gladeUnlocked(saveWith('g1', 'a1'), 'b2'));
    assert.ok(gladeUnlocked(saveWith('g1', 'b1', 'b2'), 'g2'));
    assert.ok(gladeUnlocked(saveWith('g1', 'a1', 'a2'), 'g2'));
    assert.ok(!gladeUnlocked(saveWith('g1', 'a1', 'a2'), 'g3'));
    assert.ok(gladeUnlocked(saveWith('g1', 'a1', 'a2', 'g2'), 'g3'));
  });

  test('the other path stays playable', () => {
    assert.ok(gladeOpenStops(saveWith('g1', 'a1', 'a2', 'g2', 'g3')).includes('b1'));
  });
});

describe('which stop gets the Play button (§6.5)', () => {
  const ROWS: [GladeStopId[], GladeStopId | null, GladeStopId[]][] = [
    [[], 'g1', []],
    [['g1'], 'a1', ['b1']],
    [['g1', 'b1'], 'b2', ['a1']],
    [['g1', 'b1', 'a1'], 'a2', ['b2']],
    [['g1', 'a1', 'b1'], 'b2', ['a2']],
    [['g1', 'a1', 'a2'], 'g2', ['b1']],
    [['g1', 'a1', 'a2', 'g2', 'g3'], 'b1', []],
  ];
  for (const [won, play, others] of ROWS) {
    test(`${won.length ? won.join(', ').toUpperCase() + ' won' : 'nothing won'}: Play on ${play?.toUpperCase()}`, () => {
      const s = saveWith(...won);
      assert.equal(gladePlayStop(s), play);
      assert.deepEqual(gladeOpenStops(s).filter((id) => id !== play).sort(), [...others].sort());
    });
  }

  test('with every stop won there is no Play button', () => {
    assert.equal(gladePlayStop(saveWith('g1', 'a1', 'a2', 'b1', 'b2', 'g2', 'g3')), null);
  });
});

describe('stars', () => {
  test('thresholds come from the simulation and are set for every stop', () => {
    for (const s of GLADE_STOPS) {
      assert.ok(s.stars.two > 0 && s.stars.three > 0 && s.stars.three <= s.stars.two, s.id);
      assert.equal(gladeStarsFor(s, s.stars.three), 3);
      assert.equal(gladeStarsFor(s, s.stars.three + 1), s.stars.three + 1 <= s.stars.two ? 2 : 1);
      assert.equal(gladeStarsFor(s, s.stars.two + 1), 1);
    }
  });

  test('a win records the stop, its best stars and rounds, and the order of wins', () => {
    const s = saveWith();
    const g1 = GLADE_STOPS[0];
    finishMatch(s, gladeMatch('g1', g1.stars.two + 3, true));
    assert.deepEqual(s.glade.winOrder, ['g1']);
    assert.equal(s.glade.stars.g1, 1);
    finishMatch(s, gladeMatch('g1', g1.stars.three, true));
    assert.equal(s.glade.stars.g1, 3);
    assert.equal(s.glade.bestRounds.g1, g1.stars.three);
    assert.deepEqual(s.glade.winOrder, ['g1'], 'a replay does not move it');
    assert.equal(gladeStars(s), 3);
  });

  test('a loss records nothing', () => {
    const s = saveWith();
    finishMatch(s, gladeMatch('g1', 10, false));
    assert.deepEqual(s.glade.winOrder, []);
  });

  test('Map 1 stars are untouched by Glade wins', () => {
    const s = saveWith();
    s.campaign.stars = [3, 3, 3, 3, 3];
    finishMatch(s, gladeMatch('g1', 9, true));
    assert.deepEqual(s.campaign.stars, [3, 3, 3, 3, 3]);
  });
});

describe('the fog', () => {
  test('lifts on the first boss win, for good, and earns Dawnbringer', () => {
    const s = saveWith('g1', 'a1', 'a2', 'g2');
    const first = finishMatch(s, gladeMatch('g3', 20, true));
    assert.equal(first.liftedFog, true);
    assert.equal(s.glade.fogLifted, true);
    assert.equal(s.glade.liftScenePending, true);
    assert.ok(s.charms.includes('dawnbringer'));
    s.glade.liftScenePending = false;
    const again = finishMatch(s, gladeMatch('g3', 20, true, false));
    assert.equal(again.liftedFog, false);
    assert.equal(s.glade.liftScenePending, false, 'the scene never plays twice');
  });

  test('a boss loss lifts nothing', () => {
    const s = saveWith('g1', 'a1', 'a2', 'g2');
    finishMatch(s, gladeMatch('g3', 20, false));
    assert.equal(s.glade.fogLifted, false);
  });
});

describe('rewards', () => {
  const WANT: [string, GladeStopId][] = [
    ['lantern-glow', 'g1'], ['moonlit', 'g1'], ['bunny-hop', 'a1'], ['lily-pad', 'b1'], ['firefly-meadow', 'a2'],
    ['trinket-quilt', 'b2'], ['moonlight-waltz', 'g2'], ['mistveil', 'g3'], ['dawn-bloom', 'g3'],
  ];
  for (const [item, stop] of WANT) {
    test(`${item} unlocks by winning ${stop.toUpperCase()}`, () => {
      assert.ok(!isUnlocked(saveWith(), item));
      assert.ok(isUnlocked(saveWith(stop), item));
      assert.match(requirementText(UNLOCKABLES.find((u) => u.id === item)!.req), /^Win /);
    });
  }

  test('Sunrise Garden needs all 21 Glade stars', () => {
    const s = saveWith('g1', 'a1', 'a2', 'b1', 'b2', 'g2', 'g3');
    for (const st of GLADE_STOPS) s.glade.stars[st.id] = 3;
    assert.ok(isUnlocked(s, 'sunrise-garden'));
    s.glade.stars.g2 = 2;
    assert.ok(!isUnlocked(s, 'sunrise-garden'));
  });

  test('Glade bots join Free Play when their stop opens; Lunaria once beaten; the wisps never', () => {
    assert.ok(!botsUnlocked(saveWith()).includes('mallow'));
    assert.ok(botsUnlocked(saveWith()).includes('lumi'));
    assert.ok(botsUnlocked(saveWith('g1')).includes('mallow'));
    assert.ok(!botsUnlocked(saveWith('g1', 'a1', 'a2', 'g2')).includes('lunaria'));
    assert.ok(botsUnlocked(saveWith('g1', 'a1', 'a2', 'g2', 'g3')).includes('lunaria'));
    assert.ok(!botsUnlocked(saveWith('g1', 'a1', 'a2', 'g2', 'g3')).some((b) => b === 'puff' || b === 'haze'));
  });
});

describe('Glade Charms', () => {
  test('Fog Walker: 3 stars while fogged, not once the fog is gone', () => {
    const s = saveWith();
    finishMatch(s, gladeMatch('g1', GLADE_STOPS[0].stars.three, true, false));
    assert.ok(!s.charms.includes('fog-walker'));
    finishMatch(s, gladeMatch('g1', GLADE_STOPS[0].stars.three, true, true));
    assert.ok(s.charms.includes('fog-walker'));
  });

  test('Both Paths needs all four lane stops', () => {
    const s = saveWith('g1', 'a1', 'a2', 'b1');
    finishMatch(s, gladeMatch('g2', 20, true));
    assert.ok(!s.charms.includes('both-paths'));
    finishMatch(s, gladeMatch('b2', 20, true));
    assert.ok(s.charms.includes('both-paths'));
  });

  test('Thornproof: beat Lunaria without being skipped', () => {
    const s = saveWith('g1', 'a1', 'a2', 'g2');
    const skipped = gladeMatch('g3', 20, true);
    applyEvents(s, skipped, [{ type: 'turnSkipped', seat: 0 }]);
    finishMatch(s, skipped);
    assert.ok(!s.charms.includes('thornproof'));
    finishMatch(s, gladeMatch('g3', 20, true));
    assert.ok(s.charms.includes('thornproof'));
  });

  test('Moonlit Mastery: completing the last Moonlit phase', () => {
    const s = saveWith();
    const m = gladeMatch('g1', 10, true);
    const end = (phase: number): GameEvent => ({ type: 'roundEnd', result: { round: 1, seed: '', wentOut: 0, hands: [[], [], []], points: [0, 5, 5], phasesBefore: [phase, 11, 11], advanced: [true, false, false], totals: [0, 5, 5], history: [] } as RoundResult });
    applyEvents(s, m, [end(19)]);
    assert.ok(!s.charms.includes('moonlit-mastery'));
    applyEvents(s, m, [end(20)]);
    assert.ok(s.charms.includes('moonlit-mastery'));
  });

  test('Glade matches count in the overall stats, and wisps get no stats line', () => {
    const s = saveWith('g1', 'a1', 'a2', 'g2');
    finishMatch(s, gladeMatch('g3', 20, true));
    assert.equal(s.stats.played, 1);
    assert.equal(s.stats.perBot.lunaria.wins, 1);
    assert.ok(!('puff' in s.stats.perBot));
  });
});
