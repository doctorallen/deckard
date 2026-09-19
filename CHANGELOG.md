# Changelog

## Unreleased

### Changed

- **A search page carries a batch of a broad search rather than all of it.**
  A search that matched the workspace used to send, and draw, every note and
  task on every save: about 4.3 MB of card text at 940 notes, growing with
  the workspace, for the screenful anyone reads. A page now carries 200 of
  each, about 0.54 MB whatever the workspace holds, and **Show more** asks
  for the next batch. Every count on the page is still of the whole search.

### Added

- **Related Notes writes a link to a result**. The button beside a result's
  score puts a `[[Note#Heading]]` link to that entry at the cursor of the note
  you are editing. It names the heading the entry sits under, without its
  tags, names the note alone when the heading only repeats the note's title,
  and says so when two notes share the name it has to write.

- **A search page that finds nothing offers a closer spelling**, which until
  now only Find did: **Nothing matched. Search for … instead?** Each
  misspelled word is replaced by the closest word the notes contain, and only
  the words a search reads as prose are corrected, so a tag, a path, or a
  field name spelled the same way is left exactly as it was written. The
  correction has to find something itself before it is offered.

- **Task dependencies are queryable**. `is:blocked` finds an open task while a
  task it names in ⛔ is still open, and `is:blocking` the open task the other
  one waits for, so the Agenda's `blocked by …` line can now be searched for
  across the workspace. Completing the blocker frees both. `has:id` and
  `has:dependsOn`, with `no:` for either, read the 🆔 and ⛔ markers themselves
  whatever state the tasks at their ends are in.

- **More Home widgets**:
  - **Today**: today's daily note and its open tasks, or a button to create it.
  - **Quick add**: a field that adds an open task to today's daily note.
  - **Stale tasks**: open tasks in notes left unchanged for 7 to 90 days.
  - **Related notes**: notes related to the note you had open last, ranked as
    Related Notes ranks them.
  - **Tags written together**: the tag pairs written together most often,
    with how much they overlap, to spot a missing hub note or one idea under
    two names. A pair opens a search for both.
  - **Tags without a hub**: tags used at least three times that have no hub
    note, each with **Create hub**.
  - **New tags**: tags first seen in the last 7 to 90 days, each with
    **Rename**, to catch a typo such as `#projet/atlas` early. Tags already in
    use when you update are not new.
  - **Pinned notes**: notes you pin with `Deckard: Pin Note to Home`, or with
    **Pin** for the note you had open last; **×** unpins one.

### Fixed

- A row on Home reads while the pointer is over it. A row is a button as well
  as a row, and each was colored by its own rule: the row rule raised the
  ground and the button rule wrote the text for a ground it never had, so a
  Favorite tags, Frequent tags, or Recently opened row went all but black on
  black. Cooper showed it worst; LCARS, Synthwave, Tomcat, and Fellowship had
  it too, and LCARS also at rest.

- A Stats tile you can open reads on LCARS, where it had taken the near-black
  its controls are written for onto the tile's own panel.

- The Favorite heart, a card's **Move** menu on the Task Board, a saved
  search's **Remove**, a widget's **All tags**, and a search facet's mode read
  on whatever ground the theme in use gives them, at rest and while hovered.
  No theme colors the heart apart from the toggle carrying it now, so a hover
  cannot strand it.

- Fellowship's muted text is a little darker, so the smaller print on its
  parchment panels reads.

## 1.14.0 - 2026-09-17

### Added

- **Search pages**: every search opens a page in its own editor tab, and a
  tag's overview is the page for that one tag. A search of exactly one tag
  shows the tag or entity as its title and its hub note above its entries;
  anything more, such as a second tag, words, or `is:open`, makes it an
  ordinary search, shown by its search box and builder alone, and **Clear**
  returns it to the tag it opened with. Each page has the full search box,
  **Refine**, Notes and Tasks tabs or side by side, sorting, **Save**, and a
  gear for layout, rendering, and note and task columns. Opening a search a
  page already shows brings that page forward. `Deckard: Open Search Page`
  opens one on every note, and `Deckard: Search Notes and Tasks`, **Show all**
  in Find, a query block's **Open in search**, and saved searches open here.

- **Home**: the Dashboard opens on a page of widgets you choose: a search box,
  the tasks a search finds, the Agenda, favorite and frequent tags, saved
  searches and their results, recent searches, recently opened notes, and
  workspace totals, each linking to where its entries live. **Customize** in
  the gear lets you drag widgets into order, set each to half or full width,
  choose how many entries it lists and which search a tasks widget runs,
  remove widgets, add more, and reset to the start. Widgets in a row share its
  height.

