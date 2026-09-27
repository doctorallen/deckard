# Piece 5 — Links and spellings reach a tag's page

Implementation plan for `docs/ux-fifteen-sources-plan.md` Piece 5 (5a–5h).
Written against `dev` at `726d23b` (v1.22.0). Every claim below was re-read in
the source before planning.

---

## 1. Scope

| Item | Status after verification | Notes |
| --- | --- | --- |
| **5a** `link` field, bare `[[Note]]`, builder, Links to facet, Open as search | **Planned** | Confirmed: `QueryField` (`queryTypes.ts:27-44`) has no link field. Today `[[Atlas]]` in a search box tokenizes as one bare *word* (`[` is not in `WORD_BREAK`, `queryParser.ts:193`), so it runs as `text ~ "[[Atlas]]"` and the plain-words path sends only `atlas` to the full-text store. `[[Atlas plan]]` splits into two words. `noteLinks.ts:30` caps Linked from at 50 with "N more not listed" and no way to reach the rest (`sidebarNotesHtml.ts:353`). |
| 5a "SQLite/search store" | **Dropped (nothing to do)** | The SQLite store (`searchStore.ts`) is a words-only FTS index; DQL is never evaluated there. A `link` condition is not a plain-text term (`getPlainTextTerms`, `queryEdit.ts:243`), so it goes to the in-memory evaluator on every surface. No column or schema change is needed. |
| 5a MCP / assistant tools | **Planned (docs only)** | The MCP server takes its tool definitions from the manifest's `languageModelTools` (`package.json:705`); `QUERY_SYNTAX_GUIDE` (`src/ui/state/assistantTools.ts:27`) is sent back on a bad query. Both get the new field and shorthands. |
| **5b** lookalike line on a one-tag page | **Planned** | Confirmed: lookalikes appear only on Stats (`findTagMergeCandidates`, `tagHygiene.ts:34`). `#proj/atlas` vs `#project/atlas` is found there as the `namespace` reason. |
| **5c** hub-link inclusion | **Planned** | Confirmed: `createSearchPageSnapshot` (`dashboardState.ts:192`) evaluates only the tag. Implemented on the page, not as rewritten query text, so the page stays a tag page. |
| **5d** plain-text mention line | **Planned** | Nothing today. |
| **5e** `is:daily`, `is:periodic`, Hide daily notes | **Planned** | Confirmed: `IS_VALUE_ALIASES` (`queryParser.ts:106`) has neither. Daily-note detection exists in three copies (`listDailyNotes`, `findOrphanNotes`, `isPeriodicNode`); this piece makes it one helper. |
| **5f** grouped Linked from | **Planned** | Confirmed: `collectNoteLinks` returns a flat list in index order. |
| **5g** Stats "Links that open no note" | **Planned** | Detection already exists per open note (`findLinkProblems`, `linkHealth.ts:54`) and creation exists (`createMissingNotes`, `linkHealth.ts:174`); nothing lists them workspace-wide. Scope: *missing* names only. Ambiguous names (two notes share a name) stay the editor warning they are today. |
| **5h** Rename Tag box | **Planned** | Confirmed: `chooseReplacementTag` (`renameTag.ts:522-549`) opens an empty box with `prompt: "Rename #x to"`; a bare `project/atlas` for `#proj/atlas` becomes `#proj/project/atlas` in `inferBareTag` (`renameTag.ts:816-834`) with nothing saying so. |

Nothing was found already fixed.

---

## 2. Design

### 2.1 Query language: `link` (5a)

**Syntax.**

| Written | Means |
| --- | --- |
| `[[Atlas]]` | Shorthand for `link = [[Atlas]]`. |
| `link = [[Atlas]]`, `link:[[Atlas]]`, `link = Atlas`, `link = "Atlas plan"` | Entries that link to the note Atlas (by its title or any `aliases:` name). Brackets are optional after `link`. |
| `[[Atlas#Decision]]` | Links to that heading of Atlas (`[[#Decision]]` written inside Atlas counts). |
| `[[Atlas#^q3]]` | Links to that marked line. |
| `-[[Atlas]]`, `link != [[Atlas]]`, `NOT [[Atlas]]` | Entries that do not link to Atlas. |
| `[[Atlas|the plan]]` | The alias after `|` is ignored: same as `[[Atlas]]`. |

- Field aliases: `link`, `links`, `linksto` → `link`. Operators: `=`, `!=` only.
- Canonical form (formatter, builder, saved searches): `link = [[Atlas]]`,
  `link != [[Atlas#Decision]]`. The value in the AST is the target without
  brackets or alias: `Atlas`, `Atlas#Decision`, `Atlas#^q3`.
- Parse errors (exact strings):
  - `[[Atl` unclosed: **"This link is missing its closing ]]."**
  - `[[]]`, `[[#Decision]]`, `link = "#x"`: **"link needs a note's name, such as [[Atlas]] or [[Atlas#Decision]]."**
  - `link > x`: existing "link does not support ">". Try: =, !=." message.

**What matches.** One rule, shared with Linked from so the two always agree:
the link occurrences are the ones `buildBacklinkIndex` finds (front matter
included, code fences excluded). An occurrence answers `link = [[X]]` when

1. its resolved target is one of the notes the name `X` means (title or
   alias, case-insensitive, via `createNoteTitleMap`), and it is not written
   in that note itself (as `BacklinkIndex.toNote` excludes self-links); **or**
