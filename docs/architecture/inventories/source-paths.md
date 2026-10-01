# Source paths cited outside the compiler

The harness tables in section 2 are as of the end of Phase 4 (`d65b73f`); sections 1, 3, 4, and 5 still describe `1805a01`.

This inventory lists every place outside TypeScript's view that names a source path, a compiled path, or a command id by string. The compiler catches a broken import, but it does not see these places, so a moved file breaks them or leaves them stale without any error. It was taken at `dev` `1805a01`, before Phase 0 of [the refactor plan](../../implementation/19-refactor.md), and each later phase checks against it.

Line numbers are 1-based at `1805a01`, except in section 2, where they are at `d65b73f`. "Breaks" means a test, script, build, or runtime path fails, or silently stops covering something, after a move. "Stale" means only a document goes out of date.

## Totals

| Section | Places | Distinct paths or ids | Break on a move | Only go stale | Unaffected by a move |
| --- | --- | --- | --- | --- | --- |
| 1. Current docs, `src/` paths | 80 citations in 10 files | 53 | 0 | 80 | 0 |
| 1. Current docs, `test/` harness paths | 15 citations in 7 files | 10 | 0 | 15 | 0 |
| 1. `docs/implementation/` plans | 757 citations in 20 files | 218 | 0 | 757 (dated, not kept current) | 0 |
| 2. Harness `out/` module loads | 73 sites in 12 files | 31 modules, 30 of them through the catalog | 73 (3 of them silently) | 0 | 0 |
| 2. Compiled-tree roots and paths between harness files | 19 rows | `out/`, 16 harness files, 2 baselines | 15 (14 on a harness move, 1 on a `src/` move) | 0 | 4 |
| 2. Reads by path in `src/test` | 13 rows in 11 files | `out/extension.js`, `src/extension.ts`, 6 `src/ui/` folders, `src/services`, `src/domain` | 13 (3 of them by checking less) | 0 | 0 |
| 2. Constructor signatures and internals | 28 rows in 10 files | 10 classes, 2 factories, 5 state builders, 8 members | 28 | 0 | 0 |
| 3. `scripts/` | 26 rows in 5 scripts | 1 source file, 12 command ids, 2 settings | 22 | 1 | 3 |
| 4. Build, packaging, and CI configuration | 26 rows in 12 files | 2 entry points, 1 bundle name | 12 (6 of them on a `src/` move) | 0 | 14 |
| 5. `.vscode/` and `development/` | 11 rows in 8 files | 1 `dist/` glob | 4 | 1 | 6 |

"Break on a move" counts a move of a source file, a harness, a script, or the fixture, and it includes places that stop checking without failing.

No path that the current docs, harnesses, scripts, or configuration cite is missing today. Every `src/` path the current docs cite exists, and each glob matches files. The missing paths in `docs/implementation/` are ones those plans proposed. The line numbers some docs attach to those paths are already out of date (see section 1).

## 1. Docs

The search covered every tracked Markdown file outside `docs/implementation/`: `README.md`, `CHANGELOG.md`, `.github/copilot-instructions.md`, the 14 files directly in `docs/`, and the 18 pages in `docs/guide/`. The notes under `development/notes/` and `resources/` cite no paths.

### Citations per file

| File | Citations | Distinct paths |
| --- | --- | --- |
| `docs/task-steps.md` | 27 | 23 |
| `docs/ux-review.md` | 18 | 11 |
| `docs/components.md` | 15 | 13 |
| `docs/related-notes-associations.md` | 5 | 5 |
| `docs/CONTRIBUTING.md` | 3 | 3 |
| `docs/editor-lenses.md` | 3 | 3 |
| `docs/ui-plan.md` | 3 | 3 |
| `docs/zen-mode.md` | 3 | 3 |
| `docs/todo.md` | 2 | 2 |
| `CHANGELOG.md` | 1 | 1 |
| `README.md`, `.github/copilot-instructions.md`, all of `docs/guide/`, `docs/improvements.md`, `docs/review-guide.md`, `docs/ux-fifteen-sources-plan.md`, `docs/ux-implementation-plan.md`, `docs/ux-research-plan.md` | 0 | 0 |

The plan's counts differ in two places:

- `docs/task-steps.md` has 27 citations of 23 distinct paths. The plan's 22 is the number of distinct files, leaving out the folder `src/test` at line 536.
- `docs/editor-lenses.md` cites three paths, not two. The third is `src/test/editor-lenses.test.ts` at line 59.

No current doc cites an `out/` or `dist/` path.

The guide ships in the VSIX and `guide.test.ts` checks it, but no guide page cites a source path. So no shipped doc goes stale on a move.

`CHANGELOG.md` also ships, and Help parses it at runtime. Its one citation sits in a released section, so it stays as history rather than being edited.

### Every `src/` citation

