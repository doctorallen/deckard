# Changelog

## Unreleased

### Added

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

- Webview styling and page-script helpers are now shared from
  `src/ui/webview/components.ts` instead of being repeated per page, so one
  change reaches every panel. See [components.md](components.md). Pages
  previously carried their own copies that had drifted apart: the eyebrow
  label had five different treatments, borders were 1px on some pages and 2px
  on others, and half the pages declared only part of the design-token set.
  They now share one palette, one type scale, one set of controls, and one
  `.segmented` primitive for joined buttons.

### Fixed

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
