# 28 · Statuses in the checkbox only

Plan 23 made the checkbox character a status and kept `#status/…` tags
working beside it. This plan retires the tags: a task's status is its
checkbox character and nothing else, as in Obsidian Tasks. The Task board's
status columns become a view of the status list, ticked and ordered in its
gear (option B of
https://claude.ai/artifact/PzHYvbwRLKDx9fLSiSb5UH, David, 2026-10-06), and
each column says its character.

## The model

- A status is `{ symbol, name, type, next?, icon? }`. `symbol` is required;
  `tag` is gone. An entry of `deckard.tasks.statuses` with no symbol is
  left out, as an unreadable entry is today.
- Deckard's statuses:

  | Box | Name | Type |
  | --- | --- | --- |
  | `[ ]` | Todo | todo |
  | `[/]` | In progress | inProgress |
  | `[w]` | Waiting | onHold |
  | `[s]` | Someday | onHold |
  | `[=]` | Blocked (⊘) | onHold |
  | `[x]` `[X]` | Done | done |
  | `[-]` | Cancelled | cancelled |

  Waiting and Someday get characters. Minimal draws `[w]` as "win"; a
  vault that uses it so imports its own list.
- A `#status/doing` tag is a tag like any other: it sets nothing, is
  searched as a tag, and shows as one. `[ ]` is Todo whatever it carries.
- A character no status names is still a task, an Unknown to do.

## What goes

- **Reading tags**: `readStatusTag`, `statusForTag`, `readTaskStatus` (a
  task's status is `task.status`), `nameTaskStatus`'s tag branch,
  `readLineStatus`'s tag branch, `readStatusColumnKey`'s tag branch, the
  board's `isMarkedDone` (`#status/done` heading Done), and every place that
  leaves the status namespace out of a list of namespaces (parent tag,
  board and Tasks view namespace pickers, Related Notes).
- **Writing tags**: `setTaskStatusTag`, `StatusWriteMode`, the `asTag`
  branch of `setTaskStatus`, the board's raw-tag drop for a key no status
  names, the uncheck that removed a status tag. Every status write is its
  character.
- **Settings**: `deckard.tasks.writeStatusAs`,
  `deckard.tasks.onHoldStatuses`, `deckard.board.statusNamespace`,
  `deckard.board.statuses`, `deckard.board.showCancelled`, and the `tag`
  property of `deckard.tasks.statuses`. `TaskPolicy.statusNamespace` goes
  with them.
- **The No status column** and its group in the Tasks view: every `[ ]`
  task is Todo. The board's status hint ("N of M open tasks have no
  status") goes with it.
- **Keep Tags**, the first-scan choice that set `writeStatusAs` to `tag`.

## The board's columns (option B)

- **The status list says what statuses exist; the board's gear says which
  are columns, in what order.** Two preferences, kept as the board's
  layout and grouping are (`src/core/storage`, machine-wide):
  `taskBoardColumnOrder` (status names) and `taskBoardHiddenColumns`
  (status names, `["Cancelled"]` by default). A status in neither, such as
  one added later, is a column, after those ordered, in list order.
- **Columns, by status**: every open status not hidden, in that order; a
  column per unknown character any open task uses ("Unknown `[?]`"),
  after them; **Done**, always, last but for Cancelled; **Cancelled** when
  ticked.
- **A column's header says its character**: "In progress `[/]`", "Done
  `[x]`", "Unknown `[?]`", drawn muted after the name and said once, as
  part of the column's accessible name.
- **A column's key** is its status's name as a slug (`in-progress`), the
  key `deckard.board.limits` takes; an unknown character's is
  `unknown-<code point>`.
- **The gear's Status columns group**: a row per status (open ones and
  Cancelled; Done fixed and last, not movable), each with a tick (shown as a
  column), its box, its name, its open count, and a drag handle (and the
  menu key's Move first / Move last, as today). **New status…** opens Edit
  Task Statuses on a new row; **Edit statuses…** opens it. A hidden status
  with open tasks says so in its row ("9 open, hidden") and the board's
  total still counts them.
- **A drop on a column writes its status's character**, ✅/❌ dates as now;
  the card menu lists the columns' statuses and every other status under
  "More statuses".
- **The Tasks view's By status** groups by status, in the board's column
  order, hidden statuses included (it is a list, not a board), unknown
  characters after them.

## Moving notes over

Tags are read once more, by the move alone, which knows the old meaning:

- **The legacy map** (`domain/tasks/legacyStatusTags.ts`): the namespace
  from the raw `deckard.board.statusNamespace` value (`status` when unset);
  each old tag's character from the raw `deckard.tasks.statuses` entries'
  `tag` and `symbol`, then Deckard's old defaults (`todo` → ` `, `doing` →
  `/`, `waiting` → `w`, `someday` → `s`, `blocked` → `=`); `done` checks a
  task off, listed for ticking, never silently.
- **The notice**: on the first scan of a session where task lines carry a
  status tag the map knows, once per workspace until moved: "23 tasks keep
  their status in a #status tag, which Deckard no longer reads." —
  **Preview the Move** / **Later**.
- **The preview** is Move Status Tags into Checkboxes…'s refactor preview,
  one workspace edit and one undo: tag → character (the tag removed), a
  stale tag on a box that already says its status removed, `done` listed
  unticked, an unknown tag (`#status/review`) left with **Give It a
  Character**, which opens the status editor on a new row with that name.
- **The strip**: while any task line still has a tag the map knows, the
  board and the Tasks view say "23 tasks still have #status tags. Move
  them." (the Tasks view as its `message`), so a task that suddenly reads
  as Todo has its reason beside it.
- **Searches**: saved searches, Home widgets' searches, and query blocks
  in notes that name `#status/<tag>` are offered `status:<name>` in the
  same preview (query blocks) and a confirm (saved searches and widgets),
  as a status rename carries searches today.
- **Settings, once**: `deckard.board.statuses`'s old order becomes
  `taskBoardColumnOrder` (by the map), `showCancelled: true` unhides
  Cancelled, and `deckard.board.limits` keys that name an old tag are
  rewritten to the status's slug where the reader set them. The old
  settings are then ignored.
- **A user's status list with tag-only entries** (Waiting with no symbol)
  loses them on reading; the notice's preview lists their tags under
  **Give It a Character**.
- **Import Statuses from Obsidian Tasks** stops attaching tags, and adds
  Waiting `[w]` and Someday `[s]` only when the vault has no status of that
  name or character.

## Phases, one commit each

1. **Reading and writing by character only.** The model, the defaults, the
   readers, queries (`status:`, `is:waiting`, `is:blocked`, facets,
   completions), the writers, the five settings and `TaskPolicy`'s
   namespace, the panel's Tag column. Tests move from tags to characters.
2. **The board's columns.** The preferences, the columns, the headers'
   characters, the gear, drops and the card menu, the Tasks view's groups;
   No status and the status hint gone.
3. **Moving over.** The legacy map, the move, the notice, the strip, the
   searches, the one-time settings move, the import.
4. **Samples, docs, and goldens.** `resources/sample` written with
   characters, the guide (tasks, task board, search, settings, commands,
   what Deckard writes), Help, the assistant's tool text, the changelog
   (Changed and Removed), DOM goldens.

## Decisions taken (logged for review)

1. Waiting `[w]`, Someday `[s]`.
2. Column choices are preferences, not a setting, as the settings review
   moved the board's other view choices into the board.
3. Hidden columns default to Cancelled only, as `showCancelled` did.
4. `board.limits` stays a setting, keyed by status slug.
5. The Tasks view's By status shows hidden statuses too.
6. The move is never automatic; settings are moved once without asking,
   since they are Deckard's own and say the same thing after.
7. Waiting `[w]` and Someday `[s]` go back to Todo in the workflow
   (`next: " "`), as Blocked does.
8. `deckard.board.statuses` and `deckard.board.showCancelled` go in phase
   2, with the columns they set, rather than in phase 1: until the gear's
   preferences replace them, the board has nothing else to order its
   columns by.
9. The legacy map (`legacyStatusTags.ts`) arrives in phase 1, not 3: the
   move reads tags as soon as nothing else does, so it needs the old
   meaning from the start.
10. A plain `[ ]` still leaves a table's Status cell, a query block's
    status, and a card's status line empty, as before: its box says it is
    to do, and "Todo" on every row says nothing more.
11. The gear lists Done after the open statuses and Cancelled after Done,
    as the board draws them, rather than Done last: Done is fixed and not
    dragged, and Cancelled only ticks.
12. The hidden columns, once the gear sets them, replace the default:
    ticking Cancelled stores an empty list rather than remembering a
    default to subtract from.
13. A card in an Unknown column does not say "Unknown [?]" again: its
    column's header says it.
14. Statuses that share a name share a column, written as the first of
    them, since a column goes by its name.
15. New status… and Give It a Character open Edit Task Statuses with a new
    row (a `newRow` in its snapshot, added once and kept until the list is
    saved), its character field focused, rather than a form of their own.
