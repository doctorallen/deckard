# Piece 1 — Fix what is broken (1a–1l)

Implementation plan for Piece 1 of `docs/ux-fifteen-sources-plan.md`, checked
against `dev` at `726d23b` (v1.22.0, release PR #36 open). Every claim below was
re-read in the source; line numbers are as of that commit.

---

## 1. Scope

All twelve items are covered. Every one was confirmed. Three were changed after
checking the code:

| # | Verified | Change to the approved plan |
| --- | --- | --- |
| 1a | Confirmed. `searchPageHtml.ts:415`: the `data-mode="markdown"` (Source) button draws `renderedIcon` (the eye) and the `data-mode="html"` (Rendered) button draws `sourceIcon` (`<>`). No other page uses either icon. | None. |
| 1b | Confirmed. `applyRollover` (`rollover.ts:139-155`) dedupes only against today's note. `planRollover` returns every open task in every earlier daily note, so in copy mode Monday's original and Tuesday's copy are both carried on Wednesday. `editorLensState.ts:139` counts the same plan for the daily-note "carry in" lens, so the lens overcounts too. | The dedupe goes in `planRollover` rather than `applyRollover`, so the lens and the command agree. It applies **in copy mode only**. Move mode never leaves copies behind, and there two identical lines may really be two tasks, so merging them would delete one of the user's lines. |
| 1c | Confirmed. `editTaskCommand` (`taskEditor.ts:457-510`) writes `formatTaskDraft(edited)` over one line and never calls `createNextOccurrence`. **Also found:** `assistantWrites.changeTaskLine` (the MCP and LM-tool `complete: true`) uses the same `completeDraft` and drops the next occurrence the same way. Neither path honors `deckard.tasks.addDoneDate`. | The assistant path is added to 1c, since it has the same cause and the same fix. Both paths honor `addDoneDate`. |
| 1d | Partly already done. `toggleTask` (`taskActions.ts:274-278`) already shows a *separate* warning beside the "Completed …" + Undo message, which is two notifications. `bulkEdit.ts:228` and the task editor say nothing. | 1d folds the warning into the one completion message, keeping Undo, and adds the same wording to bulk edit, the task editor, and the assistant. |
| 1e | Confirmed (`tagDecorations.ts:47-53`, white at 0.025/0.18). The band decoration also carries the **"Show related notes / Pin to Home" hover** for every tagged entry. | Banding only the cursor's section must not take that hover away from the other entries, so the hover moves to an invisible decoration type that still covers every entry. |
| 1f | Confirmed. `scanner.ts:82` calls `findFiles(pattern)` with no exclude, which applies `files.exclude` but not `search.exclude`. The matcher (`getExcludeMatcher`, `:369-379`) reads `deckard.exclude` and `files.exclude`. This checkout has **1,024** `.md` files under `node_modules`. `EditorReferences` (lenses and hovers), `EditorTagDecorations`, `WikiLinkCompletionProvider`, `TagCompletionProvider`, `TaskMetadataCompletionProvider`, and `EntityHeadingSuggestions` check only `isMarkdownFile`. `extension.ts:223-227` stores the hint flag in `globalState`. | An escape hatch is added: a `false` entry in `deckard.exclude` takes a pattern back out of the inherited `search.exclude`/`files.exclude` set. Without it, someone who hides `archive/` from search could never index it. |
| 1g | Confirmed (`searchFacets.ts:145-166`). | **Labels changed.** The query engine counts today as day 1 of a window (`queryEvaluator.ts:850`), so the middle bucket holds notes updated 7 to 29 calendar days ago. "8–30 days ago" would put a note from exactly a week ago (Sep 18, seen on Sep 25) under "8–30 days ago". The labels are **"Last 7 days"**, **"1–4 weeks ago"**, **"Older"**. |
| 1h | Confirmed (`taskStatusBar.ts:209-227`: one `setTimeout` per window; `refresh()` runs only on index update, focus regain, or a settings change). | None. |
| 1i | Confirmed (`capture.ts:292`, no `ignoreFocusOut`). **Also found:** Capture Under a Heading loses the text when the heading picker is dismissed. | The draft is kept until the capture is *written*, not only until it is accepted. |
| 1j | Confirmed (`notesGraphHtml.ts:163` and `resetGraphSettings`, `:1902-1947`). | None. |
| 1k | Confirmed. It is the lens **tooltip** (`queryBlocks.ts:119`). The title is "Open in search". A stale doc comment at `quickFind.ts:21` says the same thing. | Both are fixed. |
| 1l | Confirmed, and worse than stated. `## Unreleased` holds 81 entries covering 1.15–1.21, with repeated `### Changed/Fixed/Added` groups. **v1.22.0's ~20 `feat:` commits added no changelog entries at all.** Tags are not ancestors of `dev` after the history rewrites, so the backfill reads each tag's `CHANGELOG.md` content (`git show vX:CHANGELOG.md`) rather than ranges. v1.19.1 also exists, so the backfill is 1.15.0 through 1.22.0, nine sections. | The cut script also (a) folds repeated subsections into one each, (b) fills an empty `## Unreleased` from the release's `feat:`/`fix:` subjects so a release is never shipped with no notes, and (c) writes the `### Highlights` block that Piece 11a reads. |

---

## 2. Design

### 1a. Format toggle
- The Source button (`data-mode="markdown"`) draws `sourceIcon` (`<>`), and the Rendered button (`data-mode="html"`) draws `renderedIcon` (the eye). Labels and titles are unchanged.

### 1b. Rollover in copy mode
- `planRollover(index, today, lookbackDays, mode = 'move')`. When `mode === 'copy'`, tasks whose `sourceLineText.trim()` is the same are collapsed to one, keeping the task from the **newest** daily note. The plan stays oldest-note-first. `fromDates` is recomputed from the tasks that are kept, so the message says "Copied 2 unfinished tasks forward from 2026-09-24", not "from 3 daily notes, back to 2026-09-22".
- Collapsed duplicates are not counted as `skipped`. Otherwise every copy-mode morning would say "N tasks stayed behind" about the old originals forever.
- `editorLensState` passes `getRolloverMode(uri)` so the lens count matches.

### 1c + 1d. One completion path
A new pure helper in `src/core/markdown/taskMetadata.ts`:

```ts
export interface CompletionWrite {
  /** The lines to write in place of the task: the next occurrence, if any, then the completed line. */
  text: string;
  /** The next occurrence's line, when one was started. */
  next?: string;
  /** The 🔁 rule as written, when there is one Deckard could not read. */
  unreadRule?: string;
}
export function writeCompletion(
  completedLine: string, checkboxColumn: number, now: number, eol: string,
): CompletionWrite
```

It wraps `createNextOccurrence`, which already strips ✅/❌/🆔/block id and resets the checkbox, so the completed line can be passed in. `toggleTask`, `bulkEdit.transformLine`, `editTaskCommand`, and `assistantWrites.changeTaskLine` all go through it.

Messages. There is one message per completion, and Undo stays where it was:

| Path | Next one started | Rule not readable |
| --- | --- | --- |
| Checkbox, board, Tasks view (`toggleTask`) | unchanged: `Completed "X", and started the next one, due 2026-10-02.` + **Undo** | **warning** (not info): `Completed "X". Deckard could not read its repeat rule "every blue moon", so no next one was added.` + **Undo**. The separate second warning is removed. |
| Task editor (`Deckard: Edit Task` → Done) | status bar for 5 s: `Completed "X", and started the next one, due 2026-10-02.` The reader is looking at the line, and Cmd/Ctrl+Z undoes the one edit. | warning, no button: `Completed "X". Deckard could not read its repeat rule "every blue moon", so no next one was added.` |
| Bulk edit | unchanged sentence | appended: ` Deckard could not read the repeat rule on 2 of them, so no next one was added.` |
| Assistant `change_task` | answer adds `It repeats, so the next one was added above it: <line>` | answer adds `Its repeat rule "…" could not be read, so no next one was added.` |

- `completeDraft(draft, now, addDoneDate = true)`: when the setting is off, completing writes no ✅ date, as a checkbox does.
- In the task editor, the next occurrence goes on the line above, as `toggleTask` writes it, in the same `editor.edit` call, so one undo takes back both lines. The caret moves down one line.
- Reopening (Done → not done) never writes a next occurrence, as before.

### 1e. Section band
Contributed colors (new `contributes.colors` in `package.json`):

| id | description | dark | light | highContrast | highContrastLight |
| --- | --- | --- | --- | --- | --- |
| `deckard.sectionHighlightBackground` | "Background behind the tagged section or task the cursor is in, in Markdown notes." | `#ffffff08` | `#0000000a` | `#00000000` | `#00000000` |
| `deckard.sectionHighlightBorder` | "Left edge of the tagged section or task the cursor is in, in Markdown notes." | `#ffffff2e` | `#00000029` | `contrastBorder` | `contrastBorder` |

The dark defaults are today's values. A user can change them in `workbench.colorCustomizations`.

Behavior:
- The band is drawn only in the **active** text editor, behind the **innermost** tagged entry (a section with heading tags, an inline tagged block, or a tagged task) that holds the primary cursor. With the cursor outside every tagged entry, there is no band.
- When focus moves to a webview (`activeTextEditor` becomes `undefined`), the last band stays. When a different text editor becomes active, the old editor's band is cleared.
- Every tagged entry keeps its "Show related notes for … / Pin … to Home" hover, through a second, style-less decoration type.
- `deckard.highlightNoteSections` (still default `true`) and zen switch off both the band and the entry hovers, as today. The description changes to: "Highlight the tagged section or task the cursor is in, in Markdown notes. Its colors are `deckard.sectionHighlightBackground` and `deckard.sectionHighlightBorder`."
- The tag box decoration is unchanged (decision 4).

### 1f. Scan scope and editor features in a code repo
- **What is left out** is the union of the `true` entries of `files.exclude`, `search.exclude`, and `deckard.exclude`, less any pattern that `deckard.exclude` sets to `false`. Entries with a `when` clause are skipped, as today.
- `findFiles(include, exclude)` gets a `RelativePattern(folder, '{p1,p1/**,p2,p2/**,…}')` built from those patterns. Patterns containing `{` or `,` are left out of the glob, since nested braces are unreliable, and the matcher still removes them. The matcher, which `isNotesFile` and the watcher also use, reads the same three settings, so a full scan, a watcher event, and an editor check agree.
- Changing `search.exclude` reindexes, as `files.exclude` and `deckard.exclude` already do.
- `deckard.exclude`'s `markdownDescription` becomes: "Glob patterns of files and folders Deckard leaves out of its index, written like `#files.exclude#`. Each pattern is relative to the workspace folder and applies when set to `true`, and a pattern that matches a folder leaves out everything in it. Deckard also leaves out what `#files.exclude#` and `#search.exclude#` hide, such as `node_modules`; set one of those patterns to `false` here to index it anyway."
- **Editor features only in notes.** These return nothing when `!indexer.isNotesFile(document.uri)`:
  - tag decorations, tag document links, the section band, and entry hovers (`EditorTagDecorations`)
  - reference lenses and link and tag hovers (`EditorReferences`)
  - `[[` completion and wiki-link document links (`WikiLinkCompletionProvider`)
  - `#`/`@` completion (`TagCompletionProvider`)
  - `/` metadata completion (`TaskMetadataCompletionProvider`)
  - the "make it an entity heading" code action (`EntityHeadingSuggestions`)
- These stay available in any Markdown file: `Deckard: Edit Task` and its lightbulb (an explicit request), and query blocks (the reader wrote the block on purpose). `EditorLenses` and `LinkHealth` already check.
- A Markdown file outside every workspace folder is not a note, so it loses the decorations. This is intended: its tag links led into an index it is not part of.
- **The large-workspace hint** is stored in `workspaceState` under the same key, so each large workspace hears it once.
- `checkSetup.ts:144,146`: the fallback names both settings, "`files.exclude` or `search.exclude`", and the advice reads "Check `deckard.exclude`, `files.exclude`, and `search.exclude`; one pattern may be wider than meant."

### 1g. Updated facet
The labels are `Last 7 days`, `1–4 weeks ago`, and `Older`. The clauses and counts are unchanged.

### 1h. Daily reminder
- `TaskStatusBar(indexer, globalState, now?)`. After `indexer.ready`, it runs a check at once, then every 60 s (`setInterval`). The first run is delayed by a random 0–20 s, so windows opened together do not check in the same instant.
- Each check does two things:
  1. If the local date differs from the date of the last `refresh()`, it calls `refresh()`. The count turns over at midnight without a focus change.
  2. If `deckard.taskReminderTime` parses, the local time is at or past it, and `globalState.get('deckard.lastReminderDate') !== today`, it **first** writes today's date to `globalState`, then calls `remind()`. The key is not added to `setKeysForSync`, so a reminder heard on the laptop does not silence the desktop.
- Consequences:
  - The reminder fires once a day across all windows.
  - It fires late after sleep, at the first check after waking.
  - It fires when VS Code opens after the hour on that day.
  - It never fires for a day that has already passed.
  - A day with nothing due still records the date and stays silent, as today.
- Changing `taskReminderTime` needs no rescheduling. The next check reads it. Moving the hour later on a day that has already been reminded does not remind again, which is intended.
- `millisecondsUntil` is removed, along with its test. A pure `isReminderDue(now: Date, minuteOfDay: number, lastDate: string | undefined): boolean` replaces it.

### 1i. Quick Capture
- `picker.ignoreFocusOut = true`, so clicking into the editor or a view no longer dismisses the box. Escape still does.
- Draft: `workspaceState` key `deckard.capture.draft` = `{ text: string; target: 'today' | 'heading'; literal: boolean }`.
  - It is saved when the picker hides with non-empty text (Escape, or another quick input taking over), and when the text is accepted.
  - It is cleared only once the capture has been written (`captureToToday` returned true, or the heading insert applied), or when the picker hides with empty text.
- On the next `Deckard: Capture` or `Capture Under a Heading`, a stored draft fills the box and its target and literal state are restored, **if the draft has the same target**. A draft from the other command is kept for that command. The title reads `Deckard: Capture — Restored what you were typing` (or `Deckard: Capture Under a Heading — Restored what you were typing`) until the first keystroke, then returns to normal.
- Piece 6g later seeds Capture from a selection. When both exist, the draft wins. This is noted for that workstream.

### 1j. Reset graph, undoable
- Before resetting, `resetGraphSettings` snapshots `settings` (deep copy), `camera`, and the tag-search input value.
- After resetting, a status span next to the button (`<span class="graph-reset-undo" role="status" aria-live="polite">`) shows `Graph reset.` and a `<button type="button" data-action="undo-graph-reset">Undo</button>`. Focus moves to Undo, so a keyboard user can take it back with Enter.
- It is removed after **8 s**, or on any later control change (the snapshot would be stale).
- Undo restores the snapshot through the same `applySettingsToControls(values)` routine that reset now uses, restores the camera, calls `persist()`, `renderTagList()`, and `rebuildView(true)`, and shows `Graph settings restored.` for 3 s. Node momentum is not restored, since reset clears it and that is harmless.
- The button's `title` stays "Restore all graph controls and filters, clear node momentum, and reframe the graph." with " Undo is offered for a few seconds." appended.
- Styling uses existing tokens only (`--text-muted`, and the `.reset-graph-settings` button rule for Undo), so the contrast suite needs no new pair.

### 1k. Query-block lens
- The tooltip becomes `Open this query on a search page`, and the `quickFind.ts:21` comment is corrected to "Opens a search page on a search."

### 1l. Changelog cut in the release workflow
A new `scripts/changelog.js` (CommonJS, no dependencies) exports pure functions and has a CLI:

- `cutChangelog(text, { version, date, baseVersion, commits })` returns the new text.
  1. It gathers the body of `## Unreleased` and of any `## A.B.C` section **newer than `baseVersion`**. A re-run after the version changed from 1.23.1 to 1.24.0, or after new entries were written, folds them all into one section.
  2. It merges subsections of the same name in the order **Highlights, Added, Changed, Fixed**, then any others. Repeated `### Changed` blocks become one.
  3. If no entries remain, it builds them from `commits` (`feat:` → Added, `fix:` → Fixed; the prefix is dropped and the first letter capitalized, one bullet each).
  4. It writes `## Unreleased\n\n## <version> - <date>\n\n<merged body>` in place of those sections. The fresh `## Unreleased` is empty.
- `releaseNotes(text, version)` returns the body of `## <version>` for `--notes-file`.
- `checkChangelog(text)` returns problems: `## Unreleased` must be the first `##`, and version headings must be `## X.Y.Z - YYYY-MM-DD` in descending order.
- CLI: `node scripts/changelog.js cut <version> <date> <baseVersion> [commitsFile]`, `node scripts/changelog.js notes <version> > notes.md`.
- If the cut section has no `### Highlights`, the CLI prints `::warning file=CHANGELOG.md::<version> has no Highlights; What's new will show only its heading.` It does not fail.

`prepare-release.yml`:
- The "Determine release version" step outputs `value` on every path that ends in a release: explicit version, "already X", and a new bump. It outputs `release=true|false` (false only when `bump=none` and the version is unchanged).
- A new step, **Cut the changelog**, runs when `release == 'true'`: it runs `git log --format=%s --no-merges "$BASE_SHA..HEAD" > "$RUNNER_TEMP/commits.txt"`, then `node scripts/changelog.js cut "$VERSION" "$(TZ=America/New_York date +%F)" "$BASE_VERSION" "$RUNNER_TEMP/commits.txt"`.
- The commit step runs when `package.json`, `package-lock.json`, **or `CHANGELOG.md`** changed. It stages all three and keeps the subject `chore: prepare release vX.Y.Z`, which the explicit-version check already ignores.
- Bot pushes with `GITHUB_TOKEN` do not retrigger the workflow, so there is no loop.

`release.yml`:
- A new step writes `node scripts/changelog.js notes "$VERSION" > "$RUNNER_TEMP/notes.md"` before `gh release create`.
- `--generate-notes` is replaced by `--notes-file "$RUNNER_TEMP/notes.md"` when the file is non-empty, and kept as the fallback when it is empty.
- The VSIX is built from the merged tree, so its Changelog tab shows `## 1.23.0 - 2026-…`.

Backfill (one commit): `## Unreleased` is split into `## 1.22.0` down to `## 1.15.0`, each dated with `git log -1 --format=%cs vX.Y.Z`.
- Entries are assigned by comparing each tag's `## Unreleased` bullets, by their first 70 characters: an entry belongs to the first tag where it appears. For reference, the counts of new entries per tag are 1.17: 14, 1.18: 29, 1.19.0: 1, 1.19.1: 17, 1.20: 14, 1.21: 5.
- 1.22.0 has no entries, so it is written from its `feat:`/`fix:` subjects.
- 1.15.0 and 1.16.0 content was already folded into the existing `## 1.14.0` section when b423008 dated the old releases. Their sections are therefore written from their commit subjects. The `1.14.0` section is left as it is.
- Each backfilled section gets a three-bullet `### Highlights`.
- If v1.22.0 has not been tagged when this lands, its section is dated on the day the release PR merges.

---

## 3. Implementation steps

**1a.** `src/ui/webview/searchPageHtml.ts:415`: swap the two interpolations.

**1b.** `src/ui/commands/rollover.ts`:
- `planRollover` gains `mode: RolloverMode = 'move'`. After sorting, if the mode is copy, it walks the tasks from newest to oldest keeping the first per `sourceLineText.trim()`, then reverses the result. `fromDates` is derived from the kept tasks.
- `rollTasksForward` passes `mode`.
- `src/ui/state/editorLensState.ts:139`: it has `lookbackDays` from its caller. Thread `mode` through the same way (its caller reads settings), and check the call site in `editorLenses.ts`.

**1c/1d.**
- `src/core/markdown/taskMetadata.ts`: add `writeCompletion` (unit-tested; no vscode).
- `src/ui/commands/taskActions.ts`:
  - `toggleTask` uses `writeCompletion`.
  - It records `unreadRule` in the closure, and the `description` function returns the 1d sentence.
  - `offerUndo` gains `severity: 'info' | 'warning'`, and `updateTaskLine`'s `description` may return `{ text, severity }`. Keep the string form for existing callers.
  - The standalone `showWarningMessage` is deleted.
  - Export `describeNextOccurrence`.
- `src/ui/commands/bulkEdit.ts`:
  - `transformLine` returns the completion via `writeCompletion`, and the result counts `unreadRules`.
  - `describeBulkEditResult` appends the sentence.
  - `BulkEditResult` gains `unreadRules: number` (default 0).
- `src/ui/commands/taskEditor.ts`:
  - Add a pure `writeEditedTask(before: TaskDraft, edited: TaskDraft, now, eol, addDoneDate)` that returns `{ text, next?, unreadRule? }`. It computes the checkbox column from `edited.prefix.search(/\[[ xX]\]/) + 1` and calls `writeCompletion` only when `!before.completed && edited.completed`.
  - `editTaskCommand` writes `text` over the line. The caret line is `+1` when `next` is set. It shows the status bar message or the warning.
  - `completeDraft` gains `addDoneDate`, read in `readField` from `deckard.tasks.addDoneDate` for the document's URI (pass it through `editTaskDraft` options).
- `src/ui/commands/assistantWrites.ts`: `changeTaskLine` takes `eol`, uses `writeCompletion` when completing, and returns `{ text, next?, unreadRule? }`. `changeTask` replaces the line range with `text` (the preview shows both lines) and extends its answer. Update `assistant-writes.test.ts` expectations.
- Edge cases:
  - A completed line with `✅` already present keeps it; `setTaskLineCompletion` does this already.
  - A draft whose rule was changed to one that cannot be read cannot happen from the editor, which refuses it, but can be written by hand. That is the `unreadRule` path.
  - CRLF documents use `editor.document.eol`.

**1e.** `src/ui/commands/tagDecorations.ts`:
- Replace `noteDecorationType` with:
  - `entryHoverType` (no style; hover only; applied to every entry)
  - `sectionBandType` (`isWholeLine`, `backgroundColor: new ThemeColor('deckard.sectionHighlightBackground')`, `border: '0 0 0 1px solid'`, `borderColor: new ThemeColor('deckard.sectionHighlightBorder')`).
- Split out a pure `collectTaggedEntries(parsed): EditorEntry[]` from `decorate`. Cache `{ version, entries }` per document URI string, cleared when the document closes.
- Add a pure `findBandEntry(entries, line /* 1-based */): EditorEntry | undefined`, which picks the smallest span containing the line, with ties broken by the later start.
- Add listeners:
  - `onDidChangeTextEditorSelection`: when the event's editor is the active one, recompute and call `setDecorations(sectionBandType, …)` only if the entry changed (track `lastBand` per editor).
  - `onDidChangeActiveTextEditor`: clear the band in the previous editor, draw it in the new one.
- Constructor: `new EditorTagDecorations(isNotesFile: (uri) => boolean = () => true)`.
- `package.json`:
  - add `contributes.colors`
  - update the `deckard.highlightNoteSections` description
- `src/test/messages-rendering.test.ts` / `settings.test.ts`: check whether either asserts manifest descriptions, and update it if so.

**1f.**
- `src/core/workspace/scanner.ts`:
  - `export function collectExcludePatterns(deckard: unknown, files: unknown, search: unknown): string[]` (true entries of files+search+deckard, minus deckard's false keys, trimmed, deduped).
  - `export function toExcludeGlob(patterns: string[]): string | undefined`.
  - `createExcludeMatcher` stays and is fed `collectExcludePatterns` output (change its signature to take the pattern list, or add `createExcludeMatcherFromPatterns`, and keep the old one for tests).
  - `getExcludeMatcher` reads `search.exclude` too.
  - `scan()` passes `new vscode.RelativePattern(folder, glob)` as the exclude, or `undefined` when there are no patterns, which keeps the `files.exclude` default.
- `src/core/workspace/indexer.ts:304`: add `event.affectsConfiguration('search.exclude')`.
- Providers get `isNotesFile`:
  - `EditorTagDecorations(indexer.isNotesFile.bind(indexer))` in `extension.ts:196`.
  - `ReferenceIndexSource` gains `isNotesFile`, and `provideCodeLenses`/`provideHover` check it.
  - `WikiLinkCompletionProvider`, `TagCompletionProvider`, and `TaskMetadataCompletionProvider` check it on their existing `indexer`, extending their `Pick<>` types where needed.
  - `EntityHeadingSuggestions(indexer)` checks it.
  - Update test fakes that implement these interfaces (search `src/test` for `getSnapshot:` fakes passed to these classes) to add `isNotesFile: () => true`.
- `EditorTagDecorations`' config listener also redraws on `deckard.notesFolder`, `deckard.exclude`, `files.exclude`, and `search.exclude`.
- `src/extension.ts:223,227`: `context.workspaceState` in place of `context.globalState` for `EXCLUDE_HINT_SHOWN`.
- `src/ui/commands/checkSetup.ts:144,146`: the wording change.
- `package.json`: the `deckard.exclude` description.

**1g.** `src/ui/state/searchFacets.ts:151,156`: the two labels. `src/test/search-refine.test.ts:186` expects `'Last 7 days'`.

**1h.** `src/ui/views/taskStatusBar.ts`:
- Replace `reminder` and `scheduleReminder` with `timer: ReturnType<typeof setInterval>`, plus `lastRefreshDate`, and `check()`.
- `StatusBarIndexSource` gains `ready: Promise<void>`.
- Export `isReminderDue` and `REMINDER_DATE_KEY = 'deckard.lastReminderDate'`.
- `refresh()` records `formatLocalDate(this.now())`. Reuse `formatLocalDate` from `commands/dailyNote.ts`, or a local ISO-date helper if importing it pulls in too much.
- `dispose` clears the interval and the start delay.
- `src/extension.ts:341`: `new TaskStatusBar(indexer, context.globalState)`.

**1i.** `src/ui/commands/capture.ts`:
- Add `CaptureDrafts` (a small class over a `vscode.Memento`: `read(target)`, `save(draft)`, `clear()`), exported for tests.
- `capture(indexer, initialTarget, drafts?)`: `askForCapture` receives the draft, sets `picker.value`, `literal`, and `target`, and the title suffix.
  - `onDidHide` saves when text is non-empty and the capture was not written. `onDidAccept` saves.
  - `capture()` clears after `captureToToday` returns true or the heading insert succeeds.
- `extension.ts:697,723`: pass `new CaptureDrafts(context.workspaceState)`, one instance.

**1j.** `src/ui/webview/notesGraphHtml.ts`:
- Extract `applySettingsToControls()` from `resetGraphSettings`.
- Add `showResetUndo(previous)` and a delegated click on `[data-action="undo-graph-reset"]`.
- Add CSS for `.graph-reset-undo` next to `.reset-graph-settings`.
- Any `input`/`change` event on a graph control, and the zoom and fit buttons, dismiss the undo.

**1k.** `src/ui/preview/queryBlocks.ts:119`, `src/ui/commands/quickFind.ts:21`.

**1l.**
- `scripts/changelog.js` (new).
- `.github/workflows/prepare-release.yml` and `.github/workflows/release.yml` as designed.
- `src/test/changelog.test.ts` (new) requires `path.join(__dirname, '../../scripts/changelog.js')`. `out/test/` resolves to the repo root, as the tests already do for fixtures.
- `CHANGELOG.md` backfill (a separate commit). Use a throwaway scratch script outside the repo for the per-tag bullet diff. It is not committed.

---

## 4. Tests

All run under `npm test` (vscode-test, mocha) unless marked otherwise.

| Item | Test | Asserts |
| --- | --- | --- |
| 1a | `search-page-behavior.test.ts`, new test "each format button carries the icon of its own mode" | `find('[data-mode="markdown"]').innerHTML === sourceIcon` and `find('[data-mode="html"]').innerHTML === renderedIcon`, importing both from `icons.ts`. It fails on today's code. |
| 1b | `rollover.test.ts`, new "copies a task once however many days it has waited" | Three daily notes: 09-22 has the task, 09-23 is a copy of it, and today is 09-24. `planRollover(…, 'copy').tasks` has one task, from 09-23. `applyRollover` writes it once, and `fromDates` is `['2026-09-23']`. A second test: the same notes in move mode still plan both lines. A third (lens): the carry-in count on today's note is 1. |
| 1c | `task-metadata.test.ts`: `writeCompletion` | A 🔁 weekly line gives two lines, the next one first. A line with no rule gives one. An unreadable rule gives `unreadRule` and one line. CRLF is respected. |
| 1c | `task-editor.test.ts`: `writeEditedTask` | Done on a repeating draft writes the next occurrence above. Reopening writes one line. A draft that was already complete writes no next one. `addDoneDate=false` writes no ✅. |
| 1c | `assistant-writes.test.ts` | `changeTaskLine` with `complete: true` on a repeating line returns both lines. |
| 1d | `bulk-edit.test.ts` | `describeBulkEditResult` with `unreadRules: 2` ends with the sentence. `transformLine` counts it. |
| 1d | `task-metadata.test.ts` or a new `task-completion-message` test | The toggle description function returns the exact 1d sentence. Make the description builder a pure exported `describeCompletion(task, next?, unreadRule?)` and test that. |
| 1e | `tag-decorations.test.ts` | `findBandEntry` picks the innermost entry for a line inside a tagged task inside a tagged section, and nothing for an untagged line. `collectTaggedEntries` returns the same entries today's code bands. A manifest test: `contributes.colors` has both ids with `dark`, `light`, and `highContrast` defaults. |
| 1f | `workspace.test.ts` | Scanning with an injected `findFiles` spy passes an exclude whose pattern contains `**/node_modules`, from the default `search.exclude`. `collectExcludePatterns({ '**/node_modules': false }, {}, { '**/node_modules': true })` does not contain it. The matcher excludes `pkg/node_modules/x/README.md`. `isNotesFile` is false for such a path. |
| 1f | `editor-references.test.ts` | `provideCodeLenses` returns `[]` for a document the fake indexer calls not-a-note. The same applies to tag completion (`tag-suggestions.test.ts`) and link completion (`link-suggestions.test.ts`). |
| 1g | `search-refine.test.ts:186` | Updated to `[['Last 7 days', 1], ['Older', 1]]`. Add a case with a note updated 7 days ago landing in `1–4 weeks ago`. |
| 1h | `task-status-bar.test.ts` | `isReminderDue`: before the hour gives false; at or after it with no date gives true; with today's date gives false; with yesterday's date at 23:00 and the reminder at 09:00 gives true. Remove the `millisecondsUntil` test. A `TaskStatusBar` built with a fake index (`ready` resolved), a fake memento, and a fake `now` at 09:05 with the reminder at 09:00: `check()` writes today's date **before** `showInformationMessage` resolves. Stub `vscode.window.showInformationMessage` with the sinon-free manual stub pattern used elsewhere, and restore it in teardown. |
| 1i | `capture.test.ts` | `CaptureDrafts` over an in-memory memento: `save` then `read('today')` returns the draft; `read('heading')` does not; `clear` empties it. |
| 1j | `notes-graph-behavior.test.ts` | Move a slider, click `#reset-graph-settings`, and the slider is at its default; `[data-action="undo-graph-reset"]` exists and reads `Undo`. Click it and the slider value and `savedState()` are back. After reset, changing any control removes the undo. |
| 1k | `query-block.test.ts` | The lens tooltip equals `Open this query on a search page`, if the test already reaches the lenses. Otherwise this is covered by review only, since it is a string. |
| 1l | `changelog.test.ts` (new) | `cutChangelog` renames Unreleased, opens a fresh one, and merges repeated `### Changed`. Re-running with a new version folds the older unreleased-version section. It fills from commits when empty. `releaseNotes` returns only the section body. `checkChangelog(readFileSync('CHANGELOG.md'))` returns `[]`, which guards the backfill and every later hand edit. |

The other suites:
- `npm run test:ui` covers the graph page (contrast, script syntax, layout contracts) and the search page. It must pass with the new `.graph-reset-undo` rule and no new color pair.
- `npm run test:layout`: the graph page's status row is measured, so check the undo span does not overflow at the narrow width.
- `npm run test:e2e`: no change is expected; run it as the gate.
- `npm run test:visual` (in CI): the format toggle sits inside the closed View options menu, so **no baseline is expected to change**. If `*+zen-searchPage.png` differs, re-record those eight files in a separate `test:` commit. The graph is not in the visual set.

Gate each commit on the exit codes of all four suites (`npm test`, `test:ui`, `test:e2e`, `test:layout`), in a short-path worktree, per the concurrent-edits rule.

---

## 5. Docs

**README.md**
- Line 77 (zen paragraph): unchanged. The band now matches "the section being edited".
- Settings table, `deckard.highlightNoteSections` (line 1024): "Highlights the tagged section or task the cursor is in. Its colors are the theme colors `deckard.sectionHighlightBackground` and `deckard.sectionHighlightBorder`, which `workbench.colorCustomizations` can change. Disable it to keep entry-level Related Notes cursor behavior without the band."
- `deckard.exclude` row (line 982): add "and what `search.exclude` hides, such as `node_modules`. Set an inherited pattern to `false` here to index it anyway." Add a sentence under Get started: "In a code repository, Deckard's editor features apply only to notes: a README outside `deckard.notesFolder`, or under `node_modules`, is left alone."
- Status bar and reminders (line 514): "…once a day, in one window, at the first minute on or after that time; if VS Code was closed or asleep then, when it next opens that day."
- Rollover (around lines 873-887): "In `copy` mode a task that has waited several days is carried once, from the newest note that holds it."
- Line 270: unchanged, and now true everywhere. Add "wherever the task is completed: a checkbox, the Task board, bulk edit, the task editor, or the assistant."
- Capture (line 897): "The box stays open when you click elsewhere. If you close it with words in it, the next Capture brings them back."
- Graph (line 462): "**Reset graph** restores these controls, clears graph filters, and reframes the view; **Undo** beside it puts them back for a few seconds."

**Help (`src/ui/webview/helpHtml.ts`)**
- :364 "Checklist tasks": add "…and the next occurrence of a repeating task, from the task editor as well."
- :368 "Capture": add "It stays open when you click away, and brings back what you had typed if you close it."
- :395 "What is due": "…says the same thing once a day, at the first moment VS Code is open on or after an hour you pick."
- :453 "Notes Graph": add "Reset graph can be undone for a few seconds."
- :481 "Carrying tasks forward": add "A copied task is carried once."

**CHANGELOG `## Unreleased`.** Each commit adds its entry under `### Fixed` (1l's under `### Changed`), in the existing bold-lead style. For example:
- **The search page's format buttons show their own mode.** Source shows `<>` and Rendered shows the eye; they were swapped.
- **Copied rollover carries a task once.** In `copy` mode, a task that had waited three days arrived three times.
- **Finishing a repeating task in the task editor starts the next one**, as a checkbox does, and a rule Deckard cannot read is said in the same message as the completion.
- **The section band shows on light themes, and only behind the section the cursor is in.** Its colors are `deckard.sectionHighlightBackground` and `deckard.sectionHighlightBorder`.
- **`node_modules` stays out of the index**: Deckard now leaves out what `search.exclude` hides. Editor lenses, tag boxes, hovers, and completions apply only to notes.
- **Refine's Updated counts say which days they cover**: Last 7 days, 1–4 weeks ago, Older.
- **The daily reminder comes once a day**, in one window, and late rather than never; the status bar count turns over at midnight.
- **Capture stays open when you click away**, and keeps what you were typing.
- **Reset graph can be undone.**
- **The release notes come from this changelog**, which is now cut at each release.

**docs/components.md**
- Under Conventions, add a short **"Undo, briefly"** note: a control that discards the reader's arrangement offers Undo inline for 8 s in a `role="status"` span, with focus moved to it. Name the graph as the first user and point to Piece 9g as the place this becomes a primitive.
- No change to the `.segmented` text.

---

## 6. Commits

Each commit carries its code, tests, docs, and changelog entry, and passes all four suites on its own. Order: smallest and most independent first. 1l's workflow goes last so the backfill includes Piece 1's own entries.

1. `fix: the search page's format buttons each show the mode they pick` (1a)
2. `fix: the query block's lens names the page it opens` (1k)
3. `fix: Refine's Updated counts say which days they cover` (1g)
4. `fix: a copied rollover carries a task once, however many days it waited` (1b)
5. `fix: finishing a repeating task in the task editor, or from the assistant, starts the next one` (1c, adds `writeCompletion`)
6. `fix: a repeat rule Deckard cannot read is said where the completion is, beside Undo` (1d)
7. `fix: the section band follows the cursor, in colors a light theme can see` (1e)
8. `fix: what search.exclude hides, such as node_modules, stays out of the index` (1f scan and matcher, plus the per-workspace hint and the setup-check wording)
9. `fix: tag boxes, lenses, hovers, and completions stay in notes` (1f gating)
10. `fix: the daily reminder comes once a day, late rather than never, and the count turns over at midnight` (1h)
11. `fix: Capture stays open when you click away, and keeps what you were typing` (1i)
12. `fix: Reset graph can be undone` (1j)
13. `ci: each release cuts the changelog and uses it for the release notes` (1l script, workflows, `changelog.test.ts` without the real-file check)
14. `docs: the changelog gives each release since 1.15 its own section` (the backfill, with the real-file check enabled in `changelog.test.ts`)
15. Only if `test:visual` moves: `test: re-record the zen search page baselines for the format icons`

Commits 5 and 6 may be squashed if the reviewer prefers. 6 depends on 5's helper.

---

## 7. Size, risks, dependencies, questions

**Size:** about **4 days**.

| Items | Days |
| --- | --- |
| 1a, 1g, 1k | 0.25 together |
| 1b | 0.3 |
| 1c + 1d | 0.75 |
| 1e | 0.5 |
| 1f | 0.75 |
| 1h | 0.4 |
| 1i | 0.3 |
| 1j | 0.4 |
| 1l script and workflows | 0.5 |
| 1l backfill (editorial, nine sections plus Highlights) | 0.5 |

The approved plan's "about two days" did not know that 1.22 has no entries, or that the assistant path shares 1c's bug.

**Risks**
- **1f changes what is indexed.** Anyone with notes under a `search.exclude` pattern loses them from the index until they add a `false` entry. The changelog entry and the `deckard.exclude` description say so, and `Deckard: Check Setup`'s excluded count shows it. `files.exclude` entries with a `when` clause were previously applied by `findFiles` and now are not, because an explicit exclude replaces the default. These are rare for `.md`, and are noted in code.
- **1f gating** removes decorations from Markdown opened outside every workspace folder. This is intended, but it is visible.
- **1h cross-window race.** `globalState` propagates between windows asynchronously. Two windows that check in the same second could both remind. The random start delay and write-before-show make this unlikely; it is not impossible.
- **1l bot commit on `dev`.** Like the version bump today, the changelog cut is pushed to `dev` by the bot. A local edit to the top of `## Unreleased` then conflicts on pull. It is trivially resolved, but David should know the bot now touches `CHANGELOG.md`.
- **1l backfill accuracy.** The per-tag content diff is mechanical for 1.17–1.21. 1.15, 1.16, and 1.22 are written from commit subjects, and read as such.
- **1e selection listener cost.** The band is recomputed on every cursor move. It uses cached entries and a linear scan, and calls `setDecorations` only when the entry changes.

**Dependencies**
- Piece 2 (2c) later adds calendar periods beside 1g's labels. There is no conflict.
- Piece 3: none. Decision 3 does not touch Piece 1.
- Piece 6g (Capture seeds from selection) must respect 1i's rule that the draft wins.
- Piece 7b (`deckard.toggleTaskDone`) should call `writeCompletion`/`toggleTask` from 1c. Piece 7's 🔁 diagnostic complements 1d.
- Piece 8 (one message voice) may rephrase 1d's sentences. The strings live in one pure `describeCompletion` so that is one edit.
- Piece 9g (danger tone, undo primitive) can absorb 1j's inline undo.
- Piece 10 (speed) benefits from 1f: node_modules is no longer read.
- Piece 11a reads the `### Highlights` blocks that 1l introduces.
- Timing: 1l's backfill assumes v1.22.0 (PR #36) has shipped. If Piece 1 lands in the same release PR, the 1.22.0 section is the one the workflow cuts, and the backfill stops at 1.21.0.

**Open questions for David:** none that block work. One is worth a glance: 1f honors `search.exclude` with a `false`-in-`deckard.exclude` escape hatch, rather than adding a `deckard.useSearchExclude` switch. If he keeps notes in a search-hidden folder, he should say so before commit 8.
