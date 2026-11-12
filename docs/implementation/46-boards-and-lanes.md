# 46 · Boards and lanes

Two views of work at a glance that Deckard lacks. A type's rows are a table
and nothing else, so planning a body of work (initiatives, decisions,
incidents) as cards that move between states needs a board. And the Task
board groups by one axis only, so a board of tasks by status cannot also be
split by team or initiative. Both gain the same second axis, **Lanes**: rows
of cells across the columns, one row per value of a second field.

Nothing here is specific to one type. An initiative is a type its reader
writes, in one type note; the board works on any type, over tags or notes.
Mockups: the "Lanes and Section Moves" artifact, sections 1 and 2.

## 1. Board on a type's rows

### The view

The rows tab of a type's search page (`type = initiative`) gains a view
switch, **Table | Board**, beside its sort note. The choice is remembered
per type with the rest of the type's table view (`setTypeTable`), as its
columns and Group by are. The other tabs (Notes, Tasks) are unchanged.

On **Board**, two selects take the place of the table's headings:

- **Group**: the columns. Any field the table's ⋯ **Group by** offers: each
  select, person, and relation field of the type, and its reverses (D1).
- **Lanes**: **None**, or any of those fields but the one Group uses.

Defaults (D2): Group is the table's Group by when it has one, else the
type's first select field, else its first person or relation field. Lanes
is None. Both are remembered per type.

A type with no field to group by draws no board: the tab says *A board
groups by a select, person, or relation field, and Team has none*, with
**Add a field…**, which opens the type's note at its field table (Edit in
`Types/Team.md`'s action).

### Columns and lanes

Each axis's values, in order (D3):

- a select: every option, in the order the schema lists them, empty ones
  too, so a card can be dropped into an option no row has yet;
- a relation: every row of the types it takes, by title, empty ones too;
- a person field: the people some row names, by title;
- a reverse or computed field: the values some row has, by title.

Then the rows with no value, last: *No state*, *No team*, drawn only when
some row has none or the axis can be written. A row with two values of an
axis's field is in both columns (or lanes), as the grouped table puts it in
both groups.

Lanes stack down the page. A lane's head is its name, how many rows it
holds, and **+**; the name folds and unfolds the lane (remembered while the
page is open). The column heads are drawn once, above the first lane, each
with its count over every lane and its **+**. Within a cell, cards follow
the table's sort, by title when it has none.

### Cards

A card is the row's title, which opens the row as the table's title does,
then up to three details: the values of the columns the table shows, in its
order, leaving out the title and the two fields on the axes, each as
`label value`, links where the table draws links. A row with no hub note
says *No hub note · 2 entries* in place of its details and offers **Create
hub note**, as its table row does. The card's **⋯** is the row's menu, plus
the moves below.

### Moving a card

Dragging a card to another cell sets the fields its column and lane stand
for, as one write with Undo, through the field writer the form and File
this use (`setFrontmatterField`, `writeDraftValues`, plan 34):

- a single-value field takes the new value;
- a field that holds several swaps the value of the cell the card left for
  the cell's it entered, keeping the rest (D4);
- the *No …* column or lane takes the value out (a multi-value field loses
  the one it was dragged from);
- a row with no hub note gets one, written at once, as File this writes it
  (`writeNewNote`), with the field set.

A reverse or computed axis takes no drops: while a card is held, its cells
fade and say *Set by other notes* (the Task board's refusal note). The page
moves the card at once and the host's next state settles it; a refused
write puts it back with the reason.

The card's ⋯ lists **Move to** entries for each value of the Group field and
then **Move to lane** for the Lanes field's, so every move has a keyboard
way (D5). Escape cancels a drag.

### Adding a row

**+** on a column, a lane, or nowhere (the tab's **Add <type>**, which exists)
starts **New Note from Type…** for the type with the column's and the lane's
values filled in, the way Create hub note starts the form with its tag.

### Zen

The view switch, Group, and Lanes hide with the rows' other controls; the
cards, counts, and lane names stay drawn. A card's ⋯ is revealed on hover
or focus, as a table row's is.

## 2. Lanes on the Task board

The Task board's **Group** select gains a neighbor, **Lanes**: **None**,
**Status**, **Priority**, **Due date**, **Tag…** (a namespace), and
**Person**, less the axis Group uses (Tag… stays offered while Group is a
tag, for another namespace). The choice is remembered with Group
(`taskBoardLanes`), and is the Task Board page's alone: the Dashboard's
board layout draws no lanes (D6).

The lanes' values are the axis's columns as Group would draw them, in the
same order, each a lane: a status lane per shown status, Overdue, Today,
… for due dates, a person per lane, *No tag* and *Nobody named* last. A
task is in the lane its value says, as it is in the column; a task in two
of a namespace's tags is in both.

Under lanes, each lane is a row of the board's own columns, every column
in every lane, so a column's cells line up down the page. The column heads
are drawn once, at the top, with their counts over every lane; each cell
keeps the column's rules (the Done column's limit of 20, Overdue taking no
drop). A lane head is its name, its count, and **+**, and its name folds it.
A lane's id is its column id in the lane axis (`priority:high`,
`tag:#team/payments`), so a card dropped in a cell carries two ids, its
column's and its lane's.