2. it resolves to no note and its written name equals `X`
   case-insensitively — so `link = [[Q4 offsite]]` finds the links to a note
   not written yet (5g relies on this), and a name two notes share finds the
   links that name it.

With `#Heading` the occurrence must also name that heading
(`normalizeHeading` both sides; self-links count, as `toHeading` does); with
`#^id`, that block (as `toBlock`).

**Which entry answers.** An occurrence on one-based line L of a note is
answered by every unit that owns L, mirroring how a body tag answers:

- the task on line L;
- each inline (tagged-line) section whose `startLine..endLine` covers L;
- the heading section whose *own* body (`startLine..bodyEndLine`) covers L
  (a parent heading does not answer for a child's link, so one link is not
  two results);
- if none of those: the **file** (front matter, text before the first
  heading, or a note without headings). A file enters `evaluateQuery`'s file
  list this way only when the query has a `link` condition, so no other
  search changes. Its card shows the text before the first heading (or the
  body, for a note with no headings), not the whole note.

### 2.2 `is:daily` and `is:periodic` (5e)

- `is:daily`: any entry or task written in a daily note — a note named for a
  day (`2026-09-25.md`) or whose top heading holds one, exactly the rule
  `listDailyNotes` uses today. Aliases: `is:journal`.
- `is:periodic`: `is:daily` plus weekly and monthly notes
  (`isPeriodicNotePath`). Aliases: `is:dated`.
- Unlike the task shorthands, both apply to notes, tasks, and files.
- Parse error message is extended: "is: accepts open, done, task, note,
  overdue, due, blocked, blocking, mine, assigned, unassigned, daily, or
  periodic — not "x"."
- Completion details: `is:daily` "Written in a daily note"; `is:periodic`
  "Written in a daily, weekly, or monthly note".

### 2.3 Builder parity (5a, 5e)

Everything typed text can say, the builder can build:

- `link` appears in the field list (it comes from `QUERY_FIELDS`), with `=`
  and `!=`, placeholder `Atlas#Decision`, and value completions from note
  titles and aliases. The row writes `link = [[value]]`; brackets typed into
  the value are stripped first.
- A new row that is typed `[[Atl` offers notes as whole conditions
  (`[[Atlas]]`); `-[[Atlas]]` makes a `!=` row.
- `is:daily` and `is:periodic` appear in the `is` value list and as
  conditions.
- The query bar's chips and highlighting read `[[Atlas plan]]` as one term
  (its own `link` piece kind), not two words.

### 2.4 Completions and Refine (5a)

- Typing `[[` in a search box (the bar, or a new builder row) lists notes:
  label `[[Atlas plan]]`, detail "Linked from 12 notes" (or "alias of Atlas
  plan" for an alias), most-linked first, capped at 200. Choosing one
  inserts `[[Atlas plan]] `.
- `describeQueryField('link')`: **"A note the entry links to, as [[Atlas]] or [[Atlas#Decision]]; aliases count"**.
- Refine gains a **Links to** facet (id `links`), after Tags: the notes the
  current results link to, top 8, each with how many results link there,
  clause `[[Title]]`. The usual facet rules apply (a value that keeps none or
  all is left out; a value already written is "applied").

### 2.5 Related Notes: Linked from (5a, 5e, 5f)

```
Linked from 7                               [Hide daily notes]
  Standup                      3 days ago · 2 links
    Decisions › We moved [[Atlas]] to Q4.          [▸]
    Risks › [[Atlas]] depends on vendor sign-off.  [▸]
  Budget review                last week
    ...
  12 more not listed.  Open all as a search
```

- Grouped by source note, **newest updated first** (ties by title). The
  badge counts notes (matching the editor lens "Linked from N notes").
- Group header: note title (opens the note at its first link line), then
  "3 days ago" (the relative wording Stats uses) and "· 2 links" when more
  than one.
- Each line row keeps today's look (heading path, line text; click opens,
  Cmd/Ctrl-click opens beside). A trailing expander, `aria-expanded`, label
  **"Show the rest of this section"**, reveals the section's own text as
  plain wrapped text (at most 15 lines / 1,500 characters, ending "…" when
  cut). Expanded rows survive redraws like the group's open state does.
- The list caps at 50 lines as today. The foot line is always there when
  there is at least one link:
  - not truncated: **"Open as search"**;
  - truncated: **"12 more not listed."** followed by **"Open all as a search"**.
  - tooltip: **"Search for every entry that links here, so Refine, Bulk edit, Save, and Export work on them"**.
  The host builds the query itself: `link = [[<title>]]`, plus ` -is:periodic`
  while daily notes are hidden, and runs `deckard.search`.
- **Hide daily notes** is one toggle (a `.toolbar-toggle` with
  `aria-pressed`) in the Related Notes header beside the sort select. It
  hides daily, weekly, and monthly notes from Related Notes **and** Linked
  from. Tooltip: **"Leave out daily, weekly, and monthly notes, which link to
  everything written that day"**. When it hides something from Linked from,
  a line under the list says **"Hiding 8 daily notes."** with a **"Show
  them"** button that turns the toggle off. Default off; remembered as the
  preference `hideDailyNotes` (with the sort mode, not a setting).

### 2.6 A tag's page (5b, 5c, 5d)

All three are quiet lines under the tag's subtitle/hub on a **one-tag page**
(the only page that has `snapshot.tag`), in the order 5b, 5c, 5d, using the
page's muted text style with text buttons. None appears on any other search.

