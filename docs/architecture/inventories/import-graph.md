# Import graph

This is the import graph of `src/` at the end of Phase 4 of [the refactor plan](../../implementation/19-refactor.md), on the branch `refactor/04-services`. It sizes the work still ahead: which folders reach `vscode`, which import each other the wrong way, which mocha suites can run without the extension host, and which module-level state is left. The rules that hold the graph to its target, and the violations recorded as known, are described in [the layers page](../layers.md).

Everything below the line is printed by `node scripts/import-graph-report.js`, which reads the graph with dependency-cruiser and the rules' own configuration, `.dependency-cruiser.cjs`. Type-only imports count, since a type imported the wrong way is a dependency that a later value import follows. Each phase reruns the script and replaces this page's tables, so the numbers shrink in the history rather than in anyone's memory.

## Since the baseline

| Measure | Before Phase 0 (`dev` 1805a01) | End of Phase 1 | End of Phase 2 | End of Phase 3 | End of Phase 4 |
| --- | --- | --- | --- | --- | --- |
| Mocha suites that run under `test:unit` | 16 of 139 | 30 of 149 | 57 of 153 | 63 of 159 | 88 of 180 |
| Pairs of folders that import each other | 7 | 3 | 4 | 4 | 6, three of them inside `domain/` |
| Known dependency violations | 19 | 12 | 6 | 6 | 4 |
| Module-level state the plan replaces | 8 | 8 | 1, the timing log, which may stay | 1 | 1 |
| Module cycles | 1 | 1 | 1 | 1 | 0 |

- **The pure core is `domain/`.** The parser, the query language, the index state, the task rules, and the ranking, graph, facet, and mention engines live in `src/domain`, which imports nothing outside itself and `src/shared`. What stays in `src/core` is the services that do I/O: the index and its watcher, the scanner, storage, and the MCP protocol.
- **Commands are adapters over `src/services`**, each of which decides one feature and returns a result the command words: tags, parking, rollover, review, templates, tasks, Move to, the agenda, links, capture, pins, and export.
- **The two Phase 3 facades are gone.** Callers take the preference services they use (`PreferenceServices` picks) and the index roles they use (`src/core/workspace/indexReader.ts`), and `createWorkspaceIndex` builds the index's pieces.
- **The `agendaState`, `dashboardState`, `queryBlockState` cycle is gone**: the two entry-naming helpers they shared live in `domain/ranking/entryLabels.ts`. **`ui/preview` and `ui/state` no longer import each other**: what an embed names is in `domain/notes/embeds.ts`.
- **Three of the six pairs are inside `domain/`** (`markdown` and `tasks`, `index` and `query`, `query` and `tasks`), which the layers allow; they appeared when `src/core` was split into subfolders, and were one folder's own imports before. **`ui/commands` and `ui/views` import each other** through one type, `AgendaNode`, which Phase 5 places when it groups commands by feature.

---

## Folders and `vscode`

