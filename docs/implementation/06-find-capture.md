# Piece 6 — Find and Capture that remember: implementation plan

Written 2026-09-25 against `dev` at `726d23b` (v1.22.0). Read-only pass; nothing
in the repo was changed.

## 1. Scope

Covers **6a, 6b, 6c, 6d, 6e, 6f, 6g, 6h** from `docs/ux-fifteen-sources-plan.md`.
Piece 1i (Capture `ignoreFocusOut` and the draft) belongs to Piece 1 and is not
repeated here; 6g only defines how a selection and a draft meet.

### What verification found

| Item | Claim in the UX plan | Verified in source | Result |
| --- | --- | --- | --- |
| 6a | Access is only recorded from Deckard's own surfaces | True. `recordSectionAccess` is called from `quickFind.ts:204, 254`, `searchPage.ts:783`, `dashboard.ts:418`, `sidebarNotes.ts:686`, `stats.ts:162`, and nowhere else. Opening a note from the Explorer, Cmd+P, or a link records nothing. | Planned. |
| 6a (found) | — | Access is keyed by **section id**. The id is a hash of `path:line:heading` (`parser.ts:1230-1237`), so it changes whenever a line above the heading is added or removed, and `prune` (`preferences.ts:838-861`) then drops the count. A note you write in daily keeps losing its history. Pins avoided this by storing heading identity (`pinnedNotes.ts`). | Fixed in 6a by carrying access from an old id to the new id of the same heading. No storage migration. |
| 6a (found) | — | Every `PreferencesStore.update` fires `onDidChange`, which refreshes every open search page, the Dashboard, the board, Stats, and the Tasks view (`searchPage.ts:60`, `dashboard.ts:92`, `taskBoard.ts:91`, `stats.ts:31`, `agendaTree.ts:111`). Recording a visit on every note switch would redraw them all. | 6a records visits quietly (see §2). |
| 6b | Empty Find order is recent searches, tags, every saved search, recent notes; no pins | True (`quickFindState.ts:527-581`, `quickFind.ts:336-341`). | Planned. |
| 6c | Row actions are mouse-only | True. Only Tab is bound (`package.json` keybinding `deckard.quickFind.complete`, when `inQuickOpen && deckard.quickFindOpen`). | Planned. |
| 6c | Can an extension keybinding beat VS Code's own Cmd+Enter in a QuickPick? | Checked in the VS Code 1.139.1 bundle in `.vscode-test`. `quickInput.accept` is registered at **weight 200** (WorkbenchContrib) on Enter, with secondaries for Enter plus Alt, Ctrl, Cmd, and Shift, `when: inQuickInput && quickInputType != quickWidget`. So by default Cmd+Enter and Alt+Enter just accept. Keybindings contributed by an extension's manifest are registered at ExternalExtension weight (400), and the keybinding resolver prefers higher weight, which is the same mechanism that lets Deckard's Tab binding work in Find today. A manifest binding with `when: inQuickOpen && deckard.quickFindOpen` therefore wins, and only while Find is open. | Planned, with a manual check on the release VSIX in the commit's verification (the key path cannot be driven from `vscode-test`). |
| 6c (found) | "Open to the side leaves Find open" (README:688) | `openSourceAt(…, beside=true)` calls `showTextDocument` **without** `preserveFocus`, so focus moves into the editor, and a QuickPick without `ignoreFocusOut` hides on focus loss. The README's promise depends on timing at best. | Fixed in 6c: opening beside passes `preserveFocus: true`. |
| 6d | A task found in Find can only be opened | True (`quickFind.ts:317-318`, task rows only get Open beside). | Planned. |
| 6e | Find does not learn | True. | Planned. |
| 6f | No fallback when nothing matches | True. There is a **Create note** row (`quickFind.ts:343-356`), no capture. | Planned. See the "partial" note in §2. |
| 6g | Capture forgets its last heading | True (`capture.ts:364-394`, sorted by `updatedAt` only). | Planned. |
| 6g (found) | — | **Capture Under a Heading** inserts at `section.endLine`, which includes nested headings (`capture.ts:79-90` → `getCaptureInsertion` → `endLine`), so a capture under `## Next` lands at the end of its last `### …` child. `Section.bodyEndLine` exists for exactly this. | Fixed in 6g: capture and Move go under the heading's own lines. |
| 6g | Neither Find nor Capture reads the selection | True (`quickFind.ts:75`, `capture.ts:266-362`). | Planned. |
| 6h | Nothing moves a line into another note; Extract refuses untagged headings | True (`extractHeading.ts:43`, `:83`, `:160`). | Planned. |
| 6h (found) | — | A `- [>]` line is not a task to the index (`parser.ts:52` matches `[ xX]` only), **but** a tagged `- [>] … #project/atlas` list item becomes an *inline tagged entry* (`findInlineSections`, `parser.ts:1244-1290`) and lends its tags to its heading's `bodyTags` (`foldTaggedLines`, `parser.ts:1164-1203`). So the line left behind would show up on the tag's page as a note, and the source heading would still match `#project/atlas`. | 6h makes the parser skip `[>]` lines for inline entries. Piece 3h (migrate) writes the same form and gets the same fix; whichever lands first adds it. |

Nothing was dropped.

## 2. Design

### 6a. A note counts as opened when it stays open

- A new `NoteVisits` recorder (`src/ui/commands/noteVisits.ts`) listens to
  `window.onDidChangeActiveTextEditor` and `window.onDidChangeWindowState`.
