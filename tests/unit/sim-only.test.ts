// Simulation-only code never reaches the game (Change Request 03 §3.5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { RANDOM_DISCARD_BOT_ID, randomDiscardHoot } from '../../scripts/refine/random-discard-bot.ts';
import { createGame, step } from '../../src/engine/game.ts';
import { observe } from '../../src/engine/observation.ts';
import { createRng } from '../../src/engine/rng.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function gameBundle(): Promise<{ inputs: string[]; text: string }> {
  const out = await build({
    absWorkingDir: root,
    entryPoints: ['src/main.ts'],
    bundle: true, write: false, metafile: true, format: 'esm', outfile: 'unused.js', logLevel: 'silent',
    define: { __DEV__: 'false', __PORTRAITS__: '{}', __AUDIO_FILES__: '[]' },
  });
  return { inputs: Object.keys(out.metafile.inputs), text: out.outputFiles[0].text };
}

test('the game bundle imports nothing from the simulation tooling', async () => {
  const { inputs, text } = await gameBundle();
  assert.ok(inputs.some((f) => f.startsWith('src/')), 'the bundle was built from src');
  assert.deepEqual(inputs.filter((f) => f.startsWith('scripts/')), []);
  assert.ok(!text.includes(RANDOM_DISCARD_BOT_ID), 'the random-discard variant is not in the game');
});

test('the random-discard variant only ever changes a discard', () => {
  const { state } = createGame({ playerCount: 4, variant: 'moonlit', seed: '9c'.repeat(16) });
  const dice = createRng('3d'.repeat(16), 1);
  const own = createRng('4e'.repeat(16), 2);
  const rand = () => dice.next() / 0x100000000;
  const pick = () => own.next() / 0x100000000;
  let changed = 0;
  for (let moves = 0; moves < 3000 && (state.stage === 'draw' || state.stage === 'play'); moves++) {
    const obs = observe(state, state.current);
    const action = randomDiscardHoot(obs, rand, pick);
    if (action.type === 'discard') {
      const card = obs.hand.find((c) => c.id === action.cardId)!;
      assert.ok(card, 'it discards a card it holds');
      changed++;
    }
    const r = step(state, action);
    assert.ok(r.ok, r.ok ? '' : r.reason);
  }
  assert.ok(changed > 0);
});
