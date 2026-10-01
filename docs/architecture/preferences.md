# Preferences

**Status: current and target.** The first part of this page describes preferences as they work after Phase 4 of [the refactor plan](../implementation/19-refactor.md). The last part describes what the plan still changes; each phase rewrites this page to describe what then exists.

Preferences are what Deckard remembers that is not in the notes: favorites, pins, saved searches, view counts, task order, Home widgets, and layout choices. Deckard never writes this state into a Markdown file. It lives in VS Code's `Memento` storage.

## Where it lives

Phase 3 split the one 1,834-line `PreferencesStore` into a repository, a pure schema, and a service per capability, all in [`src/core/storage`](../../src/core/storage):

| File | What it holds |
| --- | --- |
| `preferencesSchema.ts` | The format, and nothing that reads storage or the clock: `normalizePreferences` and every normalizer, the defaults and limits, the Home widget kinds and their option rules, the migrations that run on read and `carryLegacyIds`, `pinKey` and the Find helpers, the workspace's 18 keys and the split that picks and omits them, and the helpers `oneOf`, `upsertById`, `toggled`, `bumped`, and `filterNumericRecord` |
| `preferencesRepository.ts` | `PreferencesRepository`: the two `KeyValueStore`s, the read at construction, the seed from the machine-wide store and the handover flag, the write queue, and the change and visit events. `PreferencesReader` is its read-only surface: `value`, `onDidChange`, and `onDidRecordVisit` |
| `preferencesFavorites.ts` | `FavoritesService`: favorite tags and entities, and the custom order of each |
| `preferencesUsage.ts` | `UsageService`: tag, entity, and section access, carried view counts, Find choices, recent headings |
| `preferencesTaskLayout.ts` | `TaskLayoutService`: the rank order, the task sort, and the Task Board's layout, grouping, and table |
| `preferencesHomeWidgets.ts` | `HomeWidgetsService`: Home's widgets and the Dashboard's view state |
| `preferencesPins.ts` | `PinsService`: the notes pinned to Home |
| `preferencesSavedSearches.ts` | `SavedSearchesService`: saved searches and recent searches |
| `preferencesDisplay.ts` | `DisplayService`: sort modes, column counts, render mode, page sizes, and the Related Notes options |
| `preferencesTagRenames.ts` | `TagRenames`: the cascade that moves what a renamed tag held to its new key |
| `preferencesMaintenance.ts` | `PreferencesMaintenance`: pruning against the index, the stale-choice check, and restoring a blob |
| `preferences.ts` | `PreferenceServices`, the set a caller picks its services from, and the schema's helpers and the maintenance types, re-exported where callers have always imported them |

Each service is a small class over the repository. It reads the blob as it stands and makes each change with one `update`, as the store's method did. `PreferencesStore`, the facade that held them all through Phase 3, was deleted in Phase 4. [`preferenceSnapshots.ts`](../../src/core/storage/preferenceSnapshots.ts) keeps rolling copies, and [`src/ui/commands/preferenceBackups.ts`](../../src/ui/commands/preferenceBackups.ts) exports and imports them.

## Who receives what

`createServices` in [`src/composition/services.ts`](../../src/composition/services.ts) makes the repository and each service once, in the order the facade did, and calls `initialize()` at once, so the seed and the handover land when they always did. Each caller is handed only what it uses, typed as `Pick<PreferenceServices, ...>` or as a narrow interface over one service:

| Caller | Receives |
| --- | --- |
| Home (`DashboardPanel`) | `reader`, `favorites`, `usage`, `homeWidgets`, `pins`, `savedSearches`, `display`, `tagRenames` |
| The search pages (`SearchPanels`, `SearchPanel`) | `reader`, `usage`, `savedSearches`, `display`, `pins`, `homeWidgets`, `tagRenames` |
| Related Notes (`SidebarNotesView`) | `reader`, `display`, `usage`, `tagRenames` |
| Stats | `reader`, `usage` |
| The Task Board | `reader`, `taskLayout`, `savedSearches`, `homeWidgets`, `usage` |
| Find (`QuickFind`) | `reader`, `favorites`, `usage`, `savedSearches`, `pins`; its row actions `favorites` and `savedSearches` |
| Move to…, from the editor, Find, the Task Board, and the Tasks view | `reader` and `usage` |
| The Tasks view (`AgendaTreeProvider`) | `reader` and `taskLayout` |
| Note visits | `reader` and `usage` |
| The pinned-entry context key | `reader` and `pins` |
| Pin and Unpin, Note Actions, and `PinService` | `PinsService` |
| A tag rename or merge, and `TagService` | `TagRenames` |
| `CaptureService` | `UsageService`, for the recent headings |
| Tidy | `PreferencesMaintenance` |
| Export, Import, and Restore | `reader` and `maintenance` |
| The destination picker, Capture, Insert Query Block, the reviews, `[[` completion, and the rolling copies | the reader's `value`, and the copies `onDidChange` |
| The prune after each index update and after start | `UsageService.carrySectionAccess` and `PreferencesMaintenance.prune` |

`PreferenceServices.reader` is the repository itself, typed as `PreferencesReader`, so a reader cannot write. The suites and harnesses build the same set with `createPreferences` in `src/test/preferenceServices.ts`.

## Two stores, one blob

The store reads and writes one `PersistedPreferences` blob, at `version: 1`, split across two mementos under the key `deckard.preferences`.

| Memento | What it holds | Why |
| --- | --- | --- |
| `workspaceState` | The keys that name workspace content: favorites, access counts and times, task order, saved filters, recent queries, pins, Home widgets, and the Dashboard view state | These keys mean something only in the workspace whose notes they name |
| `globalState` | A whole copy of the blob | Presentation choices such as sort modes, column counts, and page sizes are machine-wide. The whole copy is what an older Deckard reads, and it seeds a workspace whose own storage VS Code cleaned up |

