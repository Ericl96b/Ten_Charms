// Map 1 must play exactly as it always has. These hashes were recorded before any Map 2 code existed:
// the same seeds must always produce the same moves, rounds and results from the same bots.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { decide, type BotId } from '../../src/bots/profiles.ts';
import { createGame, nextRound, step } from '../../src/engine/game.ts';
import { observe } from '../../src/engine/observation.ts';
import { createRng } from '../../src/engine/rng.ts';
import type { Variant } from '../../src/engine/types.ts';

function replay(lineup: BotId[], seed: string, variant: Variant): string {
  const { state } = createGame({ playerCount: lineup.length, variant, seed });
  const botRng = createRng(seed, 0x626f74);
  const rand = () => botRng.next() / 0x100000000;
  const hash = createHash('sha256');
  for (let moves = 0; moves < 40000 && state.stage !== 'matchOver'; moves++) {
    if (state.stage === 'roundOver') {
      hash.update(JSON.stringify(state.lastRound!.points));
      nextRound(state);
      continue;
    }
    const seat = state.stage === 'choose' ? state.players.findIndex((p) => p.phase === null) : state.current;
    const action = decide(lineup[seat], observe(state, seat), rand);
    hash.update(JSON.stringify(action));
    const result = step(state, action);
    assert.ok(result.ok, `illegal move: ${JSON.stringify(action)}`);
    hash.update(JSON.stringify(result.events.map((e) => e.type)));
  }
  hash.update(JSON.stringify({ round: state.round, winners: state.winners, scores: state.players.map((p) => p.score) }));
  return hash.digest('hex').slice(0, 16);
}

const CASES: [string, BotId[], Variant, string][] = [
  ['Stop 1', ['hoot', 'pip'], 'standard', '72489283351c38c2'],
  ['Stop 2', ['hoot', 'marigold', 'pip'], 'standard', '4de8b1cc3672b5ce'],
  ['Stop 3', ['hoot', 'briar', 'marigold', 'pip'], 'standard', '567890d9d6898f46'],
  ['Stop 4', ['hoot', 'hoot', 'briar', 'marigold'], 'standard', '9c0eed9b0a5cdc33'],
  ['Stop 5', ['hoot', 'nightshade'], 'standard', '5776b13ee84a253f'],
  ['six players', ['nightshade', 'hoot', 'briar', 'marigold', 'pip', 'hoot'], 'standard', '58aa95cdf1f9d1f1'],
  ['sprint', ['nightshade', 'briar', 'pip'], 'sprint', 'e5474686e26fe386'],
  ['choose', ['hoot', 'marigold', 'nightshade', 'briar'], 'choose', '3693f235d7ca69a6'],
];

describe('classic play never changes', () => {
  for (const [name, lineup, variant, expected] of CASES) {
    test(name, () => {
      const seed = createHash('sha256').update(name).digest('hex').slice(0, 32);
      assert.equal(replay(lineup, seed, variant), expected);
    });
  }
});
