---
id: pr-relocate-repo
status: closed
deps: []
links: []
created: 2026-05-31T04:05:00Z
type: feature
priority: 1
assignee: ProbabilityEngineer
---
# Move repo directory and relocate its session bucket

Add `/relocate-repo` to move an actual repository directory on disk and then relocate all Pi session files in the old cwd bucket to the new cwd bucket.

## Acceptance Criteria

- `/relocate-repo --dry-run <source> <target>` previews repo and session movement without writing.
- `/relocate-repo <source> <target>` moves the repo directory and relocates bucket sessions.
- Existing target path fails safely.
- Original session files are not deleted.
- TypeScript check passes.
