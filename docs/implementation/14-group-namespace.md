# 14. Group by any tag namespace

Workstream plan for the larger feature "Group by any tag namespace"
(`docs/ux-fifteen-sources-plan.md`, "Larger features", row 2; source N).
Written against `dev` at `726d23b` (v1.22.0). Nothing here is implemented.

## 1. Scope

Covers the one feature row: **the Tasks view and the Task board group by
the tags of any namespace a reader chooses** (`#project/…`, `#context/…`,
`#area/…`), with inherited heading and front-matter tags counting, plus the
README recipe for GTD contexts and PARA areas.

Verified against source before planning:

| Claim | Verified | Where |
| --- | --- | --- |
| Tasks view grouping is fixed to due / priority / status / assignee | Yes | `agendaState.ts:34` `AgendaGroupBy`, `AGENDA_GROUPINGS` :37–50; `package.json:1256` `deckard.agenda.groupBy` enum |
| Board grouping is fixed to status / priority / due / assignee | Yes | `types.ts:1403` `TaskBoardGroupBy`; `messages.ts:604` `isTaskBoardGroupBy`; `preferences.ts:1107` normalizer; `components.ts:1628` switch |
| Tasks view persists in a **setting**, the board in **preferences** | Yes | `agendaTree.ts:467–500` writes `deckard.agenda.groupBy`; `taskBoard.ts:412` `setTaskBoardGroup` |
| Inherited tags count in search | Yes, but in three layers | `Task.tags` holds front-matter tags and the *nearest* heading's own tags only (`parser.ts:1411`, section tags at :1119). Parent-heading tags are added only inside the evaluator (`queryEvaluator.ts:320–338`, `createTaskUnit` :363). Checked by parsing `# Plan #project/atlas` / `## Calls` / `- [ ] Call Ren`: the task's `tags` lacks `#project/atlas`. So grouping must walk ancestors the way `createTaskUnit` does, or a task under a nested heading would sit in "No project" while `tag:#project/atlas` finds it. |
| A tag's key is canonical, its label is as written | Yes | `#organization/acme` has key `#org/acme`, label `#organization/acme`; removal from a line must use the label |
| `@phone` would be a person | Yes | `parser.ts:1022`, `isPersonTag` :928 (`@…` and `#person/…`) — the reason for the `#context/phone` recipe |
| A board card is identified by task id alone | Yes | `data-task-id`, `taskBoardMoves[card.taskId]`, `taskBoardTabStop`, drop lookup `components.ts:1997`, focus restore `PLACE_KEYS` :1009. A task shown in two columns needs a per-card key. |
| A Tasks view item id is `agenda:task:<taskId>` | Yes | `agendaTree.ts:444`; VS Code throws on a duplicate id, so a task in two groups needs the group in its id |
| The Tasks view drop does not know where a task was dragged from | Yes | `handleDrag` sets only task ids (`agendaTree.ts:246`) |

Changed from the brief after verification:

- **The board's namespace picker sits in the grouping switch, not the gear.**
  The gear (`taskBoardHtml.ts:217`) holds layout, table columns and status
  columns; the grouping itself is the `.segmented` switch under the search box
  (`renderTaskBoardGroupSwitch`). Splitting one choice across two places
  would make "what is this board grouped by" answerable in neither. A fifth
  segment, **Tag…**, opens the namespace menu in the page.
- **Nested values are grouped by their full value**, not their first
  segment: `#project/deckard/ui` is its own column, **Deckard/ui**. The query
  language does not treat a tag as matching its descendants
  (`matchesTag`, `queryEvaluator.ts:511`), so a column always holds exactly
  what `tag:#project/deckard/ui` finds, and a drag never has to drop a
  sub-segment it cannot put back.

Nothing dropped.

## 2. Design

### 2.1 Which tasks are in which group

- A task's tags for grouping are **every tag a `tag:` search would match it
  by**: its own line, the heading it sits under, every heading above that,
  and its note's front matter (`tags:`, `projects:`, …). One helper computes
  this for both the evaluator and the grouping, so the **Atlas** column and
  the search `tag:#project/atlas` always hold the same tasks.
