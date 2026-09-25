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

### 3. Read a task's status the way Obsidian writes it

A task's status is a `#status/…` tag on its line. That fits the index: the
tag is searchable, counted by Refine, completed after `#`, renamed with
the other tags, and its namespace is a setting. Obsidian Tasks has no
status field at all; its status is the character inside the checkbox,
`[/]` in progress or `[-]` cancelled, configured per vault, and Dataview
vaults write `[status:: doing]` as an inline field. Deckard's task pattern
accepts only a space, `x`, or `X` in the checkbox, so a `[/]` line from an
Obsidian vault is not indexed as a task at all, which is a larger gap than
the status form. The tag also puts every status into search results and
the graph as a node, and a status named `done` gets a column beside the
board's built-in Done.

Read the checkbox character as a status first, since that is Tasks' native
form and costs nothing to write; read `[status:: …]` beside the tag for
Dataview vaults; keep the tag as the form Deckard writes by default, or let
the written form follow `deckard.tasks.metadataFormat` as dates and
priority do; and fold `done` into the built-in column.

## From Notion

Notion's feature set as of September 2026 was read the same way: what it
has, what its users complain about, and what a local-first Markdown index
could take from it without becoming it. Most of what it has is here already
in another form: sub-items and dependencies are nested tasks and a task's
dependency, synced blocks are embeds and block references, backlinks and
`@` mentions are `[[links]]` and the Related Notes sidebar, recurring
templates are a task's recurrence and the periodic notes, reminders are
`deckard.taskReminderTime`, archiving is `deckard.exclude`, and its MCP
server has a counterpart. What remains is below.

### 4. A timeline view of tasks

Notion's timeline is its board's twin: the same rows across weeks rather
than down columns. Deckard shows tasks as a board, a list, a table, and a
calendar, but never side by side in time, so two projects' due dates are
compared by reading dates. A `timeline` layout on the Task Board, one row
per project or person and a bar from a task's scheduled date to its due
date, needs nothing the index does not hold; a dependency draws as an arrow
between two bars.

### 5. Charts and number tiles from a search

Notion charts a database and, since March 2026, lays several charts out as
a dashboard view; both are paid features. A query block that says
`chart=bar by=status`, and a Home widget that draws a bar or a single
number from a saved search grouped by tag, status, or due week, is a small
step on the evaluator, and free. Counts by group are what the Refine strip
already computes.

### 6. An import that leads with Notion

Item 1 stays, but Notion's export is the case to build first. It appends a
32-character id to every file name and every link, URL-encodes the links,
flattens each database to a CSV beside a folder of pages, and turns
callouts into HTML; a workspace export can take a day to arrive. Cleaning
the names, rewriting the links as `[[links]]`, and turning each CSV row into
a tagged note with front matter is a defined job, and losing links on the
way out is the complaint Notion's leavers make most.

### 7. A skill for assistants

Notion 3.7 lets a workspace's agent skills download into Claude Code,
Codex, and Cursor. Deckard has the query language, the tag conventions, and
the MCP tools; one skill file that teaches them, and a command that writes
it into a workspace's agent instructions, gives any assistant in the
workspace the same account of it that the Help page gives a reader.

### 8. Hand a task to an assistant from the board

Notion 3.6 assigns tasks on a board to external agents. A card's menu could
offer to open the chat with the task line and its note as context, using the
language model tools Deckard registers; nothing is written until the
assistant proposes it and the reader accepts, as every assistant write
already works.

### 9. Capture a link

Notion's web clipper is a page-level capture. Capture could recognize a URL
on the clipboard, fetch the page's title, and write a Markdown link into
today's note, so a page found while reading lands in the notes with its
name rather than its address.

Notion's own complaints are the case for the rest of Deckard: offline mode
holds the first fifty rows of a database, exports lose links, and most of
what shipped in 2025 and 2026 needs a paid tier plus credits. Local plain
Markdown is the answer to each, and the README can say so in a sentence.

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
needs. Reading Obsidian's status forms next, since the checkbox gap keeps
whole tasks out of the index. The skill file and charts are each a day and
reach anyone with an assistant or a saved search. The timeline is the
largest new surface and earns its place once the board has settled. Import,
led by Notion, canvas, and Git-aware collaboration follow, in that order, if
at all.

## Research sources

- [Notion releases](https://www.notion.com/releases)
- [Notion Calendar with Notion](https://www.notion.com/help/use-notion-calendar-with-notion)
- [Notion charts](https://www.notion.com/help/charts) and [dashboards](https://www.notion.com/help/dashboards)
- [Notion export](https://www.notion.com/help/export-your-content) and [its Markdown quirks](https://mdstill.com/blog/notion-markdown-export-quirks)
- [Notion offline](https://www.notion.com/help/use-pages-offline)

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