**5b — other spellings.** Up to three lookalikes of this tag, from the Stats
detector, most confusable first. One line each:

> Also written as **#proj/atlas** (6 entries). [Include in search] [Merge]

- **#proj/atlas** opens that tag's page.
- **Include in search** runs `#project/atlas OR #proj/atlas` on this page
  (it becomes an ordinary search; **Clear** returns to the tag, as today).
- **Merge** runs the existing `deckard.mergeTag` with the Stats direction
  (the rarer spelling into the more used one), so it is confirmed, previewed,
  and undoable. When the page's own tag is the one merged away, the page
  reopens on the tag that was kept.
- Button tooltips: Include — "Search for both spellings"; Merge — "Merge
  #proj/atlas into #project/atlas, after showing what changes".

**5c — entries that link the hub.** When the tag has a hub note and
`deckard.tagOverview.includeHubLinks` is on (default), the page lists the
tag's results **plus** every entry and task that links to any of its hub
notes (`link = [[Hub]]` for each hub) without matching the tag. Those rows
carry a small line **"Links the hub note"** in the card's source row (tasks:
after the task's location). The hub notes' own entries stay out, as today.
Counts, tabs, paging, Bulk edit, and Export all include them. A line says:

> Also listing 5 entries that link to Atlas plan without the tag. [Leave them out]

**Leave them out** sets `deckard.tagOverview.includeHubLinks` to `false`
(workspace-independent, Global target). The line is absent when there are no
such entries.

**5d — plain-text mentions.** When the tag's name part (after the namespace,
`-` and `_` read as spaces) is at least three characters and not a number:

> 12 entries mention "atlas" without the tag. [Show them]

- Counted by running `text = "atlas" -#project/atlas` minus the tag's hub
  notes (`NOT path = "<hub path>"` per hub). Absent when the count is 0.
- **Show them** runs that search on this page. Tooltip: **"Search for them;
  Bulk edit → Add a tag tags them all"**.
- `@person` tags work the same way: `@dana` → "dana".

### 2.7 Stats: Links that open no note (5g)

A panel in the "Link and tag hygiene" section, after **Tags that look alike**:

> **Links that open no note** [Create all]
> - **Q4 offsite** — 4 links from Standup, Atlas plan, and 1 more note [Create]
> - ...
> And 12 more.

- One row per missing name (case-insensitive; the first spelling found is
  shown), most-linked first, 50 listed. Clicking the row opens the search
  `link = [[Q4 offsite]]` (the unresolved-name rule in 2.1 makes it work).
- **Create** makes that note in the notes folder of the first linking note's
  workspace folder (existing `createMissingNotes`), without opening it; the
  list refreshes from the new index. Shown only for names that can be file
  names (`getExtractedNoteFileName`); otherwise the row says "cannot be a
  file name" in its detail.
- **Create all** creates every creatable listed-or-unlisted name, grouped by
  workspace folder, after a modal confirm: **"Create 17 notes for links that
  open no note?"**, detail "Each is an empty note named as the links write
  it, in the notes folder.", button **Create**. The existing "Created N notes
  for links that named no note." message follows.
- Empty state: **"Every link opens a note."**
- The Help "Broken links" card and README say Stats lists them.

### 2.8 Rename Tag box (5h)

`showInputBox` options:

- `title`: **"Rename #proj/atlas"**
- `value`: `#proj/atlas`, with `valueSelection` covering the name part
  (`atlas`: after the first `/`, or after the marker when there is no
  namespace).
- `prompt`: **"Type a new name to keep the namespace, or a whole tag starting with # or @."**
- `validateInput` returns, on every keystroke, an `InputBoxValidationMessage`:

| Input | Severity | Message |
| --- | --- | --- |
| not exactly one tag | Error | "Enter exactly one valid tag, such as #project/new-name or a bare new name." (unchanged) |
| resolves to the same tag | Info | "This is #proj/atlas already; nothing will change." |
| resolves to an existing tag | Info | "Merges into #project/atlas (42 entries)." |
| new tag, bare name containing `/` that gained the namespace | Warning | "Becomes a new tag #proj/project/atlas. Start with # to leave out proj/." |
| new tag otherwise | Info | "Becomes a new tag #proj/atlas-2026." |

Accepting a merge still goes through the existing modal `confirmMerge`.

### 2.9 Settings

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `deckard.tagOverview.includeHubLinks` | boolean | `true` | "On a tag's page, also list the entries that link to its hub note without carrying the tag, each marked \"Links the hub note\"." (`order` 7, after `hubNoteExpanded`) |

Preference (not a setting, like the sort): `hideDailyNotes: boolean`
(default `false`) in `PersistedPreferences`, normalized in `preferences.ts`.

---

## 3. Implementation steps

### 3.1 Core: backlinks and daily notes (shared groundwork)

`src/core/workspace/backlinks.ts`
- Add `note: string` (the written name, trimmed) to `WikiLinkOccurrence`;
  set it in `buildBacklinkIndex`.
- Add `getBacklinkIndex(index)` — a `WeakMap<WorkspaceIndex, BacklinkIndex>`
  cache. Replace the private cache in `noteLinks.ts` and the uncached call in
  `findOrphanNotes` (`dashboardState.ts:549`) with it.
- Add `findMissingLinkTargets(index): MissingLinkTarget[]` —
  `{ name, key, count, sourcePaths: string[] }` for occurrences with a
  non-empty `note` whose `findWikiTargetPaths(...)` is empty, grouped by
  lowercased name, sorted by count desc then name.

