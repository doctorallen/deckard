# Services and adapters

**Status: target.** This page describes the design of [the refactor plan](../implementation/19-refactor.md), not the code as it stands; each phase rewrites it to describe what then exists.

## The problem this solves

Today the decisions live in the routing. `activate()` in [`src/extension.ts`](../../src/extension.ts) runs from line 187 to 1294 and registers all 102 commands. Webview message handlers are long `switch` chains that decide inline: `DashboardPanel.handleValidMessage` covers 40 message types in 250 lines. Command files such as `renameTag.ts` and `parking.ts` hold the domain rules and the user-facing text in one function of 60 to 170 lines. The same rule is written in several places, and the copies disagree: which index entity makes an `openSource` line openable has three different answers across four hosts.

The fix is one split, applied everywhere. A service decides. An adapter asks and reports.

## What a service is

A service owns one capability. It is a class with three properties:

- It takes its collaborators in its constructor: ports, other services, and an index reader.
- Its methods take plain arguments and return result objects. It never calls `vscode.window`.
- It can be unit-tested without the extension host.

## The service catalog

| Service | What it owns |
| --- | --- |
| `TagService` | Renaming, merging, and tag hygiene, including the rewrite that `rewriteTag` does today |
| `ParkingService` | Which notes can be parked or unparked, and why the others cannot |
| `RolloverService` | Carrying unfinished tasks forward, as `applyRollover` does today |
| `TaskService` | Every task edit: update a line, toggle, steps, move, and the board's capture into a column. A `TaskRankKeeper` collaborator carries a task's rank |
| `AgendaService` | The agenda's writes, `listOverdueTasks`, and the reschedule context |
| `LinkService` | Link maintenance, link health, mentions, and extracting a heading. In [`src/services/linkService.ts`](../../src/services/linkService.ts): `LinkService` plans the rewrites a note rename or a heading rename carries along (`planNoteRenames`, `planHeadingRename`) and the links a note's mentions become (`planMentionLinks`), each checked against the notes as they stand now; `LinkNoteService` makes the note a link names (`createNoteNamed`, `createMissingNotes`) and takes a heading out into one (`extractHeading`), whose swap of the section for its link still bypasses the write history. The pure rewrite and problem rules are in `src/domain/links` |
| `CaptureService` | Capture into a note |
| `SavedSearchService` | Saved searches |
| `PinService` | Pinned notes |
| `ExportService` | Exporting results, as `services.export.fromSearch(query)` |
| `NavigationService` | `resolveSourceLocation(index, filePath, line)`: one rule for what `openSource` and `openTag` may open, with page policy as an option |
| `IndexService` | The index lifecycle, warm start, and fold; see [indexing.md](indexing.md) |
| `ConfigurationService` | Building the `QueryContext` that replaces the query and task-policy setters |
| `WriteHistory` | Every write Deckard makes, each returning a handle with `undo()` |
| `PreferencesMaintenance` | `prune(index)`; see [preferences.md](preferences.md) |

Phase 4 also moves review, templates, quick find's action table, and the assistant tool table into services. The assistant table is shared by the MCP server and the language-model tools, whose refusal strings have already drifted apart today.

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

Two existing files are the models. `insertLink.ts` is one pure builder and one thin adapter. `taskSteps.ts` has `StepList`, a class that models a QuickPick's state so the prompt is only wiring. It replaces the seven mutable `let`s of `askForCapture`.

## Result objects

A service method returns a discriminated union, for example `{ kind: 'refused', reason: 'already-parked', paths }` or `{ kind: 'stale' }`. Every outcome is then a value that a unit test can assert, and the adapter turns it into words.

None of the surveyed extensions does this. Foam returns or throws, Dendron returns `undefined` for cancellation, and GitLens and VS Code's git extension throw typed errors. Deckard keeps result objects for refusals and borrows the wrapper those two use.

## `runCommand`

