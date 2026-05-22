# pi-relocate

Pi extension that copies the current session JSONL to another working directory by replacing the old absolute cwd with the new absolute cwd. It does **not** invoke the LLM and does **not** try to switch the live Pi process.

## Install

From this repository:

```bash
pi install git:github.com/samsquire/pi-relocate
```

Or load locally while testing:

```bash
pi -e ./index.ts
```

## Usage

Inside Pi:

```text
/relocate <target-directory>
```

Example:

```text
/relocate ./my-new-repo
```

The command will:

1. resolve the target directory relative to Pi's current cwd,
2. confirm the relocation,
3. copy the current session file into the target cwd's Pi session bucket,
4. replace occurrences of the old absolute cwd with the new absolute cwd, and
5. print the restart command.

Restart with the printed command, which looks like:

```bash
cd /path/to/new/repo && pi --session /path/to/relocated.jsonl
```

Use `--force` to skip confirmation:

```text
/relocate --force ./my-new-repo
```

## Notes

- The original session file is never modified.
- The relocated session is a plain JSONL copy with string replacements.
- This is intended for workflows where you started Pi in a parent directory, created or cloned a repo, and then want to continue from that repo's cwd.
