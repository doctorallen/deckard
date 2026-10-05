# Query blocks

Put a Deckard query in a `deckard` code fence to keep a live list in a note. `Deckard: Insert Query Block…` writes one from a saved or recent search, and **Copy as live query block** in a search page's or the Task Board's **Export** copies the current search as one:

````markdown
```deckard sort=updated limit=10
tag = #project/atlas AND task = open
```
````

As a table of tasks:

````markdown
```deckard view=table columns=due,priority,for sort=due
tag = #project/atlas AND is:open
```
````

![A note's deckard query blocks beside the Markdown preview, which lists the tasks each query matches.](../images/query-blocks.png)

- The Markdown preview shows the matches, notes first, then tasks, each linking to its source line. `markdown.preview.openMarkdownLinks` decides where links open.
- **Tick a task in the preview.** Select a task's box to complete it, or a done task's box to reopen it, as its box on any page does, with **Undo** in the message. The first time, VS Code asks whether to let Deckard open the link; choose **Open**, and tick *Do not ask me again for this extension* to skip the question next time. A box drawn before Deckard last started, or for a task that has changed since, writes nothing and the preview is drawn again.
- Notes are alphabetical. Tasks are open first, soonest due first, then in source order; done tasks are struck through and overdue dates highlighted.
- `sort=` takes `title`, `due`, `scheduled`, `start`, `done`, `priority`, `for`, `status`, `note`, `created`, `updated`, or a notes table's `links`, `tasks`, `tags`, or `#namespace`, with `dir=asc` or `dir=desc`. Dates sort newest first by default, everything else ascending; empty values come last.
- `limit=10` shows at most ten notes and ten tasks; the header still shows full totals.
- `view=table` draws tasks as a table. `columns=due,priority,for,note` picks the columns after the title, from the `sort=` names plus `tags`, `blocked`, and `id`. The default is due date, priority, who it is for, and note.
- `view=table` draws notes as a table too, above the tasks. `noteColumns=` picks their columns after the title: `note`, `created`, `updated`, `links` (how many other notes link to the entry's note), `tasks` (*1 of 4 done*, steps aside), `tags`, or a namespace such as `#status`, which shows the entry's `#status/…` tags by name. The default is note, updated, links, and tasks. A cell with nothing to show is left empty.
- Notes sort by any of their columns too, with or without `view=table`: `sort=links dir=desc` puts the most linked first, and `sort=#status` orders them by status. A note's `#status` and tags include those it inherits from the tagged headings above it and the note's front matter; an untagged heading is part of the note above it, not a row of its own. A sort by a column only tasks have, such as `due`, leaves the notes in their order, and one only notes have leaves the tasks in theirs.
- Above the fence in the editor: totals and **Open search page**. Results refresh when any note changes.
- A query that does not parse shows its error. An unknown option shows a warning and the rest runs.
- Tags in a query block are not indexed, but typing `#` or `@` in one still suggests tags.

A table of every project, its status, and how far along its tasks are:

````markdown
```deckard view=table noteColumns=#status,tasks,updated sort=#status
tag = #project/* AND is:note
```
````

---

← [Search pages and tag overviews](search-pages.md) · [All topics](README.md) · [Home and Stats](home-and-stats.md) →
