---
id: pr-promote-manifest-contract-fields
status: closed
type: task
priority: 1
created: 2026-06-01T00:00:00Z
---
# Emit top-level manifest contract fields

Future relocation manifest records should put fields used by replay/graph/status logic at top level rather than inside metadata.

## Candidate fields

- `operationType`: `session_relocation`, `bucket_relocation`, etc.
- `tool`: `pi-relocate`
- `mode`: `move` or `diverge`
- `batchId`
- event checkpoint fields such as `sourceLinesAtEvent` and `sourceBytesAtEvent` remain top-level

## Acceptance Criteria

- New `pi-relocate` records emit top-level `operationType` and `tool`.
- Batch/bucket relocation emits top-level `batchId` consistently.
- Readers tolerate historical records with missing top-level fields and metadata fallbacks.
- Do not rewrite `~/.pi/agent/relocations.jsonl`.
