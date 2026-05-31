---
id: pr-launch-terminal
status: closed
deps: []
links: []
created: 2026-05-31T03:45:00Z
type: feature
priority: 2
assignee: ProbabilityEngineer
---
# Launch relocated Pi in Terminal.app

Add an optional launch mode that opens the generated restart script in a generic macOS Terminal.app window/tab after relocation. Avoid Warp-specific behavior. Optionally support explicit shutdown of the old Pi process after launching.

## Acceptance Criteria

- `/relocate --launch <target>` opens Terminal.app running the generated restart script.
- `/relocate-bucket --launch <target>` opens Terminal.app running the latest restart script when appropriate.
- `--shutdown` requests `ctx.shutdown()` only after successful launch and only when explicitly supplied.
- Default behavior remains writing restart scripts and notifying the command.
- TypeScript check passes.
