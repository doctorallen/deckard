# Writing notes: tags, people, and links

## Markdown format

Deckard recognizes ATX headings, unordered checklist items, `#` tags, `@` people, and `[[Wiki links]]`. Tag matching is case-insensitive.

**Note boundaries.** `deckard.noteBoundaries` sets where one note ends and the next begins:

| Setting | A tagged line is | A search for a tag written in prose returns |
| --- | --- | --- |
| `line` *(default)* | a note of its own | that line |
| `heading` | part of the heading above it | the heading holding the line |
| `marked` | part of the heading above it, unless it carries a `^marker` | the heading, or the marked line itself |

- Under `heading`, a prose tag stays on its line; it is not added to the heading. A tag on a heading is inherited by everything nested under it.
- A tagged line with no heading above it stays a note under every setting.
- Consecutive tagged prose lines are grouped; under `marked`, one marker marks the group.
- A task is its own entry under every setting.
- Changing the setting reindexes the workspace automatically, and writes nothing to your notes.

**Links.** A `[[link]]` names a note by its file name without `.md`, or by any name in its `aliases:` front matter, such as `aliases: [Atlas Program, AP]`. `[[Atlas.md]]` works too, and opens `Atlas`. A name two notes share opens neither. A link in fenced code or inline code, such as `` `[[Atlas]]` ``, is an example: it links nothing. A link to an image or other attachment, such as `![[diagram.png]]`, is not a note, so it is never a missing one.