Dropping a card in another cell writes both edits, the column's then the
lane's, as one line edit with one Undo (D7). A drop within its own cell on
a board sorted by Rank reranks it, as today. A cell the card cannot enter
(the Overdue lane, a status column that will not take it) refuses, as a
column does now. **+** on a lane adds a task with the lane's value, and on a
cell (its column head) the column's; Add Task's quick-add words carry the
lane's value (`for @dana`, `#team/payments`, `p1`, `today`).

The card's ⋯ already lists moves for status, priority, and due date; it
gains the lane axis's moves when that axis is a tag or a person (**Move to
lane**), so the keyboard reaches every cell.

The Table layout is unchanged: lanes are a board's.

## Decisions

- **D1.** Group and Lanes offer exactly the table's Group by fields, so the
  two views never disagree about what can group a type.
- **D2.** Lanes default to None, not the mockup's *state by team*: a
  generic board cannot know which field is the team, and the choice is
  remembered after the first time.
- **D3.** Empty select options and empty relation rows are columns, so a
  card can be moved into them; people are only those in use, since a
  person field would otherwise draw everyone in the workspace.
- **D4.** A multi-value field swaps the value the card was dragged from,
  rather than adding the new one, so a drag moves the card and does not
  copy it.
- **D5.** Moves through ⋯ rather than new keys: the type board has no key
  map, and ⋯ is already reachable from the keyboard.
- **D6.** No lanes on the Dashboard's board layout: its widgets are small,
  and a second axis there would have to fit a tile.
- **D7.** Two edits on one line are one write, so Undo takes both back.

## Tests

- Unit: the type board's columns and lanes for each field kind (option
  order, empty options, people in use, *No …* last, a row in two values);
  the default axes; what a drop writes for single and multi-value fields,
  *No …*, and a row with no hub; the refusals for reverse and computed
  axes. The Task board's lanes for each axis; a cell's two ids; the
  combined edit; the axes Lanes offers beside each Group.
- Messages: the new view, group, lane, and move messages are validated.
- DOM goldens for the type board (with and without lanes) and the Task
  board with lanes; visual baselines for both.

## As built

Section 1 built on `feat/boards-lanes`. `src/ui/state/typeBoard.ts` makes
the board from the rows tab's rows (its fields, values, cards, and what a
move changes), `src/ui/commands/typeBoardMoves.ts` writes a move, and
`src/webview/searchPage/typeBoard.tsx` draws it on the shared lane grid,
`src/webview/shared/lanes.tsx` and `lanes.css`, which section 2 builds the
Task board's lanes on. Where the plan was silent, or the code made its
words impractical:

- **Group by offers reverses.** D1 has Group and Lanes offer exactly the
  table's Group by fields, and the plan's fields include a type's
  reverses, which Group by did not offer. So Group by gained them too,
  after the schema's fields, and the table groups by a reverse as by a
  relation: Areas by **owned by**. Of the computed fields, only reverses
  are offered; `parent`, `children`, and paths are not.
- **Which values are columns.** A select's values in use that are no
  option, such as a misspelling, are columns after the options, by title.
  A relation's columns leave out a namespace level no tag is written for
  (an implicit row), which no value names; a relation that also takes
  people adds the people in use.
- **Ids.** A column or lane is named in messages by its value:
  `option:active`, `row:#team/rates`, `text:<value>`, or `none`. The host
  finds the value, and what it writes, on the board it drew, never in the
  message.
- **A card's details** leave out an empty cell and a computed count of
  nothing, `Open tasks 0`, and take the next column instead. A schema
  field's label is its key, in monospace, as its heading is.
- **Counts.** A head counts rows, so a row in two lanes of a column counts
  once in the column.
- **A move the note does not hold.** When the row's note does not write the
  value the card left, because another note sets it (a relation written
  from the other side) or the note changed since, nothing is written: a
  warning says so, with Open Note, and the page draws the card back. A
  refused move is not sent at all from the page.
- **Reverses.** While a card is held, only the cells that would change a
  reverse fade and say *Set by other notes*; on a board by a reverse with
  select lanes, a card still moves between lanes. A reverse's heads have no
  **+**, and a card's ⋯ lists no Move to for it.
- **+ on No …** starts the form with that field empty, the other axis's
  value filled in.
- **Board and Group by.** On Board the rows are not grouped; the table's
  Group by is kept for when it comes back, and is the board's Group until
  one is chosen (D2).
- **Columns line up.** Every column of the grid is as wide as the others,
  at least a Task board column's width, so a column's cells line up down
  the page; the Task board's narrower empty column would have broken that.
  The grid scrolls sideways, a lane's head staying at its left edge.
- **Cards as rows.** Each card is a Tab stop, opened by a click or
  <kbd>Enter</kbd> and its menu by right-click or the menu keys, as a
  table row is; the Task board's single roving Tab stop and its keys stay
  the Task board's.
- **Folding** is kept in the page while it is open, as the plan says, and
  forgotten on reload.