| File | Line | Path cited | Exists at `1805a01` | On a move |
| --- | --- | --- | --- | --- |
| `CHANGELOG.md` | 2381 | `src/ui/webview/components.ts` | Yes | Stale; a released entry, kept as history |
| `docs/CONTRIBUTING.md` | 5 | `src/ui/webview/helpHtml.ts` | Yes | Stale; a live instruction |
| `docs/CONTRIBUTING.md` | 32 | `src/ui/webview/components.ts` | Yes | Stale; a live instruction |
| `docs/CONTRIBUTING.md` | 64 | `src/test/changelog.test.ts` | Yes | Stale; a live instruction |
| `docs/components.md` | 4 | `src/ui/webview/*Html.ts` | Yes (glob) | Stale |
| `docs/components.md` | 6 | `src/ui/webview/components.ts` | Yes | Stale |
| `docs/components.md` | 139 | `src/test/spacing-scale.test.ts` | Yes | Stale |
| `docs/components.md` | 205 | `src/test/icons.test.ts` | Yes | Stale |
| `docs/components.md` | 208 | `src/core/markdown/proseExcerpt.ts` | Yes | Stale |
| `docs/components.md` | 404 | `src/test/components-primitives.test.ts` | Yes | Stale |
| `docs/components.md` | 511 | `src/ui/state/resultTable.ts` | Yes | Stale |
| `docs/components.md` | 560 | `src/test/zen-mode.test.ts` | Yes | Stale |
| `docs/components.md` | 709 | `src/core/markdown/taskSteps.ts` | Yes | Stale |
| `docs/components.md` | 719 | `src/test/naming.test.ts` | Yes | Stale |
| `docs/components.md` | 749 | `src/test/components-primitives.test.ts` | Yes | Stale |
| `docs/components.md` | 784 | `src/test/naming.test.ts` | Yes | Stale |
| `docs/components.md` | 800 | `src/ui/commands/notify.ts` | Yes | Stale |
| `docs/components.md` | 865 | `src/test/webviewPage.ts` | Yes | Stale |
| `docs/components.md` | 902 | `src/test/extension.test.ts` | Yes | Stale |
| `docs/editor-lenses.md` | 54 | `src/ui/commands/editorLenses.ts` | Yes | Stale |
| `docs/editor-lenses.md` | 58 | `src/ui/state/editorLensState.ts` | Yes | Stale |
| `docs/editor-lenses.md` | 59 | `src/test/editor-lenses.test.ts` | Yes | Stale |
| `docs/related-notes-associations.md` | 23 | `src/core/markdown/parser.ts` | Yes | Stale |
| `docs/related-notes-associations.md` | 25 | `src/core/workspace/indexer.ts` | Yes | Stale |
| `docs/related-notes-associations.md` | 27 | `src/ui/webview/sidebarNotes.ts` | Yes | Stale |
| `docs/related-notes-associations.md` | 29 | `src/ui/state/dashboardState.ts` | Yes | Stale |
| `docs/related-notes-associations.md` | 31 | `src/ui/webview/relatedNotesDebugHtml.ts` | Yes | Stale |
| `docs/task-steps.md` | 107 | `src/core/markdown/taskSteps.ts` | Yes | Stale |
| `docs/task-steps.md` | 330 | `src/core/types.ts` | Yes | Stale |
| `docs/task-steps.md` | 339 | `src/core/markdown/parser.ts` | Yes | Stale |
| `docs/task-steps.md` | 352 | `src/core/markdown/taskSteps.ts` | Yes | Stale |
| `docs/task-steps.md` | 373 | `src/core/query/queryTypes.ts` | Yes | Stale |
| `docs/task-steps.md` | 375 | `src/core/query/queryParser.ts` | Yes | Stale |
| `docs/task-steps.md` | 376 | `src/core/query/queryEvaluator.ts` | Yes | Stale |
| `docs/task-steps.md` | 379 | `src/ui/state/dashboardState.ts` | Yes | Stale |
| `docs/task-steps.md` | 381 | `src/ui/state/assistantTools.ts` | Yes | Stale |
| `docs/task-steps.md` | 385 | `src/ui/commands/taskSteps.ts` | Yes | Stale |
| `docs/task-steps.md` | 400 | `src/extension.ts` | Yes | Stale |
| `docs/task-steps.md` | 402 | `src/ui/commands/taskEditor.ts` | Yes | Stale |
| `docs/task-steps.md` | 409 | `src/ui/webview/components.ts` | Yes | Stale |
| `docs/task-steps.md` | 417 | `src/ui/webview/taskBoardHtml.ts` | Yes | Stale |
| `docs/task-steps.md` | 418 | `src/ui/webview/taskBoard.ts` | Yes | Stale |
| `docs/task-steps.md` | 420 | `src/ui/webview/messages.ts` | Yes | Stale |
| `docs/task-steps.md` | 422 | `src/ui/webview/helpHtml.ts` | Yes | Stale |
| `docs/task-steps.md` | 427 | `src/ui/state/taskBoardState.ts` | Yes | Stale |
| `docs/task-steps.md` | 434 | `src/core/types.ts` | Yes | Stale |
| `docs/task-steps.md` | 436 | `src/ui/webview/components.ts` | Yes | Stale |
| `docs/task-steps.md` | 444 | `src/ui/state/agendaState.ts` | Yes | Stale |
| `docs/task-steps.md` | 448 | `src/ui/views/agendaTree.ts` | Yes | Stale |
| `docs/task-steps.md` | 465 | `src/ui/commands/taskActions.ts` | Yes | Stale |
| `docs/task-steps.md` | 485 | `src/ui/commands/bulkEdit.ts` | Yes | Stale |
| `docs/task-steps.md` | 487 | `src/ui/commands/rollover.ts` | Yes | Stale |
| `docs/task-steps.md` | 536 | `src/test` | Yes | Stale |
| `docs/task-steps.md` | 642 | `src/ui/webview/helpHtml.ts` | Yes | Stale |
| `docs/todo.md` | 2 | `src/core/markdown/inlineRanges.ts` | Yes | Stale |
| `docs/todo.md` | 9 | `src/test/webviewPage.ts` | Yes | Stale |
| `docs/ui-plan.md` | 9 | `src/ui/webview` | Yes | Stale |
| `docs/ui-plan.md` | 21 | `src/ui/webview/*.ts` | Yes (glob) | Stale |
| `docs/ui-plan.md` | 24 | `src/ui/webview/icons.ts` | Yes | Stale |
| `docs/ux-review.md` | 48 | `src/ui/views/taskStatusBar.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 76 | `src/ui/webview/components.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 77 | `src/ui/webview/themes.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 112 | `src/ui/webview/components.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 113 | `src/ui/webview/components.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 152 | `src/ui/webview/dashboardHtml.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 153 | `src/ui/webview/statsHtml.ts` | Yes | Stale |
| `docs/ux-review.md` | 153 | `src/ui/webview/notesGraphHtml.ts` | Yes | Stale |
| `docs/ux-review.md` | 154 | `src/extension.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 184 | `src/ui/state/taskBoardState.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 222 | `src/ui/webview/components.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 257 | `src/ui/webview/*.ts` | Yes (glob) | Stale |
| `docs/ux-review.md` | 287 | `src/ui/webview/dashboardHtml.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 312 | `src/ui/webview/notesGraphHtml.ts` | Yes | Stale |
| `docs/ux-review.md` | 313 | `src/ui/state/notesGraphState.ts` | Yes | Stale |
| `docs/ux-review.md` | 370 | `src/ui/webview/components.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 393 | `src/ui/webview/sidebarNotesHtml.ts` (with line numbers) | Yes | Stale |
| `docs/ux-review.md` | 417 | `src/ui/webview/themes.ts` (with line numbers) | Yes | Stale |
| `docs/zen-mode.md` | 32 | `src/ui/commands/taskBoardActions.ts` (with line numbers) | Yes | Stale |
| `docs/zen-mode.md` | 292 | `src/test/zen-mode.test.ts` | Yes | Stale |
| `docs/zen-mode.md` | 321 | `src/test/extension.test.ts` | Yes | Stale |

Fourteen of these lines also cite line numbers: 13 in `docs/ux-review.md` and one in `docs/zen-mode.md`. Those numbers are already wrong at `1805a01` in the five checked:

- `docs/zen-mode.md:32` cites `taskBoardActions.ts:52`. `updateTaskBoardSetting` is at line 60.
- `docs/ux-review.md:48` cites `taskStatusBar.ts:36-43`. `describeDueTasks` is at line 54.
- `docs/ux-review.md:76` cites `components.ts:522` for `.task-meta`. The rule is at line 749.
- `docs/ux-review.md:287` cites `dashboardHtml.ts:849`. That line is now a doc comment for widget links.
- `docs/ux-review.md:417` cites `themes.ts:78` for Corpo's override. That line is now `--hover-fg`.

### `test/` harness paths cited in docs

Phase 0 rewrites some harnesses (§2.6 of the plan), so these citations can go stale too.

| File | Line | Path cited | Exists at `1805a01` | On a move |
| --- | --- | --- | --- | --- |
| `docs/components.md` | 70 | `test/ui/contrast-baseline.json` | Yes | Stale |
| `docs/components.md` | 823 | `test/ui/verifyWebviews.js` | Yes | Stale |
| `docs/components.md` | 829 | `test/ui/verifyWebviews.js` | Yes | Stale |
| `docs/components.md` | 844 | `test/ui/checkLayout.js` | Yes | Stale |
| `docs/components.md` | 880 | `test/ui/checkVisual.js` | Yes | Stale |
| `docs/components.md` | 883 | `test/ui/visual-baseline` | Yes | Stale |
| `docs/task-steps.md` | 589 | `test/e2e/taskBoard.e2e.js` | Yes | Stale |
| `docs/task-steps.md` | 605 | `test/ui/checkLayout.js` | Yes | Stale |
| `docs/task-steps.md` | 613 | `test/ui/visual-baseline/darwin/*-taskBoard.png` | Yes (glob) | Stale |
| `docs/todo.md` | 9 | `test/ui/checkLayout.js` | Yes | Stale |
| `docs/ui-plan.md` | 8 | `test/ui/visual-baseline/darwin` | Yes | Stale |
| `docs/ux-research-plan.md` | 83 | `test/ui/checkContrast.js` | Yes | Stale |
| `docs/ux-research-plan.md` | 440 | `test/ui/checkRenderedContrast.js` | Yes | Stale |
| `docs/ux-review.md` | 78 | `test/ui/contrast-baseline.json` | Yes | Stale |
| `docs/zen-mode.md` | 175 | `test/ui/checkLayout.js` | Yes | Stale |

### `docs/implementation/`

These are dated plans. They record what was intended when each was written and are not kept current, so they are counted and not listed. Most paths not on disk are ones a plan proposed, such as the refactor targets `src/services` and `src/webview`.

| File | Citations | Distinct paths | Distinct paths not on disk |
| --- | --- | --- | --- |
| `01-bugs.md` | 27 | 25 | 0 |
| `02-dates.md` | 6 | 5 | 0 |
| `03-tasks.md` | 3 | 2 | 0 |
| `04-search-board.md` | 6 | 6 | 0 |
| `05-links.md` | 28 | 26 | 0 |
| `06-find-capture.md` | 11 | 10 | 0 |
| `07-editor.md` | 13 | 12 | 0 |
| `08-messages.md` | 21 | 17 | 0 |
| `09-components.md` | 8 | 8 | 0 |
| `10-index-speed.md` | 7 | 6 | 0 |
| `11-onboarding.md` | 14 | 11 | 0 |
| `12-graph-stats.md` | 12 | 11 | 0 |
| `13-parked.md` | 7 | 7 | 0 |
| `14-group-namespace.md` | 4 | 4 | 0 |
| `15-calendar-day.md` | 8 | 7 | 1 (`src/test/calendar-page.test.ts`) |
| `16-steps.md` | 27 | 23 | 0 |
| `17-related.md` | 9 | 8 | 0 |
| `18-calendar-page.md` | 8 | 7 | 0 |
| `19-refactor-findings.md` | 500 | 167 | 11 |
| `19-refactor.md` | 38 | 26 | 8 |
| **Total** | **757** | **218** | |

Of the 757, 35 are `out/` or `dist/` paths, and 28 of those are in the two `19-` files.

## 2. Test harnesses

The Node harnesses in `test/e2e`, `test/ui`, and `test/perf` load the `tsc` output in `out/`, with a stub standing in for `vscode`. `tsconfig.json` sets `rootDir` to `src`, so `out/` mirrors `src/` exactly, and any move under `src/` moves the compiled file with it. The mocha suites keep passing, because their imports are compiler-checked. The harnesses fail instead, and only when their own npm script runs.

Since Phase 0 the harnesses no longer name `out/` paths themselves. They take each module by name from the catalog in `test/harness/modules.js`, which maps the name to its path under `out/` once, so a move is one edit there. Two loads still go around it: `test/ui/checkLayout.js:42` builds its own path to `out/domain/query/queryContext.js`, and the page builders reach the harnesses through `out/test/pages.js`, the catalog of `src/test/pages.ts`, whose imports the compiler checks.

### Distinct `out/` modules

The catalog names 40 modules. The harnesses take something from 30 of them at 72 sites in 12 files, and `checkLayout.js` loads a 31st by its own path, for 73 sites in all. `test/perf/indexSpeed.js` loads its seven through `load('…')` (lines 49 to 55), which resolves the name through the catalog's `pathOf`. `src/test/extension.test.ts` reads a 32nd compiled file, `out/extension.js`, listed under "Reads by path in `src/test`" below.

| `out/` module | Catalog name | What the harness takes from it | Used at | On a move |
| --- | --- | --- | --- | --- |
| `core/changelog.js` | `changelog` | `parseChangelog` | `test/ui/pages.js:67` | Breaks |
| `core/storage/parsedFileCodec.js` | `parsedFileCodec` | `encodeParsedFile`, `decodeParsedFile` | `test/perf/indexSpeed.js:55` | Degrades silently |
| `core/storage/searchStore.js` | `searchStore` | `SearchStore` | `test/perf/indexSpeed.js:52` | Degrades silently |
| `core/workspace/indexer.js` | `indexer` | `buildWorkspaceIndex`; perf also takes `createWorkspaceIndex` | `test/e2e/calendar.e2e.js:13`, `test/e2e/calendarPage.e2e.js:13`, `test/e2e/dashboardHome.e2e.js:14`, `test/e2e/searchPage.e2e.js:13`, `test/e2e/sidebarNotes.e2e.js:13`, `test/ui/checkLayout.js:39`, `test/perf/indexSpeed.js:50` | Breaks |
| `core/workspace/scanner.js` | `scanner` | `WorkspaceScanner` | `test/perf/indexSpeed.js:51` | Breaks |
| `domain/markdown/parser.js` | `parser` | `parseMarkdown` | `test/e2e/calendar.e2e.js:12`, `test/e2e/calendarPage.e2e.js:12`, `test/e2e/dashboardHome.e2e.js:13`, `test/e2e/searchPage.e2e.js:12`, `test/e2e/sidebarNotes.e2e.js:12`, `test/e2e/stats.e2e.js:153`, `test/e2e/stats.e2e.js:178`, `test/ui/checkLayout.js:38`, `test/perf/indexSpeed.js:49` | Breaks |
| `domain/query/queryContext.js` | (none; by path) | `createQueryContext` | `test/ui/checkLayout.js:42` | Breaks |
| `shared/timing.js` | `timing` | `setTimingLog` | `test/perf/indexSpeed.js:53` | Degrades silently |
| `test/pages.js` | `pageCatalog` | `PAGES`, which renders every page builder | `test/ui/pages.js:74` | Breaks |
| `test/preferenceServices.js` | `preferenceServices` | `createPreferences` | `test/e2e/calendarPage.e2e.js:18`, `test/e2e/dashboardHome.e2e.js:12`, `test/e2e/searchPage.e2e.js:10`, `test/e2e/sidebarNotes.e2e.js:11`, `test/e2e/stats.e2e.js:11`, `test/e2e/taskBoard.e2e.js:11`, `test/ui/checkLayout.js:40` | Breaks |
| `test/taskWrites.js` | `taskWrites` | `createTaskWrites` | `test/e2e/calendar.e2e.js:53`, `test/e2e/calendarPage.e2e.js:56`, `test/e2e/calendarPage.e2e.js:175`, `test/e2e/dashboardHome.e2e.js:73`, `test/e2e/dashboardHome.e2e.js:149`, `test/e2e/searchPage.e2e.js:65`, `test/e2e/taskBoard.e2e.js:77`, `test/e2e/taskBoard.e2e.js:364` | Breaks |
| `ui/commands/dailyNote.js` | `dailyNote` | `formatLocalDate`, `getPeriodicNote`, which it re-exports from `domain/notes/periodicNotes` | `test/e2e/calendar.e2e.js:14`, `test/e2e/calendarPage.e2e.js:14` | Breaks |
| `ui/commands/workspaceWrites.js` | `workspaceWrites` | `WorkspaceWriteHistory` | `test/e2e/calendarPage.e2e.js:19`, `test/e2e/searchPage.e2e.js:14`, `test/e2e/sidebarNotes.e2e.js:14` | Breaks |
| `ui/providers/tagDecorations.js` | `tagDecorations` | `EditorTagDecorations` | `test/e2e/editorDecorations.e2e.js:9` | Breaks |
| `ui/state/calendarState.js` | `calendarState` | `createCalendar` | `test/ui/checkLayout.js:37` | Breaks |
| `ui/state/dashboardState.js` | `dashboardState` | `createSearchPageSnapshot`, `createDeckardStatsSnapshot` | `test/ui/checkLayout.js:36` | Breaks |
| `ui/state/notesGraphState.js` | `notesGraphState` | `createNotesGraphSnapshot`, `toWire`, `graphInputsChanged` | `test/perf/indexSpeed.js:54` | Breaks |
| `ui/state/relatedNotesRanking.js` | `relatedNotesRanking` | `createSidebarSnapshot` | `test/ui/checkLayout.js:35` | Breaks |
| `ui/state/taskBoardState.js` | `taskBoardState` | `createTaskBoard` | `test/ui/checkLayout.js:34` | Breaks |
| `ui/webview/activeCalendar.js` | `activeCalendar` | `ActiveCalendar` | `test/e2e/calendarPage.e2e.js:15` | Breaks |
| `ui/webview/activeSearch.js` | `activeSearch` | `ActiveSearch` | `test/e2e/calendarPage.e2e.js:16`, `test/e2e/searchPage.e2e.js:9`, `test/e2e/sidebarNotes.e2e.js:10`, `test/e2e/taskBoard.e2e.js:12` | Breaks |
| `ui/webview/calendar.js` | `calendar` | `CalendarView` | `test/e2e/calendar.e2e.js:11` | Breaks |
| `ui/webview/calendarPage.js` | `calendarPage` | `CalendarPanel` | `test/e2e/calendarPage.e2e.js:11` | Breaks |
| `ui/webview/components.js` | `components` | `getZenCss` | `test/ui/verifyWebviews.js:13` | Breaks |
| `ui/webview/dashboard.js` | `dashboard` | `DashboardPanel` | `test/e2e/dashboardHome.e2e.js:11`, `test/e2e/taskBoard.e2e.js:13` | Breaks |
| `ui/webview/searchPage.js` | `searchPage` | `SearchPanels` | `test/e2e/searchPage.e2e.js:8` | Breaks |
| `ui/webview/sidebarNotes.js` | `sidebarNotes` | `SidebarNotesView` | `test/e2e/calendarPage.e2e.js:17`, `test/e2e/searchPage.e2e.js:11`, `test/e2e/sidebarNotes.e2e.js:9` | Breaks |
| `ui/webview/stats.js` | `stats` | `StatsPanel` | `test/e2e/stats.e2e.js:10` | Breaks |
| `ui/webview/taskBoard.js` | `taskBoard` | `TaskBoardPanel` | `test/e2e/taskBoard.e2e.js:10` | Breaks |
| `ui/webview/themePreview.js` | `themePreview` | `ThemePreview` | `test/e2e/calendar.e2e.js:15`, `test/e2e/calendarPage.e2e.js:20`, `test/e2e/dashboardHome.e2e.js:15`, `test/e2e/searchPage.e2e.js:15`, `test/e2e/sidebarNotes.e2e.js:15`, `test/e2e/stats.e2e.js:12`, `test/e2e/taskBoard.e2e.js:14` | Breaks |
| `ui/webview/themes.js` | `themes` | `deckardThemes` | `test/ui/pages.js:77` | Breaks |

Every source file behind these 31 modules exists at the end of Phase 4, as does every one the catalog names. Ten catalog entries have no harness user: `preferences` (`core/storage/preferences.js`) and the nine page builders from `calendarHtml` to `taskBoardHtml`. The page builders reach the harnesses through `test/pages.js`; nothing loads `preferences` by name since the harnesses took `createPreferences`.

"Breaks" now means the catalog entry must follow the move, and until it does every harness that names it fails. The one load by path, `queryContext.js`, breaks alone and needs its own edit.

"Degrades silently" means the harness does not fail. `load()` in `test/perf/indexSpeed.js:39-48` returns `{}` when a module is not found. The perf run guards three of its seven loads: `SearchStore` at line 201, `setTimingLog` at 127 and 178, and the codec at 113. A move of the codec or `timing.js` makes the run print a dash for the steps it can no longer measure, the mark it uses for a step the code cannot do yet. A move of `searchStore.js` makes it time every start without the cache, with no warning. `npm run bench:index` is not a test suite, so nothing fails. The other four loads are used without a guard, and the run stops with a `TypeError`. The run also takes `WorkspaceIndexer` from `indexer.js` for an older checkout; at the end of Phase 4 that export is gone, and the run builds through `createWorkspaceIndex` (line 207).

The export names in the third column are part of the same contract. Renaming an export breaks the harness just as moving its file does.

### Compiled-tree roots

These check that `out/` exists before they run, or join paths onto it. A move inside `src/` does not affect them. A change to `outDir` does.

| File | Line | Path | On a move |
| --- | --- | --- | --- |
| `test/harness/modules.js` | 16 | `out`, joined with each catalog path in `pathOf` | Breaks only if `outDir` changes |
| `test/e2e/run.js` | 30 | `out` | Breaks only if `outDir` changes |
| `test/ui/pages.js` | 10 | `out` | Breaks only if `outDir` changes |
| `test/ui/checkLayout.js` | 26 | `out`, joined at 42 with `domain/query/queryContext.js` | Breaks if `outDir` changes, or if `queryContext.ts` moves |
| `test/perf/indexSpeed.js` | 22 | `out` | Breaks only if `outDir` changes |

### Paths between harness files

A move under `src/` leaves these alone. They break when a harness file moves.

| File | Line | Path | On a move |
| --- | --- | --- | --- |
| `test/ui/pages.js` | 19, 26 | `test/e2e/vscodeStub.js` | Breaks if the stub moves |
| `test/e2e/support.js` | 21 | `./vscodeStub.js` | Breaks if the stub moves |
| `test/perf/indexSpeed.js` | 28 | `test/e2e/vscodeStub.js` | Breaks if the stub moves |
| `test/e2e/run.js` | 19-28, 44, 49 | the eight suite file names, passed to mocha beside `support.js` as its `--require` | Breaks if a suite or `support.js` is renamed |
| `test/e2e/*.e2e.js` | `calendar` 9, `calendarPage` 9, `dashboardHome` 9, `searchPage` 6, `sidebarNotes` 7, `stats` 8, `taskBoard` 8 | `./support.js` | Breaks if the support file moves |
| `test/e2e/*.e2e.js`, `test/ui/pages.js`, `checkLayout.js`, `verifyWebviews.js`, `test/perf/indexSpeed.js` | `calendar` 10, `calendarPage` 10, `dashboardHome` 10, `editorDecorations` 8, `searchPage` 7, `sidebarNotes` 8, `stats` 9, `taskBoard` 9; `pages` 44, `checkLayout` 32, `verifyWebviews` 13; `indexSpeed` 36 | `../harness/modules.js` | Breaks if the catalog moves |
| `test/e2e/support.js`, `test/ui/pages.js`, `checkLayout.js`, `verifyWebviews.js` | 15, 45, 33, 11 | `../harness/loadPage.js` | Breaks if the page loader moves |
| `test/harness/runUnitSuites.js` | 13 | `./importGraph.js` | Breaks if the import graph reader moves |
| `test/ui/checkLayout.js`, `verifyWebviews.js`, `checkContrast.js`, `checkWebviewScripts.js` | 31, 10, 16, 17 | `./pages.js` | Breaks if the catalog moves |
| `test/ui/checkVisual.js` | 30, 31 | `./pages.js`, `./checkLayout.js` | Breaks if either moves |
| `test/ui/checkRenderedContrast.js` | 21, 22 | `./pages.js`, `./checkLayout.js` | Breaks if either moves |
| `test/ui/checkVisual.js` | 63 | `visual-baseline/<platform>` | Records a new baseline and passes if the folder moves, except under `--ci`, which CI passes and which fails the run |
| `test/ui/checkContrast.js` | 679 | `contrast-baseline.json` | Breaks if the baseline moves |
| `test/ui/pages.js` | 65, 68 | `../../package.json`, `CHANGELOG.md` | Breaks if `pages.js` changes depth |

### Reads by path in `src/test`

Most of `src/test` imports through TypeScript, which the compiler checks. These places build a path at runtime instead. Ten files assume that their compiled copy sits exactly at `out/test/<name>.js`, two levels below the repository, as the comment at `src/test/changelog.test.ts:25` says. Moving one of them into a subfolder of `src/test` breaks it.

| File | Line | Path it builds | On a move |
| --- | --- | --- | --- |
| `src/test/extension.test.ts` | 333 | `out/extension.js`, read as text; line 342 asserts `'setContext', '<key>'` for each walkthrough `onContext:` key | Breaks when those `setContext` calls leave `src/extension.ts`, or when the file is renamed |
| `src/test/naming.test.ts` | 10, 11 | the repository root, then `src/ui/webview`; line 94 reads every `.ts` file there | Breaks on a depth change; a page builder moved out of the folder drops out of the check silently |
| `src/test/naming.test.ts` | 31-52 | `src/extension.ts` and, walked recursively, `src/ui/commands`, `ui/views`, `ui/preview`, `ui/webview`, `ui/state`, `ui/providers`, `services`, and `domain` | Checks less without failing: a missing folder is skipped (49-51) |
| `src/test/icons.test.ts` | 14 | `src/ui/webview`, filtered to `*Html.ts` | Passes with nothing to check if the page builders leave the folder |
| `src/test/changelog.test.ts` | 26, 27 | the repository root, then `scripts/changelog.js` | Breaks on a depth change, or if the script moves |
| `src/test/help-page.test.ts` | 17 | `package.json` | Breaks on a depth change |
| `src/test/markdown-injection-grammar.test.ts` | 112 | `syntaxes/deckard.injection.tmLanguage.json` | Breaks on a depth change |
| `src/test/markdown-injection-grammar.test.ts` | 151 | `package.json` | Breaks on a depth change |
| `src/test/choose-theme.test.ts` | 13 | `package.json` | Breaks on a depth change |
| `src/test/tag-decorations.test.ts` | 93 | `../../package.json` | Breaks on a depth change |
| `src/test/indexCorpus.ts` | 18 | the repository root, used at 52 for `resources/sample` and at 73 for `development/notes` | Breaks on a depth change |
| `src/test/sample-workspace.test.ts` | 32 | the repository root, as the extension URI | Breaks on a depth change |
| `src/test/guide.test.ts` | 13 | `docs/guide` | Breaks on a depth change |

The plan puts this `out/extension.js` read at `src/test/extension.test.ts:342`. The read is at line 333, and line 342 holds the assertion.

`.vscode-test.mjs:4` runs `out/test/**/*.test.js`. A subfolder of `src/test` is still found. A test placed beside its source, outside `src/test`, is not run, and nothing reports that it was skipped.

### Constructor signatures and arguments

By the end of Phase 4 every panel and view host the harnesses build takes one options object, so a reordering no longer breaks a call; a renamed or newly required key does, and the compiler does not check any of these calls. `CalendarView` and the state builders still take positional arguments.

| File | Line | Call | Arguments |
| --- | --- | --- | --- |
| `test/e2e/dashboardHome.e2e.js` | 66 | `new DashboardPanel({ indexer, preferences, extensionUri, navigation, whatsNew, tryNext, writes, themePreview })` | 1 object, 8 keys |
| `test/e2e/dashboardHome.e2e.js` | 144 | `new DashboardPanel({ … })` | 1 object, 6 keys |
| `test/e2e/taskBoard.e2e.js` | 71 | `new TaskBoardPanel({ indexer, preferences, extensionUri, openTag, activeSearch, writes, themePreview })` | 1 object, 7 keys |
| `test/e2e/taskBoard.e2e.js` | 355 | `new DashboardPanel({ … })` | 1 object, 6 keys |
| `test/e2e/calendarPage.e2e.js` | 53 | `new CalendarPanel({ indexer, extensionUri, writes, themePreview })` | 1 object, 4 keys |
| `test/e2e/calendarPage.e2e.js` | 156 | `new SidebarNotesView({ indexer, preferences, activeSearch, onOpenTag, extensionVersion, activeCalendar, history, themePreview })` | 1 object, 8 keys |
| `test/e2e/calendarPage.e2e.js` | 172 | `new CalendarPanel({ indexer, extensionUri, writes, themePreview, activeCalendar })` | 1 object, 5 keys |
| `test/e2e/searchPage.e2e.js` | 60 | `new SearchPanels({ indexer, preferences, extensionUri, activeSearch, writes, themePreview })` | 1 object, 6 keys |
| `test/e2e/searchPage.e2e.js` | 79 | `new SidebarNotesView({ … })` | 1 object, 7 keys |
| `test/e2e/sidebarNotes.e2e.js` | 49, 106, 258, 342, 379 | `new SidebarNotesView({ … })` | 1 object, 7 keys each |
| `test/e2e/stats.e2e.js` | 72 | `new StatsPanel({ indexer, preferences, extensionUri, onOpenTag, themePreview })` | 1 object, 5 keys |
| `test/e2e/calendar.e2e.js` | 53 | `new CalendarView(indexer, writes, themePreview)` | 3 |
| `test/e2e/editorDecorations.e2e.js` | 45, 67 | `new EditorTagDecorations().register()` | 0; the provider registers only when `register()` is called |
| `test/e2e/*.e2e.js`, `test/ui/checkLayout.js` | `checkLayout` 143, `calendarPage` 158, `dashboardHome` 63 and 146, `searchPage` 58, `sidebarNotes` 48, 108, 260, 344, 378, `stats` 66, `taskBoard` 68 | `createPreferences(globalState)`, the preference services as the extension builds them | 1 |
| `test/perf/indexSpeed.js` | 202 | `new WorkspaceScanner(access)` | 1 |
| `test/perf/indexSpeed.js` | 208 | `createWorkspaceIndex({ scanner, searchStore, readCache, version, events, ownWrites })` | 1 object, 6 keys |
| `test/perf/indexSpeed.js` | 268 | `new SearchStore(storage)`, a path; line 271 retries with a `Uri` for an older checkout | 1 |
| `test/ui/checkLayout.js` | 148, 165 | `createTaskBoard(index, preferences, search, options, tagTitleDisplayMode)` | 5 |
| `test/ui/checkLayout.js` | 181, 193, 211, 227, 242 | `createCalendar(index, month, queryContext, options)` | 4 |
| `test/ui/checkLayout.js` | 256, 282 | `createSidebarSnapshot(index, filePath, file, options)` | 4 |
| `test/ui/checkLayout.js` | 307, 321 | `createDeckardStatsSnapshot(index, preferences, unreadable, now)`, `createSearchPageSnapshot(index, preferences, query, options)` | 4, 4 |

`test/ui/checkVisual.js` and `test/ui/checkRenderedContrast.js` reuse `createSurfaces()` from `checkLayout.js:139`, so the `checkLayout.js` rows also pin those two checks.

### Reaching into internals

| File | Line | What it touches | On a change |
| --- | --- | --- | --- |
| `test/e2e/calendarPage.e2e.js` | 192, 193, 197 | replaces `page.handleDayMessage` on a `CalendarPanel`, then restores it | Breaks if the method moves off the panel |
| `test/e2e/taskBoard.e2e.js` | 419 | `activeSearch.active === board` | Breaks if the active search stops holding the panel itself |
| `test/e2e/taskBoard.e2e.js` | 421, 429 | `activeSearch.setSidebarVisible(…)` | Breaks if renamed |
| `test/e2e/taskBoard.e2e.js` | 424 | `board.getRefineState()` | Breaks if the method moves off the panel |
| `test/e2e/taskBoard.e2e.js` | 426 | `board.applySearch(…)` | Breaks if the method moves off the panel |
| `test/e2e/taskBoard.e2e.js` | 367 | `dashboard.openSavedFilter(…)` | Breaks if the method moves off the panel |
| `test/e2e/searchPage.e2e.js` | 111, 336, 340, 342, 533, 544 | `panels.showQuery(…)`, `panels.restore(…)` | Breaks if either moves off `SearchPanels` |

Every e2e suite also reads the stub's own hooks, such as `vscode._test`, `panel._toWebview`, `panel._deliver`, `panel._onWebviewMessage`, `panel._setVisible`, and `host._fromWebview`. Those belong to `test/e2e/vscodeStub.js`, not to the source, so a source move does not affect them.

## 3. `scripts/`

Each script finds the repository as its own parent folder, so moving a script breaks it. The four `.mjs` scripts are run from `package.json` lines 2312-2316. `changelog.js` is run by the release workflows.

### `scripts/capture-dashboard-screenshot.mjs`

It builds the extension, launches a real VS Code on a temporary workspace, runs Deckard commands through a companion extension, and captures the README and walkthrough screenshots. The command ids and settings it uses are cross-referenced in [the manifest inventory](manifest.md).

| Line | What it reads or drives | On a move or rename |
| --- | --- | --- |
| 15 | the repository root, as `scripts/..` | Breaks if the script moves |
| 396-404 | runs `node esbuild.js`, which writes `dist/`, unless `DECKARD_SCREENSHOT_SKIP_BUILD=1` | Breaks if the esbuild entries are wrong |
| 417-418 | `--extensionDevelopmentPath` set to the repository root, which loads `package.json` `main`, `./dist/extension.js` | Breaks if the bundle is renamed |
| 497, 555 | the extension id `esperinnovations.deckard-notes`, from `package.json` lines 2 and 4 | Breaks if the name or publisher changes |
| 52, 357 | `deckard.showDashboard`; line 357 also waits for it as the sign that Deckard has activated | Breaks if the id changes |
| 59 | `deckard.showNotesGraph` | Breaks if the id changes |
| 101 | `deckard.showHelp` | Breaks if the id changes |
| 112 | `deckard.showStats` | Breaks if the id changes |
| 119 | `deckard.showTaskBoard` | Breaks if the id changes |
| 76 | `deckard.searchWorkspace` with the argument `'meridian'` | Breaks if the id or its argument changes |
| 85 | `deckard.searchNotes` with a query string | Breaks if the id or its argument changes |
| 92, 110 | `deckard.showTagOverview` with a tag | Breaks if the id or its argument changes |
| 371 | `deckard.reindexWorkspace` | Breaks if the id changes |
| 67-68, 150-151, 161-162 | `workbench.view.extension.deckard`, then `deckard.relatedNotes.focus`, `deckard.outline.focus`, and `deckard.agenda.focus` | Breaks if the view container or a view id changes |
| 294-300 | writes the temporary workspace's `.vscode/settings.json`: `deckard.theme`, `deckard.zenMode`, `workbench.colorTheme`, `workbench.secondarySideBar.defaultVisibility`, `workbench.startupEditor` | Breaks if a Deckard setting is renamed |
| 303 | copies `development/notes` into the temporary workspace | Breaks if the fixture moves |
| 53-166 | writes `docs/images/<view>.png` for 13 views | Stale images only |
| 56, 63, 73, 89, 98, 105, 116, 123 | waits for a webview whose document title is `Deckard Dashboard`, `Deckard Notes Graph`, `Deckard Related Notes`, `Deckard Search`, `Deckard Help`, `Deckard Stats`, or `Deckard Task Board`, and for CSS selectors inside it | Times out if a page's `<title>` or those class names change |

### The other four scripts

| Script | Line | What it reads or drives | On a move or rename |
| --- | --- | --- | --- |
| `scripts/capture-all-dashboard-screenshots.mjs` | 6-12 | reads `src/ui/webview/themes.ts` as text and matches `export const deckardThemes = [ … ] as const;` | Breaks if `themes.ts` moves or the declaration changes shape |
| `scripts/capture-all-dashboard-screenshots.mjs` | 23 | runs `node esbuild.js` | Breaks if the esbuild entries are wrong |
| `scripts/capture-all-dashboard-screenshots.mjs` | 33, 41 | runs `capture-dashboard-screenshot.mjs` once per theme, writing `docs/images/dashboard-<theme>.png` | Breaks if that script moves |
| `scripts/capture-readme-screenshots.mjs` | 22-28 | the same `themes.ts` read and match | Breaks if `themes.ts` moves or the declaration changes shape |
| `scripts/capture-readme-screenshots.mjs` | 7-21 | 13 view names, which must be keys of `viewConfiguration` in `capture-dashboard-screenshot.mjs` | Unaffected by a source move |
| `scripts/capture-readme-screenshots.mjs` | 64, 75 | runs `node esbuild.js`, then `capture-dashboard-screenshot.mjs` per view | Breaks if either is wrong |
| `scripts/build-walkthrough-images.mjs` | 13, 14, 61-67 | reads `docs/images/*.png` and writes `resources/walkthrough/*.png` | Unaffected by a source move |
| `scripts/changelog.js` | 20, 21, 216 | reads and writes `CHANGELOG.md` in the working folder, in the `## x.y.z - date` and `### Highlights` shape | Unaffected by a source move |

`scripts/changelog.js` does not import `src/core/changelog.ts`. The two share a file format. The script writes `CHANGELOG.md`, and `parseChangelog` in `src/core/changelog.ts` reads the shipped copy at runtime for Home and Help. `src/test/changelog.test.ts` ties them together: it imports `../core/changelog` at line 11 and requires the script by path at line 27. A move of `src/core/changelog.ts` is caught by the compiler in that import. A move of the script breaks the test, `prepare-release.yml:115`, and `release.yml:68` and `:131`.

## 4. Build, packaging, and CI configuration

| File | Line | Path or setting | On a move |
| --- | --- | --- | --- |
| `esbuild.js` | 31 | entry `src/extension.ts` | Breaks the build |
| `esbuild.js` | 32 | entry `src/core/storage/searchStoreWorker.ts` | Breaks the build |
| `esbuild.js` | 40-41 | `outdir: 'dist'`, `entryNames: '[name]'`: each bundle is named after its entry's file name, flat in `dist/` | Renaming an entry renames its bundle; two entries with one file name collide |
| `package.json` | 55 | `"main": "./dist/extension.js"` | Breaks activation if the main entry is renamed |
| `src/core/storage/searchStoreWorkerClient.ts` | 130 | `join(__dirname, 'searchStoreWorker.js')`: the worker must sit beside the client in `out/` and beside the bundle in `dist/` | Degrades silently: with no worker file, line 70 turns the index cache off |
| `tsconfig.json` | 13 | `"rootDir": "src"` | Every `out/` path in section 2 follows from it |
| `.vscode-test.mjs` | 4 | `files: 'out/test/**/*.test.js'` | A test outside `src/test` is not run |
| `package.json` | 2304, 2306, 2308 | `compile`, `watch:esbuild`, `package` run `node esbuild.js` | Follow `esbuild.js` |
| `package.json` | 2307, 2318 | `watch:tsc`, `check-types` run `tsc --noEmit` over `tsconfig.json` | Unaffected |
| `package.json` | 2310, 2311 | `compile-tests`, `watch-tests`: `tsc -p . --outDir out` | Unaffected; they produce `out/` |
| `package.json` | 2319 | `lint`: `eslint src --max-warnings 0` | Unaffected while code stays under `src/`; code outside it goes unlinted |
| `package.json` | 2320 | `test`: `vscode-test`, which reads `.vscode-test.mjs` | Follows `.vscode-test.mjs` |
| `package.json` | 2321 | `test:e2e`: `node test/e2e/run.js` | Breaks if the runner moves |
| `package.json` | 2322 | `test:ui`: `test/ui/verifyWebviews.js`, `checkWebviewScripts.js`, `checkContrast.js` | Breaks if a check moves |
| `package.json` | 2323 | `test:layout`: `test/ui/checkLayout.js`, `checkRenderedContrast.js` | Breaks if a check moves |
| `package.json` | 2324, 2325 | `test:contrast`, `test:visual`: `test/ui/checkContrast.js`, `checkVisual.js` | Breaks if a check moves |
| `package.json` | 2326 | `bench:index`: `test/perf/indexSpeed.js` | Breaks if the harness moves |
| `package.json` | 1429-1431 | `markdown.markdownItPlugins`, `markdown.previewStyles` `./resources/query-block.css` | Unaffected by a source move |
| `eslint.config.mjs` | 4 | `files: ["**/*.ts"]` | Unaffected; `lint` limits it to `src` |
| `.vscodeignore` | 8, 10, 17, 18 | excludes `out/**`, `src/**`, `**/*.map`, `**/*.ts` | Unaffected by a move inside `src/` |
| `.vscodeignore` | 22-24, 29 | excludes `docs/**`, `test/**`, `scripts/**`, then keeps `docs/guide/**` | Unaffected by a source move |
| `.vscodeignore` | (none) | nothing names `dist/`, so the VSIX ships everything in `dist/` except maps | A new `dist/` file ships without a change here |
| `.gitignore` | 1, 2 | `out`, `dist` | Unaffected |
| `.github/workflows/ci.yml` | 40, 43, 46, 49, 52, 55 | `npm test`, `test:ui`, `test:e2e`, `test:layout`, `test:visual`, `package:vsix`; no paths | Follows `package.json` |
| `.github/workflows/release.yml`, `prepare-release.yml` | `release.yml` 59, 63, 68, 131; `prepare-release.yml` 115 | `npm test`, `package:vsix`, and `node scripts/changelog.js` | Breaks only if `scripts/changelog.js` moves |
| `.github/workflows/docs.yml` | 20-25, 48-53, 65-67 | triggers on and copies `docs/guide/**`, `docs/images/**`, `docs/site/**`, and `resources/lockup.png`; rewrites `../` links to GitHub | Unaffected by a source move; the plan adds `docs/architecture/**` here |

