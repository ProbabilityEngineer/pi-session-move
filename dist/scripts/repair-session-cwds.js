#!/usr/bin/env node
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, basename, dirname, resolve } from "node:path";
const home = process.env.HOME ? resolve(process.env.HOME) : undefined;
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? ".", ".pi", "agent");
const apply = process.argv.slice(2).includes("--write");
function collapseDuplicatedHomePrefix(value) {
    if (!home)
        return value;
    const slashValue = value.replace(/\\/g, "/");
    const slashHome = home.replace(/\\/g, "/").replace(/\/+$/g, "");
    const relHome = slashHome.replace(/^\/+/, "");
    const doubled = `${slashHome}/${relHome}`.toLowerCase();
    const lower = slashValue.toLowerCase();
    if (lower === doubled)
        return slashHome;
    if (lower.startsWith(`${doubled}/`))
        return `${slashHome}${slashValue.slice(doubled.length)}`;
    return value;
}
function normalizeText(text) {
    if (!home)
        return { text, changed: false };
    const slashHome = home.replace(/\\/g, "/").replace(/\/+$/g, "");
    const relHome = slashHome.replace(/^\/+/, "");
    const escapedHome = slashHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedRelHome = relHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`${escapedHome}/${escapedRelHome}(?=/|$)`, "gi");
    const next = text.replace(rx, slashHome);
    return { text: next, changed: next !== text };
}
function sessionBucketName(cwd) {
    const normalized = resolve(collapseDuplicatedHomePrefix(cwd)).replace(/[/\\]+$/g, "");
    const withoutRoot = normalized.replace(/^[/\\]+/, "");
    return `--${withoutRoot.replace(/[/\\:]+/g, "-")}--`;
}
function cwdFromSessionBucket(path) {
    const match = basename(path).match(/^--(.+)--$/);
    return match ? `/${match[1].replace(/-/g, "/")}` : undefined;
}
async function walk(dir, out = []) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory())
            await walk(path, out);
        else if (entry.isFile())
            out.push(path);
    }
    return out;
}
async function rewriteFile(path, changes) {
    const original = await readFile(path, "utf8");
    const { text, changed } = normalizeText(original);
    if (!changed)
        return;
    changes.push({ kind: "rewrite", path, detail: "normalized duplicated home-prefix paths in file content" });
    if (apply)
        await writeFile(path, text, "utf8");
}
async function moveBucket(path, changes) {
    const bucketCwd = cwdFromSessionBucket(path);
    if (!bucketCwd)
        return;
    const normalized = collapseDuplicatedHomePrefix(bucketCwd);
    if (normalized === bucketCwd)
        return;
    const targetDir = join(dirname(path), sessionBucketName(normalized));
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        const source = join(path, entry.name);
        const target = join(targetDir, entry.name);
        changes.push({ kind: "move", path: source, target, detail: `move session file into normalized bucket ${basename(targetDir)}` });
        if (apply) {
            await mkdir(targetDir, { recursive: true });
            const exists = await stat(target).then(() => true).catch(() => false);
            if (!exists)
                await rename(source, target);
        }
        await rewriteFile(apply ? target : source, changes);
    }
}
async function main() {
    const changes = [];
    const sessionRoot = join(agentDir, "sessions");
    const buckets = await readdir(sessionRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of buckets) {
        if (!entry.isDirectory())
            continue;
        await moveBucket(join(sessionRoot, entry.name), changes);
    }
    for (const path of await walk(sessionRoot)) {
        if (basename(path).endsWith(".jsonl"))
            await rewriteFile(path, changes);
    }
    for (const path of [
        join(agentDir, "relocations.jsonl"),
        join(agentDir, "relocation-lineages.jsonl"),
        ...(await walk(join(agentDir, "session-move"))),
        ...(await walk(join(agentDir, "relocations"))),
    ]) {
        await rewriteFile(path, changes);
    }
    if (!changes.length) {
        console.log("No duplicated home-prefix session paths found.");
        return;
    }
    for (const change of changes) {
        console.log(`${change.kind.toUpperCase()} ${change.path}${change.target ? ` -> ${change.target}` : ""}`);
    }
    console.log(`\n${apply ? "Applied" : "Planned"} ${changes.length} changes.`);
    if (!apply)
        console.log("Run again with --write to apply.");
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
//# sourceMappingURL=repair-session-cwds.js.map