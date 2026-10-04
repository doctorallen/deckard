# Commands

| Command | Description |
| --- | --- |
| **Deckard: Open Dashboard** | Opens workspace totals, Home, and tags. |
| **Deckard: Open Notes Graph** | Opens a map of every note, task, and tag connection. |
| **Deckard: Open Notes Graph Around This Note** | Opens the Notes Graph one hop out from the note in the editor, without changing its default scope. |
| **Deckard: Open Task Board** | Opens tasks as a Kanban board grouped by status, priority, due date, person, or any tag namespace. |
| **Deckard: Open Stats** | Opens index totals and local view-count statistics. |
| **Deckard: Open Help** | Opens the quick-start and advanced feature guide. |
| **Deckard: Choose Theme…** | Previews each theme on the open pages; Enter keeps one, Escape goes back. |
| **Deckard: Get Started** | Opens the walkthrough: six steps, each checked off as you do it. |
| **Deckard: What's New** | Opens Help at **What's new**. |
| **Deckard: Open Log** | Opens Deckard's log, including timings. |
| **Deckard: Reindex Workspace** | Reads and parses every note again. |
| **Deckard: Choose What Deckard Reads…** | Chooses a notes folder, leaves folders out, or pauses Deckard in this workspace; see [A code repository with no notes folder](getting-started.md#get-started). |
| **Deckard: Pause in This Workspace** | Stops Deckard reading and writing in this workspace until **Deckard: Resume in This Workspace**. |
| **Deckard: Create Hub Note for Tag…** | Lists the tags no hub note describes yet, most used first, and creates a [hub note](search-pages.md#hub-notes) for the one chosen. |
| **Deckard: Create Daily Note** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> elsewhere. Creates or opens today's note. |
| **Deckard: Pin Note to Home** | Pins the note the cursor is in to Home's Pinned notes. **Deckard: Unpin Note from Home** removes it. |
| **Deckard: Park Note** | [Parks](organizing.md#parking-notes) the note in the editor, or notes chosen in the Explorer, by adding `parked` to its front-matter tags. **Deckard: Unpark Note** reverses it. |
| **Deckard: Park Folder…** | Parks a folder by adding it to `deckard.parked.folders`; also on a folder's **Deckard** menu in the Explorer. **Deckard: Unpark Folder…** reverses it. |
| **Deckard: Park Tag…** | Parks everything a tag finds by adding it to `deckard.parked.tags`; also on a tag's menu. **Deckard: Unpark Tag…** reverses it. |
| **Deckard: Tidy Favorites, Pins, and Saved Searches** | Lists favorites, pins, and tag-set searches that point at nothing, and removes them if you confirm. |
| **Deckard: Export Tasks as Calendar…** | Writes your dated tasks to a calendar file to import into a calendar app; see [Tasks in your calendar app](daily-notes.md#tasks-in-your-calendar-app). |
| **Deckard: Export Favorites, Pins, and Searches** | Writes what Deckard remembers about this workspace to a JSON file. |
| **Deckard: Import Favorites, Pins, and Searches** | Reads one back and, after asking, replaces what this workspace remembers. |
| **Deckard: Restore Favorites, Pins, and Searches from a Copy** | Restores one of Deckard's automatic copies, after asking. |
| **Deckard: Check My Setup** | Writes a Markdown report of your resolved settings, what the last scan found and kept out, what the index holds, and whether `deckard.me` names anyone, with fixes. |
| **Deckard: Create a Work Sample** | Writes a week of a team lead's notes, dated from today, into Deckard's storage and opens it. Run again, it offers a fresh copy. |
| **Deckard: Create the Story Tour** | Writes the longer tour of Deckard, a note for each part, the same way. |
| **Deckard: Open Previous Daily Note** | Opens the nearest daily note before the one in the editor, or before today. |
| **Deckard: Open Daily Note for Date…** | Opens the daily note for a day in plain words, such as `last friday` or `oct 3`, creating it if needed. |
| **Deckard: Open Next Daily Note** | Opens the nearest daily note after the one in the editor, or after today. |
| **Deckard: Note Actions…** | The Deckard button in a note's title bar: lists actions for the cursor's position, such as completing, editing, or adding a task, opening Related Notes or the Notes Graph, moving the line, and pinning to Home. |
| **Deckard: Open Weekly Note** | Creates or opens this week's note, `week-2026-09-13-2026-09-19.md`, with [its review](daily-notes.md#writing-a-review) written in. |
| **Deckard: Open Monthly Note** | Creates or opens this month's note, `month-september-2026.md`, with its review written in. |
| **Deckard: Write a Review** | Writes, or brings up to date, the review in this week's or this month's note. |
| **Deckard: Edit Task** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> elsewhere. Edits the task on the cursor's line; see [Editing a whole task](tasks.md#editing-a-whole-task). |
| **Deckard: Add Task** | The same editor when the cursor is not on a task: the same shortcut writes a new one. |
| **Deckard: Break into Steps…** | Writes steps under the task on the cursor's line; see [Breaking a task into steps](tasks.md#breaking-a-task-into-steps). |
| **Deckard: Toggle Task Done** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd> elsewhere. Completes the tasks under every cursor and selection, or reopens them if all are done, writing the ✅ date and a repeating task's next occurrence. |
| **Deckard: Capture** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> elsewhere. Adds a task to today's note without leaving the current editor. |
| **Deckard: Capture Under a Heading** | Adds a task under a heading you choose in any note. |
| **Deckard: Roll Unfinished Tasks Forward** | Carries the last daily note's unfinished tasks into today's, creating it if needed. |
| **Deckard: New Note from Template** | Creates a note from a template in your templates folder. |
| **Deckard: Copy MCP Server Setup** | Copies the command that adds Deckard's [MCP server](ai-assistants.md#claude-code-and-other-mcp-clients) to Claude Code. |
| **Deckard: Reset MCP Server Token** | Makes a new MCP server token, invalidating copied setups. |
| **Deckard: Move to…** | Moves the line, task, or selection under another heading or into a new note, and leaves a link behind. |
| **Deckard: Open Note as Page** | The unicorn button in a note's title bar: opens the note in the editor on a page of its own, its links, tags, tasks, and query blocks working; see [Reading a note as a page](notes-and-links.md#reading-a-note-as-a-page). |
| **Deckard: Copy as Plain Markdown** | Copies the note, or the selection, with its embeds, query results, and links written out; see [Copying a note for elsewhere](notes-and-links.md#copying-a-note-for-elsewhere). |
| **Deckard: Extract Heading** | Moves a heading section into a newly named note and leaves a `[[link]]` to it. |
| **Deckard: Open a Tag's Search Page…** | Opens a tag's search page, asking which tag when none is supplied. |
| **Deckard: Insert Query Block…** | Writes a live [query block](query-blocks.md#query-blocks) at the cursor. |
| **Deckard: Find in Notes** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> elsewhere. Searches notes, tasks, tags, and saved searches as you type; see [Find](search.md#find). |
| **Deckard: Open Search Page…** | Opens a search page on a search, such as `#project/atlas AND is:open`; with nothing typed, a page of every note. |
| **Deckard: Link Current Heading to Entity** | Adds a person, project, topic, organization, or meeting tag to the current heading. |
| **Deckard: Move Inline Tags to Front Matter** | Moves explicit tags from the active note into merged note-level front matter. |
| **Deckard: Rename Tag** | Searches indexed tags and replaces the selected tag in its source notes. |
| **Deckard: Merge Tag…** | Merges one tag into an existing one, after a preview. |
| **Deckard: Rename Heading** | Renames the heading the cursor is in and rewrites every `[[Note#Heading]]` link that named it. |
| **Deckard: Undo Last Change** | Reverts Deckard's last workspace-wide write, such as a tag rename or merge. |
| **Deckard: Follow Cursor in Outline** | Selects the Outline heading containing the editor cursor. The Outline title has the same control. |
| **Deckard: Stop Following Cursor in Outline** | Leaves the Outline selection where you put it. |
| **Deckard: Focus Section** | Folds the rest of the note away from the current section or Outline heading. |
| **Deckard: Unfold All Sections** | Unfolds the note again after Focus Section. |
| **Deckard: Filter Outline by Tag…** | Shows only Outline headings carrying a tag, or a tag under it. |
| **Deckard: Clear Outline Tag Filter** | Shows every heading in the Outline again. |

---

← [AI assistants](ai-assistants.md) · [All topics](README.md) · [Settings](settings.md) →
