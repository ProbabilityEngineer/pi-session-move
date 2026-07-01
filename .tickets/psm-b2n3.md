---
id: psm-b2n3
status: closed
deps: []
links: []
created: 2026-07-01T00:52:26Z
type: bug
priority: 2
assignee: ProbabilityEngineer
tags: [session-move, move, missing-session-file]
---
# Handle /move when current session file is missing

Investigate and fix /move failure when the live Pi session points to a missing JSONL file under ~/.pi/agent/sessions. User sees 'Current Pi session file is missing; cannot move this live process.' after prior session relocations or cleanup.

