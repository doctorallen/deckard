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
	"deckard.editor.hubProgress": true,
	"deckard.editor.slashMenu": true,
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
| `deckard.notesFolder` | Empty | Optional workspace-relative folder Deckard scans. An empty value indexes all workspace Markdown files. In a multi-root workspace, each folder can set its own. |
| `deckard.exclude` | `{}` | Glob patterns, relative to the workspace folder and written like `files.exclude`, that Deckard leaves out of its index, such as `{ "**/archive": true, "drafts/*.md": true }`. Deckard also leaves out what `files.exclude` and `search.exclude` hide; set an inherited pattern to `false` to index it. In the Explorer, a folder's **Deckard → Exclude from Deckard** adds it, and **Include in Deckard** removes it from whichever settings set it, or sets it to `false` there when less specific settings set it too. To keep an archive searchable, park it instead. |
| `deckard.parked.folders` | `{}` | Glob patterns of folders and notes to park, written like `deckard.exclude`. A parked note stays searchable with `is:parked` but is left out of to-do lists. `deckard.exclude` wins. |
| `deckard.parked.tags` | `["parked"]` | Tags that park a note (in front matter), a heading and everything under it, or a task. Sub-tags park too, so `project/old` parks `#project/old/phase-1`. |
| `deckard.theme` | `corpo` | The style for Deckard's pages: `corpo`, which follows your VS Code theme, or `replicant`, `oblivion`, `lcars`, `synthwave`, `tomcat`, `fellowship`, and `cooper`. |
| `deckard.zenMode` | `false` | Turns Deckard's chrome down in every page. No control, count, or tag is removed. See [Zen mode](themes-and-zen.md#zen-mode). |
| `deckard.showWhatsNew` | `true` | After an update that adds features, Home shows one line linking to what is new. |
| `deckard.dashboard.openOnStartup` | `false` | Opens the Dashboard when VS Code starts in a workspace where Deckard has indexed notes. |
| `deckard.tagOverview.hubNoteExpanded` | `true` | Shows a tag's [hub note](search-pages.md#hub-notes) open at the top of its overview. |
| `deckard.tagOverview.includeHubLinks` | `true` | On a tag's page, also lists the entries that link to its [hub note](search-pages.md#hub-notes) without carrying the tag, each marked *Links the hub note*. |
| `deckard.dailyNoteTemplate` | `# {date}\n\n` | Used when a new daily note is created. `{date}` becomes the local date in `YYYY-MM-DD` format. |
| `deckard.weeklyNoteTemplate` | `# {week}\n\n` | Used when a new weekly note is created. `{week}` becomes the days it covers, such as `2026-09-13 to 2026-09-19`, and `{date}` its first day. |
| `deckard.calendar.weekStart` | `sunday` | The day a week starts on: `sunday`, `monday`, or `locale` (VS Code's display language). It sets the Calendar, weekly notes and reviews, `this-week`, `last-week`, and `next-week`, and typed dates such as *next week*. |
| `deckard.calendar.dayPanel` | `false` | Shows the chosen day's daily note, tasks, and new notes under the Calendar. A click then chooses a day; a double-click or Enter opens its note. Set from **Open Day Panel** and **Close Day Panel** in the Calendar's `…` menu. |
| `deckard.monthlyNoteTemplate` | `# {month}\n\n` | Used when a new monthly note is created. `{month}` becomes the month, such as `September 2026`, and `{date}` its first day. |
| `deckard.periodicNote.reviewSections` | `[]` | Sections of your own at the end of a review, each `{ "title": …, "query": … }`. See [Writing a review](daily-notes.md#writing-a-review). |
| `deckard.periodicNote.review` | `true` | Writes a review into a newly created weekly or monthly note. See [Writing a review](daily-notes.md#writing-a-review). |
| `deckard.dailyNote.rollover` | `off` | What a new daily note does with the last one's unfinished tasks: `off`, `move`, or `migrate` (`copy` is its older name). See [Carrying unfinished tasks forward](daily-notes.md#carrying-unfinished-tasks-forward). |
| `deckard.dailyNote.rolloverDays` | `7` | How many days back a rollover looks for unfinished tasks. `0` reaches as far as your daily notes go. |
| `deckard.templatesFolder` | `templates` | The folder of [note templates](notes-and-links.md#templates), relative to the workspace folder. Not indexed. Empty turns templates off. |
| `deckard.noteBoundaries` | `line` | Where one note ends and the next begins; see [Markdown format](notes-and-links.md#markdown-format). `line`, `heading`, or `marked`. |
| `deckard.parseInlineTags` | `true` | Deprecated: use `deckard.noteBoundaries`. `false` is read as `heading`. |
| `deckard.outline.showTags` | `true` | Shows each heading's own tags beside it in the Outline. |
| `deckard.outline.followCursor` | `true` | Selects the Outline heading containing the editor cursor. The eye control in the Outline title switches it. |
| `deckard.outline.inheritedTags` | `false` | Also shows the front-matter tags every heading inherits. |
| `deckard.outline.showCounts` | `true` | Shows each Outline heading's done tasks, such as `2/5`, and links naming it, such as `↩3`. |
| `deckard.agenda.groupBy` | `due` | What the [Tasks view's](tasks.md#tasks-view) groups are: `due`, `priority`, `status`, `assignee`, or `tag`. The group control in its title sets it too. |
| `deckard.agenda.groupNamespace` | `project` | The tag namespace the Tasks view groups by when `deckard.agenda.groupBy` is `tag`, such as `context` for `#context/phone`. Inherited tags count. |
| `deckard.agenda.upcomingDays` | `7` | How many days ahead the Tasks view's **Upcoming** group reaches; a dated task past that is in **Later**. |
| `deckard.agenda.query` | Empty | A [query](search.md#query-language) limiting the open tasks in the Tasks view, Home's agenda, and the status bar, such as `is:mine`. Empty means every open task. |
| `deckard.tasks.addDoneDate` | `true` | Adds a completion date when Deckard completes a task, and removes it when the task is reopened. |
| `deckard.tasks.metadataFormat` | `emoji` | The Tasks format Deckard writes for a task with no metadata yet: `emoji` (📅 2026-09-20) or `dataview` ([due:: 2026-09-20]). Existing tasks keep theirs; Deckard reads both. |
| `deckard.tasks.metadataSuggestions` | `true` | Suggests dates, priorities, repeat rules, people, and dependencies after typing `/` in a task. |
| `deckard.tasks.assigneeFromPersonTag` | `false` | Reads the first person named in a task as the person it is for; see [Who a task is for](tasks.md#who-a-task-is-for). |
| `deckard.board.limits` | `{}` | Work-in-progress limits for board columns, by status, such as `{ "doing": 3 }`, or by column id, such as `{ "priority:high": 5 }`. An over-limit column says so. |
| `deckard.tasks.onHoldStatuses` | `["waiting", "someday"]` | Statuses that put a task on hold, left out of `is:available`. Written without the namespace. |
| `deckard.tasks.suggestSteps` | `true` | Offers **Suggest steps** in Break into Steps… when a VS Code language model, such as GitHub Copilot, is installed. Only the task's words are sent, and only when you choose it. See [Suggest steps](ai-assistants.md#suggest-steps). |
| `deckard.me` | Empty | Who you are in your notes, such as `@ren-kade`, so `is:mine` finds the tasks that name you. See [Who a task is for](tasks.md#who-a-task-is-for). |
| `deckard.tasks.needsNewDateAfterDays` | `30` | How many days past its due date an open task stays in Overdue. After that it moves to **Needs a new date** and leaves the status bar's count. `0` keeps every overdue task in Overdue. |
| `deckard.statusBar` | `true` | Shows how many tasks are due today in the status bar, hidden while nothing is due. See [Status bar and reminders](tasks.md#status-bar-and-reminders). |
| `deckard.taskReminderTime` | Empty | A time of day, such as `09:00`, from which Deckard says how many tasks are due, once a day. Empty means no reminder. |
| `deckard.board.statusNamespace` | `status` | The tag namespace that holds a task's status on the task board, so the default reads `#status/doing`. |
| `deckard.board.statuses` | `["todo", "doing", "waiting"]` | The task board's status columns, in order. An unlisted status found on a task gets a column after them. |
| `deckard.editor.referenceCounts` | `true` | Shows backlink, heading-reference, and open-task counts above a note's lines. |
| `deckard.editor.hoverPreviews` | `true` | Previews a `[[Wiki link]]`'s target and summarizes a tag's entries on hover. |
| `deckard.editor.linkDiagnostics` | `true` | Marks a `[[Wiki link]]` that opens no note and offers to create a missing one. |
| `deckard.editor.taskDependencies` | `true` | Shows, above a task with `⛔` or `🆔`, the open tasks it waits on and holds up. See [Editor assistance](notes-and-links.md#editor-assistance). |
| `deckard.editor.dailyNoteActions` | `true` | Shows neighboring daily notes above a daily note, and on today's, unfinished tasks to carry in. |
| `deckard.editor.linkProblems` | `true` | Counts a note's `[[Wiki links]]` that open no note on its first line, with an action to create them. |
| `deckard.editor.embedProblems` | `true` | Says above a broken `![[embed]]` which heading or `^marker` it is missing. |
| `deckard.editor.unlinkedMentions` | `true` | Counts, on a note's first line, notes that name it without a link, with an action to link them. |
| `deckard.editor.hubProgress` | `true` | Says, on a hub note's first line, how far along the tasks of the tag it describes are. |
| `deckard.editor.slashMenu` | `true` | Offers, after a `/` alone at the start of a line, blocks and templates to write there. |
| `deckard.editor.dimTaskMetadata` | `true` | Draws a task's dates, priority, repeat rule, ids, and person, and a line's `^block-id`, fainter than its words. An overdue date takes the `deckard.overdueForeground` color instead. |
| `deckard.editor.taskDueHints` | `true` | Says after an open task's line when it is **overdue 5 days**, **due today**, or **needs a new date**. Zen mode hides these. |
| `deckard.editor.repeatDiagnostics` | `true` | Marks an unreadable 🔁 repeat rule on an open task, with quick fixes. |
| `deckard.updateLinksOnRename` | `true` | Rewrites `[[Wiki links]]` to a note's old title when it is renamed. See [Renaming notes and headings](organizing.md#renaming-notes-and-headings). |
| `deckard.moveTo.leaveBehind` | `link` | What Move to… leaves where the lines were: a task becomes `- [>] … → [[where it went]]` and anything else a `[[link]]`; `nothing` takes the lines out. |
| `deckard.previewWorkspaceWrites` | `severalNotes` | Shows a write reaching more than one note in VS Code's refactor preview first. `always` previews every write; `never` none. See [Previewing and undoing a write](search-pages.md#previewing-and-undoing-a-write). |
| `deckard.assistantTools` | `true` | Lets AI assistants in VS Code, such as Copilot in agent mode, search notes and tasks, list tags, add a task to a note, and change an existing task, after you allow the first call each session. Nothing is written until you approve the line in the refactor preview. See [AI assistants](ai-assistants.md#ai-assistants). |
| `deckard.mcpServer.enabled` | `false` | Runs an MCP server on 127.0.0.1 with the same tools, writes included, for clients that carry its token. Nothing is written until you approve the line in the refactor preview. See [Claude Code and other MCP clients](ai-assistants.md#claude-code-and-other-mcp-clients). |
| `deckard.mcpServer.port` | `39217` | The port the MCP server listens on, on 127.0.0.1. |
| `deckard.highlightNoteSections` | `true` | Highlights the tagged section or task the cursor is in. Colors: `deckard.sectionHighlightBackground` and `deckard.sectionHighlightBorder` in `workbench.colorCustomizations`. |
| `deckard.autoSelectNoteSections` | `true` | Focuses Related Notes on the tagged entry under the cursor. Disabled, Related Notes covers the whole document. |
| `deckard.tagTitleDisplayMode` | `inline` | Shows tags inside note and task titles as buttons. `separate` shows them as separate controls. |
| `deckard.enableHeadingTagRelationships` | `true` | Offers related **Tags** in a tag search's Refine, ranked by association. Disabled, Refine offers the tags the results carry. |
| `deckard.enableTagAutocomplete` | `true` | Shows indexed tag and people suggestions after a marker. |
| `deckard.enableKeywordLinks` | `true` | Lets shared wording adjust a related note's rank when it already shares a tag, association, or link, and lists similar entries for a note with no tags. Off ranks by tags and links alone. |
| `deckard.relatedNotesAssociationMinimumSupport` | `1` | How many headings, tagged lines, or tasks must write two tags together before Related Notes treats the tags as associated. |
| `deckard.relatedNotesRecencyHalfLifeDays` | `0` | Lifts recent notes in Related Notes: a note this many days old gets half the lift of one written today. 0 turns it off. |
| `deckard.entityNamespaceAliases` | `{ "org": "organization" }` | Maps one `#namespace` to another. For example, `{ "proj": "project", "leadership": "management" }` treats `#proj/atlas` as a project and collapses `#leadership/performance` into `#management/performance`. |
| `deckard.personMarker` | `@` | The punctuation character that marks people. Set it to `~` to use `~mara-vale` for people and reserve `@inbox` for a lightweight tag. |

---

← [Commands](commands.md) · [All topics](README.md) · [Privacy, source safety, and troubleshooting](privacy-and-troubleshooting.md) →
