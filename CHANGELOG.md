# Changelog

## Unreleased

### Added

- **Quick capture**: `Deckard: Capture` adds a task to today's daily note
  without leaving the current editor. Typing `#` or `@` suggests tags, most
  used first. `Deckard: Capture Under a Heading`, or the list button in the
  capture box, adds it under a heading you pick in any note instead. A note
  open in an editor keeps its unsaved changes.

- **Templates**: `Deckard: New Note from Template` creates a note from a
  Markdown file in the templates folder (`deckard.templatesFolder`,
  `templates` by default), filling in `{title}`, `{date}`, `{time}`, and an
  answer for each `{ask:Question}`. Deckard does not index the templates
  folder, so a template's tags and tasks stay out of your notes.

### Changed

- A note's created and updated dates, used by the `created` and `updated`
  query fields and the Created and Updated sorts, now come from the note
  before its file. `created:`, `date:`, and `updated:` front matter win, and a
  daily note counts as created on its day, or earlier if its file is older.
  A git clone resets every file's times, so these dates used to be the day of
  the clone.

## 1.9.0 - 2026-09-13

### Added

- Deckard is released under the MIT License, now included with the extension.

- **AI assistant tools**: Deckard registers two read-only language model
  tools, so AI assistants in VS Code, such as GitHub Copilot in agent mode,
  can answer questions about your notes. `deckard_query` runs a Deckard query
  and returns matching note sections and tasks with their paths, lines,
  headings, dates, and priorities; `deckard_list_tags` lists tags, most used
  first, so an assistant can find the exact tag to query. A query that does
  not parse returns its error with a guide to the syntax. Deckard sends
  nothing anywhere itself, and `deckard.assistantTools` hides both tools.

- **Timing log**: `Deckard: Show Log` opens Deckard's log, which records how
  long scanning, building the index, ranking Related Notes, drawing panels,
  and each editor feature take, with how many notes or lines each covered.
  Anything that takes 100 ms or longer is written as `Slow:` at the default
  level; set the log to Debug in the Output panel to see every timing. It
  works in an installed extension, so a slow machine can be diagnosed without
  a debugger. The Related Notes sidebar's own messages moved into it at Trace
  level.

- **Hub notes**: a note whose front matter says `describes: project/atlas`
  leads that tag's overview, with its other front-matter fields shown as
  properties whose tag values open their own overviews. An overview without
  one offers **Create hub note**, and hovering the tag names its hub. The hub
  collapses to its title row, and `deckard.tagOverview.hubNoteExpanded` sets
  whether it starts open.

- **Merge tags**: renaming a tag to one that already exists, or running
  `Deckard: Merge Tag…`, now asks first, showing each tag's entries, how many
  carry both, and the merged total. Where the kept tag already sits beside the
  old one on a line or in the same front-matter list, the old tag is removed
  rather than repeated.

- **Open the Dashboard on startup**: `deckard.dashboard.openOnStartup` opens
  the Dashboard when VS Code starts in a workspace with indexed notes.

- **References and previews in the editor**: counts above a note's lines say
  how many notes link to it, how many links name each heading, and how many
  open tasks sit under each heading; selecting one lists them in VS Code's
  references peek. A tagged heading also shows how many entries in other
  notes share one of the tags written on it, and selecting that count opens
  Related Notes on the heading. Hovering a `[[Wiki link]]` previews the note or section it
  points at, and hovering a tag shows its note and task counts and its most
  recent entries. `deckard.editor.referenceCounts` and
  `deckard.editor.hoverPreviews` turn them off.

- **Task board**: `Deckard: Open Task Board`, also a board icon in the
  Deckard sidebar's toolbar and in the Agenda's title, shows tasks as a Kanban board grouped by status tag (such
  as `#status/doing`), priority, or due date, always ending with Done.
  Dragging a card to another column, or choosing one from its **⋯** menu,
  rewrites the task line: its status tag, its priority in the task's
  own format, or its due date for Today, Tomorrow, and No due date. Dropping
  a card on Done completes it and dragging it out reopens it. A Deckard query
  narrows the board, and `deckard.board.statuses` and
  `deckard.board.statusNamespace` choose the status columns. The Dashboard's
  **View options** can show its Tasks tab as the same board, drawn by one
  shared component and filtered by the tab's own filters and search.

