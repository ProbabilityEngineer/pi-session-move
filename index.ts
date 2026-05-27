import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

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

function uniqueRelocatedName(originalFile: string): string {
	const parsed = basename(originalFile).replace(/\.jsonl$/i, "");
	const originalSessionId = parsed.split("_relocated_")[0] || "session";
	const safeSessionId = originalSessionId.slice(0, 96);
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${safeSessionId}_relocated_${stamp}.jsonl`;
}

function manifestFile(): string {
	return join(defaultAgentDir(), "relocations.jsonl");
}

type RelocationRecord = {
	ts: string;
	fromCwd: string;
	toCwd: string;
	sourceSession: string;
	destinationSession: string;
	parent: string;
	replacements: number | null;
	sourceSessionId?: string;
	destinationSessionId?: string;
	inferred?: boolean;
	confidence?: string;
};

async function appendManifest(record: RelocationRecord): Promise<void> {
	const path = manifestFile();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

function relocationScriptsDir(): string {
	return join(defaultAgentDir(), "relocations");
}

function scriptStamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeRestartScripts(targetCwd: string, sessionFile: string, sessionId?: string): Promise<{ scriptFile: string; latestFile: string }> {
	const dir = relocationScriptsDir();
	await mkdir(dir, { recursive: true });
	const content = [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		...(sessionId ? [`# Pi session id: ${sessionId}`] : []),
		"# Use --session with the exact relocated file. Do not switch to --session-id until Pi's ID-to-file mapping is verified for copied sessions.",
		`cd ${shellQuote(targetCwd)}`,
		`exec pi --session ${shellQuote(sessionFile)}`,
		"",
	].join("\n");
	const scriptFile = join(dir, `run-${scriptStamp()}.sh`);
	const latestFile = join(dir, "latest.sh");
	await writeFile(scriptFile, content, { encoding: "utf8", flag: "wx" });
	await chmod(scriptFile, 0o755);
	await writeFile(latestFile, content, { encoding: "utf8" });
	await chmod(latestFile, 0o755);
	return { scriptFile, latestFile };
}

async function readManifest(): Promise<RelocationRecord[]> {
	try {
		const raw = await readFile(manifestFile(), "utf8");
		return raw
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as RelocationRecord);
	} catch {
		return [];
	}
}

async function findRelocatedSessions(root = join(defaultAgentDir(), "sessions")): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile() && entry.name.includes("_relocated_") && entry.name.endsWith(".jsonl")) found.push(path);
		}
	}
	await walk(root);
	return found.sort();
}

function replaceAllLiteral(input: string, from: string, to: string): string {
	return input.split(from).join(to);
}

function parseWords(args: string): string[] {
	const parts = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
	return parts.map((part) => {
		if (
			(part.startsWith('"') && part.endsWith('"')) ||
			(part.startsWith("'") && part.endsWith("'"))
		) {
			return part.slice(1, -1);
		}
		return part;
	});
}

function parseArgs(args: string): { target?: string; force: boolean } {
	let force = false;
	const positional: string[] = [];
	for (const value of parseWords(args)) {
		if (value === "--force" || value === "-f") force = true;
		else positional.push(value);
	}

	return { target: positional.join(" ") || undefined, force };
}

function hasFlag(args: string, flag: string): boolean {
	return parseWords(args).includes(flag);
}

