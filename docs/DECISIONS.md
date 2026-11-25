# Decisions

Each entry says what was unclear, what was chosen and why, and where to change it. Entries are append-only: to change one, add a new entry that names the one it supersedes.

**Sources.**
- D1–D41 and T1–T23 are sanitized from the private decision log, last edited 2026-11-18, with their reasoning kept. Personal details are left out.
- The Map 2 and Dev Mode entries (M and V) come only from commit messages, `TESTING.md` and the code. Their original rationale (`MAP2_SPEC.md`, Change Requests 01, 03, 04 and 05) wasn't available when this file was written, so treat them as *what was done*, not *why*.
- "Confirmed" means the pointer was checked against the code on 2026-11-25.

## Tooling

- **D1. Portable Node.** No Node was installed on the build machine, so a checksum-verified portable Node LTS went into `.tools/node` (gitignored). *Change:* install Node 24+ normally and delete `.tools/`.
- **D2. No framework.** Plain TypeScript and the DOM, bundled by esbuild, with no runtime dependencies. It keeps the download small (about 0.4 MB) and gives direct control over animation. *Change:* structural.
- **D3. Browser tests on Windows WebKit.** It's the closest automated match to iOS Safari available, but it isn't iOS. *Change:* run `npm run test:e2e` on a Mac for a closer match. The device checklist covers the rest.
- **D4. No service worker in dev builds.** Only production builds register one, so test runs never pick up stale caches. Offline and update behavior are tested against the production build. *Change:* `boot()` in `src/main.ts`.

## Rules

- **D5. Group size.** A slot takes exactly the required count, and extra cards go on afterward by hitting. It gives the same result with simpler slots. *Change:* `checkGroup` in `src/engine/phases.ts`.
- **D6. Wilds at the ends of a new run.** Gaps fill first, then the run extends upward, then downward at 12. *Change:* `runPlacement` in `src/engine/phases.ts`.
- **D7. Nothing to draw.** If the draw pile is empty after a reshuffle and the top discard can't be taken (rare), the player skips the draw step rather than the game stalling. *Change:* `prepareDraw` in `src/engine/game.ts`.
- **D8. Going out on a Skip.** If a Skip is the last card, the round ends at once, so no target is chosen. *Change:* the `discard` case in `src/engine/game.ts`.
- **D9. Stage labels.** Labels such as "Phase N" are built from the number at runtime, so no file holds the trademarked name, and a test enforces that. *Change:* none. It's a requirement.
- **D10. "Runs can't go past 12."** A run can always slide to fit, so this reason appears only when a play would wrap past 12. *Change:* `runPlacement` and `checkHit` in `src/engine/phases.ts`.

## Bots

- **D11. Trading loops.** Two bots could swap the same cards forever through the discard pile. After a couple of laps with no draw from the draw pile, bots go back to the draw pile. *Change:* `tradingLoop` in `src/bots/profiles.ts`.
- **D12. Nightshade's delay.** Delaying to deny hit targets lowered her win rate, so she only does it with under 20 points in hand. *Change:* `DENY_POINT_LIMIT` in `src/bots/profiles.ts`.
- **D13. Nightshade's ladder target.** She beats Professor Hoot about 52–53% of the time, not the 60% target, after several tuning passes (`SIMULATION.md`). The best version was kept. A stronger method is rejected for now (R6).
- **D14. Stateless bots.** Bots remember nothing between moves, and Hoot's "memory" is the public history in each observation. This makes save and resume exact. *Change:* structural.

## Interface

