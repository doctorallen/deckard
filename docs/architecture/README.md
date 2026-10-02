# How Deckard is built

**Status: current.** This section describes the code as it stands after the last phase of [the refactor plan](../implementation/19-refactor.md). Where a page describes the code as it was before, it says so.

This section is for contributors. The [guide](../guide/README.md) explains how to use Deckard. These pages explain how it works and why it is shaped that way.

## Where the code runs

Deckard's code runs in four places. Each has different powers, so each is held to different rules.

| Place | What runs there | What it can reach |
| --- | --- | --- |
| Extension host | `dist/extension.js`: activation, commands, editor providers, tree views, the index, preferences, and the hosts of every page | The file system, the network, and the whole VS Code API |
| Webview sandbox | The pages: Home, the Search page, the Task Board, Related Notes, the Calendar, Stats, the Notes Graph, and Help | Nothing but `postMessage` to its host |
| Search-store worker | `dist/searchStoreWorker.js`, a Node worker thread that writes the full-text cache | One SQLite file, and no VS Code API |
| Markdown preview | The plugins VS Code's preview loads through `markdown.markdownItPlugins`, for query blocks and embeds | The `markdown-it` instance the preview hands it |

The extension host is shared with every other extension. Slow work there delays completions, hovers, and other extensions, so the index publishes in small turns and bulk writes go to the worker.

## The parts

**The index.** A scanner reads the Markdown files under the notes folder and parses each one. `IndexState` folds each note's contribution into lookup maps for tags, tasks, sections, and entities. An edit recomputes only the notes that changed. A SQLite cache keeps the parsed notes between sessions, so a warm start shows them before reading any file. See [indexing.md](indexing.md).

**Preferences.** Favorites, pins, saved searches, view counts, and layout choices live in VS Code's `Memento` storage, never in the notes. What names workspace content is kept per workspace; presentation choices are machine-wide. See [preferences.md](preferences.md).

**The pages.** Each page is a webview. The host builds a snapshot of what the page shows and posts it; the page draws it and posts back what the reader did. See [webviews.md](webviews.md).

**The host code.** Pure rules live in `domain`, the index and the stores in `core`, application logic in `services`, VS Code calls behind `ports` in `platform`, and thin adapters in `ui`. The dependency rule points one way, and lint enforces it. See [layers.md](layers.md) and [services.md](services.md).

**Tests.** Seven suites, each catching something the others cannot. See [testing.md](testing.md).

## Where it started

At v1.23.1 the code was disciplined line by line but badly placed. `activate()` in [`src/extension.ts`](../../src/extension.ts) built about 45 objects and registered 102 commands. Domain logic lived in `src/ui/state`, and `src/core` imported both `vscode` and `ui`. Each page was one template literal with its script inlined. The plan moved the code into the layers above in eight behavior-preserving phases, and no user-visible change shipped with it.

## Pages in this section

| Page | What it covers |
| --- | --- |
| [layers.md](layers.md) | The layers, the one-way dependency rule, what goes where, and how lint enforces it |
| [indexing.md](indexing.md) | Scan, parse, incremental `IndexState`, the cache fingerprint, the search-store worker, and publishing to views |
| [services.md](services.md) | The service catalog, the adapter pattern, result objects, `runCommand`, and composition |
| [webviews.md](webviews.md) | The host base class, page controllers, the typed protocol, bundling, the CSP, theming, and what ships |
| [preferences.md](preferences.md) | The repository, the schema, migrations, and pruning |
| [testing.md](testing.md) | The suites, what each alone can catch, and when to run each |
| [decisions/README.md](decisions/README.md) | Architecture decision records: the choices that could have gone the other way |

## Inventories

Phase 0 records four inventories before any code moves. Each lists something the refactor must keep working.

| Inventory | What it lists |
| --- | --- |
| [inventories/manifest.md](inventories/manifest.md) | `package.json` cross-referenced with the source: commands, settings, context keys, activation events, and command ids re-entered through `executeCommand` |
| [inventories/persisted-formats.md](inventories/persisted-formats.md) | Every format an upgrade in place must keep reading, its version marker, and the test that pins it |
| [inventories/import-graph.md](inventories/import-graph.md) | The dependency-cruiser baseline: today's import graph and its known violations |
| [inventories/source-paths.md](inventories/source-paths.md) | The docs and scripts that cite `src/` paths, which a layer move can make stale |
