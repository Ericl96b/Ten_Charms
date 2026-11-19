// Dev Mode (Change Request 05): the word, the locks it opens, and proof that with it off nothing changes.
// The word comes from outside the repo (scripts/dev-word.ts); without it these tests fail, never skip.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { GLADE_STOPS, STOPS, UNLOCKABLES } from '../../src/content.ts';
import {
  DEV_DIGEST, applyRealLocks, botsAvailable, canPlayStop, canSeeCrossroads, canSeeGlade, canUse, devModeOn, digestOf, forExport,
  gladeOpenedAtAccess, gladePlayStopAccess, isDevWord, readDevMode, reallyAllowed, takeLingering, turnOffDevMode,
} from '../../src/meta/devmode.ts';
import {
  botsUnlocked, crossroadsOpen, finishMatch, gladeOpen, gladeOpenedAt, gladePlayStop, isUnlocked, newTracker, stopOpen,
} from '../../src/meta/progress.ts';
import { defaultSave, exportCode, importCode, migrate, type SaveData, type SavedMatch } from '../../src/meta/save.ts';
import { createGame } from '../../src/engine/game.ts';
import { requireDevWord } from '../../scripts/dev-word.ts';

const WORD = requireDevWord();
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

let store = new Map<string, string>();
function stubStorage(): void {
  store = new Map();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
}
function setDev(on: boolean): void {
  if (on) store.set('ten-charms.dev', '1');
  else store.delete('ten-charms.dev');
  readDevMode();
}

/** Saves at many points in the game, from fresh to everything won, plus every prepared save in the fixtures. */
function saves(): [string, SaveData][] {
  const out: [string, SaveData][] = [['fresh', defaultSave()]];
  for (let won = 1; won <= 5; won++) {
    const s = defaultSave();
    for (let i = 0; i < won; i++) { s.campaign.won[i] = true; s.campaign.stars[i] = 2; }
    out.push([`garden ${won}`, s]);
  }
  const order = ['g1', 'a1', 'b1', 'a2', 'b2', 'g2', 'g3'] as const;
  for (let n = 1; n <= order.length; n++) {
    const s = defaultSave();
    s.campaign.won = [true, true, true, true, true];
    s.glade.winOrder = order.slice(0, n) as never;
    s.glade.revealSeen = true;
    // The Crossroads can only be the remembered place once it is open, after Lunaria (the last of the order).
    s.glade.lastMap = n === order.length ? 'crossroads' : n % 2 ? 'glade' : 'garden';
    out.push([`glade ${n}`, s]);
  }
  for (const dir of ['tests/fixtures/pre-cr04', 'tests/fixtures/pre-tower']) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) out.push([`${dir}/${f}`, migrate(JSON.parse(readFileSync(join(dir, f), 'utf8')))]);
  }
  return out;
}

beforeEach(() => {
  stubStorage();
  readDevMode();
});

describe('the secret word', () => {
  test('the shipped digest is the digest of the word', async () => {
    assert.equal(await digestOf(WORD), DEV_DIGEST, 'src/meta/devmode.ts DEV_DIGEST must be `node scripts/dev-word.ts --digest`');
  });

  test('only the exact word is recognised', async () => {
    assert.equal(await isDevWord(WORD), true);
    const wrong = [
      '', ' ', 'x', WORD.toUpperCase(), WORD[0].toUpperCase() + WORD.slice(1), ` ${WORD}`, `${WORD} `, `${WORD}\n`,
      WORD.slice(0, -1), `${WORD}${WORD.slice(-1)}`,
    ].filter((w) => w !== WORD);
    for (const w of wrong) assert.equal(await isDevWord(w), false, `a wrong word (#${wrong.indexOf(w)}) must be refused`);
  });

  test('it is off until storage says it is on', () => {
    assert.equal(devModeOn(), false);
    setDev(true);
    assert.equal(devModeOn(), true);
  });
});

describe('with Dev Mode off, nothing changes', () => {
  test('every access check equals the real check, on every save', () => {
    for (const [name, save] of saves()) {
      STOPS.forEach((_, i) => assert.equal(canPlayStop(save, i), stopOpen(save, i), `${name}: stop ${i + 1}`));
      assert.equal(canSeeGlade(save), gladeOpen(save), `${name}: glade`);
      assert.equal(canSeeCrossroads(save), crossroadsOpen(save), `${name}: crossroads`);
      for (const u of UNLOCKABLES) assert.equal(canUse(save, u.id), isUnlocked(save, u.id), `${name}: ${u.id}`);
      assert.equal(canUse(save, 'not-a-thing'), isUnlocked(save, 'not-a-thing'));
      for (const s of GLADE_STOPS) assert.equal(gladeOpenedAtAccess(save, s), gladeOpenedAt(save, s), `${name}: ${s.id}`);
      assert.equal(gladePlayStopAccess(save), gladePlayStop(save), `${name}: play stop`);
      assert.deepEqual(botsAvailable(save), botsUnlocked(save), `${name}: bots`);
    }
  });

  test('a backup code is exactly the code it always was', () => {
    for (const [name, save] of saves()) assert.equal(exportCode(forExport(save)), exportCode(save), name);
  });

  test('no match end is ever marked, so no end screen loses a button', () => {
    assert.equal(takeLingering(), false);
  });
});

