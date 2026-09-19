# Deckard improvements

## Method

All 7,591 Obsidian community plugins were ranked by download count from the
official plugin stats, then filtered to the ones that fit Deckard: a
local-first Markdown knowledge index inside VS Code. Each idea was checked
against the current source so that nothing here duplicates a shipped feature.

## Status of the earlier roadmap

| Earlier priority | Status | Supporting plugins |
| --- | --- | --- |
| Saved queries and collection views | Mostly shipped. The query language, visual builder, saved queries, query blocks in notes, and the task board exist. Table and calendar views remain. | Dataview (#3, 5.0M), Bases (core), Kanban (#9, 2.7M) |
| Typed front matter schemas and explicit relations | Open | Breadcrumbs, Metadata Menu, Supercharged Links |
| Task scheduling and planning | Mostly shipped as Obsidian Tasks metadata and the Agenda. Calendar projections remain. | Tasks (#4, 4.2M), TaskNotes (1.5M) |
| Backlinks and note-link graphs | Shipped: the Notes Graph, and backlink counts and previews in the editor | Obsidian core Backlinks and Graph |
| Section and block references | Shipped for reading: `[[Note#^id]]` resolves, completes, previews, and is counted as a backlink. Minting ids is deliberately left out. | Obsidian block references |
| Canvas or whiteboard | Open, low priority | Excalidraw (#1, 7.9M), Advanced Canvas |
| Git-aware collaboration | Open, keep light since VS Code has SCM built in | Obsidian Git (#6, 3.1M) |

## New suggestions

### 1. Queries inside notes

Inspired by Dataview, Tasks, and Bases. **Shipped** as query blocks; see the
README.

- A ` ```deckard ` block containing a query, rendered as live results in VS
  Code's Markdown preview through `extendMarkdownIt`.
- A CodeLens above the block to open it as an overview.
- The parser and evaluator in `src/core/query/` already exist, so this is
  mostly rendering. Query definitions stay portable in the note itself.

### 2. Obsidian-compatible task metadata

Inspired by Tasks and TaskNotes. **Shipped**, with the Agenda view; see the
README. Both the emoji and Dataview formats are read, and typing `/` in a
task suggests metadata to insert. Dependencies are read, shown as
"blocked by" in the Agenda, and queryable as `is:blocked`, `is:blocking`,
`has:id`, and `has:dependsOn`.

`findTaskDate` in `src/core/markdown/parser.ts` already reads one loose due
date, and the Dashboard already marks overdue tasks. Rather than inventing a
syntax, read the Tasks emoji format that most Obsidian vaults already use:

```markdown
- [ ] Send proposal 📅 2026-09-20 ⏳ 2026-09-18 🔁 every week ⏫ 🆔 a1 ⛔ b2
```

| Marker | Meaning |
| --- | --- |
| 📅 | Due date |
| ⏳ | Scheduled date |
| 🛫 | Start date |
| ✅ | Done date |
| 🔁 | Recurrence |
| 🔺 ⏫ 🔼 🔽 ⏬ | Priority, highest to lowest |
| 🆔 / ⛔ | Task ID / depends on |

Then build on it:

- Stamp a ✅ date when Deckard toggles a checkbox.
- Create the next instance when a recurring task is completed.
- Add `due`, `scheduled`, and `priority` fields to the query language.
- Add a Today / Overdue / Upcoming agenda view.

### 3. Quick capture and templates

Inspired by Templater (#2, 5.6M) and QuickAdd (#12, 2.1M).

- The only template today is `deckard.dailyNoteTemplate`.
- `Deckard: Capture` — a quick input with tag completion that appends
  `- [ ] … #tags` to today's daily note, or under a chosen heading in a chosen
  note, without leaving the current editor.
- A templates folder with variables such as `{date}` and `{title}` and
  prompted values.
- Per-namespace templates, so a new `#person/…` hub note uses a person
  template. This feeds typed schemas.

### 4. Link health and aliases

Inspired by Find orphaned files and broken links, and Obsidian's core link
behavior.

- Wiki links resolve only on an exact, case-insensitive title match
  (`src/ui/commands/linkSuggestions.ts`), and an unresolved link does nothing.
- Report unresolved `[[links]]` as diagnostics with a **Create note** quick
  fix.
- List orphan notes, with no incoming links, in Stats.
- Honor `aliases:` front matter when resolving links. Obsidian vaults use it
  heavily, and the parser currently reads only `tags`, `describes`, and
  entity fields such as `people` and `projects`.

### 5. Reference counts and previews in the editor

Inspired by Strange New Worlds, Hover Editor, and Obsidian's Page Preview.
**Shipped**; see the README's Editor assistance section.

- A CodeLens above each heading, such as `4 references · 2 open tasks`.
- Hovering a `[[link]]` previews the target section.
- Hovering a tag shows its entry count and top entries. Today the tag hover
  offers only **Rename**.
- This delivers backlinks through standard VS Code surfaces rather than a
  separate panel.

### 6. Periodic notes and a calendar

Inspired by Calendar (#7, 3.1M) and Periodic Notes (757k).

- Weekly and monthly notes with their own templates.
- Previous and next daily-note commands.
- A sidebar calendar with markers for days that have notes or due tasks.
  Deckard already infers daily-note dates for Related Notes.

### 7. Tag hub pages and merge

Inspired by Tag Wrangler (#24, 1.1M). **Shipped** as hub notes and tag
merging; see the README's Tag overviews section and
`docs/tag-hubs-and-merge-plan.md`.

- Entities are virtual today: an overview collects matching sections but no
  note describes the entity itself. Let a note declare that it describes
  `#project/atlas` and show its body at the top of that Tag Overview. It is
  also the natural home for typed properties.
- Rename Tag refuses only a rename to the same tag
  (`src/ui/commands/renameTag.ts`). Make renaming into an existing tag an
  explicit merge, showing combined counts and warning that it cannot be
  undone.

## A second pass, over the source

The suggestions above came from the plugin download charts. These came from
reading Deckard's own source for what it still does not do. Each one was
checked against `src/` and the README, and none of them restates something
already shipped or already named elsewhere in this document.

### 8. Update links when a note is renamed or moved

**Shipped**; see the README's Renaming notes and headings section. Renaming a
note rewrites the links that named it, in the same step as the rename, and
`Deckard: Rename Heading` does the same for one heading.

Nothing listens to `vscode.workspace.onWillRenameFiles`, so moving or
renaming a note quietly breaks every `[[Note]]`, `[[Note#Heading]]`, and
`[[Note#^marker]]` that points at it. Link health (#4) reports that breakage
afterwards as a diagnostic; rewriting the links inside the rename prevents
it. Renaming a heading deserves the same treatment, since heading links
resolve by their text.

### 9. Preview and undo for workspace-wide writes

**Shipped**; see the README's Previewing and undoing a write section. A write
that reaches more than one note opens in VS Code's refactor preview, and
`Deckard: Undo Last Change` takes the last one back.

Rename Tag and Merge Tag rewrite hundreds of files in one gesture, and the
merge prompt warns that it cannot be undone. Show the diff before applying,
the way VS Code's own refactorings preview a rename, and keep the last
Deckard write as a `Deckard: Undo Last Change`. It is the promise the rest
of source safety already makes, extended to the two commands that reach
furthest.

### 10. Near-duplicate tags, offered as merges

**Shipped**; see the README's Tags that look alike section. Stats ranks the
pairs and offers the ordinary merge on each row.

Merging ships, Home already surfaces new tags and tags without a hub, and
Find already corrects a misspelled word against the words in the notes.
Nothing points out that `#projct/atlas` and `#project/atlas` are the same
idea, or that `#org/acme` and `#organization/acme` collide once
`deckard.entityNamespaceAliases` is read. A hygiene panel in Stats that
ranks close pairs and offers **Merge** finishes a feature that is already
built.

### 11. Embeds: `![[Note#Heading]]`

**Shipped**; see the README's Embeds section. The preview draws a whole note,
a heading with everything under it, or one marked line.

Heading and `^marker` references already resolve, complete, preview, and
count as backlinks, and `extendMarkdownIt` already replaces a `deckard`
fence with live results. Rendering an embed in the Markdown preview is that
same machinery pointed at a different token, and it needs no minted block
ids, which is the part deliberately left out. It is how most vaults build a
map-of-content note.

### 12. A local graph

The Notes Graph draws the whole workspace. A second mode, or a sidebar panel
beside Related Notes, showing the current note's neighbors one or two hops
out answers a question a ranked list cannot: not what is most related, but
what this note is actually attached to.

### 13. Roll unfinished tasks into today's note

`Deckard: Create Daily Note` starts from the template alone. Carrying
yesterday's open tasks forward, either moved or left behind as a link, is
the most common daily habit in vaults that run Periodic Notes beside Tasks,
and every piece of it — finding the previous daily note, reading task
metadata, editing a checked line — already exists.

### 14. A generated review page

Weekly and monthly notes open empty. Their natural content is a report the
query language can already answer: `created = 7d`, `updated > 7d`,
`done = 7d`, `is:overdue`, and the tags that first appeared this week. That
is assembly rather than new evaluation, and it turns a periodic note from a
blank page into the reason to open one.

### 15. A status bar count, and optional reminders

Nothing contributes a status bar item. "3 due today", clicking through to
the Agenda, is the one Deckard surface visible without opening a view, and
an optional notification at an hour you choose follows from the same count.

### 16. When you last wrote about a person

People are first-class in the index, but nothing tracks recency by person:
who has not appeared in ninety days, when a name was last written, what is
open that mentions them. On a person's hub note that is the 1:1 and meeting
half of the product, and it reuses the dates Related Notes already prefers.

### 17. Assignee, as distinct from mention

`@ren-kade` on a task means both "owns this" and "was named here". Marking
one of them as the assignee — a front-matter default for a note, or a
convention such as the first person on the line — gives the query language
`assignee = @ren-kade` and `is:mine`, and gives the board and the Agenda a
waiting-on column.

### 18. Export a search

Deckard reads the workspace and writes back into it; nothing leaves. A
search page, tag overview, or query block result copied out as Markdown, as
CSV, or as a table on the clipboard makes a result set usable in a pull
request, an issue, or a message, while the index itself still never leaves
the machine.

### 19. Import an existing vault

The method behind this document is Obsidian adjacency, but migration is the
step before any of it: Logseq `::` properties and `#[[nested tags]]`, a
Notion CSV-and-folder export, Roam JSON. One import command that rewrites
them into Deckard's tags and `[[links]]` is what lets a vault arrive at all.

### 20. A headless CLI over the same index

The parser, the query evaluator, the SQLite cache, and an MCP server all
exist. `deckard query "tag = #project/atlas AND is:open"` in a terminal, a
git hook, or CI — fail the build when a note carries an overdue task — is a
thin shell over them, and it reaches people who are not in VS Code at the
moment they need an answer.

### 21. Bulk actions on search results

Select rows on a search page and add a tag, complete the tasks, set a due
date, or move the notes into a folder. This is the largest single saving
here and the furthest from the source-safety rules, so it needs the
line-by-line comparison each task edit already makes, and probably the
preview from #9 before it. Worth deciding deliberately rather than by
omission.

## Quick wins

- ~~**Insert link** on Related Notes results, placing `[[Note#Heading]]` at the
  cursor. Smart Connections supports drag-to-link.~~ Shipped as the link
  button on each result.
- ~~**Extract Tagged Heading leaves a link behind.** It currently removes the
  section with nothing in its place; Note Refactor leaves a `[[link]]` to the
  new note.~~ Shipped: the section is replaced by a `[[link]]` to the new
  note.
- ~~**Board layout for task results**, grouped by a namespace such as
  `#status/*`.~~ Shipped as the task board, grouped by status, priority, or
  due date.
- ~~**Open the Dashboard on startup** setting, as Homepage (1.3M) does.~~
  Shipped as `deckard.dashboard.openOnStartup`.
- ~~**Typo tolerance and title/heading boosts** in Search Workspace Knowledge,
  as Omnisearch (1.9M) does.~~ Shipped: the full-text cache weights titles,
  headings, and tags above body text, and corrects a misspelled word against
  the words in the notes. Find offers the correction as a row, and a search
  page that finds nothing offers it under the search box.

## Worth considering

Two of the top 15 plugins embed AI coding agents in the vault (Claudian, #13,
and Copilot, #15), and Local REST API with MCP has 723k downloads. VS Code's
language model tool API could let Claude Code or Copilot ask Deckard for
"open tasks for #project/atlas" while Deckard itself still sends nothing to
an external service. **Shipped** as the `deckard_query` and
`deckard_list_tags` language model tools; see the README's AI assistants
section. Assistants that reach tools only over MCP, rather than through VS
Code, would need a separate local MCP server.

## Intentionally skipped

| Plugin category | Reason |
| --- | --- |
| Excalidraw, Advanced Tables, Linter, Pandoc, Git | VS Code or existing VS Code extensions already cover these. |
| Remotely Save, Self-hosted LiveSync | Sync conflicts with Deckard's local-first design. |
| Smart Connections embeddings | Tag and BM25 ranking in Related Notes already covers most of the value at far lower cost. Revisit later. |
| Spaced Repetition | A different product. |

## Recommended sequencing

1. ~~Obsidian-compatible task metadata.~~ Shipped with the Agenda, which
   unblocks the calendar and board views.
2. ~~Queries inside notes.~~ Shipped as query blocks.
3. ~~Quick capture and templates.~~ Shipped as `Deckard: Capture` and note templates.
4. ~~Link health and aliases.~~ Shipped.
5. ~~Reference counts, previews, and backlinks.~~ Shipped.
6. ~~Periodic notes and calendar.~~ Shipped. ~~Tag hub pages~~ shipped, with tag merging.
7. From the second pass, in order: rename-aware links (#8), which closes a
   correctness hole rather than adding a feature; embeds (#11), the cheapest
   real capability given what the preview already does; and the daily
   rollover with the review page (#13, #14), which make periodic notes earn
   their settings.

Typed schemas, block references, canvas, and Git-aware collaboration from the
earlier roadmap follow once these are in place.

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
