# Visual design and assets

Conventions for how the game looks, moves and sounds, and how art and sound are added. This was checked against the code on 2026-11-25. The full design system (mood, layouts, the motion script for every moment) is in `private/SPEC.md` §9–12 and `private/TOWER_SPEC.md` §6–9. Read those before designing a new screen.

## Look

- **Theme.** Map 1 is a "Rose Garden Tea Party": warm, gentle and lightly playful. Rivals tease affectionately, and the boss is theatrical, not scary. The Moonlit Glade is its night-time counterpart, and the Tower has sky bands that cycle every five tiers (`TOWER_SKIES` in `src/content.ts`).
- **Color tokens** are CSS custom properties on `:root` in `src/ui/styles/base.css`: `--ink`, `--plum`, `--panel`, `--primary`, `--gold*`, the card colors, and others. Use the tokens, not new literal colors. Each suit is always paired with its symbol:

  | Suit | Symbol | Token |
  |---|---|---|
  | Rose | five-petal flower | `--rose` `#B8325C` |
  | Moss | single leaf | `--moss` `#3C7449` |
  | Moonstone | crescent moon | `--moonstone` `#3B5BA0` |
  | Honey | hexagon | `--honey` `#94600C` |

  The Glade's and the Tower's styles are in `glade.css` and `tower.css`.
- **Contrast.** Text and background pairs must meet WCAG AA (4.5:1). `tests/unit/assets.test.ts` lists the checked pairs, so add new pairs there.
- **Type.** Fraunces (`--display`) is for headings and Nunito (`--ui`) for the interface. Both are self-hosted from `@fontsource`, with no web font requests.
- **Scale.** `1rem` is 10 reference points at 390 wide, so the whole layout scales with the viewport width, up to 440. Test sizes are 375×667, 390×844 and 440×956 (WebKit), and 412×892 (Android Chromium).
- **Safe areas.** These come from the `--sat`, `--sab`, `--sal` and `--sar` tokens. Nothing may sit under the notch, the Dynamic Island or the home indicator.
- **Card art, icons, decor and the app icon** are drawn in code. There are no image files for them.

## Motion

- **Every action gets motion and sound.** A static, "web form" feel counts as a failure even when the rules work. The spec's motion script is the reference.
- **Only `transform` and `opacity` animate,** using the Web Animations API and CSS transforms. The one exception is the Phase Panel's short collapse, which animates height so the table can grow with it.
- **Reduced Motion.** It's a setting, and it defaults to on when the OS asks for it (`prefers-reduced-motion`, read in `src/meta/save.ts`). Under it there's no shake or drift: the Tower's lift crossfades, and cards appear face up.
- **Performance.** No main-thread task may run over 50 ms in the performance tests. Prepare heavy work, such as decoding large SVGs, on a screen where a pause isn't noticed ([DECISIONS.md](DECISIONS.md) T22).
- **Ambient motion** pauses when the app is hidden.

## Touch

- **Targets** are at least 44 points. The one accepted exception is overlapped cards in an 11-card fan (D20).
- **Touch behavior.** Drag and tap share one pointer code path. The page must not rubber-band, zoom on double-tap or pull to refresh.

## Sound

- **Sources.** Seven card sounds are recorded (Kenney Casino Audio, CC0, in `assets/audio/` as `.m4a`). Everything else is synthesized in `src/ui/audio/sfx.ts` and `music.ts`.
- **Replacing a sound.** Any file in `assets/audio/` named after a sound id replaces that sound's synthesized version. The accepted formats are `.m4a`, `.mp3`, `.wav` and `.aac` (`scripts/audio-manifest.mjs`). No code changes are needed: rebuild, and it's picked up.
  - **Sound effect ids** are in `SOUND_IDS` in `src/ui/audio/sfx.ts`.
  - **Music** files are named `music-<id>`, for any key of `MUSIC` in `src/ui/audio/music.ts`, such as `music-map`, `music-waltz`, `music-boss`, `music-gladeFog` or `music-tower`. A music file loops as is, so it needs a seamless loop. A `music-tower` file replaces the Tower's layered theme, including the layers that build up in higher tiers.
- **Formats.** Prefer `.m4a`, since iOS Safari can't rely on Ogg (D26).
- **Credits.** Every added asset needs a row in `CREDITS.md` and the matching entry in `src/credits.ts`, which drives the in-game Credits screen.

## Portraits

- **Placeholders.** Bots show letter placeholders until painted portraits exist.
- **Adding portraits.** Drop PNGs named `<bot>-<expression>.png` in `assets/portraits/`.
  - `<bot>` is one of `pip`, `marigold`, `briar`, `hoot`, `nightshade`, `lumi`, `mallow`, `velvet`, `fennel`, `sable`, `mossback` or `lunaria`.
  - `<expression>` is `neutral`, `happy`, `sad`, `smug` or `intense`.
  - `scripts/portraits.mjs` makes 256 px and 512 px WebP versions at build time and ignores any other names.
- **Prompts.** Art prompts are in `private/ART_PROMPTS.md`.

## The Tower's art

- **The art kit.** `public/art/tower-kit.json` holds the vector pieces, lifted once from the approved references in `private/mockups/tower/svg/`. The game only chooses and places them (`src/ui/tower/art.ts`). Never regenerate or hand-edit the kit.
- **Parity test.** `tests/e2e/24-tower-art-parity.spec.ts` compares the game's drawing with the references, and needs a 97% pixel match. It's skipped where `private/` is missing.

## Size budgets

`tests/unit/assets.test.ts` enforces two limits on the production build: under 15 MB in total, and under 3 MB excluding audio and portraits. The app itself is about 0.4 MB.
