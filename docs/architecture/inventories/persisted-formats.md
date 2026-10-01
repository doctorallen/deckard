# Persisted formats

This inventory lists every format Deckard writes and later reads back, so that an upgrade in place keeps reading what the previous release wrote. It names each format, where it is written and read, its version marker, its migrations, and the test that pins it. It was taken at `dev` 1805a01, before Phase 0 of [the refactor plan](../../implementation/19-refactor.md), and every `path:line` below is 1-based at that commit.

## Summary

"Pinned" means a test asserts the stored shape or the literal key. A test that imports a key constant pins behavior, but it keeps passing if the constant's value changes. Test files named without a folder are in `src/test/`.

| # | Format | Store | Version marker | Pinned by |
|---|---|---|---|---|
| 1 | Preferences blob, `deckard.preferences` | `globalState` and `workspaceState` | `version: 1` field, not checked on read | `preferences.test.ts`, `preferences-prune.test.ts`, `pinned-notes.test.ts`; partly |
| 2 | Handover flag, `deckard.preferences.workspaceScoped` | `globalState` | none | `preferences-prune.test.ts` |
| 3 | `deckard.lastSeenVersion` | `globalState` | none | `whats-new.test.ts`, by constant |
| 4 | `deckard.whatsNewPending` | `globalState` | none | `whats-new.test.ts`, by constant |
| 5 | `deckard.openSampleReadme` | `globalState` | none | `sample-workspace.test.ts`, value only |
| 6 | `deckard.lastReminderDate` | `globalState` | none | `task-status-bar.test.ts`, by constant |
| 7 | `deckard.excludeHintShown` | `workspaceState` | none | none yet |
| 8 | `deckard.firstIndexSummaryShown` | `workspaceState` | none | `first-index.test.ts`, by constant |
| 9 | `deckard.tryNext.retired` and `deckard.tryNext.snoozed` | `workspaceState` | none | none yet |
| 10 | `deckard.capture.draft` | `workspaceState` | none | `capture.test.ts`, shape only |
| 11 | Whether any memento key exists (`keys()`) | `globalState` and `workspaceState` | none | none yet |
| 12 | MCP server token, `deckard.mcpServer.token` | `SecretStorage` | none | `mcp-server.test.ts`, value only |
| 13 | SQLite search cache schema, `deckard-search.sqlite` | `storageUri` | `SCHEMA_VERSION = 3` as `PRAGMA user_version` | `search-store.test.ts` |
| 14 | Parse fingerprint, `meta` row `parse` | SQLite cache | the fingerprint is the marker | `search-store.test.ts`, `warm-start.test.ts`; partly |
| 15 | Last scan counts, `meta` row `lastScan` | SQLite cache | none | `search-store.test.ts`, `warm-start.test.ts` |
| 16 | Parsed note encoding, `notes.parsed` | SQLite cache | `FORMAT = 1` as field `v` | `parsed-file-codec.test.ts`; partly |
| 17 | Preference snapshots, `preference-snapshots/*.json` | `storageUri` | the blob's `version: 1` | `preference-backups.test.ts` |
| 18 | Preference export file | a file the reader picks | `deckard.version: 1`, not checked on read | `preference-backups.test.ts` |
| 19 | Sample workspace folder, `deckard-sample` | `globalStorageUri` | none | `sample-workspace.test.ts` |
| 20 | Search page state, view type `deckard.tagOverview` | webview state | none | `search-page-behavior.test.ts`, write only |
| 21 | Task Board state, view type `deckard.taskBoard` | webview state | none | none yet |
| 22 | Dashboard state, view type `deckard.dashboard` | webview state | none | `dashboard-behavior.test.ts`, write only |
| 23 | Notes graph state, view type `deckard.notesGraph` | webview state | none | `notes-graph-behavior.test.ts`, `parked-views.test.ts`; write only |
| 24 | Calendar page state, view type `deckard.calendarPage` | webview state | none | none yet |
| 25 | Entry ids, tag keys, and Find keys stored inside rows 1, 9, and 17 | inside other formats | none | `preferences-prune.test.ts`, `preferences.test.ts`; relative only |
| 26 | Settings Deckard writes | `settings.json` | none | `exclude-folders.test.ts`, `settings.test.ts`; partly |

Deckard calls no `setKeysForSync`, so no memento key travels with Settings Sync. Deckard uses no `logUri`. The `Deckard` output channel (`src/extension.ts:214`) writes a log that Deckard never reads back.

## Out of scope: note syntax

Task metadata, front matter, block ids (`^id`), query blocks, and every other syntax Deckard writes into notes are the user's own content. The parser tests cover how they are read, so this inventory leaves them out. Files Deckard writes and never reads back, such as an exported result list (`src/ui/commands/exportResults.ts:164`), are left out too.

## 1. Preferences blob