No workflow names a `src/`, `out/`, or `dist/` path.

## 5. `.vscode/` and `development/`

The repository tracks one file under `.vscode/` and only notes under `development/`. The primary checkout also holds four untracked files, ignored by the owner's global gitignore rather than by `.gitignore`. They are listed so a reader knows they exist, but a fresh clone does not have them.

| File | Tracked | Line | Path or setting | On a move |
| --- | --- | --- | --- | --- |
| `.vscode/launch.json` | Yes | 15, 16 | `.vscode/development-user-data` and `.vscode/development-extensions`, ignored at `.gitignore` 6-7 | Unaffected |
| `.vscode/launch.json` | Yes | 17 | `--extensionDevelopmentPath=${workspaceFolder}`, which loads `package.json` `main` | Breaks if the bundle is renamed |
| `.vscode/launch.json` | Yes | 19 | `outFiles`: `${workspaceFolder}/dist/**/*.js` | Breakpoints stop binding if bundles leave `dist/` |
| `.vscode/launch.json` | Yes | 20 | `preLaunchTask`: `npm: watch` | Follows `package.json` `watch` |
| `.vscode/settings.json` | No | 4, 5, 8, 9 | `files.exclude` and `search.exclude` for `out` and `dist` | Unaffected |
| `.vscode/tasks.json` | No | 7-9, 25, 37, 49 | `npm: watch`, `watch:esbuild`, `watch:tsc`, `watch-tests` | Follows `package.json` scripts |
| `.vscode/extensions.json` | No | 4 | three recommended extensions; no paths | Unaffected |
| `development/notes/` | Yes (51 notes) | n/a | the fixture workspace's notes; they cite no source paths | Breaks `src/test/indexCorpus.ts:69` and `scripts/capture-dashboard-screenshot.mjs:303` if the folder moves |
| `development/.vscode/settings.json` | No | 2-5 | `deckard.entityNamespaceAliases` | Unaffected by a source move; stale if the setting is renamed |
| `.vscodeignore` | Yes | 4 | `development/**` | Unaffected |
| `src/test/indexCorpus.ts` | Yes | 69, 77 | reads `development/notes` into the index corpus | Breaks on a depth change (section 2) |

