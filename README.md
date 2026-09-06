<p align="center">
	<img src="resources/lockup.png" alt="Deckard" width="50%">
</p>

# Deckard

Deckard is a local-first second brain for Markdown notes in your VS Code workspace. It connects people, projects, topics, organizations, meetings, links, and checklist tasks while keeping your notes readable and portable.

## Requirements

- VS Code 1.134.0 or newer.
- An open folder or workspace containing Markdown notes.

Deckard scans every `*.md` file in each workspace folder by default. Set a notes folder only when you want to restrict the index.

## Install

Download the VSIX attached to a GitHub release and run `Extensions: Install from VSIX...` in VS Code.

## Screenshots

| Dashboard | Related Notes |
|---|---|
| <img src="docs/images/dashboard.png" alt="Deckard Dashboard showing workspace totals, tags, favorites, and active tasks." width="460"> | <img src="docs/images/related-notes.png" alt="Deckard Related Notes sidebar showing ranked note entries and matching tags." width="460"> |
| **Tag Overview** | **Help** |
| <img src="docs/images/tag-overview.png" alt="Deckard Tag Overview showing matching notes, active tasks, and display controls." width="460"> | <img src="docs/images/help.png" alt="Deckard Help webview with quick-start instructions and feature navigation." width="460"> |

## Themes

Set `deckard.theme` to choose the visual style used by Deckard webviews. The default is `replicant`.

| Replicant | Oblivion | LCARS | Tomcat | Fellowship |
|---|---|---|---|---|
| <img src="docs/images/dashboard-replicant.png" alt="Replicant theme Dashboard." width="220"> | <img src="docs/images/dashboard-oblivion.png" alt="Oblivion theme Dashboard." width="220"> | <img src="docs/images/dashboard-lcars.png" alt="LCARS theme Dashboard." width="220"> | <img src="docs/images/dashboard-tomcat.png" alt="Tomcat theme Dashboard." width="220"> | <img src="docs/images/dashboard-fellowship.png" alt="Fellowship theme Dashboard." width="220">|

## Get started