- **Key:** `deckard.preferences`, constant at `src/core/storage/preferences.ts:34`.
- **Written:** `persist` at `src/core/storage/preferences.ts:1177`. It writes the whole blob to `globalState` (`:1178`) and the workspace's share to `workspaceState` (`:1179`). The store is built at `src/extension.ts:284`. With no folder open, it gets no `workspaceState` and reads and writes the machine-wide blob alone.
- **Read:** the constructor, `src/core/storage/preferences.ts:244` (`globalState`) and `:250` (`workspaceState`). It lays the workspace share over the machine-wide blob with the workspace keys removed (`:265`).
- **Shape:** `PersistedPreferences` at `src/core/types.ts:377`. The workspace's share is the 18 keys in `workspacePreferenceKeys` (`src/core/storage/preferences.ts:60`). Everything else is presentation and stays machine-wide.
- **Version marker:** `version: 1` (`src/core/types.ts:378`), written by `normalizePreferences` at `src/core/storage/preferences.ts:1206`. The store never reads it. `readExport` reads it to accept a bare snapshot (row 17).
- **Normalization:** every read passes through `normalizePreferences` (`:1189`). It rebuilds the object from known keys, so any key it does not name is dropped on the next write.

| Migration | Where it runs | What it converts | Pinned by |
|---|---|---|---|
| Machine-wide to per-workspace (1.19) | constructor `:255`, `initialize` `:278` | The first workspace opened with no blob of its own adopts the workspace keys of the machine-wide blob, then sets the handover flag (row 2) | `preferences-prune.test.ts:172`, `:194`, `:209`, `:239` |
| Rendered becomes the default | `normalizePreferences` `:1244` | A stored `renderMode: 'markdown'` without `renderModeChosen: true` reads as `'html'` | `preferences.test.ts:99` |
| Dashboard tabs removed | `normalizeDashboardViewState` `:1538` | Any `dashboardViewState.mode` other than `'browse'`, such as `'tasks'` or `'notes'`, reads as `'home'`. The other old view-state fields are dropped | `preferences.test.ts:234`, `:267` |
| Retired keys | `normalizePreferences` `:1189` | `dashboardTaskLayout`, `dashboardNoteSortMode`, and any other unnamed key are dropped | `preferences.test.ts:234`, `:267` |
| Home widgets added | `normalizePreferences` `:1299` | A blob with no `dashboardWidgets` array gets `DEFAULT_DASHBOARD_WIDGETS` (`:153`) | `preferences.test.ts:267` |
| Pins by path | `normalizePinnedNotes` `:1569` | A string pin reads as `{ filePath }` | `pinned-notes.test.ts:109` |
| Ids widened (1.23) | `prune` `:973`, `carryLegacyIds` `:1773` | `taskOrder`, `sectionAccessCounts`, and `sectionAccessTimes` keyed by an old one-hash id move to the new id whose first half it is (`legacyIdOf`, `src/core/markdown/parser.ts:1880`) | `preferences-prune.test.ts:25` |
| First-seen times | `prune` `:1000` | A blob with no `tagFirstSeen` marks every indexed tag as `0`, meaning known before times were kept | `preferences.test.ts:358` |
| Saved filters | `normalizeSavedFilters` `:1647` | Drops filters with no name, fewer than two tags and no query, or a duplicate id or tag set | `preferences.test.ts:467` |

`preferences-invariants.test.ts` walks random operations over the store with in-memory mementos. It pins what operations keep and remove, and that one workspace never reaches another (`:228`). It does not pin a stored shape.

**Pinned since Phase 3:** [`src/test/preferences-roundtrip.test.ts`](../../../src/test/preferences-roundtrip.test.ts) loads a complete blob, with every field set to a non-default value, split across `globalState` and `workspaceState`, and asserts what it normalizes to and the exact bytes written back to each store. It also loads each legacy shape the migrations read (the 1.19 handover, `renderMode` without `renderModeChosen`, the removed Dashboard tabs, retired keys, string pins and headings, one-hash ids from before 1.23, a missing `tagFirstSeen`) and walks every mutator, recording each write's store, key, order, and digest. The blob is made up rather than captured from a release, so a field 1.23.1 writes that the type does not declare would not be caught.

## 2. Handover flag

- **Key:** `deckard.preferences.workspaceScoped`, constant at `src/core/storage/preferences.ts:44`. Boolean.
- **Written:** `src/core/storage/preferences.ts:287`, once, after the first workspace adopts the machine-wide blob.
- **Read:** `src/core/storage/preferences.ts:257`. While it is unset, a workspace with no blob of its own is seeded from the machine-wide one.
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** `preferences-prune.test.ts:239`, which asserts the literal key stays unset in a window with no folder. `:194` pins that a second workspace is not seeded.

The plan names "its workspace-scoped twin". The twin is the `workspaceState` copy of `deckard.preferences` (row 1). This flag is a separate key.

## 3. Last version seen

