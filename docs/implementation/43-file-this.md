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
