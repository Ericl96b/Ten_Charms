// Moonlit Fog, the Thorned Crown and Lunaria's wisps. Bots are exactly as blind as the human.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ALL_BOT_IDS, decide, type BotId } from '../../src/bots/profiles.ts';
import { createGame, eligibleSkipTargets, nextRound, step } from '../../src/engine/game.ts';
import { observe } from '../../src/engine/observation.ts';
import { createRng } from '../../src/engine/rng.ts';
import type { GameState, HistoryEntry, MatchRules } from '../../src/engine/types.ts';
import { playMatch } from '../../src/sim/driver.ts';
import { n, ok, table } from './helpers.ts';

const FOG: MatchRules = { fog: true, crownSeat: 2, crownName: 'Lunaria' };
const BOSS: BotId[] = ['hoot', 'puff', 'lunaria', 'haze'];

/** Fogged positions from real play: Hoot-level bots at a boss table, stopped at many different moments. */
function foggedPositions(count: number): GameState[] {
  const out: GameState[] = [];
  for (let m = 0; out.length < count && m < 200; m++) {
    const seed = (m * 7919).toString(16).padStart(32, 'f');
    const { state } = createGame({ playerCount: 4, variant: 'moonlit', seed, rules: FOG });
    const rng = createRng(seed, 3);
    const rand = () => rng.next() / 0x100000000;
    const stopAt = 20 + (m % 9) * 23;
    for (let moves = 0; moves < stopAt && state.stage !== 'matchOver'; moves++) {
      if (state.stage === 'roundOver') { nextRound(state); continue; }
      ok(step(state, decide(BOSS[state.current], observe(state, state.current), rand)));
    }
    if (state.stage === 'draw' || state.stage === 'play') out.push(state);
  }
  return out;
}

const positions = foggedPositions(60);
const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const dice = () => 0.37;

describe('Moonlit Fog', () => {
  test('the test positions cover players who have laid down', () => {
    assert.ok(positions.length >= 40);
    assert.ok(positions.some((s) => s.players.some((p) => p.laidDown)));
  });

  test('a fogged observation holds no card count, not even the bot\'s own', () => {
    for (const state of positions) {
      for (let seat = 0; seat < 4; seat++) {
        const obs = observe(state, seat);
        assert.ok(!JSON.stringify(obs).includes('cardCount'));
        assert.equal(obs.fog, true);
        assert.equal(obs.crownSeat, 2);
      }
    }
  });

  test('without fog, observations show counts as they always have', () => {
    const { state } = createGame({ playerCount: 3, seed: 'ab'.repeat(16) });
    const obs = observe(state, 1);
    assert.equal(obs.players[0].cardCount, 10);
    assert.ok(!('fog' in obs));
    assert.ok(!('crownSeat' in obs));
  });

  test('every bot decides the same when only hidden hand sizes differ', () => {
    let compared = 0;
    for (const state of positions) {
      const seat = state.current;
      const others = [0, 1, 2, 3].filter((s) => s !== seat);
      const [a, b] = others.filter((s) => state.players[s].hand.length >= 2);
      if (a === undefined || b === undefined) continue;
      // Move a hidden card from one hand to another. The draw pile and history are untouched, so no public fact changes.
      const altered = copy(state);
      altered.players[b].hand.push(altered.players[a].hand.pop()!);
      assert.notEqual(altered.players[a].hand.length, state.players[a].hand.length);
      assert.deepEqual(observe(altered, seat), observe(state, seat));
      for (const id of ALL_BOT_IDS) {
        assert.deepEqual(decide(id, observe(altered, seat), dice), decide(id, observe(state, seat), dice), `${id} reacted to a hand size`);
      }
      compared++;
    }
    assert.ok(compared >= 30);
  });

  test('no bot rebuilds hand sizes from the history', () => {
    // Each extra pass with no card would mean one more card in that player's hand to anyone counting draws.
    // Nothing a bot may use reads them, so a bot that counts would be the only one to change its mind.
    let compared = 0;
    for (const state of positions) {
      const seat = state.current;
      const hasOwnDiscard = state.history.some((h) => h.kind === 'discard' && h.seat === seat);
      const passAfter = state.history.slice(1).some((h) => h.kind === 'pass');
      if (!hasOwnDiscard || !passAfter) continue;
      const padded = copy(state);
      const extra: HistoryEntry[] = [];
      for (const s of [0, 1, 2, 3]) if (s !== seat) for (let k = 0; k < 2 + s; k++) extra.push({ kind: 'pass', seat: s, card: null });
      padded.history.splice(1, 0, ...extra);
      for (const id of ALL_BOT_IDS) {
        assert.deepEqual(decide(id, observe(padded, seat), dice), decide(id, observe(state, seat), dice), `${id} counted draws`);
      }
      compared++;
    }
    assert.ok(compared >= 20);
  });

  test('the fog rules still let every bot play legal, finished matches', () => {
    for (const lineup of [['hoot', 'lumi', 'briar'], ['hoot', 'mallow', 'lumi', 'marigold'], ['hoot', 'velvet', 'mallow', 'briar'], ['hoot', 'fennel', 'lumi', 'marigold'], ['hoot', 'sable', 'fennel', 'briar'], ['hoot', 'mossback', 'velvet', 'sable'], BOSS] as BotId[][]) {
      for (let i = 0; i < 2; i++) {
        const crown = lineup.indexOf('lunaria');
        const out = playMatch(lineup, `${i}`.padStart(32, 'c'), 'moonlit', { fog: true, ...(crown >= 0 ? { crownSeat: crown, crownName: 'Lunaria' } : {}) });
        assert.deepEqual(out.illegal, [], lineup.join());
        assert.equal(out.stalled, false, lineup.join());
      }
    }
  });
});

