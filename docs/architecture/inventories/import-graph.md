# Import graph baseline

This is the import graph of `src/` as it stood before Phase 0 of [the refactor plan](../../implementation/19-refactor.md) moved anything, taken at `dev` 1805a01. It sizes the work of Phases 1 to 5: which folders reach `vscode`, which import each other the wrong way, which mocha suites can already run without the extension host, and how many files read each piece of module-level state that Phase 2 replaces. The rules that hold the graph to its target, and the violations recorded as known, are described in [the layers page](../layers.md).

Everything below the line is printed by `node scripts/import-graph-report.js`, which reads the graph with dependency-cruiser and the rules' own configuration, `.dependency-cruiser.cjs`. Type-only imports count, since a type imported the wrong way is a dependency that a later value import follows. Each phase reruns the script and replaces this page's tables, so the numbers shrink in the history rather than in anyone's memory.

## What the baseline says

- **101 of the 171 shipped source files import `vscode`, and 119 reach it.** The difference is `ui/state`, which imports `vscode` nowhere but reaches it in 13 of its 27 files, through `ui/commands/dailyNote.ts`, `ui/commands/rollover.ts`, and `ui/webview/rendering.ts`, and through `core/storage/preferences.ts` and `core/workspace/indexer.ts`.
- **Only 16 of the 139 mocha suites can run under plain mocha today.** The plan counted 67 suites that do not import `vscode` themselves; 51 of those still reach it through what they test. Two modules stand in the way of 28 of them: `core/workspace/indexer.ts`, which holds the pure `buildWorkspaceIndex`, and `core/storage/preferences.ts`. Phase 1 moves the first and Phase 2 puts the second on a `KeyValueStore` port, and `test:unit` picks up each suite as soon as its path to `vscode` is gone.
- **Seven pairs of folders import each other.** `ui/commands` and `ui/webview` are the largest pair: the page hosts import 23 distinct command modules, counting type-only imports, and two command modules import page hosts. `core/storage` and `ui/state` import each other through `isTaskColumnId`.
- **There is one module cycle**, among `agendaState.ts`, `dashboardState.ts`, and `queryBlockState.ts` in `ui/state`.
- **The search-store worker is clean.** Its closure is five modules, none of which reaches `vscode`, and the rule `search-worker-never-reaches-vscode` keeps it that way.
- **`workspaceWrites` is read by 13 source files and 6 test files.** The plan's count of 14 source files also took in a file that names the type rather than the singleton.

---

## Folders and `vscode`

| Folder | Files | Import `vscode` | Reach `vscode` |
| --- | --- | --- | --- |
| `src/core/changelog.ts` | 1 | 0 | 0 |
| `src/core/markdown` | 14 | 0 | 0 |
| `src/core/mcp` | 1 | 0 | 0 |
| `src/core/query` | 6 | 0 | 0 |
| `src/core/storage` | 7 | 3 | 3 |
| `src/core/taskPolicy.ts` | 1 | 0 | 0 |
| `src/core/timing.ts` | 1 | 0 | 0 |
| `src/core/types.ts` | 1 | 0 | 0 |
| `src/core/workspace` | 8 | 3 | 3 |
| `src/extension.ts` | 1 | 1 | 1 |
| `src/ui/commands` | 64 | 62 | 63 |
| `src/ui/preview` | 3 | 1 | 3 |
| `src/ui/state` | 27 | 0 | 13 |
| `src/ui/views` | 4 | 4 | 4 |
| `src/ui/webview` | 32 | 27 | 29 |
| **All shipped source** | 171 | 101 | 119 |

## Imports between folders

