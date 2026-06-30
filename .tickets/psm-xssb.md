---
id: psm-xssb
status: closed
deps: []
links: []
created: 2026-06-30T22:35:52Z
type: bug
priority: 2
assignee: ProbabilityEngineer
tags: [path-normalization, session-cwd, migration]
---
# Normalize duplicated home-prefix cwd paths in relocated sessions

Fix session move path handling so stale session cwd values like /Users/sam/users/sam/git/... are normalized to the real repo path, preventing 'Session cwd not found' prompts after moves. Add a migration/repair path for already-written bad buckets/session files if appropriate.

