# 40 · The story so far

A project's history is spread over dozens of daily notes. A **Story** tab
on a tag's page lays every line about the tag on one dated timeline,
grouped by month, so six months can be read in one scroll. Mockups: the
"Six More Deckard Ideas" artifact, idea 11
(https://claude.ai/artifact/AceorGRUEw6PQHAbfDdz3M).

## What goes in (D17: every line)

- Every line that carries the tag, or sits under a heading (at any level)
  or in a note (front matter) that does: prose lines, list items, tasks,
  and questions (plan 38, once merged). Not headings, blank lines, front
  matter, fenced code, or query blocks.
- Lines in the tag's own hub note are left out: it is the summary, not the
  story.
- A line's date: its daily note's day, else its note's `created:` field,
  else the note's file date. Within a day, lines keep their order in the
  note, and notes order by path.
- Indented child lines are folded into their parent row (shown after it,
  smaller), so a task's steps or a question's `Answer:` line read with it.

## Each row

- The date (`14 Oct`), a mark for its kind, the line's text as written
  (Markdown drawn inline as elsewhere on the page, cut to two lines), and,
  muted at the right, the heading it is under (or the note's title).
- Kinds: **D** decision (the line's note has `type: decision`, or a
  heading above it carries a tag of a type named Decision), **✓** a
  finished task, **☐** an open task, **?** a question (plan 38), **·**
  anything else.
- Selecting a row opens the line in the editor. A task's box completes it,
  as on the board.

## The tab

- **Story (N)** beside Notes and Tasks on a tag's page (a page of one tag,
  with or without Refine). N is the number of rows.
- Month headings (`October 2026`).
- Filters, as one row of toggle chips: **All**, **Decisions**, **Done**,
  **Questions** (once plan 38 is merged), and **Oldest first** (D18:
  newest first by default).
- It pages like the Notes tab (the first 100 rows, then **Show more**).
- **Copy as Markdown** in the page's **⋯** while the tab is shown copies
  the rows shown, as `- 2026-10-14 · text (Heading)`, grouped under
  `## October 2026`.
- Zen: dates, marks, and counts stay; the filter chips are content, not
  controls to quiet.

## Built from

The tag's search (which already finds the entries), the parser's lines and
headings, types (decision), the search page's tabs.

## Tests

- Unit: which lines go in (heading and front-matter tags, hub excluded,
  code skipped), dates, kinds, child folding, ordering both ways, filters.
- Page behavior (jsdom): the tab, months, a row's parts, filters, Show
  more, Copy as Markdown's text.
