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

## As built

Built on `feat/said-and-terms`, after plan 41. The table is
`src/domain/terms/terms.ts`; the hover and underline are
`src/ui/providers/termHovers.ts`, with the hover's words in
`src/ui/state/termHover.ts`; Make a term note is
`src/ui/commands/termNotes.ts`; Stats' lists are `listTerms` in
`src/ui/state/statsState.ts` and `src/webview/stats/terms.tsx`; Find's row
is in `src/ui/state/findAnswers.ts`; the tool is
`src/ui/state/assistantTerms.ts`. Where the plan was silent, or the code
made its words impractical:

- **Stats has no tabs.** It is one page of sections, so **Terms** is its
  last section, under Tags written together, with the plan's two lists
  side by side, each up to 50 terms and a count of the rest. A row of
  **Used but never defined** searches for the term's uses; a row of
  **Defined** opens the definition.
- **An entry**, for the count, is a heading and the lines under it, or a
  note's text above its first heading, read line by line, rather than the
  search's entries, which fold untagged headings into the tagged one above
  them. Reading the text once, without the index's entry grouping, keeps
  the 3,000-note build fast.
- **What is skipped.** Front matter is skipped whole, values as well as
  keys: a term note's own `term: NDF` is no use of NDF. Beside the plan's
  list, the capitalized words left out are the English ones written for
  emphasis (`NOT`, `AND`, `ALL`, `NEW`…), the Markdown alert words (`TIP`,
  `WARNING`, `CAUTION`, `INFO`), and `FIXME`, `XXX`, `TBD`, `WIP`, `ASAP`,
  `ETC`, `VS`, `TL`, `DR`. A token may not follow `#`, `@`, `/`, `.`, `\`,
  or `-`, and one whose first part is all digits, such as `2026-W38`, is
  no term. A shouted line is one with no lowercase letter and two words or
  more.
- **Inline definitions** make a term only of a token used in three entries
  or more; a term note defines its term however few use it. A task's line
  is no `NDF: words`. Nor is a status (QA: `- UAT: blocked on data`, being
  earliest, defined UAT over a later `UAT (user acceptance testing)`): a
  colon's words must spell the term's initials, or, outside a list item or
  with the term in bold as a glossary writes it, be three words or more.
  The forms are ranked: a term note, then a parenthesized form whose
  initials match, then `means` or `stands for`, then a colon; the
  earliest of the surest form wins. `NDF means` and `stands for` read to the end of the
  sentence. In the initials rule a digit counts as a letter, so `3-D
  Secure` is 3DS, and hyphens and slashes part words. Each letter and word
  pair is tried once (QA: a line of forty small words took minutes), so it
  takes letters × words steps; a unit test holds the bound. A definition loses
  its Markdown bold and closing punctuation, and is cut at 200
  characters.
- **A term note's term** is its `term:` field, else its file name, in
  capitals; its definition is its first paragraph after the front matter
  and the headings, its lines joined.
- **Hover and underline** are on defined terms only, as the plan's
  *defined term* says. The day is in the reader's short date format,
  *Defined Tue, Mar 3 in FX recon kickoff*, and *in* names the heading
  the definition is under, else the note. **Find uses** opens a search
  page on `text = NDF` (quoted for a term with a hyphen).
- **Make a term note** and **Define…** run `deckard.makeTermNote`, an
  internal command, which opens New Note from Type…'s form for the
  workspace's `term` type, or, with none, for a built-in Term (a type of
  notes, in `Terms/`, with one field, `term`), as a quick fix's person
  falls back to one. The form starts with the title and `term:` filled in,
  and from an inline definition its words as the note's first paragraph:
  `DraftStart` gained `values` and `body` for it.
- **The setting** is one more `deckard.editor.*` switch the editor preset
  decides: on in Full, Tasks, and Writing, off in Off. Zen hides the
  line through `deckard.display.zen`. A new theme color,
  `deckard.termUnderline`, is `descriptionForeground` by default.
- **Find** reads the term in any case, so `ndf` and `what's ndf?` answer
  too, and `what does NDF mean` and `define NDF`. The term's row leads the
  answers, with a book icon, and Find still lists at most three.
- **The tool** comes after `deckard_describe_tag` in the table, the
  manifest, and the MCP server's list, with an activation event, and the
  MCP server's instructions name it. Its answer is plain text: the
  definition, its source as `path:line`, heading, and day, and the use
  count; or that the notes define none, with the count and first use.
- **The work sample**'s Term type is `Types/Term.md` (rows: notes, in
  `terms/`, one field `term`, also called acronym or abbreviation), with
  `terms/3DS.md`, a term the standups and the project already use, and a
  README line to hover it.
- **Performance.** Each note's terms are read once per parsed version of
  the note, and the table once per index, both kept in `WeakMap`s; an
  index update rebuilds the table from the notes' readings when it is next
  asked for, rather than patching it. The 3,000-note fixture (26 lines a
  note, a quarter of them with a term) builds in about 100 ms here.
- **Tests**: `terms.test.ts` (unit: detection and skips, each definition
  form, initials, a term note winning, counts, Find's answer, and the
  3,000-note build), `stats-terms.test.ts` (unit, jsdom: the Stats lists
  and Define…), `term-hovers.test.ts` (host: the hover's content and
  links, none in code), and additions to the assistant tool, MCP, sample,
  typed-note-draft, and extension suites.
