# Changelog

## Unreleased

### Added

- **Pages, and Go to….** The Deckard sidebar opens with **Pages**: Home,
  the Task Board, the Calendar, today's note, the Notes Graph, Find, Stats,
  and Help, each a labeled row with a glyph of its own and a word on what is
  there now, such as *3 tasks due today*. `Deckard: Go to…`
  (Cmd/Ctrl+Shift+Alt+P) lists the same pages from anywhere, and
  **DECKARD ▾** at the top of every page drops them as a menu, with Go to…
  at its foot. The six icons that crowded the Context view's title bar are
  gone.

- **The note page looks like the other pages.** Its header is laid out as
  theirs: DECKARD ▾ and the title at the left, Back, Forward, Open in
  Editor, Help, and a gear with Theme and Zen at the right. It takes the
  same width and title style as every other page.

- **Images on the note page.** The note page draws a note's images,
  `![alt](img/flow.png)` and `![[flow.png]]`, at the page's width, and
  shows one at full size when selected. Each is read from beside the note
  or the workspace folder's top and sent to the page itself, so nothing is
  fetched from the web or outside the workspace folder; one that cannot be
  drawn says why.

- **Editor presets.** `Deckard: Choose Editor Preset…` picks what Deckard
  draws in the editor in one choice: **Full**, as now; **Tasks**, task hints
  and problem reports without link counts, mention lenses, or breadcrumbs;
  or **Writing**, a quiet page with the / menu, hover previews, and problem
  reports. Any `deckard.editor.*` switch you set yourself still wins.

- **Daily notes where you keep them.** `deckard.periodicNotes.folder` puts
  new daily, weekly, and monthly notes in a folder inside the notes folder,
  such as `journal/{yyyy}`; notes already elsewhere are still found.
  `deckard.weeklyNote.naming` set to `iso` names weekly notes `2026-W38`.
  A template setting may name a file in the templates folder, such as
  `Daily.md`, rather than hold the text. The / menu offers **Time** and
  **Time (UTC)** for a log, and the guide says whose clock a day follows on
  a remote host.

- **A work sample.** `Deckard: Create a Work Sample` writes a week of a
  team lead's notes: standups, two 1:1s, a project hub with a live list of
  what is open, and two decision records linked from the notes that made
  them. Its README starts with the five things Deckard reads and gives keys
  for every platform. Get Started and an empty Home offer it; the sci-fi
  tour is still there as `Deckard: Create the Story Tour`.

- **Say who a task is for as you write it.** Capture reads `for @dana` at
  the end, or `@dana to …` at the start, as who the task is for (`👤 @dana`);
  a person mentioned anywhere else stays a mention. A Task board card's ⋯
  menu has **For someone…**, also the **f** key, in any grouping. The first
  search in a window that uses `is:mine` or `is:waiting` while `deckard.me`
  is empty says so, rather than quietly finding the tasks for nobody.

- **Three pages for approving and using Deckard.** The guide gains *For
  your security reviewer* (what Deckard sends, stores, and runs, and over
  Remote-SSH), *What Deckard writes* (every change it makes to your files,
  what starts it, and its setting), and *Accessibility and keyboard*
  (screen readers, keys, high contrast, zoom, and motion). Help and the
  README link to them.

- **Starter templates.** New Note from Template, with no templates yet,
  offers **Create Starter Templates**: a meeting, a 1:1, and a decision
  record, written into the templates folder. `Deckard: Create Hub Note for
  Tag…` lists the tags no hub note describes yet and makes one; a tag's
  page offers the same as a button, where it was drawn as caption text. An
  empty Task board column says how to fill it without dragging: *No tasks.
  Drag a card here, or move one with its ⋯ menu.*

- **Safe in a code repository.** With no notes folder set, Deckard reads
  every Markdown file and writes today's note at the workspace's top. In a
  folder that looks like a code repository, the status bar now says
  **Deckard: whole workspace**, with a notes folder, folders left out, or a
  pause a click away; the first note Deckard would make there asks once
  where to write; and the first scan's summary offers **Not a Notes
  Workspace**. `Deckard: Pause in This Workspace` stops Deckard reading and
  writing there until it is resumed. Capture's message names the folder and
  workspace: *Added it to notes/2026-10-07.md in deckard-work.*

- **Checkbox lines that are not tasks are counted.** Only `- [ ]` and
  `- [x]` lines are tasks, so an Obsidian vault's `- [/]` and `- [-]` lines
  were left out of every task count with nothing saying so. The first scan
  that finds such lines says how many, once per workspace, and Stats keeps
  a line for them. Stats' **Wiki links** total is now **Links**, since it
  counts Markdown links too.

- **Markdown links count.** A relative `[text](../adr/0042.md)` link, the
  kind GitHub and MkDocs render, now links its note everywhere a `[[link]]`
  does: Linked from, the editor's link counts, the Notes Graph, Related
  Notes, Stats' notes nothing links to, and a search's `link`. A `#fragment`
  written as a heading's slug, such as `#decision-record`, finds that
  heading. `deckard.links.style` set to `markdown` makes Link mentions write
  `[Atlas](projects/Atlas.md)` rather than `[[Atlas]]`.

- **Esper Themes, suggested once.** Deckard's looks also come as VS Code
  color themes for the whole editor, in Esper Themes. Once the first index
  is done, a machine without it is asked once, with **Install** and **See
  Themes**.

### Changed

- **The Outline is part of the Context view.** Deckard's Outline view sat
  beside VS Code's own Outline under the same name. Its headings are now
  **Sections** in the Context view, above the related notes: each opens
  where it is, shows its own tags and `2/5 · ↩3`, and has **Focus**; the
  heading the cursor is in is marked, **Show** narrows the list to one
  tag's headings, and a long note shows its first twelve with **Show all**.
  The `deckard.outline.*` settings work as before. The Outline's view and
  its title-bar controls are gone; `Deckard: Filter Sections by Tag…` and
  the cursor-marking commands keep their places in the palette.

- **One look for dates and headings.** A due date still ahead is plain
  text everywhere, as on the Task board; only due today (amber) and overdue
  (red) take a color, so green no longer reads as done. A Home widget's
  name is now larger than the rows under it. The Note page names front
  matter as a reader knows it: **About** for `describes`, **Filed under**
  for `up`, **Also called** for `aliases`, with `[[Atlas]]` shown as Atlas.
  Stats sets its sentences in the page's font, keeping monospace for paths.

- **Focus is easier to follow.** A focused row or card now pushes the next
  one down to show where it is written, rather than laying that line over
  the next title; while the keyboard has focus, the row under a resting
  pointer no longer opens too, so one entry looks active, not two. The Task
  board's columns are lists to a screen reader, which says how many cards
  each holds and where each card is, such as *3 of 13*.

- **Names that say what they do.** `Deckard: Search Notes and Tasks` and
  `Deckard: Open Search Page` were one job under two names; they are now
  `Deckard: Open Search Page…`, which takes a search or opens every note.
  Lists of titles sort numbers as numbers, so *entry 2* comes before
  *entry 10*. Stats' Notes total says why it is larger than Files. Parking
  says what it does as it does it: a parked note leaves Home, the Tasks
  view, the board, and Related Notes, and stays searchable. The guide calls
  the sidebar's first view **Context** throughout.

- **The walkthrough teaches links.** Get Started's six steps are now:
  write a note (with the / menu), tag it and mention a person, link two
  notes and see Linked from, find anything, capture a task, and see the
  workspace. Links were the one thing the README promised that the
  walkthrough never showed; choosing a theme left it for the palette, Help,
  and every page's gear. Its steps give Windows and Linux keys beside
  macOS's.

- **A first Home lists each task once.** A new Home started with the Tasks
  view and an open tasks widget side by side, which listed the same tasks
  twice; it now starts with the Tasks view beside recently opened notes.
  The figures above Home read **Due today**, **Overdue**, and **Done this
  week**, the day's work first. Under the Tasks view widget's red
  **Overdue** heading, each row says how late it is, muted, rather than a
  column of red. **Customize Home** stays beside the tabs, in place of a
  line that went away once dismissed.

- **Stats reads like the other pages.** Its heading says **DECKARD /
  STATS** rather than *Local telemetry*, a word that reads as data leaving
  the machine, and its title sits at the left, under the heading, as every
  other page's does.

- **Renaming a note shows its link changes first.** Renaming a note in the
  Explorer rewrites the `[[links]]` that name it; when they are in more than
  one note, VS Code now asks before making them, with **Show Preview**, as
  every other Deckard write that reaches several notes does.
  `deckard.previewWorkspaceWrites` decides, as it does for those.

- **Install from the Marketplace.** Deckard is on the Visual Studio
  Marketplace as `esperinnovations.deckard-notes`, so the Extensions view
  finds it and VS Code keeps it up to date. Each GitHub release still
  carries the VSIX.

### Fixed

- **Citations are not people.** A Pandoc citation such as
  `[@smith2020; @lee2019]` made each key a person, and Stats offered to
  merge keys that looked alike. A person marker inside a bracketed citation
  is now left alone; `[assignee:: @dana]` and `[@sam](…)` still name their
  person. The parse format changes, so the cache is rebuilt.

- **The guide says what Deckard does.** It said fenced code is left out of
  the index, though its words are searchable; that note dates come only
  from file times, though front matter comes first; and that completing a
  task writes ✅, though a Dataview-format line gets `[completion:: …]`. It
  now says so, says where the local cache lives and that deleting it is
  safe, lists every setting (a test keeps it so), and the README's Quick
  start begins with Get Started.

## 2.1.0 - 2026-10-04

### Highlights

- Read any note as a page in your theme, its links, tasks, query blocks, and embeds working, from the unicorn in its title bar.
- A Hubs view files notes under the projects and topics they are about, and every project shows how far along its tasks are.
- Notes as tables, a / menu for what to write, Copy as Plain Markdown, and your dated tasks as a calendar file.

### Added

- **See how far along a project is.** A tag's page shows a bar under its
  hub and says how many of its tasks are done, how many are overdue, and
  when the next is due, each a link that searches just those tasks. The
  hub note says the same on its first line in the editor, and Home's new
  **Progress** widget lists every project's, or any namespace's, unfinished
  first.

- **Notes as a table.** A query block with `view=table` draws its notes as
  a table as well as its tasks. `noteColumns=` picks the columns: how many
  notes link to each, how far along its tasks are, its tags, its dates, or
  one namespace's tags such as `#status`. Notes sort by any of them, so
  `sort=links dir=desc` puts the most linked first.

- **Tick a task in a query block's preview.** Selecting a task's box in the
  Markdown preview completes it, or reopens a done one, with Undo, as its
  box on any page does. VS Code asks once whether Deckard may open the link.

- **A / menu at the start of a line.** Type `/` alone on a line for what to
  write there: a task, a heading, a list, a link or an embed, today's note
  or date, a query block, a table of notes or tasks, or one of your
  templates, whose `{ask:…}` questions become tab stops.

- **Your tasks in your calendar app.** `Deckard: Export Tasks as
  Calendar…` writes your dated tasks to a calendar file to import into any
  calendar app, and `deckard.calendar.exportFile` keeps one up to date for
  Apple Calendar to subscribe to. `deckard.calendar.exportQuery`
  chooses which tasks it holds.

- **Copy a note for somewhere Deckard is not.** `Deckard: Copy as Plain
  Markdown` copies the note, or the selection, with each embed written out
  as the text it names, each query block as its results, and each
  `[[link]]` as its words, ready for a chat, an email, or a pull request.

- **A tree of your projects and the notes about them.** The new **Hubs**
  view in the Deckard sidebar lists your projects, people, and other topics
  that have a hub note, each with the notes about it filed underneath, like
  pages under pages in Notion. A note names its place
  outright with `up: "[[Atlas]]"`. A note's first line says where it sits,
  such as *Projects › Atlas › Vendor review*.

- **Read a note as a page.** `Deckard: Open Note as Page`, the unicorn
  button in a note's title bar, draws the note on a Deckard page in your
  theme: its tags and `[[links]]` open what they name, with Back and
  Forward, its tasks tick, its query blocks and embeds draw live, its front
  matter is a row of properties, a bar says how far along its tasks are, and
  **Linked from** lists what links to it. The unicorn opens the page in
  front of the note's editor, as Open Preview does, and Related Notes
  follows the note the page shows. **Open in Editor**, or a double-click,
  goes to the line. Set `deckard.openNotesIn` to `page` to open every note
  there from Deckard's pages, Find, and the Hubs view; **Shift**-click on a
  page, or Shift+Enter in Find, opens a note the other way, and the Hubs
  view's right-click menu offers the other way.

- **A task's steps at a glance in the editor.** A lens above a task with
  steps draws a bar of how many are done and names the next one; select it
  to go there.

- **The sample tour shows all of it.** `Deckard: Create a Sample Workspace`
  now includes a project with a sub-project and notes filed under both, a
  table of every project, and steps for each feature above. It also gives
  Capture's shortcut as Cmd/Ctrl+Shift+Alt+N, which it still gave as C.

### Changed

- **A search page shows the tab with results.** A new search that finds
  nothing on the tab shown, Notes or Tasks, and something on the other,
  shows the other, so a link to a tag's overdue tasks lands on them. A
  redraw of the same search keeps the tab you chose.