- Grouping by namespace `ns` puts a task in one group per distinct value
  `v` of a tag `#ns/v` it has. **A task with several appears in each** —
  a call that can be made from the phone or the computer belongs on both
  lists; a task that is in two projects is work for both. Where a task is
  shown in more than one group, its details end with **also in Computer**
  (the other group labels, joined with `, `), so the duplication is never a
  surprise. The board's total ("12 tasks") still counts tasks, not cards;
  a column header counts the cards in it.
- A task with no tag in the namespace goes in **No project** / **No
  context** / **No area** — `No ` + the namespace as keys spell it
  (lowercase). It is last in the Tasks view and the last column before
  **Done** on the board, as **Nobody named** is for Person.
- Groups are ordered busiest first, then by label; this is what the Tasks
  view's `collect` already does for Status and Person.
- Group label: the value as written after `#ns/`, from the index's label for
  the key (`index.tags.get(key).label`). A value written all lowercase is
  shown the way Status shows one — first letter capitalized, `-`/`_` as
  spaces (`q3-launch` → **Q3 launch**); a value with any capital is left as
  written (`iOS`, `DeckardUI`). A nested value keeps its slash
  (**Deckard/ui**). The full tag is in the group's tooltip.
- Only **open** tasks are grouped. The board's Done column is unchanged:
  completed tasks, whatever their tags.
- Namespaces offered: every `#ns/…` namespace carried (directly or
  inherited) by at least one open task in the index, except the board's
  status namespace (Status already groups by it), `person` (Person does), and
  the internal `tag-at`. Aliases are already folded: `#organization/…` is
  offered as `#org`.

### 2.2 What a move writes

A move now knows the column it came **from** (the board sends it; the Tasks
view carries the group a dragged item was drawn in). Moving a task from
group `u` (a value, **No …**, **Done**, or unknown) to group `v` in
namespace `ns`:

| To | Condition | Writes |
| --- | --- | --- |
| `v` | task already has `#ns/v` (on its line or inherited), `u` is `v`, No …, Done or unknown, task open | nothing (`unchanged`) |
| `v` | `u` is a value written **on the task line** | replaces that tag with `#ns/v` in place; if the task already has `#ns/v`, just removes `#ns/u` |
| `v` | `u` is a value the task **inherits** | **refuses** (below); nothing is written |
| `v` | `u` is No …, Done, or unknown | appends `#ns/v` to the line (as `setTaskStatusTag` appends, before a `^block-id`), unless the task already has it |
| No … | every `#ns/…` tag the task has is on its line | removes them all |
| No … | any `#ns/…` tag is inherited | **refuses** |
| any | task is completed (dragged out of Done) | reopens it as well, as every other grouping does |

Other tags in the namespace are left alone: moving a card from **Phone** to
**Errands** on a task tagged `#context/phone #context/computer` leaves
`#context/computer`.

The tag written is `#ns/v` with the canonical namespace and the value as the
column's key holds it. A tag written under an alias (`#organization/acme`)
is found and removed by its written label.

Refusal messages (shown the way each surface shows refusals today —
information message from the board, warning from the Tasks view):

- `"Call Ren" is in #project/atlas because its heading "Atlas" is, so moving it cannot take it out. Change the heading instead.`
- `"Call Ren" is in #area/health because its note's front matter is, so moving it cannot take it out. Change the front matter instead.`

(The heading is the nearest heading in the chain that carries the tag, with
tags stripped; the task title is quoted with the existing `quoteTaskTitle`.)

The success label, used in `Moved "Call Ren" to …` and the undo item, is
the full tag, `#context/phone`, or `No context`.

**+ Add task** at the foot of a namespace column captures the task with
`#ns/v` written on it (through `captureIntoColumn`, which already runs
`resolveTaskMove` on the captured line). On **No …** it writes nothing
extra.

### 2.3 Tasks view: choosing a namespace

