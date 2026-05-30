---
id: pr-bucket-relocate
status: open
deps: [pr-branch-mode]
links:
  - git:github.com/ProbabilityEngineer/agent-session-store
created: 2026-05-30T04:00:00Z
type: feature
priority: 2
assignee: ProbabilityEngineer
---
# Support repo/bucket batch relocation

Support moving all session files associated with a repo/cwd bucket when a repository moves to a new location. Originals should be marked superseded/deletion-candidate in the store, not deleted.

## Acceptance Criteria

- Command/design supports relocating all sessions in a source bucket to a destination bucket.
- Each copied session has a per-session relocation edge.
- Store records batch operation/provenance and marks old observations superseded/deletion-candidate.
- Dry-run or confirmation shows affected sessions before copying.
- No originals are deleted automatically.
- TypeScript check passes.