- When the active editor shows an indexed note (`indexer.isNotesFile(uri)` and
  the file is in the snapshot) it starts a **1,500 ms** timer. If the same
  document is still the active editor and the window is focused when it fires,
  it records a visit. Switching away first cancels it. Diff editors, `git:`
  and other non-file schemes, and output panes never count, because only the
  active *text* editor of an indexed file does.
- **What is recorded:** the innermost heading section containing the cursor
  at that moment; above every heading (a fresh open from the Explorer puts the
  cursor on line 1, often front matter), the note's first heading. A note with
  no headings is not recorded. It never was, because a headingless file has no
  section id (`quickFindState.ts:267-282`). This is left as it is (see §7).
- **No double counting.** A section recorded in the last **10 minutes**, from
  anywhere, is not recorded again. Find, a search page, or Home record at once
  on open, and the dwell that follows is then a no-op. Flipping between two
  tabs also no longer counts each flip.
- **Quiet write.** `PreferencesStore.recordSectionAccess(id, now, { quiet: true })`
  persists without firing `onDidChange`. It fires a new, narrower
  `onDidRecordVisit` event instead. Only the Dashboard listens to it, and only
  to redraw Home when Home is visible and has a **Recently opened** widget.
  Find, `[[` completion, and Related Notes read preferences each time they are
  asked, so they are current without an event. Explicit opens from Deckard's
  pages keep the loud write they have today.
- **Access follows its heading.** On every `indexer.onDidUpdate`, before
  `prune`, a pure `carrySectionIds(previous, next)` maps each old section id
  that disappeared to the new id of the same heading in the same file. It
  matches by heading text, level, and occurrence, as `findPinnedSection`
  does. `PreferencesStore.carrySectionAccess(map)` moves counts and times
  (summing when both exist) in one quiet write. Then prune runs as today.
- No setting. It is how "Recently opened" already reads to a user. README says
  where the history lives, as it does today.

### 6b. Empty Find

Order, each group only when it has rows:

1. **Pinned**: every pin, in pin order, resolved with `resolvePin`, at most
   **10**. Icon `$(pinned)`, description `Pinned · <file name>`. A pin whose
   heading is gone still lists, as Home does, with detail `heading not found`.
2. **Recently opened**: the **5** most recently opened sections not already
   listed under Pinned.
3. **Recent searches**: **5**.
4. **Saved searches**: all of them. Separator label stays `Saved searches`.
5. **Tags**: favorites and frecent tags, **8** as today.

Typed Find keeps its current order: Complete, Tags, Saved searches, Notes,
Tasks.

### 6c. Keys inside Find

| Key (mac / others) | Command id (hidden from palette) | On a note row | On a task row | On any other row |
| --- | --- | --- | --- | --- |
| `cmd+enter` / `ctrl+enter` | `deckard.quickFind.openBeside` | Opens it beside, `preserveFocus: true`; Find stays open | Same | Same as Enter |
| `alt+enter` | `deckard.quickFind.insertLink` | Inserts `[[Note#Heading]]` at the cursor, closes Find | Inserts a link to the heading the task is under | Nothing |
| `cmd+.` / `ctrl+.` | `deckard.quickFind.actions` | The action list (6d) | The action list | The action list |

All three are bound with `"when": "inQuickOpen && deckard.quickFindOpen"`, as
Tab is. Titles, which Help's command table shows with their keys:
`Open Beside in Find`, `Insert a Link from Find`, `Show Actions in Find`.

Tooltips carry the key, written the way VS Code writes it on each platform
(`⌘`/`⌥` on macOS, `Ctrl+`/`Alt+` elsewhere), through one helper
`keyLabel('cmd+enter')`:

- `Open to the side (⌘Enter)` / `Open to the side (Ctrl+Enter)`
- `Insert a link to it at the cursor (⌥Enter)` / `(Alt+Enter)`
- `Add to the search (Tab)` (unchanged)
- Placeholder: `Words, #tags, is:open, in:folder… Tab completes, Enter opens, ⌘. for more`
  (`Ctrl+.` elsewhere).

Opening beside, from the button or the key, now passes `preserveFocus: true`
(new optional parameter on `openSourceAt`). That makes the "stays open"
promise true.

### 6d. Task actions and the action list

**Row buttons on a task:** `Open to the side (⌘Enter)`, then `$(check)`
**Complete** (`Complete this task`), or `$(circle-large-outline)` `Reopen this task`
on a completed one, then `$(calendar)` **Set due** (`Set its due date`).

- **Complete** calls `toggleTask`. The existing notification with Undo says
  what happened, and a repeat's next occurrence is written as everywhere else.
  Find stays open. While Find is open it listens to `indexer.onDidUpdate` and
  redraws, keeping the active row by its key (see 6e keys) and scroll
  position (`keepScrollPosition = true`). The row turns into a completed task
  without the list jumping.
