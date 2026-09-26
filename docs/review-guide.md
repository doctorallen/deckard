# Reviewing everything since 1.22

This guide walks through the 176 commits on `dev` after `chore: prepare
release v1.22.0` (726d23b), page by page. Each item says what changed, how to
see it, and what to look for. Items marked **(check by hand)** are ones the
automated suites cannot cover: the test host has no workspace folder, no
language model, no real canvas, and never starts from the cache.

Keys are written for macOS; use <kbd>Ctrl</kbd> for <kbd>Cmd</kbd> elsewhere.
Every command named here is in the palette under its exact title.

## Before you start

### Install the build

- [ ] In the dev checkout, run `npm run package:vsix`. It builds, lints, and
  writes `deckard-notes-1.22.0.vsix`.
- [ ] In VS Code, run **Extensions: Install from VSIX…**, choose the file, and
  then run **Developer: Reload Window**.
- [ ] The VSIX is still numbered 1.22.0, so Home's *Updated to Deckard 1.23.*
  line will not appear. See [What's new](#walkthrough-sample-workspace-and-whats-new)
  for how to see it.

### What now means something different

These change how existing notes, saved searches, and settings behave. Check
each against your own notes first.

- [ ] **`is:waiting`** used to mean the same as `is:blocked`. It now finds open
  tasks tagged `#status/waiting` or assigned to someone other than you. Any
  saved search or query block that uses it now lists different tasks.
- [ ] **Rollover `copy` now works as `migrate`.** The task is written into
  today's note, and the line left behind becomes `- [>] … → [[2026-09-25]]`.
  The next rollover rewrites old copied lines this way, and Undo takes that
  back.
- [ ] **`deckard.dailyNote.rolloverDays` now defaults to 7** (it was 0, which
  meant every day back). Older dated tasks show under Needs a new date and are
  not carried.
- [ ] **`[[…]]` in a saved search, a query block, or a board search is now a
  link.** `[[Atlas]]` used to search for the word *atlas*. It now finds the
  entries that link to Atlas. `text ~ "[[x]]"` still searches for the
  characters.
- [ ] **Nested checklists fold into their parent task.** A plain checkbox
  indented under a task is now one of its steps. It no longer gets its own
  board card, Tasks view row, or place in the status bar count, so notes with
  checklists show fewer cards. A step with its own date, priority, person, or
  tag is still listed.
- [ ] **Search pages switch to Rendered once.** The saved preference always
  held Source, whether or not anyone chose it. If you choose Source in the
  gear's Format row after the update, it sticks.
- [ ] **`search.exclude` is now respected.** A folder hidden from VS Code's
  search is no longer indexed. To index it again, set its pattern to `false`
  in `deckard.exclude`, for example
  `"deckard.exclude": { "**/journal": false }`.
- [ ] **Open tasks more than 30 days overdue** move from Overdue to the Needs a
  new date group. They no longer count on the status bar, in the badge, or in
  the reminder. Set `deckard.tasks.needsNewDateAfterDays` to `0` for the old
  behavior.
- [ ] **Due Next Week is now Due Next Monday**, which is what it always did.
  Extract Tagged Heading is now **Extract Heading**.

### New settings

| Setting | Default | What it does |
| --- | --- | --- |
| `deckard.tasks.needsNewDateAfterDays` | `30` | Days overdue before a task moves to Needs a new date; `0` turns this off |
| `deckard.tasks.onHoldStatuses` | `["waiting","someday"]` | Statuses that `is:available` and **Can start now** leave out |
| `deckard.tasks.suggestSteps` | `true` | Offers **Suggest steps** in Break into Steps… when a language model is installed |
| `deckard.calendar.weekStart` | `"sunday"` | `sunday`, `monday`, or `locale`; used by the Calendar, weekly notes, `this-week`, and *next week* |
| `deckard.calendar.dayPanel` | `false` | Shows the chosen day's panel under the Calendar |
| `deckard.periodicNote.reviewSections` | `[]` | Your own review sections, each `{ "title", "query" }` |
| `deckard.parked.folders` | `{}` | Glob patterns of parked folders and notes |
| `deckard.parked.tags` | `["parked"]` | Tags that park whatever carries them |
| `deckard.tagOverview.includeHubLinks` | `true` | A tag's page also lists entries that link to its hub note |
| `deckard.moveTo.leaveBehind` | `"link"` | `link` or `nothing`: what Move to… leaves in place of the moved lines |
| `deckard.editor.dimTaskMetadata` | `true` | Draws task dates, priority, rule, ids, and person fainter than the words |
| `deckard.editor.taskDueHints` | `true` | Adds *overdue 5 days*, *due today*, or *needs a new date* after a task line |
| `deckard.editor.repeatDiagnostics` | `true` | Marks a 🔁 rule that Deckard cannot read and offers fixes |
| `deckard.agenda.groupNamespace` | `"project"` | The namespace the Tasks view groups by when `deckard.agenda.groupBy` is `tag` |
| `deckard.board.limits` | `{}` | Work-in-progress limits, such as `{ "doing": 3 }` |
| `deckard.outline.showCounts` | `true` | Shows task (`2/5`) and link (`↩3`) counts beside Outline headings |
| `deckard.showWhatsNew` | `true` | Shows Home's one-line notice after a feature update |

Also changed: `deckard.dailyNote.rolloverDays` now defaults to `7`,
`deckard.agenda.groupBy` gains `tag`, and there are four new theme colors:
`deckard.sectionHighlightBackground`, `deckard.sectionHighlightBorder`,
`deckard.overdueForeground`, and `deckard.taskHintForeground`.

### Data to review with

- [ ] Run **Deckard: Create a Sample Workspace**. It opens nine notes, dated
  today, without a folder dialog. They include one overdue task, two due
  today, one due later this week, a `#status/waiting` task, a scheduled task,
  and people and namespaced tags. The sample has no `[[links]]`, no repeating
  tasks, no steps, and nothing parked.
- [ ] Add a note named `review.md` to the sample (or to your own notes) with
  the lines below. The dates assume today is 2026-09-26; move them if you
  review on a different day.

```markdown
# Review fixtures

## Carry-over #project/atlas
- [ ] Renew the vendor contract 📅 2026-08-17
- [ ] Send the Q3 numbers 📅 2026-09-24 #proj/atlas
- [ ] Water the plants 🔁 every week 📅 2026-09-26
- [ ] Pay rent 🔁 every tuesdya 📅 2026-09-29
- [ ] Pack for the trip 📅 2026-09-30 #context/home
  - [ ] Passport
  - [ ] Charger
  - [x] Tickets
- [ ] Call the plumber #context/phone #status/waiting
- [ ] Draft the offsite agenda ⏳ 2026-09-28 #proj/atlas

## Decision ##
We will ship the ledger in October. See [[Atlas plan]] and [[Q4 offsite]].
```

- [ ] Add `Atlas plan.md`, a hub note with `describes: project/atlas` in its
  front matter and a few lines of prose. Add one or two notes that link to it
  with `[[Atlas plan]]` but do not carry the tag.
- [ ] Add `untagged.md`, a note with no tags whose prose repeats words from
  another note, such as *ledger*, *vendor*, and *contract*.
- [ ] Write the word *atlas* in plain text, without the tag, in two or three
  entries.
- [ ] This gives you a task 40 days overdue, a repeating task, a misspelled
  rule, a task with steps, two `#context` values, a lookalike tag
  (`#proj/atlas`), a heading with closing hashes, a link to a note that does
  not exist (`[[Q4 offsite]]`), and an untagged note.

## Home (Dashboard)

Open Home with **Deckard: Open Dashboard**.

- [ ] **Top figures.** The three figures are now Overdue, Due today, and Open,
  not totals of notes, tasks, and tags.
  *See:* the top of Home. *Look for:* each figure is a button that opens its
  search, and its count matches that page. `is:today` matches the Tasks
  view's Today group.
- [ ] **Try next.** The first widget suggests one thing to do next.
  *See:* have five daily notes last week, a lookalike tag pair, ten open
  tasks, or a note you open often. *Look for:* one suggestion with **Not
  now** (hides it for a week) and **Do not suggest this**. With nothing to
  suggest, the widget takes no room. An existing Home layout finds it under
  **Add widget**. **(check by hand)**
- [ ] **Tasks view widget comes first.** A new or reset Home puts it before the
  open-tasks list. Its footer counts Done today and Needs a new date.
  *See:* gear → customize → **Reset widgets**.
- [ ] **Gone quiet** (formerly People gone quiet).
  *See:* the widget's gear. Choose the `project` namespace and turn on **Only
  those with no open tasks**. *Look for:* each row has **Add next action**,
  which captures a task with that tag into today's note.
- [ ] **Saved search results on Home.** Saving a search offers **Show Results
  on Home** and **Open Home**.
  *See:* save a search on a search page. *Look for:* a widget that lists its
  results. A saved search's row on Home offers **Show results** until Home
  lists it.
- [ ] **Undoable widget removal.** While customizing, remove a widget.
  *Look for:* **Removed Tasks view.** with **Undo** for 8 seconds, which puts
  it back in place. **Reset widgets** still asks first; its confirm button
  comes after **Keep them** and has a heavier edge, not red.
- [ ] **Walkthrough and theme in the gear.** The gear has a **Get started**
  row with a **Walkthrough** button, and a **Theme** row above **Zen**.
- [ ] **Loading.** Home shows *Indexing this workspace: N of M notes read…*
  while the first scan runs, instead of *Loading…*.
  *See:* **Deckard: Reindex Workspace** on a large workspace.
- [ ] **Speed.** Home sends each tag's name and count, not its entries, and
  builds the Tags tab only when it is open. *Look for:* Home redraws quickly
  on a large workspace. **(check by hand)**

## Search pages (including a tag's page)

Open one with **Deckard: Open Search Page**, a Home figure, or a tag's
**Open overview**.

### Results

- [ ] **Rendered by default.** *Look for:* results drawn as Markdown. In the
  gear's **Format** row, Source shows `<>` and Rendered shows the eye (they
  used to be swapped). Choose Source, reload, and it should stay Source.