function shortPath(path: string): string {
	if (!path || path.startsWith("(")) return path;
	const home = process.env.HOME;
	return home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

function cwdLabel(cwd: string): string {
	if (!cwd || cwd.startsWith("(")) return cwd;
	return basename(cwd) || cwd;
}

function recordMarker(record: RelocationRecord): string {
	return record.inferred ? "inferred" : "explicit";
}

function findCurrentIndex(records: RelocationRecord[], sessionFile?: string): number {
	if (!sessionFile) return -1;
	return records.findIndex((record) => record.destinationSession === sessionFile);
}

function buildLineage(records: RelocationRecord[], currentIndex: number): RelocationRecord[] {
	if (currentIndex < 0) return [];
	const byDestination = new Map(records.map((record) => [record.destinationSession, record]));
	const lineage: RelocationRecord[] = [];
	const seen = new Set<string>();
	let current: RelocationRecord | undefined = records[currentIndex];
	while (current && !seen.has(current.destinationSession)) {
		lineage.unshift(current);
		seen.add(current.destinationSession);
		current = byDestination.get(current.sourceSession) ?? byDestination.get(current.parent);
	}
	return lineage;
}

function forkRecords(records: RelocationRecord[], lineage: RelocationRecord[]): RelocationRecord[] {
	const chainSources = new Set(lineage.map((record) => record.sourceSession));
	const chainDestinations = new Set(lineage.map((record) => record.destinationSession));
	return records.filter(
		(record) => chainSources.has(record.sourceSession) && !chainDestinations.has(record.destinationSession),
	);
}

function formatHop(record: RelocationRecord, index: number, currentSession?: string, files = false): string[] {
	const current = record.destinationSession === currentSession ? " current" : "";
	const lines = [
		`${index}. [${recordMarker(record)}] ${cwdLabel(record.fromCwd)} -> ${cwdLabel(record.toCwd)}${current}`,
		`   ${record.ts}`,
	];
	if (files) {
		if (record.sourceSessionId || record.destinationSessionId) lines.push(`   session id: ${record.destinationSessionId ?? record.sourceSessionId}`);
		lines.push(`   source: ${shortPath(record.sourceSession)}`);
		lines.push(`   dest:   ${shortPath(record.destinationSession)}`);
	}
	return lines;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("relocate", {
		description:
			"Copy this session to another cwd by replacing old path strings; restart Pi there with --session. Records lineage in relocations.jsonl. No LLM call.",
		handler: async (args, ctx) => {
			const { target, force } = parseArgs(args);
			if (!target) {
				ctx.ui.notify("Usage: /relocate [--force] <target-directory>", "error");
				return;
			}

			const sessionFile = ctx.sessionManager.getSessionFile();
			const sessionId = ctx.sessionManager.getSessionId();
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

			const destinationFile = join(destinationDir, uniqueRelocatedName(sessionFile));
			await writeFile(destinationFile, relocated, { encoding: "utf8", flag: "wx" });
			const restart = await writeRestartScripts(targetCwd, destinationFile, sessionId);
			await appendManifest({
				ts: new Date().toISOString(),
				fromCwd: oldCwd,
				toCwd: targetCwd,
				sourceSession: sessionFile,
				destinationSession: destinationFile,
				parent: sessionFile,
				replacements,
				sourceSessionId: sessionId,
				destinationSessionId: sessionId,
			});

			const command = `bash ${shellQuote(restart.latestFile)}`;
			ctx.ui.notify(
				[
					`Relocated session written with ${replacements} direct path replacement${replacements === 1 ? "" : "s"}:`,
					destinationFile,
					"",
					"Restart script:",
					restart.scriptFile,
					"",
					"Restart Pi with:",
					command,
				].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("relocate-status", {
		description: "Show compact relocation status. Use --all for full details.",
		handler: async (args, ctx) => {
			const showAll = hasFlag(args, "--all");
			const sessionFile = ctx.sessionManager.getSessionFile();
			const records = await readManifest();
			const discovered = await findRelocatedSessions();
			const byDestination = new Map(records.map((record) => [record.destinationSession, record]));
			const currentIndex = findCurrentIndex(records, sessionFile);
			const currentLineage = buildLineage(records, currentIndex);
			const forks = forkRecords(records, currentLineage);
			const unrecorded = discovered.filter((path) => !byDestination.has(path));
			const currentSessionId = ctx.sessionManager.getSessionId();
			const lines = [
				"Relocation status",
				"",
				`Current cwd: ${shortPath(ctx.cwd)}`,
				`Current session: ${sessionFile ? shortPath(sessionFile) : "(ephemeral)"}`,
				`Current session id: ${currentSessionId}`,
				`Current session tracked: ${currentIndex >= 0 ? `yes (#${currentIndex + 1})` : "no"}`,
				`Manifest records: ${records.length}`,
				`Current lineage hops: ${currentLineage.length}`,
				`Forks from current lineage: ${forks.length}`,
				`Unrecorded relocated files: ${unrecorded.length}`,
			];

			lines.push("", "Latest relocations:");
			const recent = records.slice(-5);
			if (recent.length) {
				for (const [offset, record] of recent.entries()) {
					const n = records.length - recent.length + offset + 1;
					lines.push(...formatHop(record, n, sessionFile, false));
				}
			} else {
				lines.push("(none)");
			}

			if (forks.length) {
				lines.push("", "Forks touching current lineage:");
				for (const [index, record] of forks.slice(-5).entries()) lines.push(...formatHop(record, index + 1, sessionFile, false));
			}

			if (showAll) {
				lines.push("", "All recorded relocations:");
				for (const [index, record] of records.entries()) lines.push(...formatHop(record, index + 1, sessionFile, true));

				if (unrecorded.length) {
					lines.push("", "Discovered relocated sessions not in manifest:");
					for (const path of unrecorded) lines.push(`- ${shortPath(path)}`);
				}
			} else {
				lines.push("", "Use /relocate-lineage for the current chain; /relocate-status --all for full details.");
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("relocate-lineage", {
		description: "Show the current relocation ancestry chain. Use --files to include session paths.",
		handler: async (args, ctx) => {
			const showFiles = hasFlag(args, "--files");
			const sessionFile = ctx.sessionManager.getSessionFile();
			const records = await readManifest();
			const currentIndex = findCurrentIndex(records, sessionFile);
			const lineage = buildLineage(records, currentIndex);
			const forks = forkRecords(records, lineage);
			const lines = [
				"Relocation lineage",
				"",
				`Current cwd: ${shortPath(ctx.cwd)}`,
				`Current session: ${sessionFile ? shortPath(sessionFile) : "(ephemeral)"}`,
				`Current session id: ${ctx.sessionManager.getSessionId()}`,
			];

			if (!sessionFile) lines.push("", "Current session is ephemeral; no lineage is available.");
			else if (currentIndex < 0) lines.push("", "Current session is not recorded as a relocation destination.");
			else if (!lineage.length) lines.push("", "No lineage records found for current session.");
			else {
				lines.push("", "Current chain:");
				for (const [index, record] of lineage.entries()) lines.push(...formatHop(record, index + 1, sessionFile, showFiles));
			}

			if (forks.length) {
				lines.push("", "Forks from this chain:");
				for (const [index, record] of forks.entries()) lines.push(...formatHop(record, index + 1, sessionFile, showFiles));
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