- **Related tags in Refine**: a search of one tag, or of several joined by AND,
  is refined under **Tags** by the tags associated with them, strongest
  first, each with the three-step rail Related Notes draws a tag's weight
  with, showing its strength beside the strongest, in place of a count of the
  tags on the results.

- **Refine in the sidebar**: while a search page or the Task Board is the
  active editor, Related Notes shows its Refine options, and only those, so
  the page keeps its height for results. Selecting a value adds it to the
  search, and a related tag's open icon opens its page in a new tab. A
  **Refine** heading with these instructions leads the view; the page shows
  one Refine line until the sidebar is closed.

- **A note's tags as rows**: Related Notes lists the tags it ranks by one per
  row, as Refine lists related tags, each with its rail and a count of the
  notes and tasks carrying it.

- **The search box is a field of chips**: each term of the search, a tag, a
  condition, or words, is a chip with a remove icon inside the box, joined by
  AND, in place of the row of terms under it. Tags are blue and left-out tags
  red, and AND, OR, and NOT have their own color. A chosen completion becomes
  a chip at once, Enter adds what was typed, Backspace in an empty field
  removes the last chip, and text not added is let go when the box loses
  focus. Two tags side by side, and Refine values, are joined with AND.

- **Save on the Task Board**: **Save**, beside its search box, keeps the search
  as a saved view that reopens on the Task Board.

### Changed

- The Dashboard's tabs are **Home** and **Tags**. It no longer has a
  **Tasks** tab, since tasks have the **Task Board**, or a **Search** tab,
  since searches open search pages; one left on either reopens on Home.
  Saved searches are listed on the Tags tab and in Home's widgets.

- The Related Notes sidebar no longer lists a tag overview's associated tags
  and matching notes, or shows association strength as a percentage, which
  could pass 100%; the tags are offered in Refine, with a strength rail.

- The Task Board searches with the same search box as search pages, in place of its query field: completions, the builder, removable
  terms, and **Refine**, counting tasks alone. Plain words hide cards as they
  are typed, and a search that does not parse keeps the board as it was.

- The Task Board has a **View options** gear, like the Dashboard's. It
  switches between the board and a list, which has **All**, **Open**, and
  **Done** counts, **Sort: Rank/Created/Updated**, and ranking by drag or by
  right-click, as the Dashboard's Tasks tab had. The gear also edits the
  status columns, which you drag into order, and their tag namespace, saving
  them to `deckard.board.statuses` and `deckard.board.statusNamespace`.

### Fixed

- **Clear** in a tag overview's search box does something: it returns the page
  to its own tag, dropping tags added to it and words typed after them. It
  used to clear only the words, and stayed enabled with nothing to clear.

- A tag suggested in a search box, or in Find, says how many notes and tasks
  searching for it finds, such as *2 notes · 3 tasks*, rather than a count of
  entries that could disagree with the search.

- A tag overview's **View options** gear looks like the Dashboard's. The Corpo
  theme drew it as a button, with a blue border.

- The Dashboard keeps a search of plain words as soon as typing settles,
  whatever the words. Its check for plain words split the search on the
  letter `s` rather than on spaces, so a search of several words, or of a
  word with an `s` in it, waited for Enter.

## 1.13.0 - 2026-09-16

### Changed

- A tag overview and the Dashboard's **Search** tab are laid out the same way:
  **Save** sits beside Search and Clear in the bar, **Sort** sits under it, and
  both pages list their results under **Notes** and **Tasks** tabs. The tag
  overview's title and its tag are no longer underlined.

### Fixed

- A tag overview shows its hub note again. The page's tags moved into its
  search box, and text in the box was read as narrowing the page, which hides
  the hub; only a search typed beyond the tags counts now.

- A tag overview lists the same entries as the same search run from the
  Dashboard. It listed only the entries that write its tag, while a search
  answers with the headings that carry it as well.

- A tag overview reopened from a previous session reads its tags back out of
  the search it saved, rather than narrowing the page by them a second time.

## 1.12.0 - 2026-09-16

### Added

- **Corpo theme**: a plain style that takes its colors and fonts from your
  VS Code theme, light or dark. It leaves out the grid, glows, clipped
  corners, and uppercase readouts of Deckard's other themes, and its buttons,
  fields, and links look like VS Code's own.

