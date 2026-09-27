# Search

Deckard has one search language, and it works everywhere: in **Find**, in the
search box on Home, on search pages, and on the Task board, in query blocks,
in the Tasks view's setting, and for an AI assistant. This note teaches it
with searches you can run against this sample. Each block below holds
searches to copy, one per line, and the list under it says what each finds
in a fresh copy of the sample. Once you have completed or moved tasks in the
other notes, the numbers move too.

## Find

**Deckard: Find in Notes** (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>)
is for getting to something quickly. Results appear as you type.

- Type `lens`. Notes titled with the word come first, then the entries that
  mention it.
- Type `ghostline`. The relay project's tag is offered, because a word also
  finds a tag by its name. <kbd>Tab</kbd> adds it to the search.
- Type `overd`. The `is:overdue` condition is offered.
- Type `calibratd`. Nothing has that word, so Find offers **Search for
  calibrated instead**.
- Type `yesterday`. Find offers to open yesterday's daily note.
- Type `Order rain boots tomorrow`. Nothing matches, so Find offers to
  capture it as a task in today's note, due tomorrow.
- On a task in the results, press **Complete** or **Set due** without leaving
  Find. <kbd>Cmd</kbd>+<kbd>.</kbd> lists everything a row can do.

## Search pages

Press <kbd>Enter</kbd> in Home's search box, run **Deckard: Open Search
Page**, or select **Show all results** in Find, to see everything a search
finds on a page of its own. Each term of the search is a chip with a **×**.
**Builder** under the box edits the same search as rows and groups.
**Refine** counts what the results could be narrowed by: select a value to
keep it, <kbd>Alt</kbd>-select to leave it out, and <kbd>Shift</kbd>-select
to allow it beside the one already chosen.

## Words, tags, and people

```search
calibrated lens
"opt-out corridor"
#project/ghostline-relay
#person/ren-kade
tag = #risk/*
```

- Plain words find every note section and task that has all of them. Quote
  words to find them together.
- A tag finds everything that carries it: the relay project's tag finds 23
  tasks, most of them because they sit under a heading that carries it.
- A person is a tag like any other. Ren's tag finds his three tasks and the
  hub note that names him as the relay's owner.
- `*` is a wildcard: every tag in the risk namespace.

## AND, OR, and NOT

```search
#project/ghostline-relay is:open
#team/wardens OR #team/harbor
#project/ghostline-relay -#status/doing
(#person/ren-kade OR #person/leena-sato) AND is:open
NOT (is:done OR is:step)
```

- Terms side by side are joined by AND: the open tasks of the relay project,
  20 of them.
- OR finds either. AND binds tighter than OR, so use parentheses to say
  otherwise, as the fourth search does: the open tasks that carry Ren's or
  Leena's tag, 5 of them. One is in the Argent Protocol hub, whose front
  matter names Leena, so every entry in it carries her tag.
- `-` or `NOT` in front of a term leaves it out. `NOT` in front of
  parentheses leaves out the whole group.

## Tasks by state

`is:` names a state, written the way GitHub writes it. Put `-` in front to
turn one around, as `-is:done`.

```search
is:open
is:done
is:task
is:note
is:overdue
is:today
is:due
is:needs-date
is:waiting
is:available
is:blocked
is:blocking
is:mine
is:assigned
is:unassigned
is:step
```

- `is:open` and `is:done`: 49 open tasks and 10 done ones. `is:task` is all
  of them; `is:note` is every note section instead.
- `is:overdue`: 3, the two overdue tasks in the Tasks note and the lease
  renewal, however long ago. `is:needs-date` is the lease renewal alone: the
  one more than 30 days past its due date.
- `is:today`: 4, the Tasks view's **Today**: due today, or scheduled for
  today. `is:due` adds everything due in the next seven days, and what is
  overdue.
- `is:waiting`: 4, the task marked waiting and the three whose 👤 names
  someone other than you.
- `is:available`: what can be started now. It leaves out the blocked
  comparison, the waiting and someday tasks, and the falloff test, which has
  not started.
- `is:blocked`: 1, the comparison waiting for calibration. `is:blocking`: 1,
  the calibration.
- `is:mine`: the tasks whose 👤 names you, Juno Hale, and every task for
  nobody in particular. `is:assigned`: 4 tasks name someone.
  `is:unassigned`: the rest.
- `is:step`: the 3 steps of the field kit task.

## Present or missing

`has:` finds tasks that have a field, and `no:` those that do not.