The plan calls `development/` "a fixture workspace with its own settings". At `1805a01` the repository holds only its 51 notes. The settings file, `development/.vscode/settings.json`, is untracked and exists only in the primary checkout.

In a fresh clone there is no `tasks.json`. The `npm: watch` label that `launch.json` needs then comes from VS Code's npm task detection.

## How to regenerate

Run these from the repository root in `bash`. Each prints `file:line:match`, or a count.

Section 1, current docs:

```bash
git grep -nIoE '(^|[^A-Za-z0-9_./-])(src|out|dist)/[A-Za-z0-9_.*/-]*' -- '*.md' ':!docs/implementation/**'
git grep -nIoE '(^|[^A-Za-z0-9_./-])test/(ui|e2e|perf)/[A-Za-z0-9_./*-]*' -- '*.md' ':!docs/implementation/**'
git grep -nIE '(src|out|dist)/[A-Za-z0-9_./-]+:[0-9]' -- '*.md' ':!docs/implementation/**'
```

Section 1, `docs/implementation/`, citations per file:

```bash
for f in docs/implementation/*.md; do
  printf '%s %s\n' "$f" "$(git grep -hIoE '(^|[^A-Za-z0-9_./-])(src|out|dist)/[A-Za-z0-9_.*/-]*' -- "$f" | wc -l)"
done
```

