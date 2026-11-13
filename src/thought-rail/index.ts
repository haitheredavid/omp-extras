import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

type Block = { type: string; text?: string; thinking?: string };
type Msg = { role: string; timestamp: number; content: string | Block[] };

const isText = (b: Block) => b.type === "text" && (b.text ?? "").trim() !== "";
const blocks = (m: Msg | undefined): Block[] => (m && Array.isArray(m.content) ? m.content : []);
const TOGGLE = /^thoughtrail:toggle\/(\d+)\/(\d+)$/;

/** Collapse hidden thinking into a dotted rail row above each reply; picking the row expands it inline. */
export default function thoughtRail(pi: ExtensionAPI) {
	let enabled = true;
	let log: Msg[] = [];
	let indexByTs = new Map<number, number>();
	const expanded = new Set<string>();
	const hideThinking = lookup("hideThinkingBlock");
	// Ctrl+T flips the setting but keeps each reply's cached text-renderer output; redraw so rails follow it.
	let sessionCtx: ExtensionContext | undefined;
	hideThinking?.listen(pi.pi.settings, () => {
		if (sessionCtx) rerenderAll(sessionCtx);
	});

	const rebuild = (ctx: ExtensionContext) => {
		log = [];
		indexByTs = new Map();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const message = entry.message as unknown as Msg;
			if (message.role !== "user" && message.role !== "assistant") continue;
			if (message.role === "assistant") indexByTs.set(message.timestamp, log.length);
			log.push(message);
		}
	};

	const record = (message: Msg) => {
		if (message.role !== "user" && message.role !== "assistant") return;
		const existing = message.role === "assistant" ? indexByTs.get(message.timestamp) : undefined;
		if (existing !== undefined) {
			log[existing] = message;
			return;
		}
		if (message.role === "assistant") indexByTs.set(message.timestamp, log.length);
		log.push(message);
	};

	/** Thinking blocks between the previous reply text (or user turn) and the text block at `contentIndex`. */
	const collectThinking = (ts: number, contentIndex: number): string[] => {
		const start = indexByTs.get(ts);
		if (start === undefined) return [];
		const own = blocks(log[start]);
		const target = own[contentIndex];
		if (!target || !isText(target)) return [];
		const found: string[] = [];
		for (let i = start; i >= 0; i--) {
			const msg = log[i];
			if (!msg || msg.role === "user") break;
			const bs = blocks(msg);
			let stop = false;
			for (let j = i === start ? contentIndex - 1 : bs.length - 1; j >= 0; j--) {
				const b = bs[j];
				if (!b) continue;
				if (isText(b)) {
					stop = true;
					break;
				}
				const thought = b.type === "thinking" ? (b.thinking ?? "").trim() : "";
				if (thought !== "") found.push(thought);
			}
			if (stop) break;
		}
		return found.reverse();
	};

	const railKeys = (): Array<{ ts: number }> => {
		const keys: Array<{ ts: number }> = [];
		for (const [ts, idx] of indexByTs) {
			const bs = blocks(log[idx]);
			if (bs.some((b, ci) => isText(b) && collectThinking(ts, ci).length > 0)) keys.push({ ts });
		}
		return keys;
	};

	const rerenderAll = (ctx: ExtensionContext) => {
		for (const { ts } of railKeys()) ctx.ui.rerenderMessage(ts);
	};

	pi.setLabel("Thought rail");
	pi.registerLinkScheme("thoughtrail");

	pi.registerAssistantTextRenderer(({ message, contentIndex, text, streaming }) => {
		if (!enabled || streaming || hideThinking?.get(pi.pi.settings) !== true) return undefined;
		const thoughts = collectThinking(message.timestamp, contentIndex);
		if (thoughts.length === 0) return undefined;
		const words = thoughts.reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0);
		const key = `${message.timestamp}:${contentIndex}`;
		const open = expanded.has(key);
		const label = `┊ ${open ? "▾" : "▸"} thought · ${words} words${thoughts.length > 1 ? ` · ${thoughts.length} blocks` : ""}`;
		const link = `[${label}](thoughtrail:toggle/${message.timestamp}/${contentIndex})`;
		if (!open) return `${link}\n\n${text}`;
		const quoted = thoughts
			.map(t =>
				t
					.split("\n")
					.map(line => (line === "" ? ">" : `> ${line}`))
					.join("\n"),
			)
			.join("\n>\n");
		return `${link}\n\n${quoted}\n\n${text}`;
	});

	const resync = (_event: unknown, ctx: ExtensionContext) => {
		sessionCtx = ctx;
		rebuild(ctx);
		rerenderAll(ctx);
	};
	pi.on("session_start", resync);
	pi.on("session_switch", resync);
	pi.on("session_branch", resync);
	pi.on("session_tree", resync);
	pi.on("session_compact", resync);

	pi.on("message_end", (event, ctx) => {
		record(event.message as unknown as Msg);
		if (event.message.role === "assistant") ctx.ui.rerenderMessage(event.message.timestamp);
	});

	pi.on("link_activate", (event, ctx) => {
		const match = TOGGLE.exec(event.url);
		if (!match) return;
		const ts = Number(match[1]);
		const ci = Number(match[2]);
		if (!indexByTs.has(ts)) return;
		const key = `${ts}:${ci}`;
		if (expanded.has(key)) expanded.delete(key);
		else expanded.add(key);
		ctx.ui.rerenderMessage(ts);
	});

	pi.registerCommand("thought-rail", {
		description: "Toggle collapsed thinking rails (on|off)",
		handler: async (args, ctx) => {
			const arg = args.trim();
			if (arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else if (arg === "") enabled = !enabled;
			else {
				ctx.ui.notify("usage: /thought-rail [on|off]", "warning");
				return;
			}
			rerenderAll(ctx);
			ctx.ui.notify(`Thought rail ${enabled ? "on" : "off"}`, "info");
		},
	});
}