| Folder | Files | Import `vscode` | Reach `vscode` |
| --- | --- | --- | --- |
| `src/core/changelog.ts` | 1 | 0 | 0 |
| `src/core/mcp` | 1 | 0 | 0 |
| `src/core/storage` | 18 | 0 | 0 |
| `src/core/types.ts` | 1 | 0 | 0 |
| `src/core/workspace` | 9 | 0 | 0 |
| `src/domain/capture` | 1 | 0 | 0 |
| `src/domain/export` | 1 | 0 | 0 |
| `src/domain/graph` | 6 | 0 | 0 |
| `src/domain/index` | 9 | 0 | 0 |
| `src/domain/links` | 2 | 0 | 0 |
| `src/domain/markdown` | 22 | 0 | 0 |
| `src/domain/model` | 9 | 0 | 0 |
| `src/domain/notes` | 8 | 0 | 0 |
| `src/domain/query` | 9 | 0 | 0 |
| `src/domain/ranking` | 13 | 0 | 0 |
| `src/domain/search` | 2 | 0 | 0 |
| `src/domain/tasks` | 9 | 0 | 0 |
| `src/extension.ts` | 1 | 1 | 1 |
| `src/platform/vscodeEditApplier.ts` | 1 | 1 | 1 |
| `src/platform/vscodeProgress.ts` | 1 | 1 | 1 |
| `src/platform/vscodeWorkspace.ts` | 1 | 1 | 1 |
| `src/platform/vscodeWorkspaceEvents.ts` | 1 | 1 | 1 |
| `src/ports/clock.ts` | 1 | 0 | 0 |
| `src/ports/configuration.ts` | 1 | 0 | 0 |
| `src/ports/editApplier.ts` | 1 | 0 | 0 |
| `src/ports/events.ts` | 1 | 0 | 0 |
| `src/ports/fileSystem.ts` | 1 | 0 | 0 |
| `src/ports/keyValueStore.ts` | 1 | 0 | 0 |
| `src/ports/log.ts` | 1 | 0 | 0 |
| `src/ports/progress.ts` | 1 | 0 | 0 |
| `src/ports/uri.ts` | 1 | 0 | 0 |
| `src/ports/workspace.ts` | 1 | 0 | 0 |
| `src/ports/workspaceEvents.ts` | 1 | 0 | 0 |
| `src/services/agendaService.ts` | 1 | 0 | 0 |
| `src/services/captureService.ts` | 1 | 0 | 0 |
| `src/services/exportService.ts` | 1 | 0 | 0 |
| `src/services/linkService.ts` | 1 | 0 | 0 |
| `src/services/moveService.ts` | 1 | 0 | 0 |
| `src/services/parkingService.ts` | 1 | 0 | 0 |
| `src/services/pinService.ts` | 1 | 0 | 0 |
| `src/services/reviewService.ts` | 1 | 0 | 0 |
| `src/services/rolloverService.ts` | 1 | 0 | 0 |
| `src/services/tagService.ts` | 1 | 0 | 0 |
| `src/services/taskService.ts` | 1 | 0 | 0 |
| `src/services/templateService.ts` | 1 | 0 | 0 |
| `src/shared` | 7 | 0 | 0 |
| `src/ui/commands` | 61 | 58 | 58 |
| `src/ui/preview` | 3 | 1 | 1 |
| `src/ui/protocol` | 9 | 0 | 0 |
| `src/ui/providers` | 10 | 10 | 10 |
| `src/ui/state` | 29 | 0 | 0 |
| `src/ui/views` | 4 | 4 | 4 |
| `src/ui/webview` | 35 | 28 | 29 |
| **All shipped source** | 307 | 106 | 107 |

## Imports between folders