`Deckard: Group Tasks By…` (the view's title button) keeps its quick pick,
with one more item last:

- label **Tag namespace…**, detail `Your own tags, such as #project/… or #context/…, counting the ones a task inherits`; when current, description `Current: #project`.

Choosing it opens a second quick pick:

- title `Group tasks by tag namespace`, placeholder `Choose the namespace whose tags are the groups`
- one item per namespace, busiest first: label `#context`, description `9 open tasks` (plus ` · Current`), detail the first three values by use, `phone, computer, errands, and 2 more`.
- No namespace in use: no second pick; an information message: `No open task carries a namespaced tag, such as #context/phone, yet. Write one on a task, or on the heading above it, to group by it.`

Choosing writes both settings (Global, as today). Group icon: `$(tag)`.
Group tooltip: `Tasks tagged #context/phone on their line, a heading above them, or their note's front matter. Drag a task here to tag it.` For the No group: `Open tasks with no #context/… tag.`

### 2.4 Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `deckard.agenda.groupBy` | enum, adds `"tag"` | `due` | enumDescription for `tag`: `The tags in one namespace, such as #project/… or #context/…: deckard.agenda.groupNamespace says which.` |
| `deckard.agenda.groupNamespace` (new) | string, pattern `^[A-Za-z][A-Za-z0-9_-]*$` | `"project"` | `The tag namespace the Tasks view groups by when deckard.agenda.groupBy is tag, so context gives a group each to #context/phone, #context/computer, and the rest. A tag a task inherits from a heading or its note's front matter counts.` `order` 8; the settings after it shift one. |

The board keeps its choice in preferences, like its other groupings:
`PersistedPreferences.taskBoardGroup` gains `'tag'` and a new optional
`taskBoardGroupNamespace: string`. The normalizer keeps `'tag'` only with a
valid namespace (`^[a-z][a-z0-9_-]*$` after lowercasing), and falls back to
`status` otherwise.

The board and the Tasks view stay independent, as they are today (the board
defaults to Status, the view to Due status).

### 2.5 Task board: the switch and the menu

The grouping switch gains a fifth segment after **Person**:

- not grouped by tag: **Tag…**, `title="Group by the tags in one namespace, such as #project/… or #context/…"`
- grouped by tag: **#context**, pressed, `title="Grouped by #context/… tags. Choose another namespace"`
- no namespace in use: **Tag…**, `disabled`, `title="No open task carries a namespaced tag such as #context/phone yet"`

It is `data-action="pick-board-namespace"`, `aria-haspopup="menu"`. A click
opens the page's action menu (the one the card **⋯** uses, so it works from
the keyboard and returns focus), headed **Group by tag namespace**, one item
per namespace: `#context · 9 open tasks`. A choice posts
`{ type: 'setBoardGroup', groupBy: 'tag', namespace: 'context' }`; the
current one is left out of the menu, as a card's current column is.

Columns: one per value, busiest first, then **No context**, then **Done**.
Every namespace column takes a drop and **+ Add task**. A card's **⋯** menu
already lists "any column of the current grouping" under **This board**, so
namespace columns appear there without new code. `[`/`]` move a card to the
neighboring namespace column, from the column it is in.

### 2.6 Query syntax

None. Grouping reads the same tag set `tag:` does; no new query field.

## 3. Implementation steps

### Step A. One reading of a task's tags (core)

- `src/core/query/queryEvaluator.ts`: export
  `readTaskTagKeys(index, task): Set<string>` = `task.tags` ∪ section's
  `tags` ∪ `collectInheritedTagKeys(section)`. `createTaskUnit` calls it and
  then adds the membership keys, so search behavior is unchanged (existing
  query tests prove it).
- New `src/ui/state/tagGrouping.ts`:
  - `readNamespaceValues(index, task, namespace)` →
    `{ value, key, label, written: boolean }[]`, `written` true when the key
    is in `task.associationTagGroups[0]` (then `label` is the written label).
  - `findTagSource(index, task, key)` → `{ kind: 'heading', heading }` for the
    nearest section in the chain whose `headingTags` hold the key (heading
    text through `stripTags`), else `{ kind: 'frontmatter' }`.
  - `listTaskNamespaces(index, exclude)` →
    `{ name, openTasks, values: string[] }[]` over open tasks, busiest first.
    Excludes the given status namespace, `person`, `tag-at`.
  - `formatNamespaceValue(label, namespace)` (the label rule in 2.1) and
    `noValueLabel(namespace)` → `No ${namespace}`.
  - `isNamespaceName(value)`.
