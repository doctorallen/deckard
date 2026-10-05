# 23 · Task statuses in the checkbox

Obsidian Tasks keeps a task's status in the character between its brackets:
`[ ]` to do, `[x]` done, `[/]` in progress, `[-]` cancelled, and any other
character a vault defines. Deckard reads only `[ ]`, `[x]`, and `[X]`, so
every other line is text to it: the persona study's Obsidian user counted
about 400 tasks in Obsidian and about 260 in Deckard, and every task in
progress was among the missing. Deckard's own statuses live in `#status/…`
tags, which drive the Task Board's and the Tasks view's status columns.

This plan makes the checkbox character a status Deckard reads, writes, and
searches, the way Obsidian Tasks does, and keeps `#status/…` tags working
for the notes that already use them. From `docs/todo.md`.

## How Obsidian Tasks does it

Each status has a **symbol** (the character), a **name**, a **next symbol**
(what clicking it turns it into), and a **type**:

| Type | Meaning | `done` / `not done` |
| --- | --- | --- |
| `TODO` | Not started | not done |
| `IN_PROGRESS` | Being worked on | not done |
| `ON_HOLD` | Paused | not done |
| `DONE` | Finished | done |
| `CANCELLED` | Abandoned | done |
| `NON_TASK` | A list item with a box, not a task | done |

- The core statuses are ` ` Todo → `x` and `x` Done → ` `: they can't be
  deleted or given another symbol, though their name, next symbol, and type
  can change. The default custom statuses are `/` In Progress → `x` and `-`
  Cancelled → ` `. `X` is not a core status. A vault adds its own, often
  from a theme's set (Minimal, ITS, and others each have a button), in the
  plugin's `data.json`. A status with an earlier one's symbol is ignored.
- A symbol it doesn't know is a `TODO` named Unknown, whose next symbol is
  `x`; **Add All Unknown Status Types** adds a row for each one found.
- Clicking a checkbox moves a task to its status's next symbol.
- `NON_TASK` is for checkbox lines that aren't tasks, such as a Pro and Con
  list, a star, a quote. Tasks still treats them as tasks: `done` matches
  them, and grouping by status files them under Done.
- **Review and check your Statuses** writes a report with a diagram of the
  transitions, and warns when `DONE` isn't followed by `TODO` or
  `IN_PROGRESS`.
- A done date ✅ is written when a task's type changes **to** `DONE`, and
  removed when it changes from it; a cancelled date ❌ when it changes to
  `CANCELLED` (Tasks 5.5, on by default).
- A recurring task makes its next occurrence only on a change to `DONE`. The
  new one takes the first `TODO` status, else the first `IN_PROGRESS`, else
  ` `. A `NON_TASK` never recurs and never gets a done date.
- Search: `done` (DONE, CANCELLED, NON_TASK), `not done` (TODO, IN_PROGRESS,
  ON_HOLD), `status.name`, `status.type is`; sort and group by either.

## Where Deckard is today

From a map of the code at dev 162a7c7c (file:line references are there):

