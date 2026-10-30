import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOT_IDS, type BotId } from '../../src/bots/profiles.ts';
import { createRng } from '../../src/engine/rng.ts';
import type { Variant } from '../../src/engine/types.ts';
import { playMatch } from '../../src/sim/driver.ts';

test('bot-only matches at every size finish legally in every variant', () => {
  const rng = createRng('5a'.repeat(16));
  for (const variant of ['standard', 'sprint', 'choose'] as Variant[]) {
    for (let players = 2; players <= 6; players++) {
      for (let i = 0; i < 12; i++) {
        const lineup: BotId[] = Array.from({ length: players }, () => BOT_IDS[rng.below(5)]);
        const out = playMatch(lineup, rng.next().toString(16).padStart(32, '0'), variant);
        assert.deepEqual(out.illegal, []);
        assert.equal(out.stalled, false);
        assert.ok(out.winners.length >= 1);
      }
    }
  }
});
