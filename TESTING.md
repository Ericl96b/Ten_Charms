# Testing

How the tests are organized, what they cost, and how reliable they are.

## The workflow rule

1. While fixing a failure, use targeted runs.
2. Once the targeted runs pass, run the full gate.
3. Commit only after the gate passes. A targeted run never replaces it.

## Commands

| Command | What it does | About |
|---|---|---|
| `npm run gate` | The full gate. Required before committing a finished change, and before reporting work as done | 20 min |
| `npm run gate:no-cache` | The gate, with the simulation run fresh | 21 min |
| `npm run test:failed` | Only the tests that failed in the last run | Seconds |
| `npm run test:file -- 09-table` | One test file or area | Seconds to minutes |
| `npm run test:project -- max` | One viewport (`se`, `ref`, `max`, `android`). `max` is the slowest, because it has the real-speed match | 7.5 min for `max` |
| `npm run test:unit` | Unit tests only | 30 s |
| `npm run sim:smoke` | Small simulation, written to `test-results/sim-smoke.md`. Its numbers are never final | 2 s |
| `npm run visual:baseline` | Captures the image baseline, which stays on each machine. The gate refuses to run without one | 7 min |

Targeted runs rebuild first, and they leave out the coverage check, which only means something in a whole run. If that check is the only failure, `test:failed` finds no tests, so run the gate.

## What the gate does

`scripts/gate.mjs` rebuilds, typechecks, then runs the unit tests and the full simulation, and then the browser tests in stages. `tests/e2e/stages.ts` lists which tests go where.

| Stage | Tests | How it runs | Why |
|---|---|---|---|
| Parallel | 225 | 4 workers | Everything else |
| Serial | 32 | 1 worker | They assert a duration, sit close to a time limit (the full match, choose and sprint) or record video |
| Alone | 4 | 1 worker, nothing else running | The performance tests |
| Last | 4 | 1 worker | The coverage check reads every other test's event log |

Finally, it writes the long parity group report (below), compares images with `scripts/compare-shots.mjs` and checks the inventory. Retries are off. Results are in `test-results/gate/`, with `summary.txt` for the times.

**Workers.** Set `TC_WORKERS` to change the parallel stage. On the laptop below, the stage took 29.8 min with 1 worker, 14.8 with 2, 10.2 with 3 and 8.0 with 4. Six took 5.7 but caused a tap timeout and an image difference. Measure again on a different machine.

**Real speed.** All other full matches scale down their waits with the `setTestScale` hook, which could hide a timing bug. `10-real-speed.spec.ts` plays one full match at real speed at 440×956, in every gate, and takes about 5 minutes.

**Simulation.** Lineups and seeds are drawn in one fixed order and only sums come back from the workers, so results don't depend on the worker count. The cache key hashes every file the simulation imports, plus its sample sizes and the Node version. Results are in `test-results/sim-cache/`.

## Map 2 tests

The Moonlit Glade's browser tests are in `11-glade.spec.ts`, `12-glade-polish.spec.ts` (performance) and `13-glade-recordings.spec.ts`, and its screenshots are in the `capture: the Moonlit Glade` test in `06-visual.spec.ts`. Fogged screens hold their clouds still for screenshots with the `freezeFog` test hook, which is compiled out of production builds like the others.

Change Request 04 made Moonlit Trial A's list the Moonlit Phases. `16-glade-swap.spec.ts` loads saves recorded on the game from before then (`tests/fixtures/pre-cr04/`, made once and never regenerated), each holding a match in progress, and checks they resume exactly at every size. `16-glade-swap-match.spec.ts` plays whole matches through the real UI at 390×844 only, in the serial stage: a Map 2 stop and a Free Play match on the new list, and the saved matches on the list they began on. `tests/unit/moonlit-swap.test.ts` covers the same saves without a browser.

**Long parity groups (report only).** `17-glade-parity.spec.ts` lays down Odds and Evens groups of 8 to 20 cards on a fogged Glade table at every size, including Lunaria's crowned group at the boss, and records the largest that shows every card inside the laid-down area. `scripts/parity-report.mjs` joins the sizes into `test-results/parity-groups.md`. The sizes it finds never fail the gate; only a missing measurement does.

