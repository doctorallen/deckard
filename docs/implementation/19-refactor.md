# 19. Refactoring Deckard: services, thin adapters, and bundled webview pages

Planned against `dev` at `d4f13e2` (v1.23.1). Source: David's request to refactor the whole code base to modern standards, with these priorities: **return early**, **separation of concerns**, **business logic in services rather than in routing**, **webview HTML built the way well-made VS Code extensions build it**, **doc blocks on functions with comments that say why**, **a published page on how Deckard is built**, and, added while weighing the rendering choice, **as little third-party code shipped in the extension as possible**, for the attack surface it carries (§2.7).

The plan rests on an audit of every subsystem (twelve readers, one per area, each finding anchored to a file and line, then a second reader per subsystem who re-opened every cited line) and on five research reports, each checked claim by claim against its sources: the official webview guidance and samples; the webview source of GitLens, GitHub Pull Requests, Jupyter, Azure Cosmos DB, DocumentDB, `@microsoft/vscode-ext-webview`, and `vscode-messenger`; rendering libraries measured under this CSP and in jsdom; the lint, dependency, and docs tooling; and how Foam, GitLens, vscode-python, vscode-eslint, Dendron, Markdown All in One, and VS Code's own git extension structure their host side. The 472 findings are the backlog in [19-refactor-findings.md](19-refactor-findings.md): 135 high, 249 medium, 88 low; 364 were confirmed as written, 108 were corrected in a detail, none was refuted. Of the research claims, 199 were confirmed and 38 adjusted, and every recommendation held.

