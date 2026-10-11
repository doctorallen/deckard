# 32 · Rows of the same type in Context

Plan 30 made types: `Types/<Type>.md` schemas whose rows are the tags of a
namespace or the notes whose front matter says `type: <key>`. David asked
whether Related notes should show the other notes of the same type as the
one being read.

## Decision

Neither a tab nor a mix into the Related notes list. "Same type" alone is
too broad: every person is a Person, so a list of every other person says
nothing about this one. And Context is a stack of sections, with no tabs.

Instead, a section of its own under Related notes, above Linked from, that
appears only when the open note is a typed row. It lists the other rows of
the same type that **share a relation value** with it, grouped by the value
they share: the people on the same team, with the same manager, on the same
project.

## The section

- **When.** The note in the editor (or on the Note page) holds a typed row's
  fields: `rowsOfFile(path)`, the first by its type's key when it holds
  several, as the Note page reads them. Otherwise there is no section and no
  placeholder. A focused entry ("Show related notes for [entry]") does not
  change it: it is about the note, as Linked from is.
- **Heading.** "Other people", "Other decisions": the type's plural name,
  lowercased, styled as Linked from is, with how many rows it lists, and on
  the right **All people**, which opens the `type = person` search.
- **Groups.** For each relation field of the type (Person, a relation to a
  type, Note) and then each reverse, for each value the row has in it: the
  other rows of the type whose same field holds that value. The label is the
  field's key, muted and in monospace (a reverse's in italics, as on the
  Note page), then the value's title: `team` Payments. The label opens the
  search `type = person AND team = #team/payments`, which finds the group's
  rows and this one. Empty groups are left out. A row can be in several.
- **Rows.** Each one line: its title, which opens its note, or its tag's
  page when it has no hub note; then one fact, muted: what the hover leads
  with (`findRowSummary`), else "No hub note", else its first other
  relation. Parked rows come last, marked Parked, as in Linked from. Eight to
  a group, then **+N more**, which opens the group's search.
- **Nothing shared.** "No other person shares a team, manager, or project."
  (up to three of the type's relation fields). A type with no relation
  fields has nothing to compare by, so the section is left out.
- **Fold.** A `details`, like Linked from and Mentioned without a link, kept
  open or closed as the reader leaves it (`linksOpen.sameType`).
- **Zen.** It is content: nothing in it is quieted, as nothing in Linked
  from is.

No new settings, colors, or bar controls. Daily notes: Hide does not apply:
rows are typed notes, rarely periodic.

## Why the ranking is unchanged

Weighting Related notes by a shared relation value was considered and
declined. Links count only between the two entries today (A links to B).
A front-matter relation is file-level, so it would lift every entry of both
notes at once, and a value shared by many rows (every person on a large
team) would flood the list unless it were normalized for how common the
value is, as tags are. If it is wanted later, it should be a separate signal
limited to the schema's relations and normalized for prevalence.

## Decisions

Where the request was silent:

1. **A type with no relation fields** has no section, rather than a line
   saying it has nothing to compare by: it could never list anything.
2. **The heading counts** the other rows the groups hold, each once, as
   Linked from counts its notes; with none, no count.
3. **A group's search finds the open note's row too**, since no query term
   leaves out one row; the group lists the others.
4. **A row's fact**: what the hover leads with, else "No hub note", else its
   first written relation besides the group's (`manager Alex Rivera`), so
   a row with no Text field still says something the group does not.
5. **A value that names nothing** (unresolved text) makes no group: there
   is no row or note to compare by.
6. **A reverse whose name a built-in takes** keeps its group, with its label
   and +N more as plain text, since no query can name it.
7. **All people** is drawn at the heading's right but comes first in focus
   order, before the fold's summary, so it is not inside the summary.
8. **A row's title opens its note first**, kept rather than previewed, as a
   related note opens, Cmd/Ctrl beside; its tag's page only when it has no
   note. The rows tab opens the tag's page first; the request asked for the
   note here.

## Order of work

1. This plan.
2. The section's builder, `src/ui/state/sameTypeRows.ts`, VS Code-free, with
   unit tests (groups, reverses, caps, parked, empty states, several rows in
   one note, an untyped note, and each group's search run through the
   evaluator).
3. The protocol, the sidebar's section, and the host's two messages (open a
   row, open a search), with narrowers and a jsdom test.
4. The guide (`connections.md`, `databases.md`) and the CHANGELOG.

`npm run check-types`, `npm run lint` at zero warnings, and
`npm run test:unit`; browser suites run once at the end.
