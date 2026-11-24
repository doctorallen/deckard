# Daily notes, reviews, and the calendar

## Daily notes

Run `Deckard: Create Daily Note`, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> on Windows and Linux), or use the button in the Context view. Deckard creates or opens a note named with the local date, such as `2026-08-30.md`.

- `Deckard: Open Previous Daily Note` and `Deckard: Open Next Daily Note` step to the nearest daily note before or after the current one. From another note they start from today.
- [Find](search.md#find) opens the daily note for a day typed [in plain words](tasks.md#dates-in-plain-words), such as `last friday` or `2026-10-02`, when you type only a day; a missing note is created from the template.
- `Deckard: Open Weekly Note` and `Deckard: Open Monthly Note` create or open `week-2026-09-13-2026-09-19.md` and `month-september-2026.md`. A week runs Sunday to Saturday, or from the day `deckard.calendar.weekStart` names.
- A new note starts from its [template](#templates).
- [Add Task](tasks.md#adding-a-task) (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>) with no note open writes into today's note, creating it if needed, and its title names the note before anything is written.
- Older names, `2026-W38.md` and `2026-09.md`, are still read and opened for their period.
- **Where they go.** New daily, weekly, and monthly notes are written at the top of the notes folder, or in `deckard.periodicNotes.folder` inside it, such as `journal/{yyyy}` for a folder a year (`{mm}` is the month). A note already written elsewhere is still found for its day.
- **Whose clock.** Days and times are those of the machine Deckard runs on: over Remote-SSH or in a Codespace, the remote's time zone, so a remote set to UTC starts a new day at UTC midnight. The / menu's **Time (UTC)** writes the time in UTC for a log such as an incident timeline, beside **Time** for the machine's own.

### Templates

A new daily, weekly, or monthly note starts from a file in the templates folder (`deckard.templatesFolder`, `templates` unless you change it), when it is there:

| Note | Template | Without one |
| --- | --- | --- |
| Daily | `Daily.md` | `# {date}` |
| Weekly | `Weekly.md` | `# {week}` |
| Monthly | `Monthly.md` | `# {month}` |

- In a template, `{date}` becomes the period's first day, as *2026-09-13*; `{week}` the days the week holds, as *2026-09-13 to 2026-09-19*; and `{month}` the month, as *September 2026*. Any of the three works in any template.
- The file is read each time a note is made, so a change to it reaches the next note. A note that already exists is never rewritten.
- The templates folder is not indexed, and [New Note from Template](notes-and-links.md#templates) lists these files too. With the setting empty there are no templates, and each note starts from the line in the last column.

### Writing a review

`Deckard: Open Weekly Note` and `Deckard: Open Monthly Note` write a review into a note they create. `Deckard: Write a Review` writes or updates one for the current note's period, or one you pick.

| Section | What it lists |
| --- | --- |
| **Completed** | Tasks with a ✅ date in the period, oldest first |
| **Top three** | Each day's [top tasks](tasks.md#top-three): how many were done that day, and the rest. Only when a daily note in the period has picks |
| **Still open** | Tasks due by the end of the period that are still open |
| **Coming up** | Open tasks due, scheduled, or starting in the next week or month, soonest first |
| **Notes written** | Notes created in the period |
| **Notes changed** | Notes written earlier and changed in it |
| **New tags** | Tags Deckard first saw in the period |

- A summary line sits under the heading: **Done:** 12 (8/11 done (73%) of those due) · **Still open:** 5 · **Coming up:** 9 · …
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

- Tasks come from **every earlier daily note**, oldest first, within the last week. Other notes are left alone.
- Tasks are written exactly as they were, in order, under a **Carried over** heading at the end of today's note, one level below its first heading (`## Carried over` under `# {date}`). A second rollover adds to it.
- **A task keeps its meeting.** A task that was written under a heading is carried under that heading, written again one level below Carried over with its tags, so the task is still about the project and the person. The line under it links to the heading the task was first written under, and stays the same however many days the task is carried:

  ```markdown
  ## Carried over

  - [ ] Book travel

  ### Vendor sync #project/borealis @dana
  ([[2026-11-13#Vendor sync]])
  - [ ] Send the quote
  ```

  The heading is the nearest one above the task with tags of its own, with the tags of the headings above it added; where none has tags, the outermost below the note's title. Tasks under the note's title alone go under Carried over itself, above the headings. The link is written as `deckard.links.style` says. With `move`, a carried heading left with nothing but its link is taken out of the earlier note.
- [Steps](tasks.md#breaking-a-task-into-steps) travel with their task. `move` takes everything under the task; `migrate` copies its open steps and marks each line it leaves. A step whose task is not carried comes forward on its own at the top level.
- A `[>]` line is not a task, so it stops counting as open, and its link gives today's note a backlink.
- A task is carried only if its line is unchanged since indexing and not already in today's note. In `migrate` mode, a task in several notes is carried once, from the newest. Only a note Deckard creates rolls tasks in.
- `Deckard: Roll Unfinished Tasks Forward` does it on demand, whatever the setting, creating today's note if needed. It moves tasks unless the setting is `migrate` or `copy`.
- The rollover is one write, with **Open** and **Undo** afterward. `Deckard: Undo Last Change` also undoes it. Its notes go back together or not at all: if one changed since, Undo puts nothing back and names that note.

### Starting a meeting

`Deckard: Start a Meeting` writes a meeting's heading where the meeting belongs and puts the cursor under it, so its notes sit with the project or the person they are about and today's note still lists it.

- **What it is about.** A list offers **No one thing**, for today's note; then the projects, people, and other subjects you wrote about lately, most first; then the notes that already hold meetings; then **A note of its own…**. Type to narrow it, and press <kbd>Enter</kbd> on a row to choose it.
- **Its name.** Then type the meeting's name, or leave it empty.
- **What is written.** In `Borealis.md`, the hub note of `#project/borealis`, at the end: `## 2026-11-16 10:00 Vendor sync`, a [dated heading](notes-and-links.md#dated-headings), so the note keeps the project's meetings in order under what describes it, and each is found by its day. The time is the clock's, to the nearest five minutes. Today's note gains `- 10:00 [[Borealis#2026-11-16 10:00 Vendor sync]]` at its end, and is created if it is not there, with the tasks a [rollover](#carrying-unfinished-tasks-forward) carries in.
- **About several things.** Check more than one row: the first you check is where the notes go, and the others end the heading as tags, `## 2026-11-16 10:00 Vendor sync @priya`, so the meeting is on Priya's page too. A note checked after the first is left out, since a meeting is written in one place.
- **About no one thing.** In today's note the heading is `## 10:00 Vendor sync`, with the tags of anything else you checked, and no link is written. [Move to…](organizing.md#moving-a-section) files it later, putting the day in its heading.
- **A subject with no hub note** gets one, as [Create Hub Note for Tag](search-pages.md#hub-notes) makes it, and the meeting is written there.
- **A meeting that recurs.** **A note of its own…** makes a note with the meeting's name, such as `Weekly staff.md`, or uses the one there is, and heads each time it is held with its day and time alone: `## 2026-11-16 10:00`. From then on the note is in the list under **Meeting notes**.
- **What is offered.** A tag that names a person, sits in a namespace such as `#project/…`, or has a hub note, by how many headings carry it and how lately: one written two weeks ago counts half of one written today, and nothing counts after 60 days. The 12 that count most are listed. The notes under **Meeting notes** are the five with the latest [dated heading](notes-and-links.md#dated-headings) in those 60 days.
- It is one write, and `Deckard: Undo Last Change` takes back the heading and the link together.

### Today's top three

`Deckard: Pick Today's Top Tasks` writes the few tasks to do first into today's note, under `## Top three`, each a link to its task's line. The status bar, the Tasks view, Home, and the review read them back from there. See [Top three](tasks.md#top-three).

### Promises in today's note

Much of what you wait on is a sentence, not a task: *@sam-okafor says the loader retry fix lands by Friday*. In today's daily note, a line that names one person and a day to come is a promise you can track:

- Its day words get a faint wavy underline, and a lens above it offers **Track: Sam · Fri, Oct 16** and **Not a promise**. The lightbulb offers **Track as waiting on Sam, due Fri, Oct 16**, **Track as waiting on Sam…**, which opens the [task editor](tasks.md#editing-a-whole-task) first, to change the day or the words, and **Not a promise**.
- **Track** writes a waiting task under the line, as a child list item, so it travels with the sentence: `  - [w] Loader retry fix lands 📅 2026-10-16 👤 @sam-okafor`. Its status is the first on-hold [status](tasks.md#task-statuses) you have (Waiting, `[w]`, unless you changed them), and its metadata is written in your format, or in Dataview's brackets when the note's tasks use them. Undo takes it back. From then on it is an ordinary task: on the board, found by `is:waiting`, under **Sam owes you** on Sam's [Between you](search-pages.md#between-you-and-a-person) card, and overdue when the day passes.
- **The title** is the words after the person and *says*, *said*, *will*, *promised*, or *to*, without the day, a leading *that* or *the*, or the closing punctuation: *Loader retry fix lands*. When that leaves fewer than two words, it is the whole line without the day.
- **The person** is one `@name` or `#person/…` tag, and not you (`deckard.me`). A line naming two people, or only you, is no promise.
- **The day** is after today and no more than 60 days off: `by Friday`, `on Friday`, `Friday`, `on fri`, `tomorrow`, `next week` and `end of week` or `EOW` (that week's Friday), `end of month` or `EOM`, `on the 20th`, `Oct 20`, `20 Oct`, `10/20` (read in your date format's order), `2026-10-20`, or `in 3 days`. Of two days on a line, the last is the promise's.
- A task, a [question](tasks.md#questions) (`- [?] …`, or a line ending in `?`), a heading, and code are never promises, and a line with a task under it assigned to the same person, done or not, is already tracked.
- **Not a promise** is remembered for that line, by its words, in VS Code's storage for the workspace. Change the words and it is offered again.
- Only today's note is read, while you write in it; older notes are left alone. `deckard.editor.trackPromises` turns the underline, the lens, and the lightbulb off; it follows the [editor preset](notes-and-links.md#editor-assistance) while unset, on in **Full** and **Tasks**. The lens follows VS Code's own `editor.codeLens`. The underline's color is `deckard.promiseUnderline` in `workbench.colorCustomizations`.

## Calendar

The **Calendar** view in the Deckard sidebar shows a month of whole weeks, Sunday to Saturday unless `deckard.calendar.weekStart` or your display language starts them on Monday. Each day shows its date, a dot for a daily note, a count of open tasks due (orange once past, muted once more than 30 days gone), and, outlined, open tasks scheduled (⏳) that day. In a new install it starts collapsed; expand it, or drag it where you like.

Select a day, the mark beside a week, or the month's name to open its note; Deckard offers to create a missing one. The arrows step through months; **Today** returns.

**Repeats.** A repeating task shows a muted **↻** on every later date its rule lands on in the visible weeks, and a **Repeats** group in the calendar page's day panel. These dates are not written; a row opens the task. A `when done` rule shows only its next date.

**Weekends.** **Show weekends**, in the calendar page's **⋯**, shows all seven days; clear it for five working days, on the page and in the Calendar view alike.

**The calendar page.** `Deckard: Open Calendar`, **Calendar** at the top of the Context view, or the button in the Calendar view's title bar, opens the calendar as a page. Each day lists its tasks by name: due, then scheduled (⏳), then repeats (↻, dashed), with **+3 more**. Click a day to choose it; its panel sits beside or under the month, or in the Context sidebar while that is open. Double-click a day, or press Enter on it, to open its note. The panel shows:

- the day's name, such as *Friday, September 25 · Today*, and its daily note, **Open** or **Create**;
- tasks due, then scheduled, five of each with **Show 7 more**, each with a checkbox and a **Tomorrow** button (**Next day** after tomorrow) that moves its date, with Undo, shown on the row under the pointer or with focus;
- tasks done that day, folded; uncheck to reopen;
- notes created that day, apart from daily, weekly, and monthly notes. After five, **Search all 14** opens `created = 2026-09-25`.

On the page:

- The top right reads **‹ Today ›**, **Month | Week**, and **⋯**: the arrows step, **Today** returns, and **Month** and **Week** switch layouts. **⋯** holds **Show weekends**, **Theme…** and **Zen**, **Help on this page**, and **Keyboard shortcuts**.
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
