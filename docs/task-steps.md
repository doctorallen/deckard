# Breaking a task into steps

The design note for Break into Steps…, from plan 16
(`docs/implementation/16-steps.md`). Where the build differed from the plan,
the plan is kept as written and the code, README, and CHANGELOG say what was
built.

## 1. Scope

In scope:

- **Break into Steps…** from the lightbulb and palette on a task line, the
  Tasks view context menu, and the Task board card menu (plus a card key).
- The index learns which task a nested checkbox belongs to (a parent link
  and a step summary on the parent).
- "2 of 5 steps · next: Draft the email" on board cards, webview task rows
  (search pages, Home, board list), and Tasks view rows. In the Tasks view a
  task with steps expands to show them.
- Plain steps fold into their task's card or row on the board and in the
  Tasks view, so writing five steps does not add five cards.
- Completion: completing a task's last open step offers to complete the
  task; completing a task with open steps offers to complete them too.
  Neither is automatic.
- Recurrence: a repeating task's steps come back, unchecked, under its next
  occurrence.
- Rollover: a carried task takes its open steps with it, nested; a step is
  never carried under the wrong task.
- `is:step` and `has:steps` / `no:steps` in the query language, with
  completions (builder parity: the builder's `is`/`has` values come from
  the same completions).
- **Suggest steps**, optional, through VS Code's Language Model API
  (`vscode.lm`), only when a model is installed, only when chosen, and
  always previewed in the same list before anything is written.

Verified against source, and what changed because of it:

- **Nested tasks are indexed today, but flat.** `findTasks`
  (`parser.ts:1386-1459`) matches `^(\s*)([-*+])[ \t]+\[([ xX])\]` on
  every line, indented or not, and `Task` (`types.ts:186-222`) has no
  parent, child, or indentation field. So every nested checkbox is already
  its own task in the Tasks view's **No date** group, on the board's
  "No status" column, and in the status bar's open count. A parent link is
  needed, as the brief suspected. It also means the folding rule below
  changes what existing notes with nested checklists show on the board and
  Tasks view (fewer, richer cards) — intended, and called out in the
  CHANGELOG.
- **Steps do not inherit the task's inline tags.** A task takes its
  section's tags (`findNearestSection`); an inline `#status/doing` or
  `#project/atlas` on the parent line does not reach its nested checkboxes.
  Kept as is: changing inheritance would change every search. The folding
  rule makes it matter less, since a plain step rides on its parent.
- **There is no editor context menu entry for any Deckard task command**
  (`package.json` has no `editor/context` menu at all). Edit Task… lives on
  the lightbulb (`TaskEditorActions`, `taskEditor.ts:566-603`), the palette
  (gated on `deckard.onTaskLine`), and a keybinding. Break into Steps…
  follows the same pattern — lightbulb and palette — rather than opening a
  first `editor/context` menu for one command. No new keybinding.
- **A quick pick input cannot take a pasted multi-line list** reliably:
  it is a single-line `<input>`, and Chromium strips line breaks from a
  pasted value. So "one step per line" is one step per Enter in a list that
  grows, which is also how the task editor works. If a value does arrive
  with line breaks (a VS Code build that keeps them), it is split into
  several steps.
- **The assistant tools already use `vscode.lm`** (`assistantTools.ts`,
  `registerTool`) and the README's privacy line for them is "Deckard
  itself sends nothing anywhere". Suggest steps is the first place Deckard
  itself sends something to a model, so its wording is new and exact
  (below), and the README's Local-first row gains a clause.
- **Completing a repeating task writes the next occurrence above**
  (`taskActions.ts:254-272`, `createNextOccurrence`), so today its steps
  stay attached to the completed line and the next occurrence has none.
- **Rollover carries `sourceLineText` verbatim, indentation included**
  (`rollover.ts:176-180`), sorted by line. An open step whose task is done
  (or deduped away, or changed) is written indented under whatever task
  precedes it in today's note — a real, current bug for nested checklists,
  fixed here.

Dropped: none of the brief. Left out on purpose: a Steps row in the task
editor (the editor writes one line; steps are several), step progress in
query blocks and Find rows (later, same helper), and editing steps from
the board (open the note; they are right under the task).

## 2. Design

### What a step is

A **step** is a checkbox task whose nearest list parent is a checkbox task:

```markdown
- [ ] Plan the offsite 📅 2026-10-09
  - [x] Book the venue
  - [ ] Draft the email
  - [ ] Send the invite
```

- Parentage follows list indentation, tabs counted to the next multiple of
  4. A heading, a fence, or an unindented non-list line ends the list; a
  blank line does not.
- The direct list parent must itself be a task. A checkbox under a plain
  bullet under a task is not a step (it is its own task, as today).
- A step may have steps; each task counts only its own direct steps.
- Ordered-list items are never tasks today (`taskPattern` is unordered
  only), so they are never parents.

### Progress wording (host-worded, one helper, used everywhere)

