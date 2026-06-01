---
id: pr-session-suite-router
status: open
deps: []
links:
  - ../pi-session-relocate
  - ../pi-repo-move
created: 2026-05-31T15:10:00Z
type: task
priority: 1
assignee: ProbabilityEngineer
---
# Split/alias pi-relocate into pi-session-relocate and pi-repo-move

Reduce slash command confusion by separating session relocation from actual repo movement while preserving compatibility.

## Acceptance Criteria

- New repo/package plan exists for `pi-session-relocate` and `pi-repo-move`.
- Session-only commands move to/are aliased by `pi-session-relocate`.
- Actual filesystem repo move commands move to/are handled by `pi-repo-move`.
- Existing `/relocate*` commands remain compatibility aliases during migration.
- Docs emphasize checking `~/.pi/agent/relocations/latest.sh` before restart.

## Boundary note

Session relocation commands should move toward `pi-session-relocate`; filesystem repo move commands are handled by `pi-repo-move`; canonical store building remains `agent-session-store`/`pi-session-store`; visualization remains `pi-session-graph`.

## Slash command policy

Reduce top-level relocation command clutter over time. Prefer namespaced commands in the new packages:

```text
/session-relocate status
/session-relocate lineage
/session-relocate current <target>
/session-relocate bucket <target>
/session-relocate prune --dry-run
/session-repo move <target>
/session-repo move <source> <target>
/session-repo move-root <old-root> <new-root>
```

Existing `/relocate*` commands should remain compatibility aliases during migration, but docs should present namespaced commands first once the split packages exist.
