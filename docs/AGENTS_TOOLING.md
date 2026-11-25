# Agent tooling and capability differences

How each coding agent picks up this project, and what one agent has that the other doesn't. Shared instructions are in [AGENTS.md](../AGENTS.md). This file only records differences.

## How each agent loads instructions

| | Codex | Claude Code |
|---|---|---|
| Instruction file | Reads `AGENTS.md` directly | Reads `CLAUDE.md`, which imports `AGENTS.md` with `@AGENTS.md` and adds Claude-only notes |
| Role | Primary development agent | Secondary developer and auditor |

## Project-level agent configuration

As of 2026-11-25 this was *confirmed* empty:

- No `.claude/` folder: no settings, hooks, skills, subagents, slash commands or MCP servers.
- No Codex configuration in the repo.
- No user-level Claude hooks, skills or plugins tied to this project.

Nothing here depends on one agent's tooling, and nothing needed porting. If either agent gains project configuration, list it below, with whether the other agent has an equivalent.

## Claude Code capabilities that Codex doesn't inherit

None of these is needed to build, test or ship the game, so none is recreated for Codex.

- **Plan files, transcripts and auto-memory** (`~/.claude/`). They're local to one machine and one agent. Earlier work, including the Tower build, was planned there, and the durable parts of those plans are now in `docs/`. Don't cite those files from tracked docs.
- **Desktop-app features:** the built-in browser pane, preview servers from `.claude/launch.json` (there's none in this project), worktree sessions and published Artifacts. Anything they verify can also be verified with the project's own Playwright scripts.
- **Commit attribution.** Claude Code adds its own `Co-Authored-By` trailer. Codex uses its own or none, and neither copies the other's.

## Agent-neutral helpers that live in `private/`

These were written by an agent during the Tower build. They work with any agent, but they're untracked, and so only present where `private/` is:

- `private/tower-tools/gate-check.mjs` checks a gate's failures against the accepted pre-existing list.
- `overlay.sh` and `snapshot.sh` build a commit tree from chosen working-tree paths, for gating a snapshot in a second checkout.
- `peek.mjs`, `gaps.mjs` and `frames*.mjs` take screenshots and probe performance against a dev build served on port 4173.

## Codex-side assumptions to verify

These are *unverified*. Check them on the first Codex run, then record the results here.

- **Long runs.** The gate runs for about 20 minutes, and the Tower simulation for longer. Codex has to allow a command that long, or run it in the background.
- **Browser install.** `npx playwright install webkit chromium`, and the older WebKit 26.0 install for iPhone checks, both download browsers, so they need network access.
- **Private files.** Codex has to be able to read `private/`, which holds the specs, the Dev Mode word file and the art references.
- **Port binding.** The browser tests start local servers on ports 4173–4175, so Codex has to be allowed to bind them.
