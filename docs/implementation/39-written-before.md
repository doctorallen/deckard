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
