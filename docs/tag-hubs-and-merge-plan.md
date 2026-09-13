# Tag hubs, tag merge, and two quick wins — implementation plan

Four changes from `improvements.md`: improvement 7 (tag hub pages and merge)
and two quick wins (Extract Tagged Heading leaves a link behind, and opening
the Dashboard on startup). They share no code, so each section below can land
on its own.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| How a note becomes a hub | A `describes:` front-matter key naming one or more tags | Explicit, portable, and stored in the note. A folder or filename convention would have to guess, and would break when a tag is renamed. |
| `describes:` value syntax | The same as `tags:`: `project/atlas`, `"#project/atlas"`, or `"@dana"` | An unquoted `#` starts a YAML comment, so the bare form must work. Reusing the `tags:` rules also means Rename Tag already knows how to rewrite it. |
| Two notes describe one tag | The first by path is the hub; the overview names the others | Deterministic and visible. No note is silently hidden. |
| Where the hub shows | Between the header and the Notes/Tasks content of a plain tag overview | The overview already has an empty slot there (`relationships` in `tagOverviewHtml.ts`). Filtered and query views stay focused on their results. |
| Hub sections in the Notes list | Removed from the list | The body is already on screen, so listing it again would duplicate it. Tasks in the hub stay in Tasks. |
| Merge entry points | Rename Tag detects an existing target, plus `Deckard: Merge Tag…` with a picker of existing tags | Improvement 7 asks for renaming into an existing tag to become an explicit merge. The picker makes a deliberate merge easier than typing the target. |
| Merge confirmation | A modal warning with both counts, the overlap, and the merged total | Renaming back cannot reverse a merge, so it deserves a modal. |
| Duplicate tags after a merge | Drop the old tag where the kept tag already sits in the same tag run or front-matter list; replace it everywhere else | Removing a tag from the middle of prose would change the sentence. A duplicate there is harmless because the index de-duplicates keys. |
| Preferences on rename and merge | Move favorites, access order and counts, Dashboard tag selections, and saved views to the new key | Today even a plain rename leaves them on the old key. |
| Extract link form | A bare `[[note name]]` line where the section was | Matches Note Refactor, resolves under Deckard's exact-title rule, and leaves no duplicate tagged heading in the source. |
| Startup setting | `deckard.dashboard.openOnStartup`, default `false` | Matches the `deckard.editor.*` and `deckard.outline.*` grouping. Off by default, so nothing changes for existing users. |

---

## 1. Merge tags

### What happens today

`renameIndexedTag` stops only when the new key equals the old one
(`src/ui/commands/renameTag.ts`). Renaming `#project/apollo` to an existing
`#project/atlas` rewrites every occurrence and reports it as a rename. A line
that carried both tags ends up as `#project/atlas #project/atlas`, and
`projects: [atlas, apollo]` becomes `[atlas, atlas]`.

### `src/ui/commands/renameTag.ts`

1. **One edit planner.** Extract
   `planTagEdits(content, sourceKey, replacement, options)` and use it from
   both `replaceIndexedTag` and `createRenamePlan`, so the unit-tested function
   and the command cannot diverge.
2. **Remove instead of duplicating.** Group spans by *container*: the
   front-matter field for a front-matter value, otherwise the source line.
   Walk the source spans in order. If the container already held the kept
   tag before the rename and the span is removable, emit a removal; otherwise
   emit the replacement. A plain rename therefore keeps its source's shape.
   - A front-matter value is always removable. A block item `- apollo` loses
     its whole line; an inline item in `[atlas, apollo]` loses the value, its
     quotes, and one comma.
   - An inline tag is removable only when it touches another tag with nothing
     but whitespace between them (`# Plan #atlas #apollo`,
     `- [ ] Ship #apollo #atlas 📅 …`). It then loses the whitespace on one
     side. `Talked to #atlas about #apollo` keeps its sentence and gets a
     harmless duplicate.
