# Settings

Open **Settings** and search for `Deckard`, or add these options to your workspace settings:

```json
{
	"deckard.theme": "corpo",
	"deckard.showWhatsNew": true,
	"deckard.dashboard.openOnStartup": false,
	"deckard.tagOverview.hubNoteExpanded": true,
	"deckard.tagOverview.includeHubLinks": true,
	"deckard.notesFolder": "notes",
	"deckard.exclude": {
		"**/archive": true
	},
	"deckard.dailyNoteTemplate": "# {date}\n\n",
	"deckard.weeklyNoteTemplate": "# {week}\n\n",
	"deckard.monthlyNoteTemplate": "# {month}\n\n",
	"deckard.periodicNote.review": true,
	"deckard.dailyNote.rollover": "off",
	"deckard.dailyNote.rolloverDays": 7,
	"deckard.templatesFolder": "templates",
	"deckard.noteBoundaries": "line",
	"deckard.outline.showTags": true,
	"deckard.outline.followCursor": true,
	"deckard.outline.inheritedTags": false,
	"deckard.outline.showCounts": true,
	"deckard.agenda.groupBy": "due",
	"deckard.agenda.groupNamespace": "project",
	"deckard.agenda.upcomingDays": 7,
	"deckard.agenda.query": "",
	"deckard.tasks.addDoneDate": true,
	"deckard.tasks.metadataFormat": "emoji",
	"deckard.tasks.assigneeFromPersonTag": false,
	"deckard.tasks.metadataSuggestions": true,
	"deckard.tasks.suggestSteps": true,
	"deckard.me": "",
	"deckard.statusBar": true,
	"deckard.taskReminderTime": "",
	"deckard.board.statusNamespace": "status",
	"deckard.board.statuses": ["todo", "doing", "waiting"],
	"deckard.editor.referenceCounts": true,
	"deckard.editor.hoverPreviews": true,
	"deckard.editor.linkDiagnostics": true,
	"deckard.editor.taskDependencies": true,
	"deckard.editor.dailyNoteActions": true,
	"deckard.editor.linkProblems": true,
	"deckard.editor.embedProblems": true,
	"deckard.editor.unlinkedMentions": true,
	"deckard.editor.dimTaskMetadata": true,
	"deckard.editor.taskDueHints": true,
	"deckard.editor.repeatDiagnostics": true,
	"deckard.updateLinksOnRename": true,
	"deckard.previewWorkspaceWrites": "severalNotes",
	"deckard.assistantTools": true,
	"deckard.mcpServer.enabled": false,
	"deckard.mcpServer.port": 39217,
	"deckard.highlightNoteSections": true,
	"deckard.autoSelectNoteSections": true,
	"deckard.enableHeadingTagRelationships": true,
	"deckard.enableTagAutocomplete": true,
	"deckard.enableKeywordLinks": true,
	"deckard.relatedNotesAssociationMinimumSupport": 1,
	"deckard.relatedNotesRecencyHalfLifeDays": 0,
	"deckard.entityNamespaceAliases": {
		"org": "organization"
	},
	"deckard.personMarker": "@"
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `deckard.notesFolder` | Empty | Optional workspace-relative folder Deckard scans. An empty value indexes all workspace Markdown files. |
| `deckard.exclude` | `{}` | Glob patterns of files and folders Deckard leaves out of its index, written like VS Code's `files.exclude`. Each pattern is relative to the workspace folder and applies when set to `true`, and a pattern that matches a folder leaves out everything in it. For example, `{ "**/archive": true, "drafts/*.md": true }`. Deckard also leaves out what `files.exclude` and `search.exclude` hide, such as `node_modules`. Set an inherited pattern to `false` here to index it anyway. Right-click a folder in the Explorer and choose **Deckard → Exclude from Deckard** to add it here, with Undo; **Include in Deckard** takes it out again. To keep an archive searchable, park it instead.
| `deckard.parked.folders` | `{}` | Glob patterns of folders and notes Deckard parks, written like `deckard.exclude`. A parked note stays indexed and searchable — `is:parked` finds it — but is left out of the lists of things to do. A pattern that matches a folder parks everything in it. `deckard.exclude` wins: an excluded note is not indexed at all. |
| `deckard.parked.tags` | `["parked"]` | Tags that park whatever carries them: a note whose front matter has one, a heading and everything under it, or a task. A tag parks its sub-tags too, so `project/old` parks `#project/old/phase-1`. |
| `deckard.theme` | `corpo` | Selects the visual style for Deckard webviews: `corpo`, which follows your VS Code theme, or one of `replicant`, `oblivion`, `lcars`, `synthwave`, `tomcat`, `fellowship`, and `cooper`. |
| `deckard.zenMode` | `false` | Turns Deckard's own chrome down in every webview: decorative labels and the grid backdrop are hidden, borders and headings thin out, and each row's file and line fold away until the row is hovered or focused. No control, count, or tag is removed. See [Zen mode](themes-and-zen.md#zen-mode). |
| `deckard.showWhatsNew` | `true` | After an update that adds features, Home shows one line linking to what is new. Help's What's new section lists recent releases either way. |
| `deckard.dashboard.openOnStartup` | `false` | Opens the Dashboard when VS Code starts in a workspace where Deckard has indexed notes. A Dashboard restored from the last session is left as it is. |
| `deckard.tagOverview.hubNoteExpanded` | `true` | Shows a tag's [hub note](search-pages.md#hub-notes) open at the top of its overview. Set it to `false` to start hubs collapsed to their title row. |
| `deckard.tagOverview.includeHubLinks` | `true` | On a tag's page, also lists the entries that link to its [hub note](search-pages.md#hub-notes) without carrying the tag, each marked *Links the hub note*. |
| `deckard.dailyNoteTemplate` | `# {date}\n\n` | Used when a new daily note is created. `{date}` becomes the local date in `YYYY-MM-DD` format. |
| `deckard.weeklyNoteTemplate` | `# {week}\n\n` | Used when a new weekly note is created. `{week}` becomes the days it covers, such as `2026-09-13 to 2026-09-19`, and `{date}` its first day. |
| `deckard.calendar.weekStart` | `sunday` | The day a week starts on: `sunday`, `monday`, or `locale` for the day VS Code's display language starts it. It sets the Calendar's rows, weekly notes and their reviews, a search's `this-week`, `last-week`, and `next-week`, and *next week* and *end of week* typed as a date. A weekly note written before a change still opens. |
| `deckard.calendar.dayPanel` | `false` | Shows the chosen day under the Calendar: its daily note, the tasks due or scheduled that day, and the notes created that day. A click then chooses a day, and a double-click or Enter opens its note. **Open Day Panel** and **Close Day Panel** in the Calendar's `…` menu set it. |
| `deckard.monthlyNoteTemplate` | `# {month}\n\n` | Used when a new monthly note is created. `{month}` becomes the month, such as `September 2026`, and `{date}` its first day. |
| `deckard.periodicNote.reviewSections` | `[]` | Sections of your own at the end of a review, each `{ "title": …, "query": … }`. See [Writing a review](daily-notes.md#writing-a-review). |
| `deckard.periodicNote.review` | `true` | Writes a review into a newly created weekly or monthly note. See [Writing a review](daily-notes.md#writing-a-review). |
| `deckard.dailyNote.rollover` | `off` | What a newly created daily note does with the last one's unfinished tasks: `off`, `move`, or `migrate` (`copy` is its older name). See [Carrying unfinished tasks forward](daily-notes.md#carrying-unfinished-tasks-forward). |
| `deckard.dailyNote.rolloverDays` | `7` | How many days back a rollover looks for unfinished tasks. `0` reaches as far as your daily notes go. |
| `deckard.templatesFolder` | `templates` | The folder of [note templates](notes-and-links.md#templates), relative to the workspace folder. Deckard does not index it. Leave it empty to turn templates off. |
| `deckard.noteBoundaries` | `line` | Where one note ends and the next begins; see [Markdown format](notes-and-links.md#markdown-format). `line` indexes a tagged non-heading, non-task line as its own entry. `heading` keeps the tag on its line and returns the heading holding it. `marked` is `heading` except for a line carrying a `^block-id`. Tasks are their own entry under all three. |
| `deckard.parseInlineTags` | `true` | Deprecated: use `deckard.noteBoundaries`. `false` is read as `heading`, which keeps a line's tags searchable through the heading that holds them rather than dropping them. |
| `deckard.outline.showTags` | `true` | Shows each heading's own tags beside it in the Outline. Disable it for titles only. |
| `deckard.outline.followCursor` | `true` | Selects the Outline heading containing the editor cursor. The eye control in the Outline title switches the same setting. |
| `deckard.outline.inheritedTags` | `false` | Also shows the front-matter tags every heading in the file inherits, after the tags written on the heading itself. |
| `deckard.outline.showCounts` | `true` | Shows beside each Outline heading how many of the tasks under it are done, such as `2/5`, and how many links name it, such as `↩3`. |
| `deckard.agenda.groupBy` | `due` | What the [Tasks view's](tasks.md#tasks-view) groups are: `due`, `priority`, `status`, `assignee`, or `tag`. The group control in its title sets the same thing. |
| `deckard.agenda.groupNamespace` | `project` | The tag namespace the Tasks view groups by when `deckard.agenda.groupBy` is `tag`, so `context` gives a group each to `#context/phone`, `#context/computer`, and the rest. A tag a task inherits from a heading or its note's front matter counts. |
| `deckard.agenda.upcomingDays` | `7` | How many days ahead the Tasks view's **Upcoming** group reaches; a dated task past that is in **Later**. |
| `deckard.agenda.query` | Empty | A [query](search.md#query-language) that says which open tasks the Tasks view, Home's agenda, and the status bar's count are of, such as `is:mine`. Empty means every open task. |
| `deckard.tasks.addDoneDate` | `true` | Adds a completion date when Deckard completes a task, and removes it when the task is reopened. Disable it to change only the checkbox. |
| `deckard.tasks.metadataFormat` | `emoji` | The Tasks format Deckard writes for a task with no metadata yet: `emoji` (📅 2026-09-20) or `dataview` ([due:: 2026-09-20]). A task that already uses one keeps it. Deckard reads both either way. |
| `deckard.tasks.metadataSuggestions` | `true` | Suggests dates, priorities, repeat rules, people, and dependencies after typing `/` in a task. |
| `deckard.tasks.assigneeFromPersonTag` | `false` | Read the first person named in a task's words as the person it is for, as Deckard did before the `👤` field; see [Who a task is for](tasks.md#who-a-task-is-for). |
| `deckard.board.limits` | `{}` | Work-in-progress limits for board columns, by status, such as `{ "doing": 3 }`, or by column id, such as `{ "priority:high": 5 }`. An over-limit column says so; a drop is never refused. |
| `deckard.tasks.onHoldStatuses` | `["waiting", "someday"]` | Statuses that put a task on hold, which `is:available` leaves out. Written without the namespace, as in `deckard.board.statuses`. |
| `deckard.tasks.suggestSteps` | `true` | Offers **Suggest steps** in Break into Steps… when a VS Code language model, such as GitHub Copilot, is installed. Only the task's words are sent, to that model, and only when you choose it. `false` never offers it. See [Suggest steps](ai-assistants.md#suggest-steps). |
| `deckard.me` | Empty | Who you are in your notes, such as `@ren-kade`, so `is:mine` finds the tasks that name you. See [Who a task is for](tasks.md#who-a-task-is-for). |
| `deckard.tasks.needsNewDateAfterDays` | `30` | How many days past its due date an open task stays in Overdue. After that it moves to the Tasks view's folded **Needs a new date** group and leaves the status bar's count and warning color. `0` keeps every overdue task in Overdue. |
| `deckard.statusBar` | `true` | Shows how many tasks are due today in the status bar, hidden while nothing is due. See [Status bar and reminders](tasks.md#status-bar-and-reminders). |
| `deckard.taskReminderTime` | Empty | A time of day, such as `09:00`, from which Deckard says how many tasks are due, once a day in one window. Empty means no reminder. |
| `deckard.board.statusNamespace` | `status` | The tag namespace that holds a task's status on the task board, so the default reads `#status/doing`. |
| `deckard.board.statuses` | `["todo", "doing", "waiting"]` | The task board's status columns, in order. A status found on a task but not listed gets a column after them; ordering the columns in the gear lists it. |
| `deckard.editor.referenceCounts` | `true` | Shows backlink, heading-reference, and open-task counts above a note's lines. |
| `deckard.editor.hoverPreviews` | `true` | Previews a `[[Wiki link]]`'s target and summarizes a tag's entries on hover. |
| `deckard.editor.linkDiagnostics` | `true` | Marks a `[[Wiki link]]` that opens no note and offers to create a missing one. |
| `deckard.editor.taskDependencies` | `true` | Shows, above a task with `⛔` or `🆔`, the open tasks it waits on and holds up. See [Editor assistance](notes-and-links.md#editor-assistance). |
| `deckard.editor.dailyNoteActions` | `true` | Shows the neighboring daily notes above a daily note, and on today's note, how many unfinished tasks it could carry in. |
| `deckard.editor.linkProblems` | `true` | Shows how many of a note's `[[Wiki links]]` open no note on its first line, with an action that creates the missing notes. |
| `deckard.editor.embedProblems` | `true` | Says above an `![[embed]]` the preview cannot draw which heading or `^marker` it is missing. |
| `deckard.editor.unlinkedMentions` | `true` | Counts, on a note's first line, the other notes that name it without a link, with an action that links them. |
| `deckard.editor.dimTaskMetadata` | `true` | Draws a task's dates, priority, repeat rule, ids, and person, and a line's `^block-id`, fainter than its words. An open task's overdue date is never dimmed; it takes the `deckard.overdueForeground` color. |
| `deckard.editor.taskDueHints` | `true` | Says after an open task's line when it is **overdue 5 days**, **due today**, or **needs a new date**. Zen mode hides these. |
| `deckard.editor.repeatDiagnostics` | `true` | Marks a 🔁 repeat rule Deckard cannot read on an open task, since completing it would not start the next one, with quick fixes to the nearest rules it can read. |
| `deckard.updateLinksOnRename` | `true` | Rewrites every `[[Wiki link]]` that named a note by its old title when the note is renamed, in the same step as the rename. See [Renaming notes and headings](organizing.md#renaming-notes-and-headings). |
| `deckard.moveTo.leaveBehind` | `link` | What Move to… leaves where the lines were: a task becomes `- [>] … → [[where it went]]` and anything else a `[[link]]`; `nothing` takes the lines out. |
| `deckard.previewWorkspaceWrites` | `severalNotes` | When a write reaches more than one note, shows it in VS Code's refactor preview first. `always` shows every write, `never` applies them straight away. See [Previewing and undoing a write](search-pages.md#previewing-and-undoing-a-write). |
| `deckard.assistantTools` | `true` | Lets AI assistants in VS Code, such as Copilot in agent mode, search notes and tasks with Deckard queries and list tags, after you allow the first call in each session. See [AI assistants](ai-assistants.md#ai-assistants). |
| `deckard.mcpServer.enabled` | `false` | Runs a Model Context Protocol server on 127.0.0.1 with the same tools, for Claude Code and other MCP clients that carry its token. See [Claude Code and other MCP clients](ai-assistants.md#claude-code-and-other-mcp-clients). |
| `deckard.mcpServer.port` | `39217` | The port the MCP server listens on, on 127.0.0.1. |
| `deckard.highlightNoteSections` | `true` | Highlights the tagged section or task the cursor is in. Its colors are the theme colors `deckard.sectionHighlightBackground` and `deckard.sectionHighlightBorder`, which `workbench.colorCustomizations` can change. Disable it to keep entry-level Related Notes cursor behavior without the band. |
| `deckard.autoSelectNoteSections` | `true` | Automatically focuses Related Notes on the tagged entry under the cursor. Disable it to keep Related Notes scoped to the whole document unless you choose an entry manually. |
| `deckard.tagTitleDisplayMode` | `inline` | Keeps tags in Related Notes, search page, and Dashboard note/task titles as clickable buttons by default. Set to `separate` to remove tags from titles and show them as separate tag controls. |
| `deckard.enableHeadingTagRelationships` | `true` | Offers related **Tags** in a tag search's Refine, ranked by association. Disable it to refine by the tags the results carry instead, without changing indexed tags or note content. |
| `deckard.enableTagAutocomplete` | `true` | Shows indexed tag and people suggestions after a marker. Disable it without changing tag indexing, highlighting, or navigation. |
| `deckard.enableKeywordLinks` | `true` | Let wording that two notes share move a related note up or down a little, when it already shares a tag, an association, or a link, and list entries with similar wording under a note that has no tags yet. For a note with tags, shared wording never makes a note related on its own. Turn off to rank by tags and links alone. |
| `deckard.relatedNotesAssociationMinimumSupport` | `1` | How many headings, tagged lines, or tasks must write two tags together before Related Notes treats the tags as associated. 1 counts an association written once. |
| `deckard.relatedNotesRecencyHalfLifeDays` | `0` | Give recently written notes a small lift in Related Notes: a note this many days old gets half the lift of one written today. 0 turns it off. A daily note's date or a front-matter date is used before the file's. |
| `deckard.entityNamespaceAliases` | `{ "org": "organization" }` | Maps one `#namespace` to another. Targets can be built-in or custom; for example, `{ "proj": "project", "leadership": "management" }` treats `#proj/atlas` as a project and collapses `#leadership/performance` into `#management/performance`. Other namespaced tags become entities automatically without configuration. |
| `deckard.personMarker` | `@` | Selects the single punctuation character that identifies people. Set it to `~` to use `~mara-vale` for people and reserve `@inbox` for a lightweight tag. |

---

← [Commands](commands.md) · [All topics](README.md) · [Privacy, source safety, and troubleshooting](privacy-and-troubleshooting.md) →
