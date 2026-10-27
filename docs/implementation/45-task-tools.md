# 45 · Task tools

Four tools for working a long task list: putting a task off until a day
without giving it a due date, editing a whole search's tasks in more ways
than complete, status, due date, and tag, reading a query block's tasks under
headings, and ordering tasks by how urgent they are. Each is its own commit.

## 1. Snooze until…

A task that cannot be done yet has nowhere to go but a due date it does not
have. **Snooze until…** writes its start date instead: 🛫, or `[start::]` on
a Dataview-format line, through the same checked line edit every other task
date takes (`setTaskDate`, `updateTaskLine`), with Undo. A line with no
metadata yet takes `deckard.tasks.metadataFormat`.

The choice is a quick pick, each row with the day it means:

- **Tomorrow**.
- **Next week**: the day `next week` means in a date box, next week's
  Monday with weeks as `deckard.calendar.weekStart` draws them (D1).
- **Pick a date…**: the date box, in plain words.

The message says when the task starts, `"Call Ren" starts Wed 2026-10-28.`,
and, when the task is due before then, that it is still due: a due date is a
promise the snooze does not move (D2).

### Ways in

- **Deckard: Snooze Task Until…** in the palette and the editor's
  right-click menu, on the task at the cursor.
- **Snooze Until…** on a task's right-click menu in the Tasks view, for the
  task or the tasks selected; several are one write, previewed and undone as
  a bulk edit is.
- **Snooze until…** in a Task board card's **⋯** menu and a table row's, and
  the key **z** on a focused card (D3). The **?** sheet lists it.
- The daily reminder lists counts, not tasks, so it has no task to snooze
  and gains nothing.

### Leaving snoozed tasks out

The Tasks view already keeps a task scheduled for today out of **Today**
until its start date comes, but it lists the task under **Upcoming** or
**Later** by that start date, and the board shows it until **Can start now**
is pressed. `deckard.tasks.hideNotStarted`, off by default (D4), leaves every
open task whose start date is still to come out of the Tasks view, Home's
agenda, the status bar's count, the reminder, and the Task board, until the
day it starts. A search that names start dates, such as `has:start` or
`start > today`, still finds them, as a search that names `is:parked` finds
parked tasks. The setting is part of the task policy, read with the others.

## 2. Wider bulk edits

**Bulk edit** on a search page's tasks offers, in this order:

| Edit | What it asks | What it writes |
| --- | --- | --- |
| Complete, Reopen, Set a status | as before | |
| Set a due date | a date | 📅 / `[due::]` |
| Set a scheduled date | a date | ⏳ / `[scheduled::]` |
| Set a start date | a date | 🛫 / `[start::]` |
| Shift dates… | which dates (Due, Scheduled, Start, each with how many results have one, all chosen), then how many days, `+3` or `-2` | each chosen date a task has, moved by that many days |
| Set a priority | Highest to Lowest, or No priority | the marker or field |
| Add a tag | as before | |
| Remove a tag | a tag written on the results' lines, the most used first | the tag taken off each line that writes it |
| Replace a tag | the tag to replace, then the new one | the new tag where the old one was |
| Move to… | where, as Move to… asks | the tasks and their steps under another heading, into today's note, or into a new note, a link left behind |

Notes take Add, Remove, and Replace a tag on their heading lines.

- An empty date clears it, as the due date's box does.
- Shift moves only dates written as metadata; a date read from a task's
  words has no field to move, and the task is left as it is.
- Remove and Replace take a tag off the line only. A tag the result
  inherits from a heading or its front matter is not on its line, so it is
  not offered, and a result that does not write it is left as it is (D5).
  A person in a 👤 or `[assignee::]` field is that field, not a tag, and
  stays.
- Replace writes the new tag where the old one stood, and only removes the
  old one from a line that already has the new one.
- **Move to…** is the Tasks view's and the board's Move to…, run on the
  chosen tasks (`moveTasks`); it is its own write, with its own message and
  Undo, since it reaches two notes in a way no line edit does.

The line edits are pure and tested: `shiftTaskDates` beside `setTaskDate`
in `taskLineEdits.ts`, and `removeTagFromLine` and `replaceTagOnLine` in
`domain/markdown/tagLineEdits.ts`, which find a line's tags with the
parser's own tag reader.