### Changed

- A tag overview writes its own tags in its search box rather than holding
  them apart from it. The page reads as the search it is: its tags can be
  edited or dropped there like any other term, adding one from the sidebar
  writes it into the box, and the entries, hub note, and chips are unchanged.

- Choosing a recent search runs it, instead of only filling the search box.

- The builder opens with an empty row to type in even when the search already
  has conditions, such as a page's tags.

- A tag reads as it was written wherever it appears, in every theme: a theme
  that shouts its controls no longer shouts the tags inside them, and a tag in
  a heading no longer inherits the heading's case. A tag beside a title is
  drawn as a hairline with no fill, so a boxed tag means a control that
  changes what is listed.

- **Oblivion** is redrawn after the film's light-table screens: a near-black
  ground ruled with faint teal graph paper, pages framed by corner brackets
  rather than filled panels, wide letter-spaced headings, and an orange rule
  under the live tab or filter in place of a filled block. Its palette is the
  screens' own: cyan-teal for the data, warm sand in the readouts, and
  red-orange kept for alerts.

- A search term chip is removed by clicking anywhere on it, not only on its
  cross, and it lights up under the pointer like the other controls.

- The mark on a Dashboard tab whose search has text is a filter icon rather
  than a dot, and the **Search** tab keeps its mark while another tab is open.

- Corpo is the default theme, in place of Replicant. To keep the previous
  look, set `deckard.theme` to `replicant`.

- The tags chosen on the Dashboard's Tasks tab sit in a dashed box headed
  **Tags**, like **Refine** on the Search tab, with **Clear filters** at its
  right.


  and a dot marks each tab whose search has text. A **Namespace** filter on
  the Tags tab counts as a search: it gets the same line and dot, and
  **Clear search** clears it too.

### Fixed

- A search term in the search bar sits in one box: VS Code styles every
  `<code>` element with a background and rounded corners, which drew a second
  box inside each chip, and a term now keeps the case it was typed in.

- The mark on a chosen tab in the Oblivion theme is the filter icon itself
  rather than the icon inside a filled orange block.

- Pages in the Corpo theme paint their own background, so a view VS Code gives
  no backdrop of its own, such as a tag overview, no longer renders blank.

- A **Refine** chip's text lines up with the group label beside it, rather
  than sitting a few pixels above it.

- A hovered tag in the Cooper and Synthwave themes keeps its light hover
  background, so its dark text no longer disappears into a dark panel.

- In the Cooper theme, the gold glow no longer repeats in bands down a panel
  taller than its content, such as the Related Notes sidebar.

- A person's `@` tag, such as `@ren-kade`, shows as a **person** in the
  Dashboard's Tags tab, and the **Namespace** filter's **Person** lists it
  with the `#person/` tags, rather than under **None**.

- Task titles on the task board, on the Dashboard and in **Deckard: Task
  Board**, show their Markdown rendered, as the task list does, rather than
  as raw `**bold**` and `[links](...)`.

## 1.11.0 - 2026-09-15

### Added

- **Leave files out of the index**: `deckard.exclude` takes glob patterns
  written like VS Code's `files.exclude`, such as `{ "**/archive": true }`,
  and Deckard does not index the files and folders they match. Deckard also
  leaves out what `files.exclude` hides when a note there is saved or
  created, not only when the workspace is reindexed. Changing either setting
  reindexes the workspace.

- **Filter tags by namespace**: the Dashboard's Tags tab has a **Namespace**
  filter again, listing each namespace in use and **None** for tags without
  one. It works together with tag search and is kept while the Dashboard is
  open.

- **Find**: `Deckard: Find` (<kbd>Cmd/Ctrl+Shift+Alt+F</kbd>) searches notes,
  tasks, tags, and saved views as you type. Titles come first, then notes
  that mention your words, ranked by relevance; the last word matches while
  it is typed, `atlas` finds `#project/atlas`, and Tab completes a tag or
  condition. A misspelled word gets a correction, and an empty search offers
  recent searches, favorite and recent tags, saved views, and recently
  opened notes. It replaces `Deckard: Search Workspace Knowledge`, and keeps
  its command, so existing keybindings still work.

- **Shorthands**: `is:open`, `is:done`, `is:overdue`, `is:due`, `is:task`,
  `is:note`, `has:due` and `no:due` (also `scheduled`, `start`, `done`, and
  `priority`), and `in:folder` work in every query, including query blocks
  and AI assistant queries.

