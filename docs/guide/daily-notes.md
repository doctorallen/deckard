# Daily notes, reviews, and the calendar

## Daily notes

Run `Deckard: Create Daily Note`, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> on Windows and Linux), or use the button in the Context view. Deckard creates or opens a note named with the local date, such as `2026-08-30.md`.

- `Deckard: Open Previous Daily Note` and `Deckard: Open Next Daily Note` step to the nearest daily note before or after the current one. From another note they start from today.
- `Deckard: Open Daily Note for Date…` lists yesterday, today, tomorrow, and your seven newest daily notes, or takes a day [in plain words](tasks.md#dates-in-plain-words), such as `last friday` or `2026-10-02`; a missing note is created from the template. [Find](search.md#find) does the same when you type only a day.
- `Deckard: Open Weekly Note` and `Deckard: Open Monthly Note` create or open `week-2026-09-13-2026-09-19.md` and `month-september-2026.md`. A week runs Sunday to Saturday, or from the day `deckard.calendar.weekStart` names.
- Templates are `deckard.weeklyNoteTemplate` and `deckard.monthlyNoteTemplate`. `{week}` becomes *2026-09-13 to 2026-09-19*, `{month}` becomes *September 2026*, and `{date}` the period's first day.
- Older names, `2026-W38.md` and `2026-09.md`, are still read and opened for their period.

### Writing a review

`Deckard: Open Weekly Note` and `Deckard: Open Monthly Note` write a review into a note they create. `Deckard: Write a Review` writes or updates one for the current note's period, or one you pick.

| Section | What it lists |
| --- | --- |
| **Completed** | Tasks with a ✅ date in the period, oldest first |
| **Still open** | Tasks due by the end of the period that are still open |
| **Coming up** | Open tasks due, scheduled, or starting in the next week or month, soonest first |
| **Notes written** | Notes created in the period |
| **Notes changed** | Notes written earlier and changed in it |
| **New tags** | Tags Deckard first saw in the period |

- A summary line sits under the heading: **Done:** 12 (8 of 11 that were due) · **Still open:** 5 · **Coming up:** 9 · …
- `deckard.periodicNote.reviewSections` adds your own sections, each a title and a search: `[{ "title": "Waiting on others", "query": "is:waiting" }]`. Each lists up to 20 results. A search that does not parse says so in its section.
- It is plain Markdown with `[[links]]`, headed *Review of 2026-09-13 to 2026-09-19*, between `<!-- deckard:review -->` and `<!-- deckard:review:end -->`. Running it again rewrites only that part. Deckard offers **Open** and **Undo**.
- It adds no tags: titles are written without tags, and new tags are listed in a fenced block.
- `deckard.periodicNote.review` turns off the review in newly created notes. The command still writes one.

### Carrying unfinished tasks forward

`deckard.dailyNote.rollover` sets what a newly created daily note does with earlier unfinished tasks:

| Setting | A new daily note |
| --- | --- |
| `off` *(default)* | starts from the template alone |
| `move` | takes earlier daily notes' unfinished tasks out of them and into today's |
| `migrate` | writes them into today's, and marks each line left behind `[>]` with a link to today: `- [>] Call Ren 📅 2026-09-20 → [[2026-09-25]]` |
| `copy` | the older name for `migrate` |

- Tasks come from **every earlier daily note**, oldest first, within `deckard.dailyNote.rolloverDays` (a week by default; `0` for no limit). Other notes are left alone.
- Tasks are written exactly as they were, in order, under a **Carried over** heading at the end of today's note, one level below its first heading (`## Carried over` under `# {date}`). A second rollover adds to it.
- [Steps](tasks.md#breaking-a-task-into-steps) travel with their task. `move` takes everything under the task; `migrate` copies its open steps and marks each line it leaves. A step whose task is not carried comes forward on its own at the top level.
- A `[>]` line is not a task, so it stops counting as open, and its link gives today's note a backlink.
- A task is carried only if its line is unchanged since indexing and not already in today's note. In `migrate` mode, a task in several notes is carried once, from the newest. Only a note Deckard creates rolls tasks in.
- `Deckard: Roll Unfinished Tasks Forward` does it on demand, whatever the setting, creating today's note if needed. It moves tasks unless the setting is `migrate` or `copy`.
- The rollover is one write, with **Open** and **Undo** afterward. `Deckard: Undo Last Change` also undoes it. Its notes go back together or not at all: if one changed since, Undo puts nothing back and names that note.

## Calendar

The **Calendar** view in the Deckard sidebar shows a month of whole weeks, Sunday to Saturday unless `deckard.calendar.weekStart` or your display language starts them on Monday. Each day shows its date, a dot for a daily note, a count of open tasks due (orange once past, muted once more than 30 days gone), and, outlined, open tasks scheduled (⏳) that day.

Select a day, the mark beside a week, or the month's name to open its note; Deckard offers to create a missing one. The arrows step through months; **Today** returns.

**The day panel.** Turn on `deckard.calendar.dayPanel`, or choose **Open Day Panel** from the Calendar's `…` menu, to show the chosen day under the month. A click, Space, or arrow keys then choose a day; double-click or Enter opens its note. The panel shows:

- the day's name, such as *Friday, September 25 · Today*, and its daily note, **Open** or **Create**;
- tasks due, then scheduled, five of each with **Show 7 more**, each with a checkbox and a **Tomorrow** button (**Next day** after tomorrow) that moves its date, with Undo;
- tasks done that day, folded; uncheck to reopen;
- notes created that day, apart from daily, weekly, and monthly notes. After five, **Search all 14** opens `created = 2026-09-25`.

**Close Day Panel** brings back one-click opening.

**Repeats.** A repeating task shows a muted **↻** on every later date its rule lands on in the visible weeks, and a **Repeats** group in the day panel. These dates are not written; a row opens the task. A `when done` rule shows only its next date. Turn this off with `deckard.calendar.showRepeats` or **Turn Off Repeats** in the `…` menu.

**Weekends.** Turn off `deckard.calendar.showWeekends`, or choose **Hide Weekends** from the `…` menu, to show five working days, in the sidebar and on the calendar page. **Include Weekends** brings them back.

**The calendar page.** `Deckard: Open Calendar`, or the calendar button in the Context or Calendar view title bar, opens the calendar as a page. Each day lists its tasks by name: due, then scheduled (⏳), then repeats (↻, dashed), with **+3 more**. Click a day to choose it; its panel sits beside or under the month, or in the Context sidebar while that is open.

- **Month** and **Week** switch layouts.
- Drag a due or scheduled task to another day to move its date. Repeats stay put.
- Keys: `[` and `]` step, `t` returns to today, `m` and `w` switch the layout, `?` lists the keys.

### Tasks in your calendar app

Deckard can write your dated tasks to a calendar file (`.ics`) that Apple Calendar, Outlook, Google Calendar, and most other calendar apps read. Each task is an all-day event on its due date, or on its scheduled date when it has none, and its notes link back to the task's line in VS Code. Nothing leaves your machine: the file is written where you say, and your calendar app reads it from there.

- **Once:** run `Deckard: Export Tasks as Calendar…`, choose where to save it, and import the file into your calendar app.
- **Kept up to date:** set `deckard.calendar.exportFile` to a path ending in `.ics`, such as `.deckard/tasks.ics` in the first workspace folder, `~/Calendars/tasks.ics`, or an absolute path, or choose **Keep It Up to Date** after an export. Deckard rewrites it a moment after your notes change, once the first scan has read them, and only when the calendar changed. It never writes over a file that is not a calendar, and a relative path cannot climb out of the folder. Apple Calendar can subscribe to the file (**File → New Calendar Subscription…** with its `file://` address) and follow your notes; Google Calendar subscribes only to web addresses, so import the file there instead. A file inside your notes is not indexed; add it to `.gitignore` if the folder is a repository.
- **Which tasks:** `deckard.calendar.exportQuery` is the search the file lists, every open task by default. `is:open is:mine` keeps it to yours, and `#project/atlas is:open` to one project. A done task the search finds is marked ✓.
- Moving a task's date moves its event rather than making a new one; a repeating task is an event on its next date.

---

← [Related notes, the graph, and the outline](connections.md) · [All topics](README.md) · [Renaming, moving, and parking](organizing.md) →