describe('the Thorned Crown', () => {
  function crowned() {
    const state = table(3, [[n(5), n(9)], [n(5, 'moss'), n(9, 'moss')], [n(5, 'honey'), n(2)]], { stage: 'play', rules: { crownSeat: 2, crownName: 'Lunaria' } });
    state.players.forEach((p) => { p.laidDown = true; });
    state.groups = [
      { id: 1, owner: 2, type: 'set', num: 5, cards: [{ card: n(5), num: 5 }] },
      { id: 2, owner: 1, type: 'set', num: 5, cards: [{ card: n(5), num: 5 }] },
    ];
    return state;
  }

  test("no one else may add to Lunaria's groups, with the exact reason", () => {
    const state = crowned();
    const r = step(state, { type: 'hit', cardId: state.players[0].hand[0].id, groupId: 1 });
    assert.deepEqual(r, { ok: false, reason: "No one can add to Lunaria's groups." });
    ok(step(state, { type: 'hit', cardId: state.players[0].hand[0].id, groupId: 2 }));
  });

  test('Lunaria may add to her own groups and to anyone else\'s', () => {
    const state = crowned();
    state.current = 2;
    ok(step(state, { type: 'hit', cardId: state.players[2].hand[0].id, groupId: 1 }));
    state.players[2].hand.push(n(5, 'rose'));
    ok(step(state, { type: 'hit', cardId: state.players[2].hand[1].id, groupId: 2 }));
  });

  test('without the crown, anyone hits anything, as before', () => {
    const state = crowned();
    delete state.rules;
    ok(step(state, { type: 'hit', cardId: state.players[0].hand[0].id, groupId: 1 }));
  });

  test('in Free Play the crown follows Lunaria to whatever seat she has', () => {
    for (let i = 0; i < 3; i++) {
      const out = playMatch(['nightshade', 'lunaria', 'briar'], `${i}`.padStart(32, 'd'), 'standard', { crownSeat: 1, crownName: 'Lunaria' });
      assert.deepEqual(out.illegal, []);
    }
  });
});

describe("Lunaria's wisps", () => {
  test('they never go out before Lunaria lays down, and only skip her when nothing else is allowed', () => {
    let wispOuts = 0;
    let skipsByWisps = 0;
    for (let m = 0; m < 40; m++) {
      const seed = (m * 104729).toString(16).padStart(32, 'e');
      const { state } = createGame({ playerCount: 4, variant: 'moonlit', seed, rules: FOG });
      const rng = createRng(seed, 5);
      const rand = () => rng.next() / 0x100000000;
      for (let moves = 0; moves < 30000 && state.stage !== 'matchOver'; moves++) {
        if (state.stage === 'roundOver') { nextRound(state); continue; }
        const seat = state.current;
        const queenDown = state.players[2].laidDown;
        const action = decide(BOSS[seat], observe(state, seat), rand);
        const others = eligibleSkipTargets(state, seat).filter((s) => s !== 2);
        const res = ok(step(state, action));
        if (seat !== 1 && seat !== 3) continue;
        for (const e of res.events) {
          if (e.type === 'goOut' && e.seat === seat) {
            wispOuts++;
            assert.ok(queenDown || state.players[2].laidDown, 'a wisp went out before Lunaria laid down');
          }
          if (e.type === 'skipPlayed' && e.seat === seat) {
            skipsByWisps++;
            if (e.target === 2) assert.equal(others.length, 0, 'a wisp skipped Lunaria with someone else to skip');
          }
        }
      }
    }
    assert.ok(skipsByWisps > 0, 'the wisps played some Skips');
    void wispOuts;
  });

  test('a wisp with a Skip targets the human whenever she can be skipped', () => {
    const state = table(4, [[n(1), n(2)], [{ id: 900, kind: 'skip' }, n(7), n(8)], [n(3), n(4)], [n(5), n(6)]], { stage: 'play', current: 1, rules: FOG });
    for (const id of ['puff', 'haze'] as BotId[]) {
      const action = decide(id, observe(state, 1), dice);
      assert.equal(action.type, 'discard');
      if (action.type === 'discard') {
        assert.equal(action.cardId, 900);
        assert.equal(action.target, 0);
      }
    }
  });

  test('with the human already skipped, a wisp holds its Skip', () => {
    const state = table(4, [[n(1), n(2)], [{ id: 900, kind: 'skip' }, n(7), n(8)], [n(3), n(4)], [n(5), n(6)]], { stage: 'play', current: 1, rules: FOG });
    state.players[0].pendingSkip = true;
    const action = decide('puff', observe(state, 1), dice);
    assert.ok(action.type === 'discard' && action.cardId !== 900);
  });

  test('forced to throw a Skip with the human already skipped, a wisp skips the other wisp', () => {
    const state = table(4, [[n(1), n(2)], [{ id: 900, kind: 'skip' }, { id: 901, kind: 'skip' }], [n(3), n(4)], [n(5), n(6)]], { stage: 'play', current: 1, rules: FOG });
    state.players[0].pendingSkip = true;
    const action = decide('puff', observe(state, 1), dice);
    assert.ok(action.type === 'discard' && action.target === 3);
  });
});
