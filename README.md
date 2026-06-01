# pi-session-move

Pi extension for moving the current Pi session context to another working directory. It does **not** move repositories on disk and does **not** invoke the LLM.

Filesystem repo moves live in `pi-repo-move` (`/repo-move <target>`).

## Install

```bash
pi install git:github.com/ProbabilityEngineer/pi-session-move
```

Local testing:

```bash
pi -e ./index.ts
```

## Commands

```text
/move [--launch] [--shutdown] [--diverge] [--verbose] [--force] <target-directory>
/move-status [--all]
/move-lineage [--files]
/move-lineage --name <lineage-name>
/move-prune [--dry-run] [--stage] [--duplicates] [--force]
```

## Which command should I use?

- Use `/move` to copy the current live session to another cwd bucket and write restart guidance.
- Use `pi-repo-move`'s `/repo-move <target>` to move the current repo directory on disk and relocate its session history.
- Use `/move-status` to inspect local session move state without installing store/graph tooling.
- Use `/move-lineage` to inspect or name the current session move lineage.
- Use `/move-prune --dry-run` to preview cleanup of superseded source session files.

Store rebuild/export/report workflows belong in `agent-session-store` and `pi-session-store`, not this extension.

## Move vs diverge

Default mode is move semantics: destination becomes active and the old source observation is marked `superseded` and `deletion_candidate` in the canonical store. The source JSONL is not deleted during session move.

Use `--diverge` when both source and destination should remain active. Diverge records do not become prune candidates.

## Restart and launch

Session moves write scripts under:

```text
~/.pi/agent/session-move/restart-scripts/
```

Legacy restart scripts under `~/.pi/agent/relocations/` remain readable historical evidence.

Restart manually with the copy-paste command printed by `/move`:

```bash
cd '<target-cwd>'
pi -c
```

The extension still writes convenience scripts under `~/.pi/agent/relocations/`, including:

```bash
bash ~/.pi/agent/session-move/restart-scripts/latest.sh
```

Prefer the direct `cd` + `pi -c` command when you want the terminal shell to remain in the target cwd after Pi exits. Running `latest.sh` starts Pi in the target cwd, but the script is a child process and cannot permanently change the original shell's cwd.

`--launch` opens Terminal.app running the restart script. `--shutdown` requests shutdown of the old Pi process only after a successful launch and only when explicitly supplied.

## Store and manifest

New session-move manifest:

```text
~/.pi/agent/session-move/manifests/relocations.jsonl
```

Legacy manifest still read for compatibility:

```text
~/.pi/agent/relocations.jsonl
```

Lineage names are written to:

```text
~/.pi/agent/session-move/manifests/relocation-lineages.jsonl
```

Legacy lineage names are still read from:

```text
~/.pi/agent/relocation-lineages.jsonl
```

Canonical SQLite store:

```text
~/.pi/agent/session-store/session-store.sqlite
```

The manifest is append-only and is not rewritten. This extension records session move/restart facts and keeps status, lineage, and prune self-contained for operational use. Canonical replay, rebuild, export, graphing, and reports live in `agent-session-store`, `pi-session-store`, and `pi-session-graph`.

## Pruning

Pruning is separate from moving the current session.

```text
/move-prune --dry-run
/move-prune --stage
/move-prune
```

Safe candidates require a replacement file, must not be the current live session, must not be diverge records, and must pass line/byte checkpoint checks when available.

`--stage` moves candidates to:

```text
~/.pi/agent/session-archive/to-delete/<timestamp>/<bucket>/<file>.jsonl
```

Without `--stage`, eligible files move to `~/.Trash`. Outcomes are recorded in SQLite `prune_operations` when the local canonical store is available.

`--duplicates` previews duplicate accumulated copies grouped by provider session id. Use `--force` with duplicate mode only after manual review.

## Status and lineage

`/move-status` shows current tracking, manifest counts, fork counts, unrecorded moved files, and the current lineage name when one exists. `/move-lineage --files` shows ancestry with source/destination paths.

Name the current lineage with:

```text
/move-lineage --name publish-pi-packages
```

Lineage names are metadata about the chain/family, not individual session names. They are stored separately from the append-only session-move manifest in:

```text
~/.pi/agent/session-move/manifests/relocation-lineages.jsonl
```

When Pi exposes session naming APIs, `/move-lineage --name` also appends the name to the current session display info.

## Legacy evidence copy

Legacy files are not rewritten or deleted. To copy old top-level relocation evidence into a tidy namespace for archival review, run:

```bash
npm run migrate-paths
```

This copies legacy manifests, backups, and restart scripts into:

```text
~/.pi/agent/session-move/legacy/
```

and writes checksums to `migration-manifest.jsonl`.

## Boundaries

- `pi-session-move`: current session moves, restart guidance, local status/lineage/prune.
- `pi-repo-move`: filesystem repo directory moves and repo bucket relocation.
- `agent-session-store` / `pi-session-store`: canonical rebuild/export/report workflows.
- `pi-session-graph`: visualization over prepared graph exports.
