# 13 — Parked notes

Implementation plan for the larger feature **Parked notes** in
`docs/ux-fifteen-sources-plan.md` ("Larger features the sources point to",
sources N, O, H; tagged Pieces 3 and 12 in "Where the sources agree").
Written against `dev` at `726d23b` (v1.22.0). Every claim below was checked in
the source; file:line references are to that commit.

---

## 1. Scope

**Covered.** The whole feature row:

- a setting that parks folders (globs) and tags;
- `is:parked` in the query language (parser, evaluator, completions, builder);
- parked items left out of: the Tasks view, the status bar (and the daily
  reminder, which reads the same counts), the Task board's default, Home's task
  widgets, rollover, stale tasks (Home's *Stale tasks* widget and Piece 3's
  "Needs a new date" group), the calendar, the review's *Slipped* section,
  Related Notes, the Notes Graph, tag completion, and Refine's tag chips;
- parked items kept, but ranked last, in Find, search pages, saved-search
  widgets, and `[[` completion;
- **Park Note / Park Folder / Park Tag** and their Unpark counterparts, in the
  Explorer, the editor tab, the palette, every webview tag menu, a search
  card's menu, and the Outline.

**Verified before planning.**

| Claim | Status |
| --- | --- |
| "Today the only choice is `deckard.exclude`, which removes them from search as well." | True. `createExcludeMatcher` (`scanner.ts:469`) drops the file before it is read (`scanner.ts:91-96`, `isNotesFile` at `:300`); nothing of an excluded note reaches the index. README's own example of `deckard.exclude` is `"**/archive": true` (`README.md:927, 982`) — the exact case parking is for. |
| Nothing named parked/archive exists | True: `grep -ri "parked\|archiv" src package.json` finds only the README example. |
| One choke point for the Tasks view, status bar, Home agenda, and Reschedule All | True: `selectAgendaTasks` (`agendaState.ts:123`) feeds `agendaTree.ts:174, 552`, `taskStatusBar.ts:29`, `dashboardWidgets.ts:171`; `listOverdueTasks` (Reschedule All) goes through it too. |
| Board default is `is:open` | True: `DEFAULT_TASK_BOARD_QUERY` (`taskBoard.ts:41`); `selectTasks` (`taskBoardState.ts:505`). |
| Task statuses are tags | True: a status is `#status/<name>` read from the task's own tags (`taskBoardState.ts:495-502`), so Piece 3's `someday`/`waiting` statuses are tags too. |
| Tag menus exist in the webviews | True, one shared menu (`components.ts:1443-1470`), with one item, *Rename tag*, on search pages, the sidebar, and Home (`searchPageHtml.ts:487`, `sidebarNotesHtml.ts:549`, `dashboardHtml.ts:548`). No `explorer/context` menu exists yet. |
| Moving a note keeps its links | True: `onWillRenameFiles` in `linkMaintenance.ts:256`. |

**Changed from the plan's one-liner, after verification.**

- **The default parking tag is `#parked`, not `#someday` or `#archived`.**
  Both of those are tags people already write. Shipping either as a default
  would make tasks silently vanish from the Tasks view on upgrade. `#parked`
  is used by nobody today, so the upgrade changes nothing until someone parks
  something; anyone who wants `#archived` or `#someday` adds it to the list.
- **"Park note" tags the note; it does not move it.** See Design §2.2.
- **Tag completion and Refine** leave out *tags every use of which is parked*,
  not the parking tags only (a parked project's tags are what clutters
  completion).

Nothing dropped.

---

## 2. Design

### 2.1 What is parked

One sentence, used in Help, README, and the setting description:

> A note, heading, or task is parked when it is in a parked folder, or when a
> search for a parked tag would find it.

Concretely, computed once per index snapshot:

- **A file** is parked when its path matches `deckard.parked.folders`, or its
  front matter carries a parked tag. Every section and task in it is parked.
- **A section or task** is parked when its file is parked, or when the query
  `tag = <t> OR tag = <t>/*` (for each parked tag `t`) matches it — i.e. with
  exactly the inheritance a search already uses: front-matter tags, heading
  tags inherited down the heading tree, a task's own tags, and a body-line tag
  answering for the entry that contains it (`queryEvaluator.ts:318-400`).
- **A tag** is *parked-only* when every section, task, and file in its
  `TagInfo` is parked. This is what completion, Refine, the graph, and Home's
  tag widgets consult.
- A parked tag parks its sub-tags: `project/old` parks `#project/old/phase-1`.
  Tags are matched case-insensitively, with or without the `#`, and `@person`
  tags can be parked too.

`deckard.exclude` wins. An excluded note is never read, so it cannot be parked
or found. Parking is the choice for "out of my way, but still searchable";
excluding is for "not notes at all" (build output, vendored docs).

