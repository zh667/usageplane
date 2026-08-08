# Agent Instructions

Use [CLAUDE.md](./CLAUDE.md) as the single source of truth for this repository's project guidance, architecture notes, and conventions.

Two load-bearing rules from CLAUDE.md worth repeating here because they were learned the hard way:

1. **设计决策先侦察上游** — before designing anything, read how TokenTracker (usage side) / all-api-hub (relay side) actually do it in `~/projects/reference/`.
2. **审计项校准** — external audit findings are not accepted at face value: verify each one is reproducible in OUR code, then check what upstream actually does about it. Hardening beyond upstream's own standard is by default "intentionally not done"; the three narrow exceptions are listed in CLAUDE.md.

If any project-specific instructions appear to conflict across files, follow `CLAUDE.md` and update this file only to keep that pointer intact.
