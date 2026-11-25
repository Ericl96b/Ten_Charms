# Status

Current state, unfinished work and known issues. Update this at the end of every task ([AGENTS.md](../AGENTS.md#keeping-the-docs-current)).

**Last updated:** 2026-11-25, at `main` 31046e4, during the multi-agent transition (branch `chore/multi-agent-transition`). That docs-only commit was made without a full gate, with the user's approval, because the Dev Mode word wasn't on the machine. The trademark scan passed, and the unit tests failed only the two tests that need missing private files.

## Shipped (on `main`, deployed)

| Area | Status |
|---|---|
| Map 1, the Rose Garden | Five-stop Journey, Free Play (Sprint, Choose Your Phase), Collection, Charms, Stats, Settings, Backup & Restore, tutorial, Nightshade's boss presentation, offline install |
| Change Request 02 | Gate stages, test inventory, cached parallel simulation. The gate takes about 20 minutes |
| Map 2, the Moonlit Glade | Seven stops, Moonlit Fog, the Thorned Crown, seven new bots plus Lunaria's two wisps |
| Change Request 04 | Moonlit Phases (Finalist A), and Moonlit Trials B and C in Free Play |
| The Tower and the Crossroads | Endless climb, save schema 3, vector tower art, sky bands, Tower music |
| Change Request 05, Dev Mode | A secret link opens every lock on one browser |

*Confirmed* from `git log` and the code. The iOS 26 blank-screen fix is confirmed on the player's iPhone. Nothing else has been confirmed on a device (below).

## Open decisions

- **Tower difficulty.** This needs the user. The spec's win-rate and climb targets can't be reached with the levers it allows ([DECISIONS.md](DECISIONS.md#the-tower-privatetower_specmd-merged-to-main) T10). The shipped ladder (`TOWER_LADDER`, *confirmed* unchanged since the Tower build) makes every ordinary floor a duel:
  - Ordinary floors win 62–83% against targets of 62–92%.
  - Guardian floors win about 31–35% against targets of 47–70%.
  - The median climb ends near floor 10, against a target of 22–35.
  - Full numbers are in `SIMULATION_TOWER.md`.

  The options put to the user were:
  - lower or reshape the targets
  - keep larger tables and accept lower win rates
  - make Guardian floors easier by a rule (no Crown in early tiers, or no heart lost on a Guardian floor)
  - start climbs with more hearts

  *Unverified:* whether the user decided this on another machine.

## Unfinished work

- **The device QA hasn't been run.** That covers `private/QA.md` (Map 1) and the Tower checklist (the private Tower handoff, §8), on the iPhone from a Chrome-installed Home Screen icon and on the Android phone. No Map 2 or Dev Mode device checklist was found on this machine.
- **Nobody has reviewed the sound.** In particular, nobody has listened to the synthesized music, the Glade's tracks or the Tower's layered theme.
- **Portraits are optional.** Letter placeholders are in place ([DESIGN.md](DESIGN.md#portraits)).
- **`private/SPEC.md` §15 is missing the Change Request 02 test-tier text,** which waits in `private/CR02_SPEC_15_UPDATE.md`. The spec on this machine predates Change Request 01, so it wasn't applied.

## Known issues and technical debt

- **Nightshade is barely stronger than Professor Hoot,** at about 52%, against a 60% target. A real fix would have her play out sample futures, which needs bot thinking moved off the main thread (D13, R6).
- **Tall phones show fewer laid-down rows than the tests do.** With real safe-area insets, tall phones show about 2 full rows in a 3-opponent match, not the 3–4 the tests see with zero insets. Showing more would need smaller piles or a smaller hand.
- **The Skip target picker** failed to appear in 2 browser tests once, and it hasn't been reproduced (D38). `TESTING.md` lists this and the other one-off failures.
- **The round-tally medallion bug is likely still live.** It shows a Moonlit phase's raw id, such as "23", for a player who didn't advance. *Unverified on screen:* by code reading, `src/ui/table/moments.ts:347` uses `displayPhase` only when `t.game.phases` is set (Tower floors), so Moonlit and Trial matches still show the raw id.
- **The Tower's tier-change scene has the least performance margin.** It usually reads 32–35 ms, but over 48 targeted repeats it twice went over 50 ms (61 and 64 ms). The cause isn't found (R8).
- **Pre-existing gate failures on machines with `private/`.** These are listed in [TESTING.md](TESTING.md#machine-prerequisites-and-pre-existing-failures). Last seen 2026-11-18, and *not rechecked since*.
- **The 60 fps target isn't verified on a phone.** Desktop WebKit draws in software, so its numbers say little about an iPhone 12.
- **Feel is judged only from screenshots and recordings.** The coverage test proves each animation and sound event fired, not that it looks or sounds good.
- **Stale local branches.** `tower` and `cr02-faster-tests` are fully merged into `main`. They're safe to delete, with the user's approval.

## Unrecoverable or unverified here

The machine this was written on lacks these, and per the user, another machine has them. When they're available, reconcile them into `docs/` and remove this section's matching lines:

- `private/MAP2_SPEC.md`: the Map 2 spec. Without it the spec comparison test fails, and the Map 2 rationale isn't recorded (the M entries in [DECISIONS.md](DECISIONS.md#the-moonlit-glade-and-dev-mode-from-commits-and-code-only)).
- Change Requests 01, 03, 04 and 05. Change Request 01 brought layout 3A, the gear icon and the Android target, judging from commits on 2026-10-31.
- The private decision and progress notes for Map 2, Change Request 04 and Dev Mode. This machine's copies stop at the Tower.
- `private/dev-mode-word.txt`. Without it, or `TC_DEV_WORD`, the gate won't start.
- Whether the Tower difficulty was decided, whether any device QA was done, and whether the pre-existing failures still happen.
