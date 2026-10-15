# 43 · File this

Facts about teams and people land in today's note, and the knowledge base
learns them only if the reader edits the hub notes too. **File this**, on
the lightbulb of a line, carries the fact where it belongs: it adds the line
to a hub's notes with a link back, and, when the line says something a
field holds, it sets the field. Mockups: the "Six More Deckard Ideas"
artifact, idea 14.

## Filing a line (D23: copy, with a link back)

On any note line that is not in a hub note and mentions at least one row
(a tag with a hub note, or a person with one), the lightbulb offers, one
action per row mentioned (at most four, in the order they appear):

**Add this line to Team FX's notes**

It appends to the hub note, under its heading **Notes** (any level, made at
the end of the note as `## Notes` when missing), as the last list item:

`- 2026-10-14: <the line's text, tags kept> ([[2026-10-14#Org news]])`

- The date is the source note's day (daily note) or today.
- The link uses Deckard's link format to the line's heading (or the note
  when it has none).
- The daily note is not changed.
- One more action, **File under…**, picks any note and heading (Move to…'s
  picker) and copies the line there the same way.
- The write goes through the history (Undo in the notification, as other
  writes offer).

## Setting a field (D24: a `words` column in the type's schema)

A type's schema table (plan 30, the Markdown table in `Types/<Type>.md`)
gains an optional column, **Words**, listing the phrases that mean the
field, comma separated: `lead` → `leads, led by, now leads, heads`; `team`
→ `moved to, joined, is on`; `owns` → `owns, took over`. The sample types
are updated with such words.

A **Set …** action is offered when a line:

1. mentions a row R of a type T (by its tag, person, or a `[[link]]` to a
   row note), and
2. contains, after R's mention, a phrase from a field F's Words of T or of
   another mentioned row's type, and
3. names after that phrase a value that fits F: for a relation or person
   field, a mention of a row of the target type; for a select, one of its
   options as a word.

Two readings of one line are both offered. In *@priya-natarajan now leads
#team/fx*:

- the subject is Priya and the phrase "leads" belongs to Team's `lead`
  field (whose value type is Person), so the action is **Set Team FX's
  lead to Priya Natarajan** (subject and object swap when the field lives
  on the object's type: the phrase is matched on every mentioned row's
  type, and the value is whichever mentioned row fits the field's type).
- In *@alex-rivera moved to #team/rates*: Person's `team` field, value
  Team Rates: **Set Alex Rivera's team to Rates**.

Each action's detail says the old value (*was Alex Rivera*). Setting a
field writes through plan 34's field writer (front matter of the row's
hub note; a row with no hub note gets one, as Create Hub Note makes it),
with Undo. A multi-value field adds the value; a single-value field
replaces it.

Field actions come first in the lightbulb (group *Set a field*), then the
filing actions (group *File the line*).

## Zen

Nothing visible at rest; the lightbulb is VS Code's.

## Tests

- Unit: rows found on a line; the Words column parsed from the schema
  table; matching both readings above; value type checks (a person for a
  Person field, an option for a select); the filed line's text and link;
  the Notes heading made when missing.
- Host (single file): the code actions offered on a fixture line, and the
  writes (hub gets the line; field set; Undo restores).

## As built

Built on `feat/four-ideas`. `src/ui/state/fileThis.ts` reads a line (its
rows, where it can be filed, the fields its words set, where a filed line
goes), and `src/ui/commands/fileThis.ts` offers the actions and writes.
Where the plan was silent, or VS Code or the code made its words
impractical:

- **No detail, no group headings.** A VS Code code action has a title and
  a kind, and nothing else the lightbulb draws. So the old value is in the
  title, `Set FX’s lead to Priya Natarajan (was Alex Rivera)`, and left out
  when there is none. A field that holds several reads `Add Checkout to
  Payments’ owns`, since nothing is replaced. The two groups are two kinds,
  `refactor.deckard.setField` and `refactor.deckard.fileLine`, offered in
  that order; VS Code lists both under its own heading for other actions,
  with no heading of theirs.
