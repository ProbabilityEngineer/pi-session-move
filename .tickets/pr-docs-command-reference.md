---
id: pr-docs-command-reference
status: closed
deps: []
links: []
created: 2026-05-31T05:00:00Z
type: task
priority: 1
assignee: ProbabilityEngineer
---
# Document relocation command surface

Update README/HOWTO docs so the current command set is human-readable and discoverable.

## Commands to document

- `/relocate`
- `/relocate-bucket`
- `/relocate-repo`
- `/relocate-repos`
- `/relocate-prune`
- `/relocate-store-replay`
- `/relocate-status`
- `/relocate-lineage`

## Acceptance Criteria

- Docs explain session-only vs repo-moving commands.
- Docs explain move vs branch/copy semantics.
- Docs explain `--dry-run`, `--force`, `--launch`, and `--shutdown` where applicable.
- Docs explain prune safety model and that raw manifest is append-only.
- Docs include recommended workflows for one repo move, root repo move, replay, and pruning.