- `src/ui/state/taskBoardState.ts`:
  - `resolveTaskMove(task, columnId, options, context?: { index?: WorkspaceIndex; from?: string })`.
    New `case 'tag'`: column id `tag:<ns>/<value>` (value may hold `/`;
    empty after the slash is the No column). Validate the namespace with
    `isNamespaceName`, and the value by running `extractTags('#ns/value')`
    and requiring exactly one tag whose key is `#ns/value`; otherwise refuse
    `Deckard cannot write "#ns/value" as a tag.` Without `context.index`
    (capture) the task's own `tags` stand in, which for a parsed single line
    are its line tags. Then the table in 2.2.
  - `setTaskNamespaceTags(line, checkboxColumn, { remove: string[] (written labels), add?: string })`:
    removes each label with the boundary rule `setTaskStatusTag` uses
    (`[ \t]+<label>(?![A-Za-z0-9_/-])`, case-insensitive), replaces the first
    removed in place when there is an `add`, else appends with
    `appendToTaskText`. `setTaskStatusTag` is left as is.
- Callers pass the context: `moveTaskToColumn(task, columnId, context)` in
  `taskBoardActions.ts` (the board passes `index` and `from`),
  `AgendaTreeProvider.moveToGroup` (passes `this.index` and the source group
  id), `captureIntoColumn` (none).

Edge cases: a completed task (reopen + tag); a tag written twice on a line
(both removed); a tag inside the title's inline code is not a tag, so it is
not in `associationTagGroups` and never touched; a `^block-id` stays last;
a task that is in `u` both on its line and by inheritance counts as written
for the line copy but the inherited one keeps it in `u` — refuse, since the
card would not leave the column (check inherited membership first).

### Step B. Tasks view

- `agendaState.ts`: `AgendaGroupBy` adds `'tag'`; `AGENDA_GROUPINGS` adds
  `{ id: 'tag', label: 'Tag namespace…', detail: … }`; `AgendaOptions` adds
  `groupNamespace?: string`. New `groupByTag(entries, index, namespace, order)`
  builds groups with ids `tag:<ns>/<value>` and `tag:<ns>/`, clones an entry
  per extra group with `also in …` appended to `details`.
  `createAgenda` dispatches to it.
- `agendaTree.ts`:
  - `GROUPING_ICONS.tag = new ThemeIcon('tag')`; `createGroupItem` sets the
    tooltip in 2.3 for tag groups.
  - Task node gains `groupId`; `createTaskItem` id becomes
    `agenda:task:<groupId>:<taskId>` so a task in two groups has two ids.
  - `handleDrag` sets `{ taskId, groupId }[]`; `handleDrop` reads either
    shape (old string arrays from an in-flight drag are not a concern within
    one session, but read both anyway). `rankBefore` dedupes the drawn ids
    (`mergeOrder` does not).
  - `moveToGroup` passes `{ index, from: sourceGroupColumnId }` per task.
  - `groupColumnId` returns the id itself for `tag` (ids are already column
    ids).
  - `getAgendaGroupNamespace()` reads `agenda.groupNamespace`, lowercases,
    validates, falls back to `project`; `getChildren` passes it.
  - `pickAgendaGrouping(index?)`: on `tag`, `pickTagNamespace(index, current)`
    runs the second quick pick; writes `agenda.groupNamespace` then
    `agenda.groupBy`. Refreshes on `deckard.agenda` config change already.
- `extension.ts:555`: the command passes `indexer.getSnapshot()`.
- `package.json`: the enum value, enumDescription, and the new setting.
- The badge, Home's agenda widget, the status bar, and `listOverdueTasks`
  call `createAgenda` without `groupBy` and are unaffected.

### Step C. Task board

- `types.ts`: `TaskBoardGroupBy` adds `'tag'`; `TaskBoardLayout` gains
  `groupNamespace?: string` and `tagNamespaces: { name: string; openTasks: number }[]`;
  `SetBoardGroupMessage` gains `namespace?: string`; `MoveTaskMessage` gains
  `from?: string`; `PersistedPreferences.taskBoardGroupNamespace?: string`.
