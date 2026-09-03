# Deckard

Deckard helps you find and act on the Markdown notes in your VS Code workspace. It brings headings, tags, related notes, and checklist tasks into a small set of focused views while keeping your notes readable and portable.

## Requirements

- VS Code 1.134.0 or newer.
- An open folder or workspace containing Markdown notes.

Deckard scans `*.md` files in the configured notes folder for each workspace folder. The default folder is `notes`.

## Install

Download the VSIX attached to a GitHub release and run `Extensions: Install from VSIX...` in VS Code. When installing from a checkout, build the package with `npm run package:vsix`.

## Get started

1. Open a folder or workspace in VS Code.
2. Put your Markdown notes in the `notes` folder, or [choose a different folder](#settings).
3. Open the Command Palette and run `Deckard: Open Dashboard`.
4. Select the Deckard icon in the Activity Bar to open **Related Notes** while editing a Markdown note.

Deckard scans the notes folder automatically and refreshes when notes are added, edited, or deleted.
Run `Deckard: Reindex Workspace` from the Command Palette to trigger a full scan manually.

## Commands

- **Deckard: Open Dashboard** opens workspace totals, tags, and tasks.
- **Deckard: Reindex Workspace** performs a full scan of the configured notes folders.
- **Deckard: Create Daily Note** creates or opens today's note.
- **Deckard: Extract Tagged Heading** moves a tagged heading section into a newly named note.
- **Deckard: Show Tag Overview** opens a tag overview, or shows a tag picker when no tag is supplied.

## Markdown format

Deckard recognizes ATX headings, unordered checklist items, and tags written in Markdown text. Tags can use either `#` or `@`, and tag matching is case-insensitive. A tagged non-heading, non-task line is indexed as its own entry when `deckard.parseInlineTags` is enabled.

- Headings use the ATX form `# Heading` through `###### Heading`. Optional closing hashes are removed from the heading title.
- Tasks use `-`, `*`, or `+` followed by `[ ]` for open items or `[x]`/`[X]` for completed items.
- A task inherits tags from its nearest heading and combines them with tags written on the task line.
- Tag names start with a letter or number and can contain letters, numbers, `_`, and `-`.
- Fenced code blocks using backticks or tildes are ignored by indexing, decorations, and completion.
- Numeric-only hash tokens such as `#2026` are ignored as tags so that ordinary Markdown headings and dates do not become tags. Numeric `@` tags such as `@2026` remain valid.

For example:

```markdown
# Launch plan #project

## Next steps @today

- [ ] Review the brief #writing
- [x] Send the update @team
```

Use `- [ ]`, `* [ ]`, or `+ [ ]` for an open task. Use `- [x]` for a completed task. A task inherits tags from its heading and can also have its own tags.

## Editor assistance

- Tags in Markdown editors receive clickable decorations. Selecting a tag opens its tag overview. Heading tags are always handled; tags on other lines follow `deckard.parseInlineTags`.
- Typing `#` or `@` offers matching tags already in the index, with each tag's current entry count. Partial tag tokens are replaced correctly, fenced code is ignored, and numeric-only hash tags are excluded from `#` completion.

## Dashboard

Run `Deckard: Open Dashboard` to see total sections, total tasks, active tasks, tags, and tasks in one place.

- **Tags** groups your tags into Favorites and All tags. Sort them alphabetically, by entry count, by most accessed, or by custom rank. Favorites remain first.
- **Tasks** lets you switch between all, active, and completed tasks, and sort by rank, creation time, or update time. Rank is the default. Date sorting uses the source file's filesystem timestamps.
- **Task tags** lets you select one or more tags. A task appears when it matches any selected tag.
- Select a tag to open its [tag overview](#tag-overviews).
- Select a task to jump to its exact source line.
- Use a task checkbox to update the checklist marker in the original note.
- When tags use custom rank or tasks use Rank, drag rows or right-click a row to move it to the top or bottom. Date-sorted tasks cannot be dragged. Display order changes do not reorder text in your Markdown files.

## Related Notes

The **Related Notes** view appears in the Explorer under the Deckard Activity Bar container. With a Markdown note open, it shows other notes that share its tags.

Select a related note to open the matching line. Select a tag to open that tag's overview. The view also includes shortcuts to the Dashboard and Daily Note commands, and it updates as you edit the active note.

## Tag overviews

Open a tag overview by selecting a tag in the editor, Dashboard, Related Notes, or by running `Deckard: Show Tag Overview` from the Command Palette.

Each overview collects the matching sections from your notes. You can:

- sort entries alphabetically, by creation date, by update date, or by most accessed;
- switch between the original Markdown source and a rendered view; and
- select a section to jump to its heading in the source note.

Opening a tag overview records tag access. Opening a section records section access, which powers the access sort. Tag links inside an overview open the next overview without leaving the workflow.

## Extracting headings

Run `Deckard: Extract Tagged Heading` with the cursor inside a tagged heading section. Deckard moves the complete section, including nested headings and the original heading tags, into a new Markdown note in the configured notes folder. The extracted heading and its content are removed from the source note. If the cursor is not inside a tagged section, Deckard offers a picker of tagged headings from the workspace.

The note name is used as a single Markdown filename. Existing notes are never overwritten; choose a different name when a conflict is reported.

## Daily notes

Run `Deckard: Create Daily Note` from the Command Palette, or use the shortcut in Related Notes. Deckard creates a note named with the local date, such as `2026-08-30.md`, in your configured notes folder and opens it. If today's note already exists, Deckard opens it without replacing its contents.

## Settings

Open **Settings** and search for `Deckard`, or add these options to your workspace settings:

```json
{
	"deckard.notesFolder": "notes",
	"deckard.dailyNoteTemplate": "# {date}\n\n",
	"deckard.parseInlineTags": true
}
```

- `deckard.notesFolder` is the workspace-relative folder Deckard scans. It defaults to `notes`.
- `deckard.dailyNoteTemplate` is used when a new daily note is created. `{date}` becomes the local date in `YYYY-MM-DD` format.
- `deckard.parseInlineTags` indexes tags on non-heading, non-task Markdown lines as standalone entries and decorates them in the editor. It defaults to `true`. Heading tags and task-line tags remain available when it is `false`.

## Source safety and persistence

Markdown files remain the source of truth. Deckard changes note content only when you use a task checkbox to update its checklist marker or explicitly extract a tagged heading into a new note. Before applying a task edit, Deckard compares the complete source line and checkbox value with the indexed version. Before an extraction, Deckard verifies the source section is unchanged, then removes it only after the new note is created.

Favorites, sorting choices, custom display order, access counts, and source/rendered view preference are stored separately in VS Code and do not add metadata to your notes.

## Limitations and troubleshooting

- **The Dashboard is empty:** make sure a workspace is open, the configured notes folder exists, and its files use the Markdown patterns shown above.
- **Related Notes shows no results:** open a Markdown note containing a tag, then check that another note uses the same tag. Unsaved changes in the active editor are included.
- **A task or section is missing:** confirm the task is an unordered checklist item, the heading is an ATX heading such as `## Heading`, and `deckard.parseInlineTags` is enabled for tagged non-heading lines.
- **Content in a code block appears ignored:** this is intentional. Fenced code is excluded from indexing, tag links, and completion.
- **A numeric hash is missing:** numeric-only `#` tokens are intentionally not tags. Use an `@` marker or include a non-numeric character.
- **Date sorting looks unexpected:** task and section dates come from source file creation and modification timestamps, not dates written in note content.

Deckard does not support ordered-list tasks or arbitrary checklist syntaxes, and it only scans Markdown files inside the configured notes folders.

## Development

```sh
npm ci
npm run compile
npm test
npm run package:vsix
```
