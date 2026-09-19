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
| [Dashboard](#dashboard) | Workspace totals, a Home of widgets you arrange, and every tag, with sorting, favorites, and saved searches. |
| [Search pages](#search-pages) | Opening a tag collects every note section and task that uses it, along with the tags it is most often written with. Any other search opens the same kind of page. |
| [Search](#search) | `Deckard: Search Notes` searches notes, tasks, and tags as you type. The same search, with a builder and counts to narrow by, runs on search pages, a tag's overview among them, and on the Task board. |
| [Query blocks](#query-blocks) | A `deckard` code fence keeps a live list of a query's results inside a note, drawn in the Markdown preview. |
| [Related Notes](#related-notes) | A sidebar ranks the notes most related to the one you are editing and explains each score. |
| [Notes Graph](#notes-graph) | An interactive map of every note, task, and tag connection in the workspace. |
| [Outline](#outline) | A sidebar tree of the current file's headings, with each heading's tags beside it. |
| [Agenda](#agenda) | Open tasks grouped into Overdue, Today, and Upcoming, which you can complete from their checkboxes. |
| [Task board](#task-board) | Your tasks as a Kanban board by status, priority, or due date, where dragging a card rewrites the task in its note, or as a ranked list. |
| [Task metadata](#task-metadata) | Due, scheduled, and start dates, priorities, repeat rules, and dependencies, written in either Obsidian Tasks format. |
| [AI assistants](#ai-assistants) | Assistants in VS Code, such as Copilot in agent mode, can search your notes and tasks with Deckard queries and list your tags. |
| [Editor assistance](#editor-assistance) | Clickable tags, completion after `#`, `@`, and `/`, backlink and task counts above headings, and previews when hovering links and tags. |
| [Tag renaming](#commands) | Renames a tag everywhere it is written without touching ordinary prose or fenced code. |
| [Wiki links](#markdown-format) | `[[Note]]` links complete note titles and aliases and open the note they name. |
| [Daily notes](#daily-notes) | One command creates or opens today's note from your template. |
| [Calendar](#calendar) | A month in the sidebar, marking days with a daily note or tasks due. |
| [Quick capture](#quick-capture) | Add a task to today's note from anywhere, with tag completion. |
| [Templates](#templates) | New notes from your own templates, with the date, title, and your answers filled in. |
| [Heading extraction](#extracting-headings) | Moves a tagged section, including its nested headings, into a note of its own. |
| [Stats](#stats) | Index totals, the notes nothing links to, and your most-viewed tags, entities, and notes. |
| [Themes](#themes) | Eight visual styles for Deckard's pages, from the plain default, Corpo, to Replicant, LCARS, and Synthwave. |
| [Local-first](#source-safety-and-persistence) | Your Markdown stays the source of truth, and the index never leaves your machine. |

## Requirements

- VS Code 1.134.0 or newer.
- An open folder or workspace containing Markdown notes.

Deckard scans every `*.md` file in each workspace folder by default. Set a notes folder only when you want to restrict the index.

## Install

Download the VSIX attached to a GitHub release and run `Extensions: Install from VSIX...` in VS Code.

## Themes

Set `deckard.theme` to choose the visual style used by Deckard webviews. The default is `corpo`, a plain style that takes its colors and fonts from your VS Code theme, light or dark, without the grid, glows, and uppercase readouts of the others. The rest are Deckard's film-inspired styles; `replicant` was the default before Corpo.

| **Corpo** | **Corpo, in a light VS Code theme** | |
| --- | --- | --- |
| <img src="docs/images/dashboard-corpo.png" alt="Corpo theme Dashboard in a dark VS Code theme." width="220"> | <img src="docs/images/dashboard-corpo-light.png" alt="Corpo theme Dashboard in a light VS Code theme." width="220"> | |
| **Replicant** | **Oblivion** | **LCARS** |
| <img src="docs/images/dashboard-replicant.png" alt="Replicant theme Dashboard." width="220"> | <img src="docs/images/dashboard-oblivion.png" alt="Oblivion theme Dashboard." width="220"> | <img src="docs/images/dashboard-lcars.png" alt="LCARS theme Dashboard." width="220"> |
| **Tomcat** | **Fellowship** | **Synthwave** |
| <img src="docs/images/dashboard-tomcat.png" alt="Tomcat theme Dashboard." width="220"> | <img src="docs/images/dashboard-fellowship.png" alt="Fellowship theme Dashboard." width="220"> | <img src="docs/images/dashboard-synthwave.png" alt="Synthwave theme Dashboard." width="220"> |
| **Cooper** | | |
| <img src="docs/images/dashboard-cooper.png" alt="Cooper theme Dashboard." width="220"> | | |

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
| **Deckard: Open Dashboard** | Opens workspace totals, Home, and tags. |
| **Deckard: Open Notes Graph** | Opens an interactive force-directed map of every note, task, and tag connection. |
| **Deckard: Open Task Board** | Opens tasks as a Kanban board grouped by status, priority, or due date. |
| **Deckard: Show Stats** | Opens index totals and local view-count statistics. |
| **Deckard: Open Help** | Opens the quick-start and advanced feature guide. |
| **Deckard: Show Log** | Opens Deckard's log, which records how long indexing, ranking, and editor features take. |
| **Deckard: Reindex Workspace** | Performs a full scan of the workspace Markdown scope. |
| **Deckard: Create Daily Note** | Creates or opens today's note. |
| **Deckard: Pin Note to Home** | Adds the note in the editor to Home's Pinned notes. **Deckard: Unpin Note from Home** removes it. |
| **Deckard: Open Previous Daily Note** | Opens the nearest daily note before the one in the editor, or before today. |
| **Deckard: Open Next Daily Note** | Opens the nearest daily note after the one in the editor, or after today. |
| **Deckard: Open Weekly Note** | Creates or opens this week's note, such as `2026-W37.md`. |
| **Deckard: Open Monthly Note** | Creates or opens this month's note, such as `2026-09.md`. |
| **Deckard: Capture** | Adds a task to today's note without leaving the current editor, completing tags as you type. |
| **Deckard: Capture Under a Heading** | Adds a task under a heading you choose in any note. |
| **Deckard: New Note from Template** | Creates a note from a template in your templates folder, asking for its title and anything the template asks. |
| **Deckard: Copy MCP Server Setup** | Copies the command that adds Deckard's [MCP server](#claude-code-and-other-mcp-clients) to Claude Code, offering to turn the server on first. |
| **Deckard: Reset MCP Server Token** | Makes a new MCP server token, so every copied setup stops working. |
| **Deckard: Extract Tagged Heading** | Moves a tagged heading section into a newly named note and leaves a `[[link]]` to it. |
| **Deckard: Open a Tag's Search Page** | Opens a tag's search page, or shows a tag picker when no tag is supplied. |
| **Deckard: Open Search Page** | Opens a search page listing every note, ready for a search. |
| **Deckard: Search Notes (find as you type)** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> elsewhere. Searches notes, tasks, tags, and saved searches as you type; see [Find](#find). |
| **Deckard: Search Notes and Tasks** | Opens a search page on a Deckard query, such as `(tag = #project/atlas AND task = open) OR text ~ "vendor"`. |
| **Deckard: Link Current Heading to Entity** | Adds a user-approved canonical person, project, topic, organization, or meeting tag to the current heading. |
| **Deckard: Move Inline Tags to Front Matter** | Moves explicit tags from the active note into merged note-level front matter. |
| **Deckard: Rename Tag** | Searches indexed tags and replaces the selected tag in its source notes. |
| **Deckard: Merge Tag…** | Merges one indexed tag into another that already exists, after showing what the merge will change. |
| **Deckard: Follow Cursor in Outline** | Selects the Outline heading containing the editor cursor. The Outline title has the same control. |
| **Deckard: Stop Following Cursor in Outline** | Leaves the Outline selection where you put it. |

## Markdown format

Deckard recognizes ATX headings, unordered checklist items, `#` tags, `@` people, and `[[Wiki links]]`. Tag matching is case-insensitive. A tagged non-heading, non-task line is indexed as its own entry when `deckard.parseInlineTags` is enabled; consecutive tagged prose lines are grouped so wrapped explanations do not become truncated duplicate entries.

A `[[link]]` names a note by its file name without `.md`, or by any name in the note's `aliases:` front matter, such as `aliases: [Atlas Program, AP]`. A name two notes share opens neither.

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

Run `Deckard: Rename Tag` to search the indexed tag list, choose a replacement, and update every matching source occurrence without changing ordinary prose or fenced code. Renaming to a tag that already exists merges the two; see [Merging tags](#merging-tags). On the Dashboard, a search page, or Related Notes, right-click a tag and choose **Rename tag**. In a Markdown editor, hover a tag and choose the clickable **Rename** action. Enter a complete tag such as `#management/new-name`, or enter only a new name to keep the selected tag's marker and namespace.

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
- A 📅 date wins over a date written in the sentence. Without one, Deckard still reads `2026-09-12`, `Sep 12`, or `next Friday` from the task text. `Sep 12` and `next Friday` count from the day the note is about: a daily note's date from its file name or top heading, else a `date:`, `created:`, or `updated:` front-matter date, and only then when the file was last saved. A ✅ date is never taken for a due date.
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

- Tags in Markdown editors receive clickable decorations. Cmd/Ctrl-click opens its page, and hovering a tag provides a separate clickable **Rename** action. Heading tags are always handled; tags on other lines follow `deckard.parseInlineTags`.
- Typing `#` or `@` offers matching tags already in the index, with each tag's current entry count. `#atl` can complete to `#project/atlas`; `@al` can complete to `@alex-smith`. Partial tag tokens are replaced correctly, fenced code is ignored except inside a `deckard` [query block](#query-blocks), and numeric-only hash tags are excluded from `#` completion.
- Typing `/` after a space in a task offers due dates, priorities, repeat rules, and dependencies. See [Typing metadata](#typing-metadata).
- **Reference counts** sit above a note's lines. The first line says **Linked from N notes** when other notes link to it, and each heading shows **N references** for links that name it, such as `[[Launch plan#Decision]]` or `[[#Decision]]`, and **N open tasks** for the open tasks beneath it. Select a count to list those links or tasks in VS Code's references peek. A tagged heading also shows **N entries share a tag**: the note sections, tasks, and front-matter-only notes elsewhere that carry one of the tags written on that heading. Tags inherited from a parent heading or the note's front matter do not count, and neither do entries in the same note. Select it to open [Related Notes](#related-notes) focused on the heading, which lists those entries along with weaker matches such as associated tags and shared keywords. Set `deckard.editor.referenceCounts` to `false` to hide them.
- **Hovering a `[[Wiki link]]`** previews the note, or the section its `#Heading` names, and says how many other notes link to it. A link to a note that does not exist yet, or to a name several notes share, says so instead.
- **Link problems** are marked in open notes. A `[[link]]` to a note that does not exist yet gets a **Create note** quick fix, which creates the note in your notes folder, and a name several notes share is a warning. `deckard.editor.linkDiagnostics` turns this off.
- **Hovering a tag** shows how many notes and tasks use it, its [hub note](#hub-notes) when it has one, and its five most recently updated entries, each a link to its line, with **Open overview**. Set `deckard.editor.hoverPreviews` to `false` to turn previews off. The tag's **Rename** action stays in the same hover.

![Reference counts above a note's lines: its backlinks, and each heading's references, open tasks, and the entries that share its tags.](docs/images/editor-assistance.png)

## Dashboard

Run `Deckard: Open Dashboard` to see compact workspace totals and switch between the **Home** and **Tags** tabs. The Dashboard opens on **Home**; use Left/Right Arrow while the tab control is focused to switch tabs. The Dashboard's tab and tag search are restored when you close and reopen it. Searches open [search pages](#search-pages), and tasks have their own page, the [Task board](#task-board).

![Deckard Dashboard showing workspace totals, saved searches, and active tasks.](docs/images/dashboard.png)

### Home

**Home** is made of widgets you choose:

| Widget | Shows | Leads to |
|---|---|---|
| **Search** | The [search box](#the-search-box); <kbd>Enter</kbd> opens a search page | The search page |
| **Tasks** | The first tasks a search finds, `is:open` unless you set another, ranked as on the Task board | The Task board, on that search |
| **Agenda** | Overdue, today's, and upcoming tasks | The Agenda view |
| **Favorite tags** | The tags you favorited, with what searching for each finds | The Tags tab |
| **Frequent tags** | The tags you open most, lately | The Tags tab |
| **Saved searches** | Your saved searches, each removable | Where each was saved |
| **Saved search results** | What one saved search finds | Its search page, or the Task board |
| **Recent searches** | The searches you ran lately | Their search pages |
| **Recently opened** | The notes you opened from Deckard lately | The notes |
| **Workspace** | Note, file, task, tag, and entity totals | The Stats page |
| **Today** | Today's daily note and its open tasks, or **Create today's note** | Today's note |
| **Quick add** | A field that adds an open task to today's daily note, creating the note if needed | — |
| **Stale tasks** | Open tasks in notes left unchanged for 7, 14, 30, or 90 days, oldest first | The Task board |
| **Related notes** | Notes related to the note you had open last, ranked as [Related Notes](#related-notes) ranks them | That note |
| **Tags written together** | The tag pairs written together most often, with how often and how much the rarer tag's entries overlap; a pair searches for both | The Tags tab |
| **Tags without a hub** | Tags used at least three times with no [hub note](#hub-notes), each with **Create hub** | The Tags tab |
| **New tags** | Tags first seen in the last 7, 14, 30, or 90 days, newest first, each with **Rename**, so a typo is caught early | The Tags tab |
| **Pinned notes** | Notes you pinned, each with **×** to unpin; **Pin** adds the note you had open last | The notes |

Pin the note in the editor with `Deckard: Pin Note to Home`, and unpin it with `Deckard: Unpin Note from Home`. A tag is new from the first time Deckard indexes it; the tags in use when Deckard first kept track are not new.

Choose **Customize** in the View options gear to arrange Home. Drag a widget to move it, or right-click it to move it first or last; switch it between half and full width; open its own gear to choose how many entries it lists, which search a tasks widget runs, which saved search a results widget shows, or how many days Stale tasks and New tags look back; remove it with **×**; and add more from **+ Add widget**. **Reset** restores the widgets Home started with, and **Done** finishes. Widgets side by side share their row's height. Home's arrangement is kept in VS Code's preferences, never in your notes.

### Tags

- **Tags** shows namespaced and unnamespaced tags together. Search tags, narrow them to one namespace, or to tags without one, with **Namespace**, where a person's `@` tag counts as **Person**, then sort alphabetically, by entry count, by most accessed, or by custom rank. Favorite important items; in Rank mode, drag a row or use its context menu to move it to the top or bottom. Wherever a namespaced tag is shown inline, its `#namespace/` prefix is muted while the tag value keeps the surrounding view's normal color.
- **Searches are kept** between visits. When a search is narrowing the Tags list, a line above the list says so, such as *Showing 3 of 42 tags matching “vendor”*, with **Clear search**, and the search box is outlined. A **Namespace** filter counts too, such as *Showing 12 of 90 tags, in Person*, and **Clear search** clears it along with the text. A dot on the **Tags** tab marks it while a search is narrowing it.
- **Saved searches** are listed below the tags. Select one to reopen it where it was saved, or use **Remove** to delete it.
- Use the View options gear to choose one through four tag columns.
- Select a tag to open its [page](#search-pages).
- Right-click any tag or entity row to choose **Rename tag**. When tags use custom rank, drag rows or right-click a row to move it to the top or bottom. Display order changes do not reorder text in your Markdown files.

## Stats

Run `Deckard: Show Stats` to see the current Markdown file, note entry, task, tag, namespaced entity, and Wiki-link totals from the index. It lists the notes nothing links to, leaving out daily, weekly, and monthly notes, which are found by their date; select one to open it. It also shows the most-viewed tags, namespaced entities, and note entries from Deckard's local access counters. These counters are collected when you open a tag's page or select a note entry on a search page, and are stored only in VS Code preferences. Select a most-viewed tag or canonical tag to open its page, or a note entry to open its note at that line.

![Deckard Stats showing index totals and the most-viewed tags, entities, and note entries.](docs/images/stats.png)

## Notes Graph

Run `Deckard: Open Notes Graph`, or select the graph icon next to the Dashboard icon in Related Notes, to see the whole workspace as a zoomable force-directed map. Notes and tasks appear as dots sized by connection count. The visual layout detects weighted communities from structural links and prevalence-adjusted tag evidence, then positions each community around a virtual anchor; hidden tag nodes no longer act as high-mass particles. Secondary tags and associations still provide lighter bridges without drawing a dense web between every pair of notes. The view starts zoomed out over the full graph and stays smooth with thousands of nodes.

![Deckard Notes Graph showing clustered note, task, and tag connections.](docs/images/notes-graph.png)

- Scroll to zoom toward the cursor, drag empty space to pan, and drag a dot to rearrange its cluster; **Fit** reframes the whole graph.
- Hover a dot to highlight its direct graph neighbors and see its source location. Select any note, task, or tag dot to list those connected nodes in the sidebar using the same note-card and tag styling as the rest of Deckard. Select the current node at the top of the sidebar to open its note/task source or tag page. Select a connected sidebar item to move the graph selection; Cmd/Ctrl-click it to open that item instead. Cmd/Ctrl-clicking a graph dot opens the same destination, and selecting empty space clears the selection.
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
- Select a heading to jump to its line. Right-click a heading that carries tags for **Open the Tag's Search Page** and **Rename Tag**.
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

Run `Deckard: Open Task Board`, or select the board icon in the Deckard sidebar's toolbar or in the Agenda's title, to see tasks as a Kanban board. Drag a card to another column to change the task in its note, or choose a column from the card's **⋯** menu, which also works from the keyboard. The **View options** gear in the page's corner switches between the board and a list, and edits the status columns.

![Deckard Task Board showing tasks in status columns that end with Done.](docs/images/task-board.png)

- **Status** gives each status tag written on a task line its own column, such as `#status/doing`. `deckard.board.statuses` sets the first columns and their order, `todo`, `doing`, and `waiting` by default; any other status found on a task gets a column after them, and tasks without one wait in **No status**. Dropping a card replaces its status tag, or removes it in **No status**. Set `deckard.board.statusNamespace` to use another namespace, such as `#stage/…`.
- **Priority** gives each priority a column. Dropping a card writes the new priority in the task's own format, such as ⏫ or `[priority:: high]`.
- **Due date** has columns for Overdue, Today, Tomorrow, Within a week, Later, and No due date. Drop a card on **Today** or **Tomorrow** to set its due date, or on **No due date** to remove it; the other columns cover a range of days, so they do not accept drops. A due date written in the task's sentence, such as `by Sep 16`, is left for you to edit.
- Every grouping ends with **Done**. Dropping a card there completes it, with its done date and next occurrence, and dragging it back out reopens it. Done shows the 20 most recently completed tasks.
- Search the tasks with the same [search box](#the-search-box) as search pages, such as `#project/atlas`, `priority >= high`, or plain words. **Refine** counts only tasks, and a search you run is added to your recent searches.
- **Save**, beside the search box, keeps the search as a saved search that reopens on the Task board.
- **List** shows the same tasks as rows, with **All**, **Open**, and **Done** counts and **Sort: Rank/Created/Updated**. In Rank, drag a row or right-click it to move it to the top or bottom; date sorting uses the source file's timestamps. The status grouping switch sits under the search box while the board is shown, and the sort while the list is.
- **Status columns** in the gear lists the status columns in order. Drag a column's row to reorder it, or right-click it to move it first or last; add one, remove one with its **×**, and set the tag namespace a status is written with. Deckard saves these to `deckard.board.statuses` and `deckard.board.statusNamespace`, in the workspace's settings when it already sets them and in your user settings otherwise.
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
| Entry Wiki link | An entry links to `[[Launch plan#Decision]]` | Small supporting evidence |
| Shared wording | Both entries use distinctive section wording | Adjusts the score of an entry that qualifies another way; never makes an entry related on its own |

For example, if you select `#project/atlas #follow-up`, a note with both tags ranks ahead of a note that only contains an associated `#risk/vendor` tag. Associations retain their raw source evidence but are normalized for support and tag prevalence before diminishing returns are applied, so generic tags cannot dominate and indirect connections cannot overtake a complete direct match.

On the **Debug related notes** page, a **source unit** is one distinct tagged heading, tagged line, task, or heading relationship where Deckard can observe a tag; it is not necessarily a whole file. **Raw evidence** is the starting strength of an association, while **normalized relevance** adjusts that strength for repeated support and how common each tag is. **BM25 lexical similarity** (also written **BM-25**) is a capped search-style text match that gives more weight to distinctive shared words than to common words.

For the complete source-unit model, formulas, worked examples, configuration details, and external references, see the [Related Notes association and ranking reference](docs/related-notes-associations.md).

### Focus one note entry

Tagged headings highlight their full section; tagged lines and tasks highlight their line. Hover one to choose **Show related notes for [entry]**. The sidebar identifies the scope as a **Selected entry**, shows the source note, and uses that entry's tags first before adding tagged parent headings as lighter context. When the selected entry is a heading, tagged descendant child headings and tagged child items are also added as lighter context. Parent and child heading context decay by distance; child items use an additional level of decay, and the strongest occurrence wins when a tag appears more than once. The active tags are listed one per row, each with a segmented **Rail** marker for its contribution and a count of the notes and tasks carrying it; hover or focus a tag to see its exact Related Notes weight and that count split into notes and tasks. Choose **Show whole document** in the sidebar to return to the normal document view.

Each result shows its compact heading path and a concise primary reason for the match. Daily notes also show their inferred `YYYY-MM-DD` date, making a result such as `2026-09-10 > Project Atlas > Check-in` understandable before opening it. When both a broad heading and a nested child use the same tags, the child appears first because it is the more specific match. The Related Notes list includes its result count and shows 50 results at a time; **Show more** adds the next 50. The **Sort by** control keeps the selected ordering visible.

### Understand a score

Select a result percentage to open its explanation with the matching signals and weights; it also works from the keyboard. For the complete calculation, hover a tagged entry and choose **Debug related notes for [entry]**. The debug page shows whether each selected tag came from the entry, parent ancestry, a child heading, or a child item, along with heading paths, daily-note context, raw and normalized association support/prevalence, entry and file link evidence, lexical terms, optional recency, and specificity adjustments.

Use the sort control to choose **Relevance**, **Newest**, **Oldest**, or **Most accessed**. Select a related note to open its matching line, or select a tag to open its page.

Each result also carries a link button, beside its score, which writes a `[[Note#Heading]]` link to that entry at the cursor of the note you are editing, replacing the selection when there is one. The link names the heading the entry was written under, without its tags, and names the note alone when the heading only repeats the note's title. A tagged line or task is linked through the heading above it, since a link cannot name a line. When two notes share the name the link has to use, Deckard writes it and says which notes it could mean, because renaming one of them is the only way to make it resolve.

### Refine a search from the sidebar

While a [search page](#search-pages) or the Task board is the active editor, Related Notes shows that search's [Refine](#refine) options instead of related notes, so the page keeps its height for its results. It lists only the ways the results could be narrowed; the page keeps its search, terms, and counts, and terms are removed in its search box. Related tags are listed strongest first, each with a three-step rail, as Related Notes draws a tag's weight, showing its strength beside the strongest; hover one to see how often the tags were written together or shared a heading.

- Select a value to add it to the search.
- <kbd>Alt</kbd>-select it to leave those results out instead.
- <kbd>Shift</kbd>-select it to allow it beside the value of the same kind already chosen.
- Select the open icon beside a related tag to open that tag's page in a new tab.

The page shows a single Refine line while the sidebar holds its options, and its full Refine box again when you close the sidebar. Returning to a Markdown editor brings related notes back.

## Search pages

Every search opens a **search page** in its own editor tab, and a tag's overview is the search page for that one tag. Open one by Cmd/Ctrl-clicking a tag in the editor, selecting a tag on the Dashboard, in Related Notes, or anywhere else Deckard shows one, running a search from Home, [Find](#find), or `Deckard: Search Notes and Tasks (write a query)`, or running `Deckard: Open a Tag's Search Page` or `Deckard: Open Search Page`. Opening a search a page already shows brings that page forward rather than opening another.

![Deckard Tag Overview showing matching notes, active tasks, and display controls.](docs/images/tag-overview.png)

- **One tag is its overview.** A search of exactly one tag shows the tag, or the entity it names, as the page's title, and the [hub note](#hub-notes) that describes it above its entries. The hub's own entries are not listed again below it.
- **Anything more is a search.** Add another tag, words, or a condition such as `is:open`, and the page becomes an ordinary search: its [search box](#the-search-box) and **Builder** show everything it is filtering by, and the title says **Search**. **Clear** returns the page to the tag it opened with.
- **Refine** narrows the results. On a page of one tag, or of several tags joined by AND, it offers related **Tags** first, strongest first, with a three-step rail for each one's strength; select one to add it to the search.
- Notes and Tasks are two tabs, or side by side; the Tasks list opens on **Open** tasks and has an **All**/**Open**/**Done** filter, with checkboxes that update the original Markdown task.
- Sort notes alphabetically, by creation date, by update date, or by most accessed, on the line under the search box.
- A broad search is shown a page at a time, with **Previous**, **Next**, and the page numbers under each list, and the range it is showing, such as *271–300 of 3,760*. Notes and tasks are paged separately. **Per page** chooses 10, 30, 50, 100, or 200 results to a page; it starts at 30 and is remembered, so every search page opens the way you left the last one. The counts beside Notes and Tasks, the Refine counts, and the filtering you do by typing in the search box are all of the whole search, never of the page. Changing the search, the page size, or the Open/Done filter returns to the first page, and a search that shortens while its last page is open moves you back to the last page it still has.
- The **View options** gear chooses **Tabs** or **Side by side**, the original Markdown source or a rendered view, and one through four columns for notes and for tasks.
- **Save** keeps the search as a saved search. A search of two or more tags is saved as that set of tags, and follows them when they are renamed; the saved search's name appears above the title whenever the page's search matches it.
- Select a note entry to jump to its heading in the source note.

Opening a tag's page records tag access. Opening a section records section access, which powers the access sort. A page that a search was saved from before search pages existed, or a tag overview left open, reopens as a search page with the same tag, tags, and words.

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
- An overview with no hub offers **Create hub note**, which writes one to the notes folder and opens it. An existing note is never overwritten. When the templates folder has a template named after the tag's namespace, such as `project.md`, the new hub starts from it; see [Templates](#templates).
- When several notes describe one tag, the first by path leads the overview and the others are listed beneath it.
- Hovering the tag in the editor names its hub note, and renaming the tag updates `describes:` too.
- Filtered and query views leave the hub out, so they show only their results.
- Select the hub's title row to collapse or expand it; the overview remembers your choice until it closes. `deckard.tagOverview.hubNoteExpanded` sets whether hubs start open, which they do by default.

### Merging tags

Rename a tag to one that already exists, or run `Deckard: Merge Tag…` and pick the tag to keep, to merge the two. Deckard first shows how many entries each tag has, how many carry both, and how many the kept tag will have, and asks before changing anything, because renaming back later cannot separate them again.

- Where the kept tag already sits beside the old one on a heading or task line, or in the same front-matter list, the old tag is removed rather than repeated. Inside a sentence it is replaced, so the sentence still reads.
- Favorites, access counts, Dashboard tag selections, and saved searches move to the kept tag. A plain rename moves them too.

Set `deckard.enableHeadingTagRelationships` to `false` to refine by the tags the results carry instead of by related tags, while keeping ordinary tag indexing and note content unchanged.

## Search

Deckard has one search language everywhere: `Deckard: Search Notes` for getting to something quickly, and the search box on [search pages](#search-pages), Home, and the Task board for seeing everything a search finds.

### Find

Run `Deckard: Search Notes`, or press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> on Windows and Linux), and start typing. Results appear as you type.

![Deckard Find listing the notes titled Meridian first, then the tags that match, then notes that mention the word.](docs/images/find.png)

- Plain words are searched in every note section, task, and front-matter-only note. An entry titled with your words comes first, then titles that contain every word or match them loosely, such as `vcon` for *Vendor contract*, then entries whose text mentions them, ranked by relevance. The last word matches while you are still typing it.
- `#tags`, `@people`, and the rest of the [query language](#query-language), such as `is:open` or `in:notes/work`, narrow the results exactly as they would anywhere else.
- A word also finds tags by their last part, so `atlas` offers `#project/atlas`, and a value finds its condition, so `overd` offers `is:overdue`. <kbd>Tab</kbd> completes the highlighted tag or condition into the search, as does the **+** button beside a tag.
- <kbd>Enter</kbd> opens the note or task at its line, a tag's page, or a saved search. **Show all results**, or the list button in the title bar, opens the search on a search page.
- When no note has every word, Find says so and shows the notes with some of them. A misspelled word gets a **Search for … instead** row with the closest word your notes contain.
- With nothing typed, Find offers your recent searches, favorite and recently opened tags, saved searches, and the notes you opened last. A recent search has a button to save it as a view.

Ties are broken by how often and how recently you opened something, so a note you opened yesterday comes before one you opened often last year. This is kept in VS Code's preferences, beside the access counts, and never in your notes.

### The search box

Search pages, Home's search widget, and the Task board have the same search box. Press <kbd>/</kbd> anywhere on the page to type in it. The Task board's box searches tasks alone.

![A search page searching #project/meridian-vault is:open, with each term as a chip, Refine counts, and the matching tasks.](docs/images/notes-search.png)

- The box is a field of chips, as a multi-select is. Each term of the search, whether a tag, a condition such as `is:open`, or words, which show as the `text ~` condition they run, is a chip with a **×**, joined to the next by **AND**; a search whose top level is an OR is one chip. Tags are drawn in blue, and a tag left out with `-` in red. Type the next term in the field after the chips.
- Plain words narrow the search as you type, across everything it found rather than the page of it on screen, so a match on the last page is found from the first. The counts, the pages, and Refine all follow. <kbd>Enter</kbd> adds the words to the search itself, which makes them chips, remembers the search, and lets you save it; until then they are a draft, and leaving the box lets them go.
- Completions appear as you type: field names, the values a field accepts once the caret is in one, tags, whole conditions such as `is:open`, and, in an empty box, your recent searches. Nothing is preselected, so <kbd>Enter</kbd> always runs what you typed; <kbd>Tab</kbd> completes, arrow keys move through the list, and <kbd>Escape</kbd> abandons the edit.
- Choosing a tag, a condition, or a field's value from the completions makes it a chip at once. Pressing a chip removes its term and keeps the rest as you wrote it, and <kbd>Backspace</kbd> in an empty field removes the last chip.
- Text you typed and did not add is let go when the box loses focus, unless you move to its own buttons, such as **Search**.
- **AND**, **OR**, and **NOT** are drawn in their own color. Two tags written side by side are joined with AND, and Refine adds its values with AND.
- On a tag's page the box holds the tag as a chip, so everything the page filters by is in one place.
- A parse error is reported under the box; the chips and results keep the last search that ran, and the field keeps what you typed so you can fix it.
- A search page that finds nothing offers a closer spelling, as Find does: **Nothing matched. Search for … instead?** replaces each misspelled word with the closest word your notes contain and leaves the rest of the search as you wrote it, so a tag or a folder is never corrected into something else. It is offered only when the corrected search finds something.
- **Save**, beside the box, stores the search under a name. Saved searches appear on Home and the Tags tab, reopen where they were saved, and survive tags being renamed or removed from the index.

**Builder**, under the search box, edits the same search as OR groups of AND rows. **Add condition** starts a row from its value: type a tag, a word, or a value such as `open`, and choose a completion or press <kbd>Enter</kbd>, and the row fills in its field and operator. <kbd>Enter</kbd> then opens the next row, <kbd>Backspace</kbd> in an empty row removes it, and <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>Cmd</kbd>+<kbd>Enter</kbd> on macOS) starts a new OR group. A finished row keeps its field, operator, and value dropdowns for editing. The operator list shows the operators themselves — `=`, `!=`, `~`, `!~`, `>`, `>=`, `<`, `<=` — with their meaning on hover, so there is no separate negate control to disagree with a row, and a hand-written `NOT tag = #a` opens in the builder as `tag != #a`. The search box remains the source of truth, so a condition the builder cannot represent, such as a negated group, is shown as read-only text rather than rewritten.

### Refine

Under the search box, **Refine** counts what the results could still be narrowed by: open and done tasks, due dates (overdue, the next seven days, later, or none), the tags the results carry, when notes were last updated, and the folders they are in. Each value shows how many of the current results it keeps, and a value that would keep all of them, or none, is not offered.

- Select a value to add it to the search.
- <kbd>Alt</kbd>-select it to leave those results out instead.
- <kbd>Shift</kbd>-select a second value of the same kind to allow either, such as open *or* done tasks.

Every value adds ordinary query text, so a refined search can be saved, copied into a query block, or edited in the builder. A search of one tag, or of several tags joined by AND, lists related **Tags** instead of counting the tags the results carry, since associations are ranked better than a count can be: strongest first, with a three-step rail showing each one's strength beside the strongest, and kept even when every result carries them, since they still say how the tags relate. While the Related Notes sidebar is open beside the page, Refine is [shown there](#refine-a-search-from-the-sidebar).

### Query language

A Deckard query is what you type into Find, the search box, a [query block](#query-blocks), or an [AI assistant](#ai-assistants):

```
(tag = #project/atlas AND tag = @ren-kade) OR (tag = #risk/vendor AND text ~ "elevator")
```

Terms combine with `AND`, `OR`, `NOT`, and parentheses. `AND` binds tighter than `OR`, adjacent terms are joined by an implicit `AND`, and `-` or `!` in front of a term negates it. A bare `#tag` or `@person` is a tag condition and a bare or quoted word is a text condition, so `#project/atlas "vendor risk"` is a complete query.

Common filters have one-token shorthands, written the way GitHub writes them:

| Shorthand | Finds |
| --- | --- |
| `is:open`, `is:done` | Open or completed tasks. |
| `is:overdue` | Open tasks past their due date. |
| `is:due` | Open tasks due within the next seven days, overdue ones included. |
| `is:task`, `is:note` | Every task, or note sections without tasks. |
| `is:blocked`, `is:blocking` | Open tasks waiting for a task that is still open, and the open tasks they wait for. |
| `has:due`, `no:due` | Tasks with, or without, a due date. `scheduled`, `start`, `done`, `priority`, `id`, and `dependsOn` work the same way. |
| `in:notes/work` | Everything in a folder and the folders inside it. `*` and `?` are wildcards. |

Put `-` in front of a shorthand to negate it, as in `-is:done`. Deckard keeps a shorthand as you wrote it when it saves or formats a query.

`is:blocked` and `is:blocking` read the ⛔ and 🆔 markers as the edges between two open tasks: a task is blocked while a task it names in ⛔ is still open, and blocking while an open task names its 🆔. Completing the blocker frees both, so neither lists a task whose other end is done, and a ⛔ naming nothing in the workspace blocks nothing. `has:dependsOn` and `has:id` read the markers themselves whatever state the tasks are in.

The fields:

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

A note's created date is its `created:` or `date:` front matter. Without either, a daily note counts as created on its day, or earlier if its file is older, and any other note on its file's creation time. Its updated date is its `updated:` front matter, or its file's modified time. A git clone resets every file's times, so the dates a note states come first.

Operators are `=` for is, `!=` for is not, `~` for contains, `!~` for does not contain, and `>`, `>=`, `<`, `<=` for dates and priorities. A window such as `7d` is compared by its far end: `updated > 7d` means updated within the last seven days, and `due < 7d` means due within the next seven days, overdue tasks included. `:` is accepted everywhere `=` is, so queries written with `tag:#atlas` keep working, but Deckard writes `=` when it formats a query back. A comparison can follow the operator, so `updated:>2026-01-01` and `updated > 2026-01-01` mean the same thing. Every operator has an opposite, so any single condition can be negated without `NOT`; `NOT` is for negating a whole parenthesized group.

While a search page is the active editor, the Related Notes sidebar shows that search's **Refine** options in place of related notes, headed by the search's own title, and returns to related notes when a Markdown note is active again. A search naming exactly one tag keeps that tag's association suggestions.

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
- In the editor, the line above the fence shows the totals and **Open in search**, which opens the same query on a search page, where you can refine it.
- Results refresh when any note in the workspace changes, not only the note that holds the block.
- A query that does not parse shows its error in place of results. An unknown option is reported as a warning, and the rest of the block still runs.

The fence is ordinary Markdown, so other editors and Git show the query text itself. Like any fenced code, a query block is not indexed, so tags written in a query are not counted as tag uses. Tag completion does run inside a query block, so typing `#` or `@` there suggests indexed tags.

## AI assistants

Deckard gives AI assistants in VS Code two read-only tools through VS Code's language model tool API, so an assistant can answer questions about your notes from the index Deckard already keeps:

- **Search Deckard notes and tasks** (`deckard_query`, or `#deckardQuery` in a chat prompt) runs a [Deckard query](#query-language) and returns the matching note sections and tasks, each with its workspace-relative path, line, and headings. Tasks also show whether they are done, their due and scheduled dates, priority, and repeat rule. Asking "what are my open tasks for Atlas?" leads the assistant to run `tag = #project/atlas AND task = open`.
- **List Deckard tags** (`deckard_list_tags`, or `#deckardTags`) lists tags with how many entries use each, most used first, optionally narrowed by a search, so the assistant queries the exact tag rather than a guess.

A query returns at most 25 notes and 25 tasks unless the assistant asks for more, up to 200, and always reports the full totals. A query that does not parse returns its error with a short guide to the syntax, so the assistant can correct it and try again.

Any assistant that uses VS Code's language model tools can call them; in GitHub Copilot's agent mode they appear in the tools picker. An assistant that connects to tools only through MCP servers, rather than through VS Code, cannot see them.

Deckard itself sends nothing anywhere: the tools read the local index, and what they return goes to the assistant that asked, which may send it to its own model service. So the first time an assistant calls one of the tools in a session, VS Code asks you to allow it, saying that your notes will go to the assistant; later calls in that session go ahead. Set `deckard.assistantTools` to `false` to hide both tools. Each call is timed in [Deckard's log](#limitations-and-troubleshooting).

### Claude Code and other MCP clients

Deckard can offer the same two tools to Claude Code and other Model Context Protocol clients. Set `deckard.mcpServer.enabled` to `true`, or run `Deckard: Copy MCP Server Setup`, which offers to turn the server on and copies the command that adds Deckard to Claude Code:

```bash
claude mcp add --transport http deckard http://127.0.0.1:39217/mcp --header "Authorization: Bearer <token>"
```

- The server listens on `127.0.0.1` only, at `deckard.mcpServer.port`, so nothing off this computer can reach it.
- Every request must carry the server's token, which Deckard keeps in VS Code's secret storage. `Deckard: Reset MCP Server Token` makes a new one, and every copied setup stops working.
- Requests from web pages on other sites are refused, token or not, so a page open in a browser cannot read your notes through the server.
- As with the tools in VS Code, Deckard sends nothing anywhere itself: what a tool returns goes to the client that asked, which may send it to its own model service. The server is off by default.

## Extracting headings

Run `Deckard: Extract Tagged Heading` with the cursor inside a tagged heading section. Deckard moves the complete section, including nested headings and the original heading tags, into a new Markdown note in the configured notes folder or workspace root. In the source note, the extracted heading and its content are replaced by a `[[link]]` to the new note, keeping the blank lines around it. If the cursor is not inside a tagged section, Deckard offers a picker of tagged headings from the workspace.

The note name is used as a single Markdown filename. Existing notes are never overwritten; choose a different name when a conflict is reported.

## Daily notes

Run `Deckard: Create Daily Note` from the Command Palette, or use the shortcut in Related Notes. Deckard creates a note named with the local date, such as `2026-08-30.md`, in your configured notes folder or workspace root and opens it. If today's note already exists, Deckard opens it without replacing its contents.

`Deckard: Open Previous Daily Note` and `Deckard: Open Next Daily Note` step to the nearest daily note before or after the one in the editor, skipping days without a note. From any other note they start from today.

`Deckard: Open Weekly Note` and `Deckard: Open Monthly Note` create or open the note for this week, named for its ISO week such as `2026-W37.md`, or for this month, such as `2026-09.md`. Each has its own template, `deckard.weeklyNoteTemplate` and `deckard.monthlyNoteTemplate`, which can use `{week}`, `{month}`, and `{date}`: a week's Monday, or a month's first day.

## Calendar

The **Calendar** view in the Deckard sidebar shows a month of ISO weeks, Monday first. A dot marks a day with a daily note, and a number counts the open tasks due that day, in orange once the day has passed. Select a day to open its daily note, a week number to open that week's note, or the month's name to open the month's note. When the note does not exist yet, Deckard offers to create it from its template rather than creating it straight away. The arrows step through months, and **Today** returns to this month.

## Quick capture

Run `Deckard: Capture` and type a task. Deckard adds it as `- [ ] …` to today's daily note, creating the note from your template if needed, and leaves you in the editor you were using. Typing `#` or `@` suggests tags, most used first: choose one to complete the word, and press Enter on the task itself to add it. The list button in the capture box, or `Deckard: Capture Under a Heading`, adds the task under a heading you pick from any note instead.

A capture goes after the last list item already there, or after a blank line below the last text. A note open in an editor keeps its unsaved changes, and the note is saved.

## Templates

Put Markdown files in a `templates` folder at the root of your workspace, or the folder `deckard.templatesFolder` names, and run `Deckard: New Note from Template`. Deckard asks which template to use and the new note's title, then creates the note in your notes folder and opens it. Deckard never indexes the templates folder, so a template's tags and tasks stay out of your notes.

| Placeholder | Becomes |
| --- | --- |
| `{title}` | The title you enter, which is also the file name. |
| `{date}` | Today's date, such as `2026-09-13`. |
| `{time}` | The current time, such as `09:05`. |
| `{ask:Question}` | Your answer when Deckard asks the question. A question used twice is asked once. |

Anything else in braces is left as written.

A template named after a tag namespace, such as `person.md` or `project.md`, starts every new [hub note](#hub-notes) for a tag in that namespace. It can also use `{tag}`, and Deckard adds the `describes:` front matter unless the template writes its own.

## Settings

Open **Settings** and search for `Deckard`, or add these options to your workspace settings:

```json
{
	"deckard.theme": "corpo",
	"deckard.dashboard.openOnStartup": false,
	"deckard.tagOverview.hubNoteExpanded": true,
	"deckard.notesFolder": "notes",
	"deckard.exclude": {
		"**/archive": true
	},
	"deckard.dailyNoteTemplate": "# {date}\n\n",
	"deckard.weeklyNoteTemplate": "# {week}\n\n",
	"deckard.monthlyNoteTemplate": "# {month}\n\n",
	"deckard.templatesFolder": "templates",
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
	"deckard.editor.linkDiagnostics": true,
	"deckard.assistantTools": true,
	"deckard.mcpServer.enabled": false,
	"deckard.mcpServer.port": 39217,
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
| `deckard.exclude` | `{}` | Glob patterns of files and folders Deckard leaves out of its index, written like VS Code's `files.exclude`. Each pattern is relative to the workspace folder and applies when set to `true`, and a pattern that matches a folder leaves out everything in it. For example, `{ "**/archive": true, "drafts/*.md": true }`. Deckard also leaves out what `files.exclude` hides. |
| `deckard.theme` | `corpo` | Selects the visual style for Deckard webviews: `corpo`, which follows your VS Code theme, or one of `replicant`, `oblivion`, `lcars`, `synthwave`, `tomcat`, `fellowship`, and `cooper`. |
| `deckard.dashboard.openOnStartup` | `false` | Opens the Dashboard when VS Code starts in a workspace where Deckard has indexed notes. A Dashboard restored from the last session is left as it is. |
| `deckard.tagOverview.hubNoteExpanded` | `true` | Shows a tag's [hub note](#hub-notes) open at the top of its overview. Set it to `false` to start hubs collapsed to their title row. |
| `deckard.dailyNoteTemplate` | `# {date}\n\n` | Used when a new daily note is created. `{date}` becomes the local date in `YYYY-MM-DD` format. |
| `deckard.weeklyNoteTemplate` | `# {week}\n\n` | Used when a new weekly note is created. `{week}` becomes the ISO week, such as `2026-W37`, and `{date}` its Monday. |
| `deckard.monthlyNoteTemplate` | `# {month}\n\n` | Used when a new monthly note is created. `{month}` becomes the month, such as `2026-09`, and `{date}` its first day. |
| `deckard.templatesFolder` | `templates` | The folder of [note templates](#templates), relative to the workspace folder. Deckard does not index it. Leave it empty to turn templates off. |
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
| `deckard.editor.linkDiagnostics` | `true` | Marks a `[[Wiki link]]` that opens no note and offers to create a missing one. |
| `deckard.assistantTools` | `true` | Lets AI assistants in VS Code, such as Copilot in agent mode, search notes and tasks with Deckard queries and list tags, after you allow the first call in each session. See [AI assistants](#ai-assistants). |
| `deckard.mcpServer.enabled` | `false` | Runs a Model Context Protocol server on 127.0.0.1 with the same tools, for Claude Code and other MCP clients that carry its token. See [Claude Code and other MCP clients](#claude-code-and-other-mcp-clients). |
| `deckard.mcpServer.port` | `39217` | The port the MCP server listens on, on 127.0.0.1. |
| `deckard.highlightNoteSections` | `true` | Highlights tagged note sections in Markdown editors. Disable it to keep entry-level Related Notes cursor behavior without the editor highlight. |
| `deckard.autoSelectNoteSections` | `true` | Automatically focuses Related Notes on the tagged entry under the cursor. Disable it to keep Related Notes scoped to the whole document unless you choose an entry manually. |
| `deckard.tagTitleDisplayMode` | `inline` | Keeps tags in Related Notes, search page, and Dashboard note/task titles as clickable buttons by default. Set to `separate` to remove tags from titles and show them as separate tag controls. |
| `deckard.enableHeadingTagRelationships` | `true` | Offers related **Tags** in a tag search's Refine, ranked by association. Disable it to refine by the tags the results carry instead, without changing indexed tags or note content. |
| `deckard.enableTagAutocomplete` | `true` | Shows indexed tag and people suggestions after a marker. Disable it without changing tag indexing, highlighting, or navigation. |
| `deckard.enableKeywordLinks` | `true` | Lets capped BM25-style similarity of each section's or task's wording adjust the score of an entry that already shares a tag, association, or Wiki link. Shared wording never makes an entry related on its own. Disable it to rank by tags and links alone. |
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
- **Deckard feels slow:** run `Deckard: Show Log`. Any step that takes 100 ms or longer is listed there as `Slow:` with how long it took and how much it covered, such as the number of notes. To see every timing, open the log's settings in the Output panel and set its level to **Debug**. Editing a note never waits on indexing: the index is rebuilt only after a save, the Related Notes sidebar ranks again only when the cursor moves to a different tagged entry, and hidden panels catch up when they are shown. The search cache is written on a thread of its own, so the first build in a new workspace does not hold VS Code up; while it runs, a search finds a note by its title and tags before it finds it by the words inside it, and the log records the build as `Write search index off the extension host`.

Deckard does not support ordered-list tasks or arbitrary checklist syntaxes, and it scans only Markdown files within the configured workspace scope.

## License

Deckard is released under the [MIT License](LICENSE).
