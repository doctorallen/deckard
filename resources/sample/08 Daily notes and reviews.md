# Daily notes and reviews

A **daily note** is a note named for its day, such as `2026-09-25.md`. It is
where the day's work is written down as it happens: a heading for each thing
worked on, tagged with what it is about, and the tasks that came out of it.
Searches, the calendar, and reviews all know which day each one is.

This sample has six daily notes: today's, yesterday's, and ones from two,
five, eight, and nine days ago. Their names are the dates, so they sort first
in the Explorer.

## What the daily notes show

- **Today's note** has two tasks due today and one already done.
- **Yesterday's note** has a **Carried over** section: a task that was left
  open five days ago and brought forward. The line it was brought from, in
  the note from five days ago, now reads `- [>]` with a link to yesterday.
  A `[>]` line is no longer a task, so the task is only counted once.
- **Five days ago** has a person heading under each team member, so a search
  for that person lands on what they are doing.
- **Nine days ago** has the misspelled tag from the Tags note.

## Rollover

A daily note that starts from its template leaves last night's open tasks
behind. This sample's settings turn on **rollover** in `migrate` mode, the
bullet journal way: the tasks are written into today's note, and each line
left behind becomes `[>]` with a link to today. It looks back a week, so the
tasks in the notes from eight and nine days ago stay where they are.

## Reviews

**Deckard: Open Weekly Note** creates this week's note, named for the days it
holds, and writes a review into it: what was completed, what is still open,
what is coming up, the notes written and changed, and the tags first seen
that week. It is ordinary Markdown, not a live list, so it says what the week
was. This sample's settings add one section of their own, **Waiting on
others**, which lists what the `is:waiting` search finds.

## Try it

1. Press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd>
   (**Deckard: Create Daily Note**). Today's note is already here, so it
   opens.
2. In today's note, use **‹** in the title bar, or **Deckard: Open Previous
   Daily Note**, to step back through the days. The note from three days ago
   does not exist, so it is skipped.
3. Today's note offers **Carry in N unfinished tasks** on its first line.
   Select it, or run **Deckard: Roll Unfinished Tasks Forward**. The open
   tasks from the last week's daily notes are written under **Carried over**,
   and the lines they came from become `[>]`. The message offers **Undo**.
4. Open the **Calendar** in the Deckard sidebar. A dot marks each day with a
   daily note, a number counts the tasks due that day, and an outlined number
   counts the tasks scheduled. This sample turns on the **day panel**: select
   a day and the panel under the month lists its note, its tasks, and the
   notes created that day. Double-click a day to open its note.
5. Select the mark beside a week in the Calendar, or run **Deckard: Open
   Weekly Note**, and read the review it writes. Run **Deckard: Write a
   Review** later to bring it up to date.
6. Search for `is:daily is:open` to see every open task written in a daily
   note, and `-is:daily` for everything else.

Next: [[09 Capture, move, and park]]
