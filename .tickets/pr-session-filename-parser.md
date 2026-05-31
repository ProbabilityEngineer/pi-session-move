---
id: pr-session-filename-parser
status: closed
deps: []
links: []
created: 2026-05-31T05:00:00Z
type: task
priority: 1
assignee: ProbabilityEngineer
---
# Robustly parse mixed Pi session filename formats

Session filenames have multiple historical relocation formats. Replay/crawl/prune should parse IDs and labels robustly, and fall back safely when names are not human-readable.

## Known examples

Modern relocated suffix:

`/Users/sam/.pi/agent/sessions/--Users-sam-git-agents-pi-relocate--/2026-05-22T17-07-22-632Z_019e50a7-eb88-7c4e-ba2b-237de47e5758_relocated_2026-05-27T18-55-35-686Z.jsonl`

Base session file:

`/Users/sam/.pi/agent/sessions/--Users-sam-git-agents-pi-relocate--/2026-05-22T13-36-42-590Z_019e4fe7-0c5e-71c0-aafd-54dfe6bde592.jsonl`

Older relocated suffix with cwd slug embedded:

`/Users/sam/.pi/agent/sessions/--Users-sam-git-agents-pi-relocate--/2026-05-22T11-25-52-253Z_019e4f6f-42fd-7093-a3bc-db72c1e166c1_relocated_Users-sam-git-agents-pi-relocate_2026-05-22T11-38-40-984Z.jsonl`

## Acceptance Criteria

- Extracts provider session UUID from all known formats.
- Extracts base timestamp when present.
- Recognizes relocated suffix timestamp when present.
- Handles older `_relocated_<cwd-slug>_<timestamp>` format.
- Falls back to path/hash/content metadata if filename parse fails.
- Adds testable helper functions rather than repeating regexes inline.
- TypeScript check passes.
