---
id: psm-vopq
status: closed
deps: []
links: []
created: 2026-06-01T22:39:33Z
type: feature
priority: 2
assignee: ProbabilityEngineer
tags: [paths, migration, session-move]
---
# Move session-move runtime files under session-move namespace

Tidy Pi agent files by moving new pi-session-move writes under ~/.pi/agent/session-move/ instead of scattering manifests and restart scripts at top level. Preserve legacy raw files as evidence and support dual-read during migration.

## Design

Use new default paths for future writes: ~/.pi/agent/session-move/manifests/relocations.jsonl, ~/.pi/agent/session-move/manifests/relocation-lineages.jsonl, and ~/.pi/agent/session-move/restart-scripts/. Keep reading legacy ~/.pi/agent/relocations.jsonl, ~/.pi/agent/relocation-lineages.jsonl, and ~/.pi/agent/relocations/ for status/lineage/prune. Do not rewrite or delete legacy files. Add clear status output noting legacy inputs when present.

## Acceptance Criteria

- New /move records append to ~/.pi/agent/session-move/manifests/relocations.jsonl.
- New /move-lineage --name records append to ~/.pi/agent/session-move/manifests/relocation-lineages.jsonl.
- New restart scripts are written under ~/.pi/agent/session-move/restart-scripts/.
- Status/lineage/prune merge or tolerate both legacy and new manifest paths.
- Legacy raw files are not mutated.
- npx tsc --noEmit passes.

