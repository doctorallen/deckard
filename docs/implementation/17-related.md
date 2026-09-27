# Plan 17 — Related Notes: untagged notes, and excerpts

Workstream: the two Related Notes rows of "Larger features the sources point
to" in `docs/ux-fifteen-sources-plan.md`, plus decision 4 as it applies to
Related Notes cards, and the Precision@5 fixture from `docs/todo.md`.
Written against `dev` at `726d23b` (v1.22.0). Nothing here is built.

---

## 1. Scope

| Item | Status after verification |
| --- | --- |
| **L1. Related Notes for untagged notes** (BM25 under "Similar wording (no tags yet)", rail capped at weak, "Tags these notes use" with Add + Undo) | **Kept, one change of condition** (below). |
| **L2. Excerpts in Related Notes** (two-line excerpt, matched words marked, Preview lines 0 / 1 / 2, default 1) | **Kept.** The sidebar has no gear today; this plan adds one. |
| **Decision 4** (card views: tag chips subtler) for Related Notes cards | **Kept as a thin follow-on commit** that applies Piece 4's quiet-chip style. Piece 4 owns the look. |
| **Precision@5 evaluation fixture** (`docs/todo.md:11`) | **Kept**, first commit, so L1 is measured against a baseline. |
| **Bug found: changing Sort does not re-sort** | **Added.** See "Verified" below; a one-line fix. The Preview row needs the same refresh. |
| **Bug found: `appendTagToLine` writes after closing ATX hashes and after a `^block-id`** | **Added**, because Add uses it. It also fixes Bulk edit → Add a tag on those lines. |

### What was verified in the source

- `createSidebarSnapshot` (`src/ui/state/relatedNotesRanking.ts:103-108`)
  returns `noTags` when there are no ranked notes **and** `collectFileTags`
  finds no tag anywhere in the note: front matter, heading, inherited, inline,
  or task. Confirmed.
- An untagged note never gets an entry scope: `findTaggedEntry`
  (`sidebarNotes.ts`) only matches tagged headings, tagged inline lines, and
  tagged tasks. So for an untagged note the "entry" is always the whole note,
  and `createLexicalModel(index, activeFile)` (`wordSimilarity.ts`) takes its
  query terms from the whole of `activeFile.content`.