`src/core/markdown/parser.ts`
- Add `isDailyNoteFile(file: ParsedFile): boolean` (the `listDailyNotes`
  rule: `findDailyNoteDate(path, level-1 headings)`) and
  `isPeriodicNoteFile(file)` (`isDailyNoteFile || isPeriodicNotePath`).
- Use them in `listDailyNotes` (`dailyNote.ts:21`), `findOrphanNotes`, and
  `isPeriodicNode` (`notesGraph.ts:450`, which looks the file up by path).
  Piece 7's `deckard.isDailyNote` context key should use the same helper.

### 3.2 Query language (5a, 5e)

`src/core/query/queryTypes.ts`
- `QueryField` and `QUERY_FIELDS`: add `'link'` after `'tag'`.
- `QUERY_FIELD_OPERATORS.link = ['eq', 'neq']`.
- `QUERY_IS_VALUES`: add `'daily'`, `'periodic'`.
- `QueryFacet['id']`: add `'links'`.

`src/core/query/queryParser.ts`
- Token type `'link'` (value = inner text, plus `raw`). In `tokenize`, before
  the word scan: if `text.startsWith('[[', index)`, read to the next `]]`
  (no nesting); unclosed → the diagnostic in 2.1, token runs to end of text.
- `parsePrimary`: a `link` token → `createCondition('link', 'eq', value)`.
- `consumeValueToken`: accept `link` tokens; for any field but `link`, the
  value is the token's `raw` text (`[[x]]`), so `text ~ [[x]]` still means
  the characters.
- `startsPrimary`: include `link`.
- `FIELD_ALIASES`: `link`, `links`, `linksto`.
- `createCondition` for `link`: strip optional `[[`/`]]`, drop `|alias`,
  trim; `parseWikiTarget`; empty note → the 2.1 error; value stored as
  `note`, `note#heading`, or `note#^block`.
- `IS_VALUE_ALIASES`: `daily`, `journal` → `daily`; `periodic`, `dated` →
  `periodic`; update the error text.
- Update the grammar comment (`condition := … | linkToken`).

`src/core/query/queryFormat.ts`
- `formatCondition`: `link` → ``link ${op} [[${value}]]``.
- `quoteValue`: also quote a value that starts with `[[` (otherwise a text
  condition `[[x]]` would re-parse as a link). Round-trip test.

`src/core/query/queryLinks.ts` (new)
- `getQueryLinkState(index)`: WeakMap-cached. From `getBacklinkIndex`,
  builds `byUnit: Map<string, UnitLink[]>` keyed `section:<id>`,
  `task:<id>`, `file:<path>`, and `looseFiles: Set<string>`, using the
  ownership rule in 2.1. Per file: tasks by line; inline sections and
  heading-section own-body ranges scanned once per file.
- `UnitLink = { sourcePath, targetPath?, name /* lowercased */, heading? /* normalized */, block? }`.
- `resolveLinkQuery(index, value): LinkQuery` →
  `{ paths: Set<string>, name, heading?, block? }` via `createNoteTitleMap`.
- `matchesLinkQuery(links, query): boolean` implementing 2.1's rules.
- `countLinkTargets(index, units)` for the facet.

`src/core/query/queryEvaluator.ts`
- An evaluation context `{ index, links: LinkState, linkQueries: Map<string, LinkQuery>, periodic: PeriodicState }`
  passed to `matchesNode`/`matchesCondition` (currently index-free).
- `QueryUnit` gains `links?: UnitLink[]`, `daily?: boolean`,
  `periodic?: boolean`; `createSectionUnit`/`createTaskUnit`/`createFileUnit`
  fill them from cached per-index state (`PeriodicState` = two `Set`s of
  paths, WeakMap-cached).
- `matchesCondition` case `link`: `applyNegation(condition, matchesLinkQuery(...))`.
- `matchesIs`: handle `daily`/`periodic` **before** the `unit.kind !== 'task'` early return.
- `evaluateQuery`: file list is `membership > 0 || (hasLink && looseFiles.has(path))`,
  where `hasLink` = the query has any `link` condition (`getQueryFields`).
- `countTagMatches`/`countTagPairMatches` are unaffected (no link units).

`src/core/query/queryEdit.ts`
- No logic change; `getTopLevelTerms` works on spans. Add tests that a
  `[[Atlas plan]]` chip removes cleanly and that `extractTagTerms` leaves
  link terms in `rest`.

### 3.3 Suggestions, builder, facet (5a, 5e)

`src/ui/state/dashboardState.ts`
- `createQuerySuggestions`: `values.link` — note titles and aliases (via
  `createNoteTitleMap`), detail "Linked from N notes" from
  `getBacklinkIndex(...).toNote(path)` distinct sources, "alias of X" for
  aliases; sort by link count desc, then title; cap 200; WeakMap-cache the
  list per index.
- `IS_SUGGESTIONS`: add `is:daily`, `is:periodic` (details in 2.2).
- `describeQueryField`: `link` string (2.4); extend the `is` string.
- `createFileOverviewCard(file, { preamble })`: when `preamble` is set and
  the file has heading sections, `rawContent` is the text before the first
  heading. The snapshot passes it for files that entered through
  `looseFiles` (exposed as `results.linkOnlyFiles` or checked against
  `getQueryLinkState(index).looseFiles` minus tag membership).

