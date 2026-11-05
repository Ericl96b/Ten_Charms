// "Hoot (random discards)": a simulation-only bot for the decision gap (Change Request 03 §3.5).
// It plays exactly as Professor Hoot, except that when Hoot discards a number card it throws a card picked
// uniformly at random from the number cards outside Hoot's best grouping. Once down, every number card is outside it.
// It lives only in the simulation tooling and must never reach the game: a unit test and the production-build
// test both check for it.
import { decide } from '../../src/bots/profiles.ts';
import { evaluate, tally, trackedUnseen, usedCards } from '../../src/bots/analysis.ts';
import type { Observation } from '../../src/engine/observation.ts';
import type { Action, Card } from '../../src/engine/types.ts';

/** A name no game code uses, so the production bundle can be searched for it. */
export const RANDOM_DISCARD_BOT_ID = 'sim-only-hoot-random-discards';

/**
 * `rand` is the shared dice stream Hoot itself uses; `pick` is the variant's own, so its random choices never
 * shift the stream the rest of the table sees.
 */
export function randomDiscardHoot(obs: Observation, rand: () => number, pick: () => number): Action {
  const action = decide('hoot', obs, rand);
  if (action.type !== 'discard') return action;
  const card = obs.hand.find((c) => c.id === action.cardId);
  if (!card || card.kind !== 'num' || obs.ownPhase === null) return action;
  let spare: Card[];
  if (obs.players[obs.seat].laidDown) {
    spare = obs.hand.filter((c) => c.kind === 'num');
  } else {
    const used = usedCards(obs.hand, evaluate(tally(obs.hand), obs.ownPhase, trackedUnseen(obs)).picks);
    spare = obs.hand.filter((c) => c.kind === 'num' && !used.has(c.id));
  }
  if (spare.length === 0) return action;
  return { type: 'discard', cardId: spare[Math.floor(pick() * spare.length)].id };
}
