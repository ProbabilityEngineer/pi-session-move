---
id: psm-pqkw
status: closed
deps: []
links: []
created: 2026-08-30T01:00:28Z
type: bug
priority: 1
assignee: ProbabilityEngineer
tags: [npm, metadata, pi.dev, dependencies]
---
# Fix pi-session-move license metadata and Pi core dependency declaration

Repair the npm manifest so Pi.dev recognizes the MIT license and installed extensions resolve Pi core APIs from the active host instead of vendoring an obsolete nested copy.

## Acceptance Criteria

npm metadata reports MIT; @earendil-works/pi-coding-agent and typebox are peer dependencies with development-only copies for typechecking; package install does not contain nested Pi core dependency; lint/build/package checks pass; a patch release is published.
