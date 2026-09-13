<p align="center">
	<img src="resources/lockup.png" alt="Deckard" width="50%">
</p>

# Deckard

Deckard is a local-first second brain for Markdown notes in your VS Code workspace. It connects people, projects, topics, organizations, meetings, links, and checklist tasks while keeping your notes readable and portable.

## Features

| Feature | What it does |
| --- | --- |
| [Tags and entities](#markdown-format) | `#tags`, `@people`, and namespaced entities such as `#project/atlas` on headings, tasks, and lines become one workspace-wide index. |
| [Front matter](#markdown-format) | Fields such as `project:` and `people:` tag a whole note, and a command moves a note's inline tags there. |
| [Dashboard](#dashboard) | One page for workspace totals and every task, note, and tag, with filters, sorting, favorites, and saved views. |
| [Tag overviews](#tag-overviews) | Opening a tag collects every note section and task that uses it, along with the tags it is most often written with. |
| [Advanced search](#advanced-filtering) | A small query language with a visual builder combines tags, text, task state, dates, and priorities using `AND`, `OR`, and `NOT`. |
| [Query blocks](#query-blocks) | A `deckard` code fence keeps a live list of a query's results inside a note, drawn in the Markdown preview. |
| [Related Notes](#related-notes) | A sidebar ranks the notes most related to the one you are editing and explains each score. |
| [Notes Graph](#notes-graph) | An interactive map of every note, task, and tag connection in the workspace. |
| [Outline](#outline) | A sidebar tree of the current file's headings, with each heading's tags beside it. |
| [Agenda](#agenda) | Open tasks grouped into Overdue, Today, and Upcoming, which you can complete from their checkboxes. |
| [Task board](#task-board) | A Kanban board of tasks by status, priority, or due date, where dragging a card rewrites the task in its note. |
| [Task metadata](#task-metadata) | Due, scheduled, and start dates, priorities, repeat rules, and dependencies, written in either Obsidian Tasks format. |
| [AI assistants](#ai-assistants) | Assistants in VS Code, such as Copilot in agent mode, can search your notes and tasks with Deckard queries and list your tags. |
| [Editor assistance](#editor-assistance) | Clickable tags, completion after `#`, `@`, and `/`, backlink and task counts above headings, and previews when hovering links and tags. |
| [Tag renaming](#commands) | Renames a tag everywhere it is written without touching ordinary prose or fenced code. |
| [Wiki links](#markdown-format) | `[[Note]]` links complete note titles and open the note they name. |
| [Daily notes](#daily-notes) | One command creates or opens today's note from your template. |
| [Heading extraction](#extracting-headings) | Moves a tagged section, including its nested headings, into a note of its own. |
| [Workspace search](#commands) | Full-text search across saved notes, entities, and tasks from the Command Palette. |
| [Stats](#stats) | Index totals and your most-viewed tags, entities, and notes. |
| [Themes](#themes) | Six visual styles for Deckard's pages, from the default Replicant to LCARS and Synthwave. |
| [Local-first](#source-safety-and-persistence) | Your Markdown stays the source of truth, and the index never leaves your machine. |

## Requirements

- VS Code 1.134.0 or newer.
- An open folder or workspace containing Markdown notes.

Deckard scans every `*.md` file in each workspace folder by default. Set a notes folder only when you want to restrict the index.

## Install

Download the VSIX attached to a GitHub release and run `Extensions: Install from VSIX...` in VS Code.

## Themes

Set `deckard.theme` to choose the visual style used by Deckard webviews. The default is `replicant`.

| **Replicant** | **Oblivion** | **LCARS** |
| --- | --- | --- |
| <img src="docs/images/dashboard-replicant.png" alt="Replicant theme Dashboard." width="220"> | <img src="docs/images/dashboard-oblivion.png" alt="Oblivion theme Dashboard." width="220"> | <img src="docs/images/dashboard-lcars.png" alt="LCARS theme Dashboard." width="220"> |
| **Tomcat** | **Fellowship** | **Synthwave** |
| <img src="docs/images/dashboard-tomcat.png" alt="Tomcat theme Dashboard." width="220"> | <img src="docs/images/dashboard-fellowship.png" alt="Fellowship theme Dashboard." width="220"> | <img src="docs/images/dashboard-synthwave.png" alt="Synthwave theme Dashboard." width="220"> |

## Get started

1. Open a folder or workspace in VS Code.
2. Open any Markdown note in the workspace, or [restrict indexing to a folder](#settings).
3. Open the Command Palette and run `Deckard: Open Dashboard`.
4. Select the Deckard icon in the Activity Bar to open **Related Notes** while editing a Markdown note.

Deckard scans the workspace Markdown scope automatically and refreshes when saved notes are added, edited, or deleted.
Run `Deckard: Reindex Workspace` from the Command Palette to trigger a full scan manually.

Run `Deckard: Open Help`, or select the question-mark button in the Related Notes toolbar, to open the Help page. It includes a quick start, advanced configuration guidance, and in-page navigation by feature category.

![Deckard Help page with quick-start instructions and feature navigation.](docs/images/help.png)

## Commands

| Command | Description |
| --- | --- |
| **Deckard: Open Dashboard** | Opens workspace totals, tags, and tasks. |
| **Deckard: Open Notes Graph** | Opens an interactive force-directed map of every note, task, and tag connection. |
| **Deckard: Open Task Board** | Opens tasks as a Kanban board grouped by status, priority, or due date. |
| **Deckard: Show Stats** | Opens index totals and local view-count statistics. |
| **Deckard: Open Help** | Opens the quick-start and advanced feature guide. |
| **Deckard: Show Log** | Opens Deckard's log, which records how long indexing, ranking, and editor features take. |
| **Deckard: Reindex Workspace** | Performs a full scan of the workspace Markdown scope. |
| **Deckard: Create Daily Note** | Creates or opens today's note. |
| **Deckard: Extract Tagged Heading** | Moves a tagged heading section into a newly named note and leaves a `[[link]]` to it. |
| **Deckard: Show Tag Overview** | Opens a tag overview, or shows a tag picker when no tag is supplied. |
| **Deckard: Search Workspace Knowledge** | Searches saved notes, entities, and tasks from the Command Palette. |
| **Deckard: Search Notes and Tasks** | Opens an overview on a Deckard query, such as `(tag = #project/atlas AND task = open) OR text ~ "vendor"`. |
| **Deckard: Link Current Heading to Entity** | Adds a user-approved canonical person, project, topic, organization, or meeting tag to the current heading. |
| **Deckard: Move Inline Tags to Front Matter** | Moves explicit tags from the active note into merged note-level front matter. |
| **Deckard: Rename Tag** | Searches indexed tags and replaces the selected tag in its source notes. |
| **Deckard: Merge Tag…** | Merges one indexed tag into another that already exists, after showing what the merge will change. |
| **Deckard: Follow Cursor in Outline** | Selects the Outline heading containing the editor cursor. The Outline title has the same control. |
| **Deckard: Stop Following Cursor in Outline** | Leaves the Outline selection where you put it. |

## Markdown format

Deckard recognizes ATX headings, unordered checklist items, `#` tags, `@` people, and `[[Wiki links]]`. Tag matching is case-insensitive. A tagged non-heading, non-task line is indexed as its own entry when `deckard.parseInlineTags` is enabled; consecutive tagged prose lines are grouped so wrapped explanations do not become truncated duplicate entries.

By default, use `@` for people and namespaced `#` tags for workspace entities:

```markdown
# Project Atlas #project/atlas
Met with @alex-smith about [[Q3 planning]].

- [ ] Send the proposal by 2026-09-12 #project/atlas
```

`#project/atlas`, `#topic/leadership`, `#org/acme`, and `#meeting/q3-planning` appear as entity hubs. Any other namespaced tag, such as `#management/performance`, creates a new namespace automatically and appears as `Management: Performance` in its overview. Simple unnamespaced `#follow-up` tags remain supported; all tags appear together in the Dashboard's **Tags** catalog. Deckard distinguishes `@alex` from `#alex`. You can configure namespace aliases to map a custom namespace to any built-in or custom target namespace, and you can move the people marker; when the people marker is changed from `@`, `@name` becomes a lightweight tag.

Frontmatter can add portable entity context to every heading and task in a note:

```yaml
---
project: atlas
people: [alex-smith]
topics:
  - leadership
---
```

Supported front-matter values are highlighted in the editor and Cmd/Ctrl-clickable just like inline tags: `people`/`person` maps to `@person`, while `projects`, `topics`, `organizations`, and `meetings` map to their typed `#` tags. These metadata tags remain indexed and openable even when the note has no heading or task.

Run `Deckard: Move Inline Tags to Front Matter` to collect explicit tags from the current note into plural front-matter fields. Existing values are merged, unrelated YAML fields are preserved, and source tag tokens are removed. Because the resulting metadata applies to the entire note, use the command only for context that belongs to every heading and task in that note.

Run `Deckard: Rename Tag` to search the indexed tag list, choose a replacement, and update every matching source occurrence without changing ordinary prose or fenced code. Renaming to a tag that already exists merges the two; see [Merging tags](#merging-tags). In the Dashboard, Tag Overview, or Related Notes sidebar, right-click a tag and choose **Rename tag**. In a Markdown editor, hover a tag and choose the clickable **Rename** action. Enter a complete tag such as `#management/new-name`, or enter only a new name to keep the selected tag's marker and namespace.

- Headings use the ATX form `# Heading` through `###### Heading`. Optional closing hashes are removed from the heading title.
- **Associated tags** are Deckard's practical "these belong together" suggestion. If you write `#project/atlas` and `#risk/vendor` together on one heading, task, or tagged line, Deckard retains that raw evidence. Related Notes normalizes it by the distinct source-unit support and both tags' prevalence, so a common tag is not promoted merely by occurring often. Tags in a heading and its nested headings get a lighter connection. Front-matter and inherited tags give note context but never create associations on their own.
- Tasks use `-`, `*`, or `+` followed by `[ ]` for open items or `[x]`/`[X]` for completed items.
- A task inherits tags from its nearest heading and combines them with tags written on the task line.
- Tag names start with a letter or number and can contain letters, numbers, `_`, `-`, and `/` namespace segments.
- Fenced code blocks using backticks or tildes are ignored by indexing, decorations, and completion.
- Numeric-only hash tokens such as `#2026` are ignored as tags so that ordinary Markdown headings and dates do not become tags. Numeric `@` tags such as `@2026` remain valid.

For example:

```markdown
# Launch plan #project/atlas

## Next steps #topic/planning

- [ ] Review the brief #topic/writing
- [x] Send the update @alex-smith
```

Use `- [ ]`, `* [ ]`, or `+ [ ]` for an open task. Use `- [x]` for a completed task. A task inherits tags from its heading and can also have its own tags.

## Task metadata

Deckard reads both formats of the [Obsidian Tasks](https://publish.obsidian.md/tasks/) plugin, so tasks written for Obsidian keep their dates, priorities, and repeat rules. The emoji format looks like this, and the [Dataview format](#dataview-format) spells the same fields out in brackets:

```markdown
- [ ] Send the proposal 📅 2026-09-20 ⏳ 2026-09-18 ⏫ 🔁 every week
```

| Marker | Meaning |
| --- | --- |
| 📅 | Due date. 📆 and 🗓 also work. |
| ⏳ | Scheduled date: the day you plan to work on the task. ⌛ also works. |
| 🛫 | Start date: the task is not actionable before this day. |
| ✅ | Completion date. |
| ➕ ❌ | Created and cancelled dates. They are removed from titles and kept in the note. |
| 🔺 ⏫ 🔼 🔽 ⏬ | Priority, from highest to lowest. |
| 🔁 | Repeat rule, such as `every week`. |
| 🆔 ⛔ | A task's id, and the ids of the tasks it waits for. |

- Markers are removed from task titles wherever Deckard shows them, and appear as details instead. A trailing Obsidian block id such as `^a1b2` is left out of the title too. Deckard reads a marker anywhere on the line, while Tasks expects them at the end.
- A 📅 date wins over a date written in the sentence. Without one, Deckard still reads `2026-09-12`, `Sep 12`, or `next Friday` from the task text. A ✅ date is never taken for a due date.
- Completing a task from Deckard adds ✅ with today's date, and reopening it removes the date. Set `deckard.tasks.addDoneDate` to `false` to change only the checkbox.
- Completing a task with a 🔁 rule writes its next occurrence on the line above, as Tasks does. The due date, or else the scheduled or start date, moves forward by the rule, and the other dates keep their distance from it; a rule ending in `when done` counts from today instead. The new task drops the ✅ date, the 🆔, and any block id.
- Deckard understands `every day`, `every 3 weeks`, `every month`, `every year`, `every weekday`, `every Monday`, `every week on Tuesday, Friday`, `every month on the 15th`, and `every month on the last`, each optionally followed by `when done`. For any other rule it completes the task, adds no next occurrence, and tells you so.
- Only `[ ]`, `[x]`, and `[X]` checkboxes are tasks, so a Tasks `[-]` cancelled task is not indexed.

### Dataview format

Tasks can also be written in the plugin's text-only Dataview format, and Deckard reads it the same way:

```markdown
- [ ] Send the proposal [due:: 2026-09-20] [scheduled:: 2026-09-18] [priority:: high] [repeat:: every week]
```

The fields are `due`, `scheduled`, `start`, `created`, `completion`, `cancelled`, `priority`, `repeat`, `id`, and `dependsOn`, in square or round brackets. Other Dataview fields, such as `[owner:: Ren]`, stay part of the title. When Deckard writes a date, such as a completion date or a repeating task's next dates, it uses the format the task already uses. For a task with no metadata yet, `deckard.tasks.metadataFormat` chooses.

### Typing metadata

Type `/` after a space in a task to pick metadata instead of typing it:

- **due today**, **due tomorrow**, **due in a week**, and **due on a date**, with the same choices for scheduled and start dates;
- the five priorities, from **highest priority** to **lowest priority**;
- common repeat rules, or **repeats on a rule** to write your own;
- **task id**, and **depends on** each open task's id.

Keep typing to narrow the list, as in `/prio` or `/every`. Suggestions use the format the task already uses, or `deckard.tasks.metadataFormat` for a task without metadata. Set `deckard.tasks.metadataSuggestions` to `false` to turn them off.

## Editor assistance

- Tags in Markdown editors receive clickable decorations. Cmd/Ctrl-click opens its tag overview, and hovering a tag provides a separate clickable **Rename** action. Heading tags are always handled; tags on other lines follow `deckard.parseInlineTags`.
- Typing `#` or `@` offers matching tags already in the index, with each tag's current entry count. `#atl` can complete to `#project/atlas`; `@al` can complete to `@alex-smith`. Partial tag tokens are replaced correctly, fenced code is ignored except inside a `deckard` [query block](#query-blocks), and numeric-only hash tags are excluded from `#` completion.
- Typing `/` after a space in a task offers due dates, priorities, repeat rules, and dependencies. See [Typing metadata](#typing-metadata).
- **Reference counts** sit above a note's lines. The first line says **Linked from N notes** when other notes link to it, and each heading shows **N references** for links that name it, such as `[[Launch plan#Decision]]` or `[[#Decision]]`, and **N open tasks** for the open tasks beneath it. Select a count to list those links or tasks in VS Code's references peek. A tagged heading also shows **N entries share a tag**: the note sections, tasks, and front-matter-only notes elsewhere that carry one of the tags written on that heading. Tags inherited from a parent heading or the note's front matter do not count, and neither do entries in the same note. Select it to open [Related Notes](#related-notes) focused on the heading, which lists those entries along with weaker matches such as associated tags and shared keywords. Set `deckard.editor.referenceCounts` to `false` to hide them.
- **Hovering a `[[Wiki link]]`** previews the note, or the section its `#Heading` names, and says how many other notes link to it. A link to a note that does not exist yet, or to a name several notes share, says so instead.
- **Hovering a tag** shows how many notes and tasks use it, its [hub note](#hub-notes) when it has one, and its five most recently updated entries, each a link to its line, with **Open overview**. Set `deckard.editor.hoverPreviews` to `false` to turn previews off. The tag's **Rename** action stays in the same hover.

![Reference counts above a note's lines: its backlinks, and each heading's references, open tasks, and related entries.](docs/images/editor-assistance.png)

## Dashboard

Run `Deckard: Open Dashboard` to see compact workspace totals and switch between the **Tasks**, **Notes**, and **Tags** tabs. The Dashboard opens on **Tasks**; use Left/Right Arrow while the tab control is focused to switch modes. Dashboard tab, search, status, and tag-filter choices are restored when you close and reopen the Dashboard.

![Deckard Dashboard showing workspace totals, saved views, and active tasks.](docs/images/dashboard.png)

- **Saved tag views** appear above the Dashboard's Tasks/Notes/Tags tabs, so they remain available in any mode. In a combined Tag Overview, use **Save filter** to name its active tags; select a saved view to reopen that exact intersection, or use **Remove** to delete it.
- The Dashboard title identifies the active mode as **Dashboard: Tasks**, **Dashboard: Notes**, or **Dashboard: Tags**. Use the View options gear to choose independent one-through-four column limits for task, note, and tag cards; Deckard saves all three choices for future Dashboard sessions.
- **Tasks as a board**: open **View options** and set **Tasks** to **Board** to show the Tasks tab as the same Kanban board the [Task board](#task-board) uses, grouped by status, priority, or due date. The tab's **All**, **Open**, and **Done** filter, tag picker, and search still choose which tasks appear, and Deckard remembers the layout and grouping.
- **Task controls** provide visible **All**, **Open**, and **Done** counts, text search, plus **Sort: Rank/Created/Updated**. Open the labeled searchable tag picker to select task tags; selected tags appear as removable chips, with **Clear filters** available when tags are selected. A task appears when it matches any selected tag. Rank is the default; date sorting uses the source file's filesystem timestamps.
- **Notes** lists indexed note entries with a searchable multi-tag picker, text search, and **Sort: A-Z/Newest created/Recently updated/Most accessed**, matching the Notes tab in a tag overview. Notes use the same full-card presentation and View options format toggle as tag overviews, so you can switch between original Markdown and rendered HTML; the choice is shared with Entity Overview. A note appears when it matches any selected tag; select a note entry to jump to its source line.
- **Tags** shows namespaced and unnamespaced tags together. Search tags, then sort alphabetically, by entry count, by most accessed, or by custom rank. Favorite important items; in Rank mode, drag a row or use its context menu to move it to the top or bottom. Wherever a namespaced tag is shown inline, its `#namespace/` prefix is muted while the tag value keeps the surrounding view's normal color.
- Select a tag to open its [tag overview](#tag-overviews).
- Select a task to jump to its exact source line.
- Use a task checkbox to update the checklist marker in the original note.
- Right-click any tag or entity row to choose **Rename tag**. When tags use custom rank or tasks use Rank, drag rows or right-click a row to move it to the top or bottom. Date-sorted tasks cannot be dragged. Display order changes do not reorder text in your Markdown files.

## Stats

Run `Deckard: Show Stats` to see the current Markdown file, note entry, task, tag, namespaced entity, and Wiki-link totals from the index. It also shows the most-viewed tags, namespaced entities, and note entries from Deckard's local access counters. These counters are collected when you open a tag overview or select a note entry in an overview, and are stored only in VS Code preferences. Select a most-viewed tag or canonical tag to open its overview, or a note entry to open its note at that line.

![Deckard Stats showing index totals and the most-viewed tags, entities, and note entries.](docs/images/stats.png)

## Notes Graph

Run `Deckard: Open Notes Graph`, or select the graph icon next to the Dashboard icon in Related Notes, to see the whole workspace as a zoomable force-directed map. Notes and tasks appear as dots sized by connection count. The visual layout detects weighted communities from structural links and prevalence-adjusted tag evidence, then positions each community around a virtual anchor; hidden tag nodes no longer act as high-mass particles. Secondary tags and associations still provide lighter bridges without drawing a dense web between every pair of notes. The view starts zoomed out over the full graph and stays smooth with thousands of nodes.

![Deckard Notes Graph showing clustered note, task, and tag connections.](docs/images/notes-graph.png)

- Scroll to zoom toward the cursor, drag empty space to pan, and drag a dot to rearrange its cluster; **Fit** reframes the whole graph.
- Hover a dot to highlight its direct graph neighbors and see its source location. Select any note, task, or tag dot to list those connected nodes in the sidebar using the same note-card and tag styling as the rest of Deckard. Select the current node at the top of the sidebar to open its note/task source or tag overview. Select a connected sidebar item to move the graph selection; Cmd/Ctrl-click it to open that item instead. Cmd/Ctrl-clicking a graph dot opens the same destination, and selecting empty space clears the selection.
- **Filters** searches titles and paths, restricts the view to selected tags, and independently toggles notes, tasks, tag nodes (off by default), and orphan nodes.
- **Display** adjusts node size, link thickness, and the zoom level at which labels appear. **Connection density** sets the local edge budget; **Tag prevalence bias** controls how strongly rare/common tag populations affect salience; **Secondary bridge strength** controls weaker cross-community tag and association links. **Show all links** disables the backbone filter for comparison. **Reset graph settings** restores these controls, clears graph filters, and reframes the view.
- **Forces** tunes the layout with cluster centering, cluster cohesion, community spacing, repel strength, link strength, and link distance; changes re-run the simulation live. The graph's default layout uses a prevalence-aware local backbone: direct Wiki links and headings seed visual communities, tag memberships are scored against a target community size, and each node retains only its strongest connections. The underlying Connected Nodes sidebar still uses every indexed relationship.
- The graph is read-only: it never changes tags, associations, or your Markdown sources, and control choices persist per panel.
- The sidebar switches to **Connected nodes** only while the Notes Graph tab is active. Returning to a Markdown editor restores the normal Related Notes ranking.

## Outline

Open **Outline** from the Deckard Activity Bar to see the active Markdown file's headings as a tree. It is a view like any other, so it can be dragged into either the primary or the secondary sidebar and VS Code remembers where you put it.

![Deckard Outline listing a note's headings, with each heading's tags beside it.](docs/images/outline.png)

- Heading markers and tags are taken out of each title, and the heading's own tags are shown beside it, so structure and labels read as two columns.
- Untagged headings are kept as structure, so a tagged heading stays where you wrote it. A heading written as nothing but tags shows those tags as its title.
- Headings inside fenced code blocks are ignored, and a numeric hash such as `Sprint #3` stays in the title because it is not a tag.
- The tree is built from editor text, so it follows the file as you type rather than waiting for a save.
- Select a heading to jump to its line. Right-click a heading that carries tags for **Open Tag Overview** and **Rename Tag**.
- The eye control in the view title switches whether the Outline follows the cursor, and **Collapse all** is beside it.

Headings written in the underlined `Title`/`===` style are not shown, matching how Deckard indexes notes everywhere else.

## Agenda

Open **Agenda** from the Deckard Activity Bar to see the open tasks that need attention soon. Like the Outline, it can be dragged into either sidebar.

![Deckard Agenda grouping open tasks into Overdue, Today, and Upcoming beside a note with dated tasks.](docs/images/agenda.png)

- **Overdue** lists tasks whose due date has passed, oldest first.
- **Today** lists tasks due today, and tasks scheduled for today or earlier that have started, most important first.
- **Upcoming** lists tasks due, scheduled, or starting in the next seven days, soonest first. Set `deckard.agenda.upcomingDays` to look further ahead.
- Each task shows why it is listed, its priority, and its file, plus `blocked by …` while a task it waits for with ⛔ is still open. Select a task to open its line.
- Check a task's box to complete it with the same source-safe edit the Dashboard uses, including its ✅ date and next occurrence.
- The Agenda's badge counts the tasks that are overdue or due today.

## Task board

Run `Deckard: Open Task Board`, or select the board icon in the Deckard sidebar's toolbar or in the Agenda's title, to see tasks as a Kanban board. Drag a card to another column to change the task in its note, or choose a column from the card's **⋯** menu, which also works from the keyboard.

![Deckard Task Board showing tasks in status columns that end with Done.](docs/images/task-board.png)

- **Status** gives each status tag written on a task line its own column, such as `#status/doing`. `deckard.board.statuses` sets the first columns and their order, `todo`, `doing`, and `waiting` by default; any other status found on a task gets a column after them, and tasks without one wait in **No status**. Dropping a card replaces its status tag, or removes it in **No status**. Set `deckard.board.statusNamespace` to use another namespace, such as `#stage/…`.
- **Priority** gives each priority a column. Dropping a card writes the new priority in the task's own format, such as ⏫ or `[priority:: high]`.
- **Due date** has columns for Overdue, Today, Tomorrow, Within a week, Later, and No due date. Drop a card on **Today** or **Tomorrow** to set its due date, or on **No due date** to remove it; the other columns cover a range of days, so they do not accept drops. A due date written in the task's sentence, such as `by Sep 16`, is left for you to edit.
- Every grouping ends with **Done**. Dropping a card there completes it, with its done date and next occurrence, and dragging it back out reopens it. Done shows the 20 most recently completed tasks.
- Filter the board with a Deckard query, such as `tag = #project/atlas` or `priority >= high`.
- Select a card to open its line, or one of its tags to open that tag's overview. Only a status written on the task line counts, not one inherited from a heading, because moving the card could not change it.
- Every move is checked against the indexed line first, like a checkbox, so an edit made since the board last refreshed is never overwritten.

## Related Notes

Open **Related Notes** from the Deckard Activity Bar while editing a saved Markdown note. It suggests other note entries that may concern the same work.

![Deckard Related Notes sidebar showing ranked note entries and matching tags.](docs/images/related-notes.png)

### What makes a note related?

| Signal | Example | Importance |
|---|---|---|
| Shared tag | Both entries contain `#project/atlas` | Strongest |
| Parent or child-heading context | Your selected entry sits under a `#project/atlas` parent heading, or a selected heading contains one | Useful, but lighter |
| Associated tag | `#project/atlas` and `#risk/vendor` are often written together | Supporting evidence |
| Entry Wiki link or lexical similarity | An entry links to `[[Launch plan#Decision]]` or shares distinctive section wording | Small supporting evidence |

For example, if you select `#project/atlas #follow-up`, a note with both tags ranks ahead of a note that only contains an associated `#risk/vendor` tag. Associations retain their raw source evidence but are normalized for support and tag prevalence before diminishing returns are applied, so generic tags cannot dominate and indirect connections cannot overtake a complete direct match.

On the **Debug related notes** page, a **source unit** is one distinct tagged heading, tagged line, task, or heading relationship where Deckard can observe a tag; it is not necessarily a whole file. **Raw evidence** is the starting strength of an association, while **normalized relevance** adjusts that strength for repeated support and how common each tag is. **BM25 lexical similarity** (also written **BM-25**) is a capped search-style text match that gives more weight to distinctive shared words than to common words.

For the complete source-unit model, formulas, worked examples, configuration details, and external references, see the [Related Notes association and ranking reference](docs/related-notes-associations.md).

### Focus one note entry

Tagged headings highlight their full section; tagged lines and tasks highlight their line. Hover one to choose **Show related notes for [entry]**. The sidebar identifies the scope as a **Selected entry**, shows the source note, and uses that entry's tags first before adding tagged parent headings as lighter context. When the selected entry is a heading, tagged descendant child headings and tagged child items are also added as lighter context. Parent and child heading context decay by distance; child items use an additional level of decay, and the strongest occurrence wins when a tag appears more than once. The active tag list shows each contribution with a segmented **Rail** marker; hover or focus a tag to see its exact Related Notes weight. Choose **Show whole document** in the sidebar to return to the normal document view.

Each result shows its compact heading path and a concise primary reason for the match. Daily notes also show their inferred `YYYY-MM-DD` date, making a result such as `2026-09-10 > Project Atlas > Check-in` understandable before opening it. When both a broad heading and a nested child use the same tags, the child appears first because it is the more specific match. The Related Notes list includes its result count, and the **Sort by** control keeps the selected ordering visible.

### Understand a score

Select a result percentage to open its explanation with the matching signals and weights; it also works from the keyboard. For the complete calculation, hover a tagged entry and choose **Debug related notes for [entry]**. The debug page shows whether each selected tag came from the entry, parent ancestry, a child heading, or a child item, along with heading paths, daily-note context, raw and normalized association support/prevalence, entry and file link evidence, lexical terms, optional recency, and specificity adjustments.

Use the sort control to choose **Relevance**, **Newest**, **Oldest**, or **Most accessed**. Select a related note to open its matching line, or select a tag to open its overview.

When a Tag Overview is the active editor tab, the sidebar identifies itself as **Tag Overview**, shows the focus tag and matching-note count, and switches from related notes to one compact **Associated tags** list. Associations are sorted by strength and show a percentage; hover or focus one to learn whether the connection came from tags written together or from heading context. Expand the list to navigate without leaving the narrow sidebar. Selecting an association carries the current tag as a second filter. Active filters appear as removable chips with **Clear filters**, and the matching notes remain visible below. The notes in a Tag Overview already match that tag, so they do not show a redundant 100% relevance score. Returning to a Markdown editor restores the related-notes projection.

## Tag overviews

Open an entity or tag overview by selecting it in the editor, Dashboard, Related Notes, or by running `Deckard: Show Tag Overview` from the Command Palette.

![Deckard Tag Overview showing matching notes, active tasks, and display controls.](docs/images/tag-overview.png)

Each overview collects the matching sections from your notes. You can:

- see the active tag intersection, each removable tag condition, and the matching note and task totals at a glance;
- sort entries alphabetically, by creation date, by update date, or by most accessed;
- search Notes and Tasks independently within the active tag intersection;
- use **Save filter** beside the Tag Overview label to name a combined view, then open the **View options** gear to switch between the original Markdown source and a rendered view or choose **Tabs** or **Side by side**;
- see the matching saved view name above the entity title whenever the active tag intersection corresponds to a saved view; and
- filter overview tasks with the grouped **All**, **Open**, and **Done** controls (which default to **Open**), then use a checkbox to safely update the original Markdown task; and
- switch **Associated tags** between a namespace-collapsible **Tree** view and a layered **Graph** view on lightweight tag overviews; all remain clickable, show their connection percentage, and repeated source references show a compact count; and
- follow an association into the target overview with the current tag applied as a second filter, so only the exact sources that supplied the association are shown; active relationship filters are folded into the page title as **[filter tag] AND [focus tag]**; remove individual tags or reopen the focus tag to return to the full overview; and
- save any combined overview with two or more active tags as a named filter, then reopen or remove it from the Dashboard; and
- select a section to jump to its heading in the source note.

Opening a tag overview records tag access. Opening a section records section access, which powers the access sort. Tag links inside an overview open the next overview without leaving the workflow.

### Hub notes

A hub note describes a tag, so the tag's overview opens with what the tag is rather than only where it is used. Add `describes:` to the note's front matter:

```markdown
---
describes: project/atlas
status: active
owner: "@dana"
---
# Atlas

Migration of billing onto the new ledger.
```

- The overview for `#project/atlas` then shows the note at the top, with its other front-matter fields as properties. Values that are tags, such as `@dana`, open their own overviews. The hub's own entries are not listed again below it.
- Write the tag without its `#`, or quote it, because YAML reads an unquoted `#` as the start of a comment. Quote people, as in `describes: "@dana"`. A list such as `describes: [project/atlas, proj/atlas]` describes several tags.
- An overview with no hub offers **Create hub note**, which writes one to the notes folder and opens it. An existing note is never overwritten.
- When several notes describe one tag, the first by path leads the overview and the others are listed beneath it.
- Hovering the tag in the editor names its hub note, and renaming the tag updates `describes:` too.
- Filtered and query views leave the hub out, so they show only their results.
- Select the hub's title row to collapse or expand it; the overview remembers your choice until it closes. `deckard.tagOverview.hubNoteExpanded` sets whether hubs start open, which they do by default.

### Merging tags

Rename a tag to one that already exists, or run `Deckard: Merge Tag…` and pick the tag to keep, to merge the two. Deckard first shows how many entries each tag has, how many carry both, and how many the kept tag will have, and asks before changing anything, because renaming back later cannot separate them again.

- Where the kept tag already sits beside the old one on a heading or task line, or in the same front-matter list, the old tag is removed rather than repeated. Inside a sentence it is replaced, so the sentence still reads.
- Favorites, access counts, Dashboard tag selections, and saved views move to the kept tag. A plain rename moves them too.

### Advanced filtering

Selecting a tag and adding a related tag from the sidebar is the quickest way to narrow an overview, and it is unchanged. When an intersection is not enough, open **Advanced search** in the overview header to write a Deckard query.

```
(tag = #project/atlas AND tag = @ren-kade) OR (tag = #risk/vendor AND text ~ "elevator")
```

Terms combine with `AND`, `OR`, `NOT`, and parentheses. `AND` binds tighter than `OR`, adjacent terms are joined by an implicit `AND`, and `-` or `!` in front of a term negates it. A bare `#tag` or `@person` is a tag condition and a bare or quoted word is a text condition, so `#project/atlas "vendor risk"` is a complete query.

| Field | Matches | Example |
| --- | --- | --- |
| `tag` | A tag, including tags a section inherits from a parent heading and tags a note carries in its front matter. `*` and `?` are wildcards. | `tag = #project/atlas`, `tag = #risk/*` |
| `text` | Words in a note body, a task line, or a front-matter-only file. `:` and `~` match a substring; `=` and `!=` match a whole word. | `text ~ elevator`, `text = plan` |
| `task` | `open`, `done`, or `any`. Only tasks can satisfy it, so a query using it returns no notes. | `task = open` |
| `due`, `scheduled`, `start` | A task's 📅, ⏳, or 🛫 date: a date, `today`, `tomorrow`, a window such as `7d` counted forward from today, or `none` for a task without that date. Only tasks can satisfy them. | `due < today`, `scheduled <= today`, `due = none` |
| `done` | A task's ✅ date, with windows counted back from today. | `done = 7d` |
| `priority` | `highest`, `high`, `medium`, `none`, `low`, or `lowest`. A task without a priority counts as `none`, which ranks between `medium` and `low`. | `priority >= high` |
| `kind` | An entity namespace, including `person` for `@` tags. | `kind = project` |
| `file` | A file name, with `*` and `?` wildcards. | `file = 2026-09-*.md` |
| `path` | A workspace-relative path, with wildcards. | `path = notes/*` |
| `created`, `updated` | A date such as `2026-09-13`, a window such as `30d`, or `today`. A bare date means that whole day. | `updated > 7d`, `created = 2026-09-13` |

Operators are `=` for is, `!=` for is not, `~` for contains, `!~` for does not contain, and `>`, `>=`, `<`, `<=` for dates and priorities. A window such as `7d` is compared by its far end: `updated > 7d` means updated within the last seven days, and `due < 7d` means due within the next seven days, overdue tasks included. `:` is accepted everywhere `=` is, so queries written with `tag:#atlas` keep working, but Deckard writes `=` when it formats a query back. A comparison can follow the operator, so `updated:>2026-01-01` and `updated > 2026-01-01` mean the same thing. Every operator has an opposite, so any single condition can be negated without `NOT`; `NOT` is for negating a whole parenthesized group.

- The query bar completes field names and, once it can see which field the caret is in, that field's values — indexed tags, task states, entity namespaces, file names, and date shorthands. Nothing is preselected, so Enter always runs the query you typed; Tab completes, arrow keys move through the list, and Escape abandons the edit.
- A builder row's value field offers the same completions for its own field, so a tag row completes tags and a task row offers `open`, `done`, and `any`. Choosing one applies the query immediately.
- **Builder** edits the same query as OR groups of AND rows, using dropdowns instead of syntax. Its operator list shows the operators themselves — `=`, `!=`, `~`, `!~`, `>`, `>=`, `<`, `<=` — with their meaning on hover, so a row reads the way the query is written. A row says everything with its operator, so there is no separate negate control to disagree with it, and a hand-written `NOT tag = #a` opens in the builder as `tag != #a`. The query bar remains the source of truth, so a condition the builder cannot represent, such as a negated group, is shown as read-only text rather than rewritten.
- The Related Notes sidebar follows the query. It identifies the scope as **Advanced search**, shows the query, lists what it matched, and returns to the ordinary tag view when the query is cleared. A query naming exactly one tag keeps that tag's association suggestions.
- Editing a query never moves you to a different page. When a query narrows to an intersection led by the tag the page was opened on, the page returns to its ordinary chips in place; otherwise it keeps showing the query and its results. Opening a saved query or `Deckard: Search Notes and Tasks` on a plain intersection still lands on the ordinary tag overview, with its usual chips, association suggestions, and title.
- **Save filter** stores a query under a name. Saved queries appear in the Dashboard's saved views beside saved tag intersections, and they survive tags being renamed or removed from the index.
- A parse error is reported under the query bar and the previous results stay on screen, so a half-typed query never empties the page.

Set `deckard.enableHeadingTagRelationships` to `false` when you want to hide Associated tags suggestions, including the sidebar list, while keeping ordinary tag indexing and note content unchanged.

## Query blocks

Put a Deckard query in a `deckard` code fence to keep a live list inside a note:

````markdown
```deckard sort=updated limit=10
tag = #project/atlas AND task = open
```
````

![A note's deckard query blocks beside the Markdown preview, which lists the tasks each query matches.](docs/images/query-blocks.png)

- The Markdown preview replaces the fence with what the query matches, notes first and then tasks. Each result is its own row: a title that links to its source line, and beneath it the headings above it and its file name. The file name is left out when the first heading already names it, as a daily note's date heading does. Tags written after a title are removed from it, while tags inside the sentence, such as the people in a task, are kept. Following a link behaves like any other link to a note, so `markdown.preview.openMarkdownLinks` decides whether it opens in the preview or the editor.
- Notes are listed alphabetically. Tasks are listed open first, soonest due date first, then in source order; completed tasks are struck through and overdue due dates are highlighted.
- After `deckard`, `sort=title`, `sort=created`, or `sort=updated` reorders both lists, and date sorts put the newest first. `limit=10` shows at most ten notes and ten tasks, while the header still reports the full totals.
- In the editor, the line above the fence shows the totals and **Open in overview**, which opens the same query in an overview where you can refine it.
- Results refresh when any note in the workspace changes, not only the note that holds the block.
- A query that does not parse shows its error in place of results. An unknown option is reported as a warning, and the rest of the block still runs.

The fence is ordinary Markdown, so other editors and Git show the query text itself. Like any fenced code, a query block is not indexed, so tags written in a query are not counted as tag uses. Tag completion does run inside a query block, so typing `#` or `@` there suggests indexed tags.

## AI assistants

Deckard gives AI assistants in VS Code two read-only tools through VS Code's language model tool API, so an assistant can answer questions about your notes from the index Deckard already keeps:

- **Search Deckard notes and tasks** (`deckard_query`, or `#deckardQuery` in a chat prompt) runs a [Deckard query](#advanced-filtering) and returns the matching note sections and tasks, each with its workspace-relative path, line, and headings. Tasks also show whether they are done, their due and scheduled dates, priority, and repeat rule. Asking "what are my open tasks for Atlas?" leads the assistant to run `tag = #project/atlas AND task = open`.
- **List Deckard tags** (`deckard_list_tags`, or `#deckardTags`) lists tags with how many entries use each, most used first, optionally narrowed by a search, so the assistant queries the exact tag rather than a guess.

A query returns at most 25 notes and 25 tasks unless the assistant asks for more, up to 200, and always reports the full totals. A query that does not parse returns its error with a short guide to the syntax, so the assistant can correct it and try again.

Any assistant that uses VS Code's language model tools can call them; in GitHub Copilot's agent mode they appear in the tools picker. An assistant that connects to tools only through MCP servers, rather than through VS Code, cannot see them.

Deckard itself sends nothing anywhere: the tools read the local index, and what they return goes to the assistant that asked, which may send it to its own model service. Set `deckard.assistantTools` to `false` to hide both tools. Each call is timed in [Deckard's log](#limitations-and-troubleshooting).

## Extracting headings

Run `Deckard: Extract Tagged Heading` with the cursor inside a tagged heading section. Deckard moves the complete section, including nested headings and the original heading tags, into a new Markdown note in the configured notes folder or workspace root. In the source note, the extracted heading and its content are replaced by a `[[link]]` to the new note, keeping the blank lines around it. If the cursor is not inside a tagged section, Deckard offers a picker of tagged headings from the workspace.

The note name is used as a single Markdown filename. Existing notes are never overwritten; choose a different name when a conflict is reported.

## Daily notes

Run `Deckard: Create Daily Note` from the Command Palette, or use the shortcut in Related Notes. Deckard creates a note named with the local date, such as `2026-08-30.md`, in your configured notes folder or workspace root and opens it. If today's note already exists, Deckard opens it without replacing its contents.

## Settings

Open **Settings** and search for `Deckard`, or add these options to your workspace settings:

```json
{
	"deckard.theme": "replicant",
	"deckard.dashboard.openOnStartup": false,
	"deckard.tagOverview.hubNoteExpanded": true,
	"deckard.notesFolder": "notes",
	"deckard.dailyNoteTemplate": "# {date}\n\n",
	"deckard.parseInlineTags": true,
	"deckard.outline.showTags": true,
	"deckard.outline.followCursor": true,
	"deckard.outline.inheritedTags": false,
	"deckard.agenda.upcomingDays": 7,
	"deckard.tasks.addDoneDate": true,
	"deckard.tasks.metadataFormat": "emoji",
	"deckard.tasks.metadataSuggestions": true,
	"deckard.board.statusNamespace": "status",
	"deckard.board.statuses": ["todo", "doing", "waiting"],
	"deckard.editor.referenceCounts": true,
	"deckard.editor.hoverPreviews": true,
	"deckard.assistantTools": true,
	"deckard.highlightNoteSections": true,
	"deckard.autoSelectNoteSections": true,
	"deckard.enableHeadingTagRelationships": true,
	"deckard.enableTagAutocomplete": true,
	"deckard.enableKeywordLinks": true,
	"deckard.relatedNotesAssociationMinimumSupport": 1,
	"deckard.relatedNotesRecencyHalfLifeDays": 0,
	"deckard.entityNamespaceAliases": {
		"org": "organization"
	},
	"deckard.personMarker": "@"
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `deckard.notesFolder` | Empty | Optional workspace-relative folder Deckard scans. An empty value indexes all workspace Markdown files. |
| `deckard.theme` | `replicant` | Selects the Replicant, Oblivion, or LCARS visual style for Deckard webviews. |
| `deckard.dashboard.openOnStartup` | `false` | Opens the Dashboard when VS Code starts in a workspace where Deckard has indexed notes. A Dashboard restored from the last session is left as it is. |
| `deckard.tagOverview.hubNoteExpanded` | `true` | Shows a tag's [hub note](#hub-notes) open at the top of its overview. Set it to `false` to start hubs collapsed to their title row. |
| `deckard.dailyNoteTemplate` | `# {date}\n\n` | Used when a new daily note is created. `{date}` becomes the local date in `YYYY-MM-DD` format. |
| `deckard.parseInlineTags` | `true` | Indexes tags on non-heading, non-task Markdown lines as standalone entries and decorates them in the editor. Consecutive tagged prose lines are grouped into one entry, while a tagged unordered or numbered list item includes its indented child bullets. Heading and task-line tags remain available when `false`. |
| `deckard.outline.showTags` | `true` | Shows each heading's own tags beside it in the Outline. Disable it for titles only. |
| `deckard.outline.followCursor` | `true` | Selects the Outline heading containing the editor cursor. The eye control in the Outline title switches the same setting. |
| `deckard.outline.inheritedTags` | `false` | Also shows the front-matter tags every heading in the file inherits, after the tags written on the heading itself. |
| `deckard.agenda.upcomingDays` | `7` | How many days ahead the Agenda's **Upcoming** group looks for due, scheduled, and start dates. |
| `deckard.tasks.addDoneDate` | `true` | Adds a completion date when Deckard completes a task, and removes it when the task is reopened. Disable it to change only the checkbox. |
| `deckard.tasks.metadataFormat` | `emoji` | The Tasks format Deckard writes for a task with no metadata yet: `emoji` (📅 2026-09-20) or `dataview` ([due:: 2026-09-20]). A task that already uses one keeps it. Deckard reads both either way. |
| `deckard.tasks.metadataSuggestions` | `true` | Suggests dates, priorities, repeat rules, and dependencies after typing `/` in a task. |
| `deckard.board.statusNamespace` | `status` | The tag namespace that holds a task's status on the task board, so the default reads `#status/doing`. |
| `deckard.board.statuses` | `["todo", "doing", "waiting"]` | The task board's status columns, in order. A status found on a task but not listed gets a column after them. |
| `deckard.editor.referenceCounts` | `true` | Shows backlink, heading-reference, and open-task counts above a note's lines. |
| `deckard.editor.hoverPreviews` | `true` | Previews a `[[Wiki link]]`'s target and summarizes a tag's entries on hover. |
| `deckard.assistantTools` | `true` | Lets AI assistants in VS Code, such as Copilot in agent mode, search notes and tasks with Deckard queries and list tags. See [AI assistants](#ai-assistants). |
| `deckard.highlightNoteSections` | `true` | Highlights tagged note sections in Markdown editors. Disable it to keep entry-level Related Notes cursor behavior without the editor highlight. |
| `deckard.autoSelectNoteSections` | `true` | Automatically focuses Related Notes on the tagged entry under the cursor. Disable it to keep Related Notes scoped to the whole document unless you choose an entry manually. |
| `deckard.tagTitleDisplayMode` | `inline` | Keeps tags in Related Notes, Tag Overview, and Dashboard note/task titles as clickable buttons by default. Set to `separate` to remove overview tags from titles and show them as separate tag controls. |
| `deckard.enableHeadingTagRelationships` | `true` | Shows **Associated tags** suggestions in Tag Overview, with Tree and Graph views. Disable it to hide those suggestions without changing indexed tags or note content. |
| `deckard.enableTagAutocomplete` | `true` | Shows indexed tag and people suggestions after a marker. Disable it without changing tag indexing, highlighting, or navigation. |
| `deckard.enableKeywordLinks` | `true` | Includes capped BM25-style lexical similarity scoped to each section or task. Disable it to show shared tags and intentional Wiki links only. |
| `deckard.relatedNotesAssociationMinimumSupport` | `1` | Minimum distinct headings, tagged lines, tasks, or heading relationships needed before a learned association affects Related Notes. Raise it to suppress one-off associations; `1` preserves intentional one-offs. |
| `deckard.relatedNotesRecencyHalfLifeDays` | `0` | Optional low-impact recency tie-breaker; `0` disables it. Deckard prefers front-matter and daily-note dates before filesystem timestamps. |
| `deckard.entityNamespaceAliases` | `{ "org": "organization" }` | Maps one `#namespace` to another. Targets can be built-in or custom; for example, `{ "proj": "project", "leadership": "management" }` treats `#proj/atlas` as a project and collapses `#leadership/performance` into `#management/performance`. Other namespaced tags become entities automatically without configuration. |
| `deckard.personMarker` | `@` | Selects the single punctuation character that identifies people. Set it to `~` to use `~mara-vale` for people and reserve `@inbox` for a lightweight tag. |

## Source safety and persistence

Markdown files remain the source of truth. Deckard changes note content only when you use a task checkbox, explicitly extract a tagged heading, or approve an entity tag from `Deckard: Link Current Heading to Entity`. Before applying a task edit, Deckard compares the complete source line and checkbox value with the indexed version. Completing a task also adds its ✅ date, and completing a repeating task inserts its next occurrence on the line above; both happen in that same checked edit. Before an extraction, Deckard verifies the source section is unchanged, then removes it only after the new note is created.

Deckard stores a workspace-scoped SQLite full-text cache locally for fast saved-note search. It does not send note content to an AI model or external service. Favorites, sorting choices, custom display order, access counts, and source/rendered view preference are stored separately in VS Code and do not add metadata to your notes.

## Limitations and troubleshooting

- **The Dashboard is empty:** make sure a workspace is open, its Markdown files are within the configured scope, and they use the Markdown patterns shown above.
- **Related Notes shows no results:** open a saved Markdown note containing a tag, then check that another saved note uses the same tag.
- **A task or section is missing:** confirm the task is an unordered checklist item, the heading is an ATX heading such as `## Heading`, and `deckard.parseInlineTags` is enabled for tagged non-heading lines.
- **A heading is missing from the Outline:** the Outline shows ATX headings only, so an underlined `Title`/`===` heading does not appear. Headings inside fenced code blocks are excluded on purpose.
- **Content in a code block appears ignored:** this is intentional. Fenced code is excluded from indexing, tag links, and completion.
- **A numeric hash is missing:** numeric-only `#` tokens are intentionally not tags. Use an `@` marker or include a non-numeric character.
- **Date sorting looks unexpected:** task and section dates come from source file creation and modification timestamps, not dates written in note content.
- **Deckard feels slow:** run `Deckard: Show Log`. Any step that takes 100 ms or longer is listed there as `Slow:` with how long it took and how much it covered, such as the number of notes. To see every timing, open the log's settings in the Output panel and set its level to **Debug**. Editing a note never waits on indexing: the index is rebuilt only after a save, the Related Notes sidebar ranks again only when the cursor moves to a different tagged entry, and hidden panels catch up when they are shown.

Deckard does not support ordered-list tasks or arbitrary checklist syntaxes, and it scans only Markdown files within the configured workspace scope.
