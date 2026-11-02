# Testing

How the tests are organized, what they cost, and how reliable they are. The commands are in `README.md`.

## Coverage guarantee

`tests/inventory.json` lists every browser test: its file, title, project, and whether it's skipped. `npm run test:inventory` fails if any listed test is gone. Given run reports, `scripts/test-inventory.ts check` also fails if a listed test didn't run exactly once, was newly skipped, failed, or needed a retry. New tests are allowed.

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

The baseline suite is not yet reliable on this machine. With no code changed and no retries, 1 of 3 full runs was clean.

| Failure | Seen |
|---|---|
| Performance test over 50 ms | `max` in a full run (67 and 108 ms), `max` in a repeat (51 ms), `se` in a partial run (52 ms) |
| Auto-player timeout at 90 s in the choose and sprint test | `max` in a full run, `max` in a repeat |
| Skip target picker never appears | 2 tests at `max` in a full run, not in 6 repeats |
| "AudioContext encountered an error" console error | `android`, 1 test in a full run |
| Boss intro "element is not visible" on click | `se`, 1 baseline capture |
| 2 pixels differ between two captures | `fixture-two-top`, `-middle` and `-bottom` at `android` |
