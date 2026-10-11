# 33 · Clearer fields

> Plan 34 (`34-edit-fields-form.md`) replaces this plan's editing on the pages (3 and 4, and Edit drawn at rest) with Edit fields…, which opens the New Note from Type… form on the note.

A follow-up to plan 30's fields (§ Surfaces 5 and 6). On the work sample,
the page for `@alex-rivera`, a Person with no hub note, showed a
"FIELDS · Person" card of italic rows, *lead of*, *reports*, *decided*.
David: "it's not clear how to edit the fields for alex rivera, or why the
fields are there". Every row was a reverse worked out from other notes, and
only italics and a tooltip said so; the row's own fields (role, team,
manager, email) were not shown, since no note held them; the only way to
write them was **Create hub note**, far above; the tag page's fields were
read-only even for a row with a note; and each value's details repeated the
row itself, *Payments (lead Alex Rivera · on-call Sam Okafor)*.

A hub note opens as its tag's page, never on the Note page, so for a
namespace type (people, teams, areas) the tag page is the only place its
fields are drawn. The Note page edits only notes that say `type:`.

## What changed

1. **Where each field comes from.** The shared field rows
   (`src/webview/shared/fieldRows.tsx`) draw the row's own fields first,
   the empty ones folded, then Add field…; then a muted sentence-case
   label, **From other notes** (no eyebrow, so Zen keeps it), over the
   reverses. Each reverse keeps its italic key and says under its values
   where it is set: *Set in Payments' `lead`* when one row sets it, *Set in
   each person's `manager`* when several do, *Also set in …* for a field
   the note writes that a reverse fills too. The model
   (`describeFieldSources` in `src/ui/state/noteFields.ts`) groups the
   sources by type and field. The tooltip stays.
2. **Details leave out the row shown.** A value's details on a no-note
   row's card drop each fact that names only the row, and a fact that
   names it among others keeps the others, prefixed *also*: *ADR-002
   Feature flags (also decided-by Theo Park)*. Nothing left, no
   parenthesis.
3. **The tag page edits.** The hub card's fields are the Note page's:
   **Edit** on each field the note writes, Enter on a focused row, the same
   editors, *N empty*, **Add field…**, written through the same host code
   (`writeNoteField`, one write with Undo). The webview half lives in
   `src/webview/shared/fieldEditing.ts`, which both pages use; the
   `setNoteField` narrower moved to `src/ui/webview/host/narrowing.ts`, and
   the search page's controller writes only the hub note it drew with
   fields.
4. **A row with no note.** The Fields card says *No note describes
   @alex-rivera yet.*, then lists the type's fields as *Not set*, each with
   **Edit**, which sends `createHubNote` with the field's key: plan 31's
   form opens with the title and tag filled in and kept, on that field's
   input first (`TypeNoteFormRequest.field`, `findStartField`), then shows
   as usual. **Add field…** opens the same form. A type with no fields has
   no *Not set* rows; a row with neither fields nor reverses has no card.

## Decisions

- **Edit is drawn at rest at Full**, on both pages, rather than revealed on
  the row's hover as plan 30 built it. David could not find Edit; the
  coordinator asked for the tag page's Edit to be visible at rest with Zen
  off, the same as the Note page's, and the only way to keep the two pages
  the same was to change both. Zen still quiets it in the fields region.
  The Note page's darwin and Linux screenshots change with it.
- *also decided-by Theo Park* over *with Theo Park*: it keeps the field's
  name, so a details line with several facts stays readable.
- The source sits on its own muted line under the values, rather than
  after them on the same line, where it ran into a value's details.
- The `notePageFields` UI surface draws a decision (a note-type row), not
  Dana's hub note, which never opens on the Note page. Its DOM golden and
  screenshots are to be recorded again, as are `searchPageFieldsCard`'s.
