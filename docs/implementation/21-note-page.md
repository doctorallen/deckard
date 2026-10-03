# The note page

**Status: building.** A note read in a Deckard page rather than in the editor, and a setting that makes it where a note opens.

## What it is

A **note page** is a webview tab that draws one note the way Deckard's pages draw everything else: in the reader's theme, with the parts only Deckard understands working. It is to a note what a tag's page is to a tag.

- **Tags** are buttons that open the tag's page.
- **`[[links]]`** open the note they name in the same tab. **Back** and **Forward**, and the mouse's side buttons, step through the notes it has shown.
- **Tasks** have working boxes, through the same toggle every page uses, with Undo.
- **Query blocks** draw their results live, a list or a table, their tasks' boxes working and their rows opening what they list.
- **Embeds** draw the note, heading, or line they name, three deep, with a link to where it came from.
- **Front matter** is a row of properties above the note, a tag among the values a button.
- **The header** has the note's title, its folder, its breadcrumbs from the Hubs view, and, for a hub note, the progress bar of its tag's tasks with a button to the tag's page.
- **Linked from** lists the notes that link to it, each with the lines that do.
- **Open in Editor** opens the note at the line in view; a double-click on a block opens the editor at that block's line.

It is read-only. Editing in place is left for later, if at all: two editors of one file fight over it.

## One tab

The note page is one panel, reused like VS Code's preview tab: opening another note replaces what it shows, so reading down a list of results leaves one tab. Its title is the note's. It is kept across a reload with the note it showed.

## Where a note opens

`deckard.openNotesIn` decides where opening a note or an entry from Deckard goes:

| Value | A note opens |
| --- | --- |
| `editor` *(default)* | in the editor, at its line, as today |
| `page` | on the note page, scrolled to its line, which is marked for a moment |

**The other way, one modifier away.** Shift-click, or Shift+Enter from the keyboard, opens where the setting does not. It combines with what is there: Cmd/Ctrl+Shift-click opens the other way beside the page, and a double-click still keeps the tab. A row's tip says both.

Shift is free on every entry: Cmd/Ctrl opens beside, a double-click keeps the tab, and Alt does other work (Refine's exclude, the graph's beside, Alt+Enter for a card's menu). Shift is only read on Refine's facet chips, which open nothing.

**Where VS Code does not say which keys were held** — a native tree view (Hubs, Tasks, Outline), a lens, and Find's list — the other way is a visible control instead:

- the Hubs view's notes have **Open in Editor** and **Open as Page** on their right-click menu, the one the setting does not pick;
- the breadcrumb lens follows the setting;
- Find's Shift+Enter opens the other way, since it reads keys, through a keybinding.

**What follows the setting:** the search page's cards and tasks, Related Notes, Home's notes and tasks, the Task Board's cards, the Notes Graph, the calendars' notes, Stats' rows, Find, the Hubs view, and the breadcrumb lens. **What does not:** a link followed inside the editor, which is already where the reader is writing; the Tasks view and the Outline, which navigate the editor; and editing a task, which needs the editor.

## Shape

| Part | Where |
| --- | --- |
| The snapshot: blocks with their source lines, the header, properties, Linked from | `src/ui/protocol/notePage.ts`, built by `src/ui/state/notePageState.ts` from the index |
| The controller, its history, and its handlers | `src/ui/webview/pages/notePage/` |
| The host class, one panel | `src/ui/webview/notePage.ts` |
| The page | `src/webview/notePage/` |
| Where a note opens | `src/ui/commands/noteOpening.ts`: `chooseNoteTarget(setting, opposite)` and `openNoteAt(filePath, line, how)`, which every surface calls instead of `openResultAt` |
| The commands | `deckard.openNotePage` (the palette's *Open Note as Page*, for the note in the editor, or a note it is given) and `deckard.openNote` (internal: a note, opened where the setting says) |

The body is drawn from tokens, never from HTML, as every page draws Markdown: the snapshot carries markdown-it's blocks, each with its line, mapped as `domain/markdown/blockExcerpt.ts` maps a card's, with tasks, query blocks, and embeds read out of them. VS Code's own Markdown renderer gives back HTML, which Help trusts because the HTML is Deckard's own guide; a note's can hold a script.

A message carries `opposite: true` when Shift was held; `openingOf` reads it beside `beside` and `pin`, and `narrowOpenSource` passes it on.

## Tests

- `notePageState` from notes with every kind of block: lines, tasks, query blocks, embeds three deep, front matter, breadcrumbs, Linked from.
- `chooseNoteTarget` and the narrowing of each message.
- A host test: navigating, Back and Forward, a link, a task's box.
- The page in the catalog and as a surface, so `test:ui`, `test:dom`, `test:layout`, and `test:visual` draw it in every theme.
