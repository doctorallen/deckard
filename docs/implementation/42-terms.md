# 42 · Terms

Work notes are full of short terms (UAT, NDF, UTI, INC, RATES-UAT). Deckard
finds where a term was defined, shows the definition on hover anywhere,
and lists the terms used often but never defined. Mockups: the "Six More
Deckard Ideas" artifact, idea 13.

## What a term is

A token of 2–6 characters of capital letters and digits, at least one
letter, hyphens allowed between parts (`RATES-UAT` counts its whole length
up to 12), used in at least three entries across the workspace. Skipped:
common English and Markdown words written in capitals (`OK`, `TODO`, `AM`,
`PM`, `US`, `UK`, `ID`, `I`, `A`, `NOTE`, `FYI`, month and day
abbreviations), anything inside code, links, URLs, tags, or front matter
keys, and words in an all-caps line (a shouted heading).

## Where a definition comes from (D21: both, a term note wins)

1. **A term note**: a note whose front matter is `type: term` with
   `term: NDF` (or whose title is the term), its first paragraph the
   definition. A `Term` type is added to the sample workspace's
   `Types/` and documented; workspaces without the type still read
   `type: term` notes.
2. **Inline**, the first occurrence by date of: `NDF (non-deliverable
   forward)`, `non-deliverable forward (NDF)`, a line `NDF: words`, or
   `NDF means words` / `NDF stands for words`. The definition is the
   words (and, for the first two, the parenthesized or preceding phrase
   whose initials plausibly match: each letter of the term starts a word,
   in order, allowing small words like *of*/*and* to be skipped).

## Where it shows

- **Hover** on a defined term in a note: **NDF** · *non-deliverable
  forward*, *N entries*; *Defined 3 Mar in FX recon kickoff: "…"* (or *From
  NDF.md*); links **Open definition**, **Find uses** (a search for the
  term as a word), **Make a term note** (when the definition is inline;
  opens New Note from Type… for Term, filled).
- **Underline (D22)**: defined terms get a faint dotted underline in the
  editor. Setting `deckard.editor.termUnderline` (default on). Zen hides
  the underline, never the hover.
- **Stats → Terms tab**: **Used but never defined** (term, count, first
  use, each with **Define…** which opens New Note from Type… for Term with
  the term filled) and **Defined** (each term, its definition, its source),
  sorted by use.
- **Find**: a term's definition is an answer row when Find's text is the
  term (or `what is NDF`).
- **Assistant**: `deckard_describe_tag` is about tags; add
  `deckard_define_term` returning the definition and source, or none.

## Performance

The term table is built from the index (each entry's text) once and
updated on index updates; hover reads the table. Unit-test a 3,000-note
fixture stays under 200 ms to build.

## Tests

- Unit: term detection and skips; each definition form; initials matching;
  term note winning; counts.
- Host (single file): the hover's content and links; no hover in code.
- Page behavior (jsdom): the Stats Terms tab.
