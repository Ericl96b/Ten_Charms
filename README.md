# Ten Charms

A cozy, Rose Garden themed rummy card game for iPhone and Android: a static web app installed to the Home Screen.
## Commands

Needs Node 24 or newer. On the build machine, Node is a portable copy; in PowerShell, run `$env:PATH = "$PWD\.tools\node;$env:PATH"` first.

```bash
npm ci
```

```bash
npm run preview
```

`npm run preview` builds for production and serves it at http://localhost:4173/.

| Command | What it does |
|---|---|
| `npm run build` | Production build into `dist/` |
| `npm run build:dev` | Build with developer test hooks into `dist-dev/` |
| `npm run typecheck` | TypeScript check |
| `npm run test:unit` | Rules, bots, fairness, saves, assets |
| `npm run sim` | Headless simulation on all cores; rewrites `SIMULATION.md` (about a minute, or instant if nothing that affects it changed) |
| `node scripts/simulate-map2.ts` | The Moonlit Glade's simulation: phase difficulty, match length, a stress test and every stop's win rate and star thresholds. Rewrites `SIMULATION_MAP2.md` (about 25 minutes, cached like `npm run sim`) |
| `node scripts/refine/simulate-refine.ts` | The Moonlit Phases refinement: measures 39 phases, checks the bots against an independent judge, searches every 10-phase list and confirms the finalists on fresh seeds. Rewrites `SIMULATION_MOONLIT_REFINEMENT.md` (several hours; each measured piece is cached in `test-results/sim-cache/refine/`, so a rerun only redoes what changed). `--smoke` writes a small, never-final run to `test-results/` |
| `npm run gate` | **Everything, required before committing** (about 20 minutes). `TESTING.md` has the targeted commands for iterating |
| `npm run test:e2e` | Browser suite one test at a time, about 40 minutes (WebKit at 375×667, 390×844, 440×956; Chromium with an Android user agent at 412×892). Run both builds first |
| `node scripts/compare-shots.mjs [tags]` | Compares the screenshots from the last browser run with a saved baseline in `qa-screenshots/cr01/baseline/`. Tags name what may differ: `settings-icon`, `map-current`, `table` |

## Layout

| Path | Contents |
|---|---|
| `src/engine/` | Rules engine: deterministic, no presentation. `observation.ts` is all a bot may see |
| `src/bots/` | The bot profiles (the Rose Garden's five, the Moonlit Glade's seven, and Lunaria's two wisps) and hand evaluation. A test proves this code cannot reach hidden state, or any card count under the fog |
| `src/sim/` | Headless match driver |
| `src/meta/` | Saves, backup codes, progression, Charms, stats |
| `src/content.ts` | Title, roster, dialogue, stops, unlocks, Charms |
| `src/ui/` | Table, set pieces, screens, audio, styles. `screens/glade.ts` is the Moonlit Glade's map and `fx/fog.ts` its drifting clouds |
| `src/dev/` | Test hooks, compiled out of production builds |
| `assets/portraits/`, `assets/audio/` | Drop-in art and sound |

## Major choices

- **Plain TypeScript and the DOM, no framework.** There are no runtime dependencies, so the app stays around 0.4 MB, and every animation is under direct control.
- **esbuild** for bundling, since it is fast and has one job. `__DEV__` is a compile-time constant, so the test hooks vanish from production builds, and a test checks that.
- **Web Animations API and CSS transforms** for motion. Only `transform` and `opacity` animate, except the Phase Panel's short collapse, which animates height so the table can grow with it.
- **ChaCha20 seeded from `crypto.getRandomValues`** for shuffles: cryptographically strong and still replayable from a recorded seed.
- **`localStorage` with a rolling backup** for saves. A save is small and synchronous, so a force-quit at any moment loses nothing.
- **Web Audio** for sound: recorded CC0 card sounds where they exist, synthesis for everything else, and any file dropped in `assets/audio/` takes over from its synthesized version.
- **Playwright with WebKit and Chromium** for browser tests. WebKit is the closest automated match to iOS, where Safari and Chrome both use it, and Chromium covers Chrome on Android.
