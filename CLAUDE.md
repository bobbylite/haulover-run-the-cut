@AGENTS.md

# Claude Code notes

- The skills in `.claude/skills/` load automatically when their description matches the work; invoke them
  explicitly (`/pastel-art-style`, `/playtest-and-verify`, `/add-game-mode`) when you want the full guide in context.
- Use the repo's own tools to see the game (`scripts/shot.mjs`, the agent API); read the PNGs with the Read tool.
- When you finish a unit of work, update `docs/ROADMAP.md` (status board, decision log, session log) in the same change.
- Commits carry the Claude co-author trailer from the harness; never Copilot's. Ask before force-pushing or publishing anything.