- [ ] **Three-line previews.** A result shows three lines. On a word search,
  it shows the paragraph where the words are. **Show all** opens the rest.
  *See:* the gear's new **Preview** row: None, 3 lines, Full.
- [ ] **Tags are quiet text.** Tags on cards are monospace text with a muted
  namespace and an underline on hover, not boxes. The editor keeps its boxes.
- [ ] **Long tags stay on one line.** A long tag, term, or Refine value is
  shortened (namespace first) instead of wrapping after the `/`. The full
  tag shows as its tip.
- [ ] **Only the visible page is drawn.** An empty search of a large workspace
  opens quickly. Counts and Refine still cover every match.
  **(check by hand)**
- [ ] **Opens while indexing.** Open a search right after **Deckard: Reindex
  Workspace**. *Look for:* *Indexing this workspace: N of M notes read…*, and
  then results.
- [ ] **Loading waits.** A fast page shows nothing while loading. A slow one
  says *Loading search…* after 0.4 s, and a search still running after a
  second shows a thin bar under the box.
- [ ] **Buttons that cannot act yet.** Tab to Save, Clear, Back, or Forward
  on an empty page. *Look for:* each stays focusable, explains why it cannot
  act (*Type a search to save it*), and does not light up on hover.
- [ ] **Tips on focus.** Tab through the buttons. *Look for:* each tip shows
  on keyboard focus. Back and Forward name Alt+← and Alt+→, and Escape hides
  the tip.
