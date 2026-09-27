# Piece 10, index level: 10e, 10f, 10g — implementation plan

Written 2026-09-25 against `dev` at `726d23b` (v1.22.0). Read-only pass: nothing
in the repo was changed. Measurements were taken with the researcher's
scripts (`bench*.js`) and new ones in `scratchpad/p10/` (`breakdown.js`,
`graphprof.js`, `cache.js`, `fields.js`) against the compiled `scratchpad/out`
(same source as `726d23b`), on this Mac, Node 26, synthetic workspaces built
by the researcher's seeded generator (5 entries and 6 tasks per note, 600
tags).

---

## 1. Scope

| Item | Verdict after reading the source | Planned as |
| --- | --- | --- |
| **10e (now)** stagger view publishing | **Confirmed.** `emitUpdate()` (`indexer.ts:440-444`) fires one `vscode.EventEmitter`, and every one of **21** `onDidUpdate` subscriptions (not 18: 14 files, `grep onDidUpdate src`) runs in that one host turn. Views already skip work while hidden (`isStale` in dashboard, stats, board, graph, search, calendar, Related Notes), so the cost is the *visible* ones back to back. | Commit 2 |
| **10e (later)** incremental index | **Confirmed.** `flushPending` → `snapshot = undefined` → `getSnapshot()` calls `buildWorkspaceIndex(new Map(this.files))` over every note (`indexer.ts:104-111`). Measured at 5,000 notes: **500–620 ms** per save (plan said 520). Breakdown: per-file loop ~125 ms, association evidence ~150–230 ms, association finalize (map + one global sort with `localeCompare`) ~200 ms, counts ~30 ms. The association pass is ~65% — the plan's "tag-association pass dominates" holds. | Commits 5–6 |
| **10f** skip graph rebuilds; filter on host | **Confirmed, and worse than stated.** The graph clears its snapshot on every update (`notesGraph.ts:68-73`) and posts all of it. Payload 8.1 MB at 1,000 notes and **39.4 MB** at 5,000 (plan: 8.3 / 40). Building it costs **~1.1 s** at 5,000 notes (edge `id` sort with `localeCompare` alone ~300 ms), on top of the post. **Changed:** "filter on host" is narrowed to what the page *hides* — the Show notes / Show tasks toggles (`notesGraphHtml.ts:327-330`). The tag checklist and search box only *dim* (`tagMatchSet`, `matchSet`), and the backbone (`selectSalientEdges`) is driven live by five sliders, so moving either to the host would put a round trip under every drag. Instead the edge `id` (derivable, ~9 MB of the 39) leaves the wire. **Dropped:** posting deltas to the page — `rebuildView` recomputes the whole view from the snapshot anyway, so a delta protocol is a page rewrite for little gain once the skip exists. | Commits 3–4 |
| **10g** warm start | **Confirmed.** `scan()` reads and parses each note in turn (`scanner.ts:101-114`); measured 1,050 ms parse + ~300 ms sequential read+stat at 5,000 notes (86 ms at 8 concurrent). There is already an SQLite store keyed by path, mtime, and size (`searchDatabase.ts` `notes`), but it keeps only search rows. | Commits 7–9 |
| 4e | Belongs to the Piece 4 agent (search sort/paging). Not planned here. | — |

**Found while verifying, out of scope (flag only):** section and task ids are a
32-bit string hash of `path:line:text` (`parser.ts:1804`). At 25,000 sections
the chance that two collide is ~13%, at 30,000 tasks ~19%; a collision makes
one section or task silently vanish from `index.sections` / `index.tasks`
(`Map.set` overwrites). Worth its own `fix:` (a 53-bit hash, or path-prefixed
ids). This plan does not fix it but must stay correct in its presence — see
the fallback in commit 6.

---

## 2. Design

### 2.1 What a user notices

- Saving a note in a 5,000-note workspace no longer freezes VS Code for half a
  second or more while every open Deckard view redraws: the index update drops
  from ~520 ms to a few tens of ms, and views on screen redraw one per host
  turn, the one in front first.
- With the Notes Graph open, a save that changes no link, heading, tag, or
  task (most prose edits inside a line) costs the graph nothing; before, it
  cost ~1.1 s and a 39 MB message at 5,000 notes.
- Unchecking **Show tasks** in the graph sends less than half as much.
- Opening VS Code on a workspace Deckard has seen before shows Home, the
  board, and the Tasks view at once from the last session's notes, then
  quietly rereads only the notes whose size or saved time changed.

No new settings. No new commands. **Deckard: Reindex Workspace** keeps its
meaning ("Reads every note again.") and becomes the escape hatch: it rereads
and reparses every note, ignoring the cache.

### 2.2 Exact strings

Window progress (the status-bar spinner), `indexer.ts`:

| When | Title | Message |
| --- | --- | --- |
| Cold scan (unchanged) | `Deckard: Indexing workspace` | `412/3760 Markdown files` |
| Warm start, checking | `Deckard: Checking notes for changes` | `412/3760 Markdown files` |

Log lines (`timing.ts` `measure`, Debug level; `Slow:` at Info past 100 ms):

