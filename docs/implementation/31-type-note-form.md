# 31 · A form for a new note of a type

Plan 30 made types: `Types/<Type>.md` schemas whose rows are the tags of a
namespace (fields in the tag's hub note) or the notes whose front matter
says `type: <key>`. A new row could be made two ways, both asking only a
title: the search page's **Add <type>…** and the quick fix **Create
person "Omar H"**. Every field was then filled in by hand.

David asked for "a form for creating a new hub note from a type like the
add task form", and then: "They don't have to be hub notes, just notes with
a type from the new database feature." This plan is that form.

## The form

One quick pick that stays open, built like Add Task's editor
(`src/ui/commands/taskEditor.ts`): every field a row, its value as the
description; choosing a row opens that field's own input and comes back;
nothing is written until the last row.

- **Title**: `Add a team to Teams/`, naming where the note goes, as
  `Add a task to 2026-10-06.md` does.
- **Placeholder**: what will be written, `Teams/Risk Tech.md · #team/risk-tech`
  (the tag only for a namespace type).
- **Rows**: `$(file) Folder` (the type's `notes:` folder, or its plural
  name), `$(pencil) Title` (Enter opens it first, as Description does in
  Add Task), `$(tag) Tag` for a namespace type; a **Fields** separator, then
  one row per schema field in the schema's order, its icon by kind, its
  value or "Not set"; a separator, then `$(save) Create the note` ("Enter").
- **Inputs by kind**: rows of the related type (several for `, many`,
  each with its type and first relation as detail; typed text that names
  no row is kept as written, as plan 30 accepts loose values), a select's
  options, the task editor's date box, Checkbox toggling in place, and an
  input box with validation for Number, Email, Link, Phone, and Text. Each
  input offers **Clear** once the field holds something.
- **Create**: a problem keeps the form open on the row at fault, the
  problem in its description: no title, a title that cannot name a file or
  a tag, a tag that already has a hub note, a note already there. Nothing
  is overwritten. The note is written as one change through `writeNewNote`,
  so Undo Last Change takes it back, and opened in the editor.

## The note it writes

`src/domain/types/typedNoteDraft.ts`, VS Code-free: `planRowNote`'s note,
with each field the form set written by `setFrontmatterField` in the form
Deckard writes by kind (`"@dana"`, `"#area/rates"`, `"[[RFQ outage]]"`, a
flow list for `, many`, `2026-03-01`, `true`/`false`, the option as the
schema spells it). A type's template (`templates/<key>.md`) still applies:
its questions are asked once Create is chosen, and the form's values take
the place of the keys it writes.

## Where it opens

- **Deckard: New Note from Type…** (`deckard.newTypedNote`): the
  workspace's types, then the form. With no types, it says so and offers
  Create Type from Tags….
- **Add <type>…** in a type's search page's ⋯.
- **Create person "Omar H"…**, the quick fix, with the title filled in.
- **Create Hub Note for Tag…**, the tag page's **Create hub note**, and a
  rows tab row's **Create hub note**, for a tag a type has rows of: the
  form with the tag and its title filled in, the tag fixed. A tag no type
  has makes its hub note as before.

## Decisions

Where David's two sentences and the brief were silent:

1. **Title wording.** "Add a team to Teams/" (an article, as Add Task's
   "Add a task to …"), "an" before a vowel.
2. **Placeholder with no title**: "Teams/ · Choose Title to name the note".
3. **Checkbox** cycles Not set → Yes → No → Not set in place, since No is
   written (`false`) and Not set is not.
4. **The quick fix** reads "Create person "Omar H"…", with an ellipsis,
   since it now opens a form.
5. **Opening**: the new note opens in the editor, beside for the quick fix,
   as `createRowNote` opened rows, not where `deckard.openNotesIn` says: a
   new note is opened to be written in.
6. **Folder**: the folders that hold notes, most notes first, the type's own
   folder leading; typing a path that is not listed makes a new folder.
7. **Tag**: follows the title until it is edited. A tag typed without its
   namespace is put under it (`risk` → `#team/risk`); nested tags are kept.
8. **A person with no Person type** (the quick fix in a workspace whose
   types have person fields but no Person type) gets the form with no
   fields, as `createRowNote` wrote such a hub note before.
9. **A template value the writer cannot rewrite** (a `|` block) is left as
   the template wrote it, and a message names the fields not written.
10. **Problems** show one at a time, on the first row at fault, in its
    description after `$(error)`.
11. **Clear**: a pick for one value leads with a **Clear** row once the
    field is set; a pick for several has a Clear button in its title bar
    that unticks every value; an input box clears when emptied, as the
    date box does.
12. **Focus**: the form opens on Title while there is none, then on the row
    last chosen, so a field after a field is one arrow away; on a problem,
    on its row.
13. **A tag given to the form** (a hub note for a tag) keeps its Tag row,
    which says "the tag this note describes" and, chosen, says in the
    status bar that it stays.
14. **`createRowNote` is gone**: every way to a new row's note goes through
    the form, so it had no callers left.

## Order of work

1. This plan.
2. The draft model and its tests.
3. The form's rows (pure), the form, and its tests.
4. The entry points and their routing tests; package.json and the command
   list.
5. The guide (`databases.md`, `commands.md`) and the CHANGELOG.

`npm run check-types`, `npm run lint` at zero warnings, and
`npm run test:unit`; host suites are type-checked, not run.