| From | To | Imports | Distinct modules imported |
| --- | --- | --- | --- |
| `src/core/markdown` | `src/core/taskPolicy.ts` | 1 | 1 |
| `src/core/markdown` | `src/core/types.ts` | 5 | 1 |
| `src/core/query` | `src/core/markdown` | 3 | 3 |
| `src/core/query` | `src/core/taskPolicy.ts` | 1 | 1 |
| `src/core/query` | `src/core/types.ts` | 2 | 1 |
| `src/core/query` | `src/core/workspace` | 3 | 2 |
| `src/core/storage` | `src/core/markdown` | 1 | 1 |
| `src/core/storage` | `src/core/timing.ts` | 1 | 1 |
| `src/core/storage` | `src/core/types.ts` | 5 | 1 |
| `src/core/storage` | `src/ui/state` | 1 | 1 |
| `src/core/taskPolicy.ts` | `src/core/types.ts` | 1 | 1 |
| `src/core/types.ts` | `src/core/query` | 1 | 1 |
| `src/core/workspace` | `src/core/markdown` | 3 | 1 |
| `src/core/workspace` | `src/core/query` | 1 | 1 |
| `src/core/workspace` | `src/core/storage` | 1 | 1 |
| `src/core/workspace` | `src/core/timing.ts` | 2 | 1 |
| `src/core/workspace` | `src/core/types.ts` | 5 | 1 |
| `src/extension.ts` | `src/core/mcp` | 1 | 1 |
| `src/extension.ts` | `src/core/query` | 1 | 1 |
| `src/extension.ts` | `src/core/storage` | 3 | 3 |
| `src/extension.ts` | `src/core/taskPolicy.ts` | 1 | 1 |
| `src/extension.ts` | `src/core/timing.ts` | 1 | 1 |
| `src/extension.ts` | `src/core/workspace` | 2 | 2 |
| `src/extension.ts` | `src/ui/commands` | 53 | 53 |
| `src/extension.ts` | `src/ui/preview` | 1 | 1 |
| `src/extension.ts` | `src/ui/state` | 4 | 4 |
| `src/extension.ts` | `src/ui/views` | 4 | 4 |
| `src/extension.ts` | `src/ui/webview` | 14 | 14 |
| `src/ui/commands` | `src/core/changelog.ts` | 1 | 1 |
| `src/ui/commands` | `src/core/markdown` | 67 | 10 |
| `src/ui/commands` | `src/core/mcp` | 1 | 1 |
| `src/ui/commands` | `src/core/query` | 3 | 1 |
| `src/ui/commands` | `src/core/storage` | 13 | 2 |
| `src/ui/commands` | `src/core/timing.ts` | 13 | 1 |
| `src/ui/commands` | `src/core/types.ts` | 42 | 1 |
| `src/ui/commands` | `src/core/workspace` | 52 | 7 |
| `src/ui/commands` | `src/ui/state` | 28 | 14 |
| `src/ui/commands` | `src/ui/webview` | 2 | 2 |
| `src/ui/preview` | `src/core/markdown` | 2 | 2 |
| `src/ui/preview` | `src/core/timing.ts` | 1 | 1 |
| `src/ui/preview` | `src/core/types.ts` | 3 | 1 |
| `src/ui/preview` | `src/core/workspace` | 3 | 3 |
| `src/ui/preview` | `src/ui/state` | 3 | 2 |
| `src/ui/preview` | `src/ui/webview` | 1 | 1 |
| `src/ui/state` | `src/core/markdown` | 39 | 7 |
| `src/ui/state` | `src/core/query` | 27 | 6 |
| `src/ui/state` | `src/core/storage` | 3 | 2 |
| `src/ui/state` | `src/core/taskPolicy.ts` | 3 | 1 |
| `src/ui/state` | `src/core/types.ts` | 25 | 1 |
| `src/ui/state` | `src/core/workspace` | 21 | 3 |
| `src/ui/state` | `src/ui/commands` | 4 | 2 |
| `src/ui/state` | `src/ui/preview` | 1 | 1 |
| `src/ui/state` | `src/ui/webview` | 2 | 1 |
| `src/ui/views` | `src/core/markdown` | 2 | 2 |
| `src/ui/views` | `src/core/timing.ts` | 1 | 1 |
| `src/ui/views` | `src/core/types.ts` | 2 | 1 |
| `src/ui/views` | `src/core/workspace` | 3 | 3 |
| `src/ui/views` | `src/ui/commands` | 6 | 4 |
| `src/ui/views` | `src/ui/state` | 7 | 6 |
| `src/ui/webview` | `src/core/changelog.ts` | 2 | 1 |
| `src/ui/webview` | `src/core/markdown` | 5 | 3 |
| `src/ui/webview` | `src/core/query` | 4 | 3 |
| `src/ui/webview` | `src/core/storage` | 6 | 1 |
| `src/ui/webview` | `src/core/timing.ts` | 7 | 1 |
| `src/ui/webview` | `src/core/types.ts` | 11 | 1 |
| `src/ui/webview` | `src/core/workspace` | 25 | 6 |
| `src/ui/webview` | `src/ui/commands` | 44 | 23 |
| `src/ui/webview` | `src/ui/state` | 19 | 13 |

