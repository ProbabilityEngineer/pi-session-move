---
id: psm-vu1w
status: closed
deps: []
links: []
created: 2026-06-02T06:25:53Z
type: feature
priority: 1
assignee: ProbabilityEngineer
---
# Make lineage CLI output compact and rename command

Rename the lineage listing CLI to `pil` and make default output legible by hiding long session paths unless requested.

## Acceptance Criteria

- package bin exposes `pil`.
- Default output is one compact row per lineage without long session path lines.
- A flag can show session paths when needed.
- Numeric selection still prints cd/pi commands.
- README updated and checks pass.

