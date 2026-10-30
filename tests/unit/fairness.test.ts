import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BOT_IDS, decide } from '../../src/bots/profiles.ts';
import { createGame, step } from '../../src/engine/game.ts';
import { observe, type Observation } from '../../src/engine/observation.ts';
import { createRng, shuffle } from '../../src/engine/rng.ts';
import type { Card, GameState } from '../../src/engine/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const botDir = join(root, 'src', 'bots');

/** Every module a bot can reach through its value imports, following them all the way down. */
function reachable(start: string, seen = new Set<string>()): Set<string> {
  if (seen.has(start)) return seen;
  seen.add(start);
  const src = readFileSync(start, 'utf8');
  for (const m of src.matchAll(/^(?:import|export) (?!type)[^;]*?from '(\.[^']+)'/gms)) reachable(resolve(dirname(start), m[1]), seen);
  return seen;
}

function midGame(seed: string): GameState {
  const { state } = createGame({ playerCount: 3, seed });
  for (let t = 0; t < 10 && state.stage !== 'roundOver'; t++) {
    if (state.stage === 'draw') assert.ok(step(state, { type: 'draw', source: 'pile' }).ok);
    const hand = state.players[state.current].hand;
    const card = hand.find((c) => c.kind === 'num') ?? hand[0];
    const target = card.kind === 'skip' ? (state.current + 1) % 3 : undefined;
    assert.ok(step(state, { type: 'discard', cardId: card.id, target }).ok);
  }
  return state;
}

function seenIds(obs: Observation): Set<number> {
  const ids = new Set<number>();
  JSON.stringify(obs, (key, value) => {
    if (key === 'id' && typeof value === 'number') ids.add(value);
    return value;
  });
  return ids;
}

describe('fairness', () => {
  test('bot code cannot import the game state, the shuffler, or the seed', () => {
    const modules = [...reachable(join(botDir, 'profiles.ts'))].map((m) => relative(root, m).replaceAll('\\', '/'));
    assert.ok(modules.includes('src/engine/phases.ts'), 'the import scan is working');
    for (const banned of ['src/engine/game.ts', 'src/engine/rng.ts', 'src/engine/observation.ts', 'src/sim/driver.ts']) {
      assert.ok(!modules.includes(banned), `${banned} is reachable from bot code`);
    }
  });

  test('bot source never names the hidden state', () => {
    for (const file of readdirSync(botDir)) {
      const src = readFileSync(join(botDir, file), 'utf8');
      for (const word of ['GameState', 'drawPile', 'discardPile', 'matchSeed', 'roundSeed', 'Math.random', 'localStorage', 'globalThis', 'window']) {
        assert.ok(!src.includes(word), `${file} mentions ${word}`);
      }
    }
  });

  test('an observation holds no hidden card or seed', () => {
    const state = midGame('a1'.repeat(16));
    const obs = observe(state, 1);
    const text = JSON.stringify(obs);
    assert.ok(!text.includes(state.matchSeed));
    assert.ok(!text.includes(state.roundSeed));
    assert.ok(!('drawPile' in obs));
    const ids = seenIds(obs);
    for (const c of state.drawPile) {
      const wasDiscarded = state.history.some((h) => 'card' in h && h.card?.id === c.id);
      assert.ok(wasDiscarded || !ids.has(c.id), 'a draw pile card leaked');
    }
    for (const seat of [0, 2]) {
      for (const c of state.players[seat].hand) {
        const public_ = state.history.some((h) => 'card' in h && h.card?.id === c.id);
        assert.ok(public_ || !ids.has(c.id), 'another hand leaked');
      }
    }
  });

  test('an observation is a copy: changing it cannot touch the game', () => {
    const state = midGame('b2'.repeat(16));
    const before = JSON.stringify(state);
    const obs = observe(state, 0);
    obs.hand.length = 0;
    obs.players[1].cardCount = 99;
    obs.groups.push({ id: 1, owner: 0, type: 'set', cards: [] });
    obs.history.length = 0;
    assert.equal(JSON.stringify(state), before);
  });

  test('rearranging every hidden card changes neither the observation nor any decision', () => {
    for (let trial = 0; trial < 40; trial++) {
      const state = midGame(trial.toString(16).padStart(32, 'c'));
      const seat = state.current;
      if (state.stage === 'draw') assert.ok(step(state, { type: 'draw', source: 'pile' }).ok);
      const before = observe(state, seat);

      // Deal the other hands and the draw pile again from the same hidden cards, and change the seeds.
      const altered: GameState = JSON.parse(JSON.stringify(state));
      const others = altered.players.filter((_, i) => i !== seat);
      const pool: Card[] = [...altered.drawPile, ...others.flatMap((p) => p.hand)];
      shuffle(pool, createRng('d4'.repeat(16), trial));
      for (const p of others) p.hand = pool.splice(0, p.hand.length);
      altered.drawPile = pool;
      altered.matchSeed = 'e5'.repeat(16);
      altered.roundSeed = 'f6'.repeat(16);
      const after = observe(altered, seat);
      assert.deepEqual(after, before);

      for (const id of BOT_IDS) {
        const dice = () => 0.42;
        assert.deepEqual(decide(id, after, dice), decide(id, before, dice), `${id} reacted to hidden state`);
      }
    }
  });

  test('every seat gets its cards from the same shuffle, whatever the bot', () => {
    const a = createGame({ playerCount: 2, seed: '77'.repeat(16) }).state;
    const b = createGame({ playerCount: 2, seed: '77'.repeat(16) }).state;
    assert.deepEqual(a.players.map((p) => p.hand), b.players.map((p) => p.hand));
    // The engine takes no lineup at all, so it has no way to deal by difficulty.
    assert.ok(!readFileSync(join(root, 'src/engine/game.ts'), 'utf8').match(/difficulty|profile|BotId/));
  });
});

describe('original IP', () => {
  const banned = new RegExp(['ph', 'ase[\\s_-]*(1', '0|t', 'en)\\b'].join(''), 'i');
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (['node_modules', '.tools', '.git', 'dist', 'dist-dev', 'test-results', 'qa-screenshots', 'private'].includes(name)) return [];
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }

  test('the trademarked name appears nowhere in the project', () => {
    for (const file of walk(root)) {
      const rel = relative(root, file).replaceAll('\\', '/');
      if (rel === 'package-lock.json' ||/\.(png|woff2|webp|webm|m4a)$/.test(rel)) continue;
      assert.ok(!banned.test(rel), `file name: ${rel}`);
      assert.ok(!banned.test(readFileSync(file, 'utf8')), `content of ${rel}`);
    }
  });
});