1. Open a folder or workspace in VS Code.
2. Open any Markdown note in the workspace, or [restrict indexing to a folder](#settings).
3. Open the Command Palette and run `Deckard: Open Dashboard`.
4. Select the Deckard icon in the Activity Bar to open **Related Notes** while editing a Markdown note.

Deckard scans the workspace Markdown scope automatically and refreshes when saved notes are added, edited, or deleted.
Run `Deckard: Reindex Workspace` from the Command Palette to trigger a full scan manually.

## Commands

| Command | Description |
| --- | --- |
| **Deckard: Open Dashboard** | Opens workspace totals, tags, and tasks. |
| **Deckard: Show Stats** | Opens index totals and local view-count statistics. |
| **Deckard: Open Help** | Opens the quick-start and advanced feature guide. |
| **Deckard: Reindex Workspace** | Performs a full scan of the workspace Markdown scope. |
| **Deckard: Create Daily Note** | Creates or opens today's note. |
| **Deckard: Extract Tagged Heading** | Moves a tagged heading section into a newly named note. |
| **Deckard: Show Tag Overview** | Opens a tag overview, or shows a tag picker when no tag is supplied. |
| **Deckard: Search Workspace Knowledge** | Searches saved notes, entities, and tasks from the Command Palette. |
| **Deckard: Link Current Heading to Entity** | Adds a user-approved canonical person, project, topic, organization, or meeting tag to the current heading. |
| **Deckard: Move Inline Tags to Front Matter** | Moves explicit tags from the active note into merged note-level front matter. |

## Markdown format

Deckard recognizes ATX headings, unordered checklist items, `#` tags, `@` people, and `[[Wiki links]]`. Tag matching is case-insensitive. A tagged non-heading, non-task line is indexed as its own entry when `deckard.parseInlineTags` is enabled.

By default, use `@` for people and namespaced `#` tags for canonical workspace entities:

```markdown
# Project Atlas #project/atlas
Met with @alex-smith about [[Q3 planning]].

- [ ] Send the proposal by 2026-09-12 #project/atlas
```

`#project/atlas`, `#topic/leadership`, `#org/acme`, and `#meeting/q3-planning` appear as entity hubs. Simple `#follow-up` tags remain supported. Deckard distinguishes `@alex` from `#alex`. You can configure namespace aliases and move the people marker; when the people marker is changed from `@`, `@name` becomes a lightweight tag.

Frontmatter can add portable entity context to every heading and task in a note:

```yaml
---
project: atlas
people: [alex-smith]
topics:
  - leadership
---
```

Supported front-matter values are highlighted in the editor and Cmd/Ctrl-clickable just like inline tags: `people`/`person` maps to `@person`, while `projects`, `topics`, `organizations`, and `meetings` map to their typed `#` tags.

Run `Deckard: Move Inline Tags to Front Matter` to collect explicit tags from the current note into plural front-matter fields. Existing values are merged, unrelated YAML fields are preserved, and source tag tokens are removed. Because the resulting metadata applies to the entire note, use the command only for context that belongs to every heading and task in that note.

- Headings use the ATX form `# Heading` through `###### Heading`. Optional closing hashes are removed from the heading title.
- Tasks use `-`, `*`, or `+` followed by `[ ]` for open items or `[x]`/`[X]` for completed items.
- A task inherits tags from its nearest heading and combines them with tags written on the task line.
- Tag names start with a letter or number and can contain letters, numbers, `_`, `-`, and `/` namespace segments.
- Fenced code blocks using backticks or tildes are ignored by indexing, decorations, and completion.
- Numeric-only hash tokens such as `#2026` are ignored as tags so that ordinary Markdown headings and dates do not become tags. Numeric `@` tags such as `@2026` remain valid.

For example:

```markdown
# Launch plan #project/atlas

## Next steps #topic/planning

- [ ] Review the brief #topic/writing
- [x] Send the update @alex-smith
```

Use `- [ ]`, `* [ ]`, or `+ [ ]` for an open task. Use `- [x]` for a completed task. A task inherits tags from its heading and can also have its own tags.

## Editor assistance

- Tags in Markdown editors receive clickable decorations. Selecting a tag opens its tag overview. Heading tags are always handled; tags on other lines follow `deckard.parseInlineTags`.
- Typing `#` or `@` offers matching tags already in the index, with each tag's current entry count. `#atl` can complete to `#project/atlas`; `@al` can complete to `@alex-smith`. Partial tag tokens are replaced correctly, fenced code is ignored, and numeric-only hash tags are excluded from `#` completion.

## Dashboard

Run `Deckard: Open Dashboard` to see total sections, total tasks, active tasks, canonical tags, and tasks in one place.

- **Tags** lists people, projects, topics, organizations, and meetings as canonical tags. Filter by type, favorite important tags, then sort alphabetically, by entry count, by most accessed, or by custom rank. In Rank mode, drag a tag or use its context menu to move it to the top or bottom.
- **Tasks** lets you switch between all, active, and completed tasks, and sort by rank, creation time, or update time. Rank is the default. Date sorting uses the source file's filesystem timestamps.
- **Task tags** lets you select one or more tags. A task appears when it matches any selected tag.
- Select a tag to open its [tag overview](#tag-overviews).
- Select a task to jump to its exact source line.
- Use a task checkbox to update the checklist marker in the original note.
- When tags use custom rank or tasks use Rank, drag rows or right-click a row to move it to the top or bottom. Date-sorted tasks cannot be dragged. Display order changes do not reorder text in your Markdown files.

## Stats

Run `Deckard: Show Stats` to see the current Markdown file, note entry, task, tag, canonical tag, and Wiki-link totals from the index. It also shows the most-viewed tags, canonical tags, and note entries from Deckard's local access counters. These counters are collected when you open a tag overview or select a note entry in an overview, and are stored only in VS Code preferences.

## Related Notes

The **Related Notes** view appears in the Explorer under the Deckard Activity Bar container. With a saved Markdown note open, it ranks related entries by shared tags/entities, Wiki links, and significant shared keywords.

Related entries are ranked by shared tags/entities, Wiki links, and significant shared keywords. Use the Related Notes sort control to order results by **Most tags**, **Newest**, **Oldest**, or **Most accessed**. Newest and Oldest use the source note's modification time, while Most accessed uses Deckard's local entry-view counts. Select a related note to open the matching line, or select a tag/entity to open its overview. Selecting the Deckard Activity Bar icon opens Related Notes; it also opens the Dashboard only when no Markdown editor is active. The view also includes shortcuts to the Dashboard and Daily Note commands, and it updates after saved changes.

Select the question-mark button in the Related Notes toolbar to open the Help page. It includes a quick start, advanced configuration guidance, and in-page navigation by feature category.

## Tag overviews

Open an entity or tag overview by selecting it in the editor, Dashboard, Related Notes, or by running `Deckard: Show Tag Overview` from the Command Palette.

Each overview collects the matching sections from your notes. You can:

- sort entries alphabetically, by creation date, by update date, or by most accessed;
- switch between the original Markdown source and a rendered view; and
- choose **Tabs** to switch between Notes and Tasks, or **Side by side** to show Notes at 60% width and Tasks at 40%; and
- filter overview tasks with the grouped **All**, **Active**, and **Completed** controls (which default to **Active**), then use a checkbox to safely update the original Markdown task; and
- select a section to jump to its heading in the source note.

Opening a tag overview records tag access. Opening a section records section access, which powers the access sort. Tag links inside an overview open the next overview without leaving the workflow.

## Extracting headings

Run `Deckard: Extract Tagged Heading` with the cursor inside a tagged heading section. Deckard moves the complete section, including nested headings and the original heading tags, into a new Markdown note in the configured notes folder or workspace root. The extracted heading and its content are removed from the source note. If the cursor is not inside a tagged section, Deckard offers a picker of tagged headings from the workspace.

The note name is used as a single Markdown filename. Existing notes are never overwritten; choose a different name when a conflict is reported.

## Daily notes

Run `Deckard: Create Daily Note` from the Command Palette, or use the shortcut in Related Notes. Deckard creates a note named with the local date, such as `2026-08-30.md`, in your configured notes folder or workspace root and opens it. If today's note already exists, Deckard opens it without replacing its contents.

## Settings

Open **Settings** and search for `Deckard`, or add these options to your workspace settings:

```json
{
	"deckard.theme": "replicant",
	"deckard.notesFolder": "notes",
	"deckard.dailyNoteTemplate": "# {date}\n\n",
	"deckard.parseInlineTags": true,
	"deckard.enableTagAutocomplete": true,
	"deckard.enableKeywordLinks": true,
	"deckard.entityNamespaceAliases": {
		"org": "organization"
	},
	"deckard.personMarker": "@"
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `deckard.notesFolder` | Empty | Optional workspace-relative folder Deckard scans. An empty value indexes all workspace Markdown files. |
| `deckard.theme` | `replicant` | Selects the Replicant, Oblivion, or LCARS visual style for Deckard webviews. |
| `deckard.dailyNoteTemplate` | `# {date}\n\n` | Used when a new daily note is created. `{date}` becomes the local date in `YYYY-MM-DD` format. |
| `deckard.parseInlineTags` | `true` | Indexes tags on non-heading, non-task Markdown lines as standalone entries and decorates them in the editor. Heading and task-line tags remain available when `false`. |
| `deckard.enableTagAutocomplete` | `true` | Shows indexed tag and people suggestions after a marker. Disable it without changing tag indexing, highlighting, or navigation. |
| `deckard.enableKeywordLinks` | `true` | Includes significant shared keywords when Related Notes finds matches. Disable it to show shared tags and intentional Wiki links only. |
| `deckard.entityNamespaceAliases` | `{ "org": "organization" }` | Maps custom `#namespace` aliases to canonical entity types. For example, `{ "proj": "project", "client": "organization" }` treats `#proj/atlas` and `#client/acme` as canonical project and organization tags. |
| `deckard.personMarker` | `@` | Selects the single punctuation character that identifies people. Set it to `~` to use `~mara-vale` for people and reserve `@inbox` for a lightweight tag. |

## Source safety and persistence

Markdown files remain the source of truth. Deckard changes note content only when you use a task checkbox, explicitly extract a tagged heading, or approve an entity tag from `Deckard: Link Current Heading to Entity`. Before applying a task edit, Deckard compares the complete source line and checkbox value with the indexed version. Before an extraction, Deckard verifies the source section is unchanged, then removes it only after the new note is created.

Deckard stores a workspace-scoped SQLite full-text cache locally for fast saved-note search. It does not send note content to an AI model or external service. Favorites, sorting choices, custom display order, access counts, and source/rendered view preference are stored separately in VS Code and do not add metadata to your notes.

## Limitations and troubleshooting

- **The Dashboard is empty:** make sure a workspace is open, its Markdown files are within the configured scope, and they use the Markdown patterns shown above.
- **Related Notes shows no results:** open a saved Markdown note containing a tag, then check that another saved note uses the same tag.
- **A task or section is missing:** confirm the task is an unordered checklist item, the heading is an ATX heading such as `## Heading`, and `deckard.parseInlineTags` is enabled for tagged non-heading lines.
- **Content in a code block appears ignored:** this is intentional. Fenced code is excluded from indexing, tag links, and completion.
- **A numeric hash is missing:** numeric-only `#` tokens are intentionally not tags. Use an `@` marker or include a non-numeric character.
- **Date sorting looks unexpected:** task and section dates come from source file creation and modification timestamps, not dates written in note content.

Deckard does not support ordered-list tasks or arbitrary checklist syntaxes, and it scans only Markdown files within the configured workspace scope.