Every phase is behavior-preserving. No user-visible change ships in this plan. Each phase lands as its own branch and pull request, verified by the full suite set ([CONTRIBUTING.md](../CONTRIBUTING.md#webview-components)).

## 1. Where the code is now

About 41,000 lines of source outside `src/test`, plus 12,700 lines of page script that lives inside template literals. Line by line the code is disciplined: most functions already return early, and the comments that exist explain constraints and bugs prevented. The problems are where code lives, what it can see, and what is written twice.

### 1.1 Routing that holds business logic (51 findings)

- **`src/extension.ts`** is 1,441 lines. `activate()` runs from line 187 to 1294 and does everything: it builds about 45 objects straight from VS Code APIs, feeds five module-level setters, and registers all 102 commands across 26 `context.subscriptions.push()` calls. 79 callbacks are one-line forwards; 23 hold logic, and about a dozen make decisions or compose user-facing text. Ten named closures inside it are real work, not wiring: `readTaskPolicy` normalizes settings (236), the `indexer.ready` handler decides and words the exclude hint (331–362), the unreadable-files listener counts and warns (569–594), `tidy` carries section ids and prunes preferences (598–622, repeated at 1282), and `dueFromView`/`rescheduleContext` compute agenda load (659–689). The service list is written four times (`activeServices`, the subscriptions push, `deactivate()`, and the `ExtensionServices` interface) and the copies already disagree: `deactivate()` omits `notesGraph`.
- **Webview message handlers** are `switch` or `if` chains over `message.type` that make domain decisions inline. `DashboardPanel.handleValidMessage` is a 250-line switch over 40 types (`dashboard.ts:526–775`); the sidebar's is a 176-line ladder of 25 `if`s (`sidebarNotes.ts:646–821`), five branches of which re-rank the whole workspace with `createSnapshot()` to validate one click. The rule for which index entity makes an `openSource` line openable is written four times with three different answers (`dashboard.ts:538`, `notesGraph.ts:481`, `taskBoard.ts:524`, `stats.ts:198`), and `openTag` is validated two ways, so a key can open from one page and not another. Two `WorkspaceEdit` writers live inside the sidebar view (`sidebarNotes.ts:836`, `:872`). Theme, zen, `openHelp`, `openSource`, `openTag`, `toggleTask`, `renameTag`, `parkTag`, `pinNote`, `mergeTags`, `exportResults`, and `saveSearch` are each handled separately, and identically, by two to six hosts.
- **`src/ui/commands`** has 66 files, and about 20 are not commands: nine editor providers (`tagDecorations`, `linkSuggestions`, `editorLenses`, `editorReferences`, `tagSuggestions`, `taskMetadataSuggestions`, `entitySuggestions`, `taskLineDecorations`, `repeatRuleHealth`), long-lived services (`linkMaintenance`, `linkHealth`, `mcpServer`, `noteVisits`), and context-key ledgers. The orchestration functions in the rest hold the domain decisions and the presentation in one body of 60 to 170 lines: `rewriteTag` (`renameTag.ts:322`), `parkNotes` and `unparkNotes` (`parking.ts:99`, `:177`), `applyRollover` (`rollover.ts:172`), `moveBlocks` (`moveTo.ts:140`), `renameHeadingCommand` (`linkMaintenance.ts:350`), `capture` (`capture.ts:91`), `QuickFind.runAction` (`quickFind.ts:299`, a 130-line switch that does the writes itself). `updateTaskLine` (`taskActions.ts:103`), the choke point for every task edit, opens the document, checks staleness, applies the edit, saves, carries the rank, and offers Undo in one 90-line function. The four assistant tools are dispatched twice, once for the language-model tools and once for the MCP server, and their refusal strings have already drifted (`mcpServer.ts:276`, `assistantTools.ts:57`).
- **`src/ui/views/agendaTree.ts`** (863 lines) is a tree provider that also writes task lines (`moveToGroup` 412, `completeTasks` 479), runs QuickPicks and writes settings (`pickAgendaGrouping` 676), executes `setContext` from inside `getChildren` (198), and hosts the domain query `listOverdueTasks` (841) that the status bar and `extension.ts` import.

### 1.2 Layers pointing the wrong way (63 findings)

| Direction | Where |
| --- | --- |
| `core` → `ui` | `core/storage/preferences.ts:8` imports `isTaskColumnId` from `ui/state/resultTable` (the types it takes are re-exports of `core/types`). |
| `core` → `vscode` | `indexer.ts` (`EventEmitter` in field initializers at 57 and 74, `window.withProgress` with status-bar text at 387, watchers at 545–631), `scanner.ts` (`getConfiguration` at 299 and 558, `RelativePattern`, `Uri.joinPath`, `asRelativePath`), `preferences.ts` (`Memento`, `EventEmitter`), `preferenceSnapshots.ts` (`workspace.fs`), `searchStore.ts` (a `Uri` read once for `.fsPath`), `publishing.ts` (`panelPriority`, `viewPriority`, which map a panel's visibility to a redraw priority). `buildWorkspaceIndex`, pure and imported by 54 test files, lives in `indexer.ts`. |
| `ui/state` → `ui/commands` | `calendarState.ts:14`, `dashboardWidgets.ts:19`, and `editorLensState.ts:13–14` import pure date, periodic-note, and rollover helpers from `commands/dailyNote` and `commands/rollover`, both of which import `vscode`. |
| `ui/state` → `ui/webview` | `dashboardState.ts:92` and `taskBoardState.ts:49` bake sanitized HTML into snapshots through `webview/rendering`; `ui/preview/queryBlockHtml.ts:15` does the same. `rendering.ts` itself has no VS Code dependency. |
| `ui/commands` → `ui/webview` | `editorReferences.ts:26` imports the 183-line `createEntryScope` from the 1,300-line `sidebarNotes.ts` host. |
| `core/query` inverted | The parser imports `resolveDateRange` from the evaluator (`queryParser.ts:2`); the formatter imports `describeOperator` from the parser (`queryFormat.ts:1`). |
| Page CSS reads settings | `components.ts:1014` `getPageTailCss` calls `getDeckardTheme()`, which reads `vscode.workspace.getConfiguration` while building CSS, so no page renders without a VS Code stub. |

- **Domain engines in `src/ui/state`** (27 files, 12,693 lines). Most of the directory is domain logic wearing a view-model name: `relatedNotesRanking.ts` (`rankRelatedNotes` is 357 lines), `wordSimilarity.ts` (BM25), `tagHygiene.ts` (Damerau-Levenshtein), `quickFindState.ts` (tiered fuzzy ranking), `taskBoardState.ts` (`setTaskStatusTag` and `resolveTaskMove` rewrite task lines), `notesGraphState.ts` (graph construction and BFS), `searchFacets.ts`, `reviewState.ts` (writes Markdown), `agendaState.ts` (`placeTask`, the policy behind every task view), `editorLensState.ts` (workspace-wide mention search), and `assistantTools.ts` (the tool service). `dashboardState.ts` (2,367 lines, 35 exports) is a hub imported by 9 sibling files and 27 others; it mixes the Home snapshot, search-page evaluation, Stats, tag and task sorting, and query-bar suggestions.
- **`src/core/types.ts`** (2,244 lines) is about 11% domain model, 8% preference schema, 45% webview view models, and 34% webview message interfaces (106 of them, with 119-member unions).
- **`PreferencesStore`** (1,834 lines) holds Memento persistence, schema normalization, three migrations, favorites, usage tracking, task order and board layout, Home widgets, pins, saved searches, the tag-rename cascade, display setters, and garbage collection against the index. `WorkspaceIndexer` (830 lines) holds lifecycle, warm start, the cache fingerprint, scan orchestration with progress UI, diffing, a parking cache, six scanner pass-throughs, the search-store facade, watcher wiring, the debounce queue, the view-turn scheduler, and the unreadable-notes ledger.

### 1.3 Hidden state and hidden clocks (25 findings)

Module-level `let`s and singletons stand in for dependency injection, and pure functions read them:

| State | Where | Who reads it |
| --- | --- | --- |
| `queryIdentity`, `queryWeekStart` | `queryEvaluator.ts:313–315` | `matchesIs`, `resolveDateRange`, `dashboardState.ts:2078` |
| `policy` | `taskPolicy.ts:29` | `needsNewDate`, `readLineStatus` (as a default parameter), `describeDueDate` (`taskMetadata.ts:973`), the evaluator |
| `log` | `timing.ts:29` | every `measure` call |
| `keepTaskRank` | `taskActions.ts:36` | `carryTaskRank`, `revertTaskLine` |
| `workspaceWrites` | `workspaceWrites.ts:144` | six command modules and `extension.ts` compare `lastWrite` to decide whether Undo is still valid |
| `ownWrites` | `ownWrites.ts:11` | the indexer, to skip its debounce |
| `activeServices` | `extension.ts:168` | `deactivate()` |
| `focusedIn` | `focusSection.ts:9` | the section-focus context key |
| `previewTheme` | `themes.ts:34` | every page built anywhere picks up the last previewed theme |
| `lastSource` | `noteEmbeds.ts:265` | every Markdown preview engine shares one parse cache |
| `linkNamesByPath` | `relatedNotesRanking.ts:916` | a `Map` keyed by path that survives workspace switches, cleared only at 50,000 entries |
| `entityKinds`, `tagPatterns` | `indexState.ts:92`, `parser.ts:1059` | process-wide memos |

Four test suites reset these in teardown, and one forgotten reset leaks into unrelated suites. The clock is read the same way: `matchesIs`, `matchesDate`, and `resolveDateRange` default `now` to `Date.now()` and no caller passes it (`queryEvaluator.ts:719`), `getRecencyWeight` reads it inside the ranking (`relatedNotesRanking.ts:1005`), the query-block cache keys on `new Date().toDateString()` (`queryBlockState.ts:323`), and `agendaTree.getChildren`, `readBoardOptions`, `listOverdueTasks`, and `writeCapture` read it directly. The `WeakMap` caches keyed by a `WorkspaceIndex` snapshot are per-snapshot memoization and stay.

### 1.4 Duplication (80 findings)

The same small helpers are written again in file after file, and the copies disagree:

| Helper | Copies | Disagreement |
| --- | --- | --- |
| `escapeHtml` | 8 (`components.ts` ×3, `helpHtml`, `relatedNotesDebugHtml`, `noteEmbeds`, `queryBlockHtml`, `sidebarNotesHtml`) | two escape sets; the four-character one leaves single quotes unescaped in attributes |
| The task-line regex | 9 in `core/markdown`, 5 more in `ui/commands` | whether `[>]` counts, leading whitespace, what must follow the checkbox |
| The ATX heading regex | 6 | whether `#` alone is a heading |
| Front-matter bounds | 6 | three accept a `...` closing line, three do not |
| `exists(uri)` | 7 | — |
| `isRecord` | 5 | — |
| A pluralizer | at least 8 | zero handling, locale formatting |
| `escapeMarkdown` | 4 | different character sets |
| `getFileName` | 5 | — |
| Short weekday names | 4 | — |
| The per-document debounce | 6 classes | each re-implements `clearTimeout` in `dispose` |
| `WIKI_LINK` | 3 | whether the display text is captured |
| The parse-settings triple (`parseInlineTags`, aliases, person marker) | 4 | — |
| The QuickPick-as-Promise wrapper | 5 | — |
| `Active*` registries | 3 near-identical classes | — |
| Calendar math (`addMonths`, `makeDay`, weekday names) | 3 | — |
| The association walk | 2 (`indexState.ts:197` and `:1104`) | must stay identical for the hash-collision fallback to be equivalent |
| The Undo offer | 4 | — |
| Panel lifecycle | 7 panels and 2 views, 60–110 lines each | `enableScripts` set twice per panel |

### 1.5 Webview pages

Nine host functions each return one template literal holding the whole document: a CSP `<meta>`, one inline `<style nonce>` (about 770 shared lines plus the page's own), and one inline `<script nonce>` that interpolates `getComponentScript()` (105.9 KB, 2,136 lines) and, on four pages, `getQueryEditorScript()` (67.8 KB, 1,421 lines) as untyped text. `docs/components.md` states the design outright: "Nothing can be imported at runtime, so anything shared between panels is shared as text."

| Page | Rendered | Script |
| --- | --- | --- |
| Dashboard | 339.8 KB | 245.8 KB, 4,710 lines |
| Search page | 295.4 KB | 211.2 KB |
| Task Board | 279.1 KB | 200.2 KB |
| Related Notes | 235.4 KB | 154.1 KB |
| Calendar | 210.3 KB | 140.6 KB |
| Stats | 203.3 KB | 133.5 KB |
| Notes Graph | 190.5 KB | 107.1 KB |
| Help | 164.1 KB | 5 KB |

- Every page draws by building one HTML string and assigning `app.innerHTML` (9–12 writes per page); `renderKeepingPlace` exists to work around the focus and scroll lost on each redraw. Only the Notes Graph uses `createElement` and a canvas.
- The compiler never sees the page code. `test/ui/checkWebviewScripts.js` re-extracts the inline scripts by regex and runs `tsc` with `strict: false` over them. The graph's clustering and edge-budget algorithms (`notesGraphHtml.ts:982–1337`), the Home widget catalog and id minting (`dashboardHtml.ts:302`, `:517`), calendar arithmetic (`calendarHtml.ts:200`), board status validation (`taskBoardHtml.ts:397`), tag-key parsing (`dashboardHtml.ts:355`), and the Help manifest interpreter that authorizes `runCommand` (`helpHtml.ts:50–113`) are all written as untyped page script.
- Click handlers are 25–35-branch `if (action === …)` ladders (`dashboardHtml.ts:1149`, `searchPageHtml.ts:581`); the sidebar registers three separate `click` listeners.
- Page-to-host messages are validated by hand-written check-then-cast parsers in `messages.ts` (twelve dashboard cases pass the whole record through with a double cast); host-to-page messages are untyped literals; the page side has no types at all. `sidebarNotes.ts:615` parses three more types by hand outside the parser.
- `getContentSecurityPolicy` exists but seven of nine builders hand-write the policy string, and they have drifted. `retainContextWhenHidden: true` is set on all nine webviews, including the two sidebar views. `asWebviewUri` is used only for icons and the Help logo. `calendarDay.ts` is CSS and browser script returned as strings and spliced into three pages, with backslashes doubled by hand.
- Two globals live here: `previewTheme` (`themes.ts:34`) and the theme name baked into the shared script at build time (`components.ts:2899`).

### 1.6 Tests and tooling

- **Every test runs in the extension host.** The only runner is `vscode-test` over 139 mocha files and 1,331 tests, of which 67 files never import `vscode`. The pure parser, evaluator, and state suites boot Electron with a 20-second timeout to test pure functions.
- **Three DOM implementations.** `src/test/webviewPage.ts` (jsdom, 39 tests), `test/e2e/webviewRuntime.js` (a 528-line hand-written DOM whose `classList` methods are no-ops and whose `addEventListener` on elements is ignored, run by swapping `document` and `window` onto `globalThis`), and `mountTagOverview` in `query-builder-webview.test.ts` (a third stub DOM). 13 tests still assert on page source text.
- **Every harness depends on inline assets.** `webviewRuntime.js:392` and `checkWebviewScripts.js` regex-extract the first `<script>`; `verifyWebviews.js:165` demands exactly one nonce in the page text; `checkLayout.js:452` strips the CSP and embeds the page as an iframe `srcdoc`; `checkContrast.js:538` discovers elements by scanning the markup string literals inside the script. A page that links its script or stylesheet passes nothing.
- **The pixel guard does not compare on CI.** `test/ui/visual-baseline/` holds only a `darwin/` set; `ci.yml:52` runs `test:visual` on `ubuntu-latest`, where `checkVisual.js` records a missing baseline and passes. `release.yml:59` runs only `npm test` before publishing; the other four suites run solely in `ci.yml`, whose concurrency group can cancel them. `pretest` runs `tsc` three times and `eslint` twice; CI compiles the tests six times per run.
- **The Node harnesses hard-code 30 `out/` module paths** and pin panel constructors with up to seven positional arguments, so a file move breaks them even when the mocha suites pass.
- **Lint and compiler checks are thin.** `eslint.config.mjs` enables five rules, over `src` only. `tsconfig.json` has `noImplicitReturns`, `noFallthroughCasesInSwitch`, and `noUnusedParameters` commented out, `lib` is `ES2022` with no DOM, and there is no formatter: 292 lines of `parser.ts` (432–723) sit one indent level too deep and nothing notices.

### 1.7 Comments and doc blocks

Measured per subsystem, the share of functions and methods with a doc block:

| Subsystem | Coverage |
| --- | --- |
| `ui/commands` tasks, daily notes, capture | 90% |
| `core/markdown` | 77% |
| `core/storage`, `core/workspace` | 75% |
| `extension.ts` | 67% (and `activate()`'s block is attached to a `const`) |
| `ui/state` | 62% |
| `ui/commands` find, notes, workspace | 61% |
| `ui/webview` page builders | 60% |
| `core/query` | 60% |
| `ui/commands` links, tags, parking | 55% |
| `ui/commands` providers and `ui/views` | 51% |
| `ui/webview` hosts | 50% |
| `test/` harnesses | about 25% |

The comments that exist say why: constraints, measured numbers, bugs prevented, WCAG clauses. Narrating comments are rare and are listed in the findings. The recurring defect is a **doc block attached to the wrong declaration**: 28 found, where a constant or helper was inserted between a block and its function, so the function reads as undocumented and the block documents nothing (`extension.ts:178`, `agendaTree.ts:100`, `parser.ts:901`, `:1518`, `:1656`, `preferences.ts:388`, `messages.ts:370`, `relatedNotesRanking.ts:175`, and twenty more).

### 1.8 What the audits did not cover

Each audit had a file list under `src/`. A completeness pass named four things none of them opened, and each becomes an inventory written in Phase 0 before anything moves:

- **`package.json` is the frozen behavior contract.** 96 commands are contributed but 102 are registered in `extension.ts`, so six internal ids must keep being registered by exact name after the split. 73 settings are declared while the source reads 77 distinct keys, so four reads are undeclared or four settings are dead, and either is a behavior question. 134 `when` clauses reference about 28 `deckard.*` context keys while only eight literal `setContext` keys appear in source, so the rest are set indirectly and a move could silently stop setting one. 18 distinct `deckard.*` command ids are re-entered through `executeCommand` from other modules, which any rename and the `WriteHistory` decision of §2.3 must respect. Seven serializer view types are tied to `onWebviewPanel` activation events, and `markdown.previewStyles` and `markdown.markdownItPlugins` bind `src/ui/preview` and `resources/query-block.css`. One concrete trap: `src/test/extension.test.ts:342` reads `out/extension.js` as text and asserts the literal `'setContext', '${key}'` for each walkthrough key, so moving those calls into feature modules fails that test unless it is rewritten first (§2.6 does).
- **Every persisted format the upgrade in place must keep reading.** §6 freezes "the preferences format" and "the index cache format", but the full set is wider: seven memento keys (`deckard.preferences`, its workspace-scoped twin, `WHATS_NEW_PENDING`, `LAST_SEEN_VERSION`, `SAMPLE_README_KEY`, `EXCLUDE_HINT_SHOWN`, `FIRST_INDEX_SUMMARY_SHOWN`); the SQLite cache at `SCHEMA_VERSION = 3` (`searchDatabase.ts:20`) with a parse fingerprint built from `PARSE_FORMAT`, four settings, the extension version, and the time zone; `parsedFileCodec`, which has no version constant of its own; the `preference-snapshots/` files; the preference export JSON at `version: 1` (`preferenceBackups.ts:33`); the sample workspace under `globalStorageUri`; and, most exposed by the webview rewrite, the per-page `setState` shapes (ten `getState()` reads across the page scripts) that VS Code hands back to the serializers on restart, so a page restored after an upgrade receives state written by the old script. The inventory names each format, its version marker, and the test that pins it (`src/test/fixtures/legacyWorkspaceIndex.ts`, `preferences-invariants.test.ts`, `warm-start.test.ts`, or none yet).
- **A whole-tree import graph.** 101 of the 171 non-test source files import `vscode` (core 6, commands 62, webview 27, views 4, preview 1, state 0), and the transitive reach through `ui/state`'s three imports from `ui/commands` is larger; nobody has computed which of the 67 vscode-free test files could run under plain mocha today. The search-store worker is a second esbuild entry whose closure (`searchDatabase.ts`, `parsedFileCodec.ts`, and what they import) fails only at runtime inside the worker if any module in it comes to import `vscode`. `ui/webview` imports twelve distinct `ui/commands` modules and `ui/commands` imports two `ui/webview` modules, so those two folders are already one cycle-prone layer. Each global in §1.3 has a reader count (`workspaceWrites`: 14 source and 6 test files) that sizes its replacement. `dependency-cruiser`'s first run in Phase 0 is this baseline.
- **The existing docs, `scripts/`, `.vscode/`, and `development/`.** `docs/components.md` (57 KB) documents the exact mechanism §2.4 replaces, with an "Adding a component" recipe, and is rewritten in Phase 6; `docs/task-steps.md` cites 22 `src/` paths, `related-notes-associations.md` five, and `editor-lenses.md` two, all of which go stale on a layer move, so Phase 7 checks every `src/` path in `docs/`. `scripts/capture-dashboard-screenshot.mjs` (697 lines) drives a real VS Code by command id to produce the README and walkthrough screenshots that define "looks"; `scripts/changelog.js` feeds `src/core/changelog.ts`. `.vscode/launch.json` points `outFiles` at `dist/**`, and `development/` is a fixture workspace with its own settings. All of them are part of "nothing changes" and are checked at the end of each phase.

## 2. Target architecture

### 2.1 Layers

```
src/
  domain/          Pure model and rules. No vscode, no I/O, no ui.
    model/         notes, tasks, tags, links, index          (from core/types.ts)
    markdown/      parser, taskMetadata, dates, lineShapes   (from core/markdown)
    query/         parser, evaluator, dates, format, edit    (from core/query)
    index/         IndexState, associations, backlinks       (from core/workspace)
    ranking/       related notes, similarity, quick find, frecency, tag hygiene
    tasks/         agenda placement, board moves, reschedule, columns
    graph/         notes graph construction
  services/        Application logic: one class per capability, vscode-free.
                   Depends on domain + ports.
  ports/           Interfaces the services need: FileSystem, Configuration,
                   KeyValueStore, Clock, EditApplier, Log, Emitter.
  platform/        vscode implementations of the ports.
  ui/
    commands/<feature>/  Thin handlers, each feature exporting register(context, services).
    providers/     Completion, CodeLens, hover, decoration, diagnostic providers.
    views/         Tree views and status bars (display only).
    webview/
      host/        WebviewHost base, PageController, sharedHandlers, navigation.
      pages/<page>/ Host controller + snapshot builder for each page.
    protocol/      Message and snapshot types shared by host and page.
  webview/         Browser code, bundled by esbuild (see §2.4).
    shared/        components, query editor, calendar day, html escaping, CSS.
    <page>/        main.ts + page.css
  extension.ts     Composition root only.
```

The dependency rule points one way:

```
extension → ui → services → domain
                    ↓
                  ports ← platform
```

`webview/` imports only `ui/protocol` and `webview/shared`. `dependency-cruiser` enforces these rules in `npm run lint`, so a wrong-way import fails CI rather than a review.

### 2.2 What a service is, and what a command is

A **service** owns a capability: `TagService`, `ParkingService`, `RolloverService`, `TaskService`, `LinkService`, `CaptureService`, `AgendaService`, `SavedSearchService`, `PinService`, `ExportService`, `NavigationService`, `IndexService`, and so on.

- It takes its collaborators in its constructor: ports, other services, and an index reader.
- It exposes methods that take plain arguments and return **result objects**, for example `{ kind: 'refused', reason: 'already-parked', paths }` or `{ kind: 'stale' }`. It never calls `vscode.window`.
- It is unit-testable without the extension host.

A **command handler**, **message handler**, or **tree action** is an adapter. It does exactly three things, in order:

1. Gather input (arguments, a QuickPick, an InputBox), returning early on cancel.
2. Call one service method.
3. Present the result: a message, an undo offer, a reveal.

It holds no domain decisions. If a handler needs an `if` about the notes rather than about the reader's answer, that `if` belongs in the service.

```ts
/**
 * Parks the chosen notes. Which notes can be parked, and why the others
 * cannot, is ParkingService's decision; this only asks and reports.
 */
export async function parkNotesCommand(services: Services, uris?: vscode.Uri[]): Promise<void> {
  const chosen = uris ?? (await pickNotes());
  if (!chosen?.length) {
    return;
  }

  const result = await services.parking.parkNotes(chosen.map(toPath));
  await reportParking(result);
}
```

`extension.ts` shrinks to three steps:

1. Build the ports and services, once, in `createServices(context)`.
2. Call each feature's `register(context, services)`.
3. Hand every disposable to `context.subscriptions`, which disposes of them all. `activeServices`, the `ExtensionServices` interface, and the hand-written `deactivate()` list go away.

*As built in Phase 5:* two parts of this section were done differently. `activate()` stays synchronous and runs the features in a loop, each in its own `try`, rather than through `Promise.allSettled`, because every command and the exports must exist by the time `activate()` returns. `runCommand` logs an unexpected exception and throws it on rather than showing a generic message, so no command shows anything it did not show before. [services.md](../architecture/services.md) describes both.

Two shapes from the audit become the rule everywhere: `insertLink.ts` (one pure builder, one thin adapter) for commands, and `taskSteps.ts`'s `StepList` (a class that models a QuickPick's state so the prompt is only wiring) for prompts with state, which replaces the seven mutable `let`s of `askForCapture`.

The host-side shape follows what the surveyed extensions converge on, with one departure:

- **Feature modules, as Foam does it.** `features` is one ordered array of `(context, services) => void | Promise<void>`; `activate()` builds the services, pushes them into `context.subscriptions` at once (so a feature that throws cannot leave watchers alive), then runs `Promise.allSettled(features.map(...))` and logs a failed feature rather than failing activation. Markdown All in One's per-module `activate(context)` and the git extension's single `Disposable.from(...)` push are the same pattern.
- **Constructor injection, no container.** GitLens's `Container.instance` proxy and Dendron's `ExtensionProvider` both carry comments working around a static locator, and vscode-python labels its Inversify fields legacy. Decorator containers (`tsyringe`, `inversify`) need `reflect-metadata` and `emitDecoratorMetadata`, which esbuild does not support without a Babel shim. A plain `Services` object, built once, is what makes the fast test tier of §2.6 possible, as Foam's aliased `vscode` mock shows.
- **Result objects are Deckard's own choice.** None of the surveyed extensions returns `{ kind: 'refused' }`; Foam returns or throws, Dendron returns `undefined` for cancellation, GitLens and git throw typed errors that the command layer maps to messages in one `createCommand` wrapper. Deckard keeps the discriminated result for refusals because it makes every outcome a value a unit test can assert, and borrows the wrapper: one `runCommand(id, handler)` that swallows `vscode.CancellationError` silently, logs unexpected exceptions, and shows one generic message, so no handler needs its own `try`.
- **No lazy activation.** ESLint's placeholder-then-`realActivate` and GitLens's `once(container.onReady)` exist for expensive startups; since VS Code 1.74 contributed commands need no `onCommand` events, and Deckard's index already builds in the background, so registering everything in `activate()` stays.

### 2.3 Replacing hidden state

| Global | What replaces it |
| --- | --- |
| `setQueryIdentity`, `setQueryWeekStart`, `setTaskPolicy` | A `QueryContext { identity, weekStart, taskPolicy, now }` built by a `ConfigurationService` and passed to `evaluateQuery`, `resolveDateRange`, `needsNewDate`, `readLineStatus`, and `describeDueDate`. |
| `timing.log` | A `Log` port. |
| `keepTaskRank` | A `TaskRankKeeper` collaborator on `TaskService`. |
| `workspaceWrites`, `ownWrites` | One injected `WriteHistory` service whose `write()` returns a handle with `undo()`, so no command reads a singleton or re-enters the command system to undo. |
| `focusedIn`, `previewTheme`, `activeServices` | Small classes owned by the composition root (`SectionFocus`, `ThemePreview`). |
| `lastSource`, `linkNamesByPath`, `entityKinds`, `tagPatterns` | Caches owned by the object whose lifetime they match: the preview engine, the ranking call, the `IndexState`, the validated `ParseOptions`. |
| `Date.now()` defaults | A `Clock` port; `now` is resolved once at the entry point and threaded through, as `taskLineDecorations.ts:44` already does. |

### 2.4 Webview pages, built like modern VS Code extensions build them

The research checked the official guide and samples and read the webview source of five extensions. Seven patterns hold across all of them:

1. Page code is real TypeScript, compiled by the normal type-checker and bundled; shared code is imported modules. None assembles page script from strings, and none inlines the built JavaScript into the HTML: every one loads it through `asWebviewUri`.
2. One bundle per page (GitLens, GitHub PR, Jupyter) or one bundle with a registry and lazy chunks (Cosmos DB, DocumentDB); the HTML template is tiny either way.
3. A host base class owns panel options, nonce, CSP, HTML, `onDidReceiveMessage`, ready gating, and dispose; per-page code supplies state, handlers, and a few lifecycle hooks.
4. Initial state reaches the page either embedded as inert data (GitLens: a base64 attribute; `vscode-ext-webview`: an `application/json` block with `<` escaped) or by a ready handshake and a push. Neither interpolates JSON into an executable script.
5. Message types live in one module imported by both sides, and every request/response pair carries a correlation id. None of the five validates page-to-host messages with a schema library at the host boundary.
6. Tests are two-tier: a fast tier under jsdom (or a DOM shim) plus host-controller unit tests against a fake `Webview` exposing only `postMessage` and `onDidReceiveMessage`, and a slow tier in a real VS Code.
7. Rendering is declarative with a library that diffs (Lit in GitLens, React elsewhere), and CSS is authored as files processed by the bundler, never generated in host code.

The official guide's own words: its recommended CSP "implicitly disables inline scripts and styles. It is a best practice to extract all inline styles and scripts to external files." `@vscode/webview-ui-toolkit` was deprecated on 6 January 2025 with no official successor; `@vscode-elements/elements` (Lit, shadow DOM, v2.5.1) is the community alternative.

Deckard adopts all seven, with these choices:

- **Bundling.** `esbuild.js` gains a second context: `platform: 'browser'`, `format: 'iife'`, one entry per page (`src/webview/<page>/main.ts`) and one CSS entry per page, emitted to `dist/webview/`. A second `tsconfig.webview.json` with `lib: DOM` covers `src/webview/`. The shared layer (`components`, `queryEditor`, `calendarDay`) becomes imported modules. `checkWebviewScripts.js` is retired, because `tsc` sees the pages.
- **Loading: `asWebviewUri`, not inlining.** Each page's HTML shell links `dist/webview/<page>.css` and loads `dist/webview/<page>.js` with `<script nonce src>` under `localResourceRoots: [dist/webview]` (plus `resources/` where icons are used). The style nonce goes; `style-src` becomes plain `${cspSource}`, exactly as the samples do. Every builder calls `getContentSecurityPolicy`, so the seven hand-written policies cannot drift, and `font-src` is granted only on a page that loads a font.
- **One page loader for every harness.** `test/harness/loadPage.js` resolves each `<script src>` and `<link href>` against `dist/webview/` and inlines them, so `openWebviewPage` (jsdom), `checkLayout.js` (`srcdoc`), `checkVisual.js`, `checkContrast.js`, `verifyWebviews.js`, and the e2e suites see the same self-contained page they see today. `openWebviewPage(html, state)` keeps its signature, so the 39 page-driving tests survive unchanged. The nonce rule becomes "every inline style and script carries the page nonce" rather than "one nonce in the text". This loader lands before any page moves, and its cost is measured on one page (Stats) before the choice is final.
- **Rendering: Preact 10, in the light DOM, written against Preact's own API.** Each page is a tree of TSX components that render from the snapshot; Preact diffs and patches only what changed, which removes the full-page `innerHTML` redraw, `renderKeepingPlace`, and the in-page `escapeHtml`, since text becomes text nodes by construction. The deciding measure was what ships: Preact is one package with no transitive dependencies and 4.6 kB gzip inlined per page. For comparison (esbuild 0.28, minified, gzip): `lit-html` 3.4 kB, one package; Lit with components 6.3 kB; Svelte 5 about 18.6 kB of runtime plus a 23-package compiler tree at build time; React 19 with `react-dom/client` 69 kB across three packages. Preact was chosen over `lit-html`, the other one-package option, for its component model, and because esbuild compiles TSX natively so `tsc` type-checks the markup with no plugin. It runs under the nonce-only CSP with no `unsafe-inline` (no style injection; style objects go through `element.style`), uses native `addEventListener` rather than a synthetic event system, and renders in jsdom 30 under `runScripts: 'dangerously'` with `@testing-library/preact` as a dev dependency. Rendering into the light DOM keeps the eight themes, the high-contrast sheets, and the layout, contrast, and visual tests working unchanged. Two guards: pin 10.29.x exactly (11.0.0 shipped on 2026-09-30 and has no track record yet), and never import `preact/compat`, so the React-compatibility layer never ships and a later move to React, should it ever be wanted, stays a compiler-driven rename (`preact` → `react` imports, `onInput` → `onChange`, `class` → `className`). `@preact/signals` is not adopted now; it would add a second package and would make that rename harder. Shadow DOM is ruled out on two counts: document-level theme CSS does not cross a shadow root except through inherited and custom properties, and jsdom has never implemented `adoptedStyleSheets` (issue #3444, open since 2022). `@vscode-elements/elements` is not adopted for the same reason, and because Microsoft's stated position after the toolkit is plain HTML styled with `--vscode-*` variables, which Deckard already does. Precedent: Preact renders the diagnostic tool of `vscode-js-debug` (the debugger built into VS Code), the Quantum Development Kit's webviews, and GitHub Issue Notebooks' renderer.
- **CSP is enforced only by Chrome.** jsdom does not enforce CSP at all (a wrong-nonce script ran in the probe), so `checkLayout.js`'s headless-Chrome `srcdoc` harness is the only place a CSP regression can surface. A `srcdoc` document inherits a clone of its parent's policy, so the harness's parent page must carry the intended CSP rather than stripping it as it does today; that change lands with the loader in Phase 0.
- **Initial state in the page.** The first snapshot is embedded as inert data in `<script type="application/json" id="state">` with `<` escaped, so the page draws on its first frame without a "Loading…" flash. This is `@microsoft/vscode-ext-webview`'s mechanism; GitLens's primary channel is a base64 attribute on the app element, which comes to the same thing. Updates keep coming through `postMessage({ type: 'state' })`, the entry point the tests already drive.
- **A typed protocol.** `src/ui/protocol/<page>.ts` declares each page's `HostToPage` and `PageToHost` message maps and its snapshot type, moved out of `core/types.ts`. The shape follows `vscode-messenger`'s `RequestType<P, R>` and `NotificationType<P>` descriptors: declared once, imported by both sides, with a request id on request/response pairs (`moveTask` → `moveRefused`). Validation stays hand-written, as in every surveyed extension, but as one table of per-message narrowing functions shared across pages, which replaces the eight check-then-cast parsers in `messages.ts` and the three hand parses in `sidebarNotes.ts`. No validation library is added.
- **A host base class.** `WebviewHost<TSnapshot, TMessage>` owns the lifecycle: create, restore, the serializer registration, the stale-when-hidden refresh, `followIndexing`, theme and settings-change subscriptions, `writeThroughIndex`, and disposal. Each page supplies a `PageController`: `buildSnapshot()`, a handler map keyed by message type, and panel options. The shared messages live once in `sharedHandlers`; `openSource` and `openTag` go through one `NavigationService.resolveSourceLocation(index, filePath, line)` with page policy as an option, so the four rules become one. The three `Active*` registries become one `ActiveSource<T>`. `panelPriority` and `viewPriority` move here from `core/workspace/publishing.ts`. Handlers are adapters under §2.2: `exportResults` becomes `services.export.fromSearch(query)` plus presentation.
- **`retainContextWhenHidden`.** The guide calls it the exception for state that cannot be quickly saved and restored, with high memory overhead. It is dropped everywhere except the Dashboard's query editor and the Task Board's drag state; per-page UI state (scroll, selection, open sections) goes into `setState` so the serializers restore it. The `isStale`/`onDidChangeViewState` refresh stays even where it is kept, because the API documentation and the guide disagree on whether a hidden retained webview receives messages (GitLens buffers and replays them for this reason), and the refresh is correct under either reading.
- **CSS as files.** Page and shared CSS move to `.css` files bundled by esbuild. `getDeckardThemeCss` becomes a `Record<DeckardTheme, string>` lookup instead of a 373-line ladder; `getPageTailCss` takes `{ theme, zen }` as input rather than reading settings.
- **Domain out of page script.** The graph's clustering and salience (`buildCommunities`, `selectSalientEdges`), the widget catalog, calendar arithmetic, board status validation, tag-key parsing, and the Help manifest interpreter become typed modules, host-side where the host is the owner (widgets, validation, Help authorization) and shared typed modules where the page must compute locally (the graph, date stepping). Click handlers become one `dispatchAction` over a `Record<string, handler>`.
- **Host-side HTML.** The previews (`src/ui/preview/*`) and the debug page share one `escapeHtml` in `src/shared/html.ts`, so eight copies become one with one escape set. `rendering.ts` is retired rather than moved: with Preact, the pages render from data, and the Markdown in a card or a title reaches them as a token tree, not as HTML (§2.7).

### 2.7 What ships: the dependency surface

> **Amended by [0015](../architecture/decisions/0015-note-markdown-tokenized-by-markdown-it.md) (2026-10-01).** The token tree is mapped from `markdown-it`'s own tokens, so `markdown-it` stays as a parser; `sanitize-html` still goes.

`vsce package --no-dependencies` and `.vscodeignore` mean no `node_modules` file reaches the VSIX; esbuild inlines whatever the source imports. What ships today is therefore three direct dependencies and their 21 transitive packages (`htmlparser2`, `postcss`, `entities`, `linkify-it`, `argparse`, `dayjs`, …), all inlined into `dist/extension.js` (2.7 MB), all running in the extension host with file-system and network access. The webview pages ship no third-party code at all. Reducing that surface is a goal of this refactor alongside the structural ones, because third-party code in the host is the largest attack surface the extension has, and the one an update to Deckard can shrink.

| Dependency | Where it runs | What for | Target |
| --- | --- | --- | --- |
| `markdown-it` (7 packages inlined) | Host: `rendering.ts` renders note excerpts and task titles to HTML for the pages; `guide.ts` renders `docs/guide/*.md` for Help; `preview/*` only *type* it, since VS Code's preview passes its own instance to `extendMarkdownIt` | Card excerpts, titles, Help | **Removed.** |
| `sanitize-html` (about 12 packages inlined, including `postcss` and `htmlparser2`) | Host: the second boundary after `markdown-it`, since note content is untrusted and lands in a scripted page | Same two sites | **Removed.** Done in Phase 6 step 6 ([20-webviews.md](20-webviews.md), step 6): with the 15 packages it brought, it took 200,563 bytes off the production `dist/extension.js`, now 969,343. |
| `picomatch` (1 package) | Host: `scanner.ts:655` matches `deckard.exclude` globs | Excluding folders from the index | **Removed if Node's `path.matchesGlob` proves equivalent** (below). |
| `preact` (1 package, 0 transitive) | Webview sandbox only: no file system, no network, `postMessage` to the host | Page rendering | **Added.** The one third-party runtime left, in the lower-privilege context. |

How each removal works:

- **Note Markdown becomes a token tree, and the page renders it.** Deckard already owns a full Markdown block parser (`core/markdown/parser.ts`) and an inline-range scanner for code and links (`inlineRanges.ts`). A small `domain/markdown/inline.ts` extends that to the inline subset the pages display: `strong`, `em`, `del`, `code`, `[[wiki links]]`, `[text](url)` with `http`, `https`, and `mailto` only, and plain text. It produces `InlineToken[]`, which travels in the snapshot where `renderedTitle` and `renderedHtml` travel today, and a `<Inline tokens>` Preact component draws it as elements and text nodes. Nothing is ever parsed as HTML, so there is nothing to sanitize: the boundary is structural rather than a filter. Block excerpts on cards (`renderMarkdown`) render the same way from the parser's existing block structure (paragraphs, headings, list items, fenced code, blockquotes), which is the set `rendering.ts` allows today. Behavior preservation is checked by rendering the sample workspace's every card both ways in Phase 0 and diffing the visible text; the visual suite covers the rest.
- **Help renders the guide through VS Code's own engine.** `docs/guide/*.md` is Deckard's own trusted content shipped in the VSIX, so `sanitize-html` guards nothing there. The `markdown.api.render` command exposed by VS Code's built-in `markdown-language-features` extension renders Markdown to HTML with the engine the user already trusts for every preview, at no shipped cost. (The alternative, if that command proves unsuitable, is rendering the guide at build time into `dist/guide/*.html`, which also ships no parser.) Confirmed in Phase 0.
- **The preview plugins import types only.** `queryBlocks.ts`, `queryBlockHtml.ts`, and `noteEmbeds.ts` receive VS Code's `markdown-it` instance and need only `import type MarkdownIt`; `@types/markdown-it` is already a dev dependency. Their own `escapeHtml` becomes the shared one.
- **`picomatch` → `path.matchesGlob`.** Node has shipped `path.matchesGlob` since 22.5; VS Code 1.134's Electron carries Node 22 or later (the exact version is read from `process.versions.node` in the extension host in Phase 0). The scanner passes `{ dot: true }`, and `matchesGlob` takes no options, so the existing exclude tests (`workspace.test.ts`, the sample's `deckard.exclude`) decide whether the semantics match; if any pattern behaves differently, `picomatch` stays and is the one host-side dependency left.

The result, if all three hold: the host bundle contains no third-party code, and the extension's only shipped dependency is Preact, inside the webview sandbox. The lockfile still pins exact versions and CI still runs `npm ci` and `npm audit`, since the build-time tree (esbuild, TypeScript, the test tools) remains and can be attacked too, but nothing in it reaches a user's machine.

### 2.5 Return early, enforced

- **ESLint rules.** These become errors: `no-else-return` (`allowElseIf: false`), `no-lonely-if`, `max-depth: 3`, `@typescript-eslint/max-params: 4` in place of the core rule, since it ignores an explicit `this` (so `findTasks`'s nine positional parameters and `createInlineSection`'s nine take option objects), `no-nested-ternary`, `no-case-declarations`, `@typescript-eslint/no-unused-vars`, `@typescript-eslint/switch-exhaustiveness-check` (which needs `parserOptions.projectService: true`, the flat-config way to give typescript-eslint type information). `eslint-plugin-unicorn` is added for two rules only: `prefer-early-return`, which rewrites a trailing `if (cond) { rest }` into a guard, and its fixable `no-negated-condition`; it requires ESLint ≥ 10.4 and Node ≥ 22, both met. `complexity: 15` (`variant: 'modified'`, so a `switch` counts once) and `max-lines-per-function: 80` (`skipBlankLines`, `skipComments`) start as errors for new code only; a per-file override lists the functions still over the limit (`activate`, `rewriteTag`, `rankRelatedNotes`, `createWidget`, `tokenize`, `createCondition`, `parseRecurrence`, `readPhrase`, `refresh`, `prune`, and the page scripts) and the list shrinks as each phase lands. `lint` keeps `--max-warnings 0`, so a rule is switched on for a folder in the same change that makes that folder pass, and `test/` and `scripts/` are linted too.
- **Versions.** TypeScript stays on 6.0.x and typescript-eslint on 8.7x. TypeScript 7 ships no programmatic API, so typescript-eslint and TypeDoc cannot run on it; the toolchain waits for both to support it.
- **A formatter.** Prettier (or ESLint's stylistic `indent`) runs in `lint`, so the mis-indented block in `parser.ts` and its kind cannot recur.
- **`tsconfig.json`.** `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, and `noImplicitOverride` are switched on in Phase 0: none is implied by `strict`, none changed in TypeScript 6, and each is mechanical. They catch the dead branch or orphaned parameter a return-early rewrite leaves behind, and change no runtime behavior. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are worth having but each can surface hundreds of errors, so each is its own pass after Phase 7, not part of this plan.
- **The pattern.** Guard clauses first, then the one path that does the work. Loops use `continue` rather than wrapping the body in `if`. An `if/else if` ladder that picks a value becomes a lookup table (`KEYWORD_TYPES`, `DAYS_PER_UNIT`, `GROUP_CONTEXT_VALUES`, `MODES`) or a function that returns from each branch (`describeDueDate`, `spanOf`, `readField`). A chain of regex readers tried in order (`parseRecurrence`, `readPhrase`, `tokenize`) becomes a list of `{ pattern, read }` entries. A string sentinel such as `'unreadable'` becomes a discriminated union.

### 2.6 Tests that match the layers

- **A fast tier.** `npm run test:unit` runs plain mocha over the suites whose modules import no `vscode` (67 files today, more after Phase 2), in seconds instead of minutes, and `pretest` runs it first. `dependency-cruiser` decides which modules qualify. `npm test` keeps the host-only suites.
- **One DOM.** The hand-written `webviewRuntime.js` DOM and `mountTagOverview` are retired for jsdom, which is already a devDependency; each mount owns its window, so no suite shares globals. The eight e2e files run under mocha with one `test/e2e/support.js` for the memento stub and panel mounting.
- **One module catalog and one page catalog.** `test/harness/modules.js` names each `out/` module once; `src/test/pages.ts` renders each page once, importable by mocha and by `test/ui/pages.js`. The 13 source-text assertions are rewritten to drive the page as each page moves; the graph's clustering becomes an importable module first, which its own test asks for.
- **Host-controller tests.** Each `PageController` is tested against a fake `Webview` exposing only `postMessage` and `onDidReceiveMessage`, as GitLens and Cosmos DB do.
- **CI that compares.** A Linux visual baseline set is recorded on the CI image and committed; `checkVisual.js` gains a `--ci` flag that fails when a surface had to be recorded rather than compared. `release.yml` calls the CI validate job as a reusable workflow instead of running `npm test` alone. `pretest` compiles once.

## 3. Comments and doc blocks

The standard, added to [CONTRIBUTING.md](../CONTRIBUTING.md):

- **Every exported function, class, method, and type gets a doc block.** So does every non-trivial private function. It states the contract: what the function is for, what it returns when there is nothing, what it refuses, and the reason it exists when that is not obvious. `@param` and `@returns` are required only when the name and type do not already say it. A doc block that restates the signature is worse than none.
- **Inline comments say why, never what.** They are written for a constraint, a trade-off, a workaround, a bug they prevent, or a decision that looks wrong but is not: "The page may hold a snapshot from before a tag was renamed, so the key is resolved again." A comment that narrates the next line is deleted. The subsystem to imitate is `ui/commands` tasks and daily notes, at 90% coverage with reasons throughout.
- **A doc block sits directly above what it documents.** Nothing is inserted between a block and its declaration; a constant that needs to sit above a function gets its own one-line block and goes above the function's block. The 28 stranded blocks in the findings are reattached in the phase that touches their file.
- **A comment moves with its code.** When a refactor splits or moves a function, its doc block and comments go with it, and are rewritten if the reason changed. The prose line comments on `activate()`'s closures become the doc blocks of the functions they turn into.
- **Enforcement.** `eslint-plugin-jsdoc` 65 (ESLint 10 is in its peer range) runs from its `flat/recommended-tsdoc` config, which TypeDoc reads without complaint, with `require-jsdoc` configured as `publicOnly: { ancestorsOnly: true }`, `require: { ClassDeclaration, MethodDefinition, FunctionDeclaration, ArrowFunctionExpression }`, and `contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration']`, so exports, class methods (including `dispose` and `provide*`), and exported types all need a block; plus `check-param-names`, `require-param` with `ignoreWhenAllParamsMissing: true` (a block with no `@param` at all is allowed, since the name and type usually say it; a block that documents some parameters must document them all), `no-undefined-types`, `no-blank-blocks`, and `informative-docs`, which rejects a block that only repeats the name. A stranded block is caught indirectly: the function below it is then undocumented. Whether a doc block explains why can only be checked by a person, so the review guide gains a line for it.
- **Coverage rises with the refactor, not in a separate pass.** Each phase documents what it moves or creates, so comments are written by the change that knows why the code is shaped that way. Phase 7 sweeps what is left, starting with the subsystems at 50%: the webview hosts, the providers and views, and the test harnesses.

## 4. How Deckard is built: an architecture section on the site

`deckard.esperinnovations.com` is built by `.github/workflows/docs.yml` from `docs/guide` alone. Nothing public explains the design; `docs/components.md` and `CONTRIBUTING.md` describe the template-literal build this plan replaces, and the reasoning that exists is scattered through plans written before their code.

A new **Architecture** section is added to the same site, for contributors:

1. **Hand-written pages in `docs/architecture/`.** Each describes how the code works now, not how it was planned, and is kept current in the same change as the code, as Help and the guide are:
   - `README.md`: the index, and the one-page overview.
   - `layers.md`: the layers and the dependency rule of §2.1, and what goes where.
   - `indexing.md`: scan, parse, incremental `IndexState`, the cache fingerprint, the search-store worker, and publishing to views.
   - `services.md`: the service catalog, what each owns, and the adapter pattern of §2.2.
   - `webviews.md`: the host base class, page controllers, the protocol, bundling, theming, and the CSP.
   - `preferences.md`: the repository, the schema, migrations, and pruning.
   - `testing.md`: the suites, what each alone can catch, and when to run them.
   - `decisions/`: short architecture decision records, one per choice that could reasonably have gone the other way (§7).
2. **Diagrams in Mermaid.** A ```` ```mermaid ```` fence renders on GitHub as written. The `github-pages` gem set that `jekyll-build-pages` runs has no Mermaid plugin and allows no others, so the site layout (`docs/site/_layouts/default.html`) loads Mermaid 12 as a module script and calls `mermaid.run({ querySelector: '.language-mermaid' })`, which is the class kramdown gives the fence; a `mermaid: true` front-matter flag gates the script to the pages that need it. Every diagram is backed by prose.
3. **A generated API reference.** TypeDoc (0.28, on TypeScript 6.0.x) runs over `src/services` and `src/domain` in the docs workflow *after* the `jekyll-build-pages` step, writing straight into `_site/api/` with `--hostedBaseUrl`, so Jekyll never sees its output and its underscore-prefixed files are never dropped. (TypeDoc's own `.nojekyll` only matters when Pages builds from a branch.) It is built from the doc blocks of §3, so documented contracts are what readers see, and limited to the stable surface.
4. **A generated dependency graph.** `dependency-cruiser` 18 renders the module graph at layer level (`--output-type archi`, with `collapsePattern` set to `^(src/[^/]+)`) through `dot -T svg` for `layers.md`, so the picture comes from the same rules lint enforces and cannot drift from the code; the CI runner needs `graphviz` installed for that step, and the `mermaid` reporter is appended to `$GITHUB_STEP_SUMMARY` on each run. Rules that gate CI are `severity: error`, because the exit code counts only those.
5. **Wiring.** The section is a separate folder, not guide pages: `guide.test.ts` requires every `docs/guide/*.md` to be registered in `GUIDE_PAGES` and shipped in the VSIX, and architecture pages belong in neither. `docs.yml` stages `docs/architecture/**` beside the guide and gains its path trigger; `_config.yml` gains a "How Deckard is built" nav group; the site header links **Guide** and **Architecture**; `CONTRIBUTING.md` points there, and `docs/components.md` is rewritten to describe the bundle model.

The section is written in Phase 0 as a description of the target, marked as such, and each phase rewrites the pages it affects to describe what now exists.

## 5. Phases

Each phase is one branch off `dev` and one pull request, sized against `origin/master`. Within a phase, every commit passes `npm run check-types && npm run lint`. The full set (`npm test`, `test:ui`, `test:e2e`, `test:layout`, `test:visual`) runs once at the end, and the phase lands only on a clean run with no pixel changes: a visual diff means behavior changed, and that is a bug in the refactor. Each phase works its slice of [19-refactor-findings.md](19-refactor-findings.md) and strikes the items it closes.

| # | Phase | Contents | Risk |
| --- | --- | --- | --- |
| 0 | **Guardrails, harnesses, and inventories** | The four inventories of §1.8, written before anything moves: the manifest cross-reference, the persisted-format list with its version markers and pinning tests, the import-graph baseline, and the docs and scripts that cite `src/` paths. `tsconfig` flags; ESLint rules of §2.5 and §3 in override-list form; a formatter; `dependency-cruiser` with today's graph as the baseline and the target rules as errors for new files; `test:unit`; the page loader, the CSP-carrying `srcdoc` parent, and the jsdom e2e mount (§2.6); the module and page catalogs; the Linux visual baseline and the release gate; `docs/architecture/` skeleton and site wiring; the comment standard in CONTRIBUTING. | Low |
| 1 | **Shared helpers, the model split, and the wrong-way imports** | One home each for the helpers in §1.4 (`lineShapes.ts` for the task-line and heading rules, `frontmatter.ts` for the bounds, `calendar.ts`, `paths.ts`, `text.ts`, `html.ts`, `Debouncer`, `showQuickPickUntilHidden`, `readParseOptions`), keeping each caller's exact acceptance where the copies disagree. `core/types.ts` → `domain/model/*` and `ui/protocol/*`. `buildWorkspaceIndex`, `isTaskColumnId`, the pure `dailyNote` and `rollover` helpers, `createEntryScope`, `panelPriority`, and the query view-state types each move to their layer; the preview plugins' `markdown-it` imports become type-only, and `picomatch` is swapped for `path.matchesGlob` if the Phase 0 check passed; `queryDates.ts` breaks the parser–evaluator cycle. Re-exports keep old paths compiling until the end of the phase. | Low: mechanical |
| 2 | **Ports and context** | `ports/` and `platform/`; the scanner and indexer take `FileSystem` and `Configuration`, and the indexer's `EventEmitter`s and `withProgress` leave core; `PreferencesStore` sits on a `KeyValueStore`; `SearchStore` takes a path. `QueryContext` replaces the four setters; `WriteHistory` replaces the two write singletons; `Clock` replaces the `Date.now()` defaults; the remaining globals of §1.3 get owners. After this, the indexer, scanner, preferences, evaluator, and ranking tests run under `test:unit`. | Medium: every evaluator call site |
| 3 | **Split `PreferencesStore` and `WorkspaceIndexer`** | `PreferencesRepository`, a pure `preferencesSchema` (with `oneOf` and `upsertById` replacing the hand-written ladders and twins), and the services of §1.2 with `PreferencesMaintenance.prune(index)`. `IndexService`, a `ChangeWatcher` in `platform/` with a pure `reactionsTo(affects)` decision table, and a `ViewPublisher`; one `collectAssociationEvidence` walker for both association paths. Facades keep the old surfaces for one phase. | Medium: persisted data. The schema tests gate it, plus a round-trip test over a captured real blob and the index-equivalence suite. |
| 4 | **Services out of commands, views, and `ui/state`** | One feature per commit, worst first: tags (rename, merge, hygiene), parking, rollover, tasks (`updateLine`, toggle, steps, move, the board's `captureIntoColumn`), agenda (the tree's writes, `listOverdueTasks`, the reschedule context), links (maintenance, health, mentions, extract heading), capture, review, templates, pins, quick find's action table, the assistant tool table shared by the MCP server and the LM tools, and the export service. Ranking engines and task rules move to `domain/`. Providers move to `ui/providers` and stop registering themselves in constructors. Each commit adds service unit tests for the logic it moves. | Medium, but incremental |
| 5 | **Registration and the composition root** | `createServices(context)`; `register(context, services)` per feature in `ui/commands/<feature>/`, with the settings toggles table-driven; constructors take options objects; `extension.ts` becomes the composition root; `deactivate()` relies on subscriptions. | Low once Phase 4 is done |
| 6 | **Webviews** | (a) `WebviewHost`, `PageController`, `sharedHandlers`, `ActiveSource<T>`, and `NavigationService` on the host, one page per commit, starting with Stats. (b) The protocol modules and the validator table; `messages.ts` retired page by page. (c) The esbuild browser build, the DOM `tsconfig`, the shared layer as modules, and `asWebviewUri` loading with the CSP helper on every page, measured first on Stats. (d) Each page rewritten as Preact components under `src/webview/<page>/`, in size order: Help, Stats, Calendar (as two entries over a shared grid), Task Board, Search, Related Notes, Dashboard, Notes Graph (its clustering as a tested module first); shared components (`Inline`, task rows, cards, the query editor, facets, menus) in `src/webview/shared/`. (e) CSS to files, inert initial state, `retainContextWhenHidden` dropped where §2.4 says, `calendarDay` as a component, and the source-text assertions rewritten as each page moves. (f) The dependency removals of §2.7: the inline token tree replaces `renderedHtml` and `renderedTitle` in the snapshots as each page moves; Help switches to `markdown.api.render`; `markdown-it` and `sanitize-html` leave `package.json` when the last page lands. Its own sub-plan is written before it starts. | High: the largest phase, and a rewrite of the page markup rather than a move |
| 7 | **Sweep** | Remaining return-early fixes and over-limit functions until the override lists of Phase 0 are empty; the doc-block sweep to full coverage of exports, starting with the 50% subsystems; the 28 stranded blocks reattached; the re-export shims deleted; `docs/components.md` and the architecture pages checked against the code. | Low |

Phases 1–3 unblock everything else. Phase 4 can run feature by feature alongside Phase 6(a–b). Phase 6(c–e) waits for 6(b), because pages need the protocol types to compile against.

## 6. What is not changing

- **No behavior changes, no settings changes, no new features.** Nothing about how anything looks changes either, which `test:visual` enforces, now on CI as well.
- **Each caller's exact acceptance where duplicates disagree.** Merging nine task-line regexes into one `matchTaskLine` keeps named options for the differences (`allowIndent`, `requireWords`, whether `[>]` counts) so that no note is parsed differently afterwards. The same holds for the six front-matter checks and the `...` closing line.
- **The persisted preferences format.** Phase 3 moves the code that reads and writes it; the blob on disk and its migrations stay byte-compatible.
- **The index cache format.** A code move does not bump the parse-format fingerprint.
- **The test harnesses' contract.** Each page is driven as one self-contained HTML string by `{ type: 'state', data }` and an ambient `acquireVsCodeApi`; the loader of §2.4 is what keeps that true.
- **Writes that deliberately bypass Deckard's undo history** (`replaceSectionWithLink`, `moveInlineTagsToFrontmatter`, `linkCurrentHeading`) keep doing so; the findings mark them.
- **How Markdown looks in a card or title.** Replacing `markdown-it` with the token tree of §2.7 must render the same visible text and the same inline emphasis for every card in the sample workspace; the comparison in Phase 0 is the gate, and the visual suite is the second one.
- **No UI framework beyond Preact, and no `preact/compat`.** React (69 kB across three packages; the Azure extensions use it for Fluent UI and data grids, which Deckard does not need), Svelte (an 18.6 kB runtime and a 23-package compiler tree), and `lit-html` (one package, but no component model) were considered; §7 records why Preact.

## 7. Decisions recorded

Each becomes a record in `docs/architecture/decisions/`:

1. **Load page bundles through `asWebviewUri`, not inline.** The official guide names external files as the best practice, every surveyed extension does it, and the harness cost is one loader. Inlining was the earlier draft's choice and is kept only as the loader's implementation detail for tests.
2. **Preact 10 in the light DOM over `lit-html`, Lit components, Svelte, or React.** Shipped code decided it: one package, no transitive dependencies, 4.6 kB per page, inside the webview sandbox. `lit-html` would have been a smaller change (the templates move as they are) but has no component model; Svelte ships a larger runtime and a 23-package compiler tree; React ships fifteen times the code for ecosystem features Deckard does not use. Written against Preact's own API with no `preact/compat`, so a future move to React is a rename the compiler drives.
3. **No `@vscode-elements/elements`.** Alive, but shadow-DOM components against Deckard's own themes.
4. **Hand-written message narrowing, one table, no validation library.** None of the surveyed extensions validate at the host boundary with a library; the earlier draft's `valibot` is dropped.
5. **Inert JSON for initial state**, never JSON interpolated into a script.
6. **`retainContextWhenHidden` only where live editing state exists**, with the stale refresh kept everywhere.
7. **A fast unit tier under plain mocha**, gated by the dependency rules, beside the extension-host suites.
8. **Docs as a separate folder staged by the docs workflow**, not guide pages, because the guide ships in the VSIX.
9. **Constructor injection into a plain `Services` object, no DI container and no static locator** (§2.2); result objects for refusals as Deckard's own convention, with one command wrapper for cancellation and unexpected errors.
10. **Feature modules run with `Promise.allSettled`**, after the services are already in `context.subscriptions`, so one broken feature is logged and the rest activate.
11. **The host bundle ships no third-party code** (§2.7). Note Markdown becomes a token tree rendered by the page, Help renders through VS Code's own Markdown engine, the preview plugins import only types, and `picomatch` gives way to `path.matchesGlob` if the exclude tests agree. The shipped dependency surface goes from three packages plus 21 transitive in the extension host to one package in the webview sandbox.

## 8. Open questions

1. **Formatter:** Prettier, or ESLint's stylistic rules alone. Prettier is the smaller decision surface; the stylistic rules keep one tool.
2. **The TypeDoc reference:** public on the site, or built in CI only as a check that doc blocks parse.
3. **Bundle granularity for the four query-editor pages:** one shared `components` bundle loaded beside each page bundle, or the shared layer duplicated into each page bundle (esbuild's code splitting is ESM-only, so an `iife` build cannot share a chunk automatically). The first is smaller on disk; the second is one request per page. Decided when Phase 6(c) measures both on Stats and Search.
4. **Two Phase 0 checks decide the last of §2.7:** whether `markdown.api.render` is available from the extension host and renders the guide acceptably (else build-time rendering), and whether `path.matchesGlob` on the extension host's Node matches `picomatch` on every exclude pattern the tests hold (else `picomatch` stays).
5. **Whether the block excerpt renderer needs more than the parser already knows.** Cards show short excerpts; if a construct the old `renderMarkdown` allowed (nested lists, `hr`) is missing from the token tree in the Phase 0 comparison, it is added there, not by keeping `markdown-it`.
