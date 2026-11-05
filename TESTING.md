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

Finally, it compares images with `scripts/compare-shots.mjs` and checks the inventory. Retries are off. Results are in `test-results/gate/`, with `summary.txt` for the times.

**Workers.** Set `TC_WORKERS` to change the parallel stage. On the laptop below, the stage took 29.8 min with 1 worker, 14.8 with 2, 10.2 with 3 and 8.0 with 4. Six took 5.7 but caused a tap timeout and an image difference. Measure again on a different machine.

**Real speed.** All other full matches scale down their waits with the `setTestScale` hook, which could hide a timing bug. `10-real-speed.spec.ts` plays one full match at real speed at 440×956, in every gate, and takes about 5 minutes.

**Simulation.** Lineups and seeds are drawn in one fixed order and only sums come back from the workers, so results don't depend on the worker count. The cache key hashes every file the simulation imports, plus its sample sizes and the Node version. Results are in `test-results/sim-cache/`.

## Map 2 tests

The Moonlit Glade's browser tests are in `11-glade.spec.ts`, `12-glade-polish.spec.ts` (performance) and `13-glade-recordings.spec.ts`, and its screenshots are in the `capture: the Moonlit Glade` test in `06-visual.spec.ts`. Fogged screens hold their clouds still for screenshots with the `freezeFog` test hook, which is compiled out of production builds like the others.

Each Map 2 test is classed `real` or `fast` in `tests/inventory.json`: `fast` if it speeds up waits with `setTestScale`, `real` otherwise. Performance checks, recordings and image captures are always `real`. `FAST_CLOCK` in `tests/e2e/stages.ts` lists the fast ones, and the inventory check fails if a Map 2 test has no class.

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

**Image baseline.** It was recaptured when captures began stopping loops. Compared with the old baseline, 169 of 176 shots were within tolerance. The other 7 are at `android`: the 6 shots above (2 pixels, a difference of 9) and `table-bot-thinking` (20 pixels, a difference of up to 15, from its looping dots). The production build was byte-identical throughout.