## 3. `group=` in query blocks

```` markdown
```deckard group=due sort=priority
is:open #project/atlas
```
````

`group=` takes `due`, `scheduled`, `start`, `priority`, `status`, `note`,
`tag`, `for`, or a namespace such as `#context`, and is read the way
`sort=` is: an unknown value is warned of and the rest draws. A block's
tasks then draw under one heading per group, each with its count, in the
order of the board's columns (D6):

- **due**: the board's due columns, Needs a new date, Overdue, Today,
  Tomorrow, Within a week, Later, No due date.
- **scheduled** and **start**: the same days, Earlier (or Started) for the
  days before today, and No scheduled date, No start date.
- **priority**: Highest to Lowest, then No priority, as the Tasks view
  orders them.
- **status**: every status in the order `deckard.tasks.statuses` lists
  them, an Unknown group per character no status names, then Done and
  Cancelled. The board's own dragged order is a preference the preview
  cannot read.
- **note**: by note name.
- **tag**: each tag a task carries, inherited ones too, alphabetically, a
  task with two in both, then No tag.
- **#namespace**: the board's Tag… columns, its tags by name, then No
  project (or the namespace's own word).
- **for**: by person, Nobody named last.

Closed tasks draw under **Done** and **Cancelled** at the end of a date
grouping, whose days no longer say when they are wanted; under the other
groupings they stay in their group, after its open tasks, as a block always
lists them (D7). `sort=` orders the tasks within each group. `limit=` cuts
the list before it is grouped, so the header's totals and "Showing 10 of 40"
read as before. Notes are not grouped (D8).

The Markdown preview draws each group as a heading over its list, or as a
heading row over its rows in a table. The Note page and Copy as Plain
Markdown draw the same groups. **Copy as live query block** on the Task
board writes the board's grouping as `group=`, so a board copied into a note
lists as it did. A block's options have no builder or Refine of their own:
the board's export and the docs are how `group=` is written (D9).

## 4. Urgency

`domain/tasks/urgency.ts` scores an open task, loosely after Taskwarrior's
urgency, from what a task line says:

| What | Points |
| --- | --- |
| Due | 12 × a factor: 1 at a week or more overdue, falling evenly to 0.2 at two weeks ahead, and 0.2 for any date further off |
| Scheduled for today or earlier | +5 |
| Start date still to come | −3 |
| Priority | highest +6, high +4, medium +2, none 0, low −1, lowest −2 |
| Blocked: waiting on an open task, or in the Blocked status | −5 |

No priority sits between medium and low, as everywhere else Deckard ranks
priorities. The score is a plain function of the task's dates, priority,
and blocked state and the moment, with unit tests; ties go by due date,
then priority, then where the task is written (D10).

**Most urgent** joins the task sorts, so it is offered wherever they are:
the Tasks view's **Sort Tasks By…**, the Task board's and a search page's
**Sort**, and Home's task widgets. A saved search opens on its page, under
the page's sort. A query block takes `sort=urgency`, most urgent first, and
`dir=asc` turns it around; **Copy as live query block** from a page sorted
Most urgent writes it.

## Not built

- A per-saved-search sort: a saved search keeps its search only, and opens
  under the page's sort.
- A snooze button on the daily reminder, which names no task.
- Grouping a block's notes.

## Decisions

- **D1**: Next week is the day `next week` reads as in every date box, not
  the week's first day, so the row and typing the words agree.
- **D2**: Snoozing writes only the start date; a due date before it stays,
  and the message says so.
- **D3**: The board's key is **z**, unused on the board and the usual
  snooze letter.
- **D4**: `deckard.tasks.hideNotStarted` is off by default, so a workspace
  that lists start dates keeps listing them.
- **D5**: Remove and Replace a tag change the result's own line only.
- **D6**: A block's groups follow the board's columns and the Tasks view's
  labels, not an order of their own.
- **D7**: Closed tasks get Done and Cancelled groups only under a date
  grouping.
- **D8**: `group=` groups tasks; notes keep their list.
- **D9**: No query-block builder is added; the board's export writes
  `group=`.
- **D10**: Urgency weighs due date, scheduled and start dates, priority,
  and blocked state only; no age, tags, or in-progress bonus.
