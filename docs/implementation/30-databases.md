# 30 · Databases: types, fields, and answers

Notion-style types over plain front matter, so Deckard can hold a work
knowledge base (who is on which team, who owns what, how to reach them, what
they are working on) and answer questions such as "who leads the team
responsible for bond trading?" from Find, a hover, a page, or an assistant.

Proposal, mockups, and the UX review against plan 29 and Zen:
https://claude.ai/artifact/L6zQFpgvo5p44EmCjpeUk5 (revision 3). David
approved it on 2026-10-08 ("implement"), taking the recommended option on
every decision below.

This plan reverses the "Typed front matter schemas" row of
`docs/improvements.md` § Intentionally skipped, and the front-matter form that
`docs/ux-fifteen-sources-plan.md` declined. Those calls assumed general readers
who already have tags and links. A who-owns-what knowledge base is the use they
did not foresee.

## Decisions

| # | Decision | Taken |
| --- | --- | --- |
| D1 | Where a type's schema lives | A Markdown note per type in `Types/`, fields in a table. The folder is not indexed as notes. |
| D2 | What makes a note a row | Both, by kind. Things you mention: tags in a namespace, the hub note as the page. Notes you write: a `type:` field. Nested namespace tags are rows with a computed `parent`. |
| D3 | Two-way relations | Written on one side; the reverse is computed and named in the schema. Both sides merge; a disagreement is a diagnostic. |
| D4 | Field names in queries | Bare names (`lead = @dana`). Built-ins win; Create Type renames a colliding field and says so; a hand-written collision gets a diagnostic and is reachable as `field.<name>`. |
| D5 | Loose values written by hand | Accepted and resolved (`dana`, `Dana Whitfield`, `rates`). Deckard writes the tag form. An unresolved value is an Information diagnostic. |
| D6 | Order | Answers before editing. |
| D7 | Where a type is viewed | The search page, with a rows tab beside Notes and Tasks. No new page kind, no Board, no Cards. |
| D8 | Avatars and option colors | Neither. People are links with their title; options are plain text. |

## The model

### A type note

A type is one Markdown note in the types folder (`Types/` under the notes
folder, setting-free; the folder name is fixed so it can be excluded from the
index without a setting, as `templates/` is).

```markdown
---
deckard-type: team
rows: "#team/*"
notes: Teams/
---
# Team

| Field   | Kind                         | Reverse     | Also called           |
| ------- | ---------------------------- | ----------- | --------------------- |
| lead    | Person                       | lead of     | head, manager, run by |
| owns    | Area, many                   | owned by    | responsible for       |
| tier    | Select: gold, silver, bronze |             |                       |
| on-call | Person                       | on call for | oncall, pager         |
| channel | Text                         |             | slack, support        |

Free text below the table describes the type.
```