| From | To | Imports | Distinct modules imported |
| --- | --- | --- | --- |
| `src/core/mcp` | `src/shared` | 1 | 1 |
| `src/core/storage` | `src/core/types.ts` | 4 | 1 |
| `src/core/storage` | `src/domain/markdown` | 1 | 1 |
| `src/core/storage` | `src/domain/model` | 10 | 1 |
| `src/core/storage` | `src/domain/tasks` | 1 | 1 |
| `src/core/storage` | `src/ports/events.ts` | 3 | 1 |
| `src/core/storage` | `src/ports/fileSystem.ts` | 1 | 1 |
| `src/core/storage` | `src/ports/keyValueStore.ts` | 1 | 1 |
| `src/core/storage` | `src/ports/uri.ts` | 1 | 1 |
| `src/core/storage` | `src/shared` | 2 | 2 |
| `src/core/types.ts` | `src/domain/model` | 2 | 2 |
| `src/core/types.ts` | `src/ui/protocol` | 1 | 1 |
| `src/core/workspace` | `src/core/storage` | 3 | 1 |
| `src/core/workspace` | `src/core/types.ts` | 3 | 1 |
| `src/core/workspace` | `src/domain/index` | 5 | 2 |
| `src/core/workspace` | `src/domain/markdown` | 1 | 1 |
| `src/core/workspace` | `src/domain/model` | 1 | 1 |
| `src/core/workspace` | `src/ports/configuration.ts` | 1 | 1 |
| `src/core/workspace` | `src/ports/events.ts` | 6 | 1 |
| `src/core/workspace` | `src/ports/fileSystem.ts` | 1 | 1 |
| `src/core/workspace` | `src/ports/progress.ts` | 1 | 1 |
| `src/core/workspace` | `src/ports/uri.ts` | 5 | 1 |
| `src/core/workspace` | `src/ports/workspace.ts` | 1 | 1 |
| `src/core/workspace` | `src/ports/workspaceEvents.ts` | 2 | 1 |
| `src/core/workspace` | `src/shared` | 6 | 2 |
| `src/domain/capture` | `src/domain/markdown` | 4 | 4 |
| `src/domain/capture` | `src/domain/model` | 1 | 1 |
| `src/domain/export` | `src/domain/model` | 1 | 1 |
| `src/domain/graph` | `src/domain/markdown` | 3 | 1 |
| `src/domain/graph` | `src/domain/model` | 6 | 1 |
| `src/domain/graph` | `src/shared` | 1 | 1 |
| `src/domain/index` | `src/domain/markdown` | 2 | 1 |
| `src/domain/index` | `src/domain/model` | 7 | 1 |
| `src/domain/index` | `src/domain/query` | 1 | 1 |
| `src/domain/links` | `src/domain/index` | 2 | 1 |
| `src/domain/links` | `src/domain/markdown` | 3 | 2 |
| `src/domain/links` | `src/domain/model` | 2 | 1 |
| `src/domain/markdown` | `src/domain/model` | 7 | 1 |
| `src/domain/markdown` | `src/domain/tasks` | 1 | 1 |
| `src/domain/notes` | `src/domain/index` | 2 | 2 |
| `src/domain/notes` | `src/domain/markdown` | 9 | 5 |
| `src/domain/notes` | `src/domain/model` | 6 | 1 |
| `src/domain/notes` | `src/shared` | 1 | 1 |
| `src/domain/query` | `src/domain/index` | 2 | 2 |
| `src/domain/query` | `src/domain/markdown` | 6 | 4 |
| `src/domain/query` | `src/domain/model` | 3 | 2 |
| `src/domain/query` | `src/domain/tasks` | 2 | 1 |
| `src/domain/query` | `src/shared` | 2 | 2 |
| `src/domain/ranking` | `src/domain/index` | 2 | 1 |
| `src/domain/ranking` | `src/domain/markdown` | 5 | 2 |
| `src/domain/ranking` | `src/domain/model` | 13 | 1 |
| `src/domain/ranking` | `src/domain/query` | 1 | 1 |
| `src/domain/ranking` | `src/shared` | 2 | 1 |
| `src/domain/search` | `src/domain/index` | 4 | 3 |
| `src/domain/search` | `src/domain/markdown` | 3 | 3 |
| `src/domain/search` | `src/domain/model` | 2 | 1 |
| `src/domain/search` | `src/domain/query` | 4 | 4 |
| `src/domain/search` | `src/shared` | 1 | 1 |
| `src/domain/tasks` | `src/domain/markdown` | 13 | 6 |
| `src/domain/tasks` | `src/domain/model` | 7 | 1 |
| `src/domain/tasks` | `src/domain/query` | 1 | 1 |
| `src/domain/tasks` | `src/shared` | 1 | 1 |
| `src/extension.ts` | `src/core/mcp` | 1 | 1 |
| `src/extension.ts` | `src/core/storage` | 12 | 12 |
| `src/extension.ts` | `src/core/workspace` | 4 | 4 |
| `src/extension.ts` | `src/platform/vscodeEditApplier.ts` | 1 | 1 |
| `src/extension.ts` | `src/platform/vscodeProgress.ts` | 1 | 1 |
| `src/extension.ts` | `src/platform/vscodeWorkspace.ts` | 1 | 1 |
| `src/extension.ts` | `src/platform/vscodeWorkspaceEvents.ts` | 1 | 1 |
| `src/extension.ts` | `src/services/agendaService.ts` | 1 | 1 |
| `src/extension.ts` | `src/services/captureService.ts` | 1 | 1 |
| `src/extension.ts` | `src/services/exportService.ts` | 1 | 1 |
| `src/extension.ts` | `src/services/linkService.ts` | 1 | 1 |
| `src/extension.ts` | `src/services/moveService.ts` | 1 | 1 |
| `src/extension.ts` | `src/services/pinService.ts` | 1 | 1 |
| `src/extension.ts` | `src/services/tagService.ts` | 1 | 1 |
| `src/extension.ts` | `src/services/taskService.ts` | 1 | 1 |
| `src/extension.ts` | `src/services/templateService.ts` | 1 | 1 |
| `src/extension.ts` | `src/shared` | 1 | 1 |
| `src/extension.ts` | `src/ui/commands` | 46 | 46 |
| `src/extension.ts` | `src/ui/preview` | 1 | 1 |
| `src/extension.ts` | `src/ui/providers` | 9 | 9 |
| `src/extension.ts` | `src/ui/state` | 8 | 8 |
| `src/extension.ts` | `src/ui/views` | 4 | 4 |
| `src/extension.ts` | `src/ui/webview` | 15 | 15 |
| `src/platform/vscodeEditApplier.ts` | `src/ports/editApplier.ts` | 1 | 1 |
| `src/platform/vscodeProgress.ts` | `src/ports/progress.ts` | 1 | 1 |
| `src/platform/vscodeWorkspace.ts` | `src/ports/configuration.ts` | 1 | 1 |
| `src/platform/vscodeWorkspace.ts` | `src/ports/fileSystem.ts` | 1 | 1 |
| `src/platform/vscodeWorkspace.ts` | `src/ports/workspace.ts` | 1 | 1 |
| `src/platform/vscodeWorkspaceEvents.ts` | `src/platform/vscodeWorkspace.ts` | 1 | 1 |
| `src/platform/vscodeWorkspaceEvents.ts` | `src/ports/workspaceEvents.ts` | 1 | 1 |
| `src/ports/configuration.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/ports/editApplier.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/ports/fileSystem.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/ports/workspace.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/ports/workspaceEvents.ts` | `src/ports/events.ts` | 1 | 1 |
| `src/ports/workspaceEvents.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/ports/workspaceEvents.ts` | `src/ports/workspace.ts` | 1 | 1 |
| `src/services/agendaService.ts` | `src/domain/markdown` | 1 | 1 |
| `src/services/agendaService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/agendaService.ts` | `src/domain/query` | 1 | 1 |
| `src/services/agendaService.ts` | `src/domain/tasks` | 4 | 4 |
| `src/services/agendaService.ts` | `src/ports/configuration.ts` | 1 | 1 |
| `src/services/captureService.ts` | `src/domain/capture` | 1 | 1 |
| `src/services/captureService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/captureService.ts` | `src/domain/notes` | 1 | 1 |
| `src/services/captureService.ts` | `src/ports/keyValueStore.ts` | 1 | 1 |
| `src/services/exportService.ts` | `src/domain/export` | 1 | 1 |
| `src/services/exportService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/linkService.ts` | `src/domain/links` | 1 | 1 |
| `src/services/linkService.ts` | `src/domain/markdown` | 1 | 1 |
| `src/services/linkService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/linkService.ts` | `src/ports/fileSystem.ts` | 1 | 1 |
| `src/services/linkService.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/services/linkService.ts` | `src/shared` | 1 | 1 |
| `src/services/moveService.ts` | `src/domain/markdown` | 1 | 1 |
| `src/services/moveService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/moveService.ts` | `src/domain/tasks` | 1 | 1 |
| `src/services/moveService.ts` | `src/ports/configuration.ts` | 1 | 1 |
| `src/services/moveService.ts` | `src/ports/editApplier.ts` | 1 | 1 |
| `src/services/moveService.ts` | `src/ports/fileSystem.ts` | 1 | 1 |
| `src/services/moveService.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/services/moveService.ts` | `src/services/taskService.ts` | 1 | 1 |
| `src/services/parkingService.ts` | `src/core/workspace` | 1 | 1 |
| `src/services/parkingService.ts` | `src/domain/index` | 4 | 4 |
| `src/services/parkingService.ts` | `src/domain/markdown` | 1 | 1 |
| `src/services/parkingService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/parkingService.ts` | `src/domain/query` | 1 | 1 |
| `src/services/parkingService.ts` | `src/ports/configuration.ts` | 1 | 1 |
| `src/services/parkingService.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/services/pinService.ts` | `src/core/storage` | 1 | 1 |
| `src/services/pinService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/pinService.ts` | `src/domain/notes` | 1 | 1 |
| `src/services/reviewService.ts` | `src/domain/markdown` | 1 | 1 |
| `src/services/reviewService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/reviewService.ts` | `src/domain/notes` | 2 | 2 |
| `src/services/reviewService.ts` | `src/domain/query` | 1 | 1 |
| `src/services/reviewService.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/services/rolloverService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/rolloverService.ts` | `src/domain/notes` | 3 | 3 |
| `src/services/rolloverService.ts` | `src/ports/clock.ts` | 1 | 1 |
| `src/services/rolloverService.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/services/tagService.ts` | `src/domain/index` | 2 | 2 |
| `src/services/tagService.ts` | `src/domain/markdown` | 1 | 1 |
| `src/services/tagService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/taskService.ts` | `src/domain/markdown` | 3 | 3 |
| `src/services/taskService.ts` | `src/domain/model` | 1 | 1 |
| `src/services/taskService.ts` | `src/domain/tasks` | 3 | 3 |
| `src/services/taskService.ts` | `src/ports/clock.ts` | 1 | 1 |
| `src/services/taskService.ts` | `src/ports/configuration.ts` | 1 | 1 |
| `src/services/taskService.ts` | `src/ports/editApplier.ts` | 1 | 1 |
| `src/services/taskService.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/services/templateService.ts` | `src/domain/notes` | 1 | 1 |
| `src/services/templateService.ts` | `src/ports/clock.ts` | 1 | 1 |
| `src/services/templateService.ts` | `src/ports/fileSystem.ts` | 1 | 1 |
| `src/services/templateService.ts` | `src/ports/uri.ts` | 1 | 1 |
| `src/shared` | `src/ports/events.ts` | 2 | 1 |
| `src/shared` | `src/ports/log.ts` | 1 | 1 |
| `src/ui/commands` | `src/core/changelog.ts` | 1 | 1 |
| `src/ui/commands` | `src/core/mcp` | 1 | 1 |
| `src/ui/commands` | `src/core/storage` | 16 | 4 |
| `src/ui/commands` | `src/core/types.ts` | 35 | 1 |
| `src/ui/commands` | `src/core/workspace` | 25 | 4 |
| `src/ui/commands` | `src/domain/capture` | 3 | 1 |
| `src/ui/commands` | `src/domain/export` | 2 | 1 |
| `src/ui/commands` | `src/domain/index` | 12 | 5 |
| `src/ui/commands` | `src/domain/links` | 4 | 2 |
| `src/ui/commands` | `src/domain/markdown` | 46 | 11 |
| `src/ui/commands` | `src/domain/model` | 1 | 1 |
| `src/ui/commands` | `src/domain/notes` | 9 | 6 |
| `src/ui/commands` | `src/domain/query` | 7 | 2 |
| `src/ui/commands` | `src/domain/tasks` | 9 | 6 |
| `src/ui/commands` | `src/services/agendaService.ts` | 1 | 1 |
| `src/ui/commands` | `src/services/captureService.ts` | 3 | 1 |
| `src/ui/commands` | `src/services/exportService.ts` | 1 | 1 |
| `src/ui/commands` | `src/services/linkService.ts` | 7 | 1 |
| `src/ui/commands` | `src/services/moveService.ts` | 2 | 1 |
| `src/ui/commands` | `src/services/parkingService.ts` | 1 | 1 |
| `src/ui/commands` | `src/services/pinService.ts` | 2 | 1 |
| `src/ui/commands` | `src/services/reviewService.ts` | 1 | 1 |
| `src/ui/commands` | `src/services/rolloverService.ts` | 1 | 1 |
| `src/ui/commands` | `src/services/tagService.ts` | 1 | 1 |
| `src/ui/commands` | `src/services/taskService.ts` | 3 | 1 |
| `src/ui/commands` | `src/services/templateService.ts` | 1 | 1 |
| `src/ui/commands` | `src/shared` | 20 | 4 |
| `src/ui/commands` | `src/ui/state` | 24 | 14 |
| `src/ui/commands` | `src/ui/views` | 1 | 1 |
| `src/ui/commands` | `src/ui/webview` | 1 | 1 |
| `src/ui/preview` | `src/core/types.ts` | 3 | 1 |
| `src/ui/preview` | `src/core/workspace` | 2 | 2 |
| `src/ui/preview` | `src/domain/index` | 1 | 1 |
| `src/ui/preview` | `src/domain/markdown` | 2 | 2 |
| `src/ui/preview` | `src/domain/notes` | 2 | 1 |
| `src/ui/preview` | `src/domain/query` | 2 | 1 |
| `src/ui/preview` | `src/shared` | 3 | 2 |
| `src/ui/preview` | `src/ui/commands` | 1 | 1 |
| `src/ui/preview` | `src/ui/state` | 3 | 2 |
| `src/ui/preview` | `src/ui/webview` | 1 | 1 |
| `src/ui/protocol` | `src/domain/model` | 19 | 8 |
| `src/ui/providers` | `src/core/types.ts` | 5 | 1 |
| `src/ui/providers` | `src/core/workspace` | 11 | 2 |
| `src/ui/providers` | `src/domain/index` | 5 | 3 |
| `src/ui/providers` | `src/domain/markdown` | 13 | 6 |
| `src/ui/providers` | `src/shared` | 12 | 3 |
| `src/ui/providers` | `src/ui/commands` | 16 | 10 |
| `src/ui/providers` | `src/ui/state` | 7 | 7 |
| `src/ui/state` | `src/core/storage` | 3 | 2 |
| `src/ui/state` | `src/core/types.ts` | 22 | 1 |
| `src/ui/state` | `src/domain/graph` | 4 | 4 |
| `src/ui/state` | `src/domain/index` | 17 | 3 |
| `src/ui/state` | `src/domain/markdown` | 34 | 7 |
| `src/ui/state` | `src/domain/notes` | 6 | 4 |
| `src/ui/state` | `src/domain/query` | 34 | 6 |
| `src/ui/state` | `src/domain/ranking` | 13 | 9 |
| `src/ui/state` | `src/domain/search` | 3 | 2 |
| `src/ui/state` | `src/domain/tasks` | 10 | 5 |
| `src/ui/state` | `src/shared` | 9 | 3 |
| `src/ui/state` | `src/ui/webview` | 2 | 1 |
| `src/ui/views` | `src/core/types.ts` | 2 | 1 |
| `src/ui/views` | `src/core/workspace` | 2 | 2 |
| `src/ui/views` | `src/domain/index` | 1 | 1 |
| `src/ui/views` | `src/domain/markdown` | 2 | 2 |
| `src/ui/views` | `src/domain/query` | 1 | 1 |
| `src/ui/views` | `src/domain/tasks` | 1 | 1 |
| `src/ui/views` | `src/services/agendaService.ts` | 1 | 1 |
| `src/ui/views` | `src/shared` | 5 | 3 |
| `src/ui/views` | `src/ui/commands` | 7 | 6 |
| `src/ui/views` | `src/ui/state` | 5 | 4 |
| `src/ui/webview` | `src/core/changelog.ts` | 2 | 1 |
| `src/ui/webview` | `src/core/storage` | 6 | 1 |
| `src/ui/webview` | `src/core/types.ts` | 11 | 1 |
| `src/ui/webview` | `src/core/workspace` | 18 | 3 |
| `src/ui/webview` | `src/domain/index` | 9 | 3 |
| `src/ui/webview` | `src/domain/markdown` | 5 | 3 |
| `src/ui/webview` | `src/domain/query` | 5 | 4 |
| `src/ui/webview` | `src/ports/events.ts` | 1 | 1 |
| `src/ui/webview` | `src/services/exportService.ts` | 2 | 1 |
| `src/ui/webview` | `src/shared` | 12 | 4 |
| `src/ui/webview` | `src/ui/commands` | 48 | 24 |
| `src/ui/webview` | `src/ui/state` | 21 | 14 |