| Operation | Detail |
| --- | --- |
| `Build index` (unchanged name, full build) | `5000 notes, 25000 entries` |
| `Update index` (new, incremental) | `1 note changed, 5000 notes` |
| `Refresh views after an index update` (unchanged name; now the synchronous listeners only) | — |
| `Refresh Home after an index update`, `… Task board …`, `… Notes Graph …`, `… Stats …`, `… Calendar …`, `… Related Notes …`, `… search page …`, `… link checks …`, `… query block previews …`, `… tidy of derived counts …` | — |
| `Load notes from cache` | `5000 notes` |
| `Check notes for changes` | `5000 notes, 3 changed, 1 gone` |
| Trace only: `Notes Graph unchanged by this update; not redrawn.` | — |

README, Help, and CHANGELOG wording is in §5.

### 2.3 10e (now): staggered publishing

`WorkspaceIndexer` gains a second subscription kind:

```ts
/** A view that redraws from the index: it runs in a host turn of its own,
 *  the most visible first, after the plain listeners. */
public onDidUpdateView(
  listener: (index: WorkspaceIndex) => void,
  options: { name: string; priority: () => number },
): vscode.Disposable
```

Priorities, read at publish time (so they reflect what is on screen now):
`0` the active editor-area panel (`panel.active`); `1` visible (`panel.visible`
or `webviewView.visible`, open editors for link checks and previews); `2`
hidden (their refresh only sets `isStale`); `3` housekeeping (`preferences.prune`).

`emitUpdate()`:
1. `measure('Refresh views after an index update', () => updateEmitter.fire(snapshot))`
   — the plain listeners, which only store the index or fire a cheap event:
   editorReferences, editorLenses, queryBlocks' index hand-off, pinNote,
   agendaTree (it fires `onDidChangeTreeData`; VS Code pulls later), status bar,
   walkthrough context, the unreadable-note warning, SearchPanels' close-missing-tag check.
2. Build a queue of view subscriptions sorted by `priority()` (stable by
   registration), and drain it one per `setImmediate` turn, each in
   `measure(\`Refresh ${name} after an index update\`)`, each in try/catch →
   `reportError`.
3. A publish while a queue is draining **replaces** the queue (fresh order);
   a view never runs twice for one round, and every pending view reads the
   newest snapshot through `getSnapshot()` anyway.
4. `dispose()` clears the queue.

The scheduler is injectable (`constructor(scanner, store, options?: {
schedule?: (run: () => void) => void })`, default `setImmediate`) for tests.

Moved to `onDidUpdateView`: dashboard, stats, taskBoard, notesGraph, calendar,
sidebarNotes (Related Notes), **each** SearchPanel (per panel, so two search
pages are two turns), linkHealth `checkOpenNotes`, queryBlocks'
`refreshMarkdownPreviews`, and the `preferences.prune` listener in
`extension.ts`. A helper `onIndexUpdateInTurn(indexer, options, listener)` uses
`onDidUpdateView` when the source has it and falls back to `onDidUpdate`, so
the narrow fake indexers in unit and e2e tests (`ReferenceIndexSource`,
`IndexSource`, the e2e fakes) keep working unchanged.

### 2.4 10e (later): incremental index

**Principle: identical by construction.** The index becomes a pure fold over
per-note *contributions*, in the order of the notes map. A full build computes
every contribution and folds; an update recomputes only the changed notes'
contributions and folds again, reusing everything the change cannot touch. The
same code produces both, and a test proves the reuse is sound.

New file `src/core/workspace/indexState.ts`:

- `computeContribution(file: ParsedFile): FileContribution` — pure, per note:
  - `sections`, `tasks` (the parsed objects, by reference);
  - `tagOps`: the exact sequence of `getOrCreateTag` / push calls the current
    loop makes for this note (section tags incl. body tags, then task tags, then
    front-matter tags not already in content), each with key, label, kind
    (`section`/`task`/`file`), id, updatedAt, and the precomputed
    `getEntityKind` (the costly `normalizeTagKey` work, ~30 ms at 5,000, is now
    per note and cached);
  - `tagKeys`: distinct keys in op order (for the tags-map order);
    `hubKeys` (from `hub.describes`);
  - association evidence, already tallied per pair:
    `pairs: Map<tagKey, Map<associatedKey, PairPart>>` with
    `PairPart = { co: number; headingByDepth: number[]; units: number;
    sectionIds: string[]; taskIds: string[]; firstSectionRef?: TagReference;
    firstTaskRef?: TagReference }`, and `tagUnits: Map<tagKey, number>`,
    `units: number` (source units, registered first-wins exactly as
    `registerSourceUnit` does). All evidence is note-local: groups belong to a
    section or task, and heading evidence walks `parentSectionId`, which stays
    inside the note — **provided ids are unique** (see fallback).
  - `ids`: its section and task ids, for collision detection.