- **Where a line is offered.** Not on a heading, a blank line, front
  matter, or code. A line in a hub note offers no filing, as the plan says,
  but still offers Set ….
- **What is filed.** The line without its list mark and its box, tags
  kept, so a task filed is a line about it, not a second task. The link
  back follows `deckard.links.style`: `[[2026-10-14#Org news]]`, or, in the
  Markdown style, `[2026-10-14#Org news](../journal/2026-10-14.md)`, which
  has no anchor. It names the note alone when the line is under no heading,
  or under one named as the note is.
- **Places to file.** A tag on the line with a hub note, as the plan says;
  a `[[link]]` to a hub note is not one, though a link to a row's note does
  count as a mention for Set ….
- **The Notes heading** is the first heading whose words, tags aside, are
  *Notes*, any case and level, outside code. The line goes after the last
  list item of the heading's own lines and the lines indented under it;
  with no list there, after its last line of text with a blank line
  between; with nothing under it, right under it. A hub with none gets
  `## Notes` at its end, after a blank line.
- **File under…** offers headings only, from Move to…'s picker (its
  recent headings first), not today's note or a new note, and records the
  heading chosen as recent, as Move to… does.
- **Reading a field.** A phrase is matched as whole words, any case, any
  run of spaces between its words, and never inside a tag or a link. The
  row that holds the field is the nearest row of the field's type before
  the phrase, and the value the nearest one after it that fits; for a
  field that names rows it is also read the other way, the holder the
  nearest after and the value the nearest before. A select's value is the
  first of its options written after the phrase. A Person field takes any
  `@` row; a relation, a row of one of its types, or a person when it takes
  people. Each reading is offered once, and not at all when the row's note
  already writes that value. Of two phrases written over the same words,
  across fields and types, only the longer is read, so the sample's *is on
  call for* (Team's `on-call`) is not also *is on* (Person's `team`). A
  field whose value is a row of its holder's own type, as Person's
  `manager`, is not read the other way round, so *@theo reports to @noor*
  is not also Noor's manager. A select's option is read, as a phrase is,
  outside tags, code, and links, a Markdown link's words among them
  (`findMarkdownLinkRanges`). (QA)
- **What a field gets.** A row by its tag (`@priya-natarajan`,
  `#team/rates`), a note row as `[[Title]]`, an option as the schema spells
  it, written through `setFrontmatterField` and `writeDraftValues` as the
  form writes them. A field that holds several keeps what its note writes
  and gets the value added: what the note writes as it is now, read from
  its text, not from the index, so a value in an edit not saved yet is
  kept (QA: it was dropped). A field that holds one value, whose note no
  longer writes what the action said it was, is not set, and the reader is
  told the note changed, as the form tells it (`planReadingWrite`).
- **A row with no hub note** gets one written at once, not through the
  form: in its type's folder, titled and tagged as Create hub note's form
  starts it, from the type's template when there is one (its questions
  asked), with the field set, as one write. `writeNewNote` now gives back
  the write's handle, so its Undo is offered too.
- **The commands** the actions run, `deckard.setFieldFromLine`,
  `deckard.fileLine`, and `deckard.fileLineUnder`, are not in the palette or
  `package.json`: each needs the line it was offered on, as
  `deckard.createTypeRow` does. Each reads the line again, and writes
  nothing, saying so, when it no longer says what was offered.
- **The Words column** is read lowercased, its spaces collapsed, each
  phrase once, and is absent when empty. The parse format is now
  `type-words`, so cached type notes are read again with it. Create Type
  from Tags writes no Words column, and the type hover does not show it.
- **The sample** lists Words for a team's `lead`, `owns`, and `on-call`, and
  a person's `team` and `manager`; Team.md says what they are for.
- **The host test** runs with no workspace folder, so it writes into a hub
  note that exists and leaves the new hub note's write to the planner's
  tests.
- **The parse format** became `type-words-questions` when plan 38's
  `note-questions` was merged in, so a cache is rebuilt once for both.
