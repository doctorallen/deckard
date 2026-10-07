# Start here

This folder is a tour of Deckard that you read and do. Each numbered note
explains one part of Deckard, holds the tasks, tags, and links that make it
show up, and ends with **Try it**: the commands to run, the keys to press,
and the searches to type, with what you should see.

The notes are about a small fictional unit: two teams, **Wardens** in the
field and **Harbor** on sources and the clinic, and the projects they run.
You are **Juno Hale**, the lieutenant who writes the daily notes.

Every date was set on the day this sample was made, so something is overdue,
something is due today, and the daily notes run up to today, whenever you
read this.

## Read in this order

Open each note in the editor, where Deckard draws its hints, and keep the
Deckard sidebar open beside it. A link below opens the note in the preview;
the **Open Source** button in the preview's title bar opens it in the
editor. Keys are written for macOS: use <kbd>Ctrl</kbd> for <kbd>Cmd</kbd> on
Windows and Linux.

1. [Tasks](<01 Tasks.md>): due, scheduled, and start dates, priorities,
   overdue and Needs a new date, Done today, steps, and the Tasks view.
2. [Task board](<02 Task board.md>): statuses and the board, who a task is
   for, blocked tasks, and contexts.
3. [Repeats and dates](<03 Repeats and dates.md>): every kind of repeat rule,
   and the dates you can type in plain words.
4. [Search](<04 Search.md>): Find, search pages, and the query language, with
   a search to run for every field.
5. [Query blocks](<05 Query blocks.md>): live search results inside a note,
   a table of notes, and tasks you tick right in the preview.
6. [Tags and people](<06 Tags and people.md>): namespaces, hub notes and the
   Hubs view, a project's progress, a misspelled tag to merge, and a name
   written without its tag.
7. [Links](<07 Links.md>): links to notes, headings, and lines, embeds, a
   link to a note that does not exist yet, and copying a note for elsewhere.
8. [Daily notes and reviews](<08 Daily notes and reviews.md>): daily notes,
   rollover, weekly reviews, the calendar, and your tasks in your own
   calendar app.
9. [Add, move, and park](<09 Add, move, and park.md>): Add Task,
   Move to…, Extract Heading, templates and the `/` menu, and parked notes.
10. [Home, Stats, and the graph](<10 Home, Stats, and the graph.md>): Home and
    its Progress widget, Related Notes, Stats, the Notes Graph, themes, and
    zen.

## What else is here

- **Daily notes**, named for their days:
  [{{date-9}}](<{{date-9}}.md>), [{{date-8}}](<{{date-8}}.md>),
  [{{date-5}}](<{{date-5}}.md>), [{{date-2}}](<{{date-2}}.md>),
  [{{date-1}}](<{{date-1}}.md>) (yesterday), and [{{date}}](<{{date}}.md>)
  (today).
- **Hub notes**, each describing one tag:
  [Ghostline Relay](<projects/Ghostline Relay.md>) and
  [Argent Protocol](<projects/Argent Protocol.md>) for two projects,
  [Harbor](<teams/Harbor.md>) and [Wardens](<teams/Wardens.md>) for the
  teams, and [Sable Ortiz](<people/Sable Ortiz.md>) for a person.
  [Receiver firmware](<projects/Receiver firmware.md>) is a sub-project,
  filed under Ghostline Relay in the **Hubs** view by its `up:` front matter.
- **Notes filed under the hubs**: the
  [Relay route survey](<projects/Relay route survey.md>), under Ghostline
  Relay by its project tag, and the
  [Firmware bench log](<projects/Firmware bench log.md>), under Receiver
  firmware by `up:` alone.
- [Loose ends](<Loose ends.md>), a note with no tags, for Related Notes.
- [Velvet Circuit](<archive/Velvet Circuit.md>), a finished project,
  parked.
- The **templates** folder, with a meeting template and one for new project
  hub notes. Deckard does not index it.

## This folder's settings

`.vscode/settings.json` sets what the tour depends on, for this folder only,
so your own settings cannot hide its notes or change what it says:

- `deckard.me` says you are Juno Hale, for `is:mine` and the Person columns.
- `deckard.board.limits` puts a limit of 2 on the board's In progress column.
- `deckard.dailyNote.rollover` is `migrate`, so carrying tasks forward
  leaves a `[>]` line behind.
- `deckard.periodicNote.reviewSections` adds a **Waiting on others** section
  to reviews.

The sample is kept in VS Code's storage for Deckard. Change anything you
like: running **Deckard: Create a Sample Workspace** again replaces it with a
fresh copy dated from that day.

To begin, open [Tasks](<01 Tasks.md>).
