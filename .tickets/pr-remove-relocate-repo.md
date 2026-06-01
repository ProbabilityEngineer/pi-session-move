---
id: pr-remove-relocate-repo
status: closed
type: task
priority: 1
created: 2026-06-01T00:00:00Z
---
# Remove /relocate-repo commands from pi-relocate

`pi-repo-move` now owns filesystem repo moves. `pi-relocate` should focus on session relocation, lineage/status, bucket relocation, and prune/recovery UX.

## Acceptance Criteria

- Remove `/relocate-repo` command registration and implementation from `pi-relocate`.
- Remove `/relocate-repos` command registration and implementation if root/repo filesystem moves are moving to `pi-repo-move`.
- Update README/HOWTO command surface to point repo filesystem moves at `pi-repo-move` / `/repo-move <target>`.
- Remove or close obsolete repo-move restart guidance tickets that only apply to `/relocate-repo`.
- Preserve raw relocation manifest compatibility for historical repo-move records; do not rewrite `~/.pi/agent/relocations.jsonl`.
- Keep session-only relocation commands unchanged.

## Notes

No compatibility alias is required; this is personal tooling. Avoid Git/jj terminology unless semantics exactly match.