- **Set due** opens the reschedule list: `Today`, `Tomorrow`, `Next Monday`
  (Piece 2's rename; `Next week` until then), `A date…`, `No due date`. Its
  title is `Due date for "Call Ren about the budget"`. It reuses
  `pickReschedule` with a `title` option. Choosing writes via `setTasksDue`.
  **Escape**, and the end of either choice, reopens Find with the same text
  and the same row active.

**`cmd+.`: every action for the active row**, as a second QuickPick titled
`Actions for "…"` (the row's label, cut at 60 characters as
`quoteTaskTitle` does), with separators and each row's key in its
description:

- Note row
  - *Open*: `Open` (`Enter`), `Open to the side` (`⌘Enter`)
  - *Link*: `Insert a link at the cursor` (`⌥Enter`), `Copy a link` (writes `[[Note#Heading]]` to the clipboard; says `Copied [[Project Atlas#Next]].`)
  - *Home*: `Pin to Home` / `Unpin from Home` (`setPinned`)
- Task row
  - *Open*: `Open`, `Open to the side`, `Edit task…`
  - *Task*: `Complete` / `Reopen`, `Due today`, `Due tomorrow`, `Due on a date…`, `No due date`
  - *Move*: `Move to…` (6h)
  - *Link*: `Insert a link to its heading` (`⌥Enter`)
- Tag row: `Open its page` (`Enter`), `Add to the search` (`Tab`), `Add to favorites` / `Remove from favorites`, `Rename tag…` (runs `deckard.renameTag` with the tag)
- Recent search row: `Search for it` (`Enter`), `Save search` (Piece 8's wording; `Save as a view` until it lands), `Remove from recent searches`
- Saved search row: `Open`, `Put its search in the box` (`Tab`)

**Escape** in the action list reopens Find with its text and active row.
An action that stays in place (Complete, a due date, pin, favorite, remove,
copy) also returns to Find. One that goes somewhere (Open, a tag page, Edit
task, Move to…) closes it.

New `PreferencesStore.removeRecentQuery(query)`.

### 6e. Find learns what you pick

- **What is kept:** `findChoices: FindChoice[]` in the workspace's share of
  preferences, `{ input, key, count, at }`. `input` is the typed search,
  trimmed, lowercased, whitespace collapsed, at most 100 characters. At most
  **200** entries; the least recently used goes first.
- **Recorded** whenever a result is opened, opened beside, linked, or acted on
  from the action list, and something was typed. Recent-search and condition
  rows are not results and record nothing.
- **Keys**, stable across edits above a heading:
  - note: `note:` + `pinKey(createPinForLine(…))`, meaning file, heading text, occurrence
  - task: `task:` + JSON `[filePath, title without tags or metadata]`
  - tag: `tag:` + tag key
  - saved search: `view:` + filter id
- **Matched** as Firefox's adaptive history does: a stored `input` counts
  toward what is typed now when it **starts with** what is typed now. Having
  picked *Vendor contract* after typing `vend` lifts it for `v`, `ve`, and
  `ven`. Each key's weight is `Σ count × 0.5^(ageDays / 30)`.
- **Bonus** for notes and tasks: `min(1500, 500 × weight)`, added to the
  score, and then any entry that is not an exact title is clamped below
  `EXACT_TITLE` (3000). So one pick lifts a body-only match past loose
  matches, three picks lift it past titles containing every word, and
  **nothing learned ever beats an exact title**. Tags get
  `min(150, 50 × weight)` inside their own group.
- Pruned with everything else: entries whose file or tag no longer exists go
  on the next index update. No setting. Help and README say it is kept in
  VS Code's preferences, never in the notes.

### 6f. Capture what Find could not find

- A last row, after **Create note**, before **Show all**:
  `$(inbox) Capture “Call Ren friday p2” to today’s note`, with the line it
  will write as its detail, `- [ ] Call Ren ⏫ 📅 2026-10-02`, read exactly as
  Capture reads it (`writeCapture`, now exported as `formatCapture(text)`).
- **When:** the search has at least one plain word and only words, `#tags`,
  and `@people` otherwise (no `is:`, `in:`, `due`, OR, NOT, or parentheses),
  **and** either nothing matched or no entry had every word (the "No entry has
  every word" state). The second half matters. Full-text search nearly always
  finds a note with *some* of the words of a sentence, so "nothing matched"
  alone would almost never show the row.
- Enter on it calls `captureToToday(text, line)`: the same note, the same
  placement, the same `Added it to 2026-09-25.md.` message with **Open**.
  The typed text is recorded as a recent search only if it was not captured.

### 6g. Capture remembers headings; Find and Capture start from the selection

**Remembered headings**

- `recentHeadings: PinnedNote[]` (file, heading, level, occurrence) in the
  workspace's preferences, newest first, at most **5**. Written by Capture
  Under a Heading and by Move to… (6h) when they succeed.
- The heading list gains a **Recent** group at the top with those headings,
  resolved with `findPinnedSection`, so a heading that moved is still found.
  The last one is the active row, so Enter repeats it. Then **All headings**,
  ordered by how often and how lately each note was opened (6a's frecency),
  then by `updatedAt` as today. Unresolvable entries are skipped, and pruned
  when their file goes.
- The list is one shared `pickDestination` (see 6h) with Capture's title
  `Deckard: Capture Under a Heading` and placeholder
  `Choose the heading to add it under`.
- Capture and Move insert **under the heading's own lines**, meaning after its
  last list item or last line of text before any sub-heading
  (`bodyEndLine`), and no longer at the end of its last sub-heading. This is
  a behavior fix, noted in the CHANGELOG.

**Seeding from the selection**

- A **short single-line selection** is 1–120 characters, on one line, and not
  only whitespace, in any text editor. Longer or multi-line selections are
  ignored; Move to… is for those.
- **Find** opened with no argument starts with the selection as its search,
  all of it selected (`valueSelection` left undefined), so typing replaces it.
  An argument from a command, such as a tag, still wins.
- **Capture** starts with the selection as the text, all selected. When the
  selection is in an indexed note, the capture **links back**: the written
  line gets ` [[Source#Heading]]` after the words and before any metadata, so
  `Call Ren friday` from `Weekly review` writes
  `- [ ] Call Ren [[2026-09-22#Weekly review]] 📅 2026-10-02`. The link is
  built by `createWikiLink` and inserted into the description with
  `parseTaskDraft`/`formatTaskDraft`, so Tasks metadata stays last. The
  preview detail line shows it before anything is written. A title-bar
  button toggles it. While the link is on, the button is `$(close)` with the
  tooltip `Don’t link back to where this came from`. While it is off, the
  button is `$(link)` with `Link back to where this came from`. It is not
  remembered between captures.
- **Selection and draft (Piece 1i):** 01-bugs.md says the draft wins. This
  plan does it the other way: **a selection wins**, and the draft is kept for
  the next capture opened without a selection. Selecting words and pressing
  Capture is the more recent and more explicit intent. A draft from an hour
  ago replacing them would look like a bug. This is a coordination note
  between the two plans, not a question for David. Whichever lands second
  applies it.

### 6h. `Deckard: Move to…`

**What moves** (the *block*), read from the live document:

- **A selection:** every line it touches. A selection ending at column 0 does
  not take that line. If its last top-level line is a list item, that item's
  nested children come too (`findListItemEndLine` semantics), so a child is
  never orphaned onto the item above.
- **No selection, cursor on a list item or task:** that item and its nested
  children, meaning lines indented deeper, including blank lines between them.
  Trailing blank lines are not taken.
- **No selection, cursor on a line of prose:** that one line.
- **Refused, with nothing written:**
  - cursor on a heading → `Move to… moves lines and tasks. To move a heading and everything under it, use Extract Heading.` with a button **Extract Heading**
  - a blank line → `Put the cursor on the line to move, or select the lines.`
  - lines of front matter → `Front matter stays with its note. Select the lines below it.`
  - a selection that starts or ends inside a code block → `The selection ends inside a code block. Select the whole block to move it.`
  - a file that is not an indexed note → the command is not offered (palette `when`, lightbulb check).

**Where it goes**, from `pickDestination` (title `Deckard: Move to…`,
placeholder `Choose where it goes: a heading, today’s note, or a new note`):

1. `$(new-file) New note…`
2. `$(calendar) Today’s note`, described with its file name, created from
   the template when missing (`ensureDailyNote`)
3. **Recent**: the 5 remembered headings (6g)
4. **Headings**: every heading, ordered as in 6g, each with description
   `<file>` and detail = its heading path. Excluded: headings inside the
   block, and the heading whose own lines already hold the block.

**New note…** asks `Name the new note`, prefilled with the first eight words
of the block's first line, without tags, metadata, or list marker, validated
by `validateExtractedNoteName` and, asynchronously, `A note called “X”
already exists.`. The note is created in the notes folder as
`# X` + blank line + the block.

**The write.** One `WorkspaceEdit`, applied with `applyWorkspaceWrite`:

- **Checked:** after the destination is chosen, the source lines are read
  again and must equal what was read at the start. The target heading is found
  again in the target's live text with `findSameSection`. If either fails,
  nothing is written:
  `Deckard did not move it: the lines changed while you were choosing where.` or
  `Deckard did not move it: the heading “Next” is no longer in Project Atlas.md.`
  From an indexed `Task` (Tasks view, board, Find), the line must also equal
  `task.sourceLineText`, as `updateTaskLine` requires.
- **Moved text:** the block with its common leading indentation removed. The
  first line's exact whitespace prefix is removed from each line that has it,
  and lines are otherwise untouched. It is written with the target's line
  ending, placed as Capture places a line under that heading (`getCaptureInsertion`
  with `bodyEndLine`), or at the end of today's note.
- **What is left behind** (setting `deckard.moveTo.leaveBehind`):
  - `link` (default):
    - If every top-level item of the block is an **open task**, each becomes
      `- [>] <its line as written> → [[Target#Heading]]`: the checkbox
      character is replaced by `>`, the rest of the line is kept verbatim,
      metadata included, and ` → <link>` is appended. Its nested children leave
      with it. Today's note links as the day: `→ [[2026-09-25]]`, the form
      Piece 3h uses.
    - Anything else (prose, bullets, completed tasks, a mix) is replaced by
      **one line**: the link at the block's indentation, with `- ` when the
      block began with a list item: `- [[Target#Heading]]` or
      `[[Target#Heading]]`. This is what Extract leaves.
  - `nothing`: the lines are taken out.
- **One note or two:** a move within one note is written as one whole-document
  replace computed in memory, so the delete and insert can never overlap. A
  move between notes is a delete plus an insert, or `createFile` for a new
  note.
- **Preview:** `preview: 'always'` only when `deckard.previewWorkspaceWrites`
  is `always`. Otherwise `never`, as rollover does. The destination the user
  just chose is the review, and a refactor preview on every two-note move
  would be in the way.
- **Undoable, three ways:** the message's **Undo** button; `Deckard: Undo Last
  Change` (the write is remembered); and the editor's own Undo in each open
  note. For a new note, the write's `restore` deletes it if it is unchanged.
  The **Undo** button calls `workspaceWrites.undo()` directly when this move
  is still the last write. Otherwise it says
  `Deckard has changed your notes again since, so use Deckard: Undo Last Change.`.
- **Messages** (info, with **Open** and **Undo**):
  - one task: `Moved "Call Ren about the budget" to Project Atlas › Next.`
  - several tasks: `Moved 3 tasks to Project Atlas › Next.`
  - lines: `Moved 4 lines to Project Atlas › Next.`
  - new note: `Moved 4 lines to a new note, Budget questions.`
  - after Undo: `Put it back.`
- The destination is recorded in `recentHeadings`. For a task moved from the
  index, its board rank is carried to the new line with `carryRank`.

**Where it is offered**

- Palette: `Deckard: Move to…` (`deckard.moveTo`), `when: editorLangId == markdown`.
- Lightbulb: a `refactor.move` code action titled `Move to…` on **task lines
  and non-empty selections** in indexed notes. It is not on every bullet or
  line of prose, which would put a lightbulb on almost every line.
- Tasks view: `Move to…` on a task's context menu (`deckard.agenda.moveTo`,
  group `2_edit` beside Edit Task…). It works on a multi-selection: each task
  and its children leave their own notes and land together, in the order
  listed.
- Task board: the card menu gains a group **Note** with `Move to…`, which
  posts `{ type: 'moveTaskTo', taskId }`. No single key: `m` is already
  "due tomorrow".
- Find: `Move to…` in a task row's action list (6d).

**Extract accepts any heading.** `findTaggedHeadingAtLine` becomes
`findHeadingAtLine` (non-inline, any tags). `extractHeadingNote` drops the
`tags.length === 0` refusal. The workspace picker lists every heading, with
detail `Tags: …` only when it has some. Command title `Extract Heading`
(id unchanged). Picker placeholder `Choose a heading to extract`. Empty
message `There are no headings in your notes yet.`.

**Parser: a forwarded line is a pointer.** In `findInlineSections`, a line
matching `/^\s*[-*+][ \t]+\[>\][ \t]/` is skipped like a task. So a left-behind
`- [>] … #project/atlas → [[…]]` is neither an entry on the tag's page nor a
body tag of its heading. Full-text search still finds it, and it links
forward.

### Settings

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `deckard.moveTo.leaveBehind` | `string` enum `link`, `nothing` | `link` | `What Move to… leaves where the lines were.` enumDescriptions: `A task becomes "- [>] … → [[where it went]]"; anything else becomes a [[link]] to where it went.` / `Nothing: the lines are taken out.` |

No other settings. 6a, 6b, 6e, and 6g are behavior, and the README explains them.

## 3. Implementation steps

### 6a
- `src/ui/commands/noteVisits.ts` (new): `class NoteVisits implements Disposable`
  with `constructor(indexer, preferences, { dwellMs = 1500, repeatMs = 600_000, now })`,
  a timer per activation, `sectionForVisit(file, line)` (exported, pure).
- `src/ui/state/pinnedNotes.ts`: export `findHeadingAt`.
- `src/ui/state/frecency.ts`: `carrySectionIds(previous: WorkspaceIndex, next: WorkspaceIndex): Map<string,string>`
  (pure; groups non-inline sections per file by `[heading, level]` and occurrence).
- `src/core/storage/preferences.ts`: `recordSectionAccess(id, now, options?: { quiet?: boolean })`;
  `carrySectionAccess(map)`; `onDidRecordVisit` emitter; a private `persistQuietly`
  path that reuses the update queue without firing `onDidChange`.
- `src/extension.ts`: construct `NoteVisits`. In the `indexer.onDidUpdate`
  that prunes (`:434-444`), keep the previous snapshot, call
  `carrySectionAccess(carrySectionIds(prev, next))`, then `prune`.
- `src/ui/webview/dashboard.ts`: subscribe to `onDidRecordVisit` and refresh
  when visible and a `recentNotes` widget is on Home.
- Edge cases: the index not ready yet (skip); a file edited during the dwell
  (use the snapshot's sections; the cursor line maps to the nearest heading);
  a window losing focus mid-dwell (cancel); a multi-root path (`getFilePath`).

### 6b
- `quickFindState.ts`: `QuickFindResults.pinned: QuickFindItem[]`. In
  `buildEmptyResults` add pins (`resolvePin`, map to `kind: 'note'`,
  `pinned: true`, `sectionId` of the resolved section if any), recent notes
  limited to 5 and excluding pinned section ids and files pinned whole,
  recent searches limited to 5. Constants `EMPTY_PINNED_LIMIT = 10`,
  `EMPTY_RECENT_LIMIT = 5`.
- `quickFind.ts` `toPickItems`: two group orders, empty vs typed. Pinned rows
  use `$(pinned)`.

### 6c
- `package.json`: three commands (category Deckard, `commandPalette` `when:false`),
  three keybindings with `inQuickOpen && deckard.quickFindOpen`.
- `navigation.ts` `openSourceAt(…, preview, preserveFocus = false)`.
- `quickFind.ts`: public `openBeside()`, `insertLinkFromActive()`,
  `showActions()`. Tooltips and placeholder via `keyLabel()` (new, in
  `quickFind.ts`, reads `process.platform`). Registered in `extension.ts` next to
  `deckard.quickFind.complete`.
- `helpHtml.ts` `COMMAND_NOTES`: entries for the three commands.

### 6d
- `quickFindState.ts` `createTaskItem`: add `taskId` and `sectionId`
  (the heading's, for links; `accept()` must not record task rows as section
  visits, so it records only `kind === 'note'`).
- `quickFind.ts`: `COMPLETE`, `REOPEN`, `SET_DUE` buttons; the resume state
  `{ value, activeKey }` and `reopen()`; `indexer.onDidUpdate` subscription
  while open; `activeKey` restore after `refresh()`.
- `src/ui/commands/quickFindActions.ts` (new): `buildRowActions(item, context)`,
  pure, which returns groups of `{ id, label, description }`; and
  `runRowAction(id, item, deps)`. Kept out of `quickFind.ts` to keep that file
  readable.
- `agendaActions.ts` `pickReschedule(subject, options?: { title?: string })`.
- `preferences.ts` `removeRecentQuery`.
- Edge cases: the task's line changed since indexing (`updateTaskLine`'s
  warning, and Find redraws); a task the index lost (`getTask` undefined →
  `That task is no longer in its note.`); Complete on a repeating task (the
  next occurrence becomes a new row after the redraw).

### 6e
- `types.ts`: `FindChoice`; `PersistedPreferences.findChoices?`.
- `preferences.ts`: `'findChoices'` in `workspacePreferenceKeys`; normalize
  (valid shape, cap 200); `recordFindChoice(input, key, now)`; prune by
  `validFilePaths` and `validTags`.
- `quickFindState.ts`: `normalizeFindInput`, `findChoiceKey(index, item)`,
  `learnedBonuses(index, preferences, input, now): Map<entryId, number>`
  (resolves each matching key to the current section or task id; at most 200
  lookups). Applied in `rankEntries` and `matchTags`, with the clamp below
  `EXACT_TITLE`.
- `quickFind.ts`: record on every result action with a typed input.

### 6f
- `capture.ts`: export `formatCapture(text, { literal?, asNote? })`, which is `writeCapture` renamed.
- `quickFindState.ts`: `QuickFindResults.capture?: { text, line }` when the
  query qualifies (`isCaptureable(node)`: an AND of positive `text contains`
  and `tag` conditions, with at least one text) and `totals === 0 || partial`.
  The state layer takes the formatter as an option (`formatCapture`) so it
  stays free of `vscode`.
- `quickFind.ts`: the row, and `accept()` → `captureToToday`.

### 6g
- `types.ts`/`preferences.ts`: `recentHeadings?: PinnedNote[]` (workspace key,
  normalized with `normalizePinnedNotes` capped at 5, pruned by file),
  `recordRecentHeading(pin)`.
- `src/ui/commands/destinationPicker.ts` (new): `pickDestination(indexer, preferences, options)`,
  which returns `{ kind: 'heading', section, filePath } | { kind: 'today' } | { kind: 'newNote' }`.
  Pure item builder `buildDestinationItems(index, preferences, options)` for tests.
  Capture uses it with `allowToday: false, allowNewNote: false`.
- `capture.ts`: `pickHeading` replaced; `appendCapture(uri, line, section)`
  uses `{ startLine, endLine: bodyEndLine }`; `captureSeed(editor)` returns
  `{ text, link? }`; `withSourceLink(line, link, format)`; the link toggle
  button; records the heading on success.
- `quickFind.ts` `show(initialQuery?)`: when `initialQuery` is undefined, seed
  from `shortSelection(vscode.window.activeTextEditor)`.
- `extension.ts`: `deckard.searchWorkspace` passes `undefined`, not `''`,
  when there is no argument, so the seed applies.

### 6h
- `src/core/markdown/moveLines.ts` (new, pure, no `vscode`):
  - `readMoveBlock(lines, selection): MoveBlock | MoveRefusal`: the range,
    base indent, top-level items, and whether all are open tasks; refusals
    for heading, blank, front matter, and split fence.
  - `forwardTaskLine(line, checkboxColumn, link)` (shared with Piece 3h).
  - `leaveBehind(block, link, mode)`: the replacement lines.
  - `dedent(block)`.
  - `planSameNoteMove(text, block, insertion, replacement)`: the new full text.
- `parser.ts`: export `findListItemEndLine`; add the `[>]` skip in
  `findInlineSections`.
- `src/ui/commands/moveTo.ts` (new): `moveToCommand(indexer, preferences)`
  (from the editor), `moveTasks(indexer, preferences, tasks)` (from the
  index), `MoveToActions` code action provider (`CodeActionKind.RefactorMove`),
  message and Undo handling.
- `extractHeading.ts`: any heading; rename helpers; update the picker.
- `package.json`: `deckard.moveTo` (`Move to…`, icon `$(arrow-right)`),
  `deckard.agenda.moveTo` (`Move to…`), the menu entries, and the setting.
  Rename `Extract Tagged Heading` → `Extract Heading`.
- `extension.ts`: register the commands and `MoveToActions`.
- `components.ts` `taskCardMoves`: the group `Note` → `{ value: 'move-to', label: 'Move to…' }`;
  `openCardMenu` posts `{ type: 'moveTaskTo', taskId }` for it.
- `taskBoard.ts`: case `moveTaskTo` → `moveTasks(…, [task])`.
- Edge cases: CRLF documents; a target note open and dirty (the edit goes
  through its buffer, then it is saved, as Capture does); target = source note
  (whole-text path); a block that is the whole note body; the last line with
  no trailing newline (delete the preceding line break instead, as rollover
  does); tabs versus spaces in indentation (only the first line's exact
  prefix is removed); a task with a block id `^abc` (kept verbatim in the
  moved text; the stub drops it, so an embed resolves to the moved line);
  a multi-root workspace (the new note goes in the source file's folder's
  notes folder).

## 4. Tests

All suites must exit 0: `npm test`, `npm run test:ui`, `npm run test:e2e`,
`npm run test:layout`.

**`npm test`** (VS Code extension host):

- `note-visits.test.ts` (new): with fake timers, a note active 1.5 s records
  its cursor's heading; 1.4 s does not; switching away cancels; a second visit
  within 10 minutes is not counted; above every heading records the first
  heading; a headingless file records nothing; `quiet` does not fire
  `onDidChange` but fires `onDidRecordVisit`.
- `frecency` in `search-memory.test.ts`: `carrySectionIds` maps a heading
  pushed down by a new line to its new id; two same-text headings keep their
  order; a deleted heading maps to nothing. `carrySectionAccess` sums counts
  and keeps the later time.
- `quick-find.test.ts`:
  - 6b: empty Find returns pinned first (pin order), recently opened 5
    excluding pinned, recent searches 5; a pin whose heading is gone lists with
    `heading not found`.
  - 6e: after `recordFindChoice('vend', note B)`, `vend`, `ve`, and `v` put B
    first among non-exact matches; `vendor contract` typed exactly still puts
    the exact title first; a choice 90 days old weighs less; a heading moved
    down still receives its bonus (key is heading identity); cap at 200.
  - 6f: `Call Ren friday p2` with no match yields `capture.line`
    `- [ ] Call Ren ⏫ 📅 <date>`; a partial match also yields it; `is:overdue`
    with no match does not; `#project/atlas budget` does.
  - `toPickItems`: the empty-state group order; tooltips carry `(⌘Enter)`
    on darwin.
- `quick-find-actions.test.ts` (new): `buildRowActions` groups for note,
  task (open/completed), tag (favorite/unfavorite), recent, saved.
- `capture.test.ts`: `getCaptureInsertion` with `bodyEndLine` puts a line
  before a sub-heading; `withSourceLink` puts the link before `📅` and after
  the words, and at the end of a note line; `buildDestinationItems` puts
  Recent first with the last heading first, and skips an unresolvable one.
- `move-lines.test.ts` (new, pure): the cursor on a task with two nested
  children takes three lines; the cursor on a child takes it and its own
  children; a selection ending at column 0 excludes that line; a selection
  whose last item has children extends to them; refusals for heading, blank,
  front matter, split fence; `forwardTaskLine` gives
  `- [>] Call Ren 📅 2026-09-20 → [[2026-09-25]]`; all-open-task blocks leave
  one stub each; mixed blocks leave one `- [[…]]`; prose leaves `[[…]]`;
  `nothing` leaves nothing; dedent with spaces and with tabs; CRLF;
  `planSameNoteMove` up and down in one note.
- `move-to.test.ts` (new, integration in the host with a temp workspace):
  a task moves under another note's heading; both notes are saved; the source
  has the stub; `workspaceWrites.undo()` restores both; the source line
  changed during the pick → nothing written and the message; the heading
  removed → nothing written; a new note is created and removed by Undo;
  the moved task keeps its board rank.
- `markdown-parser.test.ts`: `- [>] … #project/atlas → [[x]]` makes no
  inline entry and adds no body tag; `- [ ]` is unaffected.
- `source-commands.test.ts`: Extract on an untagged heading extracts it;
  `findHeadingAtLine` finds the innermost heading.
- `preferences.test.ts` / `preferences-prune.test.ts`: `findChoices` and
  `recentHeadings` normalize, cap, persist per workspace, and prune by file
  and tag; `removeRecentQuery`.
- `naming.test.ts` already guards the new titles (no "Show", no
  parentheses, no "Deckard" prefix).

**`npm run test:e2e`** (`test/e2e/taskBoard.e2e.js`): the card menu lists a
**Note** group with `Move to…`; choosing it posts `{ type: 'moveTaskTo', taskId }`.
Keyboard: the menu reached from the card's ⋯ with arrows includes it.

**`npm run test:ui`**: `verifyWebviews.js` runs over the board with the new
menu group; no new checks needed. Help's command table gains rows, and
`messages-rendering.test.ts` (npm test) renders Help without error.

**`npm run test:layout`**: no layout change on any page. The menu is closed
in every layout fixture.

**Visual baselines:** none to re-record. Find, Capture, and the destination
picker are native QuickPicks, and the board menu is closed in every
`taskBoard` baseline. Run `npm run test:visual` to confirm.

**Manual, on the packaged VSIX (David runs the release VSIX):**
Cmd+Enter, Alt+Enter, and Cmd+. inside Find on macOS; Ctrl variants on a
Linux or Windows machine if available. Opening beside keeps Find open. The
lightbulb offers Move to… on a task line.

## 5. Docs

**README**
- Commands table: add **Deckard: Move to…** (`Moves the line, task, or
  selection under another heading or into a new note, and leaves a link
  behind.`); rename **Extract Tagged Heading** → **Extract Heading** (`Moves
  a heading section into a newly named note and leaves a [[link]] to it.`).
- *Find* (`:676-690`): the empty-state bullet rewritten, "With nothing typed,
  Find lists your pinned notes, the five notes you opened last, your five
  recent searches, your saved searches, and your favorite and recently
  opened tags."; keys bullet ("<kbd>Cmd</kbd>+<kbd>Enter</kbd> opens a result
  beside the editor and keeps Find open; <kbd>Alt</kbd>+<kbd>Enter</kbd>
  inserts a link to it; <kbd>Cmd</kbd>+<kbd>.</kbd> lists everything a row can
  do. On Windows and Linux, Ctrl for Cmd."); task rows' Complete and Set due;
  the Capture row; the selection seed; the last paragraph extended: "A note
  counts as opened when it stays in the editor for a moment, however it was
  opened. Find also remembers which result you chose for what you typed, and
  offers it higher the next time you type the start of it, though never
  above a note titled exactly what you typed."
- *Quick capture* (`:893-899`): the Recent headings, "under the heading's
  own lines, above any sub-heading", selection seed, and link back.
- *Extracting headings* (`:831-835`): any heading; a new subsection **Moving
  lines and tasks** with the block rules, the destinations, the left-behind
  forms, the setting, and Undo.
- *Settings*: `deckard.moveTo.leaveBehind`.
- *Tasks view* and *Task board*: one line each for Move to….

**Help (`helpHtml.ts`)**
- `COMMAND_NOTES`: `deckard.moveTo` `Moves this line, task, or selection under another heading, leaving a link.`;
  `deckard.agenda.moveTo` `Moves the task under another heading.`;
  `deckard.extractHeading` `Moves a heading and everything under it into a note of its own, leaving a link behind.`;
  the three Find commands (`Opens the highlighted result beside the editor, keeping Find open.`,
  `Links the highlighted result where the cursor was.`,
  `Lists everything the highlighted result can do.`).
- The *Find* card (`:402`): keys, pinned-first, learning. The *Capture* card
  (`:368`): recent headings, selection. The *Extracting a section* card
  (`:472`) becomes *Extracting and moving* with Move to….

**CHANGELOG `## Unreleased`**, under `### Added` / `### Changed`:
- **Find remembers.** A note counts as opened from anywhere …; empty Find
  starts with pinned notes …; Find learns …
- **Find acts without leaving.** Cmd+Enter, Alt+Enter, Cmd+. …; Complete and
  Set due on a task; Capture "…" when nothing matched.
- **Capture remembers its headings and starts from a selection.** Also:
  a capture under a heading now goes above that heading's sub-headings.
- **Move to….** …; Extract takes any heading.
- **Fixed:** opening a Find result to the side kept Find open only sometimes.

**`docs/components.md`**: *Task board* (`:274`) gains one sentence: the card
menu's **Note** group and the `moveTaskTo` message. Nothing else there is
touched, since Find and Capture are not webview components.

## 6. Commits

Each is shippable alone and passes all four suites. Subjects follow the log's
plain-sentence style.

1. `feat: a note counts as opened when it stays open, however it was opened` (6a, with the carried access and the quiet write)
2. `feat: Find with nothing typed starts with pinned notes, then the five opened last` (6b)
3. `feat: Find opens a result beside with Cmd+Enter and links it with Alt+Enter, and each button says its key` (6c, with the preserveFocus fix)
4. `feat: a task in Find can be completed or dated in place, and Cmd+. lists everything a row can do` (6d)
5. `feat: Find learns which result you pick for what you type, and never ranks it above an exact title` (6e)
6. `feat: Find offers to capture what it could not find` (6f)
7. `feat: Capture offers the headings it went under last, and puts a line above a heading's sub-headings` (6g, headings and bodyEndLine)
8. `feat: Find and Capture start from the selected words, and a capture from a note links back to it` (6g, seeding)
9. `feat: Extract Heading takes any heading, not only a tagged one` (6h)
10. `feat: Move to… moves a line, a task, or a selection under another heading, and leaves a link behind` (6h core: pure module, parser `[>]` skip, command, lightbulb, setting)
11. `feat: the Tasks view, the board, and Find move a task with Move to…` (6h surfaces)

Commit 4's Move to… action row lands in commit 11. Each commit carries its
own README, Help, and CHANGELOG lines.

## 7. Size, risks, dependencies, questions

**Size:** 6a 0.75, 6b 0.25, 6c 0.5, 6d 1.25, 6e 1, 6f 0.5, 6g 1, 6h 2.5
(Extract 0.25, core 1.75, surfaces 0.5). **About 7.75 days.**

**Risks**
- *Keybinding precedence* is reasoned from the bundle (weights 200 vs 400)
  and from Tab already working. It cannot be exercised in `vscode-test`. It is
  checked by hand on the VSIX in commit 3. If it ever fails, the buttons still
  work, and nothing else depends on the keys.
- *Visit recording cost*: one quiet `workspaceState` write per note switch at
  most once per 10 minutes per heading. There are no page redraws, apart from
  Home's Recently opened widget.
- *Carrying ids* runs over every section on every index update, a few ms at
  5,000 notes. It walks only files whose section id set changed.
- *`[>]` in Obsidian*: Obsidian Tasks may read a custom `>` status as a task.
  This is shared with Piece 3h and not changed here.
- *Headingless notes* still get no frecency, and so no Recently opened entry.
  That is unchanged from today, and fixing it means keying access by file,
  which is a separate change.
- *Same-note moves* replace the whole document. In an open editor that is
  still one undo step, but the cursor may jump to the top. The command
  restores the cursor to the stub line after the write.

**Dependencies**
- **Piece 2** (2a, 2b): Set due and the Capture row read dates through
  `askForDueDate`/`readCaptureText`, and pick up the new parser for free. Piece 2
  renames `Next week` → `Next Monday` in `pickReschedule`; 6d adds a `title`
  option there, so whoever lands second merges.
- **Piece 2d** adds a date row to `toPickItems`; 6b/6f change the same
  function. Order within the empty and typed layouts is independent.
- **Piece 1i** changes `askForCapture` (ignoreFocusOut, draft). 6g lands after
  it; see the selection-versus-draft note in §2.
- **Piece 3h** writes the same `- [>] … → [[date]]` form: share
  `forwardTaskLine` and the parser skip; whichever lands first adds them.
- **Piece 8e** renames `Save as a view` → `Save search`. 6d's action list uses
  whichever is current.
- **Piece 10b** makes Find open before the index is ready. 6a's recorder and
  6e's lookup must tolerate an empty snapshot, which they do by skipping.
- **Piece 13 (parked notes)** ranks parked entries last in `compareRanked`. 6e's
  bonus is applied before that ordering, and parked still sorts last.

**Open questions for David:** none. The one cross-plan decision, whether a
selection or a restored draft wins in Capture, is resolved above in favor of
the selection, as the more recent intent, and flagged for the Piece 1 plan's
author.
