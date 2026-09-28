# Getting started

## Requirements

- VS Code 1.134.0 or newer.
- An open folder or workspace containing Markdown notes.

Deckard scans every `*.md` file in each workspace folder by default. Set a notes folder to restrict the index.

## Install

Download the VSIX attached to a GitHub release and run `Extensions: Install from VSIX...` in VS Code.

## Get started

**Sample workspace:** run `Deckard: Create a Sample Workspace`. It opens a tour in this window when no folder is open, and otherwise in a new window or this one, as you choose. Its README, **Start here**, leads through ten notes, one per topic, each ending with **Try it**: the commands, keys, and searches to run. The notes are dated from the day you make them. Running the command again offers a fresh copy.

**Walkthrough:** `Deckard: Get Started`, or **Walkthrough** in Home's gear, opens six steps: open a note, tag it, capture a task, see the workspace, find anything, and choose a theme. Each is checked off as you do it.

**In your own notes:**

1. Open a folder or workspace in VS Code.
2. Open any Markdown note in the workspace, or [restrict indexing to a folder](settings.md#settings).
3. Run `Deckard: Open Dashboard` from the Command Palette.
4. Select the Deckard icon in the Activity Bar to open **Related Notes** while editing a Markdown note.

Deckard refreshes when saved notes are added, edited, or deleted. The first time, it says what it found, such as *Deckard read 412 notes: 1,204 open tasks (17 overdue) and 185 tags.* A workspace of 3,000 notes or more is also told how the "Exclude" setting leaves folders out.

In a code repository, Deckard's editor features apply only to notes: a README outside `deckard.notesFolder`, or under `node_modules`, is left alone.

`Deckard: Reindex Workspace` reads and parses every note again. A rescan after a settings change rereads only the notes whose size or saved time changed.

## Help

Run `Deckard: Open Help`, or select the question-mark button in the Context view's title bar. A command Help names, such as `Deckard: Find in Notes`, is a button that runs it, with its shortcut beside it. One that acts on the note in the editor, such as `Deckard: Edit Task`, is named for you to run from a note.

![Deckard Help page with quick-start instructions and feature navigation.](../images/help.png)

---

[All topics](README.md) · [Writing notes: tags, people, and links](notes-and-links.md) →