`src/ui/state/searchFacets.ts`
- After the tags facet: `facet('links', 'Links to', countLinkTargets(...), 8)`,
  values `{ label: title, count, clause: '[[' + title + ']]' }`, leaving out
  targets the query already names (`visitConditions` on `link`).
- `isWritten` already escapes brackets; add a test.

`src/ui/webview/components.ts` (query editor)
- `DEFAULT_OPERATORS.link = ['eq','neq']`; `FIELD_PLACEHOLDERS.link = 'Atlas#Decision'`.
- `formatBuilderCondition`: `link` → `'link ' + op + ' [[' + stripBrackets(value) + ']]'`.
- `quoteQueryValue`: quote values starting with `[[` (mirror of `quoteValue`).
- `parseConditionText`: `/^(-?)\[\[(.+?)\]\]$/` → `row('link', neg ? 'neq' : 'eq', inner)`.
- `scanQuery`: add `\[\[[^\]]*(?:\]\]?)?` as the first alternative in the
  token pattern and a `link` piece kind (drawn like a word chip; negated in
  red like tags).
- `queryBarSuggestions`: when `prefix` matches `/(-?)\[\[([^\]]*)$/`, return
  `values.link` items with `value`/`label` `[[Title]]`, `insert: '[[Title]] '`,
  token = the matched `[[…`.
- `pendingRowSuggestions`: when the token starts with `[[` (or `-[[`),
  offer `values.link` as conditions `[[Title]]`.

`src/ui/state/quickFindState.ts`
- No change needed: an unclosed `[[Atl` fails to parse and the existing
  fallback (`withoutToken`) keeps the rest of the search's results. Add a test.

### 3.4 Linked from, Hide daily notes, Open as search (5a, 5e, 5f)

`src/core/types.ts`
- `NoteLinkEntry` gains `sectionText?: string`.
- New `NoteLinkGroup { filePath; title; updatedAt?; entries: NoteLinkEntry[]; linkCount }`.
- `NoteLinks`: replace `linkedFrom` with `linkedFromNotes: NoteLinkGroup[]`,
  keep `linkedFromCount` (occurrences), add `linkedFromNoteCount`,
  `hiddenDailyNoteCount`.
- `SidebarNotesSnapshot`: `hideDailyNotes?: boolean`.
- Messages: `{ type: 'setHideDailyNotes'; hide: boolean }`,
  `{ type: 'openLinksSearch' }` in `SidebarMessage`.

`src/ui/state/noteLinks.ts`
- `collectNoteLinks(index, file, { hideDailyNotes })`: group `toNote(...)`
  by `sourcePath`; drop groups whose source `isPeriodicNoteFile` when hiding
  (count them); sort groups by `updatedAt` desc then title; within a group
  by line. Take lines in that order up to `LIMIT` (50), keeping whole groups
  where possible. `sectionText` = the owning heading section's `bodyContent`
  minus its heading line, trimmed to 15 lines / 1,500 chars + "…".
- `createLinksSearchQuery(file, hide)`: `link = [[<noteTitle>]]` + ` -is:periodic`.

`src/ui/state/relatedNotesRanking.ts`
- `RelatedNotesRankingOptions.hidePeriodicNotes`; `rankRelatedNotes` skips
  candidates whose file `isPeriodicNoteFile`. `createSidebarSnapshot` puts
  `hideDailyNotes` on the snapshot.

`src/core/storage/preferences.ts`
- `hideDailyNotes` in `PersistedPreferences` (default `false`), normalizer,
  `setHideDailyNotes(hide)`.

`src/ui/webview/messages.ts` — `parseSidebarMessage` accepts both new messages.

`src/ui/webview/sidebarNotes.ts`
- Pass the preference into `collectNoteLinks` and the ranking options.
- `setHideDailyNotes` → `preferences.setHideDailyNotes`, refresh.
- `openLinksSearch` → `executeCommand('deckard.search', createLinksSearchQuery(...))`
  for the selected note (host-built, never webview text).
- `openSource` lookup reads `linkedFromNotes.flatMap(g => g.entries)`.

`src/ui/webview/sidebarNotesHtml.ts`
- `renderLinks`: groups, header, expander rows (`data-action="toggle-link-section"`,
  kept in a `Set` of `filePath:line` across redraws), the foot line, the
  "Hiding N daily notes." line.
- Header toggle `data-action="set-hide-daily"` beside the sort select;
  include `hideDailyNotes` in `getNoteListKey`.
- CSS: `.link-group`, `.link-group-head`, `.link-section` (pre-wrap, muted,
  `max-height` none — the text is already capped), expander button 28px.

### 3.5 Tag page (5b, 5c, 5d)

`src/ui/state/tagHygiene.ts`
- `findTagLookalikes(index, tagKey, limit = 3)`: runs
  `findTagMergeCandidates(index, Infinity)` once per index (WeakMap cache of
  the full candidate list) and filters pairs containing `tagKey`, returning
  `{ key, label, count, sourceKey, targetKey }`.

`src/ui/state/dashboardState.ts` — `createSearchPageSnapshot`
- New option `includeHubLinks` (default `true`).
- When `focusTag` has hubs and the option is on: evaluate
  `OR(link = [[hubTitle]] for each hub)`; add sections/tasks/files not
  already in `results` and not in a hub file; remember their ids in
  `viaHubIds`. Cards and `DashboardTask`s gain `via?: 'hubLink'`.
