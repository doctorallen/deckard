# Types and fields

A type says what a kind of thing in your notes is, such as a person, a team, or an incident, and which fields it has: a team's lead, the areas it owns, who is on call. The fields are front matter you write, or already wrote, in plain Markdown. Deckard reads them as a table you can search, sort, and group, works out the other side of each relation, and answers questions such as *who leads the team that owns checkout?* from Find, a hover, a page, or an assistant.

A workspace with no types works as it always has. The [work sample](getting-started.md#get-started) ships four types to try: Person, Team, Area, and Decision.

## Two kinds of type

- **Things you mention.** Teams, people, areas, systems: you already write them as tags, `#team/payments` or `@noor-haddad`. A type over a tag namespace makes every tag in it a row, whether or not a note describes it. A row's fields live in the front matter of its [hub note](search-pages.md#hub-notes), the note whose `describes:` names the tag.
- **Notes you write.** Incidents, decisions, meetings: each is a note of its own. A type of notes makes each note whose front matter says `type: incident` a row, and its fields are that note's front matter.

## A type note

Each type is one note in the `Types` folder of your notes folder (`deckard.notesFolder`). The folder's name is fixed. Deckard reads its notes as types and leaves them out of searches, counts, Find, Related notes, and the overviews, as it does the templates folder, so their tags and tasks never count as your notes'.

```markdown
---
deckard-type: team
rows: "#team/*"
notes: teams/
---
# Team

| Field   | Kind       | Reverse     | Also called     |
| ------- | ---------- | ----------- | --------------- |
| lead    | Person     | lead of     | head            |
| owns    | Area, many | owned by    | responsible for |
| on-call | Person     | on call for | oncall, pager   |
| channel | Text       |             | slack, support  |

Every #team/ tag is a team. Text below the table describes the type.
```

| Front matter | Says |
| --- | --- |
| `deckard-type` | The type's key, such as `team`: what `type = team` and `type: team` name. The note's first heading is its name, **Team**; without one, the key is. |
| `rows` | What its rows are: a namespace, `"#team/*"`; people, `"@*"`, which takes `#person/…` tags too; or `notes`, for notes whose `type:` is the key. Quote a value that starts with `#` or `@`. |
| `notes` | The folder a new row's note is written to, such as `teams/`. Without it, the type's plural name: `Teams/`, `People/`. |

The first table whose header has **Field** and **Kind** lists the fields, one to a row, in any case:

- **Field** is the front-matter key, such as `lead` or `on-call`.
- **Kind** says what its values are; see below. Add `, many` for a field that holds several, `Area, many`.
- **Reverse** names the field the other side of a relation gets: a team's `owns` makes each area **owned by** that team. Left empty, it is the field's name and *of*, `owns of`. In a search, its spaces are hyphens: `owned-by`.
- **Also called** lists other words for the field, separated by commas, which [Find](#asking-find) reads in a question.

Other columns are yours, and kept when Deckard rewrites the table. What Deckard cannot read in a type note, such as a kind it does not know or a field listed twice, is marked in the editor.

### Kinds

| Kind | A value is |
| --- | --- |
| `Text` | anything; also what an unknown kind reads as |
| `Number` | `12`, `1,200`, `1.5` |
| `Date` | a date |
| `Checkbox` | true or false |
| `Select: proposed, accepted, superseded` | one of the options, or several with `, many` |
| `Person` | a person, `@noor-haddad` |
| a type's name, such as `Area` | a row of that type; `Area or System` takes either |
| `Note` | a note, `[[Checkout v2]]` |
| `Link`, `Email`, `Phone` | a web address, an email address, a phone number |

### Field names a search already uses

A search already reads some words as its own fields: `status`, `owner`, `start`, `note`, `type`, `title`, and the others in the [query language](search.md#query-language). A field named one of them is still read and shown, is marked in its type note, and is reached in a search as `field.status`. Name such a field something else, such as `state`, to search it by name.

## Rows

**Rows of a namespace.** Every tag under the namespace is a row, with a hub note or without one. A nested tag, `#team/payments/fraud`, is a row too, with a **parent**, `#team/payments`, which lists it among its **children**; a level no note writes is filled in. `@noor-haddad` and `#person/noor-haddad` are one row, as they are one person everywhere in Deckard.

**Rows of notes.** Every note whose front matter says `type: incident` is a row of the type keyed `incident`, titled by the note. A `type:` that names no type is an ordinary field.

A note can be both, the hub note of `#team/payments` and a `type: decision`; both types read the same front matter. A heading in a daily note is never a row: it has no front matter.

### Writing values

```markdown
---
describes: "#team/payments"
lead: "@alex-rivera"
owns: ["#area/checkout", "#area/card-payments"]
on-call: "@sam-okafor"
channel: payments-eng
---
# Payments
```

Deckard writes each value one way, and reads what you write by hand as well:

| Kind | Deckard writes | Also read |
| --- | --- | --- |
| Number | `12` | `1,200`, `1.5` |
| Date | `2026-10-08` | a date in words, such as `next friday`, as the task editor takes |
| Checkbox | `true`, `false` | `yes`, `no`, `on`, `off` |
| Select | the option as the type spells it | any case |
| Person, or a row of a namespace | `"@noor-haddad"`, `"#area/checkout"` | its name without the marker, `noor-haddad`; its title, `Noor Haddad`; an alias; with or without the namespace |
| Note, or a row of notes | `"[[ADR-001 Card form]]"` | its title, bare |
| Text, Link, Email, Phone | as typed | as typed |

- Quote a tag: YAML reads an unquoted `#` as a comment.
- A value that names nothing is kept as text, and marked in the editor: *No person is named "Omar H" yet.*
- A value written as a tag still tags every entry in its note, as front matter always has: the Payments note is listed on `@alex-rivera`'s page. A value written loosely, `lead: Alex Rivera`, finds the row without tagging anything.
- When both sides of a relation are written, Noor's `team:` and the team's own `members:`, they are read together; a field that holds one value and is given two is marked.

## Computed fields

Every row also has fields no note writes, worked out from the notes each time they are read:

| Field | Holds |
| --- | --- |
| a reverse, such as `owned-by` or `members` | the rows whose relation names this one |
| a path, such as `team.lead` or `owned-by.lead` | a related row's field, through up to two relations: `owned-by.lead.email` |
| `open-tasks` | how many open tasks its tag finds, or its note holds, and how many are overdue |
| `last-mentioned` | the date of the latest entry that carries its tag or links to its note |
| `mentions` | how many entries did in the last 30 days |
| `linked-from` | for a row of notes, the notes that link to it |
| `parent`, `children` | for a nested tag, the tag above it and those below |

## Create Type from Tags

`Deckard: Create Type from Tags…`, also **Create type from #team…** in **⋯** on the page of a tag whose namespace has no type, makes a type from what your notes already write:

1. Choose the rows: a namespace with its counts (*#team · 6 tags · 5 hub notes*), **@ people**, a `type:` value in use (*type: incident · 7 notes*), or **New note type…**.
2. Choose the fields: each key the rows' notes write, all chosen, with a guessed kind, how many notes write it, and its reverse (*Person · 5 of 5 · reverse: lead of*). Values that are tags of one namespace guess a relation to that namespace's type, or Person; dates guess Date, numbers Number, addresses Link or Email, and a few short values used again and again Select. A field whose name a search already uses is written as `team-status`, and the list says so.
3. Deckard writes `Types/Team.md`, opens it beside, and marks any value that does not fit, with quick fixes such as **Allow Area or System** and **Create a System type**.

It is one write, which `Deckard: Undo Last Change` takes back. **New note type…** asks a name and writes a type of notes with an empty table to fill in.

## A type's rows

Search `type = team`, or select a namespace heading a type has in the [Hubs view](search-pages.md#the-hubs-view), and the [search page](search-pages.md#search-pages) is titled with the type's plural name, **Teams**, and under it what its rows are, `#team/*`, or `type: incident · Incidents/`. A new first tab, **Teams (4)**, beside **Notes** and **Tasks**, is a table of the rows the search finds; side by side, the table is above both.

- **Columns.** The title, then each field, headed by its key in monospace, then **Open tasks** and **Last mentioned**, headed in muted sentence case: *Computed: not written in the note*. **Team columns**, in **⋯**, adds or removes any of them: the reverses, such as **Members**, **Mentions**, a nested row's **Parent** and **Children**, and a note row's **Linked from**.
- **Cells.** A person or a related row is a link by its title. A reverse of people lists three by first name and how many more, *Dana, Sam, Lena +2*. A date reads *today · 2026-10-08*, and open tasks *4 · 1 overdue*.
- **A row with no note** says so, *No hub note · 6 entries*, with **Create hub note** on its row.
- **⋯ on a row** opens it or its hub note, offers **Create hub note**, and copies its email.
- **Sorting.** Select a heading to sort by it, and again for the other way. While it is sorted, *Sorted by lead* and **Sort A-Z** sit beside the tab; **Sort A-Z** goes back to by title.
- **A heading's menu**, by right-click or <kbd>Shift</kbd>+<kbd>F10</kbd>: **Sort A-Z**, **Sort Z-A**, **Hide column**, then **Rename field everywhere…** and **Edit in Types/Team.md**. Right-click a select's value for **Rename option everywhere…**. A rename asks the new name, then shows every note it changes, the type's table among them, in the [refactor preview](search-pages.md#previewing-and-undoing-a-write), as one write.
- **Group by**, in **⋯**, adds each select, person, and relation field. A row with two values is listed under both, and the rows with none come last, *No team*.
- **[Refine](search.md#refine)** offers each select field's options, counted over the rows.
- **⋯** adds **Add team…**, which asks a title and writes the new row's note into the type's `notes:` folder, from a `team.md` in your [templates folder](notes-and-links.md#templates) if there is one, or else with each field's key; and **Open Types/Team.md**.
- The columns, sort, and group are kept for each type in this workspace. **Save search…** puts the table's search on Home, as any search.
- The Notes and Tasks tabs list what the search finds, as on any page: the notes and tasks in the rows' notes, and, for rows of a namespace, everything their tags are on.

## Fields on the Note page

A row's note, on the [note page](notes-and-links.md#reading-a-note-as-a-page), lists its fields under the page's bar, one to a line: the key, muted and in monospace, then its values. A person or a related row is a link by its title, which opens its page.

- **Reverses**, such as a team's `members`, are in italics and say what they come from: *From each person's team*.
- **Empty fields** fold into one line, *1 empty: email*, which opens to list them.
- **The type** is named on the hub line, or, for a row of notes, above the fields; it opens the type's rows.
- **Edit**, shown on the line you point at or tab to, or <kbd>Enter</kbd> on the line, opens a list by kind: the rows the field can name, each with its first relation, filtered as you type; a select's options; a date; a box; or a text field; then **Clear**. A field that holds several adds or removes one choice at a time.
- **Add field…** lists the type's empty fields, then **Other…** for a key of your own.
- Each change writes one key of the front matter and leaves every other line as written. It is offered with **Undo**, and `Deckard: Undo Last Change` takes it back. A value Deckard cannot rewrite safely, such as a `|` block, opens the note at its line instead.

A note with front matter and no type lists its properties in the same place, read-only.

## Fields on a tag's page

A typed tag's page draws its hub note's fields in the hub card, as the Note page does, read-only; **Edit** is on the Note page. A row with no hub note gets a **Fields** card in the hub's place, with what other rows say of it and who is behind them: *owned by: Payments (lead Alex Rivera · on-call Sam Okafor)*. So the page of an area no note describes still says who owns it. **Create hub note** stays under the title.

## Asking Find

In a workspace with types, [Find](search.md#find) reads what you type as a row and a field, in either order, and lists up to three answers first, under **Answer**:

| Typed | Answer | Shown as |
| --- | --- | --- |
| `checkout lead`, `who leads checkout` | Alex Rivera | *@alex-rivera · Person*, by way of *Checkout › owned by Payments › lead* |
| `who is on payments`, `payments members` | Noor Haddad, Theo Park | *Payments › members* |
| `payments channel`, `payments slack` | payments-eng | *Payments › channel* |
| `what does payments own` | Checkout, Card Payments | *Payments › owns* |
| `who owns checkout`, `which team owns checkout` | Payments | *Checkout › owned by* |
| `noor email` | noor@example.com | *Noor Haddad › email* |
| `who reports to alex rivera` | Noor Haddad, Theo Park | *Alex Rivera › reports* |

In a trading desk's notes, `bond trading lead` walks the same way, from the Bond Trading area through Rates, the team that owns it, to its lead.

- **The row** is a run of words that is a row's title, tag, or alias, without case, hyphens, or a trailing *s*: `checkout`, `payments`, `alex rivera`. Failing that, one word of its name will do: the first word of its title or a part of its tag, `noor` or `haddad` for `@noor-haddad`. When that word fits two rows, two Noors, each gets one answer.
- **The field** is the rest, after words such as *who*, *is*, and *the*: a field's name, its reverse's, or a word it is also called. When the row has no such field, Deckard looks through its relations and reverses, up to two away, and takes the nearest.
- **A field that says what its row does**, such as `owns`, asked of a row it names, is read from the other side: Checkout has no `owns`, so `who owns checkout` is the team whose `owns` lists Checkout. A field named for a role, such as `lead`, is not: `checkout lead` is the lead of the team that owns it.
- <kbd>Enter</kbd> opens the answer's page, or, for a value written as text, the page of the row that holds it.
- A typed tag under **Tags** leads with its type and one fact: *Team · lead Alex Rivera · 4 notes · 1 task*.

## In the editor

- **Completions.** In a row's front matter, a new line offers the type's field names. After `lead: `, the rows the field can name, each described by its type and first relation (*Noor Haddad*, *Person · team Payments*), or a select's options, or `true` and `false`; each is written as Deckard writes it. In a type note, the **Kind** column offers the kinds and the type names, and `rows:` the namespaces in use.
- **Marks.** A value that names nothing, a value that does not fit its kind (`date: soon`), a field whose name a search already uses, a field two types define differently, and a relation the two sides disagree on are marked as Information, with `deckard.editor.linkDiagnostics`. Quick fixes offer **Change to @omar (Omar Haddad)** or the closest options, **Create person "Omar H"**, which writes the row's note, and, in a type note, **Allow Area or System** and **Create a System type**.
- **The first line.** The one problems lens counts them, *2 unresolved*, and selecting it shows them. The [hub progress](search-pages.md#hub-notes) lens leads with the row's type and first relation, *Person · Payments | 1/3 done (33%)*, and a row of notes gets that lead alone.
- **Hover.** A typed tag, or a `[[link]]` to a row of notes, names the row, its type, and its first text field, *Noor Haddad `@noor-haddad` · Person · Senior engineer*; then its relations and reverses, how to reach it, how much the notes say of it, *last mentioned today · 2026-10-08*, and **Open @noor-haddad**, **Open Noor Haddad.md**, and **Copy email**. Other tags hover as before.

## Searching by field

The [query language](search.md#query-language) reads a type's fields by name, after its own fields:

| Query | Finds |
| --- | --- |
| `type = team`, `is:team` | the type's rows |
| `lead = @alex-rivera` | rows whose field names Alex |
| `owns = Checkout` | a value read as front matter reads it, by tag, title, or alias |
| `team.lead = @alex-rivera` | a path, through up to two relations |
| `owned-by.lead = @alex-rivera` | a reverse, by its name with hyphens |
| `state = proposed, accepted` | any of the options |
| `headcount > 10`, `date >= 2026-09-01` | numbers and dates, in order |
| `has:on-call`, `no:email` | a field filled, or empty |
| `open-tasks > 0` | a computed field |
| `field.status = active` | a field whose name a search already uses |
| `team = this` | in a [query block](query-blocks.md#query-blocks), the note the block is in |

A search lists the notes and tasks in the rows' notes, and, for rows of a namespace, everything their tags are on; a type's [rows tab](#a-types-rows) lists the rows. A field name no type has is still an error, which names the fields you may have meant. A `type =` that names no type reads as `kind =`, as it did before types.

After `type = team`, the search box offers the type's fields, its reverses, and its computed fields, then its relations' fields, `lead.email`; after a field, its values: rows, options, `true` and `false`, or dates. **Builder** lists them in groups: the type's own under its name, then **Through lead** and the like, then **Built in**.

## In query blocks

`noteColumns=` in a [query block](query-blocks.md#query-blocks) takes a field, a path, a reverse, or a computed field, headed as you write it, read from the row each note is, or else the rows its tags are. `this` is the note the block is in, in the editor, the Markdown preview, the note page, and **Copy as Plain Markdown**. The work sample's Checkout v2 lists its decisions:

````markdown
```deckard view=table noteColumns=date,state,decided-by
type = decision AND project = this
```
````

## For assistants

`deckard_describe_tag` (**Describe a Deckard tag and its fields**) takes a tag, a title, or a few words naming a row and answers in plain text: its type, title, tag, and note, or *No hub note.*; each field and its values; its reverses and what they come from; its open tasks; and its latest entries with their dates. `deckard_query` takes the new fields, and it and `deckard_list_tags` name the workspace's types and their fields. See [AI assistants](ai-assistants.md#ai-assistants).

## Zen

With [Zen](themes-and-zen.md#zen) on, every name, value, count, and date stays drawn: each cell of a rows tab, its tab's count, *Sorted by lead* with its **Sort A-Z**, the Note page's fields and its empty-fields line. Each row's **⋯** and **Create hub note** wait for the pointer or <kbd>Tab</kbd> on their row, and so do the Note page's **Edit** and **Add field…**; a list that is open stays open.

---

← [Writing notes: tags, people, and links](notes-and-links.md) · [All topics](README.md) · [Tasks](tasks.md) →
