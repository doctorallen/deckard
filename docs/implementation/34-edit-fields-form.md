# 34 · Edit fields in the form

Plans 30 and 33 gave a typed row's fields an editor of their own on each
page: an **Edit** on every row, Enter on a focused row, a list or input
under it by kind, **Add field…** with Other…, the empty fields folded into
"N empty: …", and, on a tag's page with no note, a **Not set** row per field
whose Edit opened plan 31's form. David: "I feel like there are too many
edit buttons now and they all have their own UI. Why not reuse the New Note
from Type... form to edit those?"

This plan does that. It supersedes the per-row editing of plan 30 (§ Surfaces
5, Note page fields: Edit, Enter, the inputs by kind, Add field…, the empty
line) and of plan 33 (§ What changed 3 and 4, and the decision that drew
Edit at rest). Plan 32's rows in Context edit nothing, and stay as they are.
What those plans say of how fields are **drawn** (key and values, From other
notes, Set in …, details) stays.

## One form, two modes

`openTypeNoteForm` (`src/ui/commands/typeNoteForm.ts`) opens on a new note,
as plan 31 built it, or on a row's note that exists: the hub note of a
namespace row, or a note with `type:`.

- **Title** `Edit fields: Rates`; **placeholder** the type and the note,
  `Team · Teams/Rates.md`.
- **No Folder, Title, or Tag rows**: editing never moves or renames.
- **Fields**: the same rows, icons, inputs by kind, and Clear as create
  mode, filled in from the note's front matter. A value that names a row is
  read as Deckard writes it (`@dana`); one that names nothing is shown as
  written. A field the writer cannot rewrite (a `|` block, a nested map)
  reads **Edit in the note**, and choosing it opens the editor at its line.
- **From other notes**: each reverse a row, its values as the description
  and where it is set as the detail, in the pages' words ("Set in Payments'
  lead", "Set in each person's manager"). Choosing one opens the one note
  that sets it at that line, or, for several, the search for those rows.
- **`$(save) Save changes`** last ("Enter"); with nothing changed it reads
  **No changes** and Enter closes the form.
- **Save** writes only the keys that changed, each by `setFrontmatterField`,
  as one edit through the write history, so Undo Last Change takes the
  whole save back; every other key and comment stays as written. A note
  whose front matter changed since the form read it is not written: the
  Save row says so, in `describeStale`'s words.
- It can open on one field's input, as plan 33's create mode could.

The draft model (`src/domain/types/typedNoteDraft.ts`) gains an existing
note: its path, title, the values it held, the fields the writer refuses,
and its front matter as read, which the save planner checks and diffs.

## The pages show fields

The Note page and a tag's page draw a row's fields and edit none in place:
no Edit, no Enter on a row, no inputs, no Add field…, no "N empty" line. A
field's **name** is a quiet link, drawn as the key is and underlined on
hover and focus, that opens the form on that field. Each surface has one way
in, all sending `editFields { filePath, field? }`, which the host checks is
the row note the page drew:

| Surface | Way in |
| --- | --- |
| A tag's page, hub card of a typed row | **Edit fields…** beside **Open <note>** in the card's header |
| A tag's page, Fields card (no note) | "No note describes @tag yet." and **Add fields…**, the create form with title and tag fixed; the type's fields are no longer listed Not set |
| The Note page, a typed note | **Edit fields…** at the end of the fields region, and **Edit fields…** in ⋯ Page |
| A type's rows tab | A row's ⋯ **Edit fields…**, for a row with a note |
| The editor | **Deckard: Edit Fields…** (`deckard.editFields`) on the note in front; a note with no type is told so and offered New Note from Type… |

Under Zen, Edit fields… and Add fields… are quieted in place
(`data-zen-reveal`, the card header and the fields regions their
`data-zen-region`); field names stay drawn as text and work by keyboard.

## What goes

`src/webview/shared/fieldEditing.ts`, the editor half of `fieldRows.tsx`
(Edit, the lists, inputs, Clear, Add field…, the empty fold), the
`setNoteField` message and narrower, `writeNoteField` and
`planNoteFieldWrite`, the `FieldEditor`/`FieldChoice`/`FieldEditValue`
shapes, `DrawnFields.empty`, `choices`, `noNote`, `DrawnField.edit` and
`startsNote`, `createHubNote`'s `field`, and their CSS.

## Order of work

1. This plan.
2. The draft model's existing note and the save planner, with tests.
3. The form's edit mode: rows (pure) and the command, with tests.
4. The pages: fields drawn without editing, the ways in, the host message,
   the command; dead code out; tests.
5. The guide, the work sample's README, and the CHANGELOG.

`npm run check-types`, `npm run lint` at zero warnings, and
`npm run test:unit`; the browser and host suites are left to CI.