Folders that import each other:

- `src/core/query` and `src/core/workspace` import each other.
- `src/core/query` and `src/core/types.ts` import each other.
- `src/core/storage` and `src/ui/state` import each other.
- `src/ui/commands` and `src/ui/state` import each other.
- `src/ui/state` and `src/ui/webview` import each other.
- `src/ui/commands` and `src/ui/webview` import each other.
- `src/ui/preview` and `src/ui/state` import each other.

## Module cycles

- `src/ui/state/agendaState.ts`, `src/ui/state/dashboardState.ts`, `src/ui/state/queryBlockState.ts`

## The search-store worker

`src/core/storage/searchStoreWorker.ts` is its own esbuild entry. Its closure within `src`:

- `src/core/query/queryTypes.ts`
- `src/core/storage/parsedFileCodec.ts`
- `src/core/storage/searchDatabase.ts`
- `src/core/storage/searchStoreWorker.ts`
- `src/core/types.ts`

What it imports from outside `src`: `fs`, `node:sqlite`, `path`, `worker_threads`.

## Which suites need the extension host

| Suites | Count |
| --- | --- |
| All mocha suites in `src/test` | 139 |
| Import `vscode` themselves | 72 |
| Import no `vscode` themselves, but reach it | 51 |
| Never reach `vscode`, so run under `test:unit` | 16 |

The suites under `test:unit`: `changelog`, `due-date-wording`, `frontmatter-tags`, `markdown-parser`, `mcp-protocol`, `naming`, `outline-tree`, `own-writes`, `result-table`, `tag-navigation`, `task-draft`, `task-metadata`, `task-query`, `timing`, `try-next`, `webview-page`.

For the suites that reach `vscode` only through what they test, the module on the shortest path that imports `vscode` itself:

| Imports `vscode` | Suites that reach it first | Examples |
| --- | --- | --- |
| `src/core/workspace/indexer.ts` | 14 | assignee, assistant-tools, dashboard-widgets, index-equivalence |
| `src/core/storage/preferences.ts` | 14 | parked-commands, parked-lists, people-recency, pinned-notes |
| `src/ui/webview/sidebarNotes.ts` | 2 | entry-matching, related-notes-evaluation |
| `src/ui/webview/searchPageHtml.ts` | 2 | query-builder-webview, search-history |
| `src/ui/commands/bulkEdit.ts` | 2 | tags-in-code, tags-in-links |
| `src/ui/commands/assistantWrites.ts` | 1 | assistant-writes |
| `src/ui/commands/capture.ts` | 1 | capture-words |
| `src/ui/commands/checkSetup.ts` | 1 | check-setup |
| `src/ui/commands/dailyNote.ts` | 1 | daily-notes |
| `src/ui/commands/datePrompt.ts` | 1 | date-phrases |
| `src/ui/commands/exportResults.ts` | 1 | export-results |
| `src/ui/webview/icons.ts` | 1 | icons |
| `src/ui/commands/moveTo.ts` | 1 | move-lines |
| `src/ui/commands/moveTagsToFrontmatter.ts` | 1 | move-tags-to-frontmatter |
| `src/ui/commands/activeNoteContext.ts` | 1 | note-actions |
| `src/ui/webview/notesGraphHtml.ts` | 1 | notes-graph-behavior |
| `src/ui/commands/notify.ts` | 1 | notify |
| `src/ui/commands/sampleWorkspace.ts` | 1 | parsed-file-codec |
| `src/ui/commands/quickFind.ts` | 1 | quick-find-actions |
| `src/ui/webview/sidebarNotesHtml.ts` | 1 | related-notes-behavior |
| `src/ui/webview/components.ts` | 1 | spacing-scale |
| `src/ui/commands/templates.ts` | 1 | templates |

