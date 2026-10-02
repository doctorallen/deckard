# Import graph

This is the import graph of `src/` at the end of Phase 6 of [the refactor plan](../../implementation/19-refactor.md), on the branch `refactor/06-webviews`. It sizes the work still ahead: which folders reach `vscode`, which import each other the wrong way, which mocha suites can run without the extension host, and which module-level state is left. The rules that hold the graph to its target, and the violations recorded as known, are described in [the layers page](../layers.md).

Everything below the line is printed by `node scripts/import-graph-report.js`, which reads the graph with dependency-cruiser and the rules' own configuration, `.dependency-cruiser.cjs`. Type-only imports count, since a type imported the wrong way is a dependency that a later value import follows. Each phase reruns the script and replaces this page's tables, so the numbers shrink in the history rather than in anyone's memory.

## Since the baseline

| Measure | Before Phase 0 (`dev` 1805a01) | End of Phase 1 | End of Phase 2 | End of Phase 3 | End of Phase 4 | End of Phase 5 | End of Phase 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mocha suites that run under `test:unit` | 16 of 139 | 30 of 149 | 57 of 153 | 63 of 159 | 88 of 180 | 89 of 183 | 114 of 221 |
| Pairs of folders that import each other | 7 | 3 | 4 | 4 | 6, three of them inside `domain/` | 7, three inside `domain/`, one type-only | 6, three inside `domain/`, one type-only |
| Known dependency violations | 19 | 12 | 6 | 6 | 4 | 4 | 2 |
| Module-level state the plan replaces | 8 | 8 | 1, the timing log, which may stay | 1 | 1 | 1 | 1 |
| Module cycles | 1 | 1 | 1 | 1 | 0 | 0 | 0 |

- **The pure core is `domain/`.** The parser, the query language, the index state, the task rules, and the ranking, graph, facet, and mention engines live in `src/domain`, which imports nothing outside itself and `src/shared`. What stays in `src/core` is the services that do I/O: the index and its watcher, the scanner, storage, and the MCP protocol.
- **Commands are adapters over `src/services`**, each of which decides one feature and returns a result the command words: tags, parking, rollover, review, templates, tasks, Move to, the agenda, links, capture, pins, and export.
- **Phase 5 made `extension.ts` a 35-line composition root.** `src/composition/services.ts` builds every service once, and each of the nineteen features in `src/ui/commands/<feature>/register.ts` registers its commands against them. The features import the `Services` type from the composition module, which imports the classes it builds from `ui/commands`: a pair of folders, type-only in that direction, and the shape the plan's `register(context, services)` implies.
- **Phase 6 moved every page into `src/webview/<page>/`, bundles on a shared Preact core in `src/webview/shared/`.** Its 90 modules reach no `vscode`: they import `ui/protocol` (the typed messages and snapshots), four pure domain folders (`domain/markdown`, `domain/dashboard`, `domain/graph`, `domain/tasks`), and each other. The script's `folderOf` does not group `src/webview`, so the tables below name each page module on its own row; every one of them reads 0 and 0 in the first table.
- **`ui/state` and `ui/webview` no longer import each other, and the two known violations left with them.** The state builders sent HTML they rendered with `ui/webview/rendering.ts`; they now send the token tree of `domain/markdown/inline.ts` and `blockExcerpt.ts` (decision 0015), the pages draw it, and `rendering.ts` and `sanitize-html` are gone. The host side of the pages is `src/ui/webview/host/` (`WebviewHost`, the shell, the narrowing helpers, the shared handlers) and a controller and narrowing table per page in `src/ui/webview/pages/<page>/`; `messages.ts` is gone.
- **The 25 new `test:unit` suites** are the per-page narrowing tables (`*-messages`), the domain modules the pages share with the host (`markdown-inline`, `markdown-block-excerpt`, `notes-graph-communities`, `notes-graph-simulation`, `widget-catalog`, `task-columns`, `calendar-day-panel`), `navigation-service`, `page-narrowing`, `help-manifest`, `guide-links`, `icons`, and `spacing-scale`, and three of the template-parity suites (`webview-shared`, `webview-tasks`, `webview-query-editor`), which compare against recordings of the deleted templates since step 7.
- **What got worse.** The suites that reach `vscode` only through what they test went from 24 to 35, and the suites that import it themselves from 70 to 72. Ten reach it through `src/test/pages.ts`, which renders each page's shell against a stand-in webview and imports `vscode` for that webview's type. A page's host and controller are `vscode` adapters by design, so a suite of a page's host reaches it either way. `ui/webview`'s imports of `ui/commands` grew from 48 to 56 (still 24 modules), and `ui/commands` and `ui/webview` still import each other, through `chooseTheme.ts`, the one known violation left in `ui/`. `src/ui/webview` grew from 35 files to 65, 47 of which reach `vscode`.

---

## Folders and `vscode`