Section 2:

```bash
grep -rnoE '\.\./\.\./out/[A-Za-z0-9_./-]+\.js' test
grep -nE "^  [A-Za-z]+: '[^']+'," test/harness/modules.js
grep -rnoE "modules\.[A-Za-z]+|require\('\.\./harness/modules\.js'\)\.[A-Za-z]+" test | grep -v '^test/harness/modules.js' | grep -v ':modules\.js$'
grep -rnE "require\(path\.join\((compiled|out)\b" test
grep -noE "load\('[^']+'\)" test/perf/indexSpeed.js
grep -rnE "'out'|\"out\"" test
grep -rnE "__dirname|path\.join\(root, 'out'" src/test
grep -rnE "require\('\./|require\('\.\./harness/|require\(path\.join\(__dirname" test
grep -rnE 'new (DashboardPanel|SidebarNotesView|TaskBoardPanel|SearchPanels|StatsPanel|CalendarView|CalendarPanel|EditorTagDecorations|WorkspaceScanner|SearchStore)\b|\b(createPreferences|createWorkspaceIndex)\(' test
grep -nE 'createTaskBoard\(|createSidebarSnapshot\(|createCalendar\(|createDeckardStatsSnapshot\(|createSearchPageSnapshot\(' test/ui/checkLayout.js
```