Each Map 2 test is classed `real` or `fast` in `tests/inventory.json`: `fast` if it speeds up waits with `setTestScale`, `real` otherwise. Performance checks, recordings and image captures are always `real`. `FAST_CLOCK` in `tests/e2e/stages.ts` lists the fast ones, and the inventory check fails if a Map 2 test has no class.

## Tower tests

The Tower's browser tests are `18-tower-nav.spec.ts` (the switcher, the Crossroads and its reveal), `19-tower-home.spec.ts` (Tower home, the floor intro, results, run over, Stats and How to Play), `20-tower-climb.spec.ts` (a whole climb, and a floor surviving a reload), `21-tower-motion.spec.ts` (the lift, skipping, Reduced Motion, sky bands and music layers), `22-tower-perf.spec.ts` (performance, alone), `23-tower-recordings.spec.ts`, `24-tower-art-parity.spec.ts` and `25-tower-captures.spec.ts`. Like Map 2's, each carries a timing class: tests titled `tower flow: …` speed up their waits with `setTestScale`; everything else runs in real time. The art parity test draws each piece with the game's own code and from the approved references in `private/`, and needs 97% of pixels to match; it's skipped where `private/` is missing. Recordings and captures go to `private/qa-screenshots/tower/`. Tower screens hold their drifting life still for captures with the `freezeAmbient` hook.

The Tower update could change only a map's top bar and the Tower's own sections in Stats and How to Play. `scripts/allowed-diffs.json` names the masks a branch may use, and the gate passes exactly them to `compare-shots.mjs`. Since Change Request 05 the list is empty: every screen must match the baseline with no masks.

## Dev Mode

Dev Mode (Change Request 05) opens every progression lock on one browser, without writing anything to the save.

**Turning it on.** Open the app's address with `#` and the secret word after it: `https://ericl96b.github.io/Ten_Charms/#<word>`. It stays on for that browser, across reloads and the Home Screen icon, and the word leaves the address. Typing it into a tab where the game is already open works too: that changes only the fragment, which never reloads the page, so the game also checks it then, and draws the screen showing again. A wrong word does nothing. The word isn't in the repo; the app holds only a salted PBKDF2 digest of it (`DEV_DIGEST` in `src/meta/devmode.ts`).

**Turning it off.** Settings shows a last row, "Dev Mode", only while it's on. "Turn off" turns it off at once and returns to the Journey, or leaves you on the table if a match is under way.

**The word for tests.** The tests read it from `TC_DEV_WORD`, or from the untracked file `private/dev-mode-word.txt` (the word alone on one line). `node scripts/dev-word.ts` says whether it's available. Without it the gate stops before it starts, and the Dev Mode unit tests fail; they never skip. If the word changes, put the output of `node scripts/dev-word.ts --digest` in `DEV_DIGEST`.

**Keeping the word out.** `tests/unit/dev-mode.test.ts` fails if any tracked file, or either build, holds the word. The gate ends with `scripts/word-scan.mjs`, which fails if it shows up in any report or log under `test-results/` or `qa-screenshots/cr05/`. Browser tests pass the word into the page only as an argument, never in a title, an address the runner logs, or a message.

**The tests.** `26-dev-mode.spec.ts` covers turning it on and off, each lock, matches at every stop, on a Tower floor and on every Free Play variant, what turning off puts back, a match left running when it's turned off, Backup & Restore, and the player's build. Tests titled `dev mode flow: …` run on a fast clock; the rest run in real time. Its captures, with Dev Mode on, go to `qa-screenshots/cr05/dev-on/`. They are new pictures, not part of the baseline. `tests/unit/dev-mode.test.ts` checks the word, and that with Dev Mode off every check returns exactly what the game's own progress gives, on every prepared save.

**Private files.** `24-tower-art-parity.spec.ts` compares against references that live only in `private/`. Where `private/mockups/tower/svg` is missing, its skip doesn't fail the inventory check, which prints a note instead. Everywhere else it must run.