| Folder | Files | Import `vscode` | Reach `vscode` |
| --- | --- | --- | --- |
| `src/composition/disposalOrder.ts` | 1 | 1 | 1 |
| `src/composition/feature.ts` | 1 | 1 | 1 |
| `src/composition/features.ts` | 1 | 0 | 1 |
| `src/composition/services.ts` | 1 | 1 | 1 |
| `src/core/changelog.ts` | 1 | 0 | 0 |
| `src/core/mcp` | 1 | 0 | 0 |
| `src/core/storage` | 18 | 0 | 0 |
| `src/core/types.ts` | 1 | 0 | 0 |
| `src/core/workspace` | 9 | 0 | 0 |
| `src/domain/capture` | 1 | 0 | 0 |
| `src/domain/dashboard` | 1 | 0 | 0 |
| `src/domain/export` | 1 | 0 | 0 |
| `src/domain/graph` | 7 | 0 | 0 |
| `src/domain/index` | 9 | 0 | 0 |
| `src/domain/links` | 2 | 0 | 0 |
| `src/domain/markdown` | 26 | 0 | 0 |
| `src/domain/model` | 11 | 0 | 0 |
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
| `src/services/navigationService.ts` | 1 | 0 | 0 |
| `src/services/parkingService.ts` | 1 | 0 | 0 |
| `src/services/pinService.ts` | 1 | 0 | 0 |
| `src/services/reviewService.ts` | 1 | 0 | 0 |
| `src/services/rolloverService.ts` | 1 | 0 | 0 |
| `src/services/tagService.ts` | 1 | 0 | 0 |
| `src/services/taskService.ts` | 1 | 0 | 0 |
| `src/services/templateService.ts` | 1 | 0 | 0 |
| `src/shared` | 7 | 0 | 0 |
| `src/ui/commands` | 83 | 78 | 78 |
| `src/ui/preview` | 3 | 1 | 1 |
| `src/ui/protocol` | 14 | 0 | 0 |
| `src/ui/providers` | 10 | 10 | 10 |
| `src/ui/state` | 29 | 0 | 0 |
| `src/ui/views` | 4 | 4 | 4 |
| `src/ui/webview` | 65 | 43 | 47 |
| `src/webview/calendar/main.tsx` | 1 | 0 | 0 |
| `src/webview/calendarPage/drag.ts` | 1 | 0 | 0 |
| `src/webview/calendarPage/main.tsx` | 1 | 0 | 0 |
| `src/webview/calendarPage/view.tsx` | 1 | 0 | 0 |
| `src/webview/dashboard/header.tsx` | 1 | 0 | 0 |
| `src/webview/dashboard/home.tsx` | 1 | 0 | 0 |
| `src/webview/dashboard/homeContext.ts` | 1 | 0 | 0 |
| `src/webview/dashboard/icons.tsx` | 1 | 0 | 0 |
| `src/webview/dashboard/keptView.ts` | 1 | 0 | 0 |
| `src/webview/dashboard/main.tsx` | 1 | 0 | 0 |
| `src/webview/dashboard/model.ts` | 1 | 0 | 0 |
| `src/webview/dashboard/rows.tsx` | 1 | 0 | 0 |
| `src/webview/dashboard/tagNames.ts` | 1 | 0 | 0 |
| `src/webview/dashboard/tagsTab.tsx` | 1 | 0 | 0 |
| `src/webview/dashboard/widgetBodies.tsx` | 1 | 0 | 0 |
| `src/webview/dashboard/widgets.tsx` | 1 | 0 | 0 |
| `src/webview/help/main.ts` | 1 | 0 | 0 |
| `src/webview/notesGraph/camera.ts` | 1 | 0 | 0 |
| `src/webview/notesGraph/canvas.ts` | 1 | 0 | 0 |
| `src/webview/notesGraph/controls.tsx` | 1 | 0 | 0 |
| `src/webview/notesGraph/graphPage.ts` | 1 | 0 | 0 |
| `src/webview/notesGraph/main.tsx` | 1 | 0 | 0 |
| `src/webview/notesGraph/model.ts` | 1 | 0 | 0 |
| `src/webview/notesGraph/pointer.ts` | 1 | 0 | 0 |
| `src/webview/notesGraph/settings.ts` | 1 | 0 | 0 |
| `src/webview/notesGraph/simulation.ts` | 1 | 0 | 0 |
| `src/webview/notesGraph/status.ts` | 1 | 0 | 0 |
| `src/webview/notesGraph/view.ts` | 1 | 0 | 0 |
| `src/webview/searchPage/header.tsx` | 1 | 0 | 0 |
| `src/webview/searchPage/hub.tsx` | 1 | 0 | 0 |
| `src/webview/searchPage/main.tsx` | 1 | 0 | 0 |
| `src/webview/searchPage/results.tsx` | 1 | 0 | 0 |
| `src/webview/shared/actionMenu.tsx` | 1 | 0 | 0 |
| `src/webview/shared/blockExcerpt.tsx` | 1 | 0 | 0 |
| `src/webview/shared/buttons.tsx` | 1 | 0 | 0 |
| `src/webview/shared/calendar/calendarIcon.tsx` | 1 | 0 | 0 |
| `src/webview/shared/calendar/dayPanel.tsx` | 1 | 0 | 0 |
| `src/webview/shared/calendar/events.ts` | 1 | 0 | 0 |
| `src/webview/shared/calendar/grid.tsx` | 1 | 0 | 0 |
| `src/webview/shared/calendar/model.ts` | 1 | 0 | 0 |
| `src/webview/shared/calendar/session.ts` | 1 | 0 | 0 |
| `src/webview/shared/facets.tsx` | 1 | 0 | 0 |
| `src/webview/shared/icons.tsx` | 1 | 0 | 0 |
| `src/webview/shared/inline.tsx` | 1 | 0 | 0 |
| `src/webview/shared/keySheet.tsx` | 1 | 0 | 0 |
| `src/webview/shared/loading.tsx` | 1 | 0 | 0 |
| `src/webview/shared/markWords.ts` | 1 | 0 | 0 |
| `src/webview/shared/menuKeys.ts` | 1 | 0 | 0 |
| `src/webview/shared/metric.tsx` | 1 | 0 | 0 |
| `src/webview/shared/openSource.ts` | 1 | 0 | 0 |
| `src/webview/shared/page.ts` | 1 | 0 | 0 |
| `src/webview/shared/pageSteps.tsx` | 1 | 0 | 0 |
| `src/webview/shared/place.ts` | 1 | 0 | 0 |
| `src/webview/shared/queryEditor.tsx` | 1 | 0 | 0 |
| `src/webview/shared/queryText.ts` | 1 | 0 | 0 |
| `src/webview/shared/rankedRows.tsx` | 1 | 0 | 0 |
| `src/webview/shared/resultTabs.tsx` | 1 | 0 | 0 |
| `src/webview/shared/scroll.ts` | 1 | 0 | 0 |
| `src/webview/shared/searchCard.tsx` | 1 | 0 | 0 |
| `src/webview/shared/status.ts` | 1 | 0 | 0 |
| `src/webview/shared/strokeIcons.tsx` | 1 | 0 | 0 |
| `src/webview/shared/tagButton.tsx` | 1 | 0 | 0 |
| `src/webview/shared/tagLabel.tsx` | 1 | 0 | 0 |
| `src/webview/shared/tagMenu.tsx` | 1 | 0 | 0 |
| `src/webview/shared/taskRow.tsx` | 1 | 0 | 0 |
| `src/webview/shared/taskTitle.tsx` | 1 | 0 | 0 |
| `src/webview/shared/tip.tsx` | 1 | 0 | 0 |
| `src/webview/shared/undoToast.tsx` | 1 | 0 | 0 |
| `src/webview/shared/viewOptions.tsx` | 1 | 0 | 0 |
| `src/webview/shared/vscode.ts` | 1 | 0 | 0 |
| `src/webview/sidebarNotes/cards.tsx` | 1 | 0 | 0 |
| `src/webview/sidebarNotes/context.tsx` | 1 | 0 | 0 |
| `src/webview/sidebarNotes/links.tsx` | 1 | 0 | 0 |
| `src/webview/sidebarNotes/main.tsx` | 1 | 0 | 0 |
| `src/webview/sidebarNotes/model.ts` | 1 | 0 | 0 |
| `src/webview/sidebarNotes/refine.tsx` | 1 | 0 | 0 |
| `src/webview/sidebarNotes/weights.tsx` | 1 | 0 | 0 |
| `src/webview/stats/attention.tsx` | 1 | 0 | 0 |
| `src/webview/stats/main.tsx` | 1 | 0 | 0 |
| `src/webview/stats/model.ts` | 1 | 0 | 0 |
| `src/webview/stats/tagPairs.tsx` | 1 | 0 | 0 |
| `src/webview/stats/tagUse.tsx` | 1 | 0 | 0 |
| `src/webview/stats/totals.tsx` | 1 | 0 | 0 |
| `src/webview/stats/views.tsx` | 1 | 0 | 0 |
| `src/webview/taskBoard/board.tsx` | 1 | 0 | 0 |
| `src/webview/taskBoard/boardMoves.ts` | 1 | 0 | 0 |
| `src/webview/taskBoard/layouts.tsx` | 1 | 0 | 0 |
| `src/webview/taskBoard/main.tsx` | 1 | 0 | 0 |
| `src/webview/taskBoard/model.ts` | 1 | 0 | 0 |
| `src/webview/taskBoard/statusSettings.tsx` | 1 | 0 | 0 |
| **All shipped source** | 467 | 144 | 149 |