**Status `someday` (Piece 3) vs parked.** Piece 3's 3g makes `is:available`
leave out tasks whose status is in its setting (default `waiting, someday`).
That is per task, and those tasks stay in the Tasks view. Parking is per
note, folder, or tag, and takes things out of the Tasks view. Because statuses
are tags, a user who wants someday tasks gone from the Tasks view entirely adds
`status/someday` to `deckard.parked.tags` — Help says so. `is:available` must
also be false for a parked task (see §7, dependency on Piece 3).

### 2.2 What "Park Note" does physically

**It writes the first tag of `deckard.parked.tags` into the note's front
matter** (`tags: [parked]`). It does not move the file. Why:

- A move changes the path: external links, bookmarks, git blame, and other
  tools (Obsidian, a static site) all break or churn, and link rewrites touch
  every note that links to it, which is a multi-note write for a one-note act.
- A tag travels with the file, syncs, shows in the note itself, is reversible
  by deleting one word, and needs no configuration.
- Moving still works for anyone who files by folder: park the archive folder
  once, then drag notes into it in the Explorer; `onWillRenameFiles` already
  keeps their links. Help says this.

Unpark Note removes every parked tag from the front matter's `tags:` (or
`tag:`) field. If the note is parked some other way it says how instead (see
the strings below).

### 2.3 Settings

Both in the **General** group, directly after `deckard.exclude` (order 12, 13;
`developerMode` moves to 14).

| Name | Type | Default | Scope |
| --- | --- | --- | --- |
| `deckard.parked.folders` | object, `additionalProperties: boolean` | `{}` | `resource` |
| `deckard.parked.tags` | array of string | `["parked"]` | `window` |

`deckard.parked.folders` markdownDescription:

> Glob patterns of folders and notes Deckard parks, written like
> `#deckard.exclude#`. A parked note stays indexed and searchable — `is:parked`
> finds it, and Find and search pages list it last — but is left out of the
> Tasks view, the status bar, the Task board, rollover, the calendar, Related
> Notes, the Notes Graph, and tag completion. Each pattern is relative to the
> workspace folder and applies when set to `true`; a pattern that matches a
> folder parks everything in it. `#deckard.exclude#` wins: an excluded note is
> not indexed at all.

`deckard.parked.tags` markdownDescription:

> Tags that park whatever carries them: a note whose front matter has one, a
> heading and everything under it, or a task. A tag parks its sub-tags too, so
> `project/old` parks `#project/old/phase-1`. **Park Note** writes the first of
> these into the note's front matter. Parked items stay searchable with
> `is:parked`.

Folders mirror `deckard.exclude` (same shape, same matcher, same Settings UI
"Add Pattern" editor). Tags are workspace-wide because the index is.

### 2.4 Query syntax

- `is:parked` — any note entry, front-matter-only note, or task that is parked.
  Unlike the other task-only `is:` values it matches notes as well as tasks
  (like `is:note`). `-is:parked` / `NOT is:parked` for the reverse. No aliases.
- Parser diagnostic becomes: `is: accepts open, done, task, note, overdue, due,
  blocked, blocking, mine, assigned, unassigned, or parked — not "x".` (Piece 3
  adds `available`; whichever lands second appends.)
- Completion row (`dashboardState.ts:1559` list): `{ value: 'is:parked', label:
  'is:parked', detail: 'Notes and tasks that are parked' }`.
- The builder reads `QUERY_IS_VALUES` (`queryTypes.ts:72`), so adding
  `'parked'` there gives builder parity.

**The one rule for task lists.** A list of things to do — the Tasks view, the
status bar, the board, Home's *Tasks*, *Tasks view*, and *Stale tasks*
widgets, the calendar, rollover, the review's *Slipped* — leaves parked tasks
out **unless its own search mentions `is:parked`** (positively or negatively).
So `deckard.agenda.query = "is:parked"` or a board search `is:open is:parked`
shows exactly the parked ones.

**Searches keep them.** Search pages, Home's saved-search widget, Find, `[[`
completion, query blocks, and the AI tools return what the query says, with
parked results after the rest.

### 2.5 Every surface, and what it does

