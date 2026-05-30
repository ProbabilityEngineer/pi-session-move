---
id: pr-branch-mode
status: open
deps: []
links:
  - git:github.com/ProbabilityEngineer/agent-session-store
created: 2026-05-30T04:00:00Z
type: feature
priority: 1
assignee: ProbabilityEngineer
---
# Add explicit branch/copy mode for relocation

Default relocation should be move semantics: source observation is superseded/unavailable in the canonical store and destination becomes active. Add explicit branch/copy mode to keep both source and destination active when the user intentionally wants a fork.

## Acceptance Criteria

- `/relocate <target>` records move semantics in the store.
- `/relocate --branch <target>` or equivalent records branch/fork semantics.
- Raw `relocations.jsonl` remains append-only and backward compatible, with intent metadata if safe.
- Store write marks source availability appropriately without deleting files.
- README documents move vs branch behavior.
- TypeScript check passes.
