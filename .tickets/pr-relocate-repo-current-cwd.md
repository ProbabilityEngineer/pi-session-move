---
id: pr-relocate-repo-current-cwd
status: closed
deps: [pr-relocate-repo]
links: []
created: 2026-05-31T04:20:00Z
type: feature
priority: 2
assignee: ProbabilityEngineer
---
# Allow relocate-repo to default source to current cwd

Make `/relocate-repo <target>` mean move the current cwd/repo to `<target>`, matching `/relocate-bucket` ergonomics. Keep `/relocate-repo <source> <target>` for explicit source moves.

## Acceptance Criteria

- One positional arg uses `ctx.cwd` as source and the arg as target.
- Two positional args use explicit source and target.
- Zero args show usage.
- Quoted/dragged paths with spaces still parse correctly.
- TypeScript check passes.
