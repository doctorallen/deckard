# Import graph

This is the import graph of `src/` at the end of Phase 1 of [the refactor plan](../../implementation/19-refactor.md), on the branch `refactor/01-helpers-and-model`. It sizes the work still ahead: which folders reach `vscode`, which import each other the wrong way, which mocha suites can run without the extension host, and how many files read each piece of module-level state that Phase 2 replaces. The rules that hold the graph to its target, and the violations recorded as known, are described in [the layers page](../layers.md).

Everything below the line is printed by `node scripts/import-graph-report.js`, which reads the graph with dependency-cruiser and the rules' own configuration, `.dependency-cruiser.cjs`. Type-only imports count, since a type imported the wrong way is a dependency that a later value import follows. Each phase reruns the script and replaces this page's tables, so the numbers shrink in the history rather than in anyone's memory.

## Since the baseline

| Measure | Before Phase 0 (`dev` 1805a01) | End of Phase 1 |
| --- | --- | --- |
| Mocha suites that run under `test:unit` | 16 of 139 | 30 of 149 |
| Pairs of folders that import each other | 7 | 3 |
| Known dependency violations | 19 | 12 |
| Module cycles | 1 | 1 |

- **Phase 1 moved the pure code to its layer.** The domain model and the page protocol left `core/types.ts`, `buildWorkspaceIndex` left the indexer, the periodic-note and rollover rules left their commands, and the query parser no longer imports the evaluator. Eight known violations went with them.
- **One violation is new, and temporary.** `core/types.ts` is now a shim that re-exports `ui/protocol`, so every old import keeps compiling; that is a core-to-UI import until Phase 7 deletes the shim.
- **`core/storage/preferences.ts` now keeps 23 suites in the extension host**, the most of any module. Phase 2 puts it on a `KeyValueStore` port, which is what moves them.
- **The cycle among `agendaState.ts`, `dashboardState.ts`, and `queryBlockState.ts` remains**, for Phase 4, when their engines move to `domain/`.

---

## Folders and `vscode`

| Folder | Files | Import `vscode` | Reach `vscode` |
| --- | --- | --- | --- |
| `src/core/changelog.ts` | 1 | 0 | 0 |
| `src/core/debounce.ts` | 1 | 0 | 0 |
| `src/core/guards.ts` | 1 | 0 | 0 |
| `src/core/markdown` | 17 | 0 | 0 |
| `src/core/mcp` | 1 | 0 | 0 |
| `src/core/paths.ts` | 1 | 0 | 0 |
| `src/core/query` | 8 | 0 | 0 |
| `src/core/storage` | 7 | 3 | 3 |
| `src/core/taskColumns.ts` | 1 | 0 | 0 |
| `src/core/taskPolicy.ts` | 1 | 0 | 0 |
| `src/core/text.ts` | 1 | 0 | 0 |
| `src/core/timing.ts` | 1 | 0 | 0 |
| `src/core/types.ts` | 1 | 0 | 0 |
| `src/core/workspace` | 10 | 3 | 3 |
| `src/domain/model/index.ts` | 1 | 0 | 0 |
| `src/domain/model/notes.ts` | 1 | 0 | 0 |
| `src/domain/model/preferences.ts` | 1 | 0 | 0 |
| `src/domain/model/query.ts` | 1 | 0 | 0 |
| `src/domain/model/tags.ts` | 1 | 0 | 0 |
| `src/domain/model/tasks.ts` | 1 | 0 | 0 |
| `src/domain/model/workspaceIndex.ts` | 1 | 0 | 0 |
| `src/extension.ts` | 1 | 1 | 1 |
| `src/shared/html.ts` | 1 | 0 | 0 |
| `src/ui/commands` | 67 | 65 | 66 |
| `src/ui/preview` | 3 | 1 | 3 |
| `src/ui/protocol` | 9 | 0 | 0 |
| `src/ui/state` | 28 | 0 | 13 |
| `src/ui/views` | 4 | 4 | 4 |
| `src/ui/webview` | 33 | 28 | 30 |
| **All shipped source** | 205 | 105 | 123 |

## Imports between folders