## Coverage guarantee

`tests/inventory.json` lists every browser test: its file, title, project, and whether it's skipped. `npm run test:inventory` fails if any listed test is gone. Given run reports, `scripts/test-inventory.ts check` also fails if a listed test didn't run exactly once, was newly skipped, failed, or needed a retry. New tests are allowed. The gate runs this with its reports, so a test dropped by a stage filter fails the gate.

No assertion limit or timeout was loosened to gain speed. The performance probe's limit stayed at 50 ms; its timer was removed because that timer alone read 46–49 ms on an idle page on Windows WebKit.

## Results after the speedup

Three gates in a row with no failures and no retries: 20.5, 19.5 and 19.7 minutes. The first ran with no simulation cache.

| Area | Before | After |
|---|---|---|
| Whole run, including the simulation | 46 min | **19.7 min** (20.5 with no cache) |
| Browser tests | 40.4 min | 18.9 min (10.6 parallel, 7.1 serial, 1.2 alone) |
| Simulation | 5.5 min | 66 s, or under 1 s on a cache hit |
| Unit tests | 5 s | 29 s, because of the new simulation runner tests |
| Rerun one failed test | 40 min | 19 s |

The per-viewport figures below add up test time, so they don't shrink when tests run side by side, and they grow a little under load. `max` also includes the 5-minute real-speed match.

| Project | Test minutes before | Test minutes after |
|---|---|---|
| max | 11.0 | 15.0 |
| ref | 10.1 | 10.5 |
| se | 9.2 | 9.4 |
| android | 8.4 | 7.9 |

**Couldn't be sped up without losing coverage:** the serial stage takes 7 minutes because of its time limits and timing checks, and the real-speed match has to take as long as a real match. Waits for bots to "think" aren't worth removing, since the slowest tests already scale them down: a separate fast clock would save about 25 seconds per gate.

## Baseline measurements

Measured before any speedup, at commit 86cdd86, on a Windows 11 laptop: Intel Core 5 120U, 10 cores and 12 threads, 15.7 GB of memory, about 4.5 GB free at rest.

Full browser suite, serial with one worker, 3 runs: 40.9, 40.4 and 38.1 minutes. **Median 40.4 minutes.** Regenerate the tables below with `node scripts/test-timing.ts <reports>`.

| Other parts, from one run | Time |
|---|---|
| Production build | 10 s (not run by the suite) |
| Development build | 1 s (not run by the suite) |
| Typecheck | 8 s |
| Unit tests | 5 s |
| `npm run sim` | 5.5 min (not run by the suite) |
| `scripts/compare-shots.mjs` | 5 s (not run by the suite) |

| Project | Median minutes |
|---|---|
| max | 11.0 |
| ref | 10.1 |
| se | 9.2 |
| android | 8.4 |

| File | Median minutes |
|---|---|
| 04-juice.spec.ts | 11.5 |
| 02-table.spec.ts | 7.4 |
| 06-visual.spec.ts | 6.8 |
| 03-meta.spec.ts | 5.5 |
| 09-table-layout.spec.ts | 5.4 |
| 08-map-play.spec.ts | 1.9 |
| 05-recordings.spec.ts | 0.9 |
| 01-shell.spec.ts | 0.3 |
| 07-settings-icon.spec.ts | 0.1 |
| zz-coverage.spec.ts | 0.0 |

| 20 slowest tests | Project | Median seconds |
|---|---|---|
| 2. a full match against Pip finishes through the real UI | max | 83 |
| choose your phase and sprint play through their own flows | max | 82 |
| 2. a full match against Pip finishes through the real UI | se | 74 |
| 2. a full match against Pip finishes through the real UI | ref | 54 |
| choose your phase and sprint play through their own flows | ref | 45 |
| capture: sheets, round end and match end | ref | 42 |
| capture: sheets, round end and match end | max | 41 |
| capture: sheets, round end and match end | se | 41 |
| capture: sheets, round end and match end | android | 40 |
| choose your phase and sprint play through their own flows | se | 38 |
| 2. a full match against Pip finishes through the real UI | android | 38 |
| lay-down moment, slots, sparkles, hit, wild trail, and going out | max | 30 |
| lay-down moment, slots, sparkles, hit, wild trail, and going out | android | 30 |
| choose your phase and sprint play through their own flows | android | 29 |
| lay-down moment, slots, sparkles, hit, wild trail, and going out | ref | 29 |
| capture: table states | max | 29 |
| lay-down moment, slots, sparkles, hit, wild trail, and going out | se | 28 |
| 7. the whole campaign: stars, unlocks, Charms, Free Play, variants and the boss intro | max | 26 |
| capture: table states | ref | 26 |
| being skipped, skipping, bots laying down, hitting, going out, and the discard history | max | 24 |

