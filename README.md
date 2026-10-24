# Claude usage tracker

A Claude Code mod that charts your Claude usage over time in a pane beside the chat.

It aggregates token usage (input, output, cache reads, cache writes) per day and per model from your local session transcripts in `~/.claude/projects`, and keeps the daily totals in its own store — so your history survives even after old transcripts are cleaned up.

## Install

At the prompt of a terminal session (Claude Code 2.1.275 or later):

```
/plugin install usage-tracker --marketplace da5idt/claude-usage-tracker
```

Answer `y` to add the marketplace, then pick a scope. From a shell instead:

```
claude plugin install usage-tracker --marketplace da5idt/claude-usage-tracker
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `da5idt/claude-usage-tracker`, then **Add plugin**.

## Using it

- The pane opens once on install; after that, run `/usage-tracker` to open it.
- Pick a range (7d / 30d / 90d / All) and a metric (Total / Output / Input / Cache read / Cache write).
- The chart, the stat row, and the per-model table all follow the selected metric and range.
- Data refreshes automatically after turns complete, and on demand with the Refresh button.

## How it works

- `scripts/aggregate.py` scans every `*.jsonl` transcript, dedupes API responses by message id + request id (one response can span several transcript lines, and forked sessions copy history), buckets by local calendar day, and prints compact JSON.
- The hooks module runs the script via `$.process.run`, merges the scan into the store taking the per-day maximum (usage within a day only grows; transcripts only disappear), and draws the pane with an SVG bar chart on desktop or unicode bars in a terminal.

## Requirements

- `python3` on the PATH (or at `/opt/homebrew/bin/python3` or `/usr/bin/python3`).
