# Renaming, moving, and parking

## Renaming notes and headings

A `[[link]]` names its target by text, so renaming a note would break every link to it. Deckard rewrites them as part of the rename:

- **Renaming or moving a note in the Explorer** rewrites every `[[link]]` that named it by its old title, across the workspace. The links and the rename land together, so one Undo takes back both, and Deckard says how many links it changed in how many notes.
- Only links that resolved to the note being renamed are touched. A link written through an `aliases:` name the note keeps is left as it is, since it still opens the note, and so is a link to a different note that happens to share the name. Moving a note to another folder changes no links, because a link names a note by its title and not by its path.
- A link's heading, `^marker`, and `|display text` are kept exactly as they were written: `[[Vendor review#Terms|the terms]]` becomes `[[Supplier review#Terms|the terms]]`.
- `deckard.updateLinksOnRename` turns this off.
- **Deckard: Rename Heading** renames the heading the cursor is in and carries the links into it along: `[[Check-in#Vendor review]]` elsewhere, and `[[#Vendor review]]` in the same note, follow the new text. Tags written on the heading stay on it. Save the note first — Deckard rewrites the links from what is on disk, so it asks you to save rather than work from a draft it cannot see.

Links inside fenced code are left alone, as everywhere else in Deckard.

## Extracting headings

Run `Deckard: Extract Heading` with the cursor inside a heading section, tagged or not. Deckard moves the complete section, including nested headings and any heading tags, into a new Markdown note in the configured notes folder or workspace root. In the source note, the extracted heading and its content are replaced by a `[[link]]` to the new note, keeping the blank lines around it. If the cursor is not inside a heading, Deckard offers a picker of every heading in the workspace, naming the tags of those that have some.

The note name is used as a single Markdown filename. Existing notes are never overwritten; choose a different name when a conflict is reported.

### Moving lines and tasks

`Deckard: Move to…` moves what the cursor is on — a task or list item with everything nested under it, or one line of prose — or every line a selection touches, under another heading, into today's note, or into a new note. A selection that ends at the start of a line leaves that line alone, and one whose last item has children takes them too. It will not move a heading (Extract Heading does that), a blank line, front matter, or half a code block. It is on the lightbulb of a task line or a selection, in the palette, on a task in the Tasks view, on a Task board card's menu, and in Find's list for a task.

The list of places starts with **New note…** and **Today's note**, then the five headings Capture and Move to… went under last, then every heading. The lines go under the heading's own lines, above any heading nested in it, with the first line's indentation taken off. Where they were, a task left behind becomes `- [>] Call Ren 📅 2026-09-20 → [[2026-09-25]]`, as rollover's migrate writes it, and anything else becomes one `[[link]]` to where it went; set `deckard.moveTo.leaveBehind` to `nothing` to take the lines out without a trace. A `[>]` line is neither a task nor an entry on a tag's page.

The lines are read again once you have chosen where they go: if they changed in the meantime, or the heading is gone, nothing is written. The move is one write, previewed only when `deckard.previewWorkspaceWrites` is `always`; the message's **Undo**, or `Deckard: Undo Last Change`, puts both notes back and removes a new note if it is unchanged.

## Parking notes

A note, heading, or task is **parked** when it is in a parked folder, or when a search for a parked tag would find it. A parked note stays indexed and searchable, and is left out of the lists of things to do. It is the way to set aside a finished project or an archive without losing it from search, which `deckard.exclude` would.

- **Park Note** writes `tags: [parked]` into the note's front matter; **Unpark Note** takes it out. Both are in the palette, the editor tab's menu, the editor's **Deckard** submenu, a note's **Deckard** menu in the Explorer, and a search card's menu, with Undo. A note stays where it is.
- **Park Folder…** adds a folder to `deckard.parked.folders`, from the palette or a folder's **Deckard** menu in the Explorer. To file by folder, park an archive folder once and drag notes into it: moving a note keeps its links.
- **Park Tag…** adds a tag to `deckard.parked.tags`, from the palette, a tag's menu on Deckard's pages, or the Outline. A tag parks everything a search for it finds — its notes, the headings it is on and everything under them, and its tasks — and its sub-tags: `project/old` parks `#project/old/phase-1`. A parked tag's own page says **Parked** with **Unpark**.

| Left out | Kept, listed last and marked **Parked** |
| --- | --- |
| The Tasks view, its badge, the status bar and reminder, the Task board, Home's task widgets, the calendar, rollover, a review's still-open list, Gone quiet, Related Notes, the Notes Graph (until **Show parked**), tag completion, and Stats' unlinked notes | Search pages, Home's saved-search widget, Find, `[[` completion, Linked from, query blocks, and the AI tools |

A list of things to do shows parked tasks only when its own search mentions `is:parked`: set `deckard.agenda.query` to `is:parked`, or search the board for `is:open is:parked`. `is:parked` finds everything parked, and `-is:parked` everything else. A status that should leave the Tasks view entirely, such as `someday`, can be parked by adding `status/someday` to `deckard.parked.tags`.

**Park or exclude?** Exclude files that are not notes at all, such as build output; an excluded note is not read, and no search finds it. Park notes you are done with. `deckard.exclude` wins when both match.

---

← [Daily notes, reviews, and the calendar](daily-notes.md) · [All topics](README.md) · [Themes and Zen mode](themes-and-zen.md) →