- **A tag page's untagged mentions and other spellings** are said at the
  top of Refine, where they are not lost among the lines under the hub.
- **A tag's page stays its page while you narrow it.** A search that adds
  terms to one tag, such as **1 overdue** or a Refine choice, keeps the hub,
  folded, and the bar, still counting all of the tag's tasks. The part of
  the words searched is outlined, and selecting it again goes back to the
  tag. A search of two tags is still a plain search.
- **A task due today is drawn as a warning,** in each theme's yellow or
  orange, between a later date's green and an overdue one's red, in task
  rows, board cards, and the preview's query blocks. In LCARS, overdue is a
  red rather than the favorites' lavender, so it reads as the most urgent.
- **LCARS reads in VS Code's font,** not Arial Narrow.
- **A note page's progress words are links,** as on a tag's page: "1
  overdue", "next due today", and the rest each open a search page of their
  own for just those tasks. A hub's link to its tag's page sits on a line of
  its own, and a hub note followed from the page opens its tag's page.

## 2.0.0 - 2026-10-03

### Highlights

- Rebuilt inside on one shared, tested core for every page: the code loaded at start is nearly half the size, and pages behave alike.
- Over 230 fixes: zen mode and other settings work in a workspace that sets them, and saves made during a scan stay saved.
- Tags in any script, such as #café and #日本, and keyboard, screen reader, and contrast fixes on every page.

### Added

- **Save a search to the Tasks view with one button.** The search icon in
  the Tasks view's title opens the Task Board to edit what the view lists:
  change the search, then select **Save to Tasks view**, which keeps what
  the box shows even before Enter runs it. **Save as search** still saves
  it as a search of its own, and **Cancel** leaves the view as it was.

### Changed

- **A search's `text =` finds a whole word,** as the guide and the builder
  have always said: `text = plan` no longer finds "planning". `text:plan`
  or a bare `plan` still finds any part of a word.

- **Capture's shortcut is Cmd/Ctrl+Shift+Alt+N.** Cmd/Ctrl+Shift+Alt+C is
  VS Code's own Copy Relative Path of Active File on macOS and Linux, which
  Deckard's shortcut took over. To keep the old one, bind `deckard.capture`
  to it in Keyboard Shortcuts.

### Fixed

- **A tip no longer covers what a card shows on hover,** such as a Related
  Notes entry's relevance score or a Home row's counts: it opens beside
  what the card shows instead.

## 1.23.1 - 2026-09-27

### Changed

- **The Extensions view names it Deckard Notes**, since another extension is
  already called Deckard. Commands, pages, and the sidebar still say Deckard.

## 1.23.0 - 2026-09-27

### Highlights

- `Deckard: Open Calendar` opens the calendar as a page: each day's tasks by name, a Week layout, and drag a task to move its date.
- A repeating task is drawn on every date its rule lands on, marked ↻, not only its next one.
- The chosen day moves to Related Notes while that sidebar is open, and either calendar can leave out the weekends.

### Added

- **Customize Home from the sidebar.** While Home is the active editor, the
  Related Notes sidebar lists every widget **+ Add widget** offers; a click
  puts Home into customizing and adds it. **Reset widgets…** is there too.

- **The guide is a website**, in the Replicant theme, under Deckard's
  lockup, with its screenshots opening full screen on a click.

- **The calendar as a page.** `Deckard: Open Calendar`, or the calendar
  button in the Related Notes and Calendar title bars, opens a month across
  the editor, on the sidebar's month and day. Each day lists its tasks by
  name, due, then scheduled, then repeats, with **+N more**, and the chosen
  day's panel sits beside the month, or under it in a narrow editor.
  **Week** shows the chosen day's week in full; `[` and `]` step, `t` is
  today, `m` and `w` switch the layout, and `?` lists the keys.

- **Drag a task to another day on the calendar page.** A due or scheduled
  task dropped on a day takes that date, with Undo, and a move Deckard could
  not write is said. A repeat stays where its rule puts it.

- **Every date a task repeats on.** A repeating task is drawn on each later
  date its rule lands on in the weeks shown, a muted **↻** in the sidebar
  and a dashed chip on the page, named in the day's tooltip and listed under
  **Repeats** in the day panel, where a row opens the task. The dates are
  projected, never written, and a `when done` rule stays on its next date.
  `deckard.calendar.showRepeats`, on by default, or **Turn Off Repeats** in
  the Calendar's `…` menu, turns them off.

- **The chosen day in Related Notes.** While the calendar page is in front
  and the Related Notes sidebar is open, the chosen day's panel is drawn
  there, its checkboxes and buttons acting on the calendar, and the month
  takes the page's whole width.

- **Weekends can be left out.** `deckard.calendar.showWeekends`, or **Hide
  Weekends** in the Calendar's `…` menu and **Weekends** in the page's gear,
  draws each week as its five working days in both calendars; the arrow keys
  step over the weekend.

### Changed

- **The Related Notes view is now Context.** It shows more than related
  notes: a search's Refine, a graph node's connections, the calendar page's
  chosen day, and Home's widgets. Its Notes Graph and Help buttons sit in
  its title bar with the others, instead of in its `…` menu.

- **A widget added to Home goes at the top**, where it is seen, and Home
  scrolls to it, outlines it for a moment, and moves focus to it.

- **Reset widgets asks in a modal confirmation**, in place of the Keep them
  and Reset buttons in the customizing bar.

- **The Extensions view shows Deckard's lockup** as its icon.

- **The guide says what to do, in fewer words**: about a third shorter,
  with every command, setting, and syntax kept.

- **The calendar icon opens the calendar.** In the Related Notes title bar
  it opened today's note; that is now a new-file icon, and the calendar icon
  opens the calendar page.

- **The Extensions view says what Deckard does**, under its name.

### Fixed

- **A chosen day in the sidebar Calendar is readable in every theme.** It
  was filled with the hover ground, cream in Cooper, and its counts went
  unreadable on it; it is now outlined and underlined in the accent.

- **A day on the calendar page keeps its date under the pointer.** The date
  took the theme's button hover, which in Cooper is the ground's own color;
  the whole day now lights faintly instead, and a click anywhere in it
  chooses it.

## 1.22.0 - 2026-09-27

### Highlights

- Search pages you can scan: rendered, three lines a result with the paragraph its words are in, five values a Refine facet, and tags on cards as quiet text; a search can become a live query block.
- Find opens a result beside the editor, links to a note, and creates one it did not find; `[[` completes a note's headings and links a day by name.
- The Task board works from the keyboard, and Capture reads a date, a priority, and a repeat rule from the words at its end.
- Nothing is silently lost: a repeating task comes back however it is finished, a copied rollover arrives once, and no section or task vanishes from the index.
- Every failure says what did not happen and what to do, with **Open Log**; Home says what is new after an update, and Choose Theme… previews each theme.

### Added

- **The sample workspace is a tour you read and do.** `Deckard: Create a
  Sample Workspace` opens on a Start here README that leads through ten
  notes, one a topic: tasks, the Task board, repeat rules and dates, search,
  query blocks, tags and people, links, daily notes and reviews, Capture and
  parking, and Home, Stats, and the graph. Each says what it holds, holds the
  tasks, tags, and links that make it show, and ends with **Try it**: the
  commands, keys, and searches to run, and what each shows. The Search note
  gives a search for every field and state, and says what each finds. The
  sample's own settings name you, show the calendar's day panel, and
  migrate tasks on rollover.

- **Zoomed out, the Notes Graph draws each file as one node, and opens it
  into its headings as you zoom in.** A workspace of fifty files draws as
  fifty dots at rest rather than hundreds, each sized by its headings
  together; **Headings** under Display chooses **By zoom**, **Always**, or
  **Never**.

- **Stats shows which tags are written together.** Your twelve most-used
  tags form a triangle whose cells count the notes and tasks carrying both,
  each opening the search for the pair; **Show as a table** lists the pairs
  by count.

- **Stats shows how often each tag is used, and merges the tags used
  once.** Six bars count the tags used once, twice, 3–5, 6–10, 11–25, and
  26 or more times. **Used once** unfolds those tags, each with the tag it
  looks like and **Merge**, or **Merge into…**; any other bar offers its
  tags to open.

- **A related tag in Refine says how many of the results carry it.** Its
  rail fills by that share, its tip leads with **In 6 of 13 results.**,
  and a screen reader hears "in 6 of 13 results" rather than a strength
  measured against the strongest tag listed. Related tags are sorted by how
  many results carry them, on search pages and in the sidebar's Refine.

- **Stats shows how notes, tasks, and open tasks moved over twelve weeks.**
  A line under each of those totals draws a point for each rolling seven
  days, the latest marked, and says **+9 in the last 7 days**; hover a
  point for its value. The weeks are rebuilt from the dates notes were
  written and tasks were done.

- **Stats leads with what needs attention, and every total opens what it
  counts.** Notes Deckard could not read, links that open no note, tags that
  look alike, and notes nothing links to come first, each with its count,
  and only when they have rows; with none, one line says so. **Notes**
  opens `is:note`, **Tags** and **Namespaced tags** offer their tags to
  open, **Wiki links** opens the Notes Graph showing only the links you
  wrote, and **Unlinked notes** moves to its list, which shows ten with
  **Show 40 more**. Empty most-viewed lists fold into one line.

- **The Notes Graph names its groups where they sit.** Zoomed out, each
  group is labeled over a faint disc after the tags its notes carry more
  than the rest of the workspace does, so a tag on every note names nothing.
  Click a name, or choose it from the new **Group** list under Filters, to
  pick that group out; **Clear tag filters** is now **Clear filters** and
  lets the group go too. The status line counts groups, and names eight
  hubs at rest rather than twelve, placed so no two labels overlap.

- **A graph node says what it is joined by.** Its tooltip counts wiki
  links, headings, and tags (`atlas.md:12 · 4 wiki links · 2 headings · 7
  tags`), and a tag says how many notes and tasks carry it. A node is sized
  by everything it is joined to in the index, so neither changes as Links
  per note moves.

- **The Notes Graph tells its lines apart.** A wiki link you wrote is a
  solid line, a heading a dashed one, a shared tag a dotted one, and a path
  through a daily note a dash-dot one, with a sample of each in the legend.
  **Only links I wrote**, under Filters, draws every wiki link and nothing
  else, and the status line says how many of the indexed links are drawn.

- **A note with no tags still finds its neighbors.** Related Notes lists up
  to ten entries with similar wording, marked weak and kept apart from
  related notes, and the tags those entries use, each with **Add**, which
  writes it on the heading or line under the cursor, with Undo. For a note
  with tags, wording alone still never makes a note related.

- **Related Notes previews each result.** A card shows the first line of
  what the entry says, starting where it shares a word with your note,
  with those words marked. The sidebar's new gear sets Preview to None, 1
  line, or 2 lines, and holds **Hide daily notes** as its Daily notes row.

- **Suggest steps.** When a VS Code language model, such as GitHub
  Copilot, is installed, Break into Steps… offers **Suggest steps**: only
  the task's words are sent, only when chosen, and the steps are shown to
  remove, reorder, or change before anything is written.
  `deckard.tasks.suggestSteps` turns it off.

- **Break a task into steps.** **Break into Steps…** — on the lightbulb,
  in the palette and the editor's Deckard submenu, on the Tasks view's
  right-click menu, and on a board card's ⋯ menu or its **s** key — writes
  `- [ ]` steps under a task, one per line typed, shown beside the steps
  already written, in one change Undo takes back. The task then says
  "2 of 5 steps · next: Draft the email" on its card and row, and opens to
  its steps in the Tasks view. Completing its last open step offers
  **Complete Task**, and completing a task with open steps offers
  **Complete Steps**; neither happens unless chosen. A checkbox indented
  under a task is now one of its steps: `is:step` finds steps, and `has:steps` / `no:steps` find
  tasks with and without them.


- **Parked notes.** A note, folder, or tag can be parked: still indexed and
  searchable, with `is:parked` and last in Find and on search pages, but
  left out of the Tasks view, the status bar, the Task board, rollover, the
  calendar, Related Notes, the Notes Graph, and tag completion. **Park
  Note** writes `#parked` into the note's front matter; **Park Folder** and
  **Park Tag** add to `deckard.parked.folders` and `deckard.parked.tags`.
  Each is in the Explorer, the editor tab, and a tag's menu, with Unpark
  beside it. Until now the only way to set notes aside was
  `deckard.exclude`, which hid them from search too.

- **Group tasks by your own tags.** The Tasks view and the Task board
  group by the tags of any namespace — #project, #context, #area — as well
  as by due date, priority, status, and person. A tag inherited from a
  heading or a note's front matter counts, a task with two such tags is in
  both groups, and dragging between groups rewrites the tag on the task
  line, refusing to take away one a heading gave it. The README has a
  recipe for GTD contexts and PARA areas.

- **The calendar counts what is scheduled.** Beside a day's due count, an
  outlined count marks the tasks scheduled (⏳) for it, and the day's
  tooltip and label say "2 due, 1 scheduled".

