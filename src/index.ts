import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { Loader, type LoaderMessageColorFn, type TUI } from "@oh-my-pi/pi-tui";
import { protectAnsi } from "./ansi-shimmer.ts";
import { DEFAULT_PONG, pongFrame } from "./pong.ts";

/** Repaint cadence; ~12.5 fps matches omp's status spinner. */
const FRAME_MS = 80;
const PROBE_WIDGET = "omp-buffer-bar:probe";

function isColorFn(value: unknown): value is LoaderMessageColorFn {
	return typeof value === "function";
}

/**
 * The working row is a `Loader` in a container mounted directly on the TUI
 * root; it is the one whose label is the frame just handed to
 * `setWorkingMessage`. `message` is TS-private, so it is read reflectively.
 */
function findWorkingLoader(tui: TUI, label: string): Loader | undefined {
	for (const root of tui.children) {
		if (!("children" in root) || !Array.isArray(root.children)) continue;
		for (const child of root.children) {
			if (child instanceof Loader && Reflect.get(child, "message") === label) return child;
		}
	}
	return undefined;
}

/**
 * Swaps the loader's shimmer colorizer (TS-private `messageColorFn`) for one
 * that leaves embedded ANSI intact. False when this omp build lacks the field.
 */
function protectLoader(loader: Loader): boolean {
	const colorize: unknown = Reflect.get(loader, "messageColorFn");
	if (!isColorFn(colorize)) return false;
	return Reflect.set(loader, "messageColorFn", protectAnsi(colorize));
}

export default function pongWorkingRow(pi: ExtensionAPI) {
	let tui: TUI | undefined;
	let loader: Loader | undefined;
	let timer: Timer | undefined;

	const stop = (ctx: ExtensionContext) => {
		if (timer === undefined) return;
		ctx.clearTimer(timer);
		timer = undefined;
		loader = undefined;
		ctx.ui.setWorkingMessage();
	};

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		// Widget factories run synchronously with the TUI; drop the probe before it ever paints.
		ctx.ui.setWidget(PROBE_WIDGET, host => {
			tui = host;
			return { render: () => [] };
		});
		ctx.ui.setWidget(PROBE_WIDGET, undefined);
	});

	pi.on("agent_start", (_event, ctx) => {
		if (!ctx.hasUI || timer !== undefined) return;
		const paint = () => {
			const frame = pongFrame(Date.now(), ctx.ui.theme, DEFAULT_PONG);
			ctx.ui.setWorkingMessage(frame);
			if (loader === undefined || Reflect.get(loader, "message") !== frame) {
				loader = tui && findWorkingLoader(tui, frame);
				if (loader && !protectLoader(loader)) loader = undefined;
			}
			// Unprotected, the shimmer would split the frame's escapes; show it plain instead.
			if (loader === undefined) ctx.ui.setWorkingMessage(Bun.stripANSI(frame));
		};
		paint();
		// Re-set every frame: omp replaces the working message with tool intents mid-run.
		timer = ctx.setInterval(paint, FRAME_MS);
	});

	pi.on("agent_end", (_event, ctx) => stop(ctx));
	pi.on("session_shutdown", (_event, ctx) => stop(ctx));
}