- `preferences.ts`: `setTaskBoardGroup(group, namespace?)`; normalizer per 2.4.
- `messages.ts`: `isTaskBoardGroupBy` accepts `tag`; `setBoardGroup` with
  `tag` requires a valid `namespace` string, rejects otherwise; `moveTask`
  accepts an optional non-empty string `from`.
- `taskBoardState.ts`: `createTaskBoard` passes
  `preferences.taskBoardGroupNamespace`; `layoutTaskBoard(index, tasks, groupBy, options, namespace?)`
  adds `createTagColumns(open, index, namespace)` (all droppable, None last),
  `createCard` gains an `alsoIn: string[]` detail (`also in Computer`), and the
  layout carries `groupNamespace` and `tagNamespaces`
  (`listTaskNamespaces(index, [options.statusNamespace])`).
  A `tag` grouping without a namespace lays out as `status`.
- `taskBoard.ts`: `setBoardGroup` passes the namespace; `moveTask` passes
  `{ index, from: message.from }`.
- `components.ts`:
  - `renderTaskBoardGroupSwitch(groupBy, namespace, namespaces)`: the fifth
    segment (2.5); `taskBoardHtml.ts:237` passes the extra arguments.
  - A card key, `columnId + '\u0000' + taskId`: `taskBoardMoves`,
    `taskBoardTabStop` keyed by it; the card carries `data-card-column`;
    `'cardColumn'` joins `PLACE_KEYS` so focus comes back to the same copy.
  - `moveCard`, the menu choice, and the drop post `from`
    (`card.dataset.cardColumn`); `dragstart` records the dragged card's
    column, and the drop looks the card up by task id **and** column.
  - `installTaskBoard` handles `pick-board-namespace`: `openActionMenu` with
    the namespaces from the last state (the page passes a getter), posting
    `setBoardGroup` with `groupBy: 'tag'`.
- The Dashboard does not draw a board with a group switch
  (`setBoardGroup` is board-only, `task-board.test.ts:386`), so nothing
  there changes.

## 4. Tests

`npm test` (vscode-test, `src/test/`):

- `agenda.test.ts`, new **groups by a tag namespace, counting the tags a task inherits**: parse
  `---\ntags: [area/health]\n---\n# Atlas #project/atlas\n## Calls\n- [ ] Call Ren #context/phone\n- [ ] Draft #context/computer #context/phone\n- [ ] Loose\n`
  and assert, for `context`: `Phone [Call Ren, Draft]`, `Computer [Draft]`,
  `No context [Loose]`, and Draft's details in Phone end `also in Computer`;
  for `project`: every task in **Atlas** (the parent heading, two levels up);
  for `area`: every task in **Health** (front matter). Group ids are
  `tag:context/phone` … `tag:context/`.
- `agenda.test.ts`: labels — `q3-launch` → `Q3 launch`, `iOS` kept, a nested
  value `Deckard/ui`; `groupColumnId('tag:context/phone', 'tag')`.
- `task-query.test.ts` (or `query-language.test.ts`): for each task,
  `readTaskTagKeys` holds a key exactly when `tag:<key>` finds the task — the
  column and the search agree.
- `task-board.test.ts`:
  - **groups by a tag namespace, a task in each of its columns**: column
    order busiest first, `tag:context/` labeled **No context** last before
    Done, a card in two columns, `taskCount` counts tasks once;
    `tagNamespaces` excludes `status` and `person`.
  - **turns a drop between tags into an edit of the task line**, one assert
    per row of the 2.2 table: append; replace in place from `u`; remove only
    `u` when `v` is already there; unchanged; to No … removes every written
    tag; reopen from Done; `#organization/acme` (key `#org/acme`) removed by
    its label; a `^block-id` stays last.
  - **refuses to take away a tag a heading or front matter gave**: the two
    exact messages in 2.2.
  - refuses a column id whose tag would not parse back to itself.
- `preferences.test.ts`: `tag` + `context` round-trips; `tag` with no or an
  invalid namespace reads back as `status`.
- `task-board.test.ts` (message validation): `setBoardGroup` `tag` needs a
  valid namespace; `moveTask` with `from` accepted, with a non-string `from`
  rejected.