`describeSteps(steps)` in `src/core/markdown/taskSteps.ts`:

| Case | Text |
| --- | --- |
| some open | `2 of 5 steps · next: Draft the email` |
| one step, open | `0 of 1 step · next: Draft the email` |
| all done | `All 5 steps done` |

"next" is the first open direct step in source order, its title as the
index holds it (metadata removed), trailing tags stripped as card titles
are. Long titles are cut by CSS, not by the host; the Tasks view
description is cut by VS Code.

Where it shows:

- **Board card**: its own line under the details,
  `<p class="board-steps">2 of 5 steps<span class="board-steps-next"> · next: Draft the email</span></p>`,
  muted, one line with ellipsis on the next-step part. The card's
  `aria-label` gains ", 2 of 5 steps".
- **Webview task row** (`renderTaskListRow`: search pages, Home widgets,
  the board's list layout): a `.task-detail` span in `.task-meta`, after
  Repeats, with the same text.
- **Tasks view**: appended to the row description
  (`due Fri 2026-10-09 · 2 of 5 steps · next: Draft the email`); the
  tooltip gains a line `Steps: 2 of 5 done. Next: Draft the email.` and
  its last line becomes `Right-click to date, edit, or break it into steps.`
  A task with steps is **collapsible (collapsed)**, and expands to its
  direct steps: each with a checkbox (checked when done; unchecking reopens
  it), opening its line on click, and the same context menu as a task.

### Folding: when a step is not listed on its own

On the **Task board** (board, list, and table layouts) and in the **Tasks
view** (and so Home's agenda widget, which reads the same `createAgenda`):

> A step is shown on its task's card or row, not on its own, when its task
> is listed too and the step carries nothing of its own to sort by: no due,
> scheduled, or start date, no priority, no person, and no tag written on
> its line.

So the steps Break into Steps writes always fold; a step someone dated,
prioritized, tagged `#status/doing`, or gave to `👤 @dana` keeps its own
card and row (it would otherwise vanish from Dana's column or from Today),
and still counts in its task's progress. A step whose task is not listed
(done, filtered out by the query) is listed normally.

Search pages and query blocks do not fold: a search lists what it found.
`is:step` and `-is:step` let a search choose.

### Break into Steps…

Command `deckard.breakIntoSteps`, title **Break into Steps…**, category
Deckard. It takes an optional task (from the view and the board); from the
palette and lightbulb it uses the task on the cursor's line.

Entry points:

| Surface | How | Label |
| --- | --- | --- |
| Editor lightbulb | `TaskEditorActions.provideCodeActions`, second action after Edit task… | `Break into steps…` |
| Palette | `commandPalette` when `editorLangId == markdown && deckard.onTaskLine` | `Deckard: Break into Steps…` |
| Tasks view | `view/item/context`, `deckardAgendaTask`, group `2_edit@2` (after Edit Task…); command `deckard.agenda.breakIntoSteps`, hidden from the palette | `Break into Steps…` |
| Task board card menu | new last-but-one group **Steps** with one item | `Break into steps…` (`Add steps…` when the card already has steps) |
| Task board key | `s` on a focused card; key sheet row `['s', 'Break it into steps']`; `aria-keyshortcuts` gains `s`; Help's keyboard card gains "<kbd>s</kbd> breaks it into steps" | — |

The flow is one quick pick with `ignoreFocusOut: true`:

- **Title**: `Break "Plan the offsite" into steps`, or
  `Add steps to "Plan the offsite"` when it has some (title via
  `quoteTaskTitle`).
- **Placeholder**: `Type a step and press Enter. Add as many as you need.`
- **Rows**, top to bottom:
  1. While the box has text: `$(add) Add "Draft the email"` (always shown,
     picked by Enter). Editing a step: `$(edit) Change step 2 to "…"`.
  2. Separator `Already written` (only when the task has steps), then each
     existing step, `$(pass-filled)` done or `$(circle-large-outline)` open,
     description `written`. Picking one does nothing (they are shown so new
     steps are not duplicates).
  3. Separator `New steps`, then each new step `1. Book the venue`,
     description `suggested` for a suggested one; item buttons
     `$(arrow-up)` "Move up" and `$(trash)` "Remove". Picking a step puts
     its words in the box to change them.
  4. When there is at least one new step: `$(check) Write 3 steps`,
     description `under the task, as - [ ] lines`.
  5. When `deckard.tasks.suggestSteps` is on and `vscode.lm.selectChatModels()`
     returns a model: `$(sparkle) Suggest steps`, description
     `asks GitHub Copilot · GPT-4o` (the model's `vendor`-facing name and
     `name`), detail
     `Sends only this task's words, "Plan the offsite". Nothing is written until you choose Write.`
- **Enter with an empty box** on a list that has new steps picks
  `Write N steps`. Escape writes nothing.
- A step typed as `- [ ] Call Dana` is written as `Call Dana` (a leading
  bullet, number, or checkbox is removed); empty steps are ignored; runs
  of whitespace collapse.

**Writing** (`addTaskSteps`):

- The task line must still read as indexed, else the shared "note
  changed" message (Piece 8b's string when it lands; today's
  `Deckard could not update this task because the source line changed.`).
- New steps go **after the task's last existing descendant line** (so
  after existing steps and their notes), before any blank line that
  follows.
- Indentation: the first existing direct step's indentation; else the
  indentation the note already uses for nested list items (the first list
  item in the note indented under another, measured as the difference);
  else the task's indentation plus two spaces (the CommonMark content
  column of `- `, read by Obsidian, GitHub, and VS Code's preview). A tab
  indented note gets a tab.
- Marker: the task's own (`-`, `*`, or `+`). Line ending: the document's.
- One write through `applyWorkspaceWrite` (label
  `writing 3 steps under "Plan the offsite"`), so a single note is written
  without a preview unless `deckard.previewWorkspaceWrites` is `always`,
  and `Deckard: Undo Last Change` takes it back.
- Message (Information): `Wrote 3 steps under "Plan the offsite".`
  [Undo]. Undo calls `workspaceWrites.undo()`.

### Suggest steps (language model)

- Setting **`deckard.tasks.suggestSteps`**: boolean, default `true`.
  Description: `Offers **Suggest steps** in Break into Steps… when a VS
  Code language model, such as GitHub Copilot, is installed. Only the
  task's words are sent, to that model, and only when you choose it. Turn
  off to never offer it.`
- Nothing is sent to find out whether a model exists: `selectChatModels()`
  lists installed models locally.
- On choosing it: the pick goes `busy`, placeholder
  `Asking GPT-4o for steps…`; the request carries the quick pick's
  cancellation (hiding the pick cancels it) and a 30-second timeout.
- **What is sent** — one user message, and nothing else (no headings, no
  note, no other tasks):

  ```
  Break this task into small, concrete steps one person can do one at a
  time, in order. Reply with 3 to 7 steps, one per line, each under 80
  characters, with no numbering, bullets, or other text.

  Task: Plan the offsite
  ```

  `justification` (shown in VS Code's consent dialog):
  `Deckard sends the words of the task you chose, to suggest steps for it.`
- The reply is read by `parseSuggestedSteps`: split lines; drop leading
  bullets, numbers, and checkboxes; drop empty lines and lines ending in
  `:`; cut each at 120 characters; keep at most 10. They join the list as
  **suggested** rows the reader removes, reorders, changes, or adds to;
  placeholder becomes `Remove any you don't want, then choose Write.`
- Failures (Warning, nothing written, the list stays open with what was
  typed):
  - consent refused / `LanguageModelError.NoPermissions`:
    `Deckard was not allowed to use GPT-4o, so it suggested nothing. Type the steps instead.`
  - anything else (blocked, not found, offline, timeout):
    `GPT-4o could not suggest steps (<error.message>). Type the steps instead.`
  - empty result: `GPT-4o suggested no steps. Type them instead.`
  The raw error also goes to Deckard's log with timing, as assistant tool
  calls are.
- README and Help say it plainly (section 5). "Nothing leaves your
  machine" stays true of the index; the Local-first row gains "unless you
  choose Suggest steps".

### Completion

In `toggleTask`, after a successful completion, the note as just written
is read again (not the index, which may lag) with `findStepFamily`:

- **Last open step completed**:
  `Completed "Draft the email", the last open step of "Plan the offsite".`
  [Complete Task] [Undo]. **Complete Task** completes the parent through
  `toggleTask` (done date, next occurrence, its own message and Undo).
- **Task completed with open steps**:
  `Completed "Plan the offsite". 3 of its steps are still open.`
  [Complete Steps] [Undo]. **Complete Steps** completes the direct open
  steps in one `applyWorkspaceWrite` (label
  `completing 3 steps of "Plan the offsite"`), then
  `Completed 3 steps of "Plan the offsite".` [Undo].
- Otherwise the message is unchanged. Reopening says nothing new. Bulk
  edit, the assistant's `deckard_change_task`, and clicks in the Markdown
  text itself do not offer (they are deliberate, or not Deckard's).

### Recurrence

Completing a repeating task that has steps writes, above it, the next
occurrence **followed by its direct steps, unchecked** (`[x]` → `[ ]`,
`✅ date` / `[completion:: …]` removed, indentation kept), so a routine
checklist comes back fresh. Steps' own dates are copied as written.
The completed occurrence keeps its checked steps as history. The message
stays `Completed "Weekly review", and started the next one, due
2026-10-02.` The Undo already reverts the whole written range
(`revertTaskLine` handles multi-line replacements).

### Rollover

- A carried task takes its **open** steps, written under it with their
  indentation relative to it (move and copy alike).
- In **move** mode its **done** steps move too, so nothing is left
  orphaned under the wrong task in the old note.
- A step whose task is not carried (done, skipped, or already in today's
  note) is carried **at the top level** (its indentation removed), never
  nested under an unrelated task.
- Dedupe (`todayLines.has(trim)`) compares a step together with its
  task, so two different tasks' "Call Dana" steps are not merged.

### Query

- `is:step` — a task that is a step (has a parent task). Aliases `substep`,
  `subtask`.
- `has:steps` / `no:steps` — a task with at least one step. Alias
  `has:subtasks`.
- Error text lists them: `is: accepts open, done, task, note, overdue, due,
  blocked, blocking, mine, assigned, unassigned, or step — not "…".` and
  `has: and no: accept due, scheduled, start, done, priority, id,
  dependsOn, or steps — not "…".`
- Completions (`dashboardState.ts:~1556`):
  `{ value: 'is:step', detail: 'Tasks written under another task' }`,
  `{ value: 'has:steps', detail: 'Tasks broken into steps' }`,
  `{ value: 'no:steps', detail: 'Tasks with no steps' }`.
- The assistant tools' shorthand guide (`state/assistantTools.ts:36`)
  gains `is:step` and `has:steps`.

## 3. Implementation steps

### 3.1 Index: parent link and step summary

- `src/core/types.ts` `Task`: add
  - `parentTaskId?: string` — "The task this one is a step of: the
    checkbox it is indented under."
  - `steps?: TaskSteps` where
    `interface TaskSteps { ids: string[]; total: number; done: number; next?: string; }`
    — direct steps only, in source order; `next` is the first open step's
    title.
  Both absent when not applicable, so every other task keeps its shape
  (`omitUndefined`).
- `src/core/markdown/parser.ts` `findTasks`: turn the `flatMap` into a
  loop keeping a list stack `{ width, taskId?, taskIndex? }[]`:
  - reset on fenced lines, headings, and unindented non-list, non-blank
    lines; skip blank lines; indented non-list lines (lazy continuation)
    keep the stack;
  - on a list item (`getListItemMatch`, which also matches ordered items)
    of width `w` (tabs to 4): pop while `top.width >= w`; if the item is a
    task and `top?.taskId`, set `parentTaskId`; push the item.
  - after the loop, fill each parent's `steps` from its children.
  Check `normalizeParsedTagReferences` carries the new fields (it spreads
  tasks; confirm).
- No persisted-index migration: the SQLite store keeps only search text
  (`searchDatabase.ts:376`), and tasks are re-parsed on load.
- New `src/core/markdown/taskSteps.ts` (pure, testable):
  - `describeSteps(steps: TaskSteps): string`
  - `isPlainStep(task: Task): boolean` — no `dueAt`, `scheduledAt`,
    `startAt`, `priority`, `assignee`, and no inline tags
    (`associationTagGroups?.[0]` empty).
  - `foldSteps(tasks: readonly Task[]): Task[]` — drops plain steps whose
    `parentTaskId` is in the list.
  - `findStepFamily(lines: string[], lineIndex: number)` →
    `{ parent?: number; steps: number[] }` line indexes, by the same
    indentation rules as the parser (shared `measureIndent`, list-stack
    helper exported from here and used by `findTasks`).
  - `planStepInsertion(lines, taskLineIndex)` →
    `{ afterLine: number; indent: string; marker: '-' | '*' | '+' }`.
  - `formatStepLines(steps: string[], indent, marker): string[]`.
  - `cleanStepText(text): string` and `splitTypedSteps(value): string[]`.
  - `parseSuggestedSteps(reply: string): string[]`.
  - `resetStepLine(line): string` — unchecked, done date removed (uses
    `setTaskLineCompletion(line, column, false, …)` from `taskMetadata.ts`).

### 3.2 Query

- `src/core/query/queryTypes.ts`: `'step'` in `QUERY_IS_VALUES`,
  `'steps'` in `QUERY_HAS_VALUES`.
- `src/core/query/queryParser.ts`: aliases and error strings above.
- `src/core/query/queryEvaluator.ts`: `case 'step'` →
  `unit.task?.parentTaskId !== undefined`; `has` `steps` →
  `(task.steps?.total ?? 0) > 0`. Notes never match either.
- `src/ui/state/dashboardState.ts`: the three completions and the listed
  values string at `:1594`.
- `src/ui/state/assistantTools.ts`: the shorthand guide.

### 3.3 Break into Steps…

- New `src/ui/commands/taskSteps.ts`:
  - `export interface StepSuggester { model(): Promise<{ label: string } | undefined>; suggest(title: string, token: vscode.CancellationToken): Promise<string[]>; }`
  - `createLanguageModelSuggester(log)` — the `vscode.lm` implementation
    (section 3.6). Injected, so tests pass a fake.
  - `breakIntoSteps(task: Task, index: WorkspaceIndex, suggester?)` — the
    quick pick (section 2), returning the steps chosen or `undefined`.
  - `addTaskSteps(task: Task, steps: string[]): Promise<boolean>` — open
    the document, verify the line (same checks as `updateTaskLine`,
    `taskActions.ts:88-100`; extract them into an exported
    `readIndexedTaskLine(document, task)` there so both share it), plan
    the insertion, `edit.insert(uri, end of afterLine, eol + lines.join(eol))`,
    `applyWorkspaceWrite`, then the message with Undo.
  - `breakIntoStepsCommand(indexer, task?)` — resolves the cursor's task
    when none is passed (as `editTaskCommand` does), waits for
    `indexer.ready`, runs the pick, writes.
- `src/extension.ts`: register `deckard.breakIntoSteps` and
  `deckard.agenda.breakIntoSteps` (node → `agenda.tasksFor(node)[0]`).
- `src/ui/commands/taskEditor.ts` `TaskEditorActions.provideCodeActions`:
  return both actions; the second is `Break into steps…` →
  `deckard.breakIntoSteps`.
- `package.json`: two commands (the agenda one `when: false` in the
  palette), `commandPalette` entry gated on `deckard.onTaskLine`,
  `view/item/context` entry, `activationEvents` if the manifest lists
  them explicitly.
- Board, `src/ui/webview/components.ts`:
  - `taskCardMoves`: a `Steps` group with
    `{ value: 'break-steps', label: card.steps ? 'Add steps…' : 'Break into steps…' }`
    before `Done`.
  - `openCardMenu`: `break-steps` posts `{ type: 'breakIntoSteps', taskId }`
    (like `pick-date`).
  - `handleCardKey`: `s` posts the same.
  - `aria-keyshortcuts` gains `s`.
- `src/ui/webview/taskBoardHtml.ts`: key sheet row.
- `src/ui/webview/taskBoard.ts`: `case 'breakIntoSteps'` → look up the
  task, `breakIntoStepsCommand(indexer, task)`.
- `src/ui/webview/messages.ts`: the new message type in the board's
  message union and its validator (the messages test checks every type).
- `src/ui/webview/helpHtml.ts` command table:
  `'deckard.breakIntoSteps': 'Writes steps under the task on the cursor’s line, one for each you type.'`

### 3.4 Progress and folding

- `src/ui/state/taskBoardState.ts`:
  - `createTaskBoard`: `const tasks = foldSteps(selectTasks(index, search.query));`
    (all three layouts and the counts then agree).
  - `TaskBoardCard.steps?: { label: string; next?: string }` from
    `task.steps` via `describeSteps` (split at ` · next: ` in the helper:
    return `{ label, next }` rather than one string, and let
    `describeSteps` join them for the row/tree callers).
- `src/core/types.ts` `DashboardTask.stepsLabel?: string`; set in
  `createDashboardTask` (`dashboardState.ts:1005`).
- `src/ui/webview/components.ts`:
  - `renderTaskBoardCard`: the `.board-steps` line after `.board-details`;
    `cardName` gains the label.
  - `renderTaskListRow`: the `.task-detail` span after `recurrence`.
  - CSS: `.board-steps` muted (`--muted` token pair already used by
    `.board-details`), `white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis;` on the line; no new colors, so no theme
    overrides and contrast inherits the existing pair.
- `src/ui/state/agendaState.ts` `createAgenda`: fold the entries with the
  same rule (`foldSteps` over `options.tasks`), and add the steps text to
  `AgendaEntry.details`. Add `AgendaEntry.steps?: Task[]` (the parent's
  direct steps from `index.tasks`, done and open) for the tree.
- `src/ui/views/agendaTree.ts`:
  - `AgendaNode` gains `{ kind: 'step'; task: Task; parentId: string; uri }`.
  - `createTaskItem`: `Collapsed` when `entry.steps?.length`; tooltip lines.
  - `getChildren(task node)`: its step nodes.
  - `createStepItem`: id `agenda:step:${parentId}:${task.id}`, checkbox
    state from `task.completed`, `contextValue = 'deckardAgendaTask'` so
    every task action applies, command opens the line.
  - `completeTasks`: handle step nodes; `Unchecked` on a step reopens it.
  - `tasksFor`: step nodes map to their task.
  - `handleDrag`: steps are not dragged (unchanged filter keeps `task`
    only; say so in the comment).
- Home's agenda widget reads `createAgenda` and `createDashboardTask`, so it
  folds and shows the label without its own change (verify in
  `dashboardWidgets.ts`).

### 3.5 Completion, recurrence, rollover

- `src/ui/commands/taskActions.ts`:
  - `offerUndo` takes extra actions: `offerUndo(description, …, extra?: { label: string; run: () => Promise<void> })`.
  - `toggleTask`: after `updateTaskLine` succeeds with `completed`, read
    the saved document, `findStepFamily` at the task's line (its line may
    have moved down by one when a next occurrence was written above — use
    the last line of the replacement, as `carryRank` does), and choose the
    message and extra action (section 2). To keep one message, the
    description function and the extra action are decided inside the
    transform from the document's lines (`transform` gets the document
    through a new `lines` field on `TaskLineContext`), not after it.
  - The parent `Task` for **Complete Task** comes from
    `parseMarkdown(filePath, document.getText(), options)` at the parent
    line (the same parse options the indexer uses; read them through the
    existing configuration helpers).
  - Recurrence: in the transform, when `nextOccurrence` exists and
    `TaskLineContext.lines` shows direct steps, return
    `[next, ...steps.map(resetStepLine), replacement].join(eol)`. The
    transform only replaces the task line, so the steps below it are
    untouched and the copies land between the new occurrence and the
    completed one.
- `src/ui/commands/bulkEdit.ts` `rewrite`: unchanged (bulk completion of a
  repeating task keeps today's behavior; noted in the README).
- `src/ui/commands/rollover.ts` `applyRollover`: group carried tasks by
  `parentTaskId`; write each root with its carried descendants, re-indented
  relative to the root; roots that were steps are outdented to the top
  level; move mode also deletes (and carries) the done descendants of a
  moved task; dedupe key is `parent line + step line`. `planRollover`
  unchanged (it lists open tasks; the grouping happens when writing).

### 3.6 Suggest steps

- `createLanguageModelSuggester`:
  - `model()`: `if (!setting) return undefined;
    const [model] = await vscode.lm.selectChatModels();` prefer
    `vendor === 'copilot'` when several; label `${model.name}`.
  - `suggest(title, token)`:
    `model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], { justification }, token)`;
    collect `response.text`; `parseSuggestedSteps`. Timeout via a linked
    `CancellationTokenSource` cancelled after 30 s.
  - Errors mapped by `error instanceof vscode.LanguageModelError` and
    `error.code === vscode.LanguageModelError.NoPermissions.name`.
  - Timing and failure written to Deckard's log (the channel the
    assistant tools use).
- `package.json`: `deckard.tasks.suggestSteps` (boolean, default `true`,
  `markdownDescription` as in section 2, `order` next to the other
  `deckard.tasks.*`).
- Re-check the model list each time the pick opens (models come and go
  with extensions); no cached state.

### Edge cases

- CRLF notes: steps written with `\r\n`; `planStepInsertion` works on
  split lines.
- A task inside a blockquote (`> - [ ] …`) is not a task today; nothing
  changes.
- A task line at the end of the file without a trailing newline: insert
  `eol + steps` after it; the file still ends as it did (no newline).
- The note is open with unsaved edits: `applyWorkspaceWrite` saves it, as
  every Deckard task edit does today.
- Line-number ids: inserting steps shifts the ids of tasks below in the
  same note, as any insertion does; their rank carries only when they
  match again. Same as capture today.
- A parent completed while its steps are open, with no action taken: its
  steps are listed on their own (the parent is no longer listed), which is
  the honest state.
- Steps of a task in a daily note with rollover **copy** mode (or 3h's
  migrate) are carried with it and marked as that piece marks carried
  lines.

## 4. Tests

`npm test` (vscode-test, `src/test/`):

- New `task-steps.test.ts` (pure):
  - parser: `parentTaskId` and `steps` for two-space, four-space, and tab
    indentation; a blank line inside the list keeps the parent; a heading,
    a fence, and an unindented paragraph end it; a checkbox under a plain
    bullet has no parent; grandchildren count only on their own parent;
    `steps.next` is the first open step; a note with no nesting parses to
    exactly the tasks it did before (deep-equal against a snapshot of the
    current output for the `markdown-parser.test.ts` fixtures).
  - `describeSteps` for 0/1/many open and all done.
  - `isPlainStep` and `foldSteps`: dated, prioritized, assigned, and
    tagged steps are kept; plain ones fold only when their parent is in
    the list.
  - `planStepInsertion`: after existing steps and their continuation
    lines, before trailing blanks; indentation from an existing child,
    from the note's other nesting, the two-space default, tabs; marker
    copied; last line of file.
  - `cleanStepText`, `splitTypedSteps`, `parseSuggestedSteps` (numbered,
    bulleted, checkbox, preamble line, 12 lines capped at 10, 200-char
    line cut).
  - `resetStepLine` for emoji and Dataview done dates.
- `query-language.test.ts`: `is:step`, `-is:step`, `has:steps`,
  `no:steps`, aliases, error strings.
- `agenda.test.ts`: plain steps fold under a listed parent, dated steps
  stay listed, a step of a done task is listed; `details` carry the steps
  text; entries carry `steps` for the tree.
- `task-board.test.ts`: `card.steps`; folded cards in board, list, and
  table; counts after folding; the menu's Steps group label switches to
  `Add steps…`.
- `task-editor.test.ts` (it already tests `TaskEditorActions`): two code
  actions on a task line, none elsewhere.
- New `task-steps-commands.test.ts` (temp workspace, as
  `source-commands.test.ts` does): `addTaskSteps` writes the expected
  text; refuses when the line changed; Undo Last Change restores the note;
  `toggleTask` on the last step returns the "last open step" message and
  its action completes the parent; `toggleTask` on a parent with open
  steps offers Complete Steps and it writes one edit; completing a
  repeating task with steps writes unchecked copies between the new and
  the done occurrence, and Undo puts the three ranges back. The quick pick
  is driven with a fake `StepSuggester` and a stubbed `createQuickPick`
  where the suite already stubs pickers (as in `task-editor.test.ts`).
- `rollover.test.ts`: open steps carried nested; move mode takes done
  steps; an orphaned open step is carried at top level; two tasks' equal
  step text both carried.
- `messages-rendering.test.ts`: the board's `breakIntoSteps` message
  validates; `renderTaskListRow` draws the steps span; the board card draws
  `.board-steps` and its aria-label.
- `naming.test.ts` (if it reads command titles): "Break into Steps…"
  passes the title-case rule.
- `extension.test.ts`: both commands registered; every manifest command
  has a Help description (existing check picks up the new one).

`npm run test:e2e` (`test/e2e/taskBoard.e2e.js`):

- A fixture task with one done and two open steps: its card shows
  `1 of 3 steps · next: Draft the email`; its steps have no cards of their
  own; a dated step does.
- The ⋯ menu lists `Break into steps…`/`Add steps…` and choosing it posts
  `breakIntoSteps` with the task id; `s` on a focused card does the same;
  `?` lists `s`.
- `dashboardHome.e2e.js` / `searchPage.e2e.js`: a task row with steps
  shows the steps span (search pages do not fold).

`npm run test:ui`: runs as is (`verifyWebviews`, `checkWebviewScripts`,
`checkContrast`); `.board-steps` reuses the muted pair, so the contrast
baseline does not change. Confirm with the run.

`npm run test:layout`: add steps to the board fixture in
`test/ui/checkLayout.js` `createIndex()` — under the long first task:
`  - [x] Find the market stall` and
  `  - [ ] Draft the report for the precinct before the rain comes back`
— so the layout check covers a card with a long, ellipsized next step
(no horizontal overflow in `.board-cards`, hover does not grow the card).

Visual baselines to re-record (`npm run test:visual -- --update`), in a
separate `test:` commit after the display commit: all 20
`test/ui/visual-baseline/darwin/*-taskBoard.png` (10 themes × zen), since
the fixture gains a steps line. No other surface's fixture has nested
tasks.

Every commit is verified by all four suites' exit codes (`npm test`,
`npm run test:ui`, `npm run test:e2e`, `npm run test:layout`), in a
short-path worktree.

