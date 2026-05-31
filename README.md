# pi-relocate

Pi extension for moving Pi session context when projects move. It can relocate the current session, whole session buckets, actual repo directories, or roots full of repos. It does **not** invoke the LLM.

## Install

```bash
pi install git:github.com/ProbabilityEngineer/pi-relocate
```

Local testing:

```bash
pi -e ./index.ts
```

## Commands

```text
/relocate [--launch] [--shutdown] [--branch] [--force] <target-directory>
/relocate-bucket [--dry-run] [--launch] [--shutdown] [--branch] [--force] <target-directory>
/relocate-repo [--dry-run] [--branch] [--force] <target-repo>
/relocate-repo [--dry-run] [--branch] [--force] <source-repo> <target-repo>
/relocate-repos [--dry-run] [--branch] [--force] <old-root> <new-root>
/relocate-prune [--dry-run] [--stage] [--duplicates] [--force]
/relocate-store-replay [--crawl-sessions]
/relocate-status [--all]
/relocate-lineage [--files]
```

## Which command should I use?

- Use `/relocate` to copy only the current live session to another cwd bucket and write a restart script.
- Use `/relocate-bucket` when the repo/cwd already moved and all sessions in the old bucket should point at the new cwd.
- Use `/relocate-repo <target>` to move the current repo directory on disk and relocate its session bucket.
- Use `/relocate-repo <source> <target>` to move an explicit repo directory and relocate its session bucket.
- Use `/relocate-repos <old-root> <new-root>` to move immediate child repos from one root to another.
- Use `/relocate-prune --dry-run` to preview cleanup of superseded source session files.
- Use `/relocate-store-replay --crawl-sessions` after restoring files or rebuilding the store.

## Move vs branch

Default mode is move semantics: destination becomes active and the old source observation is marked `superseded` and `deletion_candidate` in the canonical store. The source JSONL is not deleted during relocation.

Use `--branch`/`--copy` when both source and destination should remain active. Branch records do not become prune candidates.

## Restart and launch

Relocation writes scripts under:

```text
~/.pi/agent/relocations/
```

Restart manually with:

```bash
bash ~/.pi/agent/relocations/latest.sh
```

`--launch` opens Terminal.app running the restart script. `--shutdown` requests shutdown of the old Pi process only after a successful launch and only when explicitly supplied.

## Store and manifest

Raw manifest:

```text
~/.pi/agent/relocations.jsonl
```

Canonical SQLite store:

```text
~/.pi/agent/session-store/session-store.sqlite
```

The manifest is append-only and is not rewritten. `/relocate-store-replay` replays manifest records into SQLite. With `--crawl-sessions`, it also indexes every `~/.pi/agent/sessions/**/*.jsonl` as an observation without inventing lineage edges.

Replay understands mixed session filename formats, including base session files, modern `_relocated_<timestamp>` suffixes, and older `_relocated_<cwd-slug>_<timestamp>` suffixes. If filename parsing fails, store keys still fall back to full file path.

## Pruning

Pruning is separate from relocation.

```text
/relocate-prune --dry-run
/relocate-prune --stage
/relocate-prune
```

Safe candidates require a replacement file, must not be the current live session, must not be branch/copy records, and must pass line/byte checkpoint checks when available.

`--stage` moves candidates to:

```text
~/.pi/agent/session-archive/to-delete/<timestamp>/<bucket>/<file>.jsonl
```

Without `--stage`, eligible files move to `~/.Trash`. Outcomes are recorded in SQLite `prune_operations`.

`--duplicates` previews duplicate accumulated copies grouped by provider session id. Use `--force` with duplicate mode only after manual review.

## Status and lineage

`/relocate-status` shows current tracking, manifest counts, fork counts, and unrecorded relocated files. `/relocate-lineage --files` shows ancestry with source/destination paths.

Agents can use the read-only tool:

```text
relocate action: status/lineage
```

## Notes

- Raw session JSONLs are never modified in place.
- Relocated sessions are JSONL copies with path string replacements.
- Compaction appends summary entries; it does not shrink the JSONL.
- Active Git/code repos are best kept local; cloud folders are better for small archives/reference material.
