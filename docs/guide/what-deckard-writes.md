# What Deckard writes

Every change Deckard makes to your files, what starts it, and the setting that controls it. Deckard writes nothing on its own except the three marked *automatic*. A change that reaches more than one note is [shown first](search-pages.md#previewing-and-undoing-a-write), and `Deckard: Undo Last Change` takes the last one back.

## In your notes

| Write | Started by | Controlled by |
| --- | --- | --- |
| A task's box ticked or cleared, with its ✅ date, or `[completion:: …]` on a Dataview-format line | A checkbox on any page, the Tasks view, the board, a query block's preview, or `Deckard: Toggle Task Done` | |
| A repeating task's next occurrence, on a new line beside it | Completing a repeating task | The task's own repeat rule |
| A task's dates, priority, status character, assignee, or steps | The task editor, a board drag or card menu, the Tasks view's drops, Reschedule All… | `deckard.tasks.metadataFormat` for a task with no metadata yet |
| A captured task at the end of today's note | `Deckard: Capture` or a board column's **+ Add task** | Asks first in a code repository with no notes folder; see [Getting started](getting-started.md#get-started) |
| A tag added, renamed, or merged on every line that carries it | Rename Tag, Merge Tag…, a search page's edit, **Add a tag** | Shown first when it reaches several notes |
| `[[links]]` rewritten to a renamed note or heading | Renaming a note in the Explorer, or `Deckard: Rename Heading` | |
| A mention turned into a link | **Link mentions** on a note's first line, or **Link** in the Context view | `deckard.links.style`: `[[Name]]` or `[Name](path.md)` |
| A section moved out to a new note, leaving a link | `Deckard: Extract Heading` | |
| A task or section moved under another heading | **Move to…** | |
| `tags: [parked]` in front matter | **Park Note** | **Unpark Note** removes it |
| Tags moved into front matter | `Deckard: Move Inline Tags to Front Matter` | |
| A task added or changed for an AI assistant | The assistant's tools, after you approve the exact line | `deckard.assistantTools` |

## New files

| File | Started by | Controlled by |
| --- | --- | --- |
| Today's daily note, from its template | Opening or creating today's note, Capture, rollover | [`Daily.md`](daily-notes.md#templates) in `deckard.templatesFolder`, `deckard.notesFolder` |
| Unfinished tasks carried into a new daily note (*automatic*, when the note is made) | Creating a daily note | `deckard.dailyNote.rollover`, `off` by default |
| A weekly or monthly note, and a review written into it (*automatic*, when the note is made) | Opening the week's or month's note | `deckard.periodicNote.review`; [`Weekly.md` and `Monthly.md`](daily-notes.md#templates) |
| A note from a template | `Deckard: New Note from Template` | `deckard.templatesFolder` |
| Three starter templates | **Create Starter Templates**, offered when the templates folder is empty | |
| A hub note for a tag | **Create hub note** on a tag's page, or `Deckard: Create Hub Note for Tag…` | A template named after the tag's namespace |
| A note a link names | **Create note** on a `[[link]]` that opens none, or **Create missing notes** above the note | |
| A calendar file of your dated tasks | `Deckard: Export Tasks as Calendar…`, or kept up to date as tasks change (*automatic*, once set) | `deckard.calendar.exportFile`, empty by default |
| A JSON copy of favorites, pins, and searches | `Deckard: Export Favorites, Pins, and Searches` | |
| A sample workspace | `Deckard: Create a Work Sample` or `Deckard: Create the Story Tour`, in Deckard's own storage, not your folder | |

## In your settings

Deckard writes a setting only when you change it from one of its pages or commands: a theme, Zen, a notes folder chosen when asked, folders left out, a parked folder or tag, the board's status columns, the Tasks view's search. Each is an ordinary VS Code setting, in the scope the page says.

---

← [For your security reviewer](security.md) · [All topics](README.md) · [Accessibility and keyboard](accessibility.md) →
