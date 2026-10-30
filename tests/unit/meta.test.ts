import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createGame } from '../../src/engine/game.ts';
import type { GameEvent, RoundResult } from '../../src/engine/types.ts';
import { applyEvents, finishMatch, isUnlocked, newTracker, saveSummary, standings, starsFor, totalStars } from '../../src/meta/progress.ts';
import { defaultSave, exportCode, importCode, migrate, type SavedMatch } from '../../src/meta/save.ts';

function match(lineup: SavedMatch['lineup'] = ['pip'], mode: SavedMatch['mode'] = { kind: 'campaign', stop: 0 }): SavedMatch {
  const { state } = createGame({ playerCount: lineup.length + 1, seed: 'aa'.repeat(16) });
  return { game: state, lineup, mode, back: 'rose-lattice', cloth: 'blush-gingham', boss: false, ui: { order: [], sort: 'number', slots: [], roundShown: 0 }, tracker: newTracker(), botTurns: [] };
}

const round = (phase: number, advanced: boolean, points = 10): GameEvent => ({
  type: 'roundEnd',
  result: { round: 1, seed: '', wentOut: 0, hands: [[], []], points: [points, 5], phasesBefore: [phase, 1], advanced: [advanced, false], totals: [points, 5], history: [] } as RoundResult,
});

describe('charms', () => {
  test('First Bloom and Wild at Heart come from laying down', () => {
    const s = defaultSave(); const m = match();
    assert.deepEqual(applyEvents(s, m, [{ type: 'layDown', seat: 0, phase: 1, groupIds: [], wilds: 1 }]), ['first-bloom']);
    assert.deepEqual(applyEvents(s, m, [{ type: 'layDown', seat: 0, phase: 2, groupIds: [], wilds: 2 }]), ['wild-at-heart']);
    assert.equal(s.stats.wildsUsed, 3);
    assert.deepEqual(applyEvents(s, m, [{ type: 'layDown', seat: 1, phase: 1, groupIds: [], wilds: 3 }]), []);
  });

  test('Not Today needs a target with few cards and their phase down', () => {
    const s = defaultSave(); const m = match();
    assert.deepEqual(applyEvents(s, m, [{ type: 'skipPlayed', seat: 0, target: 1, targetCards: 3, targetLaidDown: false }]), []);
    assert.deepEqual(applyEvents(s, m, [{ type: 'skipPlayed', seat: 0, target: 1, targetCards: 4, targetLaidDown: true }]), []);
    assert.deepEqual(applyEvents(s, m, [{ type: 'skipPlayed', seat: 0, target: 1, targetCards: 3, targetLaidDown: true }]), ['not-today']);
    assert.equal(s.stats.skipsPlayed, 3);
  });

  test('Clean Sweep needs the lay-down and going out in the same turn', () => {
    const s = defaultSave(); const m = match();
    applyEvents(s, m, [{ type: 'turnStart', seat: 0 }, { type: 'layDown', seat: 0, phase: 1, groupIds: [], wilds: 0 }]);
    applyEvents(s, m, [{ type: 'turnStart', seat: 0 }]);
    assert.ok(!applyEvents(s, m, [{ type: 'goOut', seat: 0, by: 'discard' }]).includes('clean-sweep'));
    applyEvents(s, m, [{ type: 'turnStart', seat: 0 }, { type: 'layDown', seat: 0, phase: 2, groupIds: [], wilds: 0 }]);
    assert.ok(applyEvents(s, m, [{ type: 'goOut', seat: 0, by: 'hit' }]).includes('clean-sweep'));
    assert.equal(s.stats.wentOut, 2);
  });

  test('Perfect Teatime and Rainbow', () => {
    const s = defaultSave(); const m = match();
    assert.deepEqual(applyEvents(s, m, [round(1, false, 0)]), []);
    assert.deepEqual(applyEvents(s, m, [round(1, true, 0)]), ['perfect-teatime']);
    assert.deepEqual(applyEvents(s, m, [round(8, true, 5)]), ['rainbow']);
    const s2 = defaultSave(); const m2 = match();
    applyEvents(s2, m2, [round(8, false)]);
    assert.deepEqual(applyEvents(s2, m2, [round(8, true)]), []);
  });

  test('Steady Hands and Comeback on a win', () => {
    const s = defaultSave(); const m = match();
    m.game.players[1].completed = [1, 2];
    applyEvents(s, m, [round(1, false)]);
    assert.equal(m.tracker.wasFarBehind, true);
    m.game.players[0].completed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    m.game.winners = [0];
    m.game.round = 13;
    const r = finishMatch(s, m);
    assert.ok(r.newCharms.includes('comeback'));
    assert.ok(r.newCharms.includes('steady-hands'));

    const s2 = defaultSave(); const m2 = match();
    applyEvents(s2, m2, [round(1, false), round(1, false)]);
    m2.game.winners = [0];
    assert.ok(!finishMatch(s2, m2).newCharms.includes('steady-hands'));
  });
});

