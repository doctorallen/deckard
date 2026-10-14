# 35 · Add a task to its hub

A project's tasks are written in its hub note, where they belong, more
often than in the daily note. David: "I find myself opening up hub pages for
projects to put tasks for those projects rather than in daily notes for two
reasons: I have the tags displayed on the task board, and if I want to add a
random task in a daily note I don't want to have to add a heading. If I put
the tag inline on that task it doesn't appear above it in the task list."

Two things stand in the way, and this plan removes both.

1. **A tag written on the task's line is drawn nowhere.** The card's title
   drops the tags written after it (`stripTrailingTags`), and the tag above
   the title, **Show the tag each task is under**, skips every tag the
   line writes, on the grounds that the card already says it. So
   `- [ ] Call Ren #project/atlas` in a daily note shows no tag at all,
   while the same task under `## Tasks #project/atlas` in the hub shows it
   above its title.
2. **Writing into the hub means opening it**, or choosing Add Task's
   Note row, then **Under a heading…**, then the hub's heading.

## The tag above a card

`findParentTag` (`src/domain/tasks/parentTag.ts`) names the tag a task is
part of, nearest first:

1. A tag written at the end of the task's own line, which its title does
   not show, that has a hub note. It is the nearest, and the card draws it
   nowhere else.
2. The first tag on the nearest tagged heading above it, then each heading
   above that, as now.
3. Its note's front-matter tag, as now. A hub note's `describes:` is one of
   its front-matter tags, so a task in a hub is that tag's.
4. Any other tag written at the end of its own line that the title does not
   show, so a tagged task under no heading is never bare.

A tag the line writes in its sentence, which the title shows, is never
lifted. A tag of the namespace the board is grouped by is skipped, as now,
in every step; steps 2 and 3 still skip a tag the line writes.

## Add Task goes to the hub its tag names

Add Task reads the words of the **Description** for a tag that has a hub
note, as Quick add reads a day or a priority, and the Note row follows it.

- `Call Ren #project/atlas fri` makes the Note row **Atlas.md · hub of
  #project/atlas** and the title *Add a task to Atlas.md*; the line under
  the box adds **Goes to Atlas.md**.
- **A short tag** reads as the hub's when one hub's tag ends with it:
  `#atlas` is `#project/atlas` when no tag `#atlas` is written anywhere and
  only one hub describes a tag ending `/atlas`.
- **Where in the hub**: under its first heading named **Tasks** (any level,
  tags aside), above any heading nested in it; else after the note's last
  list item or text, as today's note takes a task.
- **The tag on the line**: left off when that place already carries it,
  from a tag on the **Tasks** heading or one above it, or the hub's front
  matter, which holds what it describes; otherwise written in full,
  `#project/atlas` for `#atlas`, so searches and the board still find the
  task.
- **What the reader chose stays chosen.** The words choose the note only
  until the Note row is used; after that the row says where the task goes.
  **This note** and **Today's note** keep a short tag written in full.
- **Already there.** In the hub note itself, or at a cursor under a heading
  that carries the tag, the task stays at the cursor.
- **The Note row** lists the hub, **$(tag) Atlas.md**, beside This note,
  Today's note, Another note… and Under a heading…, while the words name
  one.
- **Add a tag**, the editor's row, lists the tags with a hub note first,
  each described as **Hub: Atlas.md**, so `atl` finds `#project/atlas`
  without typing the namespace.
- A board column's **+** in a column of a tag with a hub, such as
  `#project/atlas`, starts the task in that hub.
- The message after writing says where it went, as now: *Added it to
  projects/Atlas.md in deckard-work*, or under **Tasks** in it.

## Left out

- **Filing into hubs on rollover**: daily-note tasks with a hub tag carried
  into their hubs. **Move to…** does it one task at a time; wait for need.

## Tests

- `src/test/parent-tag.test.ts`: each step above, in order, with the
  grouped namespace skipped.
- `src/test/hub-route.test.ts`: the hub a description names, short tags,
  an ambiguous short tag, the place in the hub, whether the line keeps the
  tag, and Add a tag's order.
- `src/test/add-task-target.test.ts`: the hub target's title, row, and
  choice.
- `src/test/add-task.test.ts` (extension host): a hub tag sends the task
  under the hub's Tasks heading without it; a place chosen on the Note row
  stays chosen with the short tag written in full; a cursor under the tag
  keeps the task there.