Folders that import each other:

- `src/domain/markdown` and `src/domain/tasks` import each other.
- `src/domain/index` and `src/domain/query` import each other.
- `src/domain/query` and `src/domain/tasks` import each other.
- `src/ui/commands` and `src/ui/views` import each other.
- `src/ui/state` and `src/ui/webview` import each other.
- `src/ui/commands` and `src/ui/webview` import each other.

## Module cycles

None.

## The search-store worker

`src/core/storage/searchStoreWorker.ts` is its own esbuild entry. Its closure within `src`:

- `src/core/storage/parsedFileCodec.ts`
- `src/core/storage/searchDatabase.ts`
- `src/core/storage/searchStoreWorker.ts`
- `src/core/types.ts`
- `src/domain/model/graph.ts`
- `src/domain/model/index.ts`
- `src/domain/model/notes.ts`
- `src/domain/model/preferences.ts`
- `src/domain/model/query.ts`
- `src/domain/model/relatedNotes.ts`
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
| All mocha suites in `src/test` | 180 |
| Import `vscode` themselves | 68 |
| Import no `vscode` themselves, but reach it | 24 |
| Never reach `vscode`, so run under `test:unit` | 88 |

The suites under `test:unit`: `agenda-service`, `assignee`, `assistant-tool-table`, `assistant-tools`, `calendar-math`, `capture-box`, `capture-lines`, `capture-service`, `capture-words`, `change-reactions`, `change-watcher`, `changelog`, `completion-context`, `dashboard-widgets`, `debounce`, `due-date-wording`, `emitter`, `export-results`, `export-service`, `frontmatter-tags`, `frontmatter`, `guards`, `index-publishing`, `line-shapes`, `link-rewrites`, `link-service`, `markdown-parser`, `mcp-protocol`, `move-service`, `naming`, `note-boundaries`, `note-embeds`, `note-links`, `notes-graph-state`, `outline-tree`, `page-loader`, `parked`, `parking-service`, `paths`, `people-recency`, `pin-service`, `pinned-notes`, `preference-snapshots`, `preferences-invariants`, `preferences-maintenance`, `preferences-prune`, `preferences-roundtrip`, `preferences-schema`, `preferences`, `prose-excerpt`, `query-block`, `query-language`, `query-links`, `query-values`, `quick-find-actions`, `related-notes-evaluation`, `repeat-rule-problems`, `result-table`, `review-service`, `rollover-service`, `search-store`, `shared-html`, `tag-hygiene`, `tag-navigation`, `tag-service`, `tag-target`, `tagged-entries`, `task-draft`, `task-metadata`, `task-policy`, `task-query`, `task-rules`, `task-service`, `task-steps`, `template-service`, `templates`, `text`, `theme-preview`, `timing`, `try-next`, `view-publisher`, `view-state`, `warm-start`, `webview-page`, `wiki-link-targets`, `word-similarity`, `workspace`, `write-history`.

