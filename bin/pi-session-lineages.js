#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const home = process.env.HOME ?? ".";
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");

async function readJsonl(path) {
	try {
		return (await readFile(path, "utf8")).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

function uniq(items) {
	return [...new Set(items)];
}

function shortPath(path) {
	if (!path) return "";
	return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

function formatAge(ms) {
	const delta = Math.max(0, Date.now() - ms);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (delta < hour) return `${Math.max(1, Math.round(delta / minute))}m`;
	if (delta < day) return `${Math.round(delta / hour)}h`;
	return `${Math.round(delta / day)}d`;
}

function toResumeSessionInfo(session, cwdBySession) {
	return { path: session.path, messages: session.messageCount, mtimeMs: session.modified.getTime(), cwd: cwdBySession.get(session.path) ?? session.cwd };
}

function descendants(root, records) {
	const out = new Set([root]);
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

async function main() {
	const showFiles = process.argv.includes("--files") || process.argv.includes("--verbose");
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
	const records = (await Promise.all(relocationFiles.map((path) => readJsonl(path)))).flat();
	const names = (await Promise.all(nameFiles.map((path) => readJsonl(path)))).flat()
		.filter((record) => record.type === "lineage_named" && record.root && record.name)
		.sort((a, b) => String(a.updated ?? "").localeCompare(String(b.updated ?? "")));
	const latestByName = new Map();
	for (const name of names) latestByName.set(name.name, name);
	const cwdBySession = new Map();
	for (const record of records) {
		if (record.sourceSession && record.fromCwd) cwdBySession.set(record.sourceSession, record.fromCwd);
		if (record.destinationSession && record.toCwd) cwdBySession.set(record.destinationSession, record.toCwd);
	}
	const piSessions = await SessionManager.listAll();
	const piSessionByPath = new Map(piSessions.map((session) => [session.path, toResumeSessionInfo(session, cwdBySession)]));
	const rows = [];
	for (const lineage of latestByName.values()) {
		const anchor = lineage.currentSession ?? lineage.root;
		const paths = uniq([...descendants(anchor, records), anchor].filter(Boolean));
		const infos = paths.map((path) => piSessionByPath.get(path)).filter(Boolean) ;
		const best = infos.sort((a, b) => b.messages - a.messages || b.mtimeMs - a.mtimeMs)[0];
		if (best) rows.push({ name: lineage.name, best, count: infos.length });
	}
	rows.sort((a, b) => b.best.messages - a.best.messages || b.best.mtimeMs - a.best.mtimeMs);
	const selected = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 0);
	if (selected > 0) {
		const row = rows[selected - 1];
		if (!row) throw new Error(`No lineage row ${selected}`);
		console.log(`cd ${JSON.stringify(row.best.cwd ?? ".")}`);
		console.log(`pi --session ${JSON.stringify(row.best.path)}`);
		return;
	}
	console.log("#  Lineage                         Msgs  Age  Cwd");
	for (const [index, row] of rows.slice(0, limit).entries()) {
		console.log(`${String(index + 1).padStart(2)} ${row.name.padEnd(30).slice(0, 30)} ${String(row.best.messages).padStart(5)} ${formatAge(row.best.mtimeMs).padStart(4)}  ${shortPath(row.best.cwd)}`);
		if (showFiles) console.log(`   session: ${shortPath(row.best.path)}`);
	}
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