- `tagPage` block on the snapshot:
  `{ lookalikes: [...], hubLinkCount, hubTitle, mention?: { word, count, query } }`.
  `mention.query` built with `quoteValue`; counted via `evaluateQuery`.
- Extract the whole "results for this page" step into
  `evaluateSearchPage(index, parsed, options)` so
  `SearchPagePanel.currentResults()` (`searchPage.ts:734`) — Bulk edit and
  Export — uses the same union.

`src/ui/webview/searchPage.ts`
- Pass `includeHubLinks` from configuration; refresh on its change (next to
  `hubNoteExpanded`, line 73).
- Messages: `mergeTags { sourceKey, targetKey }` → `mergeIndexedTag(...)`,
  then `host.openTag(kept.key)` if the page's tag was the source;
  `excludeHubLinks` → `update('tagOverview.includeHubLinks', false, Global)`.
  Include/Show use the existing `setOverviewQuery`.

`src/ui/webview/messages.ts` — `parseSearchPageMessage` accepts both.

`src/ui/webview/searchPageHtml.ts`
- `renderTagNotes()` after `renderHub()`: the three lines (2.6).
- `renderCard`/`renderTask`: `via === 'hubLink'` → `<span class="card-via">Links the hub note</span>`.
- Coordinate with Piece 4d (hub panel becomes a text button) and 4a (clamped
  cards): the lines sit under the subtitle whichever form the hub takes.

`package.json` — the setting (2.9).

### 3.6 Stats (5g)

- `DeckardStatsSnapshot`: `missingLinkTargets: StatsMissingLink[]`
  (`{ name, count, sources: string[] /* first 3 titles */, sourceCount, creatable }`),
  `missingLinkTargetCount`. Filled in `createDeckardStatsSnapshot` from
  `findMissingLinkTargets`, 50 listed.
- `StatsMessage`: `{ type: 'createMissingNotes'; names: string[] }`
  (`names` capped at 500 in `parseStatsMessage`; an empty list means all).
- `stats.ts`: recompute the missing set from the current index, keep only
  requested names still missing and creatable, confirm (for "all"), group by
  the first source's workspace folder, call `createMissingNotes` per group.
- `statsHtml.ts`: the panel (2.7); row click posts `openSearch` with
  `link = [[name]]` (quoted via the same rule), Create posts one name.

### 3.7 Rename Tag (5h)

`src/ui/commands/renameTag.ts`
- `describeRenameTarget(index, sourceTag, value, options): { message, severity } | undefined`
  (pure, exported for tests) implementing the table in 2.8. Uses
  `parseRenameTag`, `resolveIndexedTagKey`, and `index.tags.get(...).count`.
  The "gained the namespace" case: no marker, value contains `/`, and the
  source has a namespace.
- `chooseReplacementTag(index, sourceTag, options)`: `title`, `value`,
  `valueSelection`, `prompt`, and `validateInput` mapping the result to
  `vscode.InputBoxValidationMessage` (`InputBoxValidationSeverity.Info/Warning`;
  Error stays a plain string so the box refuses Enter).
- `nameSelection(label): [number, number]` exported for tests.

---

## 4. Tests

### `npm test` (vscode-test, `src/test`)

`query-language.test.ts`
- `[[Atlas]]` parses to `link = Atlas`; `[[Atlas plan]]` is one condition;
  `[[Atlas|the plan]]` → `Atlas`; `-[[Atlas]]` → `neq`; `link:[[A]]`,
  `link = A`, `link = "Atlas plan"` all parse; `[[Atl` → the unclosed
  error; `[[#Decision]]` → the name error; `link > A` → operator error.
- `formatQuery` round-trips each; `text ~ "[[x]]"` stays a text condition
  after format → parse (the `quoteValue` fix).
- Evaluator on a fixture: heading-section own body answers, parent does not;
  a task line answers; an inline tagged line answers; front-matter `links:`
  and a heading-less note answer as files **only** for link queries (a
  `text ~` query over the same fixture returns what it did before);
  aliases resolve; `[[Atlas#Decision]]` matches only that heading, including
  `[[#Decision]]` inside Atlas; `[[Atlas]]` excludes Atlas's self-links;
  `[[Missing note]]` finds the unresolved links; code-fenced links never match.
- **Agreement test:** for every note in the fixture,
  `evaluateQuery(link = [[title]])` covers exactly the source lines
  `collectNoteLinks(...).linkedFromCount` counts.
- `is:daily` matches entries and tasks in `2026-09-25.md` and in a note whose
  H1 holds a date; `is:periodic` adds `week-…` and `2026-W39`; `-is:daily`
  inverts; `is:journal`, `is:dated` aliases.

`search-refine.test.ts` — the Links to facet counts, leaves out applied
targets, uses `[[Title]]` clauses, and `isWritten` finds a bracketed clause.

`query-builder-webview.test.ts` (jsdom via `webviewPage.ts`)
- The field select lists `link`; a `link` row with value `Atlas plan`
  writes `link = [[Atlas plan]]`; a value typed with brackets is not doubled.
- A pending row typed `[[Atl` offers `[[Atlas]]` and choosing it makes a
  `link =` row; `-[[Atlas]]` makes a `!=` row.
- The bar's `[[` completion inserts `[[Atlas plan]] `; a `[[Atlas plan]]`
  chip is one chip with one ×.
- `is` value list includes daily and periodic.

`note-links.test.ts`
- Groups by note, newest updated first; badge counts notes; `sectionText`
  trimmed and capped; `hideDailyNotes` drops daily/weekly sources and
  reports `hiddenDailyNoteCount`; `createLinksSearchQuery` output.

