# Deckard improvements

What is still open. Everything this document once proposed that has since
shipped is described in the README instead, and the history is in Git.

## Method

The Obsidian community plugins were ranked by download count from the
official plugin stats, then filtered to the ones that fit Deckard: a
local-first Markdown knowledge index inside VS Code. A second pass read
Deckard's own source for what it still did not do. Each idea was checked
against the current source so that nothing here duplicates a shipped feature.

## From the earlier roadmap

| Priority | Status | Supporting plugins |
| --- | --- | --- |
| Canvas or whiteboard | Open, low priority | Excalidraw, Advanced Canvas |
| Git-aware collaboration | Open, keep light since VS Code has SCM built in | Obsidian Git |
| Minting block ids | Deliberately left out. `[[Note#^id]]` resolves, completes, previews, and counts as a backlink; writing a `^id` is the author's. | Obsidian block references |

## Open suggestions

### 1. Import an existing vault

The method behind this document is Obsidian adjacency, but migration is the
step before any of it: Logseq `::` properties and `#[[nested tags]]`, a
Notion CSV-and-folder export, Roam JSON. One import command that rewrites
them into Deckard's tags and `[[links]]` is what lets a vault arrive at all.

### 2. A headless CLI over the same index

The parser, the query evaluator, the SQLite cache, and an MCP server all
exist. `deckard query "tag = #project/atlas AND is:open"` in a terminal, a
git hook, or CI — fail the build when a note carries an overdue task — is a
thin shell over them, and it reaches people who are not in VS Code at the
moment they need an answer.

## Intentionally skipped

| Idea | Reason |
| --- | --- |
| Excalidraw, Advanced Tables, Linter, Pandoc, Git | VS Code or existing VS Code extensions already cover these. |
| Remotely Save, Self-hosted LiveSync | Sync conflicts with Deckard's local-first design. |
| Smart Connections embeddings, semantic search | Tag and BM25 ranking in Related Notes already covers most of the value at far lower cost. Revisit later. |
| Natural language to a query | An assistant that has the query language's reference can write a query; a built-in translator would be a second, worse one, and it would have to send text somewhere. |
| Spaced Repetition | A different product. |
| Typed front matter schemas | Not a direction Deckard is taking. It would be the largest surface-area increase on this list, touching the query language, the tables and hub notes at once, for a kind of structure the tag and `[[link]]` conventions already carry. |

## Sequencing

The CLI first, which is small once the query evaluator is the only thing it
needs. Import, canvas, and Git-aware collaboration follow, in that order, if
at all.

## Research sources

- [Obsidian plugin download stats](https://github.com/obsidianmd/obsidian-releases)
- [Tasks emoji format](https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format)
- [TaskNotes](https://github.com/callumalpass/tasknotes)
- [Breadcrumbs](https://github.com/SkepticMystic/breadcrumbs)
- [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections)
- [Tag Wrangler](https://github.com/pjeby/tag-wrangler)
- [Strange New Worlds](https://github.com/TfTHacker/obsidian42-strange-new-worlds)
- [Omnisearch](https://github.com/scambier/obsidian-omnisearch)
- [Sébastien Dubois: best Obsidian plugins for 2026](https://www.dsebastien.net/the-must-have-obsidian-plugins-for-2026/)
- [Dataview vs Datacore vs Bases](https://abdulkadersafi.com/blog/dataview-vs-datacore-vs-bases)
