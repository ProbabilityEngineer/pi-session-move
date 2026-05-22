import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeDir(value: string): string {
	return resolve(value);
}

function sessionBucketName(cwd: string): string {
	const normalized = normalizeDir(cwd).replace(/[/\\]+$/g, "");
	const withoutRoot = normalized.replace(/^[/\\]+/, "");
	return `--${withoutRoot.replace(/[/\\:]+/g, "-")}--`;
}

function defaultAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? ".", ".pi", "agent");
}

function uniqueRelocatedName(originalFile: string, targetCwd: string): string {
	const parsed = basename(originalFile).replace(/\.jsonl$/i, "");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${parsed}_relocated_${sessionBucketName(targetCwd).replace(/^--|--$/g, "")}_${stamp}.jsonl`;
}

function replaceAllLiteral(input: string, from: string, to: string): string {
	return input.split(from).join(to);
}

function parseArgs(args: string): { target?: string; force: boolean } {
	const parts = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
	const values = parts.map((part) => {
		if (
			(part.startsWith('"') && part.endsWith('"')) ||
			(part.startsWith("'") && part.endsWith("'"))
		) {
			return part.slice(1, -1);
		}
		return part;
	});

	let force = false;
	const positional: string[] = [];
	for (const value of values) {
		if (value === "--force" || value === "-f") force = true;
		else positional.push(value);
	}

	return { target: positional.join(" ") || undefined, force };
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("relocate", {
		description:
			"Copy this session to another cwd by replacing old path strings; restart Pi there with --session. No LLM call.",
		handler: async (args, ctx) => {
			const { target, force } = parseArgs(args);
			if (!target) {
				ctx.ui.notify("Usage: /relocate [--force] <target-directory>", "error");
				return;
			}

			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("Cannot relocate an ephemeral session with no session file.", "error");
				return;
			}

			const oldCwd = normalizeDir(ctx.cwd);
			const targetCwd = normalizeDir(isAbsolute(target) ? target : resolve(ctx.cwd, target));
			const targetStat = await stat(targetCwd).catch(() => undefined);
			if (!targetStat?.isDirectory()) {
				ctx.ui.notify(`Not a directory: ${targetCwd}`, "error");
				return;
			}

			if (oldCwd === targetCwd) {
				ctx.ui.notify("Target directory is already the current Pi cwd.", "info");
				return;
			}

			await ctx.waitForIdle();

			if (!force) {
				const ok = await ctx.ui.confirm(
					"Relocate session?",
					[
						"This will copy the current session JSONL and replace path strings.",
						"It will not switch the live Pi process.",
						"",
						`From: ${oldCwd}`,
						`To:   ${targetCwd}`,
					].join("\n"),
				);
				if (!ok) return;
			}

			const original = await readFile(sessionFile, "utf8");
			let relocated = replaceAllLiteral(original, oldCwd, targetCwd);

			// Handle rare JSON produced with escaped slashes.
			relocated = replaceAllLiteral(
				relocated,
				oldCwd.replace(/\//g, "\\/"),
				targetCwd.replace(/\//g, "\\/"),
			);

			const replacements = original === relocated ? 0 : original.split(oldCwd).length - 1;
			const agentDir = defaultAgentDir();
			const destinationDir = join(agentDir, "sessions", sessionBucketName(targetCwd));
			await mkdir(destinationDir, { recursive: true });

			const destinationFile = join(
				destinationDir,
				uniqueRelocatedName(sessionFile, targetCwd),
			);
			await writeFile(destinationFile, relocated, { encoding: "utf8", flag: "wx" });

			const command = `cd ${shellQuote(targetCwd)} && pi --session ${shellQuote(destinationFile)}`;
			ctx.ui.notify(
				[
					`Relocated session written with ${replacements} direct path replacement${replacements === 1 ? "" : "s"}:`,
					destinationFile,
					"",
					"Restart Pi with:",
					command,
				].join("\n"),
				"info",
			);
		},
	});
}