- **Key:** `deckard.lastSeenVersion`, `LAST_SEEN_VERSION` at `src/ui/commands/whatsNew.ts:23`. A version string such as `1.23.1`.
- **Written:** `src/ui/commands/whatsNew.ts:68` (new install) and `:81` (every activation).
- **Read:** `src/ui/commands/whatsNew.ts:65`.
- **Version marker:** none.
- **Migration:** an existing user with no stored value is read as coming from `FIRST_TRACKED_FROM = '1.22.0'` (`:26`, applied at `:71`).
- **Pinned by:** `whats-new.test.ts:58` asserts the stored value, and `:66` pins the migration. Both use the constant, so the literal key is not pinned. A pinning test would assert the literal `deckard.lastSeenVersion`.

## 4. What's new pending

- **Key:** `deckard.whatsNewPending`, `WHATS_NEW_PENDING` at `src/ui/commands/whatsNew.ts:24`. Shape `{ from: string; to: string }` (`:28`).
- **Written:** `src/ui/commands/whatsNew.ts:77`; cleared at `:103`.
- **Read:** `src/ui/commands/whatsNew.ts:76`, `:86`, `:95`, `:100`.
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** `whats-new.test.ts:87` asserts `{ from: '1.22.0', to: '1.24.0' }`, by constant. A pinning test would assert the literal key.

## 5. Sample README to show

- **Key:** `deckard.openSampleReadme`, `SAMPLE_README_KEY` at `src/ui/commands/sampleWorkspace.ts:19`. The sample folder's URI as a string.
- **Written:** `src/ui/commands/sampleWorkspace.ts:215`; cleared at `:163` before the README opens.
- **Read:** `src/ui/commands/sampleWorkspace.ts:156`, compared with each open folder's URI string in `takeSampleReadme` (`:145`).
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** `sample-workspace.test.ts:354` pins the comparison. No test uses the key.

## 6. Last reminder date

- **Key:** `deckard.lastReminderDate`, `REMINDER_DATE_KEY` at `src/ui/views/taskStatusBar.ts:110`. The local day as `YYYY-MM-DD` (`localDate`, `:101`). It lives in `globalState` (`src/extension.ts:499`), so every window shares it.
- **Written:** `src/ui/views/taskStatusBar.ts:241`, before the reminder is shown.
- **Read:** `src/ui/views/taskStatusBar.ts:237`.
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** `task-status-bar.test.ts:134` asserts `'2026-09-19'` under the constant. A pinning test would assert the literal key.

The plan's list of seven memento keys does not include this one.

## 7. Exclude hint shown

- **Key:** `deckard.excludeHintShown`, `EXCLUDE_HINT_SHOWN` at `src/extension.ts:185`, private to that file. Boolean.
- **Written:** `src/extension.ts:353`, and by `summarizeFirstIndex` through its `excludeHintShownKey` option (`src/ui/commands/firstIndex.ts:108`, passed at `src/extension.ts:343`).
- **Read:** `src/extension.ts:349`.
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** none yet. `first-index.test.ts:65` passes the key `'hint'`. A pinning test would assert that the first index of a large workspace writes the literal `deckard.excludeHintShown`, and that a stored `true` suppresses the hint.

## 8. First index summary shown

- **Key:** `deckard.firstIndexSummaryShown`, `FIRST_INDEX_SUMMARY_SHOWN` at `src/ui/commands/firstIndex.ts:16`. Boolean.
- **Written:** `src/ui/commands/firstIndex.ts:96`, before the message.
- **Read:** `src/ui/commands/firstIndex.ts:92`.
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** `first-index.test.ts:65`, by constant. A pinning test would assert the literal key.

## 9. Try next ledger

- **Keys:** `deckard.tryNext.retired` (`TRY_NEXT_RETIRED`, `src/ui/commands/tryNext.ts:22`), a `string[]` of suggestion keys; `deckard.tryNext.snoozed` (`TRY_NEXT_SNOOZED`, `:23`), a `Record<string, number>` of epoch milliseconds until which each key is put off. Both live in `workspaceState` (`src/extension.ts:207`).
- **Suggestion keys:** `weeklyReview`, `taskBoard`, `pinNote`, and `mergeLookalike:<sourceKey>|<targetKey>` (`src/ui/state/tryNext.ts:58`, `:68`, `:76`, `:84`). The last embeds two tag keys (row 25).
- **Written:** `src/ui/commands/tryNext.ts:47` and `:53`. Callers are `src/extension.ts:962`, `:1026`, `:1058`, and `src/ui/webview/dashboard.ts:399`, `:403`, `:417`.
- **Read:** `src/ui/commands/tryNext.ts:33` and `:37`.
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** none yet. `try-next.test.ts:59` tests `chooseTryNext` with sets and records built in the test, not the ledger. A pinning test would store the literal keys with values in the 1.23.1 shape and assert that `TryNextLedger` reads a retired key as retired and a snooze as active until its time.

The plan's list of seven memento keys does not include these two.

## 10. Capture draft