## Imports between folders

| From | To | Imports | Distinct modules imported |
| --- | --- | --- | --- |
| `src/composition/feature.ts` | `src/composition/services.ts` | 1 | 1 |
| `src/composition/feature.ts` | `src/shared` | 1 | 1 |
| `src/composition/features.ts` | `src/composition/feature.ts` | 1 | 1 |
| `src/composition/features.ts` | `src/ui/commands` | 19 | 19 |
| `src/composition/services.ts` | `src/composition/disposalOrder.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/core/mcp` | 1 | 1 |
| `src/composition/services.ts` | `src/core/storage` | 12 | 12 |
| `src/composition/services.ts` | `src/core/workspace` | 4 | 4 |
| `src/composition/services.ts` | `src/platform/vscodeEditApplier.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/platform/vscodeProgress.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/platform/vscodeWorkspace.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/platform/vscodeWorkspaceEvents.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/services/agendaService.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/services/captureService.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/services/exportService.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/services/linkService.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/services/moveService.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/services/pinService.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/services/tagService.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/services/taskService.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/services/templateService.ts` | 1 | 1 |
| `src/composition/services.ts` | `src/shared` | 1 | 1 |
| `src/composition/services.ts` | `src/ui/commands` | 31 | 31 |
| `src/composition/services.ts` | `src/ui/preview` | 1 | 1 |
| `src/composition/services.ts` | `src/ui/providers` | 9 | 9 |
| `src/composition/services.ts` | `src/ui/state` | 7 | 7 |
| `src/composition/services.ts` | `src/ui/views` | 4 | 4 |
| `src/composition/services.ts` | `src/ui/webview` | 15 | 15 |
| `src/core/mcp` | `src/shared` | 1 | 1 |
| `src/core/storage` | `src/core/types.ts` | 4 | 1 |
| `src/core/storage` | `src/domain/dashboard` | 1 | 1 |
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
| `src/domain/dashboard` | `src/domain/model` | 1 | 1 |
| `src/domain/export` | `src/domain/model` | 1 | 1 |
| `src/domain/graph` | `src/domain/markdown` | 3 | 1 |
| `src/domain/graph` | `src/domain/model` | 7 | 2 |
| `src/domain/graph` | `src/shared` | 1 | 1 |
| `src/domain/index` | `src/domain/markdown` | 2 | 1 |
| `src/domain/index` | `src/domain/model` | 7 | 1 |
| `src/domain/index` | `src/domain/query` | 1 | 1 |
| `src/domain/links` | `src/domain/index` | 2 | 1 |
| `src/domain/links` | `src/domain/markdown` | 3 | 2 |
| `src/domain/links` | `src/domain/model` | 2 | 1 |
| `src/domain/markdown` | `src/domain/model` | 9 | 3 |
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
| `src/extension.ts` | `src/composition/feature.ts` | 1 | 1 |
| `src/extension.ts` | `src/composition/features.ts` | 1 | 1 |
| `src/extension.ts` | `src/composition/services.ts` | 1 | 1 |
| `src/extension.ts` | `src/ui/preview` | 1 | 1 |
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
| `src/services/navigationService.ts` | `src/domain/index` | 1 | 1 |
| `src/services/navigationService.ts` | `src/domain/model` | 1 | 1 |
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
| `src/ui/commands` | `src/composition/services.ts` | 19 | 1 |
| `src/ui/commands` | `src/core/changelog.ts` | 1 | 1 |
| `src/ui/commands` | `src/core/mcp` | 1 | 1 |
| `src/ui/commands` | `src/core/storage` | 16 | 4 |
| `src/ui/commands` | `src/core/types.ts` | 35 | 1 |
| `src/ui/commands` | `src/core/workspace` | 28 | 4 |
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
| `src/ui/commands` | `src/shared` | 21 | 4 |
| `src/ui/commands` | `src/ui/state` | 25 | 15 |
| `src/ui/commands` | `src/ui/views` | 4 | 2 |
| `src/ui/commands` | `src/ui/webview` | 1 | 1 |
| `src/ui/preview` | `src/core/types.ts` | 3 | 1 |
| `src/ui/preview` | `src/core/workspace` | 2 | 2 |
| `src/ui/preview` | `src/domain/index` | 1 | 1 |
| `src/ui/preview` | `src/domain/markdown` | 3 | 3 |
| `src/ui/preview` | `src/domain/model` | 1 | 1 |
| `src/ui/preview` | `src/domain/notes` | 2 | 1 |
| `src/ui/preview` | `src/domain/query` | 2 | 1 |
| `src/ui/preview` | `src/shared` | 3 | 2 |
| `src/ui/preview` | `src/ui/commands` | 1 | 1 |
| `src/ui/preview` | `src/ui/state` | 3 | 2 |
| `src/ui/protocol` | `src/domain/model` | 26 | 10 |
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
| `src/ui/state` | `src/domain/markdown` | 37 | 9 |
| `src/ui/state` | `src/domain/model` | 3 | 2 |
| `src/ui/state` | `src/domain/notes` | 6 | 4 |
| `src/ui/state` | `src/domain/query` | 34 | 6 |
| `src/ui/state` | `src/domain/ranking` | 13 | 9 |
| `src/ui/state` | `src/domain/search` | 3 | 2 |
| `src/ui/state` | `src/domain/tasks` | 10 | 5 |
| `src/ui/state` | `src/shared` | 9 | 3 |
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
| `src/ui/webview` | `src/core/storage` | 8 | 1 |
| `src/ui/webview` | `src/core/types.ts` | 3 | 1 |
| `src/ui/webview` | `src/core/workspace` | 19 | 3 |
| `src/ui/webview` | `src/domain/index` | 7 | 3 |
| `src/ui/webview` | `src/domain/markdown` | 5 | 3 |
| `src/ui/webview` | `src/domain/model` | 16 | 4 |
| `src/ui/webview` | `src/domain/query` | 6 | 4 |
| `src/ui/webview` | `src/domain/tasks` | 1 | 1 |
| `src/ui/webview` | `src/ports/events.ts` | 1 | 1 |
| `src/ui/webview` | `src/services/exportService.ts` | 4 | 1 |
| `src/ui/webview` | `src/services/navigationService.ts` | 13 | 1 |
| `src/ui/webview` | `src/shared` | 14 | 4 |
| `src/ui/webview` | `src/ui/commands` | 56 | 24 |
| `src/ui/webview` | `src/ui/protocol` | 51 | 11 |
| `src/ui/webview` | `src/ui/state` | 22 | 13 |
| `src/webview/calendar/main.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/calendar/main.tsx` | `src/webview/shared/calendar/dayPanel.tsx` | 1 | 1 |
| `src/webview/calendar/main.tsx` | `src/webview/shared/calendar/events.ts` | 1 | 1 |
| `src/webview/calendar/main.tsx` | `src/webview/shared/calendar/grid.tsx` | 1 | 1 |
| `src/webview/calendar/main.tsx` | `src/webview/shared/calendar/model.ts` | 1 | 1 |
| `src/webview/calendar/main.tsx` | `src/webview/shared/calendar/session.ts` | 1 | 1 |
| `src/webview/calendar/main.tsx` | `src/webview/shared/page.ts` | 1 | 1 |
| `src/webview/calendarPage/drag.ts` | `src/webview/calendarPage/view.tsx` | 1 | 1 |
| `src/webview/calendarPage/drag.ts` | `src/webview/shared/calendar/events.ts` | 1 | 1 |
| `src/webview/calendarPage/drag.ts` | `src/webview/shared/calendar/session.ts` | 2 | 1 |
| `src/webview/calendarPage/drag.ts` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/domain/markdown` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/calendarPage/drag.ts` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/calendarPage/view.tsx` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/calendar/dayPanel.tsx` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/calendar/events.ts` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/calendar/model.ts` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/calendar/session.ts` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/keySheet.tsx` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/page.ts` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/scroll.ts` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/calendarPage/main.tsx` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/calendarPage/view.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/calendarPage/view.tsx` | `src/webview/shared/buttons.tsx` | 1 | 1 |
| `src/webview/calendarPage/view.tsx` | `src/webview/shared/calendar/dayPanel.tsx` | 1 | 1 |
| `src/webview/calendarPage/view.tsx` | `src/webview/shared/calendar/grid.tsx` | 1 | 1 |
| `src/webview/calendarPage/view.tsx` | `src/webview/shared/calendar/model.ts` | 1 | 1 |
| `src/webview/calendarPage/view.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/dashboard/header.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/dashboard/header.tsx` | `src/webview/dashboard/icons.tsx` | 1 | 1 |
| `src/webview/dashboard/header.tsx` | `src/webview/dashboard/model.ts` | 1 | 1 |
| `src/webview/dashboard/header.tsx` | `src/webview/dashboard/tagNames.ts` | 1 | 1 |
| `src/webview/dashboard/header.tsx` | `src/webview/shared/metric.tsx` | 1 | 1 |
| `src/webview/dashboard/header.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/dashboard/home.tsx` | `src/domain/dashboard` | 1 | 1 |
| `src/webview/dashboard/home.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/dashboard/home.tsx` | `src/webview/dashboard/homeContext.ts` | 1 | 1 |
| `src/webview/dashboard/home.tsx` | `src/webview/dashboard/model.ts` | 1 | 1 |
| `src/webview/dashboard/home.tsx` | `src/webview/dashboard/widgets.tsx` | 1 | 1 |
| `src/webview/dashboard/home.tsx` | `src/webview/shared/loading.tsx` | 1 | 1 |
| `src/webview/dashboard/homeContext.ts` | `src/ui/protocol` | 2 | 2 |
| `src/webview/dashboard/icons.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/dashboard/keptView.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/dashboard/keptView.ts` | `src/webview/dashboard/model.ts` | 1 | 1 |
| `src/webview/dashboard/keptView.ts` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/domain/dashboard` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/dashboard/main.tsx` | `src/webview/dashboard/header.tsx` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/dashboard/home.tsx` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/dashboard/homeContext.ts` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/dashboard/keptView.ts` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/dashboard/model.ts` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/dashboard/tagNames.ts` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/dashboard/tagsTab.tsx` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/menuKeys.ts` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/openSource.ts` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/page.ts` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/queryEditor.tsx` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/rankedRows.tsx` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/tagMenu.tsx` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/undoToast.tsx` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/dashboard/main.tsx` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/dashboard/model.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/dashboard/rows.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/dashboard/rows.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/dashboard/rows.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/dashboard/tagNames.ts` | `src/domain/markdown` | 1 | 1 |
| `src/webview/dashboard/tagNames.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/dashboard/tagsTab.tsx` | `src/domain/markdown` | 1 | 1 |
| `src/webview/dashboard/tagsTab.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/dashboard/tagsTab.tsx` | `src/webview/dashboard/icons.tsx` | 1 | 1 |
| `src/webview/dashboard/tagsTab.tsx` | `src/webview/dashboard/model.ts` | 1 | 1 |
| `src/webview/dashboard/tagsTab.tsx` | `src/webview/dashboard/rows.tsx` | 1 | 1 |
| `src/webview/dashboard/tagsTab.tsx` | `src/webview/dashboard/tagNames.ts` | 1 | 1 |
| `src/webview/dashboard/tagsTab.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/dashboard/widgetBodies.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/dashboard/widgetBodies.tsx` | `src/webview/dashboard/homeContext.ts` | 1 | 1 |
| `src/webview/dashboard/widgetBodies.tsx` | `src/webview/dashboard/rows.tsx` | 1 | 1 |
| `src/webview/dashboard/widgets.tsx` | `src/domain/dashboard` | 1 | 1 |
| `src/webview/dashboard/widgets.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/dashboard/widgets.tsx` | `src/webview/dashboard/homeContext.ts` | 1 | 1 |
| `src/webview/dashboard/widgets.tsx` | `src/webview/dashboard/icons.tsx` | 1 | 1 |
| `src/webview/dashboard/widgets.tsx` | `src/webview/dashboard/rows.tsx` | 1 | 1 |
| `src/webview/dashboard/widgets.tsx` | `src/webview/dashboard/widgetBodies.tsx` | 1 | 1 |
| `src/webview/dashboard/widgets.tsx` | `src/webview/shared/icons.tsx` | 1 | 1 |
| `src/webview/dashboard/widgets.tsx` | `src/webview/shared/pageSteps.tsx` | 1 | 1 |
| `src/webview/dashboard/widgets.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/help/main.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/notesGraph/camera.ts` | `src/webview/notesGraph/canvas.ts` | 1 | 1 |
| `src/webview/notesGraph/camera.ts` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/notesGraph/canvas.ts` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/notesGraph/controls.tsx` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/notesGraph/controls.tsx` | `src/webview/shared/undoToast.tsx` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/webview/notesGraph/camera.ts` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/webview/notesGraph/canvas.ts` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/webview/notesGraph/controls.tsx` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/webview/notesGraph/settings.ts` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/webview/notesGraph/simulation.ts` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/webview/notesGraph/status.ts` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/webview/notesGraph/view.ts` | 1 | 1 |
| `src/webview/notesGraph/graphPage.ts` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/notesGraph/main.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/notesGraph/main.tsx` | `src/webview/notesGraph/canvas.ts` | 1 | 1 |
| `src/webview/notesGraph/main.tsx` | `src/webview/notesGraph/controls.tsx` | 1 | 1 |
| `src/webview/notesGraph/main.tsx` | `src/webview/notesGraph/graphPage.ts` | 1 | 1 |
| `src/webview/notesGraph/main.tsx` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/notesGraph/main.tsx` | `src/webview/notesGraph/pointer.ts` | 1 | 1 |
| `src/webview/notesGraph/main.tsx` | `src/webview/notesGraph/settings.ts` | 1 | 1 |
| `src/webview/notesGraph/main.tsx` | `src/webview/notesGraph/view.ts` | 1 | 1 |
| `src/webview/notesGraph/main.tsx` | `src/webview/shared/tip.tsx` | 1 | 1 |
| `src/webview/notesGraph/model.ts` | `src/domain/graph` | 1 | 1 |
| `src/webview/notesGraph/model.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/notesGraph/pointer.ts` | `src/webview/notesGraph/camera.ts` | 1 | 1 |
| `src/webview/notesGraph/pointer.ts` | `src/webview/notesGraph/graphPage.ts` | 1 | 1 |
| `src/webview/notesGraph/pointer.ts` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/notesGraph/pointer.ts` | `src/webview/notesGraph/status.ts` | 1 | 1 |
| `src/webview/notesGraph/pointer.ts` | `src/webview/notesGraph/view.ts` | 1 | 1 |
| `src/webview/notesGraph/pointer.ts` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/notesGraph/settings.ts` | `src/webview/notesGraph/canvas.ts` | 1 | 1 |
| `src/webview/notesGraph/settings.ts` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/notesGraph/settings.ts` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/notesGraph/simulation.ts` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/notesGraph/status.ts` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/notesGraph/view.ts` | `src/domain/graph` | 1 | 1 |
| `src/webview/notesGraph/view.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/notesGraph/view.ts` | `src/webview/notesGraph/canvas.ts` | 1 | 1 |
| `src/webview/notesGraph/view.ts` | `src/webview/notesGraph/model.ts` | 1 | 1 |
| `src/webview/searchPage/header.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/searchPage/header.tsx` | `src/webview/shared/buttons.tsx` | 1 | 1 |
| `src/webview/searchPage/header.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/searchPage/header.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/searchPage/header.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/searchPage/hub.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/searchPage/hub.tsx` | `src/webview/shared/searchCard.tsx` | 1 | 1 |
| `src/webview/searchPage/hub.tsx` | `src/webview/shared/tagButton.tsx` | 1 | 1 |
| `src/webview/searchPage/hub.tsx` | `src/webview/shared/tagMenu.tsx` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/searchPage/main.tsx` | `src/webview/searchPage/header.tsx` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/searchPage/hub.tsx` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/searchPage/results.tsx` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/markWords.ts` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/menuKeys.ts` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/openSource.ts` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/page.ts` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/queryEditor.tsx` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/resultTabs.tsx` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/scroll.ts` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/tagMenu.tsx` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/searchPage/main.tsx` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/searchPage/results.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/searchPage/results.tsx` | `src/webview/shared/pageSteps.tsx` | 1 | 1 |
| `src/webview/searchPage/results.tsx` | `src/webview/shared/resultTabs.tsx` | 1 | 1 |
| `src/webview/searchPage/results.tsx` | `src/webview/shared/searchCard.tsx` | 1 | 1 |
| `src/webview/searchPage/results.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/searchPage/results.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/shared/actionMenu.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/shared/blockExcerpt.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/blockExcerpt.tsx` | `src/webview/shared/inline.tsx` | 1 | 1 |
| `src/webview/shared/buttons.tsx` | `src/webview/shared/icons.tsx` | 1 | 1 |
| `src/webview/shared/calendar/dayPanel.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/shared/calendar/dayPanel.tsx` | `src/webview/shared/calendar/calendarIcon.tsx` | 1 | 1 |
| `src/webview/shared/calendar/dayPanel.tsx` | `src/webview/shared/calendar/events.ts` | 1 | 1 |
| `src/webview/shared/calendar/dayPanel.tsx` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/shared/calendar/dayPanel.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/shared/calendar/grid.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/calendar/grid.tsx` | `src/webview/shared/calendar/calendarIcon.tsx` | 1 | 1 |
| `src/webview/shared/calendar/grid.tsx` | `src/webview/shared/calendar/model.ts` | 1 | 1 |
| `src/webview/shared/calendar/model.ts` | `src/domain/markdown` | 1 | 1 |
| `src/webview/shared/calendar/model.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/calendar/session.ts` | `src/domain/markdown` | 1 | 1 |
| `src/webview/shared/calendar/session.ts` | `src/ui/protocol` | 2 | 2 |
| `src/webview/shared/calendar/session.ts` | `src/webview/shared/calendar/events.ts` | 1 | 1 |
| `src/webview/shared/calendar/session.ts` | `src/webview/shared/calendar/model.ts` | 1 | 1 |
| `src/webview/shared/calendar/session.ts` | `src/webview/shared/page.ts` | 1 | 1 |
| `src/webview/shared/calendar/session.ts` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/shared/facets.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/facets.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/shared/inline.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/openSource.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/page.ts` | `src/webview/shared/place.ts` | 1 | 1 |
| `src/webview/shared/page.ts` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/shared/page.ts` | `src/webview/shared/tip.tsx` | 1 | 1 |
| `src/webview/shared/queryEditor.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/queryEditor.tsx` | `src/webview/shared/facets.tsx` | 1 | 1 |
| `src/webview/shared/queryEditor.tsx` | `src/webview/shared/queryText.ts` | 1 | 1 |
| `src/webview/shared/queryEditor.tsx` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/shared/queryText.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/rankedRows.tsx` | `src/webview/shared/menuKeys.ts` | 1 | 1 |
| `src/webview/shared/rankedRows.tsx` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/shared/searchCard.tsx` | `src/ui/protocol` | 3 | 3 |
| `src/webview/shared/searchCard.tsx` | `src/webview/shared/blockExcerpt.tsx` | 1 | 1 |
| `src/webview/shared/searchCard.tsx` | `src/webview/shared/tagButton.tsx` | 1 | 1 |
| `src/webview/shared/searchCard.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/shared/tagButton.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/tagButton.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/shared/tagMenu.tsx` | `src/webview/shared/menuKeys.ts` | 1 | 1 |
| `src/webview/shared/tagMenu.tsx` | `src/webview/shared/rankedRows.tsx` | 1 | 1 |
| `src/webview/shared/taskRow.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/shared/taskRow.tsx` | `src/webview/shared/taskTitle.tsx` | 1 | 1 |
| `src/webview/shared/taskTitle.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/shared/taskTitle.tsx` | `src/webview/shared/inline.tsx` | 1 | 1 |
| `src/webview/shared/taskTitle.tsx` | `src/webview/shared/tagButton.tsx` | 1 | 1 |
| `src/webview/shared/viewOptions.tsx` | `src/webview/shared/icons.tsx` | 1 | 1 |
| `src/webview/shared/viewOptions.tsx` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/sidebarNotes/cards.tsx` | `src/ui/protocol` | 3 | 3 |
| `src/webview/sidebarNotes/cards.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/cards.tsx` | `src/webview/shared/tagButton.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/cards.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/cards.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/cards.tsx` | `src/webview/sidebarNotes/weights.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/context.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/sidebarNotes/context.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/context.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/context.tsx` | `src/webview/sidebarNotes/cards.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/context.tsx` | `src/webview/sidebarNotes/model.ts` | 1 | 1 |
| `src/webview/sidebarNotes/context.tsx` | `src/webview/sidebarNotes/weights.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/links.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/sidebarNotes/links.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/calendar/dayPanel.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/loading.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/markWords.ts` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/menuKeys.ts` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/page.ts` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/scroll.ts` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/tagMenu.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/sidebarNotes/cards.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/sidebarNotes/context.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/sidebarNotes/links.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/sidebarNotes/model.ts` | 1 | 1 |
| `src/webview/sidebarNotes/main.tsx` | `src/webview/sidebarNotes/refine.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/model.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/sidebarNotes/refine.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/sidebarNotes/refine.tsx` | `src/webview/shared/facets.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/refine.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/refine.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/weights.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/sidebarNotes/weights.tsx` | `src/webview/shared/facets.tsx` | 1 | 1 |
| `src/webview/sidebarNotes/weights.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/stats/attention.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/stats/attention.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/stats/attention.tsx` | `src/webview/stats/model.ts` | 1 | 1 |
| `src/webview/stats/attention.tsx` | `src/webview/stats/views.tsx` | 1 | 1 |
| `src/webview/stats/main.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/stats/main.tsx` | `src/webview/shared/page.ts` | 1 | 1 |
| `src/webview/stats/main.tsx` | `src/webview/shared/scroll.ts` | 1 | 1 |
| `src/webview/stats/main.tsx` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/stats/main.tsx` | `src/webview/stats/attention.tsx` | 1 | 1 |
| `src/webview/stats/main.tsx` | `src/webview/stats/model.ts` | 1 | 1 |
| `src/webview/stats/main.tsx` | `src/webview/stats/tagPairs.tsx` | 1 | 1 |
| `src/webview/stats/main.tsx` | `src/webview/stats/tagUse.tsx` | 1 | 1 |
| `src/webview/stats/main.tsx` | `src/webview/stats/totals.tsx` | 1 | 1 |
| `src/webview/stats/main.tsx` | `src/webview/stats/views.tsx` | 1 | 1 |
| `src/webview/stats/model.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/stats/tagPairs.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/stats/tagPairs.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/stats/tagUse.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/stats/tagUse.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/stats/tagUse.tsx` | `src/webview/stats/model.ts` | 1 | 1 |
| `src/webview/stats/totals.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/stats/totals.tsx` | `src/webview/shared/metric.tsx` | 1 | 1 |
| `src/webview/stats/totals.tsx` | `src/webview/stats/model.ts` | 1 | 1 |
| `src/webview/stats/views.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/stats/views.tsx` | `src/webview/shared/tagLabel.tsx` | 1 | 1 |
| `src/webview/stats/views.tsx` | `src/webview/stats/model.ts` | 1 | 1 |
| `src/webview/taskBoard/board.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/taskBoard/board.tsx` | `src/webview/shared/actionMenu.tsx` | 1 | 1 |
| `src/webview/taskBoard/board.tsx` | `src/webview/shared/buttons.tsx` | 1 | 1 |
| `src/webview/taskBoard/board.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/taskBoard/board.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/taskBoard/board.tsx` | `src/webview/shared/taskTitle.tsx` | 1 | 1 |
| `src/webview/taskBoard/board.tsx` | `src/webview/taskBoard/model.ts` | 1 | 1 |
| `src/webview/taskBoard/boardMoves.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/taskBoard/boardMoves.ts` | `src/webview/shared/actionMenu.tsx` | 1 | 1 |
| `src/webview/taskBoard/boardMoves.ts` | `src/webview/shared/openSource.ts` | 1 | 1 |
| `src/webview/taskBoard/boardMoves.ts` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/taskBoard/boardMoves.ts` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/taskBoard/boardMoves.ts` | `src/webview/taskBoard/board.tsx` | 1 | 1 |
| `src/webview/taskBoard/boardMoves.ts` | `src/webview/taskBoard/model.ts` | 1 | 1 |
| `src/webview/taskBoard/layouts.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/taskBoard/layouts.tsx` | `src/webview/shared/buttons.tsx` | 1 | 1 |
| `src/webview/taskBoard/layouts.tsx` | `src/webview/shared/inline.tsx` | 1 | 1 |
| `src/webview/taskBoard/layouts.tsx` | `src/webview/shared/strokeIcons.tsx` | 1 | 1 |
| `src/webview/taskBoard/layouts.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/taskBoard/layouts.tsx` | `src/webview/taskBoard/model.ts` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/domain/tasks` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/ui/protocol` | 2 | 2 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/actionMenu.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/buttons.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/keySheet.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/menuKeys.ts` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/openSource.ts` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/page.ts` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/queryEditor.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/rankedRows.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/scroll.ts` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/status.ts` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/taskRow.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/undoToast.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/viewOptions.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/shared/vscode.ts` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/taskBoard/board.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/taskBoard/boardMoves.ts` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/taskBoard/layouts.tsx` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/taskBoard/model.ts` | 1 | 1 |
| `src/webview/taskBoard/main.tsx` | `src/webview/taskBoard/statusSettings.tsx` | 1 | 1 |
| `src/webview/taskBoard/model.ts` | `src/ui/protocol` | 1 | 1 |
| `src/webview/taskBoard/model.ts` | `src/webview/shared/actionMenu.tsx` | 1 | 1 |
| `src/webview/taskBoard/statusSettings.tsx` | `src/ui/protocol` | 1 | 1 |
| `src/webview/taskBoard/statusSettings.tsx` | `src/webview/taskBoard/model.ts` | 1 | 1 |

