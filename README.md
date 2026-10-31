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
| `npm run sim` | Headless simulation; rewrites `SIMULATION.md` (about 4 minutes) |
| `npm run test:e2e` | Browser suite (WebKit at 375×667, 390×844, 440×956; Chromium with an Android user agent at 412×892). Run both builds first |
| `node scripts/compare-shots.mjs [tags]` | Compares the screenshots from the last browser run with a saved baseline in `qa-screenshots/cr01/baseline/`. Tags name what may differ: `settings-icon`, `map-current`, `table` |

## Layout

| Path | Contents |
|---|---|
| `src/engine/` | Rules engine: deterministic, no presentation. `observation.ts` is all a bot may see |
| `src/bots/` | The five profiles and hand evaluation. A test proves this code cannot reach hidden state |
| `src/sim/` | Headless match driver |
| `src/meta/` | Saves, backup codes, progression, Charms, stats |
| `src/content.ts` | Title, roster, dialogue, stops, unlocks, Charms |
| `src/ui/` | Table, set pieces, screens, audio, styles |
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