- [ ] **One menu style.** The tag menu, the gear, the rank menu, and
  completions share one edge, background, and shadow, and a dragged row no
  longer passes under an open menu.

### Refine

- [ ] **Five values per facet.** Each facet shows five values and **+N more**.
- [ ] **Related tags show their share.** *Look for:* each related tag's bar
  fills by its share of results, its tip starts **In 6 of 13 results.**, and
  the list is sorted by that count. This applies on search pages and in the
  sidebar.
- [ ] **Links to.** A new facet lists the notes the results link to, with a
  count for each.
- [ ] **Created.** A new facet groups notes by the month they were written.
- [ ] **Updated.** Its buckets now read Last 7 days, 1–4 weeks ago, and Older.
- [ ] **Parked.** *See:* park something (see [Parked notes](#parked-notes)).
  *Look for:* Parked / Not parked values when the results include both.

### Query language

- [ ] **Link search.** Search `[[Atlas plan]]`, `link = [[Atlas plan#Decision]]`,
  `-[[Atlas plan]]`, and `[[Q4 offsite]]` (a note that does not exist).
  *Look for:* entries that link to that note or heading, and `[[Atlas plan]]`
  shown as one chip. The builder has a **link** row.
- [ ] **`[[` completion.** Type `[[` in the search box or a new builder row.
  *Look for:* notes ranked by how many notes link to them, each saying
  *Linked from 12 notes*, or which note it is an alias of.
- [ ] **Named periods.** Try `created = last-month`, `due <= friday`,
  `due = this-week`, `created = 2026-08`, `due <= "oct 3"`, and
  `due <= end-of-month`. *Look for:* each completion says which days it
  covers.
- [ ] **New `is:` values.** Try `is:daily`, `-is:daily`, `is:periodic`,
  `is:today`, `is:needs-date`, `is:available`, `is:waiting`, `is:parked`,
  `is:step`, `has:steps`, and `no:steps`. Each should also be in the
  builder's `is` values.

### A tag's page

Open `#project/atlas` with **Deckard: Open a Tag's Search Page…**.

- [ ] **Hub offer.** On a tag with no hub note, **Create hub note** is quiet
  text under the title, not an amber panel.
- [ ] **Hub links.** *Look for:* *Also listing N entries that link to Atlas
  plan without the tag.*, with **Leave them out**. Those cards are marked
  *Links the hub note*. Counts, Bulk edit, and Export include them.
- [ ] **Other spellings.** *Look for:* *Also written as #proj/atlas (N
  entries).* with **Include in search** and **Merge**. After a merge, a page
  for the merged-away tag follows the tag that was kept.
- [ ] **Plain mentions.** *Look for:* *N entries mention "atlas" without the
  tag.* with **Show them**, which opens a search you can use with **Bulk edit
  → Add a tag**.

### Export and query blocks

- [ ] **Copy as live query block.** *See:* **Export** on a search page or the
  Task board. *Look for:* this option listed first. Paste it into a note and
  you get a `deckard` fence that keeps its sort or table columns.
- [ ] **Insert Query Block.** Run **Deckard: Insert Query Block…** in a note.
  *Look for:* a choice of saved searches, recent searches, or one you type.
- [ ] **Query block lens.** The lens says **Open search page**, and its
  tooltip names a search page, not the Dashboard's Search tab.

## Task board

Open it with **Deckard: Open Task Board**.

- [ ] **Overdue counts and red for the worst.** With many overdue cards in a
  column, *look for:* a header such as **40 · 38 overdue**. Only the
  longest-overdue third stay red; the rest say *overdue* in muted text beside
  a red dot.
- [ ] **WIP limits.** Set `"deckard.board.limits": { "doing": 3 }` and put
  four cards in Doing. *Look for:* **4 / 3** in the header and a neutral
  outline. Drops are never refused.
- [ ] **Needs a new date column.** Group by Due date. *Look for:* the
  40-day-old task in its own muted column, reading **was due 2026-08-17**.
- [ ] **Can start now.** This switch is in the search bar's status row.
  *Look for:* the board narrows to `is:available`, leaving out blocked
  tasks, tasks that have not started, and `#status/waiting` and
  `#status/someday` tasks.
- [ ] **Group by tag.** Choose the **Tag…** segment and pick `context`.
  *Look for:* columns for `#context/home` and `#context/phone`. A task with
  two tags from that namespace shows in both. Dragging between columns
  rewrites the tag on the line, and it refuses to remove a tag the task gets
  from its heading.
- [ ] **Steps on cards.** *Look for:* "Pack for the trip" shows **1 of 3
  steps · next: Passport** under its details, and Passport and Charger have
  no cards of their own.
- [ ] **Card menu.** Open a card's **⋯** menu. *Look for:* the current
  status, priority, and due date are checked; each row shows its key (**2**
  for High); the keys work while the menu is open. The menu has **Move to…**
  in its Note group and **Break into Steps…** (key **s**).
- [ ] **Moves happen at once.** Move a card with a key or the menu. *Look
  for:* it jumps to the new column immediately, both counts update, and it
  shows as pending until the note is written. A move that fails says so.
- [ ] **Long columns.** A column with more than 100 cards shows the first 100
  and **Show N more**. **(check by hand)** on a large workspace.
- [ ] **List in Tasks view** is now a switch in the gear, not in the search
  bar. Turn it off again to give the Tasks view every open task back.
- [ ] **Undoable column removal.** Remove a status column in the gear.
  *Look for:* **Undo** for 8 seconds.
- [ ] **Screen reader titles.** With VoiceOver on, complete a card whose title
  has an *s* in it. *Look for:* the whole title is read, with every *s*.
  **(check by hand)**

## Tasks view (sidebar)

- [ ] **Overdue shows the most recent slip first, five at a time.** *Look
  for:* **Show N more** under five rows. The group count, badge, and
  Reschedule All still cover every task.
- [ ] **Needs a new date.** *Look for:* a folded group near the end that holds
  the 40-day task, with its own Reschedule All. The badge and Overdue leave
  it out.
- [ ] **Upcoming by day.** *Look for:* one group per day (Tomorrow, Mon Sep 28,
  …). Drag a task onto a day and it becomes due that day.
- [ ] **Done today.** Complete a task. *Look for:* a folded **Done today**
  group at the end. Unchecking a task there reopens it.
- [ ] **Steps.** *Look for:* "Pack for the trip" can be expanded to show its
  steps, each with a checkbox. The row says **1 of 3 steps · next: Passport**.
- [ ] **Group by tag.** Run **Deckard: Group Tasks By…** and choose **Tag
  namespace…**, then `context`. *Look for:* the same grouping and drag
  rules as the board. Grouping by tag is stored in `deckard.agenda.groupBy`
  and `deckard.agenda.groupNamespace`.
- [ ] **Reschedule shows how full each day is.** Right-click Overdue →
  **Reschedule All…**. *Look for:* how many tasks are already due and
  scheduled on each day offered, and the options **Spread over the next 5
  days** and **3 for today, the rest next week**, each with a preview and
  Undo. Afterward, a message says how full that day is now.
- [ ] **Right-click menu.** A task's menu has **Break into Steps…** and
  **Move to…**, for one task or several selected.
- [ ] **Empty search.** Set `deckard.agenda.query` to something that matches
  nothing. *Look for:* the view names the search and offers **Show every open
  task**. **Deckard: Clear the Tasks View's Search** is in the view's `…`
  menu.

## Status bar and daily reminder

- [ ] **Needs a new date is left out.** The due count and its warning color
  leave out the 40-day task. The hover says how many need a new date and how
  many were done today.
- [ ] **Steps are not counted.** A task's plain steps are not counted as tasks
  of their own.
- [ ] **Word count.** With a note open, *look for:* **412 words · 2 min**.
  Select a few words to see **38 of 412 words**. The count leaves out front
  matter, code, link addresses, and task metadata.
- [ ] **One reminder a day.** Set `deckard.taskReminderTime` to a minute from
  now and open three windows. *Look for:* one reminder in total, with **Open
  Tasks View**, **Reschedule Overdue…**, and **Turn Off Reminders**.
  **(check by hand)**
- [ ] **Late, not never.** Put the laptop to sleep past the reminder time and
  wake it. *Look for:* the reminder comes then. **(check by hand)**
- [ ] **Midnight.** Leave a window open over midnight. *Look for:* the count
  moves to the new day without the window needing focus. **(check by hand)**

## Calendar (sidebar)

- [ ] **Scheduled count.** *Look for:* an outlined count beside a day's due
  count for ⏳ tasks (2026-09-28 in the fixture). The tooltip says *2 due, 1
  scheduled*.
- [ ] **Needs a new date.** Days with such tasks read gray and say *1 needs a
  new date*.
- [ ] **Week start.** Set `deckard.calendar.weekStart` to `monday`. *Look
  for:* rows start on Monday. Weekly notes, `this-week`, and *next week* in a
  date box follow the setting. A weekly note written before the change still
  opens for its week.
- [ ] **Day panel.** Use **Open Day Panel** in the Calendar's `…` menu, or set
  `deckard.calendar.dayPanel`. Click a day. *Look for:* the panel shows the
  day's note (Open or Create), tasks due, scheduled, and done that day with
  checkboxes and **Tomorrow** buttons, and the notes created that day.
  Double-click or Enter opens the note. With the panel off, a click still
  opens the note.
- [ ] **Keeps focus.** Focus a day, save a note elsewhere, then press PageUp
  and PageDown. *Look for:* focus stays on its day, and a step into another
  month lands on the matching day. **(check by hand)**
- [ ] **Narrow sidebar.** Drag the sidebar narrower than 280px. *Look for:*
  the month still fits, and days from the neighboring month stay readable.

## Related Notes (sidebar)

- [ ] **Previews.** *Look for:* each card shows the first line of the entry,
  starting where it shares a word with your note, with those words marked.
  The sidebar's new gear sets **Preview** to None, 1 line, or 2 lines.
- [ ] **Linked from, grouped by note.** Open `Atlas plan.md`. *Look for:*
  linking notes listed newest first, each with when it was updated and its
  link count, and its lines underneath. A line expands to show the rest of
  its section. **Open as search** (or **Open all as a search** past fifty
  lines) opens a search page.
- [ ] **Hide daily notes.** It is the gear's **Daily notes** row. *Look for:*
  *Hiding N daily notes.* with **Show them**, and the choice is remembered.
- [ ] **Untagged notes.** Open `untagged.md`. *Look for:* up to ten entries
  with similar wording, marked weak and listed separately, and the tags they
  use, each with **Add**. **Add** writes the tag on the heading or line under
  the cursor, with Undo.
- [ ] **Sort updates at once.** Change Sort. *Look for:* the list re-sorts
  immediately and the selection does not jump back.
- [ ] **Tuning settings are explained.** In Settings, Related Notes' three
  tuning settings are described in plain words and marked advanced.
- [ ] **Parked notes are left out.** See [Parked notes](#parked-notes).

## Outline (sidebar)

- [ ] **Counts.** *Look for:* **2/5** (tasks done under a heading) and **↩3**
  (links to it) beside headings, with a tooltip that spells them out. Zen and
  `deckard.outline.showCounts: false` hide them.
- [ ] **Focus Section.** Use it on a heading's inline button or right-click
  menu, the editor's Deckard submenu, or **Deckard: Note Actions…**. *Look
  for:* the rest of the note folds away. **Unfold All Sections** in the view
  title brings it back.
- [ ] **Filter by tag.** **Deckard: Filter Outline by Tag…** in the view
  title. *Look for:* only headings that carry the tag (or a tag under it),
  until **Clear Outline Tag Filter**.

## Notes Graph

Open it with **Deckard: Open Notes Graph**, or **Deckard: Open Notes Graph
Around This Note** from a note.

- [ ] **Line styles.** *Look for:* wiki links are solid, headings dashed,
  shared tags dotted, and paths through a daily note dash-dot, with a sample
  of each in the legend. Check a few themes and forced colors.
  **(check by hand)**
- [ ] **Only links I wrote.** This is under Filters. *Look for:* every wiki
  link and nothing else, and a status line saying how many indexed links are
  drawn. Also open it from Stats' **Wiki links** tile, both with the graph
  already open and with it closed. **(check by hand)**
- [ ] **Node tooltips.** Hover a node. *Look for:* `atlas.md:12 · 4 wiki
  links · 2 headings · 7 tags`. A tag node says how many notes and tasks
  carry it. Moving **Links per note** does not change node sizes.
- [ ] **Group names.** Zoom out. *Look for:* each group labeled over a faint
  disc, named by the tags its notes carry more than the rest of the
  workspace. Click a label, or choose it from **Group** under Filters, to pick
  it out. **Clear filters** clears the group too. The status line counts
  groups and names up to eight hubs without overlapping labels. Do the names
  make sense on your own notes? **(check by hand)**
- [ ] **Files as nodes.** Zoomed out, each file with two or more headings is
  one node. It splits into headings as you zoom in. **Headings** under
  Display offers **By zoom**, **Always**, and **Never**. Zoom back and forth:
  *look for:* no jumping, and the selection stays. **(check by hand)**
- [ ] **Slider names.** Display shows **Links per note** (Fewer to More).
  **Favor rare tags**, **Links between groups**, and **Show every link** are
  under **Advanced**. A screen reader hears a word, not 0.30.
- [ ] **Reset graph can be undone.** *Look for:* **Undo** next to it for eight
  seconds, with focus on it.
- [ ] **Show parked.** A new toggle. Parked notes are hidden unless it is on,
  except the note the graph is centered on.
- [ ] **Saves that change nothing are cheap.** Edit words inside a line or
  tick a task. *Look for:* the graph does not rebuild. Adding a link redraws
  it. **(check by hand)**

## Stats

Open it with **Deckard: Open Stats**.

- [ ] **Needs attention first.** *Look for:* Notes Deckard could not read,
  Links that open no note, Tags that look alike, and Unlinked notes, each
  shown only when it has rows. With none, one line says so.
- [ ] **Links that open no note.** *Look for:* `Q4 offsite` with its link
  count and the notes that link to it. **Create** makes the note, and
  **Create all** asks first.
- [ ] **Every total opens something.** **Notes** opens `is:note`. **Tasks**
  opens `is:task` (it used to open an error). **Tags** and **Namespaced tags**
  offer their tags in a quick pick. **Wiki links** opens the graph with Only
  links I wrote. **Unlinked notes** jumps to its list, which shows ten and
  **Show 40 more**.
- [ ] **Twelve-week lines.** Under Notes, Tasks, and Open tasks. *Look for:*
  **+9 in the last 7 days**, with the latest point marked. Hover a point to
  see its value. **(check by hand)**
- [ ] **How often tags are used.** Six bars. **Used once** expands to those
  tags, each with the tag it looks like and **Merge**, or **Merge into…**.
  Other bars offer their tags. A bar lights up on hover only when it can do
  something. **(check by hand)** the quick picks and Merge into….
- [ ] **Tags written together.** A triangle of your twelve most-used tags.
  Each cell opens the search for that pair. **Show as a table** lists the
  pairs by count.
- [ ] **Most viewed.** Empty lists collapse into one line.

## Help page

Open it with **Deckard: Open Help**.

- [ ] **Commands run from Help.** *Look for:* every `Deckard: …` name is a
  button that runs the command, with this platform's shortcut beside it. A
  command that acts on the note in the editor is named but cannot be run.
  Export and Import now have their real names.
- [ ] **The nav marks the section you are reading.** Scroll. *Look for:* the
  marker in the navigation rail follows along. It never ran before.
- [ ] **What's new section.** It lists the highlights of the last five
  releases, newest first. **Deckard: What's New** opens it.

## Walkthrough, sample workspace, and What's new

- [ ] **Six-step walkthrough.** Run **Deckard: Get Started**. *Look for:* open
  a note, tag it, **Capture a task**, see the workspace, find anything, and
  **Make it yours** (Choose Theme… and zen), with screenshots. Help's Quick
  start and Home's gear **Walkthrough** also open it.
- [ ] **Sample workspace.** Run **Deckard: Create a Sample Workspace** from a
  window with a folder open. *Look for:* no folder dialog; a choice of **Open
  in New Window** or **Open Here**; nine notes dated from today; the README
  preview opening after reload. Run it again to see **Replace** or **Open As
  It Is**. **(check by hand)**
- [ ] **First index summary.** Open a folder Deckard has never indexed.
  *Look for:* one message, *Deckard read N notes: N open tasks (N overdue)
  and N tags.*, with **Open Dashboard** and **Get Started**. At 3,000 notes
  or more, the same message adds **Leave Folders Out…**. **(check by hand)**
- [ ] **What's new on Home.** This only appears after a feature update, so
  the dev VSIX (still 1.22.0) will not show it. To see it, in a throwaway
  worktree run `npm version 1.23.0 --no-git-tag-version` and
  `node scripts/changelog.js cut 1.23.0 2026-09-26 1.22.0`, package, and
  install. *Look for:* *Updated to Deckard 1.23.* once, with **What's new**
  and **Dismiss**, and no popup. `deckard.showWhatsNew: false` hides it.
  **(check by hand)**

## The editor

Open `review.md`.

- [ ] **Title bar.** *Look for:* a Deckard button that opens **Deckard: Note
  Actions…**. On a daily note, **‹** and **›** open the day before and after,
  and they stay put when you scroll. On any Deckard page, a zen button enters
  and leaves zen.
- [ ] **Note Actions.** Run it with the cursor on a task, then on a heading.
  *Look for:* only actions that fit the cursor: toggle, edit, or add a task;
  Related Notes; Open Notes Graph Around This Note; Move to…; Focus Section;
  Pin.
- [ ] **Deckard submenu.** Right-click in a note. *Look for:* **Deckard** with
  Toggle Task Done, Edit Task, Break into Steps…, Add Task; Rename Heading,
  Extract Heading, Focus Section; Move to…; Pin/Unpin, Park/Unpark Note.
- [ ] **Toggle Task Done.** Put cursors on three task lines and press
  <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd>. *Look for:* all
  three completed with ✅ dates in one edit, reopened when pressed again, and
  one Undo that reverses it. On "Water the plants", the next occurrence is
  written. It also works in an unsaved note.
- [ ] **Break into Steps.** Put the cursor on a task and use the lightbulb or
  **Deckard: Break into Steps…**. Type steps and press Enter after each,
  then **Write**. *Look for:* `- [ ]` lines under the task in one undoable
  change, with existing steps shown alongside.
- [ ] **Suggest steps.** With GitHub Copilot installed, **Suggest steps**
  appears in the same box. *Look for:* only the task's words are sent, and
  the steps are shown for editing before anything is written.
  `deckard.tasks.suggestSteps: false` removes the option. **(check by
  hand)**, since the test host has no model.
- [ ] **Completing steps.** Check Passport and Charger. On the last one,
  *look for:* **Complete Task**. Reopen them and check the parent instead:
  *look for:* **Complete Steps**. Neither happens unless you choose it.
- [ ] **Repeating task keeps its steps.** Add steps under "Water the plants"
  and complete it. *Look for:* the next occurrence comes with the steps
  unchecked, and the completed one keeps its own.
- [ ] **Faint metadata and due hints.** *Look for:* dates, priority, rule, and
  person drawn fainter than the words, and **overdue 2 days**, **due today**,
  or **needs a new date** after the line, with the overdue date in the
  overdue color. Zen hides the hints. Turn them off with
  `deckard.editor.dimTaskMetadata` and `deckard.editor.taskDueHints`.
- [ ] **Theme colors.** *Look for:* the name and alias of a `[[link]]`, the
  `!` of an embed, task dates, repeat rules, priority, Dataview keys, and
  `^block-id` colored by your theme, in any Markdown file. Code, front
  matter, and tags are unchanged.
- [ ] **Repeat rule fixes.** *Look for:* a warning under `every tuesdya` and a
  quick fix to `every tuesday`. `weekly` offers `every week`. The task editor
  shows the same warning.
- [ ] **New repeat rules.** Try `every other week`, `every other Tuesday`,
  `every 2 weeks on Monday, Thursday`, `every month on the second Tuesday`,
  `every month on the last Friday`, `every quarter`, and `every weekend`.
  None should get a warning, and each should complete to the right next date.
- [ ] **Section band.** Switch to a light theme and move the cursor through
  tagged sections. *Look for:* a visible band behind only the section the
  cursor is in. Hovering still offers Show related notes and Pin to Home.
- [ ] **Tag features stay in notes.** Open a README in a code repository
  outside `deckard.notesFolder`, or one under `node_modules`. *Look for:* no
  tag boxes, lenses, hovers, or tag completions. Edit Task and query blocks
  still work.
- [ ] **Date boxes read plain words.** In Edit Task, Due on a Date…,
  Reschedule, and Capture, type `oct 3`, `next week`, `end of month`,
  `last friday`, `3 days ago`, or `10/3`. *Look for:* feedback such as
  *Monday 2026-09-28 · in 3 days*, and one error wording for input it cannot
  read. `+1m` from Jan 31 gives Feb 28.
- [ ] **Open Daily Note for Date…** Type `last friday`. *Look for:* that day's
  note, created from the template if needed.

## Find (quick pick)

Open it with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>
(**Deckard: Find in Notes**).

- [ ] **Empty Find.** *Look for:* pinned notes first, then the five notes you
  opened last, five recent searches, saved searches, and tags.
- [ ] **Opening counts from anywhere.** Open a note from the Explorer and
  leave it open a moment. *Look for:* it appears under the notes you opened
  last. The same heading counts again only after ten minutes.
- [ ] **Keys.** <kbd>Cmd</kbd>+<kbd>Enter</kbd> opens the result beside the
  editor and keeps Find open. <kbd>Alt</kbd>+<kbd>Enter</kbd> inserts a link
  where the cursor was. <kbd>Cmd</kbd>+<kbd>.</kbd> lists every action for
  that row, including Move to… for a task. Escape returns to Find with your
  search. Each button's tooltip names its key. **(check by hand)** with Move
  to….
- [ ] **Task actions in place.** On a task, press **Complete** (or
  **Reopen**) or **Set due**. *Look for:* Find stays open and the row updates
  in place.
- [ ] **Learns your picks.** Type `vend`, pick the third result, close, and
  type `ven`. *Look for:* that result ranks higher, but never above a note
  titled exactly what you typed.
- [ ] **Offers to capture.** Type words that match nothing. *Look for:*
  **Capture "…" to today's note**, showing the line it would write, with the
  date and priority it read.
- [ ] **A day.** Type `last friday`. *Look for:* an **Open Daily Note for
  Date** row.
- [ ] **Starts from the selection.** Select a few words on one line and open
  Find. *Look for:* those words already in the box.
- [ ] **Opens while indexing.** Right after a reindex, Find opens at once,
  keeps what you type, and shows the indexing count until results are
  ready.
- [ ] **Parked notes last.** Parked results come last and say they are
  parked.

## Capture

Open it with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>
(**Deckard: Capture**).

- [ ] **Stays open when you click away.** Type something, then click into the
  editor. *Look for:* the box stays open. If it closes, reopening the same
  command brings back the words and the title says so. The same applies when
  you close the heading picker in **Deckard: Capture Under a Heading**.
  **(check by hand)**
- [ ] **Selection wins.** Select words in a note and run Capture. *Look for:*
  the words already in the box, and a link back to the heading after the
  words and before the date, with a button to leave the link off. An older
  draft is offered as **Restore what you were typing**.
- [ ] **Recent headings.** Run **Deckard: Capture Under a Heading** twice.
  *Look for:* the last five headings first, with the most recent highlighted
  so Enter repeats it.
- [ ] **Goes above sub-headings.** Capture under a heading that has
  sub-headings. *Look for:* the line goes under the heading's own lines, not
  at the end of its last sub-heading.
- [ ] **Keeps what could not be added.** If a capture fails, *look for:* an
  error with **Copy Task**.

## Move to… and Extract Heading

- [ ] **Move to…** Put the cursor on "Pack for the trip" and run **Deckard:
  Move to…** (also on the lightbulb). Choose a heading, today's note, or a new
  note. *Look for:* the task moves with its steps. The original line becomes
  `- [>] … → [[where it went]]`, and a non-task leaves a `[[link]]`
  (`deckard.moveTo.leaveBehind: nothing` leaves nothing). **Undo** restores
  both notes. **(check by hand)**, since only the text changes are tested.
- [ ] **Refuses if the lines changed.** Start a move, edit the line in another
  window before choosing, then choose. *Look for:* nothing written, with an
  explanation.
- [ ] **From everywhere.** Move to… appears on the Tasks view's right-click
  menu (one or several tasks), a board card's menu, and Find's
  <kbd>Cmd</kbd>+<kbd>.</kbd> list. A task moved to another note keeps its
  place on the board.
- [ ] **Extract Heading takes any heading.** Run **Deckard: Extract Heading**
  on an untagged heading. *Look for:* the picker lists every heading and
  names the tags of those that have any.

## Explorer and File → New File menus

- [ ] **Folder submenu.** Right-click a folder. *Look for:* **Deckard** →
  **New Note from Template Here…** (the note is written to that folder) and
  **Exclude from Deckard** (with Undo). On an excluded folder, *look for:*
  **Include in Deckard** instead. **(check by hand)**
- [ ] **Folder names with brackets.** Do the same on a folder named
  `[archive]`. *Look for:* **Include in Deckard** still appears after you
  exclude it.
- [ ] **Park from the Explorer.** On a `.md` file: **Park Note** / **Unpark
  Note**. On a folder: **Park Folder…** / **Unpark Folder…**.
  **(check by hand)**
- [ ] **File → New File….** *Look for:* **Deckard: Create Daily Note** and
  **Deckard: New Note from Template**.

## Parked notes

Nothing about parking runs against real settings in the tests, so check this
whole section by hand.

- [ ] **Park Note.** Right-click a note's editor tab → **Deckard: Park Note**.
  *Look for:* `tags: [parked]` in its front matter, with Undo. **Unpark
  Note** removes it. **(check by hand)**
- [ ] **Park Folder and Park Tag.** From the Explorer, or from a tag's
  right-click menu in the Outline or on a page. *Look for:* entries added to
  `deckard.parked.folders` and `deckard.parked.tags`, with Undo.
  **(check by hand)**
- [ ] **Left out of task views.** A parked task is missing from the Tasks
  view, the status bar, the board, rollover, and the calendar. Related Notes,
  the Notes Graph (unless **Show parked** is on), and tag completion leave
  parked notes out.
- [ ] **Still searchable.** `is:parked` finds them. In Find and on search
  pages they come last and are marked parked. The board shows them only if
  its search says `is:parked`.
- [ ] **Stats.** A line says how much is parked.

## Themes and zen

- [ ] **Choose Theme… previews.** Run **Deckard: Choose Theme…** (or **Theme**
  in the gear on Home, a search page, or the board) with Home and the board
  open. Move through the eight themes. *Look for:* each one shown live;
  Enter keeps it; Escape restores the previous theme; nothing is written to
  settings until you keep one.
- [ ] **Zen from a page's title bar.** On Home, a search page, the board,
  Stats, Help, or the graph, the title bar button enters and leaves zen.
- [ ] **Cooper stays gold on black.** Switch to Cooper and look at the Stats
  bars. They use `--cyan`, which appears pale blue there. Decide whether
  that is acceptable. **(check by hand)**
- [ ] **Disabled controls do not change on hover**, in any theme.

## Messages and notifications

- [ ] **Failures say what did not happen.** Force one, for example by setting
  `deckard.mcpServer.port` to a port that is in use. *Look for:* a
  plain-language outcome with **Open Setting** or **Open Log**, and no raw
  error text.
- [ ] **One wording for a changed note.** Edit a note on disk (from another
  editor) while a Deckard write is pending, for example a board move.
  *Look for:* *atlas.md changed after Deckard last read it, so nothing was
  written.* as an error, with **Open Note**.
- [ ] **Settings named in words.** Any message about a setting names it the
  way the Settings editor does (*the "Exclude" setting*) and offers **Open
  Setting**.
- [ ] **Severity follows one rule.** Error means nothing was written. Warning
  means it was written with a caveat. Needing a folder open is Information,
  with **Open Folder…**. A refused board or Tasks view drop is Information.
- [ ] **Unreadable repeat rule on completion.** Check "Pay rent". *Look for:*
  one warning with Undo, not a "Completed" message followed by a second
  message.
- [ ] **A task change that did nothing says so.** Edit a task line in the
  editor without saving, then toggle it from the Tasks view. *Look for:* a
  message to save the note, with **Open Note**.
- [ ] **Rename Tag explains itself.** **Deckard: Rename Tag** starts with the
  old name selected, and as you type it says whether the new name merges
  into an existing tag (and how many entries it has), is new, or changes
  nothing. `project/atlas` typed for `#proj/atlas` gets a warning.
- [ ] **Saved-search wording.** Find, search pages, and the board all title
  the box **Save search** and say *A saved search needs a name.*
- [ ] **Warm start.** Close and reopen a large workspace. *Look for:* Home, the
  board, and the Tasks view drawn almost at once, then updated with changed
  notes. Only the VSIX reads the cache. **(check by hand)**
- [ ] **Saves do not stall VS Code.** Type and save repeatedly in a large
  workspace with Home and the board open. *Look for:* no pause.
  `npm run bench:index` gives the numbers. **(check by hand)**

## Fixed bugs worth confirming

- [ ] **Search page format icons.** Source shows `<>` and Rendered shows the
  eye.
- [ ] **Copied rollover duplicates.** With `deckard.dailyNote.rollover:
  copy`, leave a task for three days and roll over. *Look for:* it arrives
  once, and the daily note's Carry in lens counts it once.
- [ ] **Rollover and steps.** Roll over "Pack for the trip". *Look for:* its
  open steps nested under it under **Carried over**, not under whatever task
  comes before it.
- [ ] **Repeating tasks completed from the editor.** Complete "Water the
  plants" from **Deckard: Edit Task** (and from the assistant, if you use
  MCP). *Look for:* the next occurrence is written.
- [ ] **Section band in light themes.** It is visible, and only behind the
  current section.
- [ ] **node_modules indexing.** In a code repository, *look for:* no
  `node_modules` READMEs in search or Stats.
- [ ] **Id collisions.** On a large workspace, *look for:* no section or task
  missing from views. Task order and view counts survive the id change.
  **(check by hand)**, by comparing your board order before and after
  updating.
- [ ] **Extract Heading failure.** This is hard to trigger. Read the message
  path in `extractHeading.ts`; the new note is kept and the message says the
  heading is in both notes.
- [ ] **Calendar focus.** Focus stays on its day through saves and
  PageUp/PageDown.
- [ ] **Help navigation.** The rail's marker follows as you scroll.
- [ ] **Related Notes sort.** It re-sorts immediately.
- [ ] **Tag after a closing `##`.** On a search page for "Decision", use
  **Bulk edit → Add a tag**. *Look for:* `## Decision #x ##`, still closed.
  A line ending in `^id` keeps the id last.
- [ ] **Include in Deckard with brackets.** It is offered on `[archive]`.
- [ ] **Screen-reader titles losing "s".** VoiceOver reads the whole title
  on the board and on search pages.
- [ ] **Stats Tasks tile.** It opens `is:task`, not an error.
- [ ] **Find beside.** <kbd>Cmd</kbd>+<kbd>Enter</kbd> no longer closes Find.
- [ ] **Capture Under a Heading.** The line lands above sub-headings.
- [ ] **Refine Updated buckets.** They read Last 7 days, 1–4 weeks ago, and
  Older.
- [ ] **Query block lens tooltip.** It says a search page.
- [ ] **Daily reminder.** Once a day across windows, and after sleep.

## Release notes to finish

- [ ] **Too many Highlights.** `## Unreleased` has five, and
  `changelog.test.ts` ("a feature release has one to three short
  Highlights") fails any x.y.0 from 1.23.0 on with more than three. Keep:
  1. *Search pages you can scan…*
  2. *Nothing is silently lost…*
  3. *Every failure says what did not happen…, Home says what is new…,
     Choose Theme… previews each theme.*

  Drop the Find/`[[` highlight and the Task board keyboard/Capture highlight.
  Both describe v1.22.0 work (9e13dbe, 5e4ea4b, 879dc70, 71ad9f9), not this
  release. If you would rather highlight new capabilities, replace 3 with
  *Break a task into steps, park what you are done with, and group tasks by
  any tag.*
- [ ] **v1.22.0's entries are still in Unreleased.** The 30 one-line Added
  entries (from *Related Notes says each shared tag once.* to *A first run
  offers its next step…*) and the 19 one-line Fixed entries (from *A
  configured status named done…* to *Zen mode turns off where a workspace
  turned it on.*) are 1.22.0's commits. v1.22.0 shipped with no changelog
  section, so either move them to a `## 1.22.0 - 2026-09-26` section before
  cutting 1.23.0, or accept that 1.23's notes will list them.
- [ ] **A stale line.** The Changed entry *A failure says what did not
  happen…* says a sample folder that already exists offers **Choose Another
  Folder**. The sample now lives in Deckard's own storage and offers
  **Replace** or **Open As It Is**. Update that sentence.
- [ ] **README wording.** *Status bar and reminders* calls the reminder's
  button **Open Tasks**; the code says **Open Tasks View**.
