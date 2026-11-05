// The Moonlit Trials (Change Request 03, Part B): Free Play variants that play the approved finalist lists.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decide } from '../../src/bots/profiles.ts';
import { createGame, nextRound, step } from '../../src/engine/game.ts';
import { observe } from '../../src/engine/observation.ts';
import { PHASES, TRIAL_VARIANTS, isMoonlitFamily, isMoonlitPhase, phaseNumber, phaseSequence, phaseText } from '../../src/engine/phases.ts';
import { createRng } from '../../src/engine/rng.ts';
import type { GameEvent, RoundResult, Variant } from '../../src/engine/types.ts';
import { applyEvents, newTracker } from '../../src/meta/progress.ts';
import { defaultSave, exportCode, importCode, migrate, type SavedMatch } from '../../src/meta/save.ts';
import { playMatch } from '../../src/sim/driver.ts';

/** The finalists approved from SIMULATION_MOONLIT_REFINEMENT.md, in finalist order and in their own order. */
const APPROVED: Record<string, string[]> = {
  trialA: ['2 Sets of 3 + Pair', '8 Odds', '8 Evens', 'Set of 4 + 2 Pairs', 'Color run of 4 + 2 Pairs', 'Set of 4 + 4 of one Color', '2 Color runs of 3', 'Color run of 4 + Set of 3', 'Color run of 3 + Set of 4', 'Color run of 5 + Pair'],
  trialB: ['7 Evens', 'Color run of 3 + Set of 3', '6 of one Color', 'Set of 3 + 5 of one Color', 'Color run of 3 + Set of 3 + Pair', '8 Odds', 'Set of 4 + 4 of one Color', 'Color run of 4 + Set of 3', 'Color run of 3 + Set of 4', 'Color run of 5 + Pair'],
  trialC: ['7 Evens', 'Color run of 3 + Set of 3', '6 of one Color', 'Set of 3 + 5 of one Color', 'Color run of 3 + Set of 3 + Pair', '2 Sets of 3 + Pair', '8 Evens', 'Set of 4 + 4 of one Color', 'Color run of 4 + Set of 3', 'Color run of 5 + Pair'],
};

const LIVE = ['Run of 4 + 2 Pairs', '4 Odds + 4 Evens', '4 Pairs', '7 Evens', 'Color run of 3 + Set of 3', 'Set of 4 + 4 of one Color', 'Color run of 4 + Run of 4', 'Color run of 5 + Pair', '3 Sets of 3', 'Color run of 6'];

