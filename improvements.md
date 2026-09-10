# Deckard improvements

## Assessment

Deckard is a strong local-first Markdown knowledge index inside VS Code. Its
current strengths are workspace-wide tag and entity indexing, aliases,
source-safe tag renaming, related-note ranking, task extraction, Wiki links,
local search, and heading-derived tag relationships.

The highest-value opportunities should extend Deckard's existing Markdown
source of truth and local index rather than turn notes into a proprietary
database or duplicate VS Code's built-in Markdown tooling.

## Prioritized opportunities

| Priority | Capability | Benefit | Comparable tools |
| --- | --- | --- | --- |
| 1 | Saved queries and collection views | Let users define reusable searches over tags, front matter, tasks, dates, and entities, then show results as tables, boards, calendars, or grouped lists. Keep query definitions portable, such as in a Markdown fence or sidecar file. | Obsidian Bases, Notion databases, Capacities queries |
| 2 | Typed front matter schemas and explicit relations | Support configurable fields such as status, date, priority, URL, and intentional Project-to-Task, Person-to-Meeting, or Organization-to-Project relations. This complements inferred tag hierarchy with authored semantic links. | Notion properties and relations, Capacities object types |
| 3 | Task scheduling and planning | Add a documented syntax for scheduled and due dates, recurring tasks, dependencies, blockers, and agenda/calendar projections. Deckard's existing task extraction and sorting are a useful foundation. | Notion task dependencies, Capacities calendar integrations, Logseq |
| 4 | Backlinks and note-link graphs | Show incoming Wiki links, optionally unlinked mentions, and global/local note graphs. Keep this separate from Deckard's tag relationship graph. | Obsidian Backlinks and Graph view, Capacities backlinks |
| 5 | Section and block references | Allow durable links to a heading, list item, or task. This supports precise research citations, decision records, and meeting follow-ups. | Capacities block-based linking, Logseq's block workflow |
| 6 | Canvas or whiteboard | Provide an optional spatial planning surface for note sections, tasks, files, URLs, and their connections, while Markdown stays canonical. | Obsidian Canvas, Logseq Whiteboards |
| 7 | Git-aware collaboration | Add local collaboration affordances first: changed-note status, conflict awareness, and reviewable knowledge updates. Keep cloud sync and shared comments optional to preserve local-first privacy. | Notion comments and mentions, Capacities collaboration |

## Recommended sequencing

1. Build saved local queries and collection views.
2. Add typed schemas and explicit relations.
3. Extend tasks with scheduling and dependencies.
4. Add backlinks and note-link graphs.
5. Evaluate canvas and optional collaboration only after the index and query
   model can support them cleanly.

The first three items compound Deckard's existing workspace index, typed
entity tags, task model, and Markdown-first design. Graph and canvas features
are higher UI investment and should follow a stable query and relationship
model.

## Intentionally avoid duplicating VS Code

Deckard should integrate with VS Code's Markdown capabilities instead of
reimplementing them. VS Code already provides synchronized preview, Mermaid,
KaTeX, workspace/file-path completion, local-link validation, Find References,
symbol rename for Markdown links, and automatic link updates after file moves
or renames.

The useful Deckard-specific work is interoperability: expose Deckard entities,
sections, tasks, backlinks, and query results through standard VS Code
navigation where possible.

## Research sources

- [Deckard README](README.md)
- [Obsidian Bases](https://help.obsidian.md/bases)
- [Obsidian Backlinks](https://help.obsidian.md/plugins/backlinks)
- [Obsidian Graph view](https://help.obsidian.md/plugins/graph)
- [Obsidian Canvas](https://help.obsidian.md/plugins/canvas)
- [Notion views, filters, and sorts](https://www.notion.com/help/views-filters-and-sorts)
- [Notion database properties](https://www.notion.com/help/database-properties)
- [Notion relations and rollups](https://www.notion.com/help/relations-and-rollups)
- [Notion tasks and dependencies](https://www.notion.com/help/tasks-and-dependencies)
- [Notion comments, mentions, and reminders](https://www.notion.com/help/comments-mentions-and-reminders)
- [Capacities queries](https://docs.capacities.io/reference/queries)
- [Capacities tables](https://docs.capacities.io/reference/tables)
- [Capacities object types](https://docs.capacities.io/reference/content-types)
- [Capacities object properties](https://docs.capacities.io/reference/object-properties)
- [Capacities calendar integrations](https://docs.capacities.io/reference/calendar-integrations)
- [Capacities block-based linking](https://docs.capacities.io/reference/block-based-linking)
- [Capacities backlinks](https://docs.capacities.io/reference/backlinks)
- [Capacities Graph view](https://docs.capacities.io/reference/graph-view)
- [Capacities collaboration](https://docs.capacities.io/more/collaboration)
- [Logseq features](https://logseq.com/features)
- [Logseq Whiteboards](https://docs.logseq.com/#/page/whiteboards)
- [VS Code Markdown](https://code.visualstudio.com/docs/languages/markdown)
