#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { SessionManager, type SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";

const home = process.env.HOME ?? ".";
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
const version = await readVersion();

async function readVersion(): Promise<string> {
	for (const url of [new URL("../package.json", import.meta.url), new URL("../../package.json", import.meta.url)]) {
		try {
			return (JSON.parse(await readFile(url, "utf8")) as { version?: string }).version ?? "0.0.0";
		} catch {}
	}
	return "0.0.0";
}

type RelocationRecord = { ts?: string; sourceSession?: string; destinationSession?: string; parent?: string; fromCwd?: string; toCwd?: string };
type LineageNameRecord = { type?: string; root?: string; name?: string; currentSession?: string; updated?: string };
type StoreExport = { sessionObservations?: StoreObservation[]; labels?: StoreLabel[] };
type StoreObservation = { sessionId: string; path: string; lineCount?: number; fileMtime?: string; metadata?: { cwd?: string; displayName?: string } };
type StoreLabel = { targetType?: string; targetId?: string; labelType?: string; value?: string; confidence?: string };
type SessionInfoRecord = { type?: string; name?: string; timestamp?: string };
type ResumeSessionInfo = { path: string; messages: number; mtimeMs: number; cwd?: string };
type LineageRow = { name: string; best: ResumeSessionInfo; count: number; totalMessages: number };

async function readJsonl<T>(path: string): Promise<T[]> {
	try {
		return (await readFile(path, "utf8")).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
	} catch {
		return [];
	}
}

async function readJson<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

async function firstSessionInfoName(path: string): Promise<string | undefined> {
	try {
		for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
			if (!line.includes('"session_info"') || !line.includes('"name"')) continue;
			const record = JSON.parse(line) as SessionInfoRecord;
			if (record.type === "session_info" && record.name) return record.name;
		}
	} catch {}
	return undefined;
}

async function restartScriptNames(): Promise<Map<string, string>> {
	const dir = join(agentDir, "session-move", "restart-scripts");
	const bySession = new Map<string, string>();
	try {
		for (const entry of await readdir(dir)) {
			if (!entry.endsWith(".sh")) continue;
			const text = await readFile(join(dir, entry), "utf8");
			const name = text.match(/--name '([^']+)'/)?.[1] ?? text.match(/--name\s+"([^"]+)"/)?.[1];
			const session = text.match(/--session '([^']+)'/)?.[1] ?? text.match(/--session\s+"([^"]+)"/)?.[1];
			if (name && session) bySession.set(session, name);
		}
	} catch {}
	return bySession;
}

function uniq<T>(items: T[]): T[] {
	return [...new Set(items)];
}

function shortPath(path: string | undefined): string {
	if (!path) return "";
	return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

function formatAge(ms: number): string {
	const delta = Math.max(0, Date.now() - ms);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (delta < hour) return `${Math.max(1, Math.round(delta / minute))}m`;
	if (delta < day) return `${Math.round(delta / hour)}h`;
	return `${Math.round(delta / day)}d`;
}

function toResumeSessionInfo(session: PiSessionInfo, cwdBySession: Map<string, string>): ResumeSessionInfo {
	return { path: session.path, messages: session.messageCount, mtimeMs: session.modified.getTime(), cwd: cwdBySession.get(session.path) ?? session.cwd };
}

function printLaunch(row: { best: ResumeSessionInfo }) {
	console.log(`cd ${JSON.stringify(row.best.cwd ?? ".")}`);
	console.log(`pi --session ${JSON.stringify(row.best.path)}`);
}

async function launch(row: { best: ResumeSessionInfo }) {
	const child = spawn("pi", ["--session", row.best.path], { cwd: row.best.cwd ?? process.cwd(), stdio: "inherit" });
	await new Promise<never>((resolve) => child.on("exit", (code) => resolve(process.exit(code ?? 0))));
}

function descendants(root: string, records: RelocationRecord[]): string[] {
	const out = new Set<string>([root]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const record of records) {
			const source = record.sourceSession ?? record.parent;
			const dest = record.destinationSession;
			if (source && dest && out.has(source) && !out.has(dest)) {
				out.add(dest);
				changed = true;
			}
		}
	}
	return [...out];
}