- **Key:** `deckard.capture.draft`, `DRAFT_KEY` at `src/ui/commands/capture.ts:52`. Shape `{ text: string; target: 'today' | 'heading'; literal: boolean }` (`:46`, `CaptureTarget` at `:18`). It lives in `workspaceState` (`src/extension.ts:501`).
- **Written:** `src/ui/commands/capture.ts:73`; cleared at `:77`.
- **Read:** `src/ui/commands/capture.ts:63`. A draft with blank text or another target is ignored.
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** `capture.test.ts:48` round-trips the shape through a map, but does not use the key. A pinning test would store a literal draft under `deckard.capture.draft` and assert `read` returns it.

The plan's list of seven memento keys does not include this one.

## 11. Whether Deckard ran before

- **Where:** `src/extension.ts:191` and `:193`, at the top of `activate`.
- **What it reads:** `workspaceState.keys().length === 0` means a workspace new to Deckard, which gates the first index summary. `globalState.keys().length > 0 || workspaceState.keys().length > 0` means an existing user, which decides whether What's new treats a missing `deckard.lastSeenVersion` as an update from 1.22.
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** none yet. `whats-new.test.ts` passes `existingUser` directly. A pinning test would activate with empty mementos and with one holding only `deckard.preferences`, and assert both flags. It would also fail if any write moved ahead of these two reads.

## 12. MCP server token

- **Key:** `deckard.mcpServer.token`, `TOKEN_KEY` at `src/ui/commands/mcpServer.ts:42`, in `context.secrets` (`src/extension.ts:405`). 64 hex characters.
- **Written:** `src/ui/commands/mcpServer.ts:151` (first use) and `:158` (reset).
- **Read:** `src/ui/commands/mcpServer.ts:146`.
- **Why it matters:** the token is copied into each client's setup (`getClaudeCodeSetup`, `:56`). A new key name after an upgrade mints a new token and breaks every configured client.
- **Version marker:** none. **Migrations:** none.
- **Pinned by:** `mcp-server.test.ts:157` pins that a new token retires the old one. It does not assert the key. A pinning test would assert that a token stored under the literal key is the one the server accepts.

The plan's list does not include this store.

## 13. SQLite search cache schema

- **File:** `deckard-search.sqlite` in `storageUri` (`src/core/storage/searchStore.ts:111`), opened with `journal_mode = WAL`, so `-wal` and `-shm` files sit beside it. With no `storageUri` the cache is `:memory:` and nothing persists. The store is built at `src/extension.ts:273`. The worker opens the same file (`src/core/storage/searchStoreWorker.ts:52`).
- **Tables:** `notes`, `entries`, the FTS5 table `entries_fts`, the vocabulary table `entries_vocab`, and `meta` (`src/core/storage/searchDatabase.ts:61` to `:90`).
- **Version marker:** `SCHEMA_VERSION = 3` (`src/core/storage/searchDatabase.ts:20`), stored as `PRAGMA user_version`.
- **Migration:** any other `user_version` drops `entries_vocab`, `entries_fts`, `entries`, `notes_fts`, and `notes`, then sets the version (`src/core/storage/searchDatabase.ts:45` to `:53`). The next scan refills it. The `meta` table is not dropped.
- **Pinned by:** `search-store.test.ts:208` builds an older layout by hand and asserts it is replaced. `:232` pins that unchanged notes stay searchable across sessions.
- **Gap:** no test opens a database file written at `SCHEMA_VERSION = 3` by the release. A pinning test would keep such a file, or the SQL that builds it, and assert the current code opens it without dropping it.

## 14. Parse fingerprint

- **Where:** the `meta` row with key `parse`. Read at `src/core/storage/searchDatabase.ts:242`, written at `:249`.
- **Built from:** `getParseFingerprint` (`src/core/workspace/scanner.ts:256`) joins, per workspace folder, `PARSE_FORMAT` (`'code-and-links'`, `src/core/markdown/parser.ts:28`), the folder URI, `deckard.noteBoundaries`, `deckard.parseInlineTags`, `deckard.personMarker`, and `deckard.entityNamespaceAliases`. `cacheFingerprint` (`src/core/workspace/indexer.ts:507`) appends the extension version and the time zone.
- **What invalidates the cache:** a different fingerprint. `readParsedNotes` then reads nothing (`src/core/storage/searchStore.ts:193`), so the start is cold. `replace` then rebuilds the text index and stores the new fingerprint (`src/core/storage/searchStore.ts:142` to `:148`). A drifted text index also rebuilds (`hasDrifted`, `src/core/storage/searchDatabase.ts:259`).
- **Consequence:** the extension version is in the fingerprint, so every release starts cold once and never reads a parsed note written by another version. A warm start happens only in `ExtensionMode.Production` (`src/extension.ts:278`).
- **Pinned by:** `warm-start.test.ts:158` pins that a new version starts cold. `search-store.test.ts:109` pins that a changed fingerprint rebuilds, using strings made up in the test.
- **Gap:** no test pins what goes into the fingerprint. A pinning test would assert that changing each of the four settings, `PARSE_FORMAT`, or the time zone changes `cacheFingerprint`.

