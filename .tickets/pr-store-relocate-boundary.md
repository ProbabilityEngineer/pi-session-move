---
id: pr-store-relocate-boundary
status: open
deps: []
links:
  - ../agent-session-store/.tickets/ass-graph-export-contract.md
  - ../pi-session-graph/.tickets/psg-store-graph-boundary.md
created: 2026-06-01T14:35:00Z
type: task
priority: 1
assignee: ProbabilityEngineer
---
# Clarify relocate/store/graph boundaries

Clarify that `pi-relocate` records relocation/restart facts, `agent-session-store` normalizes/canonicalizes those facts, and `pi-session-graph` renders them.

## Boundary

`pi-relocate` owns:

- appending raw relocation/fork/repo-move intent records
- copying/moving session files when requested
- writing restart scripts and copy-paste restart commands
- friendly recovery/restart guidance

`agent-session-store` owns:

- replaying raw manifests into canonical store records
- observation availability/supersession marks
- compaction/fork/relocation edge normalization
- graph export contracts

`pi-session-graph` owns:

- visualizing relocation/fork/compaction edges and active leaves
- filtering/rendering graph exports

## Acceptance Criteria

- README/HOWTO boundary section exists.
- Open restart tickets mention copy-paste commands as UX, not graph/store responsibility.
- Store replay/export tickets remain linked to `agent-session-store`.