- **The Search tab**: the Dashboard's Notes tab is now **Search**, Deckard's
  search page. It has the full search box, with completions, the builder,
  **Refine** counts, the tasks the search matches, and **Save** beside
  the box. Its tag picker is gone, since tags are typed in the search or
  chosen under **Refine**. `Deckard: Search Notes and Tasks`, **Show all** in
  Find, a query block's **Open in search**, and saved searches open there.

- **Refine**: under the search box, counts of open and done tasks, due
  dates, tags, update dates, and folders in the results. Select one to
  narrow, Alt-select to leave it out, or Shift-select to allow another value
  of the same kind.

- **Faster builder**: a new row starts from its value. Type a tag, a word,
  or a value such as `open` and the row fills in its field and operator;
  Enter opens the next row, Backspace removes an empty one, and Ctrl/Cmd+
  Enter starts an OR group.

### Changed

- The Dashboard's **Saved tag views** are now **Saved searches**, since they
  hold saved searches as well as saved tag sets.

- A Dashboard search kept from an earlier visit is no longer easy to miss.
  When one is narrowing the Tasks or Tags list, a line above the list says
  how many items match, with **Clear search**, the search box is outlined,
  and a dot marks each tab whose search has text.

- The search box is always shown in a tag overview, in place of the
  **Advanced search** button and the separate notes and tasks search fields.
  It narrows the tag's own entries, a whole `#tag` typed in it joins the
  tags in the title, and `/` puts the caret in it. Each term of a longer
  search is a chip that can be removed on its own.

- Full-text search ranks each note section and task by relevance, weighting
  titles, headings, and tags above body text, and requires every word rather
  than any. The search cache is rebuilt once, on the first start after an
  update.

## 1.10.0 - 2026-09-14

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
  folder, so a template's tags and tasks stay out of your notes. A template
  named after a tag namespace, such as `person.md`, starts new hub notes for
  that namespace, with `{tag}` filled in and the `describes:` front matter
  added.

- **Aliases**: a note's `aliases:` front matter, or `alias:`, gives it other
  names. `[[links]]` that use one open the note, count toward its references,
  link it in the Notes Graph and Related Notes, and link completion offers
  them. As with titles, a name two notes share opens neither.

- **Link problems**: a `[[link]]` that opens no note is marked in open notes.
  A link to a note that does not exist yet gets a **Create note** quick fix,
  which creates it in the notes folder, and a name several notes share is a
  warning. `deckard.editor.linkDiagnostics` turns this off.

- **Unlinked notes** in Stats: the page counts and lists the notes no other
  note links to, leaving out daily, weekly, and monthly notes, which are found
  by their date. Select one to open it.

- **Previous and next daily notes**: `Deckard: Open Previous Daily Note` and
  `Deckard: Open Next Daily Note` step to the nearest daily note before or
  after the one in the editor, skipping days without a note, or from today
  when the editor is on another note.

- **Weekly and monthly notes**: `Deckard: Open Weekly Note` and `Deckard:
  Open Monthly Note` create or open the note for this ISO week, such as
  `2026-W37.md`, or this month, such as `2026-09.md`, from their own templates,
  `deckard.weeklyNoteTemplate` and `deckard.monthlyNoteTemplate`. Templates
  can use `{week}`, `{month}`, and `{date}`.

- **Calendar**: a Calendar view in the Deckard sidebar shows a month of ISO
  weeks. A dot marks each day with a daily note, and a number counts the open
  tasks due that day, in orange once it has passed. Selecting a day, a week
  number, or the month's name opens its note, and a note that does not exist
  yet is offered for creation from its template.

- **MCP server**: with `deckard.mcpServer.enabled`, Deckard runs a Model
  Context Protocol server on this computer, so Claude Code and other MCP
  clients get the same query and tag tools Copilot has. It listens on
  127.0.0.1 only, answers only requests that carry its token, and refuses
  requests from web pages on other sites. `Deckard: Copy MCP Server Setup`
  copies the command that adds it to Claude Code, and `Deckard: Reset MCP
  Server Token` retires every copied setup. It is off by default.

- **Cooper theme**: set `deckard.theme` to `cooper` for a spare
  mission-control look after Interstellar: a starfield with Gargantua's gold at
  its edge, warm white readouts, thin letter-spaced headings, and outlined
  instrument buttons.

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