- **Obsidian Tasks metadata**: tasks written in the Obsidian Tasks emoji
  format keep their due (📅), scheduled (⏳), start (🛫), and done (✅) dates,
  priorities (🔺 ⏫ 🔼 🔽 ⏬), repeat rules (🔁), and dependencies (🆔 ⛔).
  The markers leave task titles and appear as details on Dashboard cards and
  in query blocks, and a ✅ date is no longer mistaken for a due date.
  Completing a task adds its ✅ date and reopening removes it, which
  `deckard.tasks.addDoneDate` can turn off. Completing a repeating task writes
  its next occurrence on the line above. Queries gain `due`, `scheduled`,
  `start`, `done`, and `priority` fields, with `none` for a missing date.
  Tasks written in the plugin's text-only Dataview format, such as
  `[due:: 2026-09-20] [priority:: high]`, are read the same way, and Deckard
  writes dates in whichever format a task already uses;
  `deckard.tasks.metadataFormat` picks one for tasks without metadata.
  Typing `/` in a task suggests dates, priorities, repeat rules, and
  dependencies to insert, which `deckard.tasks.metadataSuggestions` can turn
  off.

- **Agenda**: a new **Agenda** view in the Deckard sidebar groups open tasks
  into Overdue, Today, and Upcoming, badges the count of tasks overdue or due
  today, and completes a task from its checkbox.
  `deckard.agenda.upcomingDays` sets how far ahead Upcoming looks.

- **Query blocks**: a `deckard` code fence holding a Deckard query now shows
  its results in the Markdown preview, so a note can keep a live list of the
  notes and tasks it cares about. Each result links to its source line, tasks
  are listed open first and soonest due first, and `sort=` and `limit=` after
  the fence language order and shorten the lists. Above the fence in the
  editor, Deckard shows the totals and an **Open in overview** action. Results
  refresh when any note changes, and a query that does not parse reports its
  error in place of results. Typing `#` or `@` inside the block suggests
  indexed tags, although Deckard otherwise ignores fenced code.

- **Outline**: a new **Outline** view beside Related Notes lists the active
  Markdown file's headings as a tree, and can be dragged into either the
  primary or the secondary sidebar like VS Code's own Outline. Heading markers
  and tags are removed from each title and the heading's own tags are shown
  beside it, so structure and labels read as two columns. Untagged headings are
  kept as structure, a heading written as nothing but tags shows those tags as
  its title, headings inside fenced code blocks are ignored, and a numeric hash
  such as `Sprint #3` stays in the title. The tree is built from editor text,
  so it follows the file as you type rather than waiting for a save. Selecting
  a heading jumps to its line, right-clicking a tagged heading offers **Open
  Tag Overview** and **Rename Tag**, and the eye control in the view title
  switches whether the Outline follows the cursor. `deckard.outline.showTags`,
  `deckard.outline.followCursor`, and `deckard.outline.inheritedTags` control
  what it shows.

- **Advanced filtering in Entity Overview**: the overview page now carries a
  Deckard query behind an **Advanced search** control, so a view is no longer limited to
  one intersection of tags. A query combines conditions with `AND`, `OR`,
  `NOT`, and parentheses — for example
  `(tag = #project/atlas AND tag = @ren-kade) OR (tag = #risk/vendor AND text ~ "elevator")`.
  Conditions can match `tag`, `text`, `task`, `kind`, `file`, `path`,
  `created`, and `updated`; a bare `#tag` or `@person` is a tag condition and a
  bare or quoted word is a text condition. Equality is written `=`, with `:` still accepted as a synonym. The query bar
  and each builder row's value field complete field names and the values that
  field accepts, and a visual builder edits the same query as OR groups of
  AND rows. Selecting a tag and adding a related tag from the sidebar is
  unchanged: those views still show their original tag chips, and a query that
  is only a tag intersection reopens as that ordinary overview. `Deckard:
  Search Notes and Tasks` opens a standalone query view, and **Save filter**
  now saves a query as well as a tag set.