3. **Detect a merge.** After parsing the replacement, resolve it against the
   index. If that tag exists, the rename is a merge.
4. **Summarize.** `summarizeTagMerge(index, sourceKey, targetKey)` returns both
   tags, the merged entry count (the union of section, task, and file IDs,
   counted the way `buildWorkspaceIndex` counts), the overlap, and each tag's
   hub notes.
5. **Confirm.** A modal `showWarningMessage` with a **Merge** button:

   > Merge #project/apollo into #project/atlas?
   >
   > #project/apollo has 12 entries and #project/atlas has 30. 4 carry both,
   > so #project/atlas will have 38. Every #project/apollo in your notes
   > becomes #project/atlas, and renaming it back later cannot separate them.

   When both tags have hub notes, add which one stays the hub and that the
   other will be listed as a second one.
6. **Report.** "Merged #project/apollo into #project/atlas in N occurrences."
7. **`mergeIndexedTag(indexer, preferences, sourceKey?)`** backs a new
   `Deckard: Merge Tag…` command. It picks the tag to merge (reusing
   `chooseIndexedTag`), then the tag to keep from every other tag with its
   entry count, then follows the same confirm-and-apply path.

### Preferences — `src/core/storage/preferences.ts`

`replaceTagKey(sourceKey, targetKey)` rewrites, in one update:

| Field | Rule |
| --- | --- |
| `favoriteTags`, `favoriteEntities` | Replace, de-duplicate |
| `tagAccessOrder`, `entityAccessOrder` | Replace, keep the earlier position |
| `tagAccessCounts`, `entityAccessCounts` | Add the old count to the new key |
| `dashboardViewState.selectedTaskTags`, `selectedNoteTags` | Replace, de-duplicate |
| `savedFilters[].tagKeys` | Replace and de-duplicate; drop a tag-set view left with fewer than two tags, as `prune` does. Query views keep their text. |

`renameIndexedTag` and `mergeIndexedTag` take an optional `PreferencesStore`
and call it **before** `indexer.refresh()`, so pruning never sees the old key
alone. Every caller passes its store.

### Contributions

- `package.json`: `deckard.mergeTag` ("Deckard: Merge Tag…") after
  `deckard.renameTag`. `extension.ts` registers it.
- The Help page's **Rename tags** card and the README gain a sentence on
  merging.

---

## 2. Hub notes

### Syntax

```markdown
---
describes: project/atlas
status: active
owner: "@dana"
---
# Atlas

Migration of billing onto the new ledger.
```

`describes:` also accepts a list (`[project/atlas, proj/atlas]`), a quoted
`"#project/atlas"`, and people (`"@dana"`).

### Parser — `src/core/markdown/parser.ts`

- Treat `describes` like `tags` when turning values into tags and tag spans.
  The hub is then tagged with what it describes, and Rename Tag rewrites the
  value. `getFrontmatterReplacement` in `renameTag.ts` treats `describes`
  like `tags`, so a bare value stays bare.
- Return `describes` and `properties` from `parseFrontmatter`. `ParsedFile`
  gains `hub?: { describes: TagReference[]; properties: FrontmatterProperty[] }`,
  set only when `describes` is present. Each property is
  `{ name, values: { text, tag? }[] }`, with `tag` set when a value is a tag
  (`owner: "@dana"`). `describes`, `tag`, and `tags` are left out of
  `properties`.
- `normalizeParsedTagReferences` normalizes `hub.describes` and property tags
  through the namespace aliases.

### Index — `src/core/workspace/indexer.ts`

`buildWorkspaceIndex` collects hub files per tag key, sorts them by path, and
sets `TagInfo.hubFilePaths`. The first path is the hub; any others are
conflicts.

### Snapshot — `src/ui/state/dashboardState.ts`

`createTagOverviewSnapshot` adds, for a plain overview with no filter tags:

