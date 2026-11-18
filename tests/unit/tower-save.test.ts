// A player with Map 1 and Map 2 complete updates to the Tower. Nothing they have may change, a match in progress
// must carry on exactly, and Backup & Restore must carry the Tower.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { gladeWon } from '../../src/meta/progress.ts';
import { SCHEMA, clearSave, defaultTower, exportCode, importCode, loadSave, migrate, writeSave, type SaveData } from '../../src/meta/save.ts';

const FIXTURES = 'tests/fixtures/pre-tower';
const fixture = (name: string): Record<string, any> => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The save as the update loads it, minus only what the update adds. */
function withoutTower(after: SaveData): Record<string, any> {
  assert.equal(after.schema, SCHEMA);
  assert.deepEqual(after.tower, defaultTower());
  const { tower, ...rest } = copy(after) as Record<string, any>;
  void tower;
  return { ...rest, schema: 2 };
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

describe('saves made before the Tower', () => {
  beforeEach(() => { clearSave(); });

  test('every prepared save is here, recorded on schema 2', () => {
    const names = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    assert.deepEqual(names, ['free-standard', 'glade-g2-lifted', 'glade-g3-rematch', 'realistic']);
    for (const name of names) assert.equal(fixture(name).schema, 2, name);
  });

  test('the realistic save, with both maps complete, migrates with every field preserved', () => {
    const before = fixture('realistic');
    assert.deepEqual(withoutTower(migrate(copy(before))), before);
  });

  for (const name of ['glade-g2-lifted', 'glade-g3-rematch', 'free-standard']) {
    test(`${name}: the match in progress migrates byte for byte`, () => {
      const before = fixture(name);
      const after = migrate(copy(before));
      assert.equal(JSON.stringify(withoutTower(after)), JSON.stringify(before));
      assert.equal(JSON.stringify(after.match), JSON.stringify(before.match));
    });
  }

  test('a migrated save migrates to itself', () => {
    const once = migrate(copy(fixture('glade-g3-rematch')));
    assert.deepEqual(migrate(copy(once)), once);
  });

  test('an old backup code imports correctly, with the Crossroads open because Lunaria was beaten', () => {
    const code = readFileSync(join(FIXTURES, 'realistic-code.txt'), 'utf8').trim();
    const imported = importCode(code);
    assert.ok(imported);
    assert.deepEqual(withoutTower(imported), { ...fixture('realistic'), match: null });
    assert.equal(gladeWon(imported, 'g3'), true);
  });

  test('Backup and Restore round-trip the Tower records, totals and the climb between floors', () => {
    const save = migrate(copy(fixture('realistic')));
    save.tower = {
      best: 42,
      history: [{ floor: 42, endedAt: 1763400000000, newBest: true }, { floor: 17, endedAt: 1763300000000, newBest: false }],
      totals: { climbs: 2, floorsCleared: 57, guardiansBeaten: 5 },
      climb: { floor: 23, hearts: 2, run: { floorsCleared: 22, phasesCompleted: 70, guardiansBeaten: 2 }, attempt: null },
      revealSeen: true,
    };
    assert.deepEqual(importCode(exportCode(save)), { ...save, match: null });
  });

  test('a code never carries a floor in progress: the restored climb draws that floor afresh', () => {
    const save = migrate(copy(fixture('realistic')));
    save.tower.climb = {
      floor: 9, hearts: 1, run: { floorsCleared: 8, phasesCompleted: 26, guardiansBeaten: 0 },
      attempt: { seed: 'ab'.repeat(16), phases: [2, 31, 6], lineup: ['marigold'], guardian: null },
    };
    const restored = importCode(exportCode(save))!;
    assert.equal(restored.match, null);
    assert.deepEqual(restored.tower.climb, { ...save.tower.climb, attempt: null });
    assert.notEqual(save.tower.climb.attempt, null, 'exporting leaves the save itself alone');
  });

  test('a partial Tower block is filled in from the defaults', () => {
    const save = migrate({ ...copy(fixture('realistic')), schema: 3, tower: { best: 12, totals: { climbs: 3 } } });
    assert.deepEqual(save.tower, { ...defaultTower(), best: 12, totals: { climbs: 3, floorsCleared: 0, guardiansBeaten: 0 } });
  });

  test('the first load keeps one untouched copy of the save from before the Tower', () => {
    const store = stubStorage();
    const text = JSON.stringify(fixture('glade-g2-lifted'));
    store.set('ten-charms.save', text);
    const loaded = loadSave();
    assert.equal(store.get('ten-charms.save.pre-tower'), text);
    assert.equal(store.get('ten-charms.save.pre-map2'), undefined, 'a schema 2 save needs no Map 2 copy');
    assert.equal(JSON.stringify(loaded.match), JSON.stringify(fixture('glade-g2-lifted').match));
    writeSave({ ...loaded, charms: [...loaded.charms, 'bouquet'] });
    loadSave();
    assert.equal(store.get('ten-charms.save.pre-tower'), text, 'the copy never changes');
  });
});