- **Front matter.** `deckard-type:` is the type's key (a slug; the note's
  first heading is its display name, else the key title-cased). `rows:` is
  either a namespace pattern (`"#team/*"`, `"@*"` for people, which also
  covers `#person/…`) or `notes` (rows are notes whose `type:` equals the
  key). `notes:` is the folder new rows are written to (default: the notes
  folder's root, or `<Plural display name>/`).
- **The first Markdown table** whose header row has `Field` and `Kind` is the
  schema. Columns, case-insensitive: `Field` (required), `Kind` (required),
  `Reverse`, `Also called` (comma-separated). Unknown columns are ignored and
  kept when Deckard rewrites the table.
- **Kinds**, case-insensitive, with an optional `, many`:
  `Text`, `Number`, `Date`, `Checkbox`, `Select: a, b, c` (one or many),
  `Person`, `<Type display name or key>` (a relation to that type; `A or B`
  allows two), `Note` (a `[[link]]`), `Link` (URL), `Email`, `Phone`.
  An unknown kind reads as Text with a diagnostic.
- **Reverse** names the computed field on the other side of a relation. Empty
  means `<field> of`. Reverse names are slugged for queries (`owned by` →
  `owned-by`).
- **Built-in fields** of every type, not in the table: the row's title, tag
  (namespace types) or file (note types), and the computed fields below.

### Rows

- **Namespace types.** Every tag matching `rows:` is a row, whether or not a
  note describes it. Its page is its hub note (the note whose `describes:`
  names the tag), and the hub's front matter holds its fields. A nested tag
  (`#team/rates/emea`) is a row too, with a computed `parent` relation to
  `#team/rates` (and reverse `children`). People: `@dana` and `#person/dana`
  are the same row, as they are the same person today.
- **Note types.** Every note whose front matter has `type: <key>`, for a key
  some type note defines, is a row. A `type:` naming no type is an ordinary
  field. Its title is the note's title.
- A note can be the hub of a namespace row and a note-type row at once. The
  two field sets read the same front matter; a field defined with two
  different kinds gets a diagnostic, and the first type in key order wins.
- A heading in a daily note is never a row (it has no front matter).

### Values

Front-matter values are read by the existing parser (`readFrontmatterValues`,
`src/domain/markdown/parser.ts`) and resolved by the field's kind:

| Kind | Written by Deckard | Also accepted by hand |
| --- | --- | --- |
| Text | as typed | anything |
| Number | `12` | digits, `1,200`, `1.5` |
| Date | `2026-03-01` | ISO; the plain words the task editor takes |
| Checkbox | `true` / `false` | yes/no, on/off |
| Select | the option as the schema spells it | any case |
| Person / relation to a namespace type | `"@dana"`, `"#area/bond-trading"` | a slug (`dana`), a title (`Dana Whitfield`), an alias, with or without the namespace |
| Relation to a note type / Note | `"[[RFQ outage]]"` | a bare title |
| Link / Email / Phone | as typed | as typed |

A value that resolves to nothing is kept as text and gets an Information
diagnostic in the editor ("No person is named "Omar H" yet."), counted in the
one problems lens.

Front-matter tag inheritance is unchanged: a value written as a tag still
tags every entry in its note (so Rates' note is listed on `@dana`'s page). A
loose value that resolves to a row does **not** add a tag, so writing
`team: rates` by hand changes nothing outside typed features.

### Computed fields

Never stored, always current, available as columns, in hovers, panels, Find
answers, the assistant tool, and queries:

- **Reverse** of each relation, named by the schema.
- **Paths**: `team.lead`, `owned-by.lead`, up to two hops.
- **From the notes**: `open-tasks` (count, with overdue), `last-mentioned`
  (date of the latest entry that mentions the row's tag, or links to a note
  row), `mentions` (entries in the last 30 days), `linked-from` (note rows).
- **`parent` / `children`** for nested namespace rows.

When both sides of a relation are written (Dana's `team: rates`, Rates'
`members: ["@dana"]`), they merge. When a reverse and a written field name
the same thing differently, the row gets a diagnostic.

## Query language

Additions only; every existing query keeps its meaning.

```
type = team                     rows of a type (is:team also works)
lead = @dana                    a schema field by name
owns = "Bond trading"           relation values resolve as front matter does
team.lead = @dana               a path, up to two hops
owned-by.lead = @dana           reverse names in paths
tier = gold, silver             select: any of
headcount > 10                  numbers and dates compare by kind
has:on-call   -has:email        filled or empty
team = this                     in a query block: the note the block is in
field.status = active           a schema field whose name a built-in takes
```

- A field name is looked up after the built-ins. An unknown field is still an
  error, now listing the type fields it could have meant.
- `type = X` matches rows of type X: tags for namespace types, notes for note
  types. A search for a namespace type's rows returns entries as today
  (Notes and Tasks tabs) **and** the rows (the new rows tab).
- The builder (`src/webview/shared/queryEditor.tsx`) offers type fields in a
  native select with optgroups: the type's own fields, then "Through
  <relation>" groups one level deep, then "Built in". Options are written as
  query names. Builder parity holds: anything typed can be built.
- Suggestions offer field names after a type condition, values by kind after
  a field.

## Surfaces

Every webview surface below follows plan 29: one page bar, at most one
primary, row ⋯ revealed on hover (R11), controls in ⋯ View rather than new
bar chrome, Zen quiets controls in place and never hides data, and the bar is
identical with Zen on and off apart from the eyebrow trail.

### 1. Create Type from Tags (command)

`Deckard: Create Type from Tags…`, a QuickPick, also a ⋯ Page row on a tag
page ("Create type from #team…").

1. Pick rows: namespaces with counts ("#team · 6 tags · 5 hub notes"), "@
   people", then a "Notes with a type field" separator listing `type:` values
   already in use ("type: incident · 7 notes") and "New note type…".
2. `canPickMany` fields already used by those rows' notes, each described as
   "Person · 5 of 5 · reverse: lead of". Kinds are guessed from values: all
   tags of one namespace → that relation (or Person); ISO dates → Date;
   numbers → Number; ≤ 6 distinct short values reused across rows → Select;
   URLs/emails → Link/Email; else Text. A field whose name a built-in query
   field takes is renamed `<type>-<name>` with a detail line saying so.
   Mixed namespaces get a detail line ("2 values are #system/ tags").
3. Writes `Types/<Display>.md` (one note, no preview, undoable), opens it
   beside, and leaves mismatches as diagnostics on the table with quick fixes
   ("Allow Area or System", "Create a System type").

A workspace with no types gets no prompt. The work sample ships Person, Team,
and Decision types.

### 2. Editor

- **Completions** in a row note's front matter: field names of its type(s)
  after a newline; rows of the related type, options of a select, after a
  field name. Each completion's detail says what it is ("Team · lead Omar
  Haddad"); its documentation says what will be written.
- **In a type note**: completions for `Kind` values (kinds and type names) and
  for `rows:`.
- **Diagnostics** (Information): unresolved value; a kind mismatch (`date:
  soon`); a field colliding with a built-in; two types defining one field with
  different kinds; both sides of a relation disagreeing. Quick fixes: "Change
  to @omar (Omar Haddad)", "Create person "Omar H"", and on a type note "Allow
  A or B", "Create a <Type> type".
- **Lens on line 1**: the existing hub lens is prefixed with the row's type
  and its first relation ("Person · Credit Trading | 1/3 done (33%) · …");
  unresolved values are counted in the existing single problems lens. No new
  lens.
- **Hover** on a tag (`provideTagHover`, `src/ui/providers/editorReferences.ts`):
  for a typed row, line 1 "**Title** `@dana` · Person · <first Text field>",
  then relations and reverses ("Team Rates · lead of Rates"), contact-kind
  fields, activity with full dates ("last mentioned today · 2026-10-08"), and
  links "Open @dana", "Open <hub>.md", "Copy email". Untyped tags hover as today.

### 3. Find answers

`src/ui/state/quickFindState.ts` gains a top tier under an **Answer**
separator. The words are split into a row phrase and a field phrase:

1. Row: the longest run of words matching a row's title, slug, or alias
   (any type).
2. Field: the remaining words matching a field name, reverse name, or "also
   called" word, on the row's type or within two hops of it.
3. Path: breadth-first over relations and reverses, at most two hops, from
   the row to a field; each answer is the field's value(s).

Up to three answers, each an item with a codicon by kind (`$(person)`,
`$(tag)`, `$(note)`), the value as label, "@dana · Person · Head of Rates" as
description, and the path as detail ("Bond trading › owned by Rates ›
lead"). Accepting it opens the value's page. Also "who is on X" (members),
"X channel", "what does priya own". The rest of Find is unchanged; typed rows
under Tags get their type and one fact in the description.

### 4. Assistant tool

`deckard_describe_tag` ("Describe a Deckard tag and its fields"), read-only,
in `ASSISTANT_TOOLS` (`src/ui/state/assistantTools.ts`) and `package.json`'s
`languageModelTools`, and so on the MCP server. Input `{ tag: string }`
(a tag, a title, or a phrase; resolved like Find's row step). Output, plain
text: type, key, file; each field and value; reverses; open tasks; latest
entries with dates. `deckard_query`'s description lists the workspace's
types and their fields, and its query accepts the new fields.

### 5. Note page fields

`src/webview/notePage/main.tsx`: the properties line leaves the page bar's
lead and becomes a region below the bar's divider (`section.note-fields`,
`data-zen-region`). The HubLine's eyebrow names the type ("Team"), linked to
the type's search.

- One row per filled field: the key in monospace, muted; its values. Person
  and relation values are links with the row's title; selecting one opens it,
  as today.
- Reverse fields in italics, with "From each person's team" as a tooltip.
- Empty schema fields fold into one line, "1 empty: email".
- Editing: an **Edit** button revealed on the hovered or focused row
  (`data-zen-reveal`), or Enter on the focused row, opens a list by kind
  (rows of the related type with their first relation as detail; select
  options; a date input; a text input). Choosing writes one front-matter line
  (see Writes) and Undo Last Change takes it back. "Add field…" lists the
  type's empty fields, then "Other…" for a free key.
- Notes with front matter but no type keep today's read-only properties,
  moved into the same region.

Zen: names, values, and the empty-fields line stay; Edit and Add field… wait
in place for the pointer or Tab. An open list stays open.

### 6. Tag page

`src/webview/searchPage/hub.tsx`: for a typed row with a hub note, the hub
card's properties line becomes the same field rows (read-only here; Edit
lives on the Note page). For a typed row **without** a hub note, the hub
card's slot shows a "Fields" card (a `details` like the hub card) with the
reverse fields and computed paths, so a row with no note still shows who owns
it. "Create hub note" stays the text link under the title. Page order is
unchanged.

### 7. Types as searches

The search page (`src/webview/searchPage/`) for a query whose top level
includes `type = X` titles itself with the type's plural display name
("Teams") and its mono subtitle with `rows:` ("#team/*", or "type: incident ·
Incidents/").

- **Rows tab.** A third tab, first, "Teams (4)", beside Notes and Tasks,
  drawn with the Task board's `ResultTable` (`src/webview/taskBoard/`, moved
  to `src/webview/shared/` if needed). Columns: the row's title, the schema's
  fields (keys as written, monospace), then computed columns in sentence
  case, muted, titled "Computed: not written in the note". Default columns:
  every schema field plus Open tasks and Last mentioned. Dates as
  "today · 2026-10-08". A namespace row with no hub note reads "No hub note ·
  6 entries", with Create hub note revealed on hover.
- **Header**: click sorts (as the Task board table). Right-click or
  Shift+F10: Sort A-Z, Sort Z-A, Hide column, separator, Rename field
  everywhere… (refactor preview), Edit in Types/<Type>.md. Right-click on a
  select value: Rename option everywhere….
- **⋯ Page** gains "Add <type>…" (asks a title, writes the row note from the
  type's template: `templates/<key>.md` if any, else front matter with the
  schema's keys, into `notes:`), and "Open Types/<Type>.md". **⋯ View** gains
  "<Type> columns…" (the Task board's ColumnPicker) and Group by gains every
  select, person, and relation field; a row in two groups is listed in both.
- **Refine** shows select fields as facets with counts.
- **Save search…** puts a type on Home as a saved search; no new widget.
- The Hubs view: selecting a typed group heading opens its search. No other
  change.
- Query blocks: `noteColumns=` accepts any field, path, reverse, or computed
  name; `this` is the note the block is in.

Zen, per the plan 29 table: bar, field and chips, folded Refine, tab counts,
every cell, overdue figures, and full dates are kept; Sort and Bulk edit
(results heading), row ⋯, and Create hub note on no-note rows are quieted. A
header sort keeps "Sorted by <field> · Sort A-Z" drawn.

## Writes

- A field edit writes one key in one note's front matter, keeping key order,
  quoting style, comments, and other keys byte for byte. A missing key is
  appended after the last key. A note without front matter gets one.
- Values the writer cannot rewrite safely (block scalars, nested maps) open
  the editor at that line instead.
- Rename field / option everywhere goes through the existing refactor preview
  (`EditApplier`), one edit per note, undoable as one write.
- Creating a type, a row note, or changing `Types/*.md` is one note, applied
  directly, undoable.

## Index

- `PARSE_FORMAT` bumps: `ParsedFile` keeps `properties` (every front-matter
  key, values in order, with the existing tag detection) for every note with
  front matter, not only hubs, and `typeKey` from `type:`.
- `Types/` and the templates folder are excluded from entries, Find, Related
  notes, and counts; type notes are parsed into a `TypeRegistry`.
- A `TypeIndex` (domain, VS Code-free) resolves rows, values, reverses,
  paths, and computed fields from `IndexState`; it rebuilds incrementally on
  change, as tags do.

## Order of work

Each batch: `check-types`, `lint`, and the unit tests written for it, then a
commit. No browser suites until the end. At the end: the full suite, darwin
baselines recorded, Linux baselines from CI.

1. **Model and index.** Type notes and their table parser, kinds, rows of both
   kinds, nested parents, value resolution, reverse index, computed fields,
   `PARSE_FORMAT` bump, `Types/` exclusion. Unit tests.
2. **Query language.** `type`, fields, paths, reverses, kinds, `has:`,
   `this`, `field.`, suggestions, builder optgroups. Unit tests.
3. **Editor and Create Type.** Completions, diagnostics, quick fixes, lens
   prefix, problems count, hover, the Create Type QuickPick. Unit tests.
4. **Answers.** Find's Answer tier, `deckard_describe_tag`, `deckard_query`'s
   description. Unit tests.
5. **Fields on pages.** Note page fields region and editing, the front-matter
   writer, the tag page Fields card. Unit tests.
6. **Types as searches.** Rows tab, header menu, ⋯ rows, Group by, Refine
   facets, Hubs view heading, query block columns and `this`. Unit tests.
7. **Docs and sample.** Guide (notes-and-links, search, search-pages,
   query-blocks, ai-assistants, a new databases page), Help, README features,
   `docs/improvements.md`, CHANGELOG, the work sample's `Types/`.
8. **Full suite**, baselines, lint at zero warnings, `npm audit`.

## Left out

A type page of its own, Board and Cards views, formulas and numeric rollups,
per-field visibility settings, colored options and avatars, history,
stale-fact warnings, timeline/chart/form views, questions beyond row + field
in Find, and a front-matter form in the text editor.