Section 3:

```bash
grep -nE "src/|esbuild\.js|deckard\.[A-Za-z.]+|workbench\.view|development|docs/images|resources/|CHANGELOG" scripts/*.mjs scripts/*.js
```

Sections 4 and 5:

```bash
grep -nE "src/|out|dist" esbuild.js tsconfig.json .vscode-test.mjs .vscodeignore .gitignore .vscode/launch.json eslint.config.mjs
grep -nE '"main"|"(vscode:prepublish|compile|watch|package|pretest|check-types|lint|test|bench|capture)[^"]*":' package.json
grep -nE "src/|out/|dist/|scripts/|test/|docs/|npm (run|test)" .github/workflows/*.yml
grep -rn "__dirname" src | grep -v '^src/test/'
git ls-files .vscode development | grep -v '^development/notes/'
```

## What to check after each phase

Run these in `bash` from the repository root. Checks 1 to 5 print nothing while the inventory still holds.

1. Every `src/` path the current docs cite still exists:

   ```bash
   git grep -hIoE '(^|[^A-Za-z0-9_./-])(src|out|dist)/[A-Za-z0-9_.*/-]*' -- '*.md' ':!docs/implementation/**' | sed -E 's#^[^A-Za-z0-9_./-]##; s#[.]$##; s#/$##' | sort -u | while read -r p; do compgen -G "$p" >/dev/null || echo "stale: $p"; done
   ```

