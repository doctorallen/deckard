# Renaming, moving, and parking

## Renaming notes and headings

- **Renaming a note in the Explorer** rewrites every `[[link]]` to its old title. One Undo takes back both. Links through an `aliases:` name, links to another note with the same name, and links in fenced code are left alone. Moving a note to another folder changes no links.
- A link's heading, `^marker`, and `|display text` are kept: `[[Vendor review#Terms|the terms]]` becomes `[[Supplier review#Terms|the terms]]`.
- `deckard.updateLinksOnRename` turns this off.
- **Deckard: Rename Heading** renames the heading the cursor is in and updates links to it: `[[Check-in#Vendor review]]` elsewhere and `[[#Vendor review]]` in the same note. Tags on the heading stay. Save the note first.

## Extracting headings

Run `Deckard: Extract Heading` with the cursor in a heading section. Deckard moves the whole section, nested headings included, into a new note and leaves a `[[link]]` to it. Outside a heading, it offers a picker of every heading. Existing notes are never overwritten.

### Moving lines and tasks

`Deckard: Move to…` moves what the cursor is on (a task or list item with everything nested under it, or one line of prose), or every line a selection touches, under another heading, into today's note, or into a new note. It does not move a heading, a blank line, front matter, or half a code block. Run it from the lightbulb, the palette, the Tasks view, a Task board card's menu, or Find.

- The list starts with **New note…** and **Today's note**, then the five headings Capture and Move to… used last, then every heading. Lines go under the heading's own lines, above any nested heading.
- A task left behind becomes `- [>] Call Ren 📅 2026-09-20 → [[2026-09-25]]`; anything else becomes a `[[link]]` to where it went. Set `deckard.moveTo.leaveBehind` to `nothing` to leave no trace. A `[>]` line is not a task.
- If the lines or heading changed before you chose, nothing is written. The move is previewed only when `deckard.previewWorkspaceWrites` is `always`. **Undo**, or `Deckard: Undo Last Change`, puts both notes back.

## Parking notes

A note, heading, or task is **parked** when it is in a parked folder or a search for a parked tag finds it. Parked items stay indexed and searchable but leave the lists of things to do.

- **Park Note** writes `tags: [parked]` into front matter; **Unpark Note** removes it. Both are in the palette, the editor tab's menu, and the **Deckard** menus in the editor, Explorer, and search cards, with Undo.
- **Park Folder…** adds a folder to `deckard.parked.folders`, from the palette or a folder's **Deckard** menu in the Explorer.
- **Park Tag…** adds a tag to `deckard.parked.tags`, from the palette, a tag's menu, or the Outline. It parks everything a search for the tag finds, and its sub-tags: `project/old` parks `#project/old/phase-1`. A parked tag's page says **Parked** with **Unpark**.

| Left out | Kept, listed last and marked **Parked** |
| --- | --- |
| The Tasks view, its badge, the status bar and reminder, the Task board, Home's task widgets, the calendar, rollover, a review's still-open list, Gone quiet, Related Notes, the Notes Graph (until **Show parked**), tag completion, and Stats' unlinked notes | Search pages, Home's saved-search widget, Find, `[[` completion, Linked from, query blocks, and the AI tools |

- A task list shows parked tasks only when its search mentions `is:parked`: set `deckard.agenda.query` to `is:parked`, or search the board for `is:open is:parked`. `is:parked` finds everything parked; `-is:parked` everything else.
- To hide a status such as `someday` from the Tasks view, add `status/someday` to `deckard.parked.tags`.
- Use `deckard.exclude` for files that are not notes, such as build output: excluded files are not read or found. It wins when both match.

---

← [Daily notes, reviews, and the calendar](daily-notes.md) · [All topics](README.md) · [Themes and Zen mode](themes-and-zen.md) →
