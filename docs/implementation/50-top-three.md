# 50 · Top three

A common practice is to start the day by choosing its three most important
tasks and doing them first. Deckard has no way to say "this is one of
today's": the nearest thing is a high priority, and a task marked Highest
only so that it is seen stops meaning what a priority means.

This plan adds a day's top tasks: chosen in the morning, three unless the
setting says otherwise, shown all day, and new the next day. Mockup: the
"Top Three" artifact (https://claude.ai/artifact/CE1kLVrR93y9KpEqvag5D5).

## Principles

- **A pick lasts a day.** It changes no priority, date, or tag.
- **The limit is the point.** The picker refuses one more than the limit,
  in words.
- **The day's note says what mattered that day.** The picks are written in
  today's note as links; the tasks stay where they were written.
- **Markdown says all of it.** Deckard reads the picks back from the note.
  Nothing is stored outside the notes.
- **It offers, and does not interrupt.** No dialog opens by itself and
  there are no reminders.

## The number

`deckard.tasks.topCount` is how many tasks a day's picks hold: `3` unless
changed, `1` to `9`, and `0` turns the feature off (no status bar item, no
lens, no group, no review section; the command says it is off and offers
the setting).

The name follows the number, written as a word: **Top three**, **Top
five**, and **Top task** for one. `topTasksName(count)` in the domain gives
it, and every label below that reads "Top three" uses it.

## What is written

In today's daily note, a section one level below the note's first heading,
directly under that heading's own lines and above every other section:

```markdown
# 2026-11-24

## Top three

- [[Ledger migration#^cutover-runbook|Draft the cutover runbook]]
- [[Borealis#^vendor-quote|Send the vendor quote]]
- [ ] Outline the Q1 staffing ask

## Carried over
```

- **A pick of a task that exists** is a list item that is a link to the
  task's line, by the `^marker` at the line's end, with the task's title
  (without metadata) as the link's words. The link is written in the link
  style of today's note (`deckard.links.style`).
- **A task with no marker gets one**, the only change to its own note: up
  to three of its title's words, lowercased and joined with `-`, letters
  and digits only, made unique in its note with `-2`, `-3`. It goes at the
  very end of the line, where a marker is read.
- **A new task typed in the picker** is written as a task under the
  heading, since it has no other home.
- **The order** of the lines is the order they were checked.
- **A heading already there**, from the Daily template or by hand, is
  used. Any heading in today's note that reads `Top` followed by a number
  word or digits (`Top three`, `Top 5`), or `Top task`, in any case, at any
  level below the title, is the section. A day keeps the heading it was
  written with when the setting changes later.
- **Picking again** rewrites the section's list items only; other lines
  under the heading stay.
- It is one write across today's note and each task's note, with **Undo**,
  and `Deckard: Undo Last Change` takes it back. Today's note is created if
  it is not there, with the tasks a rollover carries in, as Start a Meeting
  does.

**Reading it back.** A day's picks are the section's list items, in order:
a link to a line resolves to the task carrying that marker in that note; a
checkbox line is itself a pick. A link that resolves to no task is kept in
the note and shown nowhere but the review, by its words. Items beyond the
limit are still read: the note is the truth, and a hand-written fourth is
shown.

`domain/tasks/topTasks.ts` holds the rules: the name, the heading test,
reading a section, making a marker, and the plan of edits for a new set of
picks.

## Picking

`Deckard: Pick Today's Top Tasks` opens one list with checkboxes, as Start
a Meeting does, titled **Today's top three · 2 of 3 chosen**.

Rows, each an open task with why it is listed and where it is written
(`Overdue 1 day · Borealis › Vendor sync`):

- **Chosen**, when today has picks: those, checked, done ones included.
- **Left from yesterday's three**: the unfinished picks of the latest
  earlier daily note that has a section.
- **Overdue**, then **Due today**, as the Tasks view counts them.
- **Most urgent**: every other open task, by the Most urgent sort.

The list is the tasks the Tasks view lists (`deckard.tasks.viewQuery`,
parked and not-started left out as there), so typing narrows to any of
them. Words that match nothing offer **Add "…" as a new task in today's
note**.

- **One more than the limit is refused**: the row is unchecked again and
  the list says **Three is the limit. Uncheck one to pick "…".**
- **Fewer is fine.** Accepting with none checked clears the section's
  items and leaves the heading.
- **A pick that is done stays.** Unchecking it is refused: **"…" is done
  today, so it stays.**

The command is in the palette, in the Tasks view's **⋯** menu, on the
**Top three** group as **Change…**, and behind the status bar item and the
lens when they offer it.

`ui/commands/topTasks.ts` asks and writes; it is registered with the daily
note commands.

## Through the day

- **Status bar.** A second item beside the due count: `◎ 1/3 · Draft the
  cutover runbook` (the `target` codicon), the count done and the first
  pick not done. Selecting it opens that task's line. With every pick done
  it reads `3/3 done`. Its tooltip lists the picks.
- **Tasks view.** A **Top three** group leads, in every grouping, with
  `1/3` as its description and **Change…** inline. A pick is listed there
  only, not again in its own group, and stays there, checked, once done.
  The view's badge and the due count are unchanged.
- **Home.** The Tasks view widget shows the same group first. The Today
  widget offers **Pick today's three** while there are none.
- **Task board.** The picks are a strip above the columns, and the
  table's first group; see On the Task board.
- **Search.** `is:top` finds today's picks, on search pages, in query
  blocks, on the board, and in a Home Tasks widget. It is offered where
  `is:` terms are.
- **Completing a pick** ticks its own line. Today's note is not rewritten.

## Offering it

While the feature is on and today has no picks:

- the status bar item reads **Pick today's three** and opens the picker;
- a lens above the first heading of today's note reads **Pick today's
  three…**, with **· 1 left from yesterday** when there are any.

Both show only to someone who uses the practice: when a daily note of the
last 14 days has a section. Until then the command, the Tasks view's menu,
and Home's Today widget are how it is found. With picks, a lens above the
section's heading reads **Top three · 1 of 3 done · Change…**.

`deckard.editor.topTasks` turns the lenses off, following the editor
preset while unset as the other lenses do.

## The review

A weekly or monthly review gains a **Top three** section, after Completed,
when any daily note in the period has picks, and its summary line gains
**Top three:** 10 of 12.

```markdown
### Top three

- Mon 2026-11-23 · 2 of 3 · left: [[Borealis#^vendor-quote|Send the vendor quote]]
- Tue 2026-11-24 · 3 of 3
- Fri 2026-11-27 · none picked
```

- A pick counts as done for its day when its task was completed on that
  day (its ✅ date), or is done with no date.
- **Left** lists the others as written in the day's note.
- A day with a daily note and no picks reads **none picked**; a day with
  no daily note is not listed.

## On the Task board

A pick that only says **Top three** at the end of its card's details is
lost among forty cards. On the board the day's picks have a place of
their own.

**The strip.** While the feature is on and the board's search finds a
pick, a strip sits above the column heads, and above the lanes: a head,
`◎ Top three  1/3 done`, with **Change…** at its right, which opens the
picker, then the picks as cards in one row, in pick order, each led by
its number in a small filled circle. The row wraps when the cards do not
fit, and a card keeps about a column's width.

- **A pick in the strip is in no column below**, nor in a lane's cell.
  Column counts and limits count what the column shows.
- **A strip card is a whole card**: checkbox, title, details, **⋯** menu,
  keys, and focus as any card. It left its column, so it says what the
  column would have: its status, with everything else a card can say.
- **Done picks stay** for the day, drawn as done, even when the board
  hides done tasks: the strip is the day's score.
- **The search applies.** A pick the search leaves out is not in the
  strip, and the head then reads `1/3 done · 2 of 3 shown`. With no pick
  shown there is no strip.
- **It folds** from its head, as a lane does.

**Drag.** A column card dropped on the strip is picked, last. One more
than the limit is refused: **Three is the limit. Remove one to pick
"…".** A strip card dropped on a column, or a lane's cell, takes that
column's edit as any card does, and stays a pick, in the strip. Dragging
within the strip does nothing: its order is the pick order. Dragging
never un-picks; the menu does.

**The menu.** A card's and a table row's **⋯** menu gains **Add to
today's top three**, and on a pick **Remove from today's top three**,
with a key on a focused card, listed with the others. Removing a pick
that is done, or one written as a task under the heading itself, is
refused in the picker's sentences. The row is not offered while the
feature is off.

**One write.** Adding and removing write what the picker writes, through
the same code: `planTopTasks` with today's picks and the one, or without
it, today's note made with its rollover when it is missing, as one
undoable change.

**The table.** The picks are the table's first group, headed `Top three
1/3 done`, in pick order, and are not repeated below.

`domain/tasks/topStrip.ts` holds what the host and the page both say;
`ui/state/taskBoardState.ts` builds the strip and the group;
`webview/taskBoard/board.tsx` draws them and `boardMoves.ts` moves them.

## Decisions

- **The picks live in today's note**, not VS Code's storage: a record, the
  weekly count, and a section edited by hand, for one marker on each
  picked line.
- **The number is a setting, three by default**, 1 to 9, and 0 for off.
- **The name follows the number**: Top three, Top five, Top task.
- **The search term is `is:top`**, which holds for any number.
- **It is offered, not opened**, and only to someone who has used it in
  the last 14 days, so an update adds no status bar item to anyone else.
- **Unfinished picks are offered first the next day**, not carried in.
- **Picking writes no scheduled date.**
- **No reminders.**

## Tests

- `top-tasks.test.ts`: the name for each count, the heading test, reading
  a section (links, tasks, broken links, more than the limit), markers
  (words, uniqueness), the plan of edits (new section, a heading already
  there, picking again, clearing), picks leading the Tasks view's groups,
  the status bar's words, `is:top`, and the review's section and figure.
- `pick-top-tasks.test.ts` (host): the list's rows, the limit, the write to
  today's note and a task's note, and its Undo.

## As built

Built as planned, with these departures and choices where the plan was
silent.

**Departures**

- **Today's note is made before the list opens**, not after it is
  accepted. A rollover moves yesterday's unfinished tasks into today's
  note, so a list drawn first would name lines that are gone by the time
  the picks are written. Dismissing the list leaves the new note.
- **A task written under the heading cannot be unchecked** in the list:
  **"…" is written under the heading, so it stays. Move or delete its line
  to drop it.** Rewriting the items without it would delete the task.
- **The refusals are said in the list's title**, in place of the count,
  until the next change: VS Code's list has no line for a message.
- **Change… on the group is a pencil button**, with Change… as its tooltip
  and in the group's right-click menu, since a tree row's inline action
  draws an icon. It is its own command, `deckard.agenda.changeTopTasks`,
  kept out of the palette.
- **The table row said it beside its status**, and a card after its other
  details, until the strip replaced both (On the Task board).
- **The lens above the first heading shows when today's note has the
  heading and no picks**, as well as when a daily note of the last 14 days
  has a section, so a Daily template that writes the heading offers
  picking from the first day.

**Choices**

- **Counts are of the picks that name a task.** `1/3` in the status bar,
  the group's description, and the lens are done of picked, not of the
  limit; the list's title alone counts against the limit. The review
  counts every item, a link that leads nowhere among those left.
- **Done is completed.** A cancelled pick is not counted as done; the
  status bar passes over it for the first open one, and reads `1/3 done`
  when none is open.
- **Markers hold ASCII letters and digits**, which is all a `^marker` is
  read with; a title with none of them gets `task`. A marker for a line of
  today's own note is written in the same edit as the section.
- **A picked line that changed since it was listed stops the write**, with
  the task named, since its marker would land on another line.
- **The section in a note with no title**: above the first heading, at
  that heading's level; in a note with no heading, at the end, at level 2.
  The title is the note's first heading when it is level 1, and is never
  itself the section.
- **A Top three heading under Carried over is not the section.** A
  rollover writes yesterday's heading again above a task it carried from
  under it, and that is yesterday's pick, not today's.
- **Top tasks, in the plural, reads as the section too**, with **Top
  task**.
- **The section's lines are put in order when rewritten**: a blank line
  under the heading, the items, then every other line of the section after
  one blank line.
- **Left from yesterday** names the day by its date when the latest
  earlier section is not yesterday's: **Left from 2026-11-20** in the
  list, **· 1 left from 2026-11-20** in the lens. An unfinished pick that
  was a task written under yesterday's heading and has since been carried
  into today's note is no longer on the line yesterday named, so it is
  listed with today's tasks, not under Left.
- **A link's words leave out tags** and the characters a link cannot hold
  (`[`, `]`, `|`), so today's note is not tagged by what it picks.
- **The group lists every pick that names a task**, whatever
  `deckard.tasks.viewQuery` lists, and a drop on it writes nothing.
- **`is:top` reads the note whatever the setting**, 0 included.
- **Home's Today widget offers picking** with or without today's note,
  through the page's existing `openView` message; no new CSS or markup
  beyond a text button in a footer line the Tasks view widget already
  draws.
- **`deckard.editor.topTasks` is on in Full and Tasks**, off in Writing
  and Off.
- **The status bar item** sits beside the due count, on its right, opens
  the list once every pick is done, and its `Open Setting` on the off message opens
  Settings at `deckard.tasks.topCount`.
- **After the write** a message says how many were picked, with **Open**,
  which opens today's note at the heading, and **Undo**.
- **In the review's summary line**, the figure follows **Done**.

### On the Task board, as built

**Departures**

- **The key is p, not t.** On a focused card **t** already makes the task
  due today, and is in the key sheet and the guide as that; **p**, for
  pick, was free.
- **The fold is kept while the board is open**, not in the board's
  preferences. That is how a lane's fold is kept (`laneGrid.folded`), and
  the strip folds as a lane does, under a name of its own beside them.
- **The limit's refusal, and the picker's other two, are a VS Code
  notification**, as the Tasks view says a drop it refuses. The board's
  own line for what it could not do is read aloud and not drawn, so a
  refusal said only there would be seen by no one.
- **The strip has no drop refusal drawn on it while a card is held.** The
  host knows the limit and the page does not ask it before the drop; the
  drop is taken and then refused in words.
- **The table's rest is headed Other tasks**, so the first group has an
  end.
- **A strip card says its status, priority, due date, and person**, all a
  card can say, in place of the column's name. On a board grouped by a
  tag it does not name the tag column it left; its title's own tags and
  its parent tag say that.

**Choices**

- **A strip card's moves are written from the column, and the lane, it
  would be in**, found by laying the picks out as the board is, with every
  status a column and Done drawn. Its menu checks its choices as there;
  **[** and **]** move it along those columns; and it is marked pending
  where it is, in the strip, until the next state.
- **← and → walk the strip, ↓ goes to the first card under it, and ↑ from
  a column's first card goes up to the strip's first.**
- **Typed words hide strip cards** as they hide any card, at once; the
  head's count is the host's, of the day, and does not change until
  Enter.
- **The strip is the board's first Tab stop** when it is drawn and not
  folded.
- **A pick's row in the table is not ranked** with the rest, by drag or by
  key, and ranking the rest leaves the picks out of the order sent.
- **A pick that is a plain step**, folded onto its task's card elsewhere,
  is a card of its own in the strip.
- **The board counts every task it draws**, the strip's with the columns'.
- **A task a rollover moved while today's note was being made** for this
  pick is not picked: a message says it moved into today's note, to pick
  it there. It happens only on the day's first pick from the board.
- **An item that names no task is kept when the picks are written
  again**, after them, by the picker as well: before this it was dropped,
  against the plan.
- **After the write** the message is **Added "…" to today's top three.**
  or **Removed "…" from today's top three.**, with **Open** and **Undo**.
- **The strip's ground** is the faint amber a column takes under a held
  card, from the theme's own tokens, with no rule of any theme's; the
  number is in the colors of the page's filled button. Zen keeps all of
  it.
- **Home draws no board of cards now**, so there is nothing there to keep
  or remove.
- **`deckard.changeTopTask`** is the command the board runs; it is kept
  out of the palette.