describe('with Dev Mode on, every lock is open', () => {
  test('each lock, one by one, on a fresh save', () => {
    setDev(true);
    const save = defaultSave();
    const before = JSON.stringify(save);
    STOPS.forEach((_, i) => assert.equal(canPlayStop(save, i), true, `Rose Garden stop ${i + 1}`));
    assert.equal(canSeeGlade(save), true, 'the Moonlit Glade');
    for (const s of GLADE_STOPS) assert.notEqual(gladeOpenedAtAccess(save, s), null, `Glade stop ${s.id}`);
    assert.equal(gladePlayStopAccess(save), 'g1', 'the Play button stays on the first stop');
    assert.equal(canSeeCrossroads(save), true, 'the Crossroads and the Tower');
    for (const id of ['free-play', 'sprint', 'choose', 'moonlit']) assert.equal(canUse(save, id), true, id);
    for (const u of UNLOCKABLES) assert.equal(canUse(save, u.id), true, u.id);
    assert.deepEqual(new Set(botsAvailable(save)), new Set([...STOPS.map((s) => s.featured), ...GLADE_STOPS.map((s) => s.featured)]));
    assert.ok(botsAvailable(save).includes('lunaria'));
    assert.equal(canUse(save, 'not-a-thing'), false);
    assert.equal(JSON.stringify(save), before, 'nothing is written to the save');
    assert.deepEqual(save.charms, []);
  });

  test('a stop that is really open keeps its real place in the order', () => {
    setDev(true);
    const save = defaultSave();
    save.campaign.won = [true, true, true, true, true];
    save.glade.winOrder = ['g1'];
    assert.equal(gladePlayStopAccess(save), gladePlayStop(save));
  });
});

/** A finished match, as the table leaves it, for finishMatch. */
function finished(mode: SavedMatch['mode'], lineup: SavedMatch['lineup'], won: boolean): SavedMatch {
  const { state } = createGame({ playerCount: lineup.length + 1, seed: 'cd'.repeat(16) });
  state.winners = won ? [0] : [1];
  state.round = 11;
  state.stage = 'matchOver';
  return { game: state, lineup, mode, back: 'rose-lattice', cloth: 'blush-gingham', boss: false, ui: { order: [], sort: 'number', slots: [], roundShown: 0 }, tracker: newTracker(), botTurns: [] };
}

describe('playing in Dev Mode counts', () => {
  test('a match records exactly the same result with Dev Mode on or off', () => {
    const cases: [string, SavedMatch['mode'], SavedMatch['lineup']][] = [
      ['stop 1', { kind: 'campaign', stop: 0 }, ['pip']],
      ['stop 3', { kind: 'campaign', stop: 2 }, ['briar', 'marigold', 'pip']],
      ['glade b2', { kind: 'glade', stop: 'b2' }, ['sable', 'fennel', 'briar']],
      ['free play', { kind: 'free' }, ['pip']],
    ];
    for (const [name, mode, lineup] of cases) {
      for (const won of [true, false]) {
        const results = [false, true].map((on) => {
          setDev(on);
          const save = defaultSave();
          const summary = finishMatch(save, finished(mode, lineup, won));
          return JSON.stringify({ save, summary });
        });
        assert.equal(results[1], results[0], `${name}, ${won ? 'won' : 'lost'}`);
      }
    }
  });
});

