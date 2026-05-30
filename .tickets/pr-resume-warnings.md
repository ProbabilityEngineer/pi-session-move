---
id: pr-resume-warnings
status: open
deps: [pr-branch-mode]
links:
  - git:github.com/ProbabilityEngineer/agent-session-store
created: 2026-05-30T04:00:00Z
type: task
priority: 2
assignee: ProbabilityEngineer
---
# Warn when current session has been moved/superseded

Use canonical store availability marks to warn when the current session is a moved/superseded source and point the user to the active destination or branch choices.

## Acceptance Criteria

- Status/lineage output reports when current session is unavailable/superseded.
- Output includes replacement destination when known.
- Explicit recovery remains possible; no raw sessions are deleted.
- TypeScript check passes.