- **Parsing.** `parser.ts` `taskShape` takes marks ` xX`; `readTask` sets
  `checkboxValue: ' ' | 'x' | 'X'` and `completed = mark !== ' '`. Any other
  mark but `>` (Deckard's migrated task) is `OTHER_MARKS`: counted into
  `ParsedFile.otherCheckboxes`, said once (`noticeOtherCheckboxesOnce`), and
  shown in Stats, and the line falls through to a tagged list entry.
- **The marks are written out in about twenty places**: shapes in
  `toggleLines`, `taskDraft`, `wordCount`, `listNesting`, `selectionSeed`,
  `taskSteps` (twice), `captureLines`, `moveLines`, `proseExcerpt`,
  `repeatRuleProblems`; regexes in `taskMetadataSuggestions`, `notePageState`
  (twice), `moveTo`, `captureLines`, `taskDraft`, `taskEditor`, and
  `taskLineMarks`. `taskLines.ts` checks a line is unchanged before every
  write by comparing its mark with `checkboxValue`.
- **Status tags.** `deckard.board.statuses` (`todo`, `doing`, `waiting`),
  `deckard.board.statusNamespace` (`status`), and
  `deckard.tasks.onHoldStatuses` (`waiting`, `someday`). A task's status is
  the first `#status/…` tag on its own line, read by two near-copies
  (`boardMoves.readTaskStatus`, `taskPolicy.readLineStatus`); a query block
  reads it from inherited tags too, which disagrees with both.
- **Columns and drops.** No status, the configured statuses, any others
  found, and Done, which is the checkbox. Dropping on a status column
  rewrites the tag and reopens a done task; dropping on Done completes it
  and leaves the tag.
- **Completion.** `setTaskLineCompletion` writes `x` or ` ` and the ✅ date;
  `createNextOccurrence` writes the next 🔁 occurrence. About eight paths
  complete a task (toggle command, board, Tasks view, bulk edit, Find,
  preview checkboxes, the task editor, assistant writes).
- **Queries.** `is:open` / `is:done` are `completed`; `is:waiting` and
  `is:available` read the status tag; `status:` is an alias of `task:`
  (open, done, any).
- **Already Obsidian Tasks compatible:** every date emoji (📅 ⏳ 🛫 ➕ ✅
  ❌), Dataview fields, priorities, 🔁 with "when done", 🆔 / ⛔. The ❌
  cancelled date is parsed into `metadata.cancelled` but never put on the
  Task, so nothing uses it.

## The model

A **status** has a symbol, a name, a type, a next symbol, and, optionally,
the `#status/…` tag it stands for:

```jsonc
"deckard.tasks.statuses": [
  { "symbol": " ", "name": "Todo",        "type": "todo",       "next": "x", "tag": "todo" },
  { "symbol": "/", "name": "In progress", "type": "inProgress", "next": "x", "tag": "doing" },
  { "symbol": "x", "name": "Done",        "type": "done",       "next": " ", "tag": "done" },
  { "symbol": "X", "name": "Done",        "type": "done",       "next": " " },
  { "symbol": "-", "name": "Cancelled",   "type": "cancelled",  "next": " " },
  { "name": "Waiting", "type": "onHold", "tag": "waiting" },
  { "name": "Someday", "type": "onHold", "tag": "someday" }
]
```

- **A task's status** is its checkbox's. A ` ` box with a `#status/…` tag
  that a status names takes that status, so every note written with tags
  reads as it does today. A status with no symbol (Waiting, Someday) is a
  tag on a ` ` box, as now.
- **A symbol no status names is a task**, a `todo` called Unknown, as in
  Obsidian. That is the point: the vault's counts match. Its next symbol is
  `x`.
- **`[>]` stays Deckard's migrated task**, not a status, as now.
- **Types decide everything else**: `todo`, `inProgress`, `onHold` are
  open; `done` is done; `cancelled` is closed but not done; `nonTask` is not
  a task at all, read as text, as `[/]` is today.
- **` ` and `x` are core**, as in Obsidian: always there, their symbols
  fixed. `X` stays Done, as Deckard has always read it; an import keeps it
  unless the vault defines `X`.
- **A symbol given twice**: the first status is read, as in Obsidian.
- `deckard.board.statuses` becomes the order of the board's columns, by
  status name; its old values (`todo`, `doing`, `waiting`) are read as the
  statuses whose tag they are. `deckard.tasks.onHoldStatuses` is replaced
  by the `onHold` type and read as an alias until removed.
  `deckard.board.statusNamespace` still names the tags' namespace.
- On the Task: `status: { symbol, name, type }` replaces `checkboxValue`
  (the stale-line check compares `status.symbol`), `cancelledAt` comes from
  ❌, and `completed` stays, as `type === 'done'`, so the many readers of it
  keep their meaning.

## Decisions taken (logged for review)

1. **Both read, the checkbox first.** A status character and a `#status/…`
   tag are both read; the character wins when it isn't a space. Nothing
   already written changes how it reads.
2. **A column writes its status's symbol when it has one**, else its tag.
   Dropping a card on In progress writes `[/]` and removes a `#status/doing`
   tag the status names; dropping on Waiting writes the tag on a ` ` box, as
   now. A setting, `deckard.tasks.writeStatusAs` (`checkbox` | `tag`),
   keeps tags for a vault that wants them, defaulting to `checkbox`.
3. **Done is `done` only; cancelled is its own.** `is:open` is todo, in
   progress, and on hold; `is:done` is done; new `is:cancelled`,
   `is:in-progress`, and `is:closed` (done or cancelled). Overdue, due today,
   Open tasks, and the board's open count leave cancelled tasks out; Done
   this week counts done only; Stats says how many were cancelled.
   Progress (steps, a hub's tag progress) leaves cancelled tasks out of both
   sides of the fraction.
4. **Unknown symbols are tasks** (Obsidian's rule), said once: "N tasks use
   a status Deckard doesn't know, such as `[?]`; they count as to do. Name
   them in `deckard.tasks.statuses`." The Stats line becomes that count.
5. **Clicking a box follows the status's next symbol**, as in Obsidian, in
   a page, the preview, and the Tasks view. With the defaults that is done
   and back, as now; a vault that sends Todo to In progress gets that.
   `Deckard: Toggle Task Done` still completes any open status and reopens a
   done one to the first `todo`. **Next status** (`Deckard: Next Task
   Status`) and **Set Status…** (a quick pick of every status) are new
   commands, in the task editor and a card's menu.
10. **`nonTask` statuses are not tasks**, where Obsidian keeps them as tasks
    that match `done`. In Deckard they would count as done, sit in the Done
    column, and fill Done this week with a pro and con list. They stay list
    lines in the note, as unknown characters are today, and Stats counts
    them as checkbox notes. The type exists so an imported vault's statuses
    say which characters to leave alone.
6. **Dates follow the type.** ✅ on a change to `done`, removed on a change
   from it (`deckard.tasks.addDoneDate`, as now); ❌ on a change to
   `cancelled`, removed from it (`deckard.tasks.addCancelledDate`, default
   on, as in Tasks).
7. **Recurrence on done only.** A 🔁 task makes its next occurrence when it
   changes to `done`, with the first `todo` status, else the first
   `inProgress`, else ` `, as in Obsidian; cancelling one makes
   none, and the board's Cancel offers "Cancel this one, keep it repeating"
   as a second action that writes the next occurrence too.
8. **Moving tags to characters is a command, never automatic.**
   `Deckard: Move Status Tags into Checkboxes…` rewrites `- [ ] … #status/doing`
   to `- [/] …` for every status with both a symbol and a tag, shown first in
   the rename preview, one undo.
9. **A vault's own statuses can be imported.** When a workspace has
   `.obsidian/plugins/obsidian-tasks-plugin/data.json`,
   `Deckard: Import Statuses from Obsidian Tasks` reads its core and custom
   statuses into `deckard.tasks.statuses` (workspace scope, since they are
   the vault's), once offered from the first scan's notice.

## Phases, one commit each

1. **The model and the parser.** `deckard.tasks.statuses` and its reader in
   `domain/tasks/taskStatuses.ts` (pure; the default list, aliases for the
   old settings, a symbol's status, unknowns); the parser reads any mark but
   `>` and `]`, sets `status` and `cancelledAt`; `nonTask` symbols stay
   text. One shared task-line shape replaces the twenty hard-coded marks.
   The index cache's schema version goes up. Tests: every default symbol,
   an unknown, `[>]`, a fenced line, the tag fallback, and a fixture vault
   whose task count matches what Obsidian Tasks reports.
2. **What the types mean.** `completed` from the type; `is:` gains
   in-progress, cancelled, closed; `is:waiting` and `is:available` read the
   `onHold` type; `status:` matches a status name as well as open, done, and
   any; a `cancelled` date field and `has:cancelled`. Home, Stats, the
   calendar, the agenda, the Sections counts, tag progress, steps, and the
   board's totals follow decision 3; the Stats line and notice follow 4.
   One status reader replaces the two near-copies, and the query block reads
   own-line tags like the others.
3. **Writing a status.** One `setTaskStatus(line, from, to)` in
   `taskLineEdits.ts` writes the symbol or the tag (decision 2), the dates
   (6), and the next occurrence (7); toggle, the board, the Tasks view, bulk
   edit, Find, preview checkboxes, the task editor (its status field lists
   every status), and assistant writes (a `status` input) all go through
   it. Next Task Status and Set Status… commands.
4. **The board and the Tasks view.** Columns from the statuses in
   `deckard.board.statuses` order, then No status, then Done; Cancelled as a
   column the gear can show, hidden by default; a card shows its status
   name when it differs from its column (an unknown symbol, a tag the board
   doesn't list). Drops through phase 3.
5. **In the editor and on pages.** Decorations for the box itself: in
   progress in the accent, cancelled struck through and dimmed, unknown
   underlined with a hover that says how to name it; completions after
   `- [` offer each status; the slash menu's task item stays `[ ]`. A page's
   checkbox shows in progress as mixed (`aria-checked="mixed"`) and
   cancelled as closed with its name; the note page and preview query blocks
   draw the same. The grammar colors a status character.
6. **Moving over, and editing statuses.** Move Status Tags into
   Checkboxes… and Import Statuses from Obsidian Tasks (decisions 8 and 9);
   the first scan's notice offers the import where `data.json` is found,
   and the move where a workspace has `#status/…` tags whose statuses have
   symbols. `Deckard: Edit Task Statuses…` opens a page to edit the list,
   since VS Code's Settings editor offers only "Edit in settings.json" for
   it: rows for symbol, name, type, next, and tag; the core rows locked;
   **Add characters found in notes** (Tasks' Add All Unknown Status Types);
   presets; Import; and the checks Tasks' Review report makes (a next symbol
   no row has, a symbol given twice, Done not followed by to do or in
   progress), shown as you type beside each status's cycle. Drawn at
   https://claude.ai/artifact/KD8GsdJu9zhzuSrXzQeRfx.
7. **Everywhere else, tests, and docs.** The calendar export writes
   `STATUS:CANCELLED` / `COMPLETED`; the assistant tools show and filter by
   status; the samples use `[/]` and `[-]`; the guide's Tasks, Task board,
   Search, and Settings pages, Help, and the changelog. DOM and screenshot
   baselines for a board with every status type, in every theme.

## Risks

- **Counts change for anyone with `[/]` or `[-]` lines today**: those lines
  become tasks. That is the fix, but the first scan after the update says so
  ("Deckard now reads `[/]` and `[-]` as tasks: 140 more tasks found").
- **A line Deckard read as a tagged note entry becomes a task.** A `[/]`
  line with tags is listed under its tag as a note entry today; after this,
  as a task. The tag's page changes which list it is in.
- **Twenty places write the marks by hand.** Phase 1's shared shape is the
  guard: a lint rule (or a test that greps for `[ xX]` in `src/`) keeps a
  new one from creeping back.
- **Themes and contrast.** Phase 5's colors go through tokens checked in
  every theme, as Display's did.