describe('campaign', () => {
  test('stars by rounds', () => {
    assert.deepEqual([10, 12, 13, 14, 15, 30].map(starsFor), [3, 3, 2, 2, 1, 1]);
  });

  test('best result is kept, and unlocks follow wins and stars', () => {
    const s = defaultSave();
    assert.equal(isUnlocked(s, 'free-play'), false);
    const m = match();
    m.game.winners = [0]; m.game.round = 12;
    const first = finishMatch(s, m);
    assert.equal(first.stars, 3);
    assert.deepEqual(first.newUnlocks.map((u) => u.id), ['clover-meadow', 'free-play']);
    m.game.round = 20;
    assert.equal(finishMatch(s, m).stars, 1);
    assert.equal(s.campaign.stars[0], 3);
    assert.equal(s.campaign.bestRounds[0], 12);
    assert.equal(s.stats.fewestRounds, 12);

    const s2 = defaultSave();
    s2.campaign.won = [true, true, true, true, false];
    s2.campaign.stars = [3, 3, 3, 3, 0];
    const b = match(['nightshade'], { kind: 'campaign', stop: 4 });
    b.game.winners = [0]; b.game.round = 11;
    const r = finishMatch(s2, b);
    assert.equal(totalStars(s2), 15);
    assert.ok(r.firstBossWin);
    assert.deepEqual(r.newUnlocks.map((u) => u.id).sort(), ['choose', 'midnight-garden', 'moth-wing', 'music-box', 'sprint', 'starlight']);
    assert.deepEqual(r.newCharms.sort(), ['bouquet', 'garden-champion', 'steady-hands']);
  });

  test('free play wins count for stats but not stars; forfeit counts as a loss', () => {
    const s = defaultSave();
    const f = match(['pip', 'briar'], { kind: 'free' });
    f.game.winners = [0];
    const r = finishMatch(s, f);
    assert.equal(r.stars, 0);
    assert.equal(totalStars(s), 0);
    assert.equal(s.stats.won, 1);
    assert.equal(s.stats.perBot.pip.wins, 1);
    const l = match(['pip', 'briar'], { kind: 'campaign', stop: 0 });
    const out = finishMatch(s, l, true);
    assert.equal(out.humanWon, false);
    assert.equal(s.stats.streak, 0);
    assert.equal(s.campaign.won[0], false);
    assert.equal(s.stats.perBot.pip.losses, 1);
  });

  test('a loss is only against bots that finished ahead', () => {
    const s = defaultSave();
    const m = match(['pip', 'briar']);
    m.game.winners = [2];
    m.game.players[2].completed = [1, 2, 3];
    m.game.players[0].completed = [1, 2];
    m.game.players[1].completed = [1];
    assert.deepEqual(standings(m.game), [2, 0, 1]);
    finishMatch(s, m);
    assert.equal(s.stats.perBot.briar.losses, 1);
    assert.equal(s.stats.perBot.pip.wins, 1);
  });
});

describe('save data', () => {
  test('backup codes round-trip, and bad codes are refused', () => {
    const s = defaultSave();
    s.campaign.stars = [3, 2, 0, 0, 0];
    s.charms = ['first-bloom'];
    s.stats.played = 42;
    s.match = match();
    const code = exportCode(s);
    const back = importCode(code)!;
    assert.equal(back.match, null);
    assert.deepEqual({ ...back, match: null }, { ...s, match: null });
    assert.equal(saveSummary(back), '5 stars, 1 Charm, 42 matches');
    assert.equal(importCode('nonsense'), null);
    assert.equal(importCode(`${code.slice(0, -4)}AAAA`), null);
  });

  test('old or partial saves fill in from defaults, and garbage throws', () => {
    const m = migrate({ schema: 0, charms: ['rainbow'], settings: { sfx: 0.1 } });
    assert.equal(m.schema, 1);
    assert.deepEqual(m.charms, ['rainbow']);
    assert.equal(m.settings.sfx, 0.1);
    assert.equal(m.settings.music, 0.5);
    assert.throws(() => migrate('x'));
    assert.throws(() => migrate({ schema: 99 }));
    assert.throws(() => migrate({ schema: 1, charms: 'no' }));
  });
});
