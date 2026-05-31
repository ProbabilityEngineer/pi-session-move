---
id: pr-normalize-dragged-paths
status: closed
deps: []
links: []
created: 2026-05-31T03:45:00Z
type: bug
priority: 1
assignee: ProbabilityEngineer
---
# Normalize dragged shell paths in relocation targets

Finder/terminal dragged paths may include shell backslash escapes such as `Mobile\ Documents` and `com\~apple\~CloudDocs`. Normalize these before resolving/statting target paths for `/relocate` and `/relocate-bucket`.

## Acceptance Criteria

- `/relocate` accepts quoted paths and dragged shell-escaped paths with spaces/tilde characters.
- `/relocate-bucket` accepts quoted paths and dragged shell-escaped paths with spaces/tilde characters.
- Existing valid paths without escapes are unchanged.
- TypeScript check passes.