describe('the trial lists', () => {
  test('each trial plays its approved finalist exactly, in order', () => {
    assert.deepEqual([...TRIAL_VARIANTS], ['trialA', 'trialB', 'trialC']);
    for (const v of TRIAL_VARIANTS) assert.deepEqual(phaseSequence(v).map(phaseText), APPROVED[v], v);
  });

  test('the Moonlit Phases keep the live list', () => {
    assert.deepEqual(phaseSequence('moonlit'), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    assert.deepEqual(phaseSequence('moonlit').map(phaseText), LIVE);
  });

  test('trial phases are Moonlit phases, shown as 1 to 10, and never shared with another list', () => {
    const seen = new Set<number>(phaseSequence('moonlit'));
    for (const v of TRIAL_VARIANTS) {
      const seq = phaseSequence(v);
      assert.deepEqual(seq.map(phaseNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      for (const p of seq) { assert.ok(isMoonlitPhase(p)); assert.ok(!seen.has(p), `${p} is shared`); seen.add(p); }
    }
    for (let p = 1; p <= 10; p++) assert.equal(phaseNumber(p), p, 'classic numbers are unchanged');
    for (let p = 11; p <= 20; p++) assert.equal(phaseNumber(p), p - 10, 'Moonlit numbers are unchanged');
  });

  test('only the Moonlit Phases and the trials are Moonlit-family variants', () => {
    const all: Variant[] = ['standard', 'sprint', 'choose', 'moonlit', 'trialA', 'trialB', 'trialC'];
    assert.deepEqual(all.filter(isMoonlitFamily), ['moonlit', 'trialA', 'trialB', 'trialC']);
  });

  test('every trial phase has requirements', () => {
    for (const v of TRIAL_VARIANTS) for (const p of phaseSequence(v)) assert.ok(PHASES[p]?.length > 0, `${p}`);
  });
});

describe('playing a trial', () => {
  for (const v of TRIAL_VARIANTS) {
    test(`${v}: bot-only matches finish legally, through all ten phases`, () => {
      for (let i = 0; i < 3; i++) {
        const out = playMatch(['hoot', 'briar', 'marigold'].slice(0, 2 + (i % 2)) as never, `${i}${v}`.padEnd(32, '3').replace(/[^0-9a-f]/g, 'b'), v);
        assert.deepEqual(out.illegal, []);
        assert.equal(out.stalled, false);
        const winner = out.state.players[out.winners[0]];
        assert.deepEqual([...winner.completed].sort((a, b) => a - b), phaseSequence(v));
      }
    });
  }

  test('a trial match starts on its own first phase', () => {
    for (const v of TRIAL_VARIANTS) {
      const { state } = createGame({ playerCount: 3, variant: v, seed: 'cd'.repeat(16) });
      assert.ok(state.players.every((p) => p.phase === phaseSequence(v)[0]));
    }
  });

  test('a trial match can be played move by move to the end', () => {
    const { state } = createGame({ playerCount: 2, variant: 'trialB', seed: 'ce'.repeat(16) });
    const rng = createRng('cf'.repeat(16), 1);
    const rand = () => rng.next() / 0x100000000;
    for (let moves = 0; moves < 50000 && state.stage !== 'matchOver'; moves++) {
      if (state.stage === 'roundOver') { nextRound(state); continue; }
      assert.ok(step(state, decide('hoot', observe(state, state.current), rand)).ok);
    }
    assert.equal(state.stage, 'matchOver');
    assert.ok(state.players[state.winners[0]].completed.includes(40));
  });
});

function trialMatch(variant: Variant): SavedMatch {
  const { state } = createGame({ playerCount: 2, variant, seed: 'ab'.repeat(16) });
  return {
    game: JSON.parse(JSON.stringify(state)), lineup: ['pip'], mode: { kind: 'free' }, back: 'honeycomb', cloth: 'buttercream', boss: false,
    ui: { order: state.players[0].hand.map((c) => c.id), sort: 'color', slots: [[], []], roundShown: 1 }, tracker: newTracker(), botTurns: [2],
  } as SavedMatch;
}

const roundEnd = (phase: number): GameEvent => ({ type: 'roundEnd', result: { round: 1, seed: '', wentOut: 0, hands: [[], []], points: [0, 5], phasesBefore: [phase, 21], advanced: [true, false], totals: [0, 5], history: [] } as RoundResult });

describe('trials and the Moonlit Mastery Charm', () => {
  for (const v of TRIAL_VARIANTS) {
    test(`${v}: completing its tenth phase earns Moonlit Mastery, and its ninth doesn't`, () => {
      const s = defaultSave();
      const m = trialMatch(v);
      const seq = phaseSequence(v);
      applyEvents(s, m, [roundEnd(seq[8])]);
      assert.ok(!s.charms.includes('moonlit-mastery'));
      applyEvents(s, m, [roundEnd(seq[9])]);
      assert.ok(s.charms.includes('moonlit-mastery'));
    });
  }

  test('a trial phase never earns it in a match that is not that trial', () => {
    const s = defaultSave();
    applyEvents(s, trialMatch('trialA'), [roundEnd(phaseSequence('trialB')[9])]);
    assert.ok(!s.charms.includes('moonlit-mastery'));
  });
});

describe('saves with a trial match', () => {
  test('a trial match in progress survives migration byte for byte', () => {
    for (const v of TRIAL_VARIANTS) {
      const match = trialMatch(v);
      const save = { ...defaultSave(), match: JSON.parse(JSON.stringify(match)) };
      const after = migrate(JSON.parse(JSON.stringify(save)));
      assert.equal(JSON.stringify(after.match), JSON.stringify(match), v);
      assert.deepEqual(migrate(JSON.parse(JSON.stringify(after))), after);
    }
  });

  test('Backup and Restore round-trip a save holding a trial match, as for any match', () => {
    const save = migrate({ ...defaultSave(), match: trialMatch('trialC') });
    save.stats.played = 7;
    save.charms.push('moonlit-mastery');
    const restored = importCode(exportCode(save))!;
    assert.ok(restored);
    // Backup codes never carry a match in progress, whatever its variant.
    assert.deepEqual(restored, { ...save, match: null });
  });
});
