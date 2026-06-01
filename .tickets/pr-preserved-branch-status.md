---
id: pr-preserved-branch-status
status: open
type: feature
priority: 1
created: 2026-06-01T15:55:00Z
links:
  - ../agent-session-store/.tickets/ass-curated-branch-preserve-mark.md
---
# Respect curated preserve marks in relocate status

`agent-session-store` now imports curated observation marks from `~/.pi/agent/session-store/observation-marks.jsonl` and exports `preservedBranches`. `/relocate-status` should honor those marks so intentional branches are not presented as ordinary deletion candidates.

## Acceptance Criteria

- `/relocate-status` detects `preserve` / `intentional_branch` marks for the current session observation when canonical store data is available.
- If a session has both `deletion_candidate`/`superseded` and a preserve mark, show it as a preserved intentional branch rather than warning as a normal deletion candidate.
- Display the preserved branch label, e.g. `Ariadne branch`, reason, and provenance.
- Do not mutate raw session JSONLs or raw relocation manifests.
- Prune/recovery guidance says preserved branches are skipped unless explicitly forced.
