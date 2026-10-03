# Query blocks

A search written in a `deckard` code fence is a **query block**: a list
inside a note that stays up to date. Open this note's preview
(<kbd>Cmd</kbd>+<kbd>K</kbd> <kbd>V</kbd>) to see the blocks below drawn as
their results. In the editor, the line above each block shows its totals
and **Open search page**.

The fence is ordinary Markdown, so another editor, or Git, shows the search
itself. Like any code block, a query block is not indexed: the tags written
in it are not counted as uses.

## What the relay project still needs

The open tasks of the relay project that are due within a week, overdue ones
included:

```deckard
#project/ghostline-relay is:open due < 7d
```

## Every dated task, as a table

`view=table` draws the tasks as a table, `columns=` picks the columns, and
`sort=` orders the rows. A task with nothing in the sorted column comes last.

```deckard view=table columns=due,priority,for,status,note sort=due
is:open has:due -is:step -is:parked
```

## Every project, as a table of notes

With `view=table`, a block's notes are a table too, like a database in
Notion. `noteColumns=` picks the columns: how many notes link to each entry,
how far along its tasks are, its tags, its dates, or one namespace's tags,
such as `#status`. Notes sort by any of them: this one puts the entries with
the most open tasks first, and those with none last.

```deckard view=table noteColumns=note,links,tasks,updated sort=tasks dir=desc
tag = #project/* AND is:note
```

## The five Wardens notes changed last

`sort=` also orders notes by `title`, `created`, or `updated`, and `limit=`
shows at most that many while the header still gives the total:

```deckard sort=updated limit=5
is:note #team/wardens
```

## Waiting on others

```deckard view=table columns=for,status,note
is:waiting
```

## Done this week

A block's dates are read each time it is drawn, so `this-week` moves on with
the week, and the same block shows next week's work next week.

```deckard sort=done
is:done done = this-week
```

## Try it

1. Open the preview beside the editor
   (<kbd>Cmd</kbd>+<kbd>K</kbd> <kbd>V</kbd>). Each result links to its line.
2. Select the box beside a task in the first block, in the preview. The
   task is completed in its note, and the message offers **Undo**. The first
   time, VS Code asks whether Deckard may open the link: choose **Open**.
   Select the box again to reopen it. Completing a task from the Tasks view
   or the board updates the preview too, because a block refreshes when any
   note changes.
3. Select **Open search page** above a block. The same search opens on a
   search page, where Refine can narrow it.
4. Change `limit=5` to `limit=2` in the third block, and add `dir=asc` after
   `sort=updated`. Save, and watch the preview.
5. Put the cursor on an empty line below and run **Deckard: Insert Query
   Block…**. Choose a recent search, or type one.
6. On any search page, open **Export** and choose **Copy as live query
   block**, then paste it here. It keeps the page's sort.
7. Type a `#` inside a block: tag completion works there, even though the
   tags are not counted.
8. On an empty line below, type `/table`. The `/` menu offers a **Notes
   table** and a **Tasks table**: choose one, type a search, and open the
   preview. Delete it afterward.
9. In the projects table, change `noteColumns=` to add `tags` and save. A
   cell with nothing to show stays empty, so what a note does have stands
   out down its column.

Next: [[06 Tags and people]]