`related-notes-behavior.test.ts` — `hidePeriodicNotes` removes daily notes
from ranking; state becomes `noMatches` when nothing is left.

`messages-rendering.test.ts`
- Sidebar: `setHideDailyNotes`, `openLinksSearch` parse; the Links section
  renders groups, the expander toggles `aria-expanded` and keeps state across
  a redraw, the foot line reads "Open as search" / "12 more not listed. Open
  all as a search", "Hiding N daily notes." + Show them.
- Search page: the three tag-page lines render with their exact strings
  only on a one-tag snapshot; `card-via` text; `mergeTags` and
  `excludeHubLinks` parse.
- Stats: the missing-links panel, empty state, Create hidden for
  non-creatable names; `createMissingNotes` parse caps names.

`search-page-behavior.test.ts` / `view-state.test.ts`
- Tag with hub: link-only entries included, marked `via: 'hubLink'`, hub's
  own entries excluded, `includeHubLinks: false` leaves them out;
  `evaluateSearchPage` equals what Bulk edit/Export receive.
- Lookalikes on the tag snapshot; mention count and query (hub excluded,
  <3-char names and numeric names skipped).

`tag-hygiene.test.ts` — `findTagLookalikes` filters to the tag, caps at 3.

`stats.test.ts` — `findMissingLinkTargets` groups by case, counts, sorts,
excludes resolved and ambiguous names.

`source-commands.test.ts` — `describeRenameTarget` for each row of 2.8
(including `project/atlas` from `#proj/atlas` → Warning text exactly), and
`nameSelection` for `#proj/atlas`, `#atlas`, `@dana`.

`daily-notes.test.ts` / `notes-graph-state.test.ts` — the helpers keep
`listDailyNotes`, orphans, and the graph's pass-through unchanged.

`assistant-tools.test.ts` — `QUERY_SYNTAX_GUIDE` mentions `[[Note]]` and
`is:daily` (guards the docs change).

### `npm run test:e2e`
- `sidebarNotes.e2e.js`: Hide daily notes toggles and posts
  `setHideDailyNotes`; Open as search posts `openLinksSearch`.
- `searchPage.e2e.js`: on a tag page with a lookalike, Include in search
  posts `setOverviewQuery` with the OR search; Merge posts `mergeTags`;
  Show them posts the mention search.
- `stats.e2e.js`: Create and Create all post `createMissingNotes`; a row
  posts `openSearch` with `link = [[…]]`.

### `npm run test:ui`
- `verifyWebviews.js`/`checkWebviewScripts.js` pick up the new markup;
  `checkContrast.js` must pass for `.card-via`, `.link-section`, and the
  tag-page lines (muted text on panel). No new baseline in
  `contrast-baseline.json`.

### `npm run test:layout`
- The sidebar fixture gains a toggle in the header at 240px: must not wrap
  past the sort select or overflow. Add the Links section to the sidebar
  surface (fixture: pass `links` from `collectNoteLinks` with one group and
  one expanded row) so the grouped list and a long `sectionText` are checked
  at 240px.
- Search page (zen) fixture: add a hub note and a lookalike to the fixture
  workspace only in a **new** surface, so the existing search baseline's
  content is unchanged.

### Visual baselines to re-record (`test/ui/visual-baseline/darwin`)
- All 16 sidebarNotes baselines (`<theme>-sidebarNotes.png` and
  `<theme>+zen-sidebarNotes.png` for cooper, corpo, fellowship, lcars,
  oblivion, replicant, synthwave, tomcat) for the header toggle, in their
  own `test:` commit.
- `*+zen-searchPage.png`: expected unchanged (the fixture's `#project/atlas`
  has no hub, no lookalike, and no untagged mention); if the new layout
  surface adds a hub, re-record in the 5c commit's companion `test:` commit.
- Stats has no visual baseline.

Every commit is verified with all four suites, gated on exit codes.

---

## 5. Docs

**README.md**
- *Query language* (≈ line 723): a `link` row in the fields table, `[[Note]]`
  under "bare terms", `is:daily`/`is:periodic` rows in the shorthands table,
  one paragraph on what "links to" counts (aliases, headings, blocks, links
  to notes not written yet, front matter included, code fences not).
- *Search pages → a tag's page* (≈ line 597): the three lines, the "Links
  the hub note" mark, and `deckard.tagOverview.includeHubLinks`.
- *Related Notes* (≈ line 545): grouped Linked from, the expander, Open as
  search, Hide daily notes.
- *Stats* and *Rename and merge*: Links that open no note; the Rename box.
- Settings table: the new setting.

**Help (`src/ui/webview/helpHtml.ts`)**
- `#query`: fields table `link` row (Example `link = [[Atlas#Decision]]`),
  shorthands row `is:daily`, `is:periodic`; the intro sentence gains "a bare
  `[[Note]]` is a link condition".
- `#links` → "Broken links" card: "Stats lists every link that opens no
  note, with Create and Create all."
- `#connections` → Related Notes card: grouped Linked from, Open as search,
  Hide daily notes; Stats card: missing links.
- `#tidy` → Rename card: "The box starts from the old name and says, as you
  type, whether the new one merges or is new."; Tags that look alike card:
  "A tag's own page says how else it is written."; Hub notes card: "…and
  the entries that link to the hub are listed on the tag's page."

