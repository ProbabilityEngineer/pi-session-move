---
id: pr-9u9a
status: closed
deps: []
links: []
created: 2026-05-27T19:15:07Z
type: feature
priority: 1
assignee: ProbabilityEngineer
---
# Write short relocation restart scripts

Have /relocate write short restart scripts so users do not need to copy long wrapped pi --session commands.

## Acceptance Criteria

/relocate writes timestamped and latest restart scripts under ~/.pi/agent/relocations; notification shows short bash command; TypeScript check passes.

