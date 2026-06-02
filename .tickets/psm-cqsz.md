---
id: psm-cqsz
status: closed
deps: []
links: []
created: 2026-06-02T06:13:34Z
type: feature
priority: 2
assignee: ProbabilityEngineer
---
# List highest-message session per lineage

Add a CLI/script that lists only the highest message-count session for each named lineage so the user can pick which repo/session to resume.

## Acceptance Criteria

- Command/script scans Pi session files and lineage names without reading secrets beyond JSONL metadata/message counts.
- Output has one row per lineage/name with message count, age, cwd if derivable, and session path.
- Ranking chooses highest messageCount per lineage.
- TypeScript check passes.


## Notes

**2026-06-02T06:18:45Z**

Follow-up: changed lineages script to use Pi's SessionManager.listAll() metadata (`messageCount`, `modified`, `cwd`) instead of reading/counting session JSONL files itself, matching /resume semantics.
