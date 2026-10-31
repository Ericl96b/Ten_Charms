# Ten Charms

A cozy, Rose Garden themed rummy card game: a static web app with no server, played mainly on an iPhone from the Home Screen. Saves stay on each player's device.

Live at https://ericl96b.github.io/Ten_Charms/. Every push to `main` redeploys it through GitHub Actions, so a push goes straight to the player.

## First step on a new clone

Set the commit email before committing anything, because this repo is public and the machine's global email may be a personal address:

```bash
git config user.email "198155317+Ericl96b@users.noreply.github.com"
```

Check it with `git config user.email`.

## Setup

Needs Node 24 or newer. `README.md` lists the commands and code layout.

```bash
npm ci
```

```bash
npx playwright install webkit
```

Run `npm run build` and `npm run build:dev` before `npm run test:e2e`. A full browser run takes about 18 minutes.

## Rules

- **This repo is public.** Keep personal details and internal notes out of tracked files, commit messages and pull requests. Check what you're staging before every commit.
- **`private/` is gitignored and may be missing.** When present, it holds the spec (`SPEC.md`), `DECISIONS.md`, `PROGRESS.md`, `HANDOFF.md`, the iPhone checklist (`QA.md`) and art prompts. Read them first, and keep `PROGRESS.md` and `DECISIONS.md` current. If it's missing, work from `README.md` and the code, tell the user that the spec comparison test is skipped, and don't recreate those notes in tracked files.
- **No play limits.** No ads, timers, energy, purchases or accounts.
- **Fair bots.** Bots only use `observe()` output, with no rigged shuffles or difficulty-based luck. Tests enforce this.
- **Original IP.** Never use the trademarked name of the game this is inspired by, anywhere in the project. Build stage labels from the number at runtime. A test scans the project, including this file.

## Testing for iPhone

The player's iPhone can run an older WebKit than the Playwright suite, and passing on a newer engine doesn't prove iOS works. A bad element name once passed every test on WebKit 27.2 while the game showed a blank screen on iOS 26.

For changes to startup, layout or newer browser features, also test on an older WebKit. `playwright@1.56.1` ships WebKit 26.0. Install it outside the project. On Windows, its installer may hang while unpacking and its host check may fail, so unpack the downloaded archive by hand and set `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`.

Windows WebKit still isn't iOS Safari. For risky changes, tell the user what to check on the real iPhone, and report a change as unconfirmed until they have.

## Known issues

- The "invalid actions" test in `tests/e2e/02-table.spec.ts` can occasionally tap the wrong card in the fanned hand. It passed 10 of 10 repeats after one failure.
- Nightshade beats Professor Hoot about 52% of the time, against a 60% target. A real fix would have her play out sample futures, which needs bot thinking moved off the main thread.
- Nobody has confirmed how the sound and music come across, and the full iPhone checklist hasn't been run.