- **D15. No Undo button.** Tapping a slot with nothing selected returns its cards. *Change:* `onSlotTap` in `src/ui/table/table.ts`.
- **D16. Slot contents across turns.** Cards left in a slot stay there across turns, and they clear at the end of the round. *Change:* `commit` in `src/ui/table/table.ts`.
- **D17. Wild on a run.** It goes on the end nearest the tap or drop, if that end has room. The Hit button tries the high end first. *Change:* `hitOn` in `src/ui/table/table.ts`.
- **D18. The primary button before drawing** reads "Lay down Phase N" but is inactive, and tapping it explains that the player must draw first. *Change:* `renderActions` in `src/ui/table/table.ts`.
- **D19. More than three opponents.** Free Play allows five. Extra seats continue clockwise, and the opponent row scrolls sideways. *Change:* `.crowded` in `src/ui/styles/table.css`.
- **D20. Overlapped cards.** With 11 cards, each card's visible strip is about 30 points wide, under the 44-point minimum. That's inherent to a fan. Taps land on the card that's visible. *Change:* `fanMetrics` in `src/ui/table/table.ts`.
- **D21. Boss presentation.** Only Stop 5 gets Nightshade's intro, moths and Midnight Garden. In Free Play she's an ordinary opponent. *Change:* `startFromMode` in `src/ui/screens/journey.ts`.
- **D22. Unlock timing.** Unlocks and Charms are worked out when the match ends, including for a saved match that had already finished when the app closed. *Change:* `finishMatch` in `src/meta/progress.ts`.
- **D23. Replay tutorial** resets the tips, which then show at the next match with Pip. *Change:* `src/ui/screens/howto.ts`.
- **D24. Bot file names.** Professor Hoot's portrait files start with `hoot`. *Change:* `NAME` in `scripts/portraits.mjs` and the bot's `id` in `src/content.ts`.
- **D25. Backup codes leave out the match in progress.** They hold progress, unlocks, stats and settings. *Change:* `exportCode` in `src/meta/save.ts`.

## Audio