describe('turning Dev Mode off', () => {
  test('equipped items locked without it go back to their slot default', () => {
    for (const slot of ['back', 'cloth', 'music'] as const) {
      for (const u of UNLOCKABLES.filter((x) => (x.type === slot) && x.req.kind !== 'default')) {
        const save = defaultSave();
        save.equipped[slot] = u.id;
        assert.equal(applyRealLocks(save), true, u.id);
        assert.equal(save.equipped[slot], defaultSave().equipped[slot], u.id);
      }
    }
  });

  test('a remembered place locked without it goes back to the garden', () => {
    for (const place of ['glade', 'crossroads'] as const) {
      const save = defaultSave();
      save.glade.lastMap = place;
      assert.equal(applyRealLocks(save), true);
      assert.equal(save.glade.lastMap, 'garden');
    }
    const open = defaultSave();
    open.campaign.won[4] = true;
    open.glade.lastMap = 'glade';
    assert.equal(applyRealLocks(open), false);
    assert.equal(open.glade.lastMap, 'glade');
  });

  test('with nothing dev-only in use, the save is left byte for byte', () => {
    // A real save only ever equips what it has unlocked. Some prepared fixtures equip items they never earned, to show
    // them on the table; those are left out here, since turning off would rightly put them back.
    const consistent = saves().filter(([, s]) => (['back', 'cloth', 'music'] as const).every((k) => isUnlocked(s, s.equipped[k])));
    assert.ok(consistent.length >= 10, 'enough saves are checked');
    for (const [name, save] of consistent) {
      const before = JSON.stringify(save);
      setDev(true);
      assert.equal(turnOffDevMode(save), false, name);
      assert.equal(JSON.stringify(save), before, name);
      assert.equal(devModeOn(), false);
      assert.equal(store.has('ten-charms.dev'), false);
    }
  });

  test('a match only Dev Mode opened is marked until its end, and only then', () => {
    setDev(true);
    const save = defaultSave();
    save.match = finished({ kind: 'campaign', stop: 2 }, ['briar', 'marigold', 'pip'], false);
    assert.equal(reallyAllowed(save, save.match), false);
    turnOffDevMode(save);
    assert.equal(takeLingering(), true);
    assert.equal(takeLingering(), false, 'cleared at the match end');

    setDev(true);
    const open = defaultSave();
    open.match = finished({ kind: 'campaign', stop: 0 }, ['pip'], false);
    assert.equal(reallyAllowed(open, open.match), true);
    turnOffDevMode(open);
    assert.equal(takeLingering(), false, 'a match open without Dev Mode is not marked');
  });

  test('a free match is dev-only if its variant, opponents, back or cloth are', () => {
    const save = defaultSave();
    save.campaign.won[0] = true;
    const m = finished({ kind: 'free' }, ['pip'], false);
    assert.equal(reallyAllowed(save, m), true);
    assert.equal(reallyAllowed(save, { ...m, lineup: ['lunaria'] }), false);
    assert.equal(reallyAllowed(save, { ...m, back: 'moth-wing' }), false);
    assert.equal(reallyAllowed(save, { ...m, cloth: 'mistveil' }), false);
    assert.equal(reallyAllowed(save, { ...m, game: { ...m.game, variant: 'sprint' } }), false);
    assert.equal(reallyAllowed(save, { ...m, game: { ...m.game, variant: 'trialB' } }), true);
    assert.equal(reallyAllowed(defaultSave(), m), false, 'Free Play itself is locked on a fresh save');
  });
});

describe('Backup & Restore', () => {
  test('a code never carries Dev Mode, nor anything only Dev Mode allowed', () => {
    setDev(true);
    const save = defaultSave();
    save.equipped = { back: 'moth-wing', cloth: 'mistveil', music: 'music-box' };
    save.glade.lastMap = 'crossroads';
    const before = JSON.stringify(save);
    const code = exportCode(forExport(save));
    assert.equal(JSON.stringify(save), before, 'the save itself is untouched');
    const restored = importCode(code)!;
    assert.deepEqual(restored.equipped, defaultSave().equipped);
    assert.equal(restored.glade.lastMap, 'garden');
    assert.doesNotMatch(JSON.stringify(restored), /ten-charms\.dev|devMode|"dev"/);
    const plain = defaultSave();
    assert.equal(exportCode(forExport(plain)), exportCode(plain), 'a save with nothing dev-only exports exactly as before');
  });
});

describe('the word stays out of the repo', () => {
  const lower = WORD.toLowerCase();
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

  test('no tracked file holds it, in its name or its content', () => {
    let checked = 0;
    for (const file of tracked) {
      if (!existsSync(file)) continue;
      assert.ok(!file.toLowerCase().includes(lower), `a tracked file name holds the word (#${checked})`);
      const text = readFileSync(file).toString('latin1').toLowerCase();
      assert.ok(!text.includes(lower), `a tracked file holds the word: ${file}`);
      checked++;
    }
    assert.ok(checked > 100, 'the scan saw the repo');
  });

  test('neither build holds it', () => {
    for (const dir of ['dist', 'dist-dev']) {
      if (!existsSync(dir)) continue;
      const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
      for (const file of walk(dir)) assert.ok(!readFileSync(file).toString('latin1').toLowerCase().includes(lower), `a built file holds the word: ${file}`);
    }
  });

  void copy;
});