- **A new hub note** for a card moved from a row with none is written as
  File this writes one (`writeRowHub`, generalized from File this's
  `writeNewHub`), asking the type template's questions when it has any.
- **Undo's words.** *Moved Swap pricing to active, Credit.*, and *Put Swap
  pricing back.*
- **Not unit-tested**: the write itself, which needs VS Code; the plan
  for it (`planTypeBoardMove`, `moveFieldValues`) is. The DOM goldens and
  visual baselines for `searchPageTypeBoard` and `searchPageTypeBoardLanes`
  (test/ui/surfaces.js) are still to be made.

### Section 2: lanes on the Task board

Section 2 built on `feat/boards-lanes` too. `src/domain/tasks/boardLanes.ts`
holds the rules both sides read: the axes Lanes offers beside a Group
(`listLaneAxes`), whether two axes can be columns and lanes
(`isLaneAxisFor`), and why a cell refuses a card (`refuseCellMove`).
`layoutTaskBoard` lays out the lanes when asked (`lanes`), `resolveCellMove`
and `combineTaskMoves` make a drop's two edits one, and the page draws the
lanes on the shared lane grid with the Task board's own cards, heads, keys,
and drag code. Where the plan was silent, or impractical:

- **The Lanes select** follows Group's order, so the two read alike: None,
  Status, Priority, Due date, Person, the namespace in use, then Tag…,
  whose menu leaves out Group's namespace and the lanes' own. It shows on
  Board only, beside Group and before Sort.
- **Group by the lanes' axis** sets Lanes back to None (the preference
  service clears `taskBoardLanes`), rather than drawing the same values
  twice or swapping the two.
- **Ids.** A lane's id is its column id on its own axis, as columns are
  named: `priority:high`, `assignee:@dana`, `tag:team/payments` (no `#`),
  `due:today`, `done`.
- **Closed tasks in lanes.** By status, Done and Cancelled are lanes as
  they are columns, holding the closed tasks, so a done task sits where the
  Done column meets the Done lane. By any other axis a closed task is in
  the lane its value says: a done task in its priority's, its person's, or
  its due band's lane. A lane is made from the tasks of every column, closed
  ones too, so a person named only on done tasks still has a lane.
- **What a cell refuses.** Beyond the columns' own rules (Overdue and the
  other ranges of days), Done and Cancelled take a card only from its own
  lane: completing a task is a write of its own, with its done date and
  next occurrence, so it cannot share one line edit with a lane's change
  (D7). By status, a cell where a closed column meets an open lane, or the
  other way round, refuses and says where to drop instead: *Drop it in the
  Done lane to complete it.* A done card dragged out of Done into another
  lane is taken: its column's edit reopens it, and its lane's is resolved
  as of an open task, so the lane's own reopening cannot undo a status the
  column wrote.
- **Menu and key moves.** A choice that is a lane's value moves the card
  across lanes in its column, any other along its lane. A choice whose cell
  refuses, such as Complete it with lanes by status, is written as before,
  the card marked pending where it is until the host's next state puts it
  in the Done lane. **[** and **]** go along the lane to the next cell that
  takes the card; **↑** and **↓** go on past a cell's ends into the lane
  above or below, past folded lanes. No new keys, so the ? sheet is as it
  was.
- **Limits.** A cell keeps its column's: Done's 20 most recent per lane,
  and an open column's first 100 per lane. **Show N more** in a cell shows
  the whole column in every lane (`showColumnRest` is by column). A
  column's work-in-progress limit counts over every lane, and the dashed
  outline goes on its head. Most of a cell overdue quiets its red, as a
  column does.
- **Counts.** On a board with lanes a column's own cards are empty in the
  protocol, every card being in a cell; the page counts the heads from the
  cells, a task in two lanes once, with what the cells hold back, and
  counts again as words hide cards or a card moves.
- **Cards.** A card leaves out what its lane says as well as its column:
  its priority, its person, and its status. A task in two of a lane
  namespace's tags says *also in Rates*, as it does in two columns.
- **+ on a lane** sends the lane's id as the column `addTaskToColumn`
  names, so Add Task opens with the lane's edit already made to the line:
  `#team/payments`, the person, or the priority, in the reader's format.
  Done has no +, as its column has none.
- **D6 holds by itself.** The Dashboard no longer draws a task board at all;
  `layoutTaskBoard` lays out lanes only when its caller asks, and only the
  Task Board page asks.
- **The shared grid** gained three optional hooks, which the type board
  does not use: `renderColumnHead` (the Task board's heads say limits and
  overdue counts), `renderCellEnd` (Show N more), and a head's
  `attributes`. The Task board installs the grid's folding only, keeping
  its own drag, rank, and key code, which now works on a column or a cell
  (`.lane-cell[data-lane-column][data-lane-lane]`); a card carries
  `data-card-lane` beside `data-card-column`. The board stays one Tab stop.
- **Not built, or still to do**: the DOM goldens and visual baselines for
  `taskBoardLanes` and `taskBoardLanesDragging` (test/ui/surfaces.js), and
  the Task board's existing goldens, which gain the Lanes select.