## 15. Last scan counts

- **Where:** the `meta` row with key `lastScan`, JSON `{ found, templates, excluded, read }`. Written at `src/core/storage/searchStore.ts:239` (called from `src/core/workspace/indexer.ts:466`), read at `:221`, and only after a warm start matched the fingerprint (`src/core/workspace/indexer.ts:205`).
- **Version marker:** none. Missing fields read as `0`.
- **Pinned by:** `search-store.test.ts:358` round-trips it. `warm-start.test.ts:94` reads it back across a session.

## 16. Parsed note encoding

- **Where:** the `notes.parsed` column. Encoded by `encodeParsedFile` (`src/core/storage/parsedFileCodec.ts:45`), called from `createNoteToWrite` (`src/core/storage/searchDatabase.ts:386`). Decoded by `decodeParsedFile` (`src/core/storage/parsedFileCodec.ts:100`), called from `readParsedNotes` (`src/core/storage/searchStore.ts:206`).
- **Shape:** `{ v, f, fm, s, sm, t, tm }` (`src/core/storage/parsedFileCodec.ts:31`). A section's text is stored as a line range when the lines give it back exactly, a `filePath` equal to the note's is left out, and keys whose value is `undefined` are listed so they come back.
- **Version marker:** `FORMAT = 1` (`src/core/storage/parsedFileCodec.ts:19`), written as `v` and checked at `:103`. The plan says the codec has no version constant. It has this one.
- **Guards:** the `v` check and a shape check throw (`:102` to `:112`). `readParsedNotes` skips a row that throws or whose `filePath` does not match (`src/core/storage/searchStore.ts:204` to `:213`). Above that, the fingerprint (row 14) keeps any row written by another version from being read.
- **Pinned by:** `parsed-file-codec.test.ts:20` pins the round trip, and `:53` pins that `{"v":99}` is refused.
- **Gap:** no test holds encoded text written by the release. A pinning test would keep one encoded note literal and assert it decodes to the same `ParsedFile`.

## 17. Preference snapshots

- **Where:** `storageUri/preference-snapshots/` (`src/core/storage/preferenceSnapshots.ts:44`), created at `src/extension.ts:293`. Nothing is written with no `storageUri`.
- **File name:** the write time as `2026-09-22T19-43-14-277Z.json` (`nameFromDate`, `:131`; `dateFromName`, `:135`). A name that does not parse is ignored when listing (`:68`). The newest `SNAPSHOTS_KEPT = 20` (`:18`) are kept.
- **Body:** the bare preferences blob, pretty-printed (`:113`).
- **Written:** `src/core/storage/preferenceSnapshots.ts:105`, two seconds after each change.
- **Read:** `list` (`:52`) and `read` (`:73`), then `readExport` (`src/ui/commands/preferenceBackups.ts:164`), which accepts a bare blob only when `version === 1` and `favoriteTags` is an array (`:78`). `importPreferences` normalizes it (`src/core/storage/preferences.ts:1169`).
- **Version marker:** the blob's `version: 1`. It is the only place that field is checked.
- **Pinned by:** `preference-backups.test.ts:47` pins the name format, `:54` and `:72` the writing and rotation, `:95` the bare-blob read and `{ version: 2 }` being refused.

## 18. Preference export file

- **Where:** a JSON file the reader chooses, `deckard-preferences.json` by default.
- **Shape:** `{ deckard: { kind: 'preferences', version: 1, exportedAt }, preferences }` (`PreferenceExport`, `src/ui/commands/preferenceBackups.ts:30`).
- **Written:** `createExport` (`:44`) and `exportPreferences` (`:95`).
- **Read:** `readExport` (`:58`) from `importPreferences` (`:111`). It requires `deckard.kind === 'preferences'` and a `preferences` record.
- **Version marker:** `deckard.version: 1` (`:33`, `:49`). `readExport` does not check it.
- **Migrations:** none of its own. The blob is normalized on import (row 1).
- **Pinned by:** `preference-backups.test.ts:95` round-trips an export and refuses junk. `:116` pins that an import is normalized.
- **Gap:** the export is built by today's code in the test. A pinning test would hold an export literal written by the release.

## 19. Sample workspace

- **Where:** `globalStorageUri/deckard-sample` (`SAMPLE_FOLDER_NAME`, `src/ui/commands/sampleWorkspace.ts:17`). `getSampleStorageUri` (`:45`) turns a `vscode-userdata:` URI into a `file:` URI.
- **Written:** `installSample` (`:97`) copies `resources/sample`, resolving date tokens and renaming `dot-vscode` to `.vscode` (`:83`). It refuses to merge onto an existing folder and replaces it only when asked (`:105`).
- **Read back:** the folder is opened as a workspace. Its URI is compared at `src/extension.ts:334` and `:341` to tell the sample apart for the first index summary, and against `deckard.openSampleReadme` (row 5).
- **Version marker:** none. A sample made by an older release stays as it was until the reader replaces it.
- **Pinned by:** `sample-workspace.test.ts:346` (replace, never merge), `:354` (README only in its folder, using the literal `deckard-sample`), `:364` (the `file:` scheme).

