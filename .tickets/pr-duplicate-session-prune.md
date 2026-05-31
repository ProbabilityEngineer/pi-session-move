---
id: pr-duplicate-session-prune
status: closed
deps: [pr-prune-superseded, pr-crawl-session-store-replay]
links: []
created: 2026-05-31T05:00:00Z
type: feature
priority: 1
assignee: ProbabilityEngineer
---
# Prune duplicate accumulated copies of the same session

Extend pruning to identify accumulated relocated copies of the same logical session, especially repeated `_relocated_` files in the same repo bucket.

## Proposed UX

- `/relocate-prune --duplicates --dry-run`
- `/relocate-prune --duplicates`

## Acceptance Criteria

- Groups candidates by provider session id when available, otherwise deterministic content/path evidence.
- Keeps current live session and latest active destination.
- Skips branch/copy records.
- Skips or manual-reviews files with post-relocation growth.
- Can use crawl-indexed observations, not only manifest records.
- Reports duplicate groups with keep/prune decisions before applying.
- TypeScript check passes.