- Eligibility is enforced in `rankRelatedNotes` (the comment at
  `relatedNotesRanking.ts` ~225: "Shared wording only adjusts the score…"),
  and pinned by `view-state.test.ts:1030` ("never lists an entry that only
  shares wording with the note"). That rule stays exactly as it is; L1 is a
  separate function and a separate list.
- The capped lexical weight is `min(0.3, raw / (raw + 1))`, so a
  wording-only score is at most 30, and `getWeightLevel` (`components.ts:1320`)
  gives level 1 below 0.375. "Rail capped at weak" falls out of the existing
  cap; the plan clamps it explicitly as well so a later formula change
  cannot promote it.
- `noTags` renders only `This note has no tags yet.`
  (`sidebarNotesHtml.ts:385`).
- **Condition change.** A note with no tags but one `[[link]]` to another note
  is in state `ready` (the link qualifies that note), not `noTags`. Taken
  literally, "noTags only" would make the suggestions vanish the moment a
  journal entry links a project, which is the common case for untagged daily
  notes. The plan uses **"the note has no tags"** (`activeTags.length === 0`),
  which is `noTags` plus that link-only `ready` case. For any note with a tag,
  nothing changes: wording alone still never makes a note related. This is a
  design choice inside the decision's intent, not a question.
- The sidebar has **no gear**. It has an in-page Sort `<select>`
  (`sidebarNotesHtml.ts:500`) and five view title-bar actions
  (`package.json:536-560`). The shared gear is `renderViewOptions` /
  `renderViewOptionChoices` in `components.ts:2012-2049`, and the sidebar
  already loads `getComponentScript()`.
- `markWords(root, words)` exists in the component script since `bcb40de`, so
  the sidebar can call it. It matches substrings (`art` inside `start`); the
  plan adds a word-start option.
- **Sort bug.** `handleValidMessage` for `setRelatedNotesSort` calls
  `preferences.setRelatedNotesSortMode` and returns. `SidebarNotesView` never
  subscribes to `preferences.onDidChange` (only `extension.ts:210` does, for
  pins). So the list is not re-sorted until the next refresh from a save or
  cursor move, and a redraw in between puts the `<select>` back to the old
  value. Confirm in the Extension Development Host before fixing.
- `appendTagToLine` (`bulkEdit.ts:70`) appends at the very end of the line.
  On `## Title ##` that gives `## Title ## #tag`, which is no longer a closing
  sequence (`hasAtxHeadingClosingHashes`, `parser.ts:1764`). On `… ^abc` the
  block id stops being last on the line, so it no longer reads as a block id.
- `rankRelatedNotes` is also used by Home's Related notes widget
  (`dashboardWidgets.ts:360`). L1 does not change that widget: its empty
  state stays as it is. Home is a summary; the suggestions and Add belong
  beside the editor.
- There is no excerpt helper to reuse. `quickFindState.ts` has private
  `cleanExcerpt` and `firstLine`, and `referenceState.ts` has
  `limitExcerpt`. None strips tags or task metadata. The plan adds one
  shared pure helper that Piece 4a (the search snippet) and Piece 5f (Linked
  from rows expanding) can also use.

---

## 2. Design

### 2.1 L1: a note with no tags

**When.** The note being read has no tags at all, and
`deckard.enableKeywordLinks` is on (the default). With the setting off, the
sidebar says `This note has no tags yet.` as it does today, and suggests
nothing: the setting already means "don't use wording".

**What the sidebar shows, top to bottom:**

1. The folded **Current note** context, as today.
2. The Sort row, now with the gear (2.2).
3. Only when the note links to or from other notes: **Related notes**, the
   link-qualified results, as today.
4. **Tags used by similar notes**: 1 to 5 rows, if any qualify.
5. **Similar wording (no tags yet)**: up to 10 cards.
6. **Linked from** / **Mentioned without a link**, as today (see 2.4 on 5f).

The tags come before the cards because tagging the note is the way out of the
weak state, and ten cards would push them off a sidebar's first screen.

**Strings (exact).**

| Where | Text |
| --- | --- |
| Tags section label | `Tags used by similar notes` |
| Tag row (button text) | `#risk/vendor` then a count, `3` |
| Tag row `title` | `On 3 of the similar entries below. Add writes it on the heading or line where the cursor is.` |
| Add button | `Add` |
| Add `aria-label` | `Add #risk/vendor to this note` |
| Cards section label | `Similar wording (no tags yet)` |
| Hint under the cards label | `These share words with this note, not tags or links.` |
| A card's reason line | `Similar wording: continuity, northern, supply` (top three terms) |
| Rail `aria-label` | `Relevance weak, 24 of 100. Show how this was scored.` (existing template) |
| Nothing similar | `This note has no tags yet, and no other entry shares enough of its wording to suggest any.` |
| Toast after Add, heading | `Added #risk/vendor to "Vendor audit".` [Undo] |
| Toast after Add, line | `Added #risk/vendor to line 12.` [Undo] |
| Undo when the line has changed since | `Line 12 changed after the tag was added, so Deckard left it as it is.` (Warning) |
| Add with no editor on the note | `Open the note in an editor, and put the cursor where the tag should go.` (Information) |
| Add in a note with no line to tag (empty note) | `Write a heading or a line first, then add the tag to it.` (Information) |
| Undo Last Change prompt label | `#risk/vendor on "Vendor audit"` → `Undo #risk/vendor on "Vendor audit"?` |

The Tag row is drawn like the note's own tags and Refine's rows
(`.tag-open.active-tag-open`, full width, the tag and a count), with a small
`Add` button at its end, the same shape as `link-one` in Linked from. Clicking
the tag itself opens its page, as every tag does; only `Add` writes.

**Ranking (a new function; the existing ranker is not touched).**
`rankSimilarWording(index, activeFilePath, activeFile, options)` in
`relatedNotesRanking.ts`:

- **Query terms.** The note's terms by tf·idf, top 25 (Lucene's
  MoreLikeThis default of 25 query terms). This keeps a long journal note
  from matching everything. Commonplace terms (in over half the entries) and
  stop words are already excluded by `wordSimilarity.ts`.
- **Candidates.** Only entries that contain a query term, found through a
  term → entries postings map built once per index and cached in a
  `WeakMap<WorkspaceIndex, …>`, as the corpus is. Sections and tasks from
  other files. A task under a section that is also listed is dropped, as the
  tagged ranker does.
- **Score.** Raw BM25 sum (`getLexicalWeight` extended to also return
  `rawWeight`), used for **order**. The **displayed** score is
  `min(30, round(min(0.3, raw / (raw + 1)) * 100))`, so the rail is weak
  (1 of 3) at most.
- **Floor.** An entry needs **two shared terms**, or **one term whose
  contribution alone is at least 1.5** (a rare word). The fixture (§4)
  calibrates both constants.
- **Spread.** At most **2 entries per file**, and **10** in all. No Show
  more: this is a weak hint, and its first screen is its use.
- **Sort.** The Sort control applies (`sortRelatedNotes`), as it does to the
  main list.
- Recency, links, and tags play no part, since the note has none of the
  last two. If recency is on it still breaks ties.

**Suggested tags.** From the listed entries (after the floor, before
Sort):

- Each entry contributes its `tags` (canonical keys, including inherited
  heading and front-matter tags), weighted by its raw BM25 score.
- Each tag's sum is multiplied by `ln(1 + entries / (1 + tagEntries))`, where
  `tagEntries` is the tag's notes plus tasks from `countTagMatches`, so
  `#daily` on every journal note does not lead.