## Webview state

VS Code keeps what a page passes to `setState` and hands it back when it restores the panel after a reload, through the serializers registered at `src/extension.ts:892` to `:916`. A page restored after an upgrade receives state written by the old script. Seven panel view types are serialized: `deckard.dashboard`, `deckard.stats`, `deckard.help`, `deckard.notesGraph`, `deckard.calendarPage`, `deckard.taskBoard`, and `deckard.tagOverview`. `stats` and `help` keep no state. The sidebar views `deckard.relatedNotes` and `deckard.calendar` are webview views (`src/extension.ts:631`, `:636`). The sidebar calendar runs the calendar script but never writes state, because its layout control is drawn only on the page (`src/ui/webview/calendarHtml.ts:305`, `:312`).

The ten `getState()` calls the plan counts are `calendarHtml.ts:114`, `:352`; `searchPageHtml.ts:161`, `:552`, `:564`, `:715`; `dashboardHtml.ts:271`; `taskBoardHtml.ts:540`, `:545`; and `notesGraphHtml.ts:295`, all under `src/ui/webview/`. The `getState` option at `components.ts:3617` is a host-state callback, not the VS Code API. The shared scroll helpers `rememberScroll` and `restoreScroll` (`src/ui/webview/components.ts:1769`, `:1780`) merge `scrollY` into a page's state.

No test restores a page from saved state. The harness starts its kept state as `undefined` (`src/test/webviewPage.ts:80`) and has no option to seed it. The tests below pin what a page writes, not what it reads back.

### 20. Search page

- **Shape:** `{ query: string; origin: string; tab?: 'notes' | 'tasks'; scrollY?: number }`.
- **Written:** `saveState`, `src/ui/webview/searchPageHtml.ts:550` to `:560`, and the scroll helper at `:564`.
- **Read by the page:** `tab` at `:161`, `scrollY` at `:715`.
- **Read by the host:** `readSerializedSearch` (`src/ui/webview/searchPage.ts:272` to `:314`), called from `restore` (`:156`).
- **Migration:** a page saved before search pages kept one string is read from `tagKey`, `filterTagKeys`, and `refinement` or `query` (`src/ui/webview/searchPage.ts:287` to `:313`). A page whose tag no longer exists is closed.
- **Pinned by:** `search-page-behavior.test.ts:650` asserts the written `{ query, origin }`. Nothing pins `readSerializedSearch`, including its legacy branch. A pinning test would pass each saved shape, current and legacy, to the serializer and assert the search the page reopens with.

### 21. Task Board

- **Shape:** `{ query: string; scrollY?: number }`.
- **Written:** `src/ui/webview/taskBoardHtml.ts:541` and `:545`.
- **Read by the page:** `scrollY` at `:543`. **Read by the host:** `query` in `restore` (`src/ui/webview/taskBoard.ts:175` to `:180`).
- **Pinned by:** none yet. A pinning test would restore the board with `{ query: 'is:open #project/atlas' }` and assert the query it shows.

### 22. Dashboard

- **Shape:** `{ dashboardMode, tagColumns, browseQuery, tagNamespaceFilter, editingHome, homeHintDismissed }`.
- **Written:** `saveDashboardViewState`, `src/ui/webview/dashboardHtml.ts:376`.
- **Read by the page:** `src/ui/webview/dashboardHtml.ts:271` to `:291`. `dashboardMode` is kept only as `'browse'`, and `tagColumns` only as 1 to 4. `browseQuery` is written but never read back. The host's `restore` (`src/ui/webview/dashboard.ts:221`) ignores the state.
- **Pinned by:** `dashboard-behavior.test.ts:437` asserts `homeHintDismissed` is written. A pinning test would load the page with each field set and assert the mode, columns, namespace filter, arranging state, and hint it draws.

### 23. Notes graph

- **Shape:** the 23 keys of `defaults` (`src/ui/webview/notesGraphHtml.ts:270` to `:294`), such as `showNotes`, `selectedTags`, `group`, `headings`, and `linkDistance`, plus `camera: { x, y, k }`.
- **Written:** `persist`, `src/ui/webview/notesGraphHtml.ts:301`.
- **Read by the page:** `src/ui/webview/notesGraphHtml.ts:295` to `:300`, and the camera at `:354`. Any saved value other than `undefined` is taken as is, with no type check. The host's `restore` (`src/ui/webview/notesGraph.ts:165`) ignores the state.
- **Pinned by:** `notes-graph-behavior.test.ts:250`, `:307`, `:472`, `:513`, `:556` and `parked-views.test.ts:79` assert keys the page writes. A pinning test would load the page with a saved state of every key and assert each control and the camera.

