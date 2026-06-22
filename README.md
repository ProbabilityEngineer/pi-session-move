# pi-session-move

> One of my diet context engineering and workflow extensions. Add pi-diet-LSP, pi-diet-Ripgrep, pi-repo-move and others from [npm](https://www.npmjs.com/~probabilityengineer).

Pi extension for moving the current Pi session context to another working directory. It does **not** move repositories on disk and does **not** invoke the LLM.

Filesystem repo moves live in `pi-repo-move` (`/repo-move <target>`).

## Install

Install from npm:

```bash
pi install npm:pi-session-move
```

Install from GitHub:

```bash
pi install git:github.com/ProbabilityEngineer/pi-session-move
```

This package ships committed `dist/` JavaScript so Pi git installs can load the extension and `pil` CLI without running TypeScript directly. Package entry points are:

```text
pi extension: ./dist/index.js
CLI bin:      ./dist/scripts/list-lineage-resume.js
```

The package also includes a small CLI, `pil`, for listing the highest-message session in each named lineage and launching Pi from the selected row. Normal npm installs expose package `bin` entries on PATH:

```bash
npm install -g pi-session-move
which pil
```

With npm, the `pil` shim is written to npm's global bin directory, normally:

```text
$(npm prefix -g)/bin/pil
```

For example with nvm this may be:

```text
~/.nvm/versions/node/<version>/bin/pil
```

Pi git package installs currently clone the package under:

```text
~/.pi/agent/git/github.com/ProbabilityEngineer/pi-session-move/
```

but Pi does not currently guarantee that package `bin` entries are linked onto your shell PATH. If you install via Pi git and want `pil` globally, create a user shim in a PATH directory such as `~/.pi/agent/bin`:

```bash
mkdir -p ~/.pi/agent/bin
ln -sfn ~/.pi/agent/git/github.com/ProbabilityEngineer/pi-session-move/dist/scripts/list-lineage-resume.js ~/.pi/agent/bin/pil
```

Ensure this is in your shell startup PATH:

```bash
export PATH="$HOME/.pi/agent/bin:$PATH"
```

Local testing:

```bash
npm run build
pi -e ./dist/index.js
```

## Commands

```text
/move [--launch] [--shutdown] [--diverge] [--verbose] [--force] <target-directory>
/lineage-name <lineage-name>
/move-prune [--dry-run] [--stage] [--duplicates] [--force]
```

## Assistant diagnostic tool

The extension also exposes an assistant-only `session_move` tool for raw move-manifest diagnostics:

```text
session_move status
session_move lineage
```

This is not a user slash command. User-facing actions are `/move`, `/lineage-name`, and `/move-prune`.

## Which command should I use?

- Use `/move` to copy the current live session to another cwd bucket and write restart guidance.
- Use `pi-repo-move`'s `/repo-move <target>` to move the current repo directory on disk and preserve its session history.
- Use `/lineage-name <name>` to pin a durable name for the current lineage branch.
- Use `/move-prune --dry-run` to preview cleanup of superseded source session files.

Use `pi-session-graph`'s `/session-status` and `/session-lineage` for read-only session status/lineage. Store rebuild/export/report workflows belong in the `agent-session-store` CLI, not this extension.

## Move vs diverge

Default mode is move semantics: destination becomes active and the old source observation is marked `superseded` and `deletion_candidate` in the canonical store. The source JSONL is not deleted during session move.

Use `--diverge` when both source and destination should remain active. Diverge records do not become prune candidates.

## Restart and launch

Session moves write scripts under:

```text
~/.pi/agent/session-move/restart-scripts/
```

Legacy restart scripts under `~/.pi/agent/relocations/` remain readable historical evidence.

After writing the moved session JSONL copy, `/move` calls Pi's `ctx.switchSession(...)` and switches the live Pi process into that moved copy.

If a switch hook cancels the session switch, or if you need a manual fallback later, use the printed copy-paste command:

```bash
cd '<target-cwd>'
pi -c
```

The extension still writes convenience scripts, including:

```bash
bash ~/.pi/agent/session-move/restart-scripts/latest.sh
```

`/move` touches the moved current-session JSONL after copying it so Pi's `pi -c` most-recent-session lookup selects that session in the target cwd bucket without printing a long `--session` path in normal output.

Prefer the direct `cd` + `pi -c` fallback command when you want the terminal shell to remain in the target cwd after Pi exits. Running `latest.sh` starts Pi in the target cwd, but the script is a child process and cannot permanently change the original shell's cwd. The script uses `exec pi --session <moved-file>` internally for exactness; `exec` replaces only the script process, not your parent shell. Sourcing a shell function/script could change the parent shell cwd, but this extension does not emit sourceable shell code because restart scripts are meant to be safe to run as child processes.

`--launch` opens a new Terminal.app window running the restart script in the target cwd as an extra fallback. Because `/move` now switches the current Pi process into the moved copy, `--shutdown` is ignored after launch.

## Store and manifest

New session-move manifest:

```text
~/.pi/agent/session-move/manifests/relocations.jsonl
```

Deprecated legacy manifest still read for compatibility:

```text
~/.pi/agent/relocations.jsonl
```

Lineage names are written to:

```text
~/.pi/agent/session-move/manifests/relocation-lineages.jsonl
```

Deprecated legacy lineage file is still read for compatibility:

```text
~/.pi/agent/relocation-lineages.jsonl
```

Canonical SQLite store:

```text
~/.pi/agent/session-store/session-store.sqlite
```

The manifest is append-only and is not rewritten. This extension records session move/restart facts and keeps move, lineage naming, and prune self-contained for operational use. Canonical replay, rebuild, export, graphing, and reports live in `agent-session-store` and `pi-session-graph`.

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

## Lineage names

Name the current lineage branch with:

```text
/lineage-name publish-pi-packages
```

Lineage names are pinned metadata about the chain/family, not raw proof of identity and not merely an individual session filename. They are stored separately from the append-only session-move manifest in:

```text
~/.pi/agent/session-move/manifests/relocation-lineages.jsonl
```

When Pi exposes session naming APIs, `/lineage-name` also appends the pinned lineage name to the current session display info so the durable lineage label and Pi's current-session display name stay synced. If no pinned lineage name exists, session moves may auto-pin a usable current Pi session display name; when a lineage branches, use `/lineage-name <branch-name>` to pin the branch-specific name.

List the highest-message surviving session for each named lineage with:

```bash
pil
```

Show CLI help or version with:

```bash
pil --help
pil --version
# or: pil -V
```

From the source checkout, the equivalent npm script is:

```bash
npm run lineages
```

The output shows one compact row per lineage with Pi's own resume message count, age, and resume cwd, then prompts for a row number and launches `pi --session` in that cwd. Use `--files` to include full session paths.

To print shell commands instead of launching Pi:

```bash
pil --print 1
# or: npm run lineages -- --print 1
```

`pil --help` shows:

```text
Usage: pil [options] [lineage-number]

Options:
  --files             Show session file paths
  --print, --command  Print the resume command instead of launching Pi
  --limit=<n>         Limit displayed rows
  -h, --help          Show this help
  -V, --version       Show version
```

## Legacy evidence migration

Deprecated legacy files are not rewritten or deleted by default. To copy old top-level move evidence into the canonical `session-move` namespace, run:

```bash
npm run migrate-paths
```

After review, you can move the deprecated legacy files instead of leaving originals in place:

```bash
npm run migrate-paths:move
```

This migrates:

- `~/.pi/agent/relocations.jsonl` -> `~/.pi/agent/session-move/manifests/relocations.jsonl`
- `~/.pi/agent/relocation-lineages.jsonl` -> `~/.pi/agent/session-move/manifests/relocation-lineages.jsonl`
- `~/.pi/agent/relocations/**` -> `~/.pi/agent/session-move/restart-scripts/**`
- except `~/.pi/agent/relocations/latest.sh`, which is skipped so the current canonical `latest.sh` remains authoritative

Move mode removes each source file only after the destination exists and its checksum matches. Both modes write checksums and operation statuses to:

```text
~/.pi/agent/session-move/migration-manifest.jsonl
```

## Boundaries

- `pi-session-move`: current session moves, restart guidance, lineage naming, and prune.
- `pi-repo-move`: filesystem repo directory moves and repo bucket session preservation.
- `agent-session-store`: canonical rebuild/export/report workflows.
- `pi-session-graph`: visualization over prepared graph exports.