**CHANGELOG.md `## Unreleased`** (`### Added` / `### Changed`), one entry
per commit, bold lead sentence in the file's style, e.g.
- **Search: what links to a note.** `[[Atlas]]` or `link = [[Atlas#Decision]]` … (note under Changed: a search that already held `[[…]]` as words now reads it as a link.)
- **Search: `is:daily` and `is:periodic`.**
- **Related Notes: Linked from by note, and Hide daily notes.**
- **A tag's page: other spellings, hub links, and plain mentions.**
- **Stats: Links that open no note.**
- **Rename Tag says what will happen.**

**package.json** `deckard_query` `modelDescription`: add "link (link =
[[Note]] or a bare [[Note]] finds entries that link to a note; [[Note#Heading]]
one heading)" to Fields and "is:daily, is:periodic" to Shorthands.
`QUERY_SYNTAX_GUIDE` gets the same two sentences.

**docs/components.md**
- *The search box*: the `link` piece kind in `scanQuery` and the `[[`
  completion context.
- *Surfaces*: a short "Linked from" entry — `.link-group`, the expander, the
  foot action — and the tag page's quiet lines (`.tag-note`) as the pattern
  for page-level hints.

---

## 6. Commits

Ordered; each ships alone and passes all four suites.

1. `feat: a search finds the entries that link to a note, written [[Atlas]] or link = [[Atlas#Decision]]`
   — 3.1 backlinks groundwork, 3.2 (link half), builder parity in
   `components.ts` (field, operators, formatting, `parseConditionText`,
   `scanQuery`), `quoteValue` fix, Help/README/CHANGELOG, assistant and
   manifest descriptions. (Builder ships with the language, per the parity rule.)
2. `feat: [[ completes a note's name in the search box and the builder, and Refine narrows by what results link to`
   — `values.link`, bar and pending-row completions, Links to facet.
3. `feat: is:daily and is:periodic find what was written in daily, weekly, and monthly notes`
   — `isDailyNoteFile`/`isPeriodicNoteFile` refactor, parser, evaluator,
   suggestions, builder values, docs.
4. `feat: Linked from groups its lines by note, newest first, each opening onto its section, and opens as a search`
   — 5f + 5a's Open as search.
5. `feat: Related Notes and Linked from can leave out daily notes`
   — preference, toggle, ranking filter, "Hiding N daily notes."
6. `test: re-record the sidebar baselines for Hide daily notes`
7. `feat: a tag's page lists the entries that link to its hub note, each saying so`
   — 5c, setting, `evaluateSearchPage` shared with Bulk edit and Export.
8. `feat: a tag's page says how else the tag is written, with Include in search and Merge`
   — 5b.
9. `feat: a tag's page says how many entries name it in plain words without the tag`
   — 5d.
10. `feat: Stats lists the links that open no note, with Create and Create all`
    — 5g.
11. `feat: Rename Tag starts from the old name and says, as you type, what the new one will do`
    — 5h.

(Commits 7–9 each touch `createSearchPageSnapshot` and `searchPageHtml.ts`;
kept separate so each line can be reviewed and reverted alone.)

---

## 7. Size, risks, dependencies, questions

**Size:** about **9 days**.
5a core + builder 2.5 · completions and facet 1 · 5e 1 · 5f + Open as search
1 · Hide daily notes + baselines 1 · 5c 1 · 5b 0.75 · 5d 0.5 · 5g 1 · 5h 0.5.

**Risks**
- *Meaning change:* a saved search, query block, or board search that holds
  `[[…]]` today runs as words; after commit 1 it is a link search. Rare
  (it matched only the inner word), called out in the CHANGELOG.
- *Unit ownership:* the "own body" rule means `[[Atlas]]` under `## Risks`
  lists `## Risks`, not `# Standup` too. Chosen to avoid double results and
  to match body tags; the agreement test pins it.
- *Cost:* the link state is one pass over `BacklinkIndex` per index version,
  cached; `evaluateQuery` without a link or `is:daily` condition does no new
  work beyond two WeakMap lookups per unit. 5b's full candidate list is cached
  per index. 5d adds one `evaluateQuery` per one-tag page render; measure at
  5,000 notes (Piece 10's fixture) and skip the count past 150 ms if needed.
- *Search-page churn:* Piece 4 (4a clamp, 4d hub button, 4e snapshot
  restructure) rewrites the same function and card renderer.

**Dependencies**
- **Piece 4** (4a, 4d, 4e) before commits 7–9: they sit in
  `createSearchPageSnapshot` and the card/hub markup that Piece 4 changes.
  The Order of work already puts Piece 5 after Piece 4.
- **Piece 12d** (Stats "Needs attention") will move 5g's panel and count;
  either order works — 5g exposes `missingLinkTargetCount` for 12d's tile.
- **Piece 7** (`deckard.isDailyNote` context key, 7c) should reuse
  `isDailyNoteFile` from commit 3.
- **Piece 9** (9a/9d toggles and tooltips) may restyle the Hide daily notes
  toggle; this plan uses the current `.toolbar-toggle` + `aria-pressed`.
- **Piece 8** may reword the "Created N notes…" message 5g reuses.
- 5c depends on 5a (commit 1), as the plan says.

**Open questions for David:** none. Choices made here that he may want to
know: Hide daily notes also hides weekly and monthly notes (as the graph's
"Pass through daily notes" does) and is off by default; hub-link inclusion
is on by default with a one-click "Leave them out" and a setting.