```ts
hub?: {
  filePath: string;
  fileName: string;
  rawContent: string;      // body after the front matter
  renderedHtml: string;
  properties: FrontmatterProperty[];
  otherFilePaths: string[];
};
```

The page itself offers **Create hub note** when a plain overview has no hub,
so the snapshot needs no extra flag. Sections and file cards from the hub file are left out of `sections`, and so
out of the Notes count.

### Tag Overview — `tagOverviewHtml.ts` and `tagOverview.ts`

`renderHub()` fills the empty `relationships` slot:

- A **Hub note** eyebrow, the file name, and an **Open** button that posts the
  existing `openSource` message.
- A property list such as `status: active` and `owner: @dana`. Tag values
  render with `renderTagButton`, so they open their own overviews.
- The body, following the page's Source/Rendered toggle like the cards do.
- For a conflict: "Also described by Apollo.md", with an open link.
- With no hub, a quiet row reading "No note describes #project/atlas yet." and
  a **Create hub note** button that posts `{ type: 'createHubNote' }`.

Styles stay page-local, as `components.md` asks until a second page needs
them.

### Creating a hub — new `src/ui/commands/hubNote.ts`

- `getHubNoteName(tag)`: the entity name in title case
  (`#project/skybridge-signal` → `Skybridge Signal`), or the tag without its
  marker.
- `createHubNoteContent(tag, title)`: front matter with `describes:` (bare for
  `#` tags, quoted for people) and a `# Title` heading.
- `createHubNote(indexer, tagKey)`: writes `<notes folder>/<name>.md` without
  ever overwriting. If the file exists, warn and offer **Open**, so the user
  can add `describes:` themselves. Then open the new note.

### Hover — `referenceState.ts` and `editorReferences.ts`

`TagSummary` gains `hubFilePath`, and the tag hover shows `Hub: [Atlas](…)`
above the entry list.

---

## 3. Extract Tagged Heading leaves a link

`extractHeadingNote` currently deletes the section from the source. Instead,
`replaceSectionWithLink` (renamed from `removeSectionFromSource`) replaces
exactly the deleted range with `[[<note name>]]` followed by the same trailing
line breaks the section had, so the spacing around it does not change:

```markdown
# Case #case
Introduction.

[[lead-note]]

## Next
```

The link target is the file name without `.md`, which is the title that
`[[links]]` resolve against. If the save fails, the rollback replaces the
inserted link with the original text, using the exact range that was edited.

The README's **Extracting headings** section and the Help command list change
"removed from the source note" to "replaced by a `[[link]]` to the new note".

---

## 4. Open the Dashboard on startup

- `package.json`: `deckard.dashboard.openOnStartup`, boolean, default `false`:
  "Open the Deckard Dashboard when VS Code starts in a workspace with indexed
  notes."
- `DashboardPanel.showOnStartup()` waits for `indexer.ready`, then opens the
  Dashboard only when the index has files and no Dashboard was restored.
  Waiting for the first index also gives VS Code's panel serializer time to
  restore a Dashboard from the last session first, so the setting never opens
  a second one or steals focus from a restored one.
- `extension.ts` calls it at the end of `activate` when the setting is on. The
  extension already activates on `onStartupFinished`.
- README settings table and JSON block, and the Help page's settings list.

---

## 5. Edge cases

| Case | Handling |
| --- | --- |
| The target is an alias of the source (`#proj/atlas` → `#project/atlas`) | Both resolve to one key, so the existing "already uses that tag identity" message stands. |
| The source appears twice in one tag run (`#old #old`) | Both are replaced, as a plain rename always has. Only a copy of the kept tag that was already written causes a removal. |
| A file changed after indexing | The existing stale-file refusal applies to merges too. |
| An open Tag Overview on the merged tag | Same as rename today: the overview that started it opens the kept tag. |
| A hub for a tag that appears nowhere else | The hub is itself tagged, so the tag exists and its overview shows just the hub. |
| `describes: #project/atlas` without quotes | YAML reads it as a comment, so nothing is parsed. The README example uses the bare form and says why. |
| A long hub body | Rendered in full; collapsing it is deferred. |
| Extracting a section at the end of a file | The link keeps whatever trailing newline the section had. |
| The startup setting on in a workspace without notes | Nothing opens, because the index is empty. |

