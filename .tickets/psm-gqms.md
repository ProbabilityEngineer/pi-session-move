---
id: psm-gqms
status: closed
deps: []
links: []
created: 2026-06-02T06:34:08Z
type: bug
priority: 1
assignee: ProbabilityEngineer
---
# Partition pil rows by nearest lineage name

`pil` currently lets older/overlapping lineage names inherit later descendants, so distinct labels like Ariadne, session-suite-worker, and agent-session-store-suite-work can show the same best session. Partition sessions by nearest pinned lineage name so rows represent distinct named branches.

## Acceptance Criteria

- `pil` assigns a session to the nearest pinned lineage name on its ancestry chain.
- Earlier lineage names no longer inherit descendants after a later branch/name pin.
- Default output avoids duplicate best-session rows caused by overlapping names.
- Validation passes.