- **D26. Mixed sources.** Seven card sounds are recorded: Kenney Casino Audio, CC0, converted to AAC (`.m4a`) because iOS Safari can't rely on Ogg. That pack has no chimes or music, so every other effect and all the music are synthesized in code, as the spec's fallback allows. *Change:* drop files in `assets/audio/` ([DESIGN.md](DESIGN.md#sound)).

## Testing

- **D27. Arranged reshuffle.** Two-player matches almost never reshuffle naturally, so the full-match test moves most of the draw pile into the discard pile partway through, then lets the real reshuffle happen. *Change:* test 2 in `tests/e2e/02-table.spec.ts`.
- **D28. Performance measurement.** WebKit has no long-task API, so tests measure the longest gap in a main-thread message loop. It's a stand-in for a real trace. *Change:* `startProbe` in `tests/e2e/04-juice.spec.ts`.
- **D29. Drag tests use a mouse pointer.** Playwright has no touch-drag gesture, and mouse-type pointer events share the touch code path. Taps use real touch input. Real finger drags are on the device checklist.
- **D30. Automated WebKit can be newer than iOS.** WebKit 27.2 passed every test while iOS 26.6.2 showed a blank screen, caused by a bad element name (`div#screens`). A browser test now applies strict element names, and a startup failure shows a message instead of a blank screen. *Change:* `tests/e2e/01-shell.spec.ts` and `public/index.html`.

## Change Request 02: faster testing (merged to `main`)

- **D31. No fast clock.** The existing `setTestScale` hook already scales bot waits in the slowest tests. A fast clock would save about 25 seconds a gate. The user approved this, which dropped two of the change request's acceptance checks. See R1.
- **D32. Gate stages.** There's one Playwright run per stage, so project names and titles don't change: parallel, serial, alone, last. The coverage check runs after the performance tests because it reads their event logs. *Change:* `tests/e2e/stages.ts` and `scripts/gate.mjs`.
- **D33. 4 workers.** With 1, 2, 3 and 4 workers the parallel stage took 29.8, 14.8, 10.2 and 8.0 minutes. See R2 for 6 workers. *Change:* `DEFAULT_WORKERS`, or set `TC_WORKERS`.
- **D34. Some tests run serially.** The full match and the choose-and-sprint test sit close to their time limits under load. By the user's decision, timeouts count as tolerances, so they weren't widened. Instead those tests run one at a time. *Change:* `SERIAL` in `tests/e2e/stages.ts`.
- **D35. The performance probe's own timer was removed.** It read 46–49 ms on an idle page on Windows WebKit, leaving no margin under 50 ms. The user approved removing it. The 50 ms limit, and the check that the probe can see a 120 ms task, are unchanged.
- **D36. Image wobble was fixed at its source.** Chromium could keep a layer rendered from a looping animation. Captures now stop loops first, so the approved tolerance increase was never needed, and the tolerance stayed at 8. *Change:* `shot` in `tests/e2e/06-visual.spec.ts`.
- **D37. Other flaky causes fixed:**
  - the boss-intro capture timing
  - the tutorial's random first tip
  - a fanned card tapped mid-move (`pointOn` in `tests/e2e/helpers.ts`)
  - Android tests using a real audio device
- **D38. The Skip target picker wasn't fixed.** It failed to appear in 2 tests once and not in 16 repeats under load. The cause isn't confirmed ([STATUS.md](STATUS.md#known-issues-and-technical-debt)).
- **D39. The simulation runs in the gate** at 2000/2000 sample sizes, with results byte-identical to the old runner. The cache key comes from esbuild's list of what the simulation really imports. *Change:* `scripts/simulate.ts`.
- **D40. Real-speed match.** It runs at 440×956 only, using `testIgnore` so no new skips appear in the inventory. *Change:* `tests/e2e/10-real-speed.spec.ts`.
- **D41. Commits grouped under one gate.** Several commits shared one gate, and the docs-only changes after the last gates got only the project scan test. The change request asked for a gate per commit. That's recorded here as a deviation, not a precedent.

## The Tower (`private/TOWER_SPEC.md`, merged to `main`)

The Tower was built unattended after the user approved the plan on 2026-11-18.

- **T1. The code is the source of truth for missing documents.** `MAP2_SPEC.md` and Change Requests 01, 03 and 04 weren't on the build machine, so, on the user's instruction, the code stood in wherever the Tower spec referred to them. This still applies ([STATUS.md](STATUS.md#unrecoverable-or-unverified-here)).
- **T2. The spec comparison test was left failing.** `tests/unit/assets.test.ts` "uses the exact lines from the spec" fails where `private/SPEC.md` exists without `MAP2_SPEC.md`. It was left unedited and treated as a known failure caused by the environment.
- **T3. Fixtures.** `tests/fixtures/pre-tower/` was recorded once, from the unchanged dev build. Never regenerate it.
- **T4. Save schema 3.** The migration only adds `tower`. The one-time `ten-charms.save.pre-tower` copy mirrors `pre-map2`. *Change:* `src/meta/save.ts`.
- **T5. Backup codes carry the Tower,** but clear the current floor's attempt, so a restored climb redraws that floor.
- **T6. A test was rewritten.** `tests/unit/moonlit-swap.test.ts` now sets aside only the new `schema` and `tower` fields, and checks those two exactly on their own.
- **T7. Pre-existing failures were accepted by rule.** During the build, a gate counted as passing when its only failures were on a fixed list that also failed on the untouched branch ([TESTING.md](TESTING.md#machine-prerequisites-and-pre-existing-failures)). None of those tests was edited.
- **T8. Gates ran in a second checkout:** a git worktree sharing `node_modules`, `private/` and the image baseline, while work continued in the main checkout.
- **T9. Commits.** The phases share modules, so the branch has four gated commits: Phase 1, Phases 2–4, Phases 5–6, and Phase 7.
- **T10. Difficulty targets were out of reach.** Three-phase floors compress skill: even Pip beats Hoot's profile on about 21% of floors, and a crowned Guardian wins about two-thirds of the time. Using every allowed lever, the closest ladder was applied and reported, and no profile, rule, heart count or phase count changed. The opponent lever took every tier down to one opponent. This is still an open decision ([STATUS.md](STATUS.md#open-decisions)).
- **T11. Noise rule for tuning.** A tuning step is kept only when it brings a rate more than 0.5 points closer to its target. See R5. *Change:* `scripts/simulate-tower.ts`.
- **T12. Bot strength for the pool lever** is measured on Tower floors themselves, with 1,000 random three-phase floors per bot against Hoot.
- **T13. A shared win that includes the player counts as winning the floor,** in the game and in the simulation.
- **T14. No defeat moments in the Tower.** Nightshade's and Lunaria's defeat moments carry map-story beats, so a Guardian floor goes straight to the floor result screen, and the player's own tablecloth stays on.
- **T15. First climb.** With no earlier best, the run-over screen shows no "Old best" pill, and "—" for the old best floor.
- **T16. Dark windows.** The references draw the arched, rose and lantern windows only lit. Their dark versions follow the references' own dark-window rule: lavender glass and a closed pink curtain.
- **T17. The art kit.** `public/art/tower-kit.json` (about 840 KB, roughly 110 KB compressed) holds the reference pieces as drawn. It loads on the first Crossroads visit and is precached for offline play. It was extracted once from the private references. Never regenerate it.
- **T18. The switcher.** It reaches into the top bar's padding, so all three options are 44-point targets without moving the map.
- **T19. Reveal order.** The Crossroads reveal waits for the fog-lift scene when both are due.
- **T20. Smoothness is judged on Chromium with its CPU slowed to a quarter,** standing in for a mid-range phone. Headless Windows WebKit draws in software, at about 30 ms a frame, so its frame times are logged, not asserted. The 50 ms main-thread checks still run in both browsers.
- **T21. The run-over's tower is drawn ahead,** when Tower home opens and after any lost floor.
- **T22. The ascent's 50 ms failure wasn't the lift.** The cause was Tower home preparing the run-over picture about 1.5 s after opening: decoding the whole tower as one SVG costs about 40 ms in WebKit. The run-over is now prepared only where it's reached, on the lost floor's result screen and the "End this climb?" sheet. See R4.
- **T23. The Android smoothness check starts when the slide does** (`data-sliding`), so the scene's setup isn't counted as a frame. The limit is unchanged.

## The Moonlit Glade and Dev Mode (from commits and code only)

No rationale was recovered for these. Each entry records what the code does and which commit did it.

- **M1. Save schema for the Glade,** with a one-time `ten-charms.save.pre-map2` copy and a Map 1 golden test (384380e).
- **M2. New group types:** color runs, Evens and Odds groups, and Pairs (b8b6aee). The Moonlit phase order was validated by simulation and corrected (dc9313a).
- **M3. Moonlit Fog, the Thorned Crown and the Glade's bots** (5d6d9de), and the Glade's screens (e058c74).
- **M4. Change Request 04** made Moonlit Trial A's list the Moonlit Phases (ids 21–30). The old list (ids 11–20) is kept only so a match in progress at the update can finish on it. Trials B and C are Free Play only (3a81a2e, 3d2fe69, c84fa12, 7ff0ae4). `tests/fixtures/pre-cr04/` was recorded once. Never regenerate it.
- **V1. Change Request 05, Dev Mode.** A secret link opens every progression lock on one browser without writing to the save. The app stores only a salted PBKDF2 digest of the word (`DEV_DIGEST` in `src/meta/devmode.ts`), and tests make sure the word never appears in tracked files, builds or reports (19cfa20, 31046e4; [TESTING.md](TESTING.md#dev-mode)).
- **V2. No masks in image comparisons since Change Request 05.** `scripts/allowed-diffs.json` is empty, so every screen must match the baseline with no masks ([TESTING.md](TESTING.md#tower-tests)).

## Rejected approaches

- **R1. A separate fast clock for tests.** It would save about 25 seconds a gate, and `setTestScale` already covers the slow tests (D31).
- **R2. 6 parallel workers.** They cut the parallel stage to 5.7 minutes but caused a tap timeout and an image difference on the reference laptop (D33).
- **R3. Widening timeouts, tolerances or the 50 ms limit to get green runs.** Rejected throughout (D34–D36). Doing any of it now needs the user's approval ([AGENTS.md](../AGENTS.md#testing-workflow)).
- **R4. Splitting the run-over tower into four SVG layers.** It kept WebKit's tasks short, but made Chromium's run-over slower (52–54 ms) and spread work into the Android slide (T22).
- **R5. A fog move from Tier 4 to Tier 5.** It measured exactly the same (63.0%), and would have made How to Play's text untrue (T11).
- **R6. Having Nightshade play out sample futures.** This is the real fix for D13, but it's too slow on a phone's main thread. It needs bot thinking moved to a worker first.
- **R7. A dedicated Undo button.** Tapping a slot is the undo (D15).
- **R8. Giving the tier-change scene's pieces their own layers.** It made no clear difference to the scene's occasional 45–64 ms readings, so it was left out.

## Consequential history

- **2026-10-30.** The first build (Phases 1–8) was made unattended from `private/SPEC.md`. Internal notes were then moved out of the repo (ad13d30), and the public history was cleaned of a personal email address. That's why the commit email must be the noreply address.
- **2026-10-30.** The iOS 26 blank screen was fixed (78c9f44), which led to D30 and the older-WebKit rule in `AGENTS.md`.
- **2026-10-31.** An Android test project, image comparison and table fixtures were added (40acf71). Android Chrome became a target.
- **2026-11-02.** Change Request 02 cut the gate from 46 to about 20 minutes and added the test inventory (D31–D41).
- **2026-11-02 to 11-15.** The Moonlit Glade (Map 2), the refinement simulation and Change Request 04 (M1–M4).
- **2026-11-18.** The Tower and the Crossroads (T1–T23).
- **2026-11-19 to 11-23.** Dev Mode, Change Request 05 (V1–V2).
- **2026-11-25.** The multi-agent transition: `AGENTS.md` became the shared instruction file, and project knowledge moved from untracked notes into `docs/`.
