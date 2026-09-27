# Daily notes, reviews, and the calendar

## Daily notes

Run `Deckard: Create Daily Note` from the Command Palette, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> on Windows and Linux), or use the shortcut in Related Notes. Deckard creates a note named with the local date, such as `2026-08-30.md`, in your configured notes folder or workspace root and opens it. If today's note already exists, Deckard opens it without replacing its contents.

`Deckard: Open Previous Daily Note` and `Deckard: Open Next Daily Note` step to the nearest daily note before or after the one in the editor, skipping days without a note. From any other note they start from today.

`Deckard: Open Daily Note for Date…` opens the note for any day. It lists yesterday, today, tomorrow, and your seven newest daily notes; type a day [in plain words](tasks.md#dates-in-plain-words), such as `last friday`, `oct 3`, or `2026-10-02`, and it offers that day's note, saying when it will create one from the daily note template. Today's note is created as `Deckard: Create Daily Note` creates it, rollover included. [Find](search.md#find) does the same when all you type is a day.

`Deckard: Open Weekly Note` and `Deckard: Open Monthly Note` create or open the note for this week or this month, **named for the days it holds**: `week-2026-09-13-2026-09-19.md` and `month-september-2026.md`. A week runs Sunday to Saturday, or from the day `deckard.calendar.weekStart` names, as the [Calendar](#calendar) draws it. A weekly note written before you change the week start still opens: each week opens the note that holds its middle day, which shares at least four days with it, so after a switch to Monday the week of Monday 2026-09-21 opens `week-2026-09-20-2026-09-26.md`, and **Write a Review** in that note still covers its own days.

Each has its own template, `deckard.weeklyNoteTemplate` and `deckard.monthlyNoteTemplate`. `{week}` becomes the days the period covers — *2026-09-13 to 2026-09-19* — `{month}` the month as *September 2026*, and `{date}` the first day: a week's first day, or a month's first.

Notes Deckard named before, `2026-W38.md` and `2026-09.md`, are still read and still opened for their period, so a workspace that has them goes on using them rather than gaining a second note for the same week. Rename one to the new form whenever you like; nothing needs migrating.

### Writing a review

A periodic note used to open from its template and say nothing. `Deckard: Open Weekly Note` and `Deckard: Open Monthly Note` now write a review into a note they create, and `Deckard: Write a Review` writes one, or brings it up to date, whenever you ask — for the period of the note you are in, or one you pick.

A review reads the index for that period and says:

| Section | What it lists |
| --- | --- |
| **Completed** | Tasks with a ✅ date in the period, oldest first |
| **Still open** | Tasks due by the end of the period that are still open: what slipped |
| **Coming up** | Open tasks due, scheduled, or starting in the next week or month, each led by its day, soonest first |
| **Notes written** | Notes created in the period |
| **Notes changed** | Notes written earlier and changed in it |
| **New tags** | Tags Deckard first saw in the period |

- The line under the heading sums it up — **Done:** 12 (8 of 11 that were due) · **Still open:** 5 · **Coming up:** 9 · … — where the share says how many tasks due in the period were done by their day.
- `deckard.periodicNote.reviewSections` adds sections of your own at the end, each a title and a search: `[{ "title": "Waiting on others", "query": "is:waiting" }]`. Each is written as a plain list of what the search found then, up to 20; a search that does not parse says so in its section rather than failing the review.
- A review is **named by the days it covers** — *Review of 2026-09-13 to 2026-09-19* — since a week number says little when you read it back. The note it is in still says which period it is.
- It is **ordinary Markdown**, not a live query, because a review should say what that week was rather than what this week is. Run it again and it is rewritten from the index as it stands.
- When one is written, Deckard says so with **Open** to read it — at the review itself — and **Undo** to take it back out of the note.
- It sits between `<!-- deckard:review -->` and `<!-- deckard:review:end -->`. Writing it again replaces what is between them and leaves everything you wrote around it exactly where it is.
- Each note and task links to its note with a `[[link]]`, so the review is a way back into the week.
- **The review carries no tags of its own.** Task and note titles are written without their tags, and new tags are listed in a fenced block, since fenced code is the one place Deckard does not read a tag. A review is about that work; it should not become an entry for every tag it mentions, nor list its tasks as tasks again.
- `deckard.periodicNote.review` turns off the review a newly created weekly or monthly note gets. The command writes one whatever the setting says.

### Carrying unfinished tasks forward

A daily note that starts from its template every morning leaves last night's open tasks behind in yesterday's note. `deckard.dailyNote.rollover` decides what a newly created daily note does about that:

| Setting | A new daily note |
| --- | --- |
| `off` *(default)* | starts from the template alone |
| `move` | takes the last daily note's unfinished tasks out of it and into today's |
| `migrate` | writes them into today's, and marks each line left behind `[>]` with a link to today, as a bullet journal does: `- [>] Call Ren 📅 2026-09-20 → [[2026-09-25]]` |
| `copy` | the older name for `migrate`, which it now means |

- The tasks come from **every earlier daily note**, oldest first, not only yesterday's: a task left open on Friday still comes forward on Monday, and one left before a week away comes forward when you are back. Other notes are left alone: a task written under a project note stays there, where it was filed.
- `deckard.dailyNote.rolloverDays` bounds how far back it looks: a week by default. `0` reaches as far as your daily notes go; an older dated task shows under the Tasks view's **Needs a new date** anyway.
- Each task is written exactly as it was, its dates, priority, people, and tags included, and they keep their order. A task's [steps](tasks.md#breaking-a-task-into-steps) travel with it, nested under it as they were: `move` takes everything written under the task, done steps and notes included, so nothing is left under another task, and `migrate` copies its open steps and marks each line it leaves. A step whose task is not carried — done, say — comes forward on its own at the top level, never under an unrelated task, and two tasks' steps with the same words are both carried. They go under a **Carried over** heading at the end of today's note, one level below the note's first heading — `## Carried over` under the default `# {date}` — and a second rollover adds to the same heading.
- A migrated `[>]` line is not a task to the index, so it stops counting as open, and its `[[link]]` gives today's note a backlink to where the task was.
- A task is carried only when its line still reads as Deckard indexed it, the same check every other Deckard task edit makes, and never when today's note already holds that line. Running it twice changes nothing.
- In `migrate` mode a task that has waited several days, from before migrate marked its lines, is carried once, from the newest note that holds it.
- Only a note Deckard creates rolls tasks in, so opening today's note again later in the day carries nothing.
- `Deckard: Roll Unfinished Tasks Forward` does the same thing whenever you ask, whatever the setting says, creating today's note if it is not there yet. It moves the tasks unless the setting says `migrate` or `copy`.
- The whole rollover is one write. What it says when it is done offers **Open**, for the day's note it wrote into — which it may have just created — and **Undo**, which puts every note back without opening any of them. `Deckard: Undo Last Change` does the same thing later.

## Calendar

The **Calendar** view in the Deckard sidebar shows a month of whole weeks, Sunday to Saturday unless `deckard.calendar.weekStart` starts them on Monday or where your display language does. Every day is drawn the same way — the date, then a dot for a daily note, then a count of the open tasks due that day, in orange once the day has passed and muted once it is more than 30 days gone, when its tasks need a new date, and beside it, outlined, the open tasks scheduled (⏳) that day — so a day that has something to mark keeps its date in the same place as one that does not. Select a day to open its daily note, the mark beside a row to open that week's note, or the month's name to open the month's note. When the note does not exist yet, Deckard offers to create it from its template rather than creating it straight away. The arrows step through months, and **Today** returns to this month. Hovering a day lists the tasks due that day and the headings of its daily note.

**The day panel.** Turn on `deckard.calendar.dayPanel`, or choose **Open Day Panel** from the Calendar's `…` menu, to show the chosen day under the month. A click, Space, or the arrow keys then choose a day rather than open it; a double-click or Enter opens its note, and **Today** comes back to today. The panel names the day — *Friday, September 25 · Today* — and offers its daily note, **Open** or **Create**, without asking again. Under it are the tasks due that day, then those scheduled, five of each with **Show 7 more** for the rest, each with a checkbox and a **Tomorrow** button — **Next day** on a day after tomorrow — that moves its due or scheduled date on, with Undo; and, folded, the tasks done that day, which unchecking reopens. Last come the notes created that day, oldest first, by their title with their folder beside it, daily, weekly, and monthly notes aside; after five, **Search all 14** opens `created = 2026-09-25` as a search page. **Close Day Panel** puts the one-click open back.

**Repeats.** A repeating task is drawn on every later date its rule lands on in the weeks shown, not only its next one: a muted **↻** beside a day's counts, named in the day's tooltip, and a **Repeats** group in the day panel. Those dates are projected from the rule and never written; a row there opens the task, which is completed on its current date. A rule that ends in `when done` is shown on its next date only, since the dates after it depend on the day it is done. Turn repeats off with `deckard.calendar.showRepeats`, or **Turn Off Repeats** in the Calendar's `…` menu.

**Weekends.** Turn off `deckard.calendar.showWeekends`, or choose **Hide Weekends** from the Calendar's `…` menu, to draw each week as its five working days, in the sidebar and on the calendar page alike; the arrow keys step over the weekend. **Include Weekends** brings them back.

**The calendar page.** `Deckard: Open Calendar`, the calendar button in the Related Notes title bar, or the one in the Calendar view's title bar, opens the calendar as a page of its own, on the month and day the sidebar shows. Each day lists its tasks by name — due, then scheduled (⏳), then repeats (↻, dashed) — with **+3 more** for the rest. A click anywhere in a day chooses it. The chosen day's panel sits beside the month, or under it in a narrow editor; while the Related Notes sidebar is open, the panel is shown there instead and the month takes the page's whole width. **Month** and **Week** switch between the month and the week the chosen day is in, where every task is listed. Drag a due or scheduled task to another day to move its date there; a repeat's dates follow its rule, so it stays put. The arrows step by the layout, `[` and `]` do the same, `t` returns to today, `m` and `w` switch the layout, and `?` lists the keys. A click on a sidebar day still opens its note.

---

← [Related notes, the graph, and the outline](connections.md) · [All topics](README.md) · [Renaming, moving, and parking](organizing.md) →