### 24. Calendar page

- **Shape:** `{ layout: 'month' | 'week' }`.
- **Written:** `setLayout`, `src/ui/webview/calendarHtml.ts:352`.
- **Read by the page:** `src/ui/webview/calendarHtml.ts:114`. Anything but `'week'` reads as `'month'`. The host's `restore` (`src/ui/webview/calendarPage.ts:106`) ignores the state.
- **Pinned by:** none yet. A pinning test would load the page with `{ layout: 'week' }` and assert the week layout.

## 25. Keys stored inside other formats

Several formats store Deckard's own identifiers. If a refactor changes how one is made, the stored value stops matching and is pruned or ignored without an error.

| Identifier | Made at | Stored in | Pinned by |
|---|---|---|---|
| Entry ids, `<prefix>-<hash>-<hash>` | `createId`, `src/core/markdown/parser.ts:1862`; inputs at `:1246`, `:1375`, `:1450`, `:1848` | `taskOrder`, `sectionAccessCounts`, `sectionAccessTimes` in row 1 | `preferences-prune.test.ts:25`, relative to the parser's own output only |
| Tag keys, such as `#project/atlas` | the parser | `favoriteTags`, `tagAccessCounts`, `savedFilters`, `tagFirstSeen`, and more in row 1; `mergeLookalike` keys in row 9 | the parser tests |
| Find choice keys, `note:[filePath,heading,occurrence]`, `task:[filePath,label]`, `tag:<key>`, `view:<id>` | `findChoiceKey`, `src/ui/state/quickFindState.ts:474`; `pinKey`, `src/core/storage/preferences.ts:1613` | `findChoices` in row 1; read by `findChoiceFilePath` (`:1341`) | `preferences.test.ts:83` |

No test pins an entry id's value. A pinning test would assert `createId` output for a few fixed inputs, and the id of a heading, a tagged line, and a task in a fixed note. It would catch any change to the text that goes into an id, such as the task-line regex merge of §6 changing `match[4]`.

## 26. Settings Deckard writes

Deckard writes these settings through `writeSetting` (`src/ui/commands/settings.ts:19`) or `configuration.update`, and reads them back. The package.json inventory owns the setting names. This row is about the value shapes Deckard itself writes.

| Setting | Value Deckard writes | Written at |
|---|---|---|
| `deckard.exclude` | `Record<string, boolean>` of escaped folder globs (`withExcludeKey`, `src/ui/commands/excludeFolders.ts:96`) | `src/ui/commands/excludeFolders.ts:172`, `:179`, `:203`; `src/ui/commands/parking.ts:408` |
| `deckard.parked.folders` | the same map shape | `src/ui/commands/parking.ts:417`, `:425`, `:486` |
| `deckard.parked.tags` | `string[]` | `src/ui/commands/parking.ts:547`, `:558`, `:616` |
| `deckard.board.statuses`, `deckard.board.statusNamespace` | `string[]`, `string` | `src/ui/commands/taskBoardActions.ts:70` |
| `deckard.agenda.query` | `string`, or cleared | `src/extension.ts:856`; `src/ui/webview/taskBoard.ts:331`, `:337` |
| `deckard.agenda.groupBy`, `deckard.agenda.groupNamespace` | `string` | `src/ui/views/agendaTree.ts:704`, `:707`, `:714` |
| `deckard.calendar.dayPanel`, `.showWeekends`, `.showRepeats` | `boolean` | `src/extension.ts:829` to `:845`; `src/ui/webview/calendarPage.ts:204`, `:209` |
| `deckard.zenMode` | `boolean`, per folder when set per folder | `src/ui/webview/zenMode.ts:71`, `:77` |
| `deckard.outline.followCursor` | `boolean` | `src/ui/views/outlineTree.ts:397` |
| `deckard.tagOverview.includeHubLinks` | `false` | `src/ui/webview/searchPage.ts:780` |
| `deckard.theme` | `string` | `src/ui/commands/chooseTheme.ts:64` |
| `deckard.mcpServer.enabled` | `true` | `src/ui/commands/mcpServer.ts:176` |
| `deckard.taskReminderTime` | cleared | `src/ui/views/taskStatusBar.ts:332` |

- **Pinned by:** `exclude-folders.test.ts:24`, `:33`, `:46` pin the exclude map and its keys. `settings.test.ts:24` pins that a write goes through. The other shapes are none yet. A pinning test would read each setting as the release writes it and assert Deckard reads the same choice back.

VS Code also stores state under Deckard's identifiers: open panels by view type, view placement by view id, keybindings by command id, and walkthrough progress by `deckard.gettingStarted`. The package.json inventory of §1.8 covers them.

## Differences from the plan's list

