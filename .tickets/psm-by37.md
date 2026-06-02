---
id: psm-by37
status: closed
deps: []
links: []
created: 2026-06-02T05:48:26Z
type: bug
priority: 1
assignee: ProbabilityEngineer
---
# Add missing tsx dev dependency

npm run migrate-paths uses tsx but package.json does not declare it, causing `sh: tsx: command not found` in fresh installs.

## Acceptance Criteria

- package.json declares tsx as a devDependency.
- package-lock.json is updated.
- npm run migrate-paths starts successfully without command-not-found.
- npm run build/lint if available passes, or TypeScript checks are validated.

