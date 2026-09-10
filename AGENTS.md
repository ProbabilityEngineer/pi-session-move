# Agent Instructions

## Repository

- `pi-session-move` is a TypeScript Pi extension that moves session context to another working directory without invoking the LLM.
- The runtime entry point is `dist/index.js`; source changes must keep the built output synchronized as required by the package workflow.
- Preserve session lineage, cwd repair, and path migration safety; write operations require explicit flags.
- Use `npm` for dependency management. Pi core packages belong in `peerDependencies`, not runtime `dependencies`.

## Working method

- Use LSP for known symbols, definitions, references, types, call sites, and diagnostics.
- Use AST-grep for syntax-shaped discovery and structural edits.
- Use Semble for behavior or intent discovery; use ripgrep for exact literals, config keys, logs, and post-change verification.
- Keep searches targeted; do not recursively search dependency directories, VCS metadata, build output, or vendored code.

## Validation

- Run `npm run lint` and `npm run build` after implementation changes.
- Run the relevant migration, lineage, or repair script in read-only mode before any `--move` or `--write` operation.
- For npm releases, run package validation, push `main` before the matching `vX.Y.Z` tag, then verify the published npm version and dist-tag.

## Work tracking

- Use `clu` as the authoritative source of project tasks and work state.
- At the start of substantial work, run `clu ready`, claim the appropriate task with `clu claim --context`, and read its inherited context before editing.
- Record newly discovered work and task notes in `clu`; use Turnlog separately for decisions, experiments, rationale, and lessons.
- Close completed work in `clu` after validation and leave incomplete or blocked work represented there.

## Version control and local state

- Git is the version-control system for this repository. Inspect `git status` and relevant diffs before editing and before finishing.
- Make small, coherent commits with clear messages. Do not rewrite published history, force-push, discard unrelated changes, or delete branches unless explicitly asked.
- Keep `.pi/` and `.turnlog/` out of Git. Track portable `.clu/config.yaml` and `.clu/templates/`; ignore mutable `.clu/data.sqlite`, WAL/SHM files, and backups.
- Prefer explicit paths and non-interactive commands. Ask before deleting files or directories.

- Use normal Git workflows. Inspect `git status` and the diff before committing or pushing.
