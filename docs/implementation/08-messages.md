# Piece 8. Messages that say what to do: implementation plan

Written 2026-09-25 against `dev` at `726d23b` (v1.22.0). Source: Piece 8 of
`docs/ux-fifteen-sources-plan.md`. Every claim below was re-read in the
source; line numbers are at `726d23b`.

---

## 1. Scope

Covers **8a–8f**, all of them. What verification turned up:

| Item | Claim in the plan | Verified | Change to the plan |
| --- | --- | --- | --- |
| audit | 123 notifications | **Yes**: exactly 123 `show{Information,Warning,Error}Message` calls outside `src/test`. | None. |
| 8a | `String(error)` appended 13 times | **Yes, roughly**: 11 `String(error)` in a toast, plus 3 that show `error.message` as the whole toast (`sampleWorkspace.ts:65`, `preferenceBackups.ts:115`, `:152`) and one `error.message` inside `mcpServer.ts:100`. 15 sites in all. | All 15 go through `reportFailure`. |
| 8a | `extractHeading.ts:296` must say "the heading is now in both notes and which to delete" | **Partly wrong.** When the source note cannot be saved *and* the rollback fails, the caller (`extractHeadingNote`, line 110–114) then **deletes the new note**. So today the heading is on disk only in the source (save failed), while the open editor shows the link in its place: the reader who saves that editor loses the heading. It is not "in both". | Fixed properly: in the unrestored case the new note is **kept**, so the heading really is in both, and the message says which to keep. See 8a design. |
| 8b | "changed since Deckard read it" written seven ways at three severities | **Yes**: 7 wordings over 9 calls (Information ×3, Warning ×6; Error ×0 today). Also found: `updateTaskLine` returns false **silently** when the line number is past the end of the note (`taskActions.ts:84`), and when `applyEdit` is refused (`:108`). | Both silent paths get a message. |
| 8c | 41 failures, 5/22/14 | Near enough: my count of failures is 43 (the two `move.reason` refusals are counted by me). | Reclassified in the table below. |
| 8d | six messages name a raw setting ID | **Yes**, six places: `extension.ts:229`, `mcpServer.ts:100`, `templates.ts:97`, `settings.ts:46` (`describeUnregisteredSetting`), `assistantTools.ts:172,206` (a tool answer, and the confirmation at `:191`), `agendaTree.ts:192,195` (the Tasks view message). Plus `dashboardState.ts:1557` (the builder's `is:mine` hint names `deckard.me`). `extension.ts:229` already has **Open Setting**. | All named in words. |
| 8d | Tasks view's empty state names its query and offers "Show every open task" | **Yes**: `agendaTree.ts:195` says "No open task matches deckard.agenda.query." with no way out. `TreeView.message` cannot hold a link, so the offer goes into a second `viewsWelcome` entry. | As planned. |
| 8e | Save flow says "filter" | **Yes**: `quickFind.ts:267` title "Save Deckard filter", `:271`, `searchPage.ts:817`, `taskBoard.ts:355` "A saved filter needs a name.", `quickFind.ts:277` "Saved Deckard filter: …", and the button tooltip `quickFind.ts:41` "Save as a view". | As planned. |
| 8e | "Entity" in Link Current Heading's quick picks and Home's widget list | **Yes**: `linkEntity.ts:65,66,70,113`, `entitySuggestions.ts:60`, and the Workspace widget's `Entities` stat (`dashboardWidgets.ts:272`; Stats calls the same number "Namespaced tags"). | As planned. The **command title** "Link Current Heading to Entity" is left as it is (a rename reaches README, keybindings users wrote by title, and the walkthrough; not asked for). |
| 8e | toast buttons "Show Stats", "Show Log" | **Yes**: `extension.ts:420-421`. Also found: `taskStatusBar.ts:238` "Open Tasks" opens the Tasks **view**; `quickFind.ts:53` "Show every result on the Dashboard" opens a **search page**; `queryBlocks.ts:118-119` "Open in search" / "Open this query on the Dashboard’s Search tab" opens a **search page** (there is no Search tab). `extension.ts:229,419` say "notes" for `files.size`. | All fixed under the glossary. |
| 8f | Notes Graph sliders, Related Notes "atomic source units" | **Yes**: `notesGraphHtml.ts:129-132`; `package.json:1183`. | As planned. No Notes Graph visual baseline exists, so none to re-record. |

Left to other pieces, on purpose:

- **Date prompts and their validation** ("Deckard cannot read that as a
  day." / "as a date." / "Write the date as YYYY-MM-DD, or today, or
  tomorrow.") belong to **Piece 2**, one date language. Not touched here.
- The graph's "Relationships" paragraph and legend (jargon such as
  "prevalence-aware visual communities") belong to **Piece 12**.
- The first-index toast is **Piece 11d**. `extension.ts:656`'s reindex
  toast is left as it is.
- The Stats page's own labels ("canonical tag overview", "note entries")
  belong to **Piece 12d**.

---

## 2. Design

### 2.1 The severity rule (8c)

Written into `docs/components.md` under **Conventions**, as a new
`### Messages` section, and held by `src/test/naming.test.ts`:

> | Severity | When |
> | --- | --- |
> | **Error** | What was asked did not happen: nothing was written or opened, or only part of it was written. |
> | **Warning** | It was written, with a caveat, or some of it was skipped. |
> | **Information** | It is done, nothing needed doing, or there is nothing to do it to yet (open a note first). |
>
> A failure says what did not happen and why, in the reader's words, then
> what to do, with at most one button for it. The raw error goes to
> Deckard's log, and the message offers **Open Log**. A setting is named as
> the Settings editor shows it, in quotes, with **Open Setting**. A
> message's buttons are Title Case, as VS Code's own are, and say Open
> rather than Show. No contractions.

### 2.2 The helpers (8a, 8b, 8d)

A new host-side module, `src/ui/commands/notify.ts` (not `messages.ts`,
which already holds the webview message validators):

```ts
export interface MessageAction {
  /** The button, in Title Case: "Open Note", "Open Setting", "Copy Task". */
  title: string;
  run: () => unknown;
}

export interface Failure {
  /** What did not happen, and why, in the reader's words. Ends with a period. */
  outcome: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
  /** The raw error. Written to Deckard's log, never into the message. */
  error?: unknown;
  /** Error unless something was written (see the rule). */
  severity?: 'error' | 'warning';
  /** At most one; Open Log follows it when there is an error. */
  action?: MessageAction;
}

/** Pure: the text and the buttons, in order. What the tests assert. */
export function describeFailure(failure: Failure): { text: string; buttons: string[] };

/** Shows it, logs `error` through core/timing's reportError, runs the chosen button. */
export async function reportFailure(failure: Failure): Promise<void>;

/** Pure: the one sentence for a note that changed underneath. */
export function describeStale(names: readonly string[]): string;

/** Error, with Open Note when there is exactly one note. */
export async function reportStale(uris: readonly vscode.Uri[]): Promise<void>;

/** Pure: a setting as the Settings editor labels it: 'mcpServer.port' → 'MCP Server: Port'. */
export function settingLabel(key: string): string;

/** The Open Setting button for `deckard.<key>`. */
export function openSettingAction(key: string): MessageAction;
```

- `reportFailure` calls `reportError(outcome, error)` from
  `src/core/timing.ts` (it already writes `message: detail` to the log at
  Error level), and adds **Open Log**, which runs `deckard.showLog`.
- `describeStale`:
  - one note: `{name} changed after Deckard last read it, so nothing was written.`
  - several: `{n} notes changed after Deckard last read them, so nothing was written.`
  - `{name}` is the file name with its extension, as capture and extract
    already say it (`2026-09-25.md`), so it is unambiguous.
- `settingLabel` mirrors VS Code's own labeling: the segments after
  `deckard.`, camelCase split into words, each capitalized, the last one
  after `: `, and `Mcp` written `MCP`. `exclude` → `Exclude`;
  `templatesFolder` → `Templates Folder`; `agenda.query` → `Agenda: Query`;
  `assistantTools` → `Assistant Tools`; `mcpServer.port` →
  `MCP Server: Port`; `me` → `Me`. Messages quote it: `the "Exclude"
  setting`.
- `openSettingAction(key)` runs
  `workbench.action.openSettings` with `deckard.<key>`, as
  `extension.ts:233` already does.

Also in `notify.ts`, the shared strings, so each is written once:

| Constant / function | Text |
| --- | --- |
| `describeRejectedEdit(name)` | `VS Code did not accept the change to {name}, so nothing was written.` fix: `Check that the note is not read-only, then try again.` |
| `describeMissingTag(key)` | `Deckard found no tag {key} in your notes. It may have been renamed or merged.` |
| `NEEDS_FOLDER` | `Open a folder first: Deckard creates notes inside it.` with **Open Folder…** (`vscode.openFolder`, no arguments, shows the dialog) |
| `describeUnsavedHalfWrite` | see 8a's extract case |

### 2.3 8a: the worst case, extracting a heading

`extractHeading.ts`, `replaceSectionWithLink` returns a three-way result,
`'replaced' | 'unchanged' | 'half'`, instead of a boolean:

- **Restored** (the source edit was rolled back): the caller deletes the
  new note as now, and the message is Error:
  `Deckard could not save {source}, so the heading was not extracted and nothing was written.`
  [Open Log] when there was an error object.
- **Not restored** (`'half'`): the caller **keeps** the new note (today it
  deletes it, which leaves the heading only in an unsaved buffer). Error:
  `Deckard wrote {new} but could not save {source}, so the heading is in both notes. {source} is open with the link in its place: save it to finish, or undo the change in it and delete {new}.`
  [Open Note] (opens and focuses `{source}`) [Open Log].
- The outer `catch` (line 314) uses the same two sentences, with "could not
  remove the heading from {source}" in place of "could not save {source}".

### 2.4 8b: one string for a note that changed underneath

Every site below calls `reportStale([uri])` (Error, **Open Note**). Undo
paths use it too: "nothing was written" is exactly what happened.

### 2.5 8d: settings in words, and the Tasks view's way out

- Messages name a setting by `settingLabel` in quotes, with **Open Setting**.
- The Tasks view:
  - Query does not parse (`agendaTree.ts:192`), view message:
    `The Tasks view's search cannot be read: {error} It lists every open task until the search is fixed.`
  - Query finds nothing (`:195`), view message:
    `No open task matches the Tasks view's search, "{query}".`
    The tree is empty, so a second `viewsWelcome` entry for
    `deckard.agenda`, shown `when` `deckard.agendaFiltered`, offers:
    `[Show every open task](command:deckard.clearAgendaQuery)` and
    `[Edit the search](command:workbench.action.openSettings?%5B%22deckard.agenda.query%22%5D)`.
    The existing welcome entry gets `"when": "!deckard.agendaFiltered"`.
  - `deckard.agendaFiltered` is set from `getChildren` whenever the query is
    non-empty and parses.
  - New command `deckard.clearAgendaQuery`, title **Clear the Tasks View's
    Search**, category Deckard, in the palette only `when`
    `deckard.agendaFiltered`, and in the Tasks view's title overflow menu
    (`view/title`, group `9_query`, not `navigation`) under the same
    `when`, so the parse-error case, whose tree is not empty, has the way
    out too. It clears `agenda.query` where it is set (workspace value if
    there is one, else global) through `writeSetting`. The target choice is
    factored out of `taskBoard.ts:312-316` into `settings.ts` as
    `settingTarget(configuration, key)` and used by both.
- The naming test's "Show" rule means the command title cannot start with
  "Show"; the welcome link text, which is not a command title, says "Show
  every open task" as the plan asks.

### 2.6 8e: "Save search" and the glossary

| Place | Before | After |
| --- | --- | --- |
| Find's row button tooltip, `quickFind.ts:41` | `Save as a view` | `Save search` |
| Find's save title, `quickFind.ts:267` | `Save Deckard filter` | `Save search` |
| Search page save title, `searchPage.ts:811` | `Save this search` | `Save search` |
| Task Board save title, `taskBoard.ts:351` | `Save this search` | `Save search` |
| Task Board save prompt, `taskBoard.ts:352` | `Name this Task Board search` | `Name this search. It opens on the Task Board.` |
| Save validation ×3, `quickFind.ts:271`, `searchPage.ts:817`, `taskBoard.ts:355` | `A saved filter needs a name.` | `A saved search needs a name.` |
| Find's confirmation, `quickFind.ts:277` | `Saved Deckard filter: ${saved.name}` | `Saved the search "${saved.name}".` |
| Find's Show-all tooltip, `quickFind.ts:53` | `Show every result on the Dashboard` | `Open every result on a search page` |
| Query block lens, `queryBlocks.ts:118` | `Open in search` | `Open search page` |
| Query block lens tooltip, `queryBlocks.ts:119` | `Open this query on the Dashboard’s Search tab` | `Open this query on a search page` |
| Unreadable toast buttons, `extension.ts:420-421` | `Show Stats`, `Show Log` | `Open Stats`, `Open Log` |
| Reminder toast button, `taskStatusBar.ts:238` (and its `===` check) | `Open Tasks` | `Open Tasks View` |
| Workspace widget stat, `dashboardWidgets.ts:272` | `Entities` | `Namespaced tags` (as Stats says it) |
| Link heading pick placeholder, `linkEntity.ts:70` | `Link "${headingName}" to an entity` | `Tag "${headingName}" with a person, project, or other namespaced tag` |
| Link heading create row, `linkEntity.ts:65` | `$(add) Create a new entity` | `$(add) A new person, project, or topic…` |
| Link heading create row description, `:66` | `Insert a canonical tag in this heading` | `Writes its tag at the end of the heading` |
| Link heading kind pick, `:113` | `Choose entity type` | `What is it?` |
| Code action, `entitySuggestions.ts:60` | `Link this heading to an entity` | `Tag this heading with a person or project…` |
| Tag pick, `extension.ts:1016` | `Choose a tag to inspect` | `Choose a tag to open its page` |
| Tag pick description, `extension.ts:1013` | `${tag.count} items` | `${n} entry` / `${n} entries` |
| Builder hint for `is:mine`, `dashboardState.ts:1557` | `Tasks for the person deckard.me names` | `Tasks for the person the "Me" setting names` |
| Duplicate-title link warning, `insertLink.ts:49` | `…so this link will not resolve until one of them is renamed.` | `…so this link will not open a note until one of them is renamed.` |
| Unreadable toast and the exclude hint, `extension.ts:229,419` | "notes" for a count of files | "files" (see table) |

### 2.7 8f: the Notes Graph's link sliders, and Related Notes' settings

Notes Graph, **Display** group (`notesGraphHtml.ts:124-135`). Element ids
and setting keys stay, so saved graph settings carry over.

| id | Label before | Label after | Tooltip after | Ends |
| --- | --- | --- | --- | --- |
| `link-density` | Connection density | **Links per note** | `How many of each note's strongest links are drawn. Fewer is easier to read. The sidebar's connections do not change.` | Fewer … More |
| `tag-specificity` | Tag prevalence bias | **Favor rare tags** | `How much more a tag on a few notes counts than a tag on nearly every note, when choosing which links to draw.` | Less … More |
| `bridge-strength` | Secondary bridge strength | **Links between groups** | `How strongly a note's other tags pull it toward other groups.` | Fewer … More |
| `show-all-links` | Show all links (comparison) | **Show every link** | `Draw every link rather than each note's strongest. Busy on a large workspace.` | (checkbox) |

- The three sliders lose their numeric `<output>`; each is drawn
  `<span class="slider-end">Fewer</span><input type="range"…><span class="slider-end">More</span>`,
  and carries `aria-valuetext` (`fewest`, `fewer`, `about half`, `more`,
  `most`, by fifths of the range) so a screen reader says a word rather than
  0.30. `bindSlider` takes `decimals: null` for these and updates
  `aria-valuetext` instead of the output.
- **Links per note** stays in Display. The other three move into a nested
  `<details class="control-group advanced"><summary>Advanced</summary>`
  at the end of Display, closed by default.
- `.slider-end` is `font: var(--text-xs)`, `color: var(--muted)`; it joins
  the shared sheet only if a second page needs it, otherwise lives in the
  graph's page CSS.

Related Notes settings (`package.json`), with `"tags": ["advanced"]`:

| Setting | Description after |
| --- | --- |
| `deckard.enableKeywordLinks` (boolean, `true`) | `Let wording that two notes share move a related note up or down a little, when it already shares a tag, an association, or a link. Shared wording never makes a note related on its own. Turn off to rank by tags and links alone.` |
| `deckard.relatedNotesAssociationMinimumSupport` (number, `1`, 1–20) | `How many headings, tagged lines, or tasks must write two tags together before Related Notes treats the tags as associated. 1 counts an association written once.` |
| `deckard.relatedNotesRecencyHalfLifeDays` (number, `0`, 0–3650) | `Give recently written notes a small lift in Related Notes: a note this many days old gets half the lift of one written today. 0 turns it off. A daily note's date or a front-matter date is used before the file's.` |

Names, types, and defaults are unchanged.

---

## 3. The inventory: every notification, before → after

Legend. **I** Information, **W** Warning, **E** Error, **M** modal
question. "keep" means the string and severity stay. `{name}` is a file
name with its extension; `{path}` a workspace-relative path. Buttons are
listed in order; **Log** is **Open Log**.

### `src/extension.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 228 | `Deckard read ${notes} notes. If some folders hold Markdown you do not want in the index, such as exported docs or dependencies, deckard.exclude leaves them out and makes every scan faster.` | I | `Deckard read ${n} files. If some folders hold Markdown you do not want in the index, such as exported docs or dependencies, the "Exclude" setting leaves them out and makes every scan faster.` | I | Open Setting |
| 2 | 416 | one: `Deckard could not read ${filePath}, so it is not indexed: ${reason}` / many: `Deckard could not read ${count} notes, so they are not indexed.` [Show Stats] [Show Log] | W | one: `Deckard could not read ${path}, so it is missing from search and Home.` / many: `Deckard could not read ${count} files, so they are missing from search and Home.` (the reason is already in the log, `scanner.ts:106`) | W | Open Stats, Open Log |
| 3 | 501 | `Nothing is overdue.` | I | keep | I | |
| 4 | 656 | `Deckard indexed … files: … notes, … tasks, and … tags.` | I | keep | I | |

### `src/ui/webview/*` hosts

| # | Where | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | dashboard.ts:519 | `Remove the saved search "${name}"? Its widget leaves Home with it.` | M | keep | M | Remove |
| 6 | calendar.ts:174 | `There is no note for ${name} yet.` | I | keep | I | Create |
| 7 | searchPage.ts:92 | `Deckard could not find the tag: ${tagKey}` | W | `describeMissingTag`: `Deckard found no tag ${tagKey} in your notes. It may have been renamed or merged.` | E | |
| 8 | searchPage.ts:826 | `Saved the search "${name}".` | I | keep | I | |
| 9 | relatedNotesDebug.ts:29 | `Deckard could not find that tagged note entry. Save the file and try again.` | W | `Deckard could not find that entry in the note as it is now. Save the note so Deckard reads it again, then try again.` | E | |
| 10 | taskBoard.ts:307 | `The Tasks view lists this search already.` | I | keep | I | |
| 11 | taskBoard.ts:318 | `The Tasks view lists "${query}" now.` / `…every open task now.` | I | keep | I | |
| 12 | taskBoard.ts:366 | `Saved the search "${name}".` | I | keep | I | |
| 13 | sidebarNotes.ts:200 | `Deckard could not find that tagged entry in the saved note. Save the file and try again.` | W | same as #9 | E | |
| 14 | sidebarNotes.ts:731 | `That line has changed since it was read, so Deckard left it as it is.` | I | `describeStale` | E | Open Note |

### `src/ui/commands/taskActions.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | 96 | `Deckard could not update this task because the source line changed.` | W | `describeStale` (also for the silent out-of-range return at :84) | E | Open Note |
| — | 108 | (silent when `applyEdit` is refused) | — | `describeRejectedEdit(name)` + fix | E | Open Note |
| 16 | 136 | `Deckard could not update this task: ${String(error)}` | E | If the edit was applied and only the save failed: `Deckard changed the task in {name} but could not save the note. Save it to keep the change.` (**E**, half-written). Otherwise: `Deckard could not update the task in {name}, so nothing was written.` | E | Open Note / Log |
| 17 | 159 | `${description}` (offerUndo) | I | keep | I | Undo |
| 18 | 186 | `Deckard could not undo this task edit because the note changed.` | W | `describeStale` | E | Open Note |
| 19 | 196 | same | W | `describeStale` | E | Open Note |
| 20 | 221 | `Deckard could not undo this task edit: ${String(error)}` | E | `Deckard could not undo the task edit in {name}, so the note keeps the edit.` | E | Log |
| 21 | 275 | `Deckard completed the task but could not read its repeat rule "${r}", so it did not add the next occurrence.` | W | keep | W | |

### `src/ui/commands/sampleWorkspace.ts`, `navigation.ts`, `linkEntity.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 22 | sample:65 | `${error.message}` (for an existing folder: `There is already a "Deckard Sample" folder in ${parent}. Move it aside, or choose another folder.`) | E | Existing folder (a typed `SampleFolderExists` error): keep that sentence, add button. Anything else: `Deckard could not create the sample notes in ${parent}.` fix `If a "Deckard Sample" folder was left there, delete it and try again.` | E | Choose Another Folder / Log |
| 23 | sample:68 | `Created ${n} sample notes in ${target}. Open it? Its README says what to try.` | I | keep | I | Open, Open in New Window |
| 24 | navigation:68 | `Deckard could not resolve source file: ${filePath}` | W | `Deckard could not find ${path}. It may have been moved or deleted since Deckard last read it.` | E | Reindex |
| 25 | navigation:83 | `Deckard could not open ${filePath}: ${String(error)}` | E | `Deckard could not open ${path}.` | E | Log |
| 26 | linkEntity:30 | `Open a Markdown heading before linking it to an entity.` | W | `Put the cursor on a heading in a note to tag it with a person or project.` | I | |
| 27 | linkEntity:39 | `Place the cursor on a Markdown heading before linking it to an entity.` | W | same as #26 | I | |
| 28 | linkEntity:86 | `${label} is already linked to this heading.` | I | `The heading is already tagged ${label}.` | I | |

### `src/ui/commands/extractHeading.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 29 | 97 | `Deckard did not extract the heading because ${fileName} already exists.` | W | `${fileName} already exists, so Deckard did not extract the heading. Choose another name.` | E | Open Note |
| 30 | 178 | `Deckard could not find any tagged headings to extract.` | I | `No heading in your notes has a tag, so there is nothing to extract.` | I | |
| 31 | 264 | `Deckard could not extract this heading because the source section changed.` | W | `describeStale` | E | Open Note |
| 32 | 296 | restored: `Deckard could not save the source note after extracting the heading: ${String(error)}` / not: `… ${String(error)} The source edit could not be rolled back.` | E | restored: `Deckard could not save {source}, so the heading was not extracted and nothing was written.` / not restored: `Deckard wrote {new} but could not save {source}, so the heading is in both notes. {source} is open with the link in its place: save it to finish, or undo the change in it and delete {new}.` | E | Log / Open Note, Log |
| 33 | 308 | same pair without the error | E | same pair | E | — / Open Note |
| 34 | 316 | `Deckard could not remove the extracted heading: ${String(error)}` (+ rollback clause) | E | same pair, "could not remove the heading from {source}" | E | Log / Open Note, Log |

### `dailyNote.ts`, `settings.ts`, `bulkEditPrompts.ts`, `mcpServer.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 35 | daily:73 | `There is no daily note before/after ${from}.` | I | keep | I | |
| 36 | daily:363 | `Open a workspace before creating a Deckard daily note.` | W | `NEEDS_FOLDER`: `Open a folder first: Deckard creates notes inside it.` | I | Open Folder… |
| 37 | settings:30 | `Deckard was updated, and this window still has the older version's settings, so deckard.${key} could not be saved. Quit and reopen VS Code — Reload Window is not enough — then try again.` | W | `Deckard was updated, and this window still has the older version's settings, so the "${settingLabel(key)}" setting could not be saved. Quit and reopen VS Code (Reload Window is not enough), then try again.` | E | Quit VS Code (`workbench.action.quit`) |
| 38 | bulk:117 | `This search found no ${tasks|notes} to edit.` | I | keep | I | |
| 39 | bulk:155 | `describeBulkEditResult` (below) | I | by result (below) | I/W/E | |
| 40 | mcp:99 | `Deckard could not start its MCP server on port ${port}: ${message}. Set deckard.mcpServer.port to a free port.` | E | `Deckard could not start its MCP server on port ${port}, because another program is using it.` (EADDRINUSE) or `…on port ${port}.` fix `Choose a free port in the "MCP Server: Port" setting.` | E | Open Setting, Log |
| 41 | mcp:162 | `Deckard's MCP server is off. Turn it on for Claude Code and other MCP clients?` | I | keep | I | Turn On |
| 42 | mcp:182 | `Copied the command that adds Deckard to Claude Code. …` | I | keep | I | |
| 43 | mcp:189 | `Deckard made a new MCP server token. …` | I | keep | I | |

`describeBulkEditResult` (`bulkEdit.ts:237`) splits `skipped` into
`unchanged` (already as asked) and `stale` (line changed, note unreadable),
counted in `applyBulkEdit` where each `skipped += …` already sits:

| Case | Before | After | Sev |
| --- | --- | --- | --- |
| changed 0, stale 0 | `Nothing to change: every result is already as you asked, or has changed since it was indexed.` | `Nothing to change: every result is already as you asked.` | I |
| changed 0, stale > 0 | (same) | `describeStale` over the stale notes | E |
| changed > 0, stale 0, unchanged > 0 | `Added #a to 2 results in 2 notes. 1 was left as they are.` | `Added #a to 2 results in 2 notes. 1 was already as you asked.` (fixes "1 was … they are") | I |
| changed > 0, stale > 0 | (same) | `Added #a to 2 results in 2 notes. 1 result changed after Deckard last read it and was left as it is.` | W |

A pure `bulkEditSeverity(result)` returns the severity; #39 and #92 use it.

### `taskEditor.ts`, `capture.ts`, `templates.ts`, `unlinkedMentions.ts`, `exportResults.ts`, `quickFind.ts`, `review.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 44 | taskEditor:290 | `Deckard cannot read "${rule}" as a repeat rule, so it would not write the next occurrence. The task keeps the rule it had.` | W | keep | W | |
| 45 | taskEditor:325 | `Deckard cannot read "${x}" as a person.` | W | `Deckard cannot read "${x}" as a person. The task keeps the person it had.` | W | |
| 46 | taskEditor:463 | `Open a Markdown note to write a task.` | I | `Open a note to write a task in it.` | I | |
| 47 | taskEditor:494 | `Deckard could not write the task. VS Code rejected the edit.` | E | `describeRejectedEdit(name)` + fix | E | |
| 48 | capture:69 | `Deckard could not find ${chosen.filePath}.` | W | `Deckard could not find ${path}, so the task was not added. It may have been moved or deleted.` | E | Copy Task |
| 49 | capture:85 | `The heading "${h}" is no longer in ${path}.` | W | `The heading "${h}" is no longer in ${path}, so the task was not added.` | E | Copy Task |
| 50 | capture:383 | `There are no headings in your notes yet.` | I | keep | I | |
| 51 | capture:399 | `Deckard could not add the capture.` | W | `Deckard could not add the task to {name}, so nothing was written.` | E | Copy Task |
| 52 | capture:404 | `Added it to ${name}.` | I | keep | I | Open |
| 53 | templates:96 | `Set deckard.templatesFolder to a folder of note templates to use them.` | I | `Deckard has no templates folder. Choose one in the "Templates Folder" setting to create notes from templates.` | I | Open Setting |
| 54 | templates:103 | `Add Markdown files to ${folder} to use them as templates.` | I | keep | I | |
| 55 | templates:145 | `${fileName} already exists.` [Open] | W | `${fileName} already exists, so Deckard did not create it. Choose another title.` | E | Open Note |
| 56 | unlinked:68 | `No note mentions ${title} without a link any more.` | I | keep | I | |
| 57 | unlinked:88 | `Linked the mentions of ${title} in ${n} notes.` | I | keep | I | |
| 58 | export:110 | `There are no ${what} to export.` | I | keep | I | |
| 59 | export:145 | `Saved ${count} ${what} to ${path}.` | I | keep | I | Open |
| 60 | quickFind:213 | `Open a note to insert a link into it, then use Find from there.` | I | keep | I | |
| 61 | quickFind:224 | `${link.warning}` | W | keep (wording per §2.6) | W | |
| 62 | quickFind:276 | `Saved Deckard filter: ${name}` | I | `Saved the search "${name}".` | I | |
| 63 | review:134 | `${message}` (review written) | I | keep | I | Open, Undo |
| 64 | review:163 | `Took the review back out of the note.` / `Deckard could not undo that: the note has changed since.` | I | success keep (I) / failure `describeStale` (E) | I/E | — / Open Note |

**Copy Task** writes the capture's line to the clipboard
(`vscode.env.clipboard.writeText`), so what was typed is not lost.
`announce` is given the line to do it.

### `moveTagsToFrontmatter.ts`, `taskBoardActions.ts`, `hubNote.ts`, `linkMaintenance.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 65 | moveTags:37 | `Open a Markdown note before moving tags to front matter.` | W | `Open a note to move its tags into front matter.` | I | |
| 66 | moveTags:55 | `Deckard found no inline tags to move into front matter.` | I | keep | I | |
| 67 | moveTags:70 | `Deckard could not move the note tags into front matter.` | W | `describeRejectedEdit(name)` + fix | E | |
| 68 | board:92 | `${move.reason}` (refused drop) | I | keep text | E | |
| 69 | board:119 | `${move.reason}` (refused add) | I | keep text | E | |
| 70 | hub:76 | `Deckard could not find the tag: ${tagKey}` | W | `describeMissingTag` | E | |
| 71 | hub:83 | `Open a workspace folder to create a hub note.` | W | `NEEDS_FOLDER` | I | Open Folder… |
| 72 | hub:94 | `${fileName} already exists. Add "describes: ${v}" to its front matter to make it the hub note for ${label}.` [Open] | W | `${fileName} already exists, so Deckard did not create a hub note. Add "describes: ${v}" to its front matter to make it the hub note for ${label}.` | E | Open Note |
| 73 | linkM:316 | `Deckard updated ${n} links in ${m} notes.` | I | keep | I | |
| 74 | linkM:354 | `Open a note to rename one of its headings.` | I | keep | I | |
| 75 | linkM:368 | `Put the cursor in a heading to rename it.` | I | keep | I | |
| 76 | linkM:374 | `Save this note before renaming its heading, so Deckard rewrites the links from what is on disk.` | W | keep text | I | Save and Rename (saves, then runs the rename again) |
| 77 | linkM:453 | `Deckard could not rename the heading. VS Code rejected the source edit.` | E | `describeRejectedEdit(name)` + fix | E | |
| 78 | linkM:464 | `Renamed the heading to "${next}" …` | I | keep | I | |

Refusal texts (`taskBoardState.ts`), unchanged except one: `'Deckard does
not know that column.'` → `'That column no longer exists on the board.
Refresh the board and try again.'`

### `preferenceBackups.ts`, `agendaActions.ts`, `tidyPreferences.ts`, `pinNote.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 79 | 95 | `Exported ${what} to ${path}.` | I | keep | I | |
| 80 | 115 | `${error.message}` (`This is not a Deckard preferences file.` / `This Deckard file does not hold preferences.` / a JSON or read error) | E | Known shape errors (a typed `NotPreferencesError`): `${fileName} is not a Deckard preferences file, so nothing was imported.` Anything else: `Deckard could not read ${fileName}, so nothing was imported.` | E | — / Log |
| 81 | 132 | `Deckard has no copies of this workspace’s preferences yet. …` | I | keep | I | |
| 82 | 152 | `That copy could not be read: ${message}` | E | `Deckard could not read that copy, so nothing was restored.` | E | Log |
| 83 | 169 | `Replace what this workspace remembers with …?` | M | keep | M | Replace |
| 84 | 181 | `Restored ${what}.` | I | keep | I | |
| 85 | agendaActions:105 | `describeBulkEditResult` | I | by result, as #39 | I/W/E | |
| 86 | tidy:67 | `Every favorite, pin, and saved search still points at something in this workspace.` | I | keep | I | |
| 87 | tidy:72 | `Remove … that point at nothing in this workspace any more?` | M | keep | M | Remove |
| 88 | tidy:79 | `Removed ….` | I | keep | I | |
| 89 | pin:50 | `Deckard has not indexed that note yet, so it cannot be pinned.` | I | `Deckard has not read that note yet, so it was not pinned. Save the note, then pin it again.` | E | |
| 90 | pin:60 | `"${name}" is already pinned to Home.` | I | keep | I | |
| 91 | pin:75 | `"${name}" is not pinned to Home.` | I | keep | I | |
| 92 | pin:92 | `${message}` (offerUndo) | I | keep | I | Undo |
| 93 | pin:117 | `Open a note in the notes folder to pin it to Home.` | I | keep | I | |

### `src/ui/views/*`, `insertLink.ts`, `linkHealth.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 94 | agendaTree:318 | `Deckard cannot write "${label}" on a task: it is not one edit. Drag it on the Task board, or edit the task.` | I | `"${label}" is not one change to a task line, so Deckard wrote nothing. Drag the task on the Task Board instead, or edit the task.` | E | |
| 95 | agendaTree:327 | `${move.reason}` once per refused task, in a loop | W | Collected and said once after the loop: none moved → the first reason (E); some moved → `Moved ${n} tasks. ${m} were left as they are: ${firstReason}` (W) | E/W | |
| 96 | insertLink:106 | `Open the Markdown note you want the link written in, then insert it.` | W | `Open the note you want the link written in, then insert it.` | I | |
| 97 | insertLink:117 | `${link.warning}` | W | keep | W | |
| 98 | linkHealth:129 | `Open a workspace folder to create notes.` | W | `NEEDS_FOLDER` | I | Open Folder… |
| 99 | linkHealth:136 | `"${name}" cannot be a file name, so Deckard cannot create the note.` | W | `"${name}" cannot be a file name, so Deckard did not create the note.` | E | |
| 100 | linkHealth:182 | `Open a workspace folder to create notes.` | W | `NEEDS_FOLDER` | I | Open Folder… |
| 101 | linkHealth:199 | `Created ${n} notes for links that named no note.` | I | keep | I | |
| 102 | taskStatusBar:241 | `Deckard: ${describeDueTasksAtLength}` | I | keep; button `Open Tasks` → `Open Tasks View` | I | Open Tasks View, Reschedule Overdue…, Turn Off Reminders |
| 103 | outlineTree:158 | `Deckard could not open that heading: ${String(error)}` | E | `Deckard could not open that heading.` | E | Log |

### `renameTag.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 104 | 87 | `Deckard could not rename a tag: ${String(error)}` | E | `Deckard could not rename the tag, so nothing was written.` | E | Log |
| 105 | 133 | `Deckard could not merge a tag: ${String(error)}` | E | `Deckard could not merge the tags, so nothing was written.` | E | Log |
| 106 | 328 | `${label} already uses that tag identity.` | I | `${label} is already written that way.` | I | |
| 107 | 346 | `Deckard could not ${verb} ${label} because ${staleFilePath} changed after indexing.` | W | `describeStale` | E | Open Note |
| 108 | 352 | `Deckard could not find any current source occurrences of ${label}.` | W | `Deckard could not find ${label} in any note as the notes are now, so nothing was written.` | E | |
| 109 | 386 | `Deckard could not ${verb} ${label}. VS Code rejected the source edit.` | E | `describeRejectedEdit` over the notes (`…the change to ${n} notes…`) + fix | E | |
| 110 | 392 | `Deckard left ${label} as it was.` | I | keep | I | |
| 111 | 405 | `${done} ${src} ${joiner} ${rep}, but Deckard could not refresh its index: ${String(error)}` | W | `${done} ${src} ${joiner} ${rep}, but Deckard could not read the notes again, so search may show the old tag until the next save.` | W | Reindex, Log |
| 112 | 409 | `${done} ${src} ${joiner} ${rep} in ${n} notes.` | I | keep | I | |
| 113 | 441 | `Merge ${src} into ${target}?` | M | keep | M | Merge |
| 114 | 462 | `Deckard could not find the tag: ${key}` | W | `describeMissingTag` | E | |
| 115 | 470 | `Deckard has no indexed tags to ${action}.` | I | keep | I | |
| 116 | 502 | `Deckard has no other tag to merge ${label} into.` | I | keep | I | |

### `workspaceWrites.ts`, `rollover.ts`

| # | Line | Before | Sev | After | Sev | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| 117 | ww:256 | `Deckard has not changed your notes in this window yet.` | I | keep | I | |
| 118 | ww:262 | `Undo ${label}?` | M | keep | M | Undo |
| 119 | ww:285 | `Undid ${label} in ${n}.` / `… ${m} changed since and were left alone.` | I | restored > 0, skipped 0: keep (I). restored > 0, skipped > 0: `Undid ${label} in ${n}. ${m} changed after Deckard last read them and were left as they are.` (W). restored 0: `describeStale` over the skipped notes (E) | I/W/E | — / — / Open Note when one |
| 120 | roll:238 | `No unfinished tasks are waiting in an earlier daily note.` | I | keep | I | |
| 121 | roll:279 | `${describeRollover}` | I | keep | I | |
| 122 | roll:282 | same | I | keep | I | Open, Undo |
| 123 | roll:301 | `Put ${n} notes back.` / `Deckard could not undo that: the notes have changed since.` | I | success keep (I); failure `describeStale` (E) | I/E | |

`UndoResult` gains `skippedUris: vscode.Uri[]` so #64, #119, and #123 can
name the notes.

### Outside notifications (8d, 8e)

| Where | Before | After |
| --- | --- | --- |
| assistantTools.ts:172, :206 (tool answer) | `Deckard's assistant tools are turned off. The deckard.assistantTools setting turns them on.` | `Deckard's assistant tools are turned off. The "Assistant Tools" setting in Deckard's settings turns them on.` |
| assistantTools.ts:191 (confirmation) | `…and the \`deckard.assistantTools\` setting turns these tools off.` | `…and the "Assistant Tools" setting in Deckard's settings turns these tools off.` |
| agendaTree.ts:192 (view message) | `deckard.agenda.query does not parse — ${error} Showing every open task.` | `The Tasks view's search cannot be read: ${error} It lists every open task until the search is fixed.` |
| agendaTree.ts:195 (view message) | `No open task matches deckard.agenda.query.` | `No open task matches the Tasks view's search, "${query}".` |
| Validation, extract name, `extractHeading.ts:74` | `Enter one note name without a path or special filename characters.` | `Use a name that can be a file name, without / \ : * ? " < > or \|.` (the templates prompt's words, same check) |
| Validation, rename tag, `renameTag.ts:538` | `Enter exactly one valid tag, such as #project/new-name or a bare new name.` | `Write one tag, such as #project/new-name, or a new name in the same namespace.` |
| Validation, rename heading, `linkMaintenance.ts:388` | `Enter the heading on one line.` | `Write the heading on one line.` |

### Tally

| | Information | Warning | Error | Modal | By outcome |
| --- | --- | --- | --- | --- | --- |
| Before (123 calls) | 64 | 38 | 16 | 5 | — |
| After (123 rows) | 63 | 7 | 42 | 5 | 6 (#39, #64, #85, #95, #119, #123: I, W, or E by what happened) |

The two silent task paths gain an Error each.

Of the failures, every Error now names what did not happen, and the 15
that carried raw error text offer **Open Log** instead.

---

## 4. Implementation steps

### Commit 1 — 8a: `notify.ts`, `reportFailure`, and the raw errors

1. Add `src/ui/commands/notify.ts` with `Failure`, `MessageAction`,
   `describeFailure`, `reportFailure`, `describeRejectedEdit`,
   `describeMissingTag`, `NEEDS_FOLDER` (§2.2). It imports `reportError`
   from `../../core/timing`. `reportFailure` picks
   `showErrorMessage`/`showWarningMessage` by severity, passes
   `[action?.title, error ? 'Open Log' : undefined]`, and on the choice
   runs the action or `deckard.showLog`.
2. Convert the 15 raw-error sites: #16, #20, #22, #25, #32–34, #40, #80,
   #82, #103, #104, #105, #111; and `sampleWorkspace.installSample` throws
   a `SampleFolderExistsError`, `preferenceBackups.readExport` a
   `NotPreferencesError`, so the handler tells known from unknown.
3. #40 needs `openSettingAction` and `settingLabel` early: add them in
   this commit (they are pure and small); commit 3 uses them further.
4. Extract (§2.3): `replaceSectionWithLink` returns
   `'replaced' | 'unchanged' | 'half'`; `extractHeadingNote` deletes the
   new note only on `'unchanged'`; the three messages as in #32–34.
   Edge: when the new note was written but the source is `'half'`, the
   function returns `undefined` (no editor opened on the new note), and
   **Open Note** opens the source.
5. `updateTaskLine` (#16): track `applied` so a save failure after a
   successful `applyEdit` is told apart from an earlier failure.

### Commit 2 — 8b: one string for a note that changed

1. `describeStale`, `reportStale` in `notify.ts`.
2. Sites: #14, #15 (+ the out-of-range return at `taskActions.ts:84`),
   #18, #19, #31, #64, #107, #119, #123, and the bulk-edit stale case.
   The applyEdit-refused silent path (`taskActions.ts:108`) gets
   `describeRejectedEdit`.
3. `workspaceWrites.ts`: `UndoResult.skippedUris`; `undo()` pushes the
   uri where it counts `skipped`.
4. `bulkEdit.ts`: `BulkEditResult` gains `unchanged` and `stale` and a
   `staleUris` list; `skipped` stays as their sum so callers and
   `describeBulkEdit` are untouched. `describeBulkEditResult` and a new
   `bulkEditSeverity`; #39 and #85 route through one
   `reportBulkEditResult(edit, result)` in `bulkEditPrompts.ts`.

### Commit 3 — 8d: settings in words, and the Tasks view's way out

1. #1, #37, #53, #40 (already), assistantTools ×3, `dashboardState.ts:1557`.
2. `settings.ts`: `describeUnregisteredSetting` uses `settingLabel`; the
   warning becomes an Error with **Quit VS Code**. Add
   `settingTarget(configuration, key)`; `taskBoard.ts:312-316` uses it.
3. Tasks view: `agendaTree.ts` sets `deckard.agendaFiltered` in
   `getChildren` (query non-empty and parses), rewrites the two messages.
   `package.json`: the second `viewsWelcome` entry, `when` on the first,
   the `deckard.clearAgendaQuery` command, its `commandPalette` `when`, and
   its `view/title` entry. `extension.ts` registers the command:
   `writeSetting('agenda.query', undefined, settingTarget(…, 'agenda.query'))`.
   Edge: a query set in both user and workspace settings is cleared where
   it wins (workspace); the view then shows the user query, which is right,
   and the command stays offered while one is set.

### Commit 4 — 8c: the severity rule, and the rest reclassified

1. Everything left in the table: preconditions to Information (#26, #27,
   #36, #46, #65, #71, #76, #96, #98, #100) with `NEEDS_FOLDER` and
   **Open Folder…**; nothing-written to Error (#7, #9, #13, #29, #48, #49,
   #51, #55, #67, #68, #69, #70, #72, #77, #89, #94, #99, #108, #109, #114).
2. Capture's **Copy Task** (#48, #49, #51): `announce(uri, taskLine, line)`.
3. #76 **Save and Rename**: saves the document, then runs
   `deckard.renameHeading` again.
4. #95: collect refusals in the loop, report once.
5. `docs/components.md`: the `### Messages` section (§2.1).

### Commit 5 — 8e: "Save search" and the glossary

All of §2.6, and #2's buttons, #62, #102's button. Tests updated:
`dashboard-widgets.test.ts:147` (`'Entities'` → `'Namespaced tags'`).

### Commit 6 — 8f: the graph's link sliders, and Related Notes' settings

1. `notesGraphHtml.ts`: §2.7 markup, `.slider-end` CSS, nested
   **Advanced** `<details>`, `bindSlider(id, key, null, …)` with
   `aria-valuetext`. Reset (`resetGraphSettings`) must also refresh
   `aria-valuetext`; it calls the same updater.
2. `package.json`: three descriptions, `"tags": ["advanced"]`.

---

## 5. Tests

All four suites must pass by exit code at each commit: `npm test`,
`npm run test:ui`, `npm run test:e2e`, `npm run test:layout`.

### `npm test` (vscode-test, `src/test`)

New `src/test/notify.test.ts` (pure functions only, as the suite already
tests `describeRollover` and `describeUnregisteredSetting`):

- `describeFailure` puts the fix after the outcome, adds **Open Log** last
  only when there is an error, never puts the error's text in the message,
  and allows one action.
- `describeStale(['a.md'])` is exactly `a.md changed after Deckard last read
  it, so nothing was written.`; three names give `3 notes changed after
  Deckard last read them, so nothing was written.`
- `settingLabel`: `exclude` → `Exclude`, `agenda.query` → `Agenda: Query`,
  `mcpServer.port` → `MCP Server: Port`, `templatesFolder` →
  `Templates Folder`.

Updated:

- `settings.test.ts:52-53`: still matches `Quit and reopen VS Code`; now
  matches `"Agenda: Group By" setting` and **not** `deckard\.agenda`.
- `bulk-edit.test.ts:168-179`: the four cases of the table in §3, including
  `1 was already as you asked.` and the Warning wording, and
  `bulkEditSeverity` for each.
- `rollover.test.ts`: unchanged (`describeRollover` keeps its text).
- `dashboard-widgets.test.ts:147`: `Namespaced tags`.
- `notes-graph-behavior.test.ts`: `says what each control does` matches the
  new tooltips (`/strongest links are drawn/`, `/tag on a few notes/`);
  a new test: the three sliders have no `<output>`, carry `aria-valuetext`
  that changes with the value, and `tag-specificity`, `bridge-strength`,
  `show-all-links` sit inside a closed `details` whose summary is
  `Advanced`, while `link-density` does not.
- `messages-rendering.test.ts:70-73`: ids unchanged, still passes.
- A new extract test in `source-commands.test.ts` (it already exercises
  source writes against a real workspace): with a save that throws and a
  rollback that fails (stub `applyEdit` on the second call), the new note
  **still exists**. If stubbing the save proves impractical in the host,
  the three-way result is tested through `replaceSectionWithLink` alone.

`src/test/naming.test.ts` — extended (8e). It already reads webview
sources; add host sources (`src/extension.ts`, `src/ui/commands`,
`src/ui/views`, `src/ui/preview`, the non-`Html` files in `src/ui/webview`,
and `src/ui/state`). A small `literals(source)` helper returns every
quoted string with `${…}` removed.

1. **Toast buttons open rather than show**: every `choice === '…'` /
   `confirm === '…'` literal and every `title: '…'` inside a
   `MessageAction` does not start with `Show `.
2. **A notification never carries a raw error**: no
   `show(Information|Warning|Error)Message(` call body contains
   `String(error)` or `.message`.
3. **A saved search is a search**: no literal matches
   `/saved filter|Deckard filter|as a view/i`.
4. **Entity stays in the code**: no literal after `label:`,
   `placeHolder:`, `placeholder:`, `description:`, `prompt:`, or
   `tooltip:`, and no literal inside a notification call, matches
   `/\bentit(y|ies)\b/i`.
5. **A setting is named in words**: no literal containing a space also
   contains `/\bdeckard\.[a-z]\w*(\.\w+)*\b/`. (A bare `'deckard.exclude'`,
   the argument to `openSettings`, has no space and passes.)
   `package.json` descriptions are not read; their `#deckard.x#` form is a
   link.
6. **The severity rule, where it can be read**: no
   `showInformationMessage(` or `showWarningMessage(` call body contains
   `could not` together with `nothing was written` (a sentence that says
   nothing was written is an Error); and every `reportStale`-shaped
   sentence goes through `describeStale` (no other literal contains
   `changed after Deckard last read`).

### `npm run test:ui`

`verifyWebviews.js` renders the Notes Graph: the new markup must keep the
CSP and script checks green; `checkContrast.js` covers `.slider-end`
(muted text on the panel; `--muted` already passes AA elsewhere).

### `npm run test:e2e`, `npm run test:layout`

No e2e asserts the changed strings (checked with grep). `checkLayout.js`
renders `notesGraph` (`test/ui/pages.js:49`): the overlay's width contract
must hold with the two end labels; run it, and narrow `.slider-end` if the
row overflows at 320px.

### Visual baselines

None to re-record. `test/ui/visual-baseline/darwin` holds only
`sidebarNotes`, `taskBoard`, and zen `searchPage`; none shows a changed
string (the board's Save button is unchanged).

---

## 6. Docs

**README.md**

- `## Limitations and troubleshooting` (line 1047): one bullet, "**A
  message offers Open Log**: when something fails, the message says what
  did not happen and what to do; the details are in Deckard's log."
- Line 462 (Notes Graph Display): rewrite the sentence with **Links per
  note**, and **Advanced** holding **Favor rare tags**, **Links between
  groups**, and **Show every link**.
- Lines 1029–1031 (settings table): the three new descriptions.
- Line 137 (Link Current Heading row): "Adds a person, project, topic,
  organization, or meeting tag to the current heading." (drops "canonical").
- Tasks view section: one sentence, "When the Tasks view's search finds
  nothing, the view says so and offers **Show every open task**."
- Saved searches section: say "Save search" where it says save.

**Help (`src/ui/webview/helpHtml.ts`)**

- Line 313's note: add "When something fails, its message offers **Open
  Log**."
- Line 66's command blurb for `deckard.linkCurrentHeading`: "Adds a person
  or project tag to this heading."
- The Notes Graph section, if it names the sliders: the new names.

**CHANGELOG `## Unreleased`**, one entry per commit under `### Changed`
(or `### Fixed` for commit 2):

- **A failure says what did not happen, and what to do.** … the details go
  to Deckard's log, with **Open Log**; extracting a heading that cannot be
  saved keeps the new note and says which to keep.
- **A note that changed underneath is said one way.** "{name} changed after
  Deckard last read it, so nothing was written.", with **Open Note**; a
  task edit that VS Code refuses is no longer silent.
- **Settings are named in words, with Open Setting**; the Tasks view offers
  **Show every open task** when its search finds nothing.
- **One rule for a message's weight**: an error wrote nothing, a warning
  wrote with a caveat; a message that only asks for a note to be open is
  information. Capture keeps the words with **Copy Task** when it cannot
  add them.
- **"Save search" everywhere**, and quick picks, Home, and toasts use the
  pages' names.
- **The Notes Graph's link sliders say what they do**, and Related Notes'
  tuning settings are in plain words and marked advanced.

**docs/components.md**

- New `### Messages` under Conventions (§2.1), naming `notify.ts`'s helpers
  in a table like **Host-side helpers**.
- The naming table: a row "A toast button says Open, and names a place |
  Open Stats, Open Tasks View | Show Stats".

---

## 7. Commits

Each is shippable alone and verified with the four suites.

1. `feat: a failure says what did not happen, and keeps the details in the log`
2. `fix: a note that changed underneath is said one way, with the note to open`
3. `feat: a setting is named in words with a button that opens it, and the Tasks view offers every open task`
4. `fix: a message's weight follows one rule, and capture keeps the words it could not add`
5. `fix: saving a search says search, and quick picks, Home, and toasts use the pages' names`
6. `feat: the Notes Graph's link sliders say what they do, and Related Notes' settings are in plain words`

---

## 8. Size, risks, dependencies, questions

**Size:** commit 1 M (1.5 d), 2 S–M (1 d), 3 S (0.75 d), 4 S (0.75 d),
5 S (0.5 d), 6 S (0.5 d). **About 5 days.**

**Risks**

- **More red toasts.** The rule makes 42 messages Errors (plus the by-outcome ones when they fail), up from 16,
  including a refused board drop and "already exists". That is the rule
  David approved; see the one question below.
- **Keeping the new note on a half-write** changes what is on disk after a
  failure. It is the safer state (the heading is in two files rather than
  in an unsaved buffer), and the message says which to delete.
- **`@id`-free setting search**: `openSettings` with `deckard.x` can match
  more than one setting when one key prefixes another
  (`dailyNote.rollover` / `dailyNote.rolloverDays`). Acceptable; it is how
  `extension.ts:233` works today.
- **The naming test's regexes** read source text; a label built at runtime
  escapes them. They are a floor, as the existing ones are.
- **`settingLabel` must match VS Code's**: VS Code splits camelCase and
  capitalizes; the `MCP` exception makes ours differ ("Mcp Server: Port" in
  the editor). Accepted: the words still find the setting, and the button
  opens it.

**Dependencies**

- **Piece 1** edits `taskEditor.ts` (Done writing a repeat) and
  `rollover.ts` (copy mode): same files, different lines; land Piece 1
  first, as the plan's order says.
- **Piece 2** owns date prompts and their validation; untouched here.
- **Piece 3** changes the Tasks view (`agendaTree.ts`); 8d's
  `getChildren` changes are small. Land after Piece 3 or rebase.
- **Piece 6** (Capture remembers): if it keeps the last capture's text,
  **Copy Task** could become **Try Again**; the button is one line either
  way.
- **Piece 9d** replaces native `title` tooltips; 8f's new tooltips go
  through whatever 9d provides if it lands first.
- **Piece 12a/12b** edit the Notes Graph controls and legend in the same
  file; 8f touches only the Display group.
- **Piece 11d** edits the first-index toast beside #1 in `extension.ts`.

**Open question for David** (one; the default is what the plan builds)

- A card dropped on a board column that cannot take it (for example a due
  date written in the sentence) wrote nothing, so by the rule it is an
  **Error**, red, where today it is Information. Keep it an Error, or make
  refused drops the one exception and leave them Information? Default:
  Error, as the rule says.
