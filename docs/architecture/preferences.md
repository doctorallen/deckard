# Preferences

**Status: current and target.** The first part of this page describes preferences as they work at v1.23.1. The last part describes what [the refactor plan](../implementation/19-refactor.md) changes; each phase rewrites this page to describe what then exists.

Preferences are what Deckard remembers that is not in the notes: favorites, pins, saved searches, view counts, task order, Home widgets, and layout choices. Deckard never writes this state into a Markdown file. It lives in VS Code's `Memento` storage.

## Where it lives today

[`src/core/storage/preferences.ts`](../../src/core/storage/preferences.ts) holds `PreferencesStore`, 1,834 lines. It does persistence, normalization, migrations, every setter, the tag-rename cascade, and pruning. [`preferenceSnapshots.ts`](../../src/core/storage/preferenceSnapshots.ts) keeps rolling copies, and [`src/ui/commands/preferenceBackups.ts`](../../src/ui/commands/preferenceBackups.ts) exports and imports them.

## Two stores, one blob

The store reads and writes one `PersistedPreferences` blob, at `version: 1`, split across two mementos under the key `deckard.preferences`.

| Memento | What it holds | Why |
| --- | --- | --- |
| `workspaceState` | The keys that name workspace content: favorites, access counts and times, task order, saved filters, recent queries, pins, Home widgets, and the Dashboard view state | These keys mean something only in the workspace whose notes they name |
| `globalState` | A whole copy of the blob | Presentation choices such as sort modes, column counts, and page sizes are machine-wide. The whole copy is what an older Deckard reads, and it seeds a workspace whose own storage VS Code cleaned up |

Until 1.19 everything was machine-wide and pruned against whichever window last built an index. Opening any folder with a README deleted the favorites and pins of the notes workspace, because that folder's index did not contain them. The split fixed that. With no folder open, the store uses the machine-wide blob alone.

Every write goes through one promise queue, so two changes land in the order they were made. A change fires `onDidChange`, which every page that follows preferences hears. A visit is recorded quietly and fires only `onDidRecordVisit`, because a visit on every note switch would otherwise redraw every page.

## The schema

The schema is the function `normalizePreferences`. Every read and every update passes through it. It rebuilds a valid blob from anything: a stale sort mode falls back to its default, and duplicate ids and bad counts are dropped. So old or hand-edited state cannot reach a view in a shape it does not expect. An imported file goes through the same function.

## Migrations

Three migrations are written into the store today:

| Migration | Since | How it runs |
| --- | --- | --- |
| Workspace scoping | 1.19 | The first workspace opened after the upgrade adopts the machine-wide content, and `deckard.preferences.workspaceScoped` records the handover. Later workspaces start clean |
| Widened ids | 1.23 | Before pruning, `carryLegacyIds` renames task and section ids from before 1.23 to the entry's id now, so task order and view counts survive |
| Rendered by default | 1.22 | Source mode is kept only when `renderModeChosen` says the reader chose it since Rendered became the default. Everyone else is switched to Rendered once |

The first runs once, at the first start in a workspace. The second runs with each prune, and the third inside `normalizePreferences`. The blob's `version` has stayed 1 throughout.

## Pruning

Pruning is a garbage collection of what Deckard derived. After each index update, a housekeeping view calls `prune` with the tags, tasks, sections, entities, and files that exist. It removes counts, orders, and times for entries that no longer exist, and it updates when each tag was first seen. Before that, `carrySectionAccess` moves a heading's view count to its new id when a line above it changed.

Three rules keep pruning from destroying data:

- **Only against an authoritative index.** Nothing is pruned while the index still shows the cache's notes unchecked, since a note missing from them may only be unread. An index holding nothing is not evidence that everything was deleted: it is what a window with no folder reports, which is the state VS Code is in while a VSIX installs.
- **Only derived data.** A favorite, a pin, a saved search, and a Home widget were chosen on purpose, so pruning never removes one. `findStale` lists those whose target is gone, and the Tidy command asks the reader.
- **Only when something changed.** Every index update prunes, and it rarely removes anything. Writing anyway would make every view that follows preferences refresh twice.

## Copies and export

Deckard once had a bug that emptied favorites, pins, and view counts, and the data came back only because it could be reconstructed. So `PreferenceSnapshots` writes a copy into the workspace's storage under `preference-snapshots/` each time preferences change, two seconds after a burst settles, and keeps the last 20. `Deckard: Restore Favorites, Pins, and Searches` offers them. Export writes the blob as JSON with `version: 1`.

## What the plan changes

The blob on disk and its migrations stay byte-compatible. Phase 3 moves the code that reads and writes it, and nothing else.

| Phase | Change |
| --- | --- |
| 1 | `preferences.ts` stops importing `isTaskColumnId` from `ui/state/resultTable`, a `core` to `ui` import. |
| 2 | The store sits on a `KeyValueStore` port instead of `vscode.Memento`, and its `EventEmitter` leaves core. Its tests then run under `test:unit`. |
| 3 | `PreferencesStore` splits into a repository, a pure schema, and services. |

The Phase 3 split:

- **`PreferencesRepository`** owns persistence: the two mementos, the write queue, and the handover between them.
- **`preferencesSchema`** is pure. Two helpers, `oneOf` and `upsertById`, replace the hand-written ladders and twins.
- **Services** take the capabilities out of the store: favorites, usage tracking, task order and board layout, Home widgets, pins, saved searches, the tag-rename cascade, and display settings. See [services.md](services.md).
- **`PreferencesMaintenance.prune(index)`** takes the index itself rather than five key lists.

A facade keeps the old `PreferencesStore` surface working for one phase. The schema tests gate the split, with a round-trip test over a captured real blob and the index-equivalence suite. The formats and their pinning tests are listed in [inventories/persisted-formats.md](inventories/persisted-formats.md).