- **Notes Graph**: `Deckard: Open Notes Graph` (also available from a graph
  icon beside the Dashboard icon in Related Notes) opens a zoomable
  force-directed map of every indexed note, task, and tag connection, with
  Obsidian-style Filters, Display, and Forces panels, hover neighbor
  highlighting, click-to-select, sidebar-hover graph highlighting, and
  Cmd/Ctrl-click-through to source lines and tag overviews. Tag nodes are
  rendered as separated virtual anchors. Notes and tasks are assigned to
  deterministic visual communities from structural and prevalence-adjusted tag
  evidence, while secondary tags remain lighter cross-community bridges. Notes
  and tasks can be independently hidden from
  the Filters panel. While the graph tab is active, the sidebar lists direct
  connected notes, tasks, and tags using shared sidebar card styles; Markdown
  editors retain the existing Related Notes ranking. The selected-node header
  opens that node's note/task source or tag overview directly. The graph also
  exposes connection density, tag prevalence bias, secondary bridge strength,
  and an all-links comparison toggle for experimenting with the
  prevalence-aware local backbone, plus visual community detection with
  virtual tag anchors, cluster cohesion and community spacing controls, and a
  Reset graph settings button that restores defaults, clears filters, and
  reframes the view.
- Release preparation now derives semantic versions from Conventional Commit
  messages.

### Changed

- Deckard's settings are grouped into titled sections in the Settings editor:
  General, Tags and People, Editor, Related Notes, Tasks, Outline, and AI
  Assistants, each listed in a deliberate order rather than alphabetically.

- The Related Notes view is named **Related Notes** in the Deckard side bar.
  It was named Deckard, so its header repeated the side bar's own title.

- The AI assistant tools ask before their first call in each session. VS Code
  shows a confirmation saying that matching notes will go to the assistant,
  which may send them to its model service, and later calls in the session go
  ahead.

- **Related Notes** lists only entries that share a tag, an associated tag,
  or a Wiki link with the note. Shared wording still ranks those entries, but
  it no longer makes an entry related on its own, which had listed nearly
  every entry in a workspace, such as 356 of the sample notes' 482. The list
  shows 50 results at a time, with **Show more** for the rest, and ranking no
  longer scores the wording of every entry to decide what qualifies.

- The Stats page's most-viewed tags, canonical tags, and note entries now
  open when selected, with the mouse or with Enter or Space: a tag opens its
  overview, and a note entry opens its note at that line. Tags are drawn with
  their namespace dimmed, and rows shift on hover, as on the Dashboard.

- **Extract Tagged Heading** now leaves a `[[link]]` to the new note where the
  section was, instead of removing the section without a trace.

- Webview styling and page-script helpers are now shared from
  `src/ui/webview/components.ts` instead of being repeated per page, so one
  change reaches every panel. See [components.md](docs/components.md). Pages
  previously carried their own copies that had drifted apart: the eyebrow
  label had five different treatments, borders were 1px on some pages and 2px
  on others, and half the pages declared only part of the design-token set.
  They now share one palette, one type scale, one set of controls, and one
  `.segmented` primitive for joined buttons.

### Fixed

- Starting VS Code, reindexing, or changing a setting that rescans the notes no
  longer rewrites the whole search cache. Only notes that changed since the
  cache was written are updated, and deleted notes are removed. At 5,000
  notes an unchanged rescan now takes 29 ms of search-cache work instead of
  most of a second.

- Saving a note no longer reads every note in the search cache to find its old
  text. At 5,000 notes a save's search-cache work now takes about 0.6 ms
  instead of 13 to 40 ms. The cache's layout changed, so the first start after
  updating rebuilds it once, in under a second at 5,000 notes.