For the suites that reach `vscode` only through what they test, the module on the shortest path that imports `vscode` itself:

| Imports `vscode` | Suites that reach it first | Examples |
| --- | --- | --- |
| `src/ui/webview/searchPageHtml.ts` | 3 | parked-commands, query-builder-webview, search-history |
| `src/ui/commands/sampleWorkspace.ts` | 2 | index-equivalence, parsed-file-codec |
| `src/ui/commands/bulkEdit.ts` | 2 | tags-in-code, tags-in-links |
| `src/ui/commands/assistantWrites.ts` | 1 | assistant-writes |
| `src/ui/commands/checkSetup.ts` | 1 | check-setup |
| `src/ui/commands/dailyNote.ts` | 1 | daily-notes |
| `src/ui/commands/datePrompt.ts` | 1 | date-phrases |
| `src/ui/webview/sidebarNotes.ts` | 1 | entry-matching |
| `src/ui/webview/icons.ts` | 1 | icons |
| `src/ui/commands/moveTo.ts` | 1 | move-lines |
| `src/ui/commands/moveTagsToFrontmatter.ts` | 1 | move-tags-to-frontmatter |
| `src/ui/commands/activeNoteContext.ts` | 1 | note-actions |
| `src/ui/webview/notesGraphHtml.ts` | 1 | notes-graph-behavior |
| `src/ui/commands/notify.ts` | 1 | notify |
| `src/ui/webview/panelPriority.ts` | 1 | panel-priority |
| `src/ui/commands/rollover.ts` | 1 | parked-lists |
| `src/ui/webview/sidebarNotesHtml.ts` | 1 | related-notes-behavior |
| `src/ui/commands/renameTag.ts` | 1 | rename-tag-box |
| `src/ui/webview/components.ts` | 1 | spacing-scale |
| `src/ui/webview/taskBoard.ts` | 1 | task-board |

