// The climb (TOWER_SPEC.md §3, §11): hearts, floors, retries, Guardians, ending a climb, records, and the stats and
// Charm rules.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CHARMS, TOWER_CHARMS, type CharmId } from '../../src/content.ts';
import type { GameEvent, GameState, RoundResult } from '../../src/engine/types.ts';
import { applyEvents, crossroadsOpen, finishMatch, newTracker } from '../../src/meta/progress.ts';
import { defaultSave, migrate, type MatchMode, type SaveData, type SavedMatch } from '../../src/meta/save.ts';
import { HISTORY_KEPT, currentAttempt, endClimb, floorResult, startClimb } from '../../src/meta/tower.ts';
import { playMatch } from '../../src/sim/driver.ts';

const seed = (i: number) => i.toString(16).padStart(32, '7');

function climbing(floor = 1, hearts = 3): SaveData {
  const save = defaultSave();
  startClimb(save);
  save.tower.climb!.floor = floor;
  save.tower.climb!.hearts = hearts;
  return save;
}

/** A finished floor as the table would hand it to finishMatch. */
function floorMatch(save: SaveData, humanWins: boolean, mode: MatchMode = { kind: 'tower', floor: save.tower.climb!.floor }): SavedMatch {
  const a = currentAttempt(save, seed(save.tower.climb!.floor));
  const out = playMatch(['hoot', ...a.lineup], seed(99), 'tower', undefined, a.phases);
  const game = out.state;
  game.winners = humanWins ? [0] : [1];
  return { game, lineup: a.lineup, mode, back: 'rose-lattice', cloth: 'blush-gingham', boss: false, ui: { order: [], sort: 'number', slots: [], roundShown: 0 }, tracker: newTracker(), botTurns: [] };
}

describe('floors and hearts', () => {
  test('a climb starts on floor 1 with three hearts, one at a time', () => {
    const save = defaultSave();
    startClimb(save);
    assert.deepEqual(save.tower.climb, { floor: 1, hearts: 3, run: { floorsCleared: 0, phasesCompleted: 0, guardiansBeaten: 0 }, attempt: null });
    assert.throws(() => startClimb(save));
  });

  test('a win moves up one floor and keeps the hearts', () => {
    const save = climbing(4, 2);
    const s = finishMatch(save, floorMatch(save, true));
    assert.equal(s.humanWon, true);
    assert.deepEqual({ floor: save.tower.climb!.floor, hearts: save.tower.climb!.hearts }, { floor: 5, hearts: 2 });
    assert.equal(save.tower.climb!.run.floorsCleared, 1);
    assert.equal(save.tower.totals.floorsCleared, 1);
    assert.equal(s.tower!.heartBack, false);
  });

  test('a loss costs one heart and keeps the floor, with a fresh draw for the retry', () => {
    const save = climbing(7, 3);
    const first = currentAttempt(save, seed(1));
    finishMatch(save, floorMatch(save, false));
    assert.deepEqual({ floor: save.tower.climb!.floor, hearts: save.tower.climb!.hearts }, { floor: 7, hearts: 2 });
    assert.equal(save.tower.climb!.attempt, null, 'the old draw is gone');
    const retry = currentAttempt(save, seed(2));
    assert.notDeepEqual(retry, first);
  });

  test('a forfeit is a loss', () => {
    const save = climbing(3, 3);
    const s = finishMatch(save, floorMatch(save, true), true);
    assert.equal(s.humanWon, false);
    assert.deepEqual({ floor: save.tower.climb!.floor, hearts: save.tower.climb!.hearts }, { floor: 3, hearts: 2 });
  });

  test('a Guardian win below three hearts gives one back; at three it changes nothing', () => {
    const low = climbing(10, 1);
    const s = finishMatch(low, floorMatch(low, true));
    assert.deepEqual({ floor: low.tower.climb!.floor, hearts: low.tower.climb!.hearts }, { floor: 11, hearts: 2 });
    assert.equal(s.tower!.heartBack, true);
    assert.equal(low.tower.climb!.run.guardiansBeaten, 1);
    assert.equal(low.tower.totals.guardiansBeaten, 1);
    const full = climbing(20, 3);
    const f = finishMatch(full, floorMatch(full, true));
    assert.equal(full.tower.climb!.hearts, 3);
    assert.equal(f.tower!.heartBack, false);
  });

  test('an ordinary win never gives a heart back', () => {
    const save = climbing(9, 1);
    finishMatch(save, floorMatch(save, true));
    assert.equal(save.tower.climb!.hearts, 1);
  });

  test('losing the last heart ends the climb on that floor', () => {
    const save = climbing(23, 1);
    save.tower.best = 40;
    const s = finishMatch(save, floorMatch(save, false));
    assert.equal(save.tower.climb, null);
    assert.deepEqual(s.tower!.end, { floor: 23, oldBest: 40, newBest: false, run: { floorsCleared: 0, phasesCompleted: 0, guardiansBeaten: 0 } });
    assert.equal(save.tower.history[0].floor, 23);
    assert.equal(save.tower.totals.climbs, 1);
  });
});