| From | To | Imports | Distinct modules imported |
| --- | --- | --- | --- |
| `src/core/markdown` | `src/core/taskPolicy.ts` | 1 | 1 |
| `src/core/markdown` | `src/core/types.ts` | 5 | 1 |
| `src/core/mcp` | `src/core/guards.ts` | 1 | 1 |
| `src/core/query` | `src/core/markdown` | 5 | 4 |
| `src/core/query` | `src/core/paths.ts` | 1 | 1 |
| `src/core/query` | `src/core/taskPolicy.ts` | 1 | 1 |
| `src/core/query` | `src/core/text.ts` | 1 | 1 |
| `src/core/query` | `src/core/types.ts` | 2 | 1 |
| `src/core/query` | `src/core/workspace` | 2 | 2 |
| `src/core/query` | `src/domain/model/query.ts` | 1 | 1 |
| `src/core/storage` | `src/core/markdown` | 1 | 1 |
| `src/core/storage` | `src/core/taskColumns.ts` | 1 | 1 |
| `src/core/storage` | `src/core/timing.ts` | 1 | 1 |
| `src/core/storage` | `src/core/types.ts` | 5 | 1 |
| `src/core/taskColumns.ts` | `src/core/types.ts` | 1 | 1 |
| `src/core/taskPolicy.ts` | `src/core/types.ts` | 1 | 1 |
| `src/core/types.ts` | `src/domain/model/index.ts` | 1 | 1 |
| `src/core/types.ts` | `src/domain/model/preferences.ts` | 1 | 1 |
| `src/core/types.ts` | `src/ui/protocol` | 1 | 1 |
| `src/core/workspace` | `src/core/markdown` | 5 | 2 |
| `src/core/workspace` | `src/core/query` | 1 | 1 |
| `src/core/workspace` | `src/core/storage` | 1 | 1 |
| `src/core/workspace` | `src/core/timing.ts` | 2 | 1 |
| `src/core/workspace` | `src/core/types.ts` | 7 | 1 |
| `src/domain/model/index.ts` | `src/domain/model/notes.ts` | 1 | 1 |
| `src/domain/model/index.ts` | `src/domain/model/preferences.ts` | 1 | 1 |
| `src/domain/model/index.ts` | `src/domain/model/query.ts` | 1 | 1 |
| `src/domain/model/index.ts` | `src/domain/model/tags.ts` | 1 | 1 |
| `src/domain/model/index.ts` | `src/domain/model/tasks.ts` | 1 | 1 |
| `src/domain/model/index.ts` | `src/domain/model/workspaceIndex.ts` | 1 | 1 |
| `src/domain/model/notes.ts` | `src/domain/model/tags.ts` | 1 | 1 |
| `src/domain/model/notes.ts` | `src/domain/model/tasks.ts` | 1 | 1 |
| `src/domain/model/tasks.ts` | `src/domain/model/tags.ts` | 1 | 1 |
| `src/domain/model/workspaceIndex.ts` | `src/domain/model/notes.ts` | 1 | 1 |
| `src/domain/model/workspaceIndex.ts` | `src/domain/model/tags.ts` | 1 | 1 |
| `src/domain/model/workspaceIndex.ts` | `src/domain/model/tasks.ts` | 1 | 1 |
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
| `src/ui/commands` | `src/core/debounce.ts` | 4 | 1 |
| `src/ui/commands` | `src/core/guards.ts` | 2 | 1 |
| `src/ui/commands` | `src/core/markdown` | 72 | 11 |
| `src/ui/commands` | `src/core/mcp` | 1 | 1 |
| `src/ui/commands` | `src/core/query` | 3 | 1 |
| `src/ui/commands` | `src/core/storage` | 13 | 2 |
| `src/ui/commands` | `src/core/text.ts` | 15 | 1 |
| `src/ui/commands` | `src/core/timing.ts` | 13 | 1 |
| `src/ui/commands` | `src/core/types.ts` | 41 | 1 |
| `src/ui/commands` | `src/core/workspace` | 55 | 9 |
| `src/ui/commands` | `src/ui/state` | 29 | 15 |
| `src/ui/commands` | `src/ui/webview` | 1 | 1 |
| `src/ui/preview` | `src/core/markdown` | 2 | 2 |
| `src/ui/preview` | `src/core/timing.ts` | 1 | 1 |
| `src/ui/preview` | `src/core/types.ts` | 3 | 1 |
| `src/ui/preview` | `src/core/workspace` | 3 | 3 |
| `src/ui/preview` | `src/shared/html.ts` | 2 | 1 |
| `src/ui/preview` | `src/ui/state` | 3 | 2 |
| `src/ui/preview` | `src/ui/webview` | 1 | 1 |
| `src/ui/protocol` | `src/domain/model/notes.ts` | 1 | 1 |
| `src/ui/protocol` | `src/domain/model/preferences.ts` | 4 | 1 |
| `src/ui/protocol` | `src/domain/model/query.ts` | 4 | 1 |
| `src/ui/protocol` | `src/domain/model/tags.ts` | 5 | 1 |
| `src/ui/protocol` | `src/domain/model/tasks.ts` | 1 | 1 |
| `src/ui/protocol` | `src/domain/model/workspaceIndex.ts` | 1 | 1 |
| `src/ui/state` | `src/core/guards.ts` | 1 | 1 |
| `src/ui/state` | `src/core/markdown` | 44 | 9 |
| `src/ui/state` | `src/core/paths.ts` | 6 | 1 |
| `src/ui/state` | `src/core/query` | 27 | 6 |
| `src/ui/state` | `src/core/storage` | 3 | 2 |
| `src/ui/state` | `src/core/taskColumns.ts` | 2 | 1 |
| `src/ui/state` | `src/core/taskPolicy.ts` | 3 | 1 |
| `src/ui/state` | `src/core/text.ts` | 5 | 1 |
| `src/ui/state` | `src/core/types.ts` | 26 | 1 |
| `src/ui/state` | `src/core/workspace` | 25 | 5 |
| `src/ui/state` | `src/ui/preview` | 1 | 1 |
| `src/ui/state` | `src/ui/webview` | 2 | 1 |
| `src/ui/views` | `src/core/debounce.ts` | 2 | 1 |
| `src/ui/views` | `src/core/markdown` | 2 | 2 |
| `src/ui/views` | `src/core/text.ts` | 2 | 1 |
| `src/ui/views` | `src/core/timing.ts` | 1 | 1 |
| `src/ui/views` | `src/core/types.ts` | 2 | 1 |
| `src/ui/views` | `src/core/workspace` | 3 | 3 |
| `src/ui/views` | `src/ui/commands` | 6 | 4 |
| `src/ui/views` | `src/ui/state` | 7 | 6 |
| `src/ui/webview` | `src/core/changelog.ts` | 2 | 1 |
| `src/ui/webview` | `src/core/guards.ts` | 1 | 1 |
| `src/ui/webview` | `src/core/markdown` | 5 | 3 |
| `src/ui/webview` | `src/core/query` | 4 | 3 |
| `src/ui/webview` | `src/core/storage` | 6 | 1 |
| `src/ui/webview` | `src/core/timing.ts` | 7 | 1 |
| `src/ui/webview` | `src/core/types.ts` | 11 | 1 |
| `src/ui/webview` | `src/core/workspace` | 27 | 6 |
| `src/ui/webview` | `src/shared/html.ts` | 3 | 1 |
| `src/ui/webview` | `src/ui/commands` | 44 | 23 |
| `src/ui/webview` | `src/ui/state` | 21 | 14 |

