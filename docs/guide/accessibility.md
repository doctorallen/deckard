# Accessibility and keyboard

Deckard is built to be used with a keyboard, a screen reader, high contrast, and zoom. This page says what to expect, and where something works differently from the rest of VS Code.

## Screen readers

- **The sidebar views** Tasks, Outline, and Hubs are native VS Code trees, read as any tree is. The **Context** and **Calendar** views and every page (Home, the Task board, search pages, the calendar page, Stats, Help, the Note page) are webviews.
- **In a webview with NVDA or JAWS,** press <kbd>Insert</kbd>+<kbd>Space</kbd> (NVDA) or <kbd>Insert</kbd>+<kbd>Z</kbd> (JAWS) to switch to focus mode when you want Deckard's own keys, such as the Task board's; browse mode reads the page as a document. VoiceOver needs no switch.
- **What changed is announced** through a status region, without moving focus: a card moved on the board, a widget added or removed on Home, and an Undo.
- **Focus stays where it was** when a page redraws after an index update, and returns to the control that opened a menu or a dialog when it closes.
- **The Task board's columns are lists:** entering one says how many cards it holds, and each card where it is, such as *3 of 13*.
- **Task metadata reads better in Dataview format.** A screen reader reads `📅 2026-10-07` as "calendar 2026-10-07" and `⏫` as an arrow; `[due:: 2026-10-07]` and `[priority:: high]` read as words. Set `deckard.tasks.metadataFormat` to `dataview` for new metadata; Deckard reads both formats and keeps each task's own.

## Keyboard

| Where | Keys |
| --- | --- |
| Anywhere | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> Find, <kbd>…</kbd>+<kbd>N</kbd> Capture, <kbd>…</kbd>+<kbd>D</kbd> today's note, <kbd>…</kbd>+<kbd>P</kbd> Go to… any page (<kbd>Cmd</kbd> for <kbd>Ctrl</kbd> on macOS) |
| Any right-click menu | <kbd>Shift</kbd>+<kbd>F10</kbd>, the context-menu key, or <kbd>Alt</kbd>+<kbd>Enter</kbd> opens it on what has focus; arrows move, <kbd>Enter</kbd> chooses, <kbd>Escape</kbd> closes |
| Task board | One Tab stop; arrows move between cards and columns; on a card, **x** done, **t**/**m** due today or tomorrow, **d** a date, **f** who it is for, **1**–**5** priority, **[** and **]** the next column, **e** edit, **?** every key. See [Task board: Keyboard](task-board.md#keyboard) |
| A card's **⋯** menu | Each item shows its one-key shortcut |
| Deckard's pages, atop Context | One Tab stop, a toolbar named *Deckard pages*; <kbd>Down</kbd> and <kbd>Up</kbd> move through the list, <kbd>Right</kbd> and <kbd>Left</kbd> through the icons, <kbd>Home</kbd> and <kbd>End</kbd> to either end, <kbd>Enter</kbd> opens. The page in front is read as the current page |
| **DECKARD ▾** atop a page | <kbd>Enter</kbd> or <kbd>Space</kbd> drops the menu of pages; arrows move, <kbd>Enter</kbd> goes, <kbd>Escape</kbd> closes it and returns to DECKARD |
| Notes Graph | Tab to the graph, arrows select a dot, <kbd>Enter</kbd> opens it, <kbd>Alt</kbd>+<kbd>Enter</kbd> beside the graph, <kbd>Escape</kbd> clears |
| Home and Tags tabs | <kbd>Left</kbd> and <kbd>Right</kbd> switch tabs |
| Ranked tags | <kbd>Alt</kbd>+<kbd>Up</kbd> and <kbd>Alt</kbd>+<kbd>Down</kbd> move a tag |
| Find | <kbd>Enter</kbd> opens a result, <kbd>Shift</kbd>+<kbd>Enter</kbd> the other way (page or editor), <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> beside |

Every command is in the Command Palette under **Deckard:**, and each can be given a key in VS Code's Keyboard Shortcuts.

## Seeing the page

- **High contrast:** in a high contrast VS Code theme, light or dark, every Deckard theme gives way to the editor's own colors, and glows, grid lines, and shadows go. Windows' forced colors are followed too.
- **Contrast:** every text color in every theme meets WCAG AA (4.5:1) against its background; a test checks it on each change.
- **Color is never the only signal:** an overdue date says *overdue*, a priority says its level, and red means overdue or high priority and nothing else.
- **Zoom:** pages reflow with VS Code's zoom (`window.zoomLevel`) and at narrow widths; the calendar page and Help fold to one column.
- **Focus is its own mark.** The focused entry has the focus ring and opens its *file / line* below it, pushing the next entry down rather than covering it; while you use the keyboard, an entry under a resting pointer stays as it is.
- **Motion:** with your system's reduce-motion setting on, pages hold still: no animated transitions or smooth scrolling.
- **Display** turns decoration and helper text down on any page, Quiet or Zen, and **Counts**, **Card details**, and **Dates** choose what a page writes, every hidden part still read aloud; see [Themes and Display](themes-and-zen.md#display).

Something that does not work as described here is a bug; please [report it](https://github.com/doctorallen/deckard/issues).

---

← [What Deckard writes](what-deckard-writes.md) · [All topics](README.md)
