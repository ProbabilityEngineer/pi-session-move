---
id: pr-4amn
status: closed
deps: []
links: []
created: 2026-06-01T19:49:05Z
type: bug
priority: 1
assignee: ProbabilityEngineer
tags: [filenames, relocation]
---
# Bound relocated session filenames

Relocated session filenames append _relocated_<timestamp> repeatedly, making names grow across relocations and risking filesystem/path length failures. Generate bounded names with a truncated base and short hash suffix; keep event timestamps in manifest records.

## Acceptance Criteria

- New pi-relocate relocated filenames do not include relocated timestamps.\n- Filename length remains bounded across repeated relocations.\n- Manifest records still contain event timestamps.\n- npx tsc --noEmit passes.

