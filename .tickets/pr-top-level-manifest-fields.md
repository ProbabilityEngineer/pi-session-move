---
id: pr-top-level-manifest-fields
status: closed
type: task
priority: 2
created: 2026-06-01T00:00:00Z
---
# Tolerate top-level operation/tool fields in relocation manifests

Other suite tools such as `pi-repo-move` may append relocation records with first-class fields like `operationType`, `tool`, `sourceRepo`, and `targetRepo`.

## Acceptance Criteria

- Relocation manifest types tolerate top-level `operationType`, `tool`, `sourceRepo`, and `targetRepo`.
- Status/lineage/prune behavior remains compatible with historical records.
- `pi-relocate` does not rewrite existing raw manifest records.
- Session-only relocation commands may optionally emit `operationType: session_relocation` and `tool: pi-relocate` in future records.
