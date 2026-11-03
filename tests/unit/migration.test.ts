// A player with real progress updates to the Moonlit Glade. Nothing they have may change.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { createGame } from '../../src/engine/game.ts';
import { newTracker } from '../../src/meta/progress.ts';
import { SCHEMA, clearSave, defaultSave, exportCode, importCode, loadSave, migrate, writeSave } from '../../src/meta/save.ts';

/** A save written by the version before Map 2: every Map 1 stop won, with real stats and settings. */
function oldSave(): Record<string, unknown> {
  return {
    schema: 1,
    settings: { music: 0.3, sfx: 0.6, botSpeed: 'brisk', animSpeed: 'fast', reducedMotion: false, hints: false, confirmDiscard: true },
    campaign: { won: [true, true, true, true, true], stars: [3, 3, 2, 3, 1], bestRounds: [10, 11, 13, 12, 15] },
    equipped: { back: 'moth-wing', cloth: 'midnight-garden', music: 'music-box' },
    charms: ['first-bloom', 'garden-champion', 'rainbow'],
    stats: {
      played: 41, won: 23, streak: 2, bestStreak: 6, phases: 212, fewestRounds: 10, wentOut: 77, skipsPlayed: 30, timesSkipped: 28, wildsUsed: 55,
      perBot: { pip: { wins: 9, losses: 1 }, marigold: { wins: 7, losses: 3 }, briar: { wins: 5, losses: 4 }, hoot: { wins: 2, losses: 6 }, nightshade: { wins: 1, losses: 5 } },
    },
    tutorial: { done: true, seen: [1, 2, 3] },
    install: { dismissedAt: 1234 },
    backupPrompted: true,
    match: null,
  };
}

function savedMatch() {
  const { state } = createGame({ playerCount: 4, seed: 'ab'.repeat(16) });
  return {
    game: JSON.parse(JSON.stringify(state)), lineup: ['briar', 'marigold', 'pip'], mode: { kind: 'campaign', stop: 2 }, back: 'honeycomb', cloth: 'buttercream', boss: false,
    ui: { order: state.players[0].hand.map((c) => c.id), sort: 'color', slots: [[], []], roundShown: 1 }, tracker: newTracker(), botTurns: [3, 4],
  };
}

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  return store;
}

describe('save migration to the Moonlit Glade', () => {
  beforeEach(() => { clearSave(); });

  test('every old field survives untouched, and the Glade starts fresh', () => {
    const before = oldSave();
    const after = migrate(JSON.parse(JSON.stringify(before)));
    assert.equal(after.schema, SCHEMA);
    for (const key of ['settings', 'campaign', 'equipped', 'charms', 'tutorial', 'install', 'backupPrompted', 'match']) {
      assert.deepEqual((after as unknown as Record<string, unknown>)[key], before[key], key);
    }
    const stats = before.stats as { perBot: Record<string, unknown> };
    for (const [key, value] of Object.entries(stats)) {
      if (key !== 'perBot') assert.deepEqual((after.stats as unknown as Record<string, unknown>)[key], value, key);
    }
    for (const [bot, line] of Object.entries(stats.perBot)) assert.deepEqual((after.stats.perBot as Record<string, unknown>)[bot], line, bot);
    assert.deepEqual(after.glade, { winOrder: [], stars: {}, bestRounds: {}, fogLifted: false, revealSeen: false, liftScenePending: false, lastMap: 'garden' });
  });

  test('a match in progress survives byte for byte', () => {
    const match = savedMatch();
    const after = migrate({ ...oldSave(), match: JSON.parse(JSON.stringify(match)) });
    assert.equal(JSON.stringify(after.match), JSON.stringify(match));
  });

  test('a migrated save migrates to itself', () => {
    const once = migrate(oldSave());
    assert.deepEqual(migrate(JSON.parse(JSON.stringify(once))), once);
  });

  test('a save from a newer version is refused rather than damaged', () => {
    assert.throws(() => migrate({ ...oldSave(), schema: SCHEMA + 1 }));
  });

  test('an old backup code imports with all its progress', () => {
    const code = exportCode(oldSave() as never);
    const imported = importCode(code)!;
    assert.deepEqual(imported.campaign.won, [true, true, true, true, true]);
    assert.deepEqual(imported.charms, ['first-bloom', 'garden-champion', 'rainbow']);
    assert.deepEqual(imported.glade.winOrder, []);
  });

  test('Glade progress round-trips through a backup code', () => {
    const save = defaultSave();
    save.glade = { winOrder: ['g1', 'b1', 'a1'], stars: { g1: 3, b1: 1, a1: 2 }, bestRounds: { g1: 9, b1: 14, a1: 11 }, fogLifted: true, revealSeen: true, liftScenePending: false, lastMap: 'glade' };
    assert.deepEqual(importCode(exportCode(save))!.glade, save.glade);
  });

  test('the first load keeps one untouched copy of the old save', () => {
    const store = stubStorage();
    const text = JSON.stringify(oldSave());
    store.set('ten-charms.save', text);
    const loaded = loadSave();
    assert.equal(store.get('ten-charms.save.pre-map2'), text);
    assert.equal(loaded.campaign.bestRounds[4], 15);
    writeSave({ ...loaded, charms: [...loaded.charms, 'bouquet'] });
    loadSave();
    assert.equal(store.get('ten-charms.save.pre-map2'), text, 'the copy never changes');
  });

  test('a new player, or one already upgraded, gets no copy', () => {
    const store = stubStorage();
    loadSave();
    assert.equal(store.get('ten-charms.save.pre-map2'), undefined);
    writeSave(defaultSave());
    loadSave();
    assert.equal(store.get('ten-charms.save.pre-map2'), undefined);
  });
});
