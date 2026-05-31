---
id: pr-crawl-session-store-replay
status: closed
deps: []
links: []
created: 2026-05-31T05:00:00Z
type: feature
priority: 1
assignee: ProbabilityEngineer
---
# Add crawl mode to store replay/index all session files

Add an option to crawl the entire Pi session folder and add missing session observations to the canonical store without requiring a manifest record.

## Proposed UX

- `/relocate-store-replay --crawl-sessions`
- or `/relocate-store-index --crawl-sessions`

## Acceptance Criteria

- Recursively scans `~/.pi/agent/sessions/**/*.jsonl`.
- Adds missing session and observation rows to the SQLite store.
- Does not rewrite `~/.pi/agent/relocations.jsonl`.
- Does not invent lineage edges unless supported by manifest or deterministic relocation evidence.
- Marks unlinked observations as indexed/unlinked for manual review.
- Handles restored files from Trash once they are back under `~/.pi/agent/sessions`.
- TypeScript check passes.
