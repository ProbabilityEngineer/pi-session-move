---
id: psm-tm7v
status: closed
deps: []
links: []
created: 2026-06-01T22:39:40Z
type: task
priority: 3
assignee: ProbabilityEngineer
tags: [migration, legacy, evidence]
---
# Add copy-only legacy session-move path migration

Provide a safe migration/report for users who want to tidy legacy relocation files without rewriting or deleting raw evidence.

## Design

Add a non-destructive migration command or script that copies legacy ~/.pi/agent/relocations.jsonl, ~/.pi/agent/relocation-lineages.jsonl, relocation backups, and restart scripts into ~/.pi/agent/session-move/legacy/ with checksums and a manifest. Do not remove originals. Make it explicit/manual, not automatic.

## Acceptance Criteria

- Migration is copy-only and idempotent.
- Copies legacy manifests/backups/scripts under ~/.pi/agent/session-move/legacy/.
- Writes a migration manifest with source path, destination path, byte count, sha256, and timestamp.
- Does not rewrite, truncate, or delete legacy evidence.
- Status can report whether legacy files have been copied.
- npx tsc --noEmit passes.