describe('ending a climb by choice', () => {
  test('"End this climb" ends it on the current floor and abandons a floor in progress', () => {
    const save = climbing(12, 2);
    save.match = floorMatch(save, false);
    const end = endClimb(save, 1763000000000);
    assert.equal(end.floor, 12);
    assert.equal(save.tower.climb, null);
    assert.equal(save.match, null);
    assert.deepEqual(save.tower.history, [{ floor: 12, endedAt: 1763000000000, newBest: true }]);
  });

  test('cancelling changes nothing', () => {
    const save = climbing(12, 2);
    const before = JSON.stringify(save);
    // The confirmation's "Keep climbing" calls nothing; the save is exactly as it was.
    assert.equal(JSON.stringify(save), before);
  });

  test('a match that isn\'t a Tower floor is left alone', () => {
    const save = climbing(5, 3);
    save.match = { ...floorMatch(save, false), mode: { kind: 'free' } };
    endClimb(save);
    assert.notEqual(save.match, null);
  });
});

describe('records', () => {
  test('the best floor changes only when beaten', () => {
    const save = defaultSave();
    for (const [floor, best, isNew] of [[14, 14, true], [9, 14, false], [14, 14, false], [15, 15, true]] as const) {
      startClimb(save);
      save.tower.climb!.floor = floor;
      const end = endClimb(save);
      assert.equal(save.tower.best, best);
      assert.equal(end.newBest, isNew);
      assert.equal(save.tower.history[0].newBest, isNew);
    }
  });

  test('history keeps the last 50 climbs, newest first', () => {
    const save = defaultSave();
    for (let i = 1; i <= 60; i++) {
      startClimb(save);
      save.tower.climb!.floor = i;
      endClimb(save, i);
    }
    assert.equal(save.tower.history.length, HISTORY_KEPT);
    assert.equal(save.tower.history[0].floor, 60);
    assert.equal(save.tower.history[49].floor, 11);
    assert.equal(save.tower.totals.climbs, 60);
  });
});

describe('the draw', () => {
  test('survives a reload: it is fixed when first drawn and stays until the attempt ends', () => {
    const save = climbing(31, 3);
    const a = currentAttempt(save, seed(5));
    const reloaded = migrate(JSON.parse(JSON.stringify(save)));
    assert.deepEqual(currentAttempt(reloaded, seed(6)), a, 'a different seed now changes nothing');
    floorResult(reloaded, true);
    assert.notDeepEqual(currentAttempt(reloaded, seed(6)), a);
  });
});

describe('existing stats and Charms', () => {
  test('a Tower floor changes none of the existing stats', () => {
    const save = climbing(5, 3);
    const match = floorMatch(save, true);
    const before = JSON.parse(JSON.stringify(save.stats));
    // Replay every event of a real floor through the same path the table uses.
    const a = save.tower.climb!.attempt!;
    let live: GameState | null = null;
    playMatch(['hoot', ...a.lineup], seed(42), 'tower', undefined, a.phases, (events, state) => {
      live = state;
      applyEvents(save, { ...match, game: state }, events);
    });
    assert.ok(live);
    finishMatch(save, match);
    finishMatch(save, floorMatch(save, false), true);
    assert.deepEqual(save.stats, before);
    assert.ok(save.tower.climb!.run.phasesCompleted > 0, 'her phases count toward the run instead');
  });

  test('only the five listed Charms can be earned on a Tower floor', () => {
    const save = climbing(8, 3);
    const match = floorMatch(save, true);
    match.tracker.laidThisTurn = true;
    const round = (phase: number, points: number): RoundResult => ({ round: 1, seed: '', wentOut: 0, hands: [], points: [points, 5], phasesBefore: [phase, 1], advanced: [true, false], totals: [0, 0], history: [] });
    const events: GameEvent[] = [
      { type: 'layDown', seat: 0, phase: 8, groupIds: [1], wilds: 2 },
      { type: 'skipPlayed', seat: 0, target: 1, targetCards: 2, targetLaidDown: true } as GameEvent,
      { type: 'goOut', seat: 0, by: 'discard' },
      { type: 'roundEnd', result: round(8, 0) },
    ];
    match.game.phases = [8, 21, 30];
    match.game.variant = 'tower';
    const earned = applyEvents(save, match, events);
    assert.deepEqual(earned.sort(), [...TOWER_CHARMS].sort());
    for (let k = 0; k < 6; k++) applyEvents(save, match, [{ type: 'roundEnd', result: round(30, 0) }]);
    match.tracker.neverFailedTwice = true;
    match.tracker.wasFarBehind = true;
    finishMatch(save, match);
    const others = CHARMS.map((c) => c.id).filter((id) => !TOWER_CHARMS.includes(id));
    for (const id of others) assert.ok(!save.charms.includes(id as CharmId), `${id} was earned in the Tower`);
  });

  test('the same moments outside the Tower still earn their Charms', () => {
    const save = defaultSave();
    const match = floorMatch({ ...climbing(1, 3) }, true, { kind: 'free' });
    const earned = applyEvents(save, match, [{ type: 'layDown', seat: 0, phase: 1, groupIds: [1], wilds: 2 }]);
    assert.deepEqual(earned, ['first-bloom', 'wild-at-heart']);
    assert.equal(save.stats.wildsUsed, 2);
  });
});

describe('the Crossroads', () => {
  test('opens once Lady Lunaria has been beaten, including on a save from before the update', () => {
    const save = defaultSave();
    assert.equal(crossroadsOpen(save), false);
    save.glade.winOrder = ['g1', 'a1', 'b1', 'a2', 'b2', 'g2'];
    assert.equal(crossroadsOpen(save), false);
    save.glade.winOrder.push('g3');
    assert.equal(crossroadsOpen(migrate({ ...JSON.parse(JSON.stringify(save)), schema: 2, tower: undefined })), true);
  });
});
