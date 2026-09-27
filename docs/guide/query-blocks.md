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
- Notes are alphabetical. Tasks are open first, soonest due first, then in source order; done tasks are struck through and overdue dates highlighted.
- `sort=` takes `title`, `due`, `scheduled`, `start`, `done`, `priority`, `for`, `status`, `note`, `created`, or `updated`, with `dir=asc` or `dir=desc`. Dates sort newest first by default; empty values come last. Notes sort only by `title`, `created`, and `updated`.
- `limit=10` shows at most ten notes and ten tasks; the header still shows full totals.
- `view=table` draws tasks as a table. `columns=due,priority,for,note` picks the columns after the title, from the `sort=` names plus `tags`, `blocked`, and `id`. The default is due date, priority, who it is for, and note. Notes stay a list above.
- Above the fence in the editor: totals and **Open search page**. Results refresh when any note changes.
- A query that does not parse shows its error. An unknown option shows a warning and the rest runs.
- Tags in a query block are not indexed, but typing `#` or `@` in one still suggests tags.

---

← [Search pages and tag overviews](search-pages.md) · [All topics](README.md) · [Home and Stats](home-and-stats.md) →
