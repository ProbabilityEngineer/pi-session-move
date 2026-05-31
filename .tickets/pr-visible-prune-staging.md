---
id: pr-visible-prune-staging
status: closed
deps: [pr-prune-superseded]
links: []
created: 2026-05-31T05:00:00Z
type: feature
priority: 2
assignee: ProbabilityEngineer
---
# Stage deletion candidates in a visible archive before Trash

Make deletion candidates human-visible by optionally moving them to a visible staging/archive area before final Trash.

## Proposed UX

- `/relocate-prune --stage --dry-run`
- `/relocate-prune --stage`
- existing `/relocate-prune` may remain Trash-based or become explicitly `/relocate-prune --trash`

## Proposed archive layout

`~/.pi/agent/session-archive/to-delete/<timestamp>/<bucket>/<file>.jsonl`

Include a manifest/report in each archive batch.

## Acceptance Criteria

- Stage mode preserves bucket/file relative paths.
- Stage mode writes a human-readable manifest/report.
- Stage mode records prune operation status as `staged` in SQLite.
- Staged files are outside active session buckets so Pi will not keep accumulating from them.
- Recovery instructions are documented.
- TypeScript check passes.
