---
id: pr-diverge-mode-verbose-output
status: closed
type: feature
priority: 1
created: 2026-06-01T17:35:00Z
---
# Prefer diverge mode wording and compact relocate output

Use non-Git wording for source-preserving relocations. Replace user-facing `--branch` / `--copy` mode with `--diverge`, keep default `move`, and make `/relocate` success output compact by default with a `--verbose` mode for file/script details.

## Acceptance Criteria

- `/relocate --diverge <target>` keeps source active.
- `/relocate` no longer accepts `--branch` or `--copy` as mode flags.
- Default `/relocate` success output uses:

```text
Relocated → <target-cwd>

Run:
cd '<target-cwd>'
pi -c

mode: move · session name: <name>
```

- `/relocate --verbose <target>` includes relocated session file, path-string rewrite count, restart script, and latest.sh command.
- README documents `move` vs `diverge`.
- TypeScript check passes.

## Closure

Implemented in `index.ts` and `README.md`; validated with `npx tsc --noEmit`.