- **A day under the calendar.** With `deckard.calendar.dayPanel` on, or
  **Open Day Panel** in the Calendar's … menu, a click chooses a day and
  the panel below the month names it and offers its daily note, Open or
  Create, and lists the tasks due, scheduled, and done that day with a
  checkbox and a **Tomorrow** button, and the notes created that day. Double-click or Enter opens the day's note. Off by default, so a
  click still opens the note.

- **The Outline focuses and filters.** **Focus Section**, on a heading in
  the Outline, in the editor's Deckard submenu, or in Note Actions, folds
  the rest of the note away; **Unfold All Sections** brings it back.
  **Filter Outline by Tag…** shows only the headings that carry a tag, or
  a tag under it, until it is cleared.

- **The Outline counts.** Beside each heading, **2/5** for the tasks under
  it that are done and **↩3** for the links that name it, spelled out in
  its tooltip. Zen hides them; `deckard.outline.showCounts` turns them off.

- **A word count.** While a note is in the editor, the status bar reads
  **412 words · 2 min**, or **38 of 412 words** for a selection, leaving
  out front matter, code, link addresses, and task metadata.

- **A repeat rule Deckard cannot read is marked.** An open task's 🔁 rule
  that Deckard cannot read gets a warning before it is completed, and quick
  fixes to the nearest rules it can: `every tuesdya` becomes `every
  tuesday`, `weekly` becomes `every week`. The task editor's warning
  suggests the same. `deckard.editor.repeatDiagnostics` turns it off.

- **More repeat rules.** `every other week`, `every other Tuesday`,
  `every 2 weeks on Monday, Thursday`, `every month on the second Tuesday`,
  and `every month on the last Friday`, as Obsidian Tasks reads them, and
  Deckard's own `every quarter` and `every weekend`.

- **Task metadata steps back; overdue speaks up.** In a note, a task's
  dates, priority, repeat rule, ids, and person are drawn fainter than its
  words, and an open task says **overdue 5 days**, **due today**, or
  **needs a new date** at the end of its line, its overdue date in the
  overdue color. `deckard.editor.dimTaskMetadata` and
  `deckard.editor.taskDueHints` turn them off; zen hides the hints.

- **`[[links]]` and task dates colored by your theme.** In any Markdown
  file, a link's name and alias, an embed's `!`, a task's dates, repeat
  rule, and priority, Dataview keys, and a `^block-id` take your theme's
  colors. Code, front matter, and tags are left as they were.

- **The Explorer knows Deckard.** Right-click a folder for a **Deckard**
  submenu: **New Note from Template Here…** writes the note into that
  folder, and **Exclude from Deckard** leaves the folder out of the index
  (with Undo), while **Include in Deckard** brings it back. Create Daily
  Note and New Note from Template are in **File → New File…**.

- **A Deckard menu in the editor.** Right-click in a note for a **Deckard**
  submenu: the task on the line, the heading the cursor is in, Move to…,
  and Pin or Unpin.

- **Zen from a page's title bar.** Every Deckard page — Home, a search
  page, the Task board, Stats, Help, and the Notes Graph — has a zen button
  in its title bar that enters zen, and leaves it again.

