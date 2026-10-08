# Settings

Open **Settings** and search for `Deckard`. Deckard's settings start with **Start here**, the four most set first: `deckard.notesFolder`, `deckard.theme`, `deckard.me`, and `deckard.periodicNotes.folder`. **General**, **Tags and People**, **Editor**, **Tasks**, and **AI Assistants** follow.

Or add these options to your workspace settings:

```json
{
	"deckard.theme": "corpo",
	"deckard.dashboard.openOnStartup": false,
	"deckard.notesFolder": "notes",
	"deckard.exclude": {
		"**/archive": true
	},
	"deckard.periodicNote.review": true,
	"deckard.dailyNote.rollover": "off",
	"deckard.templatesFolder": "templates",
	"deckard.noteBoundaries": "line",
	"deckard.tasks.viewQuery": "",
	"deckard.tasks.metadataFormat": "emoji",
	"deckard.tasks.suggestSteps": true,
	"deckard.me": "",
	"deckard.taskReminderTime": "",
	"deckard.editor.preset": "full",
	"deckard.links.style": "wiki",
	"deckard.openNotesIn": "editor",
	"deckard.assistantTools": true,
	"deckard.mcpServer.enabled": false,
	"deckard.mcpServer.port": 39217,
	"deckard.highlightNoteSections": true,
	"deckard.entityNamespaceAliases": {
		"org": "organization"
	}
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `deckard.notesFolder` | Empty | Optional workspace-relative folder Deckard scans. An empty value indexes all workspace Markdown files. In a multi-root workspace, each folder can set its own. |
| `deckard.exclude` | `{}` | Glob patterns, relative to the workspace folder and written like `files.exclude`, that Deckard leaves out of its index, such as `{ "**/archive": true, "drafts/*.md": true }`. Deckard also leaves out what `files.exclude` and `search.exclude` hide; set an inherited pattern to `false` to index it. In the Explorer, a folder's **Deckard → Exclude from Deckard** adds it, and **Include in Deckard** removes it from whichever settings set it, or sets it to `false` there when less specific settings set it too. To keep an archive searchable, park it instead. |
| `deckard.parked.folders` | `{}` | Glob patterns of folders and notes to park, written like `deckard.exclude`. A parked note stays searchable with `is:parked` but is left out of to-do lists. `deckard.exclude` wins. |
| `deckard.parked.tags` | `["parked"]` | Tags that park a note (in front matter), a heading and everything under it, or a task. Sub-tags park too, so `project/old` parks `#project/old/phase-1`. |
| `deckard.theme` | `corpo` | The style for Deckard's pages: `corpo`, which follows your VS Code theme, or `replicant`, `oblivion`, `lcars`, `synthwave`, `tomcat`, `fellowship`, and `cooper`. |
| `deckard.display.zen` | `false` | Quiets every Deckard page: each theme's decoration and the lines that teach go, spacing is tighter, cards are flat, and tags are text. Every button, count, and date stays. The **Zen** checkbox in a page's **⋯** and `Deckard: Toggle Zen` set it. Yours alone, the same in every workspace. See [Zen](themes-and-zen.md#zen). |
| `deckard.display.cardDetails` | file and line | Which details an entry shows on the one line it keeps for them under its dates, shown while the pointer is on it or it has focus: `fileAndLine` (where it is written, and the headings above it), then its `created` and `updated` dates, such as *atlas / line 4 · Created 2026-09-12*, on search cards, task rows, board cards, Home's note rows, and Related Notes. Tick them in Settings; untick all three to draw none and keep no line, which a screen reader still reads. A task's created date is its own `➕` date when it has one, else its note's; its updated date is its note's. |
| `deckard.display.dateFormat` | `YYYY-MM-DD` | How Deckard writes a date for you to read, on pages, in views, in messages, and in the task editor, in the tokens Obsidian's daily notes use: `DD/MM/YYYY`, `D MMM YYYY`, `ddd, MMM D, YYYY`, or `L` and `LL`, your display language's own. Text in `[brackets]` is written as it is. Dates written into notes, file names, and searches stay `YYYY-MM-DD`. Empty, or a format with no date in it, reads as the default. `Deckard: Choose Date Format…` shows each with today's date. See [Dates](themes-and-zen.md#dates). |
| `deckard.display.shortDateFormat` | `ddd, MMM D` | How a day of this year is written where there is little room: the Tasks view's day headings, Today's note in Context and Go to…, the calendar's day title, search completions, and Linked from. A day in another year is written in `deckard.display.dateFormat`. |
| `deckard.dashboard.openOnStartup` | `false` | Opens Home when VS Code starts in a workspace where Deckard has indexed notes. |
| `deckard.periodicNotes.folder` | `""` | The folder inside the notes folder that new daily, weekly, and monthly notes go in, such as `journal/{yyyy}` (`{mm}` is the month). Notes already elsewhere are still found. |
| `deckard.calendar.weekStart` | `sunday` | The day a week starts on: `sunday`, `monday`, or `locale` (VS Code's display language). It sets the Calendar, weekly notes and reviews, `this-week`, `last-week`, and `next-week`, and typed dates such as *next week*. |
| `deckard.calendar.exportFile` | `""` | A calendar file (`.ics`) Deckard keeps up to date with your dated tasks, for a calendar app to subscribe to. A relative path is in the first workspace folder. See [Tasks in your calendar app](daily-notes.md#tasks-in-your-calendar-app). |
| `deckard.calendar.exportQuery` | `is:open` | The search whose dated tasks the calendar file holds. |
| `deckard.periodicNote.reviewSections` | `[]` | Sections of your own at the end of a review, each `{ "title": …, "query": … }`. See [Writing a review](daily-notes.md#writing-a-review). |
| `deckard.periodicNote.review` | `true` | Writes a review into a newly created weekly or monthly note. See [Writing a review](daily-notes.md#writing-a-review). |
| `deckard.dailyNote.rollover` | `off` | What a new daily note does with the last one's unfinished tasks: `off`, `move`, or `migrate` (`copy` is its older name). See [Carrying unfinished tasks forward](daily-notes.md#carrying-unfinished-tasks-forward). |
| `deckard.templatesFolder` | `templates` | The folder of [note templates](notes-and-links.md#templates), relative to the workspace folder. Not indexed. `Daily.md`, `Weekly.md`, and `Monthly.md` here are what new [periodic notes](daily-notes.md#templates) start from. Empty turns templates off. |
| `deckard.noteBoundaries` | `line` | Where one note ends and the next begins; see [Markdown format](notes-and-links.md#markdown-format). `line`, `heading`, or `marked`. |
| `deckard.tasks.viewQuery` | Empty | A [query](search.md#query-language) limiting the open tasks in the Tasks view, Home's agenda, and the status bar, such as `is:mine`. Empty means every open task. It was `deckard.agenda.query`; a search you set there is carried over once. |
| `deckard.tasks.metadataFormat` | `emoji` | The Tasks format Deckard writes for a task with no metadata yet: `emoji` (📅 2026-09-20) or `dataview` ([due:: 2026-09-20]). Existing tasks keep theirs; Deckard reads both. |
| `deckard.board.limits` | `{}` | Work-in-progress limits for board columns, by status, its name with a hyphen for a space, such as `{ "in-progress": 3 }`, or by column id, such as `{ "priority:high": 5 }`. An over-limit column says so. |
| `deckard.tasks.statuses` | Todo, In progress, Done, Cancelled, Waiting, Someday, Blocked | What each checkbox character means: `[/]` in progress, `[w]` waiting, `[s]` someday, `[=]` blocked, `[-]` cancelled. Each status has its character, a name, and a type (to do, in progress, on hold, done, cancelled, or not a task). A task's status is its character alone. A character no status names is a task to do, called Unknown. |
| `deckard.tasks.checkboxClick` | `done` | What a click on a task's box does: `done` marks it done whatever its status, and unchecking reopens it as `[ ]`; `workflow` moves it to its status's next status, as Obsidian Tasks does. |
| `deckard.tasks.suggestSteps` | `true` | Offers **Suggest steps** in Break into Steps… when a VS Code language model, such as GitHub Copilot, is installed. Only the task's words are sent, and only when you choose it. See [Suggest steps](ai-assistants.md#suggest-steps). |
| `deckard.me` | Empty | Who you are in your notes, such as `@ren-kade`, so `is:mine` finds the tasks that name you. See [Who a task is for](tasks.md#who-a-task-is-for). |
| `deckard.tasks.needsNewDateAfterDays` | `30` | How many days past its due date an open task stays in Overdue. After that it moves to **Needs a new date** and leaves the status bar's count. `0` keeps every overdue task in Overdue. |
| `deckard.taskReminderTime` | Empty | A time of day, such as `09:00`, from which Deckard says how many tasks are due, once a day. Empty means no reminder. |
| `deckard.editor.preset` | `full` | What Deckard draws in the editor, as one choice: `full`, everything; `tasks`, task hints and problem reports without link counts, mention lenses, or breadcrumbs; `writing`, the / menu, hover previews, faint task details, and reports of broken links, embeds, and repeat rules; `off`, nothing: no lenses, decorations, previews, / menu, or problem reports. Each `deckard.editor.*` switch below follows it while unset; one you set yourself overrides it. `Deckard: Choose Editor Preset…` sets it. |
| `deckard.editor.referenceCounts` | Unset | Shows backlink, heading-reference, and open-task counts above a note's lines. Unset, it follows the preset: on in Full, off in Tasks, Writing, and Off. |
| `deckard.editor.hoverPreviews` | Unset | Previews a `[[Wiki link]]`'s target and summarizes a tag's entries on hover. Unset, it follows the preset: on in Full, Tasks, and Writing, off in Off. |
| `deckard.editor.linkDiagnostics` | Unset | Marks a `[[Wiki link]]` that opens no note and offers to create a missing one. Unset, it follows the preset: on in Full, Tasks, and Writing, off in Off. |
| `deckard.editor.taskDependencies` | Unset | Shows, above a task with `⛔` or `🆔`, the open tasks it waits on and holds up. See [Editor assistance](notes-and-links.md#editor-assistance). Unset, it follows the preset: on in Full and Tasks, off in Writing and Off. |
| `deckard.editor.dailyNoteActions` | Unset | Shows neighboring daily notes above a daily note, and on today's, unfinished tasks to carry in. Unset, it follows the preset: on in Full and Tasks, off in Writing and Off. |
| `deckard.editor.linkProblems` | Unset | Counts a note's `[[Wiki links]]` that open no note in the problems lens on its first line, which creates the missing notes. Unset, it follows the preset: on in Full, Tasks, and Writing, off in Off. |
| `deckard.editor.embedProblems` | Unset | Says above a broken `![[embed]]` which heading or `^marker` it is missing. Unset, it follows the preset: on in Full, Tasks, and Writing, off in Off. |
| `deckard.editor.unlinkedMentions` | Unset | Counts, in the problems lens on a note's first line, mentions of it in other notes without a link, which it links. Unset, it follows the preset: on in Full, off in Tasks, Writing, and Off. |
| `deckard.links.style` | `wiki` | How a link made from a mention is written: `[[Atlas]]`, or `markdown` for `[Atlas](projects/Atlas.md)`, which GitHub and MkDocs render. Both kinds are read either way. |
| `deckard.editor.hubProgress` | Unset | Says, on a hub note's first line, how far along the tasks of the tag it describes are. Unset, it follows the preset: on in Full and Tasks, off in Writing and Off. |
| `deckard.openNotesIn` | `editor` | Where a note or task opens from Deckard: `editor`, at its line, or `page`, on the [note page](notes-and-links.md#reading-a-note-as-a-page). Shift-click, or Shift+Enter, opens it the other way. |
| `deckard.editor.stepProgress` | Unset | Shows, above a task with steps, a bar of how many are done and the next one. Unset, it follows the preset: on in Full and Tasks, off in Writing and Off. |
| `deckard.editor.breadcrumbs` | Unset | Shows, on a note's first line, where it sits under its [hub notes](search-pages.md#the-hubs-view). Unset, it follows the preset: on in Full, off in Tasks, Writing, and Off. |
| `deckard.editor.slashMenu` | Unset | Offers, after a `/` alone at the start of a line, blocks and templates to write there. Unset, it follows the preset: on in Full, Tasks, and Writing, off in Off. |
| `deckard.editor.dimTaskMetadata` | Unset | Draws a task's dates, priority, repeat rule, ids, and person, and a line's `^block-id`, fainter than its words. An overdue date takes the `deckard.overdueForeground` color instead. Unset, it follows the preset: on in Full, Tasks, and Writing, off in Off. |
| `deckard.editor.taskDueHints` | Unset | Says after an open task's line when it is **overdue 5 days**, **due today**, or **needs a new date**. Unset, it follows the preset: on in Full and Tasks, off in Writing and Off. |
| `deckard.editor.repeatDiagnostics` | Unset | Marks an unreadable 🔁 repeat rule on an open task, with quick fixes. Unset, it follows the preset: on in Full, Tasks, and Writing, off in Off. |
| `deckard.assistantTools` | `true` | Lets AI assistants in VS Code, such as Copilot in agent mode, search notes and tasks, list tags, add a task to a note, and change an existing task, after you allow the first call each session. Nothing is written until you approve the line in the refactor preview. See [AI assistants](ai-assistants.md#ai-assistants). |
| `deckard.mcpServer.enabled` | `false` | Runs an MCP server on 127.0.0.1 with the same tools, writes included, for clients that carry its token. Nothing is written until you approve the line in the refactor preview. See [Claude Code and other MCP clients](ai-assistants.md#claude-code-and-other-mcp-clients). |
| `deckard.mcpServer.port` | `39217` | The port the MCP server listens on, on 127.0.0.1. |
| `deckard.highlightNoteSections` | `true` | Highlights the tagged section or task the cursor is in. Colors: `deckard.sectionHighlightBackground` and `deckard.sectionHighlightBorder` in `workbench.colorCustomizations`. |
| `deckard.entityNamespaceAliases` | `{ "org": "organization" }` | Maps one `#namespace` to another. For example, `{ "proj": "project", "leadership": "management" }` treats `#proj/atlas` as a project and collapses `#leadership/performance` into `#management/performance`. |

---

← [Commands](commands.md) · [All topics](README.md) · [Privacy, source safety, and troubleshooting](privacy-and-troubleshooting.md) →