After `#`, a link can name a heading, as `[[Check-in#Vendor review]]` does, or one line, as `[[Check-in#^lift-slip]]` does. A line is named by the `^marker` at its end ([Obsidian](https://obsidian.md) block-reference style):

```markdown
## Vendor review
The lift survey slipped because the contractor never confirmed. ^lift-slip
- [ ] Chase the contract @dana ^chase
```

- A marker is the last thing on its line, separated from the text. Markers in fenced code are ignored; when a note repeats one, the first wins.
- Typing `[[Check-in#^` completes that note's markers, each shown with its line.
- Following the link opens the note at that line; hovering previews it.
- Deckard reads markers but never writes them.

### Embeds

Write `![[Note]]` on a line of its own and VS Code's Markdown preview draws that note there:

| Written | Draws |
| --- | --- |
| `![[Check-in]]` | the whole note, without its front matter |
| `![[Check-in#Vendor review]]` | that heading, and everything nested under it |
| `![[Check-in#^lift-slip]]` | the one line that marker names, without the marker |
| `![[#Vendor review]]` | a heading of the note the embed is written in |

- An embed names its note as a link does. A name two notes share reads neither; a name no note has says so.
- `![[…]]` inside a sentence stays as typed, and `![[diagram.png]]` and other attachments are left alone.
- Embeds nest up to three deep.
- An embed inside fenced code is left as code.

### Tags and people

By default, use `@` for people and namespaced `#` tags for workspace entities:

```markdown
# Project Atlas #project/atlas
Met with @alex-smith about [[Q3 planning]].

- [ ] Send the proposal by 2026-09-12 #project/atlas
```

- `#project/atlas`, `#topic/leadership`, `#org/acme`, and `#meeting/q3-planning` appear as entity hubs.
- Any other namespaced tag, such as `#management/performance`, creates a namespace and appears as `Management: Performance`.
- Unnamespaced tags such as `#follow-up` work too. All tags appear in the Dashboard's **Tags** catalog.
- A tag's name is letters and digits of any language, `_`, and `-`, so `#café` and `#日本` are tags. A tag starts a word: the `#` in `café#latte` or in a web address such as `https://example.com/#install` is not one.
- `@alex` and `#alex` are different tags.
- Namespace aliases map a custom namespace to any built-in or custom namespace. You can change the people marker; `@name` then becomes a lightweight tag.

Front matter adds entity context to every heading and task in a note:

```yaml
---
project: atlas
people: [alex-smith]
topics:
  - leadership
---
```

`people`/`person` maps to `@person`; `projects`, `topics`, `organizations`, and `meetings` map to their typed `#` tags. These are Cmd/Ctrl-clickable like inline tags.

`Deckard: Move Inline Tags to Front Matter` moves the note's explicit tags into plural front-matter fields, merging existing values and keeping other YAML. Use it only for tags that belong to the whole note.

**Renaming tags.** Run `Deckard: Rename Tag`, right-click a tag on the Dashboard, a search page, or Related Notes and choose **Rename tag**, or hover a tag in the editor and choose **Rename**. It renames the tag everywhere it is written, leaving ordinary words and fenced code alone. Renaming to an existing tag merges the two; see [Merging tags](search-pages.md#merging-tags). Enter a complete tag such as `#management/new-name`, or only a name to keep the marker and namespace. The box previews the result, such as *Merges into #project/atlas (42 entries).*

**Syntax rules:**

- Headings use the ATX form `# Heading` through `###### Heading`. Optional closing hashes are removed from the title.
- Tasks use `-`, `*`, or `+` followed by `[ ]` for open or `[x]`/`[X]` for completed.
- A task inherits tags from its nearest heading and adds tags on its own line.
- Tag names start with a letter or number and can contain letters, numbers, `_`, `-`, and `/` namespace segments.
- A `#` in fenced code, inline code such as `` `#not-a-tag` ``, or links such as `[[#Heading]]` or `[text](#anchor)` is never a tag.
- Numeric-only hash tokens such as `#2026` are not tags. Numeric `@` tags such as `@2026` are.
- **Associated tags:** tags written together on one heading, task, or tagged line are suggested in Related Notes as belonging together, Front-matter and inherited tags never create associations alone.

```markdown
# Launch plan #project/atlas

## Next steps #topic/planning

- [ ] Review the brief #topic/writing
- [x] Send the update @alex-smith
```

## Editor assistance

- **Title bar:** Deckard's button opens **Deckard: Note Actions…**. A daily note also has **‹** and **›** for the previous and next daily notes. Right-click the title bar to hide any of them.
- **Right-click in a note** for a **Deckard** submenu: the task on the line (Toggle Task Done, Edit Task, Break into Steps…, or Add Task), the heading (Rename Heading, Extract Heading), Move to…, and Pin or Unpin.
- **Theme colors:** in any Markdown file, wiki links, an embed's `!`, task dates (`📅 2026-10-02`, `[due:: 2026-10-02]`), repeat rules, priorities, Dataview keys, and a trailing `^block-id` use your theme's colors. To change one, add a rule to `editor.tokenColorCustomizations`, for example `{ "textMateRules": [{ "scope": "constant.numeric.date.deckard", "settings": { "foreground": "#7aa2f7" } }] }`. Scopes end in `.deckard`, such as `constant.numeric.date.due.deckard`, `string.other.repeat.deckard`, and `meta.link.wiki.deckard`.
- **Task metadata** (dates, priority, repeat rule, ids, person) and any `^block-id` are dimmed (`deckard.editor.dimTaskMetadata`). An overdue task shows its due date in the overdue color and **overdue 5 days** at the line's end; one due today says **due today**; one more than 30 days overdue (`deckard.tasks.needsNewDateAfterDays`) says **needs a new date** (`deckard.editor.taskDueHints`). Change the colors in `workbench.colorCustomizations` as `deckard.overdueForeground` and `deckard.taskHintForeground`.
- **Unreadable repeat rules** are marked on open tasks. The lightbulb offers up to three readable rules. `deckard.editor.repeatDiagnostics` turns this off.
- **Word count** is in the status bar: see [Status bar and reminders](tasks.md#status-bar-and-reminders).
- **Tags** are clickable: Cmd/Ctrl-click opens its page, and the hover has **Rename**. Heading tags are always handled; tags on other lines follow `deckard.parseInlineTags`.
- **Tag completion:** typing `#` or `@` offers indexed tags with entry counts, ignoring fenced code except a `deckard` [query block](query-blocks.md#query-blocks).
- **Task metadata completion:** typing `/` after a space in a task offers due dates, priorities, repeat rules, and dependencies. See [Typing metadata](tasks.md#typing-metadata).
- **Link completion:** inside `[[`, notes are offered as [Find](search.md#find) ranks them. After `[[Note#`, that note's headings are offered; `[[#` offers this note's; `[[##words` searches every note's headings. A day in words, such as `[[next fri`, offers that day's note, `[[2026-09-26]]`.
- **Reference counts** sit above a note's lines. The first line shows **Linked from N notes**. Each heading shows **N references** and **N open tasks**, and a tagged heading **N entries share a tag**, which opens [Related Notes](connections.md#related-notes). Other counts list in the references peek. `deckard.editor.referenceCounts` set to `false` hides them.
- **Hovering a `[[Wiki link]]`** previews the note or section and says how many notes link to it.
- **Link problems:** a `[[link]]` to a missing note gets a **Create note** quick fix, and a name several notes share is a warning (`deckard.editor.linkDiagnostics`). The first line shows **N links open no note** and **Create N missing notes**, which creates a note in your notes folder for each unclaimed name; shared names are not created (`deckard.editor.linkProblems`).
- **Task dependencies** for a task using `⛔` or `🆔`: **Waiting on N open tasks** and **Blocks N open tasks**. A `⛔` name no task carries reads **No task has 🆔 name**. `deckard.editor.taskDependencies` turns these off.
- **Daily notes** show **‹ 2026-09-21** and **2026-09-23 ›** on their first line. Today's note also offers **Carry in N unfinished tasks**, which runs **Deckard: Roll Unfinished Tasks Forward**. See [Daily notes](daily-notes.md#daily-notes). `deckard.editor.dailyNoteActions` turns these off.
- **Broken [embeds](#embeds)** say why above their line, such as **Embed: Atlas has no heading "Decision"** or **Embed: Nothing in Atlas is marked ^choice**. `deckard.editor.embedProblems` turns these off.
- **Unlinked mentions:** the first line shows **Mentioned in N notes without a link** when other notes write its title or an alias as plain text. **Link N mentions** turns each into a `[[link]]`, [previewed and undoable](search-pages.md#previewing-and-undoing-a-write). Names under three characters, and names another note also uses, are skipped. A note that cannot be opened is left as it is, and the message says how many there were. `deckard.editor.unlinkedMentions` turns these off.
- **Hub progress:** a [hub note](search-pages.md#hub-notes)'s first line says how far along the tasks of the tag it describes are, such as **Progress: 2 of 6 done · 1 overdue · next due in 3 days**, which opens the tag's page. `deckard.editor.hubProgress` turns this off.
- **Hovering a tag** shows its note and task counts, its [hub note](search-pages.md#hub-notes), its five most recently updated entries, **Open overview**, and **Rename**. `deckard.editor.hoverPreviews` set to `false` turns previews off.

![Reference counts above a note's lines: its backlinks, and each heading's references, open tasks, and the entries that share its tags.](../images/editor-assistance.png)

## Templates

Put Markdown files in a `templates` folder at the workspace root, or the folder `deckard.templatesFolder` names, and run `Deckard: New Note from Template`. Choose a template and a title; Deckard creates the note in your notes folder and opens it. The templates folder is never indexed.

To write into a specific folder, right-click it in the Explorer and choose **Deckard → New Note from Template Here…**. **Deckard: Create Daily Note** and **Deckard: New Note from Template** are also in **File → New File…** and on the Welcome page.

| Placeholder | Becomes |
| --- | --- |
| `{title}` | The title you enter, which is also the file name. |
| `{date}` | Today's date, such as `2026-09-13`. |
| `{time}` | The current time, such as `09:05`. |
| `{ask:Question}` | Your answer when Deckard asks the question. A question used twice is asked once. |

Anything else in braces is left as written.

A template named after a tag namespace, such as `person.md` or `project.md`, starts every new [hub note](search-pages.md#hub-notes) for that namespace. It can use `{tag}`, and Deckard adds `describes:` front matter unless the template has its own.

---

← [Getting started](getting-started.md) · [All topics](README.md) · [Tasks](tasks.md) →