- A visible Dashboard no longer sends its page every note after each save.
  The Tasks and Tags tabs are sent no notes, and the Notes tab is sent each
  note's rendered HTML only in the HTML view. With 940 notes, an update
  shrinks from 24 MB to 1.9 MB on the Tasks tab and 9.9 MB on the Notes tab.
  The page was also sent every indexed section, which it never read.

- Opening Related Notes on an entry from its count or its hover works in a
  note with unsaved changes. The entry was looked up by its line in the saved
  note, so after lines were added above it Deckard asked to save first. It is
  now found by its title, and among entries sharing a title by their order.

- Loose task dates such as `next Friday` or `Sep 16` count from the day the
  note is about: a daily note's date from its file name or top heading, else a
  `date:`, `created:`, or `updated:` front-matter date. They used to count from
  when the file was last modified, so editing an old daily note or cloning the
  notes moved every such date in it.

- The packaged extension holds only what it runs: the bundle, its resources,
  the README, and the changelog. It no longer carries the screenshots and
  planning docs, the test and script folders, or local folders such as
  `.claude/`, which had made a local package 250 files instead of 13.

- Typing in a note no longer slows down in a large workspace. Every cursor
  move rebuilt the whole index several times and ranked Related Notes again,
  about a second of work per keystroke with 940 notes, even with the sidebar
  closed. The index is now built once per change to the notes and shared; the
  sidebar ranks again only when the cursor reaches a different tagged entry,
  and not while it is hidden; tag decorations wait for typing to pause; query
  block results are kept until the index changes; and ranking tokenizes the
  workspace once per index instead of on every call. After a save, hidden
  panels wait until they are shown, preference pruning no longer makes every
  panel draw twice, and the Dashboard sorts its cards without building a
  collator per comparison.

- Renaming a tag now moves its favorites, access counts, Dashboard tag
  selections, and saved views to the new name instead of leaving them on the
  old one.

- The Dashboard's task and tag searches no longer lose focus or drop letters
  while you type, in the list and board layouts alike. Every keystroke used
  to be stored at once, and the state that came back redrew the page: focus
  left the field, and a query a few letters old could replace newer typing.
  The page now filters as you type, stores the query once typing pauses, and
  keeps the field's focus and caret through every redraw.

- A relative date window compared with `>`, `>=`, `<`, or `<=` now uses the
  window's far end. `updated > 7d` previously matched nothing, because it was
  compared with the end of today instead of the start of the seven days.

- The Dashboard's index metrics are a horizontal three-up strip again, and its
  chamfered tiles, 1180px width and dashed header rule are back. Sharing the
  webview styles had replaced page layout wherever a page's selector matched a
  base one, which also flattened Help's two-column layout and widened the
  sidebar's padding. Each page now restates its own layout, and
  `npm run test:ui` checks those survive the cascade.

- Tag rows in the Dashboard's Tags tab now highlight their border on hover,
  matching notes, tasks, entities and saved views. They were the only row type
  without the treatment. Every openable row now shares one `.row` component,
  and `npm run test:ui` fails if a new one ships without it.

- The Related Notes sidebar now follows an advanced query. It previously kept
  projecting the tag the page was opened on, so applying a query left the
  sidebar showing stale notes.

- The advanced filter's completion list no longer preselects an entry, so
  pressing Enter in the query bar runs the query that was typed instead of
  silently accepting a completion. Tab still completes.
- A query that does not parse now reports its error while the page keeps
  showing the results of the last query that did, instead of emptying.
- Choosing a completion with the mouse applies it. Pressing the mouse on the
  list no longer moves focus out of the field, which previously committed the
  row and rebuilt it before the click could land.
- Editing a query no longer opens a second overview. A query that narrows to
  an intersection led by the page's own tag returns to its chips in place.

- Entity titles and namespace labels in the Dashboard and Entity Overview
  webviews are capitalized again. The word-boundary escape in their title
  formatter was consumed by the surrounding template literal, so
  `#project/skybridge-signal` rendered as `project: skybridge signal`.
