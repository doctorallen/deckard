# 39 · You've written this before

As the reader writes a line, Deckard ranks it against every line written
before, with the ranking Related Notes already uses, and quietly says when
an older line is a close match. Mockups: the "Four Deckard Ideas" artifact,
idea 2.

## What counts as a match

- The line under the cursor has at least six words, and typing has paused
  for one second.
- An older line shares at least three uncommon words with it (weighted as
  Related Notes weights them, so *today* and *meeting* count for little),
  and its BM25 score clears a threshold set by a unit test on fixtures.
- Lines from the same note, and lines written in the last two days, never
  match.
- **D2:** every note is searched; a line that shares a tag with the
  current line (its own or its heading's) ranks a little higher.
- At most two matches.
- Pairs marked **Not the same** are kept in workspace state and never
  offered again.

## Where it shows (D1)

1. **At the end of the cursor's line**, a faded, italic hint after the
   text: `↺ 12 Mar: same lag, fixed by restarting the curve loader` (the
   date and the older line, cut to fit about 60 characters), as an
   `after` decoration. Only on the cursor's line.
2. **The gutter**: a small ↺ on other lines of the open note that have a
   match, computed for at most the 200 lines nearest the cursor.
3. **A hover** on the hint (and the gutter mark's line): *Written before ·
   2 close matches*, each with its date and heading, the older line with
   the shared words marked, *Shares curve, feed, lagged… · both tagged
   #team/rates*, and **Open**, **Link it here**, **Not the same**.
4. **Context**: a *Written before* section above Related notes, for the
   cursor's line, with the same matches as cards; absent when there are
   none.

**Link it here (D3)** appends ` (see [[2026-03-12#Rates desk standup]])`
to the line, using Deckard's link format for the target heading.

## Performance

The index already holds every entry's words. Build (lazily, on first use)
a line-level inverted index of uncommon terms → line refs, updated
incrementally on save from the indexer's updates. Ranking one line must
stay under 15 ms on a 3,000-note workspace: add a timing test with a
generated workspace, and `measure()` it like other ranking.

A setting `deckard.editor.writtenBefore` (default on) turns all of it off.

## Zen

Under Zen the hint's words are hidden (the ↺ stays, and the hover still
works).

## Tests

- Unit: the match rules (six words, three uncommon terms, same-note and
  two-day exclusions, tag bonus, Not the same), Link it here's text.
- Timing test as above.
- Host (single file): the decoration on the cursor line only; the hover's
  links.
- Context: the Written before section renders (jsdom).

## As built

What was built where the plan was silent, or where the code made the plan
impractical:

- **One line index for plans 38 and 39.** `domain/ranking/lineIndex.ts`
  keeps every line with words (front matter, code, and headings left out)
  by its terms, tokenized as Related Notes tokenizes wording
  (`getLineTerms`), with BM25 weighed over lines. It is built on first use
  and then brought up to each index by the notes that changed: a note's
  lines are read once per parsed note, so a save costs that note. Plan 38's
  answer offering reads the same index.
- **What counts as uncommon.** A word is uncommon when it is no stop word,
  not one of a short list every workspace writes often (*today*, *meeting*,
  *notes*, *call*…), and held by at most five lines or 2% of them,
  whichever is more; below 50 lines, any such word. The score threshold,
  BM25 8 over the shared uncommon words, is set by
  `src/test/written-before.test.ts`: three words a line in forty writes
  clear it, three that a line in twelve writes do not.
- **When a line was written** is read from its note, as no line keeps a time
  of its own: a daily note's day, else when the note last changed. So a note
  changed in the last two days holds all of its lines back until then.
- **The tag bonus** multiplies a match's score by 1.25 when the older line
  carries one of the line's tags, its own or its entry's; it orders the
  matches, and the threshold is read before it.
- **Not the same** is kept as the pair of the two lines' words, hashed, in
  workspace state under `deckard.writtenBefore.notSame`, the last 500, apart
  from the preferences blob.
- **The hint** reads *↺ Thu, Mar 12: Same lag in the curve feed…*, the day
  in the reader's short date format, in the theme color
  `deckard.writtenBeforeForeground` (CodeLens's color by default), cut to 60
  characters. Under Zen it is ↺ alone.
- **The gutter** marks are worked out nearest the cursor first, at most 200
  lines, in turns of 20 ms that yield between them, and each line's matches
  are kept for its words and the index, so moving the cursor back costs
  nothing. The mark is an icon of its own, `resources/written-before-*.svg`.
- **The hover** is the line's, the cursor's or a marked one: VS Code cannot
  hover the text an `after` decoration draws apart from its line. Open is
  `deckard.openNote`; Link it here and Not the same are commands left out
  of the palette.
- **Link it here** changes the line in the editor, so the editor's Undo
  takes it back, and writes nothing when the line has changed since. Its
  link is the one Insert link writes (`createWikiLink`), to the heading the
  older line is under.
- **The setting** is an editor switch, as every `deckard.editor.*` switch
  is: no default in the manifest, following the editor preset (on in Full,
  Tasks, and Writing; off in Off), and a value set by hand wins. Only notes
  Deckard reads are compared.
- **Context** draws Written before above the related notes as cards whose
  shared words are marked as the related notes' are, each opening its line
  through a message of its own, since Context opens only the rows it lists.
  The section follows the cursor's line: when the hint changes, Context is
  sent its state again with the new section, and nothing is ranked again.
- **The timing test** builds a generated workspace of 3,000 notes of 30
  lines each, words drawn as a language draws them, builds the line index
  once outside the timing, and holds the median of 30 lines under 15 ms.

Fixed after QA, before release:

- **A hover after an edit.** The lines with matches were kept by line
  number through edits, so a line written above a marked one left its
  matches on the line that took its number, and Link it here appended to
  that line. Each marked line now keeps the words its matches were found
  for, and the hover has none for a line that reads otherwise; an edit
  clears the marks and the gutter until the note is compared again.
- **The gutter after an edit.** A pass under way when the note shrank read
  lines past its end and threw. An edit now stops the pass, and a pass
  never reads a line the note no longer has.
- **Headings, front matter, and code** were compared on the cursor's line
  and in the gutter, though the line index leaves them out; both now leave
  out the same lines (`findUnindexedLines`).
- **One reading per version.** The hints read the active note once per
  version of it, and not at all while it reads as the index read it, where
  each rest of the cursor read the whole note again. The note is still read
  whole when it has changed, not the cursor's line alone: the tags a line is
  compared with come from the headings and tagged lines above it, as the
  parser reads them (about 50 ms for a 20,000-line note, 1 ms for 500).
