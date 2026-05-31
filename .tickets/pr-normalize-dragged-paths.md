---
id: pr-normalize-dragged-paths
status: open
deps: []
links: []
created: 2026-05-31T03:20:00Z
type: task
priority: 2
assignee: ProbabilityEngineer
---
# Normalize dragged shell-escaped paths in relocate commands

Finder/terminal dragged paths may include shell escapes such as `Mobile\ Documents` and `com\~apple\~CloudDocs`. Normalize these before resolving/statting target paths in all relevant relocate commands.

Apply to:

- `/relocate`
- `/relocate-bucket`
- future multi-repo/root relocation commands

## Acceptance Criteria

- Dragged macOS paths with escaped spaces, tildes, parentheses, ampersands, and quotes are normalized before path resolution.
- Quoted paths without backslashes continue to work.
- Existing real paths containing no shell escapes are unchanged.
- Existing non-directory targets still fail appropriately.
- TypeScript check passes.
