@AGENTS.md

# Claude Code additions

`AGENTS.md`, imported above, holds every shared instruction. This file holds only what applies to Claude Code. Put new shared instructions in `AGENTS.md`, never here.

- Claude Code's plan files, session transcripts and auto-memory live under `~/.claude` on one machine. They aren't project knowledge, and the other agent can't see them. Record anything durable in the file `AGENTS.md` names for it, usually under `docs/`.
- In your role as auditor, check changes against `AGENTS.md`, the specs in `private/` and `docs/`. Report drift in `docs/STATUS.md`, and don't silently rewrite another agent's work.
- This project has no Claude Code hooks, skills, subagents, slash commands or MCP configuration. If you add one, record it in `docs/AGENTS_TOOLING.md`, with whether Codex has an equivalent.
