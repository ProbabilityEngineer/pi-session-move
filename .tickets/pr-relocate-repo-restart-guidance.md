---
id: pr-relocate-repo-restart-guidance
status: open
type: bug
priority: 1
created: 2026-05-31T19:25:00Z
---
# Show restart/cd guidance after relocate-repo

`/relocate-repo` can move/record repo/session state without clearly updating or reminding about `~/.pi/agent/relocations/latest.sh`. This leaves users with stale restart scripts from prior `/relocate` runs.

## Acceptance Criteria

- After `/relocate-repo`, print explicit next commands including:
  - `cd <new-repo-path>`
  - `pi --session <relocated-session-file>` or equivalent current-session resume command
- Clearly state whether `latest.sh` was written/updated.
- If `latest.sh` is not updated by repo moves, say so and do not imply it is current.
- Include the standard reminder to inspect any generated script before running.

## Boundary note

This is relocate UX work. It should print restart/cd commands and accurately report script behavior. Canonical graph/store normalization belongs in `agent-session-store`; rendering belongs in `pi-session-graph`.