Folders that import each other:

- `src/composition/services.ts` and `src/ui/commands` import each other.
- `src/domain/markdown` and `src/domain/tasks` import each other.
- `src/domain/index` and `src/domain/query` import each other.
- `src/domain/query` and `src/domain/tasks` import each other.
- `src/ui/commands` and `src/ui/views` import each other.
- `src/ui/commands` and `src/ui/webview` import each other.

## Module cycles

None.

## The search-store worker

`src/core/storage/searchStoreWorker.ts` is its own esbuild entry. Its closure within `src`:

- `src/core/storage/parsedFileCodec.ts`
- `src/core/storage/searchDatabase.ts`
- `src/core/storage/searchStoreWorker.ts`
- `src/core/types.ts`
- `src/domain/model/blocks.ts`
- `src/domain/model/graph.ts`
- `src/domain/model/index.ts`
- `src/domain/model/inline.ts`
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
- `src/ui/protocol/inline.ts`
- `src/ui/protocol/messaging.ts`
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
| All mocha suites in `src/test` | 221 |
| Import `vscode` themselves | 72 |
| Import no `vscode` themselves, but reach it | 35 |
| Never reach `vscode`, so run under `test:unit` | 114 |

The suites under `test:unit`: `agenda-service`, `assignee`, `assistant-tool-table`, `assistant-tools`, `calendar-day-panel`, `calendar-math`, `calendar-messages`, `calendarPage-messages`, `capture-box`, `capture-lines`, `capture-service`, `capture-words`, `change-reactions`, `change-watcher`, `changelog`, `completion-context`, `dashboard-messages`, `dashboard-widgets`, `debounce`, `due-date-wording`, `emitter`, `export-results`, `export-service`, `frontmatter-tags`, `frontmatter`, `guards`, `guide-links`, `help-manifest`, `help-messages`, `icons`, `index-publishing`, `line-shapes`, `link-rewrites`, `link-service`, `markdown-block-excerpt`, `markdown-inline`, `markdown-parser`, `mcp-protocol`, `move-service`, `naming`, `navigation-service`, `note-boundaries`, `note-embeds`, `note-links`, `notes-graph-communities`, `notes-graph-messages`, `notes-graph-simulation`, `notes-graph-state`, `outline-tree`, `page-loader`, `page-narrowing`, `parked`, `parking-service`, `paths`, `people-recency`, `pin-service`, `pinned-notes`, `preference-snapshots`, `preferences-invariants`, `preferences-maintenance`, `preferences-prune`, `preferences-roundtrip`, `preferences-schema`, `preferences`, `prose-excerpt`, `query-block`, `query-language`, `query-links`, `query-values`, `quick-find-actions`, `related-notes-evaluation`, `repeat-rule-problems`, `result-table`, `review-service`, `rollover-service`, `search-page-messages`, `search-store`, `setting-toggles`, `shared-html`, `sidebarNotes-messages`, `spacing-scale`, `stats-messages`, `tag-hygiene`, `tag-navigation`, `tag-service`, `tag-target`, `tagged-entries`, `task-board-messages`, `task-columns`, `task-draft`, `task-metadata`, `task-policy`, `task-query`, `task-rules`, `task-service`, `task-steps`, `template-service`, `templates`, `text`, `theme-preview`, `timing`, `try-next`, `view-publisher`, `view-state`, `warm-start`, `webview-page`, `webview-query-editor`, `webview-shared`, `webview-tasks`, `widget-catalog`, `wiki-link-targets`, `word-similarity`, `workspace`, `write-history`.

