import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeDraggedPath(value: string): string {
	// Finder/terminal dragged paths often arrive as shell-escaped text, e.g.
	// /Users/sam/Library/Mobile\ Documents/com\~apple\~CloudDocs
	// Extension args are already strings, not shell-evaluated, so unescape common
	// single-character shell escapes before resolving/statting.
	return value.replace(/\\(.)/g, "$1");
}

function normalizeDir(value: string): string {
	return resolve(normalizeDraggedPath(value));
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
	mode?: "move" | "branch";
	batchId?: string;
	inferred?: boolean;
	confidence?: string;
	sourceLinesAtEvent?: number;
	sourceBytesAtEvent?: number;
};

async function appendManifest(record: RelocationRecord): Promise<void> {
	const path = manifestFile();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

function hashId(prefix: string, ...parts: (string | undefined)[]) {
	return `${prefix}_${parts.filter(Boolean).join("\u0000").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 48)}_${Math.abs(parts.join("\u0000").split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)).toString(16)}`;
}

function sessionFileId(path: string) {
	return hashId("session", path);
}

function observationId(path: string) {
	return hashId("obs", path);
}

function initStore(db: DatabaseSync) {
	db.exec(`
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL, uri TEXT NOT NULL, label TEXT, first_observed_at TEXT, last_observed_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_session_id TEXT, canonical_key TEXT NOT NULL UNIQUE, first_seen_at TEXT, last_seen_at TEXT, start_timestamp TEXT, end_timestamp TEXT, event_count INTEGER, line_count INTEGER, byte_count INTEGER, content_sha256 TEXT, prefix_sha256 TEXT, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS session_observations (id TEXT PRIMARY KEY, session_id TEXT, source_id TEXT, path TEXT, provider_session_id TEXT, observed_at TEXT, snapshot_label TEXT, file_birthtime TEXT, file_mtime TEXT, file_size INTEGER, line_count INTEGER, first_event_at TEXT, last_event_at TEXT, content_sha256 TEXT, prefix_sha256 TEXT, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, source_session_id TEXT, target_session_id TEXT, edge_type TEXT NOT NULL, timestamp TEXT, source_observation_id TEXT, target_observation_id TEXT, confidence TEXT NOT NULL, provenance TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, label_type TEXT NOT NULL, value TEXT NOT NULL, valid_from TEXT, valid_to TEXT, confidence TEXT NOT NULL, source_id TEXT, evidence_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS observation_marks (id TEXT PRIMARY KEY, observation_id TEXT NOT NULL, mark_type TEXT NOT NULL, reason TEXT, replacement_observation_id TEXT, source TEXT NOT NULL, timestamp TEXT NOT NULL, confidence TEXT NOT NULL, manual_review_required INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS batch_operations (id TEXT PRIMARY KEY, operation_type TEXT NOT NULL, source_path TEXT NOT NULL, destination_path TEXT NOT NULL, timestamp TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
`);
}

async function sessionLines(path: string): Promise<number | undefined> {
	try {
		return (await readFile(path, "utf8")).split("\n").filter((line) => line.trim()).length;
	} catch {
		return undefined;
	}
}

async function sessionStats(path: string) {
	try {
		const [raw, st] = await Promise.all([readFile(path, "utf8"), stat(path)]);
		const lines = raw.split("\n").filter((line) => line.trim());
		return { lineCount: lines.length, byteCount: st.size, fileBirthtime: st.birthtime.toISOString(), fileMtime: st.mtime.toISOString() };
	} catch {
		return { lineCount: null, byteCount: null, fileBirthtime: null, fileMtime: null };
	}
}

async function appendStoreRecord(record: RelocationRecord, name?: string): Promise<void> {
	await mkdir(dirname(storeFile()), { recursive: true });
	const db = new DatabaseSync(storeFile());
	try {
		initStore(db);
		const sourceId = "source_pi_relocate_manifest";
		db.prepare("INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(sourceId, "pi", "relocation_manifest", manifestFile(), "Pi relocation manifest", null, null, "{}");
		const upsertSession = db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const upsertObs = db.prepare("INSERT OR REPLACE INTO session_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const upsertEdge = db.prepare("INSERT OR REPLACE INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const upsertLabel = db.prepare("INSERT OR REPLACE INTO labels VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const upsertMark = db.prepare("INSERT OR REPLACE INTO observation_marks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const upsertBatch = db.prepare("INSERT OR REPLACE INTO batch_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
		const sourceSessionId = sessionFileId(record.sourceSession);
		const destSessionId = sessionFileId(record.destinationSession);
		const sourceObsId = observationId(record.sourceSession);
		const destObsId = observationId(record.destinationSession);
		const sourceStats = await sessionStats(record.sourceSession);
		const destStats = await sessionStats(record.destinationSession);
		upsertSession.run(sourceSessionId, "pi", record.sourceSessionId ?? null, record.sourceSession, null, record.ts, null, null, null, sourceStats.lineCount, sourceStats.byteCount, null, null, JSON.stringify({ cwd: record.fromCwd, ...(name ? { displayName: name } : {}) }));
		upsertSession.run(destSessionId, "pi", record.destinationSessionId ?? null, record.destinationSession, record.ts, null, null, null, null, destStats.lineCount, destStats.byteCount, null, null, JSON.stringify({ cwd: record.toCwd, ...(name ? { displayName: name } : {}) }));
		upsertObs.run(sourceObsId, sourceSessionId, sourceId, record.sourceSession, record.sourceSessionId ?? null, record.ts, null, sourceStats.fileBirthtime, sourceStats.fileMtime, sourceStats.byteCount, sourceStats.lineCount, null, null, null, null, JSON.stringify({ cwd: record.fromCwd }));
		upsertObs.run(destObsId, destSessionId, sourceId, record.destinationSession, record.destinationSessionId ?? null, record.ts, null, destStats.fileBirthtime, destStats.fileMtime, destStats.byteCount, destStats.lineCount, null, null, null, null, JSON.stringify({ cwd: record.toCwd }));
		const edgeId = hashId("edge", record.ts, record.sourceSession, record.destinationSession);
		upsertEdge.run(edgeId, sourceSessionId, destSessionId, record.mode === "branch" ? "branch" : "relocation", record.ts, sourceObsId, destObsId, "authoritative", "pi-relocate", JSON.stringify({ fromCwd: record.fromCwd, toCwd: record.toCwd, replacements: record.replacements, parent: record.parent, sourceSessionId: record.sourceSessionId, destinationSessionId: record.destinationSessionId, mode: record.mode ?? "move", batchId: record.batchId, sourceLinesAtEvent: record.sourceLinesAtEvent, sourceBytesAtEvent: record.sourceBytesAtEvent }));
		if (record.batchId) upsertBatch.run(record.batchId, "bucket_relocation", record.fromCwd, record.toCwd, record.ts, "pi-relocate", "applied", JSON.stringify({ mode: record.mode ?? "move" }));
		if ((record.mode ?? "move") === "move") {
			upsertMark.run(hashId("mark", sourceObsId, "superseded", destObsId, record.ts), sourceObsId, "superseded", "relocated by pi-relocate move semantics", destObsId, "pi-relocate", record.ts, "authoritative", 1, JSON.stringify({ batchId: record.batchId }));
			upsertMark.run(hashId("mark", sourceObsId, "deletion_candidate", destObsId, record.ts), sourceObsId, "deletion_candidate", "old copy after relocation; requires manual review before deletion", destObsId, "pi-relocate", record.ts, "authoritative", 1, JSON.stringify({ batchId: record.batchId }));
		}
		upsertLabel.run(hashId("label", sourceSessionId, "cwd", record.fromCwd), "session", sourceSessionId, "cwd", record.fromCwd, null, null, "authoritative", sourceId, null, "{}");
		upsertLabel.run(hashId("label", destSessionId, "cwd", record.toCwd), "session", destSessionId, "cwd", record.toCwd, null, null, "authoritative", sourceId, null, "{}");
		if (name) {
			upsertLabel.run(hashId("label", sourceSessionId, "display", name), "session", sourceSessionId, "display_name", name, null, null, "authoritative", sourceId, null, "{}");
			upsertLabel.run(hashId("label", destSessionId, "display", name), "session", destSessionId, "display_name", name, null, null, "authoritative", sourceId, null, "{}");
		}
	} finally {
		db.close();
	}
}

async function replayManifestToStore(records?: RelocationRecord[]): Promise<{ ok: number; failed: number }> {
	records ??= await readManifest();
	let ok = 0;
	let failed = 0;
	for (const record of records) {
		try {
			await appendStoreRecord(record);
			ok++;
		} catch {
			failed++;
		}
	}
	return { ok, failed };
}

function relocationScriptsDir(): string {
	return join(defaultAgentDir(), "relocations");
}

function scriptStamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function storeFile(): string {
	return join(defaultAgentDir(), "session-store", "session-store.sqlite");
}

type ObservationMark = { markType: string; reason?: string; replacementObservationId?: string; replacementPath?: string; observationPath?: string; timestamp: string; confidence: string; manualReviewRequired: boolean };
type ThreadResumeTarget = { threadId: string; status: string; recommendedSessionId?: string; recommendedObservationId?: string; recommendedPath?: string; activeLeafPaths: string[]; recoverablePaths: string[]; reasons: string[] };

function currentSessionMarks(sessionFile?: string): ObservationMark[] {
	if (!sessionFile) return [];
	try {
		const db = new DatabaseSync(storeFile(), { readOnly: true });
		try {
			initStore(db);
			const rows = db.prepare(`
SELECT m.mark_type AS markType, m.reason AS reason, m.replacement_observation_id AS replacementObservationId, o.path AS observationPath, r.path AS replacementPath, m.timestamp AS timestamp, m.confidence AS confidence, m.manual_review_required AS manualReviewRequired
FROM observation_marks m
JOIN session_observations o ON o.id = m.observation_id
LEFT JOIN session_observations r ON r.id = m.replacement_observation_id
WHERE o.path = ?
ORDER BY m.timestamp DESC, m.mark_type
`).all(sessionFile) as { markType: string; reason?: string; replacementObservationId?: string; observationPath?: string; replacementPath?: string; timestamp: string; confidence: string; manualReviewRequired: number }[];
			return rows.map((row) => ({ ...row, manualReviewRequired: Boolean(row.manualReviewRequired) }));
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
}

function allAvailabilityMarks(): ObservationMark[] {
	try {
		const db = new DatabaseSync(storeFile(), { readOnly: true });
		try {
			initStore(db);
			const rows = db.prepare(`
SELECT m.mark_type AS markType, m.reason AS reason, m.replacement_observation_id AS replacementObservationId, o.path AS observationPath, r.path AS replacementPath, m.timestamp AS timestamp, m.confidence AS confidence, m.manual_review_required AS manualReviewRequired
FROM observation_marks m
JOIN session_observations o ON o.id = m.observation_id
LEFT JOIN session_observations r ON r.id = m.replacement_observation_id
ORDER BY m.timestamp DESC, m.mark_type
`).all() as { markType: string; reason?: string; replacementObservationId?: string; observationPath?: string; replacementPath?: string; timestamp: string; confidence: string; manualReviewRequired: number }[];
			return rows.map((row) => ({ ...row, manualReviewRequired: Boolean(row.manualReviewRequired) }));
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
}

function unavailableSessionSet(): Set<string> {
	return new Set(allAvailabilityMarks().filter((mark) => mark.markType === "superseded" || mark.markType === "deletion_candidate").map((mark) => mark.observationPath).filter((path): path is string => Boolean(path)));
}

function threadResumeTargetsForSession(sessionFile?: string): ThreadResumeTarget[] {
	if (!sessionFile) return [];
	try {
		const db = new DatabaseSync(storeFile(), { readOnly: true });
		try {
			const rows = db.prepare(`
SELECT tr.thread_id AS threadId, tr.status AS status, tr.recommended_session_id AS recommendedSessionId, tr.recommended_observation_id AS recommendedObservationId,
       ro.path AS recommendedPath, tr.active_leaf_session_ids_json AS activeLeafSessionIdsJson, tr.recoverable_session_ids_json AS recoverableSessionIdsJson, tr.reasons_json AS reasonsJson
FROM thread_resume_targets tr
JOIN thread_members tm ON tm.thread_id = tr.thread_id
JOIN sessions s ON s.id = tm.session_id
LEFT JOIN session_observations ro ON ro.id = tr.recommended_observation_id
WHERE s.canonical_key = ?
ORDER BY tr.thread_id
`).all(sessionFile) as { threadId: string; status: string; recommendedSessionId?: string; recommendedObservationId?: string; recommendedPath?: string; activeLeafSessionIdsJson: string; recoverableSessionIdsJson: string; reasonsJson: string }[];
			const pathForSession = db.prepare("SELECT canonical_key AS path FROM sessions WHERE id = ?");
			const toPaths = (raw: string) => {
				try { return (JSON.parse(raw) as string[]).flatMap((id) => (pathForSession.get(id) as { path?: string } | undefined)?.path ? [(pathForSession.get(id) as { path: string }).path] : []); } catch { return []; }
			};
			return rows.map((row) => ({ threadId: row.threadId, status: row.status, recommendedSessionId: row.recommendedSessionId, recommendedObservationId: row.recommendedObservationId, recommendedPath: row.recommendedPath, activeLeafPaths: toPaths(row.activeLeafSessionIdsJson), recoverablePaths: toPaths(row.recoverableSessionIdsJson), reasons: JSON.parse(row.reasonsJson) as string[] }));
		} finally { db.close(); }
	} catch { return []; }
}

function threadResumeLines(sessionFile?: string): string[] {
	const targets = threadResumeTargetsForSession(sessionFile);
	if (!targets.length) return [];
	return [
		"",
		"Logical thread resume:",
		...targets.flatMap((target) => [
			`- ${target.status}${target.recommendedPath ? `: ${shortPath(target.recommendedPath)}` : ""}`,
			...(target.status === "branch-choices" ? target.activeLeafPaths.map((path) => `  branch: ${shortPath(path)}`) : []),
			...(target.status === "recoverable-only" ? target.recoverablePaths.map((path) => `  recoverable: ${shortPath(path)}`) : []),
			`  reasons: ${target.reasons.join(", ")}`,
		]),
	];
}

function movedWarningLines(sessionFile?: string): string[] {
	const marks = currentSessionMarks(sessionFile);
	const relevant = marks.filter((mark) => mark.markType === "superseded" || mark.markType === "deletion_candidate");
	if (!relevant.length) return [];
	const replacement = relevant.find((mark) => mark.replacementPath)?.replacementPath;
	return [
		"",
		"⚠ Current session has canonical-store availability marks:",
		...relevant.map((mark) => `- ${mark.markType} @ ${mark.timestamp}${mark.reason ? ` — ${mark.reason}` : ""}`),
		...(replacement ? ["", `Suggested active replacement: ${shortPath(replacement)}`] : []),
		"Raw session file has not been deleted; recovery remains possible.",
	];
}

function displayName(ctx: any): string | undefined {
	const candidates = [
		ctx.sessionManager?.getSessionName?.(),
		ctx.sessionManager?.getDisplayName?.(),
		ctx.session?.name,
		ctx.session?.displayName,
	].filter((value) => typeof value === "string" && value.trim()) as string[];
	return candidates[0];
}

async function writeRestartScripts(targetCwd: string, sessionFile: string, sessionId?: string, name?: string): Promise<{ scriptFile: string; latestFile: string }> {
	const dir = relocationScriptsDir();
	await mkdir(dir, { recursive: true });
	const content = [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		...(sessionId ? [`# Pi session id: ${sessionId}`] : []),
		"# Use --session with the exact relocated file. Do not switch to --session-id until Pi's ID-to-file mapping is verified for copied sessions.",
		`cd ${shellQuote(targetCwd)}`,
		`exec pi ${name ? `--name ${shellQuote(name)} ` : ""}--session ${shellQuote(sessionFile)}`,
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

async function sessionFilesInBucket(cwd: string): Promise<string[]> {
	const dir = join(defaultAgentDir(), "sessions", sessionBucketName(cwd));
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => join(dir, entry.name)).sort();
}

async function relocateSessionFile(sourceFile: string, oldCwd: string, targetCwd: string, mode: "move" | "branch", batchId?: string, name?: string): Promise<{ record: RelocationRecord; replacements: number }> {
	const original = await readFile(sourceFile, "utf8");
	let relocated = replaceAllLiteral(original, oldCwd, targetCwd);
	relocated = replaceAllLiteral(relocated, oldCwd.replace(/\//g, "\\/"), targetCwd.replace(/\//g, "\\/"));
	const replacements = original === relocated ? 0 : original.split(oldCwd).length - 1;
	const destinationDir = join(defaultAgentDir(), "sessions", sessionBucketName(targetCwd));
	await mkdir(destinationDir, { recursive: true });
	const destinationFile = join(destinationDir, uniqueRelocatedName(sourceFile));
	await writeFile(destinationFile, relocated, { encoding: "utf8", flag: "wx" });
	const sessionId = basename(sourceFile).match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_|\.|$)/)?.[1];
	const record = { ts: new Date().toISOString(), fromCwd: oldCwd, toCwd: targetCwd, sourceSession: sourceFile, destinationSession: destinationFile, parent: sourceFile, replacements, sourceSessionId: sessionId, destinationSessionId: sessionId, mode, batchId, sourceLinesAtEvent: original.split("\n").filter((line) => line.trim()).length, sourceBytesAtEvent: Buffer.byteLength(original) } satisfies RelocationRecord;
	await appendManifest(record);
	await appendStoreRecord(record, name);
	return { record, replacements };
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
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;
	for (const char of args) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				words.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (escaping) current += "\\";
	if (current) words.push(current);
	return words;
}

function parseArgs(args: string): { target?: string; force: boolean; branch: boolean; dryRun: boolean } {
	let force = false;
	let branch = false;
	let dryRun = false;
	const positional: string[] = [];
	for (const value of parseWords(args)) {
		if (value === "--force" || value === "-f") force = true;
		else if (value === "--branch" || value === "--copy") branch = true;
		else if (value === "--dry-run" || value === "-n") dryRun = true;
		else positional.push(value);
	}

	return { target: positional.join(" ") || undefined, force, branch, dryRun };
}

function parseRepoArgs(args: string): { source?: string; target?: string; force: boolean; branch: boolean; dryRun: boolean } {
	let force = false;
	let branch = false;
	let dryRun = false;
	const positional: string[] = [];
	for (const value of parseWords(args)) {
		if (value === "--force" || value === "-f") force = true;
		else if (value === "--branch" || value === "--copy") branch = true;
		else if (value === "--dry-run" || value === "-n") dryRun = true;
		else positional.push(value);
	}
	return { source: positional[0], target: positional[1], force, branch, dryRun };
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

function childRecords(records: RelocationRecord[], sessionFile?: string): RelocationRecord[] {
	if (!sessionFile) return [];
	return records.filter((record) => record.sourceSession === sessionFile || record.parent === sessionFile);
}

function descendantRecords(records: RelocationRecord[], sessionFile?: string): RelocationRecord[] {
	if (!sessionFile) return [];
	const descendants: RelocationRecord[] = [];
	const queue = [sessionFile];
	const seen = new Set<string>();
	while (queue.length) {
		const current = queue.shift();
		if (!current || seen.has(current)) continue;
		seen.add(current);
		for (const child of childRecords(records, current)) {
			descendants.push(child);
			queue.push(child.destinationSession);
		}
	}
	return descendants;
}

function leafRecords(records: RelocationRecord[], candidates: RelocationRecord[], includeUnavailable = false): RelocationRecord[] {
	const unavailable = includeUnavailable ? new Set<string>() : unavailableSessionSet();
	return candidates.filter((record) => !childRecords(records, record.destinationSession).length && !unavailable.has(record.destinationSession));
}

function newestRecord(records: RelocationRecord[]): RelocationRecord | undefined {
	return [...records].sort((a, b) => a.ts.localeCompare(b.ts)).at(-1);
}

function lineageLength(records: RelocationRecord[], record: RelocationRecord): number {
	return buildLineage(records, records.indexOf(record)).length;
}

function longestLineageLeaf(records: RelocationRecord[], leaves: RelocationRecord[]): RelocationRecord | undefined {
	return [...leaves].sort((a, b) => lineageLength(records, a) - lineageLength(records, b) || a.ts.localeCompare(b.ts)).at(-1);
}

function restartCommand(): string {
	return `bash ${shellQuote(join(relocationScriptsDir(), "latest.sh"))}`;
}

async function ensureTargetDirectory(targetCwd: string, force: boolean, dryRun: boolean, confirm: (title: string, message: string) => Promise<boolean>): Promise<boolean> {
	const targetStat = await stat(targetCwd).catch(() => undefined);
	if (targetStat?.isDirectory()) return true;
	if (targetStat) throw new Error(`Target exists but is not a directory: ${targetCwd}`);
	if (dryRun) return true;
	if (!force) {
		const ok = await confirm("Create target directory?", `Target directory does not exist. Create it?\n\n${targetCwd}`);
		if (!ok) return false;
	}
	await mkdir(targetCwd, { recursive: true });
	return true;
}

async function moveRepoDirectory(sourceCwd: string, targetCwd: string, force: boolean, dryRun: boolean, confirm: (title: string, message: string) => Promise<boolean>): Promise<"moved" | "dry-run" | "skipped"> {
	const sourceStat = await stat(sourceCwd).catch(() => undefined);
	if (!sourceStat?.isDirectory()) throw new Error(`Source repo directory is not a directory: ${sourceCwd}`);
	const targetStat = await stat(targetCwd).catch(() => undefined);
	if (targetStat) throw new Error(`Target repo path already exists: ${targetCwd}`);
	if (dryRun) return "dry-run";
	await mkdir(dirname(targetCwd), { recursive: true });
	if (!force) {
		const ok = await confirm("Move repo directory?", [`This will move the repo directory on disk and then relocate its Pi session bucket.`, "", `From: ${sourceCwd}`, `To:   ${targetCwd}`, "", "Original session files are not deleted."].join("\n"));
		if (!ok) return "skipped";
	}
	await rename(sourceCwd, targetCwd);
	return "moved";
}

function formatLeaf(label: string, record: RelocationRecord | undefined, files = false): string[] {
	if (!record) return [`${label}: none`];
	const lines = [`${label}: ${cwdLabel(record.toCwd)} @ ${record.ts}`];
	if (record.destinationSessionId) lines.push(`  session id: ${record.destinationSessionId}`);
	if (files) lines.push(`  session: ${shortPath(record.destinationSession)}`);
	return lines;
}

function lineageSummary(records: RelocationRecord[], sessionFile?: string): string[] {
	const currentIndex = findCurrentIndex(records, sessionFile);
	const lineage = buildLineage(records, currentIndex);
	const descendants = descendantRecords(records, sessionFile);
	const leaves = leafRecords(records, descendants);
	const recoverableLeaves = leafRecords(records, descendants, true).filter((record) => unavailableSessionSet().has(record.destinationSession));
	const currentChildren = childRecords(records, sessionFile);
	const forks = forkRecords(records, lineage);
	const isLatestLeaf = Boolean(sessionFile && currentIndex >= 0 && !currentChildren.length);
	const newestLeaf = newestRecord(leaves);
	const longestLeaf = longestLineageLeaf(records, leaves);
	return [
		`Current session tracked: ${currentIndex >= 0 ? "yes" : "no"}`,
		`Current session is latest leaf: ${isLatestLeaf ? "yes" : "no"}`,
		`Children from current session: ${currentChildren.length}`,
		`Descendants from current session: ${descendants.length}`,
		`Active descendant leaves: ${leaves.length}`,
		`Recoverable moved/superseded leaves: ${recoverableLeaves.length}`,
		`Forks from current chain: ${forks.length}`,
		...formatLeaf("Newest descendant leaf", newestLeaf),
		...formatLeaf("Longest-lineage descendant leaf", longestLeaf),
		...(recoverableLeaves.length ? ["Recoverable leaves are hidden from normal resume suggestions; use --files/status details for raw paths."] : []),
		...threadResumeLines(sessionFile),
		...(descendants.length ? [`Restart latest script: ${restartCommand()}`] : []),
	];
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

async function buildStatusOutput(ctx: any, showAll = false): Promise<string> {
	const sessionFile = ctx.sessionManager?.getSessionFile?.();
	const records = await readManifest();
	const discovered = await findRelocatedSessions();
	const byDestination = new Map(records.map((record) => [record.destinationSession, record]));
	const currentIndex = findCurrentIndex(records, sessionFile);
	const currentLineage = buildLineage(records, currentIndex);
	const forks = forkRecords(records, currentLineage);
	const unrecorded = discovered.filter((path) => !byDestination.has(path));
	const lines = [
		"Relocation status",
		"",
		`Current cwd: ${shortPath(ctx.cwd ?? "")}`,
		`Current session: ${sessionFile ? shortPath(sessionFile) : "(ephemeral)"}`,
		`Current session id: ${ctx.sessionManager?.getSessionId?.() ?? "unknown"}`,
		`Current session tracked: ${currentIndex >= 0 ? `yes (#${currentIndex + 1})` : "no"}`,
		...movedWarningLines(sessionFile),
		`Manifest records: ${records.length}`,
		`Current lineage hops: ${currentLineage.length}`,
		`Forks from current lineage: ${forks.length}`,
		`Unrecorded relocated files: ${unrecorded.length}`,
	];
	if (showAll) {
		lines.push("", "All recorded relocations:");
		for (const [index, record] of records.entries()) lines.push(...formatHop(record, index + 1, sessionFile, true));
	}
	return lines.join("\n");
}

async function buildLineageOutput(ctx: any, showFiles = false): Promise<string> {
	const sessionFile = ctx.sessionManager?.getSessionFile?.();
	const records = await readManifest();
	const currentIndex = findCurrentIndex(records, sessionFile);
	const lineage = buildLineage(records, currentIndex);
	const forks = forkRecords(records, lineage);
	const lines = [
		"Relocation lineage",
		"",
		`Current cwd: ${shortPath(ctx.cwd ?? "")}`,
		`Current session: ${sessionFile ? shortPath(sessionFile) : "(ephemeral)"}`,
		`Current session id: ${ctx.sessionManager?.getSessionId?.() ?? "unknown"}`,
		...movedWarningLines(sessionFile),
		"",
		"Current position:",
		...lineageSummary(records, sessionFile),
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
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "relocate",
		label: "Relocate",
		description: "Pi session relocation status and lineage: status/lineage.",
		promptSnippet: "Relocate routing: use relocate status/lineage when checking whether the current Pi session is an older relocated branch or latest lineage leaf.",
		promptGuidelines: [
			"Use relocate lineage to answer whether the current session has descendants, is a latest leaf, or should continue from a newer relocated session.",
			"Relocate status/lineage are read-only; use slash /relocate for the user-confirmed copy operation.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("status"), Type.Literal("lineage")]),
			all: Type.Optional(Type.Boolean({ description: "For status, include all manifest records." })),
			files: Type.Optional(Type.Boolean({ description: "For lineage, include source and destination session paths." })),
		}),
		async execute(_toolCallId: string, params: { action: "status" | "lineage"; all?: boolean; files?: boolean }, _signal: AbortSignal, _updates: unknown, ctx: any) {
			const text = params.action === "status" ? await buildStatusOutput(ctx, Boolean(params.all)) : await buildLineageOutput(ctx, Boolean(params.files));
			return { content: [{ type: "text" as const, text }], details: { action: params.action } };
		},
	} as any);

	pi.registerCommand("relocate", {
		description:
			"Copy this session to another cwd by replacing old path strings; restart Pi there with --session. Records lineage in relocations.jsonl. No LLM call.",
		handler: async (args, ctx) => {
			const { target, force, branch } = parseArgs(args);
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
			try {
				if (!(await ensureTargetDirectory(targetCwd, force, false, ctx.ui.confirm))) return;
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
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
						`Mode: ${branch ? "branch/copy (source remains active)" : "move (source marked superseded in store)"}`,
					].join("\n"),
				);
				if (!ok) return;
			}

			const original = await readFile(sessionFile, "utf8").catch((error) => {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					throw new Error(["Current Pi session file is missing; cannot relocate this live process.", "", `Missing: ${sessionFile}`, "", "Try /session, /relocate-lineage --files, or start a fresh Pi session in the target directory."].join("\n"));
				}
				throw error;
			});
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
			const name = displayName(ctx);
			const restart = await writeRestartScripts(targetCwd, destinationFile, sessionId, name);
			const record = {
				ts: new Date().toISOString(),
				fromCwd: oldCwd,
				toCwd: targetCwd,
				sourceSession: sessionFile,
				destinationSession: destinationFile,
				parent: sessionFile,
				replacements,
				sourceSessionId: sessionId,
				destinationSessionId: sessionId,
				mode: branch ? "branch" : "move",
				sourceLinesAtEvent: original.split("\n").filter((line) => line.trim()).length,
				sourceBytesAtEvent: Buffer.byteLength(original),
			} satisfies RelocationRecord;
			await appendManifest(record);
			let storeWarning: string | undefined;
			try {
				await appendStoreRecord(record, name);
			} catch (error) {
				storeWarning = `Canonical store update failed; raw manifest was written. ${error instanceof Error ? error.message : String(error)}`;
			}

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
					"",
					`Mode: ${branch ? "branch/copy" : "move; source marked superseded in canonical store"}`,
					...(name ? ["", `Session name preserved in restart script: ${name}`] : []),
					...(storeWarning ? ["", storeWarning] : []),
				].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("relocate-repo", {
		description: "Move a repo directory on disk and relocate all sessions in its old cwd bucket. Use --dry-run first.",
		handler: async (args, ctx) => {
			const { source, target, force, branch, dryRun } = parseRepoArgs(args);
			if (!source || !target) {
				ctx.ui.notify("Usage: /relocate-repo [--dry-run] [--branch] [--force] <source-repo> <target-repo>", "error");
				return;
			}
			const sourceCwd = normalizeDir(isAbsolute(source) ? source : resolve(ctx.cwd, source));
			const targetCwd = normalizeDir(isAbsolute(target) ? target : resolve(ctx.cwd, target));
			const files = await sessionFilesInBucket(sourceCwd);
			const mode = branch ? "branch" : "move";
			const preview = ["Repo relocation", "", `From: ${sourceCwd}`, `To:   ${targetCwd}`, `Mode: ${mode}`, `Session files: ${files.length}`, ...(dryRun ? ["", "Dry run only; repo and sessions will not be moved."] : [])].filter(Boolean).join("\n");
			if (dryRun) {
				ctx.ui.notify(preview, "info");
				return;
			}
			try {
				const moved = await moveRepoDirectory(sourceCwd, targetCwd, force, false, ctx.ui.confirm);
				if (moved === "skipped") return;
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}
			const batchId = hashId("batch", new Date().toISOString(), sourceCwd, targetCwd, String(files.length));
			let ok = 0;
			let failed = 0;
			let replacements = 0;
			const failures: string[] = [];
			for (const file of files) {
				try {
					const result = await relocateSessionFile(file, sourceCwd, targetCwd, mode, batchId, displayName(ctx));
					ok++;
					replacements += result.replacements;
				} catch (error) {
					failed++;
					failures.push(`${shortPath(file)}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			ctx.ui.notify(["Repo relocation complete", "", `Repo moved: ${sourceCwd} -> ${targetCwd}`, `Session records written: ${ok}`, `Session failures: ${failed}`, `Total direct replacements: ${replacements}`, "Original session files were not deleted.", ...(failures.length ? ["", "Failures:", ...failures.slice(0, 10)] : [])].join("\n"), failed ? "warning" : "info");
		},
	});

	pi.registerCommand("relocate-bucket", {
		description: "Relocate all session files in the current cwd bucket to another cwd. Originals are not deleted; move mode marks them superseded in the store. Use --dry-run first.",
		handler: async (args, ctx) => {
			const { target, force, branch, dryRun } = parseArgs(args);
			if (!target) {
				ctx.ui.notify("Usage: /relocate-bucket [--dry-run] [--branch] [--force] <target-directory>", "error");
				return;
			}
			const oldCwd = normalizeDir(ctx.cwd);
			const targetCwd = normalizeDir(isAbsolute(target) ? target : resolve(ctx.cwd, target));
			try {
				if (!(await ensureTargetDirectory(targetCwd, force, dryRun, ctx.ui.confirm))) return;
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}
			const files = await sessionFilesInBucket(oldCwd);
			if (!files.length) {
				ctx.ui.notify(`No session files found in current bucket: ${sessionBucketName(oldCwd)}`, "warning");
				return;
			}
			const mode = branch ? "branch" : "move";
			const preview = [
				"Bucket relocation",
				"",
				`From: ${oldCwd}`,
				`To:   ${targetCwd}`,
				`Mode: ${mode === "branch" ? "branch/copy" : "move; source observations marked superseded in store"}`,
				`Sessions: ${files.length}`,
				"",
				...files.slice(0, 20).map((file) => `- ${shortPath(file)}`),
				...(files.length > 20 ? [`- ... ${files.length - 20} more`] : []),
			].join("\n");
			if (dryRun) {
				ctx.ui.notify(`${preview}\n\nDry run only; no files or records were written.`, "info");
				return;
			}
			if (!force) {
				const ok = await ctx.ui.confirm("Relocate all sessions in bucket?", `${preview}\n\nOriginals will not be deleted.`);
				if (!ok) return;
			}
			await ctx.waitForIdle();
			const batchId = hashId("batch", new Date().toISOString(), oldCwd, targetCwd, String(files.length));
			let ok = 0;
			let failed = 0;
			let replacements = 0;
			const failures: string[] = [];
			for (const file of files) {
				try {
					const result = await relocateSessionFile(file, oldCwd, targetCwd, mode, batchId, displayName(ctx));
					ok++;
					replacements += result.replacements;
				} catch (error) {
					failed++;
					failures.push(`${shortPath(file)}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			ctx.ui.notify([
				"Bucket relocation complete",
				"",
				`Batch: ${batchId}`,
				`Written: ${ok}`,
				`Failed: ${failed}`,
				`Total direct replacements: ${replacements}`,
				"Original files were not deleted.",
				...(mode === "move" ? ["Source observations were marked superseded/deletion-review candidates in the canonical store."] : ["Branch mode: source observations remain active."]),
				...(failures.length ? ["", "Failures:", ...failures.slice(0, 10)] : []),
			].join("\n"), failed ? "warning" : "info");
		},
	});

	pi.registerCommand("relocate-store-replay", {
		description: "Replay relocations.jsonl into the canonical SQLite session store. Does not mutate session JSONLs.",
		handler: async (_args, ctx) => {
			const result = await replayManifestToStore();
			ctx.ui.notify([
				"Relocation store replay complete",
				"",
				`Manifest: ${shortPath(manifestFile())}`,
				`Store: ${shortPath(storeFile())}`,
				`Written/updated: ${result.ok}`,
				`Failed: ${result.failed}`,
				"",
				"Session JSONLs and relocations.jsonl were not modified.",
			].join("\n"), result.failed ? "warning" : "info");
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
				...movedWarningLines(sessionFile),
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
				...movedWarningLines(sessionFile),
				"",
				"Current position:",
				...lineageSummary(records, sessionFile),
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
