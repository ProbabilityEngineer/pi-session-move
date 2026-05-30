---
id: psg-resume-availability
status: open
deps: []
links:
  - git:github.com/ProbabilityEngineer/agent-session-store
created: 2026-05-30T04:00:00Z
type: feature
priority: 2
assignee: ProbabilityEngineer
---
# Hide moved/superseded sessions from normal leaves

When canonical store exports observation availability, graph/status views should hide unavailable/superseded moved-source sessions from normal leaves and point to active replacements, while still allowing explicit recovery views.

## Acceptance Criteria

- Store-backed leaves distinguish active vs recoverable/unavailable sessions.
- Moved sources are not suggested as normal resume leaves.
- Recovery information remains accessible.
- TypeScript check passes.