| Surface | Code | Behavior |
| --- | --- | --- |
| Tasks view, status bar, Reschedule All, daily reminder, Home *Tasks view* widget | `selectAgendaTasks` (`agendaState.ts:123`) | Leaves parked out unless the agenda query mentions `is:parked`. |
| Task board | `selectTasks` (`taskBoardState.ts:505`), facets at `:153` | Same rule. Refine gains a **Parked (N)** value counting the open tasks the rule left out; selecting it writes `is:parked`. |
| Home *Tasks* widget | `dashboardWidgets.ts:144` | Same rule on the widget's query. |
| Home *Stale tasks* widget | `dashboardWidgets.ts:325` | Leaves parked out. |
| Piece 3 "Needs a new date" group | via `selectAgendaTasks` | Nothing extra: parked never reaches it. |
| Calendar | `calendarState.ts:102` | Due counts and titles leave parked out. Plan 15's day panel reads the same filter. |
| Rollover | `rollover.ts:75` | A parked task stays where it is. |
| Review | `reviewState.ts:89` (*Slipped*) | Leaves parked out; *Done* keeps them (history). Piece 3i's *Coming up* leaves them out. |
| Gone quiet / People gone quiet | `peopleRecency.ts:32` | A person or tag whose every use is parked is not listed; open-task counts ignore parked tasks (so a parked project is never a "stuck project" in 3j). |
| Home *Tags without a hub* | `dashboardWidgets.ts:391` | Leaves parked-only tags out. |
| Search pages, Home saved-search widget | `createSearchPageSnapshot` (`dashboardState.ts:195`) | Keeps parked, sorted after the rest in both notes and tasks, each card marked **Parked**. Refine gains a **Parked** facet (*Parked*, *Not parked*) when the results mix both; the Tags facet leaves parked-only tags out unless the query mentions `is:parked`. |
| A parked tag's own page | `searchPageHtml.ts:373` (entity meta) | A line under the title: **Parked.** *Its notes and tasks are left out of the Tasks view, the Task board, and Related Notes.* with an **Unpark** button. |
| Find | `rankEntries` / `compareRanked` (`quickFindState.ts:192, 331`) | Parked notes, tasks, and parked-only tags rank after every unparked one; the row's description ends `· Parked`. |
| `[[` completion | `completeNotes` (`linkSuggestions.ts:132`) | Parked notes sort last; detail `Parked`. |
| Related Notes | `rankRelatedNotes` (`relatedNotesRanking.ts:166`) | Leaves parked notes and entries out, **unless the active note is parked** (then they are ranked after the unparked ones). The *Links here* list keeps parked notes — a link is a fact — sorted last and marked **Parked**. Home's *Related notes* widget follows. |
| Notes Graph | `createNotesGraphSnapshot` (`notesGraphState.ts:36`), filters `notesGraphHtml.ts:115-118, 329` | Nodes carry `parked: true`. A new toggle **Show parked**, off by default, under *Show orphans*. The note the local graph is centered on is always drawn. |
| Tag completion | `tagSuggestions.ts:130` | Leaves parked-only tags out, **unless the note being edited is parked**. |
| Stats | `dashboardState.ts:470, 550` | *Notes nothing links to* leaves parked notes out (an archive is expected to be unlinked). A line under the totals: **Parked: 312 notes, 41 open tasks** linking to the `is:parked` search; absent when nothing is parked. Plan 12's *Needs attention* inherits the orphan rule. |
| Check My Setup | `checkSetup.ts` | One line: `312 notes are parked: 290 by deckard.parked.folders and 22 by a parked tag.` Warns when every indexed note is parked: `Every note is parked, so the Tasks view and Related Notes will be empty. Check deckard.parked.folders.` |
| Query blocks, AI tools / MCP | evaluator | Unchanged: `is:parked` works, nothing hidden (they are searches). |
| Editor decorations, lenses, link health, unlinked mentions, pins, favorites, recent notes | — | Unchanged: they are facts or explicit choices. |

### 2.6 Commands

