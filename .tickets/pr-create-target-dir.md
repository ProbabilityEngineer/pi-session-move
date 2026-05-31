---
id: pr-create-target-dir
status: closed
deps: []
links: []
created: 2026-05-30T04:40:00Z
type: feature
priority: 2
assignee: ProbabilityEngineer
---
# Create missing target directory for relocation commands

Allow `/relocate` and `/relocate-bucket` to create the target directory when it does not exist, instead of failing with `Not a directory`.

For safety, prompt before creating unless `--force` is supplied. The confirmation should clearly show the directory to be created and, for bucket relocation, the number of sessions that will be copied after creation.

## Acceptance Criteria

- `/relocate <missing-target>` prompts to create the directory, then continues after creation.
- `/relocate-bucket <missing-target>` prompts to create the directory, then continues after creation.
- `--force` creates the missing target directory without an extra prompt.
- If the target exists but is not a directory, relocation still fails.
- Dry-run bucket relocation reports that the directory would be created but does not create it.
- TypeScript check passes.
