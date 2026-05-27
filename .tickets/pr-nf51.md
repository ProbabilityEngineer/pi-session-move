---
id: pr-nf51
status: closed
deps: []
links: []
created: 2026-05-27T21:08:09Z
type: feature
priority: 1
assignee: ProbabilityEngineer
---
# Record Pi session IDs in relocation lineage

Record source/destination session IDs now that Pi 0.76 supports explicit --session-id, while keeping path-based restart scripts until file mapping is verified.

## Acceptance Criteria

Relocation manifest records session IDs when available; status/lineage display them in --all/--files output; restart scripts still use --session path; TypeScript check passes.

