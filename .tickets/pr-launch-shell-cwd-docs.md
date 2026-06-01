---
id: pr-launch-shell-cwd-docs
status: open
type: task
priority: 3
created: 2026-05-31T19:25:00Z
---
# Document shell cwd behavior for relocation restart scripts

Clarify why executing a restart script cannot permanently change the parent terminal shell cwd after Pi exits.

## Acceptance Criteria

- README explains parent shell vs child process cwd behavior.
- Docs distinguish:
  - executing `latest.sh`
  - copy/pasting `cd ...; pi --session ...`
  - sourcing shell functions/scripts
  - launching a new Terminal at target cwd
- Warn that `exec pi` in a script starts Pi in the script cwd but does not change the original shell after Pi exits.

## Boundary note

This is documentation for shell/process behavior. It should not be coupled to graph rendering or canonical store inference.
