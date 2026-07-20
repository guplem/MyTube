# AGENTS.md map with Claude-Code-only skills, subagents, and ADRs

## Context

The repo's agent instructions lived in a standalone `CLAUDE.md`, a file only Claude Code reads. Procedures (how to verify, how to shape a commit, how to create an issue) were inline or missing, and there was no `adr-checker` to keep the ADRs alive. This repo adopts a shared personal standard: a root `AGENTS.md` as the always-loaded map, on-demand skills, subagents for delegated checks, and living ADRs. The repo is developed with Claude Code only, so no multi-tool sync machinery is needed.

## Decision

- `AGENTS.md` at the repo root is the canonical, always-loaded map. `CLAUDE.md` is a one-line `@AGENTS.md` shim so Claude Code loads it. Tools that read `AGENTS.md` natively work without extra files.
- Areas that earn their own doc follow the same pattern: `<area>/AGENTS.md` holds the content, next to a one-line `<area>/CLAUDE.md` shim that makes Claude Code load it on demand when working in that area. The `adr/` directory is the first such area. A nested `AGENTS.md` without its shim never loads.
- Skills live committed directly at `.claude/skills/<name>/SKILL.md`. No `.agents/skills/` canonical tree, no gitignored mirror, no sync scripts.
- All skills are model-invocable (no `disable-model-invocation` frontmatter). The set is small, so the startup-context cost of their descriptions is low.
- Subagents live at `.claude/agents/<name>.md` (`pattern-scout`, `adr-checker`, `validate`, `docs-checker`).
- ADRs live in this single `adr/` directory, indexed as one-line rows in the root `AGENTS.md`, and are living documents updated in place. The folder's conventions live in `adr/AGENTS.md`, auto-loaded via its `adr/CLAUDE.md` shim.
- `.claude/settings.json` holds the permission allow/ask/deny lists and PostToolUse hooks (auto-format on edit, a warning when generated `dist/` output is edited).

**Rejected alternative:** keeping a standalone `CLAUDE.md` with every procedure inline. Rejected because procedures loaded on every session cost attention the agent could spend on the task, and only Claude Code reads that file; `AGENTS.md` is the open, tool-agnostic location.

## Consequences

**Positive:**

- One canonical copy of each instruction; the always-on context stays small because procedures load on demand as skills.
- No sync scripts or mirrors to maintain.

**Trade-offs and follow-up:**

- Skills, subagents, and settings are Claude-Code-only surfaces. If another agent tool is adopted, move skills to a canonical `.agents/skills/` tree with a gitignored `.claude/skills/` mirror and a sync script.
- If the number of skills grows enough that their always-loaded descriptions bloat startup context, add `disable-model-invocation: true` to the human-invoked ones and introduce an `/invoke` chaining skill.
