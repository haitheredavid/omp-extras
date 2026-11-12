# omp-buffer-bar

An `omp` extension (built against 18.19.0) that replaces the working-row text with a one-line pong rally while the agent runs. The ball and paddles keep their own colors, and the host shimmer still sweeps any plain text without breaking them.

```
  Esc ▐                 ●      ▌
```

## Install

```
omp --extension ./src/index.ts                      # once
cp -r . ~/.omp/agent/extensions/omp-buffer-bar      # always on
```

Or add the directory to `extensions:` in `~/.omp/agent/config.yml`.

## How it works

- `src/pong.ts`: `pongFrame(now, theme)` draws the frame for a given time: muted paddles, a bold accent ball, and a paddle that flashes accent on a hit.
- `src/index.ts`: from `agent_start` to `agent_end`, re-sets the working message every 80 ms. omp swaps in tool intents mid-run, so the frame has to be reasserted.
- `src/ansi-shimmer.ts`: `protectAnsi(colorize)` wraps the loader colorizer. omp's `shimmerText` styles text per code point, so it splits any embedded `\x1b[…m` into visible garbage. The wrapper swaps styled cells for same-width placeholders, runs the host shimmer (classic/kitt, session accent and speed unchanged), then puts the styled cells back and restores the shimmer's SGR state after them.

There is no public API for the colorizer. The extension gets the `TUI` through a probe widget that it removes before it paints, finds the working `Loader` (the one whose label is the frame just set), and replaces the loader's TS-private `messageColorFn`. If a future omp drops that field, frames fall back to plain text instead of corrupted escapes. Tern (TSP) terminals strip label styling, so the rally shows there uncolored.

## Develop

```
bun install
bun run typecheck
```