---

## 6. Files touched

| File | Change |
| --- | --- |
| `src/ui/commands/renameTag.ts` | Edit planner, de-duplication, merge detection, summary, confirmation, `mergeIndexedTag`, preference migration |
| `src/core/storage/preferences.ts` | `replaceTagKey` |
| `src/core/markdown/parser.ts` | `describes:` and hub properties |
| `src/core/types.ts` | `ParsedFile.hub`, `FrontmatterProperty`, `TagInfo.hubFilePaths`, the overview hub, `CreateHubNoteMessage` |
| `src/core/workspace/indexer.ts` | Hub collection |
| `src/ui/state/dashboardState.ts` | The hub in the overview snapshot |
| `src/ui/state/referenceState.ts`, `src/ui/commands/editorReferences.ts` | The hub in the tag hover |
| `src/ui/commands/hubNote.ts` | New: create a hub note |
| `src/ui/webview/tagOverview.ts`, `tagOverviewHtml.ts`, `messages.ts` | Hub rendering and `createHubNote` |
| `src/ui/webview/dashboard.ts`, `sidebarNotes.ts`, `src/extension.ts` | Pass preferences to rename; `showOnStartup` |
| `src/ui/commands/extractHeading.ts` | A link instead of a deletion |
| `package.json` | `deckard.mergeTag`, `deckard.dashboard.openOnStartup` |
| `README.md`, `CHANGELOG.md`, `src/ui/webview/helpHtml.ts`, `improvements.md` | Documentation |

---

## 7. Testing

- `source-commands.test.ts`
  - A merge drops the old tag from a heading tag run and a task line, keeps
    prose intact, and de-duplicates inline and block front-matter lists.
  - Rename rewrites `describes:` values, bare and quoted.
  - Extraction leaves `[[lead-note]]` with the original spacing, including at
    the end of a file.
- `preferences.test.ts`: `replaceTagKey` moves favorites, adds counts, keeps
  order, rewrites saved views, and drops one left with a single tag.
- `markdown-parser.test.ts`: `describes:` in bare, quoted, list, and person
  forms; properties with tag values; aliases normalized.
- `workspace.test.ts`: hub collection and conflict order.
- `view-state.test.ts`: the overview snapshot carries the hub, drops its
  sections, and omits the hub for filtered views.
- `messages-rendering.test.ts`: the Tag Overview script renders the hub and the
  create button, and `createHubNote` parses.
- `extension.test.ts`: the new command is contributed and the new setting
  defaults to `false`.
- Unit tests for `summarizeTagMerge`, `getHubNoteName`, and
  `createHubNoteContent`.
- `npm test`, `npm run test:ui`, and `npm run test:e2e`.

---

## 8. Suggested order

1. Extract leaves a link: the smallest, independent change.
2. Open the Dashboard on startup.
3. `replaceTagKey`, wired into plain rename. On its own this fixes today's
   rename leaving favorites behind.
4. Merge: the edit planner and de-duplication, then detection, summary,
   confirmation, and the command.
5. Hub notes: parser, index, snapshot, Tag Overview, creation, hover.
6. Documentation.

---

## 9. Deliberately deferred

- **Merge into…** in the webview right-click menu. **Rename tag** there already
  merges when given an existing tag; a picker needs a new message type in
  three webviews.
- Undoing a merge. Recording every rewritten span is possible, but it is a
  separate feature.
- Per-namespace hub templates (improvement 3) and typed property schemas
  (earlier roadmap).
- Collapsing a long hub body.
- A command that turns the current note into a hub.
- Rewriting tag names inside saved query text on rename or merge.