Folders that import each other:

- `src/core/query` and `src/core/workspace` import each other.
- `src/ui/state` and `src/ui/webview` import each other.
- `src/ui/commands` and `src/ui/webview` import each other.
- `src/ui/preview` and `src/ui/state` import each other.

## Module cycles

- `src/ui/state/agendaState.ts`, `src/ui/state/dashboardState.ts`, `src/ui/state/queryBlockState.ts`

## The search-store worker

`src/core/storage/searchStoreWorker.ts` is its own esbuild entry. Its closure within `src`:

- `src/core/storage/parsedFileCodec.ts`
- `src/core/storage/searchDatabase.ts`
- `src/core/storage/searchStoreWorker.ts`
- `src/core/types.ts`
- `src/domain/model/index.ts`
- `src/domain/model/notes.ts`
- `src/domain/model/preferences.ts`
- `src/domain/model/query.ts`
- `src/domain/model/tags.ts`
- `src/domain/model/tasks.ts`
- `src/domain/model/workspaceIndex.ts`
- `src/ui/protocol/calendar.ts`
- `src/ui/protocol/dashboard.ts`
- `src/ui/protocol/index.ts`
- `src/ui/protocol/notesGraph.ts`
- `src/ui/protocol/searchPage.ts`
- `src/ui/protocol/shared.ts`
- `src/ui/protocol/sidebarNotes.ts`
- `src/ui/protocol/stats.ts`
- `src/ui/protocol/taskBoard.ts`

What it imports from outside `src`: `fs`, `node:sqlite`, `path`, `worker_threads`.

## Which suites need the extension host

| Suites | Count |
| --- | --- |
| All mocha suites in `src/test` | 149 |
| Import `vscode` themselves | 72 |
| Import no `vscode` themselves, but reach it | 47 |
| Never reach `vscode`, so run under `test:unit` | 30 |