Until 1.19 everything was machine-wide and pruned against whichever window last built an index. Opening any folder with a README deleted the favorites and pins of the notes workspace, because that folder's index did not contain them. The split fixed that. With no folder open, the store uses the machine-wide blob alone.

`PreferencesRepository` does the reading and writing. Every write goes through one promise queue, so two changes land in the order they were made. A change fires `onDidChange`, which every page that follows preferences hears. A visit is recorded quietly and fires only `onDidRecordVisit`, because a visit on every note switch would otherwise redraw every page.

## The schema

The schema is the function `normalizePreferences` in `preferencesSchema.ts`. Every read and every update passes through it. It rebuilds a valid blob from anything, section by section and always in the same key order: a stale sort mode falls back to its default, and duplicate ids and bad counts are dropped. So old or hand-edited state cannot reach a view in a shape it does not expect. An imported file goes through the same function.

Each enum field is read with `oneOf(value, allowed, fallback)`. Two are conditional: Source is kept only with `renderModeChosen`, and a tag grouping only with a namespace. View counts, access times, and first-seen times are one `filterNumericRecord` with three predicates: whole numbers from zero, positive times, and times from zero, where 0 means known before times were kept. Home's widgets are read one at a time: the shared rules take the id, width, count, page, and look-back days, and a table of per-kind rules takes the options only one kind has, such as a tasks widget's search or a saved-search widget's filter, which it cannot do without.

## Migrations

Three migrations are written into the code:

| Migration | Since | How it runs |
| --- | --- | --- |
| Workspace scoping | 1.19 | The first workspace opened after the upgrade adopts the machine-wide content, and `deckard.preferences.workspaceScoped` records the handover. Later workspaces start clean |
| Widened ids | 1.23 | Before pruning, `carryLegacyIds` renames task and section ids from before 1.23 to the entry's id now, so task order and view counts survive |
| Rendered by default | 1.22 | Source mode is kept only when `renderModeChosen` says the reader chose it since Rendered became the default. Everyone else is switched to Rendered once |

The first runs once, at the first start in a workspace, in `PreferencesRepository`. The second runs with each prune, in `PreferencesMaintenance`, and the third inside `normalizePreferences`. Reading also drops the removed Dashboard tabs, drops retired keys, gives Home its default widgets when a blob has none, and reads a pin written as a path as a pin on the whole note. The blob's `version` has stayed 1 throughout.

`src/test/preferences-roundtrip.test.ts` pins the format byte for byte. A made-up blob with every field set to something other than its default must read back as itself and write back the same JSON to both stores. Each legacy shape a migration reads is loaded the same way. A walk over every mutator records which store each write reaches, in what order, a digest of its bytes, and which event follows. Its expectations were taken before the split.

## Pruning

Pruning is a garbage collection of what Deckard derived. After each index update, a housekeeping view calls `PreferencesMaintenance.prune(index)` with the index snapshot, and the prune after start does the same. It reads the keys of the snapshot's tags, tasks, sections, entities, and files. `pruneKeys` takes the key lists by name for a caller without an index. It removes counts, orders, and times for entries that no longer exist, and it updates when each tag was first seen. Before that, `carrySectionAccess` moves a heading's view count to its new id when a line above it changed.

Three rules keep pruning from destroying data:

- **Only against an authoritative index.** Nothing is pruned while the index still shows the cache's notes unchecked, since a note missing from them may only be unread. An index holding nothing is not evidence that everything was deleted: it is what a window with no folder reports, which is the state VS Code is in while a VSIX installs.
- **Only derived data.** A favorite, a pin, a saved search, and a Home widget were chosen on purpose, so pruning never removes one. `findStale` lists those whose target is gone, and the Tidy command asks the reader.
- **Only when something changed.** Every index update prunes, and it rarely removes anything. Writing anyway would make every view that follows preferences refresh twice.

## Copies and export

Deckard once had a bug that emptied favorites, pins, and view counts, and the data came back only because it could be reconstructed. So `PreferenceSnapshots` writes a copy into the workspace's storage under `preference-snapshots/` each time preferences change, two seconds after a burst settles, and keeps the last 20. `Deckard: Restore Favorites, Pins, and Searches` offers them. Export writes the blob as JSON with `version: 1`.

## What the plan changes

The blob on disk and its migrations stay byte-compatible. Phase 3 moved the code that reads and writes it, and Phase 4 its callers, and nothing else.

| Phase | Change |
| --- | --- |
| 1 | `preferences.ts` stopped importing `isTaskColumnId` from `ui/state/resultTable`, a `core` to `ui` import. |
| 2 | The store sits on a `KeyValueStore` port instead of `vscode.Memento`, and its `EventEmitter` left core. Its tests run under `test:unit`. |
| 3 | Done: `PreferencesStore` split into a repository, a pure schema, services, and `PreferencesMaintenance.prune(index)`, with the store kept as a facade. |
| 4 | Done: callers take the services they use, and `PreferencesStore` is deleted. |

The facade kept the old surface working for one phase, so no caller changed in Phase 3; Phase 4 ported the round-trip test to drive the repository and services with the same inputs and the same expected values. The round-trip test, `preferences.test.ts`, `preferences-prune.test.ts`, and `preferences-invariants.test.ts` gate the split; `preferences-schema.test.ts` covers the schema's helpers and `preferences-maintenance.test.ts` the prune by snapshot. The formats and their pinning tests are listed in [inventories/persisted-formats.md](inventories/persisted-formats.md).
