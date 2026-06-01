---
id: pr-na90
status: open
deps: []
links: []
created: 2026-06-01T19:47:59Z
type: bug
priority: 1
assignee: ProbabilityEngineer
tags: [resume, pi-c, session-relocation]
---
# Keep pi -c deterministic after session relocation

Relocation restart guidance should keep using compact cd '<target>'; pi -c while making Pi resume the intended relocated current session, without exposing long --session paths.

## Acceptance Criteria

- /relocate and /relocate-bucket keep compact restart guidance.\n- pi -c resumes the intended relocated current session.\n- Long session file paths are not printed in normal output.\n- npx tsc --noEmit passes.

