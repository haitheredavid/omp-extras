import type { Theme } from "@oh-my-pi/pi-tui";

export interface PongOptions {
	/** Cells between the two paddles. */
	width: number;
	/** Milliseconds the ball spends on each cell. */
	stepMs: number;
}

export const DEFAULT_PONG: PongOptions = { width: 24, stepMs: 60 };

const PADDLE_LEFT = "▐";
const PADDLE_RIGHT = "▌";
const PADDLE_HIT = "█";
const BALL = "●";
const COURT = " ";

/** Renders one styled frame of a single-line pong rally at time `now` (ms). */
export function pongFrame(now: number, theme: Theme, { width, stepMs }: PongOptions = DEFAULT_PONG): string {
	const span = Math.max(1, width - 1);
	const step = Math.floor(now / stepMs) % (span * 2);
	const pos = step <= span ? step : span * 2 - step;

	const ball = theme.bold(theme.fg("accent", BALL));
	const court = COURT.repeat(pos) + ball + COURT.repeat(width - pos - 1);
	const left = pos === 0 ? theme.fg("accent", PADDLE_HIT) : theme.fg("muted", PADDLE_LEFT);
	const right = pos === width - 1 ? theme.fg("accent", PADDLE_HIT) : theme.fg("muted", PADDLE_RIGHT);
	return left + court + right;
}
