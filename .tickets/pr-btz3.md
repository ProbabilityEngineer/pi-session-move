---
id: pr-btz3
status: closed
deps: []
links: []
created: 2026-06-01T16:31:44Z
type: bug
priority: 1
assignee: ProbabilityEngineer
---
# Expand tilde in relocation target paths

Relocating with a target like ~/git/agents/pi-mem-lite currently treats ~ as a literal relative path under the current cwd, producing paths such as <cwd>/~/git/agents/pi-mem-lite. Expand leading ~ to the user home directory before resolving targets, or reject unsupported tilde forms with a clear message.



## Closure

Implemented leading `~` expansion for relocation path arguments. `~` and `~/...` now resolve against `$HOME` before relative path resolution; unsupported forms such as `~user/...` produce a clear error. Applied to `/relocate`, `/relocate-repo`, `/relocate-repos-root`, and `/relocate-bucket`. Validated with `npx tsc --noEmit`.
