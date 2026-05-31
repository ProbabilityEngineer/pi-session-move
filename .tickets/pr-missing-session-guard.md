---
id: pr-missing-session-guard
status: closed
deps: []
links: []
created: 2026-05-31T03:45:00Z
type: bug
priority: 1
assignee: ProbabilityEngineer
---
# Show helpful error when current session file is missing

If `ctx.sessionManager.getSessionFile()` points to a nonexistent JSONL, `/relocate` should not throw raw ENOENT. Show a clear recovery message explaining that the live Pi process has a stale/missing session file and suggesting `/session`, `/relocate-lineage --files`, or starting a fresh Pi session in the target directory.

## Acceptance Criteria

- `/relocate` checks current session file existence before reading.
- Missing file produces a friendly error with the missing path and recovery suggestions.
- Raw session files are not modified.
- TypeScript check passes.
