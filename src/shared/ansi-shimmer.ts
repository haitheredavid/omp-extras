import type { LoaderMessageColorFn } from "@oh-my-pi/pi-tui";

/** CSI sequences (SGR among them) and OSC strings such as OSC 8 hyperlinks. */
const ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const SGR = /^\x1b\[([0-9;:]*)m$/;
const RESET = "\x1b[0m";

/**
 * Effective SGR attributes keyed by what a later code would override: `fg`,
 * `bg`, `ul` (underline color), or the flag's own number (`1` bold, `4`
 * underline, …). Tracking effect rather than history means a partial reset
 * such as `39` really returns a cell to unstyled.
 */
class SgrState {
	#attrs = new Map<string, string>();

	apply(params: string): void {
		const codes = params === "" ? ["0"] : params.split(";");
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i] ?? "0";
			const n = Number.parseInt(code, 10) || 0;
			if (n === 0) this.#attrs.clear();
			else if (n === 38 || n === 48 || n === 58) {
				let seq = code;
				// `38;5;n` and `38;2;r;g;b` spread their arguments over following params.
				if (!code.includes(":")) {
					const take = codes[i + 1] === "5" ? 2 : codes[i + 1] === "2" ? 4 : 0;
					seq = codes.slice(i, i + 1 + take).join(";");
					i += take;
				}
				this.#attrs.set(n === 38 ? "fg" : n === 48 ? "bg" : "ul", seq);
			} else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) this.#attrs.set("fg", code);
			else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) this.#attrs.set("bg", code);
			else if (n === 39) this.#attrs.delete("fg");
			else if (n === 49) this.#attrs.delete("bg");
			else if (n === 59) this.#attrs.delete("ul");
			else if (n === 22) {
				this.#attrs.delete("1");
				this.#attrs.delete("2");
			} else if (n >= 23 && n <= 29) this.#attrs.delete(String(n - 20));
			else this.#attrs.set(String(n), code);
		}
	}

	/** One SGR sequence reproducing this state from a reset; empty when unstyled. */
	toString(): string {
		return this.#attrs.size === 0 ? "" : `\x1b[${[...this.#attrs.values()].join(";")}m`;
	}
}

interface Cell {
	ch: string;
	/** SGR the source text had in effect over this cell; empty means unstyled. */
	sgr: string;
	/** Non-SGR escapes that preceded this cell in the source. */
	pre: string;
}

const protectedColorFns = new WeakSet<LoaderMessageColorFn>();

/**
 * Wraps a loader colorizer (omp's working-row shimmer) so text already styled
 * with embedded ANSI keeps its own style. Styled cells become same-width
 * placeholders before the colorizer runs, so its sweep still counts them and
 * stays continuous across the unstyled cells; they are spliced back verbatim
 * afterwards, and the colorizer's own SGR state is restored behind them.
 */
export function protectAnsi(colorize: LoaderMessageColorFn): LoaderMessageColorFn {
	if (protectedColorFns.has(colorize)) return colorize;
	const paint = (message: string): string => {
		if (!message.includes("\x1b")) return colorize(message);

		const cells: Cell[] = [];
		const source = new SgrState();
		let sgr = "";
		let pre = "";
		let mask = "";
		let last = 0;
		const pushText = (text: string) => {
			for (const ch of text) {
				cells.push({ ch, sgr, pre });
				pre = "";
				// Any one code point holds the slot; the colorizer counts code points.
				mask += sgr ? " " : ch;
			}
		};
		for (const match of message.matchAll(ESCAPE)) {
			pushText(message.slice(last, match.index));
			last = match.index + match[0].length;
			const params = SGR.exec(match[0])?.[1];
			if (params === undefined) pre += match[0];
			else {
				source.apply(params);
				sgr = source.toString();
			}
		}
		pushText(message.slice(last));
		const tail = pre + (sgr ? RESET : "");

		const painted = colorize(mask);
		const host = new SgrState();
		let out = "";
		let open: string | undefined;
		let index = 0;
		const closeStyled = () => {
			if (open === undefined) return;
			out += RESET + host.toString();
			open = undefined;
		};
		const emitText = (text: string) => {
			for (const ch of text) {
				const cell = cells[index++];
				if (cell?.sgr) {
					if (open !== cell.sgr) {
						out += RESET + cell.sgr;
						open = cell.sgr;
					}
					out += cell.pre + cell.ch;
				} else {
					closeStyled();
					out += (cell?.pre ?? "") + ch;
				}
			}
		};
		last = 0;
		for (const match of painted.matchAll(ESCAPE)) {
			emitText(painted.slice(last, match.index));
			last = match.index + match[0].length;
			closeStyled();
			out += match[0];
			const params = SGR.exec(match[0])?.[1];
			if (params !== undefined) host.apply(params);
		}
		emitText(painted.slice(last));
		closeStyled();
		return out + tail;
	};
	// The loader repaints at the shimmer cadence only while its colorizer says it animates.
	const wrapped: LoaderMessageColorFn = colorize.animated ? Object.assign(paint, { animated: true as const }) : paint;
	protectedColorFns.add(wrapped);
	return wrapped;
}