## 5. Docs

- **README**
  - Features table: a row
    `| [Steps](#breaking-a-task-into-steps) | Break a task into steps; its card says how far along it is and what is next. |`
  - Local-first row: `Your Markdown stays the source of truth, and the
    index never leaves your machine; a task's words go to a language model
    only when you choose Suggest steps.`
  - New `### Breaking a task into steps` under **Task metadata** after
    "Editing a whole task": what a step is (the Markdown), the three ways
    in, how steps are written, "2 of 5 steps · next: …", the folding rule
    in one sentence, completion offers, recurrence, rollover.
  - **Tasks view** and **Task board** sections: a task with steps expands /
    its card carries the steps line; `s` in the board keys.
  - **Carrying unfinished tasks forward**: steps travel with their task.
  - **Query language**: `is:step`, `has:steps`, `no:steps`.
  - **AI assistants**: a paragraph "**Suggest steps.**" — what is sent
    (the task's words only), to which model, when (only when chosen),
    VS Code's consent dialog, the preview, `deckard.tasks.suggestSteps`.
  - **Commands** table: `Deckard: Break into Steps…`.
  - **Settings** table and the JSON example: `deckard.tasks.suggestSteps`.
- **Help** (`src/ui/webview/helpHtml.ts`)
  - "Writing tasks": a card **Steps**: `A checkbox indented under a task is
    one of its steps. <strong>Break into Steps…</strong> — on the
    lightbulb, the Tasks view’s menu, and a card’s ⋯ — writes them one per
    line you type, and the task then reads <strong>2 of 5 steps · next:
    Draft the email</strong>. Finishing the last step offers to finish the
    task; nothing is completed for you.`
  - A card **Suggested steps**: `With a VS Code language model installed,
    <strong>Suggest steps</strong> asks it for a list you edit before
    anything is written. Only the task’s words are sent, and only when you
    choose it. <code>deckard.tasks.suggestSteps</code> hides it.`
  - Board keyboard card: `<kbd>s</kbd> breaks it into steps`.
  - Query table row: `is:step`, `has:steps` — "Steps of a task, and tasks
    broken into steps."
  - Command description map entry (3.3).
- **CHANGELOG** `## Unreleased`, `### Added`:
  - **Break a task into steps.** Break into Steps… on the lightbulb, the
    Tasks view, and a board card writes `- [ ]` steps under a task, one per
    line typed. The task then says "2 of 5 steps · next: Draft the email"
    on its card and row, expands in the Tasks view, and finishing its last
    step offers to finish it. Steps written plainly ride on their task
    rather than adding cards of their own, which also tidies boards built
    from existing nested checklists. `is:step` and `has:steps` search them.
  - **Suggest steps**, when a VS Code language model is installed: only
    the task's words are sent, only when chosen, and the steps are shown
    to edit before anything is written. `deckard.tasks.suggestSteps`.
  - `### Changed`: A repeating task's steps come back, unchecked, with its
    next occurrence. Rollover carries a task's open steps under it, and
    never nests a step under the wrong task.
- **docs/components.md**: Task board table — `.board-steps` (muted, one
  line, ellipsized next step; host-worded by `describeSteps`); Task list —
  `renderTaskListRow` draws `stepsLabel`; Host-side helpers —
  `describeSteps`, `foldSteps` and the folding rule.
- **docs/task-steps.md**: this plan, as the design note (first commit).

## 6. Commits

Each is shippable alone and verified by all four suites.

1. `docs: a design note for breaking a task into steps` — this plan as
   `docs/task-steps.md`.
2. `feat: a checkbox under a task is its step, and is:step and has:steps find them`
   — parser, types, `taskSteps.ts` core helpers, query, completions,
   assistant guide, README query rows, Help query row. Nothing visible
   changes elsewhere yet.
3. `feat: Break into Steps… writes a task's steps under it, one per line you type`
   — command, lightbulb, palette, Tasks view menu, board menu and `s`,
   Help/README sections, CHANGELOG entry.
4. `feat: a task says how many of its steps are done and which is next, and its steps ride on its card`
   — board card line, task rows, Tasks view description and expandable
   steps, folding in board and Tasks view, layout fixture, components.md.
5. `test: re-record the board baselines for the steps line` — the 20
   `*-taskBoard.png`.
6. `feat: finishing a task's last step offers to finish the task, and finishing a task offers its open steps`
7. `feat: a repeating task's steps come back, unchecked, with its next occurrence`
   (separate so it can be dropped if David says no — see question 1.)
8. `fix: rollover carries a task's steps with it, and never under another task`
9. `feat: Suggest steps asks a VS Code language model, and shows its steps before anything is written`
   — suggester, setting, README AI paragraph and Local-first row, Help
   card, CHANGELOG entry.

## 7. Size, risks, dependencies, questions

**Size**: about 7 days. Commit 2: 1 d; 3: 1.5 d; 4–5: 1.5 d; 6: 0.75 d;
7: 0.25 d; 8: 0.75 d; 9: 1 d; docs threaded through.

**Risks**

- *Existing nested checklists change on the board and in the Tasks view.*
  Plain nested checkboxes stop being cards of their own. This is the
  feature, but a user who drags nested items around the board will notice;
  the rule keeps any step with a date, priority, person, or tag. CHANGELOG
  says so.
- *Parser cost.* One extra pass-free stack per file; no measurable change
  expected, but check the 5,000-note synthetic workspace from Piece 10.
- *`vscode.lm` availability and consent.* No model → no row. Consent is
  VS Code's dialog on first use; a refusal is handled. The e2e stub has no
  `lm`; tests use a fake suggester, so the real call path is covered only
  by a manual check with Copilot installed.
- *Quick pick paste behavior* differs by VS Code build; handled both ways.
- *Toggle message change* touches the one path every checkbox uses;
  covered by the command tests above, and the message only changes when a
  step family exists.
- *Rollover rewrite* overlaps Piece 1b (dedupe by `sourceLineText`) and
  Piece 3h (`### Carried over`, migrate mode). Land after them, or rebase
  carefully: the grouping here sits naturally inside 3h's writer.

**Dependencies**

- Piece 1b and 3h (rollover) — commit 8 goes after them.
- Piece 1c (task editor Done through `toggleTask`) — once it lands, the
  task editor gets the completion offers for free.
- Piece 3b (Done today group), 3e (Upcoming by day), 3f (board column
  counts and muted overdue) — same files (`agendaTree.ts`,
  `components.ts` board card) and the same 20 board baselines; batch the
  re-record with whichever lands last.
- Piece 3g (`is:available`, `is:waiting`) — same `QUERY_IS_VALUES` list
  and error string; trivial merge.
- Piece 7e (subtler tags in card views) — board baselines again.
- Piece 8a/8b/8c — use `reportFailure` and the shared "note changed"
  string and severities if they land first; the strings above already
  follow 8c's rule (Information when written, Warning when nothing was).

**Open questions for David**

1. **Should a repeating task's steps come back with its next occurrence,
   unchecked?** Recommended yes (a weekly checklist that resets is what a
   routine wants; Obsidian Tasks does not do it, so a vault shared with
   Obsidian would see Deckard add lines Tasks would not). It is commit 7
   alone, so a no drops one commit.
