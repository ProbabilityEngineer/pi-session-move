---
id: pr-4d3f
status: closed
deps: []
links: []
created: 2026-06-01T18:58:41Z
type: bug
priority: 1
assignee: ProbabilityEngineer
tags: [pi-move, session-bucket, repo-move]
---
# Relocate all source bucket sessions during repo move

`pi-move` /move should relocate every Pi session JSONL in the source cwd session bucket, not only the current live session. The repo directory move changes the cwd identity for the whole bucket; leaving older sessions behind makes history/status/replay incomplete.

## Design

When moving the current repo, enumerate all session files in the source cwd bucket before renaming the repo. For each file, write a relocated copy into the target cwd bucket and append a relocation manifest record. Mark the operation as a repo_move with tool pi-move and top-level sourceRepo/targetRepo fields. Track the current live session among the relocated files so success output can still provide compact restart guidance for the target cwd. Preserve raw source JSONLs; do not delete them.

## Acceptance Criteria

- /move <target> relocates all JSONL files from the source cwd bucket, not just ctx.sessionManager.getSessionFile().
- Current live session is included and restart guidance remains compact: cd '<target>'; pi -c.
- Manifest records are written for every relocated session with repo_move/top-level contract fields.
- Source session files are preserved.
- Failure output reports per-session failures without silently dropping non-current sessions.
- Existing hard blockers and dirty VCS confirmation behavior remain unchanged.