- `task-board-page.test.ts` (jsdom, `webviewPage.ts`):
  - the **Tag…** segment opens a menu headed **Group by tag namespace**
    listing `#context · 2 open tasks`; choosing posts
    `{ type: 'setBoardGroup', groupBy: 'tag', namespace: 'context' }`;
  - grouped by `context` the segment reads **#context** and is pressed; with
    no namespaces it is disabled;
  - a task in two columns is two cards; choosing a column from the second
    copy's menu posts `moveTask` with `from: 'tag:context/computer'`; `]` on
    a card posts the right `from`; only one card is the Tab stop.
- A new `agenda-tree.test.ts` (runs in the extension host): with grouping
  `tag`, `getChildren` gives each copy of a task a distinct item id; a drop
  from **Phone** to **Errands** writes via `updateTaskLine` (stubbed) with
  the replaced line; `rankBefore` stores no duplicate id.

`npm run test:ui`: `verifyWebviews.js` needs no new rule; its script check
covers the new page code. Add nothing to `checkContrast.js` (no new colors).

`npm run test:layout`: add a surface to `checkLayout.js` — the board grouped
by `project` at `[900, 700]` (fixture preferences with
`taskBoardGroup: 'tag', taskBoardGroupNamespace: 'project'`), so the
five-segment switch wraps rather than overflows and a long **No
organization** header stays inside its column.

`npm run test:e2e` (`test/e2e/taskBoard.e2e.js`): choose **Tag…** →
`#context`; drag a card from **Phone** to **Errands** and read the file's
line back; drag a card whose project comes from its heading to **No
project** and assert the file is unchanged and the refusal was shown.

Visual baselines to re-record (`npm run test:visual`, all in
`test/ui/visual-baseline/darwin`): the 16 `*-taskBoard.png` (eight themes,
with and without zen) — the switch gains a segment. No other page changes.

## 5. Docs

- **README, Tasks view**: the **Group by** bullet lists **Tag namespace…**,
  with a sub-bullet: `**Tag namespace** groups by the tags in one namespace you choose, such as #project/… or #context/…, busiest first, with **No project** last. A tag counts whether it is written on the task, on a heading above it, or in its note's front matter, as it does in a search; a task with two such tags is in both groups, and says **also in** the other. deckard.agenda.groupNamespace keeps the namespace.` The drag bullet adds: `a **tag** in the namespace, replacing the one it was dragged from; a tag the task inherits cannot be taken away by dragging, and Deckard says which heading or front matter gave it.`
- **README, Task board**: a bullet after **Person**: `**Tag…** groups by the tags of one namespace, chosen from the namespaces your open tasks carry, including tags inherited from headings and front matter. Dropping a card writes the new tag on the task line in place of the one it came from, or removes the task's own tags in **No project**; a tag inherited from a heading or front matter stays, and Deckard says so.` Fix the lead: "grouped by status, priority, due date, person, or any tag namespace".
- **README, new subsection under Task board, "Contexts, areas, and projects"**: the recipe. GTD contexts as `#context/phone`, `#context/computer`, `#context/errands` — not `@phone`, which Deckard reads as a person; PARA areas as `tags: [area/health]` in a note's front matter so every task in it is in the area; projects as a heading tag `## Launch #project/atlas`; then Tasks view → Group Tasks By… → Tag namespace… → `#context`, with `deckard.agenda.query` set to `is:open` or a narrower search. Link it from the Features table row for the Tasks view.
- **README, Settings table**: `deckard.agenda.groupBy` values gain `tag`; a row for `deckard.agenda.groupNamespace`; the sample JSON block gains it.
- **Help** (`helpHtml.ts:391–392`): Tasks view card — "due status, priority, status, person, or any tag namespace, such as #context"; Task board card — "by status, priority, due date, person, or the tags of a namespace you choose".
- **CHANGELOG `## Unreleased` → `### Added`**: `**Group tasks by your own tags.** The Tasks view and the Task board group by the tags of any namespace — #project, #context, #area — as well as by due date, priority, status, and person. A tag inherited from a heading or a note's front matter counts, a task with two such tags is in both groups, and dragging between groups rewrites the tag on the task line, refusing to take away one a heading gave it. The README has a recipe for GTD contexts and PARA areas.`
- **docs/components.md**: `renderTaskBoardGroupSwitch(groupBy, namespace, namespaces)` row — "The Status / Priority / Due date / Person / Tag… switch; Tag… opens a menu of namespaces"; `installTaskBoard` row — posts `moveTask` with `from`, a card is keyed by column and task, and `pick-board-namespace` joins the actions list at line 293.

