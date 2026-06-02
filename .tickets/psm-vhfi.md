---
id: psm-vhfi
status: closed
deps: []
links: []
created: 2026-06-02T06:48:09Z
type: task
priority: 2
assignee: ProbabilityEngineer
---
# Ensure pil installs on PATH for Pi package users

Investigate and fix distribution/install behavior for the `pil` CLI. npm package bin entries work for normal npm installs, but Pi git package updates do not appear to create a PATH shim automatically. Decide whether to document npm/global install, add a Pi slash command fallback, or implement a safe shim strategy.

## Acceptance Criteria

- Verify behavior for `pi install git:...`, `pi install npm:...`, and normal `npm install -g`.
- Document supported install paths for `pil`.
- If Pi does not expose package bins, provide a user-facing alternative or installer guidance.
- Avoid unsafe postinstall behavior unless explicitly justified.

