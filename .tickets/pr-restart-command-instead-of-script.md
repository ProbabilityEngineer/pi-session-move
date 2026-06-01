---
id: pr-restart-command-instead-of-script
status: closed
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
pi -c
```

- Explain that running this directly leaves the shell in the target cwd after Pi exits, unlike executing a separate script from an old cwd.
- Keep script generation for users who prefer it.
- Consider a `--no-script` or config option later, but do not remove existing script support.

## Boundary note

This ticket only changes restart UX. It should not remove raw manifest writes or canonical store replay responsibilities.


## Closure

Implemented copy-paste restart blocks for `/relocate`, `/relocate-bucket`, and current-session `/relocate-repo` moves. Notifications now print direct `cd` + `pi -c` commands first, keep `latest.sh` scripts as convenience artifacts, and explain why scripts cannot leave the original shell in the target cwd. README restart docs updated. Validated with `npx tsc --noEmit`.