## 6. Commits

1. `feat: moving a task between tags of one namespace rewrites its line, and refuses a tag its heading gave it`
   Step A: `readTaskTagKeys`, `tagGrouping.ts`, the `tag` case of
   `resolveTaskMove`, `setTaskNamespaceTags`, the `context` parameter on the
   three callers. Tests: the `task-board.test.ts` move and refusal tests, the
   query-agreement test. No UI yet; nothing produces a `tag:` column, so
   behavior is unchanged. (1 d)
2. `feat: the Tasks view groups by any tag namespace, counting the tags a task inherits`
   Step B, the settings, the README Tasks view bullets and Settings rows,
   the Help Tasks view card, the CHANGELOG entry (Tasks view half).
   Tests: `agenda.test.ts`, `agenda-tree.test.ts`. (1 d)
3. `feat: the Task board groups by any tag namespace, and a card in two columns is two cards`
   Step C, README board bullet, Help board card, CHANGELOG completed,
   components.md. Tests: `task-board.test.ts` layout and messages,
   `preferences.test.ts`, `task-board-page.test.ts`, the layout surface, the
   e2e. `test:visual` fails on the 16 board baselines here, expectedly.
   (2 d)
4. `test: re-record the board baselines for the Tag grouping segment`
   The 16 `*-taskBoard.png`. (0.25 d)
5. `docs: contexts, areas, and projects as tag namespaces`
   The README recipe subsection and its Features-table link. (0.25 d)

Each commit passes all four suites (`npm test`, `test:ui`, `test:e2e`,
`test:layout`) on its own; commit 3 additionally needs 4 before
`test:visual` is green.

## 7. Size, risks, dependencies, questions

**Size:** about 4.5 days.

**Risks**

- *Duplicate cards.* Every place the board page keys by task id must move to
  the card key; missing one gives a menu or a Tab stop acting on the wrong
  copy. Mitigated by the jsdom tests on the second copy specifically. Only
  the tag grouping ever produces duplicates, so the other groupings cannot
  regress in behavior.
- *Many columns.* A workspace with 40 projects gets 41 columns. The board
  already scrolls sideways and 10d's per-column cap applies; no cap is
  added here. The Tasks view folds nothing, which could be long; acceptable
  for a grouping the reader chose.
- *Evaluator refactor.* `createTaskUnit` is on every search's hot path;
  `readTaskTagKeys` is the same work moved into a function, and the whole
  query suite covers it.
- *Aliases.* Removing a tag relies on the written label in
  `associationTagGroups`; tested with `#organization/…`.

**Dependencies on other workstreams**

- **Piece 10 (10a, 10d)**: "move the card at once … reconcile by task id"
  and "patch by task id" must use the card key from this plan (column +
  task), or a duplicated card is patched in only one column. Whichever
  lands second adapts; the key is one helper, `boardCardKey(columnId, taskId)`.
- **Piece 3 (3a, 3b, 3e, stale group from Decision 1, 3f)**: edits the
  same `createAgenda`, `agendaTree.ts`, and board column headers. No
  behavioral conflict — those change the Due grouping and headers; this adds
  a grouping — but a merge conflict in `agendaState.ts` and
  `createGroupItem` is likely. 3f's "40 · 38 overdue" header applies to
  namespace columns as-is.
- **Piece 3 (3j, Gone quiet with a namespace choice)**: should reuse
  `listTaskNamespaces` / `pickTagNamespace` from this plan rather than write
  a second namespace picker.
- **Parked notes** (larger feature): if it lands, parked tasks leave the
  board default and the Tasks view; the namespace list is built from the
  same open tasks, so it follows automatically.
- **Piece 9** (card views quieter tags): touches card rendering; independent.

**Open questions for David:** none. The one choice most worth a veto is
**a task with two tags in the namespace appears in both groups** (marked
"also in …"), rather than only in the first; the alternative is a one-line
change in `groupByTag` and `createTagColumns`.
