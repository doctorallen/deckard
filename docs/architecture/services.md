# Services and adapters

**Status: current.** This page describes the services and adapters as they stand after the last phase of [the refactor plan](../implementation/19-refactor.md).

## The problem this solves

The decisions lived in the routing. Until Phase 5, `activate()` in [`src/extension.ts`](../../src/extension.ts) ran from line 187 to 1294 and registered all 102 commands. Webview message handlers are long `switch` chains that decide inline: `DashboardPanel.handleValidMessage` covers 40 message types in 250 lines. Command files such as `renameTag.ts` and `parking.ts` hold the domain rules and the user-facing text in one function of 60 to 170 lines. The same rule is written in several places, and the copies disagree: which index entity makes an `openSource` line openable has three different answers across four hosts.

The fix is one split, applied everywhere. A service decides. An adapter asks and reports.

## What a service is

A service owns one capability. It is a class with three properties:

- It takes its collaborators in its constructor: ports, other services, and an index reader.
- Its methods take plain arguments and return result objects. It never calls `vscode.window`.
- It can be unit-tested without the extension host.

## The service catalog

| Service | What it owns |
| --- | --- |
| `TagService` | Renaming and merging a tag, in [`src/services/tagService.ts`](../../src/services/tagService.ts). `rewrite()` plans the edits against the index with `domain/markdown/tagRename`, checks each note it touches against its text now, opening only those, writes them as one write, and moves the tag's preferences through the `TagRenames` it is handed; it returns `refused`, `confirm-merge` (with the `merge()` to run once the reader confirms), `stale`, `unopened`, `not-found`, `rejected`, `unchanged`, or `written`. Rename Tag and Merge Tags ask, confirm, and word the result. Tag hygiene is the pure `domain/ranking/tagHygiene.ts` |
| `ParkingService` | Which notes, folders, and tags can be parked or unparked, and why the others cannot, in [`src/services/parkingService.ts`](../../src/services/parkingService.ts). `parkNotes`, `unparkNotes`, `parkFolder`, `unparkFolder`, `parkTag`, and `unparkTag` each return a result the command words; a single note's three refusals stay apart, and a result that waits on the reader carries the step that follows (`removeTag()`, `parkInstead()`), and a settings write its `undo()`. The pure rules are `domain/index/parkingRules` and `domain/index/excludeKeys` |
| `RolloverService` | Carrying unfinished tasks forward, in [`src/services/rolloverService.ts`](../../src/services/rolloverService.ts). `rollForward()` plans from the index with `domain/notes/rolloverPlan`, creates today's note only when there is something to carry, writes, and reads the notes again, returning `nothing-waiting`, `not-applied`, `nothing-carried`, or `carried`; `apply()` carries one plan. What goes and what changes in the notes it came from is the pure `planCarriedTasks` in `domain/notes/carryForward`; where the lines land in today's note is capture's rule, handed in as `place` |
| `ReviewService` | Writing a week's or a month's review into its note, in [`src/services/reviewService.ts`](../../src/services/reviewService.ts). `write()` works out the days (the period's, or those a week note's name holds, from `domain/notes/reviewPeriods`, whose `parsePeriodicNoteName` reads each name Deckard has written from a table), the period it looks ahead at, and whether the note needs writing, and returns `unchanged`, `not-applied`, or `written`. The review's summary, Markdown, and marker rewrite are still `ui/state/reviewState`, handed in as `report` |
| `TemplateService` | Making a note from a template, in [`src/services/templateService.ts`](../../src/services/templateService.ts). `createNote()` fills the template with `domain/notes/templates` at the clock's moment and writes the note through the `FileSystem` port, never over one already there, returning `exists` or `created` with whether Deckard indexes where it went. New Note from Template keeps the prompts |
| `TaskService` | Every edit to a task line, in [`src/services/taskService.ts`](../../src/services/taskService.ts): `updateLine` and `toggle` return `updated`, `unchanged`, `missing`, `stale`, `rejected`, `unsaved`, or `failed`; `revertLine` is the one Undo that bypasses the write history; `openIndexedTask`, `addSteps`, `completeSteps`, and `toggleLines` (Toggle Task Done). It writes through the `EditApplier` and `HistoryWriter` ports of [`src/ports/editApplier.ts`](../../src/ports/editApplier.ts), and its `TaskRankKeeper` carries a task's rank. It reaches every command and page on the `TaskWrites` that `createServices` makes once |
| `MoveService` | Move to…, in [`src/services/moveService.ts`](../../src/services/moveService.ts): `readTasks` reads indexed tasks as blocks, or says one is `stale`; `move` reads the blocks again, takes them out with a link left behind, puts them in the target or a note it creates, and writes once through the `HistoryWriter`, returning `moved` with the Undo handle, `stale`, or `failed`. A task moved to another note keeps its rank. The command picks and finds the destination and announces the move |
| `AgendaService` | The Tasks view's decisions, in [`src/services/agendaService.ts`](../../src/services/agendaService.ts): `buildView` (groups, badge, and an `unreadable` or `empty` status), `listOverdue`, `rescheduleContext`, `describeSubject`, `moveToGroup` (`no-edit`, or `moved` with the refusals), `setCompleted`, and `setGrouping` (`grouped`, `unchanged`, or `unwritten`). The agenda's view model in `ui/state` is handed to it as a collaborator. The tree draws what it builds; `registerAgendaCommands` in `ui/commands/agendaActions.ts` is the Tasks view's menus |
| `LinkService` | Link maintenance, link health, mentions, and extracting a heading. In [`src/services/linkService.ts`](../../src/services/linkService.ts): `LinkService` plans the rewrites a note rename or a heading rename carries along (`planNoteRenames`, `planHeadingRename`) and the links a note's mentions become (`planMentionLinks`), each checked against the notes as they stand now; `LinkNoteService` makes the note a link names (`createNoteNamed`, `createMissingNotes`) and takes a heading out into one (`extractHeading`), whose swap of the section for its link still bypasses the write history. The pure rewrite and problem rules are in `src/domain/links` |
| `CaptureService` | A new task written into a note other than the one being edited. In [`src/services/captureService.ts`](../../src/services/captureService.ts): `captureToNote(noteUri, line)` and `captureUnderHeading(line, section)` return `added`, `refused`, and, under a heading, `missing-note` or `missing-heading`; the heading is remembered through the preferences' `UsageService` only once the line is in. Add Task writes through it, and the pure [`src/ui/state/addTaskTarget.ts`](../../src/ui/state/addTaskTarget.ts) names the note in its editor's title and Note row. Find's Add row writes its line with the pure `writeCapture` in `src/domain/capture`, from the options `readCaptureOptions` reads once |
| `SavedSearchesService` | Saved searches and recent searches: one of the preference services, in [`src/core/storage/preferencesSavedSearches.ts`](../../src/core/storage/preferencesSavedSearches.ts); see [preferences.md](preferences.md) |
| `PinService` | Pinned notes. In [`src/services/pinService.ts`](../../src/services/pinService.ts): which entry a line of a note pins (`pinFor`), whether it is pinned (`isLinePinned`, which the tag hover reads), and `pin` and `unpin` by line, returning `pinned`, `unpinned`, or `no-entry`. How pins are kept is the preferences' `PinsService`, which it is handed; the pure pin rules are in `src/domain/notes/pins.ts` |
| `ExportService` | Exporting results. In [`src/services/exportService.ts`](../../src/services/exportService.ts): `fromSearch(query, kind)` evaluates the whole search, not the page of it on screen, and `fromResults(kind, results, query)` takes results already found; each returns `nothing`, or the `results` with their count, the text each format makes of them, and the live query block when there is a search. `presentExport` in `ui/commands/exportResults.ts` asks how and where, and copies or saves; the rows and formats are in `src/domain/export`. `createServices` builds one and hands it to the search pages and the Task Board, which pass the results they found to `fromResults` and present the plan with a live block of their own, since the block keeps the page's sort, or the board's layout, sort, and columns |
| `NavigationService` | What a page's `openSource` and `openTag` may open, in [`src/services/navigationService.ts`](../../src/services/navigationService.ts). `resolveSourceLocation(index, filePath, line, policy)` returns `open`, with the entry whose visit it counts, or `unknown`; `resolveTag(index, tagKey, policy)` returns `open` with the key the index holds, or `unknown`. Each page's rule today is a named policy, so no page's acceptance changed: `entries`, `graphNodes`, `tasks`, and `notes` for a line, and `lenient` and `exact` for a tag. The shared `openSource` and `openTag` message handlers in `ui/webview/host/sharedHandlers.ts` are its adapters |
| `IndexService` | The index lifecycle, warm start, and fold. Callers take the roles of the index they use, `IndexReader`, `IndexSearch`, `IndexScanStatus`, `IndexUpdates`, and `IndexControl`, which `createWorkspaceIndex` hands back as one value; see [indexing.md](indexing.md) |
| No `ConfigurationService` | The `QueryContext` that replaced the query and task-policy setters is built by `readQueryContext` in `src/ui/commands/queryContext.ts` from the settings, over the pure `createQueryContext` in `src/domain/query/queryContext.ts`; see [Replacing hidden state](#replacing-hidden-state) |
| `WriteHistory` | Every write Deckard makes, each returning a handle with `undo()`, in [`src/core/workspace/writeHistory.ts`](../../src/core/workspace/writeHistory.ts); `WorkspaceWriteHistory` in `src/ui/commands/workspaceWrites.ts` gives it VS Code's edits |
| `PreferencesMaintenance` | `prune(index)`, `pruneKeys`, the stale-choice check, and restoring a blob; with the other preference services, see [preferences.md](preferences.md) |

Phase 4 also moved review and templates into services, and made quick find's row actions and the assistant tools one table each. The assistant table is shared by the MCP server and the language-model tools, whose refusal strings had drifted apart.

The assistant tool table, `ASSISTANT_TOOLS` in `src/ui/state/assistantTools.ts`, names each of the four tools, reads its input, binds it to what it runs, and carries each surface's refusal text and timing name side by side. `AssistantTools` (the language-model tools) and `DeckardMcpServer` both iterate it, and each only adapts a call to its transport. The language-model side alone keeps the `deckard.assistantTools` guard, the once-a-session confirmation, and the progress messages; the MCP server waits for the first scan and has no guard. The two writes are handed to the table as runners, since they need the editor. The table sits in `ui/state` rather than `services` because it answers through `getQueryBlockSnapshot`, which is still there.

Find's row actions are one table, `ROW_ACTIONS` in [`src/ui/commands/quickFindActions.ts`](../../src/ui/commands/quickFindActions.ts): for each action, whether it needs the row's task, whether it leaves Find open, and what it does, through a `RowActionHost` that holds Find's own opening and showing and the services the writes go to (`PinService`, the favorites and recent searches of the preferences, and the task functions every view writes with). `STAYING_ACTIONS` is read from it, and `QuickFind.runAction` only refuses a task that is gone and runs the entry.

The preferences are services too, one per capability over one `PreferencesRepository`, and since Phase 4 each command, view, and page takes only the ones it uses, picked from `PreferenceServices` in [`src/core/storage/preferences.ts`](../../src/core/storage/preferences.ts). [preferences.md](preferences.md) lists who receives what.

## What an adapter is

A command handler, a message handler, and a tree action are all adapters. Each does exactly three things, in order:

1. Gather input: the arguments, a QuickPick, or an InputBox. Return early on cancel.
2. Call one service method.
3. Present the result: a message, an Undo offer, or a reveal.

An adapter holds no domain decisions. If a handler needs an `if` about the notes, rather than about the reader's answer, that `if` belongs in the service.

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

Two existing files are the models. `insertLink.ts` is one pure builder and one thin adapter. `taskSteps.ts` has `StepList`, a class that models a QuickPick's state so the prompt is only wiring. `CaptureBox` in `captureBox.ts` does the same for Capture, in place of the seven mutable `let`s `askForCapture` once held.

## Result objects

A service method returns a discriminated union, for example `{ kind: 'refused', reason: 'already-parked', paths }` or `{ kind: 'stale' }`. Every outcome is then a value that a unit test can assert, and the adapter turns it into words.

None of the surveyed extensions does this. Foam returns or throws, Dendron returns `undefined` for cancellation, and GitLens and VS Code's git extension throw typed errors. Deckard keeps result objects for refusals and borrows the wrapper those two use.

## `runCommand`

Every command is registered through `registerCommand(id, handler)` in [`src/ui/commands/runCommand.ts`](../../src/ui/commands/runCommand.ts), which registers the handler that `runCommand(id, handler)` wraps. The wrapper does two things:

- A `vscode.CancellationError` is the reader backing out. It is swallowed, and the command returns `undefined`.
- Any other exception is written to Deckard's log as `The command <id> failed: <message>`, through `reportError`, and thrown on unchanged.

It shows no message of its own. The plan called for one generic message, but a command that words a failure already says so itself, and an exception a command lets through has always been reported by VS Code's own notification, or by a rejected `executeCommand` when code ran it. A generic message would be a second message, or a new one, so the wrapper only logs and lets VS Code report as it always has: whatever a command showed before, it shows now, and nothing more. A handler's result passes through as it was: a value at once, a promise as a promise that settles the same way. `run-command.test.ts` holds the three outcomes.

## Composition

`extension.ts` is the composition root, and `activate()` is four lines:

1. `createServices(context)` in [`src/composition/services.ts`](../../src/composition/services.ts) builds every port implementation, store, service, index, provider, view, page host, and status bar once, into one typed `Services` object, and hands every disposable to `context.subscriptions`.
2. `runFeatures(features, context, services)` runs each feature's `register(context, services)`, in the order of [`src/composition/features.ts`](../../src/composition/features.ts).
3. `startServices(services)` starts what reads the notes: Home on startup when the setting asks, the status bar's first draw, and the first index, which prunes the preferences once it is read.
4. It returns `DeckardExports`, the Markdown preview's `extendMarkdownIt`.

`createServices` builds in the order activation always did, because VS Code can see it: which provider registers first, which listener hears an index update first, and which context key is set first all follow from it. Only the command registrations that sat between those steps moved out, to the features. Within one synchronous activation VS Code cannot tell when a command was registered, and its registry is keyed by id.

`Services` holds what a feature, the startup steps, or the exports reach, grouped where that reads naturally: `preferences` (the repository, one service per capability, the snapshots, and Move to…'s pair), `writes` (tasks, tags, parking, rollover, reviews, templates, and Add Task), `links`, `pages` (one host per page), `views` (the sidebar views, the two trees, and the task status bar), and `pageCommands`, the two functions page modules export that commands call, since a command may not import a page host's module. What only lives to be disposed, such as a completion provider or a context key, is owned by `context.subscriptions` alone.

A feature is a `(context, services) => void | Promise<void>` in `src/ui/commands/<feature>/register.ts`, one per capability. There are twenty: nineteen ordered by where each one's first command was registered in `activate()` before Phase 5, and the Hubs view, added after, last:

| Feature | Module | Commands |
| --- | --- | --- |
| Setup and diagnostics | `setup` | Show Log, Check Setup, the Work Sample, Choose Theme…, the walkthrough, Reindex Workspace |
| The Tasks view | `tasksView` | The Tasks view's menus (`registerAgendaCommands`), its grouping, and its search, edited on the Task Board or cleared; Export Tasks as Calendar…, and the calendar file it keeps up to date |
| The Outline and sections | `outline` | Revealing a heading, a heading's tags, Focus Section, Unfold All Sections, the Outline's tag filter |
| Settings toggles | `toggles` | The ten commands in `SETTING_TOGGLES`, one registration loop |
| Preference backups | `preferences` | Tidy, export, import, and restore the preferences |
| Pages | `pages` | Home, Stats, Help and What's new, the Notes Graph and its nodes, the Calendar page, the Task Board, Related Notes for an entry |
| Note Actions | `notes` | Note Actions, the menu of what can be done where the cursor is; Copy as Plain Markdown |
| Daily notes | `dailyNotes` | Today's note, another day's, the day before and after, Roll Tasks Forward |
| Reviews | `reviews` | The weekly and monthly notes, Write Review |
| Task editing | `taskEditing` | Edit Task, Add Task, Break into Steps, Toggle Task Done, Move to… |
| Note templates | `noteTemplates` | New Note from Template, here and anywhere |
| Pins | `pins` | Pin and Unpin |
| Parking and exclusion | `parkingAndExclusion` | Exclude from and Include in the index, park and unpark a note, a folder, or a tag |
| Assistant and MCP | `assistant` | Copy MCP Setup, Reset MCP Token |
| Links | `links` | The notes a link names, Link Mentions, Extract Heading, Link Current Heading, Rename Heading |
| Search pages | `search` | A tag's page, a search page, Insert Query Block |
| Find | `find` | Find in Notes and Find's keys |
| Tag editing | `tagEditing` | Move Tags to Frontmatter, Rename Tag, Merge Tag |
| Undo | `undo` | Undo Last Change |
| The Hubs view | `hubs` | The Hubs tree, and its hub's Open Tag's Page |

`runFeatures` runs each feature synchronously, in its own `try`. One that throws, or whose promise rejects, is written to the log as `Deckard could not register <feature>`, and the rest still register. The plan named `Promise.allSettled`; a loop does the same for features that are all synchronous, and keeps `activate()` synchronous, so every command exists and the exports are returned by the time VS Code counts Deckard active. This is Foam's pattern; Markdown All in One and the git extension do the same.

The ten commands that only turn one setting on and off are rows of `SETTING_TOGGLES` in [`src/ui/commands/toggles/settingToggles.ts`](../../src/ui/commands/toggles/settingToggles.ts): an enable and a disable command, the setting, its two values, and the target it is written to, `where-set`, `outline`, or `zen`. `setting-toggles.test.ts` runs under `test:unit`.

There is no dependency-injection container and no static locator. GitLens's `Container.instance` and Dendron's `ExtensionProvider` both carry comments working around a static locator. Decorator containers such as `tsyringe` and `inversify` need `reflect-metadata` and `emitDecoratorMetadata`, which esbuild does not support without a Babel shim. A plain object built once is enough, and it is what lets services run under the fast test tier.

Everything still registers in `activate()`. Since VS Code 1.74, contributed commands need no `onCommand` events, and the index already builds in the background.

`activeServices`, the `ExtensionServices` interface, and `deactivate()` are gone; `context.subscriptions` releases everything. VS Code runs an extension's `deactivate()`, then disposes its subscriptions in the order they were pushed. The old `deactivate()` disposed 27 services first, in an order of its own, while the log was open, and two of those disposals redraw something: a search page that is the active search releases it, which redraws Related Notes, and Related Notes going hides itself from the active calendar, which redraws the Calendar page. So `createServices` pushes a `DisposalOrder` first and hands it those 27 in that order, which keeps the moment and the order, and each is now disposed once rather than twice.

## Replacing hidden state

Module-level `let`s stood in for injection, and pure functions read them. Four test suites reset them in teardown, and one forgotten reset leaked into unrelated suites. Each now has an owner, and a suite builds its own.

| Was | Now held by |
| --- | --- |
| `setQueryIdentity`, `setQueryWeekStart`, `setTaskPolicy` | A `QueryContext { identity, weekStart, taskPolicy, now }` that each view, command, and tool reads with `readQueryContext` when it starts its work, and passes to `evaluateQuery`, `resolveDateRange`, `needsNewDate`, `readLineStatus`, and `describeDueDate` |
| `timing.log` | Still a module sink in `shared/timing.ts`, since a log has no answer to give back. `createServices` sets it with `setTimingLog`, and the disposable that returns clears it on deactivation |
| `keepTaskRank` | The `keepRank` of the `TaskWrites` that `createServices` makes and hands to every task edit: `updateTaskLine` and its Undo, Move to, and Toggle Task Done |
| `workspaceWrites`, `ownWrites` | One `WorkspaceWriteHistory`, core's `WriteHistory` with VS Code's edits, made in `createServices` and handed to every command, view, and page that writes, and to Undo Last Change. Its `write()` returns a `WriteHandle`, whose `isLatest()` and `offerUndo()` replace each command's `lastWrite` comparison; its `ownWrites` goes to `createWorkspaceIndex`'s options. Writes and Undos take turns, so two asked for at once never read the notes while the other is changing them |
| `focusedIn` | A `SectionFocus` made in `createServices`, whose `focus()` and `unfoldAll()` are the two commands |
| `previewTheme` | A `ThemePreview` made in `createServices` and handed to Choose Theme… and every page host. A host reads the theme and zen with `readPageChrome(preview)` in `ui/webview/host/pageChrome.ts` when it writes its HTML, hands them to the page builder, and redraws through `onDidChangePageChrome(listener, preview)` |
| `activeServices` | Nothing: `context.subscriptions` owns every disposable, and a `DisposalOrder` pushed first keeps the order the old `deactivate()` disposed 27 of them in |
| `lastSource` | A parser from `createSourceParser()` per Markdown engine, made in `addNoteEmbedRenderer`, and one per `findEmbedProblems` call |
| `linkNamesByPath` | A map each `rankRelatedNotes` call makes and hands down |
| `entityKinds` | A memo each `IndexState` holds, handed on to the state built to replace it |
| `tagPatterns` | A read-only table of one pattern per people marker, compiled when the parser loads |
| `segmenter` | A module constant |
| `Date.now()` defaults | A required `now`, read once where a view, command, or tool starts its work and passed down, as `taskLineDecorations.ts` does |

The `WeakMap` caches keyed by a `WorkspaceIndex` snapshot stay. They memoize per snapshot, so they cannot outlive the data they describe.
