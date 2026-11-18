// Fairness on Tower floors (TOWER_SPEC.md §10): the draw and lineup are public, the fog hides counts from bots exactly
// as from her, and no bot can read the climb.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ALL_BOT_IDS, decide, type BotId } from '../../src/bots/profiles.ts';
import { createGame, nextRound, step } from '../../src/engine/game.ts';
import { observe } from '../../src/engine/observation.ts';
import { createRng, shuffle } from '../../src/engine/rng.ts';
import type { Card, GameState } from '../../src/engine/types.ts';
import { drawAttempt, floorRules } from '../../src/meta/tower.ts';
import { ok } from './helpers.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const botDir = join(root, 'src', 'bots');

function reachable(start: string, seen = new Set<string>()): Set<string> {
  if (seen.has(start)) return seen;
  seen.add(start);
  const src = readFileSync(start, 'utf8');
  for (const m of src.matchAll(/^(?:import|export) (?!type)[^;]*?from '(\.[^']+)'/gms)) reachable(resolve(dirname(start), m[1]), seen);
  return seen;
}

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const dice = () => 0.41;

/** Positions from real play on drawn floors: Hoot in her seat, the floor's own opponents, stopped at many moments. */
function floorPositions(floors: number[], count: number): GameState[] {
  const out: GameState[] = [];
  for (let m = 0; out.length < count && m < 800; m++) {
    const floor = floors[m % floors.length];
    const seed = (m * 6151 + 17).toString(16).padStart(32, '9');
    const attempt = drawAttempt(seed, floor);
    const lineup: BotId[] = ['hoot', ...attempt.lineup];
    const { state } = createGame({ playerCount: lineup.length, variant: 'tower', phases: attempt.phases, rules: floorRules(floor, attempt), seed });
    const rng = createRng(seed, 3);
    const rand = () => rng.next() / 0x100000000;
    const stopAt = 15 + (m % 11) * 19;
    for (let moves = 0; moves < stopAt && state.stage !== 'matchOver'; moves++) {
      if (state.stage === 'roundOver') { nextRound(state); continue; }
      ok(step(state, decide(lineup[state.current], observe(state, state.current), rand)));
    }
    if (state.stage === 'draw' || state.stage === 'play') out.push(state);
  }
  return out;
}

describe('no bot can read the climb', () => {
  test('bot code cannot reach the Tower, the save or progress', () => {
    const modules = [...reachable(join(botDir, 'profiles.ts'))].map((m) => relative(root, m).replaceAll('\\', '/'));
    assert.ok(modules.includes('src/engine/phases.ts'), 'the import scan is working');
    for (const banned of ['src/meta/tower.ts', 'src/meta/save.ts', 'src/meta/progress.ts']) assert.ok(!modules.includes(banned), `${banned} is reachable`);
  });

  test('bot source never names hearts, floors, climbs or records', () => {
    for (const file of readdirSync(botDir)) {
      const src = readFileSync(join(botDir, file), 'utf8');
      for (const word of [/heart/i, /tower/i, /climb/i, /(?<!Math\.)\bfloor\b/i, /bestFloor/i]) assert.ok(!word.test(src), `${file} mentions ${word}`);
    }
  });

  test('an observation of a floor holds only the public list besides what every match shows', () => {
    const [state] = floorPositions([40], 1);
    const obs = observe(state, 1);
    assert.deepEqual(Object.keys(obs).sort(), ['crownSeat', 'current', 'dealt', 'discardTop', 'drawCount', 'fog', 'groups', 'hand', 'history', 'ownPhase', 'phases', 'playerCount', 'players', 'round', 'seat', 'stage', 'variant']);
    assert.deepEqual(obs.phases, state.phases);
  });
});

describe('fairness on Tower floors', () => {
  // Fogged Guardian floors with a companion are the tables with two other hands to compare, so they come up often.
  const positions = floorPositions([3, 10, 17, 20, 26, 30, 35, 40, 44, 50, 58, 60, 40, 60, 80, 100], 140);

  test('the positions cover mixed lists, fog, both Guardians and players who have laid down', () => {
    assert.ok(positions.length >= 60);
    assert.ok(positions.some((s) => s.phases!.some((p) => p <= 10) && s.phases!.some((p) => p > 10)), 'a mixed Classic and Moonlit floor');
    assert.ok(positions.some((s) => s.rules?.fog && s.rules?.crownName === 'Nightshade'), 'a fogged Nightshade floor');
    assert.ok(positions.some((s) => s.rules?.fog && s.rules?.crownName === 'Lunaria'), 'a fogged Lunaria floor');
    assert.ok(positions.some((s) => s.players.some((p) => p.laidDown)));
  });

  test('rearranging every hidden card changes neither the observation nor any decision', () => {
    positions.forEach((state, trial) => {
      const seat = state.current;
      const before = observe(state, seat);
      const altered = copy(state);
      const others = altered.players.filter((_, i) => i !== seat);
      const pool: Card[] = [...altered.drawPile, ...others.flatMap((p) => p.hand)];
      shuffle(pool, createRng('d4'.repeat(16), trial));
      for (const p of others) p.hand = pool.splice(0, p.hand.length);
      altered.drawPile = pool;
      altered.matchSeed = 'e5'.repeat(16);
      altered.roundSeed = 'f6'.repeat(16);
      const after = observe(altered, seat);
      assert.deepEqual(after, before);
      for (const id of ALL_BOT_IDS) assert.deepEqual(decide(id, after, dice), decide(id, before, dice), `${id} reacted to hidden state`);
    });
  });

  test('under the fog, no count is seen and only-hidden hand sizes change no decision', () => {
    let compared = 0;
    for (const state of positions.filter((s) => s.rules?.fog)) {
      const seat = state.current;
      for (let s = 0; s < state.playerCount; s++) assert.ok(!JSON.stringify(observe(state, s)).includes('cardCount'));
      const others = state.players.map((_, i) => i).filter((s) => s !== seat && state.players[s].hand.length >= 2);
      if (others.length < 2) continue;
      const [a, b] = others;
      const altered = copy(state);
      altered.players[b].hand.push(altered.players[a].hand.pop()!);
      assert.deepEqual(observe(altered, seat), observe(state, seat));
      for (const id of ALL_BOT_IDS) {
        assert.deepEqual(decide(id, observe(altered, seat), dice), decide(id, observe(state, seat), dice), `${id} reacted to a hand size`);
      }
      compared++;
    }
    assert.ok(compared >= 20, `${compared} fogged comparisons`);
  });

  test('every bot evaluates any floor\'s list correctly: no illegal choice from any position', () => {
    for (const state of positions) {
      for (const id of ALL_BOT_IDS) {
        const trial = copy(state);
        const action = decide(id, observe(trial, trial.current), dice);
        const r = step(trial, action);
        assert.ok(r.ok, `${id}: ${JSON.stringify(action)}: ${r.ok ? '' : r.reason}`);
      }
    }
  });
});
