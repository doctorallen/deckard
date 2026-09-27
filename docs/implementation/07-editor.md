# Piece 7 — The editor as a writing surface: implementation plan

Planned at `726d23b` on `dev` (v1.22.0), 2026-09-25, against
`docs/ux-fifteen-sources-plan.md` and David's decisions of 2026-09-25.
Everything below was checked against the source at that commit.

---

## 1. Scope

Covered: **7a, 7b, 7c, 7d, 7e (reduced), 7f, 7g, 7h**. **7i** gets a design
note only; the plan marks it "Later", so it has no commits here.

### What checking the source found

| Claim | Status | Consequence |
| --- | --- | --- |
| No `editor/title`, `editor/context`, `explorer/context`, `file/newFile`, `grammars`, `colors` (`package.json:403-614`) | **True.** `menus` holds only `commandPalette`, `view/title`, and `view/item/context`. | Planned as written. |
| Every tag has a 1px box (`tagDecorations.ts:39-46`) | **True.** | 7e changes because of decision 4 (below). |
| `deckard.isDailyNote` context key | **Does not exist.** The only editor keys are `deckard.onTaskLine`, `deckard.activeNotePinned`, `deckard.zenMode`, `deckard.outlineFollowCursor`, `deckard.canUndo`, `deckard.hasNotes`, and `deckard.hasTags`. | 7a adds it, plus `deckard.isNote`. |
| Daily notes have no previous/next navigation | **Partly wrong.** The first line already has **‹ 2026-09-21** and **2026-09-23 ›** lenses (`editorLenses.ts:236-257`, `deckard.editor.dailyNoteActions`). | The title-bar arrows still go in. They show when CodeLens is off, and they don't scroll away. The lenses stay as they are. |
| "Move to…" in the editor submenu | **The command doesn't exist.** It is Piece 6h. | The submenu gets a `3_move` group now, and 6h adds its entry there when it lands. |
| 1d: an unreadable 🔁 rule is "dropped without a word" | **Partly stale.** `toggleTask` already shows a warning (`taskActions.ts:269-273`). Bulk edit and the task editor's Done don't. | Piece 1 owns the message. 7f adds the diagnostic that warns *before* completion. |
| The task editor accepts any repeat rule | **False.** It already checks with `parseRecurrence` and warns (`taskEditor.ts:288-293`). | 7f only adds the suggestion to that warning. |
| The Outline shows no counts | **True.** The tree's `description` is tags only (`outlineTree.ts:113-118`). | 7h adds counts. |
| Status bar setting | `deckard.statusBar` is a **boolean leaf**, so `deckard.statusBar.wordCount` can't sit under it. | The word count gets no setting. VS Code already lets you hide any status-bar item from its context menu, and the item has an id and a name for that. |
| `activeWebviewPanelId` works for extension panels | **Verified.** The built-in Markdown extension uses `activeWebviewPanelId == 'markdown.preview'` (VS Code 1.139 manifest). The value is the raw `viewType`. | Deckard panels use `deckard.dashboard`, `deckard.tagOverview`, `deckard.stats`, `deckard.help`, `deckard.notesGraph`, `deckard.taskBoard`, and `deckard.relatedNotesDebug`. So `activeWebviewPanelId =~ /^deckard\./` covers all of them. |

### Changed by decision 4 (7e)

The editor keeps the box as its default. I considered dropping 7e and kept a
**reduced opt-in** instead:

- `deckard.editor.tagStyle` has two values, `box` (the default and today's look) and `text`.
- `quiet` is dropped. It was "zen's choice", and making zen restyle tags would change the editor David just decided should keep its box.
- Zen doesn't touch tag style.

It costs about 30 lines. It answers the one complaint two sources raised (three
boxes on one line of prose) without changing anything for anyone who doesn't
opt in. It's the last commit and can be dropped without affecting anything
else.

### Other scope choices

- **No `deckard.editor.titleBarButtons` setting.** VS Code lets you hide any editor title action with right-click → Hide, so a setting would repeat that.
- **The Outline's done/total** is listed under 7f in the source plan. It moves to 7h, because it is Outline work.
- **7i (writing focus, `[markdown]` prose walkthrough step)** is deferred. See §7.

---

## 2. Design

### 7a. Title bar, quick pick, and the editor context menu

**Context keys** (new `ActiveNoteContext` in `src/ui/commands/activeNoteContext.ts`):

- `deckard.isNote`: the active editor is a `.md` file that `indexer.isNotesFile` accepts.
- `deckard.isDailyNote`: that file is a daily note, by the rule `listDailyNotes` uses (`findDailyNoteDate(filePath, H1 headings)`).

**Title-bar buttons** in a Markdown note (`editor/title`, group `navigation`):

| Command | Icon | Shown when |
| --- | --- | --- |
| `deckard.previousDailyNote` | `$(chevron-left)` | `resourceLangId == markdown && deckard.isDailyNote` (`navigation@10`) |
| `deckard.nextDailyNote` | `$(chevron-right)` | the same (`navigation@11`) |
| `deckard.noteActions` (new) | `resources/editor/deckard-{light,dark}.svg` (a 16px stroked glyph, like `resources/views/*.svg`) | `resourceLangId == markdown && deckard.isNote` (`navigation@12`) |

**Note Actions** is new: `deckard.noteActions`, title **Note Actions…**, category Deckard.

- The title can't start with "Deckard" because `naming.test.ts` forbids it. The palette shows it as "Deckard: Note Actions…".
- It opens a quick pick. The title is the note's name and the placeholder is **Choose what to do with this note**.
- Items appear in this order, each only where it applies:
  - `$(check) Toggle Task Done`: on a task line.
  - `$(edit) Edit Task…` on a task line, or `$(add) Add Task…` elsewhere.
  - `$(references) Open Related Notes`, with the detail **For the heading the cursor is in** when the cursor is in a tagged entry.
    - With the detail, it runs `deckard.showEntryRelatedNotes(uri, line)`.
    - Without it, it runs `deckard.relatedNotes.focus`.
  - `$(type-hierarchy) Open Notes Graph Around This Note`
  - `$(target) Focus Section`: under a heading (7h).
  - `$(pin) Pin Note to Home`, or `$(pinned) Unpin Note from Home` (reads `preferences.isPinned` the way `ActivePinContext` does).

**Open Notes Graph Around This Note** is new: `deckard.showNotesGraphAroundNote`, category Deckard.

- The palette shows it when `editorLangId == markdown && deckard.isNote`.
- It opens the graph local, one hop out, around this note.
- It does **not** set `scopeChosen`, so the graph's next plain opening keeps its current default.

**Zen in page title bars** (`editor/title`):

- `deckard.enableZenMode` shows when `activeWebviewPanelId =~ /^deckard\./ && !deckard.zenMode` (`navigation@90`).
- `deckard.disableZenMode` shows when `activeWebviewPanelId =~ /^deckard\./ && deckard.zenMode`.
- Both keep their existing titles and icons, **Enter Zen Mode** / **Leave Zen Mode**.

**Editor context submenu**:

- `contributes.submenus`: `{ "id": "deckard.editor.context", "label": "Deckard" }`.
- It goes in `editor/context` with `"when": "resourceLangId == markdown && deckard.isNote"` and `"group": "z_deckard@1"`.
- Groups and items:
  - `1_task`: **Toggle Task Done** (`deckard.onTaskLine`); **Edit Task** (`deckard.onTaskLine`); **Add Task** (`!deckard.onTaskLine`)
  - `2_heading`: **Rename Heading**; **Extract Tagged Heading**; **Focus Section** (7h)
  - `3_move`: empty until 6h's **Move to…**
  - `4_pin`: **Pin Note to Home** (`!deckard.activeNotePinned`); **Unpin Note from Home** (`deckard.activeNotePinned`)

### 7b. Toggle Task Done

Command `deckard.toggleTaskDone`, title **Toggle Task Done**, category Deckard.

- **Palette:** shown when `editorLangId == markdown && deckard.onTaskLine`.
- **Keybinding:** `cmd+shift+alt+x` on macOS, `ctrl+shift+alt+x` elsewhere, when `editorTextFocus && editorLangId == markdown && deckard.onTaskLine`.
  - It follows Deckard's existing ⌘⇧⌥ family: F, C, D, T.
  - X is for the mark it writes.
  - It doesn't clash with VS Code's defaults, or with Markdown All in One's `alt+c`.

Behavior:

- **Which tasks:** every task line touched by any selection, so multiple cursors and multi-line selections work.
- **Toggle rule:** if any of them is open, every open one is completed. Otherwise every one is reopened, the way Toggle Line Comment decides.
- **How it writes:**
  - Each line goes through the pure completion transform Piece 1c extracts from `toggleTask`. It writes the ✅ date per `deckard.tasks.addDoneDate` and the next occurrence above per the repeat rule.
  - It writes with **one `editor.edit`**. That is one Undo, it works on unsaved notes, and it doesn't need the index.
  - The rank keeper is told about each rewritten line (it is exported from `taskActions.ts` as `carryTaskRank`).
- **Messages:**
  - After a write, `setStatusBarMessage` for 5 s: **Completed "Send proposal".** / **Completed "Send proposal", and started the next one, due 2026-10-02.** / **Reopened "Send proposal".** / **Completed 3 tasks.**
  - An unreadable rule uses Piece 1d's message.
  - With no task under any cursor (the keybinding can't fire then, but the palette and menus can): an info message, **Put the cursor on a task to mark it done.**

### 7c. Explorer submenu and New File

- **Explorer submenu:** `contributes.submenus`: `{ "id": "deckard.explorer.context", "label": "Deckard" }`, in `explorer/context` with `"when": "explorerResourceIsFolder"` and `"group": "z_deckard@1"`.
- **Its items** (none of them in the palette):

| Command | Title | `when` |
| --- | --- | --- |
| `deckard.newNoteFromTemplateHere` | **New Note from Template Here…** | always |
| `deckard.excludeFromIndex` | **Exclude from Deckard** | `resourcePath not in deckard.excludedFolders` |
| `deckard.includeInIndex` | **Include in Deckard** | `resourcePath in deckard.excludedFolders` |

- **`deckard.excludedFolders`:** an array of the absolute `fsPath`s of folders that have an exact `true` key in their workspace folder's `deckard.exclude`. It is republished whenever the configuration changes.
  - A folder that a glob, `files.exclude`, or `search.exclude` (Piece 1f) leaves out has no **Include** entry. There's no exact key to remove for those.
- **Exclude** writes `"<folder relative to its workspace folder>": true` into `deckard.exclude`.
  - It writes at the workspace-folder target in a multi-root workspace, and at the workspace target otherwise, through `writeSetting`.
  - The indexer already rescans on `deckard.exclude` (`indexer.ts:304`).
  - Then an info message, **Deckard leaves out archive/2019 now.**, with **Undo**. Undo removes the key.
- **Include** removes the key. Info message: **Deckard indexes archive/2019 again.**
- **Refusals** (info messages):
  - A workspace folder or the notes folder itself: **Deckard cannot leave out the whole notes folder. Choose a folder inside it, or change deckard.notesFolder.**
  - A folder outside the notes folder: **Deckard does not index archive/2019: it is outside deckard.notesFolder.**
  - The templates folder: **Deckard already leaves the templates folder out.**
- **New Note from Template Here…** is the existing flow, but it writes into the clicked folder.
  - If that folder is outside what Deckard indexes, it says so after creating the note: **Deckard does not index archive, so it will not list this note.**
- **`file/newFile`:** `deckard.createDailyNote` and `deckard.newNoteFromTemplate`, group `file`, `when` `workspaceFolderCount > 0`. They appear in File → New File… and on the Welcome page under their existing titles.

### 7d. Injection grammar

**Contribution:**
- `contributes.grammars`: `{ "scopeName": "markdown.deckard.injection", "path": "./syntaxes/deckard.injection.tmLanguage.json", "injectTo": ["text.html.markdown"] }`
- `injectionSelector`: `L:text.html.markdown -markup.fenced_code -markup.inline.raw -markup.raw -meta.embedded.block.frontmatter -comment`
- `L:` puts it ahead of Markdown's own link rules, so `[[x]]` isn't read as a reference link `[x]`.

**Scopes.** These are standard scope roots, so every theme colors them. Nothing new has to be themed.

| Text | Scope |
| --- | --- |
| `!` of an embed | `punctuation.definition.link.embed.deckard` |
| `[[` / `]]` | `punctuation.definition.link.begin/end.deckard` (under `meta.link.wiki.deckard`) |
| note name, `#Heading`, `#^id` | `string.other.link.title.markdown.deckard` |
| `\|alias` | `string.other.link.description.markdown.deckard` |
| date after 📅 📆 🗓 ⏳ ⌛ 🛫 ➕ ✅ ❌ | `constant.numeric.date.<due\|scheduled\|start\|created\|done\|cancelled>.deckard` |
| Dataview key in `[due:: …]`, `(repeat:: …)` | `entity.other.attribute-name.deckard` |
| Dataview date value | the date scope above |
| rule after 🔁, or in `[repeat:: …]` | `string.other.repeat.deckard` |
| `[priority:: high]` value | `constant.language.priority.deckard` |
| priority emoji | `keyword.other.priority.deckard` |
| trailing `^block-id` | `variable.other.block-id.deckard` |

**What it can't do, stated honestly:**
- Emoji draw in their own colors, so the grammar colors the **text** after a marker, not the marker itself. 7f's dimming is what quiets the emoji.
- Tags are left out. Coloring a tag's text inside its box would change the look decision 4 kept.
- Emoji go in alternations, not character classes. They are astral, and a class would split their surrogates.

**Where it applies:** every Markdown file, not only notes. Grammars can't be scoped to a folder, and coloring a `[[link]]` in a README is harmless. The README says how to turn a color off with `editor.tokenColorCustomizations`.

### 7e. Tag style (opt-in)

`deckard.editor.tagStyle`:
- Type: string, enum `["box", "text"]`, default `"box"`, scope `resource`, order 11.
- enumDescriptions:
  - `box`: "A thin box in the link color around each tag, as Deckard has always drawn it."
  - `text`: "The tag's words in the link color, with no box: quieter on a line of prose."
- description: "How a tag is drawn in the editor. Either way, Cmd/Ctrl-click opens its page and hovering it offers Rename."

### 7f. Task lines: dimming, due hints, repeat rules

**Dimming.** On a task line, every metadata token is drawn at **`opacity: 0.7`**, and so is a trailing `^block-id` on any line. The tokens are the dates, the priority emoji, 🔁 and its rule, 🆔, ⛔, 👤, 🏁, and Dataview fields in `[…::…]` and `(…::…)`.

- 0.7 is the lowest value that keeps AA contrast on Light Modern: `#3B3B3B` over white at 0.7 is `#767676`, 4.54:1. Dark Modern stays at about 6:1.
- An **overdue due date on an open task is never dimmed**. It is drawn in `deckard.overdueForeground` instead.
- Tags stay as they are.

**Due hints.** After-text at the end of an open task's line. At most one per line, italic, with a `1.5em` left margin. The wording comes from `describeDueDate(...).relative`:

| Case | Text | Color |
| --- | --- | --- |
| due before today, ≤ 30 days | `overdue 5 days` / `overdue 1 day` | `deckard.overdueForeground` |
| due more than 30 days ago (Piece 3, decision 1) | `needs a new date` | `deckard.taskHintForeground` |
| due today | `due today` | `deckard.taskHintForeground` |
| otherwise | none | |

- A task past 30 days also has its due date **not** colored red, which matches Piece 3's neutral "Needs a new date" group.
- The 30 is Piece 3's threshold constant. If Piece 3 hasn't landed, the constant is defined in `taskMetadata.ts` and Piece 3 reuses it.

**Colors** (`contributes.colors`, alongside Piece 1e's section band colors):

| id | description | defaults (dark / light / hc / hcLight) |
| --- | --- | --- |
| `deckard.overdueForeground` | Color of an overdue task's due date in the editor, and of the "overdue 5 days" hint after its line. | `errorForeground` for all four |
| `deckard.taskHintForeground` | Color of the hints after a task's line in the editor, such as "due today" and "needs a new date". | `descriptionForeground` for all four |

`descriptionForeground` is used rather than `editorCodeLens.foreground`, because Light's CodeLens gray `#919191` is 3.2:1.

**Settings** (Editor group):

| Setting | Type, default | Description |
| --- | --- | --- |
| `deckard.editor.dimTaskMetadata` | boolean, `true`, resource, order 12 | "Draw a task's dates, priority, repeat rule, ids, and person, and a line's ^block id, fainter than its words, so the sentence reads first. An overdue date is never dimmed." |
| `deckard.editor.taskDueHints` | boolean, `true`, resource, order 13 | "Say after an open task's line when it is overdue or due today, such as \"overdue 5 days\". Zen mode hides these." |
| `deckard.editor.repeatDiagnostics` | boolean, `true`, resource, order 14 | "Mark a 🔁 repeat rule Deckard cannot read, since completing that task would not start the next one, and offer the nearest rule it can read." |

**Zen** hides the hints (like the lenses) and keeps the dimming, since dimming is itself quieting.

**Repeat rules `parseRecurrence` learns**, with Tasks compatibility noted in the README:

- `every other day|week|month|year`: same as `every 2 …`.
- `every N weeks on <days>` and `every other week on <days>`. Weeks start on **Monday**, as rrule (and so Obsidian Tasks) counts them. That is independent of Piece 2e's display `weekStart`.
- `every other <weekday>`: same as `every 2 weeks on <weekday>`.
- `every [N ]month[s] on the (first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th) <weekday>`. A month with no fifth such weekday is skipped, as rrule skips it.
- `every quarter` and `every N quarters`: every 3N months. Deckard-only.
- `every weekend`: Saturday and Sunday. Deckard-only.

All of them still take `when done`.

**Repeat diagnostic.** A new `DiagnosticCollection('deckard-tasks')`.

- It applies only to open task lines in notes. The range is the rule's text.
- Severity is **Warning**, because completing the task would silently lose the repeat. The source is `Deckard` and the code `unreadable-repeat`.
- **Message with a suggestion:** `Deckard cannot read the repeat rule "every tuesdya", so completing this task will not start the next one. Try "every tuesday".`
- **Message without one:** `Deckard cannot read the repeat rule "whenever", so completing this task will not start the next one. Write a rule such as "every week", "every month on the 15th", or "every weekday".`
- **Quick fixes:** up to three, titled `Change the rule to "every tuesday"`. The first is `isPreferred`. Each replaces only the rule text.
- The task editor's existing warning (`taskEditor.ts:290`) gets the same `Try "…".` tail.

**How suggestions are found** (`suggestRecurrence(text): string[]`, pure):

1. **Whole-word synonyms.** Tasks-compatible spellings are preferred.
   - `daily` becomes `every day`, `weekly` becomes `every week`, `monthly` becomes `every month`, and `yearly` or `annually` becomes `every year`.
   - `biweekly`, `fortnightly`, and `every fortnight` become `every 2 weeks`.
   - `quarterly` becomes `every 3 months`, `weekdays` becomes `every weekday`, and `weekends` becomes `every week on saturday, sunday`.
2. Prefix `every ` when it's missing (`tuesday`, `2 weeks`, `other week`).
3. **Spelling correction.** Each token outside the rule vocabulary is replaced with the nearest vocabulary word.
   - The vocabulary is: every, other, day(s), week(s), month(s), year(s), quarter(s), weekday, weekend, on, the, last, first–fifth, 1st–5th, when, done, and the weekday names.
   - It uses `editDistance` from `core/storage/searchStore.ts`, with a limit of 1 for tokens of 4 or fewer characters and 2 for longer ones.
4. Keep only candidates `parseRecurrence` reads. Drop duplicates, keep at most 3, keep a `when done` suffix, and write them in lower case.

### 7g. Word count

- **Where:** status bar item `deckard.wordCount`, named **Deckard word count**, aligned right with priority 99 (beside the task count). No command.
- **When it shows:** while the active editor is a note (`isNote`). It's hidden otherwise.
- **Text:**
  - `412 words · 2 min`, or `1,204 words · 5 min`. Minutes are `max(1, round(words / 238))`.
  - `0 words` when empty.
  - With a non-empty selection: `38 of 412 words`.
- **Tooltip:**
  - `412 words in this note, about 2 minutes to read at 238 words a minute. Front matter, code, and task metadata are not counted.`
  - With a selection: `38 words selected, of 412 in this note.`
- **What is counted:** words from `Intl.Segmenter(undefined, { granularity: 'word' })` where `isWordLike`. The following are left out:
  - front matter, fenced code (query blocks included), indented code, inline code spans, and HTML comments
  - task metadata tokens (7f's span finder), checkboxes, and `^block-ids`
  - list, heading, and quote markers
  - link URLs (the link text counts), and the target of `[[target|alias]]` (the alias counts, or the target when there is no alias)
- **Timing:** it recounts 250 ms after a change or selection move.

### 7h. Outline

**Counts in the description.** The description is `2/5 · ↩3 · #project/atlas`, with empty parts left out.

- `2/5` is done/total over the tasks under the heading, sub-headings included.
- `↩3` is `backlinks.toHeading(filePath, heading).length`.
- The tooltip spells them out: `2 of 5 tasks done` and `Linked 3 times`.
- They're hidden in zen, like the reference-count lenses.
- Setting `deckard.outline.showCounts`: boolean, `true`, order 3. "Show beside each heading in the Deckard Outline how many of the tasks under it are done, such as 2/5, and how many links name it, such as ↩3."

**Focus Section.** Command `deckard.focusSection`, title **Focus Section**, icon `$(target)`, category Deckard.

- Where it appears: the Outline item context (`inline` and `1_focus@1`), the editor submenu, and Note Actions.
- Palette: shown when `editorLangId == markdown`.
- It takes an optional `OutlineNode`. Otherwise it uses the heading the cursor is in.
- Steps:
  1. Show the editor and put the cursor on the heading line.
  2. Run `editor.foldAllExcept`, then `editor.unfoldRecursively` so the section's own sub-headings open.
  3. Reveal the heading at the top.
  4. Set `deckard.sectionFocused`.
- **Show All Sections:** `deckard.showAllSections`, icon `$(unfold)`.
  - It appears in the Outline view title and the palette when `deckard.sectionFocused`.
  - It runs `editor.unfoldAll` and clears the key. Moving to another document also clears the key.
- **Refusals** (info messages):
  - No heading: **Put the cursor under a heading to focus its section.**
  - `editor.folding` off for Markdown: **Focus Section folds the rest of the note, and folding is turned off (editor.folding).**

**Tag filter.** A tree view can't hold clickable chips. The plan's "tag chip filters the Outline" becomes two commands:

- **Filter Outline by Tag…** (`deckard.outline.filterByTag`, `$(filter)`):
  - It is in the view title when `!deckard.outlineFiltered`, and on a tagged heading's context menu (it takes that heading's tags through the existing `pickOutlineTag`).
  - From the title, it picks from the tags on this note's headings, with the placeholder **Show only the headings that carry a tag**.
- **Clear Outline Tag Filter** (`deckard.outline.clearTagFilter`, `$(filter-filled)`) is in the view title when `deckard.outlineFiltered`.
- **Filtering behavior:**
  - The tree keeps headings whose own tags include the tag, or a tag under it: `#project` matches `#project/atlas`. Their ancestors stay for structure.
  - `view.description` shows the tag.
  - The filter stays in place across notes, until it's cleared or the window reloads.
  - If nothing in the note matches, the view message reads **No heading in this note carries #project/atlas.**

---

## 3. Implementation steps

### Shared groundwork

- `src/ui/commands/activeNoteContext.ts` (new): the `ActiveNoteContext` class.
  - It listens to `onDidChangeActiveTextEditor`, `indexer.onDidUpdate` (daily notes are known from the index), and `onDidChangeTextDocument` for the active document's H1.
  - It sets `deckard.isNote` and `deckard.isDailyNote` only when they change, following the `TaskLineContext` pattern.
  - If the index doesn't have the file yet, `isDailyNote` falls back to `findDailyNoteDate(filePath, [])`, which reads the file name.
- `src/core/workspace/backlinks.ts`: add `getBacklinkIndex(index)`, a `WeakMap<WorkspaceIndex, BacklinkIndex>` cache. It is moved from `noteLinks.ts:27`.
  - `noteLinks.ts`, `editorReferences.ts:298`, `dashboardState.ts:549`, and the Outline all use it, so one save builds the index once instead of three times. That is a side benefit for Piece 10.
- **Manifest test upkeep.** Each commit that adds a command or setting updates:
  - `extension.test.ts:19`'s setting count (54, and after this piece 59)
  - its ordered command list
  - `COMMAND_NOTES` in `helpHtml.ts`

### 7b. `deckard.toggleTaskDone`

1. Depends on Piece 1c. 1c extracts `toggleTask`'s transform into a pure, exported function. The name assumed here is `completeTaskLine(line, checkboxColumn, completed, now, { addDoneDate, format }) → { text, startedNext?: string, unreadableRule?: string }` in `taskActions.ts`.
   - `text` may be two lines, with the next occurrence first.
   - If 1c lands without one, this commit extracts it, and both `toggleTask` and 1c's editor Done call it.
2. Export `carryRank` as `carryTaskRank`.
3. Add `src/ui/commands/toggleTaskDone.ts`, `toggleTaskDoneCommand(now = Date.now())`:
   - Collect the unique line numbers from `editor.selections`, from `start.line` through `end.line`, but leave out an end line where `end.character == 0` when the selection spans lines.
   - Keep the lines where `isTaskLine` matches. The checkbox column is `TASK_LINE`'s group-1 length.
   - Decide `completed = any open`.
   - Apply `completeTaskLine` to each line. Replace with `document.eol`, from the bottom line up, in one `editor.edit`.
   - Carry ranks with `getTaskLineId(filePath, line + added, text)`.
   - Show the message, then let `TaskLineContext` re-sync.
4. Manifest: the command, the keybinding, the `commandPalette` `when`, and a Help note.

**Edge cases:**
- An unsaved or untitled `.md` works, because it writes into the buffer.
- A task inside a fenced code block: `isTaskLine` doesn't know about fences. `editTaskCommand` has the same limit. Accepted, and documented in the test.
- A cursor on a 🔁 line where the rule is unreadable: complete it, then show 1d's message.

### 7a. Title bar, quick pick, context submenu

1. `package.json`:
   - add `icon` to `previousDailyNote` and `nextDailyNote`
   - add the `deckard.noteActions` and `deckard.showNotesGraphAroundNote` commands
   - add the `editor/title` entries, the `submenus` entry, the `editor/context` entry, and the `deckard.editor.context` submenu menu
   - add the `resources/editor/deckard-light.svg` and `deckard-dark.svg` icons (stroke `#424242` / `#C5C5C5`)
2. `src/ui/commands/noteActions.ts` (new):
   - `buildNoteActionItems(state)` is pure. `state` is `{onTaskLine, pinned, inTaggedEntry, underHeading}` and it returns items with `{label, detail?, command, args}`.
   - `noteActionsCommand(deps)` reads the state from the editor, the parse, and preferences, shows the pick, and runs the chosen command.
3. `NotesGraphPanel.showAround(filePath)`:
   - sets `focusPath` and `scope = { ...scope, local: true, depth: 1 }`, leaving `scopeChosen` alone
   - then calls `show()`
4. Register the commands in `extension.ts`, and push `ActiveNoteContext`.

### 7c. Explorer and New File

1. `templates.ts`: `newNoteFromTemplate(indexer, targetFolder?: vscode.Uri)`.
   - With a target, the workspace folder is `getWorkspaceFolder(target)` (so no folder prompt), and `notesUri` is the target.
   - After writing, if `!indexer.isNotesFile(noteUri)`, show the notice.
2. `src/ui/commands/excludeFolders.ts` (new):
   - `relativeExcludeKey(folderUri, workspaceFolder)` is pure: it returns a POSIX relative path, or undefined for the root.
   - `listExcludedFolders(folders, readExclude)` is pure. It returns the fsPaths with exact `true` keys.
   - The `ExcludedFoldersContext` class republishes on `onDidChangeConfiguration('deckard.exclude' | 'deckard.notesFolder')` and on workspace folder changes.
   - `excludeFolderCommand(uri)` and `includeFolderCommand(uri)` do the checks above, then `writeSetting('exclude', {...current, [key]: true}, target, configurationFor(folder))`.
   - Undo writes the previous object back.
3. Manifest: the three commands, hidden from the palette with `when: false`; the submenu; `explorer/context`; `file/newFile`.

**Edge cases:**
- `deckard.exclude` is set at the user level. Workspace writes merge with the *workspace* value, not the effective value, so user keys aren't copied into the workspace.
- A folder name with glob characters (`[draft]`): escape `[`, `]`, `*`, `?`, `{`, `}` in the key with `\`. The existing matcher is picomatch-style, and a test covers it.

### 7d. Grammar

1. Add `syntaxes/deckard.injection.tmLanguage.json`. `.vscodeignore` doesn't exclude `syntaxes/`.
2. Add `package.json` `contributes.grammars`.
3. devDependencies `vscode-textmate` and `vscode-oniguruma`, for the test only. Neither is bundled, because esbuild doesn't import them.

### 7f. Task-line marks

1. `taskMetadata.ts`: `findTaskMetadataSpans(text): { start, end, field: TaskMetadataField | 'onCompletion' | 'blockId', value }[]`.
   - It is built from the same patterns and `DATAVIEW_FIELD_PATTERN`, using `matchAll` on the original text.
   - It drops non-Deckard Dataview keys, as `parseTaskMetadata` does, and resolves overlaps first-wins in `parseTaskMetadata`'s order.
2. `src/ui/state/taskLineMarks.ts` (new, pure): `findTaskLineMarks(lines, now, { dim, hints })` returns `{ dim: Span[], overdue: Span[], hints: { line, text, tone } [] }`, where `Span = { line, start, end }`.
   - It skips front matter and fenced code. It uses the parser's fence logic if exported, or a local ``` / ~~~ tracker that follows `parser.ts`'s rules.
   - It finds open or done state from `TASK_LINE`, due from the spans, and the wording from `describeDueDate`.
3. `src/ui/commands/taskLineDecorations.ts` (new): the `TaskLineDecorations` class, with three `TextEditorDecorationType`s: `dim` (`opacity: '0.7'`), `overdue` (`color: ThemeColor('deckard.overdueForeground')`), and `hint` (base type with no styles; each range carries `renderOptions.after`).
   - It follows `EditorTagDecorations`: visible editors, a 150 ms debounce on changes, and a config listener for `deckard.editor.*` and `deckard.zenMode`.
   - It also listens for window focus, and a timer re-armed for the next local midnight, so "today" moves.
   - It gates on `indexer.isNotesFile`. It is wrapped in `measure('Task line marks')`.
4. `package.json`: the `colors` and the two settings.
5. `parseRecurrence` additions (their own commit): new branches before the weekday branch.
   - A helper `nextWeekdayEveryNWeeks(from, weekdays, n)`: `nextDayWhere`, plus `7*(n-1)` days when the result falls in a later Monday-started week than `from`.
   - A helper `nthWeekdayOfMonth(year, month, weekday, n | 'last')`.
6. Repeat diagnostic (its own commit): `src/ui/commands/repeatRuleHealth.ts`, the `RepeatRuleHealth` class. It is modeled on `LinkHealth`, with open, change (300 ms), close, config, and a code-action provider (`QuickFix`).
   - It finds rule spans with `findTaskMetadataSpans` (field `repeat`) and checks each with `parseRecurrence`.
   - `suggestRecurrence` lives in `taskMetadata.ts`, next to `parseRecurrence`.
   - Its quick fix is a `WorkspaceEdit` replacing the rule range, not a command.
7. `taskEditor.ts:290`: add the suggestion tail.

### 7g. Word count

- `src/core/markdown/wordCount.ts` (new, pure):
  - `maskNoteForWords(lines): string[]` returns each line with the excluded parts blanked to spaces, so columns are kept.
  - `countWords(text)` is segmenter-based.
  - `countNoteWords(lines, ranges?)` counts the masked text, or only the ranges when given.
- `src/ui/views/wordCountStatusBar.ts` (new): the `WordCountStatusBar` class. It caches the masked lines per document version and recounts selections from the cache.

### 7h. Outline

1. `outlineState.ts`:
   - `OutlineNode` gains optional `tasks?: { done, total }` and `links?: number`.
   - `buildOutline(file, { ..., backlinks?, filePath? })` fills them from `file.tasks` (`sectionId` within the section tree, as `referenceState.isWithin` does) and from `backlinks.toHeading`.
   - `formatOutlineDescription(node, { tags, counts })` is pure.
   - `filterOutline(roots, tagKey)` is pure. It keeps matches and their ancestors, and ids stay unchanged.
2. `outlineTree.ts`:
   - pass `getBacklinkIndex(indexer.getSnapshot())` and rebuild on `indexer.onDidUpdate`
   - read the `showCounts` and `zenMode` settings
   - add the `tagFilter` state, `setTagFilter`, `view.description`, the messages, and the context key `deckard.outlineFiltered`
3. `src/ui/commands/focusSection.ts` (new): `focusSectionCommand(node?)` and `showAllSectionsCommand()`, plus `deckard.sectionFocused` bookkeeping.
4. Manifest: the commands, the `view/title` and `view/item/context` entries, and the setting.

### 7e. Tag style

- `tagDecorations.ts`: add a second type, `textDecorationType` (`color: ThemeColor('textLink.foreground')`, `cursor: 'pointer'`).
- `decorate()` picks the type from `deckard.editor.tagStyle` and clears the other.
- Its config listener gains `deckard.editor.tagStyle`.

---

## 4. Tests

All in `npm test` (vscode-test host) unless noted. Every commit is verified with all four suites, gated on exit codes. None of this work touches a webview's HTML: the Help table is built from the manifest, and `pages.js` passes Help no manifest.

**No visual baselines are re-recorded**, and there is no `test:layout` or `test:ui` change beyond them running green.

| Commit | Test file | Asserts |
| --- | --- | --- |
| 7b | `toggle-task-done.test.ts` (new) | Opens an untitled `.md` document and places cursors, then runs the command:<br>• one open task gets `[x]` and a ✅ date<br>• a repeating task gets its next occurrence above, dates moved<br>• two cursors, one open and one done: both done<br>• all done: all reopened, ✅ removed<br>• a selection over three lines, one of them prose: two tasks toggled<br>• one Undo restores everything<br>• a prose line: info message, no edit<br>• the rank keeper is called with the old and new ids |
| 7a | `note-actions.test.ts` (new) | `buildNoteActionItems` for each state: labels and order exactly as in §2; Unpin when pinned; Related Notes detail only in a tagged entry. |
| 7a | `active-note-context.test.ts` (new) | `deckard.isDailyNote` is true for `2026-09-25.md` and for a note whose H1 is a date, and false for `Atlas.md` and for a Markdown file outside the notes folder (`isNote` false). Read back through a stubbed `setContext` recorder. |
| 7a | `notes-graph-state.test.ts` (existing) | `showAround` sets local depth 1 and leaves `scopeChosen` false (via `openingScope`). |
| 7a | `extension.test.ts` | The manifest's `editor/title` has the three note buttons and two zen buttons with the exact `when` clauses; the submenu `deckard.editor.context` holds the listed commands in the listed groups. |
| 7c | `exclude-folders.test.ts` (new) | `relativeExcludeKey`: nested folder, root (undefined), glob characters escaped; `listExcludedFolders` lists only exact `true` keys; exclude then include round-trips the workspace setting in the test workspace; the notes-folder, outside, and templates refusals. |
| 7c | `templates.test.ts` | Given a target folder, the note is written there, not in `notesFolder`. |
| 7d | `markdown-injection-grammar.test.ts` (new) | Loads `markdown.tmLanguage.json` from `vscode.env.appRoot/extensions/markdown-basics/syntaxes` and the injection, with vscode-textmate and vscode-oniguruma:<br>• `[[Atlas#Decision\|the decision]]` has the punctuation, title, and description scopes<br>• `![[Atlas]]` has the embed scope<br>• `📅 2026-10-02`, `[due:: 2026-10-02]`, and `🔁 every week when done` are scoped<br>• the same text inside `` `…` ``, a fenced block, and front matter is **not** scoped<br>• `#project/atlas` gets no Deckard scope<br>• a heading `## Plan [[Atlas]]` is scoped |
| 7f | `task-metadata.test.ts` | `findTaskMetadataSpans` parity with `parseTaskMetadata`: for every fixture line already in the file, cutting the spans out and collapsing spaces gives `title`, and the fields and values equal `metadata`. Overlaps, variation selectors, and Dataview round brackets are covered. |
| 7f | `task-line-marks.test.ts` (new) | With `now` = 2026-09-25:<br>• due 09-20 open: hint `overdue 5 days`, due span in `overdue`, other tokens dimmed<br>• due 2026-08-01 open: `needs a new date`, not in `overdue`<br>• due today: `due today`<br>• done task: dimmed, no hint<br>• `^abc` on prose: dimmed<br>• a task in a fence: nothing<br>• `hints: false`: no hints<br>• `dim: false`: no dim spans |
| 7f | `tag-decorations.test.ts`-style fake-editor test in the same file | `TaskLineDecorations` sets the three types on a note, clears them on a non-note, and drops hints when `deckard.zenMode` is on. |
| 7f recurrence | `task-metadata.test.ts` | From Fri 2026-09-25:<br>• `every other week` → 10-09<br>• `every month on the second tuesday` → 10-13<br>• `every month on the last friday` → 10-30<br>• `every quarter` → 12-25<br>• `every weekend` → Sat 09-26, and from 09-26 → Sun 09-27<br>• `every 2 weeks on monday, thursday` from Mon 09-28 → Thu 10-01, then → Mon 10-12<br>• `every month on the fifth friday` from 10-30 → 2027-01-29 (Nov and Dec 2026 have four Fridays)<br>• `every other tuesday when done` sets `whenDone`<br>• existing rules unchanged |
| 7f diagnostic | `repeat-rule-health.test.ts` (new) | `suggestRecurrence`:<br>• `every tuesdya` → `every tuesday`<br>• `weekly` → `every week`<br>• `biweekly` → `every 2 weeks`<br>• `tuesday` → `every tuesday`<br>• `every mnth when done` → `every month when done`<br>• `whenever` → []<br>• never more than 3, and each parses<br>Diagnostic on an open task only, range equals the rule text, both exact messages, the quick fix edit replaces the rule, `repeatDiagnostics: false` clears it. |
| 7g | `word-count.test.ts` (new) | Front matter, fences, inline code, HTML comment, metadata, checkbox, `^id`, and URL are not counted; link text and alias are; a selection mid-line counts only its words; `1,204 words · 5 min` formatting; `0 words`. |
| 7h | `outline-tree.test.ts` (existing) | Counts: `2/5`, `↩3` from a stub backlink index, joined `2/5 · ↩3 · #a`; hidden in zen; `showCounts: false`. `filterOutline` keeps ancestors, matches namespace children, empty → message. |
| 7h | `focus-section.test.ts` (new) | Records executed commands with a spy: `editor.foldAllExcept`, then `editor.unfoldRecursively`, with the selection on the heading line; the no-heading message; `deckard.sectionFocused` toggles. |
| 7e | `tag-decorations.test.ts` | With `text`, the text type gets the ranges and the box type gets `[]`; the default stays `box`. |
| all | `naming.test.ts` (unchanged) | Already enforces "Open", no category in titles, and "…" on commands that ask. The new titles comply. |

---

## 5. Docs

**README**
- **Commands table:** add **Toggle Task Done** (with the shortcut), **Note Actions…**, **Open Notes Graph Around This Note**, **Focus Section**, **Show All Sections**, and **Filter Outline by Tag…**.
- **Editor assistance** gets new bullets:
  - the title bar (the Deckard button, ‹ › on daily notes; right-click the title bar to hide either)
  - the **Deckard** submenu in the editor's context menu
  - the dimmed metadata and due hints, and their settings
  - the repeat-rule warning and quick fix
  - the word count (right-click the status bar to hide it)
  - the grammar's colors, and how to override one with `editor.tokenColorCustomizations` (example given for `constant.numeric.date.deckard`)
  - `deckard.editor.tagStyle`
- **Task metadata → repeat rules:** list the new forms, and note that `every quarter` and `every weekend` are Deckard's own, not Obsidian Tasks'.
- **Outline:** counts, Focus Section / Show All Sections, and the tag filter.
- **Templates:** New Note from Template Here… and File → New File….
- **Settings:** the five new settings. Also mention Exclude from / Include in Deckard in the Explorer where `deckard.exclude` is described.
- **Zen mode:** hints hidden, dimming kept.

**Help** (`src/ui/webview/helpHtml.ts`)
- `COMMAND_NOTES` for every new command.
  - Example: `'deckard.toggleTaskDone': 'Completes or reopens the tasks under the cursors, starting the next one of a repeating task.'`
- "Writing tasks" cards: a sentence on Toggle Task Done and its shortcut, and on the repeat-rule warning.
- A new card, **"The editor"**, in "Tags and people". It covers the title-bar button, the context submenu, the word count, and dimmed metadata.

**CHANGELOG** (`## Unreleased`, `### Added` unless noted): one entry per commit, in the file's bold-lead style. Examples:
- **Toggle Task Done from the keyboard.**
- **A Deckard button and menu in the editor.**
- **Zen from a page's title bar.**
- **The Explorer knows Deckard.**
- **`[[links]]` and task dates colored by your theme.**
- **Task metadata steps back; overdue speaks up.**
- **More repeat rules.**
- **A repeat rule Deckard cannot read is marked.**
- **A word count.**
- **The Outline counts, focuses, and filters.**
- **Tags can be drawn as text** (under `### Changed`? No, it's opt-in, so `### Added`).

**components.md:** no change. No webview component is touched.

---

## 6. Commits

Each commit ships alone. Each is verified with `npm test`, `npm run test:ui`,
`npm run test:e2e`, and `npm run test:layout` (exit codes), in a short-path
worktree per the concurrent-edits rule, with no Co-Authored-By trailer.

1. `feat: a task is completed or reopened from the keyboard, with its next occurrence written` (7b; after Piece 1c)
2. `feat: a note's title bar opens Deckard's actions, and a daily note's steps to the one before and after` (7a: keys, button, quick pick, ‹ ›, graph around the note)
3. `feat: zen is turned on and off from a Deckard page's title bar` (7a)
4. `feat: the editor's context menu has a Deckard submenu` (7a)
5. `feat: the Explorer creates a note from a template in a folder, and leaves a folder out of Deckard or brings it back` (7c, with `file/newFile`)
6. `feat: links, task dates, and repeat rules take the theme's colors wherever Markdown is shown` (7d)
7. `feat: a task's metadata is drawn fainter than its words, and an overdue task says so at the end of its line` (7f: spans, dimming, hints, colors, 2 settings)
8. `feat: a repeat rule can be every other week, the second Tuesday, a quarter, or a weekend` (7f `parseRecurrence`)
9. `feat: a repeat rule Deckard cannot read is marked, with the nearest one it can as a fix` (7f diagnostic, setting, task-editor tail)
10. `feat: the status bar counts a note's words, or the selection's` (7g)
11. `feat: the Outline says how many tasks under a heading are done and how many links name it` (7h counts, shared backlink cache)
12. `feat: the Outline focuses one section and filters by a tag` (7h)
13. `feat: tags can be drawn as linked text instead of a box` (7e; optional, droppable)

Commits 2 and 4 both need `ActiveNoteContext`, which lands in 2. Commit 9
needs 7's span finder and 8's grammar. Commit 4's Focus Section entry is added
by 12, which appends it to the submenu. Everything else is independent.

---

## 7. 7i, deferred (design note only)

- **Writing focus.**
  - Commands **Focus Writing** / **Stop Focusing Writing**, separate from zen.
  - While on, one decoration type at `opacity: 0.45` covers every line outside the current paragraph (or section, per `deckard.editor.writingFocus: "paragraph" | "section"`). It follows the selection, debounced by 50 ms.
  - Size M: selection-following redraws at 60 Hz typing need care.
- **Prose walkthrough step.**
  - A walkthrough step, "Set the editor up for writing". It opens a diff of the user's `settings.json` against the proposed `[markdown]` block (`editor.wordWrap: on`, `editor.lineNumbers: off`, `editor.quickSuggestions` off for prose, `editor.minimap.enabled: false`) and applies it only on **Apply**.
  - Size S, but it belongs with Piece 11's walkthrough work.

---

## 8. Size, risks, dependencies, questions

**Size:**

| Item | Days |
| --- | --- |
| 7b | 0.5 |
| 7a | 1.25 (three commits) |
| 7c | 0.75 |
| 7d | 0.75 |
| 7f | 2.5 (0.5 recurrence + 0.75 diagnostic + 1.25 marks) |
| 7g | 0.5 |
| 7h | 1.25 (0.5 counts + 0.75 focus and filter) |
| 7e | 0.25 |
| **Total** | **about 7.75 days** for 13 commits. 7i later: about 2.5 days. |

**Risks**
- **`resourcePath in deckard.excludedFolders`** depends on `resourcePath` being the `fsPath`, which I believe VS Code sets. It can't be exercised in vscode-test.
  - Check it by hand in an Extension Development Host before committing 5.
  - Fallback: show both items and have each command say so when it has nothing to do.
- **The grammar test needs two new devDependencies** (vscode-textmate, vscode-oniguruma). Both are small, Microsoft-maintained, and test-only.
  - If David would rather add none, the fallback test compiles each `match` with JS `RegExp` against samples. That's weaker, because it can't prove the code-span exclusion.
- **Opacity on emoji** works (it's CSS opacity on the inline span). It is still the change most likely to look wrong in some theme.
  - Check in Dark Modern, Light Modern, and one high-contrast theme.
  - `dimTaskMetadata` is the escape hatch.
- **Title-bar crowding:** a daily note gains three buttons next to Markdown's preview buttons. They're hideable, and the README says how.
- **`editor.foldAllExcept`** also folds lists and code blocks outside the section. That's intended, but a reader might not expect it. **Show All Sections** undoes all of it.
- **Commit 1 hinges on 1c's helper.** If Piece 1 names it differently, commit 1 adapts. The contract is the pure line transform.

**Dependencies on other pieces**
- **Piece 1c:** the pure completion transform (hard dependency for 7b).
- **Piece 1d:** the unreadable-rule message wording, reused by 7b.
- **Piece 1e:** also adds `contributes.colors`. Whichever lands second appends to it.
- **Piece 1f:** notes-only gating. 7's new features gate on `isNotesFile` themselves, so it's a soft dependency.
- **Piece 3:** the 30-day stale threshold and the "needs a new date" wording. The same wording is used by the Calendar plan (15).
- **Piece 6h:** **Move to…** goes into the editor submenu's `3_move` group when it lands.
- **Piece 8:** message voice. The strings here already follow "say what to do next".
- **Piece 10:** the shared backlink cache helps 10e.
- **Piece 11:** 7i's walkthrough step.

**Open questions for David:** none that block the work. One is worth a glance: `deckard.editor.tagStyle: text` is kept as an opt-in under decision 4, and commit 13 can be dropped if he'd rather have no second style at all.
