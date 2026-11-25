# Ten Charms: agent instructions

The authoritative instructions for any coding agent (Codex, Claude Code or another). Agent-specific files add to this file and never repeat it.

Ten Charms is a cozy, Rose Garden themed rummy card game: a static web app with no server, played mainly on an iPhone from the Home Screen (installed from Chrome for iOS), and also on Android in Chrome. Saves stay on each player's device. It's live at https://ericl96b.github.io/Ten_Charms/.

**Every push to `main` redeploys the game through GitHub Actions, straight to the player.** Never push or merge to `main`, and never change `.github/workflows/deploy.yml`, unless the user asks you to in this task. Work on a branch.

## First steps on a new clone or machine

1. Set the commit email before committing anything. The repo is public, and the machine's global email may be a personal address:

   ```bash
   git config user.email "198155317+Ericl96b@users.noreply.github.com"
   ```

   Check it with `git config user.email`.
2. Install Node 24 or newer. On the original build machine Node is a portable copy: in PowerShell, run `$env:PATH = "$PWD\.tools\node;$env:PATH"` first.
3. Run `npm ci`, then `npx playwright install webkit chromium`.
4. Capture this machine's image baseline once with `npm run visual:baseline`. The gate won't run without one.
5. Provide the Dev Mode word through `TC_DEV_WORD` or `private/dev-mode-word.txt`. The gate stops without it ([TESTING.md](TESTING.md#dev-mode)).

## Testing workflow

1. While fixing a failure, use targeted runs: `npm run test:failed`, `test:file`, `test:project`, `test:unit` or `sim:smoke`.
2. Once the targeted runs pass, run `npm run gate`, which takes about 20 minutes. Run it in the background if your tool limits command time.
3. Commit only after the gate passes. A targeted run never replaces it, and don't report work as done without it.

Never loosen an assertion, a timeout or an image tolerance, add retries, or skip or remove a test to make a run faster or greener without asking the user. `tests/inventory.json` guards against removed and newly skipped tests. [TESTING.md](TESTING.md) lists every command, the gate's stages and the known flaky and pre-existing failures.

## Rules

- **This repo is public.** Keep personal details, the player's identity and internal notes out of tracked files, commit messages and pull requests. Check what you're staging before every commit.
- **`private/` is gitignored and may be missing.** When present, it holds the specs (`SPEC.md`, `TOWER_SPEC.md` and any change requests), the device QA checklist, art prompts and references, and older handoff notes. Read the relevant spec before changing a feature. If `private/` is missing, work from the tracked docs and the code, and tell the user that the spec comparison test is skipped. Never copy `private/` content verbatim into tracked files.
- **No play limits.** No ads, timers, energy, purchases or accounts.
- **Fair bots.** Bots only use `observe()` output (`src/engine/observation.ts`), with no rigged shuffles or difficulty-based luck. Tests enforce this.
- **Original IP.** Never use the trademarked name of the game this is inspired by, anywhere in the project. Build stage labels from the number at runtime.
  - `tests/unit/fairness.test.ts` scans every file outside `node_modules`, `.tools`, `.git`, `dist`, `dist-dev`, `test-results`, `qa-screenshots` and `private`, including this file and `docs/`.
  - It fails on the word "phase" directly followed by the number ten, in digits or in words, with or without a space, `_` or `-` between them.
  - So write "the final phase" or "the tenth phase", and never a stage label for it.
- **Never regenerate recorded material.** That covers the save fixtures in `tests/fixtures/pre-cr04/` and `tests/fixtures/pre-tower/`, and `public/art/tower-kit.json`. Never hand-edit generated reports (`SIMULATION*.md`, `tests/inventory.json`): rerun their scripts.

## Testing for iPhone

The player's iPhone can run an older WebKit than the Playwright suite, and passing on a newer engine doesn't prove iOS works. A bad element name once passed every test on WebKit 27.2 while the game showed a blank screen on iOS 26.

For changes to startup, layout or newer browser features, also test on an older WebKit. `playwright@1.56.1` ships WebKit 26.0. Install it outside the project. On Windows, its installer may hang while unpacking and its host check may fail, so unpack the downloaded archive by hand and set `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`.

Windows WebKit still isn't iOS Safari. For risky changes, tell the user what to check on the real iPhone, and report a change as unconfirmed until they have.

## Working alongside another agent

Codex is the primary development agent, and Claude Code is a secondary developer and auditor. Both may work on this machine.

- **Branches.** One agent writes to a branch at a time. Name branches by purpose, such as `feat/…`, `fix/…` or `chore/…`. Concurrent work goes in separate git worktrees, never two agents editing one checkout.
- **Test runs.** Never run two Playwright runs or gates at once in the same checkout. They share ports 4174 and 4175 and the `test-results/` folder. A worktree needs its own `qa-screenshots/cr01/baseline` copy, and links to `node_modules` and `private/`.
- **Performance stages.** Keep the machine quiet during a gate's performance stage. A laptop wake has caused a false 50 ms failure.
- **Handover.** Before handing work to the other agent, commit or describe the state in [docs/STATUS.md](docs/STATUS.md).
- **Attribution.** Each agent uses its own commit trailer, if it uses one at all.

## Where project knowledge lives

Each kind of fact has one home. Link to it rather than copying it.

| File | Owns |
|---|---|
| `AGENTS.md` | Instructions every agent follows |
| `CLAUDE.md` | Claude Code-only additions. It imports this file |
| [README.md](README.md) | Commands, code layout and architecture ("Major choices") |
| [TESTING.md](TESTING.md) | Test commands, the gate, Dev Mode, flaky and pre-existing failures, timings |
| [docs/RULES.md](docs/RULES.md) | Game rules, variants, the Glade's and the Tower's rules, and edge cases, as the code implements them |
| [docs/DESIGN.md](docs/DESIGN.md) | Visual conventions, motion, accessibility, and how art, sound and portraits are added |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions with their reasons, rejected approaches, and consequential history |
| [docs/STATUS.md](docs/STATUS.md) | What's shipped, unfinished work, open decisions, known issues and technical debt |
| [docs/AGENTS_TOOLING.md](docs/AGENTS_TOOLING.md) | Differences between agents' capabilities, and agent-specific setup |
| [CREDITS.md](CREDITS.md) | Asset sources and licenses. It matches the in-game Credits screen |
| `SIMULATION*.md` | Generated simulation reports |
| `private/` (untracked) | Specs, QA checklists, art references, and notes that can't be public |

## Keeping the docs current

- **Same commit.** Update the owning file in the same commit as the change that makes it stale.
- **Instructions here.** Agent-neutral instructions go in `AGENTS.md`. Never copy them into `CLAUDE.md` or another agent's file.
- **Decisions.** `docs/DECISIONS.md` is append-only. Add new entries at the end, with the date. To change a decision, add an entry that names the one it supersedes. Don't rewrite history.
- **Status.** Update `docs/STATUS.md` at the end of each task: what changed, what's unfinished, and what's unverified.
- **Confirmed or not.** Mark a fact *confirmed* only when it was checked against the code, a test run or the device. Otherwise mark it *unverified* and say why.
- **Private material.** Anything that can't be public goes in `private/` and is only named from tracked files.
- **Conflicts.** If two docs disagree, the code wins, then the newest dated entry. Fix the stale doc in your change and note it in `docs/STATUS.md`.