The suites under `test:unit`: `calendar-math`, `changelog`, `debounce`, `due-date-wording`, `frontmatter-tags`, `frontmatter`, `guards`, `line-shapes`, `markdown-parser`, `mcp-protocol`, `naming`, `note-boundaries`, `outline-tree`, `own-writes`, `page-loader`, `paths`, `query-links`, `query-values`, `result-table`, `shared-html`, `tag-navigation`, `task-draft`, `task-metadata`, `task-query`, `task-steps`, `text`, `timing`, `try-next`, `webview-page`, `word-similarity`.

For the suites that reach `vscode` only through what they test, the module on the shortest path that imports `vscode` itself:

| Imports `vscode` | Suites that reach it first | Examples |
| --- | --- | --- |
| `src/core/storage/preferences.ts` | 23 | assignee, assistant-tools, dashboard-widgets, note-embeds |
| `src/ui/commands/sampleWorkspace.ts` | 2 | index-equivalence, parsed-file-codec |
| `src/ui/webview/searchPageHtml.ts` | 2 | query-builder-webview, search-history |
| `src/ui/commands/bulkEdit.ts` | 2 | tags-in-code, tags-in-links |
| `src/ui/commands/assistantWrites.ts` | 1 | assistant-writes |
| `src/ui/commands/capture.ts` | 1 | capture-words |
| `src/ui/commands/checkSetup.ts` | 1 | check-setup |
| `src/ui/commands/dailyNote.ts` | 1 | daily-notes |
| `src/ui/commands/datePrompt.ts` | 1 | date-phrases |
| `src/ui/webview/sidebarNotes.ts` | 1 | entry-matching |
| `src/ui/commands/exportResults.ts` | 1 | export-results |
| `src/ui/webview/icons.ts` | 1 | icons |
| `src/ui/commands/moveTo.ts` | 1 | move-lines |
| `src/ui/commands/moveTagsToFrontmatter.ts` | 1 | move-tags-to-frontmatter |
| `src/ui/commands/activeNoteContext.ts` | 1 | note-actions |
| `src/ui/webview/notesGraphHtml.ts` | 1 | notes-graph-behavior |
| `src/ui/commands/notify.ts` | 1 | notify |
| `src/ui/commands/quickFind.ts` | 1 | quick-find-actions |
| `src/ui/webview/sidebarNotesHtml.ts` | 1 | related-notes-behavior |
| `src/ui/commands/renameTag.ts` | 1 | rename-tag-box |
| `src/ui/webview/components.ts` | 1 | spacing-scale |
| `src/ui/commands/templates.ts` | 1 | templates |

## Readers of module-level state

Files other than the owner that use a function which reads or writes the state:

| State | Owner | Source files | Test files |
| --- | --- | --- | --- |
| `queryIdentity`, `queryWeekStart` | `src/core/query/queryEvaluator.ts` | 3 | 4 |
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
| `commands-not-to-webview` | 1 | `ui/commands/chooseTheme.ts` to `ui/webview/themes.ts` |
| `core-not-to-ui` | 1 | `core/types.ts` to `ui/protocol/index.ts` |
| `core-not-to-vscode` | 6 | `core/storage/preferences.ts` to `vscode`; `core/storage/preferenceSnapshots.ts` to `vscode`; `core/storage/searchStore.ts` to `vscode`; `core/workspace/indexer.ts` to `vscode`; `core/workspace/publishing.ts` to `vscode`; `core/workspace/scanner.ts` to `vscode` |
| `no-circular` | 2 | cycle through `dashboardState.ts`, `agendaState.ts`; cycle through `queryBlockState.ts`, `dashboardState.ts`, `agendaState.ts` |
| `state-not-to-commands-views-or-webview` | 2 | `ui/state/dashboardState.ts` to `ui/webview/rendering.ts`; `ui/state/taskBoardState.ts` to `ui/webview/rendering.ts` |

## How to regenerate

```sh
node scripts/import-graph-report.js                          # every table above
npx depcruise src --config .dependency-cruiser.cjs --no-ignore-known --output-type err
                                                              # every violation, known ones included
npx depcruise src --config .dependency-cruiser.cjs --output-type archi | dot -T svg > layers.svg
                                                              # the folder-level picture, with Graphviz installed
```

When a phase removes known violations, `npm run lint:deps:baseline` rewrites `.dependency-cruiser-known-violations.json`, and the diff of that file is the record of what the phase fixed.