2. Every `out/` module the harnesses load exists, after `npm run compile-tests`:

   ```bash
   { grep -rhoE '\.\./\.\./out/[A-Za-z0-9_./-]+\.js' test | sed 's#^\.\./\.\./##'; grep -oE "load\('[^']+'\)" test/perf/indexSpeed.js | sed -E "s#load\('([^']+)'\)#out/\1#"; echo out/extension.js; } | sort -u | while read -r p; do [ -f "$p" ] || echo "missing: $p"; done
   ```

   Since Phase 0 the harnesses load through the catalog, so the check above finds no `../../out/` path, and it reads the perf run's `load('…')` names as paths, so it reports those seven as missing. This one checks every catalog entry and the one load by path:

   ```bash
   { grep -oE "^  [A-Za-z]+: '[^']+'" test/harness/modules.js | sed -E "s#.*'([^']+)'#out/\1#"; echo out/domain/query/queryContext.js; } | sort -u | while read -r p; do [ -f "$p" ] || echo "missing: $p"; done
   ```

3. Every `src/` path that `esbuild.js` and the scripts name still exists:

   ```bash
   grep -ohE "'src/[^']+'" esbuild.js scripts/*.mjs | tr -d "'" | sort -u | while read -r p; do [ -f "$p" ] || echo "missing: $p"; done
   ```

4. Every `deckard.*` id the screenshot script uses is still in `package.json`:

   ```bash
   for id in $(grep -ohE 'deckard\.[A-Za-z]+(\.focus)?' scripts/capture-dashboard-screenshot.mjs | sort -u); do grep -q "\"${id%.focus}\"" package.json || echo "missing: $id"; done
   ```

5. Every `src/test` file that climbs two folders to the root still sits directly in `src/test`:

   ```bash
   git grep -lE "__dirname, '\.\.', '\.\.'|__dirname, '\.\./\.\./" src/test | grep -v '^src/test/[^/]*$'
   ```

6. The suites that load these paths still pass, gated on their exit codes: `npm test`, `npm run test:ui`, `npm run test:e2e`, `npm run test:layout`, and `npm run test:visual`. Then run `npm run bench:index` and confirm that no row which printed a number at `1805a01` now prints a dash.
