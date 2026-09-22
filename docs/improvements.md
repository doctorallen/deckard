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
| Typed front matter schemas and explicit relations | Open. Hub notes (`describes:`) are the natural home for typed properties. | Breadcrumbs, Metadata Menu, Supercharged Links |
| A table view for saved queries | Open. The query language, builder, saved searches, query blocks, board, and calendar exist; a result set as a sortable table does not. | Dataview, Bases (core) |
| Canvas or whiteboard | Open, low priority | Excalidraw, Advanced Canvas |
| Git-aware collaboration | Open, keep light since VS Code has SCM built in | Obsidian Git |
| Minting block ids | Deliberately left out. `[[Note#^id]]` resolves, completes, previews, and counts as a backlink; writing a `^id` is the author's. | Obsidian block references |

## Open suggestions

### 1. Export a search

Deckard reads the workspace and writes back into it; nothing leaves. A
search page, tag overview, or query block result copied out as Markdown, as
CSV, or as a table on the clipboard makes a result set usable in a pull
request, an issue, or a message, while the index itself still never leaves
the machine.

### 2. Import an existing vault

The method behind this document is Obsidian adjacency, but migration is the
step before any of it: Logseq `::` properties and `#[[nested tags]]`, a
Notion CSV-and-folder export, Roam JSON. One import command that rewrites
them into Deckard's tags and `[[links]]` is what lets a vault arrive at all.

### 3. A headless CLI over the same index

The parser, the query evaluator, the SQLite cache, and an MCP server all
exist. `deckard query "tag = #project/atlas AND is:open"` in a terminal, a
git hook, or CI — fail the build when a note carries an overdue task — is a
thin shell over them, and it reaches people who are not in VS Code at the
moment they need an answer.

### 4. Guarded writes for assistants

The `deckard_query` and `deckard_list_tags` language model tools, and the MCP
server, are read-only. The task draft, the board's moves, the refactor preview
that shows a multi-note write before it lands, and the one-command undo
already exist, so a `deckard_add_task` or `deckard_change_task` that goes
through that preview would let an assistant do "add a task for Dana due
Friday" with the safety Deckard's own commands have. The consent-per-session
flow is already there.

## Intentionally skipped

| Idea | Reason |
| --- | --- |
| Excalidraw, Advanced Tables, Linter, Pandoc, Git | VS Code or existing VS Code extensions already cover these. |
| Remotely Save, Self-hosted LiveSync | Sync conflicts with Deckard's local-first design. |
| Smart Connections embeddings, semantic search | Tag and BM25 ranking in Related Notes already covers most of the value at far lower cost. Revisit later. |
| Natural language to a query | An assistant that has the query language's reference can write a query; a built-in translator would be a second, worse one, and it would have to send text somewhere. |
| Spaced Repetition | A different product. |

## Sequencing

Typed schemas first, since hub notes give them a home and the table view
wants them; then the table view; export and the CLI are small once the query
evaluator is the only thing they need. Import, canvas, and Git-aware
collaboration follow, in that order, if at all.

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
