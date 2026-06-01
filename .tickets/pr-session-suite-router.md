---
id: pr-session-suite-router
status: open
deps: []
links:
  - ../pi-session-relocate
  - ../pi-session-repo-move
created: 2026-05-31T15:10:00Z
type: task
priority: 1
assignee: ProbabilityEngineer
---
# Split/alias pi-relocate into pi-session-relocate and pi-session-repo-move

Reduce slash command confusion by separating session relocation from actual repo movement while preserving compatibility.

## Acceptance Criteria

- New repo/package plan exists for `pi-session-relocate` and `pi-session-repo-move`.
- Session-only commands move to/are aliased by `pi-session-relocate`.
- Actual filesystem repo move commands move to/are aliased by `pi-session-repo-move`.
- Existing `/relocate*` commands remain compatibility aliases during migration.
- Docs emphasize checking `~/.pi/agent/relocations/latest.sh` before restart.

## Boundary note

Session relocation commands should move toward `pi-session-relocate`; filesystem repo move commands should move toward `pi-session-repo-move`; canonical store building remains `agent-session-store`/`pi-session-store`; visualization remains `pi-session-graph`.