- `class IndexState` — owns `files` (the one notes map; the indexer's
  `this.files` moves here so the two can never drift), `contributions` (same
  key order as `files`: `Map.set` on an existing key keeps its place, delete then
  set appends — the same rules on both maps), an `ordinal` per path (assigned
  when a path is first set, so "sort by ordinal" = "files order"), and per-tag
  indexes `filesByTag`, `hubFilesByTag`, `pairFiles: Map<T, Map<U, Set<path>>>`,
  global `tagUnits`, `totalUnits`, and an id-use count.
  - `static build(files)`: contributions for all → first generation.
  - `apply(changed: ParsedFile[], removed: string[])`: subtract old
    contributions from the per-tag indexes and counts, add new ones, collect
    `dirtyTags` = keys (and hub keys) of old ∪ new contributions. Every
    structure a snapshot captures is **copy-on-write** (new outer maps, new inner
    map for a dirty tag, new sets for a dirty pair), so a snapshot handed out
    earlier never changes under its holder.
  - `snapshot(): WorkspaceIndex`:
    - `files`: a copy (1 ms at 5,000).
    - `sections`, `tasks`: rebuilt by walking contributions in order (11–19 ms
      at 5,000 measured) — this is what keeps Map order, and collision
      overwrite semantics, exactly those of a full build.
    - `tags`: key order by first appearance over `contributions` (~2 ms);
      a clean key reuses the previous snapshot's `TagInfo` object (nothing in
      `src` mutates one — checked), a dirty key is rebuilt by replaying its
      ops from `filesByTag.get(key)` sorted by ordinal, then its count and
      `hubFilePaths` (sorted by `localeCompare`, as now).
    - `entities`: same, from ops with a kind.
    - `tagAssociations`: a `LazyTagAssociations implements
      ReadonlyMap<string, TagAssociation[]>` over the frozen generation. `get(T)`
      finalizes T's list on first ask and caches it: per pair, merge the parts
      from its files in ordinal order (co, heading counts, units, `sectionIds`
      then `taskIds` concatenated, `associatedTag` = the first section-phase ref
      of the lowest-ordinal note that has one, else the first task-phase ref),
      compute `normalizedWeight`, `tagSourceUnitCount`,
      `associatedTagSourceUnitCount`, `totalSourceUnitCount`, sort with the
      existing comparator. Iteration (`forEach`, `entries`, …) finalizes all.
      Related Notes and Home ask for a handful of tags; only the graph iterates
      all, and it is skipped by 10f when nothing it draws changed.
- `WorkspaceIndex.tagAssociations` becomes `ReadonlyMap<string,
  TagAssociation[]>` (callers only `get` and `forEach`; `new Map()` in tests and
  e2e fakes still type-checks).

**Two canonicalizations** (commit 5, the only intended output changes, both
invisible to a reader):
- **C1, weight:** `weight = co × 1 + Σ_depth headingByDepth[d] × (0.5 / d)`,
  summed in increasing depth, instead of a running float sum in evidence order.
  Same value to the last one or two bits; it makes the weight a function of
  counts, so a subtract-and-add can reproduce it exactly.
- **C2, `tagAssociations` key order:** the tags map's order, instead of "first
  appearance in the one global sort". Only the Notes Graph iterates the map, and
  its output does not depend on the order: an association edge's weight is taken
  from whichever direction reaches `addEdge` first, and `normalizedWeight(A→B)`
  equals `normalizedWeight(B→A)` exactly (same evidence both ways, `max()` of the
  two counts). The test in commit 5 asserts the graph snapshot is unchanged on the
  fixtures.

The global sort disappears: each tag's list is sorted on its own. Within one
tag, associated keys are unique, so the comparator has no ties and the per-tag
order is exactly the order the global stable sort gave.

**Collision fallback:** when the id-use count says a section or task id is used
twice, `apply` does `build(files)` instead (logged as `Build index`) — identical
by definition, and a collision is rare below ~10,000 notes.

**Indexer wiring:** `refresh()` → `this.state = IndexState.build(scanned)`;
`applyUpdates` collects `changed` and `removed` and ends in one
`measure('Update index', () => this.state.apply(changed, removed))`;
`getSnapshot()` → `this.snapshot ??= this.state.snapshot()`. `buildWorkspaceIndex(files)`
stays exported (35 unit test files, `checkLayout.js`, and three e2e files use it) as
`IndexState.build(files).snapshot()`.

### 2.5 10f: the Notes Graph

**Skip.** `notesGraph.ts` keeps `builtFrom: WorkspaceIndex | undefined`, the
index its workspace snapshot was built from. On `onDidUpdateView`:
`if (!graphInputsChanged(builtFrom, index)) { trace; return; }` — no rebuild,
no post, and a hidden graph is not marked stale.

`graphInputsChanged(before, after)` in `notesGraphState.ts`:
- different `files.size`, or a path in one and not the other → changed;
- for each path whose `ParsedFile` **object** differs (unchanged notes keep
  their object across updates — `this.files` and, after commit 6, the
  `IndexState` never copy one), compare `graphSignature(before)` with
  `graphSignature(after)`; signatures cached in a `WeakMap<ParsedFile, string>`.

`graphSignature(file)` = `JSON.stringify` of exactly what the graph, the tag
map, and the association pass read from a note:
sections → `[id, heading, startLine, parentSectionId, tags, tagLabels,
bodyTags, headingTags, associationTagGroups, links]`;
tasks → `[id, title, lineNumber, sectionId, tags, tagLabels,
associationTagGroups]`; file → `[frontmatterTags, links, aliases,
hub?.describes, sections.length]`. Ids carry the line (`parser.ts:1230`), so a
save that adds a line above a heading still redraws; one that edits within a
line or a paragraph does not.

