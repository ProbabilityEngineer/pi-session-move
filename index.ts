import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);

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

function expandLeadingTilde(value: string): string {
	if (value === "~" || value.startsWith("~/")) {
		const home = process.env.HOME;
		if (!home) throw new Error("Cannot expand ~ because HOME is not set.");
		return value === "~" ? home : join(home, value.slice(2));
	}
	if (/^~[^/]/.test(value)) {
		throw new Error(`Unsupported tilde path form: ${value}. Use ~/path or an absolute path.`);
	}
	return value;
}

function normalizeDir(value: string): string {
	return resolve(expandLeadingTilde(normalizeDraggedPath(value)));
}

function normalizeDirArg(value: string, baseCwd: string): string {
	const normalized = expandLeadingTilde(normalizeDraggedPath(value));
	return normalizeDir(isAbsolute(normalized) ? normalized : resolve(baseCwd, normalized));
}

function sessionBucketName(cwd: string): string {
	const normalized = normalizeDir(cwd).replace(/[/\\]+$/g, "");
	const withoutRoot = normalized.replace(/^[/\\]+/, "");
	return `--${withoutRoot.replace(/[/\\:]+/g, "-")}--`;
}

function defaultAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? ".", ".pi", "agent");
}

type ParsedSessionFilename = { baseTimestamp?: string; providerSessionId?: string; relocatedTimestamp?: string; relocatedCwdSlug?: string; isRelocated: boolean };

function parseSessionFilename(path: string): ParsedSessionFilename {
	const name = basename(path).replace(/\.jsonl$/i, "");
	const uuid = name.match(/(?:^|_)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_|$)/i)?.[1];
	const baseTimestamp = name.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/)?.[1];
	const relocated = name.match(/_relocated_(?:(.+)_)?(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)$/);
	return { baseTimestamp, providerSessionId: uuid, relocatedCwdSlug: relocated?.[1], relocatedTimestamp: relocated?.[2], isRelocated: Boolean(relocated) };
}