- The plan's seven memento keys miss five: `deckard.lastReminderDate`, `deckard.tryNext.retired`, `deckard.tryNext.snoozed`, `deckard.capture.draft`, and the handover flag `deckard.preferences.workspaceScoped` if "twin" means the `workspaceState` copy. The full set is 11 key names in 12 key and scope pairs.
- The plan misses the `SecretStorage` token, the `meta` rows `parse` and `lastScan`, the `keys()` checks at activation, the identifiers stored inside the preferences blob, and the settings Deckard writes.
- `parsedFileCodec` has a version constant, `FORMAT = 1` (`src/core/storage/parsedFileCodec.ts:19`).
- The four settings in the fingerprint are `noteBoundaries`, `parseInlineTags`, `personMarker`, and `entityNamespaceAliases`. The folder URI is in it too.
- `src/test/fixtures/legacyWorkspaceIndex.ts` pins the in-memory index build against the old one (`index-equivalence.test.ts`). It pins no persisted format.

## Existing compatibility risks

- **A parse setting outside the fingerprint.** `deckard.tasks.assigneeFromPersonTag` is a parse option (`src/core/workspace/scanner.ts:450`) that decides a task's assignee (`src/core/markdown/parser.ts:923`). It is not in `getParseFingerprint` (`src/core/workspace/scanner.ts:256`) and does not trigger a reindex (`src/core/workspace/indexer.ts:545` to `:588`). After it changes, unchanged notes keep the old assignee in the index and in the cache until each note is edited or the workspace is reindexed. This is current behavior, so the refactor keeps it; fixing it is a behavior change for a later plan.
- **The `meta` table survives a schema bump.** The drop list at `src/core/storage/searchDatabase.ts:46` leaves `meta` out, and `CREATE TABLE IF NOT EXISTS meta` does not change an existing table. A change to `meta`'s columns needs its own migration.
- **Same-version builds read the release's cache.** The fingerprint uses the version string from package.json. A VSIX built from a refactor branch without a version bump and installed over the release reads the release's parsed notes on a warm start. Only `PARSE_FORMAT` and the codec's `v` guard that case, so a phase that changes a parsed note's shape bumps `PARSE_FORMAT`.
- **The notes graph trusts its saved state.** It copies every saved key without a type check (`src/ui/webview/notesGraphHtml.ts:298`). Renaming a key or changing a value's type lets an old value through to the new script.
- **Two version fields nobody checks.** The store never reads the blob's `version` (row 1), and `readExport` never reads the export's `deckard.version` (row 18). The only check is `version === 1` for a bare snapshot (`src/ui/commands/preferenceBackups.ts:78`), so changing or removing the blob's `version` makes new snapshots unrestorable.
- **New-install detection depends on write order.** `src/extension.ts:191` and `:193` must run before any memento write. A service that moves ahead of them and writes a key at construction turns every new install into an "existing user".
- **Unpinned literals.** Only `deckard.preferences` and `deckard.preferences.workspaceScoped` are asserted as literal strings in tests. Every other key is referenced by constant or not at all, so renaming a constant's value passes the suite and orphans the stored data.

## How to regenerate

Run these from the repository root and check each hit against the rows above.

- Memento access: `grep -rn "globalState\|workspaceState\|Memento\|setKeysForSync" src --include='*.ts' | grep -v '^src/test'`
- Reads and writes through any memento-like object: `grep -rnE "(state|memory|memento|globalState|workspaceState)\s*\.\s*(get|update|keys)" src --include='*.ts' | grep -v '^src/test'`
- Key constants: `grep -rn "= 'deckard\.[a-zA-Z.]*'" src --include='*.ts' | grep -v '^src/test'`
- Secret storage: `grep -rn "secrets" src --include='*.ts' | grep -v '^src/test'`
- Storage locations: `grep -rnE "globalStorage|storageUri|logUri|StoragePath|storagePath" src | grep -v '^src/test'`
- Files written: `grep -rn "fs.writeFile\|writeFileSync\|fs.createDirectory\|appendFile" src --include='*.ts' | grep -v '^src/test'`
- Cache schema and fingerprint: `grep -rn "SCHEMA_VERSION\|user_version\|PARSE_FORMAT\|ParseFingerprint\|cacheFingerprint\|readMeta\|writeMeta" src --include='*.ts'`
- Codec: `grep -n "FORMAT\|v:" src/core/storage/parsedFileCodec.ts`
- Parse options against the fingerprint: `grep -n "getParseOptions" -A 35 src/core/workspace/scanner.ts`
- Preference migrations: `grep -n "legacy\|Legacy\|version\|normalize" src/core/storage/preferences.ts`
- Webview state: `grep -rn "getState\|setState" src/ui --include='*.ts'` and `grep -rn "registerWebviewPanelSerializer\|registerWebviewViewProvider" src/extension.ts`
- Settings written: `grep -rn "writeSetting(\|configuration.update\|\.update('[a-zA-Z.]*'," src --include='*.ts' | grep -v '^src/test'`
- Tests per format: `grep -rln "<key or function>" src/test` for each key, constant, and function named above, then a search for the literal key string to tell a literal pin from a constant.
