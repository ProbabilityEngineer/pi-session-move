---
id: pr-relocate-repos-root
status: closed
deps: [pr-relocate-repo]
links: []
created: 2026-05-31T04:20:00Z
type: feature
priority: 2
assignee: ProbabilityEngineer
---
# Move a folder full of repos and relocate their session buckets

Add a root/batch command for moving child repo directories under one root to another root while relocating each child repo's session bucket.

## Acceptance Criteria

- Command supports dry-run first, e.g. `/relocate-repos --dry-run <old-root> <new-root>`.
- It maps child dirs `<old-root>/<name>` to `<new-root>/<name>`.
- It moves/copies repo directories only after confirmation.
- It relocates session buckets for child dirs that have sessions.
- It records batch/child batch ids in the store/manifest.
- Existing target child dirs fail or skip safely with clear report.
- TypeScript check passes.
