# omp-extras

Personal `omp` extensions (built against 18.19.0), shipped as one plugin. Each extension is an `omp.features` entry, on by default, so they toggle independently.

| Feature | What it does |
| --- | --- |
| `pong` | Replaces the working-row text with a one-line pong rally while the agent runs |
| `thought-rail` | With hidden thinking (`hideThinkingBlock`), collapses each reply's thinking into a dotted rail row; picking it expands inline. `/thought-rail [on\|off]` |
| `herdr-name` | Inside [herdr](https://herdr.dev), labels the omp pane and its tab with the session name |

## Install

```
omp plugin install git:github.com/haitheredavid/omp-extras   # from git
omp plugin link ~/projects/omp-extras                        # from a checkout; edits go live
omp plugin features omp-extras                               # list features
omp plugin features omp-extras --disable pong                # turn one off
```

Restart omp after installing or toggling.

## Layout

One directory per extension under `src/`, each with its own `index.ts` entry. Code that more than one extension could use goes in `src/shared/`. Adding an extension means adding a `src/<name>/index.ts` and a feature entry in `package.json`.

## pong

```
  Esc ▐                 ●      ▌
```

The ball and paddles keep their own colors, and the host shimmer still sweeps any plain text without breaking them.

- `src/pong/frame.ts`: `pongFrame(now, theme)` draws the frame for a given time: muted paddles, a bold accent ball, and a paddle that flashes accent on a hit.
- `src/pong/index.ts`: from `agent_start` to `agent_end`, re-sets the working message every 80 ms. omp swaps in tool intents mid-run, so the frame has to be reasserted.
- `src/shared/ansi-shimmer.ts`: `protectAnsi(colorize)` wraps the loader colorizer. omp's `shimmerText` styles text per code point, so it splits any embedded `\x1b[…m` into visible garbage. The wrapper swaps styled cells for same-width placeholders, runs the host shimmer (classic/kitt, session accent and speed unchanged), then puts the styled cells back and restores the shimmer's SGR state after them.

There is no public API for the colorizer. The extension gets the `TUI` through a probe widget that it removes before it paints, finds the working `Loader` (the one whose label is the frame just set), and replaces the loader's TS-private `messageColorFn`. If a future omp drops that field, frames fall back to plain text instead of corrupted escapes. Tern (TSP) terminals strip label styling, so the rally shows there uncolored.

## thought-rail

Rails only render when thinking is hidden; Ctrl+T flips the setting and the rails redraw to follow it. It renders through `registerAssistantTextRenderer`; the dotfiles' `~/.omp/agent/config.yml` sets `extensionRenderers.assistantText: true`.

## herdr-name

herdr's omp integration reports state and the session file, but no name, and herdr-bar's auto titles skip the `omp` agent kind, so omp tabs stay `1`. This feature polls `getSessionName()` every 2 s (omp has no rename event for extensions) and on change runs `herdr pane rename` and `herdr tab rename` for its own `HERDR_PANE_ID`.

- Renames only labels still at herdr's default (no pane label, tab label = tab number) or the label it last wrote. A name you set by hand stays. Written labels are recorded under `~/.omp/agent/cache/herdr-name/`, so a restarted omp in the same pane takes over its old name.
- Tab with more than one omp pane: only the panes are labeled; the tab keeps its name.
- The tab is looked up from the pane on every sync, so `pane move` follows.
- Skipped outside herdr and in nested omp (`OMPCODE=1`), matching herdr's own integration.

## Develop

```
bun install
bun run typecheck
```