- Left out: person tags (`isPersonTag`), and tags in the board's status
  namespace (`deckard.board.statusNamespace`, passed in through
  `RelatedNotesRankingOptions.excludedTagNamespaces`).
- Kept: tags on at least **2** listed entries. If fewer than 3 are left,
  single-entry tags fill up to 3 by score. At most **5**.
- Each row carries `{ key, label, entryCount }`. The label is the most
  common source spelling.

**Where Add writes.** A pure function
`findTagTarget(lines, cursorLine)` in `src/core/markdown/tagTarget.ts`:

1. Front matter and fenced code are skipped: a cursor inside either is
   treated as a cursor on the nearest line above that is outside them.
2. The cursor is on a heading → **that heading**.
3. The cursor is on a task or list item → **that line**. With
   `parseInlineTags` on, the line becomes its own tagged entry.
4. Otherwise, the nearest heading above → **that heading**, which tags the
   whole section.
5. No heading above, and the cursor line is non-blank prose → **that line**.
6. Otherwise, the first heading below the cursor. If there is none, the
   first non-blank line. If there is none, nothing (the "Write a heading…"
   message).

The target is worked out when Add is pressed, from the live document and
cursor, not from the snapshot. The sidebar does not refresh on cursor moves
in an untagged note, so a target named on the button would go stale. The
toast is what names it.

**How Add writes.** `appendTagToLine` puts the tag before a closing ATX
sequence (`## Title #risk/vendor ##`) and before a trailing `^block-id`. A
line that already carries the tag is left alone, and the toast says
`This line already has #risk/vendor.` The write goes through
`applyWorkspaceWrite` (label as above, `preview: 'never'`), so the note is
saved, the index updates, **Undo Last Change** takes it back, and the
editor's own Ctrl/Cmd+Z works because the edit lands in the open document.
The toast's Undo reverts the one line if it is still what was written, the
same approach as `taskActions.ts` `offerUndo`, with no modal.

After an Add the note has a tag, so the sidebar switches by itself to the
ordinary ranking, now by that tag. Undo switches it back.

### 2.2 L2: excerpts, and the sidebar's gear

**Excerpt.** Each section card (not a task card, and not an inline tagged
line, whose title is its whole text) carries `excerpt?: string`, up to 240
characters:

- **Prose lines** of the section's own body (`bodyContent`, not its
  children's), in order, with these removed: the heading line, front matter,
  fenced code, blank lines, tables, horizontal rules, image-only lines, and
  lines that are only tags. Task lines are used only if the section has no
  other prose.
- **Cleaned**: tags removed (`stripTags`), task metadata removed (dates,
  priority, 🔁, ✅), `^block-ids` removed, `[[Target|Alias]]` → `Alias`,
  `[[Target]]` → `Target`, `[text](url)` → `text`, emphasis and code marks
  dropped, list and quote markers dropped, whitespace collapsed.
- **Which line.** If the card has matched wording terms, the excerpt starts
  at the first prose line containing one of its top three terms. Otherwise
  it starts at the first prose line. It continues through the next prose
  lines up to 240 characters and is cut at a word boundary with `…`. If it
  starts after the first prose line it is prefixed with `…`.
- An excerpt equal to the card's title is dropped.

