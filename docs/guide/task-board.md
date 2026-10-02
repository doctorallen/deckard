# Task board

Run `Deckard: Open Task Board`, or select the board icon in the title bar of the Context view or the Tasks view. Drag a card to another column, or choose one from its **⋯** menu, to change the task in its note. The menu's **Move to…** moves the task and its steps under another heading. A card with steps shows **2 of 5 steps · next: Draft the email**. The **View options** gear switches views and edits status columns. Parked tasks are left off unless the search says `is:parked`.

![Deckard Task Board showing tasks in status columns that end with Done.](../images/task-board.png)

## Groupings

- **Status**: a column per status tag on a task line, such as `#status/doing`. `deckard.board.statuses` sets the first columns (`todo`, `doing`, `waiting` by default); other statuses follow, and tasks without one are in **No status**. Dropping replaces the status tag, or removes it in **No status**. `deckard.board.statusNamespace` uses another namespace, such as `#stage/…`. A status inherited from a heading does not count.
- **Priority**: a column per priority. Dropping writes it in the task's format, such as ⏫ or `[priority:: high]`.
- **Due date**: **Needs a new date** (more than 30 days overdue, titled in red), Overdue, Today, Tomorrow, Within a week, Later, and No due date. Drop on **Today** or **Tomorrow** to set the date, or **No due date** to remove it; other columns take no drops.
- **Tag…**: one namespace's tags, alphabetical, then **No context**. A task with two such tags is in both columns. Dropping replaces the tag on the line, or removes it in **No context**; an inherited tag stays. See [Contexts, areas, and projects](#contexts-areas-and-projects).
- Every grouping ends with **Done**, showing the 20 most recently completed tasks. Drop a card there to complete it, with its done date and next occurrence; drag it out to reopen it.

## Searching and filtering

- Search with the same [search box](search.md#the-search-box) as search pages, such as `#project/atlas`, `priority >= high`, or plain words. **Refine** counts only tasks. The board opens on `is:open`; clear the box for every task, or search `is:done`.
- **Can start now** narrows to `is:available`, leaving out tasks that are blocked, not started, or waiting or someday. Press it again for `is:open`.
- **Save** keeps the search in the box, whether or not Enter has run it, as a saved search that reopens on the board. **List in Tasks view**, in the gear, makes the [Tasks view](tasks.md#tasks-view) list it; select it again to list every open task.

## Cards and columns

- Due dates read by distance, such as **Overdue 15 days · 2026-09-08** or **Due tomorrow · 2026-09-24**; beyond a month only the date shows. A task more than `deckard.tasks.needsNewDateAfterDays` (30) days overdue reads **was due 2026-07-01** in muted text.
- Column headers count cards and overdue ones: **40 · 38 overdue**.
- `deckard.board.limits` sets work-in-progress limits by status, such as `{ "doing": 3 }`. The header reads **5 / 3**, and a column over its limit gets a dashed outline. Drops are never refused.
- A column over 100 cards shows **Show N more**.
- **+ Add task** under a column's title captures a task into today's note with that column's status, priority, date, or person. A card's **⋯** menu offers **Due on a date…** for any day.
- Select a card to open its line, or a tag to open its overview.
- Every move is checked against the indexed line first, so a newer edit is never overwritten.

## Table and list

- **Table** shows tasks as rows: title, due date, priority, person, and note by default. Add other fields in the gear's **Columns**. Select a header to sort, again to reverse; **Rank order** restores your ranking. A [query block](query-blocks.md#query-blocks) draws the same table with `view=table`.
- **List** shows tasks as rows with **Sort: Rank/Created/Updated**. In Rank, drag a row, right-click it to move it, or press **Alt+↑** and **Alt+↓**.
- **Status columns**, in the gear, lists the status columns in order. Drag a row to reorder, add a column, remove an empty one with **×**, or set the status namespace. These save to `deckard.board.statuses` and `deckard.board.statusNamespace`.

## Keyboard

The board is one Tab stop. Arrow keys move between cards and columns. On a focused card:

- **x** completes it; **t** and **m** make it due today or tomorrow; **d** asks for a date in plain words.
- **1** to **5** set priority; **0** clears it.
- **[** and **]** move it to the adjacent column.
- **e** opens the task editor; **s** [breaks it into steps](tasks.md#breaking-a-task-into-steps); **Enter** opens its line, and **Cmd+Enter** (Ctrl+Enter on Windows and Linux) opens it beside the board.
- **?** lists the keys.

### Contexts, areas, and projects

Group by a tag namespace for GTD and PARA lists:

- **Contexts**, where a task can be done: `#context/phone`, `#context/computer`, `#context/errands`. Not `@phone`, which Deckard reads as a person.
- **Areas**, what you keep up: `tags: [area/health]` in front matter puts every task in the note in the area.
- **Projects**, what you finish: a heading tag, `## Launch #project/atlas`, puts every task under the heading in the project.

Then choose **Group Tasks By…** in the Tasks view's title, **Tag namespace…**, and `#context`; or **Tag…** on the Task board. A task with two contexts is in both lists. Dragging a task to another context rewrites the tag on its line; an inherited project or area stays.

---

← [Tasks](tasks.md) · [All topics](README.md) · [Search](search.md) →