## Baseline reliability

Before this work, with no code changed and no retries, 1 of 3 full runs was clean.

| Failure | Seen | Outcome |
|---|---|---|
| Performance test over 50 ms | `max` in a full run (67 and 108 ms), `max` in a repeat (51 ms), `se` in a partial run (52 ms) | The probe's own timer read 46–49 ms when idle, so it was removed. Now 14–37 ms, and the test runs alone. |
| Auto-player timeout at 90 s in the choose and sprint test | `max` in a full run, `max` in a repeat | Took 77–90 s under load, so it moved to the serial stage |
| Skip target picker never appears | 2 tests at `max` in a full run, not in 16 repeats under load | Not reproduced, and the cause isn't confirmed. Possibly a slow patch on the machine or the wrong-card tap below. Watch for it. |
| "AudioContext encountered an error" console error | `android`, 1 test in a full run | Android tests no longer use a real audio device. Not reproduced before or after. |
| Boss intro "element is not visible" on click | `se`, 1 baseline capture | The capture tried to tap an intro that lasts under 100 ms at test speed. It now checks that the intro ran. |
| 2 pixels differ between two captures | 3 `fixture-two` and 3 `fixture-worst` shots at `android` | Chromium could keep a layer rendered from mid-loop. Captures now stop looping animations first, and 8 captures in a row were identical. |
| Tutorial test sees the Skip tip first | `se`, while calibrating | A random deal can show that tip first. The test now allows for it. |
| Wrong card tapped in the fan | `se`, 1 test in a gate | Tapping a fanned card now waits for its movement to finish. 40 of 40 repeats and 3 gates since. |
| Tap timeout | `ref`, with 6 workers | Too many workers for this laptop, so the default is 4 |
| "No tappable point" on a card in the fog test (`glade: in the fog, every count is hidden`) | `android`, 1 run in a gate | Passed 5 of 5 alone and in the gates before and after. Not reproduced, and the cause isn't confirmed; likely load. Watch for it. |
| `glade-table-boss-fogged` image: Lunaria's hidden-count cloud drawn slightly larger (113 pixels, a difference of up to 80) | `android`, 1 gate during Change Request 05, which changes no table code | Matched the baseline exactly in 3 captures in a row straight after. Seen again (34 pixels) in a later gate, so 2 of 5 gates during Change Request 05; the gates between and after passed. The cause isn't confirmed; likely the cloud caught mid-transition under load. Watch for it. |
| Charm toast not found (`lay-down moment, slots, sparkles, hit, wild trail, and going out`) | `ref`, 1 gate during the Dev Mode open-tab fix, which changes no table code | Passed 5 of 5 alone straight after. Not reproduced, and the cause isn't confirmed; likely the toast came and went while the test waited for the table under load. Watch for it. |
| A chip's bubble measured outside its chip (`everything tied to a chip still lands on the right chip`) | `android`, 1 gate during the Dev Mode open-tab fix, which changes no table code | The next gate passed. Not reproduced, and the cause isn't confirmed; likely measured mid-move under load. Watch for it. |

**Image baseline.** It was recaptured when captures began stopping loops. Compared with the old baseline, 169 of 176 shots were within tolerance. The other 7 are at `android`: the 6 shots above (2 pixels, a difference of 9) and `table-bot-thinking` (20 pixels, a difference of up to 15, from its looping dots). The production build was byte-identical throughout.