The source spec says "first prose line". Starting at the line that holds a
matched word, when there is one, is what makes marking it useful (it is also
what `ux-research-plan.md` 4b's centered snippet does). Otherwise it is the
first prose line, as specified.

**Marked words.** The page marks the card's top five lexical terms inside
`.note-excerpt` with `markWords(root, words, { wordStart: true })`. The new
option anchors the match at a word start, so `route` marks `routes` but
`art` does not mark `start`. Search pages keep the current behavior unless
they pass the option.

**Clamp.** `.note-excerpt` uses `display: -webkit-box;
-webkit-box-orient: vertical; -webkit-line-clamp: var(--preview-lines);
overflow: hidden`, in `var(--muted)` at `--text-xs`, line-height 1.4.
`<main data-preview-lines="0|1|2">` sets the variable. At 0 the element is
not rendered at all.

**Card order.** Title and actions → file and line → heading path →
**excerpt** → reason → tag chips.

**The gear.** The Sort row becomes a flex row:
`[Sort select (flex: 1)] [gear]`, using `renderViewOptions`. It is shown in
`ready`, in `noTags` / `noMatches` when there are cards, and not in graph,
refine, or loading states. Its first row:

| Row label | Choices | `aria-label` |
| --- | --- | --- |
| `Preview` | `None` · `1 line` · `2 lines` | `Preview lines` |

No zen row: the sidebar has no zen handler, and zen follows the pages' own
gears. Piece 5e's **Hide daily notes** is meant to join this gear as a second
row (see §7).

**Setting.** A **preference**, like the Sort mode, not a VS Code setting:
`relatedNotesPreviewLines: 0 | 1 | 2`, default `1`, normalized in
`preferences.ts` (anything else → 1). Message
`{ type: 'setRelatedNotesPreviewLines', lines: 0 | 1 | 2 }`.

### 2.3 Decision 4 on Related Notes cards

Cards draw tags in two places: the title's inline tags
(`renderInlineTitle`, the default `inline` mode) and the `.tag-list` of
matched tags (`separate` mode). Both take the quiet card-tag class Piece 4
defines. The note's own tag rows in the context fold and the Tags used by
similar notes rows are **controls**, not card chips, and keep their row
style. The excerpt never shows tags (they are stripped), so it cannot add
chips back.

### 2.4 Living with Piece 5f (Linked from grouped by note)

- Linked from stays below everything in 2.1 and 2.2. 5f regroups it by
  source note and expands rows on demand. The Preview gear row applies only
  to Related Notes and Similar wording cards, never to Linked from rows, so
  the two features do not both decide how much text a row shows.
- 5f's expansion should use this plan's `readProseLines` /
  `formatExcerpt` helpers (§3, step 3a), so both strip Markdown the same way.
- If a similar-wording card and a Linked-from row name the same entry, both
  stay: one is "why it's related", the other is "where it links". This is
  the same as today's link-qualified cards.

### 2.5 The setting's description

`deckard.enableKeywordLinks` → `Let capped, section-scoped similarity of wording adjust the score of a related note that already shares a tag, association, or Wiki link, and list entries with similar wording under a note that has no tags yet. For a note with tags, shared wording never makes another note related on its own. Disable to rank by tags and links alone.`
Piece 8f rewrites this group's descriptions as well. Whichever lands second
keeps both changes.

---

## 3. Implementation steps

### Step 0: fixture (commit 1)

- `src/test/relatedNotesFixture.ts` exports `createEvaluationWorkspace()`,
  which returns `{ index, files, cases }`. Each case is
  `{ name, activeFilePath, cursorLine?, relevant: Set<string>, never: Set<string> }`,
  with results identified as `path:line`.
- `src/test/related-notes-evaluation.test.ts` gives `precisionAt(k, ranked,
  relevant)` and one test per case (§4).

### Step 1: Sort refresh (commit 2)

- `sidebarNotes.ts` `handleValidMessage`: after `setRelatedNotesSortMode`,
  call `this.refresh()`. This is the smallest fix. Subscribing to
  `preferences.onDidChange` would refresh on every access-count write.

### Step 2: excerpts and the gear (commit 3)

- **3a.** New `src/core/markdown/proseExcerpt.ts`:
  - `readProseLines(markdown: string, options?: { personMarker?: string }): string[]`
    holds the stripping rules in 2.2. It reuses `stripTags`,
    `findFencedLines`, and the task metadata stripping from
    `parseTaskMetadata` (read what it returns as clean text; add an export
    if it has none).
  - `formatExcerpt(lines: string[], terms: string[], maxChars = 240): string | undefined`.
- **3b.** `src/ui/state/entryExcerpt.ts` has
  `getSectionProseLines(section, fileSections)`, cached in a
  `WeakMap<Section, string[]>` over `getSectionLexicalContent`. Sections are
  replaced, never mutated, on re-index (the same reasoning as
  `wordSimilarity.ts`).
- **3c.** `types.ts` `RankedNote` gains `excerpt?: string`.
  `rankRelatedNotes`: for a reference with a `sectionId` whose section is not
  `isInline`, set
  `excerpt = formatExcerpt(getSectionProseLines(...), lexicalEvidence.terms.slice(0, 3).map(t => t.term))`,
  dropped if it equals the title. Home's widget ignores the field.
- **3d.** `preferences.ts`: `relatedNotesPreviewLines` in the default (1),
  normalization, and `setRelatedNotesPreviewLines`. Check
  `preferences-invariants.test.ts` and prune/backup lists for a field
  registry.
- **3e.** `types.ts` `SidebarNotesSnapshot` gains `previewLines?: 0 | 1 | 2`.
  `sidebarNotes.ts` `createSnapshot` sets it from preferences. `messages.ts`
  `parseSidebarMessage` accepts `setRelatedNotesPreviewLines` with `lines ∈
  {0,1,2}`. The handler sets the preference, then `this.refresh()`.
- **3f.** `components.ts` `markWords(root, words, options)`: with
  `options.wordStart` the pattern is prefixed with
  `(?<![\p{L}\p{N}])` (flag `u`). Keep the skip list (buttons, tags, code).
- **3g.** `sidebarNotesHtml.ts`:
  - CSS: `.related-notes-toolbar` (flex, gap), `.note-excerpt` clamp,
    `main[data-preview-lines="1"] { --preview-lines: 1 }` and the same for 2.
  - `render()`: wrap the sort control and `renderViewOptions([{ label: 'Preview', html: renderViewOptionChoices('set-preview-lines', [[0,'None','No preview'],[1,'1 line','One line'],[2,'2 lines','Two lines']], state.previewLines ?? 1, 'Preview lines') }])`
    in the toolbar. Set `main.dataset.previewLines`. Add
    `'<p class="note-excerpt">' + escapeHtml(note.excerpt) + '</p>'` when
    `note.excerpt && previewLines > 0`.
  - After `innerHTML`, for each `.note[data-terms]` call `markWords`. The card
    carries `data-terms` (space-separated, escaped) so the script needs no
    second lookup.
  - Call `installViewOptions()` once. Handle a click on
    `[data-action="set-preview-lines"]` → `postMessage`.
- Edge cases: a section whose body is only a code block has no excerpt; a
  CRLF note; a very long single line (cut at 240); an RTL or non-ASCII line
  (the excerpt keeps it; marking only matches the ASCII terms the lexical
  model produces); `tagTitleDisplayMode: 'separate'`.

### Step 3: L1 ranking and rendering (commit 4)

- **4a.** `wordSimilarity.ts`:
  - `getLexicalWeight` also returns `rawWeight` (additive, so existing
    callers are unchanged).
  - `createMoreLikeThisModel(index, activeFile, maxTerms = 25)`: the query
    terms are the top-`maxTerms` of the note's terms by tf·idf over the
    corpus. It is otherwise the same model.
  - `getTermPostings(index): Map<string, Array<Section | Task>>`, cached per
    index. It is built in the same pass as `getLexicalCorpus`, so the corpus
    walk runs once.
- **4b.** `relatedNotesRanking.ts`:
  - `rankSimilarWording(index, activeFilePath, activeFile, tagTitleDisplayMode, options): RankedNote[]`
    as in 2.1. It produces `RankedNote` with `matchedTags: []`,
    `reasons: ['Similar wording: a, b, c']`, `relevanceEvidence` with only
    `lexicalWeight`/`lexicalTerms`, `relevanceScore` clamped ≤ 30, an
    `excerpt` (step 2), and a new `kind: 'wording'` so the page and tests can
    tell them apart.
  - `suggestTagsFromSimilar(index, similar, options): SuggestedTag[]`, as in
    2.1.
  - `createSidebarSnapshot`: when `activeTags.length === 0 && enableKeywordLinks`,
    compute `similar = { notes: sortRelatedNotes(rankSimilarWording(...), sortMode, access), tags: suggestTagsFromSimilar(...) }`
    and exclude from `similar.notes` any entry already in `notes`. The state
    is unchanged: `noTags` when `notes` is empty, `ready` when links
    qualified some.
  - `RelatedNotesRankingOptions` gains `excludedTagNamespaces?: string[]`.
    `sidebarNotes.ts` passes `[deckard.board.statusNamespace]`.
- **4c.** `types.ts`: `SidebarNotesSnapshot.similar?: { notes: RankedNote[]; tags: SuggestedTag[] }`,
  `SuggestedTag { key; label; entryCount }`, and `RankedNote.kind?: 'wording'`.
- **4d.** `sidebarNotesHtml.ts`:
  - Factor today's card-building closure in `render()` into
    `renderRankedNote(note)` so both lists share it. The reason-dropping
    logic stays.
  - `renderSimilar(similar)` renders the tags section (rows with no Add yet
    in this commit; Add arrives in commit 5), then the cards section with its
    hint. It is called in the `noTags` branch in place of the empty message
    when `state.similar` has anything, and after the main list in `ready`.
  - `getNoteListKey` includes `similar` presence, so paging resets.
- Edge cases: an empty note (no query terms → no similar, the "nothing
  similar" message); a workspace under 10 entries (commonplace pruning is
  off, so the floor does the work); every candidate in one file (the
  2-per-file cap); a daily-note template repeated across notes (commonplace
  pruning plus the idf on tags).
- Performance: the postings map makes candidate gathering proportional to
  entries sharing a term. The measure wrapper already logs
  `Related Notes: N results` with a time; check it on the 5,000-note
  synthetic workspace K used (Piece 10). Target: under 50 ms warm.

### Step 4: Add, with Undo (commit 5)

- **5a.** `src/core/markdown/tagTarget.ts`:
  `findTagTarget(lines: string[], cursorLine: number): { line: number; kind: 'heading' | 'line'; label: string } | undefined`
  (1-based lines), as in 2.1. It uses `findFencedLines` and the front-matter
  pattern from `wordSimilarity.ts`.
- **5b.** `bulkEdit.ts` `appendTagToLine`: insert before
  `/\s+#+\s*$/` when `hasAtxHeadingClosingHashes(line)`, and before
  `/\s+\^[\w-]+\s*$/`. The rest is unchanged.
- **5c.** `messages.ts` and `types.ts`: `{ type: 'addSuggestedTag', tagKey: string }`.
- **5d.** `sidebarNotes.ts` `addSuggestedTag(message)`:
  1. Re-read `this.createSnapshot().similar?.tags` and find the tag by key
     (revalidate, as `insertLink` does). Otherwise return.
  2. `editor = vscode.window.activeTextEditor`. It must be a Markdown
     document whose `getFilePath` is the snapshot's note; otherwise show the
     "Open the note…" message.
  3. `target = findTagTarget(document lines, editor.selection.active.line + 1)`.
     If there is none, show the "Write a heading…" message.
  4. `after = appendTagToLine(line, tag.label, { entityNamespaceAliases, personMarker })`.
     If `after === line`, show `This line already has #tag.`
  5. `applyWorkspaceWrite(edit, { label: '#tag on "Heading"' | '#tag on line N', preview: 'never' })`,
     then `indexer.refresh()`, as `linkMention` does.
  6. Offer the toast with Undo. Undo re-reads the line and replaces it with
     the original only if it still equals `after`. Otherwise it shows the
     warning.
- **5e.** `sidebarNotesHtml.ts`: the `Add` button on each suggested-tag row
  → `postMessage({ type: 'addSuggestedTag', tagKey })`.

### Step 5: quiet card tags (commit 6, after Piece 4)

- Add Piece 4's card-tag class (or `data-tag-style="quiet"`) to the
  `renderTags(note.matchedTags, 'matched-tag')` output and to inline title
  tags inside `.note-title`. Remove the sidebar's own
  `.note .tag-list button:not(:hover)…` color override if Piece 4's rule
  covers it.

---

## 4. Tests

### `npm test` (VS Code extension host, mocha)

**`related-notes-evaluation.test.ts`** (new, commit 1; the untagged case in
commit 4)

The fixture is one oversized daily note, `journal/2026-09-20.md`, with front
matter `tags: [daily]`, generic `## Morning` / `## Notes` headings,
`## Atlas #project/atlas` › `### Vendor review #risk/vendor`, a tagged prose
line, nested tasks, and a fenced block containing `#project/atlas` (which
must not count). Around it:

- 2 direct `#risk/vendor` entries
- 2 ancestor-only `#project/atlas` entries
- 1 association-only entry (`#supplier/northwind`, written with
  `#risk/vendor` elsewhere twice)
- 1 entry linking `[[2026-09-20#Vendor review]]`
- 1 keyword-only entry (shares "northern route supply continuity")
- 3 unrelated entries
- 20 journal notes with `#daily` and a repeated standup template

Cases:

1. **Selected entry "Vendor review".** P@5 = 1.0 over {direct ×2, link,
   association, the better ancestor}. The keyword-only entry and the `#daily`
   notes are never listed.
2. **Whole document.** P@5 ≥ the value measured at commit 1 (recorded in
   the test as a floor, with the measured value in a comment). `#daily` notes
   are not in the top 5.
3. **(commit 4) Untagged note** `journal/2026-09-21.md` about the northern
   route and a vendor audit.
   - Its judged-relevant set is 4 entries. P@5 ≥ 0.6, the calibrated floor.
   - The first suggested tag is `#risk/vendor`. `#daily` and `@dana` are
     never suggested.
   - Every card has `kind: 'wording'` and `relevanceScore ≤ 30`.
   - At most 2 per file, at most 10 in all.

**`view-state.test.ts`**
- The existing "never lists an entry that only shares wording" test is
  unchanged, and gains an assertion that `snapshot.similar` is undefined for
  a tagged note.
- New: an untagged note gives `state: 'noTags'` with `similar.notes`
  populated and `notes` empty.
- New: an untagged note with a `[[link]]` gives `state: 'ready'`, the linked
  note in `notes`, and it is excluded from `similar.notes`.
- New: with `enableKeywordLinks: false` an untagged note gives no `similar`.

**`word-similarity.test.ts`**
- `createMoreLikeThisModel` keeps at most 25 query terms, the rarest first.
- `getLexicalWeight` returns `rawWeight ≥ weight`.

**`prose-excerpt.test.ts`** (new)
- `readProseLines` strips each of: heading, front matter, fence, table,
  tag-only line, tags, 📅/⏫/🔁/✅ metadata, `^id`, wiki-link alias, Markdown
  link, and list and quote markers.
- `formatExcerpt` starts at the first line holding a term, prefixes `…`, cuts
  at 240 on a word boundary, and returns undefined for no lines.

**`tag-target.test.ts`** (new)
- One test per rule in 2.1, and a cursor inside front matter or a fence.

**`bulk-edit.test.ts`**
- `appendTagToLine` goes before closing hashes and before `^id`. The existing
  cases are unchanged.

**`preferences.test.ts` / `preferences-invariants.test.ts`**
- The `relatedNotesPreviewLines` default is 1, it round-trips, and 3 or `'x'`
  normalizes to 1.

**`messages-rendering.test.ts`**
- `parseSidebarMessage` accepts `setRelatedNotesPreviewLines` with 0, 1, and
  2, and rejects 3.
- It accepts `addSuggestedTag` with a string `tagKey`, and rejects others.

**`sidebar-add-tag.test.ts`** (new; real VS Code API, as
`workspace-writes.test.ts` does)
- Open an untagged temp note and put the cursor under `## Vendor audit`. Add
  `#risk/vendor` → the heading line ends with the tag, the note is saved, and
  `workspaceWrites.lastWrite.label` is `#risk/vendor on "Vendor audit"`.
- Undo from the toast path restores the line.
- A line edited in between is left alone.

### `npm run test:ui` (jsdom via `src/test/webviewPage.ts`, and script and contrast checks)

**`related-notes-behavior.test.ts`**
- A card with `excerpt` renders `.note-excerpt` containing it. With
  `previewLines: 0` there is no `.note-excerpt`. `main[data-preview-lines]`
  reflects 1 and 2.
- The card's terms are wrapped in `<mark>` inside the excerpt only, never in
  the title, and `art` does not mark `start`.
- The gear has a `Preview` row with three `aria-pressed` buttons. Clicking
  `2 lines` posts `setRelatedNotesPreviewLines` with `lines: 2`.
- In `noTags` with `similar`: the label `Similar wording (no tags yet)`, the
  hint, one rail segment filled per card, and the reason
  `Similar wording: …`. The `Tags used by similar notes` rows come before the
  cards. `Add` posts `addSuggestedTag` with the key, and clicking the tag
  name posts `openTag`.
- In `noTags` with no `similar`, and keyword links on, the exact "nothing
  similar" message. With no `similar` field, `This note has no tags yet.`
- In `ready` with `similar`, both sections render, related notes first.
- `checkContrast.js`: add `.note-excerpt` text on `--panel`, and `mark`
  over the excerpt, to the pairs if the list is explicit.

### `npm run test:e2e`

**`sidebarNotes.e2e.js`**
- Changing the Sort select re-orders the cards without any other event
  (commit 2).
- Choosing `None` in the gear removes excerpts, and `2 lines` restores them,
  through the real host and preferences (commit 3).
- An untagged active note shows `Similar wording (no tags yet)` through the
  real host (commit 4).

### `npm run test:layout`

- `checkLayout.js`: add a second sidebar surface
  `{ name: 'sidebarNotesUntagged', page: 'sidebarNotes', viewport: [240, 700], snapshot: untagged note }`.
  `checkLayout.js` and `checkVisual.js` key surfaces by `surface.name ?? surface.page`.
  The expectations are no horizontal overflow at 240px (the gear and the Sort
  row fit), and the tag rows' `Add` stays inside the row.
- The existing sidebar surface now carries excerpts. Its fixture text
  (`Mentions @dana and the Atlas project, entry N.`) gives a one-line excerpt
  with the `@dana` tag stripped.

### Visual baselines (`test/ui/visual-baseline/darwin`)

- Commit 3: re-record all 16 `*-sidebarNotes.png` (8 themes × zen). The gear
  and excerpts change them.
- Commit 4: record 16 new `*-sidebarNotesUntagged.png`.
- Commit 6: re-record the 16 `*-sidebarNotes.png` again (quiet tags), after
  Piece 4 re-records its own.
- Use `npm run test:visual -- --update`, then look at every changed image
  before committing.

All four suites (`npm test`, `test:ui`, `test:e2e`, `test:layout`) gate on
exit codes for every commit.

---

## 5. Docs

**README.md, `## Related Notes` (line 539 on)**
- Commit 3: after the paragraph on results, add: `Each result shows the first line of what the entry says, with the words it shares with your note marked. The gear beside **Sort by** sets **Preview** to None, 1 line, or 2 lines.`
- Commit 4: a new paragraph: `A note with no tags yet has nothing to rank by, so Related Notes lists up to ten entries whose wording is similar, under **Similar wording (no tags yet)**, each marked weak, and above them the tags those entries use.` The existing sentence "a note with no shared tag… does not appear" gets `, unless the note you are reading has no tags at all`.
- Commit 5: add `Select **Add** beside a tag to write it on the heading or line where the cursor is. The message offers **Undo**, and **Undo Last Change** takes it back too.`
- Update the `deckard.enableKeywordLinks` row wherever settings are tabled.

**Help (`src/ui/webview/helpHtml.ts:451`, the Related Notes card)**
- Append: `A note with no tags lists entries with similar wording instead, and the tags they use, each with Add. The gear sets how many lines of each result to preview.`

**`docs/related-notes-associations.md`**
- §5: add a subsection **"A note with no tags"**. It states the exception
  precisely: only when the note being read has no tags. It covers the
  separate list, the 25-term query, the floor, the 2-per-file and 10 caps,
  the ≤30 score, and the tag-suggestion formula.
- §6: `rawWeight` is used for order in that list.
- §10: the new `enableKeywordLinks` wording. Troubleshooting item 4 gets
  `(unless the note has no tags; see §5)`.
- §9: nothing. The debug page is only reachable from a tagged entry.

**CHANGELOG.md, `## Unreleased` → `### Added`**
- `**Related Notes previews each result.** A card shows the first line of what the entry says, starting where it shares a word with your note, with those words marked. The sidebar's new gear sets Preview to None, 1 line, or 2 lines.`
- `**A note with no tags still finds its neighbors.** Related Notes lists up to ten entries with similar wording, marked weak and kept apart from related notes, and the tags those entries use, each with Add, which writes it on the heading or line under the cursor with Undo. For a note with tags, wording alone still never makes a note related.`
- `### Fixed`: `Changing Related Notes' Sort re-sorts the list at once.` `Adding a tag to a heading with closing hashes, or a line ending in a block id, keeps both working.`

**`docs/components.md`**
- The `markWords` row (or a new one): `markWords(root, words, { wordStart })`
  and when to pass `wordStart`.
- The gear section: the sidebar has a gear (Preview), placed at the end of
  the Sort row.
- A line under card anatomy: title → provenance → path → excerpt → reason →
  tags. Excerpts come from `readProseLines` / `formatExcerpt`, the one place
  Markdown is turned into preview text.

**`docs/todo.md`**
- Remove the Precision@5 item (commit 1).

---

## 6. Commits (in order; each passes all four suites)

1. `test: an evaluation fixture measures Related Notes by what it puts in its first five`
   (fixture, P@5 cases 1–2, and the todo.md line removed)
2. `fix: Related Notes re-sorts as soon as its order is changed`
   (after confirming the bug in the Extension Development Host; e2e test)
3. `feat: a related note shows the first line of what it says, with the shared words marked`
   (proseExcerpt, entryExcerpt, preference, gear, markWords `wordStart`, UI
   tests, README, Help, CHANGELOG, components.md)
4. `test: re-record the sidebar baselines for excerpts and the gear`
5. `feat: a note with no tags lists entries worded like it, and the tags they use`
   (MoreLikeThis model, postings, `rankSimilarWording`,
   `suggestTagsFromSimilar`, rendering without Add, P@5 case 3, the setting
   description, the associations doc, README, CHANGELOG)
6. `test: record the sidebar baselines for a note with no tags`
7. `feat: a tag suggested for an untagged note is added where the cursor is, with Undo`
   (`tagTarget`, the `appendTagToLine` fix, the message, the handler, the
   Add button, `sidebar-add-tag.test.ts`, README, CHANGELOG. The Add rows
   change the untagged baselines, so re-record them in this commit's
   follow-up, or fold commit 6 in here if 5 and 7 land together.)
8. `feat: tags on a Related Notes card are drawn quietly` (after Piece 4)
9. `test: re-record the sidebar baselines for quiet tags`

No Co-Authored-By trailer (per memory). Stage only the files of each commit.

---

## 7. Size, risks, dependencies, questions

**Size.**

| Commit | Size |
| --- | --- |
| 1 | 0.5 d |
| 2 | 0.25 d |
| 3–4 | 1.25 d |
| 5–6 | 1.5 d |
| 7 | 1 d |
| 8–9 | 0.25 d |
| **Total** | **about 4.75 days** |

**Risks.**
- *Precision on real workspaces.* BM25 over a short untagged daily note is
  noisy. The floor, the 2-per-file cap, the 25-term query, and the weak rail
  limit the damage, and the list is labeled as wording, not relation. The
  constants are tuned on the fixture, which is synthetic. Try it on David's
  own notes before release.
- *Ranking cost.* The untagged path scores entries the tagged path never
  looks at. The postings map bounds it. Measure at 5,000 notes (Piece 10's
  synthetic workspace).
- *Saving on Add.* `applyWorkspaceWrite` saves the note, including unsaved
  typing in it. `linkMention` already behaves this way. The index reads
  saved notes, so without the save the sidebar would not switch to the new
  tag.
- *`-webkit-line-clamp`* is fine in VS Code's Chromium. jsdom does not lay
  out, so the clamp itself is covered only by layout and visual checks.
- *Marking inside excerpts* relies on the lexical model's ASCII terms.
  Non-ASCII words are never marked, which is today's behavior on search
  pages too.

**Dependencies.**
- **Piece 4** (decision 4's quiet card tags; 4a's snippet should adopt
  `proseExcerpt.ts`): commit 8 waits for it. Commits 1–7 do not.
- **Piece 5e** (Hide daily notes on Related Notes): it should add its toggle
  as a second row in this plan's sidebar gear. If 5e lands first, it creates
  the gear and commit 3 adds the Preview row to it.
- **Piece 5f** (Linked from grouped by source note): no ordering dependency.
  It should reuse `readProseLines` / `formatExcerpt` for row expansion, and
  must not be governed by the Preview row (§2.4).
- **Piece 8f** (Related Notes settings rewritten, tagged `advanced`): it
  touches the same `enableKeywordLinks` description. Merge by hand.
- **Piece 9c** (one token rule, no mid-word breaks): the suggested-tag rows
  should follow it if it lands first.
- **Piece 10** (the 5,000-note synthetic workspace): used to measure.
- **"Parked notes"** (larger feature): once built, parked notes must be left
  out of `rankSimilarWording` and the suggested tags, as they are from
  Related Notes.

**Open questions for David.** None blocking. One choice he may want to know
about: the suggestions appear for any note **with no tags**, not only in the
`noTags` state, so an untagged note that links elsewhere still gets them.
