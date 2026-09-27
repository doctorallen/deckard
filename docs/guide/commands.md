# Commands

| Command | Description |
| --- | --- |
| **Deckard: Open Dashboard** | Opens workspace totals, Home, and tags. |
| **Deckard: Open Notes Graph** | Opens an interactive force-directed map of every note, task, and tag connection. |
| **Deckard: Open Notes Graph Around This Note** | Opens the Notes Graph around the note in the editor, one hop out, without changing the scope the graph opens with next time. |
| **Deckard: Open Task Board** | Opens tasks as a Kanban board grouped by status, priority, due date, the person each task is for, or any tag namespace. |
| **Deckard: Open Stats** | Opens index totals and local view-count statistics. |
| **Deckard: Open Help** | Opens the quick-start and advanced feature guide. |
| **Deckard: Choose Theme…** | Previews each theme on the open pages as you move through the list; Enter keeps one, Escape puts back the one in use. |
| **Deckard: Get Started** | Opens the walkthrough: six steps, each checked off as you do it. |
| **Deckard: What's New** | Opens Help at **What's new**, the highlights of recent releases. |
| **Deckard: Open Log** | Opens Deckard's log, which records how long indexing, ranking, and editor features take. |
| **Deckard: Reindex Workspace** | Performs a full scan of the workspace Markdown scope, reading and parsing every note again. |
| **Deckard: Create Daily Note** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> elsewhere. Creates or opens today's note. |
| **Deckard: Pin Note to Home** | Pins the note the cursor is in — the heading and what is written under it — to Home's Pinned notes. **Deckard: Unpin Note from Home** removes it. |
| **Deckard: Park Note** | [Parks](organizing.md#parking-notes) the note in the editor, or the notes chosen in the Explorer, by writing `parked` into its front matter's tags. **Deckard: Unpark Note** takes it out again. |
| **Deckard: Park Folder…** | Parks a folder and every note in it, by adding it to `deckard.parked.folders`; also on a folder's **Deckard** menu in the Explorer. **Deckard: Unpark Folder…** takes it out again. |
| **Deckard: Park Tag…** | Parks everything a tag finds, by adding it to `deckard.parked.tags`; also on a tag's menu on Deckard's pages and in the Outline. **Deckard: Unpark Tag…** takes it out again. |
| **Deckard: Tidy Favorites, Pins, and Saved Searches** | Lists the favorites, pins, and tag-set searches that point at nothing in this workspace any more, and removes them only if you say so. Deckard never removes one of these on its own. |
| **Deckard: Export Favorites, Pins, and Searches** | Writes what Deckard remembers about this workspace to a JSON file you choose. |
| **Deckard: Import Favorites, Pins, and Searches** | Reads one back and, after asking, replaces what this workspace remembers with it. |
| **Deckard: Restore Favorites, Pins, and Searches from a Copy** | Offers the copies Deckard keeps on its own, newest first, and restores the one you pick after asking. |
| **Deckard: Check My Setup** | Writes up, as a Markdown document, what your settings resolve to in this workspace, what the last scan found and kept out, what the index holds, and whether `deckard.me` names anyone — with what to do about each thing that is off. |
| **Deckard: Create a Sample Workspace** | Writes a hands-on tour of Deckard, dated from today, into Deckard's own storage and opens it, showing its Start here README once the window reloads. Run again, it offers to replace it with a fresh copy. |
| **Deckard: Open Previous Daily Note** | Opens the nearest daily note before the one in the editor, or before today. |
| **Deckard: Open Daily Note for Date…** | Opens the daily note for a day named in plain words, such as `last friday` or `oct 3`, creating it from the template when there is none. |
| **Deckard: Open Next Daily Note** | Opens the nearest daily note after the one in the editor, or after today. |
| **Deckard: Note Actions…** | The Deckard button in a note's title bar: lists what can be done from where the cursor is — complete, edit, or add a task, open Related Notes or the Notes Graph around the note, move the line, and pin the note to Home. |
| **Deckard: Open Weekly Note** | Creates or opens this week's note, `week-2026-09-13-2026-09-19.md`, with [its review](daily-notes.md#writing-a-review) written in. |
| **Deckard: Open Monthly Note** | Creates or opens this month's note, `month-september-2026.md`, with its review written in. |
| **Deckard: Write a Review** | Writes, or brings up to date, the review in this week's or this month's note. |
| **Deckard: Edit Task** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> elsewhere. Edits the task on the cursor's line, field by field; see [Editing a whole task](tasks.md#editing-a-whole-task). |
| **Deckard: Add Task** | The same editor, under the name it goes by when the cursor is not on a task: the same shortcut writes a new one where you are. |
| **Deckard: Break into Steps…** | Writes steps under the task on the cursor's line, one for each you type; see [Breaking a task into steps](tasks.md#breaking-a-task-into-steps). |
| **Deckard: Toggle Task Done** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd> elsewhere. Completes the tasks under every cursor and selection, or reopens them when all are done already, writing the ✅ date and the next occurrence of a repeating task. One Undo takes it back. |
| **Deckard: Capture** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> elsewhere. Adds a task to today's note without leaving the current editor, completing tags as you type. |
| **Deckard: Capture Under a Heading** | Adds a task under a heading you choose in any note. |
| **Deckard: Roll Unfinished Tasks Forward** | Carries the unfinished tasks of the last daily note into today's, creating today's note if it is not there yet. |
| **Deckard: New Note from Template** | Creates a note from a template in your templates folder, asking for its title and anything the template asks. |
| **Deckard: Copy MCP Server Setup** | Copies the command that adds Deckard's [MCP server](ai-assistants.md#claude-code-and-other-mcp-clients) to Claude Code, offering to turn the server on first. |
| **Deckard: Reset MCP Server Token** | Makes a new MCP server token, so every copied setup stops working. |
| **Deckard: Move to…** | Moves the line, task, or selection under another heading or into a new note, and leaves a link behind. |
| **Deckard: Extract Heading** | Moves a heading section into a newly named note and leaves a `[[link]]` to it. |
| **Deckard: Open a Tag's Search Page…** | Opens a tag's search page, asking which tag when none is supplied. |
| **Deckard: Open Search Page** | Opens a search page listing every note, ready for a search. |
| **Deckard: Insert Query Block…** | Writes a live [query block](query-blocks.md#query-blocks) of a saved or recent search, or one you type, at the cursor. |
| **Deckard: Find in Notes** | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> elsewhere. Searches notes, tasks, tags, and saved searches as you type; see [Find](search.md#find). |
| **Deckard: Search Notes and Tasks** | Opens a search page on a Deckard query, such as `(tag = #project/atlas AND task = open) OR text ~ "vendor"`. |
| **Deckard: Link Current Heading to Entity** | Adds a person, project, topic, organization, or meeting tag to the current heading. |
| **Deckard: Move Inline Tags to Front Matter** | Moves explicit tags from the active note into merged note-level front matter. |
| **Deckard: Rename Tag** | Searches indexed tags and replaces the selected tag in its source notes. |
| **Deckard: Merge Tag…** | Merges one indexed tag into another that already exists, after showing what the merge will change. |
| **Deckard: Rename Heading** | Renames the heading the cursor is in and rewrites every `[[Note#Heading]]` link that named it. |
| **Deckard: Undo Last Change** | Puts every note back as it was before Deckard's last workspace-wide write, such as a tag rename or merge. |
| **Deckard: Follow Cursor in Outline** | Selects the Outline heading containing the editor cursor. The Outline title has the same control. |
| **Deckard: Stop Following Cursor in Outline** | Leaves the Outline selection where you put it. |
| **Deckard: Focus Section** | Folds the rest of the note away from the section the cursor is in, or the Outline heading it is run on, and opens that section's sub-headings. |
| **Deckard: Unfold All Sections** | Unfolds the note again after Focus Section. |
| **Deckard: Filter Outline by Tag…** | Shows only the Outline headings that carry a tag, or a tag under it, until it is cleared. |
| **Deckard: Clear Outline Tag Filter** | Shows every heading in the Outline again. |

---

← [AI assistants](ai-assistants.md) · [All topics](README.md) · [Settings](settings.md) →
