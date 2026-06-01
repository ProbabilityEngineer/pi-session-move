---
id: pr-restart-command-instead-of-script
status: open
type: feature
priority: 2
created: 2026-05-31T19:25:00Z
---
# Offer copy-paste restart commands, not only latest.sh

Users often copy/paste the script path anyway. Provide directly copyable shell commands so scripts are optional.

## Acceptance Criteria

- `/relocate` and related commands print a compact copy-paste block:

```bash
cd '<target-cwd>'
pi --session '<session-file>'
```

- Explain that running this directly leaves the shell in the target cwd after Pi exits, unlike executing a separate script from an old cwd.
- Keep script generation for users who prefer it.
- Consider a `--no-script` or config option later, but do not remove existing script support.

## Boundary note

This ticket only changes restart UX. It should not remove raw manifest writes or canonical store replay responsibilities.