function nearestName(path: string, parentBySession: Map<string, string>, nameByAnchor: Map<string, string>): string | undefined {
	const seen = new Set<string>();
	let current: string | undefined = path;
	while (current && !seen.has(current)) {
		seen.add(current);
		const name = nameByAnchor.get(current);
		if (name) return name;
		current = parentBySession.get(current);
	}
	return undefined;
}

function usage(): string {
	return [
		"Usage: pil [options] [lineage-number]",
		"",
		"Options:",
		"  --files             Show session file paths",
		"  --print, --command  Print the resume command instead of launching Pi",
		"  --limit=<n>         Limit displayed rows",
		"  -h, --help          Show this help",
		"  -V, --version       Show version",
	].join("\n");
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
		console.log(usage());
		return;
	}
	if (args.includes("--version") || args.includes("-V") || args[0] === "version") {
		console.log(version);
		return;
	}
	const showFiles = args.includes("--files");
	const printOnly = args.includes("--print") || args.includes("--command");
	const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
	const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
	const relocationFiles = [
		join(agentDir, "relocations.jsonl"),
		join(agentDir, "session-move", "manifests", "relocations.jsonl"),
	];
	const nameFiles = [
		join(agentDir, "relocation-lineages.jsonl"),
		join(agentDir, "session-move", "manifests", "relocation-lineages.jsonl"),
	];
	const records = (await Promise.all(relocationFiles.map((path) => readJsonl<RelocationRecord>(path)))).flat();
	const names = (await Promise.all(nameFiles.map((path) => readJsonl<LineageNameRecord>(path)))).flat()
		.filter((record) => record.type === "lineage_named" && record.root && record.name)
		.sort((a, b) => String(a.updated ?? "").localeCompare(String(b.updated ?? "")));
	const latestByName = new Map<string, LineageNameRecord>();
	for (const name of names) latestByName.set(name.name!, name);
	const nameByAnchor = new Map<string, string>();
	for (const name of latestByName.values()) nameByAnchor.set(name.currentSession ?? name.root!, name.name!);
	const cwdBySession = new Map<string, string>();
	const parentBySession = new Map<string, string>();
	for (const record of records) {
		if (record.sourceSession && record.fromCwd) cwdBySession.set(record.sourceSession, record.fromCwd);
		if (record.destinationSession && record.toCwd) cwdBySession.set(record.destinationSession, record.toCwd);
		if (record.destinationSession) parentBySession.set(record.destinationSession, record.sourceSession ?? record.parent ?? "");
	}
	const store = await readJson<StoreExport>(join(agentDir, "session-store", "session-store.export.json"));
	const restartNameByPath = await restartScriptNames();
	const storeNameByPath = new Map<string, string>();
	const storeSessionIdByPath = new Map<string, string>();
	for (const observation of store?.sessionObservations ?? []) {
		storeSessionIdByPath.set(observation.path, observation.sessionId);
		if (observation.metadata?.cwd) cwdBySession.set(observation.path, observation.metadata.cwd);
		if (observation.metadata?.displayName) storeNameByPath.set(observation.path, observation.metadata.displayName);
	}
	const labelsBySession = new Map<string, StoreLabel[]>();
	for (const label of store?.labels ?? []) {
		if (label.targetType !== "session" || !label.targetId) continue;
		const list = labelsBySession.get(label.targetId) ?? [];
		list.push(label);
		labelsBySession.set(label.targetId, list);
	}
	for (const [path, sessionId] of storeSessionIdByPath) {
		const labels = labelsBySession.get(sessionId) ?? [];
		const cwd = labels.find((label) => label.labelType === "cwd" && label.confidence === "authoritative")?.value ?? labels.find((label) => label.labelType === "cwd")?.value;
		const displayName = labels.find((label) => label.labelType === "display_name" && label.confidence === "authoritative")?.value ?? labels.find((label) => label.labelType === "display_name")?.value;
		if (cwd) cwdBySession.set(path, cwd);
		if (displayName) storeNameByPath.set(path, displayName);
	}
	for (const [path, name] of restartNameByPath) storeNameByPath.set(path, name);
	const piSessions = await SessionManager.listAll();
	await Promise.all(piSessions.filter((session) => restartNameByPath.has(session.path) && !storeNameByPath.has(session.path)).map(async (session) => {
		const sessionInfoName = await firstSessionInfoName(session.path);
		if (sessionInfoName) storeNameByPath.set(session.path, sessionInfoName);
	}));
	const piSessionByPath = new Map(piSessions.map((session) => [session.path, toResumeSessionInfo(session, cwdBySession)]));
	for (const observation of store?.sessionObservations ?? []) {
		const mtimeMs = Date.parse(observation.fileMtime ?? "");
		const existing = piSessionByPath.get(observation.path);
		const info: ResumeSessionInfo = {
			path: observation.path,
			messages: Math.max(existing?.messages ?? 0, observation.lineCount ?? 0),
			mtimeMs: Number.isFinite(mtimeMs) ? Math.max(existing?.mtimeMs ?? 0, mtimeMs) : existing?.mtimeMs ?? 0,
			cwd: cwdBySession.get(observation.path) ?? existing?.cwd,
		};
		piSessionByPath.set(observation.path, info);
	}
	const rows: LineageRow[] = [];
	const allNames = [...new Set([...latestByName.keys(), ...restartNameByPath.values()])].sort((a, b) => a.localeCompare(b));
	for (const name of allNames) {
		const lineage = latestByName.get(name);
		const anchor = lineage?.currentSession ?? lineage?.root;
		const storeNamedPaths = [...storeNameByPath.entries()].filter(([, pathName]) => pathName === name).map(([path]) => path);
		const paths = uniq([...(anchor ? descendants(anchor, records) : []), anchor, ...storeNamedPaths].filter(Boolean) as string[])
			.filter((path) => storeNameByPath.get(path) === name || nearestName(path, parentBySession, nameByAnchor) === name);
		const infos = paths.map((path) => piSessionByPath.get(path)).filter(Boolean) as ResumeSessionInfo[];
		const best = infos.sort((a, b) => b.messages - a.messages || b.mtimeMs - a.mtimeMs)[0];
		if (best) rows.push({ name, best, count: infos.length, totalMessages: best.messages });
	}
	rows.sort((a, b) => b.totalMessages - a.totalMessages || b.best.mtimeMs - a.best.mtimeMs);
	const selected = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 0);
	if (selected > 0) {
		const row = rows[selected - 1];
		if (!row) throw new Error(`No lineage row ${selected}`);
		if (printOnly || !process.stdout.isTTY) printLaunch(row);
		else await launch(row);
		return;
	}
	console.log("#  Lineage                         Msgs  Age  Repo");
	for (const [index, row] of rows.slice(0, limit).entries()) {
		console.log(`${String(index + 1).padStart(2)} ${row.name.padEnd(30).slice(0, 30)} ${String(row.totalMessages).padStart(5)} ${formatAge(row.best.mtimeMs).padStart(4)}  ${shortPath(row.best.cwd)}`);
		if (showFiles) console.log(`   session: ${shortPath(row.best.path)}`);
	}
	if (process.stdin.isTTY && process.stdout.isTTY) {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		const answer = (await rl.question("Open lineage #: ")).trim();
		rl.close();
		if (!answer) return;
		const row = rows[Number(answer) - 1];
		if (!row) throw new Error(`No lineage row ${answer}`);
		await launch(row);
	}
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