## Readers of module-level state

Files other than the owner that use a function which reads or writes the state:

| State | Owner | Source files | Test files |
| --- | --- | --- | --- |
| `queryIdentity`, `queryWeekStart` | `src/core/query/queryEvaluator.ts` | 2 | 4 |
| `policy` | `src/core/taskPolicy.ts` | 11 | 6 |
| `log` | `src/core/timing.ts` | 27 | 4 |
| `keepTaskRank` | `src/ui/commands/taskActions.ts` | 3 | 1 |
| `workspaceWrites` | `src/ui/commands/workspaceWrites.ts` | 13 | 6 |
| `ownWrites` | `src/core/workspace/ownWrites.ts` | 3 | 1 |
| `previewTheme` | `src/ui/webview/themes.ts` | 2 | 2 |
| `focusedIn` | `src/ui/commands/focusSection.ts` | 1 | 1 |

## Known violations

| Rule | Count | Imports |
| --- | --- | --- |
| `commands-not-to-webview` | 2 | `ui/commands/chooseTheme.ts` to `ui/webview/themes.ts`; `ui/commands/editorReferences.ts` to `ui/webview/sidebarNotes.ts` |
| `core-not-to-ui` | 1 | `core/storage/preferences.ts` to `ui/state/resultTable.ts` |
| `core-not-to-vscode` | 6 | `core/storage/preferences.ts` to `vscode`; `core/storage/preferenceSnapshots.ts` to `vscode`; `core/storage/searchStore.ts` to `vscode`; `core/workspace/indexer.ts` to `vscode`; `core/workspace/publishing.ts` to `vscode`; `core/workspace/scanner.ts` to `vscode` |
| `no-circular` | 2 | cycle through `dashboardState.ts`, `agendaState.ts`; cycle through `queryBlockState.ts`, `dashboardState.ts`, `agendaState.ts` |
| `query-format-not-to-parser` | 1 | `core/query/queryFormat.ts` to `core/query/queryParser.ts` |
| `query-parser-not-to-evaluator` | 1 | `core/query/queryParser.ts` to `core/query/queryEvaluator.ts` |
| `state-not-to-commands-views-or-webview` | 6 | `ui/state/calendarState.ts` to `ui/commands/dailyNote.ts`; `ui/state/dashboardState.ts` to `ui/webview/rendering.ts`; `ui/state/dashboardWidgets.ts` to `ui/commands/dailyNote.ts`; `ui/state/editorLensState.ts` to `ui/commands/dailyNote.ts`; `ui/state/editorLensState.ts` to `ui/commands/rollover.ts`; `ui/state/taskBoardState.ts` to `ui/webview/rendering.ts` |

## How to regenerate

```sh
node scripts/import-graph-report.js                          # every table above
npx depcruise src --config .dependency-cruiser.cjs --no-ignore-known --output-type err
                                                              # every violation, known ones included
npx depcruise src --config .dependency-cruiser.cjs --output-type archi | dot -T svg > layers.svg
                                                              # the folder-level picture, with Graphviz installed
```

When a phase removes known violations, `npm run lint:deps:baseline` rewrites `.dependency-cruiser-known-violations.json`, and the diff of that file is the record of what the phase fixed.
