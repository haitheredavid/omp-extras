import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/** omp has no session-rename event for extensions, so the name is polled. */
const POLL_MS = 2000;
const MAX_LABEL = 60;
/** Labels this extension wrote, one file per herdr pane/tab, so a restarted omp can tell its own names from yours. */
const OWNED_DIR = join(homedir(), ".omp", "agent", "cache", "herdr-name");

const herdrBin = process.env.HERDR_BIN_PATH || "herdr";
const paneId = process.env.HERDR_PANE_ID;

/** `pane get` omits `label` and `agent` when unset; `pane list` sends them as null. */
interface PaneInfo {
	pane_id: string;
	tab_id: string;
	agent?: string | null;
	label?: string | null;
}

interface TabInfo {
	label: string;
	number: number;
}

function field(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function isPane(value: unknown): value is PaneInfo {
	const label = field(value, "label");
	const agent = field(value, "agent");
	return (
		typeof field(value, "pane_id") === "string" &&
		typeof field(value, "tab_id") === "string" &&
		(label == null || typeof label === "string") &&
		(agent == null || typeof agent === "string")
	);
}

function isTab(value: unknown): value is TabInfo {
	return typeof field(value, "label") === "string" && typeof field(value, "number") === "number";
}

/** Runs a herdr CLI call and returns `result[key]` from its JSON reply. */
async function herdr(key: string | undefined, ...args: string[]): Promise<unknown> {
	const proc = Bun.spawn([herdrBin, ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
	const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	if (code !== 0) throw new Error(`herdr ${args.join(" ")} exited ${code}`);
	return key === undefined ? undefined : field(field(JSON.parse(out), "result"), key);
}

function ownedPath(key: string): string {
	return join(OWNED_DIR, `${key.replace(/[^\w-]/g, "_")}.txt`);
}

/**
 * A label is ours to replace when herdr still shows its default or the label
 * this extension last wrote. Anything else was set by you or another plugin.
 */
async function rename(key: string, current: string | null, isDefault: boolean, label: string, write: () => Promise<unknown>) {
	if (current === label) return;
	if (!isDefault && current !== (await readFile(ownedPath(key), "utf8").catch(() => undefined))) return;
	await write();
	await mkdir(OWNED_DIR, { recursive: true });
	await writeFile(ownedPath(key), label);
}

async function sync(name: string): Promise<void> {
	if (!paneId) return;
	const flat = name.replace(/\s+/g, " ").trim();
	const label = flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
	if (!label) return;

	// Read the tab from the pane each time: `pane move` can carry it to another tab.
	const pane = await herdr("pane", "pane", "get", paneId);
	if (!isPane(pane)) throw new Error("unexpected herdr pane reply");
	await rename(`pane-${pane.pane_id}`, pane.label ?? null, pane.label == null, label, () =>
		herdr(undefined, "pane", "rename", pane.pane_id, label),
	);

	const panes = await herdr("panes", "pane", "list");
	if (!Array.isArray(panes)) throw new Error("unexpected herdr pane list reply");
	const ompPanes = panes.filter(p => isPane(p) && p.tab_id === pane.tab_id && p.agent === "omp").length;
	// Several omp sessions share this tab: each pane carries its own name, the tab keeps its own.
	if (ompPanes > 1) return;
	const tab = await herdr("tab", "tab", "get", pane.tab_id);
	if (!isTab(tab)) throw new Error("unexpected herdr tab reply");
	await rename(`tab-${pane.tab_id}`, tab.label, tab.label === String(tab.number), label, () =>
		herdr(undefined, "tab", "rename", pane.tab_id, label),
	);
}

export default function herdrName(pi: ExtensionAPI) {
	// A nested omp launched from a parent session's shell inherits `OMPCODE=1`; it must not rename the parent's pane.
	if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_SOCKET_PATH || !paneId || process.env.OMPCODE === "1") return;

	let timer: Timer | undefined;
	let synced: string | undefined;
	let running = false;

	const tick = async () => {
		const name = pi.getSessionName();
		if (!name || name === synced || running) return;
		running = true;
		try {
			await sync(name);
			synced = name;
		} catch {
			// herdr unreachable or the pane is gone; retry on the next tick.
		} finally {
			running = false;
		}
	};

	const stop = (ctx: ExtensionContext) => {
		if (timer === undefined) return;
		ctx.clearTimer(timer);
		timer = undefined;
	};

	pi.on("session_start", (_event, ctx) => {
		stop(ctx);
		synced = undefined;
		void tick();
		timer = ctx.setInterval(() => void tick(), POLL_MS);
	});
	pi.on("session_switch", () => {
		synced = undefined;
		void tick();
	});
	pi.on("session_shutdown", (_event, ctx) => stop(ctx));
}