Every command is registered through one `runCommand(id, handler)`. It swallows `vscode.CancellationError` silently, logs any unexpected exception, and shows one generic message. So no handler needs its own `try`, and every command fails the same way.

## Composition

`extension.ts` becomes the composition root, with three steps:

1. `createServices(context)` builds the ports and services once, into a plain `Services` object.
2. Each feature's `register(context, services)` runs.
3. Every disposable goes to `context.subscriptions`, which disposes of them all.

The services are pushed into `context.subscriptions` before any feature runs. A feature that throws therefore cannot leave a watcher alive. The features are one ordered array of `(context, services) => void | Promise<void>`, run with `Promise.allSettled`. A failed feature is logged, and the rest still activate. This is Foam's pattern; Markdown All in One and the git extension do the same.

There is no dependency-injection container and no static locator. GitLens's `Container.instance` and Dendron's `ExtensionProvider` both carry comments working around a static locator. Decorator containers such as `tsyringe` and `inversify` need `reflect-metadata` and `emitDecoratorMetadata`, which esbuild does not support without a Babel shim. A plain object built once is enough, and it is what lets services run under the fast test tier.

Everything still registers in `activate()`. Since VS Code 1.74, contributed commands need no `onCommand` events, and the index already builds in the background.

`activeServices`, the `ExtensionServices` interface, and the hand-written `deactivate()` list go away. Today the service list is written four times, and the copies disagree: `deactivate()` omits `notesGraph`.

## Replacing hidden state

Module-level `let`s stood in for injection, and pure functions read them. Four test suites reset them in teardown, and one forgotten reset leaked into unrelated suites. Each now has an owner, and a suite builds its own.

| Was | Now held by |
| --- | --- |
| `setQueryIdentity`, `setQueryWeekStart`, `setTaskPolicy` | A `QueryContext { identity, weekStart, taskPolicy, now }` that each view, command, and tool reads with `readQueryContext` when it starts its work, and passes to `evaluateQuery`, `resolveDateRange`, `needsNewDate`, `readLineStatus`, and `describeDueDate` |
| `timing.log` | Still a module sink in `core/timing.ts`, since a log has no answer to give back. `activate()` sets it with `setTimingLog`, and the disposable that returns clears it on deactivation |
| `keepTaskRank` | The `keepRank` of the `TaskWrites` that `activate()` makes and hands to every task edit: `updateTaskLine` and its Undo, Move to, and Toggle Task Done |
| `workspaceWrites`, `ownWrites` | One `WorkspaceWriteHistory`, core's `WriteHistory` with VS Code's edits, made in `activate()` and handed to every command, view, and page that writes, and to Undo Last Change. Its `write()` returns a `WriteHandle`, whose `isLatest()` and `offerUndo()` replace each command's `lastWrite` comparison; its `ownWrites` goes to the indexer's options |
| `focusedIn` | A `SectionFocus` made in `activate()`, whose `focus()` and `unfoldAll()` are the two commands |
| `previewTheme` | A `ThemePreview` made in `activate()` and handed to Choose Theme… and every page host. A host reads `getDeckardTheme(preview)` when it builds its HTML and redraws through `onDidChangePageChrome(listener, preview)` |
| `activeServices` | Unchanged until Phase 5, when `context.subscriptions` owns every disposable |
| `lastSource` | A parser from `createSourceParser()` per Markdown engine, made in `addNoteEmbedRenderer`, and one per `findEmbedProblems` call |
| `linkNamesByPath` | A map each `rankRelatedNotes` call makes and hands down |
| `entityKinds` | A memo each `IndexState` holds, handed on to the state built to replace it |
| `tagPatterns` | A read-only table of one pattern per people marker, compiled when the parser loads |
| `segmenter` | A module constant |
| `Date.now()` defaults | A required `now`, read once where a view, command, or tool starts its work and passed down, as `taskLineDecorations.ts` does |

The `WeakMap` caches keyed by a `WorkspaceIndex` snapshot stay. They memoize per snapshot, so they cannot outlive the data they describe.
