---
id: psg-thread-resume
status: closed
deps: [psg-logical-threads]
links:
  - git:github.com/ProbabilityEngineer/agent-session-store
created: 2026-05-30T04:00:00Z
type: feature
priority: 3
assignee: ProbabilityEngineer
---
# Show logical thread resume targets

When store exports logical threads and active leaves, graph/status commands should show the deterministic resume target for a thread, branch choices when multiple active leaves exist, or recovery/checkpoint options when none are active.

## Acceptance Criteria

- Thread views show one active resume target, multiple branch choices, or no-active-leaf recovery/checkpoint guidance.
- Raw session-file views remain available.
- TypeScript check passes.