- **A Deckard button in a note's title bar.** It opens `Deckard: Note
  Actions…`, which lists what can be done from where the cursor is: toggle,
  edit, or add a task, open Related Notes or `Deckard: Open Notes Graph
  Around This Note`, move the line, and pin the note. A daily note's title
  bar also has **‹** and **›** to the days before and after, which stay put
  as the note scrolls.

- **Toggle Task Done from the keyboard.** `Deckard: Toggle Task Done`,
  <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd>
  (<kbd>Ctrl</kbd> elsewhere), completes the tasks under every cursor and
  selection, or reopens them when all are done, with the ✅ date and a
  repeating task's next occurrence, in one edit that one Undo takes back.
  It works in a note that is not saved yet.

- **Move to… from the Tasks view, the board, and Find.** A task's context
  menu in the Tasks view (for one task or several), a board card's menu,
  and a task's list in Find (<kbd>Cmd</kbd>+<kbd>.</kbd>) offer **Move
  to…**; a task moved to another note keeps its place on the board.

- **Move to….** `Deckard: Move to…`, or the lightbulb on a task line or a
  selection, moves a line, a task with its steps, or a selection under
  another heading, into today's note, or into a new note. A task left
  behind becomes `- [>] … → [[where it went]]`, anything else a `[[link]]`
  (`deckard.moveTo.leaveBehind`). Nothing is written if the lines changed
  while you chose, and **Undo** puts both notes back.

- **Find and Capture start from the selection.** With a few words selected
  on one line, Find searches them and Capture starts from them; a capture
  from a note links back to the heading they came from, after the words and
  before the date, with a button to leave the link off. A selection wins
  over an earlier draft, which is offered as **Restore what you were
  typing**.

- **Capture remembers its headings.** Capture Under a Heading lists the
  five headings it went under last first, the last one highlighted so Enter
  repeats it, then every heading from the notes you open most.

- **Find offers to capture what it could not find.** When no entry has
  every word, and what was typed is only words, tags, and people, Find adds
  **Capture “…” to today's note**, showing the line Capture would write,
  date and priority read from the words.

- **Find learns what you pick.** Choosing a result after typing `vend`
  lifts it for `vend`, `ven`, and whatever else starts it, more with each
  pick and less as the pick ages, but never above a note titled exactly
  what you typed. It is kept in VS Code's preferences, not in your notes.

- **Find acts without leaving.** A task in Find has **Complete** (or
  **Reopen**) and **Set due**; Find stays open and redraws the row in place.
  <kbd>Cmd</kbd>+<kbd>.</kbd> lists everything a row can do, from copying a
  link to renaming a tag or forgetting a recent search, and Escape returns
  to Find with its search.

- **Keys inside Find.** <kbd>Cmd</kbd>+<kbd>Enter</kbd> (<kbd>Ctrl</kbd>
  elsewhere) opens the highlighted result beside the editor and keeps Find
  open for the next; <kbd>Alt</kbd>+<kbd>Enter</kbd> inserts a link to it
  where the cursor was. Each row button's tooltip names its key.

- **Find starts with your pinned notes.** With nothing typed, Find lists
  your pinned notes first, then the five notes you opened last, then five
  recent searches, your saved searches, and your tags.

- **A note counts as opened however it was opened.** A note that stays in
  the editor for a moment counts for Recently opened, Find, and `[[`
  completion, whether it was opened from Deckard, the Explorer, Quick
  Open, or a link; the same heading counts again only after ten minutes. A
  heading keeps its count when lines above it change, where it used to
  lose it.

- **Stats: Links that open no note.** Stats lists every name a `[[link]]`
  writes that no note carries, most linked first, saying how many links
  and from which notes. A row opens the search for those links; **Create**
  makes the note, and **Create all** makes every one after asking.

- **A tag's page counts plain mentions.** A tag's page says *12 entries
  mention "atlas" without the tag.* when its name, three letters or more,
  is written as a plain word elsewhere; **Show them** searches for those
  entries, ready for **Bulk edit → Add a tag**.

- **A tag's page says how else it is written.** Under the hub, a tag's page
  names up to three spellings that look like it, from the same pass as
  Stats' Tags that look alike: *Also written as #proj/atlas (6 entries).*
  **Include in search** searches both; **Merge** runs the usual confirmed,
  previewed, undoable merge, and a page whose tag was merged away follows
  the one kept.

- **A tag's page lists what links to its hub note.** On a tag with a hub
  note, the page also lists every entry and task that links to the hub
  without carrying the tag, each marked *Links the hub note*, and says
  *Also listing 5 entries that link to Atlas plan without the tag.* with
  **Leave them out**. Counts, pages, Bulk edit, and Export include them;
  `deckard.tagOverview.includeHubLinks` turns it off.

- **Related Notes can leave out daily notes.** **Hide daily notes**, beside
  the sort, leaves daily, weekly, and monthly notes out of the related notes
  and of Linked from, since a daily note links to everything written that
  day. Linked from says *Hiding 8 daily notes.* with **Show them**, and the
  choice is remembered.

- **Related Notes: Linked from by note.** Linked from lists the notes that
  link here, newest updated first, each saying when it was updated and how
  many links it has, with its lines beneath; the count is of notes. A line
  unfolds onto the rest of its section, and **Open as search** (or **Open
  all as a search** past fifty lines) opens every linking entry as a search
  page, ready for Refine, Bulk edit, Save, and Export.

- **Search: `is:daily` and `is:periodic`.** `is:daily` finds what was
  written in daily notes, tasks included, and `-is:daily` leaves it out;
  `is:periodic` adds weekly and monthly notes. Both are in the builder's
  `is` values. Every place that tells a daily note from another now reads
  it one way, so a note with a day in its top heading counts on the Notes
  Graph's **Pass through daily notes** as it does elsewhere.

- **`[[` completes a note, and Refine narrows by links.** Typing `[[` in a
  search box or a new builder row lists your notes, most linked first, each
  saying *Linked from 12 notes* or which note it is an alias of. Refine
  gains **Links to**: the notes the results link to, with how many of them
  link there.

- **Search: what links to a note.** `[[Atlas]]` in any search box, Find, a
  query block, or an assistant's query finds the entries that link to the
  note Atlas, by its name or an alias; `link = [[Atlas#Decision]]` narrows
  to links to one heading, and `-[[Atlas]]` leaves them out. A link belongs
  to the entry whose own lines hold it, and a link above a note's first
  heading lists the note itself. Links to a note not written yet count, so
  `[[Q4 offsite]]` finds what waits on it. The builder has a **link** row,
  and `[[Atlas plan]]` is one chip in the search box.

- **Try next.** Home's first widget suggests one thing, when your notes are
  ready for it: a weekly review after five daily notes last week, merging
  two tags that look alike, the Task board once there are ten open tasks,
  or pinning a note you open often. **Not now** puts it off for a week, and
  **Do not suggest this** for good; with nothing to suggest it takes no room.
  Homes already arranged find it in **Add widget**.

- **A first index says what it read.** The first scan of a workspace
  finished in silence; it now says, once, *Deckard read 412 notes: 1,204
  open tasks (17 overdue) and 185 tags.*, with **Open Dashboard** and **Get
  Started**. A workspace of 3,000 notes or more hears in the same message how
  to leave folders out, rather than in a second one.

- **The walkthrough covers tasks and themes.** It had four steps and never
  mentioned tasks; it now has six: open a note, tag it, **Capture a task**,
  see the workspace, find anything, and **Make it yours** with Choose Theme…
  and zen, with screenshots of the Tasks view, Home, a search page, and four
  themes. `Deckard: Get Started` opens it, and so do Help's Quick start and
  **Walkthrough** in Home's gear.

- **Choose Theme… previews each theme.** `Deckard: Choose Theme…`, or
  **Theme** above **Zen** in the gear on Home, a search page, or the Task
  board, lists the eight themes with what each looks like; moving through
  them shows each on the open pages, Enter keeps one, and Escape puts back
  the one in use. Nothing is written to settings until one is kept.

- **What's new, in the product.** After an update that adds features, Home
  says *Updated to Deckard 1.23.* once, with **What's new** and **Dismiss**;
  a patch says nothing, and there is no pop-up. Help has a **What's new**
  section listing the highlights of the last five releases, newest first,
  with those since your update marked **New**, and `Deckard: What's New`
  opens it. `deckard.showWhatsNew` turns Home's line off.

- **A command named in Help runs from Help.** Every `Deckard: …` name in
  the guide and its commands table is a button that runs the command, with
  its shortcut beside it for this platform. A command that acts on the note
  in the editor is named but not run. Help named `Deckard: Export` and
  `Deckard: Import`, which do not exist; it now gives their real names.

- **A saved search can show its results on Home.** Saving a search offers
  **Show Results on Home**, which adds a widget listing what it finds, and
  **Open Home**; a saved search's row on Home offers **Show results** until
  Home lists it.
- **A search becomes a live query block.** **Export** on a search page or
  the Task Board offers **Copy as live query block** first, which copies the
  search, with its sort or table columns, as a `deckard` fence that stays up
  to date in a note. `Deckard: Insert Query Block…` writes one at the cursor
  from a saved or recent search, or one you type.
- Related Notes says each shared tag once.
- A board card's menu is a button that opens a menu.
- The Help rail marks the section being read.
- Stats says when the index was refreshed in words.
- Every theme defers to a high contrast editor theme.
- The type scale follows the editor's font size.
- A card's details wrap as a row with gaps.
- A reason that only names the card's chips goes too.
- A saved search reads by its name, with its criteria under the pointer.
- Priority is a badge, told from the date beside it.
- A Dashboard row's readout folds under the row under the pointer.
- The headings above an entry, under its file and line, everywhere.
- A board card folds its file and line, and the headings above, under the card.
- The palette offers a Deckard command only where it can run.
- Focus stays where it was through a redraw, and a screen reader hears what changed.
- Every text field's edge and every tag's namespace read at WCAG AA.
- A task can be dated from the Tasks view, and every overdue task at once.
- Capture reads a date, a priority, and a repeat rule from the words at its end.
- The Task board works from the keyboard.
- A result opens beside its page or as a preview, and a search page steps back and forward.
- `[[` completes a note's headings, ranks notes as Find does, and links a day by name.
- Find opens a result beside the editor, links to a note, and creates one it did not find.
- Related Notes lists what links to the note, and each mention can be linked on its own.
- A search result marks the words it was found by, and says where it is written.
- Zen quiets the editor as well as the pages.
- A focused Notes Graph passes through daily notes.
- A search page and the Task board come back scrolled where they were left.
- A copied export is said in the status bar, and a saved one offers to open.
- A task, the status bar count, and a calendar day say which, not only how many.
- A first run offers its next step, indexing says how far it has got, and settings link to each other.
- **Home leads with what is overdue, due today, and open.** The three
  figures at the top of the Dashboard were totals of notes, tasks, and tags;
  they are now Overdue, Due today, and Open, each a button that opens its
  search, scoped by `deckard.agenda.query` so the number and the page agree.
  `is:today` finds exactly the Tasks view's Today. A new or reset Home puts
  the Tasks view widget before the open-tasks list.
- **Rescheduling can spread tasks over the week, and says how full a day
  is.** Reschedule All… and Reschedule Overdue Tasks… say how many tasks
  are already due and scheduled on each day offered, and for several tasks
  offer **Spread over the next 5 days** and **3 for today, the rest next
  week**, each one previewed, undoable write. A move of several tasks ends
  by saying how full the day now is.
- **A board column counts its overdue cards, keeps red for the worst, and
  takes a limit.** A column's header reads **40 · 38 overdue**; when most of
  a column is overdue, only the longest-overdue third keep the red and the
  rest say *overdue* muted beside a red dot. `deckard.board.limits` sets
  work-in-progress limits, such as `{ "doing": 3 }`: the header reads
  **5 / 3** and the column gets a neutral outline. A drop is never refused.
- **A review looks ahead.** A weekly or monthly review gains **Coming up**:
  the open tasks due, scheduled, or starting in the next period, each led by
  its day. Its summary line counts them, and says how many of the tasks due
  in the period were done on time. `deckard.periodicNote.reviewSections`
  adds sections of your own, each a title and a search, written as a list.
- **Gone quiet watches any namespace.** Home's People gone quiet widget is
  now **Gone quiet**: its gear chooses the namespace, people by default or
  `project` or any other, and **Only those with no open tasks** lists the
  stuck ones, each with **Add next action**, which captures a task with the
  tag to today's note.
- **Done today.** The Tasks view ends with a folded Done today group of
  what was finished today; unchecking one reopens it. The status bar's hover
  and Home's Tasks view widget say how many.
- **Open Daily Note for Date…** opens the note for any day named in plain
  words, such as `last friday` or `oct 3`, creating it from the template when
  there is none. Find offers the same row when what you type is a day.

### Changed

- **A repeating task's steps come back with it.** Completing a task with a
  🔁 rule now writes its steps, unchecked, under the next occurrence, so a
  weekly checklist starts fresh; the completed occurrence keeps its own.
  Obsidian Tasks writes the next occurrence alone.

- **Nested checklists fold into their task.** On the Task board and in the
  Tasks view — and so Home's agenda and the status bar count — a plain
  checkbox written under a task now rides on that task's card or row
  instead of being a card of its own, so an existing note with nested
  checklists shows fewer, richer cards. A step with its own date,
  priority, person, or tag is still listed; search pages list every step
  they find.

- **A save no longer holds VS Code up while Deckard redraws.** A save
  updates only that note's part of the index — about 20 ms at 5,000 notes,
  down from about two thirds of a second — and the views on screen redraw
  one at a time, the one in front first, so other extensions get a turn in
  between. Hidden views still catch up when they are shown.

- **The Notes Graph costs a save nothing when the save changes nothing it
  draws.** Editing words inside a line, ticking a task, or changing its due
  date no longer rebuilds and resends the whole graph (about 1.5 seconds
  and 50 MB at 5,000 notes). A save that adds a link, heading, tag, or task,
  or moves one to another line, still redraws it. Hiding notes or tasks
  leaves them out of what is sent, and each link is sent lighter.

- **Notes are read eight at a time, and a rescan skips notes that did not
  change.** A rescan after a change to an exclude, folder, or templates
  setting rereads only the notes whose size or saved time changed — about
  a quarter of a second at 5,000 notes, down from over half a second.
  `Deckard: Reindex Workspace` still reads and parses every note.

- **Deckard starts from where it left off.** A workspace Deckard has seen
  before opens with Home, the board, and the Tasks view drawn at once from
  the notes as they were when VS Code closed, then Deckard rereads only the
  notes whose size or saved time changed — under a second to the first
  display at 5,000 notes, down from nearly three. `Deckard: Reindex
  Workspace` still rereads everything.

- **The local cache keeps each note as Deckard last read it.** Beside the
  words search uses, the cache now holds each parsed note, which the next
  start can show before reading anything. A new version of Deckard, a
  change to a parsing setting, or a new time zone rebuilds it; before, a
  new version kept search rows written by the old parser. A note whose
  created time alone changed is now written again, too.

- **Extract Heading takes any heading.** `Deckard: Extract Tagged
  Heading` is now `Deckard: Extract Heading`, and moves an untagged heading
  as readily as a tagged one; its picker lists every heading, naming the
  tags of those that have some.

- **A capture under a heading goes above its sub-headings.** It went to the
  end of the heading's last sub-heading; it now goes under the heading's
  own lines.

- **Rename Tag says what will happen.** The box starts from the old tag
  with its name selected, and says as you type whether the new name merges
  into a tag that exists (and how many entries it has), is a new tag, or
  changes nothing. A bare name with a `/` that would keep the old namespace,
  such as `project/atlas` for `#proj/atlas`, is a warning.

- **`[[…]]` in a search is a link.** A saved search, query block, or board
  search that held `[[Atlas]]` searched for the word *atlas*; it now finds
  the entries that link to Atlas. `text ~ "[[x]]"` still searches for the
  characters.

- **The sample workspace is dated the day it is made.** Its tasks were due
  in August and September, so a sample made later was all overdue. Its daily
  notes now run up to yesterday's and today's. It opens without a folder
  dialog, from Deckard's own storage,
  shows its README once the window has reloaded, and carries a
  `.vscode/settings.json` so your own settings cannot make it look empty.

- **The Notes Graph's link sliders say what they do.** *Connection
  density* is **Links per note**, from **Fewer** to **More**, and a screen
  reader hears a word rather than 0.30. *Tag prevalence bias*, *Secondary
  bridge strength*, and *Show all links* are **Favor rare tags**, **Links
  between groups**, and **Show every link**, folded under **Advanced**.
  Related Notes' three tuning settings are described in plain words and
  marked advanced.

- **A setting is named in words, with a button that opens it.** Messages
  that named a setting by its ID, such as `deckard.exclude`, name it as the
  Settings editor does, *the "Exclude" setting*, and offer **Open Setting**.
  When the Tasks view's search finds nothing, the view says which search and
  offers **Show every open task**; `Deckard: Clear the Tasks View's Search`
  does the same from the view's `…` menu.

- **A failure says what did not happen, and what to do.** A message that
  something failed no longer ends with the raw error: it says what was not
  written or opened, in plain words, and offers **Open Log**, where the
  details are. Starting the MCP server on a port in use says so and offers
  **Open Setting**; an unreadable preferences file says nothing was
  imported; a sample folder already there offers **Replace** or **Open As It Is**.

- **A long board column shows 100 cards, and the rest on request.** A
  column of hundreds drew every card; it now draws the first 100 with
  **Show N more**, as Done already did with its 20, and a card off screen is
  not laid out until it is scrolled to.

- **Find and search pages open while the workspace is indexing.** They
  opened only once the first scan finished; now Find opens at once, busy,
  keeps what is typed, and shows *Indexing this workspace: 412 of 3,760
  notes read…* until its results arrive, and a search page, Home, the Task
  board, and Stats show the same count in place of *Loading…*.

- **A moved card moves at once.** A card moved from the keyboard or its ⋯
  menu, as well as by dragging, goes to its new column straight away, both
  columns recount, and it shows as pending until the note is written; a
  note Deckard wrote itself is read back without the 200 ms wait for typing
  to settle. A move that could not be written says so.

- **List in Tasks view is a switch in the Task board's gear.** It leaves
  the search bar, shows whether the Tasks view lists the board's search, and
  selected again gives the Tasks view back every open task.

- **Tags on cards are text.** Search results, task rows, board cards, and
  Related Notes draw a tag as quiet monospace text that opens it, its
  namespace muted, with a faint underline under the pointer, rather than a
  row of boxes that outweighed the title. The editor keeps its tag boxes.

- **A tag with no hub note offers one in a line.** **Create hub note** sits
  under the tag's title as quiet text, in place of the amber panel that
  stood above the results.

- **Refine shows five of each.** A facet lists its first five values and
  **+N more** for the rest, on the search page and in the sidebar, so
  thirty related tags no longer push the results down the page.

- **Search results you can scan.** A result shows three lines of its entry,
  or, on a search of words, the paragraph the words are in when they sit
  further down; **Show all** opens the rest. The gear's new **Preview** row
  chooses None, 3 lines, or Full.

- **Search pages start rendered.** A result shows its Markdown drawn, not
  its source. **Everyone is switched to Rendered once**, since a saved
  preference held Source whether or not it was chosen; choosing Source in
  the gear's Format row after this update sticks.

- **The Dashboard sends a tag's name and count, not its entries.** At
  5,000 entries and 471 tags its snapshot drops from 1,674 KB to 75 KB, and
  Home no longer builds the hidden Tags tab on every redraw.

- **A search page draws only the page it shows.** Every match is sorted
  and counted as before, but only the thirty on screen are rendered, so an
  empty search of 5,000 entries takes 29 ms instead of 348, and a search of
  words 41 ms instead of 279. A Home widget for a saved search draws only
  its own few entries.

- **Removing a Home widget or a board column can be undone.** While
  customizing Home, removing a widget says **Removed Tasks view.** with
  **Undo** for 8 seconds, which puts it back where it was, and removing a
  status column from the board's gear does the same. **Reset widgets**, which
  cannot be undone, still asks first, and its button now comes after
  **Keep them** with a heavier edge.

- **Loading waits before it speaks.** A page that loads quickly shows
  nothing in the meantime; one that does not says *Loading search…* after
  0.4 s, in a line rather than an empty box, and tells a screen reader it is
  busy. A search still running after a second shows a thin bar under the
  box.

- **A long tag stays on one line.** A tag, a search term, or a Refine value
  too long for its place shortens, the namespace first, instead of breaking
  after its slash; the whole tag shows as its tip when it is cut short.

- **A card's menu says what is chosen, and its keys.** The Task board
  card's ⋯ menu checks the task's status, priority, and due date instead of
  leaving the current one out, shows the key that makes each change, such
  as **2** for High, and the keys work while the menu is open.

- **A button that cannot act yet says why.** Save, Clear, Back, and
  Forward stay in the Tab order while they cannot act, say why when focused
  (*Type a search to save it*), and no longer light up under the pointer.
  No disabled control in any theme changes color on hover.

- **A button's tip shows on keyboard focus, and names its key.** Every
  page's buttons — the search page, the Task board, Home, Related Notes,
  Stats, the Calendar, and the Notes Graph's controls — explain themselves on
  focus as well as under the pointer, after a short pause for the pointer;
  Back and Forward name Alt+← and Alt+→, and Escape puts a tip away.

- **Menus, the gear, and completions look like one family.** The tag menu,
  a board card's menu, the rank menu, the gear's menu, a Home widget's
  options, and search completions share one edge, ground, and shadow, and
  one stacking order, so a dragged row no longer passes under an open menu.

- **Carried tasks go under Carried over, a week back, and migrate rather
  than copy.** A rollover writes today's carried tasks under a **Carried
  over** heading at the end of the note, one level below its first heading,
  and a second run adds to it. `deckard.dailyNote.rolloverDays` now defaults
  to 7 (it was 0, as far back as the notes go); older dated tasks show under
  Needs a new date. **`copy` now means `migrate`:** the task is written into
  today's note and the line left behind becomes `- [>] … → [[2026-09-25]]`,
  so it stops counting as open. Users of `copy` will see their old notes'
  lines rewritten this way on the next rollover; Undo takes it back.

- **`is:waiting` now means waiting on someone.** It was an undocumented
  second spelling of `is:blocked`, so it disagreed with the board's own
  Waiting column. It now finds open tasks marked `#status/waiting` or
  assigned to someone other than you; `is:blocked` keeps meaning held up by
  another task. **A saved search or query block that used `is:waiting` now
  lists different tasks.** New `is:available` finds what can be started now
  — not blocked, started, and not on hold by `deckard.tasks.onHoldStatuses`
  (`waiting`, `someday`) — and the Task board's **Can start now** switch
  narrows the board to it.

- **Upcoming lists each day on its own.** The Tasks view's Upcoming is a
  group per day that has tasks — Tomorrow, Mon Sep 28 — so a crowded
  Thursday shows before Thursday, and a task dropped on a day is due that
  day.

- **A task a month past its date waits under Needs a new date.** An open
  task more than 30 days overdue leaves Overdue, the Tasks view's badge, the
  status bar's count and warning color, and the reminder, for a folded
  **Needs a new date** group with its own Reschedule All. The status bar's
  hover says how many. `deckard.tasks.needsNewDateAfterDays` sets the days,
  and `0` keeps the old behavior. `is:overdue` still finds every one.
  Wherever such a task is listed — the board, which gives it a muted column
  of its own, search pages, query blocks, Home, and the calendar — it reads
  **was due 2026-07-01** in muted text, not red. `is:needs-date` finds them,
  and Home's Tasks view widget says how many under its list.

- **Overdue lists the most recently slipped task first, five at a time.**
  A task that slipped yesterday can still be saved, and a month-old one is
  not news; oldest first put the stalest at the top. **Show 12 more** under
  the five lists the rest, and the group's count, Reschedule All, and the
  badge still cover every one.

- **Weeks can start on Monday.** `deckard.calendar.weekStart` is `sunday`,
  `monday`, or `locale`, and sets the Calendar's rows, weekly notes and their
  reviews, a search's `this-week`, and *next week* typed as a date. A weekly
  note written under the old start still opens for the week it mostly
  covers, and a review written in it covers its own days.

- **One way to write a date.** Every date box — the task editor, Due on a
  Date, Reschedule, bulk edit, `[[` day links, and Capture — reads month
  names (`oct 3`), `next week`, `end of month`, `last friday`, `3 days ago`,
  and your display language's numeric dates (`10/3`), and says back the day
  it read and how far off it is, such as *Monday 2026-09-28 · in 3 days*.
  Words it cannot read get one message everywhere. Due Next Week is now
  **Due Next Monday**, which is what it did; `+1m` from January 31st is
  February 28th, not March 3rd.

- **Searches name weeks and months.** `created = last-month`,
  `due <= friday`, `due = this-week`, `created = 2026-08`, and any day in
  plain words, such as `due <= "oct 3"` or `due <= end-of-month`. Their
  completions say the days each covers, and Refine gains a **Created**
  facet by month.

- **The release notes come from this changelog.** Each release now cuts
  `## Unreleased` into its own dated section, which the GitHub release and
  the Extensions view's Changelog tab both show. A feature release is not
  cut until its three Highlights are written.

### Fixed

- **A link to a heading is a link, not a tag.** `[[#Heading]]`, with an
  alias or as an embed, made `#Heading` a tag, and so did the target of a
  Markdown link such as `[see](#heading)`. Nothing inside `[[…]]` or a
  link's target is a tag now: the index, the editor, completion, Rename Tag
  and Merge, bulk edit, and Move Tags to Front Matter all leave it alone,
  and a tag written right after the link still counts.

- **A tag written inside inline code is text, not a tag.** `` `#project/x` ``
  or `` `@dana` `` in a sentence made a real tag, counted, colored, and
  completed like one; only fenced code was left alone. Code spans of any
  number of backticks are now skipped everywhere tags are found: the index,
  the editor's tag colors, links, and hovers, completion, Rename Tag and
  Merge, bulk edit, Move Tags to Front Matter, and the Task board's status
  moves. A backtick that nothing closes is plain text, as in CommonMark.

- **Rollover carries a task's steps with it, and never under another
  task.** A carried task's open steps are written nested under it — with
  `move`, its done steps and notes too, so nothing is left orphaned — and
  a step whose task is not carried comes forward at the top level. It used
  to be written with its old indentation under whichever task came before
  it in today's note, and two tasks' steps with the same words were merged.

- **Opening a Find result to the side keeps Find open.** It moved focus
  into the editor, so Find closed whenever the editor won the race; it now
  leaves focus in Find.

- **Saving a search says search, and places are called by their names.**
  Find, the search pages, and the Task Board all title the box **Save
  search** and say *A saved search needs a name.*; Find no longer says
  "filter" or "view". A query block's lens says **Open search page**; the
  reminder's button is **Open Tasks View**; the unreadable-note message
  offers **Open Stats** and **Open Log** and counts files; Home's Workspace
  widget says **Namespaced tags**, as Stats does; tagging a heading asks
  about a person, project, or topic rather than an "entity".

- **A message's weight follows one rule.** An error means nothing was
  written; a warning means it was written with a caveat; a message that only
  asks for a note or a folder to be open is information, and one that needs
  a folder offers **Open Folder…**. Capture keeps the words it could not add
  with **Copy Task**; a note that already exists offers **Open Note**; a
  heading rename that needs the note saved offers **Save and Rename**; a
  drag onto several tasks in the Tasks view says its refusals once.

- **A note that changed underneath is said one way, with the note to open.**
  Nine messages said a note had changed since Deckard read it in seven
  different ways, some as warnings; each now says *atlas.md changed after
  Deckard last read it, so nothing was written.* as an error, with **Open
  Note**. Undoing a review, a rollover, or a write whose notes have all
  changed says the same. A bulk edit tells results already as asked from
  results whose notes changed, and says the second as a warning.

- **A screen reader hears a task's whole title.** What the Task board and
  the search pages announced about a task — *Completed …*, *Moved … to
  Todo* — dropped every letter s from its title, since a pattern in the
  page script lost its backslash.
- **The search page's format buttons show their own mode.** Source shows
  `<>` and Rendered shows the eye; they were swapped.

- **A query block's Open in search lens names the page it opens.** Its
  tooltip said the Dashboard's Search tab, which no longer exists; it now
  says a search page.

- **Refine's Updated counts say which days they cover**: Last 7 days,
  1–4 weeks ago, and Older. "This week" and "This month" read as calendar
  spans, but the counts were rolling ones, so a note from last Saturday
  could sit under This week on a Wednesday.

- **Copied rollover carries a task once.** In `copy` mode each day's note
  keeps the task it copied forward, so a task that had waited three days
  arrived three times, and the daily note's Carry in lens counted it three
  times. Only the newest copy is carried now.

- **Finishing a repeating task in the task editor, or from the assistant,
  starts the next one**, as a checkbox does. Both wrote the completed line
  and nothing else, so the task never came back. Both now honor
  `deckard.tasks.addDoneDate` too.

- **A repeat rule Deckard cannot read is said where the completion is,
  beside Undo.** A checkbox said "Completed" and then, in a second message,
  that the rule could not be read. It is now one warning with Undo. Bulk
  edit, the task editor, and the assistant say it too; before, they said
  nothing.

- **The section band shows on light themes, and only behind the section the
  cursor is in.** It was a white tint behind every tagged section at once,
  invisible on a light theme. Its colors are now the theme colors
  `deckard.sectionHighlightBackground` and `deckard.sectionHighlightBorder`.
  Every tagged entry keeps its Show related notes and Pin to Home hover.

- **`node_modules` stays out of the index.** Deckard now leaves out what
  `search.exclude` hides, as well as `files.exclude` and `deckard.exclude`,
  and skips those folders while scanning rather than after reading them.
  If you keep notes in a folder hidden from search, set its pattern to
  `false` in `deckard.exclude` to index it again. The hint about large
  workspaces is now said once per workspace, not once per machine.

- **Tag boxes, lenses, hovers, and completions stay in notes.** In a code
  repository they appeared in every README, including those under
  `node_modules` and outside `deckard.notesFolder`, and their tag links led
  into an index those files are not part of. Edit Task and query blocks
  still work in any Markdown file, since both are asked for on purpose.

- **The daily reminder comes once a day, late rather than never, and the
  count turns over at midnight.** Each window kept its own timer, so three
  windows said it three times, and a laptop asleep at the hour never said
  it. The reminder is now said by the first window to check on or after the
  hour, and the status bar's count moves to the new day without waiting for
  the window to regain focus.

- **Capture stays open when you click away, and keeps what you were
  typing.** Clicking into the editor closed the box and lost the words, and
  so did closing the heading picker in Capture Under a Heading. Words not
  yet written come back the next time the same command opens, and the title
  says so.

- **Reset graph can be undone.** It discarded every slider, filter, and the
  camera at once; **Undo** now sits beside it for eight seconds, with the
  focus on it.

- **Two notes' sections or tasks no longer share an id, and one of them no
  longer vanishes.** Ids were a 32-bit hash of the note, line, and text;
  at 5,000 notes about one workspace in five had two entries hash alike,
  and the index kept only one, so a section or task silently went missing
  from every view. Ids are now twice as wide. Task order and view counts
  kept under the old ids are carried over to the new ones.

- **Extract Heading no longer deletes the new note when the old one is left
  half-written.** When the old note could be neither saved nor put back,
  Deckard deleted the new note, leaving the heading only in a file whose
  open editor showed the link, so saving that editor lost it. The new note
  is now kept, and the message says the heading is in both and what to do.
  The raw error goes to the log, with Open Log beside the message.

- **A task change that did nothing says so.** Checking a task whose line was
  now past the end of its note, or whose edit VS Code refused, did nothing
  and said nothing. Each now has a message, and a change made in the editor
  but not saved says to save the note, with Open Note.

- **Adding a tag to a heading with closing hashes, or a line ending in a
  block id, keeps both working.** Bulk edit's Add a tag wrote the tag at the
  very end of the line, so `## Title ##` stopped being closed and `^id`
  stopped being a block id, breaking links to it. The tag now goes before
  them.

- **Stats' Tasks tile opens every task.** It opened a search for
  `has:task`, which Deckard does not read, so the page opened on an error.
  It now searches `is:task`.

- **The calendar keeps keyboard focus through an update.** Every save in
  the workspace redrew the month and dropped the focus, and so did PageUp
  and PageDown. The focus now stays on its day, and a step into another
  month lands on the day it stepped to.

- **Help marks the section being read.** Its panel was created without
  scripts, so the navigation rail's marker had never run in VS Code.

- **Changing Related Notes' Sort re-sorts the list at once.** The new order
  was saved but not drawn until the next save or cursor move, and a redraw
  in between put the select back to the old order.

- A configured status named done adds no column beside Done.
- A date on a board card stays one word.
- Every text pair reads at 4.5:1, and the contrast baseline is empty.
- A title that carries the shared tag inline says it once too.
- Graph labels read the type step as pixels.
- Overdue keeps its color on LCARS board cards.
- The sidebar's tag list wraps.
- The danger red clears 4.5:1 on a hovered card.
- Function words are not similar terms.
- A half-width widget is half the width.
- The mark on a searched Tags tab is the size of a tab.
- A saved search's criteria open in the row's own frame.
- The pointer passes through an entry's provenance.
- A Related Notes path does not repeat what the card says.
- A task's details sit on one line with the priority badge.
- A dropped card no longer flickers back to its old column.
- The provenance frame follows a one-sided border.
- The frame carried down keeps a theme's rounded corners.
- Zen mode turns off where a workspace turned it on.

## 1.21.0 - 2026-09-25

### Highlights

- One spacing scale and one layout: board columns read as regions, and a search says its count once.
- One meaning per color: red is overdue or high priority, and nothing else.
- Buttons and commands follow one naming table.

### Changed

- **Layout: columns are regions, a count is said once, and Home widens.**
  Board columns now stand on a ground half a step above the page in every
  theme, so five headers over one field of cards read as five columns. A
  search page said its result count three times, in the tab, the pane
  heading, and the Refine strip; in the tabs layout the tab says it once,
  and the heading and strip repeat it only in the split layout, where there
  is no tab. Refine's groups are labeled regions rather than a run of chips,
  and Sort sits in the gear with the other view options. The Dashboard
  takes the panel's width up to 1400px, with three columns of widgets on a
  wide editor and one on a narrow panel.

- **One spacing scale.** The shared sheet spaced cards, rows, columns, and
  margins with twenty different literals, and zen mode tightened them by
  restating a dozen rules with a second set. Every padding, gap, and margin
  in the shared sheet is now a step of a six-step scale, `--space-1` to
  `--space-6`, zen re-declares the steps and restates no rule, and a test
  holds the sheet to the scale. Cards and columns sit a pixel or two
  differently as a result; nothing moved by more than that.

- **Color: one meaning per hue, and one filled button.** Red marked an
  overdue date, a high priority, a negated search term, and the favorite
  heart, so a reader who had learned that red means late read a heart or a
  NOT chip as urgent. Every state now takes a meaning token, `--danger`,
  `--favorite`, `--positive`, `--focus`, `--accent`, mapped by theme: the
  heart is gold, a NOT term is a dashed, struck chip in the muted color, and
  red is overdue or high priority and nothing else. The Search button is the
  one filled control on a page, since a chosen segment is now marked rather
  than filled. Replicant's, Synthwave's, and Tomcat's cyan and green were
  fully saturated on near-black, which blooms around thin text; they are
  softened a step, hues unchanged, and every pair still clears the contrast
  suite. Cooper stays gold on black. On the board, an open task tagged
  `#status/done` now heads the built-in Done column instead of getting a
  second column called Done.

- **Controls: chosen apart from hovered, one icon set, and no target under
  24px.** A chosen segment and a hovered button were both drawn amber, so
  hovering to learn what a click would do showed the chosen state and a
  chosen control under the pointer lost it. Chosen now keeps the control's
  own ground with the accent as a border and a bar along its foot, and hover
  raises the ground; Corpo follows with VS Code's own colors, and its Search
  button stays the one filled control.
  The glyphs pages drew for themselves, the same sort arrow four times over,
  come from one 16px set in `icons.ts`, and the graph's zoom buttons take
  glyphs in place of typed signs. Home's paging steppers, the favorite
  heart's control, and the relevance rail's button grew to the 24px WCAG
  2.2 asks of a pointer target.

- **Buttons and commands follow one naming table.** Bulk Edit is Bulk edit;
  Clear, Clear search, and Clear the search are Clear; a widget's Apply is
  Save; Export says what it exports; Reset and Fit say what they reset
  and fit; Home's customizing ends with Finish, since Done is a column on the
  board. Show Stats and Show Log are Open Stats and Open Log; Zen Mode is
  Enter Zen Mode; the tag page command has one title, with its ellipsis, in
  the palette and on the Outline's menu; the quick pick is Find in Notes and
  the query page is Search Notes and Tasks. The Home widget that mirrors the
  Tasks view is called Tasks view, and every search page's eyebrow says
  search page. The table is in `docs/components.md`, and a test holds it.

## 1.20.0 - 2026-09-24

### Highlights

- A due date says how far from today it is, in words.
- The Notes Graph opens around the note being written, and names its hubs.
- Every context menu opens from the keyboard, and no text is under eleven pixels.

### Changed

- **Working labels read as written in every theme.** Column titles on the
  board, group headings in lists, table headers, the Refine label, and the
  labels beside controls were set in tracked capitals in the film themes, a
  style that reads measurably slower at eleven pixels and that a reader
  scans dozens of times. They now read as written everywhere; the eyebrow
  above a page title and the title itself keep the capitals, which is where
  the display voice belongs. Palettes, glows, and backdrops are unchanged.

- **Related Notes says strong, moderate, or weak instead of a percentage.**
  Each result carried a score such as **33%**, which reads as a precision
  the ranking does not have, and two notes at 33% and 41% invited a reader
  to work out why. The result now carries the three-step rail Refine already
  draws, filled for a strong, moderate, or weak relation, and the exact
  score waits in the breakdown behind it with the signals and weights.

- **No text under eleven pixels.** Counts, captions, the calendar's due
  marks, the graph's labels and readouts, and a handful of section labels
  were set at nine or ten pixels, in muted monospace, which is below where
  fluent reading holds at a laptop's viewing distance. The pages now share
  a four-step type scale, `--text-xs` to `--text-lg`, with eleven pixels as
  its floor, and every smaller size has risen to it.

- **The Notes Graph opens around the note being written, and names its
  hubs.** It opened on the whole workspace, hundreds of unlabeled dots with
  focus off and a line saying to open a note, which the reader usually had.
  It now opens around the note in the editor, one hop out, when there is
  one, and keeps whatever scope the reader then chooses. At rest the whole
  graph labels its dozen best-connected notes on screen, so the overview
  reads as places rather than as density; zooming in still names the rest.

- **Home says it can be arranged only until it has been.** The line
  "Home is yours to arrange." was drawn above the widgets on every visit.
  A fixed line of instruction is read the first few times and skipped after,
  and it cost a row on the page opened most. It is now drawn only while Home
  still holds the widgets it started with, and goes for good once a widget
  has been moved, sized, or swapped, or the reader chooses **Dismiss**.
  Customize stays in the gear throughout.

- **The search box's line of syntax shows while the box is in use.** The
  line under every search box listing words, `#tags`, `is:open`, `AND`,
  `OR`, `NOT`, and the `/` shortcut was drawn at rest on every page, where
  it competed with the results beneath it; the placeholder already said
  most of it. It now shows while the box has focus or holds a term, and
  rests otherwise. **Builder** stays, and a search that could not be parsed
  still says so.

- **The Task Board says when almost nothing carries a status.** Status is
  the board's first grouping and a status is a tag most notes never write,
  so the first board a reader saw was one tall **No status** column and four
  near-empty ones. While fewer than a quarter of the open tasks carry a
  status, a line above the columns now says how many have none, how to give
  a task one, and offers **Group by due date**, which works for any task.

- **One vocabulary for what the index holds.** The Dashboard counted
  "entities" and "sections", Stats counted "Markdown files", "Note entries",
  "All tags", and "Canonical tags", the Notes Graph counted "notes", and a
  reindex said it had indexed 51 notes when it meant files. Every page now
  uses the same four words: a **file** holds **notes**, the headed entries,
  which hold **tasks** and carry **tags**. The Dashboard's tiles count notes,
  tasks, and tags; Stats says files, notes, tags, and namespaced tags; and a
  reindex says how many files it read and what it found in them.

- **A due date says how far from today it is, in words.** A task row read
  **DUE 2026-09-08**, in red when the date had passed, so a reader subtracted
  the date from today and an overdue task was told apart by color alone.
  Everywhere a task is listed, Home, search pages, the board's cards, list,
  and table, and query blocks, the date now reads **Overdue 15 days ·
  2026-09-08**, **Due today**, **Due tomorrow**, or **Due in 3 days**, with
  the date beside it for anyone who cites dates. Beyond a month either way
  only the date is written, and a done task keeps its date as written.

- **Capture and Create Daily Note have shortcuts.** The two commands run
  most often each day went through the Command Palette every time.
  Cmd/Ctrl+Shift+Alt+C captures a task and Cmd/Ctrl+Shift+Alt+D opens
  today's note, in the same family as the search and task shortcuts. Both
  are rebindable, and the Help page's command table lists every shortcut
  beside its command.

### Fixed

- **Every context menu opens from the keyboard.** The menu on a tag, a
  result, and a ranked row opened on a right-click alone, so rename, pin,
  and move to top or bottom could not be reached without a pointer. The
  menu key, Shift+F10, and Alt+Enter on the focused element now open the
  same menu at it, and Escape gives focus back.

- **A search's Notes and Tasks tabs behave as the tabs they said they were.**
  They carried the tab role, which tells a screen reader to expect one tab
  stop and arrow keys between them, and had neither. The chosen tab is now
  the tab stop, Left, Right, Home, and End move between them, and each tab
  names the panel it shows.

- **The file and line under a task can be read in every theme.** The base
  sheet colored them with a literal gray that sat at 1.85:1 on a dark
  panel, well under the 4.5:1 that WCAG asks of text this size, and only
  Corpo and Synthwave restated it. They now take the muted token every
  theme declares, which is 5.2:1 in the default palette.

- **The status bar counts overdue and today separately.** It read
  **22 due today, 17 overdue** when five tasks were due today, because the
  first number was both groups added together, and the Tasks view it opens
  said 17 and 5. It now reads **17 overdue, 5 due today**, and the reminder
  and hover say the same in a sentence.

## 1.19.1 - 2026-09-23

### Highlights

- A note finds where it is mentioned without a link, and links it.
- An assistant can add a task, or change one, with Deckard's own safeguards.
- Favorites, pins, and saved searches are never deleted on their own, and survive opening another folder.

### Added

- **A note finds where it is mentioned without a link, and links it.**
  Backlinks counted only the notes that had already written `[[Atlas]]`;
  the ones that wrote "Atlas" were invisible to it. A note now says
  **Mentioned in N notes without a link** on its first line when other
  notes write its title or an alias as plain prose, lists them in the
  references peek, and **Link N mentions** turns each into a `[[link]]`
  that keeps the name as written. Links, code, tags, Markdown links,
  headings, and front matter are left alone, as are names under three
  characters and names another note shares. The write is previewed and
  undone like Deckard's other multi-note writes, and each mention is
  checked against its line before it is touched.
  `deckard.editor.unlinkedMentions` turns it off.

- **An embed that cannot draw says so in the editor.** An `![[Note#Heading]]`
  whose heading was renamed drew a message in the preview and nothing at
  all in the editor, where the fix is made. It now carries the same
  message above its line, **Embed: Atlas has no heading "Decision"**, which
  opens the note it names. An embed that draws carries nothing, and one
  whose note name opens no note is left to the link problems, which count
  it already. `deckard.editor.embedProblems` turns it off.

- **A note says how many of its links open no note, and creates the
  missing ones in one go.** The diagnostics marked each broken `[[link]]`
  where it was written, which in a long note is below the fold. Its first
  line now says **N links open no note**, listed in the references peek,
  and **Create N missing notes** makes a note for every name no note has,
  never touching one already there. A name several notes share is counted
  but not created. `deckard.editor.linkProblems` turns it off.

- **A daily note steps to its neighbors, and today's offers what is still
  open.** Above a daily note sit the dates of the daily notes before and
  after it, skipping empty days, and today's note says **Carry in N
  unfinished tasks** while earlier daily notes hold open tasks it does not,
  which runs the rollover. Tasks already in today's note are not counted,
  so a copy-mode rollover does not keep offering them, and a note with no
  neighbor on a side has no arrow there. `deckard.editor.dailyNoteActions`
  turns it off.

- **A task says what it waits on, and what it holds up.** `⛔` and `🆔`
  were read by `is:blocked` and `is:blocking`, but nothing in the editor
  showed them. A task with dependencies now carries **Waiting on N open
  tasks** or **Blocks N open tasks** above it, across notes, which lists
  them in the references peek, and a `⛔` name no task carries is named
  outright. Only open tasks count, so a task whose dependencies are done
  shows nothing. `deckard.editor.taskDependencies` turns it off.

- **An assistant can add a task, or change one, with Deckard's own
  safeguards.** The query and tag tools were read-only. `deckard_add_task`
  adds a task to today's note or to a note the assistant names, and
  `deckard_change_task` completes, reopens, retitles, dates, prioritizes or
  hands over one existing task, named by its note and line as
  `deckard_query` reports them, touching only the fields it names and
  keeping the line's own format. An assistant asks before either runs,
  every time rather than once a session, and nothing is written until the
  user approves the exact line in the refactor preview Deckard's own
  multi-note writes use - whatever `deckard.previewWorkspaceWrites` says.
  Over MCP, where there is no dialog, that preview is the guard. A change
  is refused if the line is no longer the task the index knows there, so an
  assistant working from a stale answer cannot rewrite whatever is on that
  line now, and `Deckard: Undo Last Change` takes a write back afterwards.

- **Every page is compared, pixel for pixel, to how it looked.** The layout
  check measures geometry and the contrast check reads color pairs; neither
  can see a backdrop a theme paints, a glow that came back, or a control
  that moved - zen mode shipped with Cooper's dotted grid still showing, and
  it took a screenshot to notice. `npm run test:visual` takes that
  screenshot for every surface, theme and zen state and fails when it
  differs from the recorded one by more than a sliver, with the diff beside
  it. Baselines are kept per platform, since fonts are rasterized by the
  operating system, and a change that is meant is recorded with
  `--update`. It runs in CI after the layout check.

- **A search's results can be taken out.** Deckard reads the workspace and
  writes back into it; nothing leaves. A result copied out as Markdown or
  CSV makes it usable in a pull request, an issue, or a message, while the
  index itself still never leaves the machine. **Export**, beside Bulk Edit
  over a search page's notes or tasks and beside Save on the Task Board,
  takes everything the search found - not only the page on screen - as a
  Markdown table, a list with a link to each result, or CSV, and copies it
  or saves it to a file. A comma, a quote or a line break in a title is
  quoted the way a spreadsheet expects, and a pipe is escaped the way a
  Markdown table expects.

- **`Deckard: Create a Sample Workspace` gives a new reader something to
  look at.** The walkthrough says what a tag and a hub note are; it cannot
  show one being found. Seven small notes can - three daily notes with
  tagged headings and dated, prioritized tasks that name people; two
  project hubs with `describes:` front matter; a person; a team - and they
  are copied into a `deckard-sample` folder inside a folder of the reader's
  choosing, never on top of anything already there, and offered to be
  opened. A README beside them says what each shows and what to try first.
  The walkthrough's first step offers it beside creating today's note.

- **`Deckard: Check My Setup` says what the settings add up to.** Deckard
  has forty-nine of them, and the effect of most is that something is
  silently not there: a notes folder that does not exist, an exclude
  pattern wider than meant, a `deckard.me` that names nobody. Reading the
  settings does not say which. The check writes up, as a Markdown document,
  what they resolve to in this workspace - where notes are read from and
  whether that folder exists, how many files the last scan found and how
  many the templates folder and the exclude patterns kept out, which notes
  could not be read, what the index holds, and whether `deckard.me` matches
  a person any note names - with what to do beside each thing that is off.

- **A note Deckard could not read is said, not just logged.** A read that
  fails went to the log, which nobody opens; the note was simply missing
  from every search, which looks like a bad search rather than a missing
  note. Deckard now says so the moment it happens, once per note, with
  Show Stats and Show Log beside it, and Stats lists every such note with
  the reason - one line, not a stack - so a search that comes back short
  has somewhere to be explained. A note that reads again on its next save
  leaves the list on its own.

- **What a workspace remembers can be taken back.** A moment after each
  change, Deckard writes a copy of its favorites, pins, saved searches,
  widgets and view counts into the workspace's storage and keeps the last
  twenty. `Deckard: Restore Favorites, Pins, and Searches from a Copy`
  offers them newest first; `Deckard: Export` writes the same thing to a
  JSON file of your choosing, and `Deckard: Import` reads one back. Each
  says what it holds, and what is here now, before replacing anything, and
  the current state is copied first so a restore can itself be undone. A
  store that was never copied was a store one bad write could end, and
  Deckard has now had that bug once.

### Fixed

- **The builder can build anything the search box can say.** It edited one
  shape - OR groups of AND rows - so what Refine makes with three clicks and
  an Alt, `(a OR b OR c) AND NOT d`, had its OR half flattened to a line of
  text it could only keep as written, and there was no way to build that
  shape from the builder itself. It now edits the query as it is: rows and
  groups nested as deep as the search goes, every group saying whether it
  matches all of its rows or any of them, and **not** turning a group
  around. Nothing is shown as text any more. A nested group is written back
  with its parentheses whatever its join, which also mends a hand-written
  `(a OR b) AND c` that came back from the builder meaning `a OR (b AND c)`.
  A group emptied of its rows goes with them, rather than staying behind
  as a box with only a head.

- **The search box shows a search the way the builder does.** A search
  whose top level was an OR, or that held a parenthesized group, was one
  chip that could only be removed whole. Now the branches of an OR are
  chips of their own, a group is a frame of its own chips with its own
  **×**, nested as deep as the search goes, and a condition inside a group
  can be removed alone, cutting it out of the search as written. Anything
  turned around with `NOT` or `-`, a condition or a whole group, is drawn
  in red.

- **Deckard no longer deletes a favorite, a pin, or a saved search on its
  own.** Pruning used to remove any of them whose tag or note the index had
  stopped mentioning, which treated a guess as a decision. Now it collects
  only what Deckard derived for itself — view counts, access order, when a
  tag was first seen — and leaves what a reader chose alone. `Deckard: Tidy
  Favorites, Pins, and Saved Searches` lists what points at nothing in this
  workspace any more and removes it only when asked; a saved query is never
  on that list, since it can name a tag that does not exist yet.

- **Favorites, pins and view counts survive opening another folder.** They
  were kept machine-wide, and every index update deleted any key the current
  workspace did not contain — so opening any other folder holding a Markdown
  file, a repository with a README being enough, emptied the favorites,
  pinned notes, saved searches and tag and note view counts belonging to the
  notes workspace. A window with no folder open did the same thing, which is
  the state VS Code is in while a VSIX is installed from the Extensions view,
  and is where most people will have met this.

  These name what is in a workspace, so they are now kept with it. The first
  workspace opened after this release adopts what was stored machine-wide, so
  a reader with one set of notes sees no change; a second workspace starts
  clean instead of inheriting tags it does not have. What stays machine-wide
  is presentation — sort modes, column counts, layouts, page sizes — which
  means the same thing everywhere and is never pruned. A whole copy is still
  written machine-wide, so an older Deckard reads it, and so a workspace whose
  own storage VS Code has cleaned up is seeded rather than empty.

  Pruning itself also now refuses to run against an index holding nothing,
  which is not evidence that every note was deleted.

- **A task's title is Markdown in the table too.** The Task Board's table and
  a query block's table of tasks printed the title's source, so a task written
  with `**bold**`, a `` `command` ``, or a link read as its own markup while
  every other surface that shows a task drew it. Both render it now, through
  the same sanitizer the board's cards use. The plain words are kept beside
  the rendered form, since that is what a checkbox's label and a sort by title
  read. A link written inside a title is flattened to its words in a query
  block, where the whole cell is already one link to the task's line and an
  anchor inside an anchor closes the outer one early.

## 1.19.0 - 2026-09-22

### Highlights

- Zen mode turns Deckard's own chrome down without taking anything away.
- The Task Board can be a table, and so can a query block of tasks.
- The search is the filter on every page, and the Task Board edits the Tasks view's search.

### Added

- **Zen mode turns Deckard's own chrome down without taking anything away.**
  Before a note is read, a page spent its first screen on a decorative
  eyebrow, invented telemetry codes over the workspace totals, a grid
  backdrop, a permanent line of query syntax, and a file name, heading and
  line under every single row. Zen hides the ornament, thins the borders and
  headings, and folds each row's provenance away until the row is hovered or
  focused. Every button, filter, count, checkbox and tag stays exactly where
  it was: what it hides is moved off-screen rather than out of the page, so a
  screen reader still announces it and find-in-page still finds it. A task's
  due date, priority and overdue marker never fold, because they are the
  point of the row rather than chrome, and a search that could not be parsed
  still says so. Turn it on from the gear on the Dashboard, a search page or
  the Task board, from `Deckard: Zen Mode`, or with `deckard.zenMode`. It is
  one switch for every view, and it composes with all eight themes rather
  than replacing one — a theme picks the colors, zen picks how much frame
  is drawn around them.

## 1.18.0 - 2026-09-20

### Highlights

- The Agenda is now the Tasks view, grouped by what you choose, and what is due shows in the status bar.
- One edit can be made to everything a search found, shown before it lands and taken back afterwards.
- A new daily note can carry the last one's unfinished tasks in, and a weekly or monthly note opens with its review.

### Added

- **Renaming a note carries its links with it.** A `[[link]]` names a note by
  its title, so renaming one in the Explorer broke every link to it and left
  the diagnostics to report the wreckage afterwards. The links are rewritten
  as part of the rename, so one Undo takes back both, and Deckard says how
  many it changed in how many notes. Only links that resolved to the renamed
  note are touched: one written through an alias the note keeps still opens
  it, and one naming a different note that shares the title is not Deckard's
  to change. A heading, a `^marker`, and display text after `|` are kept as
  they were written, and a note that only moves folders changes no link at
  all, because a link names a title and not a path.
  `deckard.updateLinksOnRename` turns it off.

- **A week or month note is named for the days it holds.**
  `week-2026-09-13-2026-09-19.md` and `month-september-2026.md` say what they
  are from a file list, where `2026-W38.md` said little. A week runs Sunday
  to Saturday, as the Calendar draws it, so one row of the calendar is one
  week note; `{week}` in a template becomes those days and `{month}` becomes
  *September 2026*, matching the names. The names Deckard wrote before are
  still read, and still opened for their period, so a workspace holding
  `2026-W38.md` goes on using it rather than gaining a second note for the
  same week. The Calendar's week rail is a mark rather than a number, since
  the note is named for the days the row already shows.

- **The Help page is a reference again.** It had grown into a wall of cards
  that said less than the README and had fallen behind the extension: the
  settings were prose, the query language had no table, and features shipped
  without it noticing. Its commands and settings tables are now built from
  what Deckard actually contributes, so they cannot go stale, and a test
  holds the page to that — every contributed command and setting has to
  appear on it. The guide is grouped in the navigation (Writing, Tasks,
  Finding, Keeping notes, Reference), with tables for the task markers, the
  query shorthands and fields, what counts as a note, and every setting.

- **Refine says what a click does to the search.** Each value sat between a
  − and a + that were invisible until hovered while still holding their
  width open, and the tooltip described the modifiers without naming what
  they wrote. The two buttons are gone, and hovering a value now reads the
  three things a click can do in the words of the query itself: **AND** this
  clause, **AND NOT** it, or **OR** it with the value chosen before. The
  search page, the Task board and the sidebar all say it the same way, and
  <kbd>Enter</kbd>, <kbd>Alt</kbd>+<kbd>Enter</kbd> and
  <kbd>Shift</kbd>+<kbd>Enter</kbd> do the same from the keyboard.

- **Tasks can be dragged in the Tasks view.** Dropping one on another ranks
  it there, in the same order the Task board's list uses, which writes
  nothing to your notes. Dropping one on a group makes it belong to that
  group — a priority, a status, **Today**, or a person — through the same
  checked edit the board's drops make; a person is handed the task by
  rewriting the name on its line, leaving anyone else named there a mention,
  and **Nobody named** takes the name off. **Overdue** and **Upcoming** cover
  a range of days rather than one, so they name no edit and say so.

- **The Agenda is now the Tasks view**, which is what it lists. Its settings
  keep their `deckard.agenda.…` names, so nothing configured has to change.

- **The Tasks view groups by what you choose.** It grouped one way — Overdue,
  Today, Upcoming — which is the right default and the wrong one as soon as
  you want to see a person's work, or everything waiting, or what is most
  important. **Group by** in its title offers **Due status**, **Priority**,
  **Status**, and **Person**, kept in `deckard.agenda.groupBy`. Priority
  groups are marked with the emoji their task lines use, and **No priority**
  sits last, where a reader looks for it. The tasks are
  the same whichever is chosen, so grouping changes the axis rather than the
  list. Within a group, tasks ranked on the Task board lead in the order they
  were dragged into, and the rest follow as they did before.

- **The Task board searches instead of filtering, and opens on what is
  open.** Its All/Open/Done switch was obeyed by the list and ignored by the
  board, which quietly filtered one view and not the other. The switch is
  gone: the search box says the same thing for both views, and the board
  opens on `is:open`, since a board is for what is still to do. Clear the
  box for every task, or search `is:done` for the finished ones.

- **The calendar keeps its dates still, and starts its weeks on Sunday.** A
  day with a note or a due count drew taller content than a day without one,
  and a button centers what it holds, so dates wandered up and down the grid
  depending on what each day had. Every day is now the same three rows — the
  date, a dot, a count — drawn whether or not there is anything to mark. The
  week-number column is gone, and weeks run Sunday to Saturday; a weekly
  note is opened with `Deckard: Open Weekly Note`, and a row still belongs to
  the ISO week its weekdays fall in.

- **Undo puts notes back without opening them.** Taking back a write that
  reached several notes opened every one of them in the editor, leaving a
  row of tabs to close after undoing one thing. A note nobody has on screen
  is written straight to disk now; one that is open, or has unsaved changes,
  still goes through its editor so what is on screen stays in step. The
  rollover's message also offers **Open**, for the day's note it wrote into,
  which it may have just created.

- **A rollover reaches past yesterday.** It read the single most recent
  daily note and stopped there, so a task left open on Friday did not come
  forward on Monday if the weekend had a note, and a workspace whose last
  daily note happened to be finished reported that nothing was waiting while
  older notes still held open tasks. Every earlier daily note is read now,
  oldest first, and `deckard.dailyNote.rolloverDays` bounds how far back —
  the default, `0`, reaches as far as the notes go. What it says when it is
  done names how many notes it drew from and the oldest day among them, and
  carries **Undo** beside it.

- **Pinning pins the note you are in, not the file it is in.** A note in
  Deckard is an entry, but a pin was a path: pinning from inside a note's
  sixth section put the file on Home, titled with its first heading and
  opening at line 1. A pin now names the entry — kept as the heading's text,
  its level and which heading of that text it is, and resolved each time
  Home draws, so writing above a pinned heading does not lose it. A heading
  that is gone leaves the pin on its note and says so rather than vanishing,
  and a pin kept from an earlier version still means the whole note.
  Pinning moved to where the note is, too: the command pins the entry the
  cursor is in, the hover on a tagged entry offers **Pin … to Home** beside
  its related notes, and a search result offers it on right-click — each
  with **Undo** beside what it says. Home's own **Pin** button is gone,
  since Home is the one place the note being pinned is not in front of you.

- **The task editor says who a task is for.** Assignees shipped as "the
  first person named on the line", but the editor had no field for one, so
  the only way to hand a task over was to write the name in the right place
  yourself. **Assignee** offers the people your notes already name: choosing one
  replaces whoever was named first, anyone named after them stays a mention,
  and **Nobody** takes the first name off, which hands the task to whoever
  is named next.

- **`Deckard: Edit Task` and `Deckard: Add Task` build or edit a whole task
  at once.** Metadata
  could be typed after `/` one marker at a time, which is fine for adding a
  due date and poor for writing a task that has several of them. The command
  opens the task on the cursor's line as a list of its fields — description,
  status, due, scheduled, start, priority, repeat rule, what it waits for,
  and a tag — headed by the line as it will be written, and each field opens
  its own step and comes back. Dates are taken in plain words (`friday`,
  `next monday`, `in 3 days`, `+2w`), with the day read back as you type.
  Nothing is written until **Write the task**, the line keeps its format and
  the parts Deckard does not edit, including a trailing `^block-id`, and the
  editor is also on the lightbulb as **Edit task…**. A line that is not a
  task yet becomes one, keeping what was written on it — which is why the
  command has two names: the palette offers **Edit Task** when the cursor is
  on a task and **Add Task** when it is not, and both run the same editor.

- **A review is named by the days it covers**, such as *Review of
  2026-09-14 to 2026-09-20*, rather than by a week number that says little
  read back; the note it sits in still names the period. What Deckard says
  when it writes one now offers **Open**, which opens the note at the review,
  and **Undo**, which takes the review back out of it.

- **A weekly or monthly note opens with its review written in.** A periodic
  note opened from its template and said nothing, though the index could
  already answer what the period came to. A review now lists what was
  completed, what was due by the end of the period and is still open, the
  notes written and the notes changed, and the tags first seen — as ordinary
  Markdown, because a review should say what that week was rather than what
  this week is. It sits between two comments, so writing it again replaces
  only itself and leaves what you wrote around it. It carries no tags of its
  own and lists no task as a task, so a review never becomes an entry in the
  searches it reports on. `Deckard: Write a Review` writes or refreshes one
  on request, and `deckard.periodicNote.review` turns off the one a new note
  gets.

- **The Notes Graph can be drawn around one note.** It has always drawn the
  whole workspace, which says what the workspace looks like; **Focus →
  Around this note** answers the other question, what this note is actually
  attached to. **Hops out** reaches one, two, or three connections from the
  note in the editor — a tag association counting as a hop like any other —
  and the graph follows the editor as you move between notes. Only the
  neighborhood is sent to the page, so a local graph costs a screenful
  whatever the workspace holds, and the tag checklist narrows to the tags
  that neighborhood holds.

- **One edit can be made to everything a search found.** A search page is
  where a set of notes and tasks is already gathered, so **Bulk Edit** in a
  results pane now completes them, reopens them, dates them, or tags them
  together, from **Bulk Edit** beside the pane's heading. Deckard asks what to do and then lists the results with every one
  chosen, in VS Code's own list, so unpicking any leaves it alone. Every line
  is compared with the line the index recorded before it is touched — the
  check a single checkbox already made — so a task edited since is left as
  its author left it and counted; completing works exactly as a checkbox
  does, next occurrence included; and a tag is not written twice on a line
  that carries it. The whole edit is one write, previewed when it reaches
  more than one note and taken back by `Deckard: Undo Last Change`.

- **A task knows who it is for.** `@ren-kade` on a task meant both "owns
  this" and "was named here", so there was no way to ask what was waiting on
  whom. The first person named on a task line is now the person it is for,
  and anyone after them is mentioned rather than asked — nothing new is
  written into your notes, since this reads the people you were already
  writing. `assignee = @dana`, `assignee = none`, `is:assigned`, and
  `is:unassigned` search by it, `@dana` and `#person/dana` name the same
  person whichever way either side writes it, and `is:mine` finds what is
  yours once `deckard.me` says who you are. The Task board groups by
  **Person**, busiest first with **Nobody named** at the end; those columns
  take no dropped cards, because who a task is for is written in its
  sentence.

- **Home says who you have not written about lately.** People are
  first-class in the index, but nothing said when a name last came up, which
  is the question a 1:1 or a standing meeting asks. The **People gone quiet**
  widget lists the people missing from the last 30, 60, 90, or 180 days,
  longest ago first, each with how long it has been and what is still open
  with them. It reads `@` tags and `#person/…` tags together, dates a name by
  the newest note carrying it — front matter first, then a daily note's day,
  then the file — and leaves out anyone whose notes carry no date at all
  rather than guessing.

- **What is due today now shows in the status bar.** Every other count
  Deckard keeps waited for a view to be opened; this one is visible while you
  are writing code. It reads **3 due today**, counting the same tasks the
  Agenda's Overdue and Today groups hold, says **1 overdue** and takes the
  warning color when something has slipped, and opens the Agenda when
  selected. A clear day hides it entirely. `deckard.statusBar` turns it off,
  and `deckard.taskReminderTime`, set to something like `09:00`, has Deckard
  say once a day what is due, with **Open Agenda** beside it.

- **A new daily note can carry the last one's unfinished tasks in.** A note
  that starts from its template every morning left last night's open tasks
  behind in yesterday's note, which is the habit that keeps daily notes
  honest in every vault that has one. `deckard.dailyNote.rollover` set to
  `move` takes the unfinished tasks of the nearest earlier daily note into
  today's; `copy` writes them in and leaves them where they were. Each task
  is written exactly as it was — dates, priority, people, tags, indentation —
  and only when its line still reads as Deckard indexed it and today's note
  does not already hold it, so running it twice changes nothing. Other notes
  are never touched: a task filed under a project stays filed there. The
  default is `off`, and `Deckard: Roll Unfinished Tasks Forward` does the
  same thing whenever you ask. The whole rollover is one write, so
  `Deckard: Undo Last Change` puts both notes back.

- **`![[Note#Heading]]` embeds draw the note, section, or line they name.**
  A link to a heading or a marked line already resolved, completed, previewed
  on hover and counted as a backlink; an embed is the same reference read in
  place, in VS Code's Markdown preview. `![[Note]]` draws a whole note
  without its front matter, `![[Note#Heading]]` the heading and everything
  nested under it, `![[Note#^id]]` the one marked line without its marker,
  and `![[#Heading]]` a heading of the note being read — that last one from
  the editor's own text, so it keeps up as you type. Each embed is headed by
  what it read and links to its source line. It needs no minted block ids,
  which is the part Deckard deliberately leaves out. An embed inside a
  sentence stays the text you typed, attachments such as `![[diagram.png]]`
  are left alone, and an embed inside an embed stops at three deep.

- **Stats says which tags look like one idea spelled twice.** Merging has
  existed for a while and Home already names the tags that are new and the
  ones without a hub, but nothing pointed out that `#projct/atlas` and
  `#project/atlas` are the same tag typed twice, or that `#org/acme` and
  `#organization/acme` collide. The new list ranks the clearest pairs first —
  a name written with two markers, in two namespaces, punctuated two ways,
  pluralized, or mistyped — each pointing from the rarer spelling to the one
  the workspace already uses, with **Merge** beside it running the ordinary
  merge, confirmation and preview included. Two letters written the wrong way
  round count as one typo, which is the mistake tags actually collect, and
  spelling pairs are compared only within one namespace.

- **A write that reaches several notes is shown before it lands, and can be
  taken back afterwards.** Renaming or merging a tag rewrites every note that
  carries it, most of which were never open, so an editor Undo could not
  reach them. The changes now open in VS Code's own refactor preview, where
  each one sits under its note and can be left out, and Deckard reports what
  actually landed. `Deckard: Undo Last Change` puts those notes back as they
  were, leaving alone any note changed since — in the editor or on disk — and
  saying how many it left. Favorites and saved searches that followed the tag
  move back with it. `deckard.previewWorkspaceWrites` chooses between
  `severalNotes`, `always`, and `never`.

- **`Deckard: Rename Heading`** renames the heading the cursor is in and
  carries the links into it along, both `[[Note#Heading]]` elsewhere and
  `[[#Heading]]` in the same note. Tags written on the heading stay on it.

- **`deckard.noteBoundaries` decides what counts as a note inside a file.** A
  tagged line has always been a note of its own, so a search for a tag written
  in prose returned the sentence rather than the heading the sentence was
  about. Set to `heading`, a tagged line is no longer an entry: its tags stay
  on the line, and the heading holding the line is what a search returns —
  nothing is copied onto the heading, so a heading still shows only the tags
  its author wrote there, and the match knows which line answered it. A tag
  written in a body does not travel: not up to the headings above it, not
  across to the lines beside it. `marked` is the same, except that a line
  carrying a `^block-id` stays a note of its own, because its author said so.
  A tagged line with no heading above it always stays a note. Tasks are their
  own entry under every setting. The default is `line`, so nothing moves
  unless you ask it to, and `deckard.parseInlineTags` is deprecated: `false`
  now reads as `heading`, which keeps a line's tags searchable rather than
  dropping them.

### Fixed

- **A setting that changes how notes are parsed rebuilds the search cache.**
  The cache compares a scan against what it holds by path, modified time and
  size, so a settings change left it holding entries that no longer existed:
  the files had not moved. It records how its notes were parsed and rebuilds
  when that changes — including a change made while VS Code was closed, which
  nothing else could have noticed. `deckard.personMarker` and
  `deckard.entityNamespaceAliases` had the same latent staleness and are
  covered by the same record.

- **A heading's own text stops at the next heading of any level.** A parent's
  stored text used to contain its children's, so one sentence sat inside the
  text of every entry above it — four deep in the sample notes — and was
  excerpted, indexed and counted once for each. A section now carries its own
  body as well as the subtree that Extract moves.

## 1.17.0 - 2026-09-18

### Highlights

- A search page shows its results a page at a time, and typing narrows the whole search.
- Links can name one line, and Related Notes writes a link to a result.
- Task dependencies can be searched.

### Added

- **A Home widget can page through its entries.** **Paging**, in the widget's
  gear, turns it from the first few into all of them a page at a time. The
  widget grows a line of its own holding **Per page**, the entries it is
  showing, such as *6–10 of 601*, and a chevron either way — a widget is a
  corner of Home walked a page at a time, so it offers no page numbers the
  way a search page does. The page is kept with the widget's other settings.
  The Agenda and a saved search's results stay unpaged: each lists more than
  one kind of thing, and one page number could not say which it meant.

- **Links can name one line.** After `#`, a `[[Check-in#^lift-slip]]` link
  names the line marked `^lift-slip` rather than the note or one of its
  headings, following the Obsidian block-reference convention. Typing
  `[[Check-in#^` completes the markers a note carries, each shown with the
  line it marks; following a link opens the note at that line, and hovering
  it previews the line under the headings it sits beneath. Markers in fenced
  code are ignored, the first of a repeated marker wins, and a link to a
  marker that is gone still opens the note and says so. Deckard reads
  markers and never writes them, so a note is only as marked up as its
  author made it.

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

### Changed

- **Typing in a search box narrows the whole search, not the page on screen.**
  The words used to hide rows of the page the reader was holding, which at
  200 to a page was nearly the whole search and at 30 was not: a match on
  another page was never found, the count read as a share of the search when
  it was a share of the page, and a page whose own rows did not match said
  nothing matched at all. The words are now run as part of the search, so
  what a draft finds is exactly what pressing Enter finds, and the counts,
  the pages and Refine all agree with it.

- **The search cache is written on a thread of its own.** The first build in a
  new workspace wrote every note on the extension host, the thread shared with
  every other extension and with every completion, hover, and CodeLens
  Deckard answers: 159 ms at 940 notes and 1.5 s at 5,000. It now leaves the
  host 14 ms and 45 ms, both under the threshold the log calls Slow. While
  the build runs, a search finds a note by its title and tags before it finds
  it by the words inside it. A rescan that changed nothing still writes
  nothing, and a workspace with no storage of its own, or a machine where the
  thread cannot be started, writes on the host as before.

- **A search page shows its results a page at a time.** A search that matched
  the workspace used to send, and draw, every note and task on every save:
  about 4.3 MB of card text at 940 notes, growing with the workspace, for the
  screenful anyone reads. Each list is paged now, with **Previous**, **Next**,
  the page numbers, and the range being shown under it, and notes and tasks
  are paged separately. **Per page** chooses 10, 30, 50, 100, or 200 results
  to a page, starting at 30, and the choice is kept, so every search page
  opens the way the last one was left. Every count on the page is still of
  the whole search, and a search that shortens under an open page falls back
  to the last page it still has.

### Fixed

- **Tags written together ranks by the notes and tasks carrying both.** It
  counted only tags written side by side on one line, which is the strongest
  case and a rare one: in a workspace where tags are written under headings
  the count was one for every pair, so the list came out alphabetical and
  looked sorted the wrong way round, and every pair that never shared a line
  was left out of it entirely. A pair is now counted over the same entries a
  search for both tags finds, inherited tags included, so the number beside a
  pair is the number the row opens — `#project/argent-protocol` and
  `#person/sable-ortiz` read 8, which is what searching for both shows.

- **A word being typed into a search box survives its own results arriving.**
  Redrawing the page takes the field out of the document, which the browser
  reports as the reader leaving it, and what was typed was let go as if they
  had clicked away. It only showed once typing started searching, because
  that made the draft's own results the commonest redraw of all. The caret
  goes back where it was rather than to the end, so a redraw in the middle of
  a word no longer moves it out from under you. The Task board's search box
  had the same fault and is fixed with it.

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

## 1.16.0 - 2026-09-17

### Highlights

- A board card can change a task's status, priority, or due date.
- A task edit says what it wrote, and offers to undo it.
- Help is on every page, and the Notes Graph has a keyboard and a legend.

### Added

- Say what a task edit wrote, and offer to undo it.
- Make the Stats numbers a way in, and say what a reindex found.
- Put Help on every page, and give the graph a keyboard and a legend.
- Give a new workspace somewhere to start, and date the shipped releases.
- Name the search Refine narrows, and open a result beside your note.
- Reach reordering and the facet modes from the keyboard.
- Let a card change a task's status, priority, or due date.
- Move through the calendar with the arrow keys.
- Check every theme's contrast, hover states included.
- Mark a chosen segment the same way everywhere, and square it with the theme.

### Fixed

- Open a search on the results, and say what changed instead of re-reading the page.
- Show related notes sooner, and say why each one is related.
- Give the sidebar's related notes the room they need.
- Fold the sidebar's note context so the results come first.
- Say Home can be arranged, and ask before discarding an arrangement.
- Ask before removing a saved search.
- Report a note Deckard could not read to Deckard's log.
- Let the Fellowship theme use light native controls.
- Give a tag's page and a saved search one name each.
- Stop Home blanking between tabs, and keep its widgets current.
- Keep the search box readable while it is being typed in.
- Keep a task's place in a ranked list when its line is rewritten.
- Stop a chosen completion opening the recent searches.
- Say when completing a task starts its next occurrence.

## 1.15.0 - 2026-09-17

### Highlights

- Home gains eight widgets, from today's note and its open tasks to new tags.
- Quick add puts a task in today's note without leaving Home.
- Tags written together, and tags without a hub, point at a missing hub note or one idea under two names.

### Added

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
