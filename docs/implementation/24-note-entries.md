# 24 · One note per tagged heading

A tag on a heading should make the heading and everything under it one
note, up to the next heading with tags of its own. Today every heading is a
note of its own: `# ADR-001 Card form #decision #project/checkout-v2` with
untagged `## Context`, `## Decision`, and `## Consequences` under it comes
back from `#project/checkout-v2` as four cards, three of them named for a
heading and carrying no tag, and the first repeating the other three's text.
David found it on the tag page; this plan removes the behavior rather than
keeping it as a `noteBoundaries` value (David, 2026-10-04).

## Why it happens

Two rules, each reasonable alone, combine:

1. **The parser cuts a file at every heading.** Each heading is a
   `Section` (`parser.ts` `buildSections`, `createSection`), with
   `rawContent` and `endLine` covering its whole subtree, tagged children
   included, and `bodyContent` and `bodyEndLine` stopping at the next
   heading of any level.
2. **Search gives a section every heading's tags above it, and lists every
   section that matches.** `evaluateQuery` filters all of
   `index.sections`; `createSectionUnit` adds `collectInheritedTagKeys`.
   So an untagged `## Context` under a tagged `#` matches the `#`'s tag and
   is a result. The guide says so ("A tag on a heading is inherited by
   everything nested under it"), which is how it stayed.

Front matter does the same by another road: `section.tags` merges the
front-matter tags into every heading, so each heading of a note tagged in
its front matter is in `tag.sectionIds` and is its own result, while the
note itself is a result only when no heading carries the tag.

Elsewhere Deckard already means the other thing: the evaluator's own
comment calls its units "a tagged section, a task, or a front-matter-only
file", and the Context view follows "the smallest tagged entry containing
the cursor" (`findTaggedEntry`, `ui/state/entryScope.ts`).

## The model

An **entry** is what search, tag pages, Related Notes, and every count call
a note:

- **A heading with tags of its own** (`headingTags`) owns itself and every
  untagged heading under it, down to, but not into, a heading with tags of
  its own, which is an entry of its own.
- **A note tagged in its front matter** owns its preamble and every heading
  with no tagged heading above it: one note, the file, as
  `listFrontmatterOnlyFiles` already draws a file with no headings.
- **A tagged prose line** stays an entry of its own under
  `noteBoundaries: line`, and under `heading` and `marked` belongs to the
  entry that owns the heading above it.
- **A task** is an entry of its own, as now.
- **Anywhere no tag reaches** (an untagged note, or the headings of an
  untagged note above its first tagged heading), each heading stays its own
  entry, as today, so a text search still lands on a daily note's section.

Every section gets the entry that owns it (`entryId`: its own id, its
tagged ancestor's, or the file's). An entry's text is its owned sections'
headings and `bodyContent`, in order; an entry's tags are its own heading's
or front matter's, the tags it inherits from tagged headings above it, and
the `bodyTags` of what it owns.

```markdown
# ADR-001 Card form #decision #project/checkout-v2   ← entry A
Date: 2026-09-25
## Context                                           ← owned by A
## Decision #decision/accepted                       ← entry B (inherits A's tags)
### Rationale                                        ← owned by B
## Consequences                                      ← owned by A
- [ ] Map the provider's errors                      ← a task; its note is A
```

`#project/checkout-v2` finds A and B: two notes, A's card holding Date,
Context, and Consequences, B's holding Decision and Rationale.

## Decisions taken (logged for review)

1. **Removed, not kept as a setting.** The old behavior was never chosen,
   contradicts the evaluator and the Context view, and splits a note into
   untagged fragments; a reader who wants a subsection to be a note tags it.
   `noteBoundaries` keeps its one question, what a tagged prose line belongs
   to.
2. **An entry owns non-contiguous text.** In the example, Consequences comes
   after B but belongs to A, its nearest tagged ancestor. A's card draws its
   owned parts in order, with no gap marker; B's card is a result of its own.
3. **A tagged heading still inherits the tags above it**, as today
   (`note-boundaries.test.ts` pins it): B is about checkout-v2 too, so it is
   found by it, as a note of its own beside A.
4. **A front-matter-tagged note is one entry**, the file, unless a heading in
   it has tags of its own, which is an entry inheriting the front matter's.
5. **Untagged regions keep today's granularity**, each heading its own
   entry, so a text search in an untagged journal still finds the section,
   not the whole file. A later change could fold those too; not this one.
6. **Body tags roll up to the owner.** Under `heading` and `marked`, a tagged
   line's tags go to the entry owning the heading above it, not to an
   absorbed untagged heading, which never becomes "tagged" by them.
7. **A card says where a text search matched.** When the words are in an
   owned heading's part, the card adds "in ## Decision", and opening it goes
   to that line, so the precision the fragments gave is kept.
8. **Find stays a navigator by heading.** Find in Notes… lists headings to
   jump to, as an outline does; search pages, tag pages, and every count
   use entries.
9. **A visit counts for the entry.** Opening `## Context` records a visit to
   A, so Recently opened lists notes, not fragments.

## Phases, one commit each

1. **Ownership in the parser.** `Section.entryId`, set after
   `buildSections`: own id for a heading with `headingTags`, else the
   nearest tagged ancestor's, else the file's entry id when the front matter
   has tags, else its own (decision 5). A shared `ownerOf` in domain, on
   `someHeadingAncestor`, replaces the walks that mean ownership. Entry text
   assembled from owned `bodyContent`, stored as line ranges in the codec as
   `rawContent` is (no JSON bloat). `foldTaggedLines` rolls body tags up to
   the owner (6). `PARSE_FORMAT` goes up, so every cached index rebuilds.
   Tests: the example above, a nested tagged heading, an owned heading after
   a tagged sibling, a front-matter note with and without tagged headings,
   an untagged note, and inline lines under each `noteBoundaries` value.
2. **The index counts entries.** `index.tags[].sectionIds` and
   `collectTagOps` take entry ids; front-matter notes add their file entry
   and no absorbed headings; `countEntries` counts a task inside its owning
   entry; parked counts follow. `index-equivalence` (fold against a direct
   build) agrees.
3. **Search and tag pages.** `evaluateQuery` iterates entries; its unit's
   text is the entry's text and its tags the entry's (3); the plain-word
   scan, the empty search, `findsSomething`, untagged mentions, Refine's
   counts, `countTagMatches` and its six callers, and `findLineOwners`
   (so a hub link from `## Context` lists A once) all go by entry. Cards
   draw the entry's text; the Notes tab counts entries; a text match in an
   owned part adds "in ## Heading" and opens there (7).
4. **Everything else that lists notes.** Related Notes ranks and excerpts
   entries (and the wording corpus indexes them); the Context view's entry
   context uses the domain `ownerOf`, front matter included; Stats' note
   counts and trends; Home's Notes figure, Recently opened (visits by
   entry, 9), and saved-search counts; query blocks; Export and Bulk edit
   (through the search they run); the Notes Graph's nodes (one per entry,
   parent edges between entries); a tag's hover count; the assistant tools.
   Find keeps headings (8).
