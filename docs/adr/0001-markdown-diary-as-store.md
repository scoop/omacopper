---
status: accepted
---

# Markdown diary as the Store

The first-party clipboard plugin keeps its history as JSON under
`~/.local/state`, and that would have been the path of least resistance. We
store Entries instead as one plain markdown file: `## YYYY-MM-DD` Day headings
with `- [ ]` / `- [x]` items beneath, chronological, human-editable, with lines
the app does not recognise preserved verbatim. The point of the app is that
captured fragments end up somewhere you already read and edit — an editor,
Obsidian, `git diff` — and JSON is somewhere nobody reads. The cost is a
parser with real edge cases (continuation lines, foreign lines, empty Days),
which is why that parser is the one tested module.

## Consequences

- Creation time is kept at Day granularity only. Order within a Day is file
  order.
- Blank lines are structural: the app inserts one before each Day heading and
  may drop those left behind by a removed Day. Non-blank foreign lines are
  never touched.
- The app is not the sole writer, so it re-reads the Store on every Panel open
  and never caches across summons.
