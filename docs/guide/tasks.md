# Tasks

## Task metadata

Deckard reads both formats of the [Obsidian Tasks](https://publish.obsidian.md/tasks/) plugin. The emoji format looks like this; the [Dataview format](#dataview-format) spells the same fields out in brackets:

```markdown
- [ ] Send the proposal 📅 2026-09-20 ⏳ 2026-09-18 ⏫ 🔁 every week
```

| Marker | Meaning |
| --- | --- |
| 📅 | Due date. 📆 and 🗓 also work. |
| ⏳ | Scheduled date: the day you plan to work on the task. ⌛ also works. |
| 🛫 | Start date: the task is not actionable before this day. |
| ✅ | Completion date. |
| ➕ ❌ | Created and cancelled dates. Removed from titles and kept in the note. |
| 🔺 ⏫ 🔼 🔽 ⏬ | Priority, from highest to lowest. |
| 🔁 | Repeat rule, such as `every week`. |
| 🆔 ⛔ | A task's id, and the ids of the tasks it waits for. |

- Markers and a trailing block id such as `^a1b2` are left out of titles and shown as details. A marker can be anywhere on the line.
- Without a 📅 date, Deckard reads `2026-09-12`, `Sep 12`, or `next Friday` from the text, counting from the note's date (a daily note's name or top heading, else a `date:`, `created:`, or `updated:` front-matter date, else the last save). `Sep 12` is in that date's year, unless the same day in the year before or after is nearer and within two months: `Jan 5` in the note for December 28 is the coming January.
- Completing a task adds ✅ with today's date; reopening removes it. `deckard.tasks.addDoneDate` set to `false` changes only the checkbox.
- Completing a 🔁 task anywhere writes its next occurrence on the line above. The due date (else scheduled or start) moves by the rule and the other dates keep their distance; `when done` counts from today. The new task drops ✅, 🆔, and any block id, and its [steps](#breaking-a-task-into-steps) return unchecked. A bulk edit writes the next occurrence alone.
- Repeat rules:
  - Obsidian Tasks rules: `every day`, `every 3 weeks`, `every month`, `every year`, `every weekday`, `every Monday`, `every week on Tuesday, Friday`, `every month on the 15th`, `every month on the last`, `every other week` (or day, month, year), `every other Tuesday`, `every 2 weeks on Monday, Thursday` (weeks start on Monday), `every month on the second Tuesday` or `on the last Friday`.
  - Deckard's own, which Tasks does not read: `every quarter`, `every 2 quarters`, `every weekend`.
  - `on the fifth Friday` skips months without one. Any rule can end in `when done`. Any other rule completes the task with no next occurrence, and Deckard tells you so.
- Only `[ ]`, `[x]`, and `[X]` are tasks. A line with any other mark, such as Obsidian's `[/]` for in progress or `[-]` for cancelled, is text: it is not listed or counted. The first scan that finds such lines says how many, once, and [Stats](home-and-stats.md#stats) keeps saying it.

### Who a task is for

A `👤` field says who a task is for. Mentioning someone does not make the task theirs:

```markdown
- [ ] Chase the contractor @ren-kade 👤 @dana     <!-- Dana's task; Ren is mentioned -->
- [ ] Send the proposal [assignee:: #person/ren-kade]  <!-- Ren's task -->
- [ ] Write up what @dana said                    <!-- about Dana, nobody's task -->
- [ ] Book the room                               <!-- nobody's yet -->
```

- `👤` and `[assignee:: …]` are the same field in the two [task metadata](#task-metadata) formats. `🧑` is read too.
- `@dana` and `#person/dana` are the same person, as in the [people](notes-and-links.md) views.
- Search with `assignee = @dana`, `assignee = none`, `is:assigned`, or `is:unassigned`. `is:mine` finds tasks for you (set `deckard.me`, such as `@ren-kade`) plus tasks for nobody.
- On the [Task board](task-board.md#task-board), group by **Person**. Drop a card on a person to set the field, or on **Nobody named** to clear it. In any grouping, a card's **⋯** menu has **For someone…** (key **f**), which lists the people you write about.
- [Capture](#quick-capture) reads `for @dana` at the end, or `@dana to …` at the start, as who the task is for.
- The first search in a window that uses `is:mine` or `is:waiting` while `deckard.me` is empty says so, with the setting a click away.
- `deckard.tasks.assigneeFromPersonTag` treats the first person in a task's words as its owner when there is no `👤`.

### Dataview format

```markdown
- [ ] Send the proposal [due:: 2026-09-20] [scheduled:: 2026-09-18] [priority:: high] [repeat:: every week]
```

The fields are `due`, `scheduled`, `start`, `created`, `completion`, `cancelled`, `priority`, `repeat`, `id`, `dependsOn`, and Deckard's own `assignee`, in square or round brackets. Other fields, such as `[owner:: Ren]`, stay part of the title. Deckard writes dates in the format the task already uses; for a task with no metadata yet, `deckard.tasks.metadataFormat` chooses.

### Editing a whole task

**Deckard: Edit Task** (on a task line) or **Deckard: Add Task** (elsewhere), on the same shortcut, opens the line's fields, headed by the line as it will be written. A non-task line's text becomes the description. It is also **Edit task…** on the lightbulb.

| Field | What it takes |
| --- | --- |
| **Description** | The words, tags and people included |
| **Status** | Open or done. Completing writes the ✅ date, or `[completion:: …]` on a Dataview-format line; reopening removes it. `deckard.tasks.addDoneDate` turns the date off |
| **Due**, **Scheduled**, **Start** | A date in plain words |
| **Priority** | Highest to lowest, or none |
| **Repeats** | A common rule, or any rule you write |
| **Assignee** | Its `👤` field; see [Who a task is for](#who-a-task-is-for) |
| **Blocked by** | The `🆔` ids of the tasks that come first |
| **Add a tag** | A tag from your workspace, or a new one, written at the end of the description |

- Dates take [plain words](#dates-in-plain-words). An empty answer clears the date; unreadable words are refused.
- **Assignee** offers people your notes name or takes a new one (`dana` or `@dana`). **Nobody** removes it.
- **Nothing is written until you choose Write the task.** Escape leaves the line as it was.
- The line keeps its format (or `deckard.tasks.metadataFormat`), in the order [Tasks](https://publish.obsidian.md/tasks) writes it. A `^block-id`, `🏁`, and `➕` are kept.

### Breaking a task into steps

A checkbox indented under a task is one of its **steps**:

```markdown
- [ ] Plan the offsite 📅 2026-10-09
  - [x] Book the venue
  - [ ] Draft the email
  - [ ] Send the invite
```

Run **Deckard: Break into Steps…** from the lightbulb, the palette, or the editor's **Deckard** submenu on a task line; a task's right-click menu in the Tasks view; or a board card's **⋯** menu (or **s**). Type a step and press Enter for each. **Write** adds them as `- [ ]` lines under the task in one change, undone by the message's **Undo** or **Deckard: Undo Last Change**. Escape writes nothing. With a VS Code language model, **Suggest steps** drafts a list; see [Suggest steps](ai-assistants.md#suggest-steps).

- A heading, code block, or unindented paragraph ends the steps; a blank line does not. A checkbox under a plain bullet is its own task.
- `is:step` finds steps; `has:steps` finds tasks with them; `-is:step` leaves steps out of search pages.
- A task with steps shows **Steps 2/5 done (40%) · next: Draft the email**. In the editor, a lens above it draws the same with a bar, **███░░░░░░░ Steps 1/3 done (33%) · next: Draft the email**; select it to go to the next open step. `deckard.editor.stepProgress` turns it off. On the Task board and in the Tasks view, steps ride on their task unless they have their own date, priority, person, or tag, or the task is done or not listed.
- Checking a task's last open step offers **Complete Task**. Completing a task with open steps offers **Complete Steps**, with its own **Undo**. Toggle Task Done, bulk edits, and the assistant complete only what they are given.

### Typing metadata

Type `/` after a space in a task to pick metadata:

- **due today**, **due tomorrow**, **due in a week**, and **due on a date**, with the same choices for scheduled and start dates;
- the five priorities, from **highest priority** to **lowest priority**;
- common repeat rules, or **repeats on a rule** to write your own;
- **for @dana** for each person your notes name often, and **for a person** to write one;
- **task id**, and **depends on** each open task's id.

Keep typing to narrow the list, as in `/prio` or `/every`. Set `deckard.tasks.metadataSuggestions` to `false` to turn this off.

### Dates in plain words

Every date box, including `[[` day links and [Quick capture](#quick-capture), reads these words and shows the day it read, such as *Monday 2026-09-28 · in 3 days*. On Friday 2026-09-25:

| Written | Means |
| --- | --- |
| `2026-10-02`, `2026/10/02` | that day |
| `today`, `tomorrow`, `yesterday` | as named |
| `in 3 days`, `+2w`, `3 weeks`, `1 month` | that far ahead; a month is a calendar month, so Jan 31 plus a month is Feb 28 |
| `3 days ago`, `2 weeks ago` | that far back |
| `friday`, `fri`, `next friday`, `this friday` | the next Friday to come, never today: 2026-10-02 |
| `last friday` | the Friday before today: 2026-09-18 |
| `oct 3`, `3 Oct`, `October 3rd`, `Oct 3, 2027` | that day; with no year, the next one on or after today |
| `next week` | next week's Monday: 2026-09-28, with weeks as `deckard.calendar.weekStart` draws them |
| `end of week`, `eow` | the last day of this week: Saturday 2026-09-26, or Sunday with a Monday week start |
| `end of month`, `eom` | the last day of this month: 2026-09-30 |
| `next month` | the 1st of next month |
| `weekend`, `this weekend` | the coming Saturday, or today on a weekend |

- A numeric date such as `10/3` follows VS Code's display language (month first in English, day first in German or French), unless only the other order is a real day, as `25/9`. Numeric dates work only in a box, not in a search.
- In a search, a week or month is the whole span: `due = next-week` is every day of next week.

## Tasks view

Open **Tasks** from the Deckard Activity Bar to see open tasks grouped by when they are wanted. Parked tasks are left out unless `deckard.agenda.query` says `is:parked`.

![Deckard's Tasks view grouping open tasks into Overdue, Today, and Upcoming beside a note with dated tasks.](../images/agenda.png)

- **Overdue**: past due, most recently slipped first, five at a time with **Show 12 more** for the rest.
- **Today**: due today, or scheduled for today or earlier and started, most important first.
- **Upcoming**: due, scheduled, or starting in the next seven days (`deckard.agenda.upcomingDays`), one group per day. Drop a task on a day to make it due then.
- **Later** (dated tasks past that) and **No date** start folded.
- **Done today**: finished today, by ✅ date. Uncheck to reopen; drop a task here to complete it.
- **Needs a new date**: more than 30 days past due, left out of Overdue, the badge, and the status bar. Date them with the calendar button or **Reschedule All…**. `deckard.tasks.needsNewDateAfterDays` sets the days; `0` turns this off. `is:overdue` still finds them.

**What it lists.** Set `deckard.agenda.query` to any [query](search.md#query-language), such as `is:mine`, `#project/atlas`, or `has:due OR has:scheduled OR has:start`. Home's agenda widget and the [status bar](#status-bar-and-reminders) count the same list. The search icon in the title opens the search on the [Task board](task-board.md#editing-what-the-tasks-view-lists): change it there, then select **Save to Tasks view**, which keeps what the box shows. **List in Tasks view**, in the board's gear, makes the view list any board's search. **Show every open task** or **Clear the Tasks View's Search** (in the `…` menu and palette) clears it.

**Group by**, in the title, chooses **Due status** (the groups above), **Priority**, **Status**, **Person**, or **Tag namespace…**; `deckard.agenda.groupBy` keeps it.

- **Tag namespace** groups by tags in one namespace, such as `#project/…`, busiest first, **No project** last. Inherited tags count. `deckard.agenda.groupNamespace` keeps the namespace.
- **Priority** runs highest to lowest, **No priority** last.
- **Status** reads `#status/…` tags on task lines, following `deckard.board.statusNamespace`, **No status** last.
- **Person** groups by [who each task is for](#who-a-task-is-for), **Nobody named** last.

**Working with tasks:**

- Select a task to open its line. `blocked by …` shows while a ⛔ task is open.
- **Drag a task onto another** to rank it, as on the [Task board's](task-board.md#task-board) list. Ranked tasks lead their group. This writes nothing to your notes.
- **Drag a task onto a group** to write that priority, status, due date (**Today**), tag, or person into it. **Overdue**, **Later**, and **Needs a new date** take no drops.
- Check a task's box to complete it, with its ✅ date and next occurrence.
- **Right-click** to make it due today, tomorrow, next Monday, or a date [in plain words](#dates-in-plain-words); to edit it (also the pencil); to [break it into steps](#breaking-a-task-into-steps); or for **Move to…**, which moves it with its steps under another heading, into today's note, or into a new note, leaving a link; see [Moving lines and tasks](organizing.md#moving-lines-and-tasks). Select several to act on them together, as one write, [previewed and undone](search-pages.md#previewing-and-undoing-a-write).
- **Reschedule All…** on a group, the calendar button beside **Overdue**, or `Deckard: Reschedule Overdue Tasks…` dates many tasks at once. Each day shows how full it is, such as *Fri 2026-09-25 · 3 due · 1 scheduled*. For several tasks it also offers:
  - **Spread over the next 5 days**: the next five weekdays, oldest due first (17 tasks become 4, 4, 3, 3, 3).
  - **3 for today, the rest next week**, for four or more: the three most important stay today; the rest move to next Monday.
- The badge counts tasks overdue or due today.

## Status bar and reminders

The status bar shows **3 due today**, or **1 overdue, 3 due today** in the warning color, counting the Tasks view's Overdue and Today groups. It is hidden while nothing is due. Select it to open the view; hover for the first few overdue tasks, how many [need a new date](#tasks-view), and how many were done today. Tasks more than `deckard.tasks.needsNewDateAfterDays` (30) days overdue are not counted. `deckard.statusBar` turns it off.

- **Reminder.** Set `deckard.taskReminderTime` to a time such as `09:00` to see what is due once a day, or when VS Code next opens that day. It offers **Open Tasks View**, **Reschedule Overdue…**, and **Turn Off Reminders**. Empty by default.
- **Word count.** While a note is open: **412 words · 2 min**, or **38 of 412 words** with a selection. Front matter, code, comments, link addresses, and task metadata are not counted; minutes are at 238 words a minute. Right-click the status bar to hide it.

## Quick capture

Run `Deckard: Capture` and type a task. Deckard adds it as `- [ ] …` to today's daily note, creating it from your template if needed. If you close the box with words in it, the next Capture brings them back.

- **Quick add.** Words at the end are read in any order: a day (`today`, `friday`, `next monday`, `in 3 days`, `oct 3`; or after `on`, `by`, or `due`, a short day such as `fri`, `+2w`, a date, or `10/3`), a priority (`p1` to `p4`, or `!!!`, `!!`, `!`), a repeat rule (`every week`, `daily`), and who it is for (`for @dana`). `@dana to …` at the start hands the task to Dana too; a person mentioned anywhere else stays a mention. `Call Ren friday p2` becomes `- [ ] Call Ren ⏫ 📅 2026-10-02`, and `Send the deck for @dana friday` becomes `- [ ] Send the deck 📅 2026-10-02 👤 @dana`, previewed as you type. **Keep the words as written** reads nothing. **Add as a note line** writes a plain `- …` item.
- **Under a heading.** The list button, or `Deckard: Capture Under a Heading`, picks a heading from any note, starting with the five used last.
- **From a selection.** Select up to 120 characters on one line and Capture starts from them, with a link to the heading they were under: `- [ ] Call Ren [[2026-09-22#Weekly review]] 📅 2026-10-02`. The link button turns it off. **Restore what you were typing** brings back your earlier draft.
- Unsaved changes in an open note are kept, and the note is saved.

---

← [Writing notes: tags, people, and links](notes-and-links.md) · [All topics](README.md) · [Task board](task-board.md) →