```search
has:due
no:due is:open
has:scheduled
has:start
has:priority
has:id
has:dependsOn
has:steps
has:done
no:steps is:open
```

- `has:scheduled`: 2. `has:start`: 2. `has:id` and `has:dependsOn`: 1 each,
  the two ends of the dependency in the Task board note.
- `has:steps`: 1, the field kit. `no:steps is:open` is every other open task,
  steps included.
- `no:due is:open` is the 23 open tasks with no due date: the Tasks view's
  **No date**, the task scheduled for today, the field kit's two open steps,
  and the parked task, which a search still lists, last.

## Dates

A date field takes a date, a day in plain words, a week or a month, or a
window of days. A week or a month means every day in it.

```search
due < today
due = today
due <= friday
due <= "end of month"
due = this-week
due = next-month
due < 7d
due = none
scheduled = today
start > today
done = today
done >= "last friday"
created = last-month
updated > 7d
created = 2026-08
```

- `due < today`: 3, the same as `is:overdue`. `due = today`: 3; the fourth
  task on today's list is scheduled, not due.
- `due <= friday` means on or before the next Friday. Quote a day written in
  more than one word, or join its words with `-`, as `end-of-month`.
- `due = next-month` includes the close-out report and the quarterly report,
  both due on the 15th of next month.
- `due < 7d` counts seven days forward from today, overdue included: 17.
- `scheduled = today`: 1. `start > today`: 1, the falloff test.
- `done = today`: 2. With `done`, a weekday means the last one.
- `created = last-month` finds the Argent Protocol hub, whose front matter
  says it was written on the 15th of last month. `updated > 7d` is what
  changed in the last seven days.

## People and priority

```search
assignee = #person/ren-kade
assignee = none
priority >= high
priority = none
```

- `assignee` is the 👤 field: 2 tasks are Ren's. `assignee = none` is every
  task nobody was named for.
- Priorities run `highest`, `high`, `medium`, `none`, `low`, `lowest`, and can
  be compared: `priority >= high` finds 2.

## Where it is written

```search
in:projects
path = teams/*
file = 20*.md
kind = person
kind = context
is:daily
-is:daily
is:periodic
is:parked
```

- `in:projects` is everything in the projects folder. `path` and `file` match
  a path or a file name, with `*` and `?` as wildcards: `file = 20*.md` is
  every daily note.
- `kind` is a namespace: `kind = person` finds everything that names a
  person, and `kind = context` the 4 errands with a context.
- `is:daily` is anything written in a daily note; `-is:daily` everything
  else. `is:periodic` adds weekly and monthly notes, once you write one.
- `is:parked`: the Velvet Circuit note and its one task.

## Links

A note's name in double brackets finds the entries that link to it.

```search
[[Ghostline Relay]]
[[Relay]]
link = [[Ghostline Relay#Decision]]
[[Ghostline Relay#^threshold]]
-[[Ghostline Relay]] #project/ghostline-relay
[[Relay field test plan]]
```

- The first two find the same 3 entries, because Relay is the hub's alias.
- A heading or a `^marker` narrows it to the links to that heading or line:
  the Links note and today's note both link to the threshold line.
- A link to a note that does not exist yet still counts, so the last search
  finds the entry waiting on that note.

## Text, and the operators

```search
text ~ calib
text = lens
text !~ relay
task = open
```

- `~` means contains, `!~` does not contain, `=` is a whole word, `!=` is
  not. `>`, `>=`, `<`, and `<=` compare dates and priorities.
- `task = open` is the long way to write `is:open`.

## Try it

1. Open a search page and search `#project/ghostline-relay is:open`. Select
   **Builder** to see it as two rows, then **Add condition** and type
   `high` to add a priority row.
2. In **Refine**, <kbd>Alt</kbd>-select a tag to leave it out. The search box
   gains a red chip for it.
3. Select **Save** and name the search. Choose **Show Results on Home**: Home
   now has a widget with its results.
4. Select **Export** and **Copy as live query block**, then paste it into the
   Query blocks note.
5. Search `is:open no:due #team/wardens`, select **Bulk edit** over the tasks,
   choose **Set a due date**, and type `friday`. Every task gets the date in
   one change that **Deckard: Undo Last Change** takes back.
6. Set `deckard.agenda.query` to `is:mine` in this folder's settings. The
   Tasks view and the status bar now count only your tasks. Clear it again
   with **Deckard: Clear the Tasks View's Search**.

Next: [[05 Query blocks]]