5. **Tests, docs, and the changelog.** `query-language.test.ts`'s "inherits
   a tag from a parent heading" becomes "an untagged heading belongs to the
   tagged heading above it"; the tests listed under Risks follow. The guide:
   `notes-and-links.md` (what a note is, beside the `noteBoundaries`
   table), `search.md`'s `tag` field, `home-and-stats.md` ("Notes counts
   each heading" becomes each note), `query-blocks.md`, `search-pages.md`.
   The changelog says counts drop and why. DOM and screenshot baselines for
   tag pages and Home.

## Risks

- **Every count of notes drops** for anyone who structures notes with
  headings: Home's Notes, a tag page's Notes tab, a tag's hover, Stats. That
  is the fix; the changelog and the first scan after the update say so.
- **A saved search or query block that relied on a fragment**, such as one
  listing `## Decision` sections by their parent's tag, now returns whole
  notes; with decision 7 the card still points at the part.
- **The cache rebuilds once** on the parse-format change, as it does after
  any parser change.
- **Pinned tests** to update with the change, not around it:
  `query-language`, `note-boundaries` (body-tag scope at :103 and :113),
  `tag-grouping`, `stats`, `search-refine`, `view-state`, `query-block`,
  `notes-graph-state`, `workspace`, `markdown-parser`, `parsed-file-codec`,
  `index-equivalence` (with `fixtures/legacyWorkspaceIndex.ts` and
  `indexCorpus.ts`), `tagged-entries`, `people-recency`,
  `sample-workspace`.

## Taken on the way (logged for review)

- **A note tagged in its front matter is titled by its own `#` heading**
  when it is a note as a whole and its first heading is a `#` it owns, as
  the end-to-end suite caught: titled by its file name, `atlas.md` replaced
  `Atlas`. Otherwise the file name, as before.
- **A snippet's line is mapped back to the note.** An entry's text skips its
  headings with tags of their own, so a card's snippet maps each line to
  where it is written, and names the untagged heading it is under
  ("… in Consequences").
- **The Context view keeps "the smallest tagged entry"** as it was; it does
  not yet treat a front-matter note as one entry.