`getWorkspaceSnapshot()` rebuilds only when `builtFrom` is unset or inputs
changed, replacing today's `updatedAt` check (which changed on every update).
Scope changes (`setGraphScope`, following the editor) still redraw as now.

**Filter on host.** A new page→host message
`{ type: 'setGraphFilter', showNotes: boolean, showTasks: boolean }`,
validated in `messages.ts` (`parseNotesGraphMessage`), sent by the page once
after it restores its settings and on each toggle of **Show notes** /
**Show tasks**. It does not set `scopeChosen` (so the opening scope rule is
untouched). The host keeps `kinds` (default both on — the page's default, so
the common case posts once) and, when posting:
- drops `note`/`task` nodes the page hides and every edge touching one;
- adds `hiddenNodeCount` and `edgeCount` (the unfiltered edge count) to the
  posted snapshot;
- drops each edge's `id`; the page restores it on receipt
  (`edge.id = edge.source + '::' + edge.target`, used at
  `notesGraphHtml.ts:933-949`).

The page's own filter at `rebuildView` stays (harmless, and it covers the
moment between a toggle and the new snapshot). Readouts keep their meaning:
the empty state shows only when `nodes.length + (hiddenNodeCount || 0) === 0`
(`:578`); "N indexed" reads `snapshot.edgeCount ?? snapshot.edges.length`
(`:1524`); the focus line's "N of M nodes" counts `nodes.length +
(hiddenNodeCount || 0)` (`:1893`). The host's own snapshot (Connected nodes in
the sidebar, `createNotesGraphConnections`) stays whole.

Measured effect at 5,000 notes: whole graph 39.4 → ~30 MB; tasks hidden → ~14 MB.

### 2.6 10g: warm start

**Store.** In the existing database (`deckard-search.sqlite`),
`SCHEMA_VERSION` 2 → 3 (the existing drop-and-rebuild path handles upgrade):
`notes` gains `created_at INTEGER` and `parsed TEXT` (nullable). One
fingerprint, stored where the parse fingerprint is now (`meta.parse`):
`scanner.getParseFingerprint()` + extension version + time zone
(`Intl.DateTimeFormat().resolvedOptions().timeZone`, because
`new Date(y, m, d)` in the parser is local time). A mismatch rebuilds the
cache, as a settings change does today. Including the version also fixes a
latent bug: a release that changes the parser currently leaves search rows
written by the old parser in place.

In the Development and Test extension modes the cache is **not read** (a
developer's parser edits do not bump the version); it is still written, and
unit tests exercise reading with an explicit fingerprint.

**Codec** (`src/core/storage/parsedFileCodec.ts`): `encodeParsedFile(file):
string`, `decodeParsedFile(text): ParsedFile`. JSON, but a section's
`rawContent` and `bodyContent` are stored as line ranges into `content` when —
and only when — the slice reproduces them exactly (checked at encode; stored
literally otherwise), and a `filePath` equal to the note's is elided. Measured
on the repo's 53 real notes: the naive JSON is 7.4× the Markdown, 60% of it
`rawContent`/`bodyContent`; the codec should bring it near 3×. Lossless by
construction; round-trip tested.

**Writes.** `NoteToWrite` gains `createdAt` and `parsed`. The encoded string is
made during the scan, one note at a time between awaits, and memoized in a
`WeakMap<ParsedFile, string>`, so `createNoteToWrite` never encodes 5,000 notes
in one block. `compareToStored` writes a note whose mtime, **ctime**, or size
differs, or whose `parsed` is missing. Saves go through `upsert` as now; the
worker writes big batches as now.

**Start** (`WorkspaceIndexer.start()`):
1. Register watchers (unchanged).
2. If the store has a matching fingerprint: `store.readParsedNotes(onBatch)`
   reads `notes` in rowid order, 500 rows per batch, `setImmediate` between
   batches, decoding each. Rows whose path is no longer a note under current
   settings (`scanner.isNotesFile` on the path's URI — an exclude or notes
   folder changed while VS Code was closed) are skipped.
3. `state = IndexState.build(cached)`; `stale = true`; `emitUpdate()`;
   resolve the new `published` promise.
4. `refresh({ reuse: 'cache' })` — see below — then `stale = false`, resolve
   `ready`. Its delta against the stale files goes through `state.apply`; an
   empty delta (the usual case) publishes nothing.
5. No cache, a mismatched fingerprint, or an in-memory store: today's cold path,
   except for the faster scan below.

**Scan** (`scanner.scan(onProgress, reuse?)`): stat first; call
`reuse(filePath, { mtime, ctime, size })`; read and parse only when it returns
nothing. Up to **8** notes in flight (`io.js`: 303 → 86 ms at 5,000), results
kept in `findFiles` order. `refresh()` passes a `reuse` that answers the
current `ParsedFile` when mtime, ctime, and byte size match and the parse
fingerprint is the one it was parsed under. So a refresh after a change to
`deckard.exclude`, `files.exclude`, `deckard.templatesFolder`,
`deckard.notesFolder`, or a workspace folder add/remove rereads nothing it
already has; a change to a parsing setting (inline tags, note boundaries, person
marker, namespace aliases, `tasks.assigneeFromPersonTag`) reparses everything,
as now. **Reindex Workspace** calls `refresh({ reuse: 'none' })`.

**While stale.** `indexer.published: Promise<void>` (first publish, stale or
fresh) and `indexer.isStale: boolean`. Display-only surfaces await `published`
instead of `ready`: dashboard, stats, taskBoard, notesGraph, calendar,
searchPage, sidebarNotes, quickFind, tagSuggestions, linkSuggestions,
taskMetadataSuggestions, editorLenses. Everything that writes or answers for
the whole workspace keeps `ready`: rename, extract, hub note, capture, rollover,
review, daily note, pin, link maintenance, link health, tidy, check setup,
assistant tools and writes, MCP. (Board and task writes are already safe
against a stale view: `taskActions.ts:91` compares the whole source line before
writing.) The `preferences.prune` listener skips stale publishes, and
`getLastScan()` answers the counts saved with the cache (`meta.lastScan`)
until the check finishes, so Stats and Check My Setup never show "0 found".

**Why no banner.** The cached notes are what the files held when VS Code
closed; outside edits (a sync, a `git pull`) are the only way they differ, and
the check replaces them within about a second. A "may be out of date" banner on
every start would teach readers to ignore it. The spinner's title says what is
happening.

### 2.7 Targets (5,000 synthetic notes unless stated; before = measured today)

| Measure | Before | Target |
| --- | --- | --- |
| Index update after one save | 500–620 ms | ≤ 30 ms |
| Same, 1,000 notes | 96–138 ms | ≤ 10 ms |
| Full build (refresh) | 500–620 ms | no slower than +10% |
| Longest single host turn in a save with Home, board, graph, Related Notes visible | sum of all views (graph alone ~1.1 s build + 39 MB post) | the slowest single view |
| Graph, save with no structural change | ~1.1 s + 39 MB post | 0 build, no post; check ≤ 5 ms |
| Graph payload, whole workspace | 39.4 MB | ≤ 31 MB; ≤ 15 MB with tasks hidden |
| Start → first publish, warm, nothing changed | ~1.9 s (read 0.3 + parse 1.05 + build 0.52) | ≤ 0.9 s |
| Start → fresh (`ready`), warm, nothing changed | ~1.9 s | ≤ 1.1 s, with no second publish |
| Cold start | ~1.9 s | no slower than +15% (encoding) |
| Cache size | — | ≤ 4× the notes' bytes |

---

## 3. Implementation steps

### Commit 1 — benchmark

- `test/perf/indexSpeed.js` (new; plain Node, like `test/ui/*.js`): loads
  `out/` with `test/e2e/vscodeStub.js` for `vscode` (as `bench.js` does, but with
  `NODE_PATH` set in-script), generates the seeded corpus (the researcher's
  generator: `N` notes, 600 tags in four namespaces, links, dated tasks), and
  prints one table: parse, full build, one-save update (edit one note's tag),
  graph build + JSON size (+ tasks hidden), graph skip check, codec encode/decode
  + size, cold vs warm start through `WorkspaceIndexer` over a temp folder
  (fake `WorkspaceFileAccess` over `fs`, temp SQLite). Sections that the current
  commit cannot run yet print `—`.
- `package.json`: `"bench:index": "npm run compile-tests && node test/perf/indexSpeed.js 1000 5000"`.
  Not one of the four suites; numbers go in the commit messages of 2–9.

### Commit 2 — 10e now

- `indexer.ts`: `onDidUpdateView`, the queue, injectable `schedule`, `dispose`
  clears it; `emitUpdate` as in §2.3.
- New `src/core/workspace/publishing.ts`: `onIndexUpdateInTurn(source,
  options, listener)` with the `onDidUpdate` fallback.
- Callers (priority function in brackets):
  `dashboard.ts:80`, `stats.ts:30`, `taskBoard.ts:81`, `notesGraph.ts:68`
  [`active ? 0 : visible ? 1 : 2` on the panel, `2` when there is none];
  `calendar.ts:44`, `sidebarNotes.ts:67` [`view?.visible ? 1 : 2`];
  `searchPage.ts`: the manager keeps a plain `onDidUpdate` for
  `isForMissingTag` closing; each `SearchPanel` subscribes itself in its
  constructor and disposes with the panel;
  `linkHealth.ts:243` [`1`]; `queryBlocks.ts:41` splits: store index + fire
  lens change stays plain, `refreshMarkdownPreviews` goes in turn [`1`];
  `extension.ts:435` prune [`3`].
- Edge: a view whose panel was disposed between queueing and its turn — the
  subscription was disposed with it and is skipped (the queue holds the
  subscription record and checks a `disposed` flag).

### Commit 3 — 10f skip

- `notesGraphState.ts`: `graphSignature`, `graphInputsChanged` (exported for
  tests).
- `notesGraph.ts`: `builtFrom`; update handler as §2.5; `getWorkspaceSnapshot`
  keyed on it; `logTrace` line.
- Coordination: if Piece 13 (parked notes) has landed, `index.parked` is also
  an input — compare the parked sets (or clear `builtFrom` on
  `deckard.parked` configuration changes). Whichever lands second adds it.

### Commit 4 — 10f host filter and lighter edges

- `types.ts`: `NotesGraphSetFilterMessage`; `NotesGraphSnapshot` gains optional
  `hiddenNodeCount`, `edgeCount`; `NotesGraphEdge.id` stays in the host type,
  optional on the wire type (`NotesGraphWireSnapshot`).
- `messages.ts`: parse `setGraphFilter`.
- `notesGraph.ts`: `kinds`; `toWire(snapshot, kinds)` applied in `refresh()`
  just before `postMessage` (after local narrowing); re-post when a filter
  message changes `kinds`.
- `notesGraphHtml.ts`: send `setGraphFilter` after settings restore and in the
  `show-notes` / `show-tasks` toggles; restore `edge.id` on `state`; the three
  readouts in §2.5.
- Coordinate with Piece 12 (degree, edge kinds, **Only links I wrote**, which
  also edits `rebuildView` and the readouts) — trivial rebase either way.

### Commit 5 — the index as a fold of contributions (full build only)

- New `src/core/workspace/indexState.ts` (§2.4) with `build` and `snapshot`;
  `apply` not yet public.
- `indexer.ts`: `buildWorkspaceIndex` → `IndexState.build(files).snapshot()`;
  the association helpers move to `indexState.ts`.
- `types.ts`: `tagAssociations?: ReadonlyMap<…>`.
- `docs/related-notes-associations.md`: the "Raw connection" row gains "summed
  as co-occurrences plus heading evidence by depth".

### Commit 6 — incremental updates

- `IndexState.apply`, copy-on-write generations, `LazyTagAssociations`
  caching per snapshot, id-use counts and the collision fallback.
- `indexer.ts`: the state owns `files`; `refresh`, `applyUpdates`,
  `getSnapshot` as §2.4; `Update index` measurement.
- Edge cases: a note that parses to nothing (no sections, tasks, or tags) still
  has a contribution (it is in `files`); a note deleted and re-added in one
  flush appends (same as `Map`); an unreadable note is removed, as today.

### Commit 7 — faster scan, and no reparse of an unchanged note within a session

- `scanner.ts`: `scan(onProgress, reuse?)`, stat-first, 8 in flight, ordered
  results; `read()` accepts a stat it already has.
- `indexer.ts`: `refresh(options?: { reuse?: 'session' | 'none' })` (default
  `session`); fingerprint remembered per `IndexState`.
- `extension.ts:648-650` Reindex Workspace → `refresh({ reuse: 'none' })`.

### Commit 8 — keep each parsed note in the cache

- `searchDatabase.ts`: schema 3, columns, `readParsedNotes` (paged),
  `writeNote` writes `created_at` and `parsed`; `compareToStored` with ctime and
  missing `parsed`.
- `parsedFileCodec.ts` (new).
- `searchStore.ts`: `readParsedNotes(fingerprint, onBatch)`, the combined
  fingerprint, `meta.lastScan` read/write.
- `extension.ts`: pass the version and `context.extensionMode` to the store.

### Commit 9 — warm start

- `indexer.ts`: `start()` as §2.6, `published`, `isStale`, the progress title,
  `getLastScan` fallback, `Load notes from cache` / `Check notes for changes`.
- The `published`/`ready` split across the files listed in §2.6.
- `extension.ts:435` prune skips stale.
- Coordinate with Piece 4's 10b: its `hasIndexed` getter becomes "published"
  (stale counts), and its "Indexing 412 of 3,760 notes…" placeholder is then
  shown only on a cold start.

---

## 4. Tests

All in the suites that exist; each commit runs all four (`npm test`,
`npm run test:ui`, `npm run test:e2e`, `npm run test:layout`) and gates on
exit codes.

**npm test (VS Code host, mocha):**

- `index-publishing.test.ts` (commit 2), fake `schedule`:
  plain listeners run in the publish turn and no view has run; stepping runs
  priority 0, then 1, then 2, one per step; a publish mid-round restarts the
  order and each view runs once; a disposed subscription never runs; a
  throwing view is reported and the next still runs; `onIndexUpdateInTurn`
  falls back to `onDidUpdate` on a source without `onDidUpdateView`.
- `notes-graph-state.test.ts` (commit 3): for each field in the signature,
  changing it makes `graphInputsChanged` true; for each field outside it
  (`content`, `rawContent`, `bodyContent`, created/updated times, `fileTimes`,
  task status/due/priority, a paragraph's words), false **and**
  `createNotesGraphSnapshot` is deep-equal before and after (minus
  `updatedAt`) — this is the proof the signature covers what the graph reads.
  Adding or removing a note is a change.
- `notes-graph-navigation.test.ts` (commit 3): a panel receives no second
  `state` after a prose-only save; one after a tag is added.
- `notes-graph-behavior.test.ts` (jsdom page, commit 4): the page posts
  `setGraphFilter` after load and on each toggle; a wire snapshot without edge
  ids selects and highlights neighbors as before; the empty state stays hidden
  when every node is filtered out; the counts line reads `edgeCount`.
- `notes-graph-state.test.ts` (commit 4): `toWire` with tasks hidden has no
  task node and no edge touching one; with both shown it equals the snapshot
  minus edge ids; `messages` rejects a malformed `setGraphFilter`.
- `index-equivalence.test.ts` (commits 5–6) — **the equivalence test**:
  - `normalize(index)`: every map as its ordered entry list, the lazy
    associations iterated in full, `updatedAt` dropped. Order is compared, not
    sorted away.
  - Commit 5, against a frozen copy of today's implementation
    (`src/test/fixtures/legacyWorkspaceIndex.ts`, copied verbatim from
    `726d23b`): on the sample workspace, a hand-written edge-case corpus (hub
    notes and hub conflicts, front-matter-only notes, body tags, three-deep
    headings, one tag in two spellings, aliases, person/project entities,
    periodic notes, a note with no tags), and three seeded synthetic corpora —
    deep-equal except `weight`/`normalizedWeight` within 1e-9 relative and
    `tagAssociations` compared per key (C1, C2). Plus: the Notes Graph snapshot
    built from each is deep-equal (proves C2 is invisible), and Related Notes
    rankings for five tags are equal.
  - Commit 6, exact: a seeded generator makes a 60-note corpus, then 400 random
    operations — edit (add, remove, or recase a tag; add or remove a heading,
    task, link, alias, hub `describes`; empty a note to front matter only),
    add, delete, delete-then-re-add, and batches of 2–5 at once. After each,
    `normalize(state.snapshot())` must **strictly** equal
    `normalize(IndexState.build(files).snapshot())` for the same ordered
    files map. Ten seeds; a failing seed prints the operation log.
  - Old snapshots are untouched: hold a snapshot, apply ten updates, its
    normalized form is unchanged (copy-on-write).
  - Collision: the test finds two `path:line:heading` strings whose ids
    collide (birthday search over ~70k candidates, < 100 ms), puts them in two
    notes, and checks the update falls back and still equals the full build.
- `workspace.test.ts` (commits 6, 7, 9): the indexer over a fake
  `WorkspaceFileAccess` — a save updates through `Update index` (spy on the
  timing log) and matches `buildWorkspaceIndex`; `refresh()` after an exclude
  change reads no file it already had (count `readFile` calls); Reindex reads
  every file; the scan keeps `findFiles` order with 8 in flight; at most 8 reads
  are ever outstanding.
- `search-store.test.ts` (commit 8): schema 3 upgrade from a v2 file; a
  fingerprint change (settings, version, or time zone) rewrites every note;
  ctime-only change rewrites that note; `readParsedNotes` pages in rowid order.
- `parsed-file-codec.test.ts` (commit 8): round-trip deep-equal on every note
  of the sample workspace, the edge-case corpus, CRLF files, a file without a
  trailing newline, emoji and combining marks, and a section whose `rawContent`
  is not a plain slice (stored literally); encoded size of the synthetic corpus
  ≤ 4× the Markdown.
- `warm-start.test.ts` (commit 9), temp SQLite + fake access: a second
  `start()` publishes before any `readFile`, with `isStale` true; `ready`
  resolves after the check; unchanged notes cause no second publish; one
  changed, one deleted, one added cause exactly one more publish whose index
  equals a cold build; a note excluded while "closed" never appears; a
  mismatched fingerprint takes the cold path; in Test mode the cache is not
  read unless the test passes a fingerprint; `getLastScan` answers the saved
  counts while stale.

**npm run test:e2e:** the existing webview e2e files build indexes with
`buildWorkspaceIndex` and fake indexers; they must pass unchanged (the
fallback helper keeps their fakes valid). Add to `sidebarNotes.e2e.js` or the
dashboard e2e one check that a save's redraw still arrives (the stagger only
delays by turns).

**npm run test:ui / test:layout:** unchanged pages except the graph's script;
`checkWebviewScripts.js` parses it. No visual baselines cover the Notes Graph
(`test/ui/visual-baseline/darwin` has none), and no other page's markup
changes, so **no baselines are re-recorded**.

**Manual check** (commit messages carry the numbers): `npm run bench:index`
before and after each commit; and once in the Extension Development Host on
`scratchpad/ws` (5,000 notes) with the log at Debug: save a note with Home,
board, graph, and Related Notes visible and read the `Refresh … after an index
update` lines; restart and read `Load notes from cache` / `Check notes for
changes`.

---

## 5. Docs

**README.md**

- *Limitations and troubleshooting → Deckard feels slow* — replace "Editing a
  note never waits on indexing: the index is rebuilt only after a save, …" with:
  > Editing a note never waits on indexing. A save updates only that note's part
  > of the index, the views on screen redraw one at a time with the one in front
  > first, and hidden panels catch up when they are shown. The Notes Graph is
  > not redrawn by a save that changes none of its links, headings, tags, or
  > tasks. At start, Deckard shows your notes as they were when VS Code last
  > closed and then rereads only the notes whose size or saved time changed;
  > `Deckard: Reindex Workspace` rereads every note.

  (the rest of the bullet — the search cache thread — stays.)
- *Source safety and persistence* — "Deckard stores a workspace-scoped SQLite
  full-text cache locally for fast saved-note search." →
  > Deckard stores a workspace-scoped SQLite cache locally: the words of each
  > saved note for fast search, and each note as it was last read, so the next
  > start does not read every note again.
- *Notes Graph* — after "Only the neighborhood is sent to the page…" add:
  > Hiding notes or tasks leaves them out of what is sent, too.

**Help** (`src/ui/webview/helpHtml.ts:516`): "The index and the search cache
are stored locally, under this workspace’s storage, …" →
"The search cache and a copy of each note as Deckard last read it are stored
locally, under this workspace’s storage, …". The command blurb for
`deckard.reindexWorkspace` ("Reads every note again.") stays — still exact.

**CHANGELOG `## Unreleased`**, under `### Changed` (one entry per shipped
commit group, David's style):

- **A save no longer holds VS Code up while Deckard redraws.** A save updates
  only that note's part of the index — about 20 ms at 5,000 notes, down from
  about half a second — and the views on screen redraw one at a time, the one
  in front first, so other extensions get a turn in between.
- **The Notes Graph costs a save nothing when the save changes nothing it
  draws.** Editing words inside a line no longer rebuilds and resends the whole
  graph (39 MB at 5,000 notes). Hiding notes or tasks leaves them out of what is
  sent, and each link is sent a third lighter.
- **Deckard starts from where it left off.** Each note is kept in the local
  cache as last read, so a workspace opens with its notes at once and Deckard
  rereads only those whose size or saved time changed. Notes are read eight at
  a time. `Deckard: Reindex Workspace` still rereads everything.

**docs/components.md:** no change — it documents shared webview components,
and none changes. **docs/related-notes-associations.md:** the one-line note in
commit 5.

---

## 6. Commits

Each is shippable alone, passes all four suites, and records `bench:index`
before/after in its body.

1. `test: a benchmark times indexing, the Notes Graph, and a start at 1,000 and 5,000 notes`
2. `perf: after a save, the views on screen redraw one at a time, the one in front first`
3. `perf: the Notes Graph is not rebuilt or resent when a save changes none of its links, headings, tags, or tasks`
4. `perf: the Notes Graph sends only the kinds of node it shows, and not what the page can work out`
5. `refactor: the index is built from each note's own contribution`
6. `perf: a save updates only that note's part of the index`
7. `perf: notes are read eight at a time, and a rescan does not parse a note that has not changed`
8. `feat: each parsed note is kept in the local cache, which a new version or time zone rebuilds`
9. `feat: a workspace opens with its notes at once, then rereads only the notes that changed`

Docs travel with the commit whose behavior they describe (README and CHANGELOG
in 2, 3/4, 6, 9; Help in 8).

---

## 7. Size, risks, dependencies, questions

**Size:** 1 (0.5 d) + 2 (1 d) + 3 (1 d) + 4 (1 d) + 5 (2 d) + 6 (2.5 d) +
7 (1 d) + 8 (1.5 d) + 9 (2 d) ≈ **12.5 days** (10e now S, 10f M, 10e later L,
10g L — as the plan sized them).

**Risks**

- *Equivalence drift.* A future change to `buildWorkspaceIndex`'s logic must
  now be made in `computeContribution` and the fold; the equivalence test
  catches a mismatch on the next run. The collision fallback covers the one
  known cross-note dependency.
- *C1/C2 last-bit changes* could flip an exact tie in a Related Notes ranking.
  The commit-5 test compares rankings on five tags; a flip would show there.
- *Staggering and tests that expect a redraw in the same tick* (e2e harness):
  mitigated by the fallback helper; any real test that asserts "same tick" is a
  test of an implementation detail and moves to awaiting the post.
- *A cached note that is wrong.* Only possible if a file changes without its
  mtime, ctime, or size changing (the search cache already accepts this), or
  if the parser changes without a version bump (Development mode does not read
  the cache for that reason). Reindex Workspace is the escape hatch.
- *Disk:* the cache grows by ~3× the notes' bytes (≈ 15 MB for the 5,000-note
  synthetic workspace), in workspace storage.
- *Graph still costs ~1.1 s at 5,000 notes on a save that does change its
  structure* (any heading, tag, task, link, or line shift above a heading).
  Out of scope here; a follow-up could sort edges by a precomputed key (the
  `localeCompare` sort is ~300 ms) or build the graph from contributions as the
  index now is.

**Dependencies**

- **Piece 4 (10a, 10b):** 10a edits `indexer.ts` save flushing (own writes
  flush at once) — independent of commit 6 but the same functions; land either
  first and rebase. 10b's `hasIndexed` and "Indexing N of M…" placeholders
  meet commit 9's `published`: after 9, "indexed" means "published".
- **Piece 12 (graph explains itself):** edits `notesGraphHtml.ts`
  `rebuildView`, readouts, and `node.degree` use — rebase with commit 4.
- **Piece 13 (parked notes):** adds `index.parked` in `getSnapshot` and a
  `parked` node flag — becomes a graph input for commit 3's skip (whichever
  lands second), and `getSnapshot` stays the attach point after commit 6.
- **Piece 5** (links reach a tag's page) and others that add fields to
  `ParsedFile` or `Section`: after commit 3, any new field the graph reads must
  join `graphSignature` (the commit-3 test fails if it is forgotten, as long as
  it is added to the field list the test mutates — note this in the test's
  comment); after commit 8, any new `ParsedFile` field round-trips through the
  codec automatically (JSON) and the version bump rebuilds the cache.

**Open questions for David:** none. Choices made here that he may want to
know: no new setting (Reindex Workspace is the escape hatch); no "may be out of
date" banner during the second-long check at start; the graph's tag checklist
and search keep dimming on the page rather than filtering on the host.
