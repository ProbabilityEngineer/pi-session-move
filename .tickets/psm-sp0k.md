---
id: psm-sp0k
status: closed
deps: []
links: []
created: 2026-06-02T17:29:09Z
type: task
priority: 2
assignee: ProbabilityEngineer
---
# Build JS dist for extension and pil CLI

Replace ad-hoc runtime JS/TS layout with a standard TypeScript build: source TS compiles to committed dist JS, package main/bin/pi manifest point at dist, and `pil` runs from built JS for npm and Pi git installs.

## Acceptance Criteria

- Add TS source layout or build config that emits dist JS and declarations.
- package.json main/types/bin/pi.extensions point to built dist files.
- `pil` runs from dist without tsx.
- Decide whether to commit dist for Pi git install reliability and document the choice.
- npm run build and validation pass.

