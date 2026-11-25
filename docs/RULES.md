# Game rules

This describes the rules as the code implements them. It was checked against the code on 2026-11-25 at commit 31046e4. The spec's own rules text (`private/SPEC.md` §3) stays private, and this file paraphrases what the engine does rather than copying it. When this file and the code disagree, the code wins: fix this file.

All rule changes go through `step()` in `src/engine/game.ts`. Group checks are in `src/engine/phases.ts`, and the deck and points in `src/engine/cards.ts`.

## Deck and deal

- **The deck has 108 cards:**
  - numbers 1–12 in four suits, Rose, Moss, Moonstone and Honey, with two copies of each (96 cards)
  - 8 Wilds
  - 4 Skips

  `createDeck`.
- **Shuffles** use ChaCha20 seeded from `crypto.getRandomValues`. Each round's seed comes from the match seed, so any round can be replayed (`src/engine/rng.ts`).
- **Deal.** A match has 2 to 6 players. Seat 0 is the human, and seats run clockwise. Each player is dealt 10 cards. The next card starts the discard pile.
- **Turn order.** The dealer moves one seat each round, and the player after the dealer goes first. If the first discard is a Skip, that first player is skipped.

## A turn

1. **Draw** one card from the draw pile, or take the top discard. A Skip on the discard pile can't be picked up.
2. **Lay down** the current phase, once per round, with every group at once. Each group needs at least one number card. Skips can't be in a group.
3. **Hit.** Once your own phase is down, you may add cards to any laid-down group.
4. **Discard** one card. A discarded Skip makes you choose a target: any other player who isn't already due to be skipped. You can't skip yourself. If no one is eligible, the Skip is discarded with no effect.

You go out by playing your last card, as a discard or as a hit. That ends the round.

## Groups

| Group | Rule |
|---|---|
| Set | Cards of the same number |
| Pair | A Set of 2. Only the label differs (`GroupReq.pair`) |
| Run | Consecutive numbers, any suits, within 1–12. Runs don't wrap past 12 |
| Color | Cards of one suit, any numbers |
| Color run | Consecutive numbers in one suit |
| Evens or Odds | Cards that are all even, or all odd |

Wilds stand in for any card. A slot takes exactly the group's required count (D5).

## Phase lists

Phase ids live in `PHASES` in `src/engine/phases.ts`. Players see each list numbered from 1, built from the number at runtime (`phaseNumber` and `displayPhase`).

| Variant | Ids | Notes |
|---|---|---|
| Standard (the Journey and Free Play) | 1–10 | The classic list, in order |
| Sprint | 1, 3, 5, 7, 9 | Free Play |
| Choose Your Phase | any of 1–10 | At each round's start, every player picks any phase they haven't completed |
| Moonlit Phases | 21–30 | The Moonlit Glade's list since Change Request 04 ("Finalist A" in `SIMULATION_MOONLIT_REFINEMENT.md`) |
| Moonlit Trials B and C | 31–40, 41–50 | Free Play only. They play like the Moonlit Phases |
| Retired Moonlit list | 11–20 | Only a match already under way at the Change Request 04 update still plays it (`matchPhases`) |
| Tower floor | 3 of the 25-phase `TOWER_POOL` | Numbered 1–3 on the floor |

## Scoring and winning

- **Points.** At round end, the cards left in each hand score: 1–9 are 5 points, 10–12 are 10, a Skip is 15 and a Wild is 25. Every player who laid down moves past that phase.
- **Winning.** When a round ends with at least one player having completed their whole list, the finisher with the lowest total wins. If finishers tie and the player who went out is one of them, that player wins. Otherwise it's a shared win.
- **Map 1 stars.** A Journey win scores 3 stars in 12 rounds or fewer, 2 stars in 14 or fewer, and 1 star otherwise (`starsFor`). Each Glade stop has its own limits (`GLADE_STOPS[].stars`).

## Edge cases

- **Empty draw pile.** The discard pile, except its top card, is reshuffled into a new draw pile. If there's still nothing to draw and the top discard can't be taken, the player skips the draw step (D7).
- **Stalemate.** After 3 reshuffles in a row with no lay-down or hit, no one can go out, so the round ends with every hand scored (`STALEMATE_RESHUFFLES`).
- **Skip as the last card.** The round ends at once, with no target chosen (D8).
- **Wilds in a new run.** They fill gaps first, then extend the run upward, then downward once it reaches 12 (D6). "Runs can't go past 12" is the reason shown when a run would wrap (D10).
- **Wild hits on a run.** A Wild goes on the end nearest the tap or drop, if that end has room. The Hit button tries the high end first (D17).
- **Slots across turns.** Cards left in a slot stay across turns and clear at the end of the round (D16).

## The Moonlit Glade (Map 2)

The Glade opens once Stop 5 (Nightshade) is won. Its seven stops, their lineups and star limits are in `GLADE_STOPS` in `src/content.ts`, and the stops branch: Lantern Lane and Lily Pond both open after the first stop.

- **Moonlit Fog.** No one, human or bot, sees anyone else's card count. It covers Glade campaign matches until Lady Lunaria (the last stop) is beaten, which lifts it for good (`gladeFogged`).
- **The Thorned Crown.** Wherever Lunaria plays, only she may add to her own laid-down groups (`MatchRules.crownSeat`).
- **The Crossroads,** and with it the Tower, opens once Lunaria is beaten (`crossroadsOpen`).

*Unverified:* the Map 2 spec (`MAP2_SPEC.md`) isn't on the machine where this was written, so this section comes from the code alone.

## The Tower

The Tower is an endless climb, with its logic in `src/meta/tower.ts` and the ladder in `TOWER_LADDER` in `src/content.ts`.

- **Floors.** Each floor is a match on 3 different phases, drawn from `TOWER_POOL` and sorted easiest first by `TOWER_ORDER`. The whole table plays the same list, and it's shown before the match.
- **Tiers.** Each tier is 10 floors. Every 10th floor is a Guardian floor: Nightshade on odd tiers, Lunaria on even tiers. The Guardian wears the Thorned Crown. Fog depends on the tier.
- **Hearts.** A climb starts with 3 hearts. Losing a floor costs one, and the next try draws a new floor. Winning a Guardian floor gives one back, up to 3. The climb ends at 0 hearts, or when the player ends it. The best floor is kept.
- **Shared wins.** A shared win that includes the player counts as winning the floor.
- **Restores.** Backup codes carry the Tower, but restoring one redraws the current floor.

*Confirmed from the code.* For the tuned ladder and the targets it misses, see [STATUS.md](STATUS.md#open-decisions).

## Bots

- **What bots see.** Bots see only `observe()` (`src/engine/observation.ts`): no hidden hands, no draw-pile order, and no card counts under the fog. They keep no memory between moves, so what they "remember" is the public history (D14).
- **Profiles.** Each bot's behavior is in `src/bots/profiles.ts`.
- **Tests.** `tests/unit/fairness.test.ts` and `tests/unit/tower-fairness.test.ts` enforce all of this.
