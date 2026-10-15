# 44 · Type builder

A type is a Markdown note with a schema table (plan 30), and building one by
hand means typing the header and separator rows, knowing the kinds by heart
(`Person, many`, `Select: gold, silver`, `Team or Area`), and keeping the
columns aligned as fields come and go. The type builder is a form that
writes the note for the reader, in the same quick-pick style as New Note
from Type… and Edit Fields… (plans 31 and 34). The table stays the source
of truth: the form only writes it, and it can still be edited by hand.
Mockups: the "Type Builder" artifact.

## Ways in

- **New Type…** (command palette): asks the type's name, then what its rows
  are, writes `Types/<Name>.md` with an empty table, and opens the type
  form on it.
- **Edit Type…** (command palette, the editor title bar of a type note, a
  type note's CodeLens, and ⋯ on a type's page): opens the type form.
  **Change field…** on a column's menu on a type's page opens a field's
  menu in it. From
  a type note it opens that type; from a row's note, the note's first type;
  anywhere else it asks which type.
- **Add field…** (a type note's CodeLens): opens the form's Add field steps,
  then the form.
- **Create Type from Tags…** is unchanged: it guesses fields from the hub
  notes, writes the note, and opens it.

## New Type

1. **Name** (input box). The name is the heading and the file name; the
   key is its slug. The message under the input says
   `Writes Types/Org.md. Its rows are searched as type = org.` A name a type
   already has, or one a file cannot have, is refused there.
2. **Rows** (quick pick). The namespaces in use, as Create Type from Tags
   lists them (most tags first), each `Each #org/… tag` with its count;
   **Another namespace…** (an input for one not in use yet); **Each
   person**, when no type has people; and **Each note that says
   type: org**. No `notes:` is written: a namespace type's new rows go to
   the plural of its name (`Orgs/`) when it has none, as plan 30 reads a
   missing one, and the form's **New notes go in** writes one.

The note is written as one write (Undo Last Change deletes it), opened
beside, and the type form opens on it.

## The type form

One quick pick, titled `Org · Types/Org.md`, that stays until Done or
Escape:

- **Fields**, in the table's order: the name, the kind as the table writes
  it in the description, and in the detail what else is set (`Reverse:
  lead of · Also called: owner`). A field the note has a problem with shows
  the problem's message in its detail instead.
- **Add field…**
- **Type**: **Rows** (what `rows:` says, with the row count), **New notes
  go in** (the `notes:` folder; namespace types only), **Open Types/Org.md**.
- **Done**.

A title-bar button opens the type note beside the form.

Each change is written as it is made, one write per change, so Escape never
loses a field and the note open beside updates as the form is used (D1).
The form is drawn again from the note as it is after each write, so an edit
made by hand meanwhile is shown, not overwritten.

## Add field

1. **Name** (input box). The message shows how it is written and searched:
   `Written in front matter as Distribution List:, searched as
   distribution-list.` Refused: a name that cannot be a key, one the type
   already has (compared as keys, so `distribution list` repeats
   `Distribution List`). A name a search already reads (`status`, `owner`)
   is allowed with a warning that it is searched as `field.status`.
2. **Kind** (quick pick). **Rows** first: Person, the workspace's types,
   **More than one type…** (a multi-select of the types, written
   `Team or Area`), and Note; then **Values**: Text, Number, Date, Select…,
   Checkbox, Link, Email, Phone. Each has an example of how a value is
   written. Select… asks for its options next, as a comma list.
3. **One or many** (quick pick), skipped for Checkbox: **One person** /
   **Several people**, each with how a row's front matter writes it.
4. **Reverse** (input box), only for Person and relations: what the other
   side's page calls the link, empty for `<field> of`, with an example from
   the workspace (`Dana's page will list on distribution list for`).

Escape at any step writes nothing for the field. Enter on the last step
adds the table row and returns to the form with the new field active.
Also called and Words are not asked for here (D2); they are on the field's
menu.

## A field's menu

Choosing a field opens its menu, each row showing its current value:

- **Rename…**: Rename field everywhere (plan 30 B5's rename, with its
  preview of the row notes it rewrites).
- **Kind**: the Kind list, preselected on the current kind; Select… with
  its current options filled in. One or many is kept.
- **Holds**: one or several (not for Checkbox).
- **Reverse**: for Person and relations.
- **Also called**: a comma list.
- **Words**: a comma list of phrases (plan 43).
- **Move up**, **Move down**.
- **Remove from Org**: removes the table row only (D3). Row notes keep the
  key, which then shows as one of the note's other keys. It asks first,
  naming how many notes write the field.

## Writing the table

`domain/types/typeSchemaEdits.ts` edits the schema table of a type note's
text: add a row, set a field's cells, move a row, remove a row, and
realign. It reads the table with the same rules as `parseTypeNote` (the
first table, outside front matter and code fences, whose header has Field
and Kind), rewrites it aligned with `writeTable`, and keeps:

- columns Deckard does not read, and their cells;
- a separator's alignment colons;
- rows Deckard cannot read as fields (a row with no name, a bad name), in
  place;
- a Field cell written in backticks.

A column the edit needs that the table lacks (Reverse, Also called, Words)
is added after the last column Deckard reads. A type note with no schema
table gets one after its first heading.

## In the editor

- A CodeLens on the first line of a type note's schema table: **Edit
  Type…**, **Add field…**, and the count of fields and rows, which opens
  the type's page.
- A hover on each header cell of the schema table says what the column
  holds; the Kind header lists every kind with an example and `, many`.
- **Format Document** on a type note realigns its schema table (a
  formatting provider for Markdown that only answers in type notes, and
  only when the table needs it).
- **Edit Type…** in the editor title bar while a type note is open.

## On a type's page

⋯ gains **Edit type…** after Add <type>…, and a schema field's column menu
gains **Change field…**, which opens the field's menu in the form. The
one-line field summary drawn in the mockup is left out (D4).

## Decisions

- **D1**: each change is written when made, not saved at the end as Edit
  Fields… does; Escape never loses work.
- **D2**: Add field asks only for the name, kind, one or many, and the
  reverse of a link; Also called and Words are on the field's menu.
- **D3**: Remove takes out the table row and never edits row notes.
- **D4**: no field summary line on the type page; ⋯'s Edit type… is the
  way in there, with no new webview drawing.
- **D5**: the form is a quick pick, not a page.