| Command id | Title (palette, category Deckard) | Where |
| --- | --- | --- |
| `deckard.parkNote` | Park Note | Palette (`editorLangId == markdown && !deckard.activeNoteParked`), editor tab context, Explorer on `.md` (`resourceExtname == .md && !(resourcePath in deckard.parkedNotePaths)`), search card ⋯ menu |
| `deckard.unparkNote` | Unpark Note | Same places, inverse `when` |
| `deckard.parkFolder` | Park Folder… | Palette (quick pick of folders that hold notes, most notes first), Explorer on folders (`explorerResourceIsFolder && !(resourcePath in deckard.parkedFolderPaths)`) |
| `deckard.unparkFolder` | Unpark Folder… | Palette (pick from the setting's patterns), Explorer inverse |
| `deckard.parkTag` | Park Tag… | Palette (quick pick of tags with counts), every webview tag menu, Outline heading menu (`viewItem == deckardOutlineTagged`) |
| `deckard.unparkTag` | Unpark Tag… | Palette (pick from the list), tag menus when the tag is listed |

Explorer group: `7_deckard@1` (note) / `@2` (folder). Explorer multi-select
passes `(uri, uris)`; both note and folder commands handle several at once.

Context keys, set on every index update and on `deckard.parked` changes:
`deckard.activeNoteParked` (boolean, like `deckard.activeNotePinned`),
`deckard.parkedNotePaths` (object keyed by fsPath, notes parked by a
front-matter tag — bounded by what was parked by tag), and
`deckard.parkedFolderPaths` (object keyed by fsPath: every ancestor folder of
an indexed note that a pattern matches). Notes parked only by their folder are
not in `parkedNotePaths`; *Park Note* on one says so (below).

Webview tag menu: `openTagContextMenu` builds `[Rename tag, Park tag]`, or
`Unpark tag` when the key is in the page's `parkedTags` (the listed tags,
resolved to index keys, sent in each page's state as `parkedTags: string[]`).
Messages: `{ type: 'parkTag' | 'unparkTag', tagKey }`, validated in
`messages.ts` like `renameTag`. Card menu: `Park note` / `Unpark note` from the
card's `data-parked`, posting `{ type: 'parkNote' | 'unparkNote', filePath }`.

### 2.7 Strings (exact)

Park Note (one note, notification with **Undo**):
`Parked "Atlas kickoff". It stays searchable with is:parked.`
Several: `Parked 4 notes. They stay searchable with is:parked.`
Undo goes through `Deckard: Undo Last Change` (the write is an
`applyWorkspaceWrite` with label `parking 4 notes`), so the button calls
`undoLastWorkspaceWrite`.

Already parked by folder:
`"Atlas kickoff" is already parked: it is in notes/archive, which is parked.`
— buttons **Unpark Folder**.

Unpark Note on a note parked by its folder:
`"Atlas kickoff" is parked by its folder, notes/archive.` — **Unpark Folder**.

Unpark Note on a note parked by a listed tag other than the first:
`"Atlas kickoff" is parked by its tag #project/old.` — **Remove the Tag from
This Note**, **Unpark #project/old**.

Unpark Note done: `Unparked "Atlas kickoff".` / `Unparked 4 notes.`

Not a note: `Deckard does not index README.md, so there is nothing to park.`

Park Folder: `Parked notes/archive and its 34 notes. They stay searchable with
is:parked.` — **Undo** (restores the setting's previous value).

Folder is excluded:
`notes/archive is left out by deckard.exclude, so Deckard does not index or
search it. Park it instead to keep it searchable.` — **Park Instead**,
**Open Setting**. *Park Instead* removes the exact `deckard.exclude` key and
adds the parked key in one step; when the folder is excluded by a broader
pattern it opens the setting instead.

Unpark Folder parked by a broader pattern:
`notes/archive is parked by the pattern **/archive.` — **Open Setting**.

Unpark Folder done: `Unparked notes/archive and its 34 notes.`

Park Tag: `Parked #project/old: 23 notes and 9 tasks. They stay searchable
with is:parked.` — **Undo**.
Already parked through a parent: `#project/old/phase-1 is already parked
through #project/old.` — **Unpark #project/old**.
Unpark Tag: `Unparked #project/old.`

Card label: `Parked`, title attribute `Parked: left out of the Tasks view, the
Task board, and Related Notes.`

Graph toggle: label `Show parked`, title `Show parked notes, tasks, and tags.
They are hidden unless this is on.`

Refine: facet label `Parked`, values `Parked` (`is:parked`) and `Not parked`
(`-is:parked`). Board: value `Parked` (`is:parked`).

Setting targets: a write goes where the setting is already defined most
specifically (workspace-folder, workspace, then user); when nowhere, to the
workspace (to the workspace folder for `parked.folders` in a multi-root
workspace). No workspace open: the commands are hidden
(`workspaceFolderCount > 0`).

---

## 3. Implementation steps

### 3.1 Core: parked state (commit 1)

- **`src/core/types.ts`**: `WorkspaceIndex.parked?: ParkedState`, where
  `ParkedState = { files: Set<string>; sections: Set<string>; tasks:
  Set<string>; tags: Set<string> /* parked-only */; byFolder: number; byTag:
  number }`. Optional, so every existing `buildWorkspaceIndex` caller and test
  is unchanged (nothing parked).
- **`src/core/workspace/parked.ts`** (new, pure):
  - `ParkedRules = { isParkedPath(filePath: string): boolean; tags: string[] }`
    (tags canonical: trimmed, `#` added unless it starts with `#`/`@`,
    lowercased for matching).
  - `computeParked(index, rules): ParkedState` — files by path or front-matter
    tag; then `evaluateQuery(index, node)` with a node built directly (not
    parsed) as `OR` of `tag = t` and `tag = t/*` per tag, which reuses the
    evaluator's inheritance exactly; union with everything in parked files;
    then parked-only tags from `index.tags`. Empty rules short-circuit to an
    empty state (no evaluator pass).
  - Helpers every surface uses: `isParkedTask(index, id)`,
    `isParkedSection(index, id)`, `isParkedFile(index, path)`,
    `isParkedOnlyTag(index, key)`, `withoutParked(tasks, index)`,
    `parkedLast(items, isParked)` (stable partition),
    `mentionsParked(node)` (walks the AST for an `is` condition whose value is
    `parked`).
- **`src/core/workspace/scanner.ts`**: `getParkedRules(): ParkedRules`.
  `isParkedPath` maps a filePath to its workspace folder (multi-root paths are
  prefixed with the folder name, `scanner.ts:210-214`) and runs
  `createExcludeMatcher(config.get('parked.folders'))` for that folder — the
  same matcher as exclude, so a folder pattern covers its contents.
- **`src/core/workspace/indexer.ts`**:
  - `getSnapshot()` attaches `index.parked = computeParked(index,
    this.scanner.getParkedRules())` inside the same `measure` (log "… , N
    parked").
  - The configuration listener (`indexer.ts:290-318`): on
    `affectsConfiguration('deckard.parked')`, clear `this.snapshot` and
    `emitUpdate()` — no rescan.
- **Query language**: `queryTypes.ts:72` add `'parked'`; `queryParser.ts:103`
  alias `parked: 'parked'`, diagnostic text at `:654`; `queryEvaluator.ts`:
  `QueryUnit.parked?: boolean` set in `createSectionUnit`, `createTaskUnit`,
  `createFileUnit` from `index.parked` (the file unit needs `index` passed
  in); `matchesIs` answers `parked` before the task-only guard.
  Guard against recursion: `computeParked` never uses `is:parked`, and
  `evaluateQuery` reads `index.parked` only when present.
- **Completions**: `dashboardState.ts:1559` row and `:1594` sentence.
- **package.json**: the two settings (§2.3).

### 3.2 Task lists leave parked out (commit 2)

- `agendaState.ts` `selectAgendaTasks`: after choosing, `if
  (!mentionsParked(parsed.node)) tasks = withoutParked(tasks, index)`. Covers
  the Tasks view, status bar, reminder, Reschedule All, and Home's agenda
  widget.
- `taskBoardState.ts` `selectTasks`: same; return `{ tasks, parkedLeftOut }`
  (open parked tasks the rule removed that the query otherwise matched —
  evaluate once, partition). Pass `parkedLeftOut` into `buildSearchFacets`
  via a new `FacetOptions.parkedLeftOut`; `searchFacets.ts` appends facet
  `parked` (`Parked`, one value `is:parked`) when > 0. The facet also shows
  on the board when the query is the default `is:open` (today facets are
  skipped for an empty query at `:152`; the default is `is:open`, which is not
  empty, so it already shows).
- `dashboardWidgets.ts`: *Tasks* (`:144`) same rule; *Stale tasks* (`:325`)
  `withoutParked`; *Tags without a hub* (`:391`) skip parked-only tags.
- `calendarState.ts:102`, `rollover.ts:75`, `reviewState.ts:89`: skip
  `isParkedTask`.
- `peopleRecency.ts:32-90`: ignore parked tasks in counts and last-written;
  skip parked-only tags.
- Edge cases: a parked task that another task depends on still counts as an
  open dependency (`is:blocked` is a fact; the blocked task is not parked).
  Dropping a card on the board and the Tasks view's drag targets only ever see
  unparked tasks, so no write path changes.

### 3.3 Searches rank parked last (commit 3)

- `types.ts`: `TagOverviewCard.parked?: boolean`, `DashboardTask.parked?:
  boolean`, `QuickFindItem` description suffix only.
- `dashboardState.ts` `createSearchPageSnapshot` (`:195-275`): set `parked` on
  each card/task; sort with `parkedLast` wrapped around
  `compareTagOverviewCards` and `sortTasks`. **Coordinate with Piece 4e**,
  which moves card building after `takePage`: `parked` must be one of 4e's
  "light keys" so the partition happens before paging.
- `searchFacets.ts`: facet `parked` (`Parked`/`Not parked`) when results mix;
  `countTags` skips parked-only tags unless `mentionsParked`.
- `searchPageHtml.ts:276` and the task renderer in `components.ts`: a
  `<span class="parked-label" title="…">Parked</span>` in the card header /
  task meta. `.parked-label` in `getSurfaceCss()`: `--muted` text, no border,
  the existing small-meta size (no new token).
- `quickFindState.ts`: `RankedEntry.parked`; `compareRanked` (`:331`) puts
  parked after unparked before comparing scores; description gets
  `· Parked`; `matchTags` ranks parked-only tags last.
- `linkSuggestions.ts:132` `completeNotes`: parked notes sort after the rest;
  `item.detail = 'Parked'` appended.
- `dashboardWidgets.ts` *Saved search* widget inherits the order from
  `createSearchPageSnapshot`.

### 3.4 Related Notes, graph, completion, Stats (commit 4)

- `relatedNotesRanking.ts` `rankRelatedNotes` (`:188`): skip parked files and
  parked sections unless `isParkedFile(index, activeFilePath)`; in that case
  keep them and sort parked after unparked in `sortRelatedNotes`. *Links here*
  list: keep, sort last, pass `parked` to the sidebar card, which renders the
  same `.parked-label`.
- `types.ts` `NotesGraphNode.parked?: true`; `notesGraphState.ts` sets it for
  section/task/file nodes and parked-only tag nodes. `notesGraphHtml.ts`:
  toggle row after `show-orphans` (`:118`), `settings.showParked = false`,
  filter at `:329` (`if (node.parked && !settings.showParked &&
  node.id !== focusId) return false;`), `bindToggle('show-parked',
  'showParked', false)`, added to the reset list at `:1908`.
- `tagSuggestions.ts:130`: filter `!isParkedOnlyTag` unless
  `isParkedFile(index, indexer.getFilePath(document.uri))`.
- Stats: `dashboardState.ts:550` orphans skip parked; `StatsSnapshot.parked?:
  { notes: number; openTasks: number }`; `statsHtml.ts` renders the line as a
  `.row` link posting the existing open-search message with `is:parked`.
- `checkSetup.ts`: the line and the all-parked warning (§2.5), from
  `index.parked.byFolder/byTag`.

### 3.5 Commands (commit 5)

- **`src/core/markdown/frontmatterTags.ts`** (new, pure):
  `addFrontmatterTag(content, tag): string | undefined` and
  `removeFrontmatterTags(content, tags): string | undefined` (undefined = no
  change). Handles: no front matter (prepends `---\ntags: [parked]\n---\n`),
  `tags: [a, b]`, `tags: a`, a YAML block list (`tags:\n  - a`), `tag:` as the
  field name, quoted values, `#`-prefixed values, CRLF line endings kept,
  case-insensitive "already there". Removing the last value removes the
  `tags:` line; removing the only line of a front matter the command created
  removes the empty `---`/`---` block. Reuse `getFrontmatterBounds` and
  `splitValues` by moving them from `moveTagsToFrontmatter.ts` into this
  module and importing them back.
- **`src/ui/commands/parking.ts`** (new): `parkNotes(uris)`,
  `unparkNotes(uris)`, `parkFolders(uris)`, `unparkFolders(uris)`,
  `parkTag(tagKey?)`, `unparkTag(tagKey?)`, and `ParkingContext` (the three
  context keys, updated on `indexer.onDidUpdate` and editor changes, like
  `pinNote.ts:186-203`).
  - Notes: one `vscode.WorkspaceEdit` over all chosen notes →
    `applyWorkspaceWrite(edit, { label: 'parking N notes' })`, which previews
    when more than one note, per `deckard.previewWorkspaceWrites`.
  - Folders: relative path via `vscode.workspace.asRelativePath(uri, false)`;
    `deckard.exclude` check with `createExcludeMatcher`; write
    `{ ...current, [relative]: true }` to the target (§2.7). Undo restores the
    previous object. Counting notes: files in `index.files` under the folder.
  - Tags: `inspect('parked.tags')`, append the tag's label without `#` for
    `#` tags (`project/old`) and with `@` for people; undo restores.
- **`extension.ts`**: register the six commands and `ParkingContext`.
- **package.json**: commands, `explorer/context`, `editor/title/context`,
  `commandPalette` `when`s, `view/item/context` for the Outline.
- **Webviews**: `components.ts` `openTagContextMenu` adds the park item from
  a page-level `parkedTagKeys` set (`setParkedTags(keys)` helper called from
  each page's state handler); `messages.ts` accepts `parkTag`, `unparkTag`,
  `parkNote`, `unparkNote`; `searchPage.ts`, `sidebarNotes.ts`,
  `dashboard.ts` route them to the commands. Each page's state gains
  `parkedTags`. Search card menu (`searchPageHtml.ts:313-318`) adds
  `Park note`/`Unpark note` from `data-parked`.
- Tag page line (§2.5): `searchPageHtml.ts:373`, shown when the focus tag is
  listed; its **Unpark** button posts `unparkTag`.

---

## 4. Tests

All four suites gate on exit codes: `npm test`, `npm run test:ui`,
`npm run test:e2e`, `npm run test:layout`.

**`npm test`** (`src/test`):

- `parked.test.ts` (new): folder pattern parks a note's sections, tasks, and a
  front-matter-only file; front-matter tag parks the whole note; heading tag
  parks the heading, nested headings, and their tasks, not its siblings;
  body-line tag parks only its entry; `project/old` parks
  `#project/old/phase-1` but not `#project/older`; `#Parked`, `parked`, and
  `#parked` all match; `@person` parking; parked-only tags computed; empty
  rules return an empty state without evaluating; multi-root path mapping.
- `query-language.test.ts`: `is:parked` parses; matches parked notes and
  tasks, not unparked; `-is:parked`; the diagnostic lists `parked`;
  `mentionsParked` for `is:parked`, `-is:parked`, nested groups, and absent.
- `query-builder-webview.test.ts`: the builder offers `is:parked` and
  round-trips it.
- `agenda.test.ts`: `selectAgendaTasks` leaves an overdue parked task out;
  query `is:parked` lists it.
- `task-status-bar.test.ts`: counts and the tooltip names ignore a parked
  overdue task.
- `task-board.test.ts`: `is:open` leaves parked out; `is:open is:parked` shows
  only parked; the facet `Parked` carries the left-out count.
- `dashboard-widgets.test.ts`: *Tasks view*, *Tasks*, *Stale tasks*, *Tags
  without a hub* leave parked out; *Saved search* lists them last.
- `calendar.test.ts`, `rollover.test.ts`, `review.test.ts`,
  `people-recency.test.ts`: parked task not counted / not carried / not
  slipped (still done) / person used only in parked notes not listed.
- `search-page-behavior.test.ts`: a parked card with a higher score sorts
  after an unparked one; tasks likewise; `parked` flags set.
- `search-refine.test.ts`: `Parked`/`Not parked` values when mixed, absent
  when not; a parked-only tag is not a Tags value unless the query mentions
  `is:parked`.
- `quick-find.test.ts`: a parked title match ranks after a weaker unparked
  one; description ends `· Parked`.
- `link-suggestions.test.ts`: `[[` puts a parked note after an unparked one.
- `related-notes-behavior.test.ts`: parked candidates left out; kept when the
  active note is parked; *Links here* keeps a parked backlink, last.
- `notes-graph-state.test.ts`: `parked` on nodes and parked-only tag nodes.
- `messages-rendering.test.ts` (jsdom via `webviewPage.ts`): card shows
  `Parked`; tag menu shows `Park tag` / `Unpark tag` by `parkedTags`; graph
  hides parked nodes until `Show parked` is checked and keeps the focus node;
  Stats' parked line appears only when something is parked.
- `tag-suggestions.test.ts`: completion leaves a parked-only tag out, and
  offers it inside a parked note.
- `frontmatter-tags.test.ts` (new): every front-matter shape in §3.5 for add
  and remove, including CRLF and the created-then-emptied block.
- `move-tags-to-frontmatter.test.ts`: still passes after the helper move.
- `workspace.test.ts`: changing `deckard.parked.tags` emits an update without
  a rescan (scanner `scan` not called again).
- `extension.test.ts` / `settings.test.ts`: the six commands are registered
  and contributed; the two settings exist with their defaults and scopes.
- `check-setup.test.ts`, `stats.test.ts`: the parked line, the all-parked
  warning, orphans skip parked.

**`npm run test:ui`**: `verifyWebviews.js` and `checkWebviewScripts.js` cover
the new markup and script; `checkContrast.js` covers `.parked-label` on
`--muted` (already an AA pair, no new token).

**`npm run test:e2e`**: `searchPage.e2e.js` — right-click a tag, choose
*Park tag*, `parkTag` is posted with the key; a card's ⋯ offers *Park note*.
`taskBoard.e2e.js` — the Refine *Parked* value writes `is:open is:parked`.
`sidebarNotes.e2e.js` — the tag menu's park item.

**`npm run test:layout`**: no new contract; runs unchanged.

**Visual baselines**: none expected. `test/ui/pages.js` fixtures contain no
parked note, the label and facet render only when one exists, the graph has
no baseline, and menus are captured closed. If a reviewer wants the label
captured, add one parked card to the search-page fixture in a separate
`test:` commit and re-record the eight `*+zen-searchPage.png` baselines.

---

## 5. Docs

- **README**:
  - New `## Parking notes` after `## Search` (before `## Query blocks`): what
    parking is (the one-sentence rule), the three ways (Park Note writes
    `tags: [parked]`; Park Folder; Park Tag), the table of what leaves and
    what stays (from §2.5, condensed), `is:parked`, "a task list shows parked
    tasks only when its search says `is:parked`", filing by folder (park the
    folder, then drag notes in — links are kept), and **Park or exclude?**:
    exclude for files that are not notes, park for notes you are done with.
  - `## Query language`: `is:parked` row.
  - `## Settings` table: the two settings; the `deckard.exclude` row gains
    "To keep an archive searchable, park it instead."
  - `## Commands`: the six commands.
  - `## Task board` / `## Tasks view`: one sentence each on parked tasks.
  - Troubleshooting: "A task is missing from the Tasks view: it may be
    parked. Search `is:parked`."
- **Help** (`helpHtml.ts`): a card **Parking** in *What counts as a note*
  (`:351`), with the rule, the three commands, and `status/someday`; the
  query table row (`:420`) for `is:parked`; the Notes Graph card mentions
  *Show parked*; the Tasks view card adds "Parked tasks are not listed."
- **CHANGELOG `## Unreleased`**, under `### Added`:
  - **Parked notes.** A note, folder, or tag can be parked: still indexed and
    searchable, with `is:parked` and last in Find and on search pages, but
    left out of the Tasks view, the status bar, the Task board, rollover, the
    calendar, Related Notes, the Notes Graph, and tag completion. **Park
    Note** writes `#parked` into the note's front matter; **Park Folder** and
    **Park Tag** add to `deckard.parked.folders` and `deckard.parked.tags`.
    Each is in the Explorer, the editor tab, and a tag's menu, with Unpark
    beside it. Until now the only way to set notes aside was
    `deckard.exclude`, which hid them from search too.
  (Commits 1–4 each add their own shorter entry; commit 5 folds them into the
  one above.)
- **docs/components.md**: *Surfaces* table gets `.parked-label`; *Page script
  helpers* — `installTagContextMenu` row says the menu offers *Park tag* /
  *Unpark tag* from `setParkedTags(keys)`, and a `setParkedTags` row.

---

## 6. Commits

Each builds, passes all four suites, and ships on its own.

1. `feat: notes, folders, and tags can be parked, and is:parked finds them`
   — §3.1; settings, `parked.ts`, indexer, query language, completions,
   builder; README query row and settings rows; Help query row; CHANGELOG.
   (Nothing is hidden yet; parking only makes `is:parked` match.)
2. `feat: the Tasks view, status bar, board, calendar, and rollover leave parked tasks out`
   — §3.2; README/Help sentences on the Tasks view and board.
3. `feat: search pages, Find, and [[ completion list a parked note last, and say it is parked`
   — §3.3; Refine's Parked facet; `.parked-label` in components.md.
4. `feat: Related Notes, the Notes Graph, and tag completion leave parked notes out`
   — §3.4; Stats line; Check My Setup line; Help graph card.
5. `feat: Park Note, Park Folder, and Park Tag, in the Explorer, the editor, and a tag's menu`
   — §3.5; README `## Parking notes`, `## Commands`, Help *Parking* card,
   components.md tag menu rows, the combined CHANGELOG entry.

---

## 7. Size, risks, dependencies, questions

**Size**: about 6.5 days — commit 1: 1 d; 2: 1.25 d; 3: 1 d; 4: 1.25 d;
5: 2 d (front-matter shapes, setting targets, three webviews' menus).

**Risks**

- *Cost per snapshot.* `computeParked` is one evaluator pass on each index
  rebuild when any rule is set. Measure under the existing `Build index`
  timing on the 5,000-note synthetic workspace (source K); budget ≤ 30 ms. If
  over, match tag keys against `index.tags` membership directly instead of
  running the evaluator.
- *Piece 4e rewrites `createSearchPageSnapshot`.* Whichever lands second
  rebases; `parked` must be a light sort key before paging.
- *Front matter shapes.* YAML variety is the likeliest bug source; the pure
  module and its table of cases carry it, and Unpark never touches a field it
  cannot parse (it says `Deckard could not read the front matter of
  "Atlas kickoff", so it did not change it.`).
- *Setting targets in multi-root.* Writing to the wrong target silently does
  nothing when a more specific value overrides it; the "most specific defined
  target" rule and a test cover it.
- *Context key size.* `parkedNotePaths` holds only tag-parked notes; folder
  parking is expressed by folder paths, so a 3,000-note archive folder adds
  one key, not 3,000.
- *Surprise.* A user who adds `someday` to the tag list sees tasks leave the
  Tasks view — which is what they asked; Park Tag's message states the counts.

**Dependencies**

- **Piece 3** (tasks): 3g `is:available` must also exclude parked
  (`&& !unit.parked`). Recommend Piece 3 rename its setting from
  `deckard.tasks.parkedStatuses` to **`deckard.tasks.onHoldStatuses`**, so
  "parked" means one thing in Deckard; statuses (per task, still listed) and
  parking (per note/folder/tag, not listed) stay distinct. 3a/3b/stale group
  read `selectAgendaTasks`, so they inherit the rule. 3h rollover, 3i *Coming
  up*, and 3j *Gone quiet* must use `withoutParked` / skip parked-only tags —
  if Piece 3 lands first, commit 2 of this plan adds those; if this lands
  first, Piece 3 uses the helpers. `is:` diagnostic text is touched by both.
- **Piece 4** (search results): 4e (above); 4c's "top 5 + more" applies to the
  new Parked facet unchanged.
- **Piece 12** (graph and Stats): 12d *Needs attention*'s unlinked-notes tile
  uses the orphan rule from commit 4; 12b/12c degree and community labels
  should count only visible (unparked unless *Show parked*) nodes.
- **Plan 15** (calendar day panel): its task lists read the same
  `isParkedTask` filter.
- **Piece 1**: none functionally; if 1's scan starts passing excludes to
  `findFiles`, `getLastScan().excluded` still excludes and parking is
  unaffected.

**Open questions for David**: none that block. One default he may want to
overrule: the parking tag is `#parked` (safe on upgrade) rather than
`#archived` or `#someday` (which people already write, so tasks would vanish
on upgrade). Changing it is a one-line default.