## Module-level state

Whether each piece of hidden state is still declared at module level, and, while it is, how many other files use a function that reads or writes it:

| State | Declared in | Still module-level | Source files | Test files |
| --- | --- | --- | --- | --- |
| `queryIdentity`, `queryWeekStart` | `src/domain/query/queryEvaluator.ts`, `src/domain/query/queryDates.ts` | no | — | — |
| `policy` | `src/domain/tasks/taskPolicy.ts` | no | — | — |
| `log` | `src/shared/timing.ts` | yes | 30 | 6 |
| `keepTaskRank` | `src/ui/commands/taskActions.ts` | no | — | — |
| `workspaceWrites` | `src/ui/commands/workspaceWrites.ts` | no | — | — |
| `ownWrites` | `src/core/workspace/ownWrites.ts` | no | — | — |
| `previewTheme` | `src/ui/webview/themes.ts` | no | — | — |
| `focusedIn` | `src/ui/commands/focusSection.ts` | no | — | — |

## Known violations

| Rule | Count | Imports |
| --- | --- | --- |
| `commands-not-to-webview` | 1 | `ui/commands/chooseTheme.ts` to `ui/webview/themes.ts` |
| `core-not-to-ui` | 1 | `core/types.ts` to `ui/protocol/index.ts` |
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
