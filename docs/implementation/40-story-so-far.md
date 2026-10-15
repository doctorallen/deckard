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

## As built

Built on `feat/four-ideas`, before plan 38, so `[?]` lines are not
questions yet. Where the plan was silent, or the code made its words
impractical:

- **Questions, behind a seam.** `src/ui/state/storySoFar.ts` reads a line's
  kind from one rule and marks it from a table, `STORY_KINDS`, and the
  chips come from a list, `STORY_FILTERS`, whose **Questions** row is drawn
  only while the story holds a question (`whileHeld`). A question is a
  `[?]` line that no task reads. Until plan 38 makes `?` a status that is
  not a task, `[?]` is a task of an unknown status, so it reads as an open
  task and the Questions chip is never drawn; once it is, the kind and the
  chip follow with no change here. A unit test reads a `[?]` line with `?`
  set as a not-a-task status, as plan 38 will, to hold the seam.
- **Which kind wins.** A task is done or open by its box, even in a
  decision's note or under a decision's heading; then a question; then a
  decision; then anything else. A cancelled task is neither done nor open,
  and reads as **·**, with no box.
- **A task's words** are its title, as every task row draws it, its Tasks
  fields (`📅`, `✅`, …) aside, rather than the line as written. Any other
  line is drawn as written, its list mark and box aside.
- **Which lines.** A line's tag, a heading's, and the front matter's are
  matched as the tag search matches them: the same key, case aside, with
  `@sam` and `#person/sam` one person. Thematic breaks (`---`) are left out
  with the headings and blank lines. With Refine, the story is the lines
  about the tag inside the entries and tasks the narrowed search finds; an
  entry listed only because it links to the hub carries no line about the
  tag, so it adds none.
- **Dates.** "The note's file date" is the day the file was made. A
  note's `created:` is read as the parser reads it, with a time or quoted
  (`2026-03-02T10:15`, `"2026-03-02 10:15"`), before the file's own birth
  time, which it had been preferred to whenever it held a time. (QA) A note
  with no date at all is grouped under **Undated**. The day is drawn in the
  reader's short date format, `Wed, Oct 14`, as plan 37's band draws its
  date; the plan's `14 Oct` is that format's choice. A month heading always
  carries its year.
- **Order.** Newest first puts the newest day first and keeps each day's
  lines in the order they were written, notes by path, so a day reads the
  same either way.
- **Lines under a row.** A list item written under a row's item, and an
  indented line after it that is no list item, join the row. They are drawn
  as text, a step with `✓` or `☐` and a question with `?` before it, not
  with boxes of their own. A nested line that carries the tag under a line
  that is not in the story is a row of its own.
- **The tab.** It comes after Notes and Tasks. Its count is every row, the
  filter aside; the chips carry no counts. Side by side, where there are no
  tabs, the story is a pane under the notes and tasks, headed **Story
  (N)**. The filter and Oldest first last while the page is open, through
  other searches; **Show more** starts again at 100 with each search,
  filter, or order. None of it is kept in the preferences.
- **Opening a row** goes where every other row on the page goes: the
  editor, or the note page when `deckard.openNotesIn` says so. A row's tags
  are the buttons that open them.
- **Copy as Markdown** is worked out again by the host, `copyStory`, as
  Between you's agenda is, and says *Copied 12 lines of the story as
  Markdown* in the status bar. The lines under a row are copied indented
  under it, `  - ✓ Ask Ops for a window`.
- **Messages.** `setStoryFilter`, `setStoryOrder`, `showMoreStory`, and
  `copyStory`, each narrowed to exactly what it carries.
- The DOM goldens of a tag's search page change, since it gains the tab;
  they are recorded after David's review, not on this branch.
- **Questions, once plan 38 was merged in.** A line's kind is a question
  when its note's `ParsedFile.questions` holds one on that line, rather
  than when a `[?]` box is read, so a reader who gave `?` a status of their
  own keeps a task there. A question line starts no entry, so the story
  reads the lines of the questions the search finds as it reads those of
  its tasks; a question that carries the tag under a heading that does not
  is in the story. Its `Answer:` line folds under it, and the Questions
  chip is drawn. On a tag's page the Questions tab comes before the Story.