function cwdFromSessionBucket(path: string): string | undefined {
	const bucket = basename(dirname(path));
	const match = bucket.match(/^--(.+)--$/);
	return match ? `/${match[1].replace(/-/g, "/")}` : undefined;
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

function lineageNamesFile(): string {
	return join(defaultAgentDir(), "relocation-lineages.jsonl");
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

type LineageNameRecord = {
	type: "lineage_named";
	root: string;
	name: string;
	description?: string;
	currentSession?: string;
	sessionId?: string;
	created: string;
	updated: string;
	source: "pi-relocate";
};

async function appendManifest(record: RelocationRecord): Promise<void> {
	const path = manifestFile();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

async function appendLineageName(record: LineageNameRecord): Promise<void> {
	const path = lineageNamesFile();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

function hashId(prefix: string, ...parts: (string | undefined)[]) {
	return `${prefix}_${parts.filter(Boolean).join("\u0000").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 48)}_${Math.abs(parts.join("\u0000").split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)).toString(16)}`;
}

function parseJson<T>(value: string | undefined, fallback: T): T {
	if (!value) return fallback;
	try { return JSON.parse(value) as T; } catch { return fallback; }
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
CREATE TABLE IF NOT EXISTS prune_operations (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, source_path TEXT NOT NULL, replacement_path TEXT, action TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, trash_path TEXT, current_lines INTEGER, event_lines INTEGER, current_bytes INTEGER, event_bytes INTEGER, source TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
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
		const inferredLegacyMove = record.mode === undefined;
		const mode = record.mode ?? "move";
		const confidence = inferredLegacyMove ? "inferred-from-legacy-manifest" : "authoritative";
		const edgeId = hashId("edge", record.ts, record.sourceSession, record.destinationSession);
		upsertEdge.run(edgeId, sourceSessionId, destSessionId, mode === "branch" ? "branch" : "relocation", record.ts, sourceObsId, destObsId, confidence, "pi-relocate", JSON.stringify({ fromCwd: record.fromCwd, toCwd: record.toCwd, replacements: record.replacements, parent: record.parent, sourceSessionId: record.sourceSessionId, destinationSessionId: record.destinationSessionId, mode, batchId: record.batchId, sourceLinesAtEvent: record.sourceLinesAtEvent, sourceBytesAtEvent: record.sourceBytesAtEvent, inferredLegacyMove }));
		if (record.batchId) upsertBatch.run(record.batchId, "bucket_relocation", record.fromCwd, record.toCwd, record.ts, "pi-relocate", "applied", JSON.stringify({ mode, inferredLegacyMove }));
		if (mode === "move") {
			const markReason = inferredLegacyMove ? "legacy relocation manifest record inferred as move; manual review required" : "relocated by pi-relocate move semantics";
			upsertMark.run(hashId("mark", sourceObsId, "superseded", destObsId, record.ts), sourceObsId, "superseded", markReason, destObsId, "pi-relocate", record.ts, confidence, 1, JSON.stringify({ batchId: record.batchId, inferredLegacyMove }));
			upsertMark.run(hashId("mark", sourceObsId, "deletion_candidate", destObsId, record.ts), sourceObsId, "deletion_candidate", "old copy after relocation; requires manual review before deletion", destObsId, "pi-relocate", record.ts, confidence, 1, JSON.stringify({ batchId: record.batchId, inferredLegacyMove }));
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

async function indexSessionObservation(path: string): Promise<void> {
	const parsed = parseSessionFilename(path);
	const cwd = cwdFromSessionBucket(path);
	const stats = await sessionStats(path);
	const db = new DatabaseSync(storeFile());
	try {
		initStore(db);
		const sourceId = "source_pi_sessions_crawl";
		db.prepare("INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(sourceId, "pi", "sessions_crawl", join(defaultAgentDir(), "sessions"), "Pi sessions crawl", null, null, "{}");
		const sessionId = sessionFileId(path);
		const obsId = observationId(path);
		db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sessionId, "pi", parsed.providerSessionId ?? null, path, null, stats.fileMtime, parsed.baseTimestamp ?? null, null, null, stats.lineCount, stats.byteCount, null, null, JSON.stringify({ cwd, filename: parsed }));
		db.prepare("INSERT OR REPLACE INTO session_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(obsId, sessionId, sourceId, path, parsed.providerSessionId ?? null, new Date().toISOString(), "sessions-crawl", stats.fileBirthtime, stats.fileMtime, stats.byteCount, stats.lineCount, null, null, null, null, JSON.stringify({ cwd, filename: parsed, unlinkedObservation: true }));
		db.prepare("INSERT OR REPLACE INTO labels VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(hashId("label", sessionId, "cwd", cwd), "session", sessionId, "cwd", cwd ?? "unknown", null, null, "inferred", sourceId, null, "{}");
	} finally { db.close(); }
}

async function crawlSessionFiles(root = join(defaultAgentDir(), "sessions")): Promise<{ indexed: number; failed: number }> {
	let indexed = 0;
	let failed = 0;
	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				try { await indexSessionObservation(path); indexed++; } catch { failed++; }
			}
		}
	}
	await walk(root);
	return { indexed, failed };
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

type ObservationMark = { markType: string; reason?: string; replacementObservationId?: string; replacementPath?: string; observationPath?: string; timestamp: string; confidence: string; manualReviewRequired: boolean; metadata?: Record<string, unknown> };
type PruneCandidate = { sourcePath: string; replacementPath?: string; timestamp: string; confidence: string; eventLines?: number; eventBytes?: number; currentLines?: number; currentBytes?: number; category: "eligible" | "legacy-review" | "unsafe"; reason: string };
type ThreadResumeTarget = { threadId: string; status: string; recommendedSessionId?: string; recommendedObservationId?: string; recommendedPath?: string; activeLeafPaths: string[]; recoverablePaths: string[]; reasons: string[] };

function currentSessionMarks(sessionFile?: string): ObservationMark[] {
	if (!sessionFile) return [];
	try {
		const db = new DatabaseSync(storeFile(), { readOnly: true });
		try {
			initStore(db);
			const rows = db.prepare(`
SELECT m.mark_type AS markType, m.reason AS reason, m.replacement_observation_id AS replacementObservationId, o.path AS observationPath, r.path AS replacementPath, m.timestamp AS timestamp, m.confidence AS confidence, m.manual_review_required AS manualReviewRequired, m.metadata_json AS metadataJson
FROM observation_marks m
JOIN session_observations o ON o.id = m.observation_id
LEFT JOIN session_observations r ON r.id = m.replacement_observation_id
WHERE o.path = ?
ORDER BY m.timestamp DESC, m.mark_type
`).all(sessionFile) as { markType: string; reason?: string; replacementObservationId?: string; observationPath?: string; replacementPath?: string; timestamp: string; confidence: string; manualReviewRequired: number ; metadataJson?: string }[];
			return rows.map((row) => ({ ...row, manualReviewRequired: Boolean(row.manualReviewRequired), metadata: parseJson(row.metadataJson, {}) as Record<string, unknown> }));
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
}

async function uniqueTrashPath(sourcePath: string): Promise<string> {
	const trashDir = join(process.env.HOME ?? dirname(sourcePath), ".Trash");
	await mkdir(trashDir, { recursive: true });
	const parsed = basename(sourcePath);
	let candidate = join(trashDir, parsed);
	let index = 1;
	while (await stat(candidate).then(() => true, () => false)) {
		candidate = join(trashDir, `${parsed}.${index}`);
		index++;
	}
	return candidate;
}

function readPruneCandidates(currentSession?: string): PruneCandidate[] {
	try {
		const db = new DatabaseSync(storeFile(), { readOnly: true });
		try {
			initStore(db);
			const rows = db.prepare(`
SELECT o.path AS sourcePath, r.path AS replacementPath, m.timestamp AS timestamp, m.confidence AS confidence, e.metadata_json AS edgeMetadata
FROM observation_marks m
JOIN session_observations o ON o.id = m.observation_id
LEFT JOIN session_observations r ON r.id = m.replacement_observation_id
LEFT JOIN edges e ON e.source_observation_id = o.id AND e.target_observation_id = r.id
WHERE m.mark_type = 'deletion_candidate'
ORDER BY m.timestamp DESC, o.path
`).all() as { sourcePath: string; replacementPath?: string; timestamp: string; confidence: string; edgeMetadata?: string }[];
			const bySource = new Map<string, PruneCandidate>();
			for (const row of rows) {
				if (bySource.has(row.sourcePath)) continue;
				let metadata: { sourceLinesAtEvent?: number; sourceBytesAtEvent?: number; mode?: string } = {};
				try { metadata = row.edgeMetadata ? JSON.parse(row.edgeMetadata) : {}; } catch {}
				let category: PruneCandidate["category"] = "eligible";
				let reason = "superseded move source with replacement";
				if (row.sourcePath === currentSession) { category = "unsafe"; reason = "current live session"; }
				else if (!row.replacementPath) { category = "unsafe"; reason = "missing replacement observation"; }
				else if (metadata.mode === "branch") { category = "unsafe"; reason = "branch/copy source"; }
				else if (row.confidence !== "authoritative") { category = "legacy-review"; reason = `legacy/inferred mark (${row.confidence})`; }
				bySource.set(row.sourcePath, { sourcePath: row.sourcePath, replacementPath: row.replacementPath, timestamp: row.timestamp, confidence: row.confidence, eventLines: metadata.sourceLinesAtEvent, eventBytes: metadata.sourceBytesAtEvent, category, reason });
			}
			return [...bySource.values()];
		} finally { db.close(); }
	} catch { return []; }
}

async function classifyPruneCandidates(currentSession?: string): Promise<PruneCandidate[]> {
	const candidates = readPruneCandidates(currentSession);
	for (const candidate of candidates) {
		const sourceStats = await sessionStats(candidate.sourcePath);
		candidate.currentLines = sourceStats.lineCount ?? undefined;
		candidate.currentBytes = sourceStats.byteCount ?? undefined;
		if (!(await stat(candidate.sourcePath).then((st) => st.isFile(), () => false))) {
			candidate.category = "unsafe";
			candidate.reason = "source file missing";
		} else if (!candidate.replacementPath || !(await stat(candidate.replacementPath).then((st) => st.isFile(), () => false))) {
			candidate.category = "unsafe";
			candidate.reason = "replacement file missing";
		} else if (candidate.category === "eligible" && candidate.eventLines !== undefined && candidate.currentLines !== candidate.eventLines) {
			candidate.category = "unsafe";
			candidate.reason = "source line count changed after relocation";
		} else if (candidate.category === "eligible" && candidate.eventBytes !== undefined && candidate.currentBytes !== candidate.eventBytes) {
			candidate.category = "unsafe";
			candidate.reason = "source byte count changed after relocation";
		} else if (candidate.category === "eligible" && (candidate.eventLines === undefined || candidate.eventBytes === undefined)) {
			candidate.category = "legacy-review";
			candidate.reason = "missing relocation line/byte checkpoint";
		}
	}
	return candidates;
}

async function uniqueStagePath(sourcePath: string, batch: string): Promise<string> {
	const bucket = basename(dirname(sourcePath));
	const dir = join(defaultAgentDir(), "session-archive", "to-delete", batch, bucket);
	await mkdir(dir, { recursive: true });
	let candidate = join(dir, basename(sourcePath));
	let index = 1;
	while (await stat(candidate).then(() => true, () => false)) candidate = join(dir, `${basename(sourcePath)}.${index++}`);
	return candidate;
}

function duplicatePruneCandidates(candidates: PruneCandidate[], currentSession?: string): PruneCandidate[] {
	const groups = new Map<string, PruneCandidate[]>();
	for (const candidate of candidates) {
		const id = parseSessionFilename(candidate.sourcePath).providerSessionId;
		if (!id) continue;
		const group = groups.get(id) ?? [];
		group.push(candidate);
		groups.set(id, group);
	}
	const out: PruneCandidate[] = [];
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const sorted = group.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
		for (const candidate of sorted.slice(0, -1)) {
			if (candidate.sourcePath === currentSession) continue;
			out.push({ ...candidate, category: candidate.category === "unsafe" ? "unsafe" : "legacy-review", reason: `duplicate provider session id; keeping ${shortPath(sorted[sorted.length - 1].sourcePath)}` });
		}
	}
	return out;
}

function recordPruneOperation(candidate: PruneCandidate, status: string, action: string, reason: string, trashPath?: string) {
	const db = new DatabaseSync(storeFile());
	try {
		initStore(db);
		db.prepare("INSERT OR REPLACE INTO prune_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(hashId("prune", candidate.sourcePath, new Date().toISOString()), new Date().toISOString(), candidate.sourcePath, candidate.replacementPath ?? null, action, status, reason, trashPath ?? null, candidate.currentLines ?? null, candidate.eventLines ?? null, candidate.currentBytes ?? null, candidate.eventBytes ?? null, "pi-relocate", JSON.stringify({ confidence: candidate.confidence, category: candidate.category }));
	} finally { db.close(); }
}

function allAvailabilityMarks(): ObservationMark[] {
	try {
		const db = new DatabaseSync(storeFile(), { readOnly: true });
		try {
			initStore(db);
			const rows = db.prepare(`
SELECT m.mark_type AS markType, m.reason AS reason, m.replacement_observation_id AS replacementObservationId, o.path AS observationPath, r.path AS replacementPath, m.timestamp AS timestamp, m.confidence AS confidence, m.manual_review_required AS manualReviewRequired, m.metadata_json AS metadataJson
FROM observation_marks m
JOIN session_observations o ON o.id = m.observation_id
LEFT JOIN session_observations r ON r.id = m.replacement_observation_id
ORDER BY m.timestamp DESC, m.mark_type
`).all() as { markType: string; reason?: string; replacementObservationId?: string; observationPath?: string; replacementPath?: string; timestamp: string; confidence: string; manualReviewRequired: number ; metadataJson?: string }[];
			return rows.map((row) => ({ ...row, manualReviewRequired: Boolean(row.manualReviewRequired), metadata: parseJson(row.metadataJson, {}) as Record<string, unknown> }));
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
}

function isPreserveMark(mark: ObservationMark) {
	return mark.markType === "preserve" || mark.markType === "intentional_branch";
}

function preserveLabel(mark: ObservationMark) {
	return typeof mark.metadata?.label === "string" ? mark.metadata.label : mark.reason;
}

function unavailableSessionSet(): Set<string> {
	const marks = allAvailabilityMarks();
	const preserved = new Set(marks.filter(isPreserveMark).map((mark) => mark.observationPath).filter((path): path is string => Boolean(path)));
	return new Set(marks.filter((mark) => (mark.markType === "superseded" || mark.markType === "deletion_candidate") && !preserved.has(mark.observationPath ?? "")).map((mark) => mark.observationPath).filter((path): path is string => Boolean(path)));
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
	const preserveMarks = marks.filter(isPreserveMark);
	const relevant = marks.filter((mark) => mark.markType === "superseded" || mark.markType === "deletion_candidate");
	if (preserveMarks.length) {
		const latest = preserveMarks[0];
		return [
			"",
			"✓ Current session is a preserved intentional branch:",
			`- ${preserveLabel(latest) ?? "preserved branch"} @ ${latest.timestamp}${latest.reason ? ` — ${latest.reason}` : ""}`,
			`  provenance: ${latest.confidence}; source: ${latest.metadata?.sidecarMarkType ?? latest.markType}`,
			...(relevant.length ? ["  Superseded/deletion-candidate relocation marks are retained as history but ignored for normal prune guidance."] : []),
			"Raw session file should be preserved unless explicitly forced.",
		];
	}
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

async function launchInTerminal(scriptFile: string): Promise<void> {
	await execFileAsync("osascript", ["-e", `tell application "Terminal" to do script ${JSON.stringify(`bash ${shellQuote(scriptFile)}`)}`, "-e", `tell application "Terminal" to activate`]);
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

async function readLineageNames(): Promise<LineageNameRecord[]> {
	try {
		const raw = await readFile(lineageNamesFile(), "utf8");
		return raw
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as LineageNameRecord)
			.filter((record) => record.type === "lineage_named" && Boolean(record.root) && Boolean(record.name));
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
	const sessionId = parseSessionFilename(sourceFile).providerSessionId;
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

function parseArgs(args: string): { target?: string; force: boolean; branch: boolean; dryRun: boolean; launch: boolean; shutdown: boolean } {
	let force = false;
	let branch = false;
	let dryRun = false;
	let launch = false;
	let shutdown = false;
	const positional: string[] = [];
	for (const value of parseWords(args)) {
		if (value === "--force" || value === "-f") force = true;
		else if (value === "--branch" || value === "--copy") branch = true;
		else if (value === "--dry-run" || value === "-n") dryRun = true;
		else if (value === "--launch") launch = true;
		else if (value === "--shutdown") shutdown = true;
		else positional.push(value);
	}

	return { target: positional.join(" ") || undefined, force, branch, dryRun, launch, shutdown };
}

function parseRepoArgs(args: string): { source?: string; target?: string; force: boolean; branch: boolean; dryRun: boolean; usageError: boolean } {
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
	if (positional.length === 1) return { target: positional[0], force, branch, dryRun, usageError: false };
	if (positional.length === 2) return { source: positional[0], target: positional[1], force, branch, dryRun, usageError: false };
	return { force, branch, dryRun, usageError: true };
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

function lineageRoot(lineage: RelocationRecord[], sessionFile?: string): string | undefined {
	return lineage[0]?.sourceSession ?? sessionFile;
}

function latestLineageName(names: LineageNameRecord[], root?: string, sessionFile?: string): LineageNameRecord | undefined {
	const latest = (records: LineageNameRecord[]) => [...records].sort((a, b) => a.updated.localeCompare(b.updated)).at(-1);
	if (sessionFile) {
		const exact = latest(names.filter((record) => record.currentSession === sessionFile));
		if (exact) return exact;
	}
	if (!root) return undefined;
	const rootMatches = names.filter((record) => record.root === root);
	const distinctRootNames = new Set(rootMatches.map((record) => record.name));
	return distinctRootNames.size === 1 ? latest(rootMatches) : undefined;
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

async function isRepoDir(path: string): Promise<boolean> {
	return (await stat(join(path, ".git")).then(() => true, () => false)) || (await stat(join(path, ".jj")).then(() => true, () => false));
}

type RepoMovePlan = { source: string; target: string; sessionCount: number; status: "ready" | "target-exists" | "no-sessions" };

async function repoMovePlans(oldRoot: string, newRoot: string): Promise<RepoMovePlan[]> {
	const entries = await readdir(oldRoot, { withFileTypes: true });
	const plans: RepoMovePlan[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const source = join(oldRoot, entry.name);
		if (!(await isRepoDir(source))) continue;
		const target = join(newRoot, entry.name);
		const sessionCount = (await sessionFilesInBucket(source)).length;
		const targetExists = await stat(target).then(() => true, () => false);
		plans.push({ source, target, sessionCount, status: targetExists ? "target-exists" : sessionCount ? "ready" : "no-sessions" });
	}
	return plans.sort((a, b) => a.source.localeCompare(b.source));
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
	const lineageNames = await readLineageNames();
	const discovered = await findRelocatedSessions();
	const byDestination = new Map(records.map((record) => [record.destinationSession, record]));
	const currentIndex = findCurrentIndex(records, sessionFile);
	const currentLineage = buildLineage(records, currentIndex);
	const currentName = latestLineageName(lineageNames, lineageRoot(currentLineage, sessionFile), sessionFile);
	const forks = forkRecords(records, currentLineage);
	const unrecorded = discovered.filter((path) => !byDestination.has(path));
	const lines = [
		"Relocation status",
		"",
		`Current cwd: ${shortPath(ctx.cwd ?? "")}`,
		`Current session: ${sessionFile ? shortPath(sessionFile) : "(ephemeral)"}`,
		`Current session id: ${ctx.sessionManager?.getSessionId?.() ?? "unknown"}`,
		`Current lineage name: ${currentName?.name ?? "(unnamed)"}`,
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
	const lineageNames = await readLineageNames();
	const currentIndex = findCurrentIndex(records, sessionFile);
	const lineage = buildLineage(records, currentIndex);
	const currentName = latestLineageName(lineageNames, lineageRoot(lineage, sessionFile), sessionFile);
	const forks = forkRecords(records, lineage);
	const lines = [
		"Relocation lineage",
		"",
		`Current cwd: ${shortPath(ctx.cwd ?? "")}`,
		`Current session: ${sessionFile ? shortPath(sessionFile) : "(ephemeral)"}`,
		`Current session id: ${ctx.sessionManager?.getSessionId?.() ?? "unknown"}`,
		`Lineage name: ${currentName?.name ?? "(unnamed)"}`,
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
			const { target, force, branch, launch, shutdown } = parseArgs(args);
			if (!target) {
				ctx.ui.notify("Usage: /relocate [--launch] [--shutdown] [--force] <target-directory>", "error");
				return;
			}

			const sessionFile = ctx.sessionManager.getSessionFile();
			const sessionId = ctx.sessionManager.getSessionId();
			if (!sessionFile) {
				ctx.ui.notify("Cannot relocate an ephemeral session with no session file.", "error");
				return;
			}

			const oldCwd = normalizeDir(ctx.cwd);
			const targetCwd = normalizeDirArg(target, ctx.cwd);
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

			let launchWarning: string | undefined;
			if (launch) {
				try {
					await launchInTerminal(restart.latestFile);
					if (shutdown) await ctx.shutdown?.();
				} catch (error) {
					launchWarning = `Terminal launch failed: ${error instanceof Error ? error.message : String(error)}`;
				}
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
					...(launch ? ["", launchWarning ? launchWarning : `Launched in Terminal.app${shutdown ? " and requested shutdown of this Pi process" : ""}.`] : []),
					...(name ? ["", `Session name preserved in restart script: ${name}`] : []),
					...(storeWarning ? ["", storeWarning] : []),
				].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("relocate-repo", {
		description: "Move a repo directory on disk and relocate all sessions in its old cwd bucket. Use --dry-run first. With one path, source defaults to current cwd.",
		handler: async (args, ctx) => {
			const { source, target, force, branch, dryRun, usageError } = parseRepoArgs(args);
			if (usageError || !target) {
				ctx.ui.notify("Usage: /relocate-repo [--dry-run] [--branch] [--force] <target-repo> OR /relocate-repo [flags] <source-repo> <target-repo>", "error");
				return;
			}
			const sourceArg = source ?? ctx.cwd;
			const sourceCwd = normalizeDirArg(sourceArg, ctx.cwd);
			const targetCwd = normalizeDirArg(target, ctx.cwd);
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

	pi.registerCommand("relocate-repos", {
		description: "Move child repo directories from one root to another and relocate each repo session bucket. Use --dry-run first.",
		handler: async (args, ctx) => {
			const { source, target, force, branch, dryRun, usageError } = parseRepoArgs(args);
			if (usageError || !source || !target) {
				ctx.ui.notify("Usage: /relocate-repos [--dry-run] [--branch] [--force] <old-root> <new-root>", "error");
				return;
			}
			const oldRoot = normalizeDirArg(source, ctx.cwd);
			const newRoot = normalizeDirArg(target, ctx.cwd);
			let plans: RepoMovePlan[];
			try {
				plans = await repoMovePlans(oldRoot, newRoot);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}
			const ready = plans.filter((plan) => plan.status === "ready");
			const skipped = plans.filter((plan) => plan.status !== "ready");
			const mode = branch ? "branch" : "move";
			const preview = ["Repo root relocation", "", `From root: ${oldRoot}`, `To root:   ${newRoot}`, `Mode: ${mode}`, `Ready repos: ${ready.length}`, `Skipped: ${skipped.length}`, "", ...ready.slice(0, 20).map((plan) => `- ${basename(plan.source)} (${plan.sessionCount} sessions)`), ...(ready.length > 20 ? [`- ... ${ready.length - 20} more ready`] : []), ...(skipped.length ? ["", "Skipped:", ...skipped.slice(0, 10).map((plan) => `- ${basename(plan.source)} (${plan.status})`)] : [])].join("\n");
			if (dryRun) {
				ctx.ui.notify(`${preview}\n\nDry run only; no repos or sessions were moved.`, "info");
				return;
			}
			if (!ready.length) {
				ctx.ui.notify(`${preview}\n\nNo ready repos to move.`, "info");
				return;
			}
			if (!force) {
				const ok = await ctx.ui.confirm("Move repo root children?", `${preview}\n\nThis moves ready repo directories and relocates their session buckets. Original session files are not deleted.`);
				if (!ok) return;
			}
			await mkdir(newRoot, { recursive: true });
			let reposMoved = 0;
			let sessionsWritten = 0;
			let failed = 0;
			const failures: string[] = [];
			const rootBatchId = hashId("batch", new Date().toISOString(), oldRoot, newRoot, String(ready.length));
			for (const plan of ready) {
				try {
					await rename(plan.source, plan.target);
					reposMoved++;
					const childBatchId = hashId("batch", rootBatchId, plan.source, plan.target);
					for (const file of await sessionFilesInBucket(plan.source)) {
						try {
							await relocateSessionFile(file, plan.source, plan.target, mode, childBatchId, displayName(ctx));
							sessionsWritten++;
						} catch (error) {
							failed++;
							failures.push(`${shortPath(file)}: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				} catch (error) {
					failed++;
					failures.push(`${shortPath(plan.source)}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			ctx.ui.notify(["Repo root relocation complete", "", `Root batch: ${rootBatchId}`, `Repos moved: ${reposMoved}`, `Session records written: ${sessionsWritten}`, `Failures: ${failed}`, `Skipped before move: ${skipped.length}`, "Original session files were not deleted.", ...(failures.length ? ["", "Failures:", ...failures.slice(0, 10)] : [])].join("\n"), failed ? "warning" : "info");
		},
	});

	pi.registerCommand("relocate-bucket", {
		description: "Relocate all session files in the current cwd bucket to another cwd. Originals are not deleted; move mode marks them superseded in the store. Use --dry-run first.",
		handler: async (args, ctx) => {
			const { target, force, branch, dryRun, launch, shutdown } = parseArgs(args);
			if (!target) {
				ctx.ui.notify("Usage: /relocate-bucket [--dry-run] [--launch] [--shutdown] [--branch] [--force] <target-directory>", "error");
				return;
			}
			const oldCwd = normalizeDir(ctx.cwd);
			const targetCwd = normalizeDirArg(target, ctx.cwd);
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
			let restart: { scriptFile: string; latestFile: string } | undefined;
			let launchWarning: string | undefined;
			const currentSessionFile = ctx.sessionManager?.getSessionFile?.();
			const failures: string[] = [];
			for (const file of files) {
				try {
					const result = await relocateSessionFile(file, oldCwd, targetCwd, mode, batchId, displayName(ctx));
					ok++;
					replacements += result.replacements;
					if (file === currentSessionFile) restart = await writeRestartScripts(targetCwd, result.record.destinationSession, ctx.sessionManager?.getSessionId?.(), displayName(ctx));
				} catch (error) {
					failed++;
					failures.push(`${shortPath(file)}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			if (launch) {
				if (!restart) launchWarning = "No restart script was written for the current live session in this bucket.";
				else {
					try {
						await launchInTerminal(restart.latestFile);
						if (shutdown) await ctx.shutdown?.();
					} catch (error) {
						launchWarning = `Terminal launch failed: ${error instanceof Error ? error.message : String(error)}`;
					}
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
				...(restart ? ["", "Restart script:", restart.scriptFile, "Restart Pi with:", `bash ${shellQuote(restart.latestFile)}`] : []),
				...(launch ? ["", launchWarning ? launchWarning : `Launched in Terminal.app${shutdown ? " and requested shutdown of this Pi process" : ""}.`] : []),
				...(failures.length ? ["", "Failures:", ...failures.slice(0, 10)] : []),
			].join("\n"), failed ? "warning" : "info");
		},
	});

	pi.registerCommand("relocate-prune", {
		description: "Safely move superseded relocation source session files to Trash. Use --dry-run first.",
		handler: async (args, ctx) => {
			const dryRun = hasFlag(args, "--dry-run") || hasFlag(args, "-n");
			const force = hasFlag(args, "--force") || hasFlag(args, "-f");
			const stage = hasFlag(args, "--stage");
			const duplicates = hasFlag(args, "--duplicates");
			let candidates = await classifyPruneCandidates(ctx.sessionManager?.getSessionFile?.());
			if (duplicates) candidates = [...candidates, ...duplicatePruneCandidates(candidates, ctx.sessionManager?.getSessionFile?.())];
			const eligible = candidates.filter((c) => c.category === "eligible" || (duplicates && force && c.category === "legacy-review"));
			const legacy = candidates.filter((c) => c.category === "legacy-review" && !(duplicates && force));
			const unsafe = candidates.filter((c) => c.category === "unsafe");
			const preview = [
				"Relocation prune candidates",
				"",
				`Eligible: ${eligible.length}`,
				`Legacy/manual review: ${legacy.length}`,
				`Unsafe/skipped: ${unsafe.length}`,
				"",
				...eligible.slice(0, 20).map((c) => `- ${shortPath(c.sourcePath)} -> ${stage ? "stage" : "Trash"} (${c.reason})`),
				...(eligible.length > 20 ? [`- ... ${eligible.length - 20} more eligible`] : []),
				...(legacy.length ? ["", "Legacy/manual review:", ...legacy.slice(0, 10).map((c) => `- ${shortPath(c.sourcePath)} (${c.reason})`)] : []),
				...(unsafe.length ? ["", "Unsafe/skipped:", ...unsafe.slice(0, 10).map((c) => `- ${shortPath(c.sourcePath)} (${c.reason})`)] : []),
			].join("\n");
			if (dryRun) {
				ctx.ui.notify(`${preview}\n\nDry run only; no files were moved.`, "info");
				return;
			}
			if (!eligible.length) {
				ctx.ui.notify(`${preview}\n\nNo eligible files to prune.`, "info");
				return;
			}
			if (!force) {
				const ok = await ctx.ui.confirm("Move superseded session files to Trash?", `${preview}\n\nThis moves eligible files to ~/.Trash and records prune_operations in the store. It does not permanently delete files.`);
				if (!ok) return;
			}
			let trashed = 0;
			let failed = 0;
			const failures: string[] = [];
			const stageBatch = scriptStamp();
			for (const candidate of eligible) {
				try {
					const trashPath = stage ? await uniqueStagePath(candidate.sourcePath, stageBatch) : await uniqueTrashPath(candidate.sourcePath);
					await rename(candidate.sourcePath, trashPath);
					recordPruneOperation(candidate, stage ? "staged" : "trashed", stage ? "stage" : "trash", candidate.reason, trashPath);
					trashed++;
				} catch (error) {
					failed++;
					const reason = error instanceof Error ? error.message : String(error);
					recordPruneOperation(candidate, "failed", "trash", reason);
					failures.push(`${shortPath(candidate.sourcePath)}: ${reason}`);
				}
			}
			ctx.ui.notify(["Relocation prune complete", "", `${stage ? "Staged" : "Trashed"}: ${trashed}`, ...(stage ? [`Stage batch: ${join(defaultAgentDir(), "session-archive", "to-delete", stageBatch)}`] : []), `Failed: ${failed}`, `Legacy/manual review skipped: ${legacy.length}`, `Unsafe skipped: ${unsafe.length}`, ...(failures.length ? ["", "Failures:", ...failures.slice(0, 10)] : [])].join("\n"), failed ? "warning" : "info");
		},
	});

	pi.registerCommand("relocate-store-replay", {
		description: "Replay relocations.jsonl into the canonical SQLite session store. Add --crawl-sessions to index all session JSONLs. Does not mutate session JSONLs.",
		handler: async (args, ctx) => {
			const result = await replayManifestToStore();
			const crawl = hasFlag(args, "--crawl-sessions") ? await crawlSessionFiles() : undefined;
			ctx.ui.notify([
				"Relocation store replay complete",
				"",
				`Manifest: ${shortPath(manifestFile())}`,
				`Store: ${shortPath(storeFile())}`,
				`Manifest records written/updated: ${result.ok}`,
				`Manifest failures: ${result.failed}`,
				...(crawl ? [`Crawl indexed: ${crawl.indexed}`, `Crawl failed: ${crawl.failed}`] : []),
				"",
				"Session JSONLs and relocations.jsonl were not modified.",
			].join("\n"), result.failed || crawl?.failed ? "warning" : "info");
		},
	});

	pi.registerCommand("relocate-status", {
		description: "Show compact relocation status. Use --all for full details.",
		handler: async (args, ctx) => {
			const showAll = hasFlag(args, "--all");
			const sessionFile = ctx.sessionManager.getSessionFile();
			const records = await readManifest();
			const lineageNames = await readLineageNames();
			const discovered = await findRelocatedSessions();
			const byDestination = new Map(records.map((record) => [record.destinationSession, record]));
			const currentIndex = findCurrentIndex(records, sessionFile);
			const currentLineage = buildLineage(records, currentIndex);
			const currentName = latestLineageName(lineageNames, lineageRoot(currentLineage, sessionFile), sessionFile);
			const forks = forkRecords(records, currentLineage);
			const unrecorded = discovered.filter((path) => !byDestination.has(path));
			const currentSessionId = ctx.sessionManager.getSessionId();
			const lines = [
				"Relocation status",
				"",
				`Current cwd: ${shortPath(ctx.cwd)}`,
				`Current session: ${sessionFile ? shortPath(sessionFile) : "(ephemeral)"}`,
				`Current session id: ${currentSessionId}`,
				`Current lineage name: ${currentName?.name ?? "(unnamed)"}`,
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
		description: "Show or name the current relocation ancestry chain. Use --name <name>; --files includes session paths.",
		handler: async (args, ctx) => {
			const words = parseWords(args);
			const showFiles = words.includes("--files");
			const nameFlag = words.indexOf("--name");
			const name = nameFlag >= 0 ? words.slice(nameFlag + 1).filter((word) => !word.startsWith("--")).join(" ").trim() : undefined;
			const sessionFile = ctx.sessionManager.getSessionFile();
			const records = await readManifest();
			const lineageNames = await readLineageNames();
			const currentIndex = findCurrentIndex(records, sessionFile);
			const lineage = buildLineage(records, currentIndex);
			const root = lineageRoot(lineage, sessionFile);
			if (name) {
				if (!root) {
					ctx.ui.notify("Cannot name an ephemeral lineage with no session file.", "error");
					return;
				}
				const now = new Date().toISOString();
				await appendLineageName({ type: "lineage_named", root, name, currentSession: sessionFile, sessionId: ctx.sessionManager.getSessionId(), created: now, updated: now, source: "pi-relocate" });
				const sessionManager = ctx.sessionManager as { appendSessionInfo?: (name: string) => string };
				const sessionNameEntry = typeof sessionManager.appendSessionInfo === "function" ? sessionManager.appendSessionInfo(name) : undefined;
				ctx.ui.notify([
					"Relocation lineage named",
					"",
					`Name: ${name}`,
					...(sessionNameEntry ? [`Pi session display name updated: ${name}`] : ["Pi session display name was not updated; this Pi version does not expose appendSessionInfo to extensions."]),
					`Root: ${shortPath(root)}`,
					`Metadata: ${shortPath(lineageNamesFile())}`,
				].join("\n"), "info");
				return;
			}
			const currentName = latestLineageName(lineageNames, root, sessionFile);
			const forks = forkRecords(records, lineage);
			const lines = [
				"Relocation lineage",
				"",
				`Current cwd: ${shortPath(ctx.cwd)}`,
				`Current session: ${sessionFile ? shortPath(sessionFile) : "(ephemeral)"}`,
				`Current session id: ${ctx.sessionManager.getSessionId()}`,
				`Lineage name: ${currentName?.name ?? "(unnamed)"}`,
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
