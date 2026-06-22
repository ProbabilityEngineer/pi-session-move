---
id: psm-fkjy
status: closed
deps: []
links: []
created: 2026-06-22T09:23:05Z
type: feature
priority: 1
assignee: ProbabilityEngineer
tags: [move, switchSession]
---
# Switch live Pi session after /move

After /move writes the rewritten moved session JSONL, switch the live Pi process into that moved copy with ctx.switchSession(destinationFile). Keep restart command/script as fallback and use withSession for post-switch notification to avoid stale contexts.