For the suites that reach `vscode` only through what they test, the module on the shortest path that imports `vscode` itself:

| Imports `vscode` | Suites that reach it first | Examples |
| --- | --- | --- |
| `src/test/pages.ts` | 10 | notes-graph-behavior, page-sheets, parked-commands, query-builder-webview |
| `src/ui/commands/sampleWorkspace.ts` | 3 | index-equivalence, parsed-file-codec, webview-search |
| `src/ui/commands/dailyNote.ts` | 2 | calendar, daily-notes |
| `src/ui/commands/bulkEdit.ts` | 2 | tags-in-code, tags-in-links |
| `src/ui/webview/host/activeSource.ts` | 1 | active-source |
| `src/ui/commands/assistantWrites.ts` | 1 | assistant-writes |
| `src/ui/commands/agendaActions.ts` | 1 | calendar-day |
| `src/ui/commands/checkSetup.ts` | 1 | check-setup |
| `src/ui/webview/themes.ts` | 1 | components-primitives |
| `src/ui/commands/datePrompt.ts` | 1 | date-phrases |
| `src/ui/webview/sidebarNotes.ts` | 1 | entry-matching |
| `src/ui/webview/pages/help/guidePage.ts` | 1 | guide |
| `src/ui/commands/moveTo.ts` | 1 | move-lines |
| `src/ui/commands/moveTagsToFrontmatter.ts` | 1 | move-tags-to-frontmatter |
| `src/ui/commands/activeNoteContext.ts` | 1 | note-actions |
| `src/ui/webview/pages/notesGraph/notesGraphController.ts` | 1 | notes-graph-navigation |
| `src/ui/commands/notify.ts` | 1 | notify |
| `src/ui/webview/host/panelPriority.ts` | 1 | panel-priority |
| `src/ui/commands/rollover.ts` | 1 | parked-lists |
| `src/ui/commands/renameTag.ts` | 1 | rename-tag-box |
| `src/ui/webview/pages/stats/statsController.ts` | 1 | stats |
| `src/ui/webview/pages/taskBoard/taskBoardController.ts` | 1 | task-board |

## Module-level state

Whether each piece of hidden state is still declared at module level, and, while it is, how many other files use a function that reads or writes it:

| State | Declared in | Still module-level | Source files | Test files |
| --- | --- | --- | --- | --- |
| `queryIdentity`, `queryWeekStart` | `src/domain/query/queryEvaluator.ts`, `src/domain/query/queryDates.ts` | no | — | — |
| `policy` | `src/domain/tasks/taskPolicy.ts` | no | — | — |
| `log` | `src/shared/timing.ts` | yes | 32 | 12 |
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

## How to regenerate

```sh
node scripts/import-graph-report.js                          # every table above
npx depcruise src --config .dependency-cruiser.cjs --no-ignore-known --output-type err
                                                              # every violation, known ones included
npx depcruise src --config .dependency-cruiser.cjs --output-type archi | dot -T svg > layers.svg
                                                              # the folder-level picture, with Graphviz installed
```

When a phase removes known violations, `npm run lint:deps:baseline` rewrites `.dependency-cruiser-known-violations.json`, and the diff of that file is the record of what the phase fixed.
